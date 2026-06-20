"use client";

import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";

/**
 * Journey-aware shell.
 * Immersive routes (Arena, Verdict, Rewind) render full-bleed with no chrome —
 * the user is "inside the simulation", not "using software".
 * Ambient routes (Command Deck, Briefing, Record) get a minimal wordmark only.
 */
const IMMERSIVE = ["/session", "/feedback", "/rewind"];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const immersive = IMMERSIVE.includes(pathname);

  return (
    <div className="min-h-screen bg-background">
      {!immersive && (
        <button
          onClick={() => router.push("/")}
          className="fixed top-5 left-5 md:top-6 md:left-8 z-50 flex items-center gap-2 cursor-pointer group"
          aria-label="PitchForge — Command Deck"
        >
          <Logo size={22} className="transition-transform duration-200 group-hover:scale-110" />
          <span className="font-display text-[15px] font-semibold tracking-tight text-foreground group-hover:text-primary transition-colors">
            PitchForge
          </span>
        </button>
      )}
      <main>
        {children}
      </main>
    </div>
  );
}
