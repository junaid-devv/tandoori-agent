import type { LanguagePreference } from "./schema.types";

export function voiceTranscriptionOptions(language: LanguagePreference, menuNames: string[]) {
  return {
    ...(language === "pashto" ? { language: "ps" } : language === "roman_urdu" ? { language: "ur" } : {}),
    prompt: [
      "Pakistani restaurant order in Urdu, English or Pashto. Transcribe faithfully; do not translate into Hindi or add items. Urdu uses Urdu script, English uses Latin script.",
      "میں چکن پراٹھا رول آرڈر کرنا چاہوں گا۔ ایک کبابش پیزا اور فرائیڈ ونگز۔",
      "Chicken paratha roll, Kababish pizza, small, mid, medium, large, karahi, naan, delivery, pickup, address, shukriya.",
      language === "pashto" ? "Stare mashay, pa kher, menu wakhaya, dwa, dre, raka, manana." : "",
      // A bounded vocabulary hint, never an instruction to invent an order.
      `Menu spellings (reference only): ${menuNames.slice(0, 80).join(", ").slice(0, 1800)}`,
    ].filter(Boolean).join("\n"),
  };
}
