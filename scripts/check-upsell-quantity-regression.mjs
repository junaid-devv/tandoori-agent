import assert from "node:assert/strict";
import { handleLogisticsAndFallbackFlow } from "../lib/order-flow-handlers.ts";

function pass(message) {
  console.log(`PASS: ${message}`);
}

function baseState(overrides = {}) {
  return {
    conversation_id: "conv_upsell_qty",
    workflow_step: "collecting_items",
    cart: [],
    preferred_language: "english",
    resume_workflow_step: null,
    last_presented_category: null,
    last_presented_at: null,
    last_presented_options: null,
    last_presented_options_at: null,
    order_type: null,
    address: null,
    guests: null,
    reservation_time: null,
    customer_instructions: null,
    upsell_item_name: null,
    upsell_item_price: null,
    upsell_offered: false,
    declined_upsells: [],
    summary_sent_at: null,
    last_user_whatsapp_msg_id: null,
    last_processed_user_message_id: null,
    last_processed_message_seq: null,
    last_processed_user_message_at: null,
    processing_token: null,
    processing_started_at: null,
    last_error: null,
    ...overrides,
  };
}

function makeReplyDecision(reply, statePatch, trace, interactiveList = null) {
  return {
    kind: "reply",
    reply,
    statePatch,
    trace,
    interactiveList,
  };
}

function withPreferredLanguage(patch, preferredLanguage) {
  return {
    ...patch,
    preferred_language: preferredLanguage,
  };
}

function createSharedHelpers() {
  return {
    extractOrderInstructionCandidate: () => null,
    buildSummaryReply: ({ state }) => makeReplyDecision("summary", state),
    replyDecision: makeReplyDecision,
    withPreferredLanguage,
    shouldDeferToContextSwitchFallback: () => false,
    buildUnknownItemReplyData: () => ({ text: "unknown", selectableItems: [] }),
  };
}

function testUpsellYesShowsQuantityPicker() {
  const context = {
    messageText: "yes",
    state: baseState({
      workflow_step: "awaiting_upsell_reply",
      cart: [{ name: "Chicken Karahi", qty: 1, price: 1395, category: "Main Course", size: null, addons: [], item_instructions: null }],
      upsell_item_name: "Butter Naan",
      upsell_item_price: 120,
      upsell_offered: true,
    }),
    menuItems: [{ id: "naan_1", name: "Butter Naan", price: 120, category: "Bread", is_available: true }],
    semanticMatches: [],
    branch: { id: "b1", name: "Main", address: "City" },
    settings: {
      delivery_enabled: true,
      delivery_fee: 0,
      opening_time: "10:00",
      closing_time: "23:00",
      phone_delivery: "000",
    },
    isOpenNow: true,
    recentOrder: null,
    session: { invalid_step_count: 0 },
  };

  const helpers = {
    ...createSharedHelpers(),
    isUpsellYes: (normalizedText) => normalizedText === "yes",
    isUpsellNo: () => false,
    shouldPromptForQuantityPicker: () => true,
    buildQuantityPickerReply: (item) => ({
      text: `*${item.name}* selected. How many would you like?`,
      interactiveList: {
        body: `Select quantity for ${item.name}.`,
        buttonText: "Quantity",
        sectionTitle: "Quantity",
        rows: [
          { id: "__qty_pick__:1", title: "1", description: `Rs. ${item.price}` },
          { id: "__qty_pick__:custom", title: "Custom quantity", description: "Type any number" },
        ],
      },
    }),
    buildQuantityPickerCategoryKey: (itemId) => `__qty_pick__:${itemId}`,
    mergeCartItems: (cart) => cart,
    buildOrderTypePrompt: () => "Order type prompt",
    buildOrderTypeInteractiveList: () => null,
    buildQuickOrderTypeInteractiveList: () => null,
    buildUpsellInteractiveList: () => ({ body: "upsell", buttonText: "Choose", rows: [] }),
    handleOrderTypeSelection: () => makeReplyDecision("order type selected", {}),
    inferGeneralQtyOverride: () => null,
    applyQtyOverride: (cart) => cart,
    buildClosedReply: () => "closed",
    inferLastItemQtyOverride: () => null,
    applyLastItemQtyOverride: (cart) => cart,
    parseOrderTypeShortcut: () => null,
    buildPersistedStatePatch: (state) => state,
    clampQty: (qty) => qty,
  };

  const interpretation = {
    wants_confirmation: null,
    intent: "acknowledgment",
    add_items: [],
    unknown_items: [],
  };

  const result = handleLogisticsAndFallbackFlow({
    context,
    interpretation,
    matchedAdds: { matched: [], unknown: [], ambiguous: [] },
    preferredLanguage: "english",
    trace: { intent: "acknowledgment", confidence: 0.99, unknownItems: [], notes: null },
    helpers,
  });

  assert.equal(result.kind, "reply");
  assert.equal(result.reply, "*Butter Naan* selected. How many would you like?");
  assert.equal(result.statePatch.workflow_step, "collecting_items");
  assert.equal(result.statePatch.upsell_item_name, null);
  assert.equal(result.statePatch.upsell_item_price, null);
  assert.equal(result.statePatch.last_presented_category, "__qty_pick__:naan_1");
  assert.ok(Array.isArray(result.statePatch.last_presented_options));
  assert.equal(result.statePatch.last_presented_options?.[0]?.name, "Butter Naan");
  assert.equal(result.statePatch.cart, undefined);
  assert.ok(result.interactiveList);
  assert.ok(result.interactiveList.rows.some((row) => row.id === "__qty_pick__:1"));
  pass("Upsell yes flow transitions to quantity picker instead of auto-adding qty 1.");
}

try {
  testUpsellYesShowsQuantityPicker();
} catch (error) {
  console.error("FAIL:", error instanceof Error ? error.message : error);
  process.exit(1);
}
