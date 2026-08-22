/**
 * `SelfReport`, transcribed — practice the app did not witness.
 *
 * A performer who practiced at seven in the morning with their phone in a locker did the work,
 * and before this the app recorded nothing and broke their streak for it. The Swift docstring
 * carries the whole argument; this file carries the same rules for the client a school hands out,
 * and `web/tests/selfreport_test.js` runs them over Swift's own answers.
 *
 * **The week bound is the one that matters and it is not merely a courtesy here.** A finished
 * week is immutable — its points and ranks have been published — so `0010` refuses a past-week
 * self-report with a trigger. This form exists to say so *before* somebody fills it in, in a
 * sentence a trigger cannot give them. Both halves are needed: the server's is the rule, and this
 * one is the only one anybody reads.
 *
 * Its own module rather than a corner of `screens.js`, for the reason `terms.js` is its own:
 * burying a rule inside the screen that draws it is how `isInSession`'s week boundary went two
 * versions stale without anybody noticing.
 */

/**
 * The longest a single self-reported session may be.
 *
 * Derived from `practice_logs.duration_seconds`, which already refuses more than 43,200 seconds,
 * and **not** re-chosen here. A tighter number invented in this file would be a craft limit with
 * no reasoning behind it, which is exactly what the five-minute take cap turned out to be.
 */
export const MAXIMUM_DURATION = 43_200;

/** The floor. Sixty seconds — deliberately *not* the studio's countable floor; see `refusal`. */
const MINIMUM_DURATION = 60;

/**
 * Why a self-reported session cannot be accepted, or `null` when it can.
 *
 * Returns the same case names Swift's `SelfReport.Refusal` uses, because the parity fixture
 * compares them as strings — a transcription free to invent its own names could agree on
 * behaviour and disagree on which branch it took, and the fixture would never know.
 *
 * @param {Date|number} startedAt
 * @param {number} duration seconds
 * @param {{start: Date, end: Date}} week the performer's **current** week, from the studio's clock
 * @param {Date|number} now
 */
export function refusal(startedAt, duration, week, now) {
  const at = startedAt instanceof Date ? startedAt.getTime() : startedAt;
  const present = now instanceof Date ? now.getTime() : now;
  const start = week.start instanceof Date ? week.start.getTime() : week.start;
  const end = week.end instanceof Date ? week.end.getTime() : week.end;

  if (at > present) return "inTheFuture";
  if (at < start || at >= end) return "notThisWeek";
  if (duration > MAXIMUM_DURATION) return "tooLong";
  if (duration < MINIMUM_DURATION) return "tooShort";
  return null;
}

/**
 * What the performer is told, on the form, at the moment they are choosing.
 *
 * Swift's sentences exactly. Each names what to do rather than what went wrong — "invalid
 * duration" tells somebody nothing.
 */
const REFUSAL_SENTENCES = Object.freeze({
  inTheFuture: "That is in the future. Log practice after you have done it.",
  notThisWeek: "You can only add practice from this week. Last week has already been counted.",
  tooLong: "That is longer than a session can be. Twelve hours is the limit.",
  tooShort: "That is too short to count. Give it at least a minute.",
});

/** The sentence for a refusal, or null when there is none. */
export function refusalSentence(kind) {
  return kind ? REFUSAL_SENTENCES[kind] ?? null : null;
}

/**
 * How an instructor sees a week containing work the app did not witness.
 *
 * Nothing at all on a clean week: a badge on every week is a badge people stop reading, which is
 * the same failure as a check that cries wolf on every run. And *how many of how many*, because
 * one of six is a phone in a locker and six of six is a conversation.
 */
export function instructorPhrase(selfReported, total) {
  if (!(selfReported > 0) || !(total > 0)) return null;
  if (selfReported === total) {
    return total === 1
      ? "Added afterwards, not timed by the app"
      : `All ${total} added afterwards, not timed by the app`;
  }
  return `${selfReported} of ${total} added afterwards, not timed by the app`;
}
