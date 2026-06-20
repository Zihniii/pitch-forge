// ============================================================
// Unified LLM layer — delegates all API calls to the server
// proxy so API keys never reach the browser.
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

const API_BASE = "/api/llm";

/**
 * Generate JSON text for a given tier.
 *  fast    → OpenRouter (if configured) then Gemini
 *  quality → Gemini then OpenRouter
 * All fallback/retry logic runs server-side.
 */
export async function generateJSON(
  prompt: string,
  temperature: number,
  tier: Tier,
  opts: { retries?: number } = {}
): Promise<string> {
  const res = await fetch(`${API_BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, temperature, tier, retries: opts.retries ?? 2 }),
  });

  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    throw new RateLimitError(
      body.error ?? "All AI providers are rate-limited.",
      body.retryAfter
    );
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `LLM proxy error (${res.status})`);
  }

  const data = await res.json();
  return data.text;
}
