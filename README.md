<p align="center">
  <img src="assets/logo.svg" alt="PitchForge" width="380" />
</p>

<p align="center"><strong>A communication flight simulator.</strong></p>

Practice high-stakes conversations against AI personas that interrupt, challenge, and push back — out loud, in real time — then get an evidence-based verdict on how you actually communicated.

## Quick Start

```bash
npm install
# Add your keys to .env (see Environment Variables below)
npm run dev
```

Open in **Chrome**, tap **Enter the arena**, allow the microphone, and start talking.

## Tech Stack (Zero-Cost MVP)

- **Frontend:** React + TypeScript + Vite
- **Styling:** Tailwind CSS + shadcn/ui (warm carbon + amber theme)
- **LLM:** Gemini 2.5 Flash (`@google/generative-ai`) + OpenRouter free models
- **Voice:** Gemini TTS / Web Speech API, with an optional Gemini Live mode
- **State:** localStorage only — no backend, no database

## How a Session Works

`Briefing → Arena → Verdict → Record`

1. **Briefing** — 3-field intake (who you are, what you're pitching, the one belief), pick scenario + opponent + intensity.
2. **Arena** — a live spoken conversation. You speak, the persona reacts, interrupts, and escalates. Live captions show both sides.
3. **Verdict** — a YES / NO / MAYBE outcome with turn-cited evidence and rich moment analysis.
4. **Record** — every engagement is logged; click any row to reopen its full verdict.

## Voice Architecture (resilient by design)

The Arena tries the richest voice path available and **degrades gracefully** so a demo never dies:

1. **Gemini Live** (attempted first) — one WebSocket doing STT + reasoning + native audio TTS with built-in voice-activity detection and **barge-in** (the persona can cut you off; you can cut in). Requires the `v1alpha` bidi Live models, which many free keys don't have yet — so it's tried on both `v1alpha` and `v1beta` and across several model names.
2. **Turn-based fallback** (if Live can't connect) — push-to-talk via the Web Speech API, Gemini text for the persona, and **Gemini TTS** for the voice, which itself **falls back to browser TTS** if unavailable.

Either way you get a working spoken conversation, live captions, persona-specific voices, and interruptions.

## LLM Provider Split (conserves quota)

Persona turns are frequent (the quota burner); feedback runs once per session. Traffic is split across providers with **cross-fallback** both ways:

| Workload | Primary | Fallback |
|----------|---------|----------|
| Persona turns (`fast` tier) | OpenRouter free model | Gemini 2.5 Flash |
| Feedback / verdict (`quality` tier) | Gemini 2.5 Flash | OpenRouter |

The layer (`src/services/llm.ts`) retries transient `5xx` with exponential backoff, drops to `gemini-2.5-flash-lite` when overloaded, and surfaces `429` quota errors as a clean in-app banner instead of looping. If no OpenRouter key is set, everything runs on Gemini.

## Architecture

```
src/
├── types/           # Shared types (Cognitive State, Personas, Feedback, Progression)
├── lib/
│   ├── constants.ts # Scenarios, pressure levels, thresholds, rank tiers
│   └── personas.ts  # 21 personas across 6 categories (goals, objections, voice)
├── services/
│   ├── llm.ts                 # Provider router: OpenRouter + Gemini, retry/fallback
│   ├── gemini.ts              # Persona-turn + feedback prompts & state engine
│   ├── voice.ts               # Gemini TTS with browser-TTS fallback
│   ├── speech.ts              # Web Speech API wrappers (STT + browser TTS)
│   ├── live-session.ts        # Gemini Live WebSocket session (real-time voice)
│   ├── live-audio.ts          # Mic capture + PCM playback (Web Audio API)
│   ├── interruption-engine.ts # Behavioral signal detection (fillers, buzzwords, WPM)
│   ├── progression.ts         # Communication Rating (ELO-style) + ranks
│   └── storage.ts             # localStorage session persistence
├── pages/
│   ├── HomePage.tsx      # Command Deck — rating, ranks, win records
│   ├── SetupPage.tsx     # Briefing — intake + scenario + opponent + intensity
│   ├── SessionPage.tsx   # Arena — live voice (Live → turn-based fallback) + captions
│   ├── FeedbackPage.tsx  # Verdict — moment analysis + 8 dimensions (+ review mode)
│   ├── HistoryPage.tsx   # Combat record (click a row to reopen its verdict)
│   └── RewindPage.tsx    # Re-take a single answer
└── components/      # Logo, OpponentPresence, AppLayout, shadcn/ui primitives
```

## Key Features

- **Live Voice Arena** — spoken conversation with interruptions and barge-in
- **21 Distinct Personas** — investors, recruiters, buyers, executives, customers, judges
- **Interruption Engine** — the persona cuts you off when you ramble, hedge, or stall
- **Adaptive Pressure** — intensity scales with the conversation and your performance
- **Live Captions** — both sides transcribed on screen as you speak
- **Evidence-Based Feedback** — every critique cites a specific turn + quote
- **Rich Verdict** — YES/NO/MAYBE plus strongest / weakest / turning-point / missed-opportunity moments
- **Communication Rating** — ELO-style progression, ranks, streaks, persona win rates

## Environment Variables

Create a `.env` file:

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_GEMINI_API_KEY` | Yes | Google AI Studio key — [get one](https://aistudio.google.com/apikey) |
| `VITE_OPENROUTER_API_KEY` | Optional | OpenRouter key for the `fast` tier — [get one](https://openrouter.ai/keys). Leave blank to use Gemini only. |
| `VITE_OPENROUTER_MODEL` | Optional | Free model id. Default `meta-llama/llama-3.3-70b-instruct:free`. Names churn — see [free models](https://openrouter.ai/models?max_price=0). |

> ⚠️ **Security note — API keys are exposed in the browser.** All providers are
> called directly from the client, so `VITE_*` keys appear in network traffic.
> This is an accepted tradeoff for the **zero-backend hackathon MVP** and is fine
> for local use and demos. **Do not ship to public production as-is** — proxy the
> calls through a small backend (and use Live ephemeral tokens) so keys stay
> server-side. Rotate any key that has been exposed publicly.

## Free-Tier Notes

- Gemini retired the 2.0 Flash models (June 2026); this app uses **`gemini-2.5-flash`**.
- Free tiers have **per-minute and per-day** caps. If you hit a `429`, the app shows how long to wait; offloading persona turns to OpenRouter dramatically reduces Gemini usage.
- OpenRouter free model names change often — swap `VITE_OPENROUTER_MODEL` if you see a `404` (no code change needed).

## Browser Requirements

- **Chrome recommended** — best Web Audio + microphone support
- Microphone permission required (the Arena streams mic audio)
- Audio output (speakers/headphones) for the persona's voice

## Commands

```bash
npm run dev       # Vite dev server
npm run build     # Type-check + production build
npm run preview   # Preview the production build
npm run lint      # ESLint
```
