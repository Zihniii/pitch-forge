import express from "express";
import { GoogleGenAI } from "@google/genai";
import { GoogleGenerativeAI } from "@google/generative-ai";

// ── Env ──────────────────────────────────────────────────────────
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY;
const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL || process.env.VITE_OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free";

if (!GEMINI_KEY) {
  console.error("FATAL: GEMINI_API_KEY is not set");
  throw new Error("GEMINI_API_KEY is not set");
}

// ── Gemini SDKs ──────────────────────────────────────────────────
const genai = new GoogleGenerativeAI(GEMINI_KEY);
const genaiAlpha = new GoogleGenAI({ apiKey: GEMINI_KEY, apiVersion: "v1alpha" });
const genaiBeta = new GoogleGenAI({ apiKey: GEMINI_KEY, apiVersion: "v1beta" });

export { genaiAlpha, genaiBeta };

// ── Express app ──────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "10mb" }));

// ── LLM text generation ─────────────────────────────────────────
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_FALLBACK_MODEL = "gemini-2.5-flash-lite";

function isQuota(msg) {
  return msg.includes("429") || /quota|rate.?limit/i.test(msg);
}
function isTransient(msg) {
  return /\b(500|502|503|504)\b|overload|high demand|unavailable|timeout/i.test(msg);
}

async function callGemini(prompt, temperature, model) {
  const m = genai.getGenerativeModel({
    model,
    generationConfig: { temperature, topP: 0.95, responseMimeType: "application/json" },
  });
  const res = await m.generateContent(prompt);
  return res.response.text().trim();
}

async function callOpenRouter(prompt, temperature) {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.post("/api/llm/generate", async (req, res) => {
  try {
    const { prompt, temperature = 0.7, tier = "fast", retries = 2 } = req.body;
    if (!prompt) return res.status(400).json({ error: "prompt is required" });

    const order = tier === "fast"
      ? (OPENROUTER_KEY ? ["openrouter", "gemini"] : ["gemini"])
      : ["gemini", ...(OPENROUTER_KEY ? ["openrouter"] : [])];

    let lastErr = null;
    let sawQuota = false;

    for (const provider of order) {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const gModel = provider === "gemini" && attempt === retries ? GEMINI_FALLBACK_MODEL : GEMINI_MODEL;
          const text = provider === "openrouter"
            ? await callOpenRouter(prompt, temperature)
            : await callGemini(prompt, temperature, gModel);
          return res.json({ text });
        } catch (err) {
          lastErr = err;
          const msg = String(err?.message ?? err);
          if (isQuota(msg)) { sawQuota = true; break; }
          if (isTransient(msg) && attempt < retries) { await sleep(700 * Math.pow(2, attempt)); continue; }
          if (attempt < retries) { await sleep(400); continue; }
        }
      }
    }
    if (sawQuota) return res.status(429).json({ error: "All providers rate-limited", retryAfter: 30 });
    return res.status(502).json({ error: lastErr?.message || "LLM generation failed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── TTS proxy ────────────────────────────────────────────────────
const TTS_MODEL = "gemini-2.5-flash-preview-tts";
const TTS_VOICE = {
  "friendly-angel": "Puck", "skeptical-vc": "Charon", "growth-investor": "Kore",
  "technical-investor": "Orus", "technical-recruiter": "Leda", "hiring-manager": "Charon",
  "staff-engineer": "Fenrir", "pm-interviewer": "Aoede", "enterprise-buyer": "Orus",
  "skeptical-prospect": "Fenrir", "procurement-officer": "Kore", ceo: "Zephyr",
  "board-member": "Charon", "exec-stakeholder": "Aoede", "hackathon-judge": "Puck",
  "conference-moderator": "Aoede", "media-interviewer": "Charon", "early-adopter": "Leda",
  "angry-customer": "Fenrir", "confused-customer": "Kore",
};

const STYLE_MAP = {
  interrupting: "sharply, cutting in, impatient",
  impatient: "impatiently, clipped",
  annoyed: "with irritation",
  skeptical: "skeptically, with doubt",
  confused: "slowly, sounding confused",
  engaged: "with interest, leaning in",
  impressed: "warmly, mildly impressed",
};

function styleFor(emotion) {
  return (emotion && STYLE_MAP[emotion]) || "in a natural measured tone";
}

app.post("/api/voice/tts", async (req, res) => {
  try {
    const { text, personaId, emotion } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });

    const voiceName = TTS_VOICE[personaId] ?? "Charon";
    const style = styleFor(emotion);
    const result = await genaiAlpha.models.generateContent({
      model: TTS_MODEL,
      contents: `Say ${style}: ${text}`,
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
      },
    });
    const data = result?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!data) return res.status(500).json({ error: "TTS returned no audio" });
    return res.json({ audio: data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Health check ─────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, openrouter: !!OPENROUTER_KEY });
});

export default app;
