# PitchForge

**AI-Powered Communication Simulation Platform**

Practice high-stakes conversations against AI personas that interrupt, challenge, and push back — just like real humans do.

## Quick Start

```bash
npm install
cp .env.example .env   # Add your Gemini API key
npm run dev
```

## Tech Stack (Zero Cost MVP)

- **Frontend:** React + TypeScript + Vite
- **Voice I/O:** Web Speech API (Chrome)
- **LLM:** Gemini 2.0 Flash (1,500 free requests/day)
- **State:** localStorage (no server required)
- **Styling:** Tailwind CSS + shadcn/ui

## Architecture

```
src/
├── types/           # TypeScript types (Cognitive State, Personas, etc.)
├── lib/             # Constants (personas, scenarios, pressure levels)
├── services/
│   ├── gemini.ts    # LLM interaction (persona responses + feedback)
│   ├── speech.ts    # Web Speech API wrappers (STT + TTS)
│   ├── interruption-engine.ts  # Real-time behavioral signal detection
│   └── storage.ts   # localStorage session persistence
├── pages/
│   ├── HomePage.tsx      # Landing + stats
│   ├── SetupPage.tsx     # 3-field intake + scenario + persona + pressure
│   ├── SessionPage.tsx   # Voice conversation interface
│   ├── FeedbackPage.tsx  # Verdict + 8 scored dimensions
│   └── HistoryPage.tsx   # Past sessions
└── components/ui/   # shadcn/ui components
```

## Key Features

- **Dynamic Persona Engine** — AI personas with stateful cognitive models
- **Interruption Engine** — Triggers on silence, fillers, rambling, buzzwords
- **Adaptive Pressure** — Difficulty evolves based on your performance
- **Evidence-Based Feedback** — Every critique cites a specific turn + quote
- **YES/NO/MAYBE Verdict** — Emotionally resonant session outcomes

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VITE_GEMINI_API_KEY` | Google AI Studio API key (free) |

Get your key at: https://aistudio.google.com/apikey

## Browser Requirements

- Chrome recommended (best Web Speech API support)
- Microphone permission required
