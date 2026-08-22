/**
 * `StudioTrend`, transcribed — and the one data pass every dashboard figure comes out of.
 *
 * ## Why the pass lives here
 *
 * The trend compares two weeks of the same summaries the dashboard's tiles and rows are drawn
 * from, and *the tiles and the rows disagreeing about the same week is a bug that has to be made
 * impossible rather than avoided by care.* So `studioWeekRows` is the single construction:
 * `screens.js` draws this week's rows from it, and `weekTrend` runs it twice — the viewed week
 * and the one before — and hands both to the same comparison Swift makes. A second pass written
 * for the trend alone would be the two-constructions failure wearing a new coat.
 *
 * ## What the trend is allowed to say
 *
 * `StudioTrend`'s two rules, kept to the word and held by the parity fixture
 * (`Fixtures/trend/cases.json`, Swift's own answers):
 *
 *   · **It says nothing rather than something uncertain.** A first week has nothing behind it and
 *     the answer is silence, not a confident 0%.
 *   · **It does not flatter.** A drop is reported in the same voice as a rise, the difference is
 *     floored toward zero so an improvement is never overstated, and movement under the noise
 *     floor is noise — a studio is thirty teenagers, and one being ill moves the total.
 */

import { assignmentProgress, audienceIncludes, isActiveDuring, progressFraction, weekMet } from "./judgement.js";
import { memberSinceDates } from "./coverage.js";
import { longDuration } from "./format.js";

/** The week everything is judged against: the last one in the studio's grid. */
export function currentWeek(store) {
  const weeks = store.weeks();
  return weeks[weeks.length - 1];
}

/**
 * One performer's progress in one week, per assignment.
 *
 * Facts are narrowed to this person, this assignment and this week *before* being handed to
 * `assignmentProgress` — narrowing inside it would re-filter the whole studio once per assignment,
 * which is what made the instructor dashboard quadratic in Swift before it was fixed.
 */
export function weekProgress(store, performerId, week = currentWeek(store), facts = store.facts()) {
  const byId = {};
  const progress = {};

  for (const assignment of store.assignments()) {
    if (!audienceIncludes(assignment, performerId)) continue;
    if (!isActiveDuring(assignment, week)) continue;
    byId[assignment.id] = assignment;
    const mine = facts.filter((f) =>
      f.performerId === performerId &&
      f.assignmentId === assignment.id &&
      f.startedAt >= week.start && f.startedAt < week.end
    );
    progress[assignment.id] = assignmentProgress(mine, assignment.target, store.rules());
  }
  return { week, progress, byId };
}

/**
 * Every member's week, in one pass — the dashboard's figures and the trend's inputs.
 *
 * **A week that ended before somebody joined is not a week they failed**: the roster for a past
 * week counts only people who were members during it, through the same fail-safe resolution the
 * coverage denominator uses, and `joinedLater` says exactly how many rows that removed so the
 * screen can say so. For the current week the two rosters are identical.
 *
 * Each row carries the four fields `StudioTrend.between` reads (`hasWork`, `isMet`,
 * `countedSeconds` as `seconds`, `clipCount` as `clips`) plus the pair the roster rows draw
 * (`met`, `assigned`) — one shape, so nothing downstream can pick a different construction.
 */
export function studioWeekRows(store, week = currentWeek(store)) {
  const all = store.performers();
  const memberSince = memberSinceDates({
    joined: Object.fromEntries(store.roster().map((m) => [m.id, m.joined_at ?? null])),
    facts: store.facts(),
  });
  const members = all.filter((p) => {
    const since = memberSince.get(p.id);
    return since == null || since < week.end;
  });

  const byPerformer = new Map();
  for (const fact of store.facts()) {
    const held = byPerformer.get(fact.performerId);
    if (held) held.push(fact);
    else byPerformer.set(fact.performerId, [fact]);
  }
  const rows = members.map((person) => ({
    person,
    ...judgedWeek(weekProgress(store, person.id, week, byPerformer.get(person.id) ?? [])),
  }));

  return { rows, joinedLater: all.length - members.length };
}

/**
 * One judged week, from one `weekProgress` bundle — the row shape every reader shares.
 *
 * `hasWork` and `isMet` are about *required* work — optional practice counts its minutes and
 * casts no vote, which the fixture pins with an optional-only week. `fraction` is the mean
 * progress fraction across everything in the week, the number iOS's `WeekStrip` sizes its bars
 * by — carried here so the strip cannot grow its own arithmetic.
 */
function judgedWeek({ progress, byId }) {
  const required = Object.entries(progress).filter(([id]) => !byId[id].is_optional);
  const values = Object.values(progress);
  return {
    met: required.filter(([, p]) => p.isMet).length,
    assigned: required.length,
    hasWork: required.length > 0,
    isMet: weekMet(progress, byId),
    seconds: values.reduce((n, p) => n + p.countedSeconds, 0),
    clips: values.reduce((n, p) => n + p.clipCount, 0),
    fraction: values.length
      ? values.reduce((n, p) => n + progressFraction(p), 0) / values.length
      : 0,
  };
}

/**
 * One performer's judged weeks, oldest first — `PerformerSpanSummary.weeks` for the person whose
 * screen it is. The same construction as `studioWeekRows`, one person at a time, with the facts
 * pre-narrowed once so a whole season is a single pass rather than one scan per week.
 */
export function performerWeekRows(store, performerId, weeks) {
  const mine = store.facts().filter((f) => f.performerId === performerId);
  return weeks.map((week) => ({
    week,
    ...judgedWeek(weekProgress(store, performerId, week, mine)),
  }));
}

/** Movement smaller than this is noise, not news — one ill teenager moves a studio's total. */
const NOISE_FLOOR = 0.10;

/**
 * `StudioTrend.between` + `headline` + `detail`, in one call, because the web has no reason to
 * hold the intermediate struct. Returns null where Swift returns a nil headline: nothing is
 * claimed unless there is a real stretch to compare against.
 */
export function weekTrend({ now, before, periodName }) {
  const seconds = (rows) => rows.reduce((n, r) => n + r.seconds, 0);
  const clips = (rows) => rows.reduce((n, r) => n + r.clips, 0);
  const rate = (rows) => {
    const withWork = rows.filter((r) => r.hasWork);
    if (!withWork.length) return null;
    return withWork.filter((r) => r.isMet).length / withWork.length;
  };

  const practicedNow = seconds(now);
  const practicedBefore = seconds(before);
  if (!(practicedBefore > 0)) return null;

  const change = (practicedNow - practicedBefore) / practicedBefore;
  const direction = change > NOISE_FLOOR ? "up" : change < -NOISE_FLOOR ? "down" : "level";

  const difference = Math.floor(Math.abs(practicedNow - practicedBefore) / 60) * 60;

  const headline = direction === "level"
    ? `About the same as ${periodName}.`
    : direction === "up"
    ? `${longDuration(difference)} more practice than ${periodName}.`
    : `${longDuration(difference)} less practice than ${periodName}.`;

  const parts = [];
  const rateNow = rate(now);
  const rateBefore = rate(before);
  if (rateNow != null && rateBefore != null && Math.abs(rateNow - rateBefore) > NOISE_FLOOR) {
    const verb = rateNow > rateBefore ? "up" : "down";
    const percent = (v) => `${Math.floor(v * 100)}%`;
    parts.push(`Weeks finished in full are ${verb}, ${percent(rateBefore)} to ${percent(rateNow)}.`);
  }
  if (clips(before) > 0 || clips(now) > 0) {
    const moved = clips(now) - clips(before);
    if (Math.abs(moved) >= 3) {
      parts.push(moved > 0 ? `${moved} more recordings came in.` : `${Math.abs(moved)} fewer recordings came in.`);
    }
  }

  return { direction, headline, detail: parts.length ? parts.join(" ") : null };
}
