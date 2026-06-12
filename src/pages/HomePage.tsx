import { useNavigate } from "react-router-dom";
import { ArrowRight, Flame, Crosshair, Target } from "lucide-react";
import { Logo } from "@/components/Logo";
import { getProgressionProfile } from "@/services/progression";
import { PERSONAS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { PersonaId } from "@/types";

export default function HomePage() {
  const navigate = useNavigate();
  const p = getProgressionProfile();
  const hasHistory = p.totalSessions > 0;

  const quickStart = (scenario: string, persona: PersonaId) => {
    sessionStorage.setItem(
      "pitchforge_quickstart",
      JSON.stringify({ scenario, persona })
    );
    navigate("/setup");
  };

  return (
    <div className="relative min-h-screen spotlight">
      <div className="arena-grid pointer-events-none absolute inset-0 opacity-40" />

      <div className="relative page-enter mx-auto max-w-5xl px-6 pt-24 pb-20 md:pt-28">
        {!hasHistory ? (
          <FirstRun onEnter={() => navigate("/setup")} />
        ) : (
          <div className="stagger space-y-10">
            {/* Rating headline */}
            <RatingHeader profile={p} />

            {/* Primary CTA */}
            <button
              onClick={() => navigate("/setup")}
              className="group relative w-full overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent px-7 py-6 text-left transition-all duration-200 hover:border-primary/60 cursor-pointer"
            >
              <div className="relative z-10 flex items-center justify-between">
                <div>
                  <p className="font-display text-xl font-semibold tracking-tight text-foreground">
                    Enter the Arena
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Pick your opponent. Defend your idea under live pressure.
                  </p>
                </div>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform duration-200 group-hover:translate-x-1">
                  <ArrowRight className="h-5 w-5" />
                </div>
              </div>
            </button>

            {/* Stat strip */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <DeckStat label="Sessions" value={p.totalSessions} />
              <DeckStat label="YES rate" value={`${p.yesRate}%`} />
              <DeckStat
                label="Streak"
                value={p.currentStreak}
                icon={p.currentStreak >= 2 ? Flame : undefined}
                hot={p.currentStreak >= 2}
              />
              <DeckStat label="Peak" value={p.peakRating} mono />
            </div>

            {/* Two columns: weakness target + persona records */}
            <div className="grid gap-4 md:grid-cols-2">
              <WeaknessCard profile={p} />
              <PersonaRecords profile={p} />
            </div>

            {/* Quick deploy */}
            <section className="space-y-3">
              <SectionLabel>Quick deploy</SectionLabel>
              <div className="grid gap-3 sm:grid-cols-3">
                <DeployCard
                  title="Investor"
                  desc="Skeptical VC. No mercy on the numbers."
                  onClick={() => quickStart("pitch-startup", "skeptical-investor")}
                />
                <DeployCard
                  title="Recruiter"
                  desc="Reads through rehearsed answers instantly."
                  onClick={() => quickStart("job-interview", "demanding-recruiter")}
                />
                <DeployCard
                  title="Judge"
                  desc="30 seconds. Impact only. Go."
                  onClick={() => quickStart("hackathon-demo", "hackathon-judge")}
                />
              </div>
            </section>

            {/* Record link */}
            <button
              onClick={() => navigate("/history")}
              className="flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
            >
              View combat record
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- First run ---------------- */

function FirstRun({ onEnter }: { onEnter: () => void }) {
  return (
    <div className="page-enter flex min-h-[70vh] flex-col items-center justify-center text-center">
      <Logo size={56} className="mb-6" />
      <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1">
        <span className="h-1.5 w-1.5 rounded-full bg-primary live-pulse" />
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Communication Flight Simulator
        </span>
      </div>

      <h1 className="font-display text-5xl font-bold leading-[1.02] tracking-tightest md:text-7xl">
        Most ideas die
        <br />
        <span className="text-primary">in the room.</span>
      </h1>

      <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted-foreground">
        PitchForge throws you into high-pressure conversations against AI
        opponents that interrupt, doubt, and push back — in real time, out loud.
        Survive enough of them and you stop losing the room.
      </p>

      <button
        onClick={onEnter}
        className="group mt-9 inline-flex items-center gap-3 rounded-full bg-primary px-7 py-3.5 font-display text-[15px] font-semibold text-primary-foreground transition-all duration-200 hover:gap-4 cursor-pointer"
      >
        Step into the arena
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </button>

      <p className="mt-4 font-mono text-[11px] text-muted-foreground/60">
        Voice-first · Best in Chrome · ~60 seconds to your first verdict
      </p>
    </div>
  );
}

/* ---------------- Rating header ---------------- */

function RatingHeader({
  profile,
}: {
  profile: ReturnType<typeof getProgressionProfile>;
}) {
  const { rating, rank, nextRank, progressToNext, lastDelta } = profile;
  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
            {rank.name} · {rank.blurb}
          </p>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-mono text-5xl font-bold tracking-tighter text-foreground md:text-6xl">
              {rating}
            </span>
            <span className="font-mono text-sm text-muted-foreground">CR</span>
            {lastDelta !== null && lastDelta !== 0 && (
              <span
                className={cn(
                  "font-mono text-sm font-semibold",
                  lastDelta > 0 ? "text-confirm" : "text-deny"
                )}
              >
                {lastDelta > 0 ? "+" : ""}
                {lastDelta}
              </span>
            )}
          </div>
        </div>
        <Sparkline values={profile.recentRatings} />
      </div>

      {/* Rank progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
          <span>{rank.name}</span>
          <span>{nextRank ? nextRank.name : "Max rank"}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-primary transition-all duration-1000"
            style={{ width: `${Math.round(progressToNext * 100)}%` }}
          />
        </div>
        {nextRank && (
          <p className="font-mono text-[11px] text-muted-foreground/70">
            {nextRank.min - rating} CR to {nextRank.name}
          </p>
        )}
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 40;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width={w} height={h} className="shrink-0 opacity-90">
      <polyline
        points={pts}
        fill="none"
        stroke={up ? "hsl(var(--confirm))" : "hsl(var(--deny))"}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---------------- Cards ---------------- */

function DeckStat({
  label,
  value,
  mono,
  icon: Icon,
  hot,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  icon?: React.ElementType;
  hot?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/60 px-4 py-3.5">
      <div className="flex items-center gap-1.5">
        {Icon && (
          <Icon className={cn("h-3.5 w-3.5", hot ? "text-primary" : "text-muted-foreground")} />
        )}
        <span
          className={cn(
            "text-xl font-semibold tracking-tight",
            mono && "font-mono",
            hot && "text-primary"
          )}
        >
          {value}
        </span>
      </div>
      <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function WeaknessCard({
  profile,
}: {
  profile: ReturnType<typeof getProgressionProfile>;
}) {
  const w = profile.topWeakness;
  return (
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="flex items-center gap-2">
        <Target className="h-4 w-4 text-deny" />
        <SectionLabel>Targeted weakness</SectionLabel>
      </div>
      {w ? (
        <>
          <p className="mt-3 font-display text-2xl font-semibold capitalize tracking-tight">
            {w.dimension}
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Your lowest dimension at{" "}
            <span className="font-mono text-foreground">{w.avgScore}</span>/100.
            Your next opponent will hunt this in the first three turns.
          </p>
        </>
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">
          No data yet. Finish a session to reveal your weak spot.
        </p>
      )}
    </div>
  );
}

function PersonaRecords({
  profile,
}: {
  profile: ReturnType<typeof getProgressionProfile>;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-5">
      <div className="flex items-center gap-2">
        <Crosshair className="h-4 w-4 text-muted-foreground" />
        <SectionLabel>Win record vs opponents</SectionLabel>
      </div>
      <div className="mt-3 space-y-2.5">
        {profile.personaRecords.length === 0 && (
          <p className="text-[13px] text-muted-foreground">No encounters yet.</p>
        )}
        {profile.personaRecords.slice(0, 4).map((r) => {
          const persona = PERSONAS[r.personaId];
          const winRate = Math.round((r.yes / r.encounters) * 100);
          return (
            <div key={r.personaId} className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-[11px] font-bold">
                {persona?.name.charAt(0)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{persona?.title}</p>
              </div>
              <span className="font-mono text-[11px] text-muted-foreground">
                {r.encounters}×
              </span>
              <span
                className={cn(
                  "w-10 text-right font-mono text-[13px] font-semibold",
                  winRate >= 50 ? "text-confirm" : winRate > 0 ? "text-hold" : "text-deny"
                )}
              >
                {winRate}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeployCard({
  title,
  desc,
  onClick,
}: {
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group rounded-xl border border-border bg-card/40 p-4 text-left transition-all duration-200 hover:border-primary/40 hover:bg-card/80 cursor-pointer"
    >
      <p className="font-display text-[15px] font-semibold tracking-tight group-hover:text-primary transition-colors">
        {title}
      </p>
      <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{desc}</p>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      {children}
    </span>
  );
}
