/** Real pipeline + executor, isolated database and local OpenAI HTTP fixture.
 * No production credentials, customer messages, external calls or live orders.
 * Run via npm run check:agent-conversations.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://offline.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "offline-test-key";
delete process.env.GROQ_API_KEY;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.MENU_EMBEDDING_API_KEY;
delete process.env.OPENAI_API_KEY;
process.env.OPENROUTER_API_KEY = "offline-test-key";

process.env.ORDER_AGENT_NLU_MODEL = "fixture-primary";
process.env.ORDER_AGENT_ANSWER_TIMEOUT_MS = "150";
let slowAnswers = false;
let answerCalls = 0;
let truncateNext = false;
let response = null;
let parserCalls = 0;
let lastRequest = null;
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  const parser = request.response_format?.type === "json_object";
  if (parser) { parserCalls++; lastRequest = request; }
  else {
    answerCalls++;
    if (slowAnswers) await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const finishReason = parser && truncateNext ? "length" : "stop";
  truncateNext = false;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { role: "assistant",
    content: parser ? JSON.stringify(response ?? { primary_intent: "unknown", confidence: 0 }) : "Our listed menu prices apply. Staff can verify any unlisted details." } }] }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
process.env.ORDER_AGENT_NLU_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;

try {
  const { runTurn, fastUnderstanding } = await import("../lib/agent/pipeline.ts");
  const { stateRepo, getDefaultState } = await import("../lib/data/state.repo.ts");
  const { messageRepo } = await import("../lib/data/message.repo.ts");
  const { orderRepo } = await import("../lib/data/order.repo.ts");
  const { getSupabaseAdmin } = await import("../lib/supabase-admin.ts");
  const { cache } = await import("../lib/core/cache.ts");
  const { coerceUnderstanding, nluCacheKey } = await import("../lib/agent/nlu.ts");
  const { addToCart, removeFromCart } = await import("../lib/agent/cart.ts");
  const { findMatchingDeliveryArea } = await import("../lib/agent/delivery.ts");
  const { parseCustomerTimeToIso } = await import("../lib/restaurant-time.ts");
  const { inferLanguagePreference } = await import("../lib/core/lang-detect.ts");

  let checks = 0;
  const check = (name, fn) => { fn(); checks++; console.log(`PASS: ${name}`); };
  const states = new Map();
  const histories = new Map();
  const savedAddresses = new Map();
  const placed = [];
  let failPersistence = false;
  let failReceipt = false;
  let previousOrder = null;
  let cancellations = 0;
  let sequence = 0;
  const menu = [
    { id: "kh", name: "Chicken Karahi (Half)", price: 900, category: "Karahi", is_available: true },
    { id: "kf", name: "Chicken Karahi (Full)", price: 1600, category: "Karahi", is_available: true },
    { id: "n", name: "Plain Naan", price: 50, category: "Bread", is_available: true },
    { id: "t", name: "Chicken Tikka", price: 400, category: "BBQ", is_available: true },
  ];
  const settings = { is_accepting_orders: true, opening_time: "12:00 AM", closing_time: "11:59 PM",
    timezone: "Asia/Karachi", delivery_enabled: true, delivery_fee: 100, min_delivery_amount: 0,
    delivery_areas: [], estimated_prep_minutes: 25, estimated_delivery_minutes: 40,
    city: "Lahore", phone_delivery: "", phone_dine_in: "", ai_personality: "Warm" };
  const seedCaches = async () => {
    await cache.set("menu:b", structuredClone(menu), 600_000);
    await cache.set("settings:b", { ...settings }, 600_000);
  };
  await seedCaches();
  const fresh = (id, patch = {}) => {
    const state = { ...getDefaultState(id), preferred_language: "english", ...patch };
    states.set(id, state); histories.set(id, []); return state;
  };
  const line = (id = "n", qty = 1, notes = null) => {
    const item = menu.find((m) => m.id === id);
    return { menu_item_id: item.id, name: item.name, unit_price: item.price, qty, size: null, addons: [], notes };
  };
  const mention = (query, qty = 1, notes = null) => ({ query, qty, size: null, addons: [], notes });
  const u = (intent, patch = {}) => ({ primary_intent: intent, intents: [intent], confidence: 0.98, language: "english", ...patch });
  stateRepo.ensure = async (id) => structuredClone(states.get(id) ?? fresh(id));
  stateRepo.patch = async (id, patch) => {
    if (failPersistence) throw new Error("fixture persistence failed");
    Object.assign(states.get(id), structuredClone(patch));
    return structuredClone(states.get(id));
  };
  stateRepo.commitTurn = async (id, _messageId, patch) => { await stateRepo.patch(id, patch); };
  messageRepo.recentHistory = async (id) => structuredClone(histories.get(id) ?? []);
  getSupabaseAdmin().from = (table) => {
    assert.ok(["conversations", "customer_addresses", "agent_turns", "staff_alerts"].includes(table), `Unexpected DB access: ${table}`);
    let owner;
    const chain = { select: () => chain, eq: (key, value) => { if (key === "id" || key === "contact_id") owner = value; return chain; }, insert: () => chain,
      not: () => chain, order: () => chain, limit: () => chain,
      maybeSingle: async () => ({ data: savedAddresses.has(owner) ? { contact_id: owner, branch_id: "b" } : null, error: null }),
      then: (resolve) => Promise.resolve({ data: table === "customer_addresses" ? [savedAddresses.get(owner)].filter(Boolean) : null, error: null }).then(resolve) };
    return chain;
  };
  orderRepo.place = async (payload) => { placed.push(structuredClone(payload)); return `order-${placed.length}`; };
  orderRepo.getById = async () => { if (failReceipt) throw new Error("receipt unavailable"); return { order_number: placed.length, total: 1234 }; };
  orderRepo.getLatestForConversation = async () => previousOrder;
  orderRepo.cancelOrder = async () => { cancellations++; return true; };
  const send = async (id, text, understanding) => {
    response = understanding ?? null;
    const messageId = `m-${++sequence}`;
    histories.get(id).push({ id: messageId, role: "user", content: text });
    const result = await runTurn({ conversationId: id, branchId: "b", phone: "offline", messageText: text,
      sourceUserMessageId: messageId, messageId, whatsappMessageId: messageId, appName: "Test Kitchen", currency: "Rs." });
    histories.get(id).push({ id: `a-${sequence}`, role: "assistant", content: result.replyText });
    return result;
  };

  // Understand the real entry path, not just pre-labelled FSM transitions.
  fresh("delivery");
  let result = await send("delivery", "2 full chicken karahi aur 3 naan, delivery House 12 Street 4 Lahore", u("add_items", {
    intents: ["add_items", "set_order_type", "provide_address"], items: [mention("Chicken Karahi (Full)", 2), mention("Plain Naan", 3)],
    order_type: "delivery", address: "House 12 Street 4 Lahore", language: "roman_urdu" }));
  check("one message keeps every item, quantity, address and delivery mode; shows one review", () => {
    assert.equal(states.get("delivery").cart.length, 2); assert.equal(states.get("delivery").cart[0].qty, 2);
    assert.equal(result.stage, "confirming"); assert.equal((result.replyText.match(/Total:/g) ?? []).length, 1);
    assert.ok(result.replyText.includes("House 12")); assert.equal(placed.length, 0);
  });
  await send("delivery", "confirm:yes");
  check("a separate confirmation places the complete order once and clears draft confirmation", () => {
    assert.equal(placed.length, 1); assert.equal(placed[0].items[1].qty, 3);
    assert.equal(states.get("delivery").stage, "placed"); assert.equal(states.get("delivery").summary_sent_at, null);
  });

  fresh("variants");
  await send("variants", "3 naan, 2 chicken karahi less oil, and 4 tikka", u("add_items", {
    items: [mention("Plain Naan", 3), mention("Chicken Karahi", 2, "less oil"), mention("Chicken Tikka", 4)] }));
  const variantState = states.get("variants");
  check("variant clarification retains quantity, preparation and remaining order items", () => {
    assert.equal(variantState.pending_clarification.remaining_items[0].qty, 2);
    assert.equal(variantState.pending_clarification.remaining_items[0].notes, "less oil");
    assert.equal(variantState.cart.length, 2);
  });
  await send("variants", "what are your opening hours?", u("ask_hours_or_location"));
  check("an information interruption preserves unresolved portions without replaying resolved ones", () => assert.equal(states.get("variants").pending_clarification.remaining_items.length, 1));
  await send("variants", "full");
  check("typing the variant resolves the original request and resumes the remaining order", () => {
    const cart = states.get("variants").cart;
    assert.equal(cart.length, 3); assert.equal(cart.find((i) => i.menu_item_id === "kf").qty, 2);
    assert.equal(cart.find((i) => i.menu_item_id === "kf").notes, "less oil");
    assert.equal(cart.find((i) => i.menu_item_id === "t").qty, 4);
  });
  fresh("numeric", { stage: "building_cart", cart: [line()], last_shown_options: menu.slice(0, 2).map((m) => ({ id: m.id, name: m.name, price: m.price })), last_shown_options_at: new Date().toISOString() });
  check("numeric 2 selects the shown menu item even when cart already contains food", () => assert.equal(fastUnderstanding("2", states.get("numeric")).items[0].query, "Chicken Karahi (Full)"));
  states.get("numeric").pending_clarification = { kind: "order_type", options: [{ id: "ordertype:delivery", label: "Delivery" }, { id: "ordertype:pickup", label: "Pickup" }] };
  check("numeric 2 uses the actual pending order-type choices", () => assert.equal(fastUnderstanding("2", states.get("numeric")).order_type, "pickup"));
  check("negation, compound changes and item questions never match a button substring", () => {
    for (const text of ["no delivery please", "pickup and 2 naan", "don't confirm", "remove chicken karahi", "what is in the full karahi?"])
      assert.equal(fastUnderstanding(text, states.get("numeric")), null, text);
  });
  check("unshown item IDs cannot add arbitrary items", () => assert.equal(fastUnderstanding("item:forged", states.get("numeric")), null));

  fresh("notes");
  await send("notes", "one plain naan without butter and one plain naan extra crispy", u("add_items", { items: [mention("Plain Naan", 1, "without butter"), mention("Plain Naan", 1, "extra crispy")] }));
  check("two portions with different preparations stay separate", () => {
    assert.equal(states.get("notes").cart.length, 2); assert.equal(states.get("notes").cart[0].qty, 1);
    assert.equal(states.get("notes").cart[0].notes, "without butter");
  });
  check("null quantity survives coercion for instruction-only edits", () => assert.equal(coerceUnderstanding(u("add_items", { items: [mention("Plain Naan", null, "less oil")] }), "english").items[0].qty, null));
  check("mixed order and price question preserves the requested food", () => assert.equal(coerceUnderstanding(u("add_items", { intents: ["add_items", "ask_item_info"], items: [mention("Plain Naan", 2)], info_query: "price of karahi" }), "english").items.length, 1));
  check("cart refuses invalid quantities instead of silently accepting a different order", () => {
    for (const qty of [0, -1, 60, NaN, 1.5]) assert.throws(() => addToCart([], { ...line(), qty }));
  });

  fresh("truncated");
  truncateNext = true;
  const beforeTruncated = parserCalls;
  await send("truncated", "please add two naan", u("add_items", { items: [mention("Plain Naan", 2)] }));
  check("a truncated primary extraction retries the fallback without losing portions", () => {
    assert.equal(parserCalls - beforeTruncated, 2); assert.equal(states.get("truncated").cart[0].qty, 2);
  });
  fresh("resize", { cart: [line("kf", 2)] });
  await send("resize", "make my karahi half size instead", u("update_quantity", { items: [{ ...mention("Chicken Karahi", null), size: "half" }] }));
  check("changing size resolves the requested variant and preserves quantity", () => {
    assert.equal(states.get("resize").cart[0].menu_item_id, "kh"); assert.equal(states.get("resize").cart[0].qty, 2);
    assert.equal(states.get("resize").cart[0].unit_price, 900);
  });
  check("numeric removal strings preserve the amount, invalid removal amounts are rejected", () => {
    assert.equal(coerceUnderstanding(u("remove_items", { removals: [{ query: "Plain Naan", qty: "2" }] }), "english").removals[0].qty, 2);
    assert.equal(coerceUnderstanding(u("remove_items", { removals: [{ query: "Plain Naan", qty: 0 }] }), "english"), null);
  });
  fresh("note-edit", { cart: [line()] });
  await send("note-edit", "make the naan crispy", u("add_items", { items: [mention("Plain Naan", null, "extra crispy")] }));
  check("preparation-only edits to bread keep the ordered quantity", () => {
    assert.equal(states.get("note-edit").cart.length, 1); assert.equal(states.get("note-edit").cart[0].qty, 1);
    assert.equal(states.get("note-edit").cart[0].notes, "extra crispy");
  });
  await send("notes", "naan less oil", u("add_items", { items: [mention("Plain Naan", null, "less oil")] }));
  check("ambiguous preparation edits never add an extra portion", () => assert.equal(states.get("notes").cart.reduce((sum, item) => sum + item.qty, 0), 2));
  check("partial removal consumes the requested total only once across preparation lines", () => {
    const remaining = removeFromCart([line("n", 2, "crispy"), line("n", 3, "soft")], { menu_item_id: "n", qty: 3 });
    assert.equal(remaining.reduce((sum, item) => sum + item.qty, 0), 2);
  });
  fresh("info-consent", { stage: "confirming", cart: [line()], order_type: "delivery", address: "House 10 Street 4 Lahore",
    summary_sent_at: new Date().toISOString(), pending_clarification: { kind: "item_disambiguation", options: [{ id: "confirm:yes", label: "Confirm" }] } });
  await send("info-consent", "when do you close?", u("ask_hours_or_location"));
  const beforeInfoYes = placed.length;
  await send("info-consent", "yes");
  check("yes after an unrelated information answer requires a fresh order review", () => assert.equal(placed.length, beforeInfoYes));
  fresh("area-only", { cart: [line()], order_type: "delivery" });
  result = await send("area-only", "delivery to Gulberg Lahore", u("provide_address", { address: "Gulberg Lahore" }));
  check("an area alone cannot pass as a complete delivery destination", () => assert.equal(result.stage, "collecting_delivery"));
  fresh("allergy", { cart: [line()] });
  result = await send("allergy", "I am allergic to peanuts", u("general_question", { info_query: "peanut allergy" }));
  check("allergy guarantees are handed to staff", () => assert.equal(result.escalate, true));
  fresh("extras", { cart: [line()] });
  result = await send("extras", "add naan with extra cheese", u("add_items", { items: [{ ...mention("Plain Naan"), addons: ["extra cheese"] }] }));
  check("unpriced paid extras require staff verification", () => assert.equal(result.escalate, true));
  fresh("repeat-unknown", { cart: [line()] });
  for (let attempt = 0; attempt < 3; attempt++) result = await send("repeat-unknown", `unclear input ${attempt}`, u("unknown", { confidence: 0.1 }));
  check("repeated understanding failures hand off instead of looping forever", () => assert.equal(result.escalate, true));

  fresh("address", { stage: "collecting_delivery", cart: [line()], order_type: "delivery" });
  await send("address", "actually add two naan", u("add_items", { items: [mention("Plain Naan", 2)] }));
  check("a cart edit during address collection never becomes an address", () => {
    assert.equal(states.get("address").address, null); assert.equal(states.get("address").cart[0].qty, 3);
    assert.equal(states.get("address").stage, "collecting_delivery");
  });
  await send("address", "do you deliver to DHA?", u("ask_delivery_info", { info_query: "do you deliver to DHA?" }));
  check("asking about an area does not choose a destination", () => assert.equal(states.get("address").address, null));
  check("NLU receives history, current cart and fulfillment context", () => {
    const system = lastRequest.messages[0].content;
    assert.ok(system.includes("FULFILLMENT:")); assert.ok(system.includes("3xPlain Naan"));
    assert.ok(lastRequest.messages.slice(1, -1).some((m) => m.content === "actually add two naan"));
  });
  check("interpretation cache includes conversation, cart and prior assistant question", () => {
    const base = { messageText: "yes", stage: "confirming", language: "english", cart: [] };
    assert.notEqual(nluCacheKey({ ...base, conversationId: "a" }), nluCacheKey({ ...base, conversationId: "b" }));
    assert.notEqual(nluCacheKey(base), nluCacheKey({ ...base, cart: [{ name: "Naan", qty: 3 }] }));
    assert.notEqual(nluCacheKey(base), nluCacheKey({ ...base, history: [{ role: "assistant", content: "Would you like a menu?" }] }));
  });
  fresh("uncertain", { cart: [line()] });
  await send("uncertain", "something unclear", u("add_items", { confidence: 0.2, items: [mention("Chicken Tikka")] }));
  check("low-confidence model guesses cannot mutate a cart", () => assert.equal(states.get("uncertain").cart.length, 1));

  fresh("saved", { stage: "collecting_delivery", cart: [line()], order_type: "delivery" });
  result = await send("saved", "addr:saved:someone-elses-address");
  check("saved addresses are restricted to this conversation's preloaded owner", () => {
    assert.equal(states.get("saved").address, null); assert.notEqual(result.stage, "confirming");
  });
  const now = new Date("2026-10-25T12:00:00Z");
  check("invalid and ambiguous times never fabricate a reservation", () => {
    for (const text of ["later", "99pm", "9:75pm", "25:00", "9", "9 baje", "2020-01-01T00:00:00Z", ""])
      assert.equal(parseCustomerTimeToIso(text, "Asia/Karachi", now), null, text);
    assert.equal(parseCustomerTimeToIso("tomorrow 9pm", "Asia/Karachi", now), "2026-10-26T16:00:00.000Z");
    assert.equal(parseCustomerTimeToIso("in 2 hours", "Asia/Karachi", now), "2026-10-25T14:00:00.000Z");
  });
  fresh("pickup", { stage: "collecting_pickup", order_type: "pickup", cart: [line()] });
  result = await send("pickup", "later", u("provide_pickup_time", { pickup_time: "later" }));
  check("unparseable pickup time stays at time collection, with no confirm button", () => {
    assert.equal(result.stage, "collecting_pickup"); assert.equal(states.get("pickup").pickup_time, null);
    assert.ok(!result.interactive?.payload.buttons?.some((b) => b.id === "confirm:yes"));
  });
  result = await send("pickup", "in 30 minutes", u("provide_pickup_time", { pickup_time: "in 30 minutes" }));
  check("pickup review includes the customer's actual pickup time", () => assert.ok(result.replyText.includes("🕐")));
  const beforePickup = placed.length;
  await send("pickup", "confirm:yes");
  check("pickup places only after review and carries the time to the order service", () => {
    assert.equal(placed.length, beforePickup + 1); assert.ok(placed.at(-1).pickupTime); assert.equal(placed.at(-1).deliveryFee, 0);
  });
  fresh("dinein", { cart: [line()], stage: "building_cart" });
  result = await send("dinein", "table for 4, in 45 minutes", u("set_order_type", { order_type: "dine-in", guests: 4, reservation_time: "in 45 minutes" }));
  check("dine-in review includes guest count and time before confirmation", () => {
    assert.equal(result.stage, "confirming"); assert.ok(result.replyText.includes("👥 4")); assert.ok(result.replyText.includes("🕐"));
  });
  await send("dinein", "confirm:yes");
  check("dine-in carries the complete reservation to placement", () => assert.equal(placed.at(-1).guests, 4));

  fresh("receipt", { stage: "confirming", cart: [line()], order_type: "delivery", address: "House 10 Street 4 Lahore",
    summary_sent_at: new Date().toISOString(), pending_clarification: { kind: "item_disambiguation", options: [{ id: "confirm:yes", label: "Confirm" }] } });
  failReceipt = true;
  result = await send("receipt", "confirm:yes");
  failReceipt = false;
  check("a receipt lookup outage preserves committed success and a usable reference", () => {
    assert.equal(result.placeOrder, true); assert.ok(result.replyText.includes(`order-${placed.length}`));
    assert.ok(!result.replyText.includes("#0 "));
  });

  fresh("stale", { stage: "confirming", cart: [line()], order_type: "delivery", address: "House 10 Street 4 Lahore" });
  const beforeStale = placed.length;
  result = await send("stale", "confirm:yes");
  check("a stale confirming stage without a recorded review cannot place an order", () => {
    assert.equal(placed.length, beforeStale); assert.equal(result.stage, "confirming"); assert.ok(states.get("stale").summary_sent_at);
  });
  await send("stale", "confirm but add 2 naan", u("add_items", { intents: ["add_items", "confirm_order"], items: [mention("Plain Naan", 2)] }));
  check("a confirmation combined with a cart edit requires a new review", () => { assert.equal(placed.length, beforeStale); assert.equal(states.get("stale").cart[0].qty, 3); });
  await send("stale", "don't ring the bell", u("unknown", { notes: "Do not ring the bell" }));
  await send("stale", "confirm:yes");
  await send("stale", "confirm:yes");
  check("order-level rider instructions reach placement after renewed confirmation", () => assert.equal(placed.at(-1).customerInstructions, "Do not ring the bell"));

  fresh("clear", { stage: "confirming", cart: [line()], order_type: "delivery", address: "Old address", summary_sent_at: new Date().toISOString() });
  await cache.set("settings:b", { ...settings, delivery_areas: ["Gulberg"] }, 600_000);
  result = await send("clear", "change address to House 20 DHA Phase 9", u("provide_address", { address: "House 20 DHA Phase 9" }));
  check("a rejected replacement address clears the old address and cannot show confirm", () => {
    assert.equal(states.get("clear").address, null); assert.equal(result.address, null); assert.equal(result.stage, "collecting_delivery");
    assert.ok(!result.interactive?.payload.buttons?.some((b) => b.id === "confirm:yes"));
  });
  await seedCaches();
  check("delivery range checks use the phase number, never the house number", () => {
    assert.equal(findMatchingDeliveryArea("House 2 DHA Phase 9", { delivery_areas: ["DHA Phase 1-6"] }), null);
    assert.equal(findMatchingDeliveryArea("House 99 DHA Phase 5", { delivery_areas: ["DHA Phase 1-6"] }), "DHA Phase 1-6");
    assert.equal(findMatchingDeliveryArea("House 1 Askari 11", { delivery_areas: ["Askari 10"] }), null);
  });

  fresh("cancel-draft", { stage: "building_cart", cart: [line()] });
  previousOrder = { id: "old-order", status: "received", created_at: new Date().toISOString() };
  await send("cancel-draft", "cancel my new draft", u("cancel_order"));
  check("cancelling a new cart never cancels a previous accepted order", () => assert.equal(cancellations, 0));
  previousOrder = null;
  fresh("restart", { cart: [line()], customer_instructions: "old rider instruction", summary_sent_at: new Date().toISOString(),
    pending_clarification: { kind: "item_disambiguation", options: [{ id: "item:n", label: "Naan" }] } });
  await send("restart", "start over", u("restart_order"));
  check("restart clears stale notes, choices and review authorization", () => {
    for (const key of ["customer_instructions", "summary_sent_at", "pending_clarification"]) assert.equal(states.get("restart")[key], null);
  });
  fresh("post-order", { stage: "placed" });
  result = await send("post-order", "change to pickup in 30 minutes", u("set_order_type", { order_type: "pickup", pickup_time: "in 30 minutes" }));
  check("changes to accepted orders are handed to staff for dispatch and fee coordination", () => assert.equal(result.escalate, true));

  fresh("persist", { cart: [line()] });
  failPersistence = true;
  await assert.rejects(() => send("persist", "add another naan", u("add_items", { items: [mention("Plain Naan")] })), /persistence failed/);
  failPersistence = false;
  checks++; console.log("PASS: persistence failure propagates; no success reply can escape with lost state");
  check("Roman Urdu detection uses whole words instead of English substrings", () => {
    assert.equal(inferLanguagePreference("please order two noodles", "english"), "english");
    assert.equal(inferLanguagePreference("do naan aur ek tikka", "english"), "roman_urdu");
  });

  // Anonymized replay of the production incident, using the stored menu formats.
  menu.push(
    { id: "egg", name: "Lapeta Egg Burger", price: 179, category: "Burger", is_available: true },
    { id: "d15", name: "1.5 Liter Drink", price: 199, category: "Soda Section", is_available: true },
    { id: "d1", name: "1 Liter Drink", price: 150, category: "Soda Section", is_available: true },
    { id: "d500", name: "500ml Drink", price: 99, category: "Soda Section", is_available: true },
    { id: "shawarma", name: "Chicken Shawarma", price: 169, category: "Shawarma", is_available: true },
    { id: "cheese-shawarma", name: "Chicken Cheese Shawarma", price: 199, category: "Shawarma", is_available: true },
  );
  const saved = { id: "saved-owner", address: "Sector A st 26", label: "Sector A st 26", use_count: 1 };
  await seedCaches();
  await cache.set("settings:b", { ...settings, min_delivery_amount: 500, delivery_fee: 150 }, 600_000);
  fresh("incident", { preferred_language: "roman_urdu" }); savedAddresses.set("incident", saved);
  result = await send("incident", "Ek egg burger or aik drink deliver krdo", u("add_items", { language: "roman_urdu", order_type: "delivery",
    intents: ["add_items", "set_order_type"], items: [mention("egg burger"), mention("drink")] }));
  check("unspecified drink asks all three stored sizes, adds only the burger and keeps delivery", () => {
    const state = states.get("incident");
    assert.equal(state.cart.length, 1); assert.equal(state.cart[0].menu_item_id, "egg");
    assert.equal(state.order_type, "delivery"); assert.equal(state.pending_clarification.remaining_items.length, 1);
    for (const name of ["500ml Drink", "1 Liter Drink", "1.5 Liter Drink", "Lapeta Egg Burger"]) assert.ok(result.replyText.includes(name), name);
  });
  result = await send("incident", "?");
  check("question mark repeats the current sizes without adding items or losing the unresolved order", () => {
    assert.equal(states.get("incident").cart.length, 1); assert.equal(states.get("incident").pending_clarification.remaining_items.length, 1);
    assert.ok(result.replyText.includes("500ml Drink")); assert.equal(states.get("incident").invalid_step_count, 0);
  });
  result = await send("incident", "1.5 litre");
  check("typed litre spelling selects only the chosen drink and then offers the saved address", () => {
    assert.equal(states.get("incident").cart.length, 2); assert.equal(states.get("incident").cart[1].menu_item_id, "d15");
    assert.equal(result.stage, "collecting_delivery"); assert.ok(result.interactive.payload.buttons.some((b) => b.id === "addr:saved:saved-owner"));
  });
  result = await send("incident", "Pichla Address");
  check("saved multi-digit street address is accepted consistently and the real delivery minimum is explained", () => {
    assert.equal(states.get("incident").address, saved.address); assert.equal(result.stage, "building_cart");
    assert.ok(result.replyText.includes("500")); assert.equal(states.get("incident").summary_sent_at, null);
    assert.ok(!result.interactive?.payload.buttons?.some((b) => b.id === "confirm:yes"));
  });
  result = await send("incident", "Ek chicken shawarma. Bhi add krdain", u("add_items", { language: "roman_urdu", items: [mention("chicken shawarma")] }));
  check("adding shawarma preserves the saved destination and reviews one of each, with delivery fee", () => {
    assert.equal(result.stage, "confirming"); assert.equal(states.get("incident").cart.length, 3);
    assert.ok(states.get("incident").cart.every((item) => item.qty === 1)); assert.ok(result.replyText.includes("697"));
    assert.ok(result.replyText.includes("Chicken Shawarma")); assert.ok(result.interactive.payload.buttons.some((b) => b.id === "confirm:yes"));
  });
  const beforeResume = placed.length;
  result = await send("incident", "?");
  check("question mark at review shows the complete review and never confirms the order", () => {
    assert.equal(result.stage, "confirming"); assert.equal(placed.length, beforeResume); assert.ok(result.replyText.includes("697"));
  });
  const callsBeforeAddress = parserCalls;
  result = await send("incident", "Old address", u("add_items", { items: [mention("Lapeta Egg Burger"), mention("1.5 Liter Drink"), mention("Chicken Shawarma")] }));
  check("Old address bypasses a history-echoing model and never duplicates food", () => {
    assert.equal(parserCalls, callsBeforeAddress); assert.equal(states.get("incident").cart.length, 3);
    assert.ok(states.get("incident").cart.every((item) => item.qty === 1)); assert.equal(result.stage, "confirming");
  });
  result = await send("incident", "Please use the address from my previous delivery", u("use_saved_address", { language: "roman_urdu" }));
  check("natural saved-address references use only the owned saved address and do not add portions", () => {
    assert.equal(result.stage, "confirming"); assert.equal(states.get("incident").address, saved.address);
    assert.ok(states.get("incident").cart.every((item) => item.qty === 1));
  });
  fresh("blocked-ack", { stage: "confirming", cart: [line("egg")], order_type: "delivery", address: "Sector A" });
  result = await send("blocked-ack", "add a chicken shawarma", u("add_items", { items: [mention("Chicken Shawarma")] }));
  check("a blocked checkout acknowledges the new food as well as the missing address", () => {
    assert.equal(result.stage, "collecting_delivery"); assert.ok(result.replyText.includes("Chicken Shawarma"));
    assert.ok(/address/i.test(result.replyText)); assert.equal(states.get("blocked-ack").cart.length, 2);
  });
  fresh("bad-saved", { cart: [line("kf")], order_type: "delivery", stage: "collecting_delivery" });
  savedAddresses.set("bad-saved", { ...saved, address: "Sector A", label: "Sector A" });
  result = await send("bad-saved", "Old address");
  check("an incomplete saved address cannot leave confirming stage or a confirm button behind", () => {
    assert.equal(result.stage, "collecting_delivery"); assert.equal(states.get("bad-saved").address, null);
    assert.ok(!result.interactive?.payload.buttons?.some((b) => b.id === "confirm:yes"));
  });
  fresh("no-saved", { stage: "collecting_delivery", cart: [line("kf")], order_type: "delivery" });
  result = await send("no-saved", "Old address");
  check("missing saved address asks for a destination without replaying any order", () => {
    assert.equal(states.get("no-saved").cart[0].qty, 1); assert.equal(result.stage, "collecting_delivery");
  });
  fresh("pending-edit", { preferred_language: "roman_urdu" }); savedAddresses.set("pending-edit", saved);
  await send("pending-edit", "egg burger aur drink delivery", u("add_items", { order_type: "delivery", items: [mention("egg burger"), mention("drink")] }));
  result = await send("pending-edit", "also add chicken shawarma", u("add_items", { items: [mention("Chicken Shawarma")] }));
  check("a new food request while choosing a drink preserves the unresolved drink", () => {
    assert.equal(states.get("pending-edit").cart.length, 2); assert.equal(states.get("pending-edit").pending_clarification.remaining_items[0].query, "drink");
    assert.ok(result.replyText.includes("Chicken Shawarma")); assert.ok(result.replyText.includes("500ml Drink")); assert.equal(result.stage, "building_cart");
  });
  result = await send("pending-edit", "show burgers", u("browse_menu", { info_query: "Burger" }));
  check("menu browsing cannot overwrite an unresolved order's drink choices", () => {
    assert.equal(states.get("pending-edit").pending_clarification.remaining_items[0].query, "drink");
    assert.deepEqual(states.get("pending-edit").last_shown_options.map((o) => o.id).sort(), ["d1", "d15", "d500"]);
  });
  result = await send("pending-edit", "Old address");
  check("an address given before the drink choice is saved without losing food or prematurely confirming", () => {
    assert.equal(states.get("pending-edit").address, saved.address); assert.equal(result.stage, "building_cart");
    assert.equal(states.get("pending-edit").pending_clarification.remaining_items.length, 1);
  });
  result = await send("pending-edit", "item:d15");
  check("resolving the drink after interruptions completes the full order once", () => {
    assert.equal(result.stage, "confirming"); assert.equal(states.get("pending-edit").cart.length, 3);
    assert.ok(states.get("pending-edit").cart.every((item) => item.qty === 1)); assert.ok(result.replyText.includes("697"));
  });
  menu.push(
    { id: "ps", name: "BBQ Pizza Small", price: 399, category: "Pizza", is_available: true },
    { id: "pm", name: "BBQ Pizza Medium", price: 699, category: "Pizza", is_available: true },
    { id: "pl", name: "BBQ Pizza Large", price: 999, category: "Pizza", is_available: true },
    { id: "fl", name: "Fajita Pizza Large", price: 999, category: "Pizza", is_available: true },
    { id: "mb", name: "Banana Milkshake", price: 250, category: "Milkshake", is_available: true },
    { id: "mm", name: "Mango Milkshake", price: 250, category: "Milkshake", is_available: true });
  settings.min_delivery_amount = 0;
  await seedCaches();
  fresh("pizza-incident");
  result = await send("pizza-incident", "Ek bbq pizza or aik milkshake deliver kr dain", u("add_items", {
    items: [mention("bbq pizza"), mention("milkshake")], order_type: "delivery", language: "roman_urdu" }));
  check("the real pizza/milkshake incident asks for choices and retains both portions", () => {
    assert.equal(states.get("pizza-incident").pending_clarification.remaining_items.length, 2);
    assert.ok(result.replyText.includes("BBQ Pizza")); assert.ok(!/nahi hai|not.*menu|sirf Karahi/.test(result.replyText));
  });
  await send("pizza-incident", "medium");
  check("pizza size selection advances to shake flavor without losing delivery", () => {
    assert.equal(states.get("pizza-incident").cart[0].menu_item_id, "pm");
    assert.equal(states.get("pizza-incident").pending_clarification.remaining_items[0].query, "milkshake");
    assert.equal(states.get("pizza-incident").order_type, "delivery");
  });
  await send("pizza-incident", "item:mb");
  result = await send("pizza-incident", "House 42 Street 4 Lahore", u("provide_address", { address: "House 42 Street 4 Lahore" }));
  check("the completed incident reviews exactly one selected pizza and shake", () => {
    assert.equal(result.stage, "confirming"); assert.equal(states.get("pizza-incident").cart.length, 2);
    assert.ok(states.get("pizza-incident").cart.every((item) => item.qty === 1));
    assert.ok(result.replyText.includes("699")); assert.ok(result.replyText.includes("250"));
  });
  fresh("compound-questions");
  const callsBeforeQuestions = parserCalls;
  result = await send("compound-questions", "add 2 naan, tikka ka rate, fajita pizza available? delivery fee aur delivery time? COD?", u("add_items", {
    intents: ["add_items", "ask_item_info", "ask_delivery_info", "ask_payment"], items: [mention("naan", 2)],
    questions: [ { intent: "ask_item_info", query: "price of chicken tikka" },
      { intent: "ask_item_info", query: "is Fajita Pizza available" },
      { intent: "ask_delivery_info", query: "delivery fee and delivery time" },
      { intent: "ask_payment", query: "COD?" } ] }));
  check("compound questions preserve the addition and answer every independent question with catalog facts", () => {
    assert.equal(states.get("compound-questions").cart[0].qty, 2);
    for (const fact of ["400", "Fajita Pizza", "999", "100", "40", "COD"]) assert.ok(result.replyText.includes(fact), fact);
    assert.equal(parserCalls - callsBeforeQuestions, 1);
  });
  menu.find((item) => item.id === "fl").is_available = false;
  await seedCaches();
  fresh("unavailable-inquiry");
  result = await send("unavailable-inquiry", "Fajita Pizza available?", u("ask_item_info", {
    questions: [{ intent: "ask_item_info", query: "Fajita Pizza available?" }] }));
  check("an unavailable catalog item is identified without offering an order button", () => {
    assert.match(result.replyText, /unavailable/i);
    assert.equal(states.get("unavailable-inquiry").last_shown_options.length, 0);
  });
  menu.find((item) => item.id === "fl").is_available = true;
  await seedCaches();
  fresh("unknown-first");
  result = await send("unknown-first", "2 sushi and 3 naan", u("add_items", { items: [mention("sushi", 2), mention("naan", 3)] }));
  check("an unsupported first dish cannot discard valid later portions or permit a partial checkout", () => {
    assert.equal(states.get("unknown-first").cart[0].qty, 3);
    assert.equal(states.get("unknown-first").pending_clarification.remaining_items[0].query, "sushi");
    assert.ok(result.replyText.includes("sushi")); assert.ok(!states.get("unknown-first").summary_sent_at);
  });
  await send("unknown-first", "remove sushi", u("remove_items", { removals: [{ query: "sushi", qty: "all" }] }));
  check("a customer can remove an unresolved portion without deleting ordered food", () => {
    assert.ok(!states.get("unknown-first").pending_clarification?.remaining_items?.length); assert.equal(states.get("unknown-first").cart[0].qty, 3);
  });
  fresh("address-with-choice");
  await send("address-with-choice", "BBQ pizza delivery House 42 Street 4 Lahore", u("add_items", {
    items: [mention("BBQ pizza", 2)], order_type: "delivery", address: "House 42 Street 4 Lahore" }));
  check("an address in the same message survives a pending pizza size", () => assert.equal(states.get("address-with-choice").address, "House 42 Street 4 Lahore"));
  await send("address-with-choice", "large");
  check("choosing the size reviews the saved destination and original quantity", () => {
    assert.equal(states.get("address-with-choice").stage, "confirming"); assert.equal(states.get("address-with-choice").cart[0].qty, 2);
  });
  fresh("slow-compound-answers");
  slowAnswers = true;
  const answersBefore = answerCalls;
  const answerStarted = Date.now();
  result = await send("slow-compound-answers", "Tell me about parking, wifi and seating", u("general_question", {
    questions: ["parking", "wifi", "seating"].map((query) => ({ intent: "general_question", query })) }));
  slowAnswers = false;
  check("several free-form questions share one timeout instead of serial provider stalls", () => {
    assert.equal(answerCalls - answersBefore, 1);
    assert.ok(Date.now() - answerStarted < 1200);
    assert.ok(result.replyText.length > 0);
  });
  fresh("missing-catalog");
  await cache.set("menu:b", [], 600_000);
  result = await send("missing-catalog", "Fajita pizza", u("add_items", { items: [mention("Fajita pizza")] }));
  check("pictures without a catalog cannot invent missing dishes, categories or prices", () => {
    assert.equal(result.escalate, true); assert.equal(states.get("missing-catalog").last_error, "No verified menu catalog for this branch");
    assert.ok(!/Karahi|BBQ|not.*menu|nahi hai/.test(result.replyText));
  });
  await seedCaches();
  fresh("committed-order-crash", { stage: "placed", cart: [] });
  previousOrder = { id: "already-placed", order_number: 77, total: 550, type: "delivery", source_user_message_id: `m-${sequence + 1}` };
  const ordersBeforeRecovery = placed.length;
  result = await send("committed-order-crash", "confirm:yes");
  check("a crash after order commit recovers its receipt without another placement or NLU", () => {
    assert.equal(result.intent, "recovered_order_reply"); assert.ok(result.replyText.includes("77"));
    assert.equal(placed.length, ordersBeforeRecovery);
  });
  previousOrder = null;
  console.log(`\nAGENT CONVERSATIONS: ${checks} checks passed; ${parserCalls} actual parser HTTP requests, ${placed.length} isolated test orders.`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
