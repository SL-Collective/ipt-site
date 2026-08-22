/**
 * A stretch of weeks nobody practiced — `IPTCore.StudioQuiet`, transcribed.
 *
 * ## Why the web needed this
 *
 * *A break is not a miss* only works if somebody declares one, and the terms screen correctly tells a
 * new instructor that running all year is fine — so the ordinary studio has no terms, winter break
 * ends every streak in the room, and it hits hardest the performers the mechanic was working on.
 * `StudioQuiet` is what lets the app notice and ask.
 *
 * iOS has asked since v32b. **The web asked nothing**, so an instructor running their studio from a
 * Chromebook got the silent-streak-loss the feature exists to prevent — the same class of divergence
 * as the assignment editor the demo could not open, found the same way: by comparing what each client
 * actually does rather than what the shared Core makes possible.
 *
 * ## This is not the judgement, and that is why it can live here
 *
 * Points, ranks, streak history and span totals are about *other people* and stay in `0004`. This
 * asks only **"did anybody log anything in this week"**, over facts the client already holds for its
 * own studio, so it needs no server and no migration. `web/tests/quiet_test.js` holds it to Swift's
 * answers over one exported fixture.
 *
 * ## It is offered, never done
 *
 * The app can see three silent weeks and cannot know whether the building was shut or the program
 * fell apart. Naming it a break is the instructor's call, and this module only finds the shape.
 *
 * @module
 */

import { isInSession } from "./terms.js";

/**
 * How many consecutive silent weeks before this is worth raising.
 *
 * Two, because **one silent week is a competition or a flu**, and offering to erase it would be
 * helping somebody delete evidence. `StudioQuiet.minimumWeeks`.
 */
export const MINIMUM_WEEKS = 2;

/** `QuietStretch.lengthPhrase`. */
export function lengthPhrase(stretch) {
  return stretch.weeks === 1 ? "1 week" : `${stretch.weeks} weeks`;
}

/**
 * Every quiet stretch in a studio's history, most recent first.
 *
 * @param weeks the studio's week grid, oldest first.
 * @param facts every peer-visible fact in that span.
 * @param terms declared terms. Weeks **out of session are not quiet** — they are accounted for, and
 *   offering them again would be the app forgetting what it was told.
 * @param now so the week in progress can be excluded. *A Monday morning is not a quiet week*, and an
 *   unfinished week counted as silent would have the app proposing to erase the week somebody is
 *   standing in.
 */
export function quietStretches(weeks, facts, terms, now) {
  const grid = weeks ?? [];
  const practiced = new Set();
  for (const fact of facts ?? []) {
    const index = weekIndex(fact.startedAt, grid);
    if (index !== null) practiced.add(grid[index].start.getTime());
  }

  const found = [];
  let run = [];

  const close = () => {
    if (run.length >= MINIMUM_WEEKS) {
      found.push({
        start: run[0].start,
        end: run[run.length - 1].end,
        weeks: run.length,
      });
    }
    run = [];
  };

  for (const week of grid) {
    const isFinished = week.end <= now;
    const isDeclaredOff = !isInSession(terms, week.start, week.end);
    const isSilent = !practiced.has(week.start.getTime());

    if (isFinished && isSilent && !isDeclaredOff) run.push(week);
    else close();
  }
  close();

  return found.sort((a, b) => b.start - a.start);
}

/**
 * The most recent stretch worth offering, or null.
 *
 * The most recent rather than the longest: an instructor is being asked *"was that a break?"* and
 * they can answer that about December. Being asked about a fortnight two seasons ago is a question
 * nobody can answer, and one they will dismiss — taking the useful one with it.
 */
export function mostRecentQuiet(weeks, facts, terms, now) {
  return quietStretches(weeks, facts, terms, now)[0] ?? null;
}

/** Binary search — weeks are contiguous and sorted, and a season is 36 weeks against thousands of facts. */
function weekIndex(date, weeks) {
  if (weeks.length === 0) return null;
  const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (t < weeks[0].start.getTime() || t >= weeks[weeks.length - 1].end.getTime()) return null;
  let low = 0;
  let high = weeks.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (t < weeks[mid].start.getTime()) high = mid - 1;
    else if (t >= weeks[mid].end.getTime()) low = mid + 1;
    else return mid;
  }
  return null;
}

/**
 * The terms a studio should have so that `stretch` stops counting against anybody —
 * `TermSchedule.declaringBreak`.
 *
 * Terms say when a studio **is** running, so "add a break" is never one edit: it is the terms on
 * either side of the gap. Three cases, and getting any of them wrong would either fail to fix the
 * streaks or quietly write off weeks people did practice:
 *
 *   · **No terms yet** — the ordinary case, and the studio has been implicitly always-on. Two terms:
 *     everything up to the break, and everything after it. The first starts at the studio's own
 *     beginning, because a term that starts later would write off every week before it.
 *   · **A term spans the break** — split it in two, keeping its name on both halves so the instructor
 *     recognises what happened to the thing they created.
 *   · **The break is already outside every term** — nothing to do. Returning the schedule unchanged
 *     is the honest answer, and the caller checks rather than assuming.
 *
 * **`endsOn` is inclusive and a week boundary is not**, which is the one conversion here that is easy
 * to get wrong and impossible to see: `stretch.start` is the first instant *of* the break, while a
 * term's `endsOn` is a moment the term still covers. Handing the first over as the second leaves the
 * week before the break — the last week anybody practiced — half in and half out, and the streak it
 * was supposed to protect still dies.
 *
 * @param terms the studio's terms, in `{ id, name, startsOn, endsOn }` shape.
 * @returns the terms that *should* exist, sorted. Ids are carried where a term was edited in place
 *   and absent where one is new, which is what lets the caller save only the difference.
 */
export function declaringBreak(terms, stretch, { studioCreatedAt, name = "Season" } = {}) {
  const existing = terms ?? [];
  const start = stretch.start instanceof Date ? stretch.start : new Date(stretch.start);
  const end = stretch.end instanceof Date ? stretch.end : new Date(stretch.end);
  const lastInstantBefore = (boundary) => new Date(boundary.getTime() - 1000);

  if (existing.length === 0) {
    return [
      { name, startsOn: studioCreatedAt, endsOn: lastInstantBefore(start) },
      { name, startsOn: end, endsOn: null },
    ];
  }

  const result = [];
  for (const term of existing) {
    const termStart = new Date(term.startsOn);
    const termEnd = term.endsOn == null ? null : new Date(term.endsOn);
    const endsAfterBreakStarts = termEnd == null ? true : termEnd > start;
    if (!(termStart < end && endsAfterBreakStarts)) {
      result.push(term);      // entirely before or entirely after the break
      continue;
    }
    if (termStart < start) {
      result.push({ id: term.id, name: term.name, startsOn: term.startsOn, endsOn: lastInstantBefore(start) });
    }
    if (termEnd == null || termEnd > end) {
      result.push({ name: term.name, startsOn: end, endsOn: term.endsOn ?? null });
    }
  }
  return result.sort((a, b) => new Date(a.startsOn) - new Date(b.startsOn));
}
