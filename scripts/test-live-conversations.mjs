/**
 * scripts/test-live-conversations.mjs
 *
 * Runs LIVE real multi-turn orders against the database and pipeline.
 * Creates contacts, conversations, processes real turns through runTurn / pipeline,
 * places live orders in Supabase, and outputs the detailed results.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { runTurn } from "../lib/agent/pipeline.ts";
import { contactRepo } from "../lib/data/contact.repo.ts";
import { conversationRepo } from "../lib/data/conversation.repo.ts";
import { stateRepo, getDefaultState } from "../lib/data/state.repo.ts";
import { messageRepo } from "../lib/data/message.repo.ts";
import { orderRepo } from "../lib/data/order.repo.ts";
import { getActiveBranches } from "../lib/branches.ts";
import { getMenuCatalog } from "../lib/menu.ts";
import { getRestaurantSettings } from "../lib/settings.ts";
import { supabaseAdmin } from "../lib/supabase-admin.ts";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runLiveTest() {
  console.log("================================================================================");
  console.log("🔥 STARTING LIVE END-TO-END PAKISTANI CONVERSATION & ORDER TESTING");
  console.log("================================================================================\n");

  const branches = await getActiveBranches();
  if (branches.length === 0) {
    throw new Error("No active branches found in database!");
  }
  const branch = branches[0];
  console.log(`🏢 Active Branch: ${branch.name} (${branch.id}) in ${branch.city}`);

  const menu = await getMenuCatalog(branch.id);
  console.log(`📋 Loaded ${menu.length} available menu items from database.`);

  const settings = await getRestaurantSettings(branch.id);
  console.log(`⚙️ Settings: Delivery=${settings.delivery_enabled ? "Enabled" : "Disabled"}, Fee=Rs. ${settings.delivery_fee}, Min=Rs. ${settings.min_delivery_amount}`);
  console.log(`📍 Configured Delivery Areas: ${settings.delivery_areas.length > 0 ? settings.delivery_areas.join(", ") : "Deliver Anywhere"}\n`);

  const scenarios = [
    // -------------------------------------------------------------------------
    // SCENARIO 1: Ahmed — Full Delivery Order (Multi-item Pizza + Side + Delivery)
    // -------------------------------------------------------------------------
    {
      persona: "Ahmed",
      phone: "+923001112233",
      turns: [
        "Aoa bhai, 1 Zinger Burger aur 1 Chicken Fajita 11\" chahiye",
        "1 Masala Fries Medium bhi add kardo",
        "delivery krdo Officers Colony Street 4 House 12 Wah Cantt",
        "Confirm ✓",
        "bohat shukriya",
      ],
    },

    // -------------------------------------------------------------------------
    // SCENARIO 2: Bilal — Deal Inquiry (I1 fix) + Add + Quantity Change + Pickup (H1 fix)
    // -------------------------------------------------------------------------
    {
      persona: "Bilal",
      phone: "+923214445566",
      turns: [
        "Deal 1 main kia hai?",
        "Acha 2 Deal 1 kardo",
        "Nahi 2 nahi sirf 1 kardo",
        "Pickup karna hai 10:30 pm",
        "Ok",
        "Confirm ✓",
      ],
    },

    // -------------------------------------------------------------------------
    // SCENARIO 3: Hamza — Variant Selection (Size) + Shawarma + Dine-In Booking
    // -------------------------------------------------------------------------
    {
      persona: "Hamza",
      phone: "+923337778899",
      turns: [
        "Tanduri Pizza chahiye",
        "13 inch",
        "aur 2 Chicken Shawarma bhi add kar do",
        "table book krdo 4 log 9:30 pm dine in",
        "Confirm ✓",
      ],
    },

    // -------------------------------------------------------------------------
    // SCENARIO 4: Usman — Pronoun Resolution (I2 fix) + Category Boost (H2 fix) + Delivery
    // -------------------------------------------------------------------------
    {
      persona: "Usman",
      phone: "+923458889900",
      turns: [
        "Zinger Burger chahiye",
        "Is main kia hai?",
        "Burger category mein aur kya hai?",
        "Tikka Boti Burger",
        "delivery krdo Model Town Wah Cantt",
        "Proceed to checkout",
        "Confirm ✓",
      ],
    },

    // -------------------------------------------------------------------------
    // SCENARIO 5: Saad — In-cart item query (H4 fix) + Delivery Confirmation
    // -------------------------------------------------------------------------
    {
      persona: "Saad",
      phone: "+923126667788",
      turns: [
        "1 Chicken Supreme 11\" add karo",
        "Chicken Supreme available hai?",
        "delivery krdo Sector A house 20 Wah",
        "haan confirm",
      ],
    },
  ];

  let totalScenariosPassed = 0;

  for (let sIdx = 0; sIdx < scenarios.length; sIdx++) {
    const sc = scenarios[sIdx];
    console.log(`\n================================================================================`);
    console.log(`🧪 [TEST ${sIdx + 1}/${scenarios.length}] Persona: ${sc.persona} (${sc.phone})`);
    console.log(`================================================================================`);

    // 1. Ensure contact & clean conversation
    const contact = await contactRepo.upsertByPhone({
      phone: sc.phone,
      name: sc.persona,
      active_branch_id: branch.id,
    });

    // Ensure clean conversation
    const conv = await conversationRepo.ensure({
      contactId: contact.id,
      branchId: branch.id,
      phone: sc.phone,
      name: sc.persona,
    });
    const convId = conv.id;

    // Reset state and previous test messages/orders for clean run
    await supabaseAdmin.from("messages").delete().eq("conversation_id", convId);
    await supabaseAdmin.from("orders").delete().eq("conversation_id", convId);
    await stateRepo.patch(convId, {
      ...getDefaultState(convId),
      preferred_language: "roman_urdu",
      cart: [],
      order_type: null,
      address: null,
      guests: null,
      reservation_time: null,
      pickup_time: null,
      stage: "greeting",
      upsell_offered: false,
      last_shown_options: [],
      last_shown_options_at: null,
      last_shown_category: null,
      pending_clarification: null,
    });

    let lastPlacedOrderId = null;

    for (let tIdx = 0; tIdx < sc.turns.length; tIdx++) {
      const userText = sc.turns[tIdx];
      console.log(`\n💬 Turn ${tIdx + 1} | ${sc.persona}: "${userText}"`);

      // 1. Persist inbound user message
      const userMsg = await messageRepo.insert({
        conversationId: convId,
        role: "user",
        senderKind: "user",
        content: userText,
      });

      // 2. Execute turn through live pipeline
      const turnResult = await runTurn({
        conversationId: convId,
        branchId: branch.id,
        phone: sc.phone,
        messageText: userText,
        sourceUserMessageId: userMsg.id,
        whatsappMessageId: userMsg.id,
        messageId: userMsg.id,
        appName: "ORDERiQ",
        currency: "Rs.",
        customerName: sc.persona,
      });

      // 4. Persist assistant reply
      await messageRepo.insert({
        conversationId: convId,
        role: "assistant",
        senderKind: "ai",
        content: turnResult.replyText,
      });

      console.log(`🤖 Agent (${turnResult.stage}):`);
      console.log(turnResult.replyText.split("\n").map(l => "   " + l).join("\n"));

      // Check if order was placed
      if (turnResult.replyText.includes("Order #") || turnResult.stage === "placed" || turnResult.placeOrder) {
        const match = turnResult.replyText.match(/Order #(\d+)/);
        const orderNum = match ? match[1] : "placed";
        console.log(`\n🎉 SUCCESS: Order #${orderNum} placed in live Supabase database!`);
        lastPlacedOrderId = orderNum;
      }

      await sleep(1200);
    }

    // Verify order in database
    const latestOrder = await orderRepo.getLatestForConversation(convId);
    if (latestOrder) {
      console.log(`\n📦 Database Order Record Verified:`);
      console.log(`   - Order ID: ${latestOrder.id}`);
      console.log(`   - Order Number: #${latestOrder.order_number}`);
      console.log(`   - Type: ${latestOrder.type}`);
      console.log(`   - Status: ${latestOrder.status}`);
      console.log(`   - Subtotal: Rs. ${latestOrder.subtotal}`);
      console.log(`   - Delivery Fee: Rs. ${latestOrder.delivery_fee}`);
      console.log(`   - Total: Rs. ${latestOrder.total}`);
      console.log(`   - Address: ${latestOrder.address || "N/A"}`);
      console.log(`   - Guests: ${latestOrder.guests || "N/A"}`);
      console.log(`   - Reservation Time: ${latestOrder.reservation_time || "N/A"}`);
      console.log(`   - Pickup Time: ${latestOrder.pickup_time || "N/A"}`);
      totalScenariosPassed++;
    } else {
      console.error(`\n❌ ERROR: No order record found for conversation ${convId}!`);
    }
  }

  console.log(`\n================================================================================`);
  console.log(`🏁 LIVE ORDER TEST RESULTS: ${totalScenariosPassed}/${scenarios.length} ORDERS PLACED & VERIFIED`);
  console.log(`================================================================================\n`);
}

runLiveTest().catch((err) => {
  console.error("FATAL TEST ERROR:", err);
  process.exit(1);
});
