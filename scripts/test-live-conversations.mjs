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
    // SCENARIO 1: Daniyal — Casual Roman Urdu, Typos, Multi-Item & DHA Delivery
    // -------------------------------------------------------------------------
    {
      persona: "Daniyal",
      phone: "+923009990001",
      turns: [
        "Aoa bhai, 1 chicken handi creamy aur 2 roghni nan chahiye",
        "ek raita b sath daal do",
        "delivery krdo DHA phase 2 sector B house 45",
        "Confirm ✓",
        "bohat shukriya zabardast service",
      ],
    },

    // -------------------------------------------------------------------------
    // SCENARIO 2: Zeeshan — Mind Changing: Quantity & Switching Pickup to Delivery
    // -------------------------------------------------------------------------
    {
      persona: "Zeeshan",
      phone: "+923009990002",
      turns: [
        "2 chicken karahi half pickup krna hai 9:30 pm",
        "wait 2 nahi sirf 1 kar do",
        "No delivery is fine, Model Town flat 3 street 12 pe bhej do",
        "Confirm ✓",
        "Thank you",
      ],
    },

    // -------------------------------------------------------------------------
    // SCENARIO 3: Ayesha — Out-of-Menu Query & Dine-In Table Booking
    // -------------------------------------------------------------------------
    {
      persona: "Ayesha",
      phone: "+923009990003",
      turns: [
        "Assalam o Alaikum, 1 chicken multani handi aur 1 garlic naan",
        "kya aap ke pas pizza ya burger b hai?",
        "chalo 4 logo ke liye table book krdo 8:30 pm pe dine in",
        "Confirm ✓",
        "Welcome",
      ],
    },

    // -------------------------------------------------------------------------
    // SCENARIO 4: Kamran — Disambiguation & Single Word Selection
    // -------------------------------------------------------------------------
    {
      persona: "Kamran",
      phone: "+923009990004",
      turns: [
        "karahi",
        "Chicken Karahi (Half)",
        "2 plain naan",
        "delivery Askari 10 flat 8",
        "Confirm ✓",
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

    // Reset state
    await stateRepo.patch(convId, { ...getDefaultState(convId), preferred_language: "roman_urdu" });

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

      // 2. Load latest state
      const state = await stateRepo.ensure(convId, { preferred_language: "roman_urdu" });

      // 3. Execute turn through live pipeline
      const turnResult = await runTurn({
        messageText: userText,
        state,
        branchId: branch.id,
        conversationId: convId,
        sourceUserMessageId: userMsg.id,
        appName: "ORDERiQ",
        currency: "Rs.",
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
