import { GoogleGenerativeAI } from "@google/generative-ai";

// ============================================================
// Unified LLM layer — splits traffic across providers to spread
// load and conserve the Gemini free-tier quota.
//
//  - "fast" tier  → OpenRouter free model (high-frequency persona turns)
//  - "quality"    → Gemini 2.5 Flash (once-per-session feedback)
//
// Each tier falls back to the OTHER provider on failure, so a dead
// free model or an overloaded Gemini never dead-ends the app.
// All calls request JSON and retry transient 5xx with backoff.
// 429 (quota) is surfaced immediately — retrying won't help.
// ============================================================

export type Tier = "fast" | "quality";

export class RateLimitError extends Error {
  retryAfter?: number;
  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- env / config ----
const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
const OPENROUTER_KEY = import.meta.env.VITE_OPENROUTER_API_KEY as string | undefined;
// Free model names churn on OpenRouter — override via env without a code change.
const OPENROUTER_MODEL =
  (import.meta.env.VITE_OPENROUTER_MODEL as string | undefined) ??
  "meta-llama/llama-3.3-70b-instruct:free";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_FALLBACK_MODEL = "gemini-2.5-flash-lite";

export function hasOpenRouter(): boolean {
  return !!OPENROUTER_KEY;
}

function isQuota(msg: string): boolean {
  return msg.includes("429") || /quota|rate.?limit/i.test(msg);
}
function isTransient(msg: string): boolean {
  return /\b(500|502|503|504)\b|overload|high demand|unavailable|timeout/i.test(msg);
}
function retryAfterFrom(msg: string): number | undefined {
  const m = msg.match(/retry in ([\d.]+)s/i) || msg.match(/"retryDelay"\s*:\s*"?([\d.]+)s/i);
  return m ? Math.ceil(Number(m[1])) : undefined;
}

// ---- Gemini ----
let genai: GoogleGenerativeAI | null = null;
function gemini() {
  if (!GEMINI_KEY) throw new Error("VITE_GEMINI_API_KEY is not set");
  if (!genai) genai = new GoogleGenerativeAI(GEMINI_KEY);
  return genai;
}

async function callGemini(prompt: string, temperature: number, model: string): Promise<string> {
  const m = gemini().getGenerativeModel({
    model,
    generationConfig: { temperature, topP: 0.95, responseMimeType: "application/json" },
  });
  const res = await m.generateContent(prompt);
  return res.response.text().trim();
}

// ---- OpenRouter (OpenAI-compatible) ----
async function callOpenRouter(prompt: string, temperature: number): Promise<string> {
  if (!OPENROUTER_KEY) throw new Error("VITE_OPENROUTER_API_KEY is not set");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "PitchForge",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You output only valid JSON. No markdown, no code fences, no prose." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenRouter returned empty content");
  return String(text).trim();
}

// ---- one attempt against a named provider ----
async function callProvider(
  provider: "openrouter" | "gemini",
  prompt: string,
  temperature: number,
  geminiModel = GEMINI_MODEL
): Promise<string> {
  return provider === "openrouter"
    ? callOpenRouter(prompt, temperature)
    : callGemini(prompt, temperature, geminiModel);
}

/**
 * Generate JSON text for a given tier with provider fallback + backoff.
 *  fast    → OpenRouter (if configured) then Gemini
 *  quality → Gemini then OpenRouter
 */
export async function generateJSON(
  prompt: string,
  temperature: number,
  tier: Tier,
  opts: { retries?: number } = {}
): Promise<string> {
  const retries = opts.retries ?? 2;

  // Build provider order for this tier, skipping unconfigured providers.
  const order: ("openrouter" | "gemini")[] =
    tier === "fast"
      ? (hasOpenRouter() ? ["openrouter", "gemini"] : ["gemini"])
      : (["gemini", ...(hasOpenRouter() ? ["openrouter" as const] : [])]);

  let lastErr: any;
  let sawQuota = false;
  let quotaRetry: number | undefined;

  for (const provider of order) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // On the last Gemini attempt, drop to the lighter model.
        const gModel = provider === "gemini" && attempt === retries ? GEMINI_FALLBACK_MODEL : GEMINI_MODEL;
        return await callProvider(provider, prompt, temperature, gModel);
      } catch (err: any) {
        lastErr = err;
        const msg = String(err?.message ?? err);
        if (isQuota(msg)) {
          // This provider is quota-capped; remember it and move to the next provider.
          sawQuota = true;
          quotaRetry = retryAfterFrom(msg) ?? quotaRetry;
          break; // stop retrying THIS provider, try the next one
        }
        if (isTransient(msg) && attempt < retries) {
          await sleep(700 * Math.pow(2, attempt));
          continue;
        }
        if (attempt < retries) {
          await sleep(400);
          continue;
        }
        // exhausted retries for this provider → try next provider
      }
    }
  }

  // If every provider was quota-capped, surface a clean rate-limit error.
  if (sawQuota) {
    throw new RateLimitError(
      quotaRetry
        ? `All AI providers are rate-limited. Try again in ~${quotaRetry}s.`
        : "All AI providers are rate-limited or out of free quota.",
      quotaRetry
    );
  }
  throw lastErr ?? new Error("LLM generation failed");
}
