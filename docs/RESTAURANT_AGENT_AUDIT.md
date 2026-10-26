# Restaurant agent inspection and repair

Latest follow-up: [26 October menu, multi-query, reply recovery and deployment verification](RESTAURANT_AGENT_RELIABILITY_2026_10_26.md). Catalog counts and deployment limitations below are historical snapshots; the follow-up supersedes them.

Date: 25 October 2026. Scope: the active WhatsApp inbound path, language detection, NLU, history/context, cart and menu resolution, checkout state machine, fulfillment, order persistence, cancellation, replies, and deployment diagnostics.

## Result

The active ordering path was simplified and repaired. It supports multi-item delivery, pickup, and dine-in orders with quantity, size, preparation notes, rider instructions, fulfillment collection, an explicit review, and a separate confirmation. The database enforces the reviewed cart and consumes it atomically when placing an order. This is a tested implementation, not a claim that every possible customer utterance or production failure has been eliminated.

On 26 October 2026, the authorized migration was applied to the live `tandoori-restaurant-agent` project (`msjgqesrnnxrjbhijmlq`). Supabase recorded `restaurant_order_integrity` as version `20261026105455`; its read-only application version is `20261025124633`. Verification confirmed the deferred order trigger, atomic turn RPC, service-role permissions, rejection of anonymous writes, timezone column and phase coverage checks. The application service-role API also returned the expected version. The existing installation needed a timezone column, so the migration now adds it with `Asia/Karachi` as the default; the PostgreSQL fixture tests this older schema.

No customer messages were sent and no application deployment was triggered manually. Concurrent dashboard redesign files were preserved outside the agent commit. Security advisors reported the same pre-existing extension-schema and password-protection warnings before and after the migration, with no new findings.

## Findings and implemented changes

| Problem found | Resulting behavior |
|---|---|
| Overlapping substring/regex fast paths interpreted negation and compound requests as button taps. Numeric `2` could start checkout instead of selecting the displayed item. | Deterministic routing accepts exact choices. Current pending choices take precedence; natural language goes through NLU. Unshown item IDs cannot add dishes. |
| NLU saw stage and cart without prior conversation or fulfillment; its cache could reuse another customer's interpretation. | The model receives recent preceding conversation, current fulfillment, displayed choices, and unresolved portions. A SHA-256 key includes the entire input, including conversation identity. Future queued messages are excluded from history. |
| Large repetitive prompts increased quota failures. Invalid/truncated primary outputs could strand a conversation. | A smaller extraction prompt describes the actual contract. Requests have cancellation/timeouts, no hidden SDK retry loop, and bounded output allowances. Primary failures, truncation, and invalid extractions retry the fallback; failures never produce speculative cart edits. |
| Price queries could discard the ordering part of compound messages. Quantity strings/nulls could change meaning. | Mixed question/order messages preserve both intents. Note-only quantity null is preserved. Numeric removal strings preserve the amount; invalid quantities fail validation. |
| Resolving one variant discarded original quantity/preparation or later requested dishes. | Pending clarification retains the original mention and remaining items, resumes them after selection, and survives factual interruptions. |
| Cooking instructions could add another portion, merge differently prepared portions, or alter an arbitrary item. | Note-only edits change a uniquely identified existing portion. Different preparations stay separate. Ambiguous edits ask for clarification. Size edits resolve the requested sibling variant and retain quantity. |
| Cart removals/updates searched the global menu and could alter another dish. | Edits resolve against the current cart. Partial removal consumes the requested total once. |
| Any text during address collection could become a destination; old rejected addresses could reappear through nullish fallback. | Address slots come from interpretation or an owned saved address. Area inquiries do not select destinations. Incomplete/rejected replacements clear the old address and continue collection. |
| Coverage ranges matched house numbers instead of the named phase, allowing wrong destinations. | Application and PostgreSQL coverage bind a phase/range number to its area prefix and use phrase boundaries. |
| Invalid or vague times silently became “45 minutes from now”; summary omitted reservation details. | Invalid/past/ambiguous times are clarified. Pickup and dine-in reviews include actual local time and guest count; scheduled service must fall within operating hours. |
| Generic affirmations could add an unseen upsell or confirm changed/unreviewed details. | No automatic upsell addition. Changed orders require another summary and confirmation. A “yes” after an unrelated information reply requires renewed review. |
| Root rider instructions were lost, and post-order fulfillment edits could silently alter dispatch/fees. | Instructions appear in review and reach placement. Changes to accepted orders go to staff. Previous orders can be rebuilt with current menu availability/prices and fresh fulfillment/review. |
| Cancellation could affect an older accepted order while a new draft existed, or race with kitchen preparation. | Draft cancellation stays local. Automatic accepted-order cancellation uses a conditional database update requiring received status and the 10-minute window; other cancellations request staff review. |
| State errors were swallowed; duplicate replays only compared the most recent inbound ID; creating state could reset another worker's row. | Persistence failures propagate. The conversation lock is rechecked before processing. State creation does not overwrite an existing row. An atomic RPC stores the draft mutation and a durable inbound receipt together. |
| Order insert and draft consumption were separate operations, allowing another confirmation after a partial failure. | A deferred PostgreSQL trigger validates the complete committed order against the reviewed draft and consumes that draft in the same transaction. Repeated confirmation cannot create another order. |
| Cached quotes/availability could change before commit. | The RPC validates branch, current menu identity/availability/prices, service, delivery minimum/fee/coverage, future times, instructions and reviewed lines. Changes roll back and require a new review. |
| A successful insert followed by a failed receipt lookup could be described as a failed order. | Placement remains successful; the order UUID is a safe fallback reference. |
| English words containing Urdu fragments switched reply language; Pashto ordering verbs became kitchen notes. | Language signals use whole words, preserve preference for neutral taps/dish names, and the prompt distinguishes ordering verbs from preparation. |
| Unsupported paid extras or allergy assurances could be invented. | Unpriced addons and explicit allergy concerns require staff verification. The agent never guarantees allergen safety. |
| Voice processing errors after transcription could be described as transcription failure, encouraging a duplicate order. | Real processing/transport failures propagate for handling, and transcription logs avoid customer text. Voice turns use the same locked ordering pipeline and inactivity reset. Persisted human/paused state also prevents accidental bot resumption if a mode update fails. |
| Health/readiness checks recognized AI credentials the active client did not use and missed the new RPC dependency. | Checks recognize supported agent providers, tenant channel credential storage, and a read-only order-integrity migration version probe. |

## Architecture

The entry point is `lib/whatsapp-inbound.ts`, shared by the supported WhatsApp transports. It acquires the conversation lock before invoking `lib/agent/pipeline.ts`.

The pipeline loads context, interprets an exact choice or calls NLU, asks the pure state machine for actions, executes validated actions, and awaits durable persistence. Language generation is grounded in restaurant/menu facts; cart mutations and placement remain deterministic. PostgreSQL is the final authority for committed orders.

The NLU/pipeline/state machine were shortened substantially by removing duplicate keyword overrides and repetitive prompt examples. The existing schema is retained; unresolved mentions live inside the existing pending-clarification JSONB field. Database changes are isolated in a new migration.

## Verification

- `npm run check:all-guards`: passed, including existing routing, interactive, parser, operational, security, menu, cart, E2E, latency, Evolution/Meta isolation and persona checks.
- `npm run check:agent-conversations`: 47 checks passed through the real pipeline/executor with a local OpenAI-compatible HTTP fixture and isolated repositories. Includes 5 complete test orders; no live orders.
- `npm run check:order-integrity`: 24 checks passed in real PostgreSQL via PGlite, executing the actual migration and RPC. Includes rollback, reviewed cart/notes, schedule, branch, coverage, replay, permissions and atomic state/receipt checks.
- Synthetic live AI evaluation: 12/12 passed (median 691 ms in the final run), covering English, Roman Urdu, Urdu-script and Roman Pashto ordering, corrections, information, instructions, fulfillment, and handoff. This evaluates NLU only and does not demonstrate live WhatsApp delivery or production database behavior.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed.
- Scoped ESLint for changed runtime/test files: no errors; existing unused optional parameters generate two warnings.
- Repository-wide lint remains failing outside this repair scope (50 errors and 46 warnings in the recorded run, including legacy scripts and UI). Counts may change with the concurrent dashboard work. The baseline already failed repository lint.

Some old guards inspect source strings rather than behavior. Two were updated to inspect the actual alert rendering/hourly analytics data instead of dashboard wording changed by the concurrent redesign. New ordering and PostgreSQL checks assert observable behavior.

## Required deployment steps

1. For other environments, apply the existing baseline and ordered migrations, including `supabase/migrations/20261025124633_restaurant_order_integrity.sql`, to the intended Supabase database before deploying the agent. It creates the reviewed-order trigger, updated placement RPC, atomic turn/receipt RPC and read-only health version function. A missing migration fails closed.
2. Configure a strong `WHATSAPP_VERIFY_TOKEN` matching Meta when using Meta. The local deployment preflight currently fails its minimum 24-character/non-placeholder requirement. No credential values were changed or printed.
3. Verify the selected restaurant's WhatsApp connection, branch ownership, menu sizes/prices/availability/descriptions, operating timezone/hours, delivery fee/minimum/areas, and staff alerts. Phone IDs/tokens are tenant configuration, not shared fallback credentials.
4. Confirm AI account throughput for peak traffic. Live tests exposed provider 429 quota limits. The prompt and primary allowance were reduced and a fallback is tested, but local correctness cannot increase an account's quotas. Run the synthetic live evaluation against the intended credentials/model.
5. Check `/api/health` after migration and deployment, then run real delivery, pickup, dine-in, correction, voice, handoff, duplicate webhook and failed outbound delivery scenarios using a test customer number. Verify the kitchen/dashboard order exactly matches the reviewed items and instructions.
6. Clear remaining repository lint failures before making a repository-wide clean-quality claim.

## Practical limits

- Live language evaluation is a small synthetic sample, not a measured accuracy rate or proof of every dialect/typo. Confidence is a model estimate; low confidence and repeated failures clarify or hand off.
- Urdu script input is accepted; the current preference contract replies in English, Roman Urdu or Roman Pashto. Urdu/Pashto script output is not a separate preference.
- Complete-address checks are heuristic, not geocoding. Coverage names should match configured customer-facing names. Urdu-script addresses may require staff clarification when coverage names are Latin-only; phase boundaries are intentionally strict.
- Addon prices, allergen/cross-contamination data, table capacity, real-time kitchen inventory and dispatch routing need authoritative business integrations. Unsupported paid extras/allergy assurances go to staff; no capacity allocation guarantee is implemented.
- Free-form answers use grounding instructions and can still be wrong. Maintain accurate descriptions and review live transcripts; the model cannot directly execute order mutations.
- Processing failures and outbound failures create staff alerts, but this change does not add an exactly-once transactional WhatsApp outbox. A crash after a database commit or an uncertain provider send may require staff to confirm/recover the reply. Duplicate orders are prevented by the database safeguards.
- Remote schema, permissions and the read-only service-role health RPC were verified on 26 October 2026. No production load test, live voice transcription quality study or end-to-end customer-channel smoke test was performed.

## Follow-up: production conversation on 26 October 2026

The earlier synthetic tests missed a real failure. Reviewing today's production conversation and stored menu confirmed these linked problems:

- The customer requested an egg burger and an unspecified drink for delivery. NLU correctly left the drink unsized, but menu resolution automatically chose the 1.5-litre drink. Only that volume format was recognised as a variant; 1-litre and 500-ml names were treated as unrelated base dishes.
- Selecting the owned saved address advanced to `confirming` without a summary or confirmation buttons. The executor and checkout also disagreed about an abbreviated street address containing multiple digits.
- A question mark produced a generic misunderstanding response instead of the pending choices or checkout step.
- The model copied previous fulfillment fields when another dish was requested. On a later saved-address reference it replayed all three earlier items, doubling the draft quantities. No order had been placed today at inspection time.
- An unrelated addition or menu-browsing interruption could erase an unresolved size choice. Additions could also go unacknowledged when a scheduled review failed validation.

The follow-up repairs recognise numeric drink volumes consistently, compare equivalent ml/litre sizes, reject unavailable requested sizes rather than substituting, and include all matching catalog siblings before deciding a request is unambiguous. Current catalog prices, availability and membership override vector metadata, including when the loaded catalog is empty. Whole-token matching avoids accidental name fragments.

Saved-address taps now pass through the same checkout validation and review as typed addresses. Saved-address references have a dedicated NLU intent; exact phrases use only the conversation's owned saved address and bypass the model. The extraction contract explicitly returns only changes requested in the current message. Its cache version changed so an older extraction is not reused. A question mark re-presents choices or a fresh review without placing an order. Unresolved portions survive additions, browsing and address replies, and actual additions are acknowledged even when checkout is blocked.

Stored menu inspection found 128 items, no duplicate normalised names, and no populated descriptions. The three drink SKUs are `500ml Drink` (Rs. 99), `1 Liter Drink` (Rs. 150), and `1.5 Liter Drink` (Rs. 199). Brand, ingredient and deal-content facts are absent and must be supplied by the restaurant; none were invented or written to the menu. Stored delivery settings require a Rs. 500 food subtotal and charge Rs. 150 delivery. An initial burger/drink draft below that minimum must request more food rather than offer confirmation.

Verification after the follow-up:

- 62 isolated pipeline/conversation checks, including an anonymised replay of the incident and interruptions before choosing a drink.
- 23 resolver checks exercising both lexical fallback and a real local embedding endpoint with deliberately incomplete vector RPC results.
- 18/18 live NLU cases, including historical cart/address context, saved-address references and an explicit extra portion. One primary provider request failed with HTTP 400 and the configured fallback returned the correct extraction.
- Production build and TypeScript passed; scoped lint had zero errors and one existing unused-parameter warning.
- Existing PostgreSQL integrity tests still cover 24 commit/replay/fulfillment cases. No additional schema migration is needed for this application-only repair.

The original customer draft was inspected, not rewritten, and no customer-channel replies or orders were sent during this follow-up. Its previously duplicated quantities need a fresh review/reset before that draft is used again. Repaired code does not retroactively infer a customer's unchosen drink size.
