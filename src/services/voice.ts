import { GoogleGenAI } from "@google/genai";
import { PERSONAS } from "@/lib/constants";
import { base64ToArrayBuffer } from "./live-audio";
import { speak as browserSpeak, stopSpeaking as browserStop, primeVoices } from "./speech";
import type { SpeakEmotion } from "./speech";

// ============================================================
// Voice layer — Gemini TTS with automatic browser-TTS fallback.
// Gemini TTS gives expressive, distinct, human voices. If the
// model isn't available on the key (or any call fails), we fall
// back to the Web Speech API so the persona ALWAYS speaks.
// ============================================================

const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const TTS_SAMPLE_RATE = 24000;

// Persona → Gemini prebuilt TTS voice (distinct character per opponent).
const TTS_VOICE: Record<string, string> = {
  "friendly-angel": "Puck",
  "skeptical-vc": "Charon",
  "growth-investor": "Kore",
  "technical-investor": "Orus",
  "technical-recruiter": "Leda",
  "hiring-manager": "Charon",
  "staff-engineer": "Fenrir",
  "pm-interviewer": "Aoede",
  "enterprise-buyer": "Orus",
  "skeptical-prospect": "Fenrir",
  "procurement-officer": "Kore",
  ceo: "Zephyr",
  "board-member": "Charon",
  "exec-stakeholder": "Aoede",
  "hackathon-judge": "Puck",
  "conference-moderator": "Aoede",
  "media-interviewer": "Charon",
  "early-adopter": "Leda",
  "angry-customer": "Fenrir",
  "confused-customer": "Kore",
};

// Emotion → spoken-style directive Gemini TTS understands (it does NOT read
// the directive aloud — it shapes delivery).
function styleFor(emotion: SpeakEmotion | undefined, personaId: string): string {
  const persona = PERSONAS[personaId];
  const pace = persona?.speech?.pace ?? "measured";
  switch (emotion) {
    case "interrupting": return "sharply, cutting in, impatient";
    case "impatient": return "impatiently, clipped";
    case "annoyed": return "with irritation";
    case "skeptical": return "skeptically, with doubt";
    case "confused": return "slowly, sounding confused";
    case "engaged": return "with interest, leaning in";
    case "impressed": return "warmly, mildly impressed";
    default: return `in a natural ${pace} tone`;
  }
}

let genai: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!genai) {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error("VITE_GEMINI_API_KEY is not set");
    genai = new GoogleGenAI({ apiKey });
  }
  return genai;
}

// Whether Gemini TTS is usable on this key. null = unknown (try it).
let geminiTtsAvailable: boolean | null = null;

// Shared playback context + current source so we can cancel.
let audioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let speakToken = 0;

function getCtx(): AudioContext {
  if (!audioCtx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AC();
  }
  return audioCtx;
}

/** Must be called from a user gesture to satisfy autoplay policies. */
export async function primeVoice(): Promise<void> {
  primeVoices(); // warm browser TTS voice list for the fallback path
  try {
    const ctx = getCtx();
    if (ctx.state === "suspended") await ctx.resume();
  } catch {
    /* noop */
  }
}

async function geminiTTS(text: string, personaId: string, emotion?: SpeakEmotion): Promise<ArrayBuffer | null> {
  try {
    const voiceName = TTS_VOICE[personaId] ?? "Charon";
    const style = styleFor(emotion, personaId);
    const res = await ai().models.generateContent({
      model: TTS_MODEL,
      contents: `Say ${style}: ${text}`,
      config: {
        responseModalities: ["AUDIO" as any],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
      },
    });
    const data =
      (res as any)?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!data) return null;
    return base64ToArrayBuffer(data);
  } catch (e) {
    console.warn("[voice] Gemini TTS failed, will fall back:", (e as any)?.message ?? e);
    return null;
  }
}

function playPcm(buf: ArrayBuffer, token: number, onEnd?: () => void) {
  const ctx = getCtx();
  const int16 = new Int16Array(buf);
  const float = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float[i] = int16[i] / 0x8000;

  const audioBuffer = ctx.createBuffer(1, float.length, TTS_SAMPLE_RATE);
  audioBuffer.copyToChannel(float, 0);

  const src = ctx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(ctx.destination);
  src.onended = () => {
    if (currentSource === src) currentSource = null;
    if (token === speakToken) onEnd?.();
  };
  currentSource = src;
  src.start();
}

export interface SpeakOpts {
  emotion?: SpeakEmotion;
  onStart?: () => void;
  onEnd?: () => void;
}

/**
 * Speak a line as the persona. Tries Gemini TTS; falls back to browser TTS.
 * Cancels any in-flight speech first.
 */
export async function speakLine(text: string, personaId: string, opts: SpeakOpts = {}): Promise<void> {
  cancelSpeech();
  const token = ++speakToken;
  opts.onStart?.();

  // Try Gemini TTS unless we already know it's unavailable.
  if (geminiTtsAvailable !== false) {
    const pcm = await geminiTTS(text, personaId, opts.emotion);
    if (token !== speakToken) return; // superseded
    if (pcm) {
      geminiTtsAvailable = true;
      try {
        await primeVoice();
        playPcm(pcm, token, opts.onEnd);
        return;
      } catch (e) {
        console.warn("[voice] PCM playback failed, falling back:", e);
      }
    } else {
      // First failure marks it unavailable so we don't keep paying the latency.
      if (geminiTtsAvailable === null) geminiTtsAvailable = false;
    }
  }

  // Fallback: browser TTS (persona cadence handled inside speech.ts).
  if (token !== speakToken) return;
  browserSpeak(text, personaId, { emotion: opts.emotion, onEnd: opts.onEnd });
}

export function cancelSpeech(): void {
  speakToken++;
  if (currentSource) {
    try { currentSource.stop(); } catch { /* noop */ }
    currentSource = null;
  }
  browserStop();
}

export function isGeminiVoiceActive(): boolean {
  return geminiTtsAvailable === true;
}
