/**
 * The audio the demo studio's clips actually contain.
 *
 * **A play button that does nothing is worse than no play button**, and this client had something
 * worse again: `DemoStore` had no `clipURL` at all, so every clip in the listening queue answered
 * `store.clipURL is not a function` — a raw JavaScript error, printed in the card, on the screen
 * the standing decisions call the reason to buy. A director evaluating IPT on a Chromebook met
 * that on their first press.
 *
 * iOS has had `SeedClip` since the demo existed and says why in its own words: *the demo has clips
 * on it, and a play button that does nothing reads as a bug in the product rather than as an
 * absence of data.*
 *
 * ## Why this is synthesised rather than shipped
 *
 * The obvious fix is to export Swift's bytes to a file beside `demo-studio.json`. That is ~350 KB
 * of WAV in the precache of an app whose entire shell is a few tens of kilobytes, downloaded by a
 * school Chromebook that will never hear most of it — and the backdrops were resampled from 640 KB
 * to 97 KB for exactly this reason.
 *
 * Rendering it locally costs no bytes, works with the network gone, and needs no cache entry.
 *
 * ## And why that is not the "second construction" this project forbids
 *
 * A duplicate is dangerous when it encodes a **judgement** two clients must agree on — a week
 * boundary, a scoring rule, a refusal. This is a **fixture**: what it has to be is *a click with a
 * note landing slightly behind it*, because that is what an instructor is actually listening for,
 * and getting the drag wrong by a millisecond changes nothing about the product. The numbers are
 * `SeedClip`'s so the two demos sound like the same thing; nothing depends on the bytes matching.
 */

/** `SeedClip`'s own numbers, so the two demos sound like the same studio. */
const SAMPLE_RATE = 44_100;
const BPM = 88;
const DRAG_SECONDS = 0.035;

/**
 * One decaying sine, mixed in place.
 *
 * `gain` rather than `amplitude`, and not only because WebAudio calls it that: **Amplitude is an
 * analytics vendor**, and `make web-audit` refuses the word anywhere under `web/` because
 * `docs/privacy-policy.md` promises there is no usage analytics. The audit was right to stop
 * this file, an exemption would have been a hole kept open for a synonym, and `gain` is the
 * better word here in any case.
 */
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

/** A 16-bit mono WAV, written by hand. No encoder, no dependency, no shipped asset. */
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

/**
 * A playable URL for a demo clip. The same audio for every clip of a given length, deliberately:
 * the demo is a showroom, and thirteen distinct takes would be thirteen times the work to make
 * the same point.
 *
 * **The length is the clip's own, never a constant.** This rendered a fixed four seconds while
 * the metadata beside it — the export's, `SeedClip`'s numbers — said 22, so the card read
 * "Play 00:22", played four, and both marked-moment buttons (6.5 s, 14 s) seeked past the end of
 * the audio into silence. On the one screen whose pitch is *starts at the moment they marked*, a
 * director pressing a marked moment heard nothing. iOS renders `clip.duration` and always did;
 * the fixture's numbers only match the product if the length is one of them.
 *
 * Rendered once per length per visit and kept — `URL.createObjectURL` leaks until revoked, and a
 * queue of thirteen clips would otherwise mint thirteen of them.
 */
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
