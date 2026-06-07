import type { SessionRecord } from "@/types";
import { SESSION_STORAGE_KEY, CURRENT_SESSION_KEY } from "@/lib/constants";

// ============================================================
// Session Storage — localStorage persistence
// ============================================================

export function saveSession(session: SessionRecord): void {
  const sessions = getAllSessions();
  const existingIndex = sessions.findIndex((s) => s.id === session.id);
  if (existingIndex >= 0) {
    sessions[existingIndex] = session;
  } else {
    sessions.push(session);
  }
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
}

export function getAllSessions(): SessionRecord[] {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SessionRecord[];
  } catch {
    return [];
  }
}

export function getSession(id: string): SessionRecord | null {
  const sessions = getAllSessions();
  return sessions.find((s) => s.id === id) ?? null;
}

export function deleteSession(id: string): void {
  const sessions = getAllSessions().filter((s) => s.id !== id);
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
}

// --- Current session (in-progress) ---

export function saveCurrentSession(session: SessionRecord): void {
  localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify(session));
}

export function getCurrentSession(): SessionRecord | null {
  try {
    const raw = localStorage.getItem(CURRENT_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return null;
  }
}

export function clearCurrentSession(): void {
  localStorage.removeItem(CURRENT_SESSION_KEY);
}

// --- Stats ---

export function getSessionStats() {
  const sessions = getAllSessions().filter((s) => s.feedback !== null);
  if (sessions.length === 0) {
    return { totalSessions: 0, averageScore: 0, bestVerdict: null, lastSession: null, yesRate: 0 };
  }

  const scores = sessions.map((s) => {
    const dims = s.feedback!.dimensions;
    return dims.reduce((sum, d) => sum + d.score, 0) / dims.length;
  });

  const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const yesCount = sessions.filter((s) => s.feedback!.verdict === "YES").length;
  const lastSession = sessions[sessions.length - 1];

  return {
    totalSessions: sessions.length,
    averageScore: avgScore,
    yesRate: Math.round((yesCount / sessions.length) * 100),
    lastSession,
  };
}

// --- Improvement Delta ---

export interface ImprovementDelta {
  hasComparison: boolean;
  overallDelta: number; // positive = improved
  dimensionDeltas: Record<string, number>;
  previousVerdict: string | null;
  previousOverallScore: number | null;
}

export function getImprovementDelta(currentSession: SessionRecord): ImprovementDelta {
  const allSessions = getAllSessions()
    .filter((s) => s.feedback !== null && s.id !== currentSession.id)
    .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));

  if (allSessions.length === 0 || !currentSession.feedback) {
    return {
      hasComparison: false,
      overallDelta: 0,
      dimensionDeltas: {},
      previousVerdict: null,
      previousOverallScore: null,
    };
  }

  const previous = allSessions[0];
  const prevFeedback = previous.feedback!;
  const currFeedback = currentSession.feedback;

  const prevOverall = Math.round(
    prevFeedback.dimensions.reduce((sum, d) => sum + d.score, 0) / prevFeedback.dimensions.length
  );
  const currOverall = Math.round(
    currFeedback.dimensions.reduce((sum, d) => sum + d.score, 0) / currFeedback.dimensions.length
  );

  const dimensionDeltas: Record<string, number> = {};
  for (const dim of currFeedback.dimensions) {
    const prevDim = prevFeedback.dimensions.find((d) => d.dimension === dim.dimension);
    if (prevDim) {
      dimensionDeltas[dim.dimension] = dim.score - prevDim.score;
    }
  }

  return {
    hasComparison: true,
    overallDelta: currOverall - prevOverall,
    dimensionDeltas,
    previousVerdict: prevFeedback.verdict,
    previousOverallScore: prevOverall,
  };
}
