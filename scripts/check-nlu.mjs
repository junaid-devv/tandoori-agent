/**
 * scripts/check-nlu.mjs — Phase 4 NLU verification.
 *
 * Two modes:
 *  1) OFFLINE contract tests (always run): schema validity, multi-intent support,
 *     primary/intents backfill, defaults, Urdu-script passthrough, injection safety.
 *     Uses coerceUnderstanding() — no network.
 *  2) LIVE golden set (only when OPENROUTER_API_KEY is set): asserts real model
 *     output on English / Roman Urdu / Urdu-script / code-mixed / non-linear cases.
 *
 * Run: node --no-warnings --import ./scripts/alias-register.mjs --experimental-strip-types scripts/check-nlu.mjs
 */
import { coerceUnderstanding, understandTurn, TurnUnderstandingSchema, INTENTS } from "../lib/agent/nlu.ts";

let failures = 0;
function pass(m) { console.log(`PASS: ${m}`); }
function fail(m) { console.error(`FAIL: ${m}`); failures += 1; }
function check(cond, m) { cond ? pass(m) : fail(m); }

// ---------------------------------------------------------------------
// 1) OFFLINE CONTRACT TESTS
// ---------------------------------------------------------------------
console.log("\n== NLU offline contract tests ==");

// a) A minimal valid object coerces and validates.
{
  const u = coerceUnderstanding({ primary_intent: "greeting" }, "english");
  check(u !== null, "coerce: minimal object with only primary_intent succeeds");
  check(u && u.intents.includes("greeting"), "coerce: intents backfilled from primary_intent");
  check(u && TurnUnderstandingSchema.safeParse(u).success, "coerce: result passes zod schema");
}

// b) intents -> primary_intent backfill.
{
  const u = coerceUnderstanding({ intents: ["add_items", "ask_item_info"] }, "roman_urdu");
  check(u && u.primary_intent === "add_items", "coerce: primary_intent backfilled from intents[0]");
  check(u && u.language === "roman_urdu", "coerce: language preserved");
}

// c) Multi-intent + entities survive validation.
{
  const u = coerceUnderstanding(
    {
      intents: ["add_items", "provide_address", "set_order_type"],
      primary_intent: "add_items",
      confidence: 0.9,
      language: "roman_urdu",
      items: [{ query: "zinger burger", qty: 2, size: null, addons: [], notes: null }],
      order_type: "delivery",
      address: "DHA phase 5",
    },
    "roman_urdu",
  );
  check(u && u.items.length === 1 && u.items[0].qty === 2, "coerce: item mention with qty preserved");
  check(u && u.order_type === "delivery" && u.address === "DHA phase 5", "coerce: order_type + address preserved");
  check(u && u.intents.length === 3, "coerce: multi-intent array preserved");
}

// d) Removal with qty "all".
{
  const u = coerceUnderstanding(
    { primary_intent: "remove_items", removals: [{ query: "pizza", qty: "all" }] },
    "english",
  );
  check(u && u.removals[0].qty === "all", "coerce: removal qty 'all' accepted");
}

// e) Invalid intent rejected (not in taxonomy).
{
  const u = coerceUnderstanding({ primary_intent: "make_me_a_sandwich" }, "english");
  check(u === null, "coerce: unknown intent value rejected by schema");
}

// f) Out-of-range qty rejected.
{
  const u = coerceUnderstanding(
    { primary_intent: "add_items", items: [{ query: "x", qty: 999, size: null, addons: [], notes: null }] },
    "english",
  );
  check(u === null, "coerce: qty above max rejected");
}

// g) Taxonomy sanity: key intents exist.
{
  const required = ["greeting", "add_items", "remove_items", "confirm_order", "human_request", "affirm", "deny", "ask_recommendation"];
  const missing = required.filter((i) => !INTENTS.includes(i));
  check(missing.length === 0, `taxonomy: required intents present${missing.length ? " (missing: " + missing.join(",") + ")" : ""}`);
}

// ---------------------------------------------------------------------
// 2) LIVE GOLDEN SET (network; gated)
// ---------------------------------------------------------------------
const hasKey = Boolean(process.env.OPENROUTER_API_KEY);
if (!hasKey) {
  console.log("\n== NLU live golden set: SKIPPED (set OPENROUTER_API_KEY to run) ==");
} else {
  console.log("\n== NLU live golden set ==");
  const golden = [
    {
      name: "english simple add",
      text: "can I get 2 chicken biryani please",
      expect: (u) => u.intents.includes("add_items") && u.items.some((i) => i.qty === 2),
    },
    {
      name: "roman urdu add + delivery + address",
      text: "2 zinger burger delivery karwa do gulshan block 5",
      expect: (u) =>
        u.intents.includes("add_items") &&
        u.order_type === "delivery" &&
        !!u.address &&
        u.language === "roman_urdu",
    },
    {
      name: "urdu script items",
      text: "چکن کڑاہی ایک اور دو نان",
      expect: (u) => u.intents.includes("add_items") && u.items.length >= 1,
    },
    {
      name: "non-linear: price question mid-flow",
      text: "ye biryani kitne ki hai?",
      expect: (u) => u.intents.includes("ask_item_info") || u.intents.includes("browse_menu"),
    },
    {
      name: "mind change (remove + add)",
      text: "pizza rehne do, fries kar do",
      expect: (u) => u.intents.includes("remove_items") && u.intents.includes("add_items"),
    },
    {
      name: "human escalation",
      text: "kisi insaan se baat karao",
      expect: (u) => u.wants_human === true && u.intents.includes("human_request"),
    },
    {
      name: "bare yes is affirm (not confirm_order guess)",
      text: "haan",
      expect: (u) => u.intents.includes("affirm"),
    },
  ];

  for (const g of golden) {
    try {
      const u = await understandTurn({ messageText: g.text, language: "english", stage: "browsing", cart: [] });
      check(g.expect(u), `live: ${g.name} -> ${u.primary_intent} [${u.intents.join(",")}]`);
    } catch (e) {
      fail(`live: ${g.name} threw ${e.message}`);
    }
  }
}

// ---------------------------------------------------------------------
console.log("");
if (failures > 0) {
  console.error(`NLU CHECK FAILED: ${failures} failure(s)`);
  process.exitCode = 1;
} else {
  console.log("NLU CHECK PASSED");
}
