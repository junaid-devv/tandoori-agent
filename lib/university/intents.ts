import {
  SARHAD_UNIVERSITY_INFO,
  getDaysRemainingUntilDeadline,
} from "./knowledge-base";
import type {
  WhatsAppInteractiveListPayload,
  WhatsAppReplyButtonPayload,
} from "../whatsapp";

export type UniversityIntentType =
  | "ad_greeting"
  | "ask_programs"
  | "ask_eligibility"
  | "ask_procedure"
  | "ask_classes_schedule"
  | "ask_location"
  | "ask_deadline"
  | "ask_fees"
  | "apply_register"
  | "human_counselor"
  | "complex_conversation";

export interface FastPathResult {
  intent: UniversityIntentType;
  textReply: string;
  replyButtons?: WhatsAppReplyButtonPayload | null;
  interactiveList?: WhatsAppInteractiveListPayload | null;
  extractedLeadData?: {
    program?: string;
    qualification?: string;
    percentageMarks?: number;
    name?: string;
  };
}

export function detectUniversityFastPath(userMessage: string, hasPriorMessages = false): FastPathResult | null {
  const raw = userMessage.trim().toLowerCase();
  const daysLeft = getDaysRemainingUntilDeadline();

  // 1. Interactive Button Clicks (Exact payload matches only)
  if (raw === "btn:programs") {
    return {
      intent: "ask_programs",
      textReply:
        `📚 *SARHAD UNIVERSITY – FALL 2026 PROGRAMS OFFERED*\n\n` +
        `DEC Alam Public School & College, Jutial, Gilgit mein mandrja-zail programs available hain:\n\n` +
        `1️⃣ *BBA* (Business Administration)\n` +
        `2️⃣ *B.Ed* (Bachelor of Education)\n` +
        `3️⃣ *English* (Literature & Linguistics)\n` +
        `4️⃣ *Education*\n` +
        `5️⃣ *Urdu*\n` +
        `6️⃣ *Health & Physical Education*\n\n` +
        `🎓 *Degree Options:*\n` +
        `• *After FA/FSc (Min 45%):* 2-Year Associate Degree (ADP) ya 4-Year BS\n` +
        `• *After Graduation (Min 45%):* 2.5-Year BS Bridge Program\n\n` +
        `🗓️ *Last Date:* 10 September 2026 (${daysLeft} din baqi hain!)\n\n` +
        `Aap kis program mein admission lena chahtay hain?`,
      replyButtons: {
        body: "Agla step select karein:",
        buttons: [
          { id: "btn:eligibility", title: "🎓 Eligibility" },
          { id: "btn:procedure", title: "📝 How to Apply" },
          { id: "btn:location", title: "📍 DEC Gilgit" },
        ],
      },
    };
  }

  if (raw === "btn:eligibility") {
    return {
      intent: "ask_eligibility",
      textReply:
        `✅ *SARHAD UNIVERSITY – ELIGIBILITY CRITERIA*\n\n` +
        `• *Minimum Requirement:* *45% Marks* in previous qualification.\n\n` +
        `🎓 *Degree Pathways:*\n` +
        `1️⃣ *FA / FSc / ICS / I.Com k baad:*\n` +
        `   • 2-Year Associate Degree (ADP) — Graduation equivalent\n` +
        `   • 4-Year BS Program\n\n` +
        `2️⃣ *2-Year Graduation (BA/BSc) k baad:*\n` +
        `   • 2.5-Year BS Program (16-year BS Honours degree)\n\n` +
        `Apni previous qualification (FA/FSc ya Graduation) aur percentage batayein taa k hum mazeed guide karein!`,
      replyButtons: {
        body: "Apni qualification select karein:",
        buttons: [
          { id: "btn:qual_fa", title: "1️⃣ FA / FSc" },
          { id: "btn:qual_grad", title: "2️⃣ Graduation" },
          { id: "btn:procedure", title: "📝 How to Apply" },
        ],
      },
    };
  }

  if (raw === "btn:procedure") {
    return {
      intent: "ask_procedure",
      textReply:
        `📝 *ADMISSION PROCEDURE (FALL 2026)*\n\n` +
        `1. Desired program select karein.\n` +
        `2. *DEC Alam Public School & College, Jutial, Gilgit* visit karein.\n` +
        `3. Educational documents (DMC, CNIC/B-form, Photos) submit karein.\n` +
        `4. Admission confirm hotay hi *LMS ID* mil jaye gi.\n` +
        `5. LMS par 24/7 recorded video lectures available hotay hain.\n` +
        `6. Course outline receive karein (har subject k ~25 prescribed topics).\n` +
        `7. Semester end par DEC Gilgit center mein 70-mark paper appear karein.\n\n` +
        `⏰ *Last Date:* 10 September 2026!`,
      replyButtons: {
        body: "Mazeed maloomat:",
        buttons: [
          { id: "btn:classes", title: "🏫 Sunday Classes" },
          { id: "btn:location", title: "📍 DEC Gilgit" },
          { id: "btn:programs", title: "📚 Programs" },
        ],
      },
    };
  }

  if (raw === "btn:classes") {
    return {
      intent: "ask_classes_schedule",
      textReply:
        `🏫 *CLASSES & DISTANCE LEARNING SYSTEM*\n\n` +
        `⭐ Ye distance learning program hai jo job holders aur teachers k liye ideal hai!\n\n` +
        `💻 *Online LMS:* Recorded lectures 24/7 available hotay hain. Aap apni marzi k waqt study kar saktay hain.\n\n` +
        `📌 *Sunday Classes:* DEC Alam Public School Jutial mein har Sunday physical classes hoti hain jo k *100% OPTIONAL* hain.\n\n` +
        `Aap bina Sunday attend kiye bhi pura degree program LMS k zariye mukamal kar saktay hain!`,
      replyButtons: {
        body: "Explore karein:",
        buttons: [
          { id: "btn:programs", title: "📚 Programs" },
          { id: "btn:location", title: "📍 DEC Gilgit" },
          { id: "btn:eligibility", title: "🎓 Eligibility" },
        ],
      },
    };
  }

  if (raw === "btn:location") {
    return {
      intent: "ask_location",
      textReply:
        `📍 *SARHAD UNIVERSITY DEC GILGIT CENTER*\n\n` +
        `🏫 *Distance Education Center (DEC)*\n` +
        `Alam Public School & College, Jutial, Gilgit.\n\n` +
        `🗓️ *Fall 2026 Admissions Open!*\n` +
        `⏰ *Last Date:* *10 September 2026* (${daysLeft} din baqi hain!)\n\n` +
        `Apnay educational documents k sath DEC Alam Public School Jutial visit farmaein taa k registration process mukamal ho sakay.`,
      replyButtons: {
        body: "Quick options:",
        buttons: [
          { id: "btn:programs", title: "📚 Programs" },
          { id: "btn:procedure", title: "📝 How to Apply" },
          { id: "btn:eligibility", title: "🎓 Eligibility" },
        ],
      },
    };
  }

  if (raw === "btn:dates") {
    return {
      intent: "ask_deadline",
      textReply:
        `🗓️ *IMPORTANT ADMISSION DEADLINE*\n\n` +
        `⏰ *Last Date for Admission:* *10 September 2026* (${daysLeft} din baqi hain!)\n` +
        `📍 *Center:* DEC Alam Public School & College, Jutial, Gilgit\n\n` +
        `Fall 2026 session k liye seats limited hain, is liye last date se pehle apni registration confirm karein!`,
      replyButtons: {
        body: "Apply karein:",
        buttons: [
          { id: "btn:programs", title: "📚 Programs" },
          { id: "btn:procedure", title: "📝 How to Apply" },
          { id: "btn:location", title: "📍 DEC Gilgit" },
        ],
      },
    };
  }

  if (raw === "btn:qual_fa") {
    return {
      intent: "ask_eligibility",
      textReply:
        `🎓 *Options for FA / FSc Students (Min 45% Marks):*\n\n` +
        `1️⃣ *2-Year Associate Degree (ADP)* — Graduation equivalent\n` +
        `2️⃣ *4-Year BS Program* — Complete Honours degree\n\n` +
        `Available Fields: BBA, B.Ed, English, Urdu, Education, Health & Physical Education.\n\n` +
        `Aap kis program mein interested hain?`,
      extractedLeadData: {
        qualification: "FA/FSc",
      },
      replyButtons: {
        body: "Programs dekhein:",
        buttons: [
          { id: "btn:programs", title: "📚 Programs" },
          { id: "btn:procedure", title: "📝 How to Apply" },
          { id: "btn:location", title: "📍 DEC Gilgit" },
        ],
      },
    };
  }

  if (raw === "btn:qual_grad") {
    return {
      intent: "ask_eligibility",
      textReply:
        `🎓 *Options for Graduation / BA / BSc Students (Min 45% Marks):*\n\n` +
        `✅ *2.5-Year BS Program (Bridge Degree)*\n` +
        `• 5 Semesters — Converts 14-year education to full 16-year HEC-recognized BS Honours Degree!\n\n` +
        `Available Fields: BBA, B.Ed, English, Urdu, Education, Health & Physical Education.\n\n` +
        `Aap kis program mein admission lena chahtay hain?`,
      extractedLeadData: {
        qualification: "Graduation (BA/BSc)",
      },
      replyButtons: {
        body: "Agla step:",
        buttons: [
          { id: "btn:programs", title: "📚 Programs" },
          { id: "btn:procedure", title: "📝 How to Apply" },
          { id: "btn:location", title: "📍 DEC Gilgit" },
        ],
      },
    };
  }

  // 2. Initial Greetings (ONLY on first message of a conversation)
  const isIslamicGreeting =
    raw === "aoa" ||
    raw === "a.o.a" ||
    raw === "salam" ||
    raw === "slaam" ||
    raw === "assalam o alaikum" ||
    raw === "assalam-o-alaikum" ||
    raw === "assalamu alaikum" ||
    raw === "asalam alaikum";

  const isEnglishGreeting =
    raw === "hi" ||
    raw === "hello" ||
    raw === "hey" ||
    raw === "start";

  if (!hasPriorMessages && (isIslamicGreeting || isEnglishGreeting)) {
    const salutation = isIslamicGreeting ? "Walaikum Assalam!" : "Hello! Assalam-o-Alaikum!";
    return {
      intent: "ad_greeting",
      textReply:
        `${salutation} Sarhad University DEC Gilgit mein khush-amdeed.\n\n` +
        `Fall 2026 admissions open hain (Last Date: 10 September). Yahan LMS recorded lectures aur optional Sunday physical classes k sath degree hoti hai.\n\n` +
        `Aap kis program k baray mein maloomat lena chahtay hain?`,
      replyButtons: {
        body: "Select what you would like to know:",
        buttons: [
          { id: "btn:programs", title: "📚 Programs" },
          { id: "btn:eligibility", title: "🎓 Eligibility" },
          { id: "btn:procedure", title: "📝 How to Apply" },
        ],
      },
    };
  }

  // ALL other inquiries and ongoing conversation turns flow to LLM Counselor!
  return null;
}

export function getContextualReplyButtons(
  userMessage: string,
  botReplyText: string
): WhatsAppReplyButtonPayload {
  const rawUser = userMessage.toLowerCase().trim();
  const rawBot = botReplyText.toLowerCase();

  // If discussing programs or degrees
  if (
    rawUser.includes("program") ||
    rawUser.includes("course") ||
    rawBot.includes("bba") ||
    rawBot.includes("b.ed") ||
    rawBot.includes("degree")
  ) {
    return {
      body: "Next steps:",
      buttons: [
        { id: "btn:eligibility", title: "🎓 Eligibility" },
        { id: "btn:procedure", title: "📝 How to Apply" },
        { id: "btn:location", title: "📍 DEC Gilgit" },
      ],
    };
  }

  // If discussing eligibility, marks, or qualifications
  if (
    rawUser.includes("eligib") ||
    rawUser.includes("mark") ||
    rawUser.includes("criteria") ||
    rawBot.includes("45%")
  ) {
    return {
      body: "Qualification options:",
      buttons: [
        { id: "btn:qual_fa", title: "1️⃣ FA / FSc" },
        { id: "btn:qual_grad", title: "2️⃣ Graduation" },
        { id: "btn:programs", title: "📚 Programs" },
      ],
    };
  }

  // If discussing classes, schedule, or LMS
  if (
    rawUser.includes("class") ||
    rawUser.includes("sunday") ||
    rawUser.includes("timing") ||
    rawUser.includes("kab") ||
    rawBot.includes("lms") ||
    rawBot.includes("recorded")
  ) {
    return {
      body: "Explore more:",
      buttons: [
        { id: "btn:programs", title: "📚 Programs" },
        { id: "btn:procedure", title: "📝 How to Apply" },
        { id: "btn:location", title: "📍 DEC Gilgit" },
      ],
    };
  }

  // If discussing location, center, or how to apply
  if (
    rawUser.includes("kahan") ||
    rawUser.includes("address") ||
    rawUser.includes("location") ||
    rawUser.includes("apply") ||
    rawBot.includes("jutial")
  ) {
    return {
      body: "Quick options:",
      buttons: [
        { id: "btn:programs", title: "📚 Programs" },
        { id: "btn:procedure", title: "📝 How to Apply" },
        { id: "btn:classes", title: "🏫 Sunday Classes" },
      ],
    };
  }

  // Default: Universal guide buttons
  return {
    body: "Agla step select karein:",
    buttons: [
      { id: "btn:programs", title: "📚 Programs" },
      { id: "btn:eligibility", title: "🎓 Eligibility" },
      { id: "btn:procedure", title: "📝 How to Apply" },
    ],
  };
}
