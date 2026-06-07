import type {
  Persona,
  Scenario,
  PressureLevelConfig,
  CognitiveState,
} from "@/types";

// ============================================================
// Personas — PRD Section 8, Step 3
// ============================================================

export const PERSONAS: Record<string, Persona> = {
  "skeptical-investor": {
    id: "skeptical-investor",
    name: "Marcus Chen",
    title: "Skeptical Investor",
    description:
      "Market-focused. Interrupts often. Questions every assumption.",
    behavioralProfile:
      "A seasoned VC who has seen 10,000 pitches. Cuts through fluff immediately. Respects specificity and distrusts vague claims.",
    pressureTriggers: [
      "Unsupported traction claims",
      "Weak differentiation",
      "Vague moat",
      "No numbers",
    ],
    signaturePhrases: [
      "Why now?",
      "Who else is doing this?",
      "What's the real moat?",
      "Give me a number.",
      "I've seen this before. Why is yours different?",
    ],
    voiceConfig: { rate: 1.0, pitch: 0.9 },
  },
  "demanding-recruiter": {
    id: "demanding-recruiter",
    name: "Sarah Okonkwo",
    title: "Demanding Recruiter",
    description:
      "Clarity-focused. Evaluates communication quality above content.",
    behavioralProfile:
      "Senior recruiter at a top company. Cares about how you communicate, not just what you say. Detects rehearsed answers instantly.",
    pressureTriggers: [
      "Vague or rehearsed-sounding answers",
      "Hedging language",
      "Not answering the question directly",
    ],
    signaturePhrases: [
      "Tell me more specifically.",
      "What did you personally do?",
      "That sounds rehearsed. Try again in your own words.",
      "I need a concrete example.",
    ],
    voiceConfig: { rate: 0.95, pitch: 1.1 },
  },
  "hackathon-judge": {
    id: "hackathon-judge",
    name: "Alex Rivera",
    title: "Hackathon Judge",
    description:
      "Impact and novelty-focused. Extremely time-constrained.",
    behavioralProfile:
      "Has 2 minutes per team. Only cares about: what does it do, why does it matter, and is it real. No patience for setup or backstory.",
    pressureTriggers: [
      "Exceeding 90 seconds per answer",
      "Vague impact claims",
      "Too much context before the point",
    ],
    signaturePhrases: [
      "What's the actual impact?",
      "You have 30 seconds.",
      "Skip the backstory. What does it do?",
      "Show me, don't tell me.",
    ],
    voiceConfig: { rate: 1.1, pitch: 1.0 },
  },
  "non-technical-customer": {
    id: "non-technical-customer",
    name: "Diana Walsh",
    title: "Non-Technical Customer",
    description:
      "Cares only about value. Confused by acronyms and tech terms.",
    behavioralProfile:
      "A decision-maker who will buy if she understands the value. Zero tolerance for jargon. Needs to understand benefits, not features.",
    pressureTriggers: [
      "Jargon",
      "Feature-first explanations",
      "Undefined technical terms",
    ],
    signaturePhrases: [
      "I don't understand that. Just tell me what it does for me.",
      "Why should I care?",
      "My current solution works fine. Convince me.",
    ],
    voiceConfig: { rate: 0.9, pitch: 1.15 },
  },
  "technical-expert": {
    id: "technical-expert",
    name: "Dr. James Park",
    title: "Technical Expert",
    description:
      "Challenges logic, asks for depth, skeptical of hand-waving.",
    behavioralProfile:
      "A senior engineer who has built systems at scale. Respects technical depth. Allergic to marketing language. Wants to know how things actually work.",
    pressureTriggers: [
      "Vague implementation claims",
      "Unsupported technical assertions",
      "Marketing language in technical context",
    ],
    signaturePhrases: [
      "How does that actually work?",
      "What are the failure modes?",
      "That sounds like marketing. Give me the architecture.",
      "What happens at scale?",
    ],
    voiceConfig: { rate: 0.95, pitch: 0.85 },
  },
};

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
    defaultPersona: "skeptical-investor",
  },
  {
    id: "job-interview",
    name: "Job Interview",
    description:
      "Simulate a recruiter or hiring manager screen. Persona evaluates clarity, confidence, and communication.",
    icon: "briefcase",
    defaultPersona: "demanding-recruiter",
  },
  {
    id: "technical-presentation",
    name: "Technical Presentation",
    description:
      "Present a complex system to a non-technical audience. Persona challenges jargon and demands simplicity.",
    icon: "cpu",
    defaultPersona: "non-technical-customer",
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
    defaultPersona: "non-technical-customer",
  },
  {
    id: "customer-discovery",
    name: "Customer Discovery",
    description:
      "Simulate an exploratory call with a potential customer. Persona pushes back on assumptions.",
    icon: "search",
    defaultPersona: "non-technical-customer",
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
