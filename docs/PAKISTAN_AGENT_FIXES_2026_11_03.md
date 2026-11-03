# Pakistani ordering conversation repairs

Reviewed Luqman's stored Foods Carnival conversation and the Kababish Pizza conversation against the live branch catalog. No customer messages were sent or orders changed during verification.

## Causes and changes

- Whisper transcribed Luqman's Urdu voice note in Devanagari. Urdu conversations now request Urdu transcription with Pakistani food/menu hints; Devanagari auto-detection retries once with Urdu explicitly selected. The parser understands the earlier artifact and outputs Latin food queries. Generated informational replies containing Hindi script or stock Hindi expressions are rejected and retried within the existing answer budget.
- The menu stores `Chicken Paratha` under `Paratha Roll`. Matching uses a single category to complete item names and accepts `Partha` and common spellings. Combined headings such as `Pasta, Lasagne & Pizza Fries` cannot turn pasta into a fries match. Full cheese-variant names retain their exact SKU.
- Failed matches were retained in the unresolved queue and repeated during delivery/address turns. Rejected dishes no longer enter that queue. Old broken queues are repaired on the next inbound turn without adding historical food. Actual size/flavour choices retain quantities and preparation notes. Current-turn grounding rejects obvious historical food replays.
- `Mid` was missing from size recognition. Kababish Pizza now presents Small Rs. 449, Mid Rs. 799 and Large Rs. 1199 from the catalog. Typing `medium` selects the Mid SKU.
- Simple named orders use the catalog directly. Complex turns retain NLU with bounded relevant spelling hints. Neutral dish/service messages preserve the customer's language. Replies are shorter, ingredient descriptions are not duplicated, and fallback prompts use the current checkout step.
- Delivery confirmation asks for a current WhatsApp location pin. Meta location messages and Evolution shared pins are accepted. A pin is added to the active order's rider instructions while preserving the reviewed address, fee, total and staff notes. Conversation/branch ownership and concurrent staff edits are checked. Repeated identical pins do not add duplicate notes.

## Verification

- `npm run check:all-guards`: existing regressions plus incident conversations, Hindi answer rejection and delivery-pin persistence checks.
- `npm run check:live-menu-catalog`: read-only catalog verification, including all available SKUs, Urdu/transcription roll aliases and all Kababish sizes.
- `LIVE_NLU_FILTER=Pakistan:` with `npm run check:live-order-understanding`: synthetic real-provider checks for the five incident phrases; no database writes or WhatsApp sends.
- `npm run build`, TypeScript and scoped ESLint.

The app must be deployed or restarted with this source for live traffic to use the changes. These repairs use existing database columns and require no new migration. The original audio itself was not replayed; voice validation covers the stored transcript, language configuration and interpretation.
