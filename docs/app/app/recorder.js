/**
 * Capturing a take in a browser, in a format an instructor's iPhone can actually play.
 *
 * ==========================================================================================
 * Why `MediaRecorder` alone is not the answer, despite being the obvious one
 * ==========================================================================================
 *
 * `docs/where-we-are.md` recorded "Recording travels too: MediaRecorder is supported in Chrome on
 * ChromeOS". That is true and it is not sufficient, because on Chrome `MediaRecorder` produces
 * **WebM/Opus**, and three independent things in this product reject it:
 *
 *   1. The clips bucket's `allowed_mime_types` is `['audio/mp4','audio/aac','audio/m4a']`. A WebM
 *      upload is a 400 at the storage API.
 *   2. `ClipObjectPath.fileExtension` is `m4a`, and that path format is a security rule — the
 *      storage policies authorise a clip by reading its own name.
 *   3. **AVFoundation cannot decode WebM or Opus.** So even with the first two relaxed, an
 *      instructor's iPhone could not play a Chromebook student's recording.
 *
 * The third is the one that matters. "The loop dies at the instructor, not the student" is this
 * product's own diagnosis of why every rival fails, and shipping a web client whose clips are
 * silent on the listening screen would be walking into it deliberately.
 *
 * ==========================================================================================
 * So: two paths, chosen by asking rather than by guessing
 * ==========================================================================================
 *
 *   · **Safari** (iOS and macOS) — `MediaRecorder` with `audio/mp4` gives AAC in an MP4 container,
 *     which is exactly what the bucket, the path format and AVFoundation all want. Supported since
 *     Safari 14.1, so it covers the hand-me-down iPhone this product deliberately targets.
 *
 *   · **Chrome / Edge / ChromeOS / Android** — `MediaRecorder` gives WebM, so encode through
 *     **WebCodecs `AudioEncoder`** with `mp4a.40.2` (AAC-LC) and mux the frames into an MP4
 *     ourselves.
 *
 * The order is deliberate and is the reverse of what looks natural. WebCodecs is the more capable
 * API, but `AudioEncoder` was **undefined in Safari 16.4 through 18.7** — video only — and AAC
 * encoding only arrived in Safari 26. A WebCodecs-first strategy would therefore have excluded
 * precisely the population the iOS 17 deployment target exists for: a performer on an older
 * hand-me-down iPhone whose school blocks the App Store. Asking `MediaRecorder.isTypeSupported`
 * first costs nothing and covers them.
 *
 *   · **Firefox, and any browser on desktop Linux** — neither path exists; there is no AAC encoder
 *     at all. `capabilities()` reports it, and the practice screen offers to submit the session
 *     **without** a recording. That is not a degraded special case — it is a path the product
 *     already has, because a clip that cannot upload is dropped after five attempts and the
 *     session is delivered anyway. Practice is never lost; the clip is not practice.
 *
 * ==========================================================================================
 * What is *not* here
 * ==========================================================================================
 *
 * No server-side transcode. A Worker running ffmpeg would be a new moving part immediately before
 * a pilot, and the first line on the bill that scales with clips rather than with studios. Both
 * are things `docs/running-costs.md` argues against by name.
 */

/**
 * How long a take may run when the assignment does not say otherwise — `TakeRules`, transcribed.
 *
 * **This file said "five minutes, the same cap `PracticeRecorder` applies", and it had not been
 * true since `0007`.** Take length belongs to the *work*: a run of the show is eight to eleven
 * minutes and a concert band movement six to ten, so a fixed five cut every one of them off
 * mid-phrase — which is `docs/running-costs.md`'s rule failing, because *a performer who cannot
 * record the thing they were assigned is perceiving a limit.* iOS reads
 * `TakeRules.takeSeconds(assignmentMinutes:)`; the web hard-coded 300 and never looked at
 * `assignment.take_minutes` at all.
 *
 * That made it worse than the bug it was supposed to have fixed. The web's assignment editor
 * **offers the instructor the control** — writes `take_minutes`, validates it, shows it back — and
 * the web's recorder ignored it. An instructor setting "record the show run, 11 minutes" on a
 * Chromebook was told it had worked, and every performer recording in a browser was still cut off
 * at 5:00. *A described control is worse than an absent one.*
 *
 * Exported and pure so something can run it: the rest of this file needs a microphone, and *"this
 * file needs a device" is a claim about a file, not about the judgements inside it.*
 */
export const DEFAULT_TAKE_SECONDS = 300;

/** `TakeRules.maxTakeMinutes`. Derived from the 8 MB bucket at 480 KB a minute, not chosen. */
export const MAX_TAKE_MINUTES = 15;

/**
 * What the recorder is allowed to run to, given what the assignment asks for.
 *
 * **Clamped, never refused.** This runs on the performer's device at the moment they press record,
 * and refusing here would turn a bad number written weeks ago into somebody who cannot practice
 * today. The instructor's form is where an out-of-range length is refused, because that is where
 * there is somebody to tell.
 */
export function takeSeconds(assignmentMinutes) {
  if (assignmentMinutes == null) return DEFAULT_TAKE_SECONDS;
  return Math.min(Math.max(assignmentMinutes, 1), MAX_TAKE_MINUTES) * 60;
}

/** `TakeRules.warnWithin` — how close to the limit the countdown starts. */
export const WARN_WITHIN_SECONDS = 30;

/**
 * Seconds left before the take stops itself, or null while that is too far away to say.
 *
 * **Rounded, not truncated, and that is deliberately the opposite of everywhere else.** Minutes of
 * practice round *down* because crediting a minute somebody did not play discredits the whole
 * board; this is a countdown rather than a claim about work done, and truncating it would show "0"
 * for a whole second while the recorder is still running — which reads as the app having stopped.
 *
 * The web had no countdown at all: a take simply ended. `TakeRules.secondsBeforeLimit`.
 */
export function secondsBeforeLimit(elapsed, limit = DEFAULT_TAKE_SECONDS) {
  const remaining = limit - elapsed;
  if (remaining > WARN_WITHIN_SECONDS) return null;
  return Math.max(Math.round(remaining), 0);
}

/** AAC-LC. The one profile that is both encodable in browsers and decodable by AVFoundation. */
const AAC_LC = "mp4a.40.2";
const SAMPLE_RATE = 44_100;
const BITRATE = 64_000; // voice-and-click, not fidelity — 480 KB/minute, as on iOS

/**
 * What this browser can actually do, asked rather than inferred from the user agent.
 *
 * Sniffing the UA would be a second construction of "can this browser encode AAC" whose answer is
 * a guess. These are the real feature tests, and `isConfigSupported` is asynchronous precisely
 * because the answer depends on hardware.
 */
export async function capabilities() {
  const mediaRecorderMp4 = typeof MediaRecorder !== "undefined" &&
    MediaRecorder.isTypeSupported?.("audio/mp4");

  let webCodecsAac = false;
  if (typeof AudioEncoder !== "undefined") {
    try {
      const { supported } = await AudioEncoder.isConfigSupported({
        codec: AAC_LC,
        sampleRate: SAMPLE_RATE,
        numberOfChannels: 1,
        bitrate: BITRATE,
      });
      webCodecsAac = !!supported;
    } catch {
      webCodecsAac = false;
    }
  }

  const canRecord = typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  const canCaptureFrames = typeof MediaStreamTrackProcessor !== "undefined";
  const webCodecsUsable = webCodecsAac && canCaptureFrames;

  return {
    canRecord,
    mediaRecorderMp4,
    webCodecsAac,        // what the browser could do
    webCodecsUsable,     // what this client can currently do with it
    canProduceCompatibleClip: canRecord && (mediaRecorderMp4 || webCodecsUsable),
    path: mediaRecorderMp4 ? "mediarecorder-mp4" : webCodecsUsable ? "webcodecs-aac" : "none",
  };
}

/**
 * The microphone, requested with the constraints a *musical* take needs.
 *
 * All three processors are off, and that is the whole reason this is not the browser default.
 * `RecordingPolicy.take` refuses them on iOS for the same reason and states it plainly: this app
 * is record-only, bring-your-own-click, so the performer is playing a metronome out loud in the
 * room and the recording has to capture the click *and* the playing in one take.
 *
 *   · `echoCancellation` is built to remove exactly what a speaker in the room is emitting — it
 *     would cancel the click the instructor needs to hear.
 *   · `noiseSuppression` treats a sustained tone as noise.
 *   · `autoGainControl` rides the level, so a diminuendo arrives flat.
 *
 * All four ways of getting this wrong produce a plausible-looking app that silently ruins takes,
 * which is why it is stated here rather than left to a default.
 */
export async function openMicrophone() {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      sampleRate: SAMPLE_RATE,
    },
  });
}

/**
 * Records one take and resolves to `{ blob, duration, mimeType }` where the blob is AAC in MP4.
 *
 * `onTick` receives elapsed seconds so the screen can draw a clock without owning a second timer —
 * two constructions of "how long has this been running" is how a display and a stored duration end
 * up disagreeing about the same take.
 */
export async function record(stream, { onTick, onLevel, signal, maxSeconds } = {}) {
  const caps = await capabilities();
  if (!caps.canProduceCompatibleClip) {
    throw new Error("This browser can't record in a format your instructor can play.");
  }
  const limit = maxSeconds ?? DEFAULT_TAKE_SECONDS;
  return caps.mediaRecorderMp4
    ? recordViaMediaRecorder(stream, { onTick, onLevel, signal, maxSeconds: limit })
    : recordViaWebCodecs(stream, { onTick, onLevel, signal, maxSeconds: limit });
}


function recordViaMediaRecorder(stream, { onTick, onLevel, signal, maxSeconds }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let recorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: "audio/mp4",
        audioBitsPerSecond: BITRATE,
      });
    } catch (e) {
      reject(e);
      return;
    }

    const started = performance.now();
    const meter = onLevel ? attachMeter(stream, onLevel) : null;
    const tick = setInterval(() => {
      const elapsed = (performance.now() - started) / 1000;
      onTick?.(elapsed);
      if (elapsed >= maxSeconds) recorder.stop();
    }, 200);

    const finish = () => {
      clearInterval(tick);
      meter?.stop();
    };

    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onerror = (e) => { finish(); reject(e.error ?? new Error("Recording failed.")); };
    recorder.onstop = () => {
      finish();
      resolve({
        blob: new Blob(chunks, { type: "audio/mp4" }),
        duration: (performance.now() - started) / 1000,
        mimeType: "audio/mp4",
      });
    };

    signal?.addEventListener("abort", () => {
      if (recorder.state !== "inactive") recorder.stop();
    }, { once: true });

    recorder.start(1000);
  });
}


/**
 * Encodes AAC through WebCodecs and muxes it into a fragmented MP4.
 *
 * The muxer is deliberately minimal and lives in `mp4.js` — a full MP4 writer is a large thing to
 * carry for a mono AAC track with no video, and every byte of it is downloaded by a school
 * Chromebook on school wi-fi.
 */
async function recordViaWebCodecs(stream, { onTick, onLevel, signal, maxSeconds }) {
  const { Mp4AacWriter } = await import("./mp4.js");

  let encoderError = null;
  let writer = null;
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => writer.addChunk(chunk, metadata),
    error: (e) => { encoderError = e; },
  });

  /**
   * Configured from the FIRST FRAME, not from the constants at the top of this file.
   *
   * `getUserMedia({ channelCount: 1, sampleRate: 44100 })` is a request, and the track honours it
   * or not as the hardware pleases — measured in a real Chromium, frames arrived **stereo** while
   * the constraint said mono. An encoder configured for one shape and fed another fires its error
   * callback and closes, and the take dies on exactly the machines whose microphones report two
   * channels — common laptop hardware, not an edge case.
   *
   * The frame describes itself, so the encoder and the muxer are configured from it and cannot
   * disagree with the audio — a container claiming a different rate than the frames were encoded
   * at plays at the wrong pitch and probes as perfectly valid.
   */
  const configureFrom = (frame) => {
    writer = new Mp4AacWriter({
      sampleRate: frame.sampleRate,
      channels: frame.numberOfChannels,
      bitrate: BITRATE,
    });
    encoder.configure({
      codec: AAC_LC,
      sampleRate: frame.sampleRate,
      numberOfChannels: frame.numberOfChannels,
      bitrate: BITRATE,
    });
  };

  /**
   * The stream is downmixed to mono through a Web Audio graph before it reaches the encoder,
   * and this is a workaround for a browser lying, not a preference.
   *
   * Measured in a real Chromium: `AudioEncoder.isConfigSupported({ numberOfChannels: 2 })` answers
   * **supported**, and the encoder then fails with `EncodingError` on the first stereo frame it is
   * given. The feature test cannot be trusted, so the frames are made mono before the encoder ever
   * sees them — which is also what the product wants: 64 kbps voice-and-click, same as iOS.
   *
   * A destination node with `channelCount: 1, channelCountMode: "explicit"` makes the graph do the
   * downmix natively — no per-frame JavaScript, and the same machinery `attachMeter` already uses.
   * The context's own sample rate is left alone: forcing 44.1 kHz on hardware that runs at 48 kHz
   * would make the browser resample twice, and `configureFrom` handles whatever rate arrives.
   */
  const graph = new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
  const source = graph.createMediaStreamSource(stream);
  const monoOut = graph.createMediaStreamDestination();
  monoOut.channelCount = 1;
  monoOut.channelCountMode = "explicit";
  source.connect(monoOut);

  const track = monoOut.stream.getAudioTracks()[0];
  const processor = new MediaStreamTrackProcessor({ track });
  const reader = processor.readable.getReader();

  const started = performance.now();
  const meter = onLevel ? attachMeter(stream, onLevel) : null;
  const tick = setInterval(() => onTick?.((performance.now() - started) / 1000), 200);

  let stopped = false;
  const stop = () => { stopped = true; };
  signal?.addEventListener("abort", stop, { once: true });

  try {
    while (!stopped) {
      const { value: frame, done } = await reader.read();
      if (done || !frame) break;
      if (encoderError) { frame.close(); throw encoderError; }
      if (!writer) configureFrom(frame);
      encoder.encode(frame);
      frame.close();
      if ((performance.now() - started) / 1000 >= maxSeconds) break;
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
  } finally {
    clearInterval(tick);
    meter?.stop();
    try { reader.releaseLock(); } catch { /* already released */ }
    track.stop();
    for (const t of stream.getAudioTracks()) t.stop();
    graph.close();
    try { encoder.close(); } catch { /* already closed */ }
  }

  if (!writer) throw new Error("the microphone produced no audio at all");
  return {
    blob: writer.finish(),
    duration: writer.durationSeconds,
    mimeType: "audio/mp4",
  };
}


/**
 * A live level, for the one thing a performer actually needs while recording: proof it is hearing
 * them. A recorder with no visible response is one people stop trusting and start testing, and a
 * take that turns out to be silence is forty minutes gone.
 *
 * Deliberately not a waveform. A waveform is decoration during a take; a single honest level is
 * information, and it costs one analyser node instead of a canvas redraw loop competing with the
 * encoder for the main thread.
 */
function attachMeter(stream, onLevel) {
  const ctx = new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const buf = new Uint8Array(analyser.frequencyBinCount);
  let raf;
  const loop = () => {
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
    onLevel(peak);
    raf = requestAnimationFrame(loop);
  };
  loop();

  return {
    stop() {
      cancelAnimationFrame(raf);
      source.disconnect();
      ctx.close().catch(() => {});
    },
  };
}
