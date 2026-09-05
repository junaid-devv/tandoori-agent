/**
 * scripts/check-order-flow-handlers.mjs — Phase 9 repoint
 *
 * Tests state machine flow transitions & pipeline wiring in the rebuilt architecture.
 * Pure unit tests: no network or database calls.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { nextTransition } from "../lib/agent/state-machine.ts";

function pass(message) {
  console.log(`PASS: ${message}`);
}

function baseUnderstanding(overrides = {}) {
  return {
    intents: ["add_items"],
    primary_intent: "add_items",
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
    stage: "building_cart",
    cart: [{ menu_item_id: "m1", name: "Chicken Karahi", unit_price: 1395, qty: 1 }],
    order_type: "delivery",
    has_address: true,
    has_dinein_details: false,
    has_pickup_time: false,
    upsell_offered: true,
    anger_level: 0,
    consecutive_failures: 0,
    invalid_step_count: 0,
    awaiting_selection: false,
    ...overrides,
  };
}

// 1. Confirming stage + confirm_order intent -> place_order action, stage 'placed'
function testAwaitingConfirmationPlacesOrder() {
  const view = baseStateView({ stage: "confirming" });
  const u = baseUnderstanding({
    intents: ["confirm_order"],
    primary_intent: "confirm_order",
  });
  const t = nextTransition(view, u);
  assert.equal(t.nextStage, "placed");
  assert.ok(t.actions.some((a) => a.kind === "place_order"));
  pass("Confirmation transition places order and moves stage to 'placed'.");
}

// 2. Address collection stage -> collect_delivery_address action emitted with address
function testDeliveryAddressTransition() {
  const view = baseStateView({
    stage: "collecting_delivery",
    has_address: false,
  });
  const u = baseUnderstanding({
    intents: ["provide_address"],
    primary_intent: "provide_address",
    address: "Street 5, F-7, Islamabad",
  });
  const t = nextTransition(view, u);
  assert.ok(t.actions.some((a) => a.kind === "collect_delivery_address"));
  pass("Providing delivery address triggers collect_delivery_address action.");
}

// 3. Non-linear flow: Asking info during address collection stays in address stage
function testNonLinearInfoQuery() {
  const view = baseStateView({
    stage: "collecting_delivery",
    has_address: false,
  });
  const u = baseUnderstanding({
    intents: ["ask_item_info"],
    primary_intent: "ask_item_info",
    info_query: "how much is biryani",
  });
  const t = nextTransition(view, u);
  assert.equal(t.nextStage, "collecting_delivery");
  assert.ok(t.actions.some((a) => a.kind === "answer_info"));
  pass("Non-linear info question in checkout answers without stage loss.");
}

// 4. Human escalation transition
function testHumanEscalation() {
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
  pass("Human request intent sets escalate flag and transitions to 'human' stage.");
}

// 5. Cancel / restart transition
function testCancelOrder() {
  const view = baseStateView();
  const u = baseUnderstanding({
    intents: ["cancel_order"],
    primary_intent: "cancel_order",
  });
  const t = nextTransition(view, u);
  assert.ok(t.actions.some((a) => a.kind === "cancel_order"));
  pass("Cancel order intent triggers cancel_order action.");
}

// 6. Verify pipeline wiring files exist
function testPipelineWiring() {
  const pipelinePath = path.join(process.cwd(), "lib", "agent", "pipeline.ts");
  const executorPath = path.join(process.cwd(), "lib", "agent", "executor.ts");
  assert.ok(fs.existsSync(pipelinePath), "pipeline.ts must exist");
  assert.ok(fs.existsSync(executorPath), "executor.ts must exist");

  const pipeline = fs.readFileSync(pipelinePath, "utf8");
  const executor = fs.readFileSync(executorPath, "utf8");

  assert.ok(pipeline.includes("runTurn"), "pipeline must export runTurn");
  assert.ok(executor.includes("executeTurn"), "executor must export executeTurn");
  assert.ok(executor.includes("orderRepo.cancelOrder(recent.id)"), "executor must call orderRepo.cancelOrder on cancellation");
  assert.ok(executor.includes("customer_cancellation"), "executor must create customer_cancellation alert on cancellation");
  pass("Pipeline and executor wiring files verified (including cancellation status handling).");
}

import { reply } from "../lib/agent/reply.ts";

// 7. Settings-aware order summary & confirmation verification
function testSettingsDeliveryRulesSummaryAndConfirmation() {
  const settings = {
    branch_id: "b1",
    is_accepting_orders: true,
    opening_time: "10:00 AM",
    closing_time: "11:00 PM",
    min_delivery_amount: 450,
    delivery_enabled: true,
    delivery_fee: 150,
    delivery_areas: ["F-6", "F-7"],
    estimated_prep_minutes: 30,
    estimated_delivery_minutes: 45,
    city: "Islamabad",
    phone_delivery: "0300-1234567",
    phone_dine_in: "042-111222",
    ai_personality: "Warm & Professional",
    timezone: "Asia/Karachi",
  };

  const cartUnderMin = [{ menu_item_id: "m1", name: "Fries", unit_price: 200, qty: 1 }];
  const summaryUnderMin = reply.summary("roman_urdu", cartUnderMin, "delivery", "Rs.", "Street 5, F-7", settings);
  assert.ok(summaryUnderMin.includes("Total: Rs. 350 (COD)"), "Summary total must include delivery fee");
  assert.ok(summaryUnderMin.includes("minimum order Rs. 450"), "Summary must warn about minimum delivery amount");
  assert.ok(summaryUnderMin.includes("Delivery: ~45 min"), "Summary must include estimated delivery time");

  const cartAboveMin = [{ menu_item_id: "m2", name: "Chicken Karahi", unit_price: 1395, qty: 1 }];
  const summaryAboveMin = reply.summary("english", cartAboveMin, "delivery", "Rs.", "Street 5, F-7", settings);
  assert.ok(summaryAboveMin.includes("Delivery Fee: Rs. 150"), "Summary must show delivery fee");
  assert.ok(summaryAboveMin.includes("Total: Rs. 1545 (COD)"), "Summary must show total with delivery fee");
  assert.ok(summaryAboveMin.includes("Delivery: ~45 min"), "Summary must show delivery ETA");

  const placedMsg = reply.orderPlaced("english", 101, "Rs.", 1545, "delivery", settings);
  assert.ok(placedMsg.includes("Order #101 confirmed!"), "Placed reply must include order number");
  assert.ok(placedMsg.includes("Estimated delivery: ~45 mins"), "Placed reply must include ETA");

  const minWarning = reply.minDeliveryNotMet("roman_urdu", 200, 450, "Rs.");
  assert.ok(minWarning.includes("Rs. 450") && minWarning.includes("Rs. 250"), "Min delivery helper must calculate difference");

  pass("Settings delivery rules (fee, min order, ETA) verified in concise order summary & confirmation.");
}

testAwaitingConfirmationPlacesOrder();
testDeliveryAddressTransition();
testNonLinearInfoQuery();
testHumanEscalation();
testCancelOrder();
testPipelineWiring();
testSettingsDeliveryRulesSummaryAndConfirmation();
