import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  CognitiveState,
  ConversationTurn,
  SessionSetup,
  Persona,
  PressureLevel,
  SessionFeedback,
} from "@/types";
import { PERSONAS, PRESSURE_LEVELS } from "@/lib/constants";

// ============================================================
// Gemini Client
// ============================================================

function getGenAI() {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("VITE_GEMINI_API_KEY is not set in environment variables");
  }
  return new GoogleGenerativeAI(apiKey);
}

// ============================================================
// System Prompt Builder — PRD Section 24
// ============================================================

function buildSystemPrompt(
  persona: Persona,
  setup: SessionSetup,
  state: CognitiveState,
  pressureLevel: PressureLevel
): string {
  const pressure = PRESSURE_LEVELS.find((p) => p.id === pressureLevel)!;

  return `You are ${persona.name}, a ${persona.title}.
Your goal is to evaluate how clearly and convincingly the user communicates.

BEHAVIORAL PROFILE: ${persona.behavioralProfile}

PRESSURE TRIGGERS: ${persona.pressureTriggers.join(", ")}

SIGNATURE PHRASES (use naturally): ${persona.signaturePhrases.join(" / ")}

USER CONTEXT:
- Name & Role: ${setup.nameAndRole}
- Product/Project: ${setup.productDescription}
- Value Proposition: ${setup.valueProposition}
- Scenario: ${setup.scenario}

CURRENT SESSION STATE:
${JSON.stringify(state, null, 2)}

PRESSURE LEVEL: ${pressure.name} (multiplier: ${pressure.multiplier})

HISTORICAL WEAKNESS TARGETED: ${state.historicalGraphVectors.primaryWeaknessTargeted}

RULES:
(1) Evaluate communication only — not business validity.
(2) If confusion_level > 7, interrupt the user mid-thought and demand clarification.
(3) If trust_level < 3, become dismissive and raise harder objections.
(4) If interest_level < 3 for 3+ consecutive turns, signal readiness to end.
(5) Within the first 3 turns, challenge the user on their historical weakness.
(6) Keep responses concise — 1-3 sentences max. You are evaluating THEM, not lecturing.
(7) React emotionally and authentically. Show skepticism, interest, confusion, or impatience.
(8) If the user gives a strong answer, acknowledge it briefly before moving to the next challenge.
(9) Never break character. You are this persona throughout.

RESPONSE FORMAT:
Respond with valid JSON only, no markdown, no code fences:
{
  "reply": "Your spoken response as the persona (1-3 sentences)",
  "updatedState": { ...updated CognitiveState object... },
  "shouldEnd": false,
  "endReason": null
}

If the conversation should end naturally (interest too low, enough turns, or natural conclusion):
{
  "reply": "Your closing statement as persona",
  "updatedState": { ...final state... },
  "shouldEnd": true,
  "endReason": "A brief reason why the conversation is ending"
}`;
}

// ============================================================
// Generate Persona Response
// ============================================================

export interface PersonaResponse {
  reply: string;
  updatedState: CognitiveState;
  shouldEnd: boolean;
  endReason: string | null;
}

export async function generatePersonaResponse(
  setup: SessionSetup,
  state: CognitiveState,
  transcript: ConversationTurn[]
): Promise<PersonaResponse> {
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const persona = PERSONAS[setup.persona];
  const systemPrompt = buildSystemPrompt(persona, setup, state, setup.pressureLevel);

  // Format transcript as conversation history
  const history = transcript
    .map((turn) => `[Turn ${turn.id}] ${turn.role === "user" ? "USER" : persona.name}: ${turn.content}`)
    .join("\n");

  const prompt = `${systemPrompt}

CONVERSATION HISTORY:
${history || "(No conversation yet — this is the opening. Greet the user briefly and invite them to begin their pitch/presentation.)"}

Generate your next response as the persona. Remember: valid JSON only.`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text().trim();

  // Parse JSON — handle potential markdown fences
  let cleaned = responseText;
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    const parsed = JSON.parse(cleaned) as PersonaResponse;
    return parsed;
  } catch {
    // Fallback if JSON parsing fails
    return {
      reply: responseText.slice(0, 200),
      updatedState: state,
      shouldEnd: false,
      endReason: null,
    };
  }
}

// ============================================================
// Generate Session Feedback — PRD Sections 12-13
// ============================================================

export async function generateSessionFeedback(
  setup: SessionSetup,
  transcript: ConversationTurn[],
  finalState: CognitiveState
): Promise<SessionFeedback> {
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const persona = PERSONAS[setup.persona];

  const formattedTranscript = transcript
    .map((turn) => `[Turn ${turn.id}] ${turn.role === "user" ? "USER" : persona.name}: ${turn.content}`)
    .join("\n");

  const prompt = `You are a communication evaluation engine for PitchForge.

Analyze this conversation transcript and generate a detailed evaluation.

PERSONA: ${persona.name} (${persona.title})
SCENARIO: ${setup.scenario}
PRESSURE LEVEL: ${setup.pressureLevel}
FINAL STATE: ${JSON.stringify(finalState, null, 2)}

TRANSCRIPT:
${formattedTranscript}

EVALUATION RULES (CRITICAL):
1. EVIDENCE ONLY — Every critique must cite a specific turn number and quote what was said.
2. COMMUNICATION ONLY — Judge clarity, structure, conviction — NOT business idea quality.
3. CONTEXT-GROUNDED — Base all feedback on the transcript. No external assumptions.

VERDICT RULES:
- YES: The user communicated clearly, maintained conviction under pressure, and would likely achieve their goal.
- MAYBE: Mixed performance. Some strong moments but critical weaknesses.
- NO: Communication broke down. The user failed to maintain clarity or conviction.

Respond with valid JSON only (no markdown fences):
{
  "verdict": "YES" | "NO" | "MAYBE",
  "primaryReason": "Single most important factor (cite specific turn)",
  "biggestWeakness": "The communication dimension that most hurt credibility",
  "strongestMoment": {
    "turnNumber": <number>,
    "content": "What they said",
    "explanation": "Why it was effective"
  },
  "replayChallenge": "A specific constraint for next session",
  "dimensions": [
    { "dimension": "clarity", "score": <0-100>, "evidence": "Turn X: ..." },
    { "dimension": "conviction", "score": <0-100>, "evidence": "Turn X: ..." },
    { "dimension": "structure", "score": <0-100>, "evidence": "Turn X: ..." },
    { "dimension": "authenticity", "score": <0-100>, "evidence": "Turn X: ..." },
    { "dimension": "resilience", "score": <0-100>, "evidence": "Turn X: ..." },
    { "dimension": "adaptability", "score": <0-100>, "evidence": "Turn X: ..." },
    { "dimension": "brevity", "score": <0-100>, "evidence": "Turn X: ..." },
    { "dimension": "persuasiveness", "score": <0-100>, "evidence": "Turn X: ..." }
  ],
  "buzzwordCount": <total buzzwords detected>,
  "fillerCount": <total fillers detected>,
  "averageWpm": <average words per minute>,
  "totalDuration": <session duration in seconds>
}`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text().trim();

  let cleaned = responseText;
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  return JSON.parse(cleaned) as SessionFeedback;
}
