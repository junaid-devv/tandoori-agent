/**
 * scripts/run-pakistani-persona-scenarios.mjs
 *
 * Comprehensive simulation battery of 7 distinct Pakistani customer personas
 * covering:
 * - Slang, Roman Urdu, Urdu script, mixed English-Urdu
 * - Typos and informal abbreviations
 * - Multi-intent & compound messages
 * - Mid-order mind changes (sizes, quantities, switching delivery <-> pickup)
 * - Non-linear questions asked during checkout
 * - Out-of-menu items gracefully handled
 * - Exact item resolution (e.g. Raita vs Mint Raita) vs dish disambiguation
 * - Delivery area validations & unrestricted delivery
 * - Post-order flow (compliments, status checks)
 * - Human escalations
 */
import { nextTransition } from "../lib/agent/state-machine.ts";
import { executeTurn } from "../lib/agent/executor.ts";
import { resolveItemDetailed } from "../lib/menu/search.ts";
import { inferLanguagePreference } from "../lib/core/lang-detect.ts";
import { orderRepo } from "../lib/data/order.repo.ts";

// Mock order repository for deterministic offline testing
orderRepo.place = async () => "test-order-uuid-101";
orderRepo.getById = async (id) => ({
  id,
  order_number: 109,
  type: "delivery",
  status: "pending",
  subtotal: 3130,
  delivery_fee: 100,
  total: 3230,
});

const mockMenu = [
  { id: "m-ch-handi-1", name: "CHICKEN HANDI (BONELESS)", price: 2595, category: "Pakistani Cuisine (chicken)", is_available: true },
  { id: "m-ch-handi-2", name: "CHICKEN CREAMY HANDI (BONELESS)", price: 2595, category: "Pakistani Cuisine (chicken)", is_available: true },
  { id: "m-ch-handi-3", name: "CHICKEN MULTANI HANDI", price: 2645, category: "Pakistani Cuisine (chicken)", is_available: true },
  { id: "m-ch-karahi-h", name: "CHICKEN KARAHI (HALF)", price: 1395, category: "Pakistani Cuisine (chicken)", is_available: true },
  { id: "m-ch-karahi-f", name: "CHICKEN KARAHI (FULL)", price: 2495, category: "Pakistani Cuisine (chicken)", is_available: true },
  { id: "m-mut-karahi-h", name: "MUTTON KARAHI (HALF)", price: 2195, category: "Pakistani Cuisine (mutton)", is_available: true },
  { id: "m-mut-karahi-f", name: "MUTTON KARAHI (FULL)", price: 3995, category: "Pakistani Cuisine (mutton)", is_available: true },
  { id: "m-bbq-tikka", name: "CHICKEN TIKKA", price: 450, category: "BBQ", is_available: true },
  { id: "m-bbq-seekh", name: "SEEKH KABAB (4 PCS)", price: 650, category: "BBQ", is_available: true },
  { id: "m-bbq-malai", name: "CHICKEN MALAI BOTI", price: 750, category: "BBQ", is_available: true },
  { id: "m-salad-green", name: "FRESH GREEN SALAD", price: 425, category: "Salads", is_available: true },
  { id: "m-salad-russian", name: "RUSSIAN SALAD", price: 995, category: "Salads", is_available: true },
  { id: "m-salad-raita", name: "RAITA", price: 295, category: "Salads", is_available: true },
  { id: "m-salad-mint-raita", name: "MINT RAITA", price: 330, category: "Salads", is_available: true },
  { id: "m-naan-roghni", name: "ROGHNI NAAN", price: 120, category: "Bread & Tandoor", is_available: true },
  { id: "m-naan-garlic", name: "GARLIC NAAN", price: 140, category: "Bread & Tandoor", is_available: true },
  { id: "m-naan-plain", name: "PLAIN NAAN", price: 60, category: "Bread & Tandoor", is_available: true },
];

const mockSettings = {
  is_accepting_orders: true,
  opening_time: "11:00 AM",
  closing_time: "2:00 AM",
  delivery_enabled: true,
  delivery_fee: 100,
  min_delivery_amount: 500,
  delivery_areas: ["DHA Phase 1-6", "Gulberg", "Model Town", "Garden Town", "Askari 10"],
  estimated_prep_minutes: 30,
  estimated_delivery_minutes: 45,
  city: "Lahore",
  phone_delivery: "042-111-222-333",
  phone_dine_in: "042-111-222-334",
  ai_personality: "Warm & Professional",
};

let totalPassed = 0;
let totalFailed = 0;

function createSession(phone, customerName) {
  let state = {
    preferred_language: "roman_urdu",
    stage: "greeting",
    cart: [],
    order_type: null,
    address: null,
    dinein_guests: null,
    dinein_time: null,
    pickup_time: null,
    upsell_offered: false,
    last_shown_options: [],
    last_shown_options_at: null,
    last_shown_category: null,
    last_error: null,
  };

  return {
    phone,
    customerName,
    state,
    async sendTurn(userText, simulatedUnderstanding) {
      const view = {
        stage: state.stage,
        cart: [...state.cart],
        order_type: state.order_type,
        has_address: Boolean(state.address),
        has_dinein_details: Boolean(state.dinein_guests && state.dinein_time),
        has_pickup_time: Boolean(state.pickup_time),
        upsell_offered: state.upsell_offered,
        awaiting_selection: state.last_shown_options.length > 0,
      };

      const lang = simulatedUnderstanding.language || state.preferred_language;
      const transition = nextTransition(view, simulatedUnderstanding);
      
      const turnResult = await executeTurn({
        transition,
        understanding: simulatedUnderstanding,
        ctx: {
          state,
          view,
          settings: mockSettings,
          menu: mockMenu,
          isOpenNow: true,
        },
        branchId: "branch-test",
        conversationId: `conv-${phone}`,
        sourceUserMessageId: `msg-${Date.now()}-${Math.random()}`,
        appName: "ORDERiQ",
        currency: "Rs.",
      });

      // Apply patch to session state
      Object.assign(state, turnResult.statePatch);
      if (turnResult.statePatch.cart) {
        state.cart = turnResult.statePatch.cart;
      }
      if (turnResult.statePatch.stage) {
        state.stage = turnResult.statePatch.stage;
      }

      return {
        userText,
        reply: turnResult.replyText,
        stage: state.stage,
        cart: state.cart,
        escalated: turnResult.escalate,
      };
    },
  };
}

async function runBattery() {
  console.log("================================================================================");
  console.log("🚀 STARTING COMPREHENSIVE PAKISTANI PERSONA TEST BATTERY");
  console.log("================================================================================\n");

  // ------------------------------------------------------------------------------------------------
  // PERSONA 1: Tariq (+923001234567) - Casual Roman Urdu, item additions, exact raita, DHA delivery
  // ------------------------------------------------------------------------------------------------
  console.log("📌 PERSONA 1: Tariq (+923001234567) — Casual Roman Urdu, Exact Items & Order");
  const s1 = createSession("923001234567", "Tariq");

  // Turn 1
  let res = await s1.sendTurn("Aoa bhai menu me kia he?", {
    intents: ["browse_menu"],
    primary_intent: "browse_menu",
    language: "roman_urdu",
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
  });
  console.log(`[Turn 1] Tariq: "${res.userText}"\nBot: ${res.reply}\n`);

  // Turn 2: Add 1 Chicken Creamy Handi + 2 Roghni Naan
  res = await s1.sendTurn("1 chicken handi creamy aur 2 roghni nan krdo", {
    intents: ["add_items"],
    primary_intent: "add_items",
    language: "roman_urdu",
    items: [
      { query: "chicken handi creamy", qty: 1, size: null, addons: [], notes: null },
      { query: "roghni nan", qty: 2, size: null, addons: [], notes: null },
    ],
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
  });
  console.log(`[Turn 2] Tariq: "${res.userText}"\nBot: ${res.reply}\n`);
  if (s1.state.cart.length === 2 && s1.state.cart.some(i => i.name.includes("CREAMY HANDI"))) {
    console.log("  ✅ Added Creamy Handi & Roghni Naan accurately!");
    totalPassed++;
  } else {
    console.error("  ❌ Failed to add handi and naan properly!");
    totalFailed++;
  }

  // Turn 3: Add exact Raita
  res = await s1.sendTurn("ek raita b daal do", {
    intents: ["add_items"],
    primary_intent: "add_items",
    language: "roman_urdu",
    items: [{ query: "raita", qty: 1, size: null, addons: [], notes: null }],
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
  });
  console.log(`[Turn 3] Tariq: "${res.userText}"\nBot: ${res.reply}\n`);
  if (s1.state.cart.some(i => i.name === "RAITA")) {
    console.log("  ✅ RAITA resolved directly without disambiguation loop!");
    totalPassed++;
  } else {
    console.error("  ❌ RAITA exact resolution failed!");
    totalFailed++;
  }

  // Turn 4: Provide delivery address
  res = await s1.sendTurn("delivery krdo DHA phase 5 house 14 st 2", {
    intents: ["set_order_type", "provide_address"],
    primary_intent: "provide_address",
    language: "roman_urdu",
    items: [],
    removals: [],
    order_type: "delivery",
    address: "DHA phase 5 house 14 st 2",
    guests: null,
    reservation_time: null,
    pickup_time: null,
    info_query: null,
    sentiment: "neutral",
    wants_human: false,
    notes: null,
  });
  console.log(`[Turn 4] Tariq: "${res.userText}"\nBot: ${res.reply}\n`);
  if (res.stage === "confirming") {
    console.log("  ✅ Advanced directly to order summary with confirmation button!");
    totalPassed++;
  } else {
    console.error("  ❌ Stage was not confirming:", res.stage);
    totalFailed++;
  }

  // Turn 5: Confirm
  res = await s1.sendTurn("Confirm ✓", {
    intents: ["confirm_order"],
    primary_intent: "confirm_order",
    language: "roman_urdu",
    items: [],
    removals: [],
    order_type: null,
    address: null,
    guests: null,
    reservation_time: null,
    pickup_time: null,
    info_query: null,
    sentiment: "calm",
    wants_human: false,
    notes: "fast_path_confirm",
  });
  console.log(`[Turn 5] Tariq: "${res.userText}"\nBot: ${res.reply}\n`);
  if (res.stage === "placed" || res.reply.includes("Order #")) {
    console.log("  ✅ Order placed successfully!");
    totalPassed++;
  } else {
    console.error("  ❌ Order placement failed!");
    totalFailed++;
  }

  // Turn 6: Compliment / Shukriya
  res = await s1.sendTurn("bohat shukriya bhai", {
    intents: ["smalltalk"],
    primary_intent: "smalltalk",
    language: "roman_urdu",
    items: [],
    removals: [],
    order_type: null,
    address: null,
    guests: null,
    reservation_time: null,
    pickup_time: null,
    info_query: null,
    sentiment: "calm",
    wants_human: false,
    notes: "fast_path_smalltalk",
  });
  console.log(`[Turn 6] Tariq: "${res.userText}"\nBot: ${res.reply}\n`);
  if (res.reply.includes("Bohat shukriya") || res.reply.includes("order")) {
    console.log("  ✅ Post-order compliment acknowledged warmly!");
    totalPassed++;
  } else {
    console.error("  ❌ Compliment fallback error!");
    totalFailed++;
  }

  // ------------------------------------------------------------------------------------------------
  // PERSONA 2: Usman (+923019876543) - Mind Changer: Qty change, Size change, Delivery <-> Pickup
  // ------------------------------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("📌 PERSONA 2: Usman (+923019876543) — Mind Changes, Size & Fulfillment Swapping");
  const s2 = createSession("923019876543", "Usman");

  // Turn 1: 2 Full Karahi
  res = await s2.sendTurn("2 full chicken karahi deliver krdo model town", {
    intents: ["add_items", "set_order_type", "provide_address"],
    primary_intent: "add_items",
    language: "roman_urdu",
    items: [{ query: "chicken karahi", qty: 2, size: "full", addons: [], notes: null }],
    removals: [],
    order_type: "delivery",
    address: "Model Town",
    guests: null,
    reservation_time: null,
    pickup_time: null,
    info_query: null,
    sentiment: "neutral",
    wants_human: false,
    notes: null,
  });
  console.log(`[Turn 1] Usman: "${res.userText}"\nBot: ${res.reply}\n`);

  // Turn 2: "wait 2 nahi sirf 1 kar do" -> update quantity
  res = await s2.sendTurn("wait 2 nahi sirf 1 kar do", {
    intents: ["update_quantity"],
    primary_intent: "update_quantity",
    language: "roman_urdu",
    items: [{ query: "chicken karahi", qty: 1, size: "full", addons: [], notes: null }],
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
  });
  console.log(`[Turn 2] Usman: "${res.userText}"\nBot: ${res.reply}\n`);
  if (s2.state.cart.length === 1 && s2.state.cart[0].qty === 1) {
    console.log("  ✅ Quantity successfully updated to 1!");
    totalPassed++;
  } else {
    console.error("  ❌ Quantity update failed!");
    totalFailed++;
  }

  // Turn 3: "actually pickup krna hai 8:30 pm"
  res = await s2.sendTurn("actually pickup krna hai 8:30 pm", {
    intents: ["set_order_type", "provide_pickup_time"],
    primary_intent: "set_order_type",
    language: "roman_urdu",
    items: [],
    removals: [],
    order_type: "pickup",
    address: null,
    guests: null,
    reservation_time: null,
    pickup_time: "8:30 PM",
    info_query: null,
    sentiment: "neutral",
    wants_human: false,
    notes: null,
  });
  console.log(`[Turn 3] Usman: "${res.userText}"\nBot: ${res.reply}\n`);
  if (s2.state.order_type === "pickup") {
    console.log("  ✅ Switched from delivery to pickup smoothly!");
    totalPassed++;
  } else {
    console.error("  ❌ Order type switch to pickup failed!");
    totalFailed++;
  }

  // Turn 4: "No delivery is fine, model town flat 4 street 8 pe bhej do"
  res = await s2.sendTurn("No delivery is fine, model town flat 4 street 8 pe bhej do", {
    intents: ["set_order_type", "provide_address"],
    primary_intent: "set_order_type",
    language: "roman_urdu",
    items: [],
    removals: [],
    order_type: "delivery",
    address: "model town flat 4 street 8",
    guests: null,
    reservation_time: null,
    pickup_time: null,
    info_query: null,
    sentiment: "neutral",
    wants_human: false,
    notes: null,
  });
  console.log(`[Turn 4] Usman: "${res.userText}"\nBot: ${res.reply}\n`);
  if (s2.state.order_type === "delivery" && s2.state.stage === "confirming") {
    console.log("  ✅ Switched back to delivery and updated address to Model Town!");
    totalPassed++;
  } else {
    console.error("  ❌ Mind-change back to delivery failed!");
    totalFailed++;
  }

  // ------------------------------------------------------------------------------------------------
  // PERSONA 3: Hamza (+923214567890) - Disambiguation & Out-of-Menu Items
  // ------------------------------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("📌 PERSONA 3: Hamza (+923214567890) — Disambiguation & Missing Menu Items");
  const s3 = createSession("923214567890", "Hamza");

  // Turn 1: Broad "karahi chahiye"
  const karahiResolution = await resolveItemDetailed("branch-test", "karahi", null, mockMenu);
  console.log("Disambiguation check for 'karahi':", karahiResolution.kind);
  if (karahiResolution.kind === "ambiguous" || karahiResolution.kind === "variants") {
    console.log("  ✅ Correctly caught generic 'karahi' as needing disambiguation!");
    totalPassed++;
  } else {
    console.error("  ❌ Generic karahi was not caught as ambiguous!");
    totalFailed++;
  }

  // Turn 2: Non-existent item "pizza"
  const pizzaResolution = await resolveItemDetailed("branch-test", "pizza", null, mockMenu);
  console.log("Resolution check for 'pizza':", pizzaResolution.kind);
  if (pizzaResolution.kind === "not_found") {
    console.log("  ✅ Correctly identified pizza as not on the menu!");
    totalPassed++;
  } else {
    console.error("  ❌ Non-menu item pizza was mistakenly matched!");
    totalFailed++;
  }

  // ------------------------------------------------------------------------------------------------
  // PERSONA 4: Fatima (+923331122334) - Urdu Script & Mid-Checkout Inquiries
  // ------------------------------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("📌 PERSONA 4: Fatima (+923331122334) — Urdu Script & Mid-Checkout Inquiries");
  const s4 = createSession("923331122334", "Fatima");

  const urduGreeting = "السلام علیکم! مینیو دکھائیں";
  const detectedLang = inferLanguagePreference(urduGreeting);
  console.log(`Language detection for '${urduGreeting}':`, detectedLang);
  if (detectedLang === "roman_urdu") {
    console.log("  ✅ Urdu script normalized and directed to Urdu/Roman Urdu responder!");
    totalPassed++;
  } else {
    console.error("  ❌ Urdu script detection failed!");
    totalFailed++;
  }

  // Add item
  res = await s4.sendTurn("ایک چکن ہانڈی اور دو نان", {
    intents: ["add_items"],
    primary_intent: "add_items",
    language: "roman_urdu",
    items: [
      { query: "chicken handi", qty: 1, size: null, addons: [], notes: null },
      { query: "plain naan", qty: 2, size: null, addons: [], notes: null },
    ],
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
  });

  // Turn 3: Inquire about timings during checkout (non-linear without resetting cart)
  res = await s4.sendTurn("کھانا کتنی دیر میں تیار ہوگا؟", {
    intents: ["ask_delivery_info"],
    primary_intent: "ask_delivery_info",
    language: "roman_urdu",
    items: [],
    removals: [],
    order_type: null,
    address: null,
    guests: null,
    reservation_time: null,
    pickup_time: null,
    info_query: "preparation time",
    sentiment: "neutral",
    wants_human: false,
    notes: null,
  });
  console.log(`[Turn 3] Fatima: "${res.userText}"\nBot: ${res.reply}\n`);
  if (s4.state.cart.length === 2) {
    console.log("  ✅ Cart preserved safely when non-linear question was asked!");
    totalPassed++;
  } else {
    console.error("  ❌ Cart was lost during non-linear question!");
    totalFailed++;
  }

  // ------------------------------------------------------------------------------------------------
  // PERSONA 5: Bilal (+923455544332) - Out-of-Area Delivery Restriction
  // ------------------------------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("📌 PERSONA 5: Bilal (+923455544332) — Out-of-Area Delivery Check");
  const s5 = createSession("923455544332", "Bilal");

  // Add Handi
  await s5.sendTurn("1 chicken multani handi", {
    intents: ["add_items"],
    primary_intent: "add_items",
    language: "roman_urdu",
    items: [{ query: "chicken multani handi", qty: 1, size: null, addons: [], notes: null }],
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
  });

  // Provide out-of-area address: "Township"
  res = await s5.sendTurn("deliver to Pech phase 2 Township", {
    intents: ["provide_address"],
    primary_intent: "provide_address",
    language: "roman_urdu",
    items: [],
    removals: [],
    order_type: "delivery",
    address: "Pech phase 2 Township",
    guests: null,
    reservation_time: null,
    pickup_time: null,
    info_query: null,
    sentiment: "neutral",
    wants_human: false,
    notes: null,
  });
  console.log(`[Turn 2] Bilal: "${res.userText}"\nBot: ${res.reply}\n`);
  if (res.reply.includes("delivery area mein nahi hai") || res.reply.includes("delivery zone")) {
    console.log("  ✅ Correctly detected out-of-area address and prompted for alternate/pickup!");
    totalPassed++;
  } else {
    console.error("  ❌ Out of area address was not blocked!");
    totalFailed++;
  }

  // ------------------------------------------------------------------------------------------------
  // PERSONA 6: Zainab (+923087766554) - Human Agent Escalation
  // ------------------------------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("📌 PERSONA 6: Zainab (+923087766554) — Human Escalation");
  const s6 = createSession("923087766554", "Zainab");

  res = await s6.sendTurn("kisi insaan ya manager se baat karwao", {
    intents: ["human_request"],
    primary_intent: "human_request",
    language: "roman_urdu",
    items: [],
    removals: [],
    order_type: null,
    address: null,
    guests: null,
    reservation_time: null,
    pickup_time: null,
    info_query: null,
    sentiment: "frustrated",
    wants_human: true,
    notes: null,
  });
  console.log(`[Turn 1] Zainab: "${res.userText}"\nBot: ${res.reply}\n`);
  if (res.escalated) {
    console.log("  ✅ Successfully escalated to human staff!");
    totalPassed++;
  } else {
    console.error("  ❌ Human escalation failed!");
    totalFailed++;
  }

  // ------------------------------------------------------------------------------------------------
  // PERSONA 7: Shahbaz (+923129988776) - Order Status & Politeness
  // ------------------------------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("📌 PERSONA 7: Shahbaz (+923129988776) — Order Status & Polite Feedback");
  const s7 = createSession("923129988776", "Shahbaz");

  res = await s7.sendTurn("Order status kya hai?", {
    intents: ["order_status"],
    primary_intent: "order_status",
    language: "roman_urdu",
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
  });
  console.log(`[Turn 1] Shahbaz: "${res.userText}"\nBot: ${res.reply}\n`);
  if (res.reply.includes("Order") || res.reply.includes("recent order")) {
    console.log("  ✅ Order status check handled cleanly!");
    totalPassed++;
  } else {
    console.error("  ❌ Order status check failed!");
    totalFailed++;
  }

  console.log("\n================================================================================");
  console.log(`📊 TEST BATTERY SUMMARY: ${totalPassed} PASSED, ${totalFailed} FAILED`);
  console.log("================================================================================\n");

  if (totalFailed > 0) {
    throw new Error(`Test suite completed with ${totalFailed} failure(s).`);
  }
}

runBattery();
