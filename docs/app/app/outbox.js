
import { clipObjectPath } from "./config.js";
import { currentUserId, insert, signedClipUrl, StoreError, uploadClip } from "./supabase.js";

const DB_NAME = "ipt";
const DB_VERSION = 1;
const STORE = "outbox";

const REFUSAL_LIMIT = 5;
const CLIP_ATTEMPT_LIMIT = 5;


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

export async function requestDurableStorage() {
  if (!navigator.storage?.persist) return { supported: false, granted: false };
  const already = await navigator.storage.persisted?.();
  if (already) return { supported: true, granted: true };
  return { supported: true, granted: await navigator.storage.persist() };
}


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

function belongsTo(item, performerId) {
  if (!performerId) return false;
  return item.performerId === performerId;
}

export function ownedBy(items, performerId) {
  return items.filter((i) => belongsTo(i, performerId));
}

export async function queued(performerId = currentUserId()) {
  return ownedBy((await pending()).filter((i) => !i.setAside), performerId);
}

export async function setAside(performerId = currentUserId()) {
  return ownedBy((await pending()).filter((i) => i.setAside), performerId);
}


export function discard(id) {
  return tx("readwrite", (s) => s.delete(id));
}

async function update(item) {
  await tx("readwrite", (s) => s.put(item));
  return item;
}

let inFlight = null;
let followUp = null;

export function flush(options = {}) {
  if (inFlight) {
    followUp ??= inFlight.catch(() => {}).then(() => {
      followUp = null;
      return flush(options);
    });
    return followUp;
  }
  inFlight = withOutboxLock(() => deliverQueue(options)).finally(() => { inFlight = null; });
  return inFlight;
}

const OUTBOX_LOCK = "ipt.outbox.flush";

function withOutboxLock(run) {
  const locks = globalThis.navigator?.locks;
  if (!locks?.request) return run();
  return locks.request(OUTBOX_LOCK, { ifAvailable: true }, async (lock) => {
    if (lock) return run();
    return { delivered: 0, stillWaiting: (await queued()).length, lastError: null };
  });
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

export async function status(performerId = currentUserId()) {
  const [waiting, aside] = await Promise.all([queued(performerId), setAside(performerId)]);
  const oldest = waiting[0] ? new Date(waiting[0].draft.startedAt) : null;
  return {
    waiting: waiting.length,
    setAside: aside.length,
    oldest,
    quiet: waiting.length === 0 && aside.length === 0,
  };
}

export { REFUSAL_LIMIT, CLIP_ATTEMPT_LIMIT, signedClipUrl };
