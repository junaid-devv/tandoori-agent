# Restaurant Agent

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
| AI | OpenRouter and optional Google AI Studio |
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
| `OPENROUTER_API_KEY` or `GOOGLE_AI_API_KEY` | AI interpretation/support |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta WhatsApp phone number ID |
| `WHATSAPP_ACCESS_TOKEN` | Meta Graph API token |
| `WHATSAPP_APP_SECRET` or `META_APP_SECRET` | Webhook and Flow signature validation |
| `WHATSAPP_VERIFY_TOKEN` | Secret used by Meta webhook verification |
| `RATE_LIMIT_HASH_SECRET` | HMAC secret for rate-limit identifiers |
| `ADMIN_RESET_ENABLED` | Optional production gate for destructive dashboard reset |

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

- Apply `migrations.sql` before routing live WhatsApp traffic.
- Keep `WHATSAPP_ALLOW_UNSIGNED_FLOW_ENDPOINT=false` in production.
- Keep `WEBHOOK_STORE_RAW_BODY=false` and `WEBHOOK_RETAIN_PROCESSED_PAYLOAD=false` unless temporarily debugging an incident.
- Keep `ADMIN_RESET_ENABLED=false` unless production admins explicitly need destructive reset controls.
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
