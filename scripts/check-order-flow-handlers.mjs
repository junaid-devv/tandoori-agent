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
  pass("Pipeline and executor wiring files verified.");
}

testAwaitingConfirmationPlacesOrder();
testDeliveryAddressTransition();
testNonLinearInfoQuery();
testHumanEscalation();
testCancelOrder();
testPipelineWiring();
