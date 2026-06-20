import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

const GEMINI_KEY = process.env.GEMINI_API_KEY!;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free";

const genai = new GoogleGenerativeAI(GEMINI_KEY);
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_FALLBACK_MODEL = "gemini-2.5-flash-lite";

function isQuota(msg: string) {
  return msg.includes("429") || /quota|rate.?limit/i.test(msg);
}
function isTransient(msg: string) {
  return /\b(500|502|503|504)\b|overload|high demand|unavailable|timeout/i.test(msg);
}

async function callGemini(prompt: string, temperature: number, model: string) {
  const m = genai.getGenerativeModel({
    model,
    generationConfig: { temperature, topP: 0.95, responseMimeType: "application/json" },
  });
  const res = await m.generateContent(prompt);
  return res.response.text().trim();
}

async function callOpenRouter(prompt: string, temperature: number) {
  if (!OPENROUTER_KEY) throw new Error("OpenRouter key not configured");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://pitchforge.app",
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  try {
    const { prompt, temperature = 0.7, tier = "fast", retries = 2 } = await req.json();
    if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });

    const order = tier === "fast"
      ? (OPENROUTER_KEY ? ["openrouter", "gemini"] : ["gemini"])
      : ["gemini", ...(OPENROUTER_KEY ? ["openrouter"] : [])];

    let lastErr: any = null;
    let sawQuota = false;

    for (const provider of order) {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const gModel = provider === "gemini" && attempt === retries ? GEMINI_FALLBACK_MODEL : GEMINI_MODEL;
          const text = provider === "openrouter"
            ? await callOpenRouter(prompt, temperature)
            : await callGemini(prompt, temperature, gModel);
          return NextResponse.json({ text });
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          if (isQuota(msg)) { sawQuota = true; break; }
          if (isTransient(msg) && attempt < retries) { await sleep(700 * Math.pow(2, attempt)); continue; }
          if (attempt < retries) { await sleep(400); continue; }
        }
      }
    }
    if (sawQuota) return NextResponse.json({ error: "All providers rate-limited", retryAfter: 30 }, { status: 429 });
    return NextResponse.json({ error: lastErr?.message || "LLM generation failed" }, { status: 502 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
