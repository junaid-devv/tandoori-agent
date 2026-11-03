import type { LanguagePreference } from "./schema.types";

export const URDU_VOICE_FALLBACK = "Maaf kijiye, voice note saaf samajh nahi aaya. Dobara voice note bhej dein ya order likh dein.";

// This audience sends Urdu audio, regardless of an earlier English text greeting.
export function voiceTranscriptionOptions(_language: LanguagePreference, menuNames: string[]) {
  const vocabulary = [...new Set(menuNames.flatMap((name) => name.split(/\s+/)))].slice(0, 45).join(", ").slice(0, 350);
  return {
    language: "ur" as const,
    temperature: 0,
    // Short spelling context, never an example order that could be copied.
    prompt: `پاکستانی ریسٹورنٹ کے گاہک کی اردو گفتگو، کھانے کا آرڈر، مقدار، پتہ۔ صرف سنی ہوئی بات لکھیں۔ کھانوں کے نام: ${vocabulary}`,
  };
}

type VoiceRequest = ReturnType<typeof voiceTranscriptionOptions> & { file: File; model: string };
export type VoiceTranscriber = {
  provider: string;
  model: string;
  transcribe: (request: VoiceRequest) => Promise<{ text?: string }>;
};

export class UrduVoiceTranscriptionError extends Error {
  readonly attempts: Array<{ provider: string; model: string; status?: number; reason: string }>;
  constructor(attempts: Array<{ provider: string; model: string; status?: number; reason: string }>) {
    super("Urdu voice transcription failed after recovery attempts");
    this.attempts = attempts;
  }
}

/** Retry empty/Hindi output and provider failures with the same audio.
 * A configured secondary provider is tried before repeating the primary. */
export async function transcribeUrduVoice(file: File, menuNames: string[], providers: VoiceTranscriber[]) {
  const attempts: UrduVoiceTranscriptionError["attempts"] = [];
  const options = voiceTranscriptionOptions("roman_urdu", menuNames);
  const candidates = [...providers, ...providers.slice(0, 1)].slice(0, 3);
  for (const candidate of candidates) {
    try {
      const response = await candidate.transcribe({ file, model: candidate.model, ...options });
      const text = response.text?.trim();
      if (!text) throw new Error("empty_transcript");
      if (/[\u0900-\u097f]/u.test(text)) throw new Error("non_urdu_script");
      return { text, provider: candidate.provider, model: candidate.model, attempts: attempts.length + 1 };
    } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : undefined;
      attempts.push({ provider: candidate.provider, model: candidate.model, status,
        reason: error instanceof Error && /^(empty_transcript|non_urdu_script)$/.test(error.message) ? error.message : "provider_error" });
    }
  }
  throw new UrduVoiceTranscriptionError(attempts);
}
