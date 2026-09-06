// =============================================================================
// SARHAD UNIVERSITY ADMISSIONS BOT — VERIFICATION SUITE
// Tests Fast-Path Intents, Interactive Buttons, Roman Urdu AI Counselor, & CRM Leads
// =============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { detectUniversityFastPath } from "../lib/university/intents.ts";
import { askUniversityCounselorAI } from "../lib/university/counselor-ai.ts";
import { SARHAD_UNIVERSITY_INFO, getDaysRemainingUntilDeadline } from "../lib/university/knowledge-base.ts";

let passedCount = 0;
let totalCount = 0;

function assert(condition, message) {
  totalCount += 1;
  if (condition) {
    passedCount += 1;
    console.log(`  ✅ PASS: ${message}`);
  } else {
    console.error(`  ❌ FAIL: ${message}`);
  }
}

async function runTests() {
  console.log("\n=======================================================");
  console.log("🎓 SARHAD UNIVERSITY DEC GILGIT BOT VERIFICATION");
  console.log("=======================================================\n");

  const daysLeft = getDaysRemainingUntilDeadline();
  console.log(`[INFO] Deadline: 10 September 2026 (${daysLeft} days remaining)`);
  console.log(`[INFO] Center: ${SARHAD_UNIVERSITY_INFO.centerLocation}\n`);

  // -------------------------------------------------------------------------
  // TEST SUITE 1: 0ms Fast-Path & Interactive Button Responses
  // -------------------------------------------------------------------------
  console.log("--- Suite 1: 0ms Fast-Path & Interactive Buttons ---");

  // 1. Ad Greeting
  const adGreeting = detectUniversityFastPath("Hi, I saw your ad for Sarhad University Fall 2026 Admissions");
  assert(adGreeting !== null, "Detects Meta Ad greeting");
  assert(adGreeting?.intent === "ad_greeting", "Sets intent to ad_greeting");
  assert(adGreeting?.replyButtons?.buttons?.length === 3, "Returns 3 quick-action interactive buttons");
  assert(adGreeting?.textReply.includes("10 September 2026"), "Mentions 10 September 2026 deadline");

  // 2. Program Offerings
  const progQuery = detectUniversityFastPath("btn:programs");
  assert(progQuery !== null, "Handles btn:programs button click");
  assert(progQuery?.textReply.includes("BBA") && progQuery?.textReply.includes("B.Ed"), "Lists BBA and B.Ed");
  assert(progQuery?.textReply.includes("English") && progQuery?.textReply.includes("Urdu"), "Lists English and Urdu");
  assert(progQuery?.textReply.includes("Education") && progQuery?.textReply.includes("Health & Physical Education"), "Lists Education and Health & Physical Education");

  // 3. Eligibility
  const eligQuery = detectUniversityFastPath("eligibility criteria kya hai?");
  assert(eligQuery !== null, "Detects eligibility inquiry");
  assert(eligQuery?.textReply.includes("45%"), "Mentions 45% minimum marks rule");
  assert(eligQuery?.textReply.includes("Associate Degree Program (ADP)") && eligQuery?.textReply.includes("2.5-Year BS"), "Explains ADP and 2.5-year BS pathways");

  // 4. Classes & Distance Learning
  const classQuery = detectUniversityFastPath("kya Sunday class attend karna lazmi hai? Main job karta hoon");
  assert(classQuery !== null, "Detects Sunday class and distance learning inquiry");
  assert(classQuery?.textReply.includes("OPTIONAL"), "Affirms Sunday physical classes are optional");
  assert(classQuery?.textReply.includes("LMS"), "Explains LMS recorded lectures for working professionals");

  // 5. DEC Gilgit Location
  const locQuery = detectUniversityFastPath("btn:location");
  assert(locQuery !== null, "Handles btn:location button click");
  assert(locQuery?.textReply.includes("Alam Public School & College, Jutial, Gilgit"), "Provides exact center address in Jutial Gilgit");

  // 6. Qualification Selection
  const faQual = detectUniversityFastPath("btn:qual_fa");
  assert(faQual !== null && faQual.extractedLeadData?.qualification === "FA/FSc", "Extracts FA/FSc qualification from button");

  const gradQual = detectUniversityFastPath("btn:qual_grad");
  assert(gradQual !== null && gradQual.extractedLeadData?.qualification === "Graduation (BA/BSc)", "Extracts Graduation qualification from button");
  assert(gradQual?.textReply.includes("2.5-Year BS Program"), "Explains 2.5-Year BS bridge degree for graduates");

  // -------------------------------------------------------------------------
  // TEST SUITE 2: Conversational AI Counselor (Multi-Turn Roman Urdu)
  // -------------------------------------------------------------------------
  console.log("\n--- Suite 2: Conversational AI Counselor & Scenario Handling ---");

  console.log("  [Testing LLM Scenario 1: Complex Student Query in Roman Urdu]...");
  const scenario1 = await askUniversityCounselorAI(
    "Salam! Mera naam Tariq Shah hai. Mere FSc pre-medical mein 50% marks hain, kya main BBA kar sakta hoon? Aur main teacher hoon to daily classes to nahi hongi na?",
    []
  );

  assert(scenario1.replyText.length > 50, "Counselor generated detailed conversational response");
  assert(
    scenario1.replyText.toLowerCase().includes("bba") || scenario1.replyText.toLowerCase().includes("adp"),
    "Counselor addressed BBA program inquiry"
  );
  assert(
    scenario1.replyText.toLowerCase().includes("lms") ||
    scenario1.replyText.toLowerCase().includes("recorded") ||
    scenario1.replyText.toLowerCase().includes("optional") ||
    scenario1.replyText.toLowerCase().includes("sunday"),
    "Counselor explained LMS recorded lectures and optional Sunday classes for teachers"
  );

  console.log(`\n  💬 AI Counselor Sample Response:\n  ${scenario1.replyText.slice(0, 300)}...\n`);

  if (scenario1.leadUpdate) {
    console.log(`  🎯 Extracted Lead Data:`, JSON.stringify(scenario1.leadUpdate, null, 2));
    assert(scenario1.leadUpdate.fullName === "Tariq Shah" || scenario1.leadUpdate.programInterest?.includes("BBA"), "Extracted lead name or program");
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log("\n=======================================================");
  console.log(`🏁 TEST RESULTS: ${passedCount} / ${totalCount} PASSED`);
  console.log("=======================================================\n");

  if (passedCount === totalCount) {
    console.log("🎉 ALL TESTS PASSED! The University Admissions Agent is verified and fully functional.\n");
    process.exit(0);
  } else {
    console.error("⚠️ Some tests failed. Please review the output above.\n");
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
