
import { audienceIncludes, isActiveDuring } from "./judgement.js";

export const MINIMUM_ROSTER_FOR_HEADLINE = 3;

export const TEMPO_RANGE = Object.freeze({ min: 20, max: 300 });

export function cleanTempo(raw) {
  const tempo = Number(raw);
  return Number.isInteger(tempo) && tempo >= TEMPO_RANGE.min && tempo <= TEMPO_RANGE.max
    ? tempo
    : null;
}

export function focusPointPhrase(point) {
  const tempo = cleanTempo(point?.tempo);
  return tempo == null ? point.text : `${point.text} (♩ = ${tempo})`;
}

export function linePhrase(line) {
  return `${line.workedCount} of ${line.rosterCount}`;
}

export function focusCoverage({ points = [], marks = [], rosterCount = 0 }) {
  const byPoint = new Map();
  for (const mark of marks) {
    const who = byPoint.get(mark.focusPointId) ?? new Set();
    who.add(mark.performerId);
    byPoint.set(mark.focusPointId, who);
  }

  const lines = points
    .slice()
    .map((point) => {
      const workedCount = byPoint.get(point.id)?.size ?? 0;
      return {
        point,
        workedCount,
        rosterCount,
        isUntouched: workedCount === 0,
        fraction: rosterCount > 0 ? workedCount / rosterCount : 0,
      };
    })
    .sort((a, b) =>
      a.workedCount !== b.workedCount
        ? a.workedCount - b.workedCount
        : a.point.position - b.point.position
    );

  const hasPlan = lines.length > 0;
  const untouched = lines.filter((l) => l.isUntouched);

  const isFullyCovered = hasPlan && rosterCount > 0 &&
    lines.every((l) => l.workedCount === rosterCount);

  return {
    lines,
    rosterCount,
    hasPlan,
    untouched,
    isFullyCovered,
    headline: headlineFor(lines, rosterCount, untouched, hasPlan),
  };
}

function headlineFor(lines, rosterCount, untouched, hasPlan) {
  if (!hasPlan || rosterCount < MINIMUM_ROSTER_FOR_HEADLINE) return null;

  if (untouched.length === lines.length) return "Nobody has started this plan yet.";
  if (untouched.length > 0) {
    const first = untouched[0];
    return untouched.length === 1
      ? `Nobody has worked on “${first.point.text}” yet.`
      : `${untouched.length} of these have gone untouched.`;
  }

  const weakest = lines[0];
  if (!weakest) return null;
  if (weakest.workedCount === rosterCount) return "The whole studio has worked through this plan.";
  return `“${weakest.point.text}”: ${linePhrase(weakest)} so far.`;
}

export function focusProgress({ points = [], worked = [] }) {
  const ids = new Set(points.map((p) => p.id));
  const ticked = new Set([...worked].filter((id) => ids.has(id)));
  const ordered = points.slice().sort((a, b) => a.position - b.position);

  const total = ordered.length;
  const workedCount = ticked.size;
  const hasPlan = total > 0;
  const remaining = ordered.filter((p) => !ticked.has(p.id));

  return {
    points: ordered,
    worked: ticked,
    total,
    workedCount,
    hasPlan,
    isComplete: hasPlan && workedCount === total,
    isWorked: (id) => ticked.has(id),
    remaining,
    nextUp: remaining[0] ?? null,
    fraction: total > 0 ? workedCount / total : 0,
    phrase: hasPlan ? `${workedCount} of ${total} worked on` : null,
  };
}

export function marksByAssignment(marks, weekStarts = null) {
  const byAssignment = new Map();
  for (const mark of marks) {
    if (weekStarts && !weekStarts.has(new Date(mark.weekStart).getTime())) continue;
    const its = byAssignment.get(mark.assignmentId) ?? [];
    its.push(mark);
    byAssignment.set(mark.assignmentId, its);
  }
  return byAssignment;
}

export function memberSinceDates({ joined = {}, facts = [] }) {
  const first = new Map();
  for (const fact of facts) {
    if (joined[fact.performerId] == null) continue;
    const at = new Date(fact.startedAt);
    const current = first.get(fact.performerId);
    if (current === undefined || at < current) first.set(fact.performerId, at);
  }
  const result = new Map();
  for (const [id, declared] of Object.entries(joined)) {
    if (declared == null) continue;
    const joinedAt = new Date(declared);
    const practiced = first.get(id);
    result.set(id, practiced !== undefined && practiced < joinedAt ? practiced : joinedAt);
  }
  return result;
}

export function assignmentAudience({ assignment, performers, weeks, memberSince }) {
  if (weeks.length === 0) return [];
  return performers.filter((p) => {
    if (!audienceIncludes(assignment, p.id)) return false;
    const since = memberSince?.get(p.id);
    if (since == null) return true;
    return weeks.some((week) => since < week.end);
  });
}

export function uncoveredInstructions({ assignments = [], weeks = [], marks = [], performers = [], memberSince = new Map() }) {
  const starts = new Set(weeks.map((w) => w.start.getTime()));
  const byAssignment = marksByAssignment(marks, starts);
  const out = [];

  for (const assignment of assignments) {
    const points = assignment.focus_points ?? [];
    if (points.length === 0) continue;
    if (!weeks.some((week) => isActiveDuring(assignment, week))) continue;

    const activeWeeks = weeks.filter((week) => isActiveDuring(assignment, week));
    const audience = assignmentAudience({ assignment, performers, weeks: activeWeeks, memberSince });
    if (audience.length === 0) continue;
    const its = byAssignment.get(assignment.id) ?? [];
    const coverage = focusCoverage({ points, marks: its, rosterCount: audience.length });
    for (const line of coverage.untouched) out.push(`${assignment.title}: ${line.point.text}`);
  }

  return out;
}
