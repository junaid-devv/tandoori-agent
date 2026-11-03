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

## Follow-up: Urdu voice recovery

The new customer voice note failed before a transcript was saved, so its original provider error is unknown. The previous typed `Hello` left the chat in English, which incorrectly controlled both voice auto-detection and the failure reply.

- All voice requests explicitly use Urdu, independently of typed greetings. Voice replies and unavailable-audio fallbacks use Roman Urdu.
- Groq uses full `whisper-large-v3`; short Urdu context replaces the long multilingual example-order prompt. Official limits: https://console.groq.com/docs/speech-to-text.
- Empty or Devanagari transcripts and provider errors receive bounded recovery attempts. OpenAI is a secondary provider only when its key is configured; currently Groq is configured, so the same audio is retried there.
- Successful and failed transcription attempts retain safe provider/model/status diagnostics.
- Complete quantified requests such as `ek afghani wrap or ek chicken paratha roll` resolve both menu entries directly. Unknown words, Urdu negations, preparation requests and English alternatives still require normal interpretation. Known audio spellings `افغانی ریب` and `چکن پراتا رول` resolve the intended catalog names.
- Known Urdu food names are normalized before model interpretation of complex messages.

Verification: recovered the actual customer's 9,291-byte audio through its owning Evolution connection and ran the production transcription helper with the branch menu vocabulary, without placing an order or sending a customer message. It produced `ایک افغانی ریب اور ایک چکن پراتا رول۔`; direct catalog interpretation resolved exactly one Afghani Wrap and one Chicken Paratha Roll. The live complex-message interpreter also retained both separate portions after food-name normalization. Full guards, updated conversation checks, voice-recovery checks, scoped lint and production build passed. These follow-up source changes require deployment before live traffic uses them.

## Follow-up: Urdu mistaken for Pashto

The stored Urdu voice transcript `ایک مسالہ فرائز اور ایک فرینڈ فرائز۔` produced the Pashto staff-handoff reply `Taso da staff sara connect kawom`. The detector incorrectly classified Urdu ڈ (U+0688) as a Pashto-only letter; the distinct Pashto letter is ډ (U+0689). Corrected the Unicode signal and added regressions for both letters and Urdu/Pashto retroflex T characters. Urdu voice turns now carry a trusted `replyLanguage: roman_urdu` through the final interpretation stage, overriding a stale stored preference or incorrect model language. This covers ordinary cart replies and staff handoff copy. Tests cover the incident phrase, a wrong model classification, a stale Pashto preference, and genuine Pashto detection. No customer message or order was changed during verification.

## Pashto removed; fries request root cause

Retired Pashto from reply types, language detection, AI schemas/prompts, template replies, interactive controls and legacy response helpers. Unsupported saved preferences normalize to Roman Urdu. Voice remains explicitly Urdu; ordinary text supports English and Roman Urdu. Generated answers reject known retired-language reply formulas.

The recorded fries turn correctly extracted one `Masala Fries` (Rs230) and one `Friend Fries` (Rs199), both available in Foods Carnival. It also copied `Gudwal house 27` and `delivery` from history. Because the earlier order was already placed, the fabricated address change triggered the legitimate post-confirmation fulfillment guard before cart insertion. New food requests now reject destination/service fields unsupported by the current message; genuine English and Urdu address/service instructions remain valid. Known Urdu fries spellings also resolve the complete two-item request directly from the catalog, without model extraction. Regression fixtures cover the exact stored transcript after a confirmed order, historical-address replay, and a genuine Urdu address.

The affected live chat had no subsequent customer/staff messages. A guarded repair restored agent mode at its previous `placed` stage, cleared the false escalation, resolved its alert and corrected the language. The existing accepted order was untouched; no historical food was added and no customer message was sent. Confirmed zero retired preferences remain in contacts/conversation states. Source changes require deployment.
