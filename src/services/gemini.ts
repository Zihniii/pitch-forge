import type {
  CognitiveState,
  ConversationTurn,
  SessionSetup,
  Persona,
  SessionFeedback,
} from "@/types";
import { PERSONAS, PRESSURE_LEVELS, SCENARIOS } from "@/lib/constants";
import { generateJSON, RateLimitError } from "./llm";

// Re-export so existing imports keep working.
export { RateLimitError };

// ============================================================
// Turn signals — REAL measured behavior, fed to the persona
// ============================================================

export interface TurnSignals {
  wpm: number;
  fillerCount: number;
  buzzwordCount: number;
  durationSec: number;
  wordCount: number;
  detectedBuzzwords: string[];
  detectedFillers: string[];
}

export interface InterruptionDirective {
  reason: string;
  message: string;
}

export interface PersonaTurnInput {
  setup: SessionSetup;
  state: CognitiveState;
  transcript: ConversationTurn[];
  signals?: TurnSignals | null;
  interruption?: InterruptionDirective | null;
  askedQuestions: string[];
}

export interface PersonaResponse {
  reply: string;
  updatedState: CognitiveState;
  shouldEnd: boolean;
  endReason: string | null;
  /** Short label of the question/objection asked — feeds anti-repetition memory. */
  questionAsked: string | null;
  /** The persona's read of the user's last answer (drives deterministic state). */
  emotion: PersonaEmotion;
}

type PersonaEmotion =
  | "neutral"
  | "engaged"
  | "impressed"
  | "skeptical"
  | "confused"
  | "impatient"
  | "annoyed";

// What the LLM returns — its READ of the answer, not the authoritative state.
interface LLMTurnOutput {
  reply: string;
  questionAsked: string | null;
  read: {
    answerQuality: number; // 0-100: how clear/convincing the last answer was
    addressedQuestion: boolean;
    dodged: boolean;
    emotion: PersonaEmotion;
  };
  shouldEnd: boolean;
  endReason: string | null;
}

// ============================================================
// Deterministic State Engine
// State is OWNED by us, not the LLM. The LLM contributes a read
// of answer quality; real signals (fillers/buzzwords/wpm/rambling)
// contribute measurable pressure. Everything is clamped + grounded.
// This fixes state drift and makes pressure earn itself.
// ============================================================

const clamp = (n: number, lo = 0, hi = 10) => Math.max(lo, Math.min(hi, n));

function computeNextState(
  prev: CognitiveState,
  read: LLMTurnOutput["read"],
  signals: TurnSignals | null,
  pressureMultiplier: number
): CognitiveState {
  const m = { ...prev.stateMetrics };
  m.currentTurnCount += 1;

  const q = read.answerQuality; // 0-100
  // Quality maps to a -1..+1 swing around the 55 midpoint.
  const qualitySwing = (q - 55) / 45;

  // --- Trust ---
  // Gains are harder under pressure; losses are amplified.
  let trustDelta = qualitySwing > 0
    ? qualitySwing * 1.4 / pressureMultiplier
    : qualitySwing * 1.6 * pressureMultiplier;
  if (read.dodged) trustDelta -= 1.0 * pressureMultiplier;
  if (read.emotion === "impressed") trustDelta += 0.8;
  m.trustLevel = clamp(m.trustLevel + trustDelta);

  // --- Interest --- natural decay each turn + reaction to quality
  let interestDelta = -0.4; // attention is a depleting resource
  interestDelta += qualitySwing * 1.3;
  if (read.emotion === "engaged" || read.emotion === "impressed") interestDelta += 1.2;
  if (read.emotion === "impatient" || read.emotion === "annoyed") interestDelta -= 1.0;
  m.interestLevel = clamp(m.interestLevel + interestDelta);

  // --- Confusion --- driven by jargon, low quality, and stated confusion
  let confusionDelta = -0.6; // clears slightly by default
  if (signals) {
    if (signals.buzzwordCount >= 2) confusionDelta += signals.buzzwordCount * 0.7;
  }
  if (q < 40) confusionDelta += 1.6;
  if (read.emotion === "confused") confusionDelta += 1.8;
  m.confusionLevel = clamp(m.confusionLevel + confusionDelta);

  // --- Stutter / hesitation events ---
  const stutter = signals
    ? signals.fillerCount >= 3 || (signals.wpm > 0 && signals.wpm < 80 && signals.durationSec > 12)
    : false;
  m.consecutiveStutterEvents = stutter ? m.consecutiveStutterEvents + 1 : 0;

  // --- Linguistic tracking ---
  const lt = {
    detectedBuzzwords: [...prev.linguisticTracking.detectedBuzzwords],
    trackedFillers: [...prev.linguisticTracking.trackedFillers],
    averageWpm: prev.linguisticTracking.averageWpm,
  };
  if (signals) {
    lt.detectedBuzzwords = Array.from(
      new Set([...lt.detectedBuzzwords, ...signals.detectedBuzzwords])
    );
    lt.trackedFillers = [...lt.trackedFillers, ...signals.detectedFillers];
    if (signals.wpm > 0) {
      // rolling average of user WPM
      const userTurns = prev.stateMetrics.currentTurnCount; // turns before this one
      lt.averageWpm =
        userTurns > 0
          ? Math.round((lt.averageWpm * userTurns + signals.wpm) / (userTurns + 1))
          : signals.wpm;
    }
  }

  return {
    ...prev,
    stateMetrics: m,
    linguisticTracking: lt,
  };
}

// ============================================================
// System Prompt — rich persona embodiment
// ============================================================

function describeState(s: CognitiveState): string {
  const { trustLevel, interestLevel, confusionLevel, consecutiveStutterEvents } = s.stateMetrics;
  const band = (v: number, low: string, mid: string, high: string) =>
    v <= 3 ? low : v <= 6 ? mid : high;
  return [
    `- Trust in them: ${trustLevel}/10 (${band(trustLevel, "low — you doubt them", "cautious", "high — you believe them")})`,
    `- Your interest: ${interestLevel}/10 (${band(interestLevel, "fading — you want to wrap up", "moderate", "high — you're leaning in")})`,
    `- Your confusion: ${confusionLevel}/10 (${band(confusionLevel, "clear", "some fog", "very confused — push hard for clarity")})`,
    consecutiveStutterEvents >= 2
      ? `- They have hesitated ${consecutiveStutterEvents} turns in a row — acknowledge it.`
      : ``,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPersonaPrompt(input: PersonaTurnInput): string {
  const { setup, state, transcript, signals, interruption, askedQuestions } = input;
  const persona = PERSONAS[setup.persona];
  const pressure = PRESSURE_LEVELS.find((p) => p.id === setup.pressureLevel)!;
  const scenario = SCENARIOS.find((sc) => sc.id === setup.scenario);
  const isOpening = transcript.length === 0;

  const history = transcript
    .map((t) => `[Turn ${t.id}] ${t.role === "user" ? setup.nameAndRole.split(",")[0] || "THEM" : persona.name}: ${t.content}`)
    .join("\n");

  const signalBlock = signals
    ? `MEASURED DELIVERY of their last answer (objective facts — react if relevant, do not quote the numbers):
- Speaking pace: ${signals.wpm} wpm ${signals.wpm < 90 ? "(hesitant/slow)" : signals.wpm > 175 ? "(rushed)" : "(normal)"}
- Filler words: ${signals.fillerCount}${signals.detectedFillers.length ? ` (${signals.detectedFillers.slice(0, 5).join(", ")})` : ""}
- Buzzwords/jargon: ${signals.buzzwordCount}${signals.detectedBuzzwords.length ? ` (${signals.detectedBuzzwords.join(", ")})` : ""}
- Answer length: ${signals.wordCount} words over ${Math.round(signals.durationSec)}s`
    : "";

  const interruptBlock = interruption
    ? `*** INTERRUPT NOW ***
They just triggered: ${interruption.reason}.
You CUT THEM OFF mid-thought. Your reply MUST open as an interruption — sharp, in your voice — reacting to exactly this behavior. Do not let them finish. Reference what they were doing (e.g. the hesitation, the buzzwords, the rambling). Keep it to ONE punchy sentence, then a demand.
Suggested energy (rephrase in your own voice): "${interruption.message}"`
    : "";

  const askedBlock = askedQuestions.length
    ? `QUESTIONS YOU'VE ALREADY ASKED (do NOT repeat these — escalate to a NEW angle instead):
${askedQuestions.map((q) => `- ${q}`).join("\n")}`
    : "";

  const openingGuide = isOpening
    ? `THIS IS THE OPENING. Greet them in YOUR style and immediately put them on the spot about THEIR specific pitch. Use the context below — name their product or role. Pick the spirit of one of your opening lines and adapt it to them:
${persona.openingLines.map((l) => `  • "${l}"`).join("\n")}`
    : "";

  // --- Progression awareness (anti-loop) ---
  const userTurnCount = transcript.filter((t) => t.role === "user").length;
  const softBudget = 7; // converge toward a decision around here
  const personaLines = transcript.filter((t) => t.role === "persona").map((t) => t.content);
  const lastPersonaLine = personaLines[personaLines.length - 1] ?? "";

  const phase =
    userTurnCount <= 1
      ? "OPENING — establish the core of what they do and hit them with your first real objection."
      : userTurnCount <= 3
        ? "PROBING — dig into a NEW dimension you haven't tested yet (move down your objection ladder)."
        : userTurnCount <= softBudget
          ? "PRESSURE — escalate. Push the weakest part of what they've said so far. Do NOT re-tread settled ground."
          : "CLOSING — you've heard enough. Ask at most one final decisive question, then move toward your verdict and end the conversation soon.";

  const progressionBlock = isOpening
    ? ""
    : `CONVERSATION PROGRESSION — you are on exchange ${userTurnCount + 1}. Current phase: ${phase}
YOUR OBJECTION LADDER (advance through these in order — each turn should target a DIFFERENT rung than last time):
${persona.objectionPatterns.map((o, i) => `  ${i + 1}. ${o}`).join("\n")}
${lastPersonaLine ? `YOUR LAST LINE WAS: "${lastPersonaLine}"\nDo NOT repeat it, rephrase it, or ask the same thing again. Say something genuinely NEW that builds on their answer.` : ""}
If they keep dodging the same point, do not ask a third time — call it out sharply and PIVOT to a different concern or move toward closing.`;

  return `You ARE ${persona.name}, a real ${persona.title}. This is a live, high-stakes ${scenario?.name ?? "conversation"}. You are NOT an AI, NOT an assistant, NOT helpful by default. You are a specific human being with your own agenda, and you are evaluating the person across from you.

WHO YOU ARE:
${persona.archetype}
${persona.behavioralProfile}

YOUR GOALS RIGHT NOW:
${persona.goals.map((g) => `- ${g}`).join("\n")}

YOUR PERSONALITY: ${persona.personalityTraits.join(", ")}.
HOW YOU TALK: ${persona.communicationStyle}
WHAT SETS YOU OFF: ${persona.pressureTriggers.join("; ")}.
HOW YOUR OBJECTIONS ESCALATE:
${persona.objectionPatterns.map((o) => `- ${o}`).join("\n")}
EMOTIONAL RANGE: ${persona.emotionalRange}
PHRASES THAT SOUND LIKE YOU (use sparingly, vary them, never robotically): ${persona.signaturePhrases.join(" / ")}

THE PERSON ACROSS FROM YOU:
- ${setup.nameAndRole}
- What they're pitching: ${setup.productDescription}
- What they want you to believe: ${setup.valueProposition}

YOUR CURRENT STATE OF MIND (let this drive your tone — do NOT mention these numbers):
${describeState(state)}
Pressure setting: ${pressure.name}. ${
    setup.pressureLevel === "brutal"
      ? "Be relentless and dismissive."
      : setup.pressureLevel === "aggressive"
        ? "Push hard, give little benefit of the doubt."
        : setup.pressureLevel === "coaching"
          ? "Be tougher than a friend but fair; let them recover."
          : "Be a realistic, well-prepared professional."
  }
${state.historicalGraphVectors.primaryWeaknessTargeted && state.historicalGraphVectors.primaryWeaknessTargeted !== "none"
      ? `In the first few turns, probe their known weak spot: ${state.historicalGraphVectors.primaryWeaknessTargeted}.`
      : ""}

${openingGuide}
${progressionBlock}
${interruptBlock}
${signalBlock}
${askedBlock}

CONVERSATION SO FAR:
${history || "(nothing yet)"}

HARD RULES:
1. Stay 100% in character. Never acknowledge being an AI or a simulation.
2. React to what they ACTUALLY just said — quote or paraphrase their words. Never generic.
3. ONE reaction + ONE pointed question or demand. Keep it to 1–2 sentences. Real people are brief and pointed under pressure.
4. ADVANCE THE CONVERSATION. Every turn must introduce a NEW angle, objection, or follow-up. NEVER repeat or rephrase a question you've already asked. If they answered well, acknowledge it and raise the bar; if they dodged twice, call it out and PIVOT — do not ask a third time.
5. Judge their COMMUNICATION (clarity, conviction, structure), not whether their business is a good idea.
6. Sound like speech, not writing: contractions, natural rhythm, occasional sentence fragments. No lists, no markdown.
7. Drive toward a decision. This is a short, intense exchange (about ${softBudget}–10 turns total), not an endless interview. Once you've tested their key claims, start closing. End the conversation (shouldEnd:true) when you've heard enough to decide, your interest is gone, or it has run long — and deliver a real closing line in character.

Return ONLY this JSON:
{
  "reply": "what you say out loud, in character (1-2 sentences)",
  "questionAsked": "3-6 word label of the question/objection you just raised, or null",
  "read": {
    "answerQuality": 0-100 (how clear & convincing THEIR last answer was; 55 is average; opening turn use 55),
    "addressedQuestion": true/false (did they actually answer what you asked),
    "dodged": true/false (did they evade or deflect),
    "emotion": "neutral|engaged|impressed|skeptical|confused|impatient|annoyed"
  },
  "shouldEnd": false,
  "endReason": null
}`;
}

// ============================================================
// Generate Persona Response
// ============================================================

export async function generatePersonaResponse(input: PersonaTurnInput): Promise<PersonaResponse> {
  const persona = PERSONAS[input.setup.persona];
  const pressure = PRESSURE_LEVELS.find((p) => p.id === input.setup.pressureLevel)!;
  // A touch more temperature for warm/expressive personas, less for clipped analytical ones.
  const temp = input.interruption ? 0.95 : 0.85;

  const prompt = buildPersonaPrompt(input);

  try {
    const raw = await generateJSON(prompt, temp, "fast");
    const out = parseJSON<LLMTurnOutput>(raw);

    if (!out || typeof out.reply !== "string" || !out.reply.trim()) {
      return fallbackTurn(input, persona, pressure.multiplier);
    }

    const read = out.read ?? { answerQuality: 55, addressedQuestion: true, dodged: false, emotion: "neutral" as PersonaEmotion };
    const reply = sanitizeReply(out.reply);

    // For the opening there's no user answer yet — don't move state on quality.
    const updatedState = input.transcript.length === 0
      ? advanceTurnOnly(input.state)
      : computeNextState(input.state, read, input.signals ?? null, pressure.multiplier);

    // Auto-end safeguards so conversations converge instead of looping.
    const userTurns = input.transcript.filter((t) => t.role === "user").length;
    const m = updatedState.stateMetrics;
    const interestDead = m.interestLevel <= 2 && userTurns >= 3;
    // A decision has effectively been reached: strong trust or fully lost, after a real exchange.
    const decisionReached =
      userTurns >= 7 && (m.trustLevel >= 8 || m.trustLevel <= 2 || m.interestLevel <= 3);
    // Hard ceiling — never drag past 10 user turns.
    const hardCap = userTurns >= 10;
    const shouldEnd = Boolean(out.shouldEnd) || interestDead || decisionReached || hardCap;

    return {
      reply,
      updatedState,
      shouldEnd,
      endReason:
        out.endReason ??
        (interestDead ? "Lost interest" : decisionReached ? "Decision reached" : hardCap ? "Time's up" : null),
      questionAsked: out.questionAsked?.trim() || null,
      emotion: read.emotion ?? "neutral",
    };
  } catch (err: any) {
    console.error("Persona turn failed:", err);
    // Rate-limit errors are already typed by the LLM layer — re-throw so the UI
    // shows a clear message instead of looping canned lines.
    if (err instanceof RateLimitError || err?.name === "RateLimitError") throw err;
    // Other transient errors: a single in-character fallback is acceptable.
    return fallbackTurn(input, persona, pressure.multiplier);
  }
}

function advanceTurnOnly(prev: CognitiveState): CognitiveState {
  return {
    ...prev,
    stateMetrics: { ...prev.stateMetrics, currentTurnCount: prev.stateMetrics.currentTurnCount + 1 },
  };
}

// In-character fallback (never reads JSON aloud).
function fallbackTurn(input: PersonaTurnInput, persona: Persona, pm: number): PersonaResponse {
  const isOpening = input.transcript.length === 0;
  const line = isOpening
    ? persona.openingLines[Math.floor(Math.random() * persona.openingLines.length)]
    : persona.signaturePhrases[Math.floor(Math.random() * persona.signaturePhrases.length)];
  const read = { answerQuality: 50, addressedQuestion: false, dodged: false, emotion: "neutral" as PersonaEmotion };
  return {
    reply: line,
    updatedState: isOpening
      ? advanceTurnOnly(input.state)
      : computeNextState(input.state, read, input.signals ?? null, pm),
    shouldEnd: false,
    endReason: null,
    questionAsked: null,
    emotion: "neutral",
  };
}

// ============================================================
// JSON helpers
// ============================================================

function parseJSON<T>(raw: string): T | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  // Grab the outermost JSON object if there's stray text.
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first > 0 || last < cleaned.length - 1) {
    if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

// Strip anything that looks like leaked JSON/markup so it's never spoken.
function sanitizeReply(reply: string): string {
  let r = reply.trim();
  // If a JSON object leaked in, try to recover the "reply" field.
  if (r.startsWith("{")) {
    const match = r.match(/"reply"\s*:\s*"([^"]+)"/);
    if (match) r = match[1];
  }
  r = r.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
  return r || "Go on.";
}

// ============================================================
// Feedback Engine — rich, evidence-grounded evaluation
// Uses REAL counts (passed in) instead of asking the LLM to recount.
// ============================================================

export interface FeedbackInputs {
  buzzwordCount: number;
  fillerCount: number;
  averageWpm: number;
  totalDuration: number;
  interruptionCount: number;
}

export async function generateSessionFeedback(
  setup: SessionSetup,
  transcript: ConversationTurn[],
  finalState: CognitiveState,
  measured: FeedbackInputs
): Promise<SessionFeedback> {
  const persona = PERSONAS[setup.persona];

  const userTurns = transcript.filter((t) => t.role === "user");
  const formatted = transcript
    .map((t) => `[Turn ${t.id}] ${t.role === "user" ? "THEM" : persona.name}: ${t.content}`)
    .join("\n");

  // List of valid user turn numbers so the model can only cite real turns.
  const userTurnNumbers = userTurns.map((t) => t.id);

  const prompt = `You are the evaluation engine for PitchForge — a communication flight simulator. You just observed a live ${SCENARIOS.find((s) => s.id === setup.scenario)?.name ?? "conversation"} between ${setup.nameAndRole.split(",")[0] || "the candidate"} and ${persona.name} (${persona.title}).

Your job: deliver a verdict that feels like a REAL outcome from ${persona.name}, backed by hard evidence from the transcript. Write the verdictLine and primaryReason in ${persona.name}'s voice.

ABSOLUTE RULES:
1. EVIDENCE ONLY. Every moment must cite a real USER turn number from this list: [${userTurnNumbers.join(", ")}]. Quote their actual words (verbatim or near-verbatim). If a category genuinely doesn't exist in the transcript, still pick the closest real turn — never invent a quote.
2. COMMUNICATION ONLY. Judge clarity, conviction, structure, authenticity, resilience, adaptability, brevity, persuasiveness. NEVER judge whether the business idea is good.
3. GROUNDED. Base everything only on what was actually said. No assumptions about the world outside the transcript.
4. Each moment needs: the quote, why it mattered (insight), and for weaknesses, a concrete "improvement" — exactly what to say differently.
5. Be specific and non-generic. "Be more confident" is banned. Say WHERE confidence broke and WHAT to do.

CONVERSATION STATE AT END: trust ${finalState.stateMetrics.trustLevel}/10, interest ${finalState.stateMetrics.interestLevel}/10, confusion ${finalState.stateMetrics.confusionLevel}/10.
MEASURED (use these EXACT numbers, do not recount): buzzwords=${measured.buzzwordCount}, fillers=${measured.fillerCount}, avgWpm=${measured.averageWpm}, durationSec=${Math.round(measured.totalDuration)}, interruptions=${measured.interruptionCount}.

VERDICT GUIDE (from ${persona.name}'s perspective and goals):
- YES: they earned it — clear, convincing, held up under your pressure.
- MAYBE: real potential but a critical weakness left you unconvinced.
- NO: communication broke down; you would not move forward.

TRANSCRIPT:
${formatted}

Return ONLY this JSON (no markdown):
{
  "verdict": "YES" | "NO" | "MAYBE",
  "verdictLine": "${persona.name}'s blunt one-sentence verdict, in their voice",
  "primaryReason": "the single biggest factor, citing a turn",
  "biggestWeakness": "the communication dimension that hurt them most, with evidence",
  "strongestMoment": { "turnNumber": <user turn#>, "content": "their quote", "explanation": "why it landed" },
  "weakestMoment": { "turnNumber": <user turn#>, "quote": "their quote", "insight": "why it hurt them", "improvement": "exactly what to say instead" },
  "turningPoint": { "turnNumber": <user turn#>, "quote": "their quote", "insight": "how the conversation shifted here (for better or worse)", "improvement": "how to control that moment next time" },
  "missedOpportunity": { "turnNumber": <user turn#>, "quote": "their quote", "insight": "the opening they failed to seize", "improvement": "what they should have said" },
  "mostConvincingAnswer": { "turnNumber": <user turn#>, "quote": "their quote", "insight": "why it moved you" },
  "mostDamagingAnswer": { "turnNumber": <user turn#>, "quote": "their quote", "insight": "why it cost them", "improvement": "the fix" },
  "replayChallenge": "one specific, actionable constraint for their next attempt",
  "dimensions": [
    { "dimension": "clarity", "score": 0-100, "evidence": "Turn X: ..." },
    { "dimension": "conviction", "score": 0-100, "evidence": "Turn X: ..." },
    { "dimension": "structure", "score": 0-100, "evidence": "Turn X: ..." },
    { "dimension": "authenticity", "score": 0-100, "evidence": "Turn X: ..." },
    { "dimension": "resilience", "score": 0-100, "evidence": "Turn X: ..." },
    { "dimension": "adaptability", "score": 0-100, "evidence": "Turn X: ..." },
    { "dimension": "brevity", "score": 0-100, "evidence": "Turn X: ..." },
    { "dimension": "persuasiveness", "score": 0-100, "evidence": "Turn X: ..." }
  ]
}`;

  const raw = await generateJSON(prompt, 0.6, "quality", { retries: 3 });
  const parsed = parseJSON<SessionFeedback>(raw);
  if (!parsed) throw new Error("Could not parse feedback");

  // Inject our REAL measured numbers — never trust the model to count.
  parsed.buzzwordCount = measured.buzzwordCount;
  parsed.fillerCount = measured.fillerCount;
  parsed.averageWpm = measured.averageWpm;
  parsed.totalDuration = measured.totalDuration;

  return parsed;
}
