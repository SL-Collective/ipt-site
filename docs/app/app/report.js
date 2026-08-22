/**
 * The season artefact — `IPTCore.StudioReport`, transcribed.
 *
 * The thing an instructor forwards to a booster club, a principal or a parent, and the thing a
 * performer keeps when the season stops. Plain text on purpose: it pastes into an email, a message,
 * a shared document and a printed sheet without any of them needing to understand a format.
 *
 * ## Why a second copy exists at all
 *
 * iOS has had both halves behind `ShareLink` since v22. The web had neither, which matters more than
 * it sounds — the web client exists because districts hand out Chromebooks, and printing is
 * something people do from a laptop.
 *
 * `ReportParityTests` exports the inputs **and Swift's own answers** to
 * `Tests/IPTCoreTests/Fixtures/report/cases.json`, and `web/tests/report_test.js` compares the
 * finished text character for character. That is the only thing that makes this permissible: *a
 * duplicate is allowed when something that runs proves the copies agree.* And the failure being
 * defended against is not a crash — it is a booster club and a parent reading two different accounts
 * of the same season, each of which looks entirely correct.
 *
 * ## Three of these numbers cannot be computed here
 *
 * `weeksMet`, `weeksWithWork` and `bestStreak` are span totals about **other people**, and the
 * judgement split puts those in `0004_judgement.sql` alone. `0009` projects them out of
 * `studio_leaderboard`, which already had them one CTE away. Against a project without `0009` they
 * arrive as null, and every line that needs one is **omitted** rather than printed as a zero — "0 of
 * 0 weeks" and "Best run: 0 weeks in a row" are both sentences somebody would believe.
 *
 * @module
 */

import { longDuration } from "./format.js";

/** `PerformerSpanSummary.weeksPhrase`. */
function weeksPhrase(summary) {
  if (!(summary.weeksWithWork > 0)) return "nothing assigned";
  return `${summary.weeksMet} of ${summary.weeksWithWork} ${summary.weeksWithWork === 1 ? "week" : "weeks"}`;
}

/** `PerformerSpanSummary.hasWork`. */
function hasWork(summary) {
  return (summary?.weeksWithWork ?? 0) > 0;
}

/** Whether the span totals `0009` supplies are actually present. */
function knowsWeeks(summary) {
  return summary != null
    && summary.weeksMet !== null && summary.weeksMet !== undefined
    && summary.weeksWithWork !== null && summary.weeksWithWork !== undefined;
}

/**
 * `StudioSection.group` — the roster in sections, by instrument.
 *
 * "Snare" and "snare" are one section and **the first spelling seen names it**, because
 * second-guessing an instructor's capitalisation is not this function's job. Anybody with no
 * instrument falls into a trailing "No section set" rather than disappearing.
 */
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

/**
 * `StudioReport.instructorSummary`.
 *
 * @param summaries a Map or plain object keyed by performer id.
 * @param uncovered instructions nobody in the studio has worked on, worst first. It is the only
 *   line in the report that tells the reader what to *do*: a head of department reading "3 of 4
 *   weeks" learns how hard somebody worked, and "nobody has touched the roll release" tells them
 *   what next week's rehearsal is for.
 */
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

/** `StudioReport.performerSummary`. Shorter, and written to be shown to somebody proud of them. */
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

/**
 * A standings row as the report reads a span summary, or **null when the server has not told us**.
 *
 * The three span numbers arrive only from a project carrying `0009`. Returning null rather than a
 * zeroed object is what makes the omission happen at the top of the report instead of halfway
 * through a sentence: a caller with nulls in hand can decide not to offer the artefact at all,
 * which is honest, where "0 of 0 weeks finished in full" is a claim.
 */
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
