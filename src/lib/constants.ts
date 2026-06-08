import type {
  Scenario,
  PressureLevelConfig,
  CognitiveState,
} from "@/types";
import { PERSONA_LIBRARY } from "./personas";

// ============================================================
// Personas — see personas.ts for the full library
// ============================================================

export const PERSONAS = PERSONA_LIBRARY;

export { PERSONA_LIBRARY };

// ============================================================
// Scenarios — PRD Section 8, Step 2
// ============================================================

export const SCENARIOS: Scenario[] = [
  {
    id: "pitch-startup",
    name: "Pitch My Startup",
    description:
      "Simulate a VC first-meeting pitch. Persona focuses on market size, differentiation, traction, and team.",
    icon: "rocket",
    defaultPersona: "skeptical-vc",
  },
  {
    id: "job-interview",
    name: "Job Interview",
    description:
      "Simulate a recruiter or hiring manager screen. Persona evaluates clarity, confidence, and communication.",
    icon: "briefcase",
    defaultPersona: "technical-recruiter",
  },
  {
    id: "technical-presentation",
    name: "Technical Presentation",
    description:
      "Present a complex system to a non-technical audience. Persona challenges jargon and demands simplicity.",
    icon: "cpu",
    defaultPersona: "confused-customer",
  },
  {
    id: "hackathon-demo",
    name: "Hackathon Demo",
    description:
      "Simulate a time-pressured demo to judges. Persona interrupts if you exceed 90 seconds per answer.",
    icon: "timer",
    defaultPersona: "hackathon-judge",
  },
  {
    id: "sales-demo",
    name: "Sales / Product Demo",
    description:
      "Simulate a live product demo to a skeptical prospect. Persona challenges value claims.",
    icon: "presentation",
    defaultPersona: "skeptical-prospect",
  },
  {
    id: "customer-discovery",
    name: "Customer Discovery",
    description:
      "Simulate an exploratory call with a potential customer. Persona pushes back on assumptions.",
    icon: "search",
    defaultPersona: "early-adopter",
  },
];

// ============================================================
// Pressure Levels — PRD Section 8, Step 4
// ============================================================

export const PRESSURE_LEVELS: PressureLevelConfig[] = [
  {
    id: "coaching",
    name: "Coaching",
    description:
      "Supportive tone. Open questions. Allows you to finish thoughts.",
    multiplier: 0.5,
    initialTrust: 7,
    initialInterest: 7,
  },
  {
    id: "realistic",
    name: "Realistic",
    description:
      "Balanced skepticism. Occasional interruptions. Natural follow-ups.",
    multiplier: 1.0,
    initialTrust: 5,
    initialInterest: 5,
  },
  {
    id: "aggressive",
    name: "Aggressive",
    description:
      "High skepticism. Frequent interruptions. Challenges every claim.",
    multiplier: 1.5,
    initialTrust: 3,
    initialInterest: 4,
  },
  {
    id: "brutal",
    name: "Brutal",
    description:
      "Stress test. Dismissive tone. Maximum discomfort.",
    multiplier: 2.0,
    initialTrust: 2,
    initialInterest: 3,
  },
];

// ============================================================
// Default Cognitive State
// ============================================================

export function createInitialCognitiveState(
  pressureLevel: PressureLevelConfig
): CognitiveState {
  return {
    sessionId: `pitchforge_${Date.now()}`,
    stateMetrics: {
      confusionLevel: 2,
      trustLevel: pressureLevel.initialTrust,
      interestLevel: pressureLevel.initialInterest,
      currentTurnCount: 0,
      consecutiveStutterEvents: 0,
    },
    linguisticTracking: {
      detectedBuzzwords: [],
      trackedFillers: [],
      averageWpm: 0,
    },
    historicalGraphVectors: {
      primaryWeaknessTargeted: "none",
    },
  };
}

// ============================================================
// Interruption Thresholds — PRD Section 9
// ============================================================

export const INTERRUPTION_THRESHOLDS = {
  silenceDuration: 3500, // ms — 3.5 seconds without speech
  fillerCountPerTurn: 3,
  ramblingDuration: 90, // seconds without conclusion
  buzzwordCountPerTurn: 3,
  lowWpmThreshold: 80,
  lowWpmDuration: 15000, // ms — 15 seconds below threshold
} as const;

// ============================================================
// Buzzword Dictionary
// ============================================================

export const BUZZWORDS = [
  "revolutionary",
  "next-gen",
  "game-changing",
  "disruptive",
  "synergy",
  "leverage",
  "paradigm",
  "cutting-edge",
  "best-in-class",
  "world-class",
  "holistic",
  "scalable",
  "innovative",
  "transformative",
  "bleeding-edge",
  "state-of-the-art",
  "ai-powered",
  "machine-learning",
  "blockchain",
  "ecosystem",
] as const;

// ============================================================
// Filler Words
// ============================================================

export const FILLER_WORDS = [
  "um",
  "umm",
  "uh",
  "uhh",
  "like",
  "you know",
  "basically",
  "actually",
  "sort of",
  "kind of",
  "i mean",
  "right",
  "so yeah",
] as const;

// ============================================================
// App Constants
// ============================================================

export const APP_NAME = "PitchForge";
export const MAX_TURNS = 15;
export const SESSION_STORAGE_KEY = "pitchforge_sessions";
export const CURRENT_SESSION_KEY = "pitchforge_current_session";

// ============================================================
// Progression — Communication Rating tiers (ELO-style)
// ============================================================

export const BASE_RATING = 1000;

import type { RankTier } from "@/types";

export const RANK_TIERS: RankTier[] = [
  { id: "rookie",    name: "Rookie",     min: 0,    blurb: "First time under fire." },
  { id: "contender", name: "Contender",  min: 1100, blurb: "Holding your ground." },
  { id: "operator",  name: "Operator",   min: 1250, blurb: "Composed under pressure." },
  { id: "closer",    name: "Closer",     min: 1400, blurb: "You move the room." },
  { id: "elite",     name: "Elite",      min: 1550, blurb: "Hard to rattle." },
  { id: "master",    name: "Master",     min: 1700, blurb: "Master of the room." },
];

// Pressure level → rating stakes multiplier (higher pressure = bigger swings)
export const PRESSURE_STAKES: Record<string, number> = {
  coaching: 0.6,
  realistic: 1.0,
  aggressive: 1.35,
  brutal: 1.7,
};
