/**
 * The seeded studio, in the browser, with the writing switched off.
 *
 * ==========================================================================================
 * One studio, two clients
 * ==========================================================================================
 *
 * The data here is **not** written in JavaScript. `demo-studio.json` is produced by
 * `DemoStudioExportTests` from the same `MockStore.seeded` the iPhone runs, so there is one
 * seeder in one language and this file only lays its output onto today's calendar. Adding a
 * performer or an assignment to the demo means editing the Swift seed and re-running `make test`;
 * editing this file to add one would be the second construction the export exists to prevent.
 *
 * ==========================================================================================
 * Why the times are rebuilt rather than read
 * ==========================================================================================
 *
 * The seed is built backwards from the instant it runs. A fixture full of absolute dates would be
 * a studio permanently stuck in February — an empty current week, every streak reading zero — and
 * that is what a director evaluating in October would open.
 *
 * So each session carries an offset and this places it:
 *
 *   · **finished weeks** — `weekStart + offsetSeconds`. Whole weeks, entirely in the past whenever
 *     the file is read.
 *   · **the current week** — `now - offsetSeconds`, because that week is partly unlived. Counting
 *     back from the reader's own clock is what keeps "practiced this morning" reading as this
 *     morning on a Tuesday and on a Saturday alike.
 *
 * The week grid itself comes from `judgement.js`, which is the parity-gated construction — so the
 * demo cannot disagree with the app about where a week begins even at a daylight-saving change.
 *
 * ==========================================================================================
 * Read-only, and where that is enforced
 * ==========================================================================================
 *
 * Every write throws `DemoBlocked`, carrying which feature was reached for. That mirrors
 * `DemoStore` in Swift exactly, including the reasoning: the screens ask first so the prompt lands
 * at the moment of intent, and this is what makes a forgotten call site harmless rather than a
 * hole. Nothing here touches the network, so the demo needs no Supabase project, no account, and
 * no row in `purchases` — which is precisely why it can be free and unlimited.
 */

import { effectiveRules, weeksBetween } from "./judgement.js";
import { demoClipURL } from "./demo-clip.js";
import { DemoBlocked, fixture } from "./words.js";

export { DemoBlocked } from "./words.js";

const refuse = (action) => { throw new DemoBlocked(action); };

/**
 * Builds the demo studio as of `now`.
 *
 * `timeZone` defaults to the browser's, which is right here and *only* here: a real studio's week
 * boundary comes from `studios.time_zone` and must never come from the device — that was a live
 * bug, and `judgement.js` takes the zone as an argument precisely so it cannot be read ambiently.
 * The demo has no server to have declared one, so the reader's own clock is the honest choice, and
 * it is passed explicitly rather than defaulted inside the week arithmetic.
 */
export async function buildDemoStudio({
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
} = {}) {
  const data = await fixture();
  const { weekStartsOn } = data;

  const spanStart = new Date(now.getTime() - (data.weekCount - 1) * 7 * 86_400_000);
  const weeks = weeksBetween(spanStart, now, weekStartsOn, timeZone).slice(-data.weekCount);
  const lastWeek = weeks.length - 1;

  const instantFor = (session) => {
    const week = weeks[Math.min(session.week, lastWeek)];
    if (!week) return null;
    if (session.week >= lastWeek) {
      const at = now.getTime() - session.offsetSeconds * 1000;
      return new Date(Math.max(at, week.start.getTime()));
    }
    return new Date(week.start.getTime() + session.offsetSeconds * 1000);
  };

  const studioCreatedAt = weeks[0].start;

  const assignments = data.assignments.map((a) => ({
    id: a.id,
    title: a.title,
    section: a.section ?? null,
    target: { kind: a.targetKind, amount: a.targetAmount },
    is_optional: a.isOptional,
    take_minutes: a.takeMinutes ?? null,
    focus_points: a.focusPoints.map((text, position) => ({ id: `${a.id}-fp-${position}`, text, position })),
    opens_at: weeks[Math.min(a.opensInWeek, lastWeek)].start.toISOString(),
    closes_at: null,
    whole_studio: a.audience == null,
    audience: a.audience ?? [],
    created_by: "instructor-0",
  }));

  const sessions = data.sessions
    .map((s, index) => {
      const startedAt = instantFor(s);
      return startedAt && {
        id: `session-${index}`,
        performerId: s.performerID,
        assignmentId: s.assignmentID,
        startedAt,
        recordedAt: startedAt,
        duration: s.duration,
        hasClip: s.clipSeconds != null,
        clip: s.clipSeconds == null
          ? null
          : { path: `seed-session-${index}`, seconds: s.clipSeconds, markers: s.clipMarkers },
        note: s.note ?? null,
        wasHeard: s.wasHeard,
        heardAt: s.heardOffsetSeconds == null
          ? null
          : new Date(now.getTime() - s.heardOffsetSeconds * 1000),
        instructorNote: s.instructorNote ?? null,
        selfReported: s.selfReported ?? false,
      };
    })
    .filter(Boolean)
    .filter((s) => s.startedAt <= now)
    .sort((a, b) => b.startedAt - a.startedAt);

  return {
    isDemo: true,
    studio: {
      id: "demo-studio",
      name: data.studioName,
      join_code: data.joinCode ?? null,
      week_starts_on: weekStartsOn,
      time_zone: timeZone,
      created_at: studioCreatedAt.toISOString(),
      scoring: data.scoring ?? null,
    },
    rules: effectiveRules(data.scoring),
    weeks,
    instructor: {
      id: "instructor-0",
      display_name: data.instructorName,
      role: "instructor",
      instrument: null,
      paint: null,
    },
    performers: data.performers.map((p) => ({
      id: p.id,
      display_name: p.displayName,
      instrument: p.instrument ?? null,
      paint: p.paint ?? null,
      role: "performer",
    })),
    /** Which performer the role toggle sits in. Exported, never inferred from ordering. */
    performerSeatId: data.performerSeatID,
    standings: data.standings.map((s) => ({
      performerId: s.performerID,
      rank: s.rank,
      points: s.points,
      assignmentsMet: s.assignmentsMet,
      assignmentsAssigned: s.assignmentsAssigned,
      currentStreak: s.currentStreak,
      clipCount: s.clipCount,
      practiceSeconds: s.practiceSeconds,
      weeksMet: s.weeksMet ?? null,
      weeksWithWork: s.weeksWithWork ?? null,
      bestStreak: s.bestStreak ?? null,
    })),
    actions: Object.fromEntries(data.actions.map((a) => [a.name, a])),
    offer: data.offer,
    scoringPresets: data.scoringPresets ?? [],
    assignments,
    sessions,
    focusMarks: data.focusMarks.map((m) => ({
      performerId: m.performerID,
      assignmentId: m.assignmentID,
      focusPointId: `${m.assignmentID}-fp-${m.pointIndex}`,
      weekStart: weeks[Math.min(m.week, lastWeek)].start,
    })),
  };
}

/**
 * A store over the demo studio, shaped like the thing the web screens will call.
 *
 * Reads are narrowed by `viewingAs` the same way row-level security narrows them on a real
 * project: a performer sees their own sessions and nobody else's detail, while `facts` — the
 * peer-visible projection — stays whole, because a leaderboard where everybody else sits at zero
 * is the bug `PracticeFact` exists to prevent.
 */
export class DemoStore {
  #studio;
  #role;

  constructor(studio, role = "instructor") {
    this.#studio = studio;
    this.#role = role;
  }

  static async open(options) {
    return new DemoStore(await buildDemoStudio(options));
  }

  /** The role toggle. Not authentication — there is nothing here to authenticate against. */
  viewAs(role) {
    if (role !== "instructor" && role !== "performer") throw new Error(`no such seat: ${role}`);
    this.#role = role;
    return this.profile();
  }

  get role() { return this.#role; }
  get isInstructor() { return this.#role === "instructor"; }

  /**
   * **The store contract's own answer to "is this the showroom", which was missing.**
   *
   * `isDemo: true` has been on the seeded *data* since the demo shipped — `this.#studio.isDemo` —
   * and nothing ever put it on the store. So `store.isDemo` was `undefined` on every DemoStore
   * ever built, which is falsy, which means both readers of it were reading "no" from the demo:
   * `syncPlan`'s guard against writing reminders for a studio that does not exist, and
   * `loadExportedWords`'s deliberate null. The shell never noticed because it tracks the demo
   * separately as `state.inDemo` — two constructions of one fact, and the one with no gate was the
   * one the modules outside the shell asked.
   *
   * `syncPlan` still returned null, so nothing leaked: `hasStudio` was undefined too and the third
   * clause caught it. *A guard that holds by accident is not a guard* — the demo's protection
   * against spending a real person's one push permission on a seeded studio was resting on a
   * second missing property.
   */
  get isDemo() { return true; }

  /** A showroom always has its one studio. Read by `syncPlan`, and undefined here until now. */
  get hasStudio() { return true; }

  /**
   * The studio's own id, which the demo did not have.
   *
   * `SupabaseStore` exposes this and screens and plans read it — the web's weekly reminder anchor
   * is keyed `weekOpens-${studioId}` so two studios cannot collapse into one, and in the demo that
   * came out `weekOpens-undefined`. Harmless while the demo writes nothing, and exactly the kind of
   * shape difference that is invisible until something reads it.
   */
  get studioId() { return this.#studio.studio.id; }

  profile() {
    return this.isInstructor
      ? this.#studio.instructor
      : this.#studio.performers.find((p) => p.id === this.#studio.performerSeatId);
  }

  studio() { return this.#studio.studio; }
  standings() { return this.#studio.standings; }
  performers() { return this.#studio.performers; }
  offer() { return this.#studio.offer; }

  scoringPresets() { return this.#studio.scoringPresets ?? []; }
  /** The copy for one blocked feature, by the name both clients use for it. */
  action(name) { return this.#studio.actions[name]; }
  rules() { return this.#studio.rules; }
  weeks() { return this.#studio.weeks; }
  roster() { return [this.#studio.instructor, ...this.#studio.performers]; }
  assignments() { return this.#studio.assignments; }

  /**
   * Detail — notes and clips. A performer reads only their own, which is a real narrowing rather
   * than a screen hiding rows: it is what the policies do on a live project, and a demo that
   * showed an instructor's view under a performer's toggle would be demonstrating a privacy leak.
   */
  logs() {
    const me = this.profile().id;
    return this.isInstructor
      ? this.#studio.sessions
      : this.#studio.sessions.filter((s) => s.performerId === me);
  }

  /** The peer-visible projection: who practiced, against what, for how long, with a clip or not. */
  facts() {
    return this.#studio.sessions.map((s) => ({
      performerId: s.performerId,
      assignmentId: s.assignmentId,
      startedAt: s.startedAt,
      duration: s.duration,
      hasClip: s.hasClip,
    }));
  }

  focusMarks() {
    const me = this.profile().id;
    return this.isInstructor
      ? this.#studio.focusMarks
      : this.#studio.focusMarks.filter((m) => m.performerId === me);
  }

  /** Nothing is seeded, and empty is the normal answer — a studio with no terms is always in session. */
  terms() { return []; }

  /** Nothing seeded, same as the iPhone's demo. */
  nudges() { return []; }


  signUp() { refuse("createAccount"); }
  signIn() { refuse("createAccount"); }
  updateProfile() { refuse("editProfile"); }
  deleteAccount() { refuse("deleteAccount"); }

  createStudio() { refuse("createStudio"); }
  joinStudio() { refuse("joinStudio"); }
  removeMember() { refuse("manageRoster"); }
  setRole() { refuse("manageRoster"); }
  leaveStudio() { refuse("manageRoster"); }
  deleteStudio() { refuse("manageRoster"); }
  setScoring() { refuse("setScoring"); }

  saveTerm() { refuse("setTerms"); }
  deleteTerm() { refuse("setTerms"); }

  createAssignment() { refuse("assignWork"); }
  updateAssignment() { refuse("assignWork"); }
  closeAssignment() { refuse("assignWork"); }
  deleteAssignment() { refuse("assignWork"); }

  /**
   * A playable clip, so the showroom's most important screen is not a row of broken buttons.
   *
   * `DemoStore` had no `clipURL` at all and `main.js` calls `store.clipURL(path)` — so every clip
   * in the listening queue printed `store.clipURL is not a function` into the card. Not a refusal
   * and not an empty state: a raw JavaScript error, on the screen a director evaluating IPT is
   * most likely to open, and the one the standing decisions call the reason to buy.
   *
   * Reading is not a write, so this is **not** routed through `refuse` — hearing a take is the
   * fourth step of the loop and gating it would demo everything except the point.
   */
  clipURL(path) {
    const log = this.logs().find((l) => l.clip?.path === path);
    return demoClipURL(log?.clip?.seconds);
  }

  logPractice() { refuse("logPractice"); }
  deleteLog() { refuse("logPractice"); }
  acknowledgeLog() { refuse("acknowledgeSession"); }
  setFocusMark() { refuse("markFocusPoint"); }
  sendNudge() { refuse("sendNudge"); }

  /**
   * A silent no-op, and the one write that is neither allowed nor refused — the same exception
   * `DemoStore.markNudgeSeen` makes in Swift. Nobody taps this; the screen does it on the
   * performer's behalf the instant a banner is drawn, so refusing it would raise a purchase
   * prompt for something the person never reached for.
   */
  async markNudgeSeen() {}

  /**
   * Silent no-ops, for the same reason and one more of its own.
   *
   * Nobody reaches for these — `push.js` calls them by itself on load — so refusing would raise a
   * purchase prompt about a feature somebody has never heard of, having done nothing. And a demo
   * must reach nothing outside its own screen: this is the same class as the demo rescheduling a
   * real performer's notifications, which it did once. `syncPlan` bails on `isDemo` before it gets
   * here; these exist so the next thing to forget cannot leak either.
   */
  async registerPushSubscription() {}
  async forgetPushSubscription() {}
  async replaceReminderPlan() {}
}
