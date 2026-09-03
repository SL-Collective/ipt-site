
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
  return tempo == null ? point.text : `${point.text} (♩\u00a0=\u00a0${tempo})`;
}

export function linePhrase(line) {
  return `${line.workedCount} of ${line.rosterCount}`;
}

export function focusCoverage({ points = [], marks = [], audience = [] }) {
  const roll = audience instanceof Set ? audience : new Set(audience);
  const rosterCount = roll.size;
  const byPoint = new Map();
  for (const mark of marks) {
    if (!roll.has(mark.performerId)) continue;
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
    summaryPhrase: !hasPlan
      ? null
      : hasPlan && workedCount === total
      ? "Everything on the plan worked"
      : remaining[0]
      ? (workedCount === 0 ? `Next: ${remaining[0].text}` : `${remaining.length} left · ${remaining[0].text}`)
      : `${workedCount} of ${total} worked on`,
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



export function groupBySection(performers) {
  const buckets = new Map();
  const unassigned = [];

  for (const performer of performers) {
    const raw = (performer.instrument ?? "").trim();
    if (!raw) {
      unassigned.push(performer);
      continue;
    }
    const key = raw.toLowerCase();
    if (!buckets.has(key)) buckets.set(key, { name: raw, members: [] });
    buckets.get(key).members.push(performer);
  }

  const byName = (a, b) => {
    const x = a.display_name.toLowerCase();
    const y = b.display_name.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  };

  const sections = [...buckets.values()]
    .map((bucket) => ({ name: bucket.name, members: bucket.members.slice().sort(byName) }))
    .sort((a, b) => {
      const x = a.name.toLowerCase();
      const y = b.name.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });

  if (unassigned.length > 0) {
    sections.push({ name: "No section set", members: unassigned.slice().sort(byName) });
  }
  return sections;
}
