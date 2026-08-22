/**
 * The only part of the judgement this client computes, and the reason it is allowed to.
 *
 * ==========================================================================================
 * What is here, and what is deliberately not
 * ==========================================================================================
 *
 * Points, ranks, streak history, span totals and the leaderboard are **not here** and must never
 * be added. They are computed once, in Postgres, by `0004_judgement.sql`, and this client reads
 * the answer. That is not a limitation: those numbers are about *other people*, so a client cannot
 * compute them correctly offline regardless — it does not have anybody else's latest practice. A
 * cached leaderboard is already stale, so there is no offline capability being given up.
 *
 * What is here is the one thing a client genuinely cannot delegate: **"have I met this week's
 * target, right now, counting the session still sitting in my outbox."** The server has never seen
 * that session — practice is written to disk before the network is touched, because a practice
 * room is a basement — so a server-rendered ring would sit still at the exact moment somebody
 * finished practicing. That is the product failing while it is being used.
 *
 * The seam that keeps this small is that **a finished week is immutable.** The server hands over
 * the streak as of the last completed week; this decides whether *this* week is met and adds one.
 *
 * ==========================================================================================
 * Why this is allowed to be a second construction
 * ==========================================================================================
 *
 * `IPTCore` has the same rules in Swift and `0004_judgement.sql` has them in SQL. Three
 * constructions of one thing is worse than two, and this repository is blunt about what that costs
 * — so the condition is the one `ClipObjectPath` established: a duplicate is permitted when
 * something that runs proves the copies agree.
 *
 * `web/tests/judgement_test.js` runs this file over **the same fixture** that `ScoringParityTests`
 * runs `ScoreEngine` over and that `parity.sql` produced from Postgres. One scenario, three
 * engines, one set of expected numbers. A change to any one of them fails the other two.
 *
 * Nothing here may grow a rule that is not already in both of the other two.
 */

/**
 * Milliseconds of UTC offset for an IANA zone at a given instant.
 *
 * There is no direct API for this. `Intl.DateTimeFormat` can render an instant *in* a zone, so
 * this renders the same instant as if it were UTC and takes the difference. It is the standard
 * construction and it is exact, including for zones with half-hour and 45-minute offsets.
 */
const zoneFormatters = new Map();

function offsetMs(instantMs, timeZone) {
  let fmt = zoneFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    zoneFormatters.set(timeZone, fmt);
  }
  const p = {};
  for (const { type, value } of fmt.formatToParts(new Date(instantMs))) p[type] = value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUTC - Math.floor(instantMs / 1000) * 1000;
}

/** The civil (wall-clock) date in a zone, as {year, month, day, weekday} with weekday 0 = Sunday. */
export function civilDate(instant, timeZone) {
  const ms = instant instanceof Date ? instant.getTime() : instant;
  const shifted = new Date(ms + offsetMs(ms, timeZone));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/**
 * The instant at which a given civil (wall-clock) time occurs in a zone.
 *
 * Two passes, which is what makes it correct across a daylight-saving change: the offset depends
 * on the instant, and the instant is what is being solved for. Guess with UTC, correct with the
 * offset at the guess, then correct again with the offset at the corrected instant. The second
 * pass is the one that matters on the two weekends a year the first pass lands on the wrong side
 * of a transition.
 *
 * A week never begins at an ambiguous or skipped wall-clock time — US transitions happen at 02:00
 * and European ones at 01:00 UTC, and no zone in the tz database moves its clock at midnight — so
 * for the midnight case there is no third case to handle. A *reminder* can be asked for at 02:30,
 * which on one Sunday a year does not exist; `reminders.js` says what happens there and the parity
 * fixture covers it.
 *
 * **This is exported, and it is not a judgement.** The rule at the top of this file is that nothing
 * may be added here that is not already in `IPTCore` and the SQL. This computes no progress, no
 * points and no met-ness — it is the zone primitive the week arithmetic was already built on,
 * generalised from midnight to any time of day so `reminders.js` can place a fire instant without
 * building a second, subtly different copy of the two-pass construction. `WeekCalendar` reaches the
 * same thing through `Calendar.date(bySettingHour:)`.
 */
export function instantAtCivilTime(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstPass = guess - offsetMs(guess, timeZone);
  const instant = guess - offsetMs(firstPass, timeZone);

  if (offsetMs(instant, timeZone) === guess - instant) return instant;
  return firstValidInstantAfter(instant, guess - instant, timeZone);
}

/**
 * The wall-clock time asked for does not exist — it is inside the hour a spring-forward skips.
 *
 * Something has to be returned, and *which* something is not a free choice: `Calendar` snaps
 * **forward** to the moment the clock jumps to, and this file's answers are compared against
 * Swift's. Falling back instead lands 90 minutes early, which is what the two-pass construction
 * does on its own and what the parity gate caught.
 *
 * This is reachable because `dailyTime` is a picker and 2:30 AM is a legal thing to choose. It is
 * not reachable from `weekContaining`: no zone in the tz database moves its clock at midnight.
 *
 * Binary search rather than a closed form, which would have to encode which side of which rule each
 * zone uses. It converges to the **millisecond**, not to the second: stopping a second early leaves
 * the answer up to 999 ms past the transition, which is invisible in every rendering of it and is
 * still a different number from Swift's. The parity gate does not round, deliberately — a tolerance
 * here is a tolerance for the next transcription error too.
 */
function firstValidInstantAfter(before, targetOffset, timeZone) {
  let lo = before;
  let hi = before + 26 * 3_600_000;
  if (offsetMs(hi, timeZone) !== targetOffset) return before;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (offsetMs(mid, timeZone) === targetOffset) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Exported for `spans.js`, whose month boundary is a civil instant in the studio zone. */
export function instantAtCivilMidnight(year, month, day, timeZone) {
  return instantAtCivilTime(year, month, day, 0, 0, timeZone);
}

/**
 * The practice week containing an instant, as `{ start, end }` Dates.
 *
 * Half-open: start inclusive, end exclusive. The closed alternative needs an "end of week"
 * instant, and every expression of it — 23:59:59, 23:59:59.999 — drops the logs in the gap it
 * leaves.
 *
 * `weekStartsOn` is Swift `Calendar`'s numbering (1 = Sunday, 2 = Monday), because that is what
 * `studios.week_starts_on` holds. JavaScript's `getUTCDay()` is 0 = Sunday, so the target weekday
 * is `weekStartsOn - 1`.
 *
 * The arithmetic is done on the civil date and converted back once, never by subtracting hours
 * from the instant. A week is 167 or 169 hours twice a year, and stepping by a fixed 168 lands an
 * hour off local midnight from the transition onward — silently reassigning anything practiced in
 * that hour to the neighbouring week.
 */
export function weekContaining(instant, weekStartsOn, timeZone) {
  const { year, month, day, weekday } = civilDate(instant, timeZone);
  const back = (weekday - (weekStartsOn - 1) + 7) % 7;

  const startPivot = new Date(Date.UTC(year, month - 1, day - back));
  const endPivot = new Date(Date.UTC(year, month - 1, day - back + 7));

  return {
    start: new Date(instantAtCivilMidnight(
      startPivot.getUTCFullYear(), startPivot.getUTCMonth() + 1, startPivot.getUTCDate(), timeZone)),
    end: new Date(instantAtCivilMidnight(
      endPivot.getUTCFullYear(), endPivot.getUTCMonth() + 1, endPivot.getUTCDate(), timeZone)),
  };
}

/**
 * "This week", "Last week", "Next week" — or null, meaning the caller shows the date range.
 *
 * `WeekCalendar.title(for:relativeTo:)`, transcribed: *never a bare date range for the two weeks
 * a user is actually looking at.* Null rather than the range itself, because the range the screen
 * already draws is `weekPhrase`'s, and two constructions of "Aug 10 – Aug 16" would drift the day
 * either was improved. Which week counts as "last" rides `weekContaining` — the arithmetic the
 * parity gate already holds to Swift — so the words here can only drift if the sentences do, and
 * `check_labels.py` reads both clients' sentences.
 */
export function weekTitle(week, now, weekStartsOn, timeZone) {
  const current = weekContaining(now, weekStartsOn, timeZone);
  if (week.start.getTime() === current.start.getTime()) return "This week";
  const previous = weekContaining(new Date(current.start.getTime() - 1), weekStartsOn, timeZone);
  if (week.start.getTime() === previous.start.getTime()) return "Last week";
  const next = weekContaining(current.end, weekStartsOn, timeZone);
  if (week.start.getTime() === next.start.getTime()) return "Next week";
  return null;
}

/** Every practice week from the one containing `from` through the one containing `to`, oldest first. */
export function weeksBetween(from, to, weekStartsOn, timeZone) {
  const first = weekContaining(from, weekStartsOn, timeZone);
  const last = weekContaining(to, weekStartsOn, timeZone);
  if (first.start > last.start) return [];

  const weeks = [];
  let week = first;
  while (week.start <= last.start && weeks.length < 520) {
    weeks.push(week);
    week = weekContaining(new Date(week.end.getTime() + 1), weekStartsOn, timeZone);
  }
  return weeks;
}

/**
 * Whether an assignment counts for a week.
 *
 * Compared against the *week's* bounds and never against "now", which is what makes an
 * instructor's view of week 3 stable after the assignment closes in week 5.
 */
export function isActiveDuring(assignment, week) {
  if (new Date(assignment.opens_at) >= week.end) return false;
  if (assignment.closes_at && new Date(assignment.closes_at) <= week.start) return false;
  return true;
}

export function audienceIncludes(assignment, performerId) {
  if (assignment.whole_studio) return true;
  return (assignment.audience ?? []).includes(performerId);
}

/**
 * How far a performer got on one assignment in one week.
 *
 * `facts` must already be narrowed to one performer, one assignment and one week — narrowing here
 * would mean re-filtering the same array once per assignment, which is what made the instructor's
 * dashboard quadratic in Swift before it was fixed.
 *
 * Two rules are the ones that discredit every other number if they are wrong:
 *
 *   · **Round down, never up.** Counted minutes are `floor(seconds / 60)`, so 44:59 of a
 *     45-minute target is not met. Crediting a minute the performer did not practice is the one
 *     error that stops the whole board being believed.
 *
 *   · **A session under the floor counts for nothing at all** — neither sessions nor minutes.
 *     Without it a sessions target is met by tapping start and stop four times. They are still
 *     *reported*, as `discardedSessions`, because somebody who did it by accident is owed an
 *     explanation rather than a number that silently did not move.
 */
export function assignmentProgress(facts, target, rules) {
  const floorSeconds = rules.minimumCountableSession;
  let countedSessions = 0, countedSeconds = 0, discardedSessions = 0, clipCount = 0;

  for (const fact of facts) {
    if (fact.duration >= floorSeconds) {
      countedSessions += 1;
      countedSeconds += fact.duration;
      if (fact.hasClip) clipCount += 1;
    } else {
      discardedSessions += 1;
    }
  }

  const countedMinutes = Math.floor(countedSeconds / 60);
  const isMet = target.kind === "minutes"
    ? countedMinutes >= target.amount
    : countedSessions >= target.amount;

  return { target, countedSessions, countedSeconds, countedMinutes, discardedSessions, clipCount, isMet };
}

/**
 * Progress toward the target as a 0–1 fraction, clamped.
 *
 * Unclamped overshoot is available from the raw counts; a ring that runs past its track is a bug,
 * not a reward.
 */
export function progressFraction(progress) {
  const { target } = progress;
  if (target.amount <= 0) return 1;
  const raw = target.kind === "minutes"
    ? progress.countedSeconds / (target.amount * 60)
    : progress.countedSessions / target.amount;
  if (!Number.isFinite(raw)) return 0;
  return Math.min(Math.max(raw, 0), 1);
}

/**
 * Whether the week is met, over required work only.
 *
 * **Optional work is excluded from the judgement and from nothing else.** An enrichment étude
 * offered to whoever wants it must not be able to break the week — and the streak — of every
 * performer who sensibly ignored it. It still counts minutes, points and totals; it simply cannot
 * decide whether the week was finished.
 *
 * A week with no required work is *not* met and is also not failed — the server decides what that
 * does to a streak, and the answer is "nothing".
 */
export function weekMet(progressByAssignment, assignmentsById) {
  const required = Object.entries(progressByAssignment)
    .filter(([id]) => !assignmentsById[id]?.is_optional);
  if (required.length === 0) return false;
  return required.every(([, p]) => p.isMet);
}

/**
 * The streak to show while the current week is still running.
 *
 * `priorStreak` comes from the server — it is a claim about weeks that are finished and can never
 * change. This adds the week in progress if it has just been met, which is the number the ring and
 * the banner both read.
 *
 * Mirrors `PerformerWeekSummary.standingStreak(asOf:)`, whose absence meant that every Monday
 * morning a performer eight met weeks deep was told they were on no streak at all.
 */
export function standingStreak(priorStreak, thisWeekMet) {
  return thisWeekMet ? priorStreak + 1 : priorStreak;
}

/** The product defaults, equal to `ScoringRules()` and to `effective_scoring()`'s fallbacks. */
const DEFAULT_RULES = Object.freeze({
  completionPoints: 100,
  streakBonusPerWeek: 25,
  streakBonusCap: 100,
  clipBonus: 10,
  clipBonusWeeklyCap: 30,
  minutePointsPerBlock: 1,
  minutesPerBlock: 15,
  minutePointsWeeklyCap: 10,
  minimumCountableSession: 120,
  keepsScore: true,
});

/** A studio's `scoring` jsonb merged over the defaults — the client half of `effective_scoring()`. */
export function effectiveRules(scoring) {
  return { ...DEFAULT_RULES, ...(scoring ?? {}) };
}
