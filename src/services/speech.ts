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

export function startListening(callbacks: SpeechRecognitionCallbacks): boolean {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    callbacks.onError("Speech recognition is not supported in this browser. Please use Chrome.");
    return false;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    // Reset silence timer on any speech
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(callbacks.onSilence, 3500);

    let finalTranscript = "";
    let interimTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += result[0].transcript;
      } else {
        interimTranscript += result[0].transcript;
      }
    }

    if (finalTranscript) {
      callbacks.onResult(finalTranscript, true);
    } else if (interimTranscript) {
      callbacks.onResult(interimTranscript, false);
    }
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
  // Start silence timer immediately
  silenceTimer = setTimeout(callbacks.onSilence, 3500);
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
// Text-to-Speech (SpeechSynthesis API)
// ============================================================

let currentUtterance: SpeechSynthesisUtterance | null = null;

export function speak(
  text: string,
  personaId: string,
  onEnd?: () => void
): void {
  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  const persona = PERSONAS[personaId] as Persona | undefined;
  const utterance = new SpeechSynthesisUtterance(text);

  // Apply persona voice config
  if (persona?.voiceConfig) {
    utterance.rate = persona.voiceConfig.rate;
    utterance.pitch = persona.voiceConfig.pitch;
  }

  // Try to select a voice
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    // Prefer English voices
    const englishVoices = voices.filter((v) => v.lang.startsWith("en"));
    if (persona?.voiceConfig.voiceName) {
      const match = voices.find((v) =>
        v.name.toLowerCase().includes(persona.voiceConfig.voiceName!.toLowerCase())
      );
      if (match) utterance.voice = match;
    } else if (englishVoices.length > 0) {
      // Assign different voice indices based on persona for differentiation
      const personaIds = Object.keys(PERSONAS);
      const idx = personaIds.indexOf(personaId);
      utterance.voice = englishVoices[idx % englishVoices.length];
    }
  }

  utterance.onend = () => {
    currentUtterance = null;
    onEnd?.();
  };

  utterance.onerror = () => {
    currentUtterance = null;
    onEnd?.();
  };

  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  window.speechSynthesis.cancel();
  currentUtterance = null;
}

export function isSpeaking(): boolean {
  return window.speechSynthesis.speaking;
}

// ============================================================
// Speech Support Detection
// ============================================================

export function isSpeechRecognitionSupported(): boolean {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function isSpeechSynthesisSupported(): boolean {
  return "speechSynthesis" in window;
}
