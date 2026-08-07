import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

const genai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY!,
  apiVersion: "v1alpha",
});

const TTS_MODEL = "gemini-3.1-flash-tts-preview";

const TTS_VOICE: Record<string, string> = {
  "friendly-angel": "Puck", "skeptical-vc": "Charon", "growth-investor": "Kore",
  "technical-investor": "Orus", "technical-recruiter": "Leda", "hiring-manager": "Charon",
  "staff-engineer": "Fenrir", "pm-interviewer": "Aoede", "enterprise-buyer": "Orus",
  "skeptical-prospect": "Fenrir", "procurement-officer": "Kore", ceo: "Zephyr",
  "board-member": "Charon", "exec-stakeholder": "Aoede", "hackathon-judge": "Puck",
  "conference-moderator": "Aoede", "media-interviewer": "Charon", "early-adopter": "Leda",
  "angry-customer": "Fenrir", "confused-customer": "Kore",
};

const STYLE_MAP: Record<string, string> = {
  interrupting: "sharply, cutting in, impatient",
  impatient: "impatiently, clipped",
  annoyed: "with irritation",
  skeptical: "skeptically, with doubt",
  confused: "slowly, sounding confused",
  engaged: "with interest, leaning in",
  impressed: "warmly, mildly impressed",
};

function styleFor(emotion?: string) {
  return (emotion && STYLE_MAP[emotion]) || "in a natural measured tone";
}

export async function POST(req: NextRequest) {
  try {
    const { text, personaId, emotion } = await req.json();
    if (!text) return NextResponse.json({ error: "text is required" }, { status: 400 });

    const voiceName = TTS_VOICE[personaId] ?? "Charon";
    const style = styleFor(emotion);
    const result = await genai.models.generateContent({
      model: TTS_MODEL,
      contents: `Say ${style}: ${text}`,
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
      },
    });

    const data = (result as any)?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!data) return NextResponse.json({ error: "TTS returned no audio" }, { status: 500 });

    return NextResponse.json({ audio: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
