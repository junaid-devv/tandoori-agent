import OpenAI from "openai";
import { SARHAD_UNIVERSITY_INFO, getDaysRemainingUntilDeadline } from "./knowledge-base";

export interface UniversityCounselorResponse {
  replyText: string;
  leadUpdate?: {
    fullName?: string;
    programInterest?: string;
    degreeLevel?: string;
    priorQualification?: string;
    percentageMarks?: number;
    eligibilityConfirmed?: boolean;
    leadStatus?: "new" | "contacted" | "visit_planned" | "visited_dec" | "enrolled" | "lost";
    notes?: string;
  };
}

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

function getSystemPrompt(): string {
  const daysLeft = getDaysRemainingUntilDeadline();

  return `You are the Official Admissions Counselor for SARHAD UNIVERSITY OF SCIENCE & INFORMATION TECHNOLOGY – DISTANCE EDUCATION CENTER (DEC), Alam Public School & College, Jutial, Gilgit.

You are interacting with prospective students on WhatsApp who arrived via Meta Ads (Facebook/Instagram) or sponsorships for Fall 2026 Admissions.

### OFFICIAL FACT SHEET (DO NOT DEVIATE OR INVENT FACTS):
1. UNIVERSITY & CENTER:
   - University: Sarhad University of Science & Information Technology
   - Admission Center: Distance Education Center (DEC), Alam Public School & College, Jutial, Gilgit
   - Session: Fall 2026 Admissions (Admissions are NOW OPEN!)
   - Last Date for Admission: 10 September 2026 (${daysLeft} days remaining!). Admissions are strictly limited to the Fall 2026 window.

2. PROGRAMS OFFERED (ONLY THESE 6 ARE AVAILABLE):
   1. Education
   2. English
   3. Urdu
   4. BBA (Business Administration)
   5. Health & Physical Education
   6. B.Ed (Bachelor of Education)

3. PROGRAM OPTIONS & PATHWAYS:
   - After FA / FSc / ICS / I.Com (Intermediate):
     * 2-Year Associate Degree Program (ADP) — equivalent to 2-year traditional graduation
     * 4-Year BS Program — 8 semesters full Honours degree
   - After Graduation (BA / BSc / B.Com / ADP):
     * 2.5-Year BS Program — bridge program converting 14-year education to 16-year BS degree

4. ELIGIBILITY CRITERIA:
   - Minimum 45% marks required in the previous qualification.
   - Students with FA/FSc (any group: Pre-Medical, Pre-Engineering, ICS, Humanities, etc.) can apply for relevant 2-Year ADP or 4-Year BS.
   - Students with 2-Year Graduation or ADP can apply for 2.5-Year BS.
   - If a student has under 45%, advise them kindly to visit DEC Alam Public School & College, Jutial, Gilgit to speak with an admissions officer for possible guidance.

5. ADMISSION PROCEDURE:
   1. Select desired program based on previous qualification.
   2. Visit DEC Alam Public School & College, Jutial, Gilgit for admission guidance and registration.
   3. Submit required educational documents (Matric & Inter DMC/Certificates, CNIC/B-Form copy, 4 passport photos) and complete registration.
   4. Receive LMS ID upon confirmation.
   5. Recorded video lectures are uploaded to the LMS.
   6. Students study lectures according to their own schedule (24/7 self-paced).
   7. Receive course outline: each subject has approximately 25 prescribed topics.
   8. Semester examinations: 70-mark paper per subject prepared strictly from the prescribed course outline according to the university examination system.

6. PHYSICAL CLASSES & DISTANCE LEARNING:
   - Physical classes are conducted EVERY SUNDAY at DEC Alam Public School & College, Jutial, Gilgit.
   - CRITICAL: Sunday physical classes are 100% OPTIONAL!
   - Students who cannot attend physical classes (due to job, remote residence, travel, or family) can complete their studies purely through the recorded LMS lectures.
   - This distance program is especially designed for school/college teachers, government employees, working professionals, and remote students across Gilgit-Baltistan who cannot attend regular daily classes.

7. FEE INQUIRIES:
   - Fees are affordable and semester-based. Because exact fee amounts vary per degree (ADP vs BS vs B.Ed) and installment schedules are available, invite the student to visit DEC Alam Public School & College, Jutial, Gilgit or speak directly with the DEC coordinator to receive the exact fee voucher.

### CONVERSATIONAL RULES & TONE:
- Language: Respond in the EXACT same language/style the student uses:
  * If they message in Roman Urdu (e.g., "admissions kab tak hain", "kia main job k sath parh skta hu"), reply in natural, polite Roman Urdu.
  * If they message in English, reply in fluent professional English.
  * If they message in Urdu script, reply in Urdu.
- Tone: Warm, welcoming, respectful, encouraging, and authoritative ("Assalam-o-Alaikum! Sarhad University DEC Gilgit mein khush-amdeed").
- Conversational Empathy: When a student mentions they work or are a teacher, validate and praise their ambition, reassuring them that the LMS system and optional Sunday classes are tailored exactly for their busy life.
- Always create helpful urgency around the deadline (10 September 2026).
- Natural Lead Capture: Intelligently discover the student's:
  1. Name
  2. Interested program (Education, English, Urdu, BBA, Health & Physical Education, B.Ed)
  3. Prior qualification (FA/FSc or Graduation)
  If any of these details are mentioned or can be asked naturally without annoying the student, ask politely.
- Formatting: Use WhatsApp-friendly markdown: *bold* for emphasis, clean emojis, short paragraphs. Never produce giant walls of unbroken text.

### STRUCTURED OUTPUT:
At the very end of your response, output a hidden JSON tag if you extracted or updated any student lead attributes:
<LEAD_UPDATE>
{
  "fullName": "Student name or null if unknown",
  "programInterest": "Program name or null",
  "degreeLevel": "2-Year ADP or 4-Year BS or 2.5-Year BS or null",
  "priorQualification": "FA/FSc or Graduation or null",
  "percentageMarks": 45 or null,
  "eligibilityConfirmed": true or false,
  "leadStatus": "new" or "contacted" or "visit_planned",
  "notes": "Short note about student inquiry"
}
</LEAD_UPDATE>
If no lead data was extracted, do not include the <LEAD_UPDATE> tag.`;
}

function getAIClient(): OpenAI | null {
  // 1. Try Groq (Fastest inference & excellent Roman Urdu comprehension)
  if (process.env.GROQ_API_KEY || process.env.DEEPSEEK_API_KEY) {
    return new OpenAI({
      baseURL: process.env.ORDER_AGENT_NLU_BASE_URL || "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY || process.env.DEEPSEEK_API_KEY,
    });
  }

  // 2. Try OpenRouter
  if (process.env.OPENROUTER_API_KEY) {
    return new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
    });
  }

  // 3. Try Google AI Studio
  if (process.env.GOOGLE_AI_API_KEY) {
    return new OpenAI({
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      apiKey: process.env.GOOGLE_AI_API_KEY,
    });
  }

  return null;
}

function getModelName(): string {
  if (process.env.GROQ_API_KEY || process.env.DEEPSEEK_API_KEY) {
    return process.env.ORDER_AGENT_NLU_MODEL || "llama-3.3-70b-versatile";
  }
  if (process.env.OPENROUTER_API_KEY) {
    return "meta-llama/llama-3.3-70b-instruct";
  }
  if (process.env.GOOGLE_AI_API_KEY) {
    return "gemini-1.5-flash";
  }
  return "gpt-4o-mini";
}

export async function askUniversityCounselorAI(
  userMessage: string,
  chatHistory: ChatHistoryMessage[] = [],
  currentLeadData?: {
    fullName?: string | null;
    programInterest?: string | null;
    priorQualification?: string | null;
  }
): Promise<UniversityCounselorResponse> {
  const client = getAIClient();
  const daysLeft = getDaysRemainingUntilDeadline();

  if (!client) {
    // Graceful fallback if no LLM key configured
    return {
      replyText:
        `📢 *SARHAD UNIVERSITY – FALL 2026 ADMISSIONS*\n` +
        `📍 *Center:* DEC Alam Public School & College, Jutial, Gilgit\n` +
        `🗓️ *Last Date:* 10 September 2026 (${daysLeft} din baqi hain!)\n\n` +
        `Admissions open hain for BBA, B.Ed, English, Urdu, Education, aur Health & Physical Education.\n` +
        `Minimum 45% marks required hain. LMS par recorded lectures aur Sunday ko optional classes hain.\n\n` +
        `Mazeed rehnumai k liye apna naam aur qualification batayein ya DEC Alam Public School & College Jutial visit farmaein!`,
    };
  }

  const systemPrompt = getSystemPrompt();

  let contextNote = "";
  if (currentLeadData) {
    const known = [];
    if (currentLeadData.fullName) known.push(`Name: ${currentLeadData.fullName}`);
    if (currentLeadData.programInterest) known.push(`Program: ${currentLeadData.programInterest}`);
    if (currentLeadData.priorQualification) known.push(`Prior Qualification: ${currentLeadData.priorQualification}`);
    if (known.length > 0) {
      contextNote = `\n[Context: Already known about this student: ${known.join(", ")}. Do not ask for details you already know unless clarifying.]`;
    }
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt + contextNote },
  ];

  // Include recent history (last 8 turns)
  const recentHistory = chatHistory.slice(-8);
  for (const h of recentHistory) {
    messages.push({
      role: h.role,
      content: h.content,
    });
  }

  messages.push({ role: "user", content: userMessage });

  try {
    const completion = await client.chat.completions.create({
      model: getModelName(),
      messages,
      temperature: 0.3,
      max_tokens: 600,
    });

    const rawResponse = completion.choices[0]?.message?.content || "";

    // Parse out <LEAD_UPDATE> if present
    let replyText = rawResponse;
    let leadUpdate: UniversityCounselorResponse["leadUpdate"] = undefined;

    const leadMatch = rawResponse.match(/<LEAD_UPDATE>([\s\S]*?)<\/LEAD_UPDATE>/);
    if (leadMatch) {
      replyText = rawResponse.replace(/<LEAD_UPDATE>[\s\S]*?<\/LEAD_UPDATE>/, "").trim();
      try {
        const parsed = JSON.parse(leadMatch[1].trim());
        leadUpdate = {};
        if (parsed.fullName && parsed.fullName !== "null") leadUpdate.fullName = parsed.fullName;
        if (parsed.programInterest && parsed.programInterest !== "null") leadUpdate.programInterest = parsed.programInterest;
        if (parsed.degreeLevel && parsed.degreeLevel !== "null") leadUpdate.degreeLevel = parsed.degreeLevel;
        if (parsed.priorQualification && parsed.priorQualification !== "null") leadUpdate.priorQualification = parsed.priorQualification;
        if (typeof parsed.percentageMarks === "number") leadUpdate.percentageMarks = parsed.percentageMarks;
        if (typeof parsed.eligibilityConfirmed === "boolean") leadUpdate.eligibilityConfirmed = parsed.eligibilityConfirmed;
        if (parsed.leadStatus) leadUpdate.leadStatus = parsed.leadStatus;
        if (parsed.notes) leadUpdate.notes = parsed.notes;
      } catch {
        // Ignore lead parse error, retain text
      }
    }

    return {
      replyText: replyText.trim(),
      leadUpdate,
    };
  } catch (error) {
    console.error("[counselor-ai] LLM execution error:", error);
    // Robust conversational fallback
    return {
      replyText:
        `📢 *SARHAD UNIVERSITY – FALL 2026 ADMISSIONS*\n` +
        `📍 *Distance Education Center (DEC):* Alam Public School & College, Jutial, Gilgit\n` +
        `🗓️ *Last Date:* 10 September 2026\n\n` +
        `Aap ka sawal mil gaya hai. Sarhad University Distance Education Center mein BBA, B.Ed, English, Urdu, Education, aur Health & Physical Education k admissions open hain (Min 45% marks).\n\n` +
        `Recorded lectures LMS par available hain aur Sunday classes optional hain. Aap DEC Alam Public School Jutial visit karke direct admission form submit kar saktay hain!`,
    };
  }
}
