import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Mic, MicOff, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionHUD } from "@/components/SessionHUD";
import { cn } from "@/lib/utils";
import {
  PERSONAS,
  PRESSURE_LEVELS,
  createInitialCognitiveState,
  MAX_TURNS,
} from "@/lib/constants";
import { generatePersonaResponse } from "@/services/gemini";
import {
  startListening,
  stopListening,
  speak,
  stopSpeaking,
} from "@/services/speech";
import {
  checkForInterruption,
  calculateWpm,
  countBuzzwords,
  countFillers,
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

  // Session state
  const [setup, setSetup] = useState<SessionSetup | null>(null);
  const [cognitiveState, setCognitiveState] = useState<CognitiveState | null>(null);
  const [transcript, setTranscript] = useState<ConversationTurn[]>([]);
  const [interruptions, setInterruptions] = useState<InterruptionEvent[]>([]);
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [sessionId] = useState(`session_${Date.now()}`);
  const [startTime] = useState(Date.now());

  // HUD metrics (cumulative for current session)
  const [liveWpm, setLiveWpm] = useState(0);
  const [totalFillers, setTotalFillers] = useState(0);
  const [totalBuzzwords, setTotalBuzzwords] = useState(0);

  // Refs for mutable state in callbacks
  const turnStartRef = useRef<number>(Date.now());
  const turnTextRef = useRef<string>("");
  const transcriptRef = useRef<ConversationTurn[]>([]);
  const stateRef = useRef<CognitiveState | null>(null);
  const statusRef = useRef<SessionStatus>("idle");

  // Keep refs in sync
  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);
  useEffect(() => {
    stateRef.current = cognitiveState;
  }, [cognitiveState]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Transcript auto-scroll
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, currentTranscript]);

  // ---- Initialize session ----
  useEffect(() => {
    const raw = sessionStorage.getItem("pitchforge_setup");
    if (!raw) {
      navigate("/setup");
      return;
    }

    const sessionSetup = JSON.parse(raw) as SessionSetup;
    setSetup(sessionSetup);

    const pressure = PRESSURE_LEVELS.find(
      (p) => p.id === sessionSetup.pressureLevel
    )!;
    const initialState = createInitialCognitiveState(pressure);
    setCognitiveState(initialState);

    getPersonaOpening(sessionSetup, initialState);
  }, []);

  // ---- Persona opening ----
  const getPersonaOpening = async (
    setup: SessionSetup,
    state: CognitiveState
  ) => {
    setStatus("processing");
    try {
      const response = await generatePersonaResponse(setup, state, []);
      const turn: ConversationTurn = {
        id: 1,
        role: "persona",
        content: response.reply,
        timestamp: Date.now(),
      };
      setTranscript([turn]);
      setCognitiveState(response.updatedState);
      setStatus("persona-speaking");

      (window as any).pendo?.track("practice_session_started", {
        scenario: setup.scenario,
        persona: setup.persona,
        pressureLevel: setup.pressureLevel,
        sessionId: sessionId,
      });

      speak(response.reply, setup.persona, () => {
        setStatus("idle");
      });
    } catch (error) {
      console.error("Failed to get persona opening:", error);

      (window as any).pendo?.track("persona_response_failed", {
        sessionId,
        turnNumber: 1,
        isOpeningGreeting: true,
        errorMessage: String(error).substring(0, 200),
        scenario: setup.scenario,
        persona: setup.persona,
      });

      const persona = PERSONAS[setup.persona];
      const fallback = `Hello. I'm ${persona.name}. You have my attention. Go ahead.`;
      const turn: ConversationTurn = {
        id: 1,
        role: "persona",
        content: fallback,
        timestamp: Date.now(),
      };
      setTranscript([turn]);
      setStatus("persona-speaking");
      speak(fallback, setup.persona, () => setStatus("idle"));
    }
  };

  // ---- Start listening ----
  const handleStartListening = useCallback(() => {
    if (!setup || status === "processing" || status === "persona-speaking")
      return;

    setStatus("listening");
    turnStartRef.current = Date.now();
    turnTextRef.current = "";
    setCurrentTranscript("");

    startListening({
      onResult: (text, isFinal) => {
        if (isFinal) {
          turnTextRef.current += " " + text;
          setCurrentTranscript(turnTextRef.current.trim());
        } else {
          setCurrentTranscript(turnTextRef.current + " " + text);
        }

        // Update live WPM for HUD
        const elapsed = Date.now() - turnStartRef.current;
        if (elapsed > 2000) {
          const currentWpm = calculateWpm(turnTextRef.current, elapsed);
          setLiveWpm(currentWpm);
        }
      },
      onSilence: () => {
        if (
          statusRef.current === "listening" &&
          turnTextRef.current.trim().length > 0
        ) {
          handleUserTurnComplete();
        }
      },
      onEnd: () => {
        if (
          statusRef.current === "listening" &&
          turnTextRef.current.trim().length > 0
        ) {
          handleUserTurnComplete();
        }
      },
      onError: (error) => {
        console.error("Speech error:", error);
        (window as any).pendo?.track("speech_recognition_error", {
          sessionId,
          errorType: typeof error === "object" && error !== null ? (error as any).error || "unknown" : "unknown",
          errorMessage: String(error).substring(0, 200),
          turnNumber: Math.ceil((transcriptRef.current?.length || 0) / 2) + 1,
          browserUserAgent: navigator.userAgent.substring(0, 200),
        });
      },
    });
  }, [setup, status]);

  // ---- Stop listening ----
  const handleStopListening = useCallback(() => {
    stopListening();
    if (turnTextRef.current.trim().length > 0) {
      handleUserTurnComplete();
    } else {
      setStatus("idle");
    }
  }, []);

  // ---- Process completed user turn ----
  const handleUserTurnComplete = async () => {
    stopListening();
    const text = turnTextRef.current.trim();
    if (!text || !setup || !stateRef.current) return;

    const duration = Date.now() - turnStartRef.current;
    const wpm = calculateWpm(text, duration);
    const fillerCount = countFillers(text);
    const buzzwordCount = countBuzzwords(text);

    // Update HUD totals
    setLiveWpm(wpm);
    setTotalFillers((prev) => prev + fillerCount);
    setTotalBuzzwords((prev) => prev + buzzwordCount);

    const turnId = transcriptRef.current.length + 1;
    const userTurn: ConversationTurn = {
      id: turnId,
      role: "user",
      content: text,
      timestamp: Date.now(),
      metadata: {
        wpm,
        fillerCount,
        buzzwordCount,
        duration: duration / 1000,
      },
    };

    (window as any).pendo?.track("user_turn_completed", {
      sessionId,
      turnId,
      wpm,
      fillerCount,
      buzzwordCount,
      turnDurationSeconds: Math.round(duration / 1000),
      wordCount: text.split(/\s+/).length,
      scenario: setup.scenario,
      persona: setup.persona,
    });

    setTranscript((prev) => [...prev, userTurn]);
    setCurrentTranscript("");
    setStatus("processing");

    // Check for interruption
    const interruption = checkForInterruption(
      text,
      duration,
      wpm,
      stateRef.current
    );
    if (
      interruption.shouldInterrupt &&
      interruption.reason &&
      interruption.message
    ) {
      (window as any).pendo?.track("interruption_triggered", {
        sessionId,
        turnId,
        interruptionReason: interruption.reason,
        scenario: setup.scenario,
        persona: setup.persona,
        pressureLevel: setup.pressureLevel,
      });

      setInterruptions((prev) => [
        ...prev,
        { reason: interruption.reason!, turnId, timestamp: Date.now() },
      ]);
    }

    // Check max turns
    const updatedTranscript = [...transcriptRef.current, userTurn];
    if (updatedTranscript.length >= MAX_TURNS * 2) {
      handleEndSession(updatedTranscript, stateRef.current);
      return;
    }

    // Get persona response
    try {
      const response = await generatePersonaResponse(
        setup,
        stateRef.current,
        updatedTranscript
      );

      const personaTurn: ConversationTurn = {
        id: turnId + 1,
        role: "persona",
        content: response.reply,
        timestamp: Date.now(),
        metadata: { interrupted: interruption.shouldInterrupt },
      };

      setTranscript((prev) => [...prev, personaTurn]);
      setCognitiveState(response.updatedState);

      if (response.shouldEnd) {
        setStatus("persona-speaking");
        speak(response.reply, setup.persona, () => {
          handleEndSession(
            [...updatedTranscript, personaTurn],
            response.updatedState
          );
        });
      } else {
        setStatus("persona-speaking");
        speak(response.reply, setup.persona, () => {
          setStatus("idle");
        });
      }
    } catch (error) {
      console.error("LLM error:", error);
      (window as any).pendo?.track("persona_response_failed", {
        sessionId,
        turnNumber: turnId + 1,
        isOpeningGreeting: false,
        errorMessage: String(error).substring(0, 200),
        scenario: setup.scenario,
        persona: setup.persona,
      });
      setStatus("idle");
    }
  };

  // ---- End session ----
  const handleEndSession = (
    finalTranscript: ConversationTurn[],
    finalState: CognitiveState
  ) => {
    stopListening();
    stopSpeaking();
    setStatus("ended");

    const record: SessionRecord = {
      id: sessionId,
      setup: setup!,
      cognitiveState: finalState,
      transcript: finalTranscript,
      feedback: null,
      interruptions,
      startedAt: startTime,
      endedAt: Date.now(),
    };

    const userTurns = finalTranscript.filter((t) => t.role === "user");
    (window as any).pendo?.track("practice_session_completed", {
      sessionId,
      scenario: setup!.scenario,
      persona: setup!.persona,
      pressureLevel: setup!.pressureLevel,
      totalTurns: userTurns.length,
      totalInterruptions: interruptions.length,
      sessionDurationSeconds: Math.round((Date.now() - startTime) / 1000),
      endReason: finalTranscript.length >= MAX_TURNS * 2 ? "max_turns" : "user_ended",
    });

    saveCurrentSession(record);
    navigate("/feedback");
  };

  const handleForceEnd = () => {
    if (cognitiveState) {
      handleEndSession(transcript, cognitiveState);
    }
  };

  // ---- Render ----
  if (!setup) return null;

  const persona = PERSONAS[setup.persona];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <span className="text-xs font-bold text-primary">
              {persona.name.charAt(0)}
            </span>
          </div>
          <div>
            <p className="text-sm font-medium">{persona.name}</p>
            <p className="text-xs text-muted-foreground">{persona.title}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Turn {Math.ceil(transcript.length / 2)}/{MAX_TURNS}
          </span>
          <Button variant="destructive" size="sm" onClick={handleForceEnd}>
            <Square className="w-3 h-3 mr-1" />
            End
          </Button>
        </div>
      </header>

      {/* Real-Time HUD — Phase 2 */}
      <div className="px-4 pt-3">
        <SessionHUD
          wpm={liveWpm}
          fillerCount={totalFillers}
          buzzwordCount={totalBuzzwords}
          cognitiveState={cognitiveState}
          isListening={status === "listening"}
        />
      </div>

      {/* Conversation transcript */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {transcript.map((turn) => (
          <div
            key={turn.id}
            className={cn(
              "max-w-[85%] rounded-lg p-3",
              turn.role === "user"
                ? "ml-auto bg-primary/10 text-foreground"
                : "mr-auto bg-card border border-border"
            )}
          >
            <p className="text-xs text-muted-foreground mb-1">
              {turn.role === "user" ? "You" : persona.name}
            </p>
            <p className="text-sm">{turn.content}</p>
            {turn.metadata?.interrupted && (
              <p className="text-xs text-orange-400 mt-1">⚡ Interrupted</p>
            )}
          </div>
        ))}

        {/* Current interim transcript */}
        {currentTranscript && status === "listening" && (
          <div className="max-w-[85%] ml-auto rounded-lg p-3 bg-primary/5 border border-primary/20">
            <p className="text-xs text-muted-foreground mb-1">
              You (speaking...)
            </p>
            <p className="text-sm text-foreground/70">{currentTranscript}</p>
          </div>
        )}

        {/* Processing indicator */}
        {status === "processing" && (
          <div className="max-w-[85%] mr-auto rounded-lg p-3 bg-card border border-border">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-primary"
                  style={{
                    animation: `pulseDot 1s ease-in-out ${i * 0.2}s infinite`,
                  }}
                />
              ))}
            </div>
          </div>
        )}

        <div ref={transcriptEndRef} />
      </div>

      {/* Bottom control bar */}
      <div className="border-t border-border p-4">
        <div className="flex items-center justify-center gap-4">
          {status === "persona-speaking" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Volume2 className="w-4 h-4 animate-pulse text-primary" />
              <span>{persona.name} is speaking...</span>
            </div>
          )}

          {(status === "idle" || status === "listening") && (
            <>
              {status === "idle" ? (
                <Button
                  onClick={handleStartListening}
                  size="lg"
                  className="w-16 h-16 rounded-full relative"
                >
                  <Mic className="w-6 h-6" />
                </Button>
              ) : (
                <Button
                  onClick={handleStopListening}
                  size="lg"
                  variant="destructive"
                  className="w-16 h-16 rounded-full animate-pulse"
                >
                  <MicOff className="w-6 h-6" />
                </Button>
              )}
            </>
          )}

          {status === "processing" && (
            <p className="text-sm text-muted-foreground">Thinking...</p>
          )}
        </div>

        {status === "idle" && (
          <p className="text-center text-xs text-muted-foreground mt-2">
            Tap the mic to speak
          </p>
        )}
        {status === "listening" && (
          <p className="text-center text-xs text-muted-foreground mt-2">
            Listening... tap to stop
          </p>
        )}
      </div>
    </div>
  );
}
