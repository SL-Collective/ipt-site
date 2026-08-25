
const SAMPLE_RATE = 44_100;
const BPM = 88;
const DRAG_SECONDS = 0.035;

function addTone(samples, { start, duration, frequency, gain, decay }) {
  const from = Math.floor(start * SAMPLE_RATE);
  const count = Math.floor(duration * SAMPLE_RATE);
  for (let i = 0; i < count; i += 1) {
    const at = from + i;
    if (at < 0 || at >= samples.length) continue;
    const t = i / SAMPLE_RATE;
    const envelope = Math.exp(-decay * t);
    samples[at] += Math.sin(2 * Math.PI * frequency * t) * gain * envelope;
  }
}

function wav(samples) {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const ascii = (at, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);          // PCM header length
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32_767), true);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

const cached = new Map();

export function demoClipURL(seconds = 4) {
  const length = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) : 4;
  if (cached.has(length)) return cached.get(length);
  const samples = new Float32Array(Math.floor(length * SAMPLE_RATE));
  const beat = 60 / BPM;
  for (let beatTime = 0; beatTime < length; beatTime += beat) {
    addTone(samples, { start: beatTime, duration: 0.012, frequency: 1000, gain: 0.35, decay: 260 });
    addTone(samples, {
      start: beatTime + DRAG_SECONDS, duration: 0.35, frequency: 330, gain: 0.22, decay: 9,
    });
  }
  const url = URL.createObjectURL(wav(samples));
  cached.set(length, url);
  return url;
}
