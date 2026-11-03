/**
 * lib/core/lang-detect.ts
 *
 * Language preference detection — extracted from order-engine.ts (Phase 9).
 * Pure functions, no IO.
 *
 * Used by:
 *  - lib/agent/nlu.ts (already uses LanguagePreference from schema.types)
 *  - app/api/webhook/route.ts (replaces direct order-engine import)
 */
import { normalizeText } from "../order-text-utils.ts";
import { supportedReplyLanguage, type LanguagePreference } from "../schema.types.ts";

// ---------------------------------------------------------------------------
// Signal word tables
// ---------------------------------------------------------------------------
const ROMAN_URDU_SIGNAL_WORDS = [
  "aoa",
  "aslamoalikum", "assalamualaikum", "assalamualikum", "aik", "ji", "jee",
  "main", "mein", "krna", "karna", "chahon", "chahoon", "chahunga", "mangwana", "krdain",
  "assalam",
  "walaikum",
  "kya",
  "kia",
  "chahiye",
  "bhej",
  "haan",
  "nahin",
  "nahi",
  "kitna",
  "kitne",
  "kar do",
  "mujhe",
  "mujhay",
  "dena",
  "dedo",
  "lena",
  "ledo",
  "chahta",
  "chahti",
  "karni",
  "karni hai",
  "theek",
  "thek",
  "bilkul",
  "shukriya",
  "bhai",
  "apka",
  "aapka",
  "mere",
  "mera",
  "ek",
  "do",
  "teen",
  "char",
  "pach",
  "aur",
  "wala",
  "wali",
];

const ENGLISH_SIGNAL_WORDS = [
  "hello",
  "hi",
  "please",
  "price",
  "what", "how", "can i", "could you", "would like", "thank you", "thanks", "do you",
];

function scoreSignals(text: string, words: string[]): number {
  return words.reduce((total, word) => {
    if (text === word) return total + 2;
    if (` ${text} `.includes(` ${word} `)) return total + 1;
    return total;
  }, 0);
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/** Detect if text is primarily written in Arabic/Urdu script (Unicode block \u0600-\u06FF) */
export function containsUrduScript(text: string): boolean {
  const arabicUrduChars = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  // Consider it Urdu script if more than 30% of non-space chars are Arabic/Urdu
  const totalChars = text.replace(/\s/g, "").length;
  if (totalChars === 0) return false;
  return arabicUrduChars / totalChars > 0.3;
}

export function inferLanguagePreference(
  text: string,
  previous: LanguagePreference = "english",
): LanguagePreference {
  previous = supportedReplyLanguage(previous);

  // Whisper sometimes renders spoken Pakistani Urdu in Devanagari. This is
  // a transcription artifact, never a request to switch the reply to Hindi.
  if (/[\u0900-\u097f]/u.test(text)) return "roman_urdu";

  // Urdu audio and Urdu script always use Roman Urdu replies.
  if (containsUrduScript(text)) {
    return "roman_urdu";
  }

  const normalized = normalizeText(text);
  const romanScore = scoreSignals(normalized, ROMAN_URDU_SIGNAL_WORDS);
  const englishScore = scoreSignals(normalized, ENGLISH_SIGNAL_WORDS);

  if (romanScore === 0 && englishScore === 0) return previous;
  if (romanScore >= englishScore + 1) return "roman_urdu";

  // One English greeting cannot replace an established Roman Urdu preference.
  if (englishScore >= romanScore + 1) {
    if (previous === "roman_urdu" && englishScore < 2) return "roman_urdu";
    return "english";
  }
  return previous;
}

