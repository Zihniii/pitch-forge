import { useNavigate } from "react-router-dom";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getAllSessions, deleteSession } from "@/services/storage";
import { PERSONAS } from "@/lib/constants";
import type { SessionRecord } from "@/types";

export default function HistoryPage() {
  const navigate = useNavigate();
  const sessions = getAllSessions()
    .filter((s) => s.feedback !== null)
    .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0));

  const handleDelete = (id: string) => {
    deleteSession(id);
    // Force re-render
    window.location.reload();
  };

  const formatDate = (timestamp: number) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestamp));
  };

  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-3 p-6">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="font-semibold">Session History</h1>
        <span className="text-xs text-muted-foreground ml-auto">
          {sessions.length} session{sessions.length !== 1 ? "s" : ""}
        </span>
      </header>

      <main className="max-w-2xl mx-auto px-6 space-y-3">
        {sessions.length === 0 ? (
          <div className="text-center py-20 space-y-4">
            <p className="text-muted-foreground">No sessions yet.</p>
            <Button onClick={() => navigate("/setup")}>Start Your First Session</Button>
          </div>
        ) : (
          sessions.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              onDelete={() => handleDelete(session.id)}
              formatDate={formatDate}
            />
          ))
        )}
      </main>
    </div>
  );
}

function SessionCard({
  session,
  onDelete,
  formatDate,
}: {
  session: SessionRecord;
  onDelete: () => void;
  formatDate: (ts: number) => string;
}) {
  const feedback = session.feedback!;
  const persona = PERSONAS[session.setup.persona];
  const avgScore = Math.round(
    feedback.dimensions.reduce((sum, d) => sum + d.score, 0) / feedback.dimensions.length
  );

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "text-xs font-bold px-2 py-0.5 rounded",
              feedback.verdict === "YES" && "bg-green-500/10 text-green-500",
              feedback.verdict === "NO" && "bg-red-500/10 text-red-500",
              feedback.verdict === "MAYBE" && "bg-amber-500/10 text-amber-500"
            )}
          >
            {feedback.verdict}
          </span>
          <span className="text-sm font-medium">{persona?.title || "Persona"}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold">{avgScore}</span>
          <button
            onClick={onDelete}
            className="p-1 text-muted-foreground hover:text-destructive transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground line-clamp-2">
        {feedback.primaryReason}
      </p>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{session.setup.scenario.replace("-", " ")}</span>
        <span>{formatDate(session.endedAt || session.startedAt)}</span>
      </div>
    </div>
  );
}
