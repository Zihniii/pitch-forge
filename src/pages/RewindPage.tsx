import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Mic, MicOff, RotateCcw, Check, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  const navigate = useNavigate();
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
      navigate("/");
      return;
    }
    setContext(JSON.parse(raw) as RewindContext);
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
          setCurrentTranscript(turnTextRef.current + " " + text);
        }
      },
      onSilence: () => {
        if (turnTextRef.current.trim().length > 0) {
          handleSubmitAnswer();
        }
      },
      onEnd: () => {
        if (turnTextRef.current.trim().length > 0) {
          handleSubmitAnswer();
        }
      },
      onError: (err) => console.error("Speech error:", err),
    });
  }, [status]);

  const handleStopListening = useCallback(() => {
    stopListening();
    if (turnTextRef.current.trim().length > 0) {
      handleSubmitAnswer();
    } else {
      setStatus("ready");
    }
  }, []);

  const handleSubmitAnswer = async () => {
    stopListening();
    const text = turnTextRef.current.trim();
    if (!text || !context) return;

    setNewAnswer(text);
    setStatus("processing");

    // Build transcript up to this point, replacing the original user turn with the new one
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
      const response = await generatePersonaResponse(
        context.setup,
        context.cognitiveState,
        rewindTranscript
      );

      setPersonaReaction(response.reply);
      setStatus("persona-speaking");

      // Generate comparison
      const comparisonText = generateComparison(
        context.originalUserTurn.content,
        text,
        response.reply
      );
      setComparison(comparisonText);

      speak(response.reply, context.setup.persona, () => {
        setStatus("done");
      });
    } catch (err) {
      console.error("Rewind LLM error:", err);
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

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 p-6 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="font-semibold">Conversation Rewind</h1>
          <p className="text-xs text-muted-foreground">
            Re-attempt Turn {context.originalUserTurn.id}
          </p>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-2xl mx-auto w-full space-y-6">
        {/* The persona's question that preceded the user's answer */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">
            {persona.name} asked:
          </p>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="text-sm">{context.precedingPersonaTurn.content}</p>
          </div>
        </div>

        {/* Original answer */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">
            Your original answer (Turn {context.originalUserTurn.id}):
          </p>
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
            <p className="text-sm text-foreground/70">
              {context.originalUserTurn.content}
            </p>
          </div>
        </div>

        {/* New answer area */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">
            {status === "done" ? "Your new answer:" : "Try again — say it better:"}
          </p>

          {newAnswer ? (
            <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4">
              <p className="text-sm">{newAnswer}</p>
            </div>
          ) : currentTranscript && status === "listening" ? (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <p className="text-sm text-foreground/70">{currentTranscript}</p>
            </div>
          ) : null}
        </div>

        {/* Persona reaction */}
        {personaReaction && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">
              {persona.name}'s reaction:
            </p>
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="text-sm">{personaReaction}</p>
            </div>
          </div>
        )}

        {/* Comparison */}
        {comparison && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
            <p className="text-xs font-medium text-primary">Quick Assessment</p>
            <p className="text-sm">{comparison}</p>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-center gap-4 pt-4">
          {status === "ready" && (
            <Button
              onClick={handleStartListening}
              size="lg"
              className="w-16 h-16 rounded-full relative"
            >
              <Mic className="w-6 h-6" />
            </Button>
          )}

          {status === "listening" && (
            <Button
              onClick={handleStopListening}
              size="lg"
              variant="destructive"
              className="w-16 h-16 rounded-full animate-pulse"
            >
              <MicOff className="w-6 h-6" />
            </Button>
          )}

          {status === "processing" && (
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 rounded-full bg-primary"
                  style={{ animation: `pulseDot 1s ease-in-out ${i * 0.2}s infinite` }}
                />
              ))}
            </div>
          )}

          {status === "persona-speaking" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Volume2 className="w-4 h-4 animate-pulse text-primary" />
              <span>{persona.name} is reacting...</span>
            </div>
          )}

          {status === "done" && (
            <div className="flex gap-3">
              <Button onClick={handleReset} variant="outline">
                <RotateCcw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
              <Button onClick={() => navigate(-1)}>
                <Check className="w-4 h-4 mr-2" />
                Done
              </Button>
            </div>
          )}
        </div>

        {status === "ready" && (
          <p className="text-center text-xs text-muted-foreground">
            Tap the mic to record your improved answer
          </p>
        )}
      </main>
    </div>
  );
}

// --- Comparison Helper ---

function generateComparison(original: string, newAnswer: string, reaction: string): string {
  const originalWords = original.split(/\s+/).length;
  const newWords = newAnswer.split(/\s+/).length;
  const shorter = newWords < originalWords;
  const brevityNote = shorter
    ? `More concise (${newWords} words vs ${originalWords}).`
    : newWords === originalWords
      ? `Same length.`
      : `Longer (${newWords} words vs ${originalWords}).`;

  // Simple heuristic comparison
  const improvements: string[] = [];
  if (shorter) improvements.push("Better brevity");
  if (!newAnswer.toLowerCase().includes("um") && original.toLowerCase().includes("um")) {
    improvements.push("Fewer fillers");
  }
  if (newAnswer.split(".").length > original.split(".").length) {
    improvements.push("Better structure");
  }

  return `${brevityNote} ${improvements.length > 0 ? improvements.join(", ") + "." : "Compare the persona's reaction to gauge improvement."}`;
}
