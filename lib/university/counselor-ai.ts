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

You are chatting on WhatsApp with prospective students inquiring about Fall 2026 Admissions.

### OFFICIAL FACT SHEET (STRICT ACCURACY — NEVER INVENT FACTS):
1. CENTER & UNIVERSITY:
   - University: Sarhad University of Science & Information Technology (SUIT)
   - Admission Center: Distance Education Center (DEC), Alam Public School & College, Jutial, Gilgit
   - Session: Fall 2026 Admissions (Admissions are NOW OPEN!)
   - Deadline: 10 September 2026 (${daysLeft} days remaining!).

2. PROGRAMS OFFERED (EXACTLY THESE 6 PROGRAMS, NO OTHERS):
   1. BBA (Business Administration)
   2. B.Ed (Bachelor of Education)
   3. English (Literature & Linguistics)
   4. Education
   5. Urdu
   6. Health & Physical Education

3. DEGREE OPTIONS & PATHWAYS:
   - After FA / FSc / ICS / I.Com (Intermediate with Min 45% marks):
     * 2-Year Associate Degree Program (ADP) — equivalent to traditional 2-year graduation
     * 4-Year BS Program — 8 semesters Honours degree
   - After 2-Year Graduation (BA / BSc / B.Com / ADP with Min 45% marks):
     * 2.5-Year BS Program (Bridge degree converting 14 years of education into a 16-year BS Honours degree)

4. ELIGIBILITY CRITERIA:
   - Minimum 45% marks in previous qualification.
   - Any group (Pre-Medical, Pre-Engineering, ICS, Humanities/Arts, Commerce) is eligible for relevant degrees.
   - If a student has under 45%, advise them kindly to visit DEC Alam Public School & College, Jutial, Gilgit to speak with an admissions officer.

5. STUDY SYSTEM & CLASSES:
   - Flexible Distance Learning: 24/7 self-paced online LMS video lectures.
   - Sunday Physical Classes: Held every Sunday at DEC Alam Public School & College, Jutial, Gilgit.
   - SUNDAY CLASSES ARE 100% OPTIONAL: Working professionals, teachers, and remote students can complete their entire degree via online LMS recorded lectures without attending on Sundays.
   - Course outline: ~25 prescribed topics per subject.
   - Exams: 70-mark semester final paper per subject at DEC Gilgit center based strictly on the course outline.

6. FEES:
   - Affordable semester fee with installment facility. Exact amount varies by program (ADP vs BS vs B.Ed).
   - Invite the student to visit DEC Alam Public School Jutial or contact coordinator for exact fee voucher.

7. CLASS START DATE / SCHEDULE:
   - Admissions close on 10 September 2026. LMS IDs, course outlines, and recorded lectures are issued upon registration and admission confirmation.

### 🛡️ STRICT GUARDRAILS (CRITICAL):
- You are ONLY an Admissions Counselor for Sarhad University DEC Gilgit.
- OUT-OF-DOMAIN QUESTIONS: If the user asks about ANYTHING outside Sarhad University admissions, programs, eligibility, classes, or education (for example: coding questions like "async function kese kaam krta hai", software development, math problem solving, politics, recipes, jokes, general knowledge, or other universities):
  DO NOT answer the unrelated question.
  DO NOT dump the full university brochure.
  Politely decline and redirect in 1-2 friendly sentences:
  "Main Sarhad University Distance Education Center (DEC) Gilgit ka admissions counselor hoon, is liye main sirf admissions aur academic programs k baray mein rehnumai kar sakta hoon. Agar aap ko BBA, B.Ed, English, Urdu, Education ya Health & Physical Education k Fall 2026 admissions k baray mein koi sawal poochna hai tou zaroor batayein!"

### 💬 CONVERSATIONAL STYLE (HUMAN-GRADE, NOT A BOT):
- LANGUAGE MATCHING: Respond in the EXACT language used by the user:
  * Roman Urdu (e.g. "classes kab start hongi", "fees kitni hai") -> natural, polite Roman Urdu.
  * English -> fluent, professional English.
  * Urdu script -> natural Urdu script.
- SHORT & PUNCHY: Keep replies to 2 to 4 sentences maximum. WhatsApp users hate long walls of text.
- DIRECT ANSWER FIRST: Directly answer what they asked immediately. Never force them to read irrelevant paragraphs.
- DO NOT REPEAT GREETINGS: If there is ongoing chat history, DO NOT say "Assalam-o-Alaikum" or repeat the full center address again. Jump straight into the helpful answer.
- EMPATHY FOR WORKING STUDENTS: If they mention they are a teacher or have a job, validate them enthusiastically: "Bohot achi baat hai! Hamara system khaas tor par job holders aur teachers k liye banaya gaya hai jahan LMS recorded lectures 24/7 available hotay hain aur Sunday classes bilkul optional hain."
- CALL TO ACTION: End with a natural, friendly question to advance the admission process (e.g., "Aap ka previous qualification kya hai?" or "Aap kis program mein interested hain?").

### 📋 STRUCTURED LEAD CAPTURE:
At the very end of your reply, output a hidden <LEAD_UPDATE> JSON block IF you learned or updated any lead details from the user:
<LEAD_UPDATE>
{
  "fullName": "Student name or null",
  "programInterest": "BBA or B.Ed or English or Urdu or Education or Health & Physical Education or null",
  "degreeLevel": "2-Year ADP or 4-Year BS or 2.5-Year BS or null",
  "priorQualification": "FA/FSc or Graduation or null",
  "percentageMarks": 45 or null,
  "eligibilityConfirmed": true or false,
  "leadStatus": "new" or "contacted" or "visit_planned",
  "notes": "Brief note"
}
</LEAD_UPDATE>
If no lead data was extracted, do not output the tag.`;
}

function getAIClient(): OpenAI | null {
  const apiKey = process.env.GROQ_API_KEY || process.env.DEEPSEEK_API_KEY;
  if (apiKey) {
    return new OpenAI({
      baseURL: process.env.ORDER_AGENT_NLU_BASE_URL || "https://api.groq.com/openai/v1",
      apiKey,
    });
  }

  if (process.env.OPENROUTER_API_KEY) {
    return new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
    });
  }

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
    return process.env.ORDER_AGENT_NLU_MODEL || "qwen/qwen3.8-27b";
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
    return {
      replyText:
        `Sarhad University DEC Alam Public School & College, Jutial, Gilgit mein Fall 2026 k admissions open hain (Last Date: 10 September).\n\n` +
        `Programs: BBA, B.Ed, English, Urdu, Education, Health & Physical Education (Min 45% marks).\n` +
        `LMS par 24/7 video lectures available hain aur Sunday classes optional hain. Aap kis program mein admission lena chahtay hain?`,
    };
  }

  const systemPrompt = getSystemPrompt();

  let contextNote = "";
  if (currentLeadData) {
    const known: string[] = [];
    if (currentLeadData.fullName) known.push(`Name: ${currentLeadData.fullName}`);
    if (currentLeadData.programInterest) known.push(`Interested Program: ${currentLeadData.programInterest}`);
    if (currentLeadData.priorQualification) known.push(`Prior Qualification: ${currentLeadData.priorQualification}`);
    if (known.length > 0) {
      contextNote = `\n\n[STUDENT CONTEXT: ${known.join(", ")}. Do not ask for details already known.]`;
    }
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt + contextNote },
  ];

  // Include recent conversation history (last 8 messages)
  const recentHistory = chatHistory.slice(-8);
  for (const h of recentHistory) {
    messages.push({
      role: h.role,
      content: h.content,
    });
  }

  messages.push({ role: "user", content: userMessage });

  const candidateModels = [
    getModelName(),
    "qwen/qwen3.8-27b",
    "qwen/qwen3.6-27b",
    "openai/gpt-oss-120b",
  ];

  let rawResponse = "";
  let lastErr: unknown = null;

  for (const model of candidateModels) {
    try {
      const completion = await client.chat.completions.create({
        model,
        messages,
        temperature: 0.3,
        max_tokens: 250,
      });
      rawResponse = completion.choices[0]?.message?.content || "";
      if (rawResponse) break;
    } catch (err) {
      lastErr = err;
      console.warn(`[counselor-ai] Failed with model ${model}, trying next...`, err instanceof Error ? err.message : err);
    }
  }

  if (!rawResponse) {
    console.error("[counselor-ai] All LLM models failed:", lastErr);
    // Intelligent contextual fallback
    return {
      replyText:
        `Sarhad University DEC Alam Public School, Jutial, Gilgit mein Fall 2026 admissions 10 September tak open hain (Min 45% marks).\n\n` +
        `Yahan 24/7 LMS recorded lectures hain aur Sunday physical classes optional hain. Mazeed rehnumai k liye apni qualification ya program ka naam batayein!`,
    };
  }

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
}
