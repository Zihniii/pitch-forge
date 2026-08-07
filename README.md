<p align="center">
  <img src="assets/logo.svg" alt="PitchForge" width="380" />
</p>

<p align="center"><strong>A communication flight simulator.</strong></p>

Practice high-stakes conversations against AI personas that interrupt, challenge, and push back — out loud, in real time — then get an evidence-based verdict on how you actually communicated.

## Quick Start

```bash
npm install            # Install dependencies
# Add your keys to .env (see Environment Variables below)
npm run dev            # Next.js dev server (http://localhost:3000)
npm run server         # Express WS proxy (needed for Gemini Live)
```

Or both at once:

```bash
npx concurrently "npm run dev" "npm run server"
```

Open in **Chrome**, tap **Enter the arena**, allow the microphone, and start talking.

## Tech Stack

- **Framework:** Next.js 16 (App Router) + React 18 + TypeScript 5
- **Styling:** Tailwind CSS 3 + shadcn/ui (warm carbon + amber theme)
- **LLM:** Gemini 2.5 Flash (`@google/generative-ai`) + OpenRouter free-tier models
- **Voice:** Gemini Live (WebSocket) → Gemini TTS → browser SpeechSynthesis (3-tier graceful degradation)
- **Server:** Express proxy for Gemini Live WebSocket and LLM/TTS API routes
- **State:** localStorage only — no backend database
- **Analytics:** Pendo / Novus SDK (anonymous visitor tracking)

## How a Session Works

`Briefing → Arena → Verdict → Record`

1. **Briefing** — 3-field intake (who you are, what you're pitching, the one belief), optional document upload (PDF/TXT/MD/DOCX), pick scenario + opponent + intensity.
2. **Arena** — a live spoken conversation. You speak, the persona reacts, interrupts, and escalates. Live captions show both sides. Text input fallback available.
3. **Verdict** — a YES / NO / MAYBE outcome with turn-cited evidence, 8-dimension scoring, and rich moment analysis (strongest, weakest, turning point, missed opportunity).
4. **Record** — every engagement is logged; click any row to reopen its full verdict. Session deletion also supported.

## Voice Architecture (resilient by design)

The Arena tries the richest voice path available and **degrades gracefully** so a demo never dies:

1. **Gemini Live** (attempted first) — one WebSocket doing STT + reasoning + native audio TTS with built-in voice-activity detection and **barge-in** (the persona can cut you off; you can cut in). Uses `gemini-3.1-flash-live-preview` on `v1alpha`/`v1beta` endpoints.
2. **Turn-based fallback** (if Live can't connect) — push-to-talk via the Web Speech API, Gemini text for the persona, and **Gemini TTS** for the voice, which itself **falls back to browser SpeechSynthesis** if unavailable.
3. **Live mic level meter** and **mute toggle** available in Gemini Live mode.

Either way you get a working spoken conversation, live captions, persona-specific voices, and interruptions.

## LLM Provider Split (conserves quota)

Persona turns are frequent (the quota burner); feedback runs once per session. Traffic is split across providers with **cross-fallback** both ways:

| Workload | Primary | Fallback | Degraded |
|----------|---------|----------|----------|
| Persona turns (`fast` tier) | OpenRouter free model | Gemini 2.5 Flash | Gemini 2.5 Flash Lite |
| Feedback / verdict (`quality` tier) | Gemini 2.5 Flash | OpenRouter | — |

The layer (`src/services/llm.ts`) retries transient `5xx` with exponential backoff, drops to `gemini-2.5-flash-lite` when overloaded, and surfaces `429` quota errors as a clean in-app banner instead of looping. If no OpenRouter key is set, everything runs on Gemini. All API calls are proxied server-side through Next.js API routes — keys are never exposed to the browser.

## Architecture

```
src/
├── types/                # Shared types (Cognitive State, Personas, Feedback, Progression)
│   ├── index.ts          # All type definitions
│   └── speech.d.ts       # Web Speech API declarations
├── lib/
│   ├── constants.ts      # 6 scenarios, 4 pressure levels, thresholds, 6 rank tiers
│   ├── personas.ts       # 21 personas across 6 categories (goals, objections, voice)
│   └── utils.ts          # cn(), formatDuration(), formatDate()
├── services/
│   ├── llm.ts                    # Provider router: OpenRouter + Gemini, retry/fallback
│   ├── gemini.ts                 # Persona-turn + feedback prompts & state engine
│   ├── voice.ts                  # Gemini TTS with browser-TTS fallback
│   ├── speech.ts                 # Web Speech API wrappers (STT + browser TTS)
│   ├── live-session.ts           # Gemini Live WebSocket session (real-time voice)
│   ├── live-audio.ts             # Mic capture + PCM playback (Web Audio API)
│   ├── interruption-engine.ts    # Behavioral signal detection (fillers, buzzwords, WPM)
│   ├── progression.ts            # Communication Rating (ELO-style) + ranks
│   └── storage.ts                # localStorage session persistence
├── views/                # Page components
│   ├── HomePage.tsx      # Command Deck — rating, ranks, win records, quick deploy
│   ├── SetupPage.tsx     # Briefing — intake + document upload + scenario + opponent + intensity
│   ├── SessionPage.tsx   # Arena — live voice (Live → turn-based fallback) + captions
│   ├── FeedbackPage.tsx  # Verdict — moment analysis + 8 dimensions (+ review mode)
│   ├── HistoryPage.tsx   # Combat record (click a row to reopen or delete)
│   └── RewindPage.tsx    # Re-take a single answer, see persona's new reaction + comparison
├── components/
│   ├── AppLayout.tsx          # Journey-aware shell (immersive vs ambient)
│   ├── Logo.tsx               # PitchForge SVG anvil mark
│   ├── OpponentPresence.tsx   # Animated presence ring
│   ├── DocumentUpload.tsx     # PDF/TXT/MD/DOCX ingestion for briefing context
│   └── ui/                    # shadcn/ui primitives (button, card, toast)
└── app/                  # Next.js App Router pages + API routes
    ├── api/
    │   ├── llm/generate/route.ts   # LLM proxy (Gemini + OpenRouter)
    │   ├── voice/tts/route.ts      # Gemini TTS proxy
    │   ├── live/route.ts           # Live API stub
    │   └── health/route.ts         # Health check
    ├── layout.tsx
    ├── page.tsx
    ├── setup/page.tsx
    ├── session/page.tsx
    ├── feedback/page.tsx
    ├── history/page.tsx
    └── rewind/page.tsx
server/
├── index.js              # Express + WebSocket server (Gemini Live proxy)
├── app.js                # Express: LLM + TTS proxy + health check
└── package.json
```

## Key Features

- **Live Voice Arena** — spoken conversation with interruptions and barge-in (dual engine: Gemini Live WS + turn-based fallback)
- **21 Distinct Personas** — investors, recruiters, buyers, executives, customers, judges (across 6 categories)
- **6 Scenarios** — Pitch My Startup, Job Interview, Technical Presentation, Hackathon Demo, Sales/Product Demo, Customer Discovery
- **4 Pressure Levels** — Coaching, Realistic, Aggressive, Brutal
- **Interruption Engine** — the persona cuts you off when you ramble, hedge, stall, or overuse buzzwords
- **Adaptive Pressure** — intensity scales via Cognitive State (9-field deterministic state machine)
- **Live Captions** — both sides transcribed on screen as you speak
- **Turn Counter & Pressure Meter** — shows current turn / MAX_TURNS (15) and a 10-segment threat bar
- **Text Input Fallback** — type your answers as an alternative to voice
- **Live Mic Level Meter** — input level visualization in Gemini Live mode with mute toggle
- **Evidence-Based Feedback** — every critique cites a specific turn + quote across 8 dimensions (clarity, conviction, structure, authenticity, resilience, adaptability, brevity, persuasiveness)
- **Rich Verdict** — YES/NO/MAYBE plus strongest / weakest / turning-point / missed-opportunity moments
- **Rewind Mode** — re-take a single answer from the transcript and see the persona's new reaction + comparison
- **Improvement Delta** — compare current vs previous session scores per dimension
- **Document Upload** — ingest PDF/TXT/MD/DOCX to populate your briefing context
- **Quick Deploy** — one-click starting points on the Command Deck (Investor, Recruiter, Judge)
- **Share Verdict** — copy verdict text to clipboard
- **Communication Rating** — ELO-style progression, 6 ranks (Rookie → Master), streaks, persona win rates
- **Weakness Targeting** — persona hunts your lowest dimension from past sessions
- **Anti-Repetition Memory** — tracks asked questions to prevent the persona repeating itself
- **Session Auto-End Logic** — auto-ends when interest dies, decision reached, or hard cap of 10 user turns

## Environment Variables

Create a `.env` file (keys are server-side only — never exposed to the browser):

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google AI Studio key — [get one](https://aistudio.google.com/apikey) |
| `OPENROUTER_API_KEY` | Optional | OpenRouter key for the `fast` tier — [get one](https://openrouter.ai/keys). Leave blank to use Gemini only. |
| `OPENROUTER_MODEL` | Optional | Free model id. Default `qwen/qwen3-next-80b-a3b-instruct:free`. Names churn — see [free models](https://openrouter.ai/models?max_price=0). |
| `PORT` | Optional | Server port for the Express proxy (default `3001`) |

> ⚠️ **Security note — API keys stay server-side.** All LLM and TTS calls are proxied through Next.js API routes (`/api/llm/generate`, `/api/voice/tts`). Keys are never exposed to the browser. This is safe for local use, demos, and deployment (provided your host respects `.env`).

## Free-Tier Notes

- Gemini retired the 2.0 Flash models (June 2026) and the original Live previews (Dec 2025); this app uses **`gemini-3.6-flash`** for text and **`gemini-3.1-flash-live-preview`** for real-time voice. Live fallback model: `gemini-2.5-flash-lite`.
- Free tiers have **per-minute and per-day** caps. If you hit a `429`, the app shows how long to wait; offloading persona turns to OpenRouter dramatically reduces Gemini usage.
- OpenRouter free model names change often — swap `OPENROUTER_MODEL` if you see a `404` (no code change needed).

## Browser Requirements

- **Chrome recommended** — best Web Audio + microphone support
- Microphone permission required (the Arena streams mic audio)
- Audio output (speakers/headphones) for the persona's voice

## Commands

```bash
npm run dev          # Next.js dev server (http://localhost:3000)
npm run build        # Type-check + production build
npm run start        # Start the production server
npm run lint         # ESLint
npm run server       # Express WS proxy (needed for Gemini Live)
npm run dev:server   # Alias for server (Express WS proxy)
```
