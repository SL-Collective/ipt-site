/**
 * The order an instructor hears their studio in, and what both sides are told about the wait.
 *
 * ==========================================================================================
 * Why this is its own file and not a `sort` in a screen
 * ==========================================================================================
 *
 * This is the app's central promise made practical. **Every rival dies at the same link, and it is
 * not the student — it is the third step.** Assign → practice → record → *listen* → feel heard →
 * record again. A director with ninety kids and a Friday game does not listen; when they stop,
 * performers discover their recording went into a void, and a teenager needs about two weeks of
 * that before they stop attaching clips. Then this is a practice card with extra steps.
 *
 * So the ordering is a product decision with a reason, which is exactly what this project keeps in
 * Core rather than in a view — `ListeningQueue` in Swift, this file on the web.
 *
 * ==========================================================================================
 * A second construction, and what makes it allowed
 * ==========================================================================================
 *
 * The rule this repository applies to a duplicate is `ClipObjectPath`'s: it is permitted when
 * something that runs proves the copies agree. Scoring earned a three-way parity gate because a
 * disagreement there is silent, plausible and about somebody's grade. This is lighter — a queue in
 * a different order is visible the moment anybody looks at both — so `listening_test.js` proves the
 * **properties** the Swift tests assert rather than a copied expected list: nobody's second clip
 * before anybody's first, performers introduced by their earliest, ties broken so the order cannot
 * shuffle between two refreshes.
 *
 * Proving properties rather than an example is the stronger half anyway. An expected list can be
 * re-recorded from whatever the code now does; a property cannot.
 */

import { civilDate } from "./judgement.js";
import { longDuration } from "./format.js";

/**
 * Unheard clips, **round-robin by performer**, each performer's own in the order they arrived.
 *
 * Not simply oldest-first, and that is the whole point. Somebody who sends four takes would, under
 * a strict chronological sort, have three of them heard before a quieter performer's only one — so
 * the person who most needs to be noticed is heard last, by an instructor who is by then twelve
 * clips deep and losing attention. Round-robin means **nobody's second clip is heard before
 * anybody's first.**
 *
 * Performers are introduced in the order their earliest unheard clip arrived, so the queue is still
 * fundamentally first-come; it just interleaves.
 *
 * Filtering happens here rather than at the call site so there is one definition of "waiting to be
 * heard", and a session still sitting in somebody's outbox is not one of them — it has no clip on
 * the server yet, so there is nothing to play.
 */
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

/** "3 of 8" — position in the queue, one-based, for somebody working down it. */
export function positionPhrase(index, total) {
  return `${Math.min(index + 1, total)} of ${total}`;
}

/**
 * What to say when the queue empties.
 *
 * Named for the achievement rather than the absence: an instructor who has just listened to their
 * whole studio has done the thing this app exists for, and "No clips" would be a strange way to
 * greet it.
 */
/**
 * What the speed control is buying, in minutes of somebody's evening.
 *
 * `PlaybackRate.savingPhrase` in Swift, transcribed — including the two guards, which are the
 * whole design:
 *
 *   · **nil at normal speed**, which the five minute floor already covers, since 1× saves exactly
 *     zero. Swift makes the same point in its own comment and keeps one condition rather than two,
 *     because a second one is a line no planted breakage can reach.
 *   · **nil below five minutes saved**, rather than a cheerful "saves 4 seconds". Same rule
 *     `StudioTrend` follows refusing to call movement under 10% news: *a number that flatters once
 *     is a number nobody believes again.*
 *
 * `longDuration`, not `compactDuration` — this is a sentence somebody reads, and "About 20m
 * instead of 30m" is the tight-row form wearing prose.
 */
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

/**
 * Whole calendar days between two instants — "since Tuesday" is how a person counts.
 *
 * Through `civilDate`, the same construction the week grid stands on, rather than an epoch-day
 * floor shifted by `getTimezoneOffset`: the floor construction lost the 23:00-to-07:00 morning
 * (calendar days say "yesterday", 24-hour blocks say nothing) only by luck of the offset, and the
 * parity fixture carries that morning and a spring-forward crossing so neither can drift back in.
 * The zone defaults to the runtime's own — the days in these sentences are the reader's, by the
 * decision written on `ListeningBacklog.calendar`.
 */
function daysBetween(from, to, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const dayNumber = (d) => {
    const { year, month, day } = civilDate(d, timeZone);
    return Date.UTC(year, month - 1, day) / 86_400_000;
  };
  return Math.max(0, dayNumber(to) - dayNumber(from));
}

/**
 * The two facts a reminder needs about the queue: how many are waiting, and since when.
 *
 * `ListeningBacklog`'s constructor, transcribed — one definition of "waiting to be heard", the
 * same one `listeningOrder` and `waitingPhrase` filter by. The **oldest by `startedAt`**, because
 * a session that sat in an outbox through a week with no signal was still *played* a week ago and
 * the performer has been waiting since then.
 *
 * `PATIENCE_DAYS` is Swift's `ListeningBacklog.patienceDays` and carries its reasoning: three days
 * is about the **performer**, not the instructor's calendar — somebody who recorded on Monday and
 * hears nothing by Thursday has finished the week believing nobody listened.
 */
export const PATIENCE_DAYS = 3;

export function listeningBacklog(logs) {
  const waiting = logs.filter((l) => l.hasClip && !l.wasHeard && !l.isPending);
  if (!waiting.length) return { waiting: 0, oldestRecordedAt: null };
  const oldest = waiting.reduce((a, b) => (a.startedAt < b.startedAt ? a : b));
  return { waiting: waiting.length, oldestRecordedAt: oldest.startedAt };
}

/**
 * How long the studio has been waiting, as one line — or nothing at all.
 *
 * **The count only ever goes up**, and it says nothing about the thing that matters: that Marcus
 * recorded on Tuesday and nobody has heard it. Thirteen from this morning is a good day's work;
 * three from last week is the product failing. So this measures the *oldest*.
 *
 * Nil on the day everything arrived, because the count already says enough and a screen that
 * always has something to say becomes noise. Nothing here is red either — being behind on
 * listening is information, not an emergency, and an instructor who is made to feel accused closes
 * the app.
 */
export function waitingPhrase(logs, now = new Date(), timeZone = undefined) {
  const waiting = logs.filter((l) => l.hasClip && !l.wasHeard && !l.isPending);
  if (!waiting.length) return null;
  const oldest = waiting.reduce((a, b) => (a.startedAt < b.startedAt ? a : b));
  const days = daysBetween(oldest.startedAt, now, timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  if (days === 0) return null;
  if (days === 1) return "the oldest since yesterday";
  return `the oldest for ${days} days`;
}

/**
 * What a performer is told about their own recording — `HeardState`, transcribed and held to
 * Swift's answers by the listening parity fixture.
 *
 * The other half of the same loop, and the half nobody builds. A clip that has been heard should
 * say so, and one that has not should say *that* — plainly, **with no estimate and no apology**.
 * "Not heard yet" is honest and survives being true for a week; "your instructor will listen soon"
 * is a claim this app cannot keep and would be resented for.
 */
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

/**
 * What deleting this account destroys, in numbers.
 *
 * A transcription of `DeletionCost`, and the reason it is not "all associated data will be removed"
 * is that the sentence tells somebody nothing. An instructor deleting their account is **ending a
 * room full of other people's work** and will not otherwise know it. Counts and hours are the part
 * that survives skimming, because somebody about to do something irreversible skims.
 *
 * It lives beside the listening code rather than in `judgement.js` for the reason that file states
 * about itself: nothing may go in there that is not also in `IPTCore` *and* in the SQL, and this is
 * in neither the SQL nor anybody's grade.
 */
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

/**
 * What removing somebody from the roster actually costs, in numbers.
 *
 * ## The sentence this replaces was false
 *
 * Both clients told an instructor *"Their practice history stays part of this studio's record"* at
 * the moment of the confirmation. It is not: everything the judgement produces —
 * `studio_assignment_progress` and so the board, the totals, every span summary and the season
 * report — selects its performers from **current membership**, so a removed performer is gone from
 * the studio's record *retroactively*, including from weeks that finished months ago and from a
 * season an instructor may already have forwarded to a booster club.
 *
 * That is proved rather than asserted: `supabase/harness/checks.sql` puts a performer with practice
 * on the board, deletes the membership row exactly as the clients do, and asks the board again.
 *
 * ## What is actually true, and why the behaviour is fine
 *
 * Nothing is deleted. `practice_logs_read` is `performer_id = auth.uid() or
 * is_instructor_of(studio_id)` and asks nothing about membership, so the instructor keeps every
 * session and the performer keeps their own — *practice is never lost* holds. And **rejoining with
 * the code brings the whole season back**, which the harness also proves, because the summaries are
 * rebuilt from membership every time they are asked for.
 *
 * So the fix is the copy, not the schema. What an instructor needs at that moment is what leaves the
 * studio's numbers, that it is not destroyed, and that it is undoable.
 */
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
