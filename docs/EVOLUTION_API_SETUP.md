# Evolution API and official Meta Cloud API

ORDERiQ keeps its existing dashboard, inbox, AI ordering flow, menu settings,
staff handoff, and order notifications. A restaurant can select **Meta**, **Evolution**,
or **Disabled** in WhatsApp Integration. Configure and pair each restaurant from
that page; the Evolution Manager UI is not required.

## Application setup

Apply `supabase/migrations/20261024150130_evolution_multi_tenant_provider.sql`
to every existing application database. Fresh installations using `db/schema.sql`
already include the new tables and columns. Do not run the destructive rebuild
schema against an existing database.
The migration has already been applied to the connected Tandoori project
(`msjgqesrnnxrjbhijmlq`). Other project databases need their own migration.

Set these variables on the **dashboard application server** when Evolution is deployed:

```dotenv
EVOLUTION_API_BASE_URL=https://your-evolution-server.example
EVOLUTION_API_KEY=the-same-value-as-the-servers-AUTHENTICATION_API_KEY
EVOLUTION_WEBHOOK_SECRET=a-different-random-secret-with-at-least-32-characters
APP_URL=https://your-existing-dashboard.example
```

Generate each secret separately:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep keys server-only. Do not add `NEXT_PUBLIC_` to them. Restart/redeploy the
dashboard after changing environment variables. Leaving Evolution's URL/key empty
is supported: the dashboard reports setup is required, and Meta remains usable.
Provider selection is stored **per restaurant**, not in a global environment switch.

This workspace's ignored `.env.local` already has separately generated gateway and
webhook secrets. Preserve them and copy the values privately to the dashboard host;
use the gateway key as Evolution's `AUTHENTICATION_API_KEY` when deploying it.
`EVOLUTION_API_BASE_URL` remains empty until your server exists. `APP_URL` must be
your actual public dashboard URL. Production hosting variables have not been changed.

## Railway or another host

Use Evolution API **v2**. The supplied Docker Compose file pins the release to
`evoapicloud/evolution-api:v2.3.7`. Verify your host can pull that tag before deployment.

For Railway, create an Evolution service from that image, plus PostgreSQL and Redis
services. Set a public HTTPS domain and persist `/evolution/instances` on a volume.
Use Railway's private PostgreSQL and Redis connection URLs for the variables below.
Configure the service port as `8080` (or keep `SERVER_PORT` consistent with your host).

```dotenv
SERVER_TYPE=http
SERVER_PORT=8080
SERVER_URL=https://your-evolution-server.example
AUTHENTICATION_API_KEY=your-random-gateway-key
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://USER:PASSWORD@HOST:5432/evolution?schema=evolution_api
DATABASE_CONNECTION_CLIENT_NAME=orderiq_evolution
CACHE_REDIS_ENABLED=true
CACHE_REDIS_URI=redis://REDIS_HOST:6379/0
CACHE_REDIS_PREFIX_KEY=orderiq_evolution
CACHE_REDIS_SAVE_INSTANCES=false
CACHE_LOCAL_ENABLED=false
WEBHOOK_GLOBAL_ENABLED=false
```

For a VPS, copy `deploy/evolution/.env.example` to `.env` in that directory, fill
the values, then run `docker compose up -d`. Put an HTTPS reverse proxy in front of
`127.0.0.1:8080`. PostgreSQL and Redis stay on the private container network.
Keep all three data volumes persistent and backed up.

The gateway's internal database should be separate from ORDERiQ's public application
tables. If using Supabase PostgreSQL for the gateway, use a dedicated database user
limited to a private `evolution_api` schema and a direct/session connection suitable
for Prisma. Do not expose that schema through the Data API or give the gateway a
Supabase service-role key. A separate Railway PostgreSQL database is also supported.

## Link a restaurant from your dashboard

1. Select the restaurant in ORDERiQ and open **WhatsApp Integration → Evolution API**.
2. Click **Start Session**, then scan the QR under WhatsApp → Linked Devices.
   Alternatively generate a pairing code using the full phone number and country code.
3. The connection status updates automatically. If a QR expires, click Start Session
   again. Refreshing the page does not restart the WhatsApp connection.
4. Select **Use Evolution** to activate it for that restaurant.
5. Send a test message, then check a real customer's menu selection, confirmation
   button, voice order, manual owner reply, and dashboard staff reply.

Instances are named `orderiq-<restaurant UUID>`. The server chooses the name; tenants
cannot supply another restaurant's instance. Every instance gets its own authenticated
webhook at `/api/webhook/evolution`. Tenant routing comes from the instance's database
mapping, never from a `restaurant_id` supplied by an incoming webhook. Do not configure
a shared default instance or a global gateway webhook.

The app subscribes to `MESSAGES_UPSERT`, `MESSAGES_UPDATE`, and `CONNECTION_UPDATE`.
Global API keys and webhook authentication tokens are omitted from status responses
and stored webhook envelopes. Connection records use RLS and are accessible only to
the application's server service role. Ordinary admins are confined to their tenant;
branch staff cannot change integration settings.

## Official API

Meta Embedded Signup and `/api/webhook` remain available. Connect Meta from the
same dashboard and select it as the restaurant's active provider. Its credentials
remain in `whatsapp_configs`; Evolution has a separate `evolution_configs` mapping.
Configuring one provider does not delete the other provider's credentials.
Incoming customer turns run only for the selected provider, preventing two bots
from answering the same business simultaneously. Existing conversations retain
their inbound channel for staff replies and order notifications. A disabled tenant
cannot send new outbound messages.

## Interactive messages and additional features

Both providers use the existing list row IDs and button IDs, so menu pagination,
order type, cart actions, and confirmation continue through the same order engine.
Evolution calls `sendList` and `sendButtons` rather than turning every menu into text.
WhatsApp client and Baileys/version compatibility varies: the upstream feature guide
still marks lists as testing and restricts button support, while current source defines
both endpoints. If the gateway explicitly rejects an interactive send, the existing
assistant dispatcher sends numbered text options instead. An HTTP success does not
prove that every WhatsApp client displayed a button; verify on your deployed version.
Keep Meta available when official interactive delivery is required.

Included: text, images/menu cards, native lists and reply buttons, incoming button/list
selection parsing (including native-flow responses), voice-note transcription through
your existing model, location text, delivery/read receipts, and manual phone replies
that pause the AI. Group/broadcast messages are ignored by the ordering bot.

Useful future additions supported by Evolution's API include polls for feedback,
reactions for order acknowledgments, document/PDF receipts, outgoing voice notes,
location cards for branches, contact cards, quoted replies, typing/read indicators,
and WhatsApp labels. These are feature opportunities, not enabled product features.
Meta-specific templates and WhatsApp Flows are not automatically reproduced by
Baileys list/button endpoints.

## Cutover and verification

Legacy linked-device sessions cannot be imported: each restaurant must pair again.
The additive migration leaves existing live provider selections and old private
gateway tables intact, so applying the schema before deploying the new application
does not stop a currently running installation. The new app reads the old provider
value as Evolution for migration, but never calls the old gateway. Once paired,
select Evolution to save the new provider value. Existing menus, contacts, messages,
orders, and official credentials are retained.

Run `npm run check:evolution` for isolated contract/security regressions with mocked
gateways and two tenant identities. Run `npm run check:all-guards` and `npm run build`
for broader checks. Live QR pairing and actual WhatsApp delivery require the server
URL/key and a linked phone; those cannot be verified before the gateway is deployed.

## Verification performed on 24 October 2026

- Production build (including TypeScript), lint on new integration modules and
  dashboard integration page, and the full `check:all-guards` suite passed.
- The Evolution contract suite uses mocked gateways and two tenant identities;
  it also checks immutable webhook redelivery and live-schema profile field mapping.
- A running production build returned 401 for unauthenticated integration access
  and invalid webhook tokens, 404 for the removed gateway endpoint, and 200 from
  `/api/health` with the live database and all schema checks passing.
- The connected Supabase migration and service-role access were verified. Anon
  and authenticated roles cannot read Evolution connection records.
- Existing Supabase advisor findings remain: mutable function search path, public
  extensions, client-callable menu SECURITY DEFINER RPCs, and disabled leaked-password
  protection. These require a separate review; no broad security cleanup was applied.
  The new table's RLS-without-policies advisory is intentional: only service-role
  access is granted.

Sources:
- [Evolution v2 API reference](https://github.com/evolution-foundation/docs-evolution/blob/main/openapi/openapi-v2.json)
- [Current message DTOs](https://github.com/evolution-foundation/evolution-api/blob/main/src/api/dto/sendMessage.dto.ts)
- [Feature availability](https://github.com/evolution-foundation/docs-evolution/blob/main/v2/en/configuration/available-resources.mdx)
- [Evolution 2.3.7 release](https://github.com/evolution-foundation/evolution-api/releases/tag/2.3.7)
