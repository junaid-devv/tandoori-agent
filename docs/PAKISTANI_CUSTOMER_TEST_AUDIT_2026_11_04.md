# Pakistani customer journey audit — 4 November 2026

The expanded customer tests found and fixed eight issues. The first new pass had 16 failing checks out of 47. Further end-to-end journeys exposed a quantity overflow exception and a house-number correction retaining an obsolete pin. Reviewing the live AI output also exposed a hallucinated add-on that a weak assertion had missed. The final suite contains 66 checks, 98 synthetic customer turns and 1,000 generated basket calculations.

## Issues reproduced and fixed

| Customer situation | Failure before the fix | Result after the fix |
| --- | --- | --- |
| Sends `New City Phase 1`, then `House 12`, or house/street/area separately | New fragments could overwrite the area or earlier address pieces, restarting collection | Numbered pieces accumulate, including pieces received after a review; the completed destination receives the correct fee |
| Says `my house`, `ghar pe ao`, `house number`, or `gali mein` | Address keywords alone were considered a complete destination | Requests an actual numbered destination, named landmark or location pin |
| Replies `tikka wala aur fajita rakh dein`, `flavours Tikka aur Fajita rakhna`, or provides flavours in the initial order | Valid choices were repeatedly requested because only exact names or a colon-formatted note counted | Recognizes common answer wording, keeps the existing deal quantity and preserves cooking instructions; unsupported, negated and excessive choices cannot satisfy checkout |
| Uses `۲ نان`, `٢ naan`, or `۱` on a displayed menu/flavour list | Urdu and Arabic keyboard digits missed the deterministic quantity/selection paths | Normalizes those digits for food quantities, choices and compact addresses |
| Browses a category with 23 items | Items after the first ten had no list navigation | Offers previous/next pages within WhatsApp's ten-row limit; numeric selections refer to the displayed page |
| Corrects `House 12` to `House 13` | Both house numbers and the previous house's location pin could remain | Replaces the house component, preserves the area/street and removes the conflicting pin |
| Has 49 identical portions, then requests two more | The cart limit threw an uncaught exception | Explains the 50-portion limit, keeps the existing quantity and lets the customer continue |
| Says `Ek aur egg burger bhi add krdo` after ordering a branded burger | A live model put a historical branding word into `addons`, unnecessarily escalating the customer to staff | Rejects a clear replay of historical branding as an extra; explicit and unknown/translated unpriced extras still receive staff verification |

## Customer coverage

The new suite exercises the real turn pipeline, menu resolver, state machine, executor and state commits against isolated repositories. It checks:

- Roman Urdu, English, Urdu food script, mixed script, keyboard digits, short replies and greetings.
- Menu browsing, page navigation, current numeric choices, malformed/stale taps, sizes, sold-out dishes and unsupported food.
- Quantity changes, substitutions, separate cooking preparations, instruction-only edits, ambiguous removals and quantity limits.
- Delivery, pickup and family dine-in from selection to a separately confirmed order.
- Addresses in different message orders, compact block notation, missing addresses, missing saved addresses, pins and destination changes.
- Correct area fees, changes to a more expensive area, minimum delivery amounts and pickup without delivery charges.
- Information questions during checkout, premature acknowledgements, repeated confirmations, empty carts and closed restaurants.
- Complaint escalation, attempts to override catalog prices and arithmetic/removal invariants over 1,000 baskets.

Every synthetic turn also checks for a nonempty response, valid quantities, catalog prices and WhatsApp button/list limits. Placement must follow a previously reviewed draft.

The established guard suite additionally covers webhook authentication, tenant boundaries, duplicate delivery, order placement RPCs in isolated PostgreSQL, recovery after failed replies, cancellation/revenue rules, and simulated voice-provider failures. Some older guards inspect source text; they should not be mistaken for live integration tests.

## Verification

| Layer | Result |
| --- | --- |
| Expanded isolated customer journeys | 66/66 checks; 98 turns; 1,000 generated baskets |
| Existing full guard suite plus the new journeys | Passed |
| Live catalog, read-only | 257 available items across two active branches resolve to their own SKU and price; deployed reply migration verified |
| Live AI language evaluation | Paced full run: 32/32 passed, median 1,076 ms per extraction. After strengthening the historical-add-on assertion and adding the guard: final targeted live rerun 1/1 passed, 1,267 ms |
| TypeScript and production build | Passed |
| Lint on changed files | No errors; two existing unused-parameter warnings |
| Local production configuration readiness | Failed: `WHATSAPP_VERIFY_TOKEN` is missing/placeholder/shorter than 24 characters |

## Limits and remaining operational work

The new journey suite deliberately uses local extraction fixtures for ambiguous sentences to isolate downstream business logic. Of its 98 turns, 71 bypassed the parser, 20 used specified extraction fixtures and seven exercised an unknown extraction. Separate live AI tests exercise actual extraction; neither is a substitute for a live WhatsApp transport and real noisy voice-note trial. The first 32/32 result did not validate add-on correctness for one historical-cart case: manual output review caught that gap, which now has a deterministic regression and a stricter live assertion.

The first AI run at one-second intervals passed eight cases, then 24 cases returned provider-error/circuit-breaker fallbacks. Those 24 results are availability failures, not evidence of incorrect language interpretation. The paced rerun used the existing 15-second interval and passed all 32 cases, with the fallback recovering primary-model errors. Primary and fallback models use the same configured provider, so rate limits can affect both; capacity under bursts remains an operational concern.

The configuration readiness finding is for the local environment. It does not establish what is configured in deployment. A Meta verification token must agree with the Meta webhook configuration; changing only the local value would not verify that integration. No deployed secrets or provider settings were changed.

No customer messages were sent, no production orders were placed, and the live catalog check performed no writes. Actual audio quality, device-specific WhatsApp rendering, live rider handoff and concurrent production load were not exercised. The fixes must be deployed before real customers receive the changed behavior.

## Reproduce

```powershell
npm run check:pakistani-journeys
npm run check:all-guards
npm run check:live-order-understanding
npm run check:live-menu-catalog
npm run check:production-readiness
npm run build
```

`check:pakistani-journeys` writes the complete synthetic transcripts and per-check outcomes to `output/pakistani-customer-journeys.json`. It is also included in `check:all-guards`. The live language evaluation uses the configured AI provider and should retain its default pause to avoid artificial bursts.
