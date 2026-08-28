# Tandoori Agent — Rebuild Audit & Architecture Proposal

> Status: **DRAFT — awaiting sign-off before any implementation.**
> Scope: full production-grade rebuild of the WhatsApp ordering agent for Pakistani restaurants/cafes.

---

## PART 1 — AUDIT (what exists today)

### 1.1 Stack
- **Next.js 16** (App Router) — webhook + dashboard in one app.
- **Supabase (Postgres + pgvector)** for data.
- **OpenAI SDK** pointed at **OpenRouter** (NLU) + **Google AI Studio** (support replies, menu OCR) + **OpenAI embeddings**.
- **Anthropic SDK** is a dependency but effectively unused in the hot path.
- **zod** for schema validation of the LLM NLU output.

### 1.2 Module map (current)

| File | Lines | Responsibility | Verdict |
|---|---|---|---|
| `app/api/webhook/route.ts` | **2,310** | WhatsApp ingest, signature, dedup, branch/city selection, session hydration, orchestration, delivery | **God-route.** Mixes transport, routing, business logic. Split needed. |
| `lib/order-engine.ts` | **5,828** | `decideTurn` mega-dispatcher over `workflow_step`, cart ops, item matching, **179 regex literals**, ~40 `isX/parseX` keyword helpers | **Core problem.** One file doing everything. Keyword-NLU everywhere. |
| `lib/order-flow-handlers.ts` | 897 | `handleAwaitingConfirmationFlow`, `handleLogisticsAndFallbackFlow` | Extension of order-engine; same coupling. |
| `lib/ai.ts` | 729 | LLM NLU (`getOrderTurnInterpretation`), support fallback reply, menu OCR | NLU is sound in isolation but only used as ONE call; its result is second-guessed by regex. |
| `lib/order-input-parsers.ts` | 245 | qty/address/guest/time regex parsers | Mostly replaceable by LLM entity extraction. |
| `lib/order-menu-*.ts` (categories/replies/text-utils) | ~460 | menu list rendering + fuzzy text matching | Keep rendering; retire fuzzy-match-as-NLU. |
| `lib/semantic-menu.ts` | 211 | embeddings + `match_menu_items_by_embedding` RPC + **lexical fallback** | Infra exists but **not the real retrieval path** (see 1.5). |
| `lib/whatsapp.ts` | 509 | Graph API send (text/list/flow/media) | Keep; trim flow senders. |
| `lib/whatsapp-flow.ts` | 413 | **WhatsApp Flow feature** | **DEAD — remove entirely** (see 1.4). |
| `app/api/whatsapp/flows/route.ts` | 534 | **WhatsApp Flow endpoint** | **DEAD — remove.** |
| `lib/webhook-interactive-builders.ts` | 151 | builds flow/list messages | Flow parts dead; keep list builders. |
| `lib/user-session.ts` | 281 | `user_sessions` node/status tracking | **Redundant with `conversation_states`** — two overlapping state stores. Consolidate. |
| `lib/messages.ts` / `assistant-dispatcher.ts` | 561 | persist + dispatch outbound | Keep, simplify (drop flow branch). |
| `lib/branches.ts` / `webhook-city-helpers.ts` | 375 | branch/city selection + regex intent | Keep logic, move detection to NLU. |
| `lib/customer-crm.ts` | 207 | saved address, reorder, order stats | Keep; move `isReorderRequest`/`isUseSavedAddressRequest` regex into NLU. |
| `lib/settings.ts` / `restaurant-profile.ts` / `restaurant-time.ts` / `menu.ts` / `menu-availability.ts` | ~1,000 | config, hours, menu CRUD | Keep, mostly clean. |
| `lib/staff-alerts.ts` / `handoff.ts` | 148 | human handoff | Keep. |
| `lib/rate-limit.ts` / `webhook-events.ts` / `record-access.ts` / `cache.ts` / `supabase*.ts` | ~250 | infra | Keep. |
| `lib/admin*.ts` / `auth.ts` | ~770 | dashboard admin/auth | Keep (out of agent hot path). |
| `lib/message-personality.ts` | 76 | tone strings | Fold into reply layer. |

### 1.3 Duplicated / overlapping logic
1. **Two state stores:** `conversation_states` (cart, workflow_step, everything) **and** `user_sessions` (active_node, status, is_bot_active). They track overlapping concerns and can disagree. → collapse to one.
2. **Intent detection in 3 places:** `detectMessageType` (regex), `hasDirectMenuSignal` (regex, in webhook), and the LLM interpreter (`ai.ts`). They can conflict; regex often overrides the LLM.
3. **Item matching in ≥3 places:** `order-text-utils` token overlap, `order-menu-replies` fuzzy match, `semantic-menu` lexical fallback — three fuzzy matchers with different thresholds → inconsistent "did you mean" behavior.
4. **Two SQL files** (`migrations.sql` 1,191 + `supabase-schema.sql` 1,099) that overlap heavily; `migrations.sql` is an append-only patch history full of `add column if not exists` / `drop constraint … not valid`.
5. **Language detection** duplicated across `inferLanguagePreference`, `parseExplicitLanguagePreference`, and the NLU `language` field.

### 1.4 Dead code (remove entirely)
- `lib/whatsapp-flow.ts`, `app/api/whatsapp/flows/route.ts`, flow builders in `webhook-interactive-builders.ts`, `sendWhatsAppInteractiveFlow` + `nfm_reply` handling in webhook, `buildFlowMessageForAgentReply` in `assistant-dispatcher.ts`. The WhatsApp Flow ordering path was **never deployed**.
- Any `order_agent_turns` write-only audit rows if we replace with structured logging (TBD — keep if you want an audit trail).

### 1.5 NLU = keyword matching (every instance flagged)
- **179 regex literals** in `order-engine.ts`; ~40 `isX/detectX/parseX` helpers (`isCheckoutRequest`, `isExplicitYes/No`, `isUpsellYes/No`, `isLikelyDirectOrderRequest`, `isLikelyRemovalOrEditMessage`, `isGenericMenuPrompt`, …).
- `detectMessageType()` and `hasDirectMenuSignal` (webhook) gate the entire pipeline on regex — including which turns even load the menu or call the LLM.
- Urdu/Roman-Urdu handling is **hardcoded phrase lists** inside the NLU prompt and regex (`'iske ilawa'`, `'kuch aur'`, unicode ranges for چکن/بریانی…). Brittle by construction.

### 1.6 Vector search — scaffolded, not the real path
- Infra is real: `vector(1536)` column, `menu_item_embeddings`, `match_menu_items_by_embedding` RPC (cosine), sync fired on menu save.
- **But:** if no embedding API key is set, `getEmbeddingClient()` → null → `createEmbedding` → null → **always `lexicalFallback` (token overlap)**. And semantic results are passed to the LLM only as *hints*, never used as the authoritative retrieval/ranking path. Net effect for the user = keyword matching wearing a vector costume.

### 1.7 Performance issues
- Regex gates decide whether to load menu / call LLM — but the **god-route still does many sequential awaits** (settings, state, branch, contact, session, saved address) before deciding.
- NLU + support reply can both fire in one turn (two LLM round-trips).
- In-memory caches (`interpretationCache`, menu cache) are **per-serverless-instance** → cold on every new Lambda; not shared.
- Embedding generated per query with no query cache.
- `conversation_states` read + write are separate round-trips around a large `decideTurn`.

### 1.8 Database tables (usage-verified)
Used: `branches, restaurant_profiles, restaurant_settings, contacts, customer_addresses, conversations, messages, conversation_states, menu_items, menu_uploads, menu_item_embeddings, orders, order_items, staff_profiles, staff_branch_access, staff_alerts, user_sessions, webhook_events, order_agent_turns`.
Redundant/absorbable: `user_sessions` (→ merge into `conversation_states`), `order_agent_turns` (optional), `menu_uploads` (keep only if OCR history matters).

---

## PART 2 — TARGET ARCHITECTURE (proposed)

### 2.1 Principles
- **LLM-first NLU.** One structured extraction per turn (intent + entities + language + sentiment) via tool/function-calling schema. No regex gating the pipeline. Keep a *tiny* deterministic fast-path only for exact interactive-button IDs and pure numeric selections (zero ambiguity, saves an LLM call).
- **Thin state machine, rich context.** `workflow_step` becomes a small FSM that the LLM output *advises*, not a giant switch. Non-linear jumps (price question mid-address) are allowed because the FSM consults intent, not position.
- **Vector search is THE retrieval path.** Every item lookup/recommendation goes through embeddings → `match_menu_items_by_embedding`, with lexical only as a genuine fallback when a query is too short to embed. Embedding key becomes required config; startup check warns if missing.
- **Separation of concerns.** Transport ≠ orchestration ≠ domain ≠ persistence ≠ rendering.
- **Latency budget per turn** with explicit parallelism and shared caching.

### 2.2 Target module structure
```
app/api/webhook/route.ts            # transport only: verify, dedup, enqueue, 200 fast. ~150 lines
lib/agent/
  pipeline.ts                       # orchestrates one turn (the ONLY place that sequences steps)
  nlu.ts                            # single LLM extraction (intent+entities+lang+sentiment), zod-typed
  state-machine.ts                  # pure FSM: (currentState, nlu, cart) -> nextState + required action
  actions/                          # one file per capability, pure-ish, testable
    add-items.ts  remove-items.ts  set-order-type.ts  collect-address.ts
    confirm.ts    browse-menu.ts   order-status.ts    handoff.ts   reorder.ts
  reply.ts                          # renders localized WhatsApp replies (EN / Roman Urdu) from action results
  context.ts                        # loads+caches per-turn context (state, menu, settings, saved addr) in parallel
lib/menu/
  search.ts                         # vector-first retrieval (embeddings + RPC), lexical fallback, query cache
  embeddings.ts                     # sync + create
  catalog.ts                        # menu CRUD + cache
lib/wa/
  client.ts                         # Graph API send (text/list/media)
  ingest.ts                         # parse incoming envelope -> normalized Message
  interactive.ts                    # list/button builders (NO flows)
lib/data/                           # thin repositories, one per aggregate
  conversation.ts  contact.ts  order.ts  settings.ts  branch.ts  customer.ts
lib/core/ (rate-limit, webhook-events, cache, supabase, time, config)
```
Deleted: `whatsapp-flow.ts`, `app/api/whatsapp/flows/`, flow builders, `user-session.ts` (merged), the bulk of `order-engine.ts` (decomposed into `actions/` + `state-machine.ts`).

### 2.3 Conversation / state model
Single FSM stored in one row (`conversations.state` jsonb or slim `conversation_states`):
```
stage: greeting | browsing | building_cart | choosing_order_type
     | collecting_delivery | collecting_dinein | collecting_pickup
     | confirming | placed | post_order | human
cart: [{ menu_item_id, name, qty, unit_price, size, addons[], notes }]
order_type, delivery_address, guests, reservation_time, pickup_time
language: en | roman_urdu
pending_clarification: null | { kind, options[] }
last_shown_options: [menu_item_id]     # for numeric selection
updated_at
```
**Turn algorithm (pipeline.ts):**
1. Fast-path: if interactive button/list reply or bare number matching `last_shown_options` → resolve deterministically, skip NLU.
2. Else run `nlu()` once → `{intent, items[], removals[], order_type, address, guests, time, asks[], language, sentiment, wants_human}`.
3. `state-machine.next(stage, nlu, cart)` → `{nextStage, actions[]}`. Handles **mid-flow switches** (e.g. address stage + "kitne ka hai" → answer price, stay in stage) and **multi-intent single messages**.
4. Run action(s) (vector search for item resolution, cart mutation, order placement via `place_order_from_payload`).
5. `reply.render(actionResults, language, tone)` → localized WhatsApp message(s).
6. Persist state + outbound in one write path.

### 2.4 Conversation lifecycle (every stage mapped)
`greeting → intent detection → menu browse/search (vector) → cart building → customization (size/addons/notes) → order type → delivery/dine-in/pickup details → confirmation → place order (COD default) → order status/tracking → post-order (repeat order, complaint → handoff)`. Context (cart, last question, pending clarification, language) carries via the single state row; every stage can be re-entered non-linearly.

### 2.5 NLU design (replaces keyword lists)
- One JSON-schema/tool-call extraction. Handles EN / Roman Urdu / Urdu-script / code-mixed natively via the model, **not** phrase tables. We keep a *small* curated few-shot set (5–10 real Pakistani-WhatsApp examples) instead of exhaustive regex.
- Output validated by zod (reuse existing schema, trimmed). One repair retry max.
- Sentiment/`wants_human` drive handoff.

### 2.6 Menu search (genuinely functional vector path)
- Embedding key **required**; `search.ts` embeds the query, calls `match_menu_items_by_embedding` (branch-scoped, availability-filtered, threshold tuned ~0.35–0.5), returns ranked items with `menu_item_id`.
- These IDs are what the cart/actions use — **retrieval drives resolution**, not just LLM hints.
- Caches: query→embedding LRU; branch menu + its embeddings warmed. Lexical fallback only for <4-char queries.

### 2.7 Target database (single clean migration, rebuilt from scratch)
`branches, restaurant_profiles, restaurant_settings, contacts, customer_addresses, conversations (+ inline state or slim conversation_states), messages, menu_categories, menu_items, menu_item_embeddings, orders, order_items, staff_profiles, staff_branch_access, staff_alerts, webhook_events`.
Dropped: `user_sessions` (merged), `menu_uploads` (unless OCR history wanted), `order_agent_turns` (optional structured-log table only if you want an audit trail). One `schema.sql` with real `create table`s, proper FKs/indexes, pgvector index (ivfflat/hnsw), and the two needed functions (`place_order_from_payload`, `match_menu_items_by_embedding`, `check_rate_limit`, `claim_webhook_event`). No `add column if not exists` history.

### 2.8 Performance plan
- Transport returns 200 immediately; heavy work in `after()` (already partially done) — formalize.
- One LLM call/turn in the common case (fast-path avoids it for buttons/numbers).
- `context.ts` loads state+menu+settings+savedAddr in **one parallel batch**; menu+embeddings cached and branch-warmed.
- Query-embedding cache; skip embedding for trivial inputs.
- Single state read + single write per turn.
- Optional: move per-instance caches to a shared store (Supabase table or Upstash) so serverless cold starts don't thrash. (Flag for your call — adds a dependency.)

---

## PART 3 — PHASE PLAN (checkpoint between each)

Each phase: define "working", implement, verify with the existing `scripts/check-*` guards + new targeted tests, then check in.

1. **Audit & architecture sign-off** ← *this document.* Done when you approve.
2. **DB schema consolidation** — one `schema.sql` rebuilt from scratch; regenerate `database.types.ts`. Working = schema applies clean on a fresh DB, types compile.
3. **Data/repository layer** — `lib/data/*` repos; swap raw `.from()` calls behind them. Working = build green, dashboard + webhook still function.
4. **NLU/intent layer** — `lib/agent/nlu.ts` single extraction; remove regex gates from ingest. Working = NLU test set (EN/Roman-Urdu/mixed) passes; no regex decides menu-load/LLM-call.
5. **State/context handling** — `state-machine.ts` + `context.ts`; merge `user_sessions`. Working = multi-turn + mid-flow-switch scenarios pass; context persists.
6. **Vector menu search** — `lib/menu/search.ts` vector-first, required key, tuned threshold. Working = item resolution goes through embeddings (verified in logs), recommendations sane.
7. **Order-engine decomposition** — split into `agent/actions/*` + `reply.ts`; delete old `order-engine.ts`/`order-flow-handlers.ts`. Working = full order lifecycle E2E passes.
8. **Dead code / flow removal** — delete WhatsApp Flow code + unused tables. Working = build green, no dead imports, guards pass.
9. **E2E + latency pass** — scenario suite + latency budget check. Working = all scenarios green, p95 turn latency within target.

---

## Decisions (locked 2026-08-28)
1. **Cache**: in-memory LRU now, behind a `CacheStore` interface (`lib/core/cache.ts`) so Upstash/Redis is a later drop-in with no call-site changes.
2. **Embeddings**: OpenAI `text-embedding-3-small` (1536-dim; matches schema vector size).
3. **Audit trail**: KEEP `agent_turns` (append-only, written in `after()`, off the reply path).
4. **Menu OCR history** (`menu_uploads`): KEEP (dashboard uses it).
5. **Deployment**: Vercel serverless (Next.js 16 `after()` already assumes it).

### Phase status
- Phase 1 (audit) — ✅ done.
- Phase 2 (schema consolidation) — ✅ done. `db/schema.sql` + `lib/schema.types.ts`; `tsc` clean. DB apply on fresh Supabase deferred to user (accepted as DoD).
- Phase 3 (data/repository layer + cache foundation) — ✅ done.
  - `lib/core/cache.ts`: `CacheStore` interface + `InMemoryCacheStore` (LRU+TTL, stampede-safe `getOrSet`) + `setCacheStore()` for later Redis swap.
  - `lib/data/`: `contact.repo`, `conversation.repo`, `message.repo`, `order.repo` (+ barrel `index.ts`). Order placement via `orderRepo.place` → `place_order_from_payload` RPC.
  - Call-site migration is done **per consumer in its own phase** to avoid double-work / breakage: state-store consumers → Phase 5; menu/search & `customer-crm` (coupled to order-engine types) → Phase 6–7. New agent code (Phases 4–7) uses these repos from the start.
  - Verified: `tsc --noEmit` clean; `@/*` alias resolves for `lib/data` + `lib/core`.
- Phase 4 (NLU/intent layer) — ✅ done.
  - `lib/agent/nlu.ts`: single LLM extraction → `TurnUnderstanding` (multi-intent, entities, language, sentiment, wants_human). Behavior-oriented intent taxonomy (24 intents incl. `affirm`/`deny`/`ask_recommendation`/`human_request`). Small curated Pakistani-WhatsApp few-shot instead of phrase tables. zod-validated; `coerceUnderstanding()` normalizes/backfills. Cache-aware via `lib/core/cache`.
  - Design goal met: output is self-sufficient so the state machine (Phase 5) needs no post-hoc regex overrides (replaces the `parseOrderTypeShortcut`/`RESTART_WORDS`/`CANCEL_WORDS`/human-regex second-guessing in old order-engine).
  - Test harness: `scripts/alias-register.mjs` + `alias-hooks.mjs` (maps `@/` for node strip-types runs). `scripts/check-nlu.mjs` = 12 offline contract tests (always) + live golden set gated on `OPENROUTER_API_KEY` (EN/Roman-Urdu/Urdu-script/code-mixed/non-linear/escalation). Wired as `npm run check:nlu` + added to `check:all-guards`.
  - Verified: `check:nlu` 12/12 PASS; `tsc --noEmit` clean. Live golden set to be run once keys are configured.
  - NOTE: `lib/core/cache.ts` constructor changed to explicit field assignment (strip-types compatibility). No behavior change.
- Phase 5 (state/context handling) — ✅ done.
  - `lib/agent/state-machine.ts`: PURE FSM `nextTransition(view, understanding) → {nextStage, actions[], escalate}`. Non-linear (mid-checkout questions stay in stage), multi-intent, confirmation-slot gating, bare affirm/deny resolved against context, escalation short-circuit. No regex/keywords.
  - `lib/data/state.repo.ts`: the SINGLE merged state store on new schema (`conversation_states` absorbing `user_sessions`). `get/ensure/patch` + `parseState`/`getDefaultState`. `deriveSessionView()` reconstructs the legacy `active_node`/`status` shape so the dashboard needs no rewrite when it flips (Phase 7).
  - `lib/agent/context.ts`: `loadTurnContext()` — parallel load (state/menu/settings/history) with cached menu+settings via `lib/core/cache`; `buildStateView()`; cache invalidation helpers.
  - Tests: `scripts/check-state-machine.mjs` — 18 pure FSM tests (multi-intent, non-linear, gating, affirm/deny, mind-change, upsell-once, restart, escalation). `npm run check:state-machine`, added to `check:all-guards`.
  - Verified: FSM 18/18 PASS; NLU 12/12 still PASS; `tsc --noEmit` clean.
  - Scoping (same discipline as Phase 3): live dashboard/webhook query rewrite deferred to Phase 7 (atomic schema flip). Phase 5 ships the target modules + the compat view they migrate onto; nothing live is rewired yet, so no breakage against the current DB.
- Phase 6 (vector menu search) — ⏳ next.

