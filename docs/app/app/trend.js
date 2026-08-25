
import { assignmentProgress, audienceIncludes, isActiveDuring, progressFraction, weekMet } from "./judgement.js";
import { memberSinceDates } from "./coverage.js";
import { longDuration } from "./format.js";

export function currentWeek(store) {
  const weeks = store.weeks();
  return weeks[weeks.length - 1];
}

export function weekProgress(store, performerId, week = currentWeek(store), facts = store.facts()) {
  const byId = {};
  const progress = {};

  for (const assignment of store.assignments()) {
    if (!audienceIncludes(assignment, performerId)) continue;
    if (!isActiveDuring(assignment, week)) continue;
    byId[assignment.id] = assignment;
    const mine = facts.filter((f) =>
      f.performerId === performerId &&
      f.assignmentId === assignment.id &&
      f.startedAt >= week.start && f.startedAt < week.end
    );
    progress[assignment.id] = assignmentProgress(mine, assignment.target, store.rules());
  }
  return { week, progress, byId };
}

export function studioWeekRows(store, week = currentWeek(store)) {
  const all = store.performers();
  const memberSince = memberSinceDates({
    joined: Object.fromEntries(store.roster().map((m) => [m.id, m.joined_at ?? null])),
    facts: store.facts(),
  });
  const members = all.filter((p) => {
    const since = memberSince.get(p.id);
    return since == null || since < week.end;
  });

  const byPerformer = new Map();
  for (const fact of store.facts()) {
    const held = byPerformer.get(fact.performerId);
    if (held) held.push(fact);
    else byPerformer.set(fact.performerId, [fact]);
  }
  const rows = members.map((person) => ({
    person,
    ...judgedWeek(weekProgress(store, person.id, week, byPerformer.get(person.id) ?? [])),
  }));

  return { rows, joinedLater: all.length - members.length };
}

function judgedWeek({ progress, byId }) {
  const required = Object.entries(progress).filter(([id]) => !byId[id].is_optional);
  const values = Object.values(progress);
  return {
    met: required.filter(([, p]) => p.isMet).length,
    assigned: required.length,
    hasWork: required.length > 0,
    isMet: weekMet(progress, byId),
    seconds: values.reduce((n, p) => n + p.countedSeconds, 0),
    clips: values.reduce((n, p) => n + p.clipCount, 0),
    fraction: values.length
      ? values.reduce((n, p) => n + progressFraction(p), 0) / values.length
      : 0,
  };
}

export function performerWeekRows(store, performerId, weeks) {
  const mine = store.facts().filter((f) => f.performerId === performerId);
  return weeks.map((week) => ({
    week,
    ...judgedWeek(weekProgress(store, performerId, week, mine)),
  }));
}

const NOISE_FLOOR = 0.10;

export function weekTrend({ now, before, periodName }) {
  const seconds = (rows) => rows.reduce((n, r) => n + r.seconds, 0);
  const clips = (rows) => rows.reduce((n, r) => n + r.clips, 0);
  const rate = (rows) => {
    const withWork = rows.filter((r) => r.hasWork);
    if (!withWork.length) return null;
    return withWork.filter((r) => r.isMet).length / withWork.length;
  };

  const practicedNow = seconds(now);
  const practicedBefore = seconds(before);
  if (!(practicedBefore > 0)) return null;

  const change = (practicedNow - practicedBefore) / practicedBefore;
  const direction = change > NOISE_FLOOR ? "up" : change < -NOISE_FLOOR ? "down" : "level";

  const difference = Math.floor(Math.abs(practicedNow - practicedBefore) / 60) * 60;

  const headline = direction === "level"
    ? `About the same as ${periodName}.`
    : direction === "up"
    ? `${longDuration(difference)} more practice than ${periodName}.`
    : `${longDuration(difference)} less practice than ${periodName}.`;

  const parts = [];
  const rateNow = rate(now);
  const rateBefore = rate(before);
  if (rateNow != null && rateBefore != null && Math.abs(rateNow - rateBefore) > NOISE_FLOOR) {
    const verb = rateNow > rateBefore ? "up" : "down";
    const percent = (v) => `${Math.floor(v * 100)}%`;
    parts.push(`Weeks finished in full are ${verb}, ${percent(rateBefore)} to ${percent(rateNow)}.`);
  }
  if (clips(before) > 0 || clips(now) > 0) {
    const moved = clips(now) - clips(before);
    if (Math.abs(moved) >= 3) {
      parts.push(moved > 0 ? `${moved} more recordings came in.` : `${Math.abs(moved)} fewer recordings came in.`);
    }
  }

  return { direction, headline, detail: parts.length ? parts.join(" ") : null };
}
