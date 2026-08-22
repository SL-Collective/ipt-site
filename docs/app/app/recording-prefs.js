/**
 * What this browser does when somebody presses Record — the web's half of `CountIn`.
 *
 * ## Why this exists at all
 *
 * The web started recording **the instant the button was pressed**. `CountIn`'s docstring in Core
 * is, from its first line, an argument against exactly that:
 *
 * > Three seconds was picked because it is the convention everywhere else that records musicians,
 * > and it is right for the case it was imagined in: a phone on a stand, an arm's length away, and
 * > an instrument already in your hands. That is a snare drummer. It is not: a bass trombonist, or
 * > anybody whose instrument has to come up off a stand; a pianist whose phone is on the lid and
 * > whose bench is three feet from it; a guard performer with the phone across the gym…
 *
 * *The first bar of every take being the sound of somebody sitting down is the failure this exists
 * to prevent* — and zero causes it more reliably than three. iOS has offered the choice since the
 * feature landed; on a Chromebook there was no choice and the answer was the worst one.
 *
 * **It costs nothing to be generous**, because the count-in is silence *before* the recorder
 * starts: a longer one makes no clip longer and no upload bigger. What it costs is somebody
 * standing still watching a number, which is why `CountIn` bounds it and why the options are
 * Swift's rather than this file's — they ride `demo-studio.json`, like the notification dial and
 * the nudge openings, so the two clients cannot come to describe the same wait differently.
 *
 * ## Why it is not in `push.js`
 *
 * That module has a preferences blob too, and folding this into it would have been fewer files. It
 * is keyed `ipt.notifications` and merged over `STANDARD_PREFERENCES` on every read — so a
 * recording setting living inside it would be a recording setting that a notification default can
 * silently reset, and a stored blob nobody can reason about from its own name. Different question,
 * different key.
 *
 * ## On the device, not in the database
 *
 * The same reasoning `push.js` states: this is a fact about *where somebody's phone is when they
 * practice*, which is a property of this browser and this room rather than of the account. iOS
 * keeps it in `Preferences` for the same reason, and neither client syncs it.
 *
 * @module
 */

const KEY = "ipt.recording";

/** `CountIn.standard` — right for an instrument already in hand, and wrong for everything else. */
export const STANDARD_COUNT_IN_SECONDS = 3;

/**
 * The chosen count-in, in seconds.
 *
 * Falls back to the standard on anything unreadable — a browser in private mode where
 * `localStorage` throws, a blob from an older version, a value somebody edited by hand. A count-in
 * is not worth an error state; the worst case has to be *a working recorder*, which is what makes
 * every guard here return rather than throw.
 */
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

/** Saved on choosing, not on leaving the screen — there is no Save button and there should not be. */
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

/**
 * Counts down, then resolves — or resolves at once when the count-in is off.
 *
 * `onTick` is called with the number **about to be shown**, starting at the full count and ending
 * at 1, so a caller can put it on screen without doing its own arithmetic. Nothing is drawn here:
 * this module has no DOM in it, which is what lets a test run the countdown without one.
 *
 * `signal` aborts it. Somebody who presses Record and immediately changes their mind must not have
 * to wait ten seconds to be allowed to, and the recorder must not then start behind them —
 * `aborted` says which happened rather than leaving the caller to guess.
 *
 * @param wait injectable so a test does not sleep for ten real seconds. Production passes nothing.
 */
export async function countIn(seconds, { onTick, signal, wait = sleep } = {}) {
  if (!Number.isInteger(seconds) || seconds <= 0) return { aborted: false };

  for (let left = seconds; left > 0; left -= 1) {
    if (signal?.aborted) return { aborted: true };
    onTick?.(left);
    await wait(1000, signal);
  }
  return { aborted: signal?.aborted === true };
}

/**
 * A second, or the abort — whichever comes first.
 *
 * **The plain `setTimeout` version waited out the rest of the tick**, so calling the count-in off
 * took up to a second to be noticed. That is the whole thing this was written to avoid, one order
 * of magnitude smaller: somebody presses Record, changes their mind, presses again, and the screen
 * sits there. Found by a test that asserted the countdown was gone 120 ms after the second press —
 * the first version of that test looked only at whether a take had started, which this passed.
 *
 * The listener is removed on the timer path too. A count-in that ran to completion would otherwise
 * leave a listener on a controller the screen still holds, once per take, for the life of a
 * session — the same shape as the `<dialog>` handlers that were left in the body forever.
 */
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
