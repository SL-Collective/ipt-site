
import { isInSession } from "./terms.js";

export const MINIMUM_WEEKS = 2;

export function lengthPhrase(stretch) {
  return stretch.weeks === 1 ? "1 week" : `${stretch.weeks} weeks`;
}

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

export function mostRecentQuiet(weeks, facts, terms, now) {
  return quietStretches(weeks, facts, terms, now)[0] ?? null;
}

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
