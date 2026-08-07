import { WebSocketServer } from "ws";
import { createServer } from "http";
import app, { genaiAlpha, genaiBeta } from "./app.js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env") });

const PORT = parseInt(process.env.PORT || "3001", 10);

// ── Live API WebSocket proxy ──────────────────────────────────────
const LIVE_MODEL_CANDIDATES = [
  "gemini-3.1-flash-live-preview",
];

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (ws) => {
  let geminiSession = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    try { geminiSession?.close(); } catch {}
    geminiSession = null;
  };

  const send = (data) => { if (!closed) try { ws.send(data); } catch {} };

  ws.on("close", cleanup);
  ws.on("error", cleanup);

  ws.on("message", async (raw) => {
    if (closed) return;

    if (raw instanceof Buffer) {
      if (!geminiSession) return;
      try {
        geminiSession.sendRealtimeInput({
          audio: { data: raw.toString("base64"), mimeType: "audio/pcm;rate=16000" },
        });
      } catch {}
      return;
    }

    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case "start": {
        const attempts = [];
        for (const model of LIVE_MODEL_CANDIDATES) {
          attempts.push({ client: genaiAlpha, model, label: `v1alpha/${model}` });
        }
        for (const model of LIVE_MODEL_CANDIDATES) {
          attempts.push({ client: genaiBeta, model, label: `v1beta/${model}` });
        }

        let connected = false;
        for (const a of attempts) {
          try {
            geminiSession = await connectLive(a.client, a.model, msg.systemInstruction, msg.voiceName, ws);
            connected = true;
            break;
          } catch (e) {
            console.warn(`[Live] ${a.label} failed:`, e.message);
          }
        }

        if (!connected) {
          send(JSON.stringify({ type: "error", message: "Live API unavailable on this key" }));
        }
        break;
      }

      case "stop": {
        cleanup();
        break;
      }
    }
  });
});

function connectLive(client, model, systemInstruction, voiceName, ws) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let sessionRef = null;

    const ok = (s) => { if (!settled) { settled = true; resolve(s); } };
    const fail = (m) => { if (!settled) { settled = true; reject(new Error(m)); } };

    const send = (data) => { try { ws.send(data); } catch {} };

    client.live.connect({
      model,
      config: {
        responseModalities: ["AUDIO"],
        systemInstruction,
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => {},
        onmessage: (geminiMsg) => {
          if (geminiMsg?.setupComplete && !settled) {
            ok(sessionRef);
            send(JSON.stringify({ type: "open" }));
            try {
              sessionRef?.sendClientContent({
                turns: "Begin now. Greet me briefly in character and hit me with your opening challenge.",
                turnComplete: true,
              });
            } catch {}
          }

          const sc = geminiMsg?.serverContent;
          if (!sc) return;

          if (sc?.interrupted) {
            send(JSON.stringify({ type: "interrupted" }));
            send(JSON.stringify({ type: "speaking_end" }));
            return;
          }

          const parts = sc?.modelTurn?.parts ?? [];
          for (const part of parts) {
            const audio = part.inlineData?.data;
            if (audio) {
              send(JSON.stringify({ type: "speaking_start" }));
              send(Buffer.from(audio, "base64"));
            }
          }

          if (sc?.outputTranscription?.text) {
            send(JSON.stringify({ type: "persona_text", text: sc.outputTranscription.text }));
          }
          if (sc?.inputTranscription?.text) {
            send(JSON.stringify({ type: "user_text", text: sc.inputTranscription.text }));
          }
          if (sc?.turnComplete) {
            send(JSON.stringify({ type: "turn_complete" }));
          }
        },
        onerror: (e) => {
          const m = e?.message ?? "Live connection error";
          if (!settled) fail(m);
          else send(JSON.stringify({ type: "error", message: m }));
        },
        onclose: (e) => {
          if (!settled) fail(e?.reason || "Connection closed before setup");
          else send(JSON.stringify({ type: "close" }));
        },
      },
    }).then((s) => {
      sessionRef = s;
    }).catch((e) => fail(e?.message ?? String(e)));
  });
}

// ── Start ─────────────────────────────────────────────────────────
const server = createServer(app);

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  if (url.pathname === "/api/live") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`[PitchForge Server] running on http://localhost:${PORT}`);
});
