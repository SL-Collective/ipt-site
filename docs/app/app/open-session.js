
const KEY = "ipt.session.open";

export const HEARTBEAT_MS = 10_000;

const VERSION = 1;

export function saveOpenSession({ assignmentId, performerId, startedAt, note = "", markers = [] }) {
  if (!performerId || !assignmentId) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({
      version: VERSION,
      assignmentId,
      performerId,
      startedAt: startedAt.toISOString(),
      beatAt: new Date().toISOString(),
      note,
      markers,
    }));
  } catch {
  }
}

export function readOpenSession() {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { return null; }
  if (!raw) return null;
  try {
    const held = JSON.parse(raw);
    if (held?.version !== VERSION) { clearOpenSession(); return null; }
    return {
      ...held,
      startedAt: new Date(held.startedAt),
      beatAt: new Date(held.beatAt),
    };
  } catch {
    clearOpenSession();
    return null;
  }
}

export function clearOpenSession() {
  try { localStorage.removeItem(KEY); } catch { /* private mode */ }
}

export function watchedSeconds(session) {
  return Math.max(0, (session.beatAt.getTime() - session.startedAt.getTime()) / 1000);
}

const RESUMABLE_WITHIN_MS = 24 * 60 * 60 * 1000;

export function offerFor(session, now, floorSeconds) {
  if (watchedSeconds(session) < floorSeconds) return "nothingToKeep";
  return now.getTime() - session.beatAt.getTime() <= RESUMABLE_WITHIN_MS ? "resumable" : "saveOnly";
}

export function belongsTo(session, performerId) {
  if (!performerId) return false;
  return session.performerId === performerId;
}
