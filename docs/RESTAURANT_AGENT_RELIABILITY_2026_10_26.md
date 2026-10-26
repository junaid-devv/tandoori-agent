# Restaurant agent reliability follow-up — 26 October 2026

## Incident and current catalog

The screenshot's pizza/milkshake request was extracted correctly by NLU. Retrieval/execution and missing facts caused the failure: inspection initially found zero priced menu rows, despite saved menu pictures. A picture is a presentation asset; it cannot authorize a SKU or price. Informational generation also contained fixed cuisine examples that could turn missing menu facts into invented specialties. The executor stopped processing the remaining portions after its first unresolved mention.

During inspection the owner imported new pictures and 79 menu items and confirmed that this was intentional. Those changes were preserved. No menu, customer draft, order or customer-channel message was written by this repair. The reviewed recovery preview for the earlier pictures was abandoned before mutation when its empty-catalog precondition failed.

The latest read-only check found 79 priced, available SKUs and no pizza or milkshake rows. All 79 full names resolve locally to their own ID and current price. Pizza/milkshake incident regressions use an isolated representative catalog containing those dishes; they do not add those dishes to the owner's replacement catalog.

## Repairs

- Named dishes resolve against the authoritative branch catalog first, including common aliases, typos, sizes and drink volumes. Matching all meaningful name tokens prevents BBQ pizza from silently becoming another BBQ dish. All size/flavor siblings participate before deciding whether a request is unambiguous. Optional semantic retrieval provides suggestions; semantic similarity alone cannot authorize a different dish.
- Every portion in a compound request is considered. Resolved portions enter the cart once, unresolved portions remain in a queue with quantity and preparation notes, and one clarification is presented at a time. Later choices, removals, browsing and address replies preserve that queue. Checkout cannot omit unresolved requests.
- NLU captures up to eight independent questions alongside cart and fulfillment changes. Actions retain each question's own text. Prices, named item availability/descriptions, phone numbers, delivery fees/times and payment are rendered from stored facts where supported. Unavailable items are marked and receive no ordering button. Free-form grounding receives the entire catalog without a fixed cuisine keyword filter or silently omitted category tails.
- Empty catalogs fail closed with a setup explanation and staff alert. Catalog/settings query failures propagate rather than being cached as an empty menu or invented default restaurant. Branch profile defaults are resolved through the branch's owning restaurant.
- Saved-picture import prepares an editable review preview, retaining descriptions and defaulting to merge. It never automatically replaces the live catalog. Invalid/missing prices are rejected instead of becoming free items. Dashboard and health checks expose missing priced catalogs.
- Context loads independent reads together. Catalog names avoid embedding and RPC latency; optional embedding and vector requests have short timeouts. NLU attempts share a 10-second total budget (6 seconds per attempt by default), and free-form answers share a 6-second budget per turn. Exact choices bypass NLU. Cache invalidation also invalidates in-flight loads, so an old read cannot repopulate a freshly invalidated entry. Removed nested menu/settings caches avoid compounded staleness.
- Draft changes, processed inbound receipt and the full reply payload now commit atomically. An atomic delivery claim prevents two workers sending the same saved reply. Definitely rejected sends retry that payload without NLU/cart mutations/order placement. Accepted or uncertain sends cannot be automatically replayed. A crash after order placement but before reply commit recovers the persisted order acknowledgment.

## Database change

`supabase/migrations/20261026124645_restaurant_agent_reply_recovery.sql` adds four functions using the existing owned inbound message metadata. It does not create client write permissions or alter menu/order data. Existing application versions remain compatible with the previous turn RPC.

The migration was tested in isolated PostgreSQL and applied to the configured `tandoori-restaurant-agent` project. The server API returns reply version `20261026124645`. SQL privilege checks confirm server-role access and deny anonymous/authenticated execution of the privileged reply operations. Database advisor findings were unchanged after the migration.

For another environment, apply all ordered migrations before deploying the application. A missing reply migration fails the health check and processing; there is no unsafe non-durable fallback.

## Verification

- Full `npm run check:all-guards` passed, including routing, parser, persona, security, operational, Evolution/Meta separation, latency, menu/cart/conversation and PostgreSQL checks, including the shared answer-timeout regression.
- 74 pipeline/conversation checks through the real executor and a local OpenAI-compatible fixture; 45 parser HTTP fixture requests and five isolated test orders.
- 23 menu resolver checks, including incomplete vector results and local authoritative resolution.
- 29 real PostgreSQL integrity checks using actual migrations and RPCs, including rollback, cross-conversation rejection, anonymous permission rejection, receipt preservation, claim ownership and retry states.
- Five reply/cache checks use the real delivery coordinator, isolated PostgreSQL and a stub sender: concurrent sends, definite failures, uncertain outcomes, acceptance followed by receipt-write failure, and in-flight stale-cache invalidation.
- Live synthetic NLU: 21/21 cases passed, median 793 ms. One primary request returned HTTP 400; the configured fallback correctly recovered. This measures interpretation, not end-to-end WhatsApp latency or an overall accuracy rate.
- Read-only live catalog: 79/79 available full names resolved to their own SKU/price locally. Server API confirmed the new migration. No writes or WhatsApp calls.
- Production build and TypeScript passed. Scoped lint passed with two existing unused optional-parameter warnings. Repository-wide lint had pre-existing failures outside these changes; no claim of clean repository-wide lint is made.
- The built production app's local `/api/health` returned HTTP 200 against the configured database, with catalog, schema and both migration checks passing. This checks configured dependencies; it does not replace the stricter deployment preflight or a live WhatsApp smoke test. The temporary test server was stopped after the read-only probe.

## Deployment gates and practical limits

1. Local `check:production-readiness` still rejects `WHATSAPP_VERIFY_TOKEN` because it is shorter than the required 24 characters. Update the deployment secret and the matching Meta webhook configuration together. The value was neither printed nor changed.
2. Deploy the repaired application, confirm `/api/health`, and run test-number WhatsApp smoke tests for delivery/pickup/dine-in, compound orders/questions, voice, correction, duplicate webhooks, provider rejection and kitchen/dashboard agreement. No live customer messages, live orders, voice quality study or production load test was performed here.
3. Verify that pictures, priced SKUs, descriptions, hours/timezone, coverage/minimums/fees and connected WhatsApp account describe the intended restaurant. Pictures do not replace priced rows. Changes made directly in the database can take the catalog's 30-second TTL to propagate across running instances; placement revalidates current database prices and availability.
4. Schedule and monitor the existing authenticated webhook-retry worker; recovery depends on replay/retry of the durable webhook event. Saved replies are not an independent scheduled outbox scanner. An ambiguous provider send or process death while sending requires delivery verification and surfaces a staff alert when replayed. Multipart media delivery does not have independent per-attachment exactly-once receipts.
5. Keep staff escalation for allergies, unpriced extras, missing business facts and uncertain delivery. The model cannot guarantee every dialect/typo, geocode addresses, allocate table capacity or know live kitchen inventory without authoritative integrations. No zero-error or completely unattended guarantee is justified by these tests.
6. Existing database advisories remain: [extension placement](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) for vector/pg_trgm and [leaked password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). The two service-only tables retain RLS without client policies intentionally; no policies were loosened.

Earlier audit observations are historical snapshots. This document supersedes the older claims that the active catalog has 128 items, that no further migration is needed, or that replies have no durable receipt/retry path.

## Follow-up: ETA, cancellation and fries availability

The next production screenshot exposed two uncovered paths. The stored turns show that `Kitna time lge ga?` was correctly classified as delivery information, but a malformed wording matcher missed it and returned all delivery policies. `Fries hain?` was classified as `general_question`, bypassed the deterministic menu answer and received a misunderstanding reply when generation returned no usable answer. The cancellation had succeeded and left the conversation in browsing; it was not the cause of the availability failure. Order #2 was already cancelled when inspected. No customer state or order was changed during this repair.

Simple, complete catalog questions now bypass both language models. Other questions use the same catalog facts regardless of whether NLU chooses an item-specific or general-question label. Cart edits, mixed requests, dietary constraints and unrecognized food wording retain the normal interpretation path. Pending unresolved items are preserved during information replies.

Live-catalog verification also caught an unintended typo match: `fries` matched `fried`, offering fried-rice dishes among fries choices. Exact catalog words now take priority over typo matches, and short words require exact identity or explicit normalized aliases. Fries cannot become fried rice even when actual fries are missing or unavailable.

ETA follow-ups now read the owned order's status and service. An active delivery quotes an approximate window from confirmation, rather than restarting a fresh 40-minute estimate. Cancelled, delivered and dispatched orders use their actual status; overdue orders say a revised arrival time is unverified. Scheduled pickup/dine-in uses its saved time. Fees and coverage are not repeated for a time-only question.

Free-form answering now has a compatible fallback within the existing shared deadline. Rejected, empty, truncated or stalled primary responses can recover, and incomplete answers are never cached. If all attempts fail, the reply explains that the answer could not be verified and records a partial processing result, rather than blaming the customer's wording.

Verification: 83 isolated conversation checks including the screenshot sequence, dietary/edit boundaries and consistent overdue timing across intent labels; 24 menu resolution checks including fries/fried-rice isolation; six local HTTP answer-recovery checks; 2/2 live NLU incident cases; and read-only verification of all 79 live SKUs plus exactly the three fries entries. A separate synthetic live answer returned those three fries and their correct prices in 1,110 ms. Full guards, TypeScript/build and scoped lint were rerun. No migration, real order or WhatsApp message is required by this follow-up.
