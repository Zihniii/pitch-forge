// ============================================================
// PitchForge Type Definitions — based on PRD v3.0
// ============================================================

// --- Persona Types ---
export type PersonaId = string;

export type PersonaCategory =
  | "startup"
  | "career"
  | "sales"
  | "leadership"
  | "presentation"
  | "customer";

export type SpeechPace = "slow" | "measured" | "brisk" | "clipped" | "rapid";

export interface PersonaSpeech {
  gender: "male" | "female" | "neutral";
  /** Substrings to prefer when matching an installed system voice. */
  voiceHints: string[];
  pace: SpeechPace;
  baseRate: number;      // 0.1 - 2 (SpeechSynthesis rate)
  basePitch: number;     // 0 - 2  (SpeechSynthesis pitch)
  pitchJitter: number;   // per-sentence random variation
  /** Verbal tics this persona uses when reacting (e.g. "Look,", "Hmm."). */
  verbalTics: string[];
}

export interface Persona {
  id: PersonaId;
  name: string;
  title: string;
  category: PersonaCategory;
  archetype: string;            // one-line essence
  description: string;
  behavioralProfile: string;
  goals: string[];              // what this persona is trying to get out of the user
  personalityTraits: string[];
  communicationStyle: string;
  pressureTriggers: string[];
  objectionPatterns: string[];  // recurring objections they escalate through
  signaturePhrases: string[];
  openingLines: string[];       // distinct ways to open the conversation
  emotionalRange: string;       // how their emotion shifts with state
  speech: PersonaSpeech;
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

export interface FeedbackMoment {
  turnNumber: number;
  quote: string;        // verbatim or near-verbatim from transcript
  insight: string;      // why it mattered
  improvement?: string; // how to do better (optional for positive moments)
}

export interface SessionFeedback {
  verdict: Verdict;
  verdictLine: string;       // the persona's in-character one-liner
  primaryReason: string;
  biggestWeakness: string;
  // Rich moment analysis — all grounded in transcript turns
  strongestMoment: {
    turnNumber: number;
    content: string;
    explanation: string;
  };
  weakestMoment: FeedbackMoment;
  turningPoint: FeedbackMoment;
  missedOpportunity: FeedbackMoment;
  mostConvincingAnswer: FeedbackMoment;
  mostDamagingAnswer: FeedbackMoment;
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

// --- Progression System ---
export interface RankTier {
  id: string;
  name: string;        // e.g. "Contender"
  min: number;         // min rating for this tier
  blurb: string;       // identity line
}

export interface PersonaRecord {
  personaId: PersonaId;
  encounters: number;
  yes: number;
  maybe: number;
  no: number;
}

export interface ProgressionProfile {
  rating: number;              // Communication Rating (ELO-style)
  peakRating: number;
  rank: RankTier;
  nextRank: RankTier | null;
  progressToNext: number;      // 0-1 within current tier toward next
  totalSessions: number;
  yesRate: number;             // %
  currentStreak: number;       // consecutive non-NO sessions
  bestStreak: number;
  lastDelta: number | null;    // rating change of most recent session
  personaRecords: PersonaRecord[];
  topWeakness: { dimension: EvaluationDimension; avgScore: number } | null;
  dimensionAverages: Record<string, number>;
  recentRatings: number[];     // chronological rating after each session
}

// --- Session Status ---
export type SessionStatus =
  | "idle"
  | "listening"
  | "processing"
  | "persona-speaking"
  | "interrupted"
  | "ended";
