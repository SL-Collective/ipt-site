
import { longDuration } from "./format.js";
import {
  assignmentAudience,
  focusCoverage,
  groupBySection,
  marksByAssignment,
} from "./coverage.js";
import { isActiveDuring } from "./judgement.js";

function weeksPhrase(summary) {
  if (!(summary.weeksWithWork > 0)) return "nothing assigned";
  return `${summary.weeksMet} of ${summary.weeksWithWork} ${summary.weeksWithWork === 1 ? "week" : "weeks"}`;
}

function hasWork(summary) {
  return (summary?.weeksWithWork ?? 0) > 0;
}

function knowsWeeks(summary) {
  return summary != null
    && summary.weeksMet !== null && summary.weeksMet !== undefined
    && summary.weeksWithWork !== null && summary.weeksWithWork !== undefined;
}


export function instructorSummary({
  studioName,
  range,
  performers,
  summaries,
  uncovered = [],
  trendHeadline = null,
  bySection = true,
}) {
  const summaryFor = (performer) =>
    summaries instanceof Map ? summaries.get(performer.id) : summaries?.[performer.id];

  const lines = [studioName, range, ""];

  const withWork = performers.filter((p) => hasWork(summaryFor(p)));
  const met = withWork.filter((p) => {
    const s = summaryFor(p);
    return s && s.weeksWithWork > 0 && s.weeksMet === s.weeksWithWork;
  });
  const seconds = performers.reduce((sum, p) => sum + (summaryFor(p)?.totalCountedSeconds ?? 0), 0);
  const clips = performers.reduce((sum, p) => sum + (summaryFor(p)?.clipCount ?? 0), 0);

  if (withWork.length === 0) {
    lines.push("Nothing was assigned in this range.");
    return lines.join("\n");
  }

  lines.push(`${met.length} of ${withWork.length} finished everything assigned`);
  lines.push(`${longDuration(seconds)} practiced · ${clips} ${clips === 1 ? "clip" : "clips"} recorded`);
  if (trendHeadline) lines.push(trendHeadline);
  lines.push("");

  const describe = (performer) => {
    const summary = summaryFor(performer);
    if (!hasWork(summary)) return `  ${performer.display_name}: nothing assigned`;
    const parts = [];
    parts.push(weeksPhrase(summary));
    parts.push(longDuration(summary.totalCountedSeconds));
    if (summary.clipCount > 0) {
      parts.push(`${summary.clipCount} ${summary.clipCount === 1 ? "clip" : "clips"}`);
    }
    if (summary.currentStreak >= 2) parts.push(`${summary.currentStreak}-week streak`);
    const name = performer.instrument
      ? `${performer.display_name} (${performer.instrument})`
      : performer.display_name;
    return `  ${name}: ${parts.join(", ")}`;
  };

  if (bySection) {
    for (const section of groupBySection(performers)) {
      const sectionWithWork = section.members.filter((p) => hasWork(summaryFor(p)));
      if (sectionWithWork.length === 0) continue;
      const sectionMet = sectionWithWork.filter((p) => {
        const s = summaryFor(p);
        return s.weeksMet === s.weeksWithWork;
      }).length;
      lines.push(`${section.name}: ${sectionMet} of ${sectionWithWork.length}`);
      for (const performer of section.members) lines.push(describe(performer));
      lines.push("");
    }
  } else {
    const rate = (p) => {
      const s = summaryFor(p);
      if (!s || !(s.assignmentsAssigned > 0)) return 1;
      return s.assignmentsMet / s.assignmentsAssigned;
    };
    const ordered = performers.slice().sort((a, b) => {
      const ra = rate(a);
      const rb = rate(b);
      if (ra !== rb) return ra - rb;
      const x = a.display_name.toLowerCase();
      const y = b.display_name.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
    for (const performer of ordered) lines.push(describe(performer));
    lines.push("");
  }

  if (uncovered.length > 0) {
    lines.push("Not yet worked on by anybody:");
    for (const instruction of uncovered.slice(0, 3)) lines.push(`  · ${instruction}`);
    if (uncovered.length > 3) lines.push(`  · and ${uncovered.length - 3} more`);
    lines.push("");
  }

  lines.push("Recorded with IPT: Individual Practice Time");
  return lines.join("\n");
}

export function performerSummary({ name, studioName, range, summary }) {
  const lines = [`${name}, ${studioName}`, range, ""];

  if (!hasWork(summary)) {
    lines.push("Nothing was assigned in this range.");
    return lines.join("\n");
  }

  lines.push(`${weeksPhrase(summary)} finished in full`);
  lines.push(`${longDuration(summary.totalCountedSeconds)} practiced`);
  if (summary.clipCount > 0) {
    lines.push(
      `${summary.clipCount} ${summary.clipCount === 1 ? "recording" : "recordings"} sent to my instructor`,
    );
  }
  if (summary.bestStreak >= 2) lines.push(`Best run: ${summary.bestStreak} weeks in a row`);
  lines.push("");
  lines.push("Recorded with IPT: Individual Practice Time");
  return lines.join("\n");
}

export function spanFrom(standing) {
  if (!knowsWeeks(standing)) return null;
  return {
    weeksMet: standing.weeksMet,
    weeksWithWork: standing.weeksWithWork,
    bestStreak: standing.bestStreak ?? 0,
    currentStreak: standing.currentStreak ?? 0,
    clipCount: standing.clipCount ?? 0,
    totalCountedSeconds: standing.practiceSeconds ?? 0,
    assignmentsMet: standing.assignmentsMet ?? 0,
    assignmentsAssigned: standing.assignmentsAssigned ?? 0,
  };
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
