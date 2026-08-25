
const KEY = "ipt.recording";

export const STANDARD_COUNT_IN_SECONDS = 3;

export function countInSeconds() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
    const seconds = stored?.countInSeconds;
    return Number.isInteger(seconds) && seconds >= 0 && seconds <= 60
      ? seconds
      : STANDARD_COUNT_IN_SECONDS;
  } catch {
    return STANDARD_COUNT_IN_SECONDS;
  }
}

export function saveCountInSeconds(seconds) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), countInSeconds: seconds }));
  } catch { /* private mode: the choice lasts the sitting, which is better than an error */ }
}

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") ?? {};
  } catch {
    return {};
  }
}

export async function countIn(seconds, { onTick, signal, wait = sleep } = {}) {
  if (!Number.isInteger(seconds) || seconds <= 0) return { aborted: false };

  for (let left = seconds; left > 0; left -= 1) {
    if (signal?.aborted) return { aborted: true };
    onTick?.(left);
    await wait(1000, signal);
  }
  return { aborted: signal?.aborted === true };
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}


export const MARKER_DEBOUNCE_SECONDS = 1.0;

export function acceptsMark(at, markers) {
  const last = markers[markers.length - 1];
  if (last == null) return true;
  return at - last >= MARKER_DEBOUNCE_SECONDS;
}

export function marking(at, markers) {
  return acceptsMark(at, markers) ? [...markers, at] : markers;
}
