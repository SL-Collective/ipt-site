
import { isInSession } from "./terms.js";
import { civilDate, instantAtCivilTime } from "./judgement.js";
import { PATIENCE_DAYS } from "./listening.js";

const KINDS = Object.freeze({
  practiceReminder: "practiceReminder",
  streakAtRisk: "streakAtRisk",
  lastChance: "lastChance",
  weeklyWrap: "weeklyWrap",
  weeklySummary: "weeklySummary",
  listeningBacklog: "listeningBacklog",
  weekOpens: "weekOpens",
});

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

function fraction(progress) {
  if (progress.target.amount <= 0) return 1;
  const raw = progress.target.kind === "minutes"
    ? progress.countedSeconds / (progress.target.amount * 60)
    : progress.countedSessions / progress.target.amount;
  return Math.min(Math.max(raw, 0), 1);
}

function statusPhrase(progress) {
  if (isMet(progress)) return "Target met";
  if (progress.target.kind === "minutes") {
    return `${Math.max(progress.target.amount - countedMinutes(progress), 0)} min to go`;
  }
  const remaining = Math.max(progress.target.amount - progress.countedSessions, 0);
  return remaining === 1 ? "1 session to go" : `${remaining} sessions to go`;
}

function longDuration(seconds) {
  const total = Math.floor(Math.max(seconds, 0) / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours} hr ${String(minutes).padStart(2, "0")} min`;
}


function derive(summary) {
  const entries = Object.entries(summary.progress);
  const optional = new Set(summary.optionalIds ?? []);
  const required = entries.filter(([id]) => !optional.has(id));
  return {
    entries,
    required,
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

export function quietContains(quiet, time) {
  const t = minutesFromMidnight(time);
  const s = minutesFromMidnight(quiet.start);
  const e = minutesFromMidnight(quiet.end);
  if (s === e) return false;
  return s < e ? (t >= s && t < e) : (t >= s || t < e);
}

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

function fireDate(day, time, quiet, timeZone) {
  const { year, month, day: d } = civilDate(day, timeZone);
  const fire = new Date(instantAtCivilTime(year, month, d, time.hour, time.minute, timeZone));
  return movedOutOfQuiet(fire, quiet, timeZone);
}

function wrapDate(week, quiet, timeZone) {
  return movedOutOfQuiet(new Date(week.end.getTime() + 3_600_000), quiet, timeZone);
}

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
  const short = derived.required.filter(([, p]) => !isMet(p)).length;
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

function remainingPhrase(open, summary) {
  const first = open[0];
  const progress = first && summary.progress[first.id];
  if (!first || !progress) return "Still to finish";
  if (open.length === 1) return `${statusPhrase(progress)} on ${first.title}`;
  return `${open.length} assignments still short of their target`;
}


function isOnPace(derived, daysLeft, weekLength) {
  if (derived.activeAssignmentCount <= 0) return true;
  const done = derived.required.reduce((sum, [, p]) => sum + fraction(p), 0) /
    derived.activeAssignmentCount;
  const elapsed = (weekLength - daysLeft) / weekLength;
  return done >= elapsed;
}


export function performerPlan({ now, week, summary, assignments, preferences, terms = [], timeZone }) {
  if (preferences.volume === "off") return [];
  if (!isInSession(terms, week.start, week.end)) return [];

  const volume = preferences.volume;
  const derived = derive(summary);
  const planned = [];

  const optionalIds = new Set(summary.optionalIds ?? []);
  const open = assignments.filter((a) => {
    if (optionalIds.has(a.id)) return false;
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

function listeningNudge({ now, studioName, preferences, backlog, timeZone }) {
  if (!preferences.wantsListeningNudge || !allows.listeningNudge(preferences.volume)) return null;
  if (!backlog || !backlog.waiting || !backlog.oldestRecordedAt) return null;

  const oldest = new Date(backlog.oldestRecordedAt);
  const elapsed = daysApart(oldest, now, timeZone);
  const firstAhead = Math.max(1, Math.floor(elapsed / PATIENCE_DAYS) + 1);
  for (let step = firstAhead; step <= firstAhead + 4; step += 1) {
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

function daysApart(from, to, timeZone) {
  const a = civilDate(from, timeZone);
  const b = civilDate(to, timeZone);
  const at = Date.UTC(a.year, a.month - 1, a.day);
  const bt = Date.UTC(b.year, b.month - 1, b.day);
  return Math.max(0, Math.round((bt - at) / 86_400_000));
}

export function weeklyAnchor({
  studioName, studioKey, weekStartsOn, preferences, role, nextWeek, timeZone,
}) {
  if (preferences.volume === "off") return null;

  const isInstructor = role === "instructor";
  const hour = isInstructor ? 17 : 16;
  const { year, month, day } = civilDate(nextWeek.start, timeZone);
  const fireAt = new Date(instantAtCivilTime(year, month, day, hour, 0, timeZone));

  return {
    id: `weekOpens-${studioKey}`,
    kind: KINDS.weekOpens,
    title: role == null || isInstructor ? `New week in ${studioName}` : "New practice week",
    body: role == null
      ? `${studioName} starts a fresh week today. Open IPT.`
      : isInstructor
      ? `Last week's practice is final. Open IPT to see how ${studioName} finished.`
      : `${studioName} starts a fresh week today. Open IPT to see what's due.`,
    fireAt,
    repeatsWeeklyOn: { weekday: weekStartsOn, hour },
  };
}

export function capped(plans, limit = DEVICE_LIMIT) {
  const seen = new Set();
  const unique = plans.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));

  const anchors = unique.filter((p) => p.repeatsWeeklyOn)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rest = unique.filter((p) => !p.repeatsWeeklyOn).sort((a, b) =>
    a.fireAt - b.fireAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return anchors.concat(rest.slice(0, Math.max(limit - anchors.length, 0)));
}
