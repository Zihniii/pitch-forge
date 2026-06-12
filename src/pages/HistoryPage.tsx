import { useNavigate } from "react-router-dom";
import { Trash2, ArrowRight, Swords } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAllSessions, deleteSession } from "@/services/storage";
import { getProgressionProfile, sessionRatingDelta } from "@/services/progression";
import { PERSONAS, SCENARIOS } from "@/lib/constants";
import type { SessionRecord } from "@/types";

export default function HistoryPage() {
  const navigate = useNavigate();
  const sessions = getAllSessions()
    .filter((s) => s.feedback !== null)
    .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));
  const profile = getProgressionProfile();

  const handleDelete = (id: string) => {
    deleteSession(id);
    window.location.reload();
  };

  return (
    <div className="relative min-h-screen spotlight">
      <div className="arena-grid pointer-events-none absolute inset-0 opacity-30" />

      <div className="relative page-enter mx-auto max-w-2xl px-6 pt-24 pb-16">
        <div className="flex items-end justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Combat record
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">
              {sessions.length} engagement{sessions.length === 1 ? "" : "s"}
            </h1>
          </div>
          {sessions.length > 0 && (
            <div className="text-right">
              <p className="font-mono text-2xl font-bold tracking-tighter">{profile.rating}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Current CR
              </p>
            </div>
          )}
        </div>

        {sessions.length === 0 ? (
          <div className="mt-12 flex flex-col items-center rounded-2xl border border-border bg-card/40 p-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Swords className="h-6 w-6 text-primary" />
            </div>
            <p className="mt-4 font-display text-lg font-semibold">No battles yet</p>
            <p className="mt-1 max-w-xs text-[13px] text-muted-foreground">
              Your record is clean. Step into the arena and start building it.
            </p>
            <button
              onClick={() => navigate("/setup")}
              className="group mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 font-display text-[13px] font-semibold text-primary-foreground transition-all hover:gap-3 cursor-pointer"
            >
              Enter the arena
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="mt-8 space-y-2">
            {sessions.map((s) => (
              <Row key={s.id} session={s} onOpen={() => navigate(`/feedback?review=${s.id}`)} onDelete={() => handleDelete(s.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ session, onOpen, onDelete }: { session: SessionRecord; onOpen: () => void; onDelete: () => void }) {
  const f = session.feedback!;
  const persona = PERSONAS[session.setup.persona];
  const scenario = SCENARIOS.find((sc) => sc.id === session.setup.scenario)?.name || session.setup.scenario;
  const score = Math.round(f.dimensions.reduce((sum, d) => sum + d.score, 0) / f.dimensions.length);
  const delta = sessionRatingDelta(session);
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(session.endedAt || session.startedAt));

  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-center gap-4 rounded-xl border border-border bg-card/50 px-4 py-3.5 text-left transition-colors hover:border-primary/40 hover:bg-card/80 cursor-pointer"
    >
      {/* Verdict chip */}
      <span
        className={cn(
          "flex h-10 w-14 shrink-0 items-center justify-center rounded-lg font-display text-[11px] font-bold uppercase tracking-wider",
          f.verdict === "YES" && "bg-confirm/10 text-confirm",
          f.verdict === "NO" && "bg-deny/10 text-deny",
          f.verdict === "MAYBE" && "bg-hold/10 text-hold"
        )}
      >
        {f.verdict}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[14px] font-medium">{persona?.title}</p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {scenario} · {date}
        </p>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="font-mono text-[14px] font-bold">{score}</p>
          <span
            className={cn(
              "font-mono text-[10px] font-semibold",
              delta >= 0 ? "text-confirm" : "text-deny"
            )}
          >
            {delta >= 0 ? "+" : ""}
            {delta} CR
          </span>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground/40 transition-colors group-hover:text-primary" />
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onDelete(); } }}
          className="p-1.5 text-muted-foreground/50 transition-colors hover:text-deny cursor-pointer"
          aria-label="Delete session"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}
