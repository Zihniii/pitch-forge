import type { Persona } from "@/types";
import { PERSONAS } from "@/lib/constants";

// ============================================================
// Speech-to-Text (Web Speech API)
// ============================================================

interface SpeechRecognitionCallbacks {
  onResult: (transcript: string, isFinal: boolean) => void;
  onSilence: () => void;
  onEnd: () => void;
  onError: (error: string) => void;
}

let recognition: SpeechRecognition | null = null;
let silenceTimer: ReturnType<typeof setTimeout> | null = null;
const SILENCE_MS = 3500;

export function startListening(callbacks: SpeechRecognitionCallbacks): boolean {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    callbacks.onError("Speech recognition is not supported in this browser. Please use Chrome.");
    return false;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(callbacks.onSilence, SILENCE_MS);

    let finalTranscript = "";
    let interimTranscript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalTranscript += result[0].transcript;
      else interimTranscript += result[0].transcript;
    }
    if (finalTranscript) callbacks.onResult(finalTranscript, true);
    else if (interimTranscript) callbacks.onResult(interimTranscript, false);
  };

  recognition.onerror = (event) => {
    if (event.error !== "no-speech" && event.error !== "aborted") {
      callbacks.onError(`Speech recognition error: ${event.error}`);
    }
  };

  recognition.onend = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    callbacks.onEnd();
  };

  recognition.start();
  silenceTimer = setTimeout(callbacks.onSilence, SILENCE_MS);
  return true;
}

export function stopListening(): void {
  if (recognition) {
    recognition.stop();
    recognition = null;
  }
  if (silenceTimer) {
    clearTimeout(silenceTimer);
    silenceTimer = null;
  }
}

// ============================================================
// Voice catalog — load and cache, assign a DISTINCT voice per persona
// ============================================================

let voiceCache: SpeechSynthesisVoice[] = [];
const personaVoiceMap = new Map<string, SpeechSynthesisVoice>();

function loadVoices(): SpeechSynthesisVoice[] {
  if (voiceCache.length) return voiceCache;
  voiceCache = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  return voiceCache;
}

// getVoices() is async-populated in Chrome — warm it up at module load.
export function primeVoices(): void {
  if (!("speechSynthesis" in window)) return;
  loadVoices();
  if (!voiceCache.length) {
    window.speechSynthesis.onvoiceschanged = () => {
      voiceCache = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
      personaVoiceMap.clear(); // re-assign now that real voices exist
    };
  }
}

/**
 * Pick the best available voice for a persona, honoring gender + hints,
 * and guaranteeing distinct voices across personas where possible.
 */
function selectVoice(persona: Persona): SpeechSynthesisVoice | null {
  if (personaVoiceMap.has(persona.id)) return personaVoiceMap.get(persona.id)!;

  const voices = loadVoices();
  if (!voices.length) return null;

  const used = new Set(Array.from(personaVoiceMap.values()).map((v) => v.name));
  const { gender, voiceHints } = persona.speech;

  // 1) Exact hint match (preferred named voices), unused first.
  for (const hint of voiceHints) {
    const hit = voices.find(
      (v) => v.name.toLowerCase().includes(hint.toLowerCase()) && !used.has(v.name)
    );
    if (hit) {
      personaVoiceMap.set(persona.id, hit);
      return hit;
    }
  }

  // 2) Gender-heuristic match, unused first.
  const femaleHints = ["female", "samantha", "victoria", "zira", "susan", "karen", "moira", "tessa", "fiona"];
  const maleHints = ["male", "daniel", "david", "alex", "fred", "mark", "george", "oliver", "thomas"];
  const wants = gender === "female" ? femaleHints : gender === "male" ? maleHints : [];
  const genderMatch = voices.find(
    (v) => wants.some((h) => v.name.toLowerCase().includes(h)) && !used.has(v.name)
  );
  if (genderMatch) {
    personaVoiceMap.set(persona.id, genderMatch);
    return genderMatch;
  }

  // 3) Any unused voice.
  const anyUnused = voices.find((v) => !used.has(v.name));
  const chosen = anyUnused ?? voices[0];
  personaVoiceMap.set(persona.id, chosen);
  return chosen;
}

// ============================================================
// Text-to-Speech — humanized cadence, pauses, emotion
// ============================================================

export type SpeakEmotion =
  | "neutral"
  | "engaged"
  | "impressed"
  | "skeptical"
  | "confused"
  | "impatient"
  | "annoyed"
  | "interrupting";

interface SpeakOptions {
  emotion?: SpeakEmotion;
  onStart?: () => void;
  onEnd?: () => void;
}

let speaking = false;
let cancelled = false;

/** Split into sentence-ish chunks so we can insert human pauses between them. */
function chunk(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?…])\s+|(?<=[—–-])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Emotion -> rate/pitch/pause modifiers, layered on the persona's base voice. */
function emotionProfile(emotion: SpeakEmotion) {
  switch (emotion) {
    case "interrupting": return { rate: 1.18, pitch: 1.06, gap: 60, pre: 0 };
    case "impatient":    return { rate: 1.14, pitch: 1.02, gap: 90, pre: 30 };
    case "annoyed":      return { rate: 1.1,  pitch: 0.95, gap: 110, pre: 40 };
    case "skeptical":    return { rate: 0.97, pitch: 0.96, gap: 200, pre: 160 };
    case "confused":     return { rate: 0.9,  pitch: 1.04, gap: 260, pre: 220 };
    case "engaged":      return { rate: 1.04, pitch: 1.05, gap: 140, pre: 60 };
    case "impressed":    return { rate: 1.0,  pitch: 1.08, gap: 170, pre: 90 };
    default:             return { rate: 1.0,  pitch: 1.0,  gap: 160, pre: 80 };
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Speak a persona line with natural pacing:
 * - persona-specific voice + base rate/pitch
 * - emotional modulation
 * - inter-sentence pauses (skeptics pause longer; impatient barely pause)
 * - slight per-sentence pitch jitter so it isn't monotone
 */
export async function speak(text: string, personaId: string, options: SpeakOptions = {}): Promise<void> {
  if (!("speechSynthesis" in window)) {
    options.onStart?.();
    options.onEnd?.();
    return;
  }

  window.speechSynthesis.cancel();
  cancelled = false;
  speaking = true;

  const persona = PERSONAS[personaId] as Persona | undefined;
  const sp = persona?.speech;
  const emo = emotionProfile(options.emotion ?? "neutral");
  const voice = persona ? selectVoice(persona) : null;

  const baseRate = sp?.baseRate ?? 1;
  const basePitch = sp?.basePitch ?? 1;
  const jitter = sp?.pitchJitter ?? 0.05;

  const sentences = chunk(text);
  options.onStart?.();

  // Tiny "beat" before speaking (a real person reacting) — skip when interrupting.
  if (emo.pre > 0) await wait(emo.pre);

  for (let i = 0; i < sentences.length; i++) {
    if (cancelled) break;
    const sentence = sentences[i];

    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(sentence);
      if (voice) u.voice = voice;
      u.rate = clampRate(baseRate * emo.rate);
      // jitter pitch slightly per sentence + emotion offset
      const jit = (Math.random() * 2 - 1) * jitter;
      u.pitch = clampPitch(basePitch * emo.pitch + jit);
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });

    if (cancelled) break;
    // Pause between sentences — longer after questions, shorter when impatient.
    if (i < sentences.length - 1) {
      const isQuestion = /[?]$/.test(sentence);
      await wait(emo.gap + (isQuestion ? 120 : 0));
    }
  }

  speaking = false;
  if (!cancelled) options.onEnd?.();
}

function clampRate(r: number) { return Math.max(0.5, Math.min(1.6, r)); }
function clampPitch(p: number) { return Math.max(0.4, Math.min(1.8, p)); }

export function stopSpeaking(): void {
  cancelled = true;
  speaking = false;
  window.speechSynthesis.cancel();
}

export function isSpeaking(): boolean {
  return speaking || window.speechSynthesis.speaking;
}

// ============================================================
// Support detection
// ============================================================

export function isSpeechRecognitionSupported(): boolean {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function isSpeechSynthesisSupported(): boolean {
  return "speechSynthesis" in window;
}
