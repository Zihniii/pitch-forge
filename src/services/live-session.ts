import type { SessionSetup } from "@/types";
import { PERSONAS, PRESSURE_LEVELS, SCENARIOS } from "@/lib/constants";
import { startMicCapture, AudioPlayer, type MicCaptureHandle } from "./live-audio";

// ============================================================
// Gemini Live session — real-time voice via server WebSocket
// proxy. API keys stay server-side.
// ============================================================

const LIVE_MODEL_CANDIDATES = [
  "gemini-live-2.5-flash-preview",
  "gemini-2.5-flash-preview-native-audio-dialog",
  "gemini-2.0-flash-live-001",
  "gemini-2.0-flash-exp",
];

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

export interface LiveCallbacks {
  onUserText: (text: string) => void;
  onPersonaText: (text: string) => void;
  onPersonaSpeakingStart: () => void;
  onPersonaSpeakingEnd: () => void;
  onInterrupted: () => void;
  onTurnComplete: () => void;
  onError: (msg: string) => void;
  onOpen: () => void;
  onClose: () => void;
}

export class LiveSession {
  private ws: WebSocket | null = null;
  private mic: MicCaptureHandle | null = null;
  private player: AudioPlayer;
  private setup: SessionSetup;
  private cb: LiveCallbacks;
  private closed = false;
  private muted = false;

  constructor(setup: SessionSetup, cb: LiveCallbacks) {
    this.setup = setup;
    this.cb = cb;
    this.player = new AudioPlayer();
  }

  getInputLevel(): number {
    return this.mic?.getLevel() ?? 0;
  }

  isPersonaSpeaking(): boolean {
    return this.player.playing;
  }

  async start(): Promise<void> {
    await this.player.resume();

    // 1) Request mic first so a permission failure surfaces clearly.
    try {
      this.mic = await startMicCapture((b64) => {
        if (this.closed || this.muted || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        // Send audio as binary
        const binary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        this.ws.send(binary);
      });
      console.log("[Live] mic capture started");
    } catch (e: any) {
      console.error("[Live] mic capture failed:", e);
      throw e;
    }

    // 2) Connect to the server WS proxy.
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.hostname}:3001/api/live`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("[Live] WS connected to proxy");

      // Send the start message with session config.
      const systemInstruction = buildSystemInstruction(this.setup);
      const voiceName = voiceFor(this.setup.persona);
      this.ws!.send(JSON.stringify({
        type: "start",
        systemInstruction,
        voiceName,
      }));
    };

    this.ws.onmessage = (event) => {
      if (this.closed) return;

      // Binary = audio chunk from Gemini
      if (event.data instanceof Blob) {
        event.data.arrayBuffer().then((buf) => {
          const b64 = arrayBufferToBase64(buf);
          this.player.enqueue(b64, () => {
            if (!this.player.playing) {
              this.cb.onPersonaSpeakingEnd();
            }
          });
        });
        return;
      }

      // Text = JSON message
      try {
        const msg = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onerror = (e) => {
      console.error("[Live] WS error:", e);
    };

    this.ws.onclose = () => {
      console.log("[Live] WS closed");
      if (!this.closed) {
        this.cb.onClose();
      }
    };

    // Wait for the "open" confirmation from the server
    await new Promise<void>((resolve, reject) => {
      const onMsg = (event: MessageEvent) => {
        if (typeof event.data !== "string") return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "open") {
            this.ws?.removeEventListener("message", onMsg);
            this.cb.onOpen();
            resolve();
          }
          if (msg.type === "error") {
            this.ws?.removeEventListener("message", onMsg);
            reject(new Error(msg.message));
          }
        } catch {}
      };
      this.ws?.addEventListener("message", onMsg);

      // Timeout after 15 seconds.
      setTimeout(() => {
        this.ws?.removeEventListener("message", onMsg);
        reject(new Error("Live API connection timed out"));
      }, 15000);
    });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  private handleMessage(msg: any) {
    switch (msg.type) {
      case "user_text":
        this.cb.onUserText(msg.text);
        break;
      case "persona_text":
        this.cb.onPersonaText(msg.text);
        break;
      case "speaking_start":
        this.cb.onPersonaSpeakingStart();
        break;
      case "speaking_end":
        this.cb.onPersonaSpeakingEnd();
        break;
      case "interrupted":
        this.player.flush();
        this.cb.onInterrupted();
        this.cb.onPersonaSpeakingEnd();
        break;
      case "turn_complete":
        this.cb.onTurnComplete();
        break;
      case "error":
        this.cb.onError(msg.message);
        break;
      case "close":
        this.cb.onClose();
        break;
    }
  }

  stop() {
    this.closed = true;
    try { this.mic?.stop(); } catch { /* noop */ }
    try { this.player.close(); } catch { /* noop */ }
    try {
      if (this.ws) {
        this.ws.send(JSON.stringify({ type: "stop" }));
        this.ws.close();
      }
    } catch { /* noop */ }
    this.ws = null;
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
