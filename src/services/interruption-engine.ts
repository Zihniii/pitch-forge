import type { InterruptionReason, CognitiveState } from "@/types";
import {
  INTERRUPTION_THRESHOLDS,
  BUZZWORDS,
  FILLER_WORDS,
} from "@/lib/constants";

// ============================================================
// Interruption Engine — PRD Section 9
// ============================================================

export interface InterruptionCheck {
  shouldInterrupt: boolean;
  reason: InterruptionReason | null;
  message: string | null;
}

/**
 * Analyzes a user's turn text and metadata to determine if
 * the persona should interrupt.
 */
export function checkForInterruption(
  turnText: string,
  turnDurationMs: number,
  wpm: number,
  state: CognitiveState
): InterruptionCheck {
  // Check buzzword overload
  const buzzwordCount = countBuzzwords(turnText);
  if (buzzwordCount >= INTERRUPTION_THRESHOLDS.buzzwordCountPerTurn) {
    return {
      shouldInterrupt: true,
      reason: "buzzword-overload",
      message: `You just used ${buzzwordCount} buzzwords. Tell me what that actually means in plain language.`,
    };
  }

  // Check excessive fillers
  const fillerCount = countFillers(turnText);
  if (fillerCount >= INTERRUPTION_THRESHOLDS.fillerCountPerTurn) {
    return {
      shouldInterrupt: true,
      reason: "excessive-fillers",
      message: "Give me the direct answer. No hedging.",
    };
  }

  // Check rambling (90+ seconds without conclusion)
  const turnDurationSec = turnDurationMs / 1000;
  if (turnDurationSec >= INTERRUPTION_THRESHOLDS.ramblingDuration) {
    return {
      shouldInterrupt: true,
      reason: "rambling",
      message: "What is your actual point? I need one sentence.",
    };
  }

  // Check low WPM hesitation
  if (
    wpm > 0 &&
    wpm < INTERRUPTION_THRESHOLDS.lowWpmThreshold &&
    turnDurationMs > INTERRUPTION_THRESHOLDS.lowWpmDuration
  ) {
    return {
      shouldInterrupt: true,
      reason: "low-wpm-hesitation",
      message: "Take your time. What are you trying to say?",
    };
  }

  // No interruption needed
  return { shouldInterrupt: false, reason: null, message: null };
}

/**
 * Check for silence-based interruption (called externally by timer)
 */
export function getSilenceInterruptionMessage(state: CognitiveState): string {
  if (state.stateMetrics.confusionLevel > 5) {
    return "You stopped. Are you unsure about that point?";
  }
  if (state.stateMetrics.consecutiveStutterEvents >= 2) {
    return "I can see you are thinking. Take a moment, then give me one clear sentence.";
  }
  return "You went quiet. Is there something you want to add?";
}

// ============================================================
// Linguistic Analysis Utilities
// ============================================================

export function countBuzzwords(text: string): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const word of BUZZWORDS) {
    const regex = new RegExp(`\\b${word.replace("-", "[\\s-]?")}\\b`, "gi");
    const matches = lower.match(regex);
    if (matches) count += matches.length;
  }
  return count;
}

export function countFillers(text: string): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const filler of FILLER_WORDS) {
    const regex = new RegExp(`\\b${filler}\\b`, "gi");
    const matches = lower.match(regex);
    if (matches) count += matches.length;
  }
  return count;
}

export function calculateWpm(text: string, durationMs: number): number {
  if (durationMs <= 0) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const minutes = durationMs / 60000;
  return Math.round(words / minutes);
}

export function detectBuzzwordsInText(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const word of BUZZWORDS) {
    const regex = new RegExp(`\\b${word.replace("-", "[\\s-]?")}\\b`, "gi");
    if (regex.test(lower)) found.push(word);
  }
  return found;
}

export function detectFillersInText(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const filler of FILLER_WORDS) {
    const regex = new RegExp(`\\b${filler}\\b`, "gi");
    if (regex.test(lower)) found.push(filler);
  }
  return found;
}
