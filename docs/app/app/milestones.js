/**
 * `Milestone` and `MilestoneDetector`, transcribed — something worth stopping for, on the client
 * a district hands out.
 *
 * Everything this app rewards happens quietly, and until now the web's entire response was a
 * green ring: a performer on a Chromebook hit eight weeks running and was told nothing, on the
 * client whose whole reason to exist is the school that blocks everything else. The rules decide
 * what somebody is told about themselves and every one is wrong in a way that is embarrassing
 * rather than crashy — "Your 1-week streak!" is worse than silence — so they are held to Swift's
 * answers, words included, by `Fixtures/milestones/cases.json`.
 *
 * ## The judgement-split seam, stated where the wiring can read it
 *
 * The detector wants the latest week's streak, and a streak is history — *streak history lives
 * only in `0004`*, and a local reconstruction here would be the third construction the standing
 * decision forbids. So the caller feeds it the server's own number, gated by the one thing this
 * client may judge for itself: `isMet ? currentStreak : 0`. That reproduces the iOS semantics
 * exactly — `streakLength` is zero for a running week that is not yet met, so the streak card
 * lands in the week it is earned, at the moment it is earned, and never re-fires on a Monday for
 * last week's news. On a project without `0004` there is no number, and the honest answer is that
 * streak milestones do not fire rather than fire from a guess.
 *
 * ## The ledger
 *
 * A milestone is celebrated once, ever. Keys carry the profile id (`Milestone.id` is stable per
 * achievement), so the ledger survives sign-out without one person inheriting another's
 * celebrations — the account-inheritance bug iOS already paid for. The demo keeps its ledger in
 * memory per visit, because the showroom seeds fresh people on every entry and a persisted key
 * would be a permanent `UserDefaults` stain for looking around; `main.js` owns that Set.
 */

import { longDuration } from "./format.js";

/** Streak lengths worth stopping for — the numbers somebody would actually say out loud. */
const STREAK_MARKS = [4, 8, 12, 16, 20, 26, 30, 40, 52];

/** Hour totals worth stopping for, on the same reasoning. */
const HOUR_MARKS = [10, 25, 50, 100, 200, 500];

/** A week has to be substantial before "best ever" is a compliment. */
const MINIMUM_BEST_WEEK = 30 * 60;

/** Swift's own sentences, per kind. No exclamation marks — a seventeen-year-old can tell. */
function milestone(kind, value) {
  switch (kind) {
    case "streak":
      return {
        id: `streak-${value}`,
        title: `${value} weeks in a row`,
        detail: `You've finished everything assigned ${value} weeks running.`,
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
        detail: `${value} hours in this studio since you joined.`,
      };
  }
}

/**
 * `MilestoneDetector.reached`, over the same shape the fixture speaks: weeks oldest-first, each
 * `{ countedSeconds, streakLength }`, and the performer's clip count. Only the **latest** week's
 * streak is anybody's news — a detector scanning history re-celebrates a spring streak every
 * time the app opens.
 */
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

/** Celebrated once, ever, per person. */
export function seenMilestones() {
  try {
    return new Set(JSON.parse(localStorage.getItem(LEDGER_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

/**
 * Forgets one person's ledger, keeping everybody else's.
 *
 * `Preferences.forgetPerson()` on iOS, transcribed — and the web had no equivalent at all, so
 * deleting your account left `ipt.milestones.seen` on the device carrying your profile id and
 * every mark you had passed, for an account that no longer exists. `docs/privacy-policy.md` says
 * of this list that it goes "when you sign out or clear the app's data", and a deleted account is
 * the one case where that promise is not a convenience but the whole point.
 *
 * **Entries are removed by prefix, not by clearing the key**, because the ledger is one list
 * shared by everybody who has signed in on this browser — which is the ordinary case for the
 * device this client exists for. A school Chromebook holds several students; one of them leaving
 * must not re-celebrate the rest of them.
 *
 * iOS's own reasoning for what it does *not* forget applies here unchanged: the count-in survives,
 * because it is a fact about where this device sits when somebody practices rather than a record
 * of what a person did.
 */
export function forgetPerson(profileId) {
  if (!profileId) return;
  const kept = [...seenMilestones()].filter((entry) => !entry.startsWith(`${profileId}-`));
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(kept));
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
