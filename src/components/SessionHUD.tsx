import { cn } from "@/lib/utils";
import type { CognitiveState } from "@/types";

interface SessionHUDProps {
  wpm: number;
  fillerCount: number;
  buzzwordCount: number;
  cognitiveState: CognitiveState | null;
  isListening: boolean;
}

/**
 * Real-Time HUD — PRD Section 8, Step 6
 * Subtle, non-intrusive heads-up display surfacing live coaching signals.
 */
export function SessionHUD({
  wpm,
  fillerCount,
  buzzwordCount,
  cognitiveState,
  isListening,
}: SessionHUDProps) {
  if (!cognitiveState) return null;

  const { trustLevel, interestLevel, confusionLevel } = cognitiveState.stateMetrics;

  // Pressure indicator: derived from trust + interest (lower = more pressure)
  const pressureScore = Math.round(10 - (trustLevel + interestLevel) / 2);
  const pressureLabel =
    pressureScore <= 3 ? "Low" : pressureScore <= 6 ? "Medium" : "High";
  const pressureColor =
    pressureScore <= 3
      ? "text-green-500"
      : pressureScore <= 6
        ? "text-yellow-500"
        : "text-red-500";

  // WPM indicator
  const wpmStatus =
    wpm === 0 ? "neutral" : wpm < 100 ? "slow" : wpm > 170 ? "fast" : "good";

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2 rounded-lg border border-border/50 bg-card/80 backdrop-blur-sm transition-opacity duration-300",
        isListening ? "opacity-100" : "opacity-50"
      )}
    >
      {/* WPM */}
      <HUDMetric
        label="WPM"
        value={wpm || "—"}
        status={wpmStatus}
      />

      <div className="w-px h-6 bg-border/50" />

      {/* Fillers */}
      <HUDMetric
        label="Fillers"
        value={fillerCount}
        status={fillerCount >= 3 ? "danger" : fillerCount >= 1 ? "warn" : "good"}
      />

      <div className="w-px h-6 bg-border/50" />

      {/* Buzzwords */}
      <HUDMetric
        label="Buzz"
        value={buzzwordCount}
        status={buzzwordCount >= 3 ? "danger" : buzzwordCount >= 1 ? "warn" : "good"}
      />

      <div className="w-px h-6 bg-border/50" />

      {/* Pressure Indicator */}
      <div className="flex items-center gap-1.5">
        <PressureBar level={pressureScore} />
        <div className="text-center">
          <p className={cn("text-xs font-bold tabular-nums", pressureColor)}>
            {pressureLabel}
          </p>
          <p className="text-[9px] text-muted-foreground">Pressure</p>
        </div>
      </div>
    </div>
  );
}

// --- Sub-components ---

function HUDMetric({
  label,
  value,
  status,
}: {
  label: string;
  value: string | number;
  status: "good" | "warn" | "danger" | "slow" | "fast" | "neutral";
}) {
  const color =
    status === "good"
      ? "text-green-500"
      : status === "warn"
        ? "text-yellow-500"
        : status === "danger"
          ? "text-red-500"
          : status === "slow"
            ? "text-blue-400"
            : status === "fast"
              ? "text-orange-400"
              : "text-muted-foreground";

  return (
    <div className="text-center min-w-[40px]">
      <p className={cn("text-sm font-bold tabular-nums", color)}>{value}</p>
      <p className="text-[9px] text-muted-foreground">{label}</p>
    </div>
  );
}

function PressureBar({ level }: { level: number }) {
  // 5 bars, filled based on level (0-10)
  const filled = Math.ceil(level / 2);
  return (
    <div className="flex gap-0.5 items-end">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "w-1 rounded-full transition-all duration-300",
            i < filled
              ? level <= 4
                ? "bg-green-500"
                : level <= 7
                  ? "bg-yellow-500"
                  : "bg-red-500"
              : "bg-border"
          )}
          style={{ height: `${8 + i * 3}px` }}
        />
      ))}
    </div>
  );
}
