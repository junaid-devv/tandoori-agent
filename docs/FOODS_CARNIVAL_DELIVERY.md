# Foods Carnival delivery areas

The owner confirmed these 22 delivery areas on 3 November 2026. Canonical names,
fees and English/Roman Urdu/Urdu aliases are in
`data/foods-carnival-delivery-zones.json`.

| Fee (Rs) | Areas |
| --- | --- |
| 100 | 18 Area, 15 Area, 14 Area, 20 Area, 19 Area, Barrier No. 2, Losar, GT Road, New City Phase 1 |
| 150 | Chhachhi Mohalla, Gulshan Anwar, Nawababad, Malka Abad, Wah Model Town, Basti Chowk, Jameelabad, Taxila Chowk |
| 200 | Gudwal, Barrier No. 3, Wah General Hospital, New City Phase 2 |
| 180 | Basti Qabristan Road |

Applied to Foods Carnival / Laiq Ali Chowk, branch
`457cbcc8-5158-4859-9c55-066403461bf7`. Following the owner's correction, the four
earlier zones (Laiq Ali Chowk, Lala Rukh, Aslam Market, Anwar Chowk) were removed,
leaving 22 fixed-price zones. The outside-area rate is saved as Rs 40 per km.
No delivery toggle, minimum, menu, order or conversation was changed.
The settings and database migrations were applied and read back successfully.

## Matching and rollout

Explicit aliases work with the existing application. The updated
`lib/delivery-pricing.ts` additionally handles joined/split words, native Urdu and
Arabic numerals, and small Roman spelling errors, including adjacent swapped
letters. Deploy the updated application to activate those extra rules in chat.
Its rules match the applied `delivery_area_spelling_tolerance` database migration.
Numbers cannot be edited or moved during fuzzy matching; multiple plausible zones
require clarification. Existing range labels retain their original behavior.

Outside fixed-price zones, the agent advertises Rs 40 per km (kilometre) and asks
for a full address or WhatsApp pin. Once supplied, the draft cart and destination
are retained and the request is handed to staff to confirm the distance, quote
the final delivery fee, and obtain customer approval. A location pin alone is not
treated as a verified road distance, and the rate is never used as a flat fee.
Deploy the updated application to activate this message and handoff flow.
The rate is editable in Delivery settings; 0 disables the outside-area option.

Choosing Delivery now asks only "Apna delivery address bhej dein." (or the short
English/Pashto equivalent), without listing address components or delivery zones.
Customers with a usable saved address can still choose that address or a new one.
For a fixed-price area, the agent shows the order and delivery-inclusive total for
confirmation, then places the order and asks for a rider location pin. For other
destinations, staff confirm distance and charges before the order is placed.

## Repeatable commands

Preview the update to current settings:

```powershell
node --no-warnings --experimental-strip-types scripts/configure-foods-carnival-delivery.mjs
```

Add `--apply` to save. The script validates the restaurant and branch, removes the
four earlier zones, adds the 22 confirmed zones, preserves any other custom zones,
sets the outside-area rate to 40, backs up previous delivery settings under `output/delivery/`, refuses
to overwrite a concurrent settings edit, and verifies the saved fields.
Credentials come from `.env.local`; none are embedded in the script.

Run checks:

```powershell
node --no-warnings --experimental-strip-types scripts/check-delivery-area-spelling.mjs
node scripts/check-order-integrity.mjs
npm run check:agent-conversations
```

Verification completed: 175 TypeScript/PostgreSQL spelling and fee checks,
43 PostgreSQL order-integrity checks and 120 agent-conversation checks, including
outside-area information, full address, saved address, pin, pending-fee checkout,
fixed-fee precedence and ambiguity behavior. TypeScript and targeted backend/script
ESLint checks passed. The settings page retains two existing React effect lint
errors and two warnings, verified against HEAD; this change adds no lint findings.
Live verification confirmed the 22 saved fees, removed zones and Rs 40/km setting,
without creating orders or customer messages.
