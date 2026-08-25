
import { civilDate, instantAtCivilMidnight, weekContaining, weeksBetween, weekTitle } from "./judgement.js";
import { seasonWindow, termsFrom } from "./terms.js";
import { weekPhrase } from "./format.js";

function monthInterval(anchor, timeZone) {
  const { year, month } = civilDate(anchor, timeZone);
  return {
    start: new Date(instantAtCivilMidnight(year, month, 1, timeZone)),
    end: new Date(instantAtCivilMidnight(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1, timeZone)),
  };
}

export function monthWeeks(anchor, now, weekStartsOn, timeZone) {
  const { start, end } = monthInterval(anchor, timeZone);
  const through = Math.min(end.getTime() - 1, now.getTime());
  if (through < start.getTime()) {
    return [weekContaining(new Date(Math.min(anchor.getTime(), now.getTime())), weekStartsOn, timeZone)];
  }
  const candidates = weeksBetween(start, new Date(through), weekStartsOn, timeZone);
  const inMonth = candidates.filter((w) => w.start >= start && w.start < end);
  return inMonth.length
    ? inMonth
    : [weekContaining(new Date(Math.min(anchor.getTime(), now.getTime())), weekStartsOn, timeZone)];
}

export function customWeeks(from, to, now, weekStartsOn, timeZone) {
  const lower = new Date(Math.min(from.getTime(), to.getTime()));
  const upper = new Date(Math.min(Math.max(from.getTime(), to.getTime()), now.getTime()));
  if (upper < lower) return [weekContaining(now, weekStartsOn, timeZone)];
  const weeks = weeksBetween(lower, upper, weekStartsOn, timeZone);
  return weeks.length ? weeks : [weekContaining(now, weekStartsOn, timeZone)];
}

export function pastTermWeeks({ startsOn, endsOn, studioCreatedAt, now, weekStartsOn, timeZone }) {
  const seasonStart = new Date(studioCreatedAt);
  const start = new Date(Math.max(new Date(startsOn).getTime(), seasonStart.getTime()));
  const end = new Date(Math.min(endsOn ? new Date(endsOn).getTime() : now.getTime(), now.getTime()));
  const weeks = weeksBetween(new Date(Math.min(start.getTime(), end.getTime())), end, weekStartsOn, timeZone);
  return weeks.length
    ? weeks
    : [weekContaining(new Date(Math.min(new Date(startsOn).getTime(), now.getTime())), weekStartsOn, timeZone)];
}

export function isThisMonth(anchor, now, timeZone) {
  const a = civilDate(anchor, timeZone);
  const b = civilDate(now, timeZone);
  return a.year === b.year && a.month === b.month;
}

export function seasonWeeks({ terms, studioCreatedAt, now, weekStartsOn, timeZone }) {
  const window = seasonWindow(termsFrom(terms ?? []), { studioCreatedAt, now });
  const from = Math.min(window.from.getTime(), window.to.getTime());
  const weeks = weeksBetween(new Date(from), window.to, weekStartsOn, timeZone);
  return {
    weeks: weeks.length ? weeks : [weekContaining(now, weekStartsOn, timeZone)],
    termName: window.term?.name ?? null,
  };
}

export function spanTitle(kind, { anchor = null, now, weeks, timeZone, weekStartsOn, termName = null }) {
  switch (kind) {
    case "week": {
      const week = weeks[0];
      return weekTitle(week, now, weekStartsOn, timeZone) ?? weekPhrase(week, timeZone);
    }
    case "month": {
      if (isThisMonth(anchor, now, timeZone)) return "This month";
      const sameYear = civilDate(anchor, timeZone).year === civilDate(now, timeZone).year;
      return new Intl.DateTimeFormat(undefined, {
        month: "long", ...(sameYear ? {} : { year: "numeric" }), timeZone,
      }).format(anchor);
    }
    case "season":
      return termName ?? "All season";
    case "custom":
      return "Custom range";
  }
}

export function spanSubtitle(weeks, timeZone) {
  if (!weeks.length) return "—";
  if (weeks.length === 1) return weekPhrase(weeks[0], timeZone);
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone });
  const lastDay = new Date(weeks[weeks.length - 1].end.getTime() - 1000);
  return `${fmt.format(weeks[0].start)} – ${fmt.format(lastDay)} · ${weeks.length} weeks`;
}

export function spanRows(weeks, rowsForWeek) {
  const byPerson = new Map();
  let members = 0;
  for (const week of weeks) {
    const { rows } = rowsForWeek(week);
    for (const row of rows) {
      const held = byPerson.get(row.person.id) ?? {
        person: row.person, weeksMet: 0, weeksWithWork: 0, seconds: 0, clips: 0,
      };
      if (row.hasWork) held.weeksWithWork += 1;
      if (row.isMet) held.weeksMet += 1;
      held.seconds += row.seconds;
      held.clips += row.clips;
      byPerson.set(row.person.id, held);
    }
  }
  members = byPerson.size;
  return { rows: [...byPerson.values()], members };
}
