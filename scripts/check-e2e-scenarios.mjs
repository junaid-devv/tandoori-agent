/**
 * scripts/check-e2e-scenarios.mjs — Phase 9 E2E Guard Suite
 *
 * Runs multi-turn conversational scenario assertions against the rebuilt pipeline
 * core modules (State Machine, Cart, NLU contract, and Language Detection).
 * Pure offline execution — no network or database calls.
 */
import assert from "node:assert/strict";
import { nextTransition } from "../lib/agent/state-machine.ts";
import { addToCart, removeFromCart, cartSubtotal } from "../lib/agent/cart.ts";
import { inferLanguagePreference, containsUrduScript } from "../lib/core/lang-detect.ts";
import { stripVoiceNotePrefix, normalizeText } from "../lib/order-text-utils.ts";

function pass(message) {
  console.log(`PASS: ${message}`);
}

function baseUnderstanding(overrides = {}) {
  return {
    intents: ["greeting"],
    primary_intent: "greeting",
    confidence: 0.95,
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

function baseStateView(overrides = {}) {
  return {
    stage: "greeting",
    cart: [],
    order_type: null,
    has_address: false,
    has_dinein_details: false,
    has_pickup_time: false,
    upsell_offered: false,
    anger_level: 0,
    consecutive_failures: 0,
    invalid_step_count: 0,
    awaiting_selection: false,
    ...overrides,
  };
}

console.log("\n== E2E Multi-turn Scenarios ==");

// Scenario 1: English Full Delivery Order Lifecycle
function scenarioEnglishDeliveryLifecycle() {
  // Turn 1: Greeting
  let view = baseStateView({ stage: "greeting", cart: [] });
  let u = baseUnderstanding({ intents: ["greeting"], primary_intent: "greeting" });
  let t = nextTransition(view, u);
  assert.equal(t.nextStage, "browsing");
  assert.ok(t.actions.some((a) => a.kind === "greet"));

  // Turn 2: Add item
  view = baseStateView({ stage: "browsing", cart: [] });
  u = baseUnderstanding({
    intents: ["add_items"],
    primary_intent: "add_items",
    items: [{ query: "Chicken Biryani", qty: 2, size: null, addons: [], notes: null }],
  });
  t = nextTransition(view, u);
  assert.equal(t.nextStage, "building_cart");
  assert.ok(t.actions.some((a) => a.kind === "add_items"));
  assert.ok(t.actions.some((a) => a.kind === "offer_upsell"));

  // Turn 3: Set order type
  view = baseStateView({
    stage: "building_cart",
    cart: [{ menu_item_id: "m1", name: "Chicken Biryani", unit_price: 450, qty: 2 }],
    upsell_offered: true,
  });
  u = baseUnderstanding({
    intents: ["set_order_type"],
    primary_intent: "set_order_type",
    order_type: "delivery",
  });
  t = nextTransition(view, u);
  assert.equal(t.nextStage, "collecting_delivery");
  assert.ok(t.actions.some((a) => a.kind === "ask_order_type"));

  // Turn 4: Provide delivery address
  view = baseStateView({
    stage: "collecting_delivery",
    cart: [{ menu_item_id: "m1", name: "Chicken Biryani", unit_price: 450, qty: 2 }],
    order_type: "delivery",
    has_address: false,
    upsell_offered: true,
  });
  u = baseUnderstanding({
    intents: ["provide_address"],
    primary_intent: "provide_address",
    address: "House 12, Street 4, F-7, Islamabad",
  });
  t = nextTransition(view, u);
  assert.ok(t.actions.some((a) => a.kind === "collect_delivery_address"));

  // Turn 5: Confirm order
  view = baseStateView({
    stage: "confirming",
    cart: [{ menu_item_id: "m1", name: "Chicken Biryani", unit_price: 450, qty: 2 }],
    order_type: "delivery",
    has_address: true,
    upsell_offered: true,
  });
  u = baseUnderstanding({
    intents: ["confirm_order"],
    primary_intent: "confirm_order",
  });
  t = nextTransition(view, u);
  assert.equal(t.nextStage, "placed");
  assert.ok(t.actions.some((a) => a.kind === "place_order"));

  pass("Scenario 1: English Full Delivery Order Lifecycle completed successfully.");
}

// Scenario 2: Roman Urdu Dine-in Lifecycle
function scenarioRomanUrduDineIn() {
  assert.equal(inferLanguagePreference("Assalam o Alaikum, 4 logo ke liye table book karni hai"), "roman_urdu");

  let view = baseStateView({
    stage: "building_cart",
    cart: [{ menu_item_id: "m2", name: "Chicken Karahi", unit_price: 1400, qty: 1 }],
    upsell_offered: true,
  });

  // Turn: Dine-in selection with guests and time
  const u = baseUnderstanding({
    intents: ["set_order_type", "provide_dinein_details"],
    primary_intent: "set_order_type",
    order_type: "dine-in",
    guests: 4,
    reservation_time: "8:30 PM",
    language: "roman_urdu",
  });
  const t = nextTransition(view, u);
  assert.equal(t.nextStage, "collecting_dinein");
  assert.ok(t.actions.some((a) => a.kind === "ask_order_type"));
  assert.ok(t.actions.some((a) => a.kind === "collect_dinein_details"));

  pass("Scenario 2: Roman Urdu Dine-in multi-intent selection verified.");
}

// Scenario 3: Cart edit (add + partial remove + subtotal)
function scenarioCartEditing() {
  let cart = [];
  cart = addToCart(cart, { menu_item_id: "m1", name: "Chicken Biryani", unit_price: 450, qty: 3 });
  assert.equal(cart.length, 1);
  assert.equal(cart[0].qty, 3);
  assert.equal(cartSubtotal(cart), 1350);

  cart = removeFromCart(cart, { name: "Chicken Biryani", qty: 1 });
  assert.equal(cart[0].qty, 2);
  assert.equal(cartSubtotal(cart), 900);

  cart = removeFromCart(cart, { name: "Chicken Biryani", qty: "all" });
  assert.equal(cart.length, 0);
  assert.equal(cartSubtotal(cart), 0);

  pass("Scenario 3: Cart mutations (add, partial remove, all remove, subtotal) verified.");
}

// Scenario 4: Non-linear question during checkout
function scenarioNonLinearCheckout() {
  const view = baseStateView({
    stage: "collecting_delivery",
    cart: [{ menu_item_id: "m1", name: "Chicken Biryani", unit_price: 450, qty: 1 }],
    order_type: "delivery",
    has_address: false,
    upsell_offered: true,
  });
  const u = baseUnderstanding({
    intents: ["ask_hours_or_location"],
    primary_intent: "ask_hours_or_location",
  });
  const t = nextTransition(view, u);
  assert.equal(t.nextStage, "collecting_delivery");
  // Hours/location now flow through the grounded answer layer (facts-based),
  // still WITHOUT leaving the checkout stage.
  assert.ok(t.actions.some((a) => a.kind === "answer_grounded"));
  pass("Scenario 4: Non-linear question in checkout maintains current stage.");
}

// Scenario 5: Cancellation & Restart
function scenarioCancellationAndRestart() {
  const view = baseStateView({
    stage: "building_cart",
    cart: [{ menu_item_id: "m1", name: "Chicken Biryani", unit_price: 450, qty: 1 }],
  });

  const uCancel = baseUnderstanding({ intents: ["cancel_order"], primary_intent: "cancel_order" });
  const tCancel = nextTransition(view, uCancel);
  assert.ok(tCancel.actions.some((a) => a.kind === "cancel_order"));

  const uRestart = baseUnderstanding({ intents: ["restart_order"], primary_intent: "restart_order" });
  const tRestart = nextTransition(view, uRestart);
  assert.equal(tRestart.nextStage, "browsing");
  assert.ok(tRestart.actions.some((a) => a.kind === "restart_order"));

  pass("Scenario 5: Cancellation and restart flows verified.");
}

// Scenario 6: Human Handoff / Escalation
function scenarioHumanHandoff() {
  const view = baseStateView();
  const u = baseUnderstanding({
    intents: ["human_request"],
    primary_intent: "human_request",
    wants_human: true,
  });
  const t = nextTransition(view, u);
  assert.equal(t.nextStage, "human");
  assert.equal(t.escalate, true);
  assert.ok(t.actions.some((a) => a.kind === "escalate_human"));
  pass("Scenario 6: Human escalation sets escalate flag and transitions to human.");
}

// Scenario 7: Urdu Script Detection & Normalization
function scenarioUrduVoiceNormalization() {
  const rawVoiceNote = "[Voice note] مینو";
  const stripped = stripVoiceNotePrefix(rawVoiceNote);
  assert.equal(stripped, "مینو");
  assert.equal(containsUrduScript(stripped), true);
  assert.equal(inferLanguagePreference(stripped), "roman_urdu");
  assert.equal(normalizeText(rawVoiceNote), "menu");
  pass("Scenario 7: Urdu script detection and voice note normalization verified.");
}

scenarioEnglishDeliveryLifecycle();
scenarioRomanUrduDineIn();
scenarioCartEditing();
scenarioNonLinearCheckout();
scenarioCancellationAndRestart();
scenarioHumanHandoff();
scenarioUrduVoiceNormalization();

console.log("\nALL E2E SCENARIOS PASSED ✅\n");
