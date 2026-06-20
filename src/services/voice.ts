import { PERSONAS } from "@/lib/constants";
import { base64ToArrayBuffer } from "./live-audio";
import { speak as browserSpeak, stopSpeaking as browserStop, primeVoices } from "./speech";
import type { SpeakEmotion } from "./speech";

// ============================================================
// Voice layer — Gemini TTS via server proxy (keys stay
// server-side), with automatic browser-TTS fallback.
// ============================================================

const TTS_SAMPLE_RATE = 24000;

// Persona → Gemini prebuilt TTS voice (mirrors server mapping).
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

// Whether Gemini TTS is usable. null = unknown (try it).
let geminiTtsAvailable: boolean | null = null;

// Shared playback context.
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
  primeVoices();
  try {
    const ctx = getCtx();
    if (ctx.state === "suspended") await ctx.resume();
  } catch { /* noop */ }
}

async function geminiTTS(text: string, personaId: string, emotion?: SpeakEmotion): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, personaId, emotion }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.audio) return null;
    return base64ToArrayBuffer(data.audio);
  } catch (e) {
    console.warn("[voice] Gemini TTS proxy failed:", (e as any)?.message ?? e);
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
 * Speak a line as the persona. Tries Gemini TTS (via proxy); falls back to browser TTS.
 * Cancels any in-flight speech first.
 */
export async function speakLine(text: string, personaId: string, opts: SpeakOpts = {}): Promise<void> {
  cancelSpeech();
  const token = ++speakToken;
  opts.onStart?.();

  if (geminiTtsAvailable !== false) {
    const pcm = await geminiTTS(text, personaId, opts.emotion);
    if (token !== speakToken) return;
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
      if (geminiTtsAvailable === null) geminiTtsAvailable = false;
    }
  }

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
