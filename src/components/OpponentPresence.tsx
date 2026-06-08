import { cn } from "@/lib/utils";

type PresenceState = "idle" | "listening" | "thinking" | "speaking";

interface OpponentPresenceProps {
  initial: string;
  state: PresenceState;
  /** 0-10 — drives the ember intensity of the ring */
  threat: number;
  size?: number;
}

/**
 * The opponent's living presence. Not an avatar — a felt entity.
 * Breathes when idle, locks on when listening, pulses when speaking.
 * The ring runs hotter (ember) as threat rises.
 */
export function OpponentPresence({
  initial,
  state,
  threat,
  size = 140,
}: OpponentPresenceProps) {
  // Threat 0-10 → hue from amber (warm) to ember-red (hot)
  const hot = threat >= 7;
  const warm = threat >= 4;
  const ringColor = hot
    ? "hsl(var(--threat))"
    : warm
      ? "hsl(var(--hold))"
      : "hsl(var(--primary))";

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* Outer aura */}
      <div
        className={cn(
          "absolute inset-0 rounded-full blur-2xl transition-opacity duration-500",
          state === "speaking" ? "opacity-70" : "opacity-30"
        )}
        style={{ background: `radial-gradient(circle, ${ringColor}, transparent 70%)` }}
      />

      {/* Rotating threat ring */}
      <svg
        viewBox="0 0 100 100"
        className={cn(
          "absolute inset-0 h-full w-full",
          state === "speaking" ? "presence-speak" : "presence-breath"
        )}
      >
        <circle
          cx="50"
          cy="50"
          r="46"
          fill="none"
          stroke={ringColor}
          strokeWidth="1.5"
          strokeDasharray="4 6"
          opacity="0.65"
        />
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke={ringColor}
          strokeWidth="0.75"
          opacity="0.35"
        />
      </svg>

      {/* Listening lock-on brackets */}
      {state === "listening" && (
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
          {[0, 90, 180, 270].map((rot) => (
            <path
              key={rot}
              d="M 50 8 L 50 16"
              stroke="hsl(var(--primary))"
              strokeWidth="2"
              strokeLinecap="round"
              transform={`rotate(${rot} 50 50)`}
            />
          ))}
        </svg>
      )}

      {/* Core disc */}
      <div
        className="relative flex items-center justify-center rounded-full border bg-card"
        style={{
          width: size * 0.6,
          height: size * 0.6,
          borderColor: ringColor,
          boxShadow: `0 0 ${state === "speaking" ? 40 : 16}px ${ringColor}40`,
        }}
      >
        <span className="font-display text-2xl font-bold text-foreground">
          {initial}
        </span>
      </div>

      {/* Thinking dots */}
      {state === "thinking" && (
        <div className="absolute -bottom-1 flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: ringColor,
                animation: `pulseDot 1s ease-in-out ${i * 0.18}s infinite`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
