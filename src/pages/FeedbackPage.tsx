import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Trophy,
  AlertTriangle,
  Target,
  Share2,
  RotateCcw,
  ArrowRight,
  ArrowLeft,
  Home,
  TrendingUp,
  TrendingDown,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getCurrentSession,
  saveSession,
  clearCurrentSession,
  getSession,
} from "@/services/storage";
import { generateSessionFeedback } from "@/services/gemini";
import { deltaForLatest, rankForRating, getProgressionProfile, sessionRatingDelta } from "@/services/progression";
import { PERSONAS } from "@/lib/constants";
import type { SessionFeedback, SessionRecord, ConversationTurn, Verdict, FeedbackMoment } from "@/types";

const VERDICT_COPY: Record<Verdict, { word: string; line: string; spotlight: string; color: string }> = {
  YES: { word: "YES", line: "They're in.", spotlight: "spotlight-confirm", color: "text-confirm" },
  NO: { word: "NO", line: "They walked.", spotlight: "spotlight-deny", color: "text-deny" },
  MAYBE: { word: "MAYBE", line: "You left them on the fence.", spotlight: "spotlight-hold", color: "text-hold" },
};

export default function FeedbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reviewId = searchParams.get("review");
  const [feedback, setFeedback] = useState<SessionFeedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [ratingDelta, setRatingDelta] = useState<number | null>(null);
  const [newRating, setNewRating] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const isReview = !!reviewId;

  useEffect(() => {
    // Review mode: open a past record's stored verdict — no regeneration.
    if (reviewId) {
      const past = getSession(reviewId);
      if (!past || !past.feedback) {
        navigate("/history");
        return;
      }
      setSession(past);
      setFeedback(past.feedback);
      setRatingDelta(sessionRatingDelta(past));
      setRevealed(true); // skip the dramatic reveal when reviewing
      setLoading(false);
      return;
    }
    const current = getCurrentSession();
    if (!current) {
      navigate("/");
      return;
    }
    setSession(current);
    generateFeedback(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generateFeedback = async (s: SessionRecord) => {
    try {
      const userTurns = s.transcript.filter((t) => t.role === "user");
      // No real conversation happened — don't dead-end on an LLM call that will fail.
      if (userTurns.length === 0) {
        setError("empty");
        setLoading(false);
        return;
      }

      const measuredRaw = sessionStorage.getItem("pitchforge_measured");
      const measured = measuredRaw
        ? JSON.parse(measuredRaw)
        : { buzzwordCount: 0, fillerCount: 0, averageWpm: 0, totalDuration: 0, interruptionCount: 0 };
      const result = await generateSessionFeedback(s.setup, s.transcript, s.cognitiveState, measured);
      setFeedback(result);
      sessionStorage.removeItem("pitchforge_measured");

      const completed: SessionRecord = { ...s, feedback: result, endedAt: Date.now() };
      saveSession(completed);
      clearCurrentSession();

      const delta = deltaForLatest(completed.id);
      setRatingDelta(delta);
      setNewRating(getProgressionProfile().rating);

      const overall = Math.round(
        result.dimensions.reduce((sum, d) => sum + d.score, 0) / result.dimensions.length
      );
      (window as any).pendo?.track("feedback_generated", {
        sessionId: s.id,
        verdict: result.verdict,
        overallScore: overall,
        scenario: s.setup.scenario,
        persona: s.setup.persona,
        pressureLevel: s.setup.pressureLevel,
        ratingDelta: delta ?? 0,
      });
    } catch (err) {
      console.error("Feedback generation failed:", err);
      (window as any).pendo?.track("feedback_generation_failed", {
        sessionId: s.id,
        scenario: s.setup.scenario,
        persona: s.setup.persona,
        error: (err as Error)?.message || 'Unknown error',
      });
      setError("The judge's verdict was lost in transmission. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    if (!feedback) return;
    const overall = overallScore(feedback);
    const text = `PitchForge — ${feedback.verdict} · ${overall}/100${
      ratingDelta !== null ? ` (${ratingDelta >= 0 ? "+" : ""}${ratingDelta} CR)` : ""
    }\n${feedback.primaryReason}\n\n#EveryoneShipsNow`;
    (window as any).pendo?.track("share_card_downloaded", {
      verdict: feedback.verdict,
      overallScore: overall,
    });
    try {
      await navigator.clipboard.writeText(text);
      const { toast } = await import("sonner");
      toast.success("Verdict copied to clipboard");
    } catch {
      /* noop */
    }
  };

  const handleRewind = (userTurn: ConversationTurn) => {
    if (!session) return;
    const preceding = session.transcript.find((t) => t.role === "persona" && t.id === userTurn.id - 1);
    if (!preceding) return;
    sessionStorage.setItem(
      "pitchforge_rewind",
      JSON.stringify({
        setup: session.setup,
        cognitiveState: session.cognitiveState,
        precedingPersonaTurn: preceding,
        originalUserTurn: userTurn,
        transcriptUpToTurn: session.transcript.filter((t) => t.id <= userTurn.id),
      })
    );
    navigate("/rewind");
  };

  // ---- Loading: the wait builds tension ----
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center spotlight">
        <div className="space-y-5 text-center">
          <div className="flex justify-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-2.5 w-2.5 rounded-full bg-primary"
                style={{ animation: `pulseDot 1s ease-in-out ${i * 0.2}s infinite` }}
              />
            ))}
          </div>
          <p className="font-display text-lg font-semibold tracking-tight">The room is deciding…</p>
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Reviewing every word you said
          </p>
        </div>
      </div>
    );
  }

  if (error || !feedback) {
    const isEmpty = error === "empty";
    return (
      <div className="flex min-h-screen items-center justify-center p-6 spotlight">
        <div className="max-w-sm space-y-4 text-center">
          <AlertTriangle className="mx-auto h-10 w-10 text-deny" />
          <p className="font-display text-lg font-semibold tracking-tight">
            {isEmpty ? "No exchange to score" : "Verdict lost in transmission"}
          </p>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {isEmpty
              ? "The conversation ended before you said anything the opponent could judge. Step back into the arena and speak — they're listening the moment you start."
              : "Something dropped while the room was deciding. Your session is saved — try generating the verdict again."}
          </p>
          <div className="flex justify-center gap-3 pt-1">
            {!isEmpty && session && (
              <button
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  generateFeedback(session);
                }}
                className="rounded-lg bg-primary px-5 py-2.5 font-display text-sm font-semibold text-primary-foreground cursor-pointer"
              >
                Retry verdict
              </button>
            )}
            <button
              onClick={() => navigate(isEmpty ? "/setup" : "/")}
              className={cn(
                "rounded-lg px-5 py-2.5 font-display text-sm font-semibold cursor-pointer",
                isEmpty
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {isEmpty ? "Back to arena" : "Back to deck"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const overall = overallScore(feedback);
  const persona = session ? PERSONAS[session.setup.persona] : null;
  const copy = VERDICT_COPY[feedback.verdict];

  // ---- Verdict reveal (full screen) ----
  if (!revealed) {
    return (
      <div className={cn("relative flex min-h-screen flex-col items-center justify-center overflow-hidden", copy.spotlight)}>
        <div className="arena-grid pointer-events-none absolute inset-0 opacity-40" />
        <div className="vignette pointer-events-none absolute inset-0" />

        <div className="relative z-10 flex flex-col items-center px-6 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            {persona?.name} delivers the verdict
          </p>

          <h1 className={cn("verdict-in mt-6 font-display text-[88px] font-bold leading-none tracking-tightest md:text-[140px]", copy.color)}>
            {copy.word}
          </h1>

          <p className="mt-4 font-display text-xl font-medium tracking-tight text-foreground md:text-2xl">
            {feedback.verdictLine || copy.line}
          </p>

          <p className="mt-5 max-w-md text-[14px] leading-relaxed text-muted-foreground">
            {feedback.primaryReason}
          </p>

          {/* Rating swing */}
          {ratingDelta !== null && newRating !== null && (
            <div className="mt-8 flex items-center gap-3 rounded-full border border-border bg-card/60 px-5 py-2.5">
              <span className="font-mono text-sm text-muted-foreground">Communication Rating</span>
              <span className="font-mono text-lg font-bold">{newRating}</span>
              <span
                className={cn(
                  "flex items-center gap-1 font-mono text-sm font-semibold",
                  ratingDelta >= 0 ? "text-confirm" : "text-deny"
                )}
              >
                {ratingDelta >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {ratingDelta >= 0 ? "+" : ""}
                {ratingDelta}
              </span>
            </div>
          )}

          <button
            onClick={() => setRevealed(true)}
            className="group mt-10 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-display text-[14px] font-semibold text-primary-foreground transition-all hover:gap-3 cursor-pointer"
          >
            See the breakdown
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>
    );
  }

  // ---- Dossier ----
  return (
    <div className="min-h-screen page-enter">
      <div className="mx-auto max-w-2xl px-6 pt-20 pb-16">
        {/* Verdict recap header */}
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Verdict · {persona?.title}
            </p>
            <div className="mt-1 flex items-baseline gap-3">
              <span className={cn("font-display text-4xl font-bold tracking-tight", copy.color)}>
                {copy.word}
              </span>
              {ratingDelta !== null && (
                <span
                  className={cn(
                    "font-mono text-sm font-semibold",
                    ratingDelta >= 0 ? "text-confirm" : "text-deny"
                  )}
                >
                  {ratingDelta >= 0 ? "+" : ""}
                  {ratingDelta} CR
                </span>
              )}
            </div>
          </div>
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
          >
            <Share2 className="h-3.5 w-3.5" />
            Share
          </button>
        </div>

        {/* Overall score + rank */}
        <div className="mt-6 flex items-center gap-5 rounded-xl border border-border bg-card/60 p-5">
          <ScoreRing score={overall} />
          <div className="flex-1">
            <p className="font-display text-2xl font-bold tracking-tight">{overall}<span className="text-base text-muted-foreground">/100</span></p>
            <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Performance score
            </p>
            {newRating !== null && (
              <p className="mt-2 text-[13px] text-muted-foreground">
                You're a <span className="font-semibold text-primary">{rankForRating(newRating).name}</span> at{" "}
                <span className="font-mono text-foreground">{newRating}</span> CR.
              </p>
            )}
          </div>
        </div>

        {/* Strongest + weakness */}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-confirm/25 bg-confirm/[0.05] p-4">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4 text-confirm" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-confirm">Strongest moment</span>
            </div>
            <p className="mt-2 text-[13px] italic leading-relaxed">
              "{feedback.strongestMoment.content}"
            </p>
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              Turn {feedback.strongestMoment.turnNumber} — {feedback.strongestMoment.explanation}
            </p>
          </div>
          <div className="rounded-xl border border-deny/25 bg-deny/[0.05] p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-deny" />
              <span className="font-mono text-[10px] uppercase tracking-wider text-deny">What cost you</span>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed">{feedback.biggestWeakness}</p>
          </div>
        </div>

        {/* Replay challenge */}
        <div className="mt-4 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/[0.08] to-transparent p-5">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-primary" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-primary">Your next mission</span>
          </div>
          <p className="mt-2 text-[14px] leading-relaxed text-foreground">{feedback.replayChallenge}</p>
          <button
            onClick={() => navigate("/setup")}
            className="group mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-display text-[13px] font-semibold text-primary-foreground transition-all hover:gap-3 cursor-pointer"
          >
            Run it back
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Moment-by-moment analysis */}
        <div className="mt-8 space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Moment analysis · every claim cites a turn
          </p>
          <MomentCard
            kind="convince"
            label="Most convincing answer"
            moment={feedback.mostConvincingAnswer}
          />
          <MomentCard
            kind="turning"
            label="Turning point"
            moment={feedback.turningPoint}
          />
          <MomentCard
            kind="missed"
            label="Missed opportunity"
            moment={feedback.missedOpportunity}
          />
          <MomentCard
            kind="damage"
            label="Most damaging answer"
            moment={feedback.mostDamagingAnswer}
          />
          <MomentCard
            kind="weak"
            label="Weakest moment"
            moment={feedback.weakestMoment}
          />
        </div>

        {/* Dimensions */}
        <div className="mt-8 space-y-2.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Eight dimensions · evidence-graded
          </p>
          {feedback.dimensions.map((dim, i) => (
            <DimensionRow key={dim.dimension} dim={dim} index={i} />
          ))}
        </div>

        {/* Telemetry */}
        <div className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border">
          <Telemetry label="Buzzwords" value={feedback.buzzwordCount} alert={feedback.buzzwordCount >= 3} />
          <Telemetry label="Fillers" value={feedback.fillerCount} alert={feedback.fillerCount >= 5} />
          <Telemetry label="Avg WPM" value={feedback.averageWpm} />
        </div>

        {/* Transcript */}
        <button
          onClick={() => setShowTranscript((v) => !v)}
          className="mt-8 flex w-full items-center justify-between rounded-lg border border-border px-4 py-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
        >
          <span>Replay the full exchange · rewind any answer</span>
          <ChevronDown className={cn("h-4 w-4 transition-transform", showTranscript && "rotate-180")} />
        </button>

        {showTranscript && session && (
          <div className="mt-4 space-y-2.5">
            {session.transcript.map((turn) => {
              const isStrongest = turn.role === "user" && turn.id === feedback.strongestMoment.turnNumber;
              const highFillers = turn.role === "user" && (turn.metadata?.fillerCount || 0) >= 3;
              const highBuzz = turn.role === "user" && (turn.metadata?.buzzwordCount || 0) >= 2;
              return (
                <div
                  key={turn.id}
                  className={cn(
                    "rounded-xl border p-3.5 text-[13px]",
                    turn.role === "user" ? "border-border bg-card/60" : "border-border/50 bg-muted/20",
                    isStrongest && "border-confirm/40 bg-confirm/[0.05]",
                    highFillers && !isStrongest && "border-threat/30",
                    highBuzz && !isStrongest && !highFillers && "border-hold/30"
                  )}
                >
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Turn {turn.id} · {turn.role === "user" ? "You" : persona?.name}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {isStrongest && <Tag className="border-confirm/40 text-confirm">Best</Tag>}
                      {turn.metadata?.interrupted && <Tag className="border-threat/40 text-threat">Interrupted</Tag>}
                      {highFillers && <Tag className="border-threat/40 text-threat">{turn.metadata?.fillerCount} fillers</Tag>}
                      {turn.role === "user" && turn.metadata?.wpm ? (
                        <Tag className="border-border text-muted-foreground">{turn.metadata.wpm} wpm</Tag>
                      ) : null}
                    </div>
                  </div>
                  <p className="leading-relaxed text-foreground/90">{turn.content}</p>
                  {turn.role === "user" && (
                    <button
                      onClick={() => handleRewind(turn)}
                      className="mt-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-primary cursor-pointer"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Rewind
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer actions */}
        <div className="mt-10 flex gap-3">
          {isReview ? (
            <>
              <button
                onClick={() => navigate("/history")}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-display text-[14px] font-semibold text-primary-foreground cursor-pointer"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to record
              </button>
              <button
                onClick={() => navigate("/setup")}
                className="flex items-center justify-center gap-2 rounded-lg border border-border px-5 py-3 text-[14px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
              >
                <RotateCcw className="h-4 w-4" />
                Run it back
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => navigate("/setup")}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-display text-[14px] font-semibold text-primary-foreground cursor-pointer"
              >
                <RotateCcw className="h-4 w-4" />
                New session
              </button>
              <button
                onClick={() => navigate("/")}
                className="flex items-center justify-center gap-2 rounded-lg border border-border px-5 py-3 text-[14px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
              >
                <Home className="h-4 w-4" />
                Deck
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------- helpers ---------------- */

function overallScore(f: SessionFeedback): number {
  return Math.round(f.dimensions.reduce((sum, d) => sum + d.score, 0) / f.dimensions.length);
}

function ScoreRing({ score }: { score: number }) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const color = score >= 70 ? "hsl(var(--confirm))" : score >= 45 ? "hsl(var(--hold))" : "hsl(var(--deny))";
  return (
    <div className="relative h-20 w-20 shrink-0">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} fill="none" stroke="hsl(var(--border))" strokeWidth="5" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * circ} ${circ}`}
          className="ring-fill"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-mono text-lg font-bold">{score}</span>
      </div>
    </div>
  );
}

function DimensionRow({ dim, index }: { dim: SessionFeedback["dimensions"][number]; index: number }) {
  const color = dim.score >= 70 ? "bg-confirm" : dim.score >= 45 ? "bg-hold" : "bg-deny";
  return (
    <div className="rounded-xl border border-border bg-card/40 p-3.5">
      <div className="flex items-center justify-between">
        <span className="font-display text-[14px] font-medium capitalize">{dim.dimension}</span>
        <span className="font-mono text-[13px] font-bold">{dim.score}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
        <div
          className={cn("h-full origin-left rounded-full", color)}
          style={{ width: `${dim.score}%`, animation: `barGrow 800ms ${index * 60}ms cubic-bezier(0.22,1,0.36,1) both` }}
        />
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">{dim.evidence}</p>
    </div>
  );
}

function Telemetry({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="bg-card/60 px-4 py-3.5 text-center">
      <p className={cn("font-mono text-xl font-bold", alert ? "text-deny" : "text-foreground")}>{value}</p>
      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider", className)}>
      {children}
    </span>
  );
}

const MOMENT_STYLES: Record<
  string,
  { border: string; label: string; dot: string }
> = {
  convince: { border: "border-confirm/25", label: "text-confirm", dot: "bg-confirm" },
  turning: { border: "border-primary/25", label: "text-primary", dot: "bg-primary" },
  missed: { border: "border-hold/25", label: "text-hold", dot: "bg-hold" },
  damage: { border: "border-deny/25", label: "text-deny", dot: "bg-deny" },
  weak: { border: "border-deny/25", label: "text-deny", dot: "bg-deny" },
};

function MomentCard({
  kind,
  label,
  moment,
}: {
  kind: keyof typeof MOMENT_STYLES;
  label: string;
  moment: FeedbackMoment;
}) {
  if (!moment || (!moment.quote && !moment.insight)) return null;
  const s = MOMENT_STYLES[kind];
  return (
    <div className={cn("rounded-xl border bg-card/40 p-4", s.border)}>
      <div className="flex items-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
        <span className={cn("font-mono text-[10px] uppercase tracking-wider", s.label)}>{label}</span>
        {typeof moment.turnNumber === "number" && moment.turnNumber > 0 && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            Turn {moment.turnNumber}
          </span>
        )}
      </div>
      {moment.quote && (
        <p className="mt-2 border-l-2 border-border pl-3 text-[13px] italic leading-relaxed text-foreground/85">
          "{moment.quote}"
        </p>
      )}
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{moment.insight}</p>
      {moment.improvement && (
        <p className="mt-2 rounded-lg bg-primary/[0.06] px-3 py-2 text-[12px] leading-relaxed text-foreground/90">
          <span className="font-mono text-[10px] uppercase tracking-wider text-primary">Fix · </span>
          {moment.improvement}
        </p>
      )}
    </div>
  );
}
