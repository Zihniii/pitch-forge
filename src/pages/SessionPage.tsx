import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Mic, MicOff, Square, Zap, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { OpponentPresence } from "@/components/OpponentPresence";
import {
  PERSONAS,
  PRESSURE_LEVELS,
  SCENARIOS,
  createInitialCognitiveState,
} from "@/lib/constants";
import { LiveSession } from "@/services/live-session";
import { countFillers, countBuzzwords } from "@/services/interruption-engine";
import { saveCurrentSession } from "@/services/storage";
import type {
  SessionSetup,
  ConversationTurn,
  SessionRecord,
} from "@/types";

type ArenaStatus = "ready" | "connecting" | "live" | "ended" | "error";

export default function SessionPage() {
  const navigate = useNavigate();

  const [setup, setSetup] = useState<SessionSetup | null>(null);
  const [status, setStatus] = useState<ArenaStatus>("ready");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [personaSpeaking, setPersonaSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [bargeFlash, setBargeFlash] = useState(false);

  // Live transcript surfacing
  const [personaLine, setPersonaLine] = useState("");
  const [userLine, setUserLine] = useState("");
  const [turnCount, setTurnCount] = useState(0);

  // Refs
  const sessionRef = useRef<LiveSession | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const sessionIdRef = useRef<string>(`session_${Date.now()}`);
  const bargeCountRef = useRef(0);
  const endedRef = useRef(false);

  // Transcript assembly: fragments arrive by role; flush on role switch.
  const transcriptRef = useRef<ConversationTurn[]>([]);
  const pendingRef = useRef<{ role: "user" | "persona"; text: string } | null>(null);
  const personaBufRef = useRef("");
  const userBufRef = useRef("");
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [inputLevel, setInputLevel] = useState(0);

  // ---- Load setup ----
  useEffect(() => {
    const raw = sessionStorage.getItem("pitchforge_setup");
    if (!raw) return;
    setSetup(JSON.parse(raw) as SessionSetup);
    return () => {
      sessionRef.current?.stop();
      if (levelTimerRef.current) clearInterval(levelTimerRef.current);
    };
  }, []);

  // ---- Transcript helpers ----
  const flushPending = useCallback(() => {
    const p = pendingRef.current;
    if (p && p.text.trim()) {
      const id = transcriptRef.current.length + 1;
      transcriptRef.current = [
        ...transcriptRef.current,
        { id, role: p.role, content: p.text.trim(), timestamp: Date.now() },
      ];
    }
    pendingRef.current = null;
  }, []);

  const appendFragment = useCallback(
    (role: "user" | "persona", text: string) => {
      if (!text) return;
      const p = pendingRef.current;
      if (p && p.role !== role) flushPending();
      if (!pendingRef.current) pendingRef.current = { role, text: "" };
      pendingRef.current.text += text;
    },
    [flushPending]
  );

  // ---- Start the live session ----
  const beginSession = useCallback(async () => {
    if (!setup) return;
    setStatus("connecting");
    setErrorMsg(null);
    startTimeRef.current = Date.now();

    const session = new LiveSession(setup, {
      onOpen: () => {
        setStatus("live");
        // poll input level for the mic meter
        levelTimerRef.current = setInterval(() => {
          setInputLevel(sessionRef.current?.getInputLevel() ?? 0);
        }, 120);
      },
      onUserText: (t) => {
        // a new user fragment means the persona's turn (if any) is over
        if (personaBufRef.current) {
          setPersonaLine(personaBufRef.current);
          personaBufRef.current = "";
        }
        userBufRef.current += t;
        setUserLine(userBufRef.current);
        appendFragment("user", t);
      },
      onPersonaText: (t) => {
        if (userBufRef.current) {
          userBufRef.current = "";
        }
        personaBufRef.current += t;
        setPersonaLine(personaBufRef.current);
        appendFragment("persona", t);
      },
      onPersonaSpeakingStart: () => {
        setPersonaSpeaking(true);
        setUserLine("");
      },
      onPersonaSpeakingEnd: () => setPersonaSpeaking(false),
      onInterrupted: () => {
        bargeCountRef.current += 1;
        setBargeFlash(true);
        setTimeout(() => setBargeFlash(false), 1400);
      },
      onTurnComplete: () => {
        setTurnCount((c) => c + 1);
        // lock in whatever the persona just said as the standing line
        if (personaBufRef.current) {
          setPersonaLine(personaBufRef.current);
        }
      },
      onError: (msg) => {
        console.error("Live error:", msg);
        setErrorMsg(msg);
        setStatus("error");
      },
      onClose: () => {
        if (!endedRef.current) {
          // unexpected close
        }
      },
    });

    sessionRef.current = session;
    try {
      await session.start();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(
        err?.name === "NotAllowedError"
          ? "Microphone access was blocked. Allow the mic and try again."
          : err?.message ?? "Could not start the live session."
      );
      setStatus("error");
    }
  }, [setup, appendFragment]);

  // ---- Mute toggle ----
  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    sessionRef.current?.setMuted(next);
  }, [muted]);

  // ---- End + go to feedback ----
  const handleEnd = useCallback(() => {
    if (endedRef.current || !setup) return;
    endedRef.current = true;

    flushPending();
    if (levelTimerRef.current) clearInterval(levelTimerRef.current);
    sessionRef.current?.stop();
    setStatus("ended");

    const transcript = transcriptRef.current;
    const pressure = PRESSURE_LEVELS.find((p) => p.id === setup.pressureLevel)!;
    const finalState = createInitialCognitiveState(pressure);
    finalState.stateMetrics.currentTurnCount = transcript.filter((t) => t.role === "user").length;

    const record: SessionRecord = {
      id: sessionIdRef.current,
      setup,
      cognitiveState: finalState,
      transcript,
      feedback: null,
      interruptions: [],
      startedAt: startTimeRef.current,
      endedAt: Date.now(),
    };
    saveCurrentSession(record);

    // Real measured signals from the user's transcribed words.
    const userText = transcript.filter((t) => t.role === "user").map((t) => t.content).join(" ");
    const durationSec = (Date.now() - startTimeRef.current) / 1000;
    const wordCount = userText.trim().split(/\s+/).filter(Boolean).length;
    sessionStorage.setItem(
      "pitchforge_measured",
      JSON.stringify({
        buzzwordCount: countBuzzwords(userText),
        fillerCount: countFillers(userText),
        averageWpm: durationSec > 0 ? Math.round(wordCount / (durationSec / 60)) : 0,
        totalDuration: durationSec,
        interruptionCount: bargeCountRef.current,
      })
    );

    navigate("/feedback");
  }, [setup, flushPending, navigate]);

  // Safety cap: wrap up after a long exchange.
  useEffect(() => {
    if (status === "live" && turnCount >= 22) handleEnd();
  }, [turnCount, status, handleEnd]);

  // ---- No setup ----
  if (!setup) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div className="space-y-4 text-center">
          <p className="font-display text-lg font-semibold">No active engagement</p>
          <p className="text-sm text-muted-foreground">Brief a session before entering the arena.</p>
          <button
            onClick={() => navigate("/setup")}
            className="rounded-lg bg-primary px-5 py-2.5 font-display text-sm font-semibold text-primary-foreground cursor-pointer"
          >
            Go to briefing
          </button>
        </div>
      </div>
    );
  }

  const persona = PERSONAS[setup.persona];
  const scenarioLabel = SCENARIOS.find((s) => s.id === setup.scenario)?.name || setup.scenario;
  const pressureLabel = PRESSURE_LEVELS.find((p) => p.id === setup.pressureLevel)?.name || "";
  const userTurns = transcriptRef.current.filter((t) => t.role === "user").length;

  // Pressure builds with the conversation (honest visual — no fake cognitive state in Live).
  const threat = Math.max(0, Math.min(10, 3 + Math.floor(turnCount / 2) + (bargeFlash ? 2 : 0)));

  const presenceState: "idle" | "listening" | "thinking" | "speaking" =
    status === "connecting" ? "thinking"
    : personaSpeaking ? "speaking"
    : status === "live" ? "listening"
    : "idle";

  // ---- Pre-session gate ----
  if (status === "ready" || status === "connecting" || status === "error") {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden spotlight px-6">
        <div className="arena-grid pointer-events-none absolute inset-0 opacity-40" />
        <div className="vignette pointer-events-none absolute inset-0" />

        <div className="relative z-10 flex flex-col items-center text-center">
          <OpponentPresence
            initial={persona.name.charAt(0)}
            state={status === "connecting" ? "thinking" : "idle"}
            threat={4}
            size={150}
          />
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {scenarioLabel} · {pressureLabel} · live voice
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight md:text-4xl">
            You're about to face {persona.name}
          </h1>
          <p className="mt-2 max-w-md text-[14px] leading-relaxed text-muted-foreground">
            {persona.archetype} This is a real-time voice conversation — they can
            hear you, interrupt you, and push back. Speak naturally. Cut in when you need to.
          </p>

          {status === "error" && errorMsg && (
            <div className="mt-5 flex items-center gap-2 rounded-lg border border-deny/40 bg-deny/10 px-4 py-2.5">
              <AlertTriangle className="h-4 w-4 text-deny" />
              <span className="text-[13px] text-deny">{errorMsg}</span>
            </div>
          )}

          {status === "connecting" ? (
            <div className="mt-9 flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="font-mono text-[12px] uppercase tracking-wider">Connecting…</span>
            </div>
          ) : (
            <button
              onClick={beginSession}
              className="group mt-9 inline-flex items-center gap-3 rounded-full bg-primary px-7 py-3.5 font-display text-[15px] font-semibold text-primary-foreground transition-all hover:gap-4 cursor-pointer"
            >
              <Mic className="h-4 w-4" />
              {status === "error" ? "Try again" : "Begin — allow your mic"}
            </button>
          )}

          <button
            onClick={() => navigate("/setup")}
            className="mt-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70 transition-colors hover:text-foreground cursor-pointer"
          >
            Back to briefing
          </button>
        </div>
      </div>
    );
  }

  // ---- Live arena ----
  return (
    <div
      className={cn(
        "relative min-h-screen overflow-hidden arena-enter",
        threat >= 7 ? "spotlight-deny" : "spotlight"
      )}
    >
      <div className="arena-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="vignette pointer-events-none absolute inset-0" />

      {/* Top bar */}
      <header className="relative z-20 flex items-center justify-between px-5 py-4 md:px-8">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 rounded-full border border-deny/40 bg-deny/10 px-2.5 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-deny live-pulse" />
            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-deny">Live</span>
          </span>
          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {scenarioLabel} · {pressureLabel}
          </span>
        </div>

        <div className="flex items-center gap-5">
          <div className="text-right">
            <p className="font-mono text-sm font-bold leading-none">{userTurns}</p>
            <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Exchanges</p>
          </div>
          <button
            onClick={handleEnd}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-deny/50 hover:text-deny cursor-pointer"
          >
            <Square className="h-3 w-3" />
            End
          </button>
        </div>
      </header>

      {/* Pressure meter */}
      <div className="relative z-20 px-5 md:px-8">
        <ThreatMeter threat={threat} />
      </div>

      {/* Stage */}
      <div className="relative z-10 flex flex-col items-center px-6 pt-6 pb-44 md:pt-10">
        <OpponentPresence
          initial={persona.name.charAt(0)}
          state={presenceState}
          threat={threat}
          size={150}
        />
        <p className="mt-4 font-display text-lg font-semibold tracking-tight">{persona.name}</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
          {persona.title}
        </p>

        {/* Persona's line */}
        <div className="mt-8 min-h-[120px] w-full max-w-2xl text-center">
          {bargeFlash ? (
            <div className="jolt">
              <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-threat/50 bg-threat/10 px-3 py-1">
                <Zap className="h-3 w-3 text-threat" />
                <span className="font-mono text-[10px] uppercase tracking-wider text-threat">
                  You cut in
                </span>
              </div>
              <p className="font-display text-xl font-medium leading-snug tracking-tight text-foreground/60 md:text-2xl">
                {personaLine}
              </p>
            </div>
          ) : personaLine ? (
            <p className="page-enter font-display text-2xl font-medium leading-snug tracking-tight text-foreground md:text-[28px]">
              {personaLine}
            </p>
          ) : (
            <p className="font-mono text-sm text-muted-foreground">
              {personaSpeaking ? "…" : "Opponent is sizing you up…"}
            </p>
          )}
        </div>

        {/* Your live words */}
        {userLine && (
          <div className="mt-6 w-full max-w-2xl">
            <p className="text-center font-mono text-[10px] uppercase tracking-wider text-primary">You</p>
            <p className="mt-2 text-center text-[15px] leading-relaxed text-foreground/70">{userLine}</p>
          </div>
        )}
      </div>

      {/* Mic dock — continuous in Live; button mutes */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex flex-col items-center pb-8 pt-6">
        <LiveMic
          muted={muted}
          personaSpeaking={personaSpeaking}
          level={inputLevel}
          onToggle={toggleMute}
        />
        <p className="mt-3 font-mono text-[11px] text-muted-foreground">
          {muted
            ? "Muted — tap to speak"
            : personaSpeaking
              ? `${persona.name} is talking — cut in anytime`
              : "Listening… just talk"}
        </p>
      </div>
    </div>
  );
}

/* ---------------- Pressure meter ---------------- */

function ThreatMeter({ threat }: { threat: number }) {
  const label = threat <= 3 ? "Holding" : threat <= 6 ? "Pressed" : threat <= 8 ? "Hostile" : "Critical";
  const color = threat <= 3 ? "text-confirm" : threat <= 6 ? "text-hold" : "text-deny";
  return (
    <div className="mx-auto flex max-w-2xl items-center gap-3">
      <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Pressure</span>
      <div className="flex h-1.5 flex-1 gap-0.5 overflow-hidden rounded-full">
        {Array.from({ length: 10 }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "flex-1 rounded-full transition-colors duration-500",
              i < threat
                ? threat <= 3 ? "bg-confirm" : threat <= 6 ? "bg-hold" : "bg-deny"
                : "bg-border"
            )}
          />
        ))}
      </div>
      <span className={cn("w-16 text-right font-mono text-[11px] font-semibold", color)}>{label}</span>
    </div>
  );
}

/* ---------------- Live mic ---------------- */

function LiveMic({
  muted,
  personaSpeaking,
  level,
  onToggle,
}: {
  muted: boolean;
  personaSpeaking: boolean;
  level: number;
  onToggle: () => void;
}) {
  const ringScale = 1 + Math.min(0.5, level * 0.8);
  if (muted) {
    return (
      <button
        onClick={onToggle}
        className="group relative flex h-20 w-20 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-transform hover:scale-105 cursor-pointer"
        aria-label="Unmute"
      >
        <MicOff className="h-7 w-7" />
      </button>
    );
  }
  return (
    <button
      onClick={onToggle}
      className={cn(
        "group relative flex h-20 w-20 items-center justify-center rounded-full transition-transform hover:scale-105 cursor-pointer",
        personaSpeaking ? "bg-primary/80 text-primary-foreground" : "bg-primary text-primary-foreground"
      )}
      aria-label="Mute"
    >
      {/* live input ring */}
      <span
        className="absolute inset-0 rounded-full border border-primary/40 transition-transform duration-100"
        style={{ transform: `scale(${ringScale})` }}
      />
      <span className="absolute -inset-2 rounded-full border border-primary/20 live-pulse" />
      <Mic className="relative h-7 w-7" />
    </button>
  );
}
