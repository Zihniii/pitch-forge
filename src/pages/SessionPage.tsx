import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Mic, MicOff, Square, Zap, Captions, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { OpponentPresence } from "@/components/OpponentPresence";
import {
  PERSONAS,
  PRESSURE_LEVELS,
  SCENARIOS,
  createInitialCognitiveState,
  MAX_TURNS,
} from "@/lib/constants";
import { generatePersonaResponse } from "@/services/gemini";
import type { TurnSignals } from "@/services/gemini";
import { startListening, stopListening } from "@/services/speech";
import { speakLine, cancelSpeech, primeVoice } from "@/services/voice";
import { LiveSession } from "@/services/live-session";
import {
  checkForInterruption,
  interruptionReasonLabel,
  calculateWpm,
  countBuzzwords,
  countFillers,
  detectBuzzwordsInText,
  detectFillersInText,
} from "@/services/interruption-engine";
import { saveCurrentSession } from "@/services/storage";
import type {
  SessionSetup,
  CognitiveState,
  ConversationTurn,
  InterruptionEvent,
  SessionStatus,
  SessionRecord,
} from "@/types";

export default function SessionPage() {
  const navigate = useNavigate();

  const [setup, setSetup] = useState<SessionSetup | null>(null);
  const [cognitiveState, setCognitiveState] = useState<CognitiveState | null>(null);
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [started, setStarted] = useState(false);
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [textInput, setTextInput] = useState("");
  const [interruptFlash, setInterruptFlash] = useState<string | null>(null);
  const [liveWpm, setLiveWpm] = useState(0);
  const [liveFillers, setLiveFillers] = useState(0);
  const [showCaptions, setShowCaptions] = useState(true);
  const [feed, setFeed] = useState<{ role: "user" | "persona"; text: string }[]>([]);
  const [personaLine, setPersonaLine] = useState("");
  const [quotaError, setQuotaError] = useState<string | null>(null);
  // Engine mode: try Live first; fall back to turn-based if Live can't connect.
  const [mode, setMode] = useState<"connecting" | "live" | "turn">("connecting");
  const liveRef = useRef<LiveSession | null>(null);
  const liveUserBufRef = useRef("");
  const livePersonaBufRef = useRef("");
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [inputLevel, setInputLevel] = useState(0);
  const [muted, setMuted] = useState(false);

  const [sessionId] = useState(`session_${Date.now()}`);
  const [startTime] = useState(Date.now());

  const turnStartRef = useRef<number>(Date.now());
  const turnTextRef = useRef<string>("");
  const transcriptRef = useRef<ConversationTurn[]>([]);
  const stateRef = useRef<CognitiveState | null>(null);
  const statusRef = useRef<SessionStatus>("idle");
  const processingRef = useRef<boolean>(false);
  const askedQuestionsRef = useRef<string[]>([]);
  const interruptionsRef = useRef<InterruptionEvent[]>([]);
  const aggregateRef = useRef({ buzzwords: 0, fillers: 0, wpmSum: 0, userTurns: 0 });
  const feedEndRef = useRef<HTMLDivElement>(null);
  const endedRef = useRef(false);

  useEffect(() => { stateRef.current = cognitiveState; }, [cognitiveState]);
  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [feed, currentTranscript]);

  // ---- Load setup ----
  useEffect(() => {
    const raw = sessionStorage.getItem("pitchforge_setup");
    if (!raw) return;
    setSetup(JSON.parse(raw) as SessionSetup);
    return () => {
      stopListening();
      cancelSpeech();
      liveRef.current?.stop();
      if (levelTimerRef.current) clearInterval(levelTimerRef.current);
    };
  }, []);

  const pushFeed = useCallback((role: "user" | "persona", text: string) => {
    if (!text.trim()) return;
    setFeed((prev) => [...prev, { role, text: text.trim() }]);
  }, []);

  // ---- Turn-based opening (fallback engine) ----
  const startTurnBased = useCallback(async () => {
    if (!setup) return;
    setMode("turn");
    const pressure = PRESSURE_LEVELS.find((p) => p.id === setup.pressureLevel)!;
    const initialState = createInitialCognitiveState(pressure);
    const weakness = sessionStorage.getItem("pitchforge_weakness");
    if (weakness) initialState.historicalGraphVectors.primaryWeaknessTargeted = weakness;
    setCognitiveState(initialState);
    stateRef.current = initialState;

    setStatus("processing");
    try {
      const response = await generatePersonaResponse({
        setup,
        state: initialState,
        transcript: [],
        askedQuestions: [],
      });
      const turn: ConversationTurn = { id: 1, role: "persona", content: response.reply, timestamp: Date.now() };
      transcriptRef.current = [turn];
      setCognitiveState(response.updatedState);
      stateRef.current = response.updatedState;
      if (response.questionAsked) askedQuestionsRef.current.push(response.questionAsked);
      setPersonaLine(response.reply);
      pushFeed("persona", response.reply);
      setStatus("persona-speaking");
      speakLine(response.reply, setup.persona, {
        emotion: response.emotion,
        onEnd: () => setStatus("idle"),
      });
    } catch (e: any) {
      console.error(e);
      if (e?.name === "RateLimitError") {
        setQuotaError(e.message);
        // Still let them try — show a minimal opening so the screen isn't empty.
        const fallback = PERSONAS[setup.persona].openingLines[0];
        transcriptRef.current = [{ id: 1, role: "persona", content: fallback, timestamp: Date.now() }];
        setPersonaLine(fallback);
        pushFeed("persona", fallback);
        setStatus("idle");
        return;
      }
      const fallback = PERSONAS[setup.persona].openingLines[0];
      transcriptRef.current = [{ id: 1, role: "persona", content: fallback, timestamp: Date.now() }];
      setPersonaLine(fallback);
      pushFeed("persona", fallback);
      setStatus("persona-speaking");
      speakLine(fallback, setup.persona, { onEnd: () => setStatus("idle") });
    }
  }, [setup, pushFeed]);

  // ---- Entry: try Live, fall back to turn-based ----
  const beginSession = useCallback(async () => {
    if (!setup) return;
    await primeVoice();
    setStarted(true);
    setMode("connecting");

    const live = new LiveSession(setup, {
      onOpen: () => {
        setMode("live");
        setStatus("idle");
        levelTimerRef.current = setInterval(() => {
          setInputLevel(liveRef.current?.getInputLevel() ?? 0);
        }, 120);
      },
      onUserText: (t) => {
        if (livePersonaBufRef.current) {
          flushLiveBuf("persona");
        }
        liveUserBufRef.current += t;
        setCurrentTranscript(liveUserBufRef.current);
      },
      onPersonaText: (t) => {
        if (liveUserBufRef.current) flushLiveBuf("user");
        livePersonaBufRef.current += t;
        setPersonaLine(livePersonaBufRef.current);
      },
      onPersonaSpeakingStart: () => { setStatus("persona-speaking"); setCurrentTranscript(""); },
      onPersonaSpeakingEnd: () => setStatus("idle"),
      onInterrupted: () => {
        interruptionsRef.current = [...interruptionsRef.current, { reason: "rambling", turnId: transcriptRef.current.length, timestamp: Date.now() }];
        setInterruptFlash("You cut in");
        setTimeout(() => setInterruptFlash(null), 1400);
      },
      onTurnComplete: () => { flushLiveBuf("persona"); flushLiveBuf("user"); },
      onError: (msg) => console.warn("[Live] error:", msg),
      onClose: () => {},
    });
    liveRef.current = live;

    try {
      await live.start();
      // success → onOpen already flipped mode to "live"
    } catch (e) {
      console.warn("[Live] unavailable, using turn-based engine:", e);
      live.stop();
      liveRef.current = null;
      if (levelTimerRef.current) clearInterval(levelTimerRef.current);
      await startTurnBased();
    }
  }, [setup, startTurnBased]);

  // Commit a streamed Live buffer into the transcript + caption feed.
  const flushLiveBuf = useCallback((role: "user" | "persona") => {
    const buf = role === "user" ? liveUserBufRef : livePersonaBufRef;
    const text = buf.current.trim();
    if (!text) return;
    buf.current = "";
    const id = transcriptRef.current.length + 1;
    transcriptRef.current = [...transcriptRef.current, { id, role, content: text, timestamp: Date.now() }];
    pushFeed(role, text);
    if (role === "user") {
      aggregateRef.current.buzzwords += countBuzzwords(text);
      aggregateRef.current.fillers += countFillers(text);
      setCurrentTranscript("");
    }
  }, [pushFeed]);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      liveRef.current?.setMuted(next);
      return next;
    });
  }, []);

  // ---- Listening ----
  const handleStartListening = useCallback(() => {
    if (!setup || status === "processing" || status === "persona-speaking") return;
    cancelSpeech();
    setStatus("listening");
    turnStartRef.current = Date.now();
    turnTextRef.current = "";
    setCurrentTranscript("");
    setLiveWpm(0);
    setLiveFillers(0);
    startListening({
      onResult: (text, isFinal) => {
        if (isFinal) {
          turnTextRef.current += " " + text;
          setCurrentTranscript(turnTextRef.current.trim());
        } else {
          setCurrentTranscript((turnTextRef.current + " " + text).trim());
        }
        const full = (turnTextRef.current + " " + text).trim();
        const elapsed = Date.now() - turnStartRef.current;
        setLiveWpm(calculateWpm(full, elapsed));
        setLiveFillers(countFillers(full));
      },
      onSilence: () => {
        if (statusRef.current === "listening" && turnTextRef.current.trim().length > 0) {
          submitTurn(turnTextRef.current.trim(), Date.now() - turnStartRef.current);
        }
      },
      onEnd: () => {
        if (statusRef.current === "listening" && turnTextRef.current.trim().length > 0) {
          submitTurn(turnTextRef.current.trim(), Date.now() - turnStartRef.current);
        }
      },
      onError: (err) => console.error("Speech error:", err),
    });
  }, [setup, status]);

  const handleStopListening = useCallback(() => {
    stopListening();
    if (turnTextRef.current.trim().length > 0) {
      submitTurn(turnTextRef.current.trim(), Date.now() - turnStartRef.current);
    } else {
      setStatus("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTextSubmit = () => {
    const t = textInput.trim();
    if (!t || status === "processing" || status === "persona-speaking") return;
    setTextInput("");
    submitTurn(t, Math.max(3000, t.split(/\s+/).length * 350));
  };

  // ---- Submit a turn ----
  const submitTurn = async (text: string, durationMs: number) => {
    if (processingRef.current || !setup || !stateRef.current) return;
    processingRef.current = true;
    stopListening();

    const wpm = calculateWpm(text, durationMs);
    const fillerCount = countFillers(text);
    const buzzwordCount = countBuzzwords(text);

    const agg = aggregateRef.current;
    agg.buzzwords += buzzwordCount;
    agg.fillers += fillerCount;
    if (wpm > 0) { agg.wpmSum += wpm; agg.userTurns += 1; }

    const signals: TurnSignals = {
      wpm,
      fillerCount,
      buzzwordCount,
      durationSec: durationMs / 1000,
      wordCount: text.trim().split(/\s+/).filter(Boolean).length,
      detectedBuzzwords: detectBuzzwordsInText(text),
      detectedFillers: detectFillersInText(text),
    };

    const turnId = transcriptRef.current.length + 1;
    const userTurn: ConversationTurn = {
      id: turnId,
      role: "user",
      content: text,
      timestamp: Date.now(),
      metadata: { wpm, fillerCount, buzzwordCount, duration: durationMs / 1000 },
    };
    transcriptRef.current = [...transcriptRef.current, userTurn];
    pushFeed("user", text);
    setCurrentTranscript("");
    setStatus("processing");

    const interruption = checkForInterruption(text, durationMs, wpm, stateRef.current);
    let directive = null;
    if (interruption.shouldInterrupt && interruption.reason) {
      interruptionsRef.current = [...interruptionsRef.current, { reason: interruption.reason, turnId, timestamp: Date.now() }];
      setInterruptFlash(interruption.message);
      setTimeout(() => setInterruptFlash(null), 2200);
      directive = { reason: interruptionReasonLabel(interruption.reason), message: interruption.message! };
    }

    if (transcriptRef.current.length >= MAX_TURNS * 2) {
      processingRef.current = false;
      finish();
      return;
    }

    try {
      const response = await generatePersonaResponse({
        setup,
        state: stateRef.current,
        transcript: transcriptRef.current,
        signals,
        interruption: directive,
        askedQuestions: askedQuestionsRef.current,
      });
      const personaTurn: ConversationTurn = {
        id: turnId + 1,
        role: "persona",
        content: response.reply,
        timestamp: Date.now(),
        metadata: { interrupted: interruption.shouldInterrupt },
      };
      transcriptRef.current = [...transcriptRef.current, personaTurn];
      setCognitiveState(response.updatedState);
      stateRef.current = response.updatedState;
      if (response.questionAsked) {
        askedQuestionsRef.current = [...askedQuestionsRef.current, response.questionAsked].slice(-12);
      }
      setPersonaLine(response.reply);
      pushFeed("persona", response.reply);
      setStatus("persona-speaking");
      speakLine(response.reply, setup.persona, {
        emotion: directive ? "interrupting" : response.emotion,
        onEnd: () => {
          processingRef.current = false;
          if (response.shouldEnd) finish();
          else setStatus("idle");
        },
      });
    } catch (error: any) {
      console.error("LLM error:", error);
      processingRef.current = false;
      if (error?.name === "RateLimitError") {
        setQuotaError(error.message);
        setStatus("idle");
      } else {
        setStatus("idle");
      }
    }
  };

  // ---- End session ----
  const finish = useCallback(() => {
    if (endedRef.current || !setup) return;
    endedRef.current = true;
    stopListening();
    cancelSpeech();
    liveRef.current?.stop();
    if (levelTimerRef.current) clearInterval(levelTimerRef.current);
    // flush any in-flight Live buffers into the transcript
    flushLiveBuf("persona");
    flushLiveBuf("user");
    setStatus("ended");

    const finalState = stateRef.current ?? createInitialCognitiveState(PRESSURE_LEVELS.find((p) => p.id === setup.pressureLevel)!);
    const record: SessionRecord = {
      id: sessionId,
      setup,
      cognitiveState: finalState,
      transcript: transcriptRef.current,
      feedback: null,
      interruptions: interruptionsRef.current,
      startedAt: startTime,
      endedAt: Date.now(),
    };
    saveCurrentSession(record);

    const agg = aggregateRef.current;
    sessionStorage.setItem(
      "pitchforge_measured",
      JSON.stringify({
        buzzwordCount: agg.buzzwords,
        fillerCount: agg.fillers,
        averageWpm: agg.userTurns ? Math.round(agg.wpmSum / agg.userTurns) : 0,
        totalDuration: (Date.now() - startTime) / 1000,
        interruptionCount: interruptionsRef.current.length,
      })
    );
    navigate("/feedback");
  }, [setup, sessionId, startTime, navigate]);

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

  const sm = cognitiveState?.stateMetrics;
  const threat = sm ? Math.max(0, Math.min(10, Math.round(10 - (sm.trustLevel + sm.interestLevel) / 2 + sm.confusionLevel / 2))) : 3;

  const presenceState =
    status === "listening" ? "listening"
    : status === "processing" ? "thinking"
    : status === "persona-speaking" ? "speaking"
    : "idle";

  // ---- Pre-session gate (needed for mic + audio gesture) ----
  if (!started || mode === "connecting") {
    const connecting = started && mode === "connecting";
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden spotlight px-6">
        <div className="arena-grid pointer-events-none absolute inset-0 opacity-40" />
        <div className="vignette pointer-events-none absolute inset-0" />
        <div className="relative z-10 flex flex-col items-center text-center">
          <OpponentPresence initial={persona.name.charAt(0)} state={connecting ? "thinking" : "idle"} threat={4} size={150} />
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {scenarioLabel} · {pressureLabel}
          </p>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight md:text-4xl">
            You're about to face {persona.name}
          </h1>
          <p className="mt-2 max-w-md text-[14px] leading-relaxed text-muted-foreground">
            {persona.archetype} They'll interrupt if you ramble, hedge, or stall.
          </p>
          {connecting ? (
            <div className="mt-9 flex items-center gap-2 text-muted-foreground">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="font-mono text-[12px] uppercase tracking-wider">Connecting voice…</span>
            </div>
          ) : (
            <button
              onClick={beginSession}
              className="group mt-9 inline-flex items-center gap-3 rounded-full bg-primary px-7 py-3.5 font-display text-[15px] font-semibold text-primary-foreground transition-all hover:gap-4 cursor-pointer"
            >
              <Mic className="h-4 w-4" />
              Enter the arena
            </button>
          )}
          {!connecting && (
            <button
              onClick={() => navigate("/setup")}
              className="mt-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70 transition-colors hover:text-foreground cursor-pointer"
            >
              Back to briefing
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---- Arena ----
  return (
    <div className={cn("relative flex h-screen flex-col overflow-hidden arena-enter", threat >= 7 ? "spotlight-deny" : "spotlight")}>
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
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="font-mono text-sm font-bold leading-none">{userTurns}<span className="text-muted-foreground">/{MAX_TURNS}</span></p>
            <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Turns</p>
          </div>
          <button
            onClick={() => setShowCaptions((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] transition-colors cursor-pointer",
              showCaptions ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <Captions className="h-3.5 w-3.5" />
            Captions
          </button>
          <button
            onClick={finish}
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

      {/* Quota / error banner */}
      {quotaError && (
        <div className="relative z-30 mx-auto mt-3 flex max-w-2xl items-center gap-2 rounded-lg border border-deny/40 bg-deny/10 px-4 py-2.5 mx-5 md:mx-auto">
          <Zap className="h-4 w-4 shrink-0 text-deny" />
          <span className="text-[12px] leading-snug text-deny">{quotaError}</span>
          <button
            onClick={() => setQuotaError(null)}
            className="ml-auto font-mono text-[10px] uppercase tracking-wider text-deny/70 hover:text-deny cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Stage — opponent (fixed) + scrolling feed */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center px-6 pt-5">
        <OpponentPresence initial={persona.name.charAt(0)} state={presenceState} threat={threat} size={108} />
        <p className="mt-3 font-display text-base font-semibold tracking-tight">{persona.name}</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{persona.title}</p>

        {interruptFlash && (
          <div className="jolt mt-3 inline-flex items-center gap-1.5 rounded-full border border-threat/50 bg-threat/10 px-3 py-1">
            <Zap className="h-3 w-3 text-threat" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-threat">Interrupted</span>
          </div>
        )}

        {/* Captions OFF: single big line */}
        {!showCaptions && (
          <div className="flex min-h-0 flex-1 w-full max-w-2xl items-center justify-center text-center">
            {personaLine ? (
              <p className="page-enter font-display text-2xl font-medium leading-snug tracking-tight text-foreground md:text-[28px]">
                {personaLine}
              </p>
            ) : (
              <p className="font-mono text-sm text-muted-foreground">Opponent is sizing you up…</p>
            )}
          </div>
        )}

        {/* Captions ON: scrolling feed fills remaining space */}
        {showCaptions && (
          <div className="mt-4 w-full max-w-2xl flex-1 space-y-2.5 overflow-y-auto px-1 pb-2">
            {feed.length === 0 && (
              <p className="text-center font-mono text-sm text-muted-foreground">Opponent is sizing you up…</p>
            )}
            {feed.map((b, i) => (
              <div key={i} className={cn("flex flex-col", b.role === "user" ? "items-end" : "items-start")}>
                <span className={cn("mb-0.5 font-mono text-[9px] uppercase tracking-wider", b.role === "user" ? "text-primary" : "text-muted-foreground")}>
                  {b.role === "user" ? "You" : persona.name}
                </span>
                <div className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed",
                  b.role === "user" ? "rounded-tr-sm bg-primary/12 text-foreground" : "rounded-tl-sm bg-card/70 text-foreground/90"
                )}>
                  {b.text}
                </div>
              </div>
            ))}
            {currentTranscript && (
              <div className="flex flex-col items-end">
                <span className="mb-0.5 font-mono text-[9px] uppercase tracking-wider text-primary">You</span>
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-dashed border-border bg-primary/8 px-3.5 py-2 text-[14px] leading-relaxed text-foreground/70">
                  {currentTranscript}
                </div>
              </div>
            )}
            <div ref={feedEndRef} />
          </div>
        )}
      </div>

      {/* Control dock — footer (part of the flex column, not floating) */}
      <div className="relative z-30 flex shrink-0 flex-col items-center gap-2 border-t border-border/50 bg-background/80 pb-5 pt-4 backdrop-blur">
        {status === "listening" && (
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span><span className={cn("font-semibold", liveWpm > 0 && (liveWpm < 90 || liveWpm > 180) ? "text-deny" : "text-foreground")}>{liveWpm || "—"}</span> wpm</span>
            <span><span className={cn("font-semibold", liveFillers >= 3 ? "text-deny" : "text-foreground")}>{liveFillers}</span> fillers</span>
          </div>
        )}
        {mode === "live" ? (
          <>
            <LiveMic muted={muted} personaSpeaking={status === "persona-speaking"} level={inputLevel} onToggle={toggleMute} />
            <p className="font-mono text-[11px] text-muted-foreground">
              {muted ? "Muted — tap to speak"
                : status === "persona-speaking" ? `${persona.name} is talking — cut in anytime`
                : "Listening… just talk"}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-primary/70">● Real-time voice</p>
          </>
        ) : (
          <>
            <MicControl status={status} onStart={handleStartListening} onStop={handleStopListening} />
            <p className="font-mono text-[11px] text-muted-foreground">
              {status === "listening" ? "Speaking… tap to send your answer"
                : status === "persona-speaking" ? `${persona.name} is responding…`
                : status === "processing" ? "Reading you…"
                : "Tap the mic to answer"}
            </p>
            {/* text fallback */}
            <div className="flex w-full max-w-md items-center gap-2 px-6">
              <input
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleTextSubmit(); }}
                placeholder="…or type your answer"
                disabled={status === "processing" || status === "persona-speaking"}
                className="flex-1 rounded-lg border border-border bg-card/60 px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/40 focus:border-primary/50 focus:outline-none disabled:opacity-40"
              />
              <button
                onClick={handleTextSubmit}
                disabled={!textInput.trim() || status === "processing" || status === "persona-speaking"}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-30 cursor-pointer"
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
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
              i < threat ? (threat <= 3 ? "bg-confirm" : threat <= 6 ? "bg-hold" : "bg-deny") : "bg-border"
            )}
          />
        ))}
      </div>
      <span className={cn("w-16 text-right font-mono text-[11px] font-semibold", color)}>{label}</span>
    </div>
  );
}

/* ---------------- Mic control (turn-based push-to-talk) ---------------- */

function MicControl({ status, onStart, onStop }: { status: SessionStatus; onStart: () => void; onStop: () => void }) {
  const disabled = status === "processing" || status === "persona-speaking";
  if (status === "listening") {
    return (
      <button
        onClick={onStop}
        className="group relative flex h-20 w-20 items-center justify-center rounded-full bg-deny text-white transition-transform hover:scale-105 cursor-pointer"
        aria-label="Send answer"
      >
        <span className="absolute inset-0 rounded-full bg-deny opacity-40 live-pulse" />
        <span className="absolute -inset-3 rounded-full border border-deny/40 live-pulse" />
        <Square className="relative h-6 w-6 fill-current" />
      </button>
    );
  }
  return (
    <button
      onClick={onStart}
      disabled={disabled}
      className={cn(
        "group relative flex h-20 w-20 items-center justify-center rounded-full transition-all cursor-pointer",
        disabled ? "bg-secondary text-muted-foreground/40 cursor-not-allowed" : "bg-primary text-primary-foreground hover:scale-105"
      )}
      aria-label="Start speaking"
    >
      {!disabled && <span className="absolute -inset-2 rounded-full border border-primary/30" />}
      <Mic className="h-7 w-7" />
    </button>
  );
}

/* ---------------- Live mic (continuous, mute toggle) ---------------- */

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
      <span
        className="absolute inset-0 rounded-full border border-primary/40 transition-transform duration-100"
        style={{ transform: `scale(${ringScale})` }}
      />
      <span className="absolute -inset-2 rounded-full border border-primary/20 live-pulse" />
      <Mic className="relative h-7 w-7" />
    </button>
  );
}
