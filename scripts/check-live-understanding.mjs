/**
 * Live smoke test: replays the exact failing screenshot messages through the
 * REAL NLU (claude-sonnet-5) + REAL grounded answer layer (against a small
 * in-memory menu), to prove they no longer produce "not on the menu" garbage.
 *
 * Run: node --no-warnings --import ./scripts/alias-register.mjs --experimental-strip-types scripts/check-live-understanding.mjs
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { understandTurn } from "../lib/agent/nlu.ts";
import { groundedAnswer } from "../lib/agent/answer.ts";

const MENU = [
  { id: "1", name: "Chicken Biryani", price: 350, category: "Rice", is_available: true },
  { id: "2", name: "Zinger Burger", price: 450, category: "Burgers", is_available: true },
  { id: "3", name: "Gulab Jamun", price: 200, category: "Desserts", is_available: true },
  { id: "4", name: "Kheer", price: 180, category: "Desserts", is_available: true },
  { id: "5", name: "Chicken Karahi", price: 900, category: "Desi", is_available: true },
];
const SETTINGS = {
  branch_id: "b1", is_accepting_orders: true, opening_time: "12:00 PM", closing_time: "11:00 PM",
  min_delivery_amount: 500, delivery_enabled: true, delivery_fee: 100,
  delivery_areas: ["DHA", "Gulberg"], estimated_prep_minutes: 25, estimated_delivery_minutes: 40,
  city: "Lahore", phone_delivery: "0300-1234567", phone_dine_in: "042-111222", ai_personality: "Warm", timezone: "Asia/Karachi",
};

const CASES = [
  { msg: "Restaurant open kb hota hai", wantIntent: ["ask_hours_or_location", "general_question"] },
  { msg: "Meethe main kia hai", wantIntent: ["ask_item_info", "browse_menu", "general_question"] },
  { msg: "Best item konsa available hai", wantIntent: ["ask_recommendation", "ask_item_info"] },
  { msg: "Delivery available hai?", wantIntent: ["ask_delivery_info", "general_question"] },
];

const BAD = /isn'?t on the menu|not on the menu|menu me nahi|didn'?t (quite )?get that|samajh nahi/i;

let failures = 0;
for (const c of CASES) {
  const u = await understandTurn({ messageText: c.msg, language: "roman_urdu", stage: "browsing", cart: [] });
  const intentOk = c.wantIntent.includes(u.primary_intent) || u.intents.some((i) => c.wantIntent.includes(i));
  const ans = await groundedAnswer({
    question: u.info_query || c.msg, language: u.language, appName: "Test Dhaba", currency: "Rs.",
    settings: SETTINGS, menu: MENU, isOpenNow: true,
  });
  const answerOk = ans && !BAD.test(ans);
  const ok = intentOk && answerOk;
  if (!ok) failures++;
  console.log(`\n[${ok ? "PASS" : "FAIL"}] "${c.msg}"`);
  console.log(`   intent=${u.primary_intent} (${u.intents.join(",")}) info_query="${u.info_query ?? ""}"`);
  console.log(`   answer: ${ans ? ans.replace(/\n/g, " ") : "(null)"}`);
  if (!intentOk) console.log(`   ✗ intent not in ${JSON.stringify(c.wantIntent)}`);
  if (!answerOk) console.log(`   ✗ answer empty or contains dead-end phrasing`);
}

console.log(`\n${failures ? `LIVE CHECK FAILED: ${failures}` : "LIVE UNDERSTANDING CHECK PASSED ✅"}`);
process.exit(failures ? 1 : 0);
