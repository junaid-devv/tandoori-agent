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

export function detectUniversityFastPath(userMessage: string): FastPathResult | null {
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

  // 2. Pure Greetings (only when user sends pure hello/hi with no query attached)
  const isPureGreeting =
    raw === "hi" ||
    raw === "hello" ||
    raw === "salam" ||
    raw === "aoa" ||
    raw === "a.o.a" ||
    raw === "assalam o alaikum" ||
    raw === "assalam-o-alaikum" ||
    raw === "hey" ||
    raw === "start";

  if (isPureGreeting) {
    return {
      intent: "ad_greeting",
      textReply:
        `📢 *SARHAD UNIVERSITY – FALL 2026 ADMISSIONS*\n` +
        `🎓 *Distance Education Center (DEC) Gilgit*\n\n` +
        `Assalam-o-Alaikum! Sarhad University DEC Alam Public School & College, Jutial, Gilgit mein Fall 2026 k admissions OPEN hain.\n\n` +
        `🗓️ *Last Date:* 10 September 2026 (${daysLeft} din baqi hain!)\n` +
        `✅ *Eligibility:* Minimum 45% marks\n` +
        `💻 *System:* Distance learning with LMS video lectures + Optional Sunday classes\n\n` +
        `Hum aap ki kis tarah rehnumai kar saktay hain? Niche diye gaye buttons se select karein ya apna sawal likhein:`,
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

  // ALL other natural questions, inquiries, and conversations flow to LLM Counselor!
  return null;
}
