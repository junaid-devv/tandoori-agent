# Luqman checkout repairs — 4 November 2026

Reviewed the stored Foods Carnival conversation from 3 November UTC (4 November in Pakistan), its current state, branch menu and delivery settings. The customer selected a Rs2350 Shahana deal and a Rs399 small Tikka pizza, supplied `18 G 606`, a WhatsApp pin and `new city phase 1`, then complained after repeated address prompts. The conversation's human handoff follows that real complaint; it was not automatically undone.

## Repairs

- Keep partial destination details in the active draft. Combine shorthand, area and pin across turns instead of discarding them. Accept a valid shared pin as a precise destination, and use a separately supplied configured area to determine the fixed fee. The incident sequence now reviews Rs2749 subtotal plus Rs100 delivery, Rs2849 total. Coordinates alone do not establish a fixed-price zone. Outside-area destinations still require a verified fee before placement.
- An explicit address replacement drops the old pin and requires a fresh review. New-address controls clear the old draft destination. Incomplete area-only replies cannot authorize an order.
- Recognize exact catalog category names before size interpretation: `regular pizza` browses Regular Pizza. Recognize the customer's `deal ki taser` picture request. Category lists now page through all categories within WhatsApp's ten-row limit.
- Reject pizza-deal suggestions for a standalone drink request based solely on the drink in a deal description. Explain the included drink from the selected deal's actual description. No standalone drink SKU or price was invented.
- Collect required pizza flavors from descriptions that explicitly declare a flavor count and choice list. Save the choices as the existing cart item's kitchen instructions; do not add another pizza. Multiple flavor choices and separate copies of the same deal retain their own instructions. Checkout cannot bypass missing flavors.
- Explain invalid old menu numbers and re-present current choices. Expired item numbers cannot select stale items. Preserve complete flavor sentences in deal descriptions.
- Native interactive-send rejection now produces one copy of the reply followed by numbered options, rather than repeating the reply body.

## Verification

- `check:agent-conversations`: 148 isolated conversation checks, including the recorded incident phrases, both area/pin orders, replacement of a previous pin, separate same-deal flavor choices, and placement only after explicit review confirmation.
- `check:evolution`: mocked database/provider integration verifies list and button rejection fallbacks contain one reply and numbered choices.
- `check:all-guards`, TypeScript, scoped ESLint and production build. ESLint reports three pre-existing unused-parameter warnings and no errors.

All conversation and send tests use isolated fixtures. No customer messages, live orders or live conversation state were changed. No schema migration is required. Deploy or restart with this source for live traffic to receive the repairs.
