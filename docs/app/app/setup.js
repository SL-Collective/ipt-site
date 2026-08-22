/**
 * The two things that have to happen before a new studio is a studio — `IPTCore.StudioSetup`.
 *
 * ## Why the web needed this
 *
 * `CLAUDE.md` records the lesson and iOS acted on it:
 *
 * > **Empty states act; they do not describe.** The first screen a new instructor saw said "share
 * > your join code" and gave no way to see the join code, and no mention of the other half. Chrome
 * > that cannot succeed is what makes a new app feel broken rather than new.
 *
 * `StudioSetup` is that fix, and it has been on the instructor's dashboard since v16. **The web
 * client still had the screen it describes** — a dashboard with a week picker over a studio that
 * has no weeks, a roster reading "no performers yet", and nothing anywhere saying what to do next.
 * That is the first screen a director sees on the Chromebook this client exists for, and the one a
 * whole evaluation turns on.
 *
 * ## The order is the content
 *
 * **Assign first, then invite.** An instructor who invites thirty teenagers to an app with nothing
 * in it has spent their one moment of attention on a blank screen, and the second invitation is
 * much harder to send than the first.
 *
 * ## And it leaves
 *
 * `isComplete` is the whole card's condition, because *a checklist that keeps reappearing after it
 * is finished is the most irritating thing an app can do.* It never comes back: both conditions are
 * about things a studio has, not things somebody did, so a studio that has ever had an assignment
 * and a performer is past this forever.
 *
 * Every word is Swift's and `web/tests/setup_test.js` holds them to it — these are product
 * sentences, and the copy that drifted would be the copy attached to somebody's first five minutes.
 *
 * @module
 */

/**
 * @param assignments how many assignments exist in this studio, of any age.
 * @param performers how many people have joined, **not counting instructors** — an instructor
 *   looking at their own studio is not somebody they invited.
 */
export function setupSteps(assignments, performers) {
  return [
    {
      kind: "assign",
      title: "Assign something to practice",
      detail: "A piece and a weekly target. Everything else in IPT hangs off this. Without one " +
        "there is nothing for anybody to do.",
      isDone: assignments > 0,
    },
    {
      kind: "invite",
      title: "Invite your performers",
      detail: "Read the join code out in rehearsal. They type it once and they're in.",
      isDone: performers > 0,
    },
  ];
}

/** True once there is nothing useful left to say, at which point the card disappears for good. */
export function isSetUp(assignments, performers) {
  return setupSteps(assignments, performers).every((step) => step.isDone);
}

/** The next thing to do, or null when finished. Drives the one highlighted button. */
export function nextStep(assignments, performers) {
  return setupSteps(assignments, performers).find((step) => !step.isDone) ?? null;
}

/** The heading. Named for the studio so it reads as this instructor's room, not a tutorial. */
export function setupTitle(studioName, assignments, performers) {
  return isSetUp(assignments, performers) ? studioName : `Set up ${studioName}`;
}
