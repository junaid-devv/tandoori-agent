/**
 * scripts/check-upsell-quantity-regression.mjs — Phase 9 repoint
 *
 * Asserts upsell gating invariants in the new architecture:
 * 1) State machine triggers offer_upsell when adding items if upsell_offered is false
 * 2) Does not offer upsell again if upsell_offered is already true
 * 3) Schema and state repository include upsell tracking fields
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { nextTransition } from "../lib/agent/state-machine.ts";

function pass(message) {
  console.log(`PASS: ${message}`);
}

function baseStateView(overrides = {}) {
  return {
    stage: "building_cart",
    cart: [{ menu_item_id: "m1", name: "Chicken Karahi", unit_price: 1395, qty: 1 }],
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

function baseUnderstanding(overrides = {}) {
  return {
    intents: ["add_items"],
    primary_intent: "add_items",
    confidence: 0.95,
    language: "english",
    items: [{ query: "Chicken Biryani", qty: 1, size: null, addons: [], notes: null }],
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

// 1. Adding items with upsell_offered: false -> triggers offer_upsell
function testOffersUpsellOnce() {
  const view = baseStateView({ upsell_offered: false });
  const u = baseUnderstanding();
  const t = nextTransition(view, u);
  assert.ok(t.actions.some((a) => a.kind === "offer_upsell"), "Should offer upsell when adding items if not yet offered");
  pass("Adding items offers upsell when not previously offered.");
}

// 2. Adding items with upsell_offered: true -> skips offer_upsell
function testSkipsUpsellIfAlreadyOffered() {
  const view = baseStateView({ upsell_offered: true });
  const u = baseUnderstanding();
  const t = nextTransition(view, u);
  assert.ok(!t.actions.some((a) => a.kind === "offer_upsell"), "Should not offer upsell again if already offered");
  pass("Adding items skips upsell if upsell_offered is already true.");
}

// 3. Verify schema definition contains upsell tracking fields
function testSchemaFields() {
  const schemaPath = path.join(process.cwd(), "lib", "schema.types.ts");
  const schemaSource = fs.readFileSync(schemaPath, "utf8");
  assert.ok(schemaSource.includes("upsell_offered: boolean"), "schema.types.ts must define upsell_offered");
  assert.ok(schemaSource.includes("upsell_item_name"), "schema.types.ts must define upsell_item_name");
  pass("Schema includes upsell tracking fields.");
}

testOffersUpsellOnce();
testSkipsUpsellIfAlreadyOffered();
testSchemaFields();
