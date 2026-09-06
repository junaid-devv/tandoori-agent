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

  // 1. Button Payloads
  if (raw === "btn:programs" || raw === "programs" || raw === "courses") {
    return {
      intent: "ask_programs",
      textReply:
        `📚 *SARHAD UNIVERSITY – FALL 2026 PROGRAMS OFFERED*\n\n` +
        `The following programs are available for Fall 2026 at DEC Gilgit:\n\n` +
        `1️⃣ *BBA* (Business Administration)\n` +
        `2️⃣ *B.Ed* (Bachelor of Education)\n` +
        `3️⃣ *English* (Literature & Linguistics)\n` +
        `4️⃣ *Education*\n` +
        `5️⃣ *Urdu*\n` +
        `6️⃣ *Health & Physical Education*\n\n` +
        `🎓 *Degree Options:*\n` +
        `• *After FA/FSc:* 2-Year Associate Degree (ADP) or 4-Year BS\n` +
        `• *After Graduation:* 2.5-Year BS Program\n\n` +
        `📍 *Center:* DEC Alam Public School & College, Jutial, Gilgit\n` +
        `⏰ *Last Date:* 10 September 2026 (${daysLeft} days left!)\n\n` +
        `Aap kis program mein admission lena chahtay hain?`,
      replyButtons: {
        body: "Select an option below to proceed:",
        buttons: [
          { id: "btn:eligibility", title: "Check Eligibility" },
          { id: "btn:procedure", title: "How to Apply" },
          { id: "btn:location", title: "DEC Center Gilgit" },
        ],
      },
    };
  }

  if (raw === "btn:eligibility" || raw === "eligibility" || raw.includes("criteria") || raw.includes("marks kitne")) {
    return {
      intent: "ask_eligibility",
      textReply:
        `✅ *SARHAD UNIVERSITY – ELIGIBILITY CRITERIA*\n\n` +
        `• *Minimum Requirement:* *45% Marks* in previous qualification.\n\n` +
        `🎓 *Options by Qualification:*\n` +
        `1️⃣ *After FA / FSc / ICS / I.Com (Min 45%):*\n` +
        `   • *2-Year Associate Degree Program (ADP)* — equivalent to Graduation\n` +
        `   • *4-Year BS Program*\n\n` +
        `2️⃣ *After 2-Year Graduation / BA / BSc (Min 45%):*\n` +
        `   • *2.5-Year BS Program* (convert to 16-year BS Honours)\n\n` +
        `Apni previous qualification (FA/FSc ya Graduation) aur percentage batayein taa k hum aap ka admission guide kar sakein!`,
      replyButtons: {
        body: "Choose your background:",
        buttons: [
          { id: "btn:qual_fa", title: "I have FA / FSc" },
          { id: "btn:qual_grad", title: "I have Graduation" },
          { id: "btn:procedure", title: "Admission Steps" },
        ],
      },
    };
  }

  if (raw === "btn:procedure" || raw === "admission procedure" || raw.includes("apply kaise") || raw.includes("how to apply")) {
    return {
      intent: "ask_procedure",
      textReply:
        `📝 *SARHAD UNIVERSITY – ADMISSION PROCEDURE (FALL 2026)*\n\n` +
        `1. Apni qualification k mutabiq desired program select karein.\n` +
        `2. *DEC Alam Public School & College, Jutial, Gilgit* visit karein guidance & registration k liye.\n` +
        `3. Educational documents (DMC, CNIC/B-form, Photos) submit karein.\n` +
        `4. Admission confirm hone k baad aapko *LMS ID* mil jayegi.\n` +
        `5. *LMS par recorded video lectures* available honge jo aap apnay schedule k mutabiq kisi bhi waqt dekh saktay hain.\n` +
        `6. Course outline receive karein (har subject k ~25 prescribed topics).\n` +
        `7. Semester end par DEC center mein 70-mark paper appear karein.\n\n` +
        `⏰ *Last Date:* 10 September 2026!`,
      replyButtons: {
        body: "Next steps:",
        buttons: [
          { id: "btn:classes", title: "Class Schedule" },
          { id: "btn:location", title: "DEC Center Info" },
          { id: "btn:counselor", title: "Talk to Counselor" },
        ],
      },
    };
  }

  if (raw === "btn:classes" || raw.includes("sunday") || raw.includes("job") || raw.includes("classes timing") || raw.includes("class schedule")) {
    return {
      intent: "ask_classes_schedule",
      textReply:
        `🏫 *CLASSES & DISTANCE LEARNING SYSTEM*\n\n` +
        `⭐ *Ye Distance Learning Program hai*, jo khaas tor par job holders, teachers aur regular classes na lene walay students k liye banaya gaya hai!\n\n` +
        `💻 *Online LMS:* Recorded video lectures 24/7 available hotay hain. Aap apni marzi k waqt study kar saktay hain.\n\n` +
        `📌 *Sunday Physical Classes:* DEC Alam Public School & College, Jutial, Gilgit mein har Sunday physical classes hoti hain.\n` +
        `➡️ *Sunday classes bilkul OPTIONAL hain!* Jo students Sunday attend nahi kar saktay wo LMS lectures se complete study kar saktay hain.\n\n` +
        `Is flexible system ki wajah se aap job k sath easily degree mukamal kar saktay hain!`,
      replyButtons: {
        body: "Explore more:",
        buttons: [
          { id: "btn:programs", title: "View Programs" },
          { id: "btn:location", title: "Center Location" },
          { id: "btn:eligibility", title: "Check Eligibility" },
        ],
      },
    };
  }

  if (raw === "btn:location" || raw.includes("kahan hai") || raw.includes("address") || raw.includes("location") || raw.includes("jutial") || raw.includes("alam public")) {
    return {
      intent: "ask_location",
      textReply:
        `📍 *SARHAD UNIVERSITY ADMISSION CENTER (DEC GILGIT)*\n\n` +
        `🏫 *Distance Education Center (DEC)*\n` +
        `Alam Public School & College, Jutial, Gilgit.\n\n` +
        `🗓️ *Fall 2026 Admissions Open!*\n` +
        `⏰ *Last Date to Apply:* *10 September 2026* (${daysLeft} din baqi hain!)\n\n` +
        `Admissions limited session k liye hain. Apnay educational documents k sath DEC Alam Public School & College Jutial visit farmaein taa k registration process mukamal ho sakay.`,
      replyButtons: {
        body: "Quick options:",
        buttons: [
          { id: "btn:programs", title: "Programs List" },
          { id: "btn:procedure", title: "Admission Steps" },
          { id: "btn:counselor", title: "Call Counselor" },
        ],
      },
    };
  }

  if (raw === "btn:dates" || raw.includes("last date") || raw.includes("deadline") || raw.includes("kab tak")) {
    return {
      intent: "ask_deadline",
      textReply:
        `🗓️ *IMPORTANT ADMISSION DEADLINE*\n\n` +
        `⏰ *Last Date for Admission:* *10 September 2026*\n` +
        `📍 *Location:* DEC Alam Public School & College, Jutial, Gilgit\n\n` +
        `⚠️ *Note:* Fall 2026 session k liye seats limited hain. Last date ka intezar na karein aur jald az jald apni registration confirm karein!`,
      replyButtons: {
        body: "Apply before deadline:",
        buttons: [
          { id: "btn:programs", title: "View Programs" },
          { id: "btn:procedure", title: "How to Apply" },
          { id: "btn:location", title: "Center Location" },
        ],
      },
    };
  }

  if (raw === "btn:qual_fa") {
    return {
      intent: "ask_eligibility",
      textReply:
        `🎓 *Options for FA / FSc / ICS / I.Com Students (Min 45% Marks):*\n\n` +
        `1️⃣ *2-Year Associate Degree Program (ADP)*\n` +
        `   • 4 Semesters — Equivalent to traditional 2-year Graduation\n` +
        `   • Career-oriented and fast-track\n\n` +
        `2️⃣ *4-Year BS Program*\n` +
        `   • 8 Semesters — Complete 16-Year Honours Degree\n\n` +
        `Available Fields: BBA, B.Ed, English, Urdu, Education, Health & Physical Education.\n\n` +
        `Aap kis subject mein interest rakhtay hain? Aur aap ka shubh naam kya hai?`,
      extractedLeadData: {
        qualification: "FA/FSc",
      },
      replyButtons: {
        body: "Choose your preferred path:",
        buttons: [
          { id: "btn:programs", title: "Available Programs" },
          { id: "btn:procedure", title: "How to Apply" },
          { id: "btn:location", title: "DEC Center Gilgit" },
        ],
      },
    };
  }

  if (raw === "btn:qual_grad") {
    return {
      intent: "ask_eligibility",
      textReply:
        `🎓 *Options for Graduation / BA / BSc / B.Com Students (Min 45% Marks):*\n\n` +
        `✅ *2.5-Year BS Program (Bridge Degree)*\n` +
        `• 5 Semesters\n` +
        `• Converts your 14-year education into a full 16-year HEC-recognized BS Honours Degree!\n\n` +
        `Available Fields: BBA, B.Ed, English, Urdu, Education, Health & Physical Education.\n\n` +
        `LMS par flexible recorded lectures hain, jo working teachers aur professionals k liye ideal hain.\n\n` +
        `Aap ka naam kya hai aur aap kis program mein admission lena chahtay hain?`,
      extractedLeadData: {
        qualification: "Graduation (BA/BSc)",
      },
      replyButtons: {
        body: "Next actions:",
        buttons: [
          { id: "btn:programs", title: "View Programs" },
          { id: "btn:procedure", title: "Admission Steps" },
          { id: "btn:location", title: "DEC Center Gilgit" },
        ],
      },
    };
  }

  // 2. Ad Greetings & Welcome (e.g. clicks from sponsored Facebook/Instagram ads)
  const isAdClick =
    raw.includes("ad") ||
    raw.includes("sponsored") ||
    raw.includes("facebook") ||
    raw.includes("instagram") ||
    raw.includes("sarhad university") ||
    raw.includes("admissions open") ||
    raw === "hi" ||
    raw === "hello" ||
    raw === "salam" ||
    raw === "aoa" ||
    raw === "assalam o alaikum" ||
    raw === "assalam-o-alaikum" ||
    raw === "hey";

  if (isAdClick && raw.length < 150) {
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

  return null;
}
