import { GoogleGenAI, Modality } from "@google/genai";
import type { Session } from "@google/genai";
import type { SessionSetup } from "@/types";
import { PERSONAS, PRESSURE_LEVELS, SCENARIOS } from "@/lib/constants";
import { startMicCapture, AudioPlayer, type MicCaptureHandle } from "./live-audio";

// ============================================================
// Gemini Live session — real-time voice with native audio,
// built-in VAD and barge-in. One WebSocket does STT+LLM+TTS.
// ============================================================

// Native-audio dialog model (free tier on AI Studio).
const LIVE_MODEL = "gemini-2.0-flash-live-001";

// Map each persona to a distinct Live prebuilt voice for character variety.
// Live voices: Puck, Charon, Kore, Fenrir, Aoede, Leda, Orus, Zephyr.
const LIVE_VOICE_BY_PERSONA: Record<string, string> = {
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

function voiceFor(personaId: string): string {
  return LIVE_VOICE_BY_PERSONA[personaId] ?? "Charon";
}

function buildSystemInstruction(setup: SessionSetup): string {
  const persona = PERSONAS[setup.persona];
  const pressure = PRESSURE_LEVELS.find((p) => p.id === setup.pressureLevel)!;
  const scenario = SCENARIOS.find((s) => s.id === setup.scenario);

  const pressureGuide =
    setup.pressureLevel === "brutal"
      ? "Be relentless, dismissive, and hard to win over. Interrupt often."
      : setup.pressureLevel === "aggressive"
        ? "Push hard, give little benefit of the doubt, interrupt when they ramble."
        : setup.pressureLevel === "coaching"
          ? "Be tougher than a friend but fair; let them recover when they stumble."
          : "Be a realistic, well-prepared professional who has heard many pitches.";

  return `You ARE ${persona.name}, a real ${persona.title}. This is a LIVE, spoken, high-stakes ${scenario?.name ?? "conversation"}. You are NOT an AI or an assistant. You are a specific human being with your own agenda, evaluating the person in front of you.

WHO YOU ARE:
${persona.archetype}
${persona.behavioralProfile}

YOUR GOALS:
${persona.goals.map((g) => `- ${g}`).join("\n")}

PERSONALITY: ${persona.personalityTraits.join(", ")}.
HOW YOU TALK: ${persona.communicationStyle}
WHAT SETS YOU OFF: ${persona.pressureTriggers.join("; ")}.
HOW YOUR OBJECTIONS ESCALATE (advance through these — never repeat the same one):
${persona.objectionPatterns.map((o, i) => `  ${i + 1}. ${o}`).join("\n")}
PHRASES THAT SOUND LIKE YOU (vary them, never robotic): ${persona.signaturePhrases.join(" / ")}
EMOTIONAL RANGE: ${persona.emotionalRange}

THE PERSON ACROSS FROM YOU:
- ${setup.nameAndRole}
- Pitching: ${setup.productDescription}
- Wants you to believe: ${setup.valueProposition}

PRESSURE SETTING: ${pressure.name}. ${pressureGuide}

HOW TO BEHAVE IN THIS LIVE CONVERSATION:
- Speak in SHORT, punchy turns — one reaction plus one pointed question or demand. Real people under pressure are brief.
- React to what they ACTUALLY just said. Reference their words. Never generic.
- ADVANCE every turn: new angle, new objection, or a sharper follow-up. NEVER re-ask something you already asked. If they dodge twice, call it out and pivot.
- Judge their COMMUNICATION (clarity, conviction, structure) — not whether the business is a good idea.
- Sound human: contractions, natural rhythm, the occasional fragment. Show real emotion — skepticism, interest, impatience.
- This is a short, intense exchange (roughly 6–10 exchanges). Once you've tested their key claims, move toward a decision and wrap up with a clear closing line in character.
- Open by greeting them in your style and immediately putting them on the spot about THEIR specific pitch.
- Stay 100% in character at all times. Never mention being an AI, a model, or a simulation.`;
}

// ============================================================
// Session wrapper
// ============================================================

export interface LiveCallbacks {
  onUserText: (text: string) => void;       // streamed input transcription
  onPersonaText: (text: string) => void;    // streamed output transcription
  onPersonaSpeakingStart: () => void;
  onPersonaSpeakingEnd: () => void;
  onInterrupted: () => void;                 // model output interrupted (barge-in)
  onTurnComplete: () => void;
  onError: (msg: string) => void;
  onOpen: () => void;
  onClose: () => void;
}

export class LiveSession {
  private ai: GoogleGenAI;
  private session: Session | null = null;
  private mic: MicCaptureHandle | null = null;
  private player: AudioPlayer;
  private setup: SessionSetup;
  private cb: LiveCallbacks;
  private closed = false;
  private speaking = false;
  private muted = false;

  constructor(setup: SessionSetup, cb: LiveCallbacks) {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error("VITE_GEMINI_API_KEY is not set");
    this.ai = new GoogleGenAI({ apiKey });
    this.setup = setup;
    this.cb = cb;
    this.player = new AudioPlayer();
  }

  getInputLevel(): number {
    return this.mic?.getLevel() ?? 0;
  }

  isPersonaSpeaking(): boolean {
    return this.speaking || this.player.playing;
  }

  async start(): Promise<void> {
    await this.player.resume();

    this.session = await this.ai.live.connect({
      model: LIVE_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: buildSystemInstruction(this.setup),
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceFor(this.setup.persona) },
          },
        },
        // Keep text transcripts of both sides for the feedback engine.
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => {
          this.cb.onOpen();
          // Nudge the persona to open the conversation.
          this.session?.sendClientContent({
            turns: [{ role: "user", parts: [{ text: "[The candidate has just sat down. Begin the conversation now — greet them and hit them with your opening challenge.]" }] }],
            turnComplete: true,
          });
        },
        onmessage: (msg: any) => this.handleMessage(msg),
        onerror: (e: any) => this.cb.onError(e?.message ?? "Live connection error"),
        onclose: () => {
          this.cb.onClose();
        },
      },
    });

    // Begin streaming mic audio upstream.
    this.mic = await startMicCapture((b64) => {
      if (this.closed || this.muted || !this.session) return;
      this.session.sendRealtimeInput({
        audio: { data: b64, mimeType: "audio/pcm;rate=16000" },
      });
    });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  private handleMessage(msg: any) {
    const sc = msg.serverContent;

    // Barge-in: model was cut off because the user started talking.
    if (sc?.interrupted) {
      this.player.flush();
      this.speaking = false;
      this.cb.onInterrupted();
      this.cb.onPersonaSpeakingEnd();
      return;
    }

    // Streamed audio out.
    const parts = sc?.modelTurn?.parts ?? [];
    for (const part of parts) {
      const audio = part.inlineData?.data;
      if (audio) {
        if (!this.speaking) {
          this.speaking = true;
          this.cb.onPersonaSpeakingStart();
        }
        this.player.enqueue(audio, () => {
          if (!this.player.playing) {
            this.speaking = false;
            this.cb.onPersonaSpeakingEnd();
          }
        });
      }
    }

    // Transcriptions (for the transcript / feedback).
    if (sc?.outputTranscription?.text) {
      this.cb.onPersonaText(sc.outputTranscription.text);
    }
    if (sc?.inputTranscription?.text) {
      this.cb.onUserText(sc.inputTranscription.text);
    }

    if (sc?.turnComplete) {
      this.cb.onTurnComplete();
    }
  }

  stop() {
    this.closed = true;
    try { this.mic?.stop(); } catch { /* noop */ }
    try { this.player.close(); } catch { /* noop */ }
    try { this.session?.close(); } catch { /* noop */ }
    this.session = null;
  }
}
