import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Rocket, Briefcase, Cpu, Timer, Presentation, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentUpload } from "@/components/DocumentUpload";
import { cn } from "@/lib/utils";
import { SCENARIOS, PERSONAS, PRESSURE_LEVELS } from "@/lib/constants";
import type { ScenarioId, PersonaId, PressureLevel, SessionSetup } from "@/types";

const SCENARIO_ICONS: Record<string, React.ElementType> = {
  rocket: Rocket,
  briefcase: Briefcase,
  cpu: Cpu,
  timer: Timer,
  presentation: Presentation,
  search: Search,
};

export default function SetupPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Context ingestion
  const [nameAndRole, setNameAndRole] = useState("");
  const [productDescription, setProductDescription] = useState("");
  const [valueProposition, setValueProposition] = useState("");

  // Step 2: Scenario + Persona
  const [scenario, setScenario] = useState<ScenarioId>("pitch-startup");
  const [persona, setPersona] = useState<PersonaId>("skeptical-investor");

  // Step 3: Pressure
  const [pressureLevel, setPressureLevel] = useState<PressureLevel>("realistic");

  const handleStart = () => {
    const setup: SessionSetup = {
      nameAndRole,
      productDescription,
      valueProposition,
      scenario,
      persona,
      pressureLevel,
    };
    // Store setup in sessionStorage so SessionPage can pick it up
    sessionStorage.setItem("pitchforge_setup", JSON.stringify(setup));
    navigate("/session");
  };

  const canProceedStep1 = nameAndRole.trim() && productDescription.trim() && valueProposition.trim();

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center gap-3 p-6">
        <Button variant="ghost" size="icon" onClick={() => step > 1 ? setStep((s) => (s - 1) as 1 | 2 | 3) : navigate("/")}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="font-semibold">Setup Your Session</h1>
          <p className="text-xs text-muted-foreground">Step {step} of 3</p>
        </div>
        {/* Progress dots */}
        <div className="ml-auto flex gap-1.5">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={cn(
                "w-2 h-2 rounded-full transition-colors",
                s <= step ? "bg-primary" : "bg-border"
              )}
            />
          ))}
        </div>
      </header>

      <main className="flex-1 p-6 max-w-2xl mx-auto w-full">
        {/* Step 1: Context Ingestion */}
        {step === 1 && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-bold">Tell us about you</h2>
              <p className="text-sm text-muted-foreground">
                This context helps the AI persona challenge you on specific claims.
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Name & Role</label>
                <input
                  type="text"
                  placeholder="e.g. Sarah, founder of a B2B SaaS company"
                  value={nameAndRole}
                  onChange={(e) => setNameAndRole(e.target.value)}
                  className="w-full rounded-lg border border-border bg-muted px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Product / Project</label>
                <textarea
                  placeholder="Describe your product or project in 2-3 sentences"
                  value={productDescription}
                  onChange={(e) => setProductDescription(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-border bg-muted px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Core Value Proposition</label>
                <textarea
                  placeholder="The one thing you want them to believe after hearing your pitch"
                  value={valueProposition}
                  onChange={(e) => setValueProposition(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-border bg-muted px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>
            </div>

            {/* Document Upload — Phase 2+ */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">or upload a document</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <DocumentUpload
                onExtracted={(text) => {
                  // Auto-fill product description with extracted text
                  if (!productDescription.trim()) {
                    setProductDescription(text.slice(0, 500));
                  } else {
                    setProductDescription(productDescription + "\n\n---\n" + text.slice(0, 500));
                  }
                }}
              />
            </div>

            <Button
              onClick={() => setStep(2)}
              disabled={!canProceedStep1}
              className="w-full"
              size="lg"
            >
              Continue
            </Button>
          </div>
        )}

        {/* Step 2: Scenario + Persona */}
        {step === 2 && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-bold">Choose Your Scenario</h2>
              <p className="text-sm text-muted-foreground">
                What kind of conversation are you preparing for?
              </p>
            </div>

            {/* Scenarios */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {SCENARIOS.map((s) => {
                const Icon = SCENARIO_ICONS[s.icon] || Rocket;
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      setScenario(s.id);
                      setPersona(s.defaultPersona);
                    }}
                    className={cn(
                      "flex items-start gap-3 p-4 rounded-lg border text-left transition-colors",
                      scenario === s.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground"
                    )}
                  >
                    <Icon className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-sm">{s.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {s.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Persona override */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Persona</label>
              <div className="flex flex-wrap gap-2">
                {Object.values(PERSONAS).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPersona(p.id)}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      persona === p.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {p.title}
                  </button>
                ))}
              </div>
            </div>

            <Button onClick={() => setStep(3)} className="w-full" size="lg">
              Continue
            </Button>
          </div>
        )}

        {/* Step 3: Pressure Level */}
        {step === 3 && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-xl font-bold">Set the Pressure</h2>
              <p className="text-sm text-muted-foreground">
                How hard do you want to be challenged?
              </p>
            </div>

            <div className="space-y-3">
              {PRESSURE_LEVELS.map((level) => (
                <button
                  key={level.id}
                  onClick={() => setPressureLevel(level.id)}
                  className={cn(
                    "w-full flex items-center gap-4 p-4 rounded-lg border text-left transition-colors",
                    pressureLevel === level.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-muted-foreground"
                  )}
                >
                  <div
                    className={cn(
                      "w-3 h-3 rounded-full shrink-0",
                      level.id === "coaching" && "bg-green-500",
                      level.id === "realistic" && "bg-yellow-500",
                      level.id === "aggressive" && "bg-orange-500",
                      level.id === "brutal" && "bg-red-500"
                    )}
                  />
                  <div>
                    <p className="font-medium text-sm">{level.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {level.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>

            {/* Summary */}
            <div className="rounded-lg border border-border bg-card p-4 space-y-2">
              <p className="text-xs text-muted-foreground">Session Summary</p>
              <div className="text-sm space-y-1">
                <p>
                  <span className="text-muted-foreground">Scenario:</span>{" "}
                  {SCENARIOS.find((s) => s.id === scenario)?.name}
                </p>
                <p>
                  <span className="text-muted-foreground">Persona:</span>{" "}
                  {PERSONAS[persona]?.name} ({PERSONAS[persona]?.title})
                </p>
                <p>
                  <span className="text-muted-foreground">Pressure:</span>{" "}
                  {PRESSURE_LEVELS.find((p) => p.id === pressureLevel)?.name}
                </p>
              </div>
            </div>

            <Button onClick={handleStart} className="w-full" size="lg">
              Begin Simulation
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
