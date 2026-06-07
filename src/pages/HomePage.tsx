import { useNavigate } from "react-router-dom";
import { Mic, History, TrendingUp, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getSessionStats } from "@/services/storage";

export default function HomePage() {
  const navigate = useNavigate();
  const stats = getSessionStats();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between p-6">
        <h1 className="text-xl font-bold gradient-text">PitchForge</h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/history")}
          className="text-muted-foreground"
        >
          <History className="w-4 h-4 mr-2" />
          History
        </Button>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-2xl mx-auto">
        <div className="space-y-6">
          {/* Animated mic icon */}
          <div className="relative mx-auto w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
            <Mic className="w-9 h-9 text-primary" />
            <div className="absolute inset-0 rounded-full border-2 border-primary/30 animate-ping" />
          </div>

          <div className="space-y-3">
            <h2 className="text-3xl md:text-4xl font-bold">
              Master High-Stakes
              <span className="gradient-text block">Communication</span>
            </h2>
            <p className="text-muted-foreground text-lg max-w-md mx-auto">
              Practice against AI personas that interrupt, challenge, and push
              back — just like real humans do.
            </p>
          </div>

          {/* CTA */}
          <Button
            onClick={() => navigate("/setup")}
            size="lg"
            className="text-base px-8 py-6 rounded-xl"
          >
            <Zap className="w-5 h-5 mr-2" />
            Start a Session
          </Button>

          {/* Quick stats if user has history */}
          {stats.totalSessions > 0 && (
            <div className="flex items-center justify-center gap-6 pt-4">
              <div className="text-center">
                <p className="text-2xl font-bold">{stats.totalSessions}</p>
                <p className="text-xs text-muted-foreground">Sessions</p>
              </div>
              <div className="w-px h-8 bg-border" />
              <div className="text-center">
                <p className="text-2xl font-bold">{stats.averageScore}</p>
                <p className="text-xs text-muted-foreground">Avg Score</p>
              </div>
              <div className="w-px h-8 bg-border" />
              <div className="text-center">
                <p className="text-2xl font-bold">{stats.yesRate}%</p>
                <p className="text-xs text-muted-foreground">YES Rate</p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Features */}
      <section className="p-6 pb-10">
        <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: TrendingUp,
              title: "Adaptive Pressure",
              desc: "Difficulty adjusts in real-time based on your performance",
            },
            {
              icon: Mic,
              title: "Voice-First",
              desc: "Real conversation — interruptions, silence, and challenge",
            },
            {
              icon: Zap,
              title: "Evidence-Based",
              desc: "Every critique cites exactly what you said and when",
            },
          ].map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="rounded-lg border border-border bg-card p-4 space-y-2"
            >
              <Icon className="w-5 h-5 text-primary" />
              <h3 className="font-medium text-sm">{title}</h3>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
