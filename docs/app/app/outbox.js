/**
 * Practice is never lost, and never counted twice.
 *
 * ==========================================================================================
 * The rule this file exists to keep
 * ==========================================================================================
 *
 * A session is written to disk **before the network is touched**, and survives the tab being
 * closed, the laptop sleeping, and a week with no signal. A practice room is a basement; a submit
 * button that can lose forty minutes is one nobody trusts twice.
 *
 * This is the web transcription of `SubmissionQueue`, and it is the single largest reason a
 * browser client is not simply "the app but worse". Every hard-won behaviour in the Swift version
 * is here because each one was a real failure first:
 *
 * ==========================================================================================
 * A refusal is not a bad connection
 * ==========================================================================================
 *
 * The queue waits **forever** on a network failure, which is right. It cannot wait forever on a
 * *refusal*: an assignment deleted while somebody had a session queued against it, or a performer
 * removed from the studio between practicing and submitting, is a row the server will never
 * accept. And because `flush` stops at the first failure to keep sessions in order, one permanently
 * refused session held every session behind it hostage — permanently.
 *
 * So refusals are counted separately from network failures. Past `REFUSAL_LIMIT` the session is
 * **set aside**: kept on disk and on their screen with a reason, because it is still practice they
 * actually did, and only they may throw it away.
 *
 * ==========================================================================================
 * A retry counter that nothing acts on is not a retry policy
 * ==========================================================================================
 *
 * `attempts` was incremented and displayed for months in the Swift version while a permanently
 * failing clip blocked the whole queue. Anything that retries needs a ceiling and a defined
 * behaviour past it — here, past `CLIP_ATTEMPT_LIMIT` the session is delivered **without** its
 * recording and the performer is told. Practice is never lost; the clip is not practice.
 *
 * ==========================================================================================
 * At-least-once, so the write must be idempotent
 * ==========================================================================================
 *
 * The row can exist on the server before this queue has finished recording its own removal — a
 * tab closed in exactly that window resends. `practice_logs_one_per_instant` in the migration is
 * what makes that safe, and it reports the duplicate as error 23505. **A duplicate is success.**
 * `humanize()` in supabase.js deliberately does not translate that string, because finding it is
 * how this file tells "already delivered" from "rejected".
 */

import { clipObjectPath } from "./config.js";
import { currentUserId, insert, signedClipUrl, StoreError, uploadClip } from "./supabase.js";

const DB_NAME = "ipt";
const DB_VERSION = 1;
const STORE = "outbox";

/** How many times a *refusal* is retried before the session is set aside for the performer. */
const REFUSAL_LIMIT = 5;
/** How many times a *clip upload* is retried before the session goes without it. */
const CLIP_ATTEMPT_LIMIT = 5;


/** What to do with a session after a delivery attempt failed. */
export function decideAfterFailure(item, error) {
  const isNetwork = error?.kind === "network";
  const next = {
    ...item,
    attempts: item.attempts + 1,
    refusals: isNetwork ? item.refusals : item.refusals + 1,
    lastError: error?.message ?? "Unknown error",
  };

  if (!isNetwork && next.refusals >= REFUSAL_LIMIT) {
    return { ...next, setAside: true, action: "setAside" };
  }
  return { ...next, action: "retryLater" };
}

/**
 * What to do when the *clip* fails but the practice itself is fine.
 *
 * **This charged a dropped connection to the clip ceiling.** `decideAfterFailure`, directly above,
 * checks `kind === "network"` and refuses to spend a budget on a basement; this function did not
 * take the error at all and counted every failure the same way. So a performer who recorded a take
 * on school wi-fi lost the recording after five attempts — and five is nothing, because a flush
 * runs on every foreground, every load, every submit and the "Try now" button. Riding the bus home
 * with the tab open was enough to reach it.
 *
 * The clip is the one artifact this app exists to move. Losing it because the signal was bad, and
 * saying only that it "couldn't be sent", is the failure the whole queue is built to prevent,
 * arriving through the one path that had not been checked for it.
 *
 * The ceiling still exists and still means what it says: a recording the server will not take — a
 * file past the bucket's size limit, a policy refusal — must not cost somebody the forty minutes
 * it was attached to. That is a fact about the recording. A dropped connection is not, so it costs
 * nothing and waits, exactly as the session itself does.
 */
export function decideAfterClipFailure(item, error) {
  if (error?.kind === "network") {
    return { ...item, attempts: item.attempts + 1, lastError: error.message, action: "retryLater" };
  }
  const next = { ...item, clipAttempts: item.clipAttempts + 1 };
  if (next.clipAttempts >= CLIP_ATTEMPT_LIMIT) {
    return {
      ...next,
      droppedClip: true,
      lastError: "The recording couldn't be sent, so the session went without it.",
      action: "deliverWithoutClip",
    };
  }
  return { ...next, action: "retryLater" };
}

/**
 * Whether a server response means "already delivered" rather than "rejected".
 *
 * At-least-once delivery means a row may already exist from an attempt whose acknowledgement was
 * lost. `practice_logs_one_per_instant` catches the resend and Postgres reports 23505.
 *
 * Getting this wrong is silent in both directions, which is why it is its own function with its
 * own tests: reading a duplicate as a failure resends forever, and reading it as a fresh insert
 * doubles somebody's week with no error and nothing to notice.
 */
export function isAlreadyDelivered(error) {
  if (!error) return false;
  return error.body?.code === "23505" || /duplicate key|23505/.test(error.message ?? "");
}


let dbPromise = null;

function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const d = open.result;
      if (!d.objectStoreNames.contains(STORE)) {
        const store = d.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("startedAt", "draft.startedAt");
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return db().then((d) =>
    new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      try {
        result = fn(store);
      } catch (e) {
        reject(e);
        return;
      }
      t.oncomplete = () => resolve(result?.result ?? result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    })
  );
}

/**
 * Asks the browser to exempt this origin from storage eviction.
 *
 * **This is not optional on Safari.** WebKit clears all script-writable storage — IndexedDB
 * included, which is this queue — after seven days without use. A home-screen web app runs its own
 * counter and is effectively exempt while it is being used, but a performer who practices weekly
 * over a school holiday is exactly the person this queue exists for and exactly the person that
 * window catches.
 *
 * Granted silently for installed PWAs and for origins with engagement; refused otherwise, which is
 * information rather than an error. It is why `install.js` pushes add-to-home-screen on iOS rather
 * than treating it as a nicety.
 */
export async function requestDurableStorage() {
  if (!navigator.storage?.persist) return { supported: false, granted: false };
  const already = await navigator.storage.persisted?.();
  if (already) return { supported: true, granted: true };
  return { supported: true, granted: await navigator.storage.persist() };
}


/**
 * Records a finished session. Returns as soon as it is **on disk** — never after the network.
 *
 * Awaiting delivery here is the mistake the Swift version made once: the performer watched a
 * spinner at the end of a practice session, on the worst connection in the building, for a write
 * that was already durable.
 */
export async function enqueue(draft) {
  const performerId = currentUserId();
  if (!performerId) throw StoreError.notSignedIn();

  const item = {
    id: crypto.randomUUID(),
    performerId,
    draft: {
      assignmentId: draft.assignmentId,
      studioId: draft.studioId,
      startedAt: new Date(draft.startedAt).toISOString(),
      duration: draft.duration,
      note: draft.note ?? null,
      markers: draft.markers ?? [],
      clip: draft.clip ?? null, // a Blob; IndexedDB stores it natively
      clipDuration: draft.clipDuration ?? null,
      selfReported: draft.selfReported === true,
    },
    attempts: 0,
    refusals: 0,
    clipAttempts: 0,
    lastError: null,
    setAside: false,
    droppedClip: false,
    queuedAt: new Date().toISOString(),
  };

  await tx("readwrite", (s) => s.put(item));
  return item;
}

export function pending() {
  return tx("readonly", (s) => s.index("startedAt").getAll());
}

/** Everything still trying, oldest practice first. Set-aside items are excluded. */
export async function queued() {
  return (await pending()).filter((i) => !i.setAside);
}

/** Sessions the server refused too many times. Shown with a reason; only the performer clears them. */
export async function setAside() {
  return (await pending()).filter((i) => i.setAside);
}

export function discard(id) {
  return tx("readwrite", (s) => s.delete(id));
}

async function update(item) {
  await tx("readwrite", (s) => s.put(item));
  return item;
}

/**
 * Delivers everything queued, oldest first, stopping at the first thing that is still waiting.
 *
 * **Order is preserved deliberately** — see the file comment. The cost of that decision is the
 * head-of-line blocking that made refusal handling necessary, and both halves are here.
 */
let inFlight = null;
let followUp = null;

/**
 * One flush at a time, however many things ask for one.
 *
 * **Found by running this queue against a real store for the first time.** `logPractice` starts a
 * flush and deliberately does not await it — the performer must not watch a spinner for a write
 * that is already durable — so any caller that flushed alongside it had two passes reading the same
 * queue and delivering the same rows. Every clip was uploaded twice and every row inserted twice.
 *
 * Nothing *broke*, which is the point: `practice_logs_one_per_instant` caught the duplicate row and
 * the queue read 23505 as the success it is. So the whole fault was invisible — twice the uploads
 * and twice the requests, on a school connection, for exactly the sessions that already struggled
 * to send. `SubmissionQueue` is an actor and gets this for free; JavaScript does not, so it is
 * written down here.
 *
 * A caller arriving mid-flush gets **one** coalesced follow-up rather than a queue of them: what
 * they want is "make sure what I just wrote goes out", and one more pass after this one satisfies
 * every such caller at once. Its `onProgress` is the first waiting caller's, which is why that
 * argument is only ever used to draw a bar.
 */
export function flush(options = {}) {
  if (inFlight) {
    followUp ??= inFlight.catch(() => {}).then(() => {
      followUp = null;
      return flush(options);
    });
    return followUp;
  }
  inFlight = deliverQueue(options).finally(() => { inFlight = null; });
  return inFlight;
}

async function deliverQueue({ onProgress } = {}) {
  const items = await queued();
  let delivered = 0;
  let stillWaiting = 0;
  let lastError = null;

  for (const item of items) {
    try {
      await deliver(item);
      await discard(item.id);
      delivered += 1;
      onProgress?.({ delivered, remaining: items.length - delivered });
    } catch (err) {
      const { action, ...next } = decideAfterFailure(item, err);
      await update(next);

      if (action === "setAside") {
        continue;
      }

      stillWaiting = items.length - delivered;
      lastError = err.message;
      break;
    }
  }

  return { delivered, stillWaiting, lastError };
}

/**
 * One session: the clip first, then the row.
 *
 * **Clip first, and this order is load-bearing.** A row that claims a clip which failed to upload
 * is a broken play button on an instructor's screen; a clip with no row is invisible garbage that
 * a lifecycle rule sweeps up. One of those is a support call and the other is a rounding error.
 */
async function deliver(item) {
  const { draft } = item;
  let clipPath = null;

  if (draft.clip && !item.droppedClip) {
    try {
      clipPath = clipObjectPath(draft.studioId, item.performerId, item.id);
      await uploadClip(clipPath, draft.clip);
    } catch (err) {
      const { action, ...next } = decideAfterClipFailure(item, err);
      Object.assign(item, next);
      await update(item);
      if (action === "deliverWithoutClip") {
        clipPath = null;
      } else {
        throw err;
      }
    }
  }

  try {
    await insert("practice_logs", [{
      id: item.id,
      assignment_id: draft.assignmentId,
      performer_id: item.performerId,
      started_at: draft.startedAt,
      duration_seconds: draft.duration,
      note: draft.note,
      self_reported: draft.selfReported === true,
      clip_path: clipPath,
      clip_duration: clipPath ? draft.clipDuration : null,
      clip_markers: clipPath && draft.markers?.length ? draft.markers : null,
    }], { returning: "minimal" });
  } catch (err) {
    if (!isAlreadyDelivered(err)) throw err;
  }
}

/**
 * What to show the performer about the queue, in words rather than counts.
 *
 * A count of waiting sessions only ever goes up and tells somebody nothing they can act on. The
 * two facts that matter are whether anything is stuck and whether anything needs *them*.
 */
export async function status() {
  const [waiting, aside] = await Promise.all([queued(), setAside()]);
  const oldest = waiting[0] ? new Date(waiting[0].draft.startedAt) : null;
  return {
    waiting: waiting.length,
    setAside: aside.length,
    oldest,
    quiet: waiting.length === 0 && aside.length === 0,
  };
}

export { REFUSAL_LIMIT, CLIP_ATTEMPT_LIMIT, signedClipUrl };
