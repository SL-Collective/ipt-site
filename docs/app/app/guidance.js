/**
 * What this studio actually practices, for an instructor deciding what to ask of it.
 *
 * The JavaScript half of `IPTCore.TargetGuidance`. `GuidanceParityTests` exports the inputs **and
 * Swift's own answers** to `Tests/IPTCoreTests/Fixtures/guidance/cases.json`, and
 * `web/tests/guidance_test.js` compares every field — which is the only thing that makes a second
 * construction of this permissible at all. A transcription error here does not crash: it hands an
 * instructor a different number on a Chromebook than on their phone, about their own studio, at the
 * moment they are deciding what to ask forty people to do, and both screens look right.
 *
 * ## What this deliberately does not do
 *
 * **It does not suggest a number, and it never invents a benchmark.** "Most studios use 90 minutes"
 * would be a fabricated statistic. What it reports is what *these* performers did, which is a fact
 * the app holds — and it says nothing at all until there is enough history to mean anything.
 *
 * @module
 */

import { longDuration } from "./format.js";
import { isInSession } from "./terms.js";

/**
 * How many finished performer-weeks before this is worth showing.
 *
 * Six, because a median of two numbers is not a median — and because a first week is atypical by
 * definition: the week a studio starts is the week everybody is paying attention.
 * `TargetGuidance.minimumObservations`.
 */
export const MINIMUM_OBSERVATIONS = 6;

/** `ScoringRules.standard.minimumCountableSession`. A tapped-and-abandoned session is not practice. */
const COUNTABLE_FLOOR_SECONDS = 120;

/**
 * What the studio has been doing, or null when it cannot honestly say.
 *
 * @param {{start: Date, end: Date}[]} weeks the studio's week grid, oldest first
 * @param {{performerId: string, startedAt: Date, duration: number}[]} facts
 * @param {{startsOn: string|Date, endsOn: string|Date|null}[]} terms
 * @param {Date} now unfinished weeks are excluded — a studio looks like it practices half as much
 *   as it does if you average in a Tuesday
 */
export function targetGuidance(weeks, facts, terms, now) {
  const finished = (weeks ?? []).filter(
    (week) => week.end <= now && isInSession(terms, week.start, week.end),
  );
  if (finished.length === 0) return null;

  const totals = new Map();
  for (const fact of facts ?? []) {
    if (!(fact.duration >= COUNTABLE_FLOOR_SECONDS)) continue;
    const week = weekContaining(fact.startedAt, finished);
    if (!week) continue;
    let byWeek = totals.get(fact.performerId);
    if (!byWeek) {
      byWeek = new Map();
      totals.set(fact.performerId, byWeek);
    }
    const key = week.start.getTime();
    byWeek.set(key, (byWeek.get(key) ?? 0) + fact.duration);
  }

  const observations = [];
  for (const byWeek of totals.values()) {
    const firstWeek = Math.min(...byWeek.keys());
    for (const week of finished) {
      if (week.start.getTime() < firstWeek) continue;
      observations.push(Math.trunc((byWeek.get(week.start.getTime()) ?? 0) / 60));
    }
  }

  if (observations.length < MINIMUM_OBSERVATIONS) return null;
  const sorted = observations.slice().sort((a, b) => a - b);
  return {
    medianMinutes: percentile(sorted, 0.5),
    upperMinutes: percentile(sorted, 0.75),
    weeksObserved: finished.length,
    performersObserved: totals.size,
  };
}

/**
 * The sentence, matching `TargetGuidance.phrase` exactly.
 *
 * The second half is **dropped** when the quartile equals the median, or a studio that practices
 * uniformly is told the same figure twice in two sentences. And it says "or more", because a 75th
 * percentile is the floor of that quarter rather than what they all did.
 */
export function guidancePhrase(guidance) {
  if (!guidance) return "";
  const period = guidance.weeksObserved === 1
    ? "the last week"
    : `the last ${guidance.weeksObserved} weeks`;
  const median = `Over ${period}, performers here practiced a median of `
    + `${longDuration(guidance.medianMinutes * 60)} a week.`;
  if (!(guidance.upperMinutes > guidance.medianMinutes)) return median;
  return `${median} The busiest quarter did ${longDuration(guidance.upperMinutes * 60)} or more.`;
}

/**
 * Nearest-rank, with no interpolation: these are whole minutes somebody practiced, and a median of
 * "72.5 minutes" is a number nobody did — which matters when an instructor is about to copy it into
 * a target.
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/**
 * Binary search, which stays correct over a *non-contiguous* list — `finished` has the weeks the
 * studio was not running cut out of it, and the array is still sorted and non-overlapping.
 */
function weekContaining(date, weeks) {
  const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (t < weeks[0].start.getTime() || t >= weeks[weeks.length - 1].end.getTime()) return null;
  let low = 0;
  let high = weeks.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (t < weeks[mid].start.getTime()) high = mid - 1;
    else if (t >= weeks[mid].end.getTime()) low = mid + 1;
    else return weeks[mid];
  }
  return null;
}
