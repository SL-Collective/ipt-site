
import { completionPhrase } from "./format.js";

export const STREAK_THRESHOLD = 2;

export const POINTS_HEADING = "How points work";

export const POINTS_FOOTNOTE =
  "Time is worth the least on purpose. Finishing the work is what counts: leaving a timer "
  + "running all week scores less than one completed assignment.";

export function scoringRuleLines(rules, recordsAudio) {
  const lines = [
    { label: "Meet an assignment's weekly target", points: rules.completionPoints, ceiling: null },
    {
      label: "Each extra week in a row you meet everything",
      points: rules.streakBonusPerWeek,
      ceiling: `up to ${rules.streakBonusCap}`,
    },
  ];
  if (recordsAudio) {
    lines.push({
      label: "Attach a clip to a session",
      points: rules.clipBonus,
      ceiling: `up to ${rules.clipBonusWeeklyCap} a week`,
    });
  }
  lines.push({
    label: `Every ${rules.minutesPerBlock} minutes practiced`,
    points: rules.minutePointsPerBlock,
    ceiling: `up to ${rules.minutePointsWeeklyCap} a week`,
  });
  return lines;
}

export function pointsPhrase(points) {
  return `+${points}`;
}

export function studioPulse(board) {
  const rows = board ?? [];
  const clipCount = rows.reduce((n, s) => n + (s.clipCount ?? 0), 0);
  const onStreak = rows.filter((s) => (s.currentStreak ?? 0) >= STREAK_THRESHOLD).length;
  return {
    practiceSeconds: rows.reduce((n, s) => n + (s.practiceSeconds ?? 0), 0),
    clipCount,
    onStreak,
    practicedLabel: "practiced together",
    clipsLabel: clipCount === 1 ? "clip recorded" : "clips recorded",
    streakLabel: onStreak === 1 ? "on a streak" : "on streaks",
  };
}

export function standingFacts(entry, recordsAudio = true) {
  if (!(entry.practiceSeconds > 0) && (entry.clipCount ?? 0) === 0) return ["No practice logged"];
  const facts = [`${completionPhrase(entry.assignmentsMet, entry.assignmentsAssigned)} of assigned work`];
  if (recordsAudio) {
    const clips = entry.clipCount ?? 0;
    facts.push(`${clips} ${clips === 1 ? "clip" : "clips"}`);
  }
  return facts;
}

export function firstName(displayName) {
  const [first] = (displayName ?? "").split(" ").filter(Boolean);
  return first ?? displayName ?? "";
}

export function gapPhrase(entry, board, completionPoints) {
  const ahead = [...(board ?? [])].reverse().find((s) => s.rank < entry.rank);
  if (!ahead) {
    return `${completionPhrase(entry.assignmentsMet, entry.assignmentsAssigned)} of what you've been assigned, all season.`;
  }
  const gap = ahead.points - entry.points;
  if (gap <= 0) return `You're level with ${ahead.displayName}.`;
  return `${gap} points behind ${firstName(ahead.displayName)}. `
    + `One completed assignment is worth ${completionPoints}.`;
}

export function tiedAtTop(board) {
  const top = board?.[0]?.rank;
  if (top === undefined) return 0;
  return board.filter((s) => s.rank === top).length;
}

export function tiedAtTopPhrase(board, podium = 3) {
  const tied = tiedAtTop(board);
  return tied > podium ? `${tied} performers are tied at the top.` : null;
}
