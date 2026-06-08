import type {
  SessionRecord,
  ProgressionProfile,
  RankTier,
  PersonaRecord,
  PersonaId,
  EvaluationDimension,
  Verdict,
} from "@/types";
import { RANK_TIERS, BASE_RATING, PRESSURE_STAKES } from "@/lib/constants";
import { getAllSessions } from "./storage";

// ============================================================
// Progression Engine
// Derives a Communication Rating (ELO-style) and a full
// progression profile from completed session history.
// Pure, deterministic — recomputed from the session log.
// ============================================================

function overallScore(session: SessionRecord): number {
  const dims = session.feedback!.dimensions;
  if (!dims.length) return 0;
  return Math.round(dims.reduce((s, d) => s + d.score, 0) / dims.length);
}

/**
 * Rating delta for a single session.
 * Score 50 is neutral. Above gains, below loses.
 * Verdict applies a bonus/penalty. Pressure scales the stakes.
 */
export function sessionRatingDelta(session: SessionRecord): number {
  const score = overallScore(session);
  const verdict = session.feedback!.verdict;
  const stakes = PRESSURE_STAKES[session.setup.pressureLevel] ?? 1;

  // Base: -25..+25 from score around the 50 midpoint
  let delta = ((score - 50) / 50) * 25;

  // Verdict swing
  if (verdict === "YES") delta += 14;
  else if (verdict === "NO") delta -= 14;

  delta *= stakes;
  return Math.round(delta);
}

export function rankForRating(rating: number): RankTier {
  let tier = RANK_TIERS[0];
  for (const t of RANK_TIERS) if (rating >= t.min) tier = t;
  return tier;
}

function nextRankAfter(tier: RankTier): RankTier | null {
  const idx = RANK_TIERS.findIndex((t) => t.id === tier.id);
  return idx >= 0 && idx < RANK_TIERS.length - 1 ? RANK_TIERS[idx + 1] : null;
}

/** Build the full progression profile from all completed sessions. */
export function getProgressionProfile(): ProgressionProfile {
  const sessions = getAllSessions()
    .filter((s) => s.feedback !== null)
    .sort((a, b) => (a.endedAt || a.startedAt) - (b.endedAt || b.startedAt));

  let rating = BASE_RATING;
  let peak = BASE_RATING;
  const recentRatings: number[] = [];
  let lastDelta: number | null = null;

  let currentStreak = 0;
  let bestStreak = 0;
  let yesCount = 0;

  const personaMap = new Map<PersonaId, PersonaRecord>();
  const dimTotals: Record<string, { sum: number; n: number }> = {};

  for (const s of sessions) {
    const delta = sessionRatingDelta(s);
    rating = Math.max(0, rating + delta);
    peak = Math.max(peak, rating);
    recentRatings.push(rating);
    lastDelta = delta;

    const verdict = s.feedback!.verdict as Verdict;
    if (verdict === "YES") yesCount++;
    if (verdict === "NO") {
      currentStreak = 0;
    } else {
      currentStreak++;
      bestStreak = Math.max(bestStreak, currentStreak);
    }

    // Persona records
    const pid = s.setup.persona;
    const rec = personaMap.get(pid) ?? {
      personaId: pid,
      encounters: 0,
      yes: 0,
      maybe: 0,
      no: 0,
    };
    rec.encounters++;
    if (verdict === "YES") rec.yes++;
    else if (verdict === "MAYBE") rec.maybe++;
    else rec.no++;
    personaMap.set(pid, rec);

    // Dimension averages
    for (const d of s.feedback!.dimensions) {
      const key = d.dimension;
      if (!dimTotals[key]) dimTotals[key] = { sum: 0, n: 0 };
      dimTotals[key].sum += d.score;
      dimTotals[key].n++;
    }
  }

  const dimensionAverages: Record<string, number> = {};
  let topWeakness: ProgressionProfile["topWeakness"] = null;
  for (const [dim, { sum, n }] of Object.entries(dimTotals)) {
    const avg = Math.round(sum / n);
    dimensionAverages[dim] = avg;
    if (!topWeakness || avg < topWeakness.avgScore) {
      topWeakness = { dimension: dim as EvaluationDimension, avgScore: avg };
    }
  }

  const rank = rankForRating(rating);
  const nextRank = nextRankAfter(rank);
  const progressToNext = nextRank
    ? Math.min(1, Math.max(0, (rating - rank.min) / (nextRank.min - rank.min)))
    : 1;

  return {
    rating: Math.round(rating),
    peakRating: Math.round(peak),
    rank,
    nextRank,
    progressToNext,
    totalSessions: sessions.length,
    yesRate: sessions.length ? Math.round((yesCount / sessions.length) * 100) : 0,
    currentStreak,
    bestStreak,
    lastDelta,
    personaRecords: Array.from(personaMap.values()).sort(
      (a, b) => b.encounters - a.encounters
    ),
    topWeakness,
    dimensionAverages,
    recentRatings,
  };
}

/**
 * The rating delta the just-completed session contributed,
 * relative to the rating before it. Used for the verdict reveal.
 */
export function deltaForLatest(latestSessionId: string): number | null {
  const all = getAllSessions().filter((s) => s.feedback !== null);
  const target = all.find((s) => s.id === latestSessionId);
  if (!target) return null;
  return sessionRatingDelta(target);
}
