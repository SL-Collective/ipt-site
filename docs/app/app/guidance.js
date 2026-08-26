
import { longDuration } from "./format.js";
import { isInSession } from "./terms.js";

export const MINIMUM_OBSERVATIONS = 6;

const COUNTABLE_FLOOR_SECONDS = 120;

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

export function guidancePhrase(guidance) {
  if (!guidance) return "";
  const period = guidance.weeksObserved === 1
    ? "the last week"
    : `the last ${guidance.weeksObserved} weeks`;
  const median = `Over ${period}, performers here practiced a median of `
    + `${longDuration(guidance.medianMinutes * 60)} a week across everything they were assigned.`;
  if (!(guidance.upperMinutes > guidance.medianMinutes)) return median;
  return `${median} The busiest quarter did ${longDuration(guidance.upperMinutes * 60)} or more.`;
}

export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

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
