"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  Rocket,
  Briefcase,
  Cpu,
  Timer,
  Presentation,
  Search,
  Check,
} from "lucide-react";
import { DocumentUpload } from "@/components/DocumentUpload";
import { cn } from "@/lib/utils";
import { SCENARIOS, PERSONAS, PRESSURE_LEVELS } from "@/lib/constants";
import { getProgressionProfile } from "@/services/progression";
import type { ScenarioId, PersonaId, PressureLevel, SessionSetup, PersonaCategory } from "@/types";

const SCENARIO_ICONS: Record<string, React.ElementType> = {
  rocket: Rocket,
  briefcase: Briefcase,
  cpu: Cpu,
  timer: Timer,
  presentation: Presentation,
  search: Search,
};

const PRESSURE_META: Record<
  PressureLevel,
  { tag: string; color: string; bar: number }
> = {
  coaching: { tag: "Warm-up", color: "text-confirm", bar: 1 },
  realistic: { tag: "Standard", color: "text-hold", bar: 2 },
  aggressive: { tag: "Hostile", color: "text-threat", bar: 3 },
  brutal: { tag: "No mercy", color: "text-deny", bar: 4 },
};

const CATEGORY_ORDER: PersonaCategory[] = [
  "startup",
  "career",
  "sales",
  "leadership",
  "presentation",
  "customer",
];

const CATEGORY_LABELS: Record<PersonaCategory, string> = {
  startup: "Startup & Fundraising",
  career: "Career & Interviews",
  sales: "Sales & Deals",
  leadership: "Leadership & Stakeholders",
  presentation: "Stage & Media",
  customer: "Customers",
};

type Stage = 1 | 2 | 3;

export default function SetupPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>(1);

  const [nameAndRole, setNameAndRole] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [valueProposition, setValueProposition] = useState("");
  const [scenario, setScenario] = useState<ScenarioId>("pitch-startup");
  const [persona, setPersona] = useState<PersonaId>("skeptical-investor");
  const [pressureLevel, setPressureLevel] = useState<PressureLevel>("realistic");

  const profile = getProgressionProfile();
  const targetedWeakness = profile.topWeakness?.dimension ?? null;

  useEffect(() => {
    const qs = sessionStorage.getItem("pitchforge_quickstart");
    if (qs) {
      const { scenario: s, persona: p } = JSON.parse(qs);
      if (s) setScenario(s);
      if (p) setPersona(p);
      sessionStorage.removeItem("pitchforge_quickstart");
    }
  }, []);

  const handleScenario = (s: ScenarioId) => {
    setScenario(s);
    const def = SCENARIOS.find((sc) => sc.id === s)?.defaultPersona;
    if (def) setPersona(def);
  };

  const deploy = () => {
    const setup: SessionSetup = {
      nameAndRole,
      productDescription,
      valueProposition,
      scenario,
      persona,
      pressureLevel,
    };
    sessionStorage.setItem("pitchforge_setup", JSON.stringify(setup));
    if (targetedWeakness) {
      sessionStorage.setItem("pitchforge_weakness", targetedWeakness);
    }

    // Persist and sync visitor metadata
    const [rawName, ...roleParts] = nameAndRole.split(",");
    const visitorName = rawName.trim();
    const visitorRole = roleParts.join(",").trim();
    localStorage.setItem('pitchforge_visitor_meta', JSON.stringify({ visitorName, visitorRole }));
    (window as any).pendo?.identify?.({
      visitor: {
        id: localStorage.getItem('pitchforge_visitor_id') || '',
        visitorName,
        visitorRole,
      },
    });

    (window as any).pendo?.track("session_setup_completed", {
      scenario,
      persona,
      pressureLevel,
    });

    router.push("/session");
  };

  const canAdvance = stage === 1 ? !!(nameAndRole.trim() && productDescription.trim() && valueProposition.trim()) : true;
  const activePersona = PERSONAS[persona];

  return (
    <div className="relative min-h-screen spotlight">
      <div className="arena-grid pointer-events-none absolute inset-0 opacity-30" />

      <div className="relative page-enter mx-auto flex min-h-screen max-w-2xl flex-col px-6 pt-24 pb-28">
        {/* Stage rail */}
        <div className="mb-8 flex items-center gap-3">
          {(["Mission", "Opponent", "Intensity"] as const).map((label, i) => {
            const n = (i + 1) as Stage;
            const done = n < stage;
            const active = n === stage;
            return (
              <div key={label} className="flex items-center gap-3">
                <button
                  onClick={() => n < stage && setStage(n)}
                  disabled={n > stage}
                  className={cn(
                    "flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.15em] transition-colors",
                    active && "text-primary",
                    done && "text-foreground cursor-pointer hover:text-primary",
                    !active && !done && "text-muted-foreground/50"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full border text-[10px]",
                      active && "border-primary text-primary",
                      done && "border-confirm bg-confirm/10 text-confirm",
                      !active && !done && "border-border"
                    )}
                  >
                    {done ? <Check className="h-3 w-3" /> : n}
                  </span>
                  <span className="hidden sm:inline">{label}</span>
                </button>
                {i < 2 && <span className="h-px w-6 bg-border" />}
              </div>
            );
          })}
        </div>

        <div className="flex-1">
          {stage === 1 && (
            <div className="page-enter space-y-7">
              <Heading
                kicker="Mission brief"
                title="What are you walking in to defend?"
                sub="This becomes everything your opponent knows. Be specific — vague briefs get torn apart."
              />

              <div className="space-y-5">
                <Field label="Who are you?" hint='Name and role — "Sarah, founder of a B2B SaaS startup"'>
                  <input
                    autoFocus
                    value={nameAndRole}
                    onChange={(e) => setNameAndRole(e.target.value)}
                    placeholder="Sarah, founder of a B2B SaaS startup"
                    className={inputCls}
                  />
                </Field>
                <Field label="What are you pitching?" hint="2–3 sentences. The product, project, or yourself.">
                  <textarea
                    rows={3}
                    value={productDescription}
                    onChange={(e) => setProductDescription(e.target.value)}
                    placeholder="An AI scheduling tool for small clinics that cuts no-shows by 40%..."
                    className={cn(inputCls, "resize-none")}
                  />
                </Field>
                <Field label="The one thing they must believe" hint="If they only remember one sentence, what is it?">
                  <input
                    value={valueProposition}
                    onChange={(e) => setValueProposition(e.target.value)}
                    placeholder="This is the team that will own this market."
                    className={inputCls}
                  />
                </Field>
              </div>

              <DocumentUpload
                onExtracted={(text) =>
                  setProductDescription((prev) =>
                    prev.trim() ? prev + "\n\n" + text.slice(0, 500) : text.slice(0, 500)
                  )
                }
              />
            </div>
          )}

          {stage === 2 && (
            <div className="page-enter space-y-7">
              <Heading
                kicker="Choose your arena"
                title="Who's across the table?"
                sub="The scenario sets the room. The opponent sets the pressure."
              />

              {/* Scenario chips */}
              <div className="flex flex-wrap gap-2">
                {SCENARIOS.map((s) => {
                  const Icon = SCENARIO_ICONS[s.icon] || Rocket;
                  return (
                    <button
                      key={s.id}
                      onClick={() => handleScenario(s.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors cursor-pointer",
                        scenario === s.id
                          ? "border-primary/60 bg-primary/10 text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {s.name}
                    </button>
                  );
                })}
              </div>

              {/* Opponent cards — grouped by category */}
              <div className="space-y-5">
                {CATEGORY_ORDER.map((cat) => {
                  const group = Object.values(PERSONAS).filter((p) => p.category === cat);
                  if (!group.length) return null;
                  return (
                    <div key={cat} className="space-y-2.5">
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                        {CATEGORY_LABELS[cat]}
                      </p>
                      {group.map((p) => {
                        const selected = persona === p.id;
                        return (
                          <button
                            key={p.id}
                            onClick={() => setPersona(p.id)}
                            className={cn(
                              "group w-full rounded-xl border p-4 text-left transition-all duration-200 cursor-pointer",
                              selected
                                ? "border-primary/60 bg-primary/[0.06]"
                                : "border-border hover:border-muted-foreground/30 bg-card/40"
                            )}
                          >
                            <div className="flex items-start gap-3.5">
                              <span
                                className={cn(
                                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-display text-base font-bold transition-colors",
                                  selected ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"
                                )}
                              >
                                {p.name.charAt(0)}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="font-display text-[15px] font-semibold tracking-tight">{p.name}</p>
                                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                                    {p.title}
                                  </span>
                                </div>
                                <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                                  {p.description}
                                </p>
                                {selected && (
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {p.pressureTriggers.slice(0, 3).map((t) => (
                                      <span
                                        key={t}
                                        className="rounded border border-deny/25 bg-deny/[0.07] px-1.5 py-0.5 font-mono text-[10px] text-deny/90"
                                      >
                                        {t}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {stage === 3 && (
            <div className="page-enter space-y-7">
              <Heading
                kicker="Set the intensity"
                title="How hard should they push?"
                sub="Higher intensity means bigger swings to your Communication Rating."
              />

              <div className="space-y-2.5">
                {PRESSURE_LEVELS.map((lvl) => {
                  const meta = PRESSURE_META[lvl.id];
                  const selected = pressureLevel === lvl.id;
                  return (
                    <button
                      key={lvl.id}
                      onClick={() => setPressureLevel(lvl.id)}
                      className={cn(
                        "flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-all duration-200 cursor-pointer",
                        selected
                          ? "border-primary/60 bg-primary/[0.06]"
                          : "border-border hover:border-muted-foreground/30 bg-card/40"
                      )}
                    >
                      <div className="flex items-end gap-0.5">
                        {[0, 1, 2, 3].map((i) => (
                          <span
                            key={i}
                            className={cn(
                              "w-1 rounded-full transition-colors",
                              i < meta.bar ? "bg-primary" : "bg-border"
                            )}
                            style={{ height: `${8 + i * 4}px` }}
                          />
                        ))}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-display text-[15px] font-semibold tracking-tight">{lvl.name}</p>
                          <span className={cn("font-mono text-[10px] uppercase tracking-wider", meta.color)}>
                            {meta.tag}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[13px] text-muted-foreground">{lvl.description}</p>
                      </div>
                      {selected && <Check className="h-4 w-4 text-primary" />}
                    </button>
                  );
                })}
              </div>

              {/* Threat briefing */}
              <div className="rounded-xl border border-primary/25 bg-gradient-to-br from-primary/[0.08] to-transparent p-5">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
                  Engagement briefing
                </p>
                <p className="mt-2 text-[14px] leading-relaxed text-foreground">
                  You face{" "}
                  <span className="font-semibold">{activePersona.name}</span>, a{" "}
                  {activePersona.title.toLowerCase()}, at{" "}
                  <span className="font-semibold">{PRESSURE_META[pressureLevel].tag.toLowerCase()}</span>{" "}
                  intensity.
                  {targetedWeakness && (
                    <>
                      {" "}They will hunt your{" "}
                      <span className="font-semibold capitalize text-primary">{targetedWeakness}</span>{" "}
                      in the opening turns.
                    </>
                  )}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Fixed action bar */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-6 py-4">
          {stage > 1 ? (
            <button
              onClick={() => setStage((s) => (s - 1) as Stage)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          ) : (
            <button
              onClick={() => router.push("/")}
              className="rounded-lg px-3 py-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
            >
              Cancel
            </button>
          )}

          {stage < 3 ? (
            <button
              onClick={() => canAdvance && setStage((s) => (s + 1) as Stage)}
              disabled={!canAdvance}
              className="group ml-auto flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 font-display text-[14px] font-semibold text-primary-foreground transition-all hover:gap-3 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
            >
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={deploy}
              className="group ml-auto flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 font-display text-[14px] font-semibold text-primary-foreground transition-all hover:gap-3 cursor-pointer"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground live-pulse" />
              Enter the arena
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-card/60 px-4 py-3 text-[14px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-colors";

function Heading({ kicker, title, sub }: { kicker: string; title: string; sub: string }) {
  return (
    <div className="space-y-2">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">{kicker}</p>
      <h1 className="font-display text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
      <p className="max-w-lg text-[14px] leading-relaxed text-muted-foreground">{sub}</p>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block font-display text-[14px] font-medium">{label}</label>
      <p className="text-[12px] text-muted-foreground/70">{hint}</p>
      <div className="pt-0.5">{children}</div>
    </div>
  );
}
