// ============================================================
// PitchForge Type Definitions — based on PRD v3.0
// ============================================================

// --- Persona Types ---
export type PersonaId =
  | "skeptical-investor"
  | "demanding-recruiter"
  | "hackathon-judge"
  | "non-technical-customer"
  | "technical-expert";

export interface Persona {
  id: PersonaId;
  name: string;
  title: string;
  description: string;
  behavioralProfile: string;
  pressureTriggers: string[];
  signaturePhrases: string[];
  voiceConfig: {
    rate: number;
    pitch: number;
    voiceName?: string;
  };
}

// --- Scenario Types ---
export type ScenarioId =
  | "pitch-startup"
  | "job-interview"
  | "technical-presentation"
  | "hackathon-demo"
  | "sales-demo"
  | "customer-discovery";

export interface Scenario {
  id: ScenarioId;
  name: string;
  description: string;
  icon: string;
  defaultPersona: PersonaId;
}

// --- Pressure Levels ---
export type PressureLevel = "coaching" | "realistic" | "aggressive" | "brutal";

export interface PressureLevelConfig {
  id: PressureLevel;
  name: string;
  description: string;
  multiplier: number;
  initialTrust: number;
  initialInterest: number;
}

// --- Session Setup (Context Ingestion) ---
export interface SessionSetup {
  nameAndRole: string;       // e.g. "Sarah, founder of a B2B SaaS company"
  productDescription: string; // 2-3 sentences
  valueProposition: string;  // The one thing you want them to believe
  scenario: ScenarioId;
  persona: PersonaId;
  pressureLevel: PressureLevel;
}

// --- Cognitive State Engine (9 fields) ---
export interface CognitiveState {
  sessionId: string;
  stateMetrics: {
    confusionLevel: number;      // 0-10
    trustLevel: number;          // 0-10
    interestLevel: number;       // 0-10
    currentTurnCount: number;
    consecutiveStutterEvents: number;
  };
  linguisticTracking: {
    detectedBuzzwords: string[];
    trackedFillers: string[];
    averageWpm: number;
  };
  historicalGraphVectors: {
    primaryWeaknessTargeted: string;
  };
}

// --- Conversation Turn ---
export interface ConversationTurn {
  id: number;
  role: "user" | "persona";
  content: string;
  timestamp: number;
  metadata?: {
    wpm?: number;
    fillerCount?: number;
    buzzwordCount?: number;
    duration?: number; // seconds
    interrupted?: boolean;
  };
}

// --- Interruption Signal ---
export type InterruptionReason =
  | "long-silence"
  | "excessive-fillers"
  | "rambling"
  | "buzzword-overload"
  | "low-wpm-hesitation";

export interface InterruptionEvent {
  reason: InterruptionReason;
  turnId: number;
  timestamp: number;
}

// --- Feedback & Evaluation ---
export type EvaluationDimension =
  | "clarity"
  | "conviction"
  | "structure"
  | "authenticity"
  | "resilience"
  | "adaptability"
  | "brevity"
  | "persuasiveness";

export interface DimensionScore {
  dimension: EvaluationDimension;
  score: number; // 0-100
  evidence: string; // turn-numbered citation
}

export type Verdict = "YES" | "NO" | "MAYBE";

export interface SessionFeedback {
  verdict: Verdict;
  primaryReason: string;
  biggestWeakness: string;
  strongestMoment: {
    turnNumber: number;
    content: string;
    explanation: string;
  };
  replayChallenge: string;
  dimensions: DimensionScore[];
  buzzwordCount: number;
  fillerCount: number;
  averageWpm: number;
  totalDuration: number;
}

// --- Session Record (localStorage persistence) ---
export interface SessionRecord {
  id: string;
  setup: SessionSetup;
  cognitiveState: CognitiveState;
  transcript: ConversationTurn[];
  feedback: SessionFeedback | null;
  interruptions: InterruptionEvent[];
  startedAt: number;
  endedAt: number | null;
}

// --- Session Status ---
export type SessionStatus =
  | "idle"
  | "listening"
  | "processing"
  | "persona-speaking"
  | "interrupted"
  | "ended";
