
import { civilDate } from "./judgement.js";
import { longDuration } from "./format.js";

export function listeningOrder(logs) {
  const waiting = logs.filter((l) => l.hasClip && !l.wasHeard && !l.isPending);
  if (!waiting.length) return [];

  const byPerformer = new Map();
  for (const log of waiting) {
    if (!byPerformer.has(log.performerId)) byPerformer.set(log.performerId, []);
    byPerformer.get(log.performerId).push(log);
  }

  const arrival = (a, b) =>
    a.recordedAt - b.recordedAt || String(a.id).localeCompare(String(b.id));
  for (const theirs of byPerformer.values()) theirs.sort(arrival);

  const performers = [...byPerformer.keys()].sort((a, b) =>
    arrival(byPerformer.get(a)[0], byPerformer.get(b)[0])
  );

  const ordered = [];
  const deepest = Math.max(...[...byPerformer.values()].map((t) => t.length));
  for (let round = 0; round < deepest; round++) {
    for (const performer of performers) {
      const theirs = byPerformer.get(performer);
      if (round < theirs.length) ordered.push(theirs[round]);
    }
  }
  return ordered;
}

export function positionPhrase(index, total) {
  return `${Math.min(index + 1, total)} of ${total}`;
}

export function savingPhrase(rate, backlogSeconds) {
  if (!(backlogSeconds > 0) || !(rate > 0)) return null;
  const at = backlogSeconds / rate;
  if (backlogSeconds - at < 300) return null;
  return `About ${longDuration(at)} instead of ${longDuration(backlogSeconds)}`;
}

export function finishedPhrase(heard) {
  if (heard === 0) return "Nothing waiting to be heard.";
  if (heard === 1) return "One clip heard. That's everyone.";
  return `${heard} clips heard. That's everyone.`;
}

function daysBetween(from, to, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const dayNumber = (d) => {
    const { year, month, day } = civilDate(d, timeZone);
    return Date.UTC(year, month - 1, day) / 86_400_000;
  };
  return Math.max(0, dayNumber(to) - dayNumber(from));
}

export const PATIENCE_DAYS = 3;

export function listeningBacklog(logs) {
  const waiting = logs.filter((l) => l.hasClip && !l.wasHeard && !l.isPending);
  if (!waiting.length) return { waiting: 0, oldestRecordedAt: null };
  const oldest = waiting.reduce((a, b) => (a.startedAt < b.startedAt ? a : b));
  return { waiting: waiting.length, oldestRecordedAt: oldest.startedAt };
}

export function waitingPhrase(logs, now = new Date(), timeZone = undefined) {
  const waiting = logs.filter((l) => l.hasClip && !l.wasHeard && !l.isPending);
  if (!waiting.length) return null;
  const oldest = waiting.reduce((a, b) => (a.startedAt < b.startedAt ? a : b));
  const days = daysBetween(oldest.startedAt, now, timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  if (days === 0) return null;
  if (days === 1) return "the oldest since yesterday";
  return `the oldest for ${days} days`;
}

export function heardPhrase(log, now = new Date(), timeZone = undefined) {
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (log.wasHeard) {
    const when = log.heardAt ?? now;
    const days = daysBetween(when, now, zone);
    const day = days === 0 ? "today" : days === 1 ? "yesterday"
      : when.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: zone });
    return `Your instructor heard this ${day}`;
  }
  const days = daysBetween(log.startedAt, now, zone);
  if (days === 0) return "Waiting to be heard";
  if (days === 1) return "Waiting to be heard since yesterday";
  return `Waiting to be heard for ${days} days`;
}

export function deletionCost({ studios, logs, roster, profileId, selectedStudioId = null }) {
  const owned = studios.filter((s) => s.owner_id === profileId);

  const selectedIsSaved = Boolean(
    selectedStudioId
      && owned.some((s) => s.id === selectedStudioId)
      && roster.some((p) => p.id !== profileId && (p.role === "instructor" || p.isInstructor)),
  );
  const doomed = new Set(
    owned.filter((s) => !(selectedIsSaved && s.id === selectedStudioId)).map((s) => s.id),
  );
  const counted = logs.filter((l) => doomed.has(l.studioId) || l.performerId === profileId);
  const others = new Set(
    roster.filter((p) => p.id !== profileId).map((p) => p.id),
  );

  const parts = [];
  const plural = (n, one, many) => (n === 1 ? one : `${n} ${many}`);
  if (doomed.size) parts.push(plural(doomed.size, "1 studio", "studios"));
  if (doomed.size && others.size) {
    parts.push(plural(others.size, "1 other person's practice", "other people's practice"));
  }
  if (counted.length) parts.push(plural(counted.length, "1 session", "sessions"));
  const clips = counted.filter((l) => l.hasClip).length;
  if (clips) parts.push(plural(clips, "1 recording", "recordings"));
  const seconds = counted.reduce((n, l) => n + l.duration, 0);
  if (seconds >= 300) parts.push(`${Math.floor(seconds / 3600)} hr ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")} min of logged practice`);

  const succession = selectedIsSaved
    ? "1 studio isn't deleted: somebody else instructs in it, so it passes to them."
    : null;

  if (!parts.length) {
    return {
      phrase: "There's nothing logged yet.",
      affectsOthers: false,
      succession,
    };
  }
  const phrase = parts.length === 1
    ? `This deletes ${parts[0]}.`
    : `This deletes ${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}.`;
  return { phrase, affectsOthers: doomed.size > 0 && others.size > 0, succession };
}

export const REMOVAL_UNDOABLE =
  "Nothing is deleted, and rejoining with the join code brings it all back.";

export function removalCost({ logs, performerId }) {
  const undoable = REMOVAL_UNDOABLE;
  const theirs = logs.filter((l) => l.performerId === performerId);
  if (theirs.length === 0) return `They haven't logged any practice yet. ${undoable}`;

  const parts = [];
  parts.push(theirs.length === 1 ? "1 session" : `${theirs.length} sessions`);
  const clips = theirs.filter((l) => l.hasClip).length;
  if (clips) parts.push(clips === 1 ? "1 recording" : `${clips} recordings`);
  const seconds = theirs.reduce((n, l) => n + l.duration, 0);
  if (seconds >= 300) {
    parts.push(`${Math.floor(seconds / 3600)} hr ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")} min`);
  }
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `This takes ${list} out of the studio's standings and totals, including weeks `
    + `already finished. ${undoable}`;
}

export function assignmentCost({ logs, assignmentId }) {
  const theirs = logs.filter((l) => l.assignmentId === assignmentId);
  const clips = theirs.filter((l) => l.hasClip).length;
  const parts = [theirs.length === 1 ? "1 logged session" : `${theirs.length} logged sessions`];
  if (clips) parts.push(clips === 1 ? "1 recording" : `${clips} recordings`);

  const titleTail = theirs.length === 0 ? "" : ` and ${parts.join(" and ")}`;
  const phrase = theirs.length === 0
    ? "Nothing has been logged against it, so nothing else is lost."
    : "Practice time your studio has already put in will be gone for good, and their points and "
      + `streaks will change.${clips ? " The recordings go with them, and a take belongs to the performer who made it." : ""}`
      + " If you're just done with this piece, finish it instead.";
  return { titleTail, phrase };
}
