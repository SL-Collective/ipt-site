
import { effectiveRules, weeksBetween } from "./judgement.js";
import {
  currentUserId,
  deleteClip,
  insert,
  isSignedIn,
  patch,
  remove,
  rpc,
  select,
  selectAll,
  signedClipUrl,
  signOut as endSession,
  StoreError,
} from "./supabase.js";
import { forgetPerson } from "./milestones.js";
import { discard, enqueue, flush, pending, queued, setAside, status as outboxStatus } from "./outbox.js";
import { seasonWindow, termsFrom } from "./terms.js";

const STUDIO_KEY = "ipt.studio";

function rememberStudio(id) {
  try { id ? localStorage.setItem(STUDIO_KEY, id) : localStorage.removeItem(STUDIO_KEY); } catch { /* private mode */ }
}

function rememberedStudio() {
  try { return localStorage.getItem(STUDIO_KEY); } catch { return null; }
}

function query(params) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) q.append(key, value);
  }
  return q.toString();
}

const iso = (date) => new Date(date).toISOString();
const uuid = (id) => String(id).toLowerCase();


function assignmentFrom(row) {
  return {
    id: row.id,
    title: row.title,
    section: row.section ?? null,
    target: { kind: row.target_kind, amount: row.target_amount },
    is_optional: row.is_optional ?? false,
    take_minutes: row.take_minutes ?? null,
    focus_points: (row.assignment_focus_points ?? [])
      .map((p) => ({ id: p.id, text: p.body, tempo: p.tempo ?? null, position: p.position }))
      .sort((a, b) => a.position - b.position),
    opens_at: row.opens_at,
    closes_at: row.closes_at ?? null,
    whole_studio: row.whole_studio,
    audience: (row.assignment_targets ?? []).map((t) => t.profile_id),
    created_by: row.created_by ?? null,
    created_at: row.created_at,
  };
}

function logFrom(row) {
  return {
    id: row.id,
    performerId: row.performer_id,
    assignmentId: row.assignment_id,
    startedAt: new Date(row.started_at),
    recordedAt: new Date(row.created_at ?? row.started_at),
    duration: row.duration_seconds,
    hasClip: row.clip_path != null,
    clip: row.clip_path && row.clip_duration != null
      ? { path: row.clip_path, seconds: row.clip_duration, markers: row.clip_markers ?? [] }
      : null,
    note: row.note ?? null,
    wasHeard: row.heard_at != null,
    heardAt: row.heard_at ? new Date(row.heard_at) : null,
    instructorNote: row.instructor_note ?? null,
    selfReported: row.self_reported === true,
  };
}

function factFrom(row) {
  return {
    performerId: row.performer_id,
    assignmentId: row.assignment_id,
    startedAt: new Date(row.started_at),
    duration: row.duration_seconds,
    hasClip: row.has_clip,
  };
}

function pendingAsLog(item) {
  return {
    id: item.id,
    performerId: item.performerId,
    assignmentId: item.draft.assignmentId,
    startedAt: new Date(item.draft.startedAt),
    recordedAt: new Date(item.queuedAt ?? item.draft.startedAt),
    duration: item.draft.duration,
    hasClip: !!item.draft.clip && !item.droppedClip,
    clip: null, // not uploaded yet; there is nothing to play from the server
    note: item.draft.note ?? null,
    wasHeard: false,
    heardAt: null,
    instructorNote: null,
    selfReported: item.draft.selfReported === true,
    isPending: true,
    isSetAside: !!item.setAside,
    lastError: item.lastError ?? null,
  };
}

const pendingAsFact = (item) => ({
  performerId: item.performerId,
  assignmentId: item.draft.assignmentId,
  startedAt: new Date(item.draft.startedAt),
  duration: item.draft.duration,
  hasClip: !!item.draft.clip && !item.droppedClip,
});


export class SupabaseStore {
  isDemo = false;

  #profile = null;
  #studios = [];
  #studioId = null;
  #snapshot = null;
  #clock = null;

  #canClaim = null;

  static async open({ now = null, studioId = rememberedStudio() } = {}) {
    if (!isSignedIn()) throw StoreError.notSignedIn();
    const store = new SupabaseStore(now);
    await store.reload({ studioId });
    return store;
  }

  constructor(now = null) {
    this.#clock = now;
  }


  async reload({ studioId = this.#studioId } = {}) {
    const now = this.#clock ?? new Date();

    const [profiles, studios] = await Promise.all([
      select("profiles", query({ id: `eq.${uuid(currentUserId())}`, select: "*" })),
      select("studios", query({ select: "*", order: "created_at.asc" })),
    ]);

    const row = profiles?.[0];
    if (!row) {
      console.error("IPT: signed in with no profile row. Check the on_auth_user_created trigger.");
      throw new StoreError(
        "server",
        "You're signed in, but your account didn't finish setting up. That is on us rather than "
          + "on you. Try again in a moment.",
        500,
      );
    }
    this.#profile = {
      id: row.id,
      display_name: row.display_name,
      instrument: row.instrument ?? null,
      paint: row.paint ?? null,
      accountRole: row.role,
    };

    this.#studios = (studios ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      join_code: s.join_code,
      week_starts_on: s.week_starts_on,
      time_zone: s.time_zone ?? null,
      created_at: s.created_at,
      scoring: s.scoring ?? null,
      owner_id: s.owner_id,
    }));

    const chosen = this.#studios.find((s) => s.id === studioId) ?? this.#studios[0] ?? null;
    this.#studioId = chosen?.id ?? null;
    rememberStudio(this.#studioId);

    this.#snapshot = chosen ? await this.#loadStudio(chosen, now) : null;
    if (this.#snapshot && this.isInstructor && !chosen.time_zone) {
      await this.#claimTimeZone(chosen, now);
    }
    return this;
  }

  async #claimTimeZone(studio, now) {
    if (this.#canClaim === false) return;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let inForce;
    try {
      inForce = await rpc("claim_time_zone", { p_studio: uuid(studio.id), p_zone: zone });
      this.#canClaim = true;
    } catch (error) {
      if (isMissingFunction(error)) this.#canClaim = false;
      return;
    }
    if (!inForce || inForce === this.#snapshot.studio.time_zone) return;
    studio.time_zone = inForce;
    this.#snapshot.studio.time_zone = inForce;
    this.#snapshot.weeks = weeksBetween(new Date(studio.created_at), now, studio.week_starts_on, inForce);
  }

  async #loadStudio(studio, now) {
    const id = uuid(studio.id);
    const since = iso(studio.created_at);
    const zone = studio.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

    const termRows = select("terms", query({
      studio_id: `eq.${id}`, select: "id,studio_id,name,starts_on,ends_on", order: "starts_on.asc",
    })).catch(() => []);

    const [roster, assignments, logs, facts, focusMarks, terms, nudges, standings] = await Promise.all([
      select("memberships", query({
        studio_id: `eq.${id}`,
        select: "role,joined_at,profiles(id,display_name,role,instrument,paint)",
      })),
      selectAll("assignments", query({
        studio_id: `eq.${id}`,
        select: "*,assignment_targets(profile_id),assignment_focus_points(id,body,tempo,position)",
        order: "created_at.desc,id",
      })),
      selectAll("practice_logs", query({
        studio_id: `eq.${id}`, started_at: `gte.${since}`, select: "*", order: "started_at.desc,id",
      })),
      selectAll("practice_log_facts", query({
        studio_id: `eq.${id}`, started_at: `gte.${since}`, select: "*",
        order: "started_at.desc,performer_id,assignment_id",
      })),
      selectAll("focus_marks", query({ studio_id: `eq.${id}`, week_start: `gte.${since}`, select: "*", order: "id" }))
        .catch(() => []),
      termRows,
      selectAll("nudges", query({ studio_id: `eq.${id}`, select: "*", order: "created_at.desc,id" }))
        .catch(() => []),
      termRows.then((rows) => this.#loadStandings(studio, now, rows)),
    ]);

    const members = (roster ?? [])
      .filter((m) => m.profiles)
      .map((m) => ({
        id: m.profiles.id,
        display_name: m.profiles.display_name,
        instrument: m.profiles.instrument ?? null,
        paint: m.profiles.paint ?? null,
        role: m.role,
        joined_at: m.joined_at,
      }))
      .sort((a, b) => a.display_name.toLowerCase().localeCompare(b.display_name.toLowerCase()));

    const serverLogs = (logs ?? []).map(logFrom);
    const serverFacts = (facts ?? []).map(factFrom);

    return {
      studio: {
        name: studio.name,
        week_starts_on: studio.week_starts_on,
        time_zone: zone,
        created_at: studio.created_at,
        scoring: studio.scoring,
        join_code: studio.join_code,
        id: studio.id,
      },
      rules: effectiveRules(studio.scoring),
      weeks: weeksBetween(new Date(studio.created_at), now, studio.week_starts_on, zone),
      roster: members,
      assignments: (assignments ?? []).map(assignmentFrom),
      serverLogs,
      serverFacts,
      logs: serverLogs,
      facts: serverFacts,
      focusMarks: (focusMarks ?? []).map((m) => ({
        id: m.id,
        performerId: m.performer_id,
        assignmentId: m.assignment_id,
        focusPointId: m.focus_point_id,
        weekStart: new Date(m.week_start),
      })),
      terms: (terms ?? []).map((t) => ({
        id: t.id, name: t.name, starts_on: t.starts_on, ends_on: t.ends_on ?? null,
      })),
      nudges: (nudges ?? []).map((n) => ({
        id: n.id,
        fromInstructorId: n.from_instructor,
        toPerformerId: n.to_performer,
        message: n.message,
        createdAt: new Date(n.created_at),
        seenAt: n.seen_at ? new Date(n.seen_at) : null,
      })),
      standings: standings.rows,
      standingsAvailable: standings.available,
      pending: [],
    };
  }

  async #loadStandings(studio, now, terms) {
    const window = seasonWindow(termsFrom(terms ?? []), {
      studioCreatedAt: studio.created_at,
      now,
    });
    try {
      const rows = await rpc("studio_leaderboard", {
        p_studio: uuid(studio.id),
        p_from: iso(window.from),
        p_to: iso(window.to),
      });
      return {
        available: true,
        rows: (rows ?? []).map((r) => ({
          performerId: r.performer_id,
          rank: r.rank,
          points: r.points,
          assignmentsMet: r.assignments_met,
          assignmentsAssigned: r.assignments_assigned,
          currentStreak: r.current_streak,
          clipCount: r.clip_count,
          practiceSeconds: r.practice_seconds,
          weeksMet: r.weeks_met ?? null,
          weeksWithWork: r.weeks_with_work ?? null,
          bestStreak: r.best_streak ?? null,
        })),
      };
    } catch (error) {
      if (isMissingFunction(error)) return { available: false, rows: [] };
      throw error;
    }
  }

  async applyPending() {
    if (!this.#snapshot) return this;
    const me = this.#profile.id;
    const assignments = new Set(this.#snapshot.assignments.map((a) => a.id));
    const mine = (await pending()).filter(
      (i) => i.performerId === me && assignments.has(i.draft.assignmentId),
    );

    this.#snapshot.pending = mine;
    const delivered = new Set(this.#snapshot.serverLogs.map((l) => l.id));
    const undelivered = mine.filter((i) => !delivered.has(i.id));

    this.#snapshot.logs = [...undelivered.map(pendingAsLog), ...this.#snapshot.serverLogs]
      .sort((a, b) => b.startedAt - a.startedAt);
    this.#snapshot.facts = [
      ...undelivered.filter((i) => !i.setAside).map(pendingAsFact),
      ...this.#snapshot.serverFacts,
    ];
    return this;
  }


  get isLoaded() { return this.#snapshot != null; }
  get hasStudio() { return this.#studioId != null; }
  get studioId() { return this.#studioId; }

  joinedStudios() { return this.#studios; }

  profile() { return this.#profile; }

  get role() {
    const me = this.#snapshot?.roster.find((p) => p.id === this.#profile?.id);
    return me?.role ?? "performer";
  }

  get isInstructor() { return this.role === "instructor"; }

  studio() { return this.#snapshot?.studio ?? null; }
  rules() { return this.#snapshot?.rules ?? effectiveRules(null); }
  weeks() { return this.#snapshot?.weeks ?? []; }
  roster() { return this.#snapshot?.roster ?? []; }
  performers() { return this.roster().filter((p) => p.role === "performer"); }
  assignments() { return this.#snapshot?.assignments ?? []; }
  logs() { return this.#snapshot?.logs ?? []; }
  facts() { return this.#snapshot?.facts ?? []; }
  focusMarks() { return this.#snapshot?.focusMarks ?? []; }
  terms() { return this.#snapshot?.terms ?? []; }
  nudges() { return this.#snapshot?.nudges ?? []; }
  standings() { return this.#snapshot?.standings ?? []; }

  get standingsAvailable() { return this.#snapshot?.standingsAvailable ?? false; }

  get isDemo() { return false; }

  pending() { return this.#snapshot?.pending ?? []; }


  async signOut() {
    await endSession();
    this.#profile = null;
    this.#snapshot = null;
    this.#studios = [];
    this.#studioId = null;
    rememberStudio(null);
  }

  async updateProfile({ displayName, instrument = null, paint }) {
    const rows = await patch("profiles", query({ id: `eq.${uuid(this.#profile.id)}` }), {
      display_name: displayName,
      instrument,
      ...(paint !== undefined && { paint }),
    });
    if (!rows?.[0]) throw StoreError.notPermitted();
    this.#profile = {
      ...this.#profile,
      display_name: rows[0].display_name,
      instrument: rows[0].instrument,
      paint: rows[0].paint,
    };
    return this.#profile;
  }

  async deleteAccount() {
    const departing = this.#profile?.id;
    await rpc("delete_account");
    forgetPerson(departing);
    await this.signOut();
  }


  async createStudio({ name, weekStartsOn = 2 }) {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let last = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const id = await this.#createStudioRPC(name.trim(), randomJoinCode(), weekStartsOn, zone);
        await this.reload({ studioId: id });
        return this.studio();
      } catch (error) {
        if (isJoinCodeCollision(error)) { last = error; continue; }
        throw accountGate(error);
      }
    }
    throw last ?? new StoreError("server", "Couldn't make a join code just now. Try again.", 500);
  }

  async #createStudioRPC(name, code, weekStartsOn, zone) {
    try {
      return await rpc("create_studio", {
        p_name: name, p_join_code: code, p_week_starts_on: weekStartsOn, p_time_zone: zone,
      });
    } catch (error) {
      if (!isMissingFunction(error)) throw error;
      return await rpc("create_studio", {
        p_name: name, p_join_code: code, p_week_starts_on: weekStartsOn,
      });
    }
  }

  async joinStudio(code) {
    let id;
    try {
      id = await rpc("join_studio", { p_code: normaliseJoinCode(code) });
    } catch (error) {
      if (/no studio/i.test(error.message ?? "")) throw StoreError.noSuchStudio();
      throw accountGate(error, "joinStudio");
    }
    await this.reload({ studioId: id });
    return this.studio();
  }

  async selectStudio(id) {
    await this.reload({ studioId: id });
    await this.applyPending();
    return this.studio();
  }

  async leaveStudio(id = this.#studioId) {
    await rpc("leave_studio", { p_studio: uuid(id) });
    await this.reload({ studioId: null });
  }

  async deleteStudio(id = this.#studioId) {
    for (const path of this.logs().map((l) => l.clip?.path).filter(Boolean)) {
      try { await deleteClip(path); } catch { /* best effort; see SupabaseStore.deleteClips */ }
    }
    await remove("studios", query({ id: `eq.${uuid(id)}` }));
    await this.reload({ studioId: null });
  }

  async removeMember(profileId) {
    await remove("memberships", query({
      studio_id: `eq.${uuid(this.#studioId)}`, profile_id: `eq.${uuid(profileId)}`,
    }));
    await this.reload();
  }

  async setRole(profileId, role) {
    await patch("memberships", query({
      studio_id: `eq.${uuid(this.#studioId)}`, profile_id: `eq.${uuid(profileId)}`,
    }), { role });
    await this.reload();
  }

  async transferStudio(profileId) {
    await rpc("transfer_studio", { p_studio: uuid(this.#studioId), p_to: uuid(profileId) });
    await this.reload();
  }

  async setScoring(rules) {
    const rows = await patch("studios", query({ id: `eq.${uuid(this.#studioId)}`, select: "*" }), {
      scoring: rules ?? null,
    });
    if (!rows?.[0]) throw StoreError.notPermitted();
    await this.reload();
    return this.studio();
  }


  async saveTerm({ id, name, startsOn, endsOn = null }) {
    const rows = await insert("terms", [{
      id: id ?? crypto.randomUUID(),
      studio_id: uuid(this.#studioId),
      name: name.trim(),
      starts_on: iso(startsOn),
      ends_on: endsOn ? iso(endsOn) : null,
    }], { returning: "representation", resolution: "merge-duplicates" });
    if (!rows?.[0]) throw StoreError.notPermitted();
    await this.reload();
    return rows[0];
  }

  async deleteTerm(id) {
    await remove("terms", query({ id: `eq.${uuid(id)}` }));
    await this.reload();
  }


  async createAssignment(draft) {
    const wholeStudio = draft.wholeStudio ?? !(draft.audience?.length);
    const rows = await insert("assignments", [{
      studio_id: uuid(this.#studioId),
      title: draft.title.trim(),
      section: draft.section?.trim() || null,
      target_kind: draft.target.kind,
      target_amount: draft.target.amount,
      opens_at: iso(draft.opensAt ?? new Date()),
      closes_at: draft.closesAt ? iso(draft.closesAt) : null,
      whole_studio: wholeStudio,
      is_optional: !!draft.isOptional,
      take_minutes: draft.takeMinutes ?? null,
      created_by: uuid(this.#profile.id),
    }]);
    const created = rows?.[0];
    if (!created) {
      throw new StoreError(
        "server",
        "That may not have saved. Check your assignments before writing it again.",
        500,
      );
    }

    try {
      if (!wholeStudio) {
        await insert("assignment_targets", draft.audience.map((p) => ({
          assignment_id: created.id, profile_id: uuid(p),
        })), { returning: "minimal" });
      }
      await this.#writeFocusPoints(created.id, draft.focusPoints ?? [], { replacing: false });
    } catch (error) {
      try { await this.deleteAssignment(created.id, { reload: false }); } catch { /* already gone */ }
      throw error;
    }

    await this.reload();
    return this.assignments().find((a) => a.id === created.id);
  }

  async updateAssignment(id, draft) {
    const wholeStudio = draft.wholeStudio ?? !(draft.audience?.length);
    await patch("assignments", query({ id: `eq.${uuid(id)}` }), {
      title: draft.title.trim(),
      section: draft.section?.trim() || null,
      target_kind: draft.target.kind,
      target_amount: draft.target.amount,
      ...(draft.closesAt !== undefined && { closes_at: draft.closesAt ? iso(draft.closesAt) : null }),
      whole_studio: wholeStudio,
      is_optional: !!draft.isOptional,
      take_minutes: draft.takeMinutes ?? null,
    });

    await remove("assignment_targets", query({ assignment_id: `eq.${uuid(id)}` }));
    if (!wholeStudio) {
      await insert("assignment_targets", draft.audience.map((p) => ({
        assignment_id: uuid(id), profile_id: uuid(p),
      })), { returning: "minimal" });
    }
    await this.#writeFocusPoints(id, draft.focusPoints ?? [], { replacing: true });
    await this.reload();
    return this.assignments().find((a) => a.id === id);
  }

  async #writeFocusPoints(assignmentId, points, { replacing }) {
    const id = uuid(assignmentId);
    if (replacing) {
      const keep = points.filter((p) => p.id).map((p) => uuid(p.id));
      await remove("assignment_focus_points", query({
        assignment_id: `eq.${id}`,
        id: keep.length ? `not.in.(${keep.join(",")})` : undefined,
      }));
    }
    if (!points.length) return;
    await insert("assignment_focus_points", points.map((p, position) => ({
      id: p.id ?? crypto.randomUUID(),
      assignment_id: id,
      body: p.text.trim(),
      tempo: p.tempo ?? null,
      position: p.position ?? position,
    })), { returning: "minimal", resolution: "merge-duplicates" });
  }

  async closeAssignment(id, at = new Date()) {
    await patch("assignments", query({ id: `eq.${uuid(id)}` }), { closes_at: iso(at) });
    await this.reload();
    return this.assignments().find((a) => a.id === id);
  }

  async deleteAssignment(id, { reload = true } = {}) {
    await remove("assignments", query({ id: `eq.${uuid(id)}` }));
    if (reload) await this.reload();
  }


  async logPractice(draft) {
    const item = await enqueue({ ...draft, studioId: draft.studioId ?? this.#studioId });
    await this.applyPending();
    this.flush().catch(() => { /* the queue keeps it; the bar says so */ });
    return item;
  }

  async flush(options) {
    const result = await flush(options);
    if (result.delivered > 0) await this.reload();
    await this.applyPending();
    return result;
  }

  outboxStatus() { return outboxStatus(); }
  queued() { return queued(); }
  setAside() { return setAside(); }

  async discardPending(id) {
    await discard(id);
    await this.applyPending();
  }

  async deleteLog(id) {
    const log = this.logs().find((l) => l.id === id);
    if (log?.clip?.path) {
      try { await deleteClip(log.clip.path); } catch { /* the row is what matters */ }
    }
    await remove("practice_logs", query({ id: `eq.${uuid(id)}` }));
    await this.reload();
    await this.applyPending();
  }

  async acknowledgeLog(id, note = null) {
    const trimmed = note?.trim();
    const rows = await patch("practice_logs", query({ id: `eq.${uuid(id)}` }), {
      heard_at: iso(new Date()),
      instructor_note: trimmed ? trimmed : null,
    });
    if (!rows?.[0]) throw StoreError.notPermitted();
    await this.reload();
    await this.applyPending();
    return logFrom(rows[0]);
  }

  clipURL(path) { return signedClipUrl(path); }


  async setFocusMark({ focusPointId, assignmentId, weekStart, worked }) {
    if (worked) {
      await insert("focus_marks", [{
        assignment_id: uuid(assignmentId),
        focus_point_id: uuid(focusPointId),
        performer_id: uuid(this.#profile.id),
        studio_id: uuid(this.#studioId),
        week_start: iso(weekStart),
      }], { returning: "minimal", resolution: "ignore-duplicates" });
    } else {
      await remove("focus_marks", query({
        focus_point_id: `eq.${uuid(focusPointId)}`,
        performer_id: `eq.${uuid(this.#profile.id)}`,
        week_start: `eq.${iso(weekStart)}`,
      }));
    }
    await this.reload();
    await this.applyPending();
  }


  async sendNudge({ to, message }) {
    const trimmed = message.trim();
    if (!trimmed) throw new StoreError("invalidDraft", "Write something first.");
    const rows = await insert("nudges", [{
      studio_id: uuid(this.#studioId),
      from_instructor: uuid(this.#profile.id),
      to_performer: uuid(to),
      message: trimmed,
    }]);
    if (!rows?.[0]) throw StoreError.notPermitted();
    await this.reload();
    return rows[0];
  }

  async markNudgeSeen(id) {
    try {
      await patch("nudges", query({ id: `eq.${uuid(id)}` }), { seen_at: iso(new Date()) });
    } catch { /* see above */ }
  }


  async registerPushSubscription({ endpoint, p256dh, auth }) {
    await insert("push_subscriptions", [{
      endpoint,
      profile_id: uuid(this.#profile.id),
      p256dh,
      auth,
    }], { resolution: "merge-duplicates", returning: "minimal" });
  }

  async forgetPushSubscription(endpoint) {
    await remove("push_subscriptions", query({ endpoint: `eq.${endpoint}` }));
  }

  async replaceReminderPlan(plan, studioId = this.#studioId) {
    if (!studioId) return;
    await rpc("replace_reminder_plan", {
      p_studio: uuid(studioId),
      p_plan: plan.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        body: item.body,
        fireAt: iso(item.fireAt),
        weekStart: item.weekStart ? iso(item.weekStart) : null,
        repeatsWeeklyOn: item.repeatsWeeklyOn ?? null,
      })),
    });
  }
}


function isMissingFunction(error) {
  if (!error) return false;
  const code = error.body?.code ?? "";
  return code === "PGRST202" || code === "42883" ||
    /could not find the function|does not exist/i.test(error.message ?? "");
}

function isJoinCodeCollision(error) {
  const message = error?.message ?? "";
  return error?.body?.code === "23505" || message.includes("join_code") || message.includes("23505");
}

function accountGate(error, action = "createStudio") {
  const said = `${error?.message ?? ""} ${error?.body?.message ?? ""}`;
  return /IPT_NO_ACCOUNT/.test(said) ? StoreError.needsAccount(action) : error;
}

const JOIN_ALPHABET = "ACDEFGHJKMNPQRTUVWXY3467";
const JOIN_LENGTH = 6;

export function normaliseJoinCode(raw) {
  return String(raw ?? "").toUpperCase().replace(/[\s-]/g, "");
}

export function isPlausibleJoinCode(raw) {
  const code = normaliseJoinCode(raw);
  return code.length === JOIN_LENGTH && [...code].every((c) => JOIN_ALPHABET.includes(c));
}

function randomJoinCode(length = 6) {
  let code = "";
  const limit = 256 - (256 % JOIN_ALPHABET.length);
  const bytes = new Uint8Array(length * 2);
  while (code.length < length) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= limit || code.length === length) continue;
      code += JOIN_ALPHABET[b % JOIN_ALPHABET.length];
    }
  }
  return code;
}
