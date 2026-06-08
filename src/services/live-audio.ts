// ============================================================
// Live Audio plumbing for the Gemini Live API
// - Capture mic → 16kHz mono PCM16 (base64) for upstream
// - Play 24kHz mono PCM16 chunks streamed from the model
// All browser-native (Web Audio API). No external deps.
// ============================================================

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// ---- base64 helpers ----
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

// Float32 [-1,1] → Int16 PCM
function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

// Naive linear downsample to 16kHz
function downsample(buffer: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate >= inRate) return buffer;
  const ratio = inRate / outRate;
  const newLen = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLen);
  let pos = 0;
  for (let i = 0; i < newLen; i++) {
    const next = Math.round((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = Math.round(i * ratio); j < next && j < buffer.length; j++) {
      sum += buffer[j];
      count++;
    }
    result[i] = count ? sum / count : 0;
    pos = next;
  }
  void pos;
  return result;
}

// ============================================================
// Microphone capture
// ============================================================

export interface MicCaptureHandle {
  stop: () => void;
  getLevel: () => number; // 0-1 rough input level for UI
}

export async function startMicCapture(
  onChunk: (base64Pcm16: string) => void
): Promise<MicCaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });

  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  const ctx: AudioContext = new AudioCtx();
  const source = ctx.createMediaStreamSource(stream);

  // ScriptProcessor is deprecated but universally supported and simplest for PCM capture.
  const bufferSize = 4096;
  const processor = ctx.createScriptProcessor(bufferSize, 1, 1);

  let level = 0;

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    // level meter
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
    level = Math.min(1, Math.sqrt(sum / input.length) * 4);

    const down = downsample(input, ctx.sampleRate, INPUT_SAMPLE_RATE);
    const pcm = floatTo16BitPCM(down);
    onChunk(arrayBufferToBase64(pcm));
  };

  source.connect(processor);
  processor.connect(ctx.destination);

  return {
    stop: () => {
      try {
        processor.disconnect();
        source.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
      } catch {
        /* noop */
      }
    },
    getLevel: () => level,
  };
}

// ============================================================
// Output playback queue (24kHz PCM16 chunks → scheduled audio)
// ============================================================

export class AudioPlayer {
  private ctx: AudioContext;
  private nextStartTime = 0;
  private sources: AudioBufferSourceNode[] = [];
  private _playing = false;

  constructor() {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AudioCtx({ sampleRate: OUTPUT_SAMPLE_RATE });
  }

  get playing() {
    return this._playing;
  }

  /** Enqueue a base64 PCM16 (24kHz mono) chunk for gapless playback. */
  enqueue(base64Pcm16: string, onChunkEnd?: () => void) {
    const buf = base64ToArrayBuffer(base64Pcm16);
    const int16 = new Int16Array(buf);
    const float = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float[i] = int16[i] / 0x8000;

    const audioBuffer = this.ctx.createBuffer(1, float.length, OUTPUT_SAMPLE_RATE);
    audioBuffer.copyToChannel(float, 0);

    const src = this.ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(this.ctx.destination);

    const now = this.ctx.currentTime;
    const startAt = Math.max(now, this.nextStartTime);
    src.start(startAt);
    this.nextStartTime = startAt + audioBuffer.duration;
    this._playing = true;

    this.sources.push(src);
    src.onended = () => {
      this.sources = this.sources.filter((s) => s !== src);
      if (this.sources.length === 0) this._playing = false;
      onChunkEnd?.();
    };
  }

  /** Hard stop — used when the user barges in / interrupts. */
  flush() {
    for (const s of this.sources) {
      try { s.stop(); } catch { /* noop */ }
    }
    this.sources = [];
    this.nextStartTime = 0;
    this._playing = false;
  }

  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  close() {
    this.flush();
    try { this.ctx.close(); } catch { /* noop */ }
  }
}
