/** Synthetic NLU-only evaluation. Uses configured provider, never DB/WhatsApp. */
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });
const { understandTurn } = await import("../lib/agent/nlu.ts");
const item = (name, qty = 1) => ({ name, qty });
const deliveryHistory = [
  { role: "user", content: "Ek egg burger or aik drink deliver krdo" },
  { role: "assistant", content: "1x Lapeta Egg Burger and 1x 1.5 Liter Drink added. Use saved address or new address?" },
  { role: "user", content: "Pichla Address" },
  { role: "assistant", content: "Saved address selected: Sector A st 26." },
];
const fulfillment = { order_type: "delivery", address: "Sector A st 26", guests: null, reservation_time: null, pickup_time: null };
const cases = [
  { name: "numbered deal keeps identifier separate from quantity and flavours", text: "Ek Shahana Special Ultra Long Pizza Deal 2 chahiye, flavours Tikka aur Fajita rakhna", language: "roman_urdu",
    test: (u) => u.intents.includes("add_items") && u.items.length === 1 && /deal\s*2\b/i.test(u.items[0].query) && u.items[0].qty === 1 && /tikka/i.test(u.items[0].notes ?? "") && /fajita/i.test(u.items[0].notes ?? "") && !u.items[0].addons.length },
  { name: "numbered deal allows multiple portions of a different deal number", text: "Please add 2 Deal 3", test: (u) => u.items.length === 1 && /deal\s*3\b/i.test(u.items[0].query) && u.items[0].qty === 2 },
  { name: "numbered deal defaults to one portion without a quantity", text: "Deal 1 order karna hai", language: "roman_urdu", test: (u) => u.items.length === 1 && /deal\s*1\b/i.test(u.items[0].query) && u.items[0].qty === 1 },
  { name: "numbered deal flavour count describes one pizza", text: "Add one two flavor long pizza with BBQ and Pepperoni", test: (u) => u.items.length === 1 && /two[ -]?flavou?r|2[ -]?flavou?r/i.test(u.items[0].query) && u.items[0].qty === 1 && /bbq/i.test(u.items[0].notes ?? "") && /pepperoni/i.test(u.items[0].notes ?? "") },
  { name: "incident fries availability after cancellation", text: "Fries hain?", language: "roman_urdu", stage: "browsing",
    history: [{ role: "user", content: "Cancel krdo" }, { role: "assistant", content: "Order cancel ho gaya." }],
    test: (u) => u.intents.includes("ask_item_info") && !u.items.length && !u.removals.length },
  { name: "incident ETA after confirmation", text: "Kitna time lge ga?", language: "roman_urdu", stage: "placed",
    history: [{ role: "assistant", content: "Order #2 confirmed. Estimated delivery ~40 mins." }],
    test: (u) => (u.intents.includes("ask_delivery_info") || u.intents.includes("order_status")) && !u.items.length },
  { name: "production pizza and shake message retains both portions and delivery", text: "Ek bbq pizza or aik milkshake deliver kr dain", language: "roman_urdu",
    test: (u) => u.items.length === 2 && u.items.some((i) => /bbq.*pizza/i.test(i.query)) && u.items.some((i) => /milkshake/i.test(i.query)) && u.order_type === "delivery" },
  { name: "several questions plus an order keep independent answers", text: "Add 2 naan. Chicken tikka ka rate? Fajita pizza available? Delivery fee aur delivery time? COD?", language: "roman_urdu",
    test: (u) => u.items.some((i) => /naan/i.test(i.query) && i.qty === 2) && u.questions.length >= 4 && u.questions.filter((q) => q.intent === "ask_item_info").length >= 2 && u.questions.some((q) => q.intent === "ask_delivery_info") && u.questions.some((q) => q.intent === "ask_payment") },
  { name: "an unknown item cannot erase a second requested dish", text: "2 sushi aur 3 naan bhej do", language: "roman_urdu",
    test: (u) => u.items.length === 2 && u.items.some((i) => /sushi/i.test(i.query) && i.qty === 2) && u.items.some((i) => /naan/i.test(i.query) && i.qty === 3) },
  { name: "English multi-item order", text: "Please add 2 chicken biryani and 3 plain naan", test: (u) => u.intents.includes("add_items") && u.items.length === 2 && u.items.some((i) => i.qty === 3) },
  { name: "Roman Urdu complete delivery", text: "2 zinger burger aur ek naan, delivery karwa do House 12 Street 4 Gulberg Lahore, rider gate pe call kare", language: "roman_urdu", test: (u) => u.items.length === 2 && u.order_type === "delivery" && !!u.address && !!u.notes },
  { name: "Urdu script quantities and preparation", text: "دو ہاف چکن کڑاہی کم مرچ کے ساتھ اور تین نان چاہیے", test: (u) => u.items.length >= 2 && u.items.some((i) => i.qty === 2 && /half/i.test(i.size ?? "") && !!i.notes) && u.language === "roman_urdu" },
  { name: "Roman Pashto order", text: "Za dwa chicken tikka ghwaram, yaw naan hum rakawa", language: "pashto", test: (u) => u.intents.includes("add_items") && u.items.some((i) => i.qty === 2) && u.items.every((i) => !i.notes) && u.language === "pashto" },
  { name: "price inquiry cannot add food", text: "Full chicken karahi ka rate kya hai?", test: (u) => !u.items.length && u.intents.includes("ask_item_info") },
  { name: "coverage inquiry cannot select a destination", text: "Do you deliver to DHA Phase 5?", test: (u) => u.intents.includes("ask_delivery_info") && !u.address && !u.order_type && !u.items.length },
  { name: "correction preserves direction", text: "zinger nahi, biryani chahiye", cart: [item("Zinger Burger")], test: (u) => u.intents.includes("remove_items") && u.intents.includes("add_items") && /zinger/i.test(u.removals[0]?.query ?? "") && /biryani/i.test(u.items[0]?.query ?? "") },
  { name: "preparation update is not another portion", text: "chicken karahi mein mirch kam rakhna", cart: [item("Chicken Karahi (Full)", 2)], test: (u) => u.items.some((i) => i.qty === null && !!i.notes) },
  { name: "add plus another item's price question", text: "Add two naan and tell me the price of chicken tikka", test: (u) => u.intents.includes("add_items") && u.intents.includes("ask_item_info") && u.items.some((i) => /naan/i.test(i.query) && i.qty === 2) && !!u.info_query },
  { name: "acknowledgment uses the last assistant question", text: "haan", stage: "building_cart", cart: [item("Plain Naan", 2)], history: [{ role: "assistant", content: "Would you like to see our drinks menu?" }], test: (u) => u.primary_intent === "affirm" && !u.items.length && !u.intents.includes("confirm_order") },
  { name: "dine-in details preserve guests and time", text: "Dine in for 4 people tomorrow at 8pm", test: (u) => u.order_type === "dine-in" && u.guests === 4 && /tomorrow|2026|2027/i.test(u.reservation_time ?? "") },
  { name: "explicit staff handoff", text: "kisi insaan se baat karwao please", test: (u) => u.wants_human && u.intents.includes("human_request") },
  { name: "generic drink must remain unsized", text: "Ek egg burger or aik drink deliver krdo", language: "roman_urdu", test: (u) => u.items.length === 2 && u.items.some((i) => /drink/i.test(i.query) && !i.size && !/\d|liter|litre|ml/i.test(i.query)) && u.order_type === "delivery" },
  { name: "shawarma addition cannot copy historical food or fulfillment", text: "Ek chicken shawarma. Bhi add krdain", language: "roman_urdu", stage: "confirming", cart: [item("Lapeta Egg Burger"), item("1.5 Liter Drink")], history: deliveryHistory, fulfillment,
    test: (u) => u.items.length === 1 && /chicken.*shawarma/i.test(u.items[0].query) && u.items[0].qty === 1 && !u.address && !u.order_type },
  { name: "old address cannot replay the historical cart", text: "Old address", language: "roman_urdu", stage: "collecting_delivery", cart: [item("Lapeta Egg Burger"), item("1.5 Liter Drink"), item("Chicken Shawarma")], fulfillment,
    history: [...deliveryHistory, { role: "user", content: "Ek chicken shawarma. Bhi add krdain" }, { role: "assistant", content: "Please send your complete delivery address." }],
    test: (u) => u.intents.includes("use_saved_address") && !u.items.length && !u.removals.length && !u.address },
  { name: "polite saved-address reference is a slot request only", text: "Please use the address from my previous delivery", language: "english", stage: "collecting_delivery", cart: [item("Lapeta Egg Burger")], history: deliveryHistory,
    test: (u) => u.intents.includes("use_saved_address") && !u.items.length && !u.address },
  { name: "a new typed destination cannot re-add historical food", text: "House 80 Street 12 Sector B", language: "roman_urdu", stage: "collecting_delivery", cart: [item("Lapeta Egg Burger"), item("1.5 Liter Drink")], history: deliveryHistory, fulfillment,
    test: (u) => u.intents.includes("provide_address") && !!u.address && !u.items.length && !u.removals.length },
  { name: "explicit extra portion remains an addition despite history", text: "Ek aur egg burger bhi add krdo", language: "roman_urdu", stage: "confirming", cart: [item("Lapeta Egg Burger"), item("1.5 Liter Drink")], history: deliveryHistory, fulfillment,
    test: (u) => u.intents.includes("add_items") && u.items.length === 1 && /egg.*burger/i.test(u.items[0].query) && u.items[0].qty === 1 && !u.address && !u.order_type },
];
let failures = 0;
const times = [];
const selectedCases = process.env.LIVE_NLU_FILTER ? cases.filter((c) => c.name.includes(process.env.LIVE_NLU_FILTER)) : cases;
assert.ok(selectedCases.length, "No matching live NLU cases");
for (const [index, c] of selectedCases.entries()) {
  if (index) await new Promise((resolve) => setTimeout(resolve, Number(process.env.LIVE_NLU_PAUSE_MS) || 15_000));
  const started = Date.now();
  const u = await understandTurn({ conversationId: `synthetic-${index}`, messageText: c.text,
    language: c.language ?? "english", stage: c.stage ?? "browsing", cart: c.cart ?? [], history: c.history ?? [], fulfillment: c.fulfillment });
  const elapsed = Date.now() - started;
  times.push(elapsed);
  const passed = c.test(u);
  if (!passed) failures++;
  console.log(`${passed ? "PASS" : "FAIL"}: ${c.name} (${elapsed}ms) ${JSON.stringify(u)}`);
}
times.sort((a, b) => a - b);
console.log(`LIVE ORDER UNDERSTANDING: ${selectedCases.length - failures}/${selectedCases.length} passed; median ${times[Math.floor(times.length / 2)]}ms.`);
assert.equal(failures, 0, `${failures} live language understanding cases failed`);
