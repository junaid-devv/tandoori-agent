# ORDERiQ

WhatsApp Cloud API ordering assistant for restaurants, built with Next.js, Supabase, and AI-assisted menu/order understanding.

The app is designed for COD-first restaurant workflows. It does not require online payment to place an order.

## What It Supports

- WhatsApp webhook verification and signed webhook processing
- AI-assisted menu, ordering, and support replies
- Deterministic backend state machine for cart, checkout, confirmation, and order placement
- Delivery, pickup, and dine-in fulfillment
- Delivery area checks, delivery fees, minimum delivery amount, and ETA settings
- Atomic order placement through a Supabase RPC
- Idempotent webhook event storage and atomic webhook claiming
- Duplicate WhatsApp message protection
- Human handoff and staff dashboard replies
- WhatsApp interactive lists and optional WhatsApp Flows
- Outbound message delivery status callbacks: `sent`, `delivered`, `read`, `failed`
- DB-backed rate limiting for login, WhatsApp webhooks, and WhatsApp Flow endpoint
- Privacy defaults that redact raw webhook bodies and processed webhook payloads

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js App Router |
| Database | Supabase Postgres + Realtime |
| AI | Groq or a configured OpenAI-compatible provider (DeepSeek gateway / OpenRouter) |
| Styling | Tailwind CSS |
| Deployment | Vercel or any Node-compatible Next.js host |

## Setup

```bash
npm install
cp .env.example .env.local
```

Fill `.env.local` with real Supabase, WhatsApp, and AI credentials. The most important variables are:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Dashboard client key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only database access |
| `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, or `OPENROUTER_API_KEY` | AI interpretation/support; choose a matching model and endpoint |
| Tenant WhatsApp credentials | Connect each restaurant through the dashboard; IDs/tokens are stored server-side |
| `WHATSAPP_APP_SECRET` or `META_APP_SECRET` | Webhook and Flow signature validation |
| `WHATSAPP_VERIFY_TOKEN` | Secret used by Meta webhook verification |
| `RATE_LIMIT_HASH_SECRET` | HMAC secret for rate-limit identifiers |

Optional WhatsApp Flows variables are documented in [.env.example](.env.example).

Branding and operational defaults can be edited from **Dashboard -> Admin -> Branding** after the first admin account is created. Use `single` branch mode for restaurants with no public branch selection, or `multiple` branch mode when customers should choose a city/branch before ordering.

To generate strong local values for `WHATSAPP_VERIFY_TOKEN` and `RATE_LIMIT_HASH_SECRET` without printing them:

```bash
npm run prepare:production-secrets -- --write-local
```

If the script changes `WHATSAPP_VERIFY_TOKEN`, update the Meta webhook configuration to the same value before verifying the webhook.

## Database

For a fresh database, run [supabase-schema.sql](supabase-schema.sql).

For an existing database, run [migrations.sql](migrations.sql).

Important RPCs created by the schema:

- `place_order_from_payload(...)` for atomic, validated order creation
- `claim_webhook_event(...)` for atomic webhook processing claims
- `check_rate_limit(...)` for DB-backed rate limiting

## Local Development

```bash
npm run dev
```

Dashboard: [http://localhost:3000/dashboard](http://localhost:3000/dashboard)

For local WhatsApp webhook testing:

```bash
npx ngrok http 3000
```

Meta webhook URL:

```text
https://your-ngrok-id.ngrok-free.app/api/webhook
```

WhatsApp Flow data endpoint:

```text
https://your-ngrok-id.ngrok-free.app/api/whatsapp/flows
```

## Production Checks

Run these before deployment:

```bash
npm run lint
npx tsc --noEmit
npm run check:all-guards
npm run build
npm run check:production-readiness
```

`check:production-readiness` validates deployment configuration and schema coverage. It intentionally fails when required secrets are missing, too short, or still placeholders.

## Production Deployment Notes

- Apply the baseline `migrations.sql` and the ordered files in `supabase/migrations/` before routing live WhatsApp traffic. `20261025124633_restaurant_order_integrity.sql`, `20261026124645_restaurant_agent_reply_recovery.sql`, and `20261103110240_area_delivery_pricing.sql` are required before deploying this version. `/api/health` checks all three migration versions and that ordering branches have priced catalogs.
- Keep `WHATSAPP_ALLOW_UNSIGNED_FLOW_ENDPOINT=false` in production.
- Keep `WEBHOOK_STORE_RAW_BODY=false` and `WEBHOOK_RETAIN_PROCESSED_PAYLOAD=false` unless temporarily debugging an incident.
- Operational reset is available to authenticated admins in all environments and requires the exact typed confirmation phrase.
- Configure Meta webhook subscription for messages and status callbacks.
- Make sure `WHATSAPP_VERIFY_TOKEN` exactly matches the token configured in Meta.
- Set the restaurant profile in Admin -> Branding, then configure branch settings: open hours, delivery enabled, delivery fee, minimum delivery, delivery areas, prep ETA, delivery ETA, phone numbers, and AI tone.
- Test at least one real delivery, pickup, dine-in, human handoff, unsupported media, status update, and duplicate webhook replay before launch.

## Architecture

```text
WhatsApp webhook
  -> verify Meta signature
  -> rate-limit request source
  -> persist webhook event by body hash
  -> claim event atomically
  -> extract message/status callbacks
  -> persist inbound message or update outbound delivery status
  -> acquire per-conversation lock
  -> load branch, settings, menu, state, session
  -> deterministic order engine advances workflow
  -> AI is used only for NLU/support fallback
  -> atomic order RPC validates menu, prices, fulfillment fields
  -> persist assistant/human replies
  -> dashboard updates through Supabase
```

## API Routes

| Method | Route | Description |
|---|---|---|
| GET | `/api/webhook` | Meta webhook verification |
| POST | `/api/webhook` | WhatsApp message/status webhook |
| POST | `/api/whatsapp/flows` | Encrypted WhatsApp Flow data exchange |
| GET | `/api/conversations` | Conversation list |
| GET | `/api/conversations/[id]` | Conversation detail |
| GET | `/api/conversations/[id]/messages` | Conversation messages |
| PATCH | `/api/conversations/[id]` | Toggle AI/human mode or unread state |
| POST | `/api/conversations/[id]` | Send a staff message |
| GET | `/api/orders` | Orders with items |
| PATCH | `/api/orders/[id]/status` | Update status and notify customer |
| GET/POST | `/api/settings` | Branch restaurant settings |

## Current Launch Gate

The codebase builds and passes local guards. Production launch is still gated on external configuration:

- Real production secrets must be set in the host.
- Supabase migrations must be applied.
- Meta webhook and optional Flow endpoints must be configured with matching secrets.
- A live WhatsApp smoke test must pass against the production URL.


## Restaurant Agent Verification

The latest menu, multi-query, delivery recovery and latency repairs are documented in [docs/RESTAURANT_AGENT_RELIABILITY_2026_10_26.md](docs/RESTAURANT_AGENT_RELIABILITY_2026_10_26.md). Earlier inspection is retained in [docs/RESTAURANT_AGENT_AUDIT.md](docs/RESTAURANT_AGENT_AUDIT.md).

```bash
npm run check:agent-conversations   # Real pipeline/executor with local parser HTTP fixture
npm run check:order-integrity       # Real migration/RPC in isolated PostgreSQL via PGlite
npm run check:reply-recovery        # Real delivery claim/retry logic, isolated PostgreSQL and a stub sender
npm run check:answer-recovery       # Rejected, incomplete and slow AI answers recover within one budget
npm run check:live-order-understanding # Synthetic NLU cases using your configured AI provider
npm run check:live-menu-catalog     # Read-only live catalog SKU/price resolution and migration check
```

The first four checks never contact production services. The live NLU check uses AI credits and intentionally pauses between requests; it never accesses the database or sends WhatsApp messages. Set `LIVE_NLU_PAUSE_MS` to pace it for your provider quota; `LIVE_NLU_FILTER=incident` selects the latest screenshot cases. The live catalog check reads the configured database without writing any data or sending messages. `ORDER_AGENT_ANSWER_FALLBACK_MODEL` optionally selects a compatible free-form answer fallback; otherwise it uses the configured NLU fallback or the default Groq fallback, within the existing answer timeout.

`ORDER_AGENT_NLU_MAX_TOKENS` controls the extraction/fallback allowance (default 1600). Groq primary requests default to at most 900 tokens; override with `ORDER_AGENT_NLU_PRIMARY_MAX_TOKENS` after verifying the account quota. A truncated or invalid primary extraction retries the fallback. `ORDER_AGENT_NLU_TIMEOUT_MS` bounds each attempt (default 6000), and `ORDER_AGENT_NLU_TOTAL_TIMEOUT_MS` bounds primary plus fallback together (default 10000). `ORDER_AGENT_ANSWER_TIMEOUT_MS` is the shared free-form answer budget per turn (default 6000). Named catalog questions and ordinary item resolution do not need a second model or an embedding request. Override `ORDER_AGENT_NLU_FALLBACK_MODEL` to select a compatible fallback. Groq uses its own endpoint; other credentials use `ORDER_AGENT_NLU_BASE_URL` when configured. Model and endpoint must belong to the selected provider. A Google AI key alone does not configure this agent's OpenAI-compatible client.


## Area delivery pricing

Apply `supabase/migrations/20261103110240_area_delivery_pricing.sql` after the existing ordered migrations, before deploying the new app. Health checks verify the new columns and pricing function version. Existing branches keep their flat fee.

In **Dashboard → Settings → Delivery**, choose **By area**, then add each area, its charge, and optional alternate spellings (comma-separated). A zero charge means free delivery for that area. Only listed areas are served in this mode; the old flat-fee coverage list is used only in Flat fee mode. Avoid overlapping area definitions: an address matching multiple zones requires clarification.

The assistant shows the matched charge and total before confirmation. The database independently resolves and checks that price against the reviewed quote. A changed charge requires a new review. Each order stores its own delivery fee, so later settings edits leave historical totals intact.
