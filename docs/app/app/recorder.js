
export const DEFAULT_TAKE_SECONDS = 300;

export const MAX_TAKE_MINUTES = 15;

export function takeSeconds(assignmentMinutes) {
  if (assignmentMinutes == null) return DEFAULT_TAKE_SECONDS;
  return Math.min(Math.max(assignmentMinutes, 1), MAX_TAKE_MINUTES) * 60;
}

export const WARN_WITHIN_SECONDS = 30;

export function secondsBeforeLimit(elapsed, limit = DEFAULT_TAKE_SECONDS) {
  const remaining = limit - elapsed;
  if (remaining > WARN_WITHIN_SECONDS) return null;
  return Math.max(Math.round(remaining), 0);
}

const AAC_LC = "mp4a.40.2";
const SAMPLE_RATE = 44_100;
const BITRATE = 64_000; // voice-and-click, not fidelity — 480 KB/minute, as on iOS

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

export async function openMicrophone() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: SAMPLE_RATE,
      },
    });
  } catch (error) {
    console.error("IPT: the microphone could not be opened", error);
    const name = error?.name ?? "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      throw new Error(
        "Microphone access is off, so takes can't be recorded. You can still log the time. "
          + "To turn it back on, open your browser's site permissions for IPT.",
      );
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      throw new Error(
        "No microphone was found on this device. You can still log the time.",
      );
    }
    if (name === "NotReadableError") {
      throw new Error(
        "Something else on this device is using the microphone. Close it and try again, "
          + "or log the time without a take.",
      );
    }
    throw new Error(
      "The microphone could not be opened, so there is no take to keep. You can still log the time.",
    );
  }
}

export function watchInput(stream, onLost) {
  const tracks = stream.getAudioTracks();
  let lost = null;
  const note = (why) => { if (!lost) { lost = why; onLost?.(why); } };

  const onEnded = () => note("The microphone was disconnected part way through.");
  const onMute = () => note("Something else took the microphone part way through.");
  for (const track of tracks) {
    track.addEventListener("ended", onEnded);
    track.addEventListener("mute", onMute);
  }

  return {
    check() {
      if (!lost && tracks.some((t) => t.muted || t.readyState === "ended")) {
        note("The microphone stopped part way through.");
      }
      return lost;
    },
    get lost() { return lost; },
    stop() {
      for (const track of tracks) {
        track.removeEventListener("ended", onEnded);
        track.removeEventListener("mute", onMute);
      }
    },
  };
}

export function interruptedSentence(why) {
  return `${why} What was captured up to that point has been kept.`;
}

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
    let capturedUntil = null;
    const input = watchInput(stream, () => {
      capturedUntil ??= performance.now();
      if (recorder.state !== "inactive") recorder.stop();
    });
    const tick = setInterval(() => {
      const elapsed = (performance.now() - started) / 1000;
      onTick?.(elapsed);
      input.check();
      if (elapsed >= maxSeconds) recorder.stop();
    }, 200);

    const finish = () => {
      clearInterval(tick);
      meter?.stop();
      input.stop();
    };

    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onerror = (e) => { finish(); reject(e.error ?? new Error("Recording failed.")); };
    recorder.onstop = () => {
      finish();
      resolve({
        blob: new Blob(chunks, { type: "audio/mp4" }),
        duration: ((capturedUntil ?? performance.now()) - started) / 1000,
        mimeType: "audio/mp4",
        interrupted: input.lost ? interruptedSentence(input.lost) : null,
      });
    };

    signal?.addEventListener("abort", () => {
      if (recorder.state !== "inactive") recorder.stop();
    }, { once: true });

    recorder.start(1000);
  });
}


async function recordViaWebCodecs(stream, { onTick, onLevel, signal, maxSeconds }) {
  const { Mp4AacWriter } = await import("./mp4.js");

  let encoderError = null;
  let writer = null;
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => writer.addChunk(chunk, metadata),
    error: (e) => { encoderError = e; },
  });

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

  let stopped = false;
  const input = watchInput(stream, () => { stopped = true; });
  const tick = setInterval(() => {
    onTick?.((performance.now() - started) / 1000);
    if (input.check()) stopped = true;
  }, 200);

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
    input.stop();
    try { reader.releaseLock(); } catch { /* already released */ }
    track.stop();
    for (const t of stream.getAudioTracks()) t.stop();
    graph.close();
    try { encoder.close(); } catch { /* already closed */ }
  }

  if (!writer) {
    console.error("IPT: the microphone produced no audio at all");
    throw new Error("Nothing came through the microphone, so there is no take to keep. "
                    + "Check the microphone in Settings and try again.");
  }
  try {
    return {
      blob: writer.finish(),
      duration: writer.durationSeconds,
      mimeType: "audio/mp4",
      interrupted: input.lost ? interruptedSentence(input.lost) : null,
    };
  } catch (cause) {
    console.error("IPT: the MP4 writer refused to finish.", cause);
    throw new Error("That take couldn't be saved as a file your instructor can play. "
                    + "The practice still counts; record again if you want a take with it.");
  }
}


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
