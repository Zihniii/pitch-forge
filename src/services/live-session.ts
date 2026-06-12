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
// Names differ across API versions and change often; we try these in order
// and use whichever the connected key actually supports.
const LIVE_MODEL_CANDIDATES = [
  "gemini-live-2.5-flash-preview",
  "gemini-2.5-flash-preview-native-audio-dialog",
  "gemini-2.0-flash-live-001",
  "gemini-2.0-flash-exp",
];

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
  private aiBeta: GoogleGenAI;
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
    // Live preview models are served on the v1alpha API version; the SDK
    // defaults to v1beta (which is why bidiGenerateContent was "not found").
    this.ai = new GoogleGenAI({ apiKey, apiVersion: "v1alpha" });
    this.aiBeta = new GoogleGenAI({ apiKey, apiVersion: "v1beta" });
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

    // 1) Request mic FIRST so a permission failure surfaces clearly before connecting.
    try {
      this.mic = await startMicCapture((b64) => {
        if (this.closed || this.muted || !this.session) return;
        try {
          this.session.sendRealtimeInput({
            audio: { data: b64, mimeType: "audio/pcm;rate=16000" },
          });
        } catch {
          /* socket may be momentarily closed during reconnection */
        }
      });
      console.log("[Live] mic capture started");
    } catch (e: any) {
      console.error("[Live] mic capture failed:", e);
      throw e;
    }

    // 2) Try each (apiVersion × model) combo until one connects.
    const attempts: { label: string; client: GoogleGenAI; model: string }[] = [];
    for (const model of LIVE_MODEL_CANDIDATES) {
      attempts.push({ label: `v1alpha/${model}`, client: this.ai, model });
    }
    for (const model of LIVE_MODEL_CANDIDATES) {
      attempts.push({ label: `v1beta/${model}`, client: this.aiBeta, model });
    }

    let lastErr = "";
    for (const a of attempts) {
      try {
        console.log("[Live] trying:", a.label);
        await this.connectModel(a.client, a.model);
        console.log("[Live] connected:", a.label);
        return; // success
      } catch (e: any) {
        lastErr = e?.message ?? String(e);
        console.warn(`[Live] ${a.label} failed: ${lastErr}`);
      }
    }
    throw new Error(
      `Live API unavailable on this key (tried v1alpha + v1beta). Last error: ${lastErr}`
    );
  }

  /**
   * Connect to a single model on a given client. Resolves once the session is
   * confirmed open (setupComplete). Rejects if the socket closes early
   * (e.g. "model not found"), so the caller can try the next combo.
   */
  private connectModel(client: GoogleGenAI, model: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const ok = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const fail = (msg: string) => {
        if (!settled) {
          settled = true;
          reject(new Error(msg));
        }
      };

      client.live
        .connect({
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: buildSystemInstruction(this.setup),
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voiceFor(this.setup.persona) },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
          },
          callbacks: {
            onopen: () => {
              console.log("[Live] socket open for", model);
            },
            onmessage: (msg: any) => {
              // First real message (setupComplete) confirms the model is valid.
              if (msg?.setupComplete && !settled) {
                ok();
                this.cb.onOpen();
                try {
                  this.session?.sendClientContent({
                    turns: "Begin now. Greet me briefly in character and hit me with your opening challenge.",
                    turnComplete: true,
                  });
                } catch (e) {
                  console.error("[Live] opening nudge failed:", e);
                }
              }
              try {
                this.handleMessage(msg);
              } catch (e) {
                console.error("[Live] handleMessage error:", e);
              }
            },
            onerror: (e: any) => {
              const m = e?.message ?? "Live connection error";
              if (!settled) fail(m);
              else this.cb.onError(m);
            },
            onclose: (e: any) => {
              const reason = e?.reason ?? "";
              console.log("[Live] connection closed:", reason);
              // Early close before confirmation = this model is unusable.
              if (!settled) {
                fail(reason || "Connection closed before setup");
              } else {
                this.cb.onClose();
              }
            },
          },
        })
        .then((session) => {
          this.session = session;
        })
        .catch((e: any) => fail(e?.message ?? String(e)));
    });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  private handleMessage(msg: any) {
    if (msg?.setupComplete) console.log("[Live] setupComplete");
    const sc = msg.serverContent;
    if (!sc) return;

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
