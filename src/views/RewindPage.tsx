"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Mic, Square, RotateCcw, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { OpponentPresence } from "@/components/OpponentPresence";
import { PERSONAS } from "@/lib/constants";
import { generatePersonaResponse } from "@/services/gemini";
import { startListening, stopListening, speak, stopSpeaking } from "@/services/speech";
import { calculateWpm } from "@/services/interruption-engine";
import type { SessionSetup, CognitiveState, ConversationTurn } from "@/types";

interface RewindContext {
  setup: SessionSetup;
  cognitiveState: CognitiveState;
  precedingPersonaTurn: ConversationTurn;
  originalUserTurn: ConversationTurn;
  transcriptUpToTurn: ConversationTurn[];
}

type RewindStatus = "ready" | "listening" | "processing" | "persona-speaking" | "done";

export default function RewindPage() {
  const router = useRouter();
  const [context, setContext] = useState<RewindContext | null>(null);
  const [status, setStatus] = useState<RewindStatus>("ready");
  const [newAnswer, setNewAnswer] = useState("");
  const [currentTranscript, setCurrentTranscript] = useState("");
  const [personaReaction, setPersonaReaction] = useState("");
  const [comparison, setComparison] = useState<string | null>(null);

  const turnStartRef = useRef<number>(Date.now());
  const turnTextRef = useRef<string>("");

  useEffect(() => {
    const raw = sessionStorage.getItem("pitchforge_rewind");
    if (!raw) {
      router.push("/");
      return;
    }
    setContext(JSON.parse(raw) as RewindContext);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartListening = useCallback(() => {
    if (status !== "ready") return;
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
          setCurrentTranscript((turnTextRef.current + " " + text).trim());
        }
      },
      onSilence: () => { if (turnTextRef.current.trim().length > 0) handleSubmitAnswer(); },
      onEnd: () => { if (turnTextRef.current.trim().length > 0) handleSubmitAnswer(); },
      onError: (err) => console.error("Speech error:", err),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const handleStopListening = useCallback(() => {
    stopListening();
    if (turnTextRef.current.trim().length > 0) handleSubmitAnswer();
    else setStatus("ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmitAnswer = async () => {
    stopListening();
    const text = turnTextRef.current.trim();
    if (!text || !context) return;

    setNewAnswer(text);
    setStatus("processing");

    const newUserTurn: ConversationTurn = {
      id: context.originalUserTurn.id,
      role: "user",
      content: text,
      timestamp: Date.now(),
      metadata: {
        wpm: calculateWpm(text, Date.now() - turnStartRef.current),
        duration: (Date.now() - turnStartRef.current) / 1000,
      },
    };

    const rewindTranscript = [
      ...context.transcriptUpToTurn.filter((t) => t.id < context.originalUserTurn.id),
      newUserTurn,
    ];

    try {
      const response = await generatePersonaResponse({
        setup: context.setup,
        state: context.cognitiveState,
        transcript: rewindTranscript,
        askedQuestions: [],
      });
      setPersonaReaction(response.reply);
      setStatus("persona-speaking");
      setComparison(generateComparison(context.originalUserTurn.content, text));
      speak(response.reply, context.setup.persona, {
        emotion: response.emotion,
        onEnd: () => setStatus("done"),
      });
    } catch (err) {
      console.error("Rewind LLM error:", err);
      (window as any).pendo?.track("persona_response_failed", {
        scenario: context.setup.scenario,
        persona: context.setup.persona,
        isRewind: true,
        error: (err as Error)?.message || 'Unknown error',
      });
      setStatus("done");
    }
  };

  const handleReset = () => {
    setStatus("ready");
    setNewAnswer("");
    setCurrentTranscript("");
    setPersonaReaction("");
    setComparison(null);
    stopSpeaking();
  };

  if (!context) return null;

  const persona = PERSONAS[context.setup.persona];
  const presenceState =
    status === "listening" ? "listening"
    : status === "processing" ? "thinking"
    : status === "persona-speaking" ? "speaking"
    : "idle";

  return (
    <div className="relative min-h-screen overflow-hidden spotlight">
      <div className="arena-grid pointer-events-none absolute inset-0 opacity-30" />

      <header className="relative z-20 flex items-center gap-3 px-5 py-4 md:px-8">
        <button
          onClick={() => router.back()}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Rewind</p>
          <p className="font-display text-[15px] font-semibold tracking-tight">
            Re-take turn {context.originalUserTurn.id}
          </p>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-xl px-6 pb-44 pt-2">
        {/* Opponent presence */}
        <div className="flex flex-col items-center">
          <OpponentPresence
            initial={persona.name.charAt(0)}
            state={presenceState}
            threat={5}
            size={104}
          />
          <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {persona.name} asked
          </p>
          <p className="mt-2 text-center font-display text-lg font-medium leading-snug tracking-tight">
            {context.precedingPersonaTurn.content}
          </p>
        </div>

        {/* Original answer */}
        <div className="mt-8 space-y-1.5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            What you said
          </p>
          <div className="rounded-xl border border-deny/20 bg-deny/[0.05] p-4">
            <p className="text-[13px] leading-relaxed text-foreground/70">
              {context.originalUserTurn.content}
            </p>
          </div>
        </div>

        {/* New answer */}
        {(newAnswer || (currentTranscript && status === "listening")) && (
          <div className="mt-4 space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-primary">
              {status === "done" ? "Your retake" : "Speaking…"}
            </p>
            <div
              className={cn(
                "rounded-xl border p-4",
                newAnswer ? "border-confirm/25 bg-confirm/[0.05]" : "border-primary/25 bg-primary/[0.05]"
              )}
            >
              <p className="text-[13px] leading-relaxed">
                {newAnswer || currentTranscript}
              </p>
            </div>
          </div>
        )}

        {/* Reaction */}
        {personaReaction && (
          <div className="mt-4 space-y-1.5">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {persona.name}'s reaction
            </p>
            <div className="rounded-xl border border-border bg-card/60 p-4">
              <p className="text-[14px] leading-relaxed">{personaReaction}</p>
            </div>
          </div>
        )}

        {comparison && (
          <div className="mt-4 rounded-xl border border-primary/25 bg-primary/[0.06] p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-primary">Quick read</p>
            <p className="mt-1.5 text-[13px]">{comparison}</p>
          </div>
        )}
      </main>

      {/* Control dock */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex flex-col items-center pb-8 pt-6">
        {status === "ready" && (
          <button
            onClick={handleStartListening}
            className="group relative flex h-18 w-18 items-center justify-center rounded-full bg-primary p-6 text-primary-foreground transition-transform hover:scale-105 cursor-pointer"
            aria-label="Record retake"
          >
            <span className="absolute -inset-2 rounded-full border border-primary/30" />
            <Mic className="h-6 w-6" />
          </button>
        )}
        {status === "listening" && (
          <button
            onClick={handleStopListening}
            className="group relative flex items-center justify-center rounded-full bg-deny p-6 text-white transition-transform hover:scale-105 cursor-pointer"
            aria-label="Lock in retake"
          >
            <span className="absolute inset-0 rounded-full bg-deny opacity-40 live-pulse" />
            <Square className="relative h-6 w-6 fill-current" />
          </button>
        )}
        {status === "processing" && (
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-2 w-2 rounded-full bg-primary" style={{ animation: `pulseDot 1s ease-in-out ${i * 0.2}s infinite` }} />
            ))}
          </div>
        )}
        {status === "done" && (
          <div className="flex gap-3">
            <button
              onClick={handleReset}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
              Again
            </button>
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-display text-[13px] font-semibold text-primary-foreground cursor-pointer"
            >
              <Check className="h-4 w-4" />
              Done
            </button>
          </div>
        )}
        <p className="mt-3 font-mono text-[11px] text-muted-foreground">
          {status === "ready"
            ? "Tap to record your better answer"
            : status === "listening"
              ? "Tap to lock it in"
              : status === "persona-speaking"
                ? `${persona.name} is reacting…`
                : ""}
        </p>
      </div>
    </div>
  );
}

function generateComparison(original: string, newAnswer: string): string {
  const o = original.split(/\s+/).length;
  const n = newAnswer.split(/\s+/).length;
  const notes: string[] = [];
  if (n < o) notes.push(`Tighter — ${n} words vs ${o}`);
  else if (n > o) notes.push(`Longer — ${n} words vs ${o}`);
  else notes.push("Same length");
  if (!/\bum\b|\buh\b/i.test(newAnswer) && /\bum\b|\buh\b/i.test(original)) notes.push("fewer fillers");
  if (newAnswer.split(".").length > original.split(".").length) notes.push("clearer structure");
  return notes.join(" · ") + ".";
}
