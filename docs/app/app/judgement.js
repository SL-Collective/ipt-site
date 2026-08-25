
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

export function instantAtCivilTime(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstPass = guess - offsetMs(guess, timeZone);
  const instant = guess - offsetMs(firstPass, timeZone);

  if (offsetMs(instant, timeZone) === guess - instant) return instant;
  return firstValidInstantAfter(instant, guess - instant, timeZone);
}

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

export function instantAtCivilMidnight(year, month, day, timeZone) {
  return instantAtCivilTime(year, month, day, 0, 0, timeZone);
}

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

export function weekTitle(week, now, weekStartsOn, timeZone) {
  const current = weekContaining(now, weekStartsOn, timeZone);
  if (week.start.getTime() === current.start.getTime()) return "This week";
  const previous = weekContaining(new Date(current.start.getTime() - 1), weekStartsOn, timeZone);
  if (week.start.getTime() === previous.start.getTime()) return "Last week";
  const next = weekContaining(current.end, weekStartsOn, timeZone);
  if (week.start.getTime() === next.start.getTime()) return "Next week";
  return null;
}

export function workHeading(week, now, weekStartsOn, timeZone) {
  const current = weekContaining(now, weekStartsOn, timeZone);
  if (week.start.getTime() === current.start.getTime()) return "This week's work";
  const previous = weekContaining(new Date(current.start.getTime() - 1), weekStartsOn, timeZone);
  if (week.start.getTime() === previous.start.getTime()) return "Last week's work";
  const next = weekContaining(current.end, weekStartsOn, timeZone);
  if (week.start.getTime() === next.start.getTime()) return "Next week's work";
  return "That week's work";
}

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

export function isActiveDuring(assignment, week) {
  if (new Date(assignment.opens_at) >= week.end) return false;
  if (assignment.closes_at && new Date(assignment.closes_at) <= week.start) return false;
  return true;
}

export function audienceIncludes(assignment, performerId) {
  if (assignment.whole_studio) return true;
  return (assignment.audience ?? []).includes(performerId);
}

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

export function progressFraction(progress) {
  const { target } = progress;
  if (target.amount <= 0) return 1;
  const raw = target.kind === "minutes"
    ? progress.countedSeconds / (target.amount * 60)
    : progress.countedSessions / target.amount;
  if (!Number.isFinite(raw)) return 0;
  return Math.min(Math.max(raw, 0), 1);
}

export function weekMet(progressByAssignment, assignmentsById) {
  const required = Object.entries(progressByAssignment)
    .filter(([id]) => !assignmentsById[id]?.is_optional);
  if (required.length === 0) return false;
  return required.every(([, p]) => p.isMet);
}

export function standingStreak(priorStreak, thisWeekMet) {
  return thisWeekMet ? priorStreak + 1 : priorStreak;
}

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

export function effectiveRules(scoring) {
  return { ...DEFAULT_RULES, ...(scoring ?? {}) };
}
