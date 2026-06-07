import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Repeat,
  Home,
  Trophy,
  AlertTriangle,
  Sparkles,
  Share2,
  TrendingUp,
  TrendingDown,
  Minus,
  MessageSquare,
  Download,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getCurrentSession,
  saveSession,
  clearCurrentSession,
  getImprovementDelta,
} from "@/services/storage";
import { generateSessionFeedback } from "@/services/gemini";
import { PERSONAS } from "@/lib/constants";
import type { SessionFeedback, SessionRecord, ConversationTurn } from "@/types";
import type { ImprovementDelta } from "@/services/storage";

export default function FeedbackPage() {
  const navigate = useNavigate();
  const [feedback, setFeedback] = useState<SessionFeedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionRecord | null>(null);
  const [delta, setDelta] = useState<ImprovementDelta | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showShareCard, setShowShareCard] = useState(false);
  const shareCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const currentSession = getCurrentSession();
    if (!currentSession) {
      navigate("/");
      return;
    }
    setSession(currentSession);
    generateFeedback(currentSession);
  }, []);

  const generateFeedback = async (session: SessionRecord) => {
    try {
      const result = await generateSessionFeedback(
        session.setup,
        session.transcript,
        session.cognitiveState
      );
      setFeedback(result);

      // Save completed session
      const completed: SessionRecord = {
        ...session,
        feedback: result,
        endedAt: Date.now(),
      };
      saveSession(completed);
      clearCurrentSession();

      // Calculate improvement delta
      const improvementDelta = getImprovementDelta(completed);
      setDelta(improvementDelta);

      const overallScore = Math.round(
        result.dimensions.reduce((sum, d) => sum + d.score, 0) / result.dimensions.length
      );
      (window as any).pendo?.track("feedback_generated", {
        sessionId: session.id,
        verdict: result.verdict,
        overallScore,
        scenario: session.setup.scenario,
        persona: session.setup.persona,
        pressureLevel: session.setup.pressureLevel,
        buzzwordCount: result.buzzwordCount,
        fillerCount: result.fillerCount,
        averageWpm: result.averageWpm,
        hasImprovementDelta: improvementDelta?.hasComparison || false,
        improvementDeltaScore: improvementDelta?.overallDelta || 0,
        previousVerdict: improvementDelta?.previousVerdict || "none",
      });
    } catch (err) {
      console.error("Feedback generation failed:", err);
      (window as any).pendo?.track("feedback_generation_failed", {
        sessionId: session.id,
        scenario: session.setup.scenario,
        persona: session.setup.persona,
        pressureLevel: session.setup.pressureLevel,
        errorMessage: String(err).substring(0, 200),
        transcriptTurnCount: session.transcript.length,
      });
      setError("Failed to generate feedback. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleShareCard = async () => {
    setShowShareCard(true);
    // Give time for render, then use canvas API to capture
    setTimeout(async () => {
      if (!shareCardRef.current) return;
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d")!;
        canvas.width = 600;
        canvas.height = 400;

        // Draw share card
        ctx.fillStyle = "#0D0D14";
        ctx.fillRect(0, 0, 600, 400);

        // Border
        ctx.strokeStyle = feedback?.verdict === "YES" ? "#22c55e" : feedback?.verdict === "NO" ? "#ef4444" : "#f59e0b";
        ctx.lineWidth = 3;
        ctx.strokeRect(2, 2, 596, 396);

        // Logo
        ctx.font = "bold 18px Inter, system-ui";
        ctx.fillStyle = "#7C6FE0";
        ctx.fillText("PitchForge", 30, 45);

        // Verdict
        ctx.font = "black 72px Inter, system-ui";
        ctx.fillStyle = feedback?.verdict === "YES" ? "#22c55e" : feedback?.verdict === "NO" ? "#ef4444" : "#f59e0b";
        ctx.fillText(feedback?.verdict || "", 30, 140);

        // Score
        const overallScore = Math.round(
          (feedback?.dimensions.reduce((sum, d) => sum + d.score, 0) || 0) / (feedback?.dimensions.length || 1)
        );
        ctx.font = "bold 28px Inter, system-ui";
        ctx.fillStyle = "#E2E2E8";
        ctx.fillText(`Score: ${overallScore}/100`, 30, 190);

        // Delta
        if (delta?.hasComparison) {
          const sign = delta.overallDelta >= 0 ? "+" : "";
          ctx.font = "16px Inter, system-ui";
          ctx.fillStyle = delta.overallDelta >= 0 ? "#1DB88E" : "#E05555";
          ctx.fillText(`${sign}${delta.overallDelta} from last session`, 30, 220);
        }

        // Primary reason
        ctx.font = "14px Inter, system-ui";
        ctx.fillStyle = "#888799";
        const reason = feedback?.primaryReason || "";
        const words = reason.split(" ");
        let line = "";
        let y = 260;
        for (const word of words) {
          const test = line + word + " ";
          if (ctx.measureText(test).width > 540) {
            ctx.fillText(line.trim(), 30, y);
            line = word + " ";
            y += 20;
            if (y > 320) break;
          } else {
            line = test;
          }
        }
        if (y <= 320) ctx.fillText(line.trim(), 30, y);

        // Hashtag
        ctx.font = "14px Inter, system-ui";
        ctx.fillStyle = "#7C6FE0";
        ctx.fillText("#EveryoneShipsNow  ·  pitchforge.app", 30, 375);

        // Download
        const link = document.createElement("a");
        link.download = `pitchforge-${feedback?.verdict?.toLowerCase()}-${Date.now()}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();

        (window as any).pendo?.track("share_card_downloaded", {
          sessionId: session?.id,
          verdict: feedback?.verdict,
          overallScore,
          hasImprovementDelta: delta?.hasComparison || false,
          improvementDeltaScore: delta?.overallDelta || 0,
          shareMethod: "png_download",
        });
      } catch {
        // Fallback: copy text
        const text = `${feedback?.verdict} | Score: ${Math.round((feedback?.dimensions.reduce((sum, d) => sum + d.score, 0) || 0) / (feedback?.dimensions.length || 1))}/100\n${feedback?.primaryReason}\n\n#EveryoneShipsNow #PitchForge`;
        await navigator.clipboard.writeText(text);
        alert("Share text copied to clipboard!");

        (window as any).pendo?.track("share_card_downloaded", {
          sessionId: session?.id,
          verdict: feedback?.verdict,
          overallScore,
          hasImprovementDelta: delta?.hasComparison || false,
          improvementDeltaScore: delta?.overallDelta || 0,
          shareMethod: "clipboard_copy",
        });
      }
      setShowShareCard(false);
    }, 100);
  };

  const handleRewind = (userTurn: ConversationTurn) => {
    if (!session || !feedback) return;
    // Find the persona turn that preceded this user turn
    const precedingTurn = session.transcript.find(
      (t) => t.role === "persona" && t.id === userTurn.id - 1
    );
    if (!precedingTurn) return;

    const rewindContext = {
      setup: session.setup,
      cognitiveState: session.cognitiveState,
      precedingPersonaTurn: precedingTurn,
      originalUserTurn: userTurn,
      transcriptUpToTurn: session.transcript.filter((t) => t.id <= userTurn.id),
    };
    sessionStorage.setItem("pitchforge_rewind", JSON.stringify(rewindContext));
    navigate("/rewind");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="flex gap-1 justify-center">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2.5 h-2.5 rounded-full bg-primary"
                style={{
                  animation: `pulseDot 1s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
          </div>
          <p className="text-muted-foreground text-sm">
            Analyzing your performance...
          </p>
        </div>
      </div>
    );
  }

  if (error || !feedback) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-destructive mx-auto" />
          <p className="text-muted-foreground">{error || "Something went wrong"}</p>
          <Button onClick={() => navigate("/")}>Go Home</Button>
        </div>
      </div>
    );
  }

  const overallScore = Math.round(
    feedback.dimensions.reduce((sum, d) => sum + d.score, 0) / feedback.dimensions.length
  );

  const persona = session ? PERSONAS[session.setup.persona] : null;

  return (
    <div className="min-h-screen pb-10">
      {/* Header */}
      <header className="flex items-center gap-3 p-6">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="font-semibold">Session Feedback</h1>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-muted-foreground"
          onClick={handleShareCard}
        >
          <Share2 className="w-4 h-4 mr-1" />
          Share
        </Button>
      </header>

      <main className="max-w-2xl mx-auto px-6 space-y-6">
        {/* Verdict Card */}
        <div
          className={cn(
            "rounded-xl border-2 p-6 text-center space-y-3",
            feedback.verdict === "YES" && "border-green-500 bg-green-500/5",
            feedback.verdict === "NO" && "border-red-500 bg-red-500/5",
            feedback.verdict === "MAYBE" && "border-amber-500 bg-amber-500/5"
          )}
        >
          <p
            className={cn(
              "text-5xl font-black",
              feedback.verdict === "YES" && "text-green-500",
              feedback.verdict === "NO" && "text-red-500",
              feedback.verdict === "MAYBE" && "text-amber-500"
            )}
          >
            {feedback.verdict}
          </p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {feedback.primaryReason}
          </p>
        </div>

        {/* Improvement Delta */}
        {delta?.hasComparison && (
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {delta.overallDelta > 0 ? (
                  <TrendingUp className="w-4 h-4 text-green-500" />
                ) : delta.overallDelta < 0 ? (
                  <TrendingDown className="w-4 h-4 text-red-500" />
                ) : (
                  <Minus className="w-4 h-4 text-muted-foreground" />
                )}
                <span className="text-sm font-medium">vs Last Session</span>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "text-lg font-bold",
                    delta.overallDelta > 0 && "text-green-500",
                    delta.overallDelta < 0 && "text-red-500",
                    delta.overallDelta === 0 && "text-muted-foreground"
                  )}
                >
                  {delta.overallDelta > 0 ? "+" : ""}
                  {delta.overallDelta}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({delta.previousOverallScore} → {overallScore})
                </span>
              </div>
            </div>

            {/* Per-dimension deltas */}
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(delta.dimensionDeltas).map(([dim, value]) => (
                <span
                  key={dim}
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full border",
                    value > 0 && "border-green-500/30 text-green-500 bg-green-500/5",
                    value < 0 && "border-red-500/30 text-red-500 bg-red-500/5",
                    value === 0 && "border-border text-muted-foreground"
                  )}
                >
                  {dim} {value > 0 ? `+${value}` : value}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Overall Score Ring */}
        <div className="flex items-center justify-center">
          <div className="relative w-28 h-28">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke="hsl(var(--border))"
                strokeWidth="6"
              />
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${overallScore * 2.51} ${100 * 2.51}`}
                className="ring-fill"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xl font-bold">{overallScore}</span>
            </div>
          </div>
        </div>

        {/* Dimension Scores */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">
            Scored Dimensions
          </h3>
          <div className="grid grid-cols-1 gap-2">
            {feedback.dimensions.map((dim) => (
              <div
                key={dim.dimension}
                className="rounded-lg border border-border bg-card p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium capitalize">
                    {dim.dimension}
                  </span>
                  <div className="flex items-center gap-2">
                    {delta?.hasComparison && delta.dimensionDeltas[dim.dimension] !== undefined && (
                      <span
                        className={cn(
                          "text-xs",
                          delta.dimensionDeltas[dim.dimension] > 0 && "text-green-500",
                          delta.dimensionDeltas[dim.dimension] < 0 && "text-red-500"
                        )}
                      >
                        {delta.dimensionDeltas[dim.dimension] > 0 ? "↑" : delta.dimensionDeltas[dim.dimension] < 0 ? "↓" : ""}
                        {delta.dimensionDeltas[dim.dimension] !== 0 && Math.abs(delta.dimensionDeltas[dim.dimension])}
                      </span>
                    )}
                    <span className="text-sm font-bold">{dim.score}</span>
                  </div>
                </div>
                <div className="w-full h-1.5 rounded-full bg-border overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-1000"
                    style={{ width: `${dim.score}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{dim.evidence}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Strongest Moment */}
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-green-500" />
            <h3 className="text-sm font-medium text-green-400">
              Strongest Moment
            </h3>
          </div>
          <p className="text-sm italic">
            &ldquo;{feedback.strongestMoment.content}&rdquo;
          </p>
          <p className="text-xs text-muted-foreground">
            Turn {feedback.strongestMoment.turnNumber} —{" "}
            {feedback.strongestMoment.explanation}
          </p>
        </div>

        {/* Biggest Weakness */}
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h3 className="text-sm font-medium text-red-400">
              Biggest Weakness
            </h3>
          </div>
          <p className="text-sm">{feedback.biggestWeakness}</p>
        </div>

        {/* Replay Challenge */}
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-medium text-primary">
              Replay Challenge
            </h3>
          </div>
          <p className="text-sm">{feedback.replayChallenge}</p>
        </div>

        {/* Stats bar */}
        <div className="flex items-center justify-around rounded-lg border border-border bg-card p-4">
          <div className="text-center">
            <p className="text-lg font-bold">{feedback.buzzwordCount}</p>
            <p className="text-xs text-muted-foreground">Buzzwords</p>
          </div>
          <div className="w-px h-8 bg-border" />
          <div className="text-center">
            <p className="text-lg font-bold">{feedback.fillerCount}</p>
            <p className="text-xs text-muted-foreground">Fillers</p>
          </div>
          <div className="w-px h-8 bg-border" />
          <div className="text-center">
            <p className="text-lg font-bold">{feedback.averageWpm}</p>
            <p className="text-xs text-muted-foreground">WPM</p>
          </div>
        </div>

        {/* Annotated Transcript Toggle */}
        <div>
          <button
            onClick={() => setShowTranscript(!showTranscript)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <MessageSquare className="w-4 h-4" />
            {showTranscript ? "Hide" : "View"} Annotated Transcript
          </button>

          {showTranscript && session && (
            <div className="mt-4 space-y-3">
              {session.transcript.map((turn) => {
                const isStrongest =
                  turn.role === "user" &&
                  turn.id === feedback.strongestMoment.turnNumber;
                const hasHighFillers =
                  turn.role === "user" && (turn.metadata?.fillerCount || 0) >= 3;
                const hasHighBuzzwords =
                  turn.role === "user" &&
                  (turn.metadata?.buzzwordCount || 0) >= 2;

                return (
                  <div
                    key={turn.id}
                    className={cn(
                      "rounded-lg p-3 text-sm border",
                      turn.role === "user"
                        ? "ml-4 border-border bg-card"
                        : "mr-4 border-border/50 bg-muted/30",
                      isStrongest && "border-green-500/50 bg-green-500/5",
                      hasHighFillers &&
                        !isStrongest &&
                        "border-orange-500/30 bg-orange-500/5",
                      hasHighBuzzwords &&
                        !isStrongest &&
                        !hasHighFillers &&
                        "border-amber-500/30 bg-amber-500/5"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">
                        Turn {turn.id} ·{" "}
                        {turn.role === "user"
                          ? "You"
                          : persona?.name || "Persona"}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {isStrongest && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 font-medium">
                            ★ Best
                          </span>
                        )}
                        {hasHighFillers && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-500 font-medium">
                            Fillers: {turn.metadata?.fillerCount}
                          </span>
                        )}
                        {hasHighBuzzwords && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-medium">
                            Buzzwords: {turn.metadata?.buzzwordCount}
                          </span>
                        )}
                        {turn.role === "user" && turn.metadata?.wpm && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            {turn.metadata.wpm} wpm
                          </span>
                        )}
                        {turn.metadata?.interrupted && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 font-medium">
                            ⚡ Interrupted
                          </span>
                        )}
                      </div>
                    </div>
                    <p className="text-foreground/90">{turn.content}</p>
                    {turn.role === "user" && (
                      <button
                        onClick={() => handleRewind(turn)}
                        className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Rewind this answer
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button onClick={() => navigate("/setup")} className="flex-1">
            <Repeat className="w-4 h-4 mr-2" />
            Try Again
          </Button>
          <Button
            onClick={() => navigate("/")}
            variant="outline"
            className="flex-1"
          >
            <Home className="w-4 h-4 mr-2" />
            Home
          </Button>
        </div>
      </main>

      {/* Hidden share card for rendering */}
      {showShareCard && (
        <div
          ref={shareCardRef}
          className="fixed -left-[9999px] top-0"
          aria-hidden
        />
      )}
    </div>
  );
}
