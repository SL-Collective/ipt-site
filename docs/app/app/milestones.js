
import { longDuration } from "./format.js";

const STREAK_MARKS = [4, 8, 12, 16, 20, 26, 30, 40, 52];

const HOUR_MARKS = [10, 25, 50, 100, 200, 500];

const MINIMUM_BEST_WEEK = 30 * 60;

function milestone(kind, value) {
  switch (kind) {
    case "streak":
      return {
        id: `streak-${value}`,
        title: `${value} weeks in a row`,
        detail: "Everything assigned, finished, week after week.",
      };
    case "best-week":
      return {
        id: "best-week",
        title: "Your best week yet",
        detail: `${longDuration(value)}, more than any week before this one.`,
      };
    case "first-clip":
      return {
        id: "first-clip",
        title: "First recording sent",
        detail: "Your instructor can hear you play now, not just see the minutes.",
      };
    case "hours":
      return {
        id: `hours-${value}`,
        title: `${value} hours practiced`,
        detail: "In this studio alone, since you joined.",
      };
  }
}

export function reachedMilestones({ weeks = [], clipCount = 0 }) {
  const latest = weeks[weeks.length - 1];
  if (!latest) return [];
  const found = [];

  if (STREAK_MARKS.includes(latest.streakLength)) {
    found.push(milestone("streak", latest.streakLength));
  }

  const earlierBest = Math.max(0, ...weeks.slice(0, -1).map((w) => w.countedSeconds));
  if (latest.countedSeconds > earlierBest
    && latest.countedSeconds >= MINIMUM_BEST_WEEK
    && weeks.length > 1) {
    found.push(milestone("best-week", latest.countedSeconds));
  }

  if (clipCount === 1) found.push(milestone("first-clip"));

  const totalHours = Math.floor(weeks.reduce((n, w) => n + w.countedSeconds, 0) / 3600);
  const mark = Math.max(...HOUR_MARKS.filter((m) => m <= totalHours), -1);
  if (mark > 0) found.push(milestone("hours", mark));

  return found;
}

const LEDGER_KEY = "ipt.milestones.seen";

export function seenMilestones() {
  try {
    return new Set(JSON.parse(localStorage.getItem(LEDGER_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export const WELCOME_KEY = "ipt.welcome.seen";

export function seenWelcomes() {
  try {
    return new Set(JSON.parse(localStorage.getItem(WELCOME_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export function markWelcomeSeen(entry) {
  const seen = seenWelcomes();
  seen.add(entry);
  try {
    localStorage.setItem(WELCOME_KEY, JSON.stringify([...seen]));
  } catch {
  }
}

export function forgetPerson(profileId) {
  if (!profileId) return;
  const kept = [...seenMilestones()].filter((entry) => !entry.startsWith(`${profileId}-`));
  const keptWelcomes = [...seenWelcomes()].filter((entry) => !entry.startsWith(`${profileId}:`));
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(kept));
    localStorage.setItem(WELCOME_KEY, JSON.stringify(keptWelcomes));
  } catch {
  }
}

export function markMilestoneSeen(profileId, milestoneId) {
  const seen = seenMilestones();
  seen.add(`${profileId}-${milestoneId}`);
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify([...seen]));
  } catch {
  }
}
