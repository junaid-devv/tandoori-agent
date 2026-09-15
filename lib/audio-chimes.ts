/**
 * lib/audio-chimes.ts
 *
 * Web Audio API synthesizer for instant in-app auditory cues:
 * - New Order: Energetic, distinctive cash-register / ascending arpeggio chime.
 * - New Message: Soft, clean message bubble pop chime.
 *
 * Works in all modern browsers without relying on external mp3 files.
 */

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtxClass) return null;

  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtxClass();
  }
  if (sharedAudioCtx.state === "suspended") {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

// Ensure context resumes on first user touch / click
if (typeof window !== "undefined") {
  const unlockAudio = () => {
    if (sharedAudioCtx && sharedAudioCtx.state === "suspended") {
      sharedAudioCtx.resume().catch(() => {});
    }
  };
  window.addEventListener("pointerdown", unlockAudio, { once: true });
  window.addEventListener("keydown", unlockAudio, { once: true });
}

/**
 * Play an energetic, bright order alert chime (ascending chord C5-E5-G5-C6 with metallic ring)
 */
export function playOrderConfirmedChime(volume = 0.35): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    const startTime = ctx.currentTime;

    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = index === 3 ? "triangle" : "sine";
      osc.frequency.setValueAtTime(freq, startTime + index * 0.08);

      const noteStart = startTime + index * 0.08;
      const noteDuration = index === 3 ? 0.6 : 0.25;

      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(volume, noteStart + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, noteStart + noteDuration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(noteStart);
      osc.stop(noteStart + noteDuration);
    });
  } catch (err) {
    console.warn("[Audio] Failed to play order chime:", err);
  }
}

/**
 * Play a clean, soft notification pop chime for incoming customer messages (D5 to A5 pop)
 */
export function playNewMessageChime(volume = 0.25): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const startTime = ctx.currentTime;
    const notes = [698.46, 880.0]; // F5 -> A5
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime + idx * 0.09);

      const noteStart = startTime + idx * 0.09;
      gain.gain.setValueAtTime(0, noteStart);
      gain.gain.linearRampToValueAtTime(volume, noteStart + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, noteStart + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(noteStart);
      osc.stop(noteStart + 0.35);
    });
  } catch (err) {
    console.warn("[Audio] Failed to play message chime:", err);
  }
}
