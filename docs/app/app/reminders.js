/**
 * What the app should say, and when — on the web.
 *
 * ==========================================================================================
 * This is a transcription, and it is only allowed to exist because a gate proves it
 * ==========================================================================================
 *
 * `Sources/IPTCore/ReminderPlanner.swift` is the original. Every string below is copied from it,
 * character for character, and **not one word of copy may be written here first.** The copy is a
 * product decision: "Time to practice!" is a notification people switch off in week two and
 * "35 min to go on Étude 9 — two days left" is one they act on, and a second set of words about the
 * same reminder is the bug this repository keeps finding.
 *
 * This repository's position on duplicates is not "never" — it is **"a duplicate is allowed when
 * something that runs proves the two agree."** `ClipObjectPath` is duplicated in SQL and the
 * harness builds the path both ways. `judgement.js` is duplicated in SQL and Swift and a three-way
 * gate runs all three over one exported scenario.
 *
 * So: `Tests/IPTCoreTests/ReminderParityTests.swift` exports a set of scenarios **and the plan the
 * Swift planner produced for each** into `Tests/IPTCoreTests/Fixtures/reminders/plans.json`, and
 * `web/tests/reminders_test.js` runs this file over the identical inputs and compares every id,
 * kind, title, body, fire instant and repeat rule. A sentence that exists on one side and not the
 * other fails `make webtest`. That gate is not optional and it is the only thing making this file
 * permissible.
 *
 * ==========================================================================================
 * Why a plan is made here at all, when a browser cannot schedule anything
 * ==========================================================================================
 *
 * It cannot, which is the whole problem — see `docs/notifications.md`. The device composes and a
 * server delivers verbatim, exactly the shape iOS already has: `UNUserNotificationCenter` is also a
 * dumb courier for pre-composed strings. The courier in `supabase/functions/send-reminders` reads a
 * title and a body out of a row and encrypts them. It has no assignment titles, no progress and no
 * branch that chooses between two phrasings, so there is nothing in it that *could* drift.
 *
 * ==========================================================================================
 * What is deliberately not here
 * ==========================================================================================
 *
 * `heardAnnouncement` and `submissionDigest` are **event-driven, not scheduled** — nothing on any
 * device knows in advance that an instructor will sit down and listen tonight. On iOS they ride
 * `BGAppRefreshTask` and are already "soon rather than instant", which Settings already says. On
 * the web they arrive when the client is next opened, which is the same class of answer.
 *
 * The gap this file closes is the *structural* one: a PWA cannot schedule anything locally, so
 * without it a performer on a Chromebook is told nothing between sessions ever. Porting the two
 * event-driven kinds would mean one person's device composing a notification for another person's,
 * which is a new cross-account write surface — and building one against no adoption, that nothing
 * can exercise live, is its own defect.
 */

import { isInSession } from "./terms.js";
import { civilDate, instantAtCivilTime } from "./judgement.js";
import { PATIENCE_DAYS } from "./listening.js";

/** The kinds this file plans. Mirrors `ReminderKind`, minus the two event-driven ones above. */
const KINDS = Object.freeze({
  practiceReminder: "practiceReminder",
  streakAtRisk: "streakAtRisk",
  lastChance: "lastChance",
  weeklyWrap: "weeklyWrap",
  weeklySummary: "weeklySummary",
  listeningBacklog: "listeningBacklog",
  weekOpens: "weekOpens",
});

/**
 * iOS keeps 64 pending local notifications per app and silently drops the rest.
 *
 * The web has no such limit, and the cap is kept anyway — not as a constraint but so the two
 * clients produce the *same plan* and the parity gate has something to compare. A single
 * performer's week is six to ten rows, so it never binds in practice; see `capped`.
 */
const DEVICE_LIMIT = 64;


const allows = {
  dailyWhenOnTrack: (v) => v === "everything",
  dailyWhenBehind: (v) => v === "balanced" || v === "everything",
  weeklyWrap: (v) => v === "balanced" || v === "everything",
  streakAtRisk: (v) => v !== "off",
  lastChance: (v) => v !== "off",
  weeklySummary: (v) => v !== "off",
  listeningNudge: (v) => v !== "off",
};


function countedMinutes(progress) {
  return Math.floor(progress.countedSeconds / 60);
}

export function isMet(progress) {
  return progress.target.kind === "minutes"
    ? countedMinutes(progress) >= progress.target.amount
    : progress.countedSessions >= progress.target.amount;
}

/** Progress toward the target, clamped to 1. A bar that runs past its track is a bug, not a reward. */
function fraction(progress) {
  if (progress.target.amount <= 0) return 1;
  const raw = progress.target.kind === "minutes"
    ? progress.countedSeconds / (progress.target.amount * 60)
    : progress.countedSessions / progress.target.amount;
  return Math.min(Math.max(raw, 0), 1);
}

/** "35 min to go", "2 sessions to go", "Target met". Never a bare number. */
function statusPhrase(progress) {
  if (isMet(progress)) return "Target met";
  if (progress.target.kind === "minutes") {
    return `${Math.max(progress.target.amount - countedMinutes(progress), 0)} min to go`;
  }
  const remaining = Math.max(progress.target.amount - progress.countedSessions, 0);
  return remaining === 1 ? "1 session to go" : `${remaining} sessions to go`;
}

/**
 * `DurationText.long` — "42 min", "1 hr 05 min".
 *
 * Not `format.js`'s `longDuration`, deliberately: that one is for a screen and this one is held to
 * the parity fixture. They agree today and the gate is what keeps them agreeing.
 */
function longDuration(seconds) {
  const total = Math.floor(Math.max(seconds, 0) / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours} hr ${String(minutes).padStart(2, "0")} min`;
}


/**
 * The derived reads Swift gets for free as computed properties.
 *
 * Note the asymmetry, which is the easiest rule here to get wrong: **optional work is excluded
 * from the judgement and from nothing else.** `activeAssignmentCount` and `metAssignmentCount`
 * count required work only; minutes and clips count everything.
 */
function derive(summary) {
  const entries = Object.entries(summary.progress);
  const optional = new Set(summary.optionalIds ?? []);
  const required = entries.filter(([id]) => !optional.has(id));
  return {
    entries,
    activeAssignmentCount: required.length,
    metAssignmentCount: required.filter(([, p]) => isMet(p)).length,
    totalCountedSeconds: entries.reduce((sum, [, p]) => sum + p.countedSeconds, 0),
    get hasWork() { return this.activeAssignmentCount > 0; },
    get isMet() {
      return this.activeAssignmentCount > 0 && this.metAssignmentCount === this.activeAssignmentCount;
    },
  };
}


function timeOfDayAt(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", hour: "2-digit", minute: "2-digit",
  }).formatToParts(instant);
  const p = {};
  for (const { type, value } of parts) p[type] = value;
  return { hour: +p.hour, minute: +p.minute };
}

function minutesFromMidnight(time) {
  return time.hour * 60 + time.minute;
}

/** `QuietHours.contains`. Allowed to wrap midnight, which is the normal case — 9pm to 8am. */
export function quietContains(quiet, time) {
  const t = minutesFromMidnight(time);
  const s = minutesFromMidnight(quiet.start);
  const e = minutesFromMidnight(quiet.end);
  if (s === e) return false;
  return s < e ? (t >= s && t < e) : (t >= s || t < e);
}

/**
 * `ReminderPlanner.movedOutOfQuiet`.
 *
 * A reminder inside quiet hours is moved to the moment they end rather than dropped — dropping it
 * means a performer who set 10pm silently gets nothing and concludes the feature is broken.
 *
 * **Which day the window ends on depends on which half of it the reminder is in.** A wrapping
 * window has an evening half and a morning half and only the evening half ends tomorrow. See the
 * comment on the Swift original for the bug that came from adding a day unconditionally.
 */
function movedOutOfQuiet(instant, quiet, timeZone) {
  if (!quiet) return instant;
  const time = timeOfDayAt(instant, timeZone);
  if (!quietContains(quiet, time)) return instant;

  const { year, month, day } = civilDate(instant, timeZone);
  const endsTomorrow = minutesFromMidnight(quiet.start) > minutesFromMidnight(quiet.end) &&
    minutesFromMidnight(time) >= minutesFromMidnight(quiet.start);
  const pivot = new Date(Date.UTC(year, month - 1, day + (endsTomorrow ? 1 : 0)));
  return new Date(instantAtCivilTime(
    pivot.getUTCFullYear(), pivot.getUTCMonth() + 1, pivot.getUTCDate(),
    quiet.end.hour, quiet.end.minute, timeZone,
  ));
}

/** The start of each remaining day in the week, today included. `remainingDays` in Swift. */
function remainingDays(now, week, timeZone) {
  const from = new Date(Math.max(now.getTime(), week.start.getTime()));
  const { year, month, day } = civilDate(from, timeZone);
  const days = [];
  for (let i = 0; days.length < 8; i += 1) {
    const pivot = new Date(Date.UTC(year, month - 1, day + i));
    const instant = new Date(instantAtCivilTime(
      pivot.getUTCFullYear(), pivot.getUTCMonth() + 1, pivot.getUTCDate(), 0, 0, timeZone));
    if (instant >= week.end) break;
    days.push(instant);
  }
  return days;
}

/** `Calendar.date(bySettingHour:of:)` on a day already at local midnight, then out of quiet hours. */
function fireDate(day, time, quiet, timeZone) {
  const { year, month, day: d } = civilDate(day, timeZone);
  const fire = new Date(instantAtCivilTime(year, month, d, time.hour, time.minute, timeZone));
  return movedOutOfQuiet(fire, quiet, timeZone);
}

/** The wrap-up lands an hour after the week turns over, so it describes a closed week. */
function wrapDate(week, quiet, timeZone) {
  return movedOutOfQuiet(new Date(week.end.getTime() + 3_600_000), quiet, timeZone);
}

/** `ReminderPlanner.id(_:day:)` — deliberately unpadded, so it matches Swift's `dateComponents`. */
function idFor(kind, day, timeZone) {
  const { year, month, day: d } = civilDate(day, timeZone);
  return `${kind}.${year}-${month}-${d}`;
}


function nudgeTitle(open) {
  if (open.length === 1) return open[0].title;
  return `${open.length} assignments still open`;
}

function nudgeBody(open, summary, daysLeft) {
  const days = daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;
  return `${remainingPhrase(open, summary)}, ${days} this week.`;
}

function streakTitle(streak, daysLeft) {
  return daysLeft === 1
    ? `One day to keep your ${streak}-week streak`
    : `${daysLeft} days to keep your ${streak}-week streak`;
}

function streakBody(summary, derived, daysLeft) {
  const days = daysLeft === 1 ? "Today is the last day" : `${daysLeft} days left`;
  const short = derived.entries.filter(([, p]) => !isMet(p)).length;
  const work = short === 1 ? "one assignment" : `${short} assignments`;
  return `${days}, and ${work} still to finish. One session keeps it alive.`;
}

function lastChanceBody(open, summary) {
  return `${remainingPhrase(open, summary)} before the week resets.`;
}

function wrapBody(summary, derived) {
  const met = derived.metAssignmentCount;
  const total = derived.activeAssignmentCount;
  const time = longDuration(derived.totalCountedSeconds);
  if (derived.isMet) {
    const streak = summary.streakLength ?? 0;
    const streakPart = streak >= 2 ? ` That's ${streak} weeks in a row.` : "";
    return `You hit ${met} of ${total} and practiced ${time}.${streakPart}`;
  }
  return `You hit ${met} of ${total} and practiced ${time}. A new week starts now.`;
}

/**
 * "35 min to go on Étude 9" for one, and a count for several.
 *
 * Mixed target kinds cannot be summed into one number honestly, so the plural form counts
 * assignments rather than inventing a total.
 */
function remainingPhrase(open, summary) {
  const first = open[0];
  const progress = first && summary.progress[first.id];
  if (!first || !progress) return "Still to finish";
  if (open.length === 1) return `${statusPhrase(progress)} on ${first.title}`;
  return `${open.length} assignments still short of their target`;
}


/**
 * Whether the performer is far enough along that a nudge today would be noise.
 *
 * Deliberately generous: a performer at 55% with three days left is left alone. The cost of a
 * missed nudge is one unmet week; the cost of a nudge somebody did not need is that they stop
 * reading them.
 *
 * The sum is over *every* assignment and the divisor is the *required* count — Swift's
 * `progress.values` over `activeAssignmentCount` — so a studio with optional work can read past
 * 100% done. That is the original's behaviour and it errs toward silence, which is the direction
 * this function is already deliberately biased.
 */
function isOnPace(derived, daysLeft, weekLength) {
  if (derived.activeAssignmentCount <= 0) return true;
  const done = derived.entries.reduce((sum, [, p]) => sum + fraction(p), 0) /
    derived.activeAssignmentCount;
  const elapsed = (weekLength - daysLeft) / weekLength;
  return done >= elapsed;
}


/**
 * Everything a performer's device should have scheduled for the rest of the current week.
 *
 * @param now         {Date}
 * @param week        {{start: Date, end: Date}}
 * @param summary     `{ progress: {[assignmentId]: {target:{kind,amount}, countedSessions,
 *                    countedSeconds, clipCount}}, optionalIds: [], streakLength, priorStreak }`
 * @param assignments `[{ id, title }]`, in the order the studio holds them
 * @param preferences `NotificationPreferences`
 * @param terms       `[{ startsAt, endsAt }]`. Empty means always running.
 * @param timeZone    the **studio's** zone. A week boundary belongs to the studio, not the device.
 */
export function performerPlan({ now, week, summary, assignments, preferences, terms = [], timeZone }) {
  if (preferences.volume === "off") return [];
  if (!isInSession(terms, week.start, week.end)) return [];

  const volume = preferences.volume;
  const derived = derive(summary);
  const planned = [];

  const open = assignments.filter((a) => {
    const progress = summary.progress[a.id];
    return progress ? !isMet(progress) : false;
  });
  const weekIsDone = derived.hasWork && derived.isMet;
  const days = remainingDays(now, week, timeZone);

  if (!weekIsDone && open.length > 0 &&
      (allows.dailyWhenBehind(volume) || allows.dailyWhenOnTrack(volume))) {
    days.slice(0, -1).forEach((day, index) => {
      const fire = fireDate(day, preferences.dailyTime, preferences.quietHours, timeZone);
      if (!fire || !(fire > now)) return;
      const daysLeft = days.length - index;
      if (volume === "balanced" && isOnPace(derived, daysLeft, 7)) return;
      planned.push({
        id: idFor(KINDS.practiceReminder, day, timeZone),
        kind: KINDS.practiceReminder,
        title: nudgeTitle(open),
        body: nudgeBody(open, summary, daysLeft),
        fireAt: fire,
      });
    });
  }

  const priorStreak = summary.priorStreak ?? 0;
  if (preferences.wantsStreakAlerts && allows.streakAtRisk(volume) &&
      !weekIsDone && derived.hasWork && priorStreak >= 2 && days.length <= 2 && days.length > 0) {
    const day = days[0];
    const fire = fireDate(day, preferences.dailyTime, preferences.quietHours, timeZone);
    if (fire && fire > now) {
      planned.push({
        id: idFor(KINDS.streakAtRisk, day, timeZone),
        kind: KINDS.streakAtRisk,
        title: streakTitle(priorStreak, days.length),
        body: streakBody(summary, derived, days.length),
        fireAt: fire,
      });
    }
  }

  if (preferences.wantsLastChance && allows.lastChance(volume) &&
      !weekIsDone && open.length > 0 && days.length > 0) {
    const lastDay = days[days.length - 1];
    const fire = fireDate(lastDay, preferences.dailyTime, preferences.quietHours, timeZone);
    if (fire && fire > now) {
      planned.push({
        id: idFor(KINDS.lastChance, lastDay, timeZone),
        kind: KINDS.lastChance,
        title: "Last day of the practice week",
        body: lastChanceBody(open, summary),
        fireAt: fire,
      });
    }
  }

  if (preferences.wantsWeeklyWrap && allows.weeklyWrap(volume) && derived.hasWork) {
    const fire = wrapDate(week, preferences.quietHours, timeZone);
    if (fire && fire > now) {
      planned.push({
        id: idFor(KINDS.weeklyWrap, week.end, timeZone),
        kind: KINDS.weeklyWrap,
        title: derived.isMet ? "Week complete" : "Week closed",
        body: wrapBody(summary, derived),
        fireAt: fire,
      });
    }
  }

  return planned.sort((a, b) => a.fireAt - b.fireAt);
}

/**
 * The scheduled part of an instructor's notifications: the weekly summary.
 *
 * The submission digest is not scheduled — nothing on any device knows in advance whether anyone
 * will practice.
 */
export function instructorPlan(
  { now, week, studioName, preferences, backlog = null, terms = [], timeZone },
) {
  if (!isInSession(terms, week.start, week.end)) return [];
  if (preferences.volume === "off") return [];

  const plan = [];

  if (preferences.wantsWeeklySummary && allows.weeklySummary(preferences.volume)) {
    const fire = wrapDate(week, preferences.quietHours, timeZone);
    if (fire && fire > now) {
      plan.push({
        id: idFor(KINDS.weeklySummary, week.end, timeZone),
        kind: KINDS.weeklySummary,
        title: `${studioName}: the week is closing`,
        body: "Open IPT for who met their target this week and who didn't.",
        fireAt: fire,
      });
    }
  }

  const nudge = listeningNudge({ now, studioName, preferences, backlog, timeZone });
  if (nudge) plan.push(nudge);

  return plan;
}

/**
 * The one reminder about the step this product says every rival dies at.
 *
 * `ReminderPlanner.listeningNudge`, transcribed. The reasoning is written in full on the Swift
 * side; the two properties that decide whether this transcription is right are:
 *
 *   · **Scheduled forward, not sent when it becomes true.** Noticing happens when somebody opens
 *     the app, and the instructor who never opens it again is exactly who this exists for. The
 *     fire instant is the day the oldest clip crosses `PATIENCE_DAYS`, which is knowable now.
 *   · **On multiples of the threshold**, so a backlog that stays overdue produces one reminder
 *     every three days rather than a fresh one on every load — seven a week about a fact that has
 *     not changed is how a dial gets switched off, taking the weekly summary with it.
 *
 * The age in the sentence is counted **from the fire instant**, not from the step: `fireDate`
 * moves a time inside quiet hours to the far side of the window, which for a late daily time is
 * the next morning, and a body built from the step alone then understated the wait by a day.
 */
function listeningNudge({ now, studioName, preferences, backlog, timeZone }) {
  if (!preferences.wantsListeningNudge || !allows.listeningNudge(preferences.volume)) return null;
  if (!backlog || !backlog.waiting || !backlog.oldestRecordedAt) return null;

  const oldest = new Date(backlog.oldestRecordedAt);
  for (let step = 1; step <= 30; step += 1) {
    const day = new Date(oldest.getTime() + step * PATIENCE_DAYS * 86_400_000);
    const fire = fireDate(day, preferences.dailyTime, preferences.quietHours, timeZone);
    if (!fire || !(fire > now)) continue;

    const days = daysApart(oldest, fire, timeZone);
    return {
      id: idFor(KINDS.listeningBacklog, day, timeZone),
      kind: KINDS.listeningBacklog,
      title: `${studioName}: waiting to be heard`,
      body: `The oldest recording has been waiting ${days} days. Open IPT to hear it.`,
      fireAt: fire,
    };
  }
  return null;
}

/**
 * Whole calendar days from one instant to another, in the studio's zone.
 *
 * Civil dates rather than 86,400-second blocks, exactly as `daysBetween` in `listening.js` does
 * it and for the same reason Swift uses `startOfDay`: a span crossing a daylight-saving boundary
 * is 23 or 25 hours long, and dividing by a day would drop or invent one.
 */
function daysApart(from, to, timeZone) {
  const a = civilDate(from, timeZone);
  const b = civilDate(to, timeZone);
  const at = Date.UTC(a.year, a.month - 1, a.day);
  const bt = Date.UTC(b.year, b.month - 1, b.day);
  return Math.max(0, Math.round((bt - at) / 86_400_000));
}

/**
 * The reminder that survives the app never being opened.
 *
 * Every other reminder is a one-shot about *this* week, because a reminder that says "35 min to go
 * on Étude 9" cannot honestly be written before the week it describes. The consequence is that the
 * whole plan expires and a device that is not opened is never rescheduled — so the app goes silent
 * on exactly the performer it should be reaching. That is the failure people mean when they say an
 * app "stopped notifying me", and on the web it is worse: there is no background refresh to rebuild
 * the plan behind their back.
 *
 * So one notification per studio repeats weekly, forever, on the morning the practice week turns
 * over. It carries no numbers — it cannot know them — and its job is not to inform but to bring
 * somebody back so the accurate ones can be rebuilt. The courier re-arms it after each send.
 */
export function weeklyAnchor({
  studioName, studioKey, weekStartsOn, preferences, isInstructor, nextWeek, timeZone,
}) {
  if (preferences.volume === "off") return null;

  const hour = isInstructor ? 17 : 16;
  const { year, month, day } = civilDate(nextWeek.start, timeZone);
  const fireAt = new Date(instantAtCivilTime(year, month, day, hour, 0, timeZone));

  return {
    id: `weekOpens-${studioKey}`,
    kind: KINDS.weekOpens,
    title: isInstructor ? `New week in ${studioName}` : "New practice week",
    body: isInstructor
      ? `Last week's practice is final. Open IPT to see how ${studioName} finished.`
      : `${studioName} starts a fresh week today. Open IPT to see what's due.`,
    fireAt,
    repeatsWeeklyOn: { weekday: weekStartsOn, hour },
  };
}

/**
 * Merges the plans from every studio and keeps what will fit.
 *
 * **The repeating anchors are never dropped.** They are the safety net that brings somebody back
 * into the app, so losing one to a crowded week would break exactly the case the cap exists to
 * survive. Everything else is kept soonest-first: a reminder ten days out will be rebuilt long
 * before it was due to fire, and a reminder this evening will not.
 */
export function capped(plans, limit = DEVICE_LIMIT) {
  const seen = new Set();
  const unique = plans.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));

  const anchors = unique.filter((p) => p.repeatsWeeklyOn)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rest = unique.filter((p) => !p.repeatsWeeklyOn).sort((a, b) =>
    a.fireAt - b.fireAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return anchors.concat(rest.slice(0, Math.max(limit - anchors.length, 0)));
}
