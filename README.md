# PitchForge

**AI-Powered Communication Simulation Platform**

Practice high-stakes conversations against AI personas that interrupt, challenge, and push back — just like real humans do.

## Quick Start

```bash
npm install
cp .env.example .env   # Add your Gemini API key
npm run dev
```

Open in **Chrome**, allow microphone access, and start a session.

## Tech Stack (Zero Cost MVP)

- **Frontend:** React + TypeScript + Vite
- **Real-time voice:** Gemini Live API (`@google/genai`) — native audio, built-in VAD + barge-in
- **LLM (feedback):** Gemini 2.0 Flash via `@google/generative-ai`
- **State:** localStorage (no server required)
- **Styling:** Tailwind CSS + shadcn/ui

## Voice Engine — Gemini Live

The live conversation runs on the **Gemini Live API** over a WebSocket. A single
connection handles speech-to-text, persona reasoning, and native audio
text-to-speech, with the model's own voice activity detection. This enables
real **barge-in**: the persona can cut you off mid-sentence, and you can cut in
on the persona — playback stops instantly.

- Each persona is mapped to a distinct Live voice (Puck, Charon, Kore, Fenrir, …).
- Input audio is captured and downsampled to 16 kHz PCM; output is 24 kHz PCM.
- Input/output transcriptions are captured so the post-session feedback engine
  still receives a full transcript.

Live model: `gemini-2.0-flash-live-001`.

> ⚠️ **Security note — API key exposure**
>
> The Gemini Live API is called **directly from the browser**, so
> `VITE_GEMINI_API_KEY` is exposed in client-side network traffic. This is an
> accepted tradeoff for the **zero-backend hackathon MVP** and is fine for
> local use and demos.
>
> **Do not ship this to public production as-is.** Anyone can read the key from
> the browser and rack up usage against your quota. For production, mint
> short-lived **ephemeral tokens** from a small backend (the Live API supports
> them) and connect with those instead of the raw key. Treat the current setup
> as demo-only, single-device, and rotate the key if it is ever exposed publicly.

## Architecture

```
src/
├── types/           # TypeScript types (Cognitive State, Personas, Feedback, etc.)
├── lib/
│   ├── constants.ts # Scenarios, pressure levels, thresholds, ranks
│   └── personas.ts  # Full persona library (21 personas across 6 categories)
├── services/
│   ├── live-session.ts        # Gemini Live WebSocket session (real-time voice)
│   ├── live-audio.ts          # Mic capture + PCM playback (Web Audio API)
│   ├── gemini.ts              # Text LLM: feedback/verdict generation
│   ├── speech.ts              # Web Speech API wrappers (legacy/fallback TTS+STT)
│   ├── interruption-engine.ts # Behavioral signal detection (fillers, buzzwords, WPM)
│   ├── progression.ts         # Communication Rating (ELO-style) + ranks
│   └── storage.ts             # localStorage session persistence
├── pages/
│   ├── HomePage.tsx      # Command Deck — rating, ranks, win records
│   ├── SetupPage.tsx     # Briefing — intake + scenario + opponent + intensity
│   ├── SessionPage.tsx   # Arena — real-time Gemini Live voice conversation
│   ├── FeedbackPage.tsx  # Verdict — evidence-based moment analysis + 8 dimensions
│   ├── HistoryPage.tsx   # Combat record
│   └── RewindPage.tsx    # Re-take a single answer
└── components/      # OpponentPresence, app shell, shadcn/ui primitives
```

## Key Features

- **Real-Time Voice Arena** — Gemini Live conversation with native audio and barge-in
- **21 Distinct Personas** — investors, recruiters, buyers, executives, customers, judges
- **Interruption Engine** — the persona cuts you off when you ramble, hedge, or stall
- **Adaptive Pressure** — intensity scales with the conversation and your performance
- **Evidence-Based Feedback** — every critique cites a specific turn + quote
- **Rich Verdict** — YES/NO/MAYBE plus strongest/weakest/turning-point/missed-opportunity moments
- **Communication Rating** — ELO-style progression, ranks, streaks, and persona win rates

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VITE_GEMINI_API_KEY` | Google AI Studio API key (free tier) |

Get your key at: https://aistudio.google.com/apikey

## Browser Requirements

- **Chrome recommended** — best Web Audio + microphone support
- Microphone permission required (the Arena streams mic audio in real time)
- Audio output (speakers/headphones) for the persona's voice
