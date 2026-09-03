
import { effectiveRules, weeksBetween } from "./judgement.js";
import { demoClipURL } from "./demo-clip.js";
import { DemoBlocked, fixture } from "./words.js";

export { DemoBlocked } from "./words.js";

const refuse = (action) => { throw new DemoBlocked(action); };

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
    focus_points: a.focusPoints.map((point, position) => ({
      id: `${a.id}-fp-${position}`,
      text: point.text,
      tempo: point.tempo ?? null,
      position,
    })),
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
        studioId: "demo-studio",
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
      records_audio: data.recordsAudio ?? true,
      owner_id: "instructor-0",
    },
    rules: effectiveRules(data.scoring, data.recordsAudio ?? true),
    weeks,
    instructor: {
      id: "instructor-0",
      display_name: data.instructorName,
      role: "instructor",
      instrument: null,
      paint: null,
      account_display_name: data.instructorName,
      account_instrument: null,
      is_corrected: false,
    },
    performers: data.performers.map((p) => ({
      id: p.id,
      display_name: p.displayName,
      instrument: p.instrument ?? null,
      paint: p.paint ?? null,
      role: "performer",
      account_display_name: p.displayName,
      account_instrument: p.instrument ?? null,
      is_corrected: false,
    })),
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
      studioId: "demo-studio",
    })),
  };
}

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

  viewAs(role) {
    if (role !== "instructor" && role !== "performer") throw new Error(`no such seat: ${role}`);
    this.#role = role;
    return this.profile();
  }

  get role() { return this.#role; }
  get isInstructor() { return this.#role === "instructor"; }

  get isDemo() { return true; }

  get hasStudio() { return true; }

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

  async accountPurchase() { return null; }

  scoringPresets() { return this.#studio.scoringPresets ?? []; }
  action(name) { return this.#studio.actions[name]; }
  rules() { return this.#studio.rules; }
  weeks() { return this.#studio.weeks; }
  roster() { return [this.#studio.instructor, ...this.#studio.performers]; }
  assignments() { return this.#studio.assignments; }

  logs() {
    const me = this.profile().id;
    return this.isInstructor
      ? this.#studio.sessions
      : this.#studio.sessions.filter((s) => s.performerId === me);
  }

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

  terms() { return []; }

  nudges() { return []; }


  signUp() { refuse("createAccount"); }
  signIn() { refuse("createAccount"); }
  updateProfile() { refuse("editProfile"); }
  deleteAccount() { refuse("deleteAccount"); }

  createStudio() { refuse("createStudio"); }
  joinStudio() { refuse("joinStudio"); }
  removeMember() { refuse("manageRoster"); }
  setRole() { refuse("manageRoster"); }
  transferStudio() { refuse("manageRoster"); }
  leaveStudio() { refuse("manageRoster"); }
  deleteStudio() { refuse("manageRoster"); }
  setScoring() { refuse("setScoring"); }
  setRecordsAudio() { refuse("manageRoster"); }
  renameStudio() { refuse("manageRoster"); }
  rotateJoinCode() { refuse("manageRoster"); }
  correctMember() { refuse("manageRoster"); }

  saveTerm() { refuse("setTerms"); }
  deleteTerm() { refuse("setTerms"); }

  createAssignment() { refuse("assignWork"); }
  updateAssignment() { refuse("assignWork"); }
  closeAssignment() { refuse("assignWork"); }
  deleteAssignment() { refuse("assignWork"); }

  clipURL(path) {
    const log = this.logs().find((l) => l.clip?.path === path);
    return demoClipURL(log?.clip?.seconds);
  }

  logPractice() { refuse("logPractice"); }
  deleteLog() { refuse("logPractice"); }
  discardPending() { refuse("logPractice"); }
  removeClip() { refuse("logPractice"); }
  updateEmail() { refuse("editProfile"); }
  applyPending() {}
  selectStudio() {}
  acknowledgeLog() { refuse("acknowledgeSession"); }
  unacknowledgeLog() { refuse("acknowledgeSession"); }
  setFocusMark() { refuse("markFocusPoint"); }
  sendNudge() { refuse("sendNudge"); }

  async markNudgeSeen() {}

  async registerPushSubscription() {}
  async forgetPushSubscription() {}
  async replaceReminderPlan() {}
  async hasPracticeHistory() { return false; }
  async ownRecord() { return { logs: [], marks: [], nudges: [], labels: { studios: [], assignments: [], focusPoints: [], people: [] } }; }
}
