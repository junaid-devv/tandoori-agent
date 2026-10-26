/** Synthetic NLU-only evaluation. Uses configured provider, never DB/WhatsApp. */
import assert from "node:assert/strict";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local", quiet: true });
const { understandTurn } = await import("../lib/agent/nlu.ts");
const item = (name, qty = 1) => ({ name, qty });
const cases = [
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
];
let failures = 0;
const times = [];
for (const [index, c] of cases.entries()) {
  if (index) await new Promise((resolve) => setTimeout(resolve, Number(process.env.LIVE_NLU_PAUSE_MS) || 15_000));
  const started = Date.now();
  const u = await understandTurn({ conversationId: `synthetic-${index}`, messageText: c.text,
    language: c.language ?? "english", stage: c.stage ?? "browsing", cart: c.cart ?? [], history: c.history ?? [] });
  const elapsed = Date.now() - started;
  times.push(elapsed);
  const passed = c.test(u);
  if (!passed) failures++;
  console.log(`${passed ? "PASS" : "FAIL"}: ${c.name} (${elapsed}ms) ${JSON.stringify(u)}`);
}
times.sort((a, b) => a - b);
console.log(`LIVE ORDER UNDERSTANDING: ${cases.length - failures}/${cases.length} passed; median ${times[Math.floor(times.length / 2)]}ms.`);
assert.equal(failures, 0, `${failures} live language understanding cases failed`);
