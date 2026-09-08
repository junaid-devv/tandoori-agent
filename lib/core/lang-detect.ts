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
import type { LanguagePreference } from "../schema.types.ts";

// ---------------------------------------------------------------------------
// Signal word tables
// ---------------------------------------------------------------------------
const ROMAN_URDU_SIGNAL_WORDS = [
  "aoa",
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
  "order",
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
  "delivery",
  "address",
  "confirm",
  "order",
  "menu",
];

/**
 * Roman Pashto signal words — common Pashto conversational words
 * written in Latin script as used in WhatsApp messages.
 */
const PASHTO_SIGNAL_WORDS = [
  "stare mashay",
  "staray mashay",
  "stare",
  "staray",
  "pa kher",
  "pa khair",
  "pakhray",
  "manana",
  "dera manana",
  "ghwaarom",
  "ghwaarem",
  "ghwaram",
  "ghwaaray",
  "ghwaray",
  "wakhaya",
  "wakhaye",
  "wakhayey",
  "leedal",
  "wrakawa",
  "rakawa",
  "raka",
  "raakawa",
  "raasha",
  "rasha",
  "tsomra",
  "tsomra da",
  "amrada",
  "tsomrada",
  "tsanga",
  "tsanga ye",
  "cherta",
  "kalta",
  "dalta",
  "hagha",
  "kawai",
  "kawey",
  "khwral",
  "khwaral",
  "yaw",
  "dwa",
  "dre",
  "tsalor",
  "pinzah",
  "shpag",
  "laro",
  "nasha",
  "deliver kra",
  "deliver krra",
  "ghar ta",
  "kora ta",
  "zmong",
  "khpal",
  "khush raghlay",
  "rawalegay",
  "rawastaway",
  "darsara",
  "wakhla",
  "khwand",
  "tse",
  "raghay",
];

const PASHTO_SCRIPT_WORDS = [
  "مننه",
  "ستړي",
  "مه شي",
  "پخیر",
  "په خیر",
  "وښایه",
  "څنګه",
  "څومره",
  "غواړم",
  "راکړه",
  "ډوډۍ",
  "راولېږئ",
  "خوراک",
];

function scoreSignals(text: string, words: string[]): number {
  return words.reduce((total, word) => {
    if (text === word) return total + 2;
    if (text.includes(word)) return total + 1;
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

/**
 * Detect if text contains Pashto-specific Unicode characters or distinct Pashto script words.
 * Pashto uses several characters not found in Arabic or Urdu:
 *   ځ (U+0681), څ (U+0685), ږ (U+0696), ټ (U+067C), ډ (U+0688),
 *   ړ (U+0693), ښ (U+069A), ڼ (U+06BC), ۍ (U+06CD), ې (U+06D0)
 */
export function containsPashtoScript(text: string): boolean {
  if (/[\u0681\u0685\u0696\u067C\u0688\u0693\u069A\u06BC\u06CD\u06D0]/.test(text)) {
    return true;
  }
  return PASHTO_SCRIPT_WORDS.some((word) => text.includes(word));
}

export function inferLanguagePreference(
  text: string,
  previous: LanguagePreference = "english",
): LanguagePreference {
  // Pashto-specific script characters or vocabulary — highest priority
  if (containsPashtoScript(text)) return "pashto";

  // General Arabic/Urdu-range script — could be Pashto or Urdu.
  // If already detected as pashto via previous turns, keep it; otherwise treat as roman_urdu.
  if (containsUrduScript(text)) {
    return previous === "pashto" ? "pashto" : "roman_urdu";
  }

  const normalized = normalizeText(text);
  const pashtoScore = scoreSignals(normalized, PASHTO_SIGNAL_WORDS);
  const romanScore = scoreSignals(normalized, ROMAN_URDU_SIGNAL_WORDS);
  const englishScore = scoreSignals(normalized, ENGLISH_SIGNAL_WORDS);

  // Pashto wins if it has a clear advantage over both Urdu and English
  if (pashtoScore > 0 && pashtoScore >= romanScore && pashtoScore >= englishScore) {
    return "pashto";
  }

  if (romanScore === 0 && englishScore === 0) return previous;
  if (romanScore >= englishScore + 1) return "roman_urdu";

  // Only switch TO english if there is a meaningful English signal advantage AND
  // the previous preference was not roman_urdu/pashto from a strong signal (e.g. user
  // typed "hello" once but has been in Roman Urdu / Pashto the whole conversation).
  // Require a score of 2+ to flip from roman_urdu/pashto → english.
  if (englishScore >= romanScore + 1) {
    if (previous === "roman_urdu" && englishScore < 2) return "roman_urdu";
    if (previous === "pashto" && englishScore < 2) return "pashto";
    return "english";
  }
  return previous;
}

