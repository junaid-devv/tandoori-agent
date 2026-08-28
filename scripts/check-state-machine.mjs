/**
 * scripts/check-state-machine.mjs — Phase 5 FSM verification (pure, offline).
 *
 * Covers: multi-intent single message, mid-flow (non-linear) switching, slot
 * filling, confirmation gating, bare affirm/deny resolution, escalation.
 *
 * Run: node --no-warnings --import ./scripts/alias-register.mjs --experimental-strip-types scripts/check-state-machine.mjs
 */
import { nextTransition } from "../lib/agent/state-machine.ts";

let failures = 0;
function pass(m) { console.log(`PASS: ${m}`); }
function fail(m) { console.error(`FAIL: ${m}`); failures += 1; }
function check(cond, m) { cond ? pass(m) : fail(m); }
function hasAction(t, kind) { return t.actions.some((a) => a.kind === kind); }

function view(overrides = {}) {
  return {
    stage: "browsing",
    cart: [],
    order_type: null,
    has_address: false,
    has_dinein_details: false,
    has_pickup_time: false,
    upsell_offered: false,
    awaiting_selection: false,
    ...overrides,
  };
}

function u(overrides = {}) {
  return {
    intents: ["unknown"],
    primary_intent: "unknown",
    confidence: 0.9,
    language: "english",
    items: [],
    removals: [],
    order_type: null,
    address: null,
    guests: null,
    reservation_time: null,
    pickup_time: null,
    info_query: null,
    sentiment: "neutral",
    wants_human: false,
    notes: null,
    ...overrides,
  };
}

const item = (query, qty = 1) => ({ query, qty, size: null, addons: [], notes: null });
const cartItem = (name, qty = 1) => ({ menu_item_id: "m1", name, qty, unit_price: 100, size: null, addons: [], notes: null });

console.log("\n== state-machine FSM tests ==");

// 1) Escalation wins over everything.
{
  const t = nextTransition(view({ stage: "collecting_delivery" }), u({ intents: ["add_items", "human_request"], wants_human: true, items: [item("fries")] }));
  check(t.escalate && t.nextStage === "human" && hasAction(t, "escalate_human"), "escalation short-circuits even with other intents");
}

// 2) Multi-intent single message: add + set order type + address.
{
  const t = nextTransition(
    view(),
    u({
      intents: ["add_items", "set_order_type", "provide_address"],
      primary_intent: "add_items",
      items: [item("zinger burger", 2)],
      order_type: "delivery",
      address: "DHA phase 5",
    }),
  );
  check(hasAction(t, "add_items"), "multi-intent: add_items action present");
  check(hasAction(t, "collect_delivery_address"), "multi-intent: address captured");
  check(t.nextStage === "collecting_delivery", "multi-intent: advanced to delivery collection");
}

// 3) NON-LINEAR: price question during address collection stays in stage.
{
  const t = nextTransition(
    view({ stage: "collecting_delivery", cart: [cartItem("Biryani")], order_type: "delivery" }),
    u({ intents: ["ask_item_info"], primary_intent: "ask_item_info", info_query: "biryani price" }),
  );
  check(hasAction(t, "answer_info"), "non-linear: answers info question mid-checkout");
  check(t.nextStage === "collecting_delivery", "non-linear: STAYS in collecting_delivery (no forced reset)");
}

// 4) Confirm with missing slot → advance to missing slot, don't place.
{
  const t = nextTransition(
    view({ stage: "building_cart", cart: [cartItem("Karahi")], order_type: null }),
    u({ intents: ["confirm_order"], primary_intent: "confirm_order" }),
  );
  check(!hasAction(t, "place_order"), "confirm with no order_type does NOT place order");
  check(t.nextStage === "choosing_order_type", "confirm with missing slot advances to order-type");
}

// 5) Confirm with all slots filled → place order.
{
  const t = nextTransition(
    view({ stage: "confirming", cart: [cartItem("Karahi")], order_type: "delivery", has_address: true }),
    u({ intents: ["confirm_order"], primary_intent: "confirm_order" }),
  );
  check(hasAction(t, "place_order") && t.nextStage === "placed", "confirm with all slots → place_order + placed");
}

// 6) Bare affirm while confirming (slots ready) → place order.
{
  const t = nextTransition(
    view({ stage: "confirming", cart: [cartItem("Roll")], order_type: "pickup", has_pickup_time: true }),
    u({ intents: ["affirm"], primary_intent: "affirm" }),
  );
  check(hasAction(t, "place_order"), "bare affirm at confirming (ready) places order");
}

// 7) Bare affirm with no context → clarify (not a blind confirm).
{
  const t = nextTransition(view({ stage: "browsing" }), u({ intents: ["affirm"], primary_intent: "affirm" }));
  check(hasAction(t, "ask_clarification"), "bare affirm with no context asks clarification");
}

// 8) Affirm accepts upsell.
{
  const t = nextTransition(
    view({ stage: "building_cart", cart: [cartItem("Burger")], upsell_offered: true }),
    u({ intents: ["affirm"], primary_intent: "affirm" }),
  );
  check(hasAction(t, "add_items"), "affirm after upsell offer adds item");
}

// 9) Deny upsell → move toward checkout.
{
  const t = nextTransition(
    view({ stage: "building_cart", cart: [cartItem("Burger")], upsell_offered: true }),
    u({ intents: ["deny"], primary_intent: "deny" }),
  );
  check(t.nextStage === "choosing_order_type", "deny upsell advances toward order type");
}

// 10) Mind change: remove pizza + add fries in one message.
{
  const t = nextTransition(
    view({ stage: "building_cart", cart: [cartItem("Pizza")] }),
    u({ intents: ["remove_items", "add_items"], primary_intent: "remove_items", removals: [{ query: "pizza", qty: "all" }], items: [item("fries")] }),
  );
  check(hasAction(t, "remove_items") && hasAction(t, "add_items"), "mind-change handled: remove + add in one turn");
}

// 11) Restart resets to browsing.
{
  const t = nextTransition(view({ stage: "confirming", cart: [cartItem("X")] }), u({ intents: ["restart_order"], primary_intent: "restart_order" }));
  check(hasAction(t, "restart_order") && t.nextStage === "browsing", "restart resets to browsing");
}

// 12) Add item offers upsell once (not when already offered).
{
  const t1 = nextTransition(view({ stage: "browsing" }), u({ intents: ["add_items"], primary_intent: "add_items", items: [item("biryani")] }));
  check(hasAction(t1, "offer_upsell"), "first add offers upsell");
  const t2 = nextTransition(view({ stage: "building_cart", cart: [cartItem("Biryani")], upsell_offered: true }), u({ intents: ["add_items"], primary_intent: "add_items", items: [item("naan")] }));
  check(!hasAction(t2, "offer_upsell"), "second add does not re-offer upsell");
}

// 13) Unknown with info_query → answer via search, not canned fallback.
{
  const t = nextTransition(view(), u({ primary_intent: "unknown", info_query: "something spicy" }));
  check(hasAction(t, "answer_info"), "unknown with info_query routes to answer_info");
}

console.log("");
if (failures > 0) {
  console.error(`STATE-MACHINE CHECK FAILED: ${failures} failure(s)`);
  process.exitCode = 1;
} else {
  console.log("STATE-MACHINE CHECK PASSED");
}
