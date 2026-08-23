/**
 * The live studio: fetched once, then read synchronously.
 *
 * ==========================================================================================
 * A loader plus a snapshot, not a set of async getters
 * ==========================================================================================
 *
 * `screens.js` calls `store.logs()` and immediately `.filter()`s the result. There is no `await`
 * anywhere in it, and that is deliberate rather than an oversight — it mirrors `AppModel` on iOS,
 * where every screen reads an already-loaded snapshot and the fetching happens once, in one place.
 * A screen that awaits is a screen that renders twice and disagrees with itself in between.
 *
 * So this is `load()` — the same seven queries `AppModel.loadStudioContents` runs, concurrently —
 * followed by a set of plain accessors over what came back. Anything here that returned a Promise
 * would force `screens.js` to be rewritten, and the screens are the part already proven.
 *
 * The shape every accessor returns is `DemoStore`'s, exactly. `DemoStore` was written first and is
 * what the screens were built against; two stores answering the same question in two shapes is the
 * bug the store contract in `web/README.md` exists to prevent.
 *
 * ==========================================================================================
 * What this file may not do
 * ==========================================================================================
 *
 * **No filtering a policy should be doing.** A performer may not read another performer's note or
 * clip, and that is row-level security in Postgres — never a `.filter()` here. `logs()` returns
 * whatever the server was willing to send; `facts()` reads the `practice_log_facts` view, which is
 * the peer-visible projection and is deliberately *not* narrowed, because a leaderboard where
 * everybody else sits at zero is the bug `PracticeFact` exists to prevent.
 *
 * **No judgement that is not already in Swift and in SQL.** Points, ranks and streak history come
 * from `studio_leaderboard` and are read, never derived — see `standings()`. The one thing this
 * client computes is the week in progress, and that lives in `judgement.js` behind a three-way
 * parity gate.
 *
 * ==========================================================================================
 * A refusal is not a bad connection
 * ==========================================================================================
 *
 * Every write below can fail two ways and they are not the same failure. `StoreError.network` means
 * the request never got an answer — retryable forever, because a practice room is a basement. A
 * status means the server has an opinion about this person, and no amount of retrying will change
 * it. `outbox.js` acts on that distinction; `main.js` reports on it; and the rule is the one
 * `CachingStore.swift` states in the same words.
 */

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

/** Which studio was last being looked at. A preference, not a permission — the server decides that. */
const STUDIO_KEY = "ipt.studio";

function rememberStudio(id) {
  try { id ? localStorage.setItem(STUDIO_KEY, id) : localStorage.removeItem(STUDIO_KEY); } catch { /* private mode */ }
}

function rememberedStudio() {
  try { return localStorage.getItem(STUDIO_KEY); } catch { return null; }
}

/** PostgREST query strings, built rather than concatenated, so a timestamp cannot break one. */
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

/**
 * A session still in the outbox, as the fact and the log it will become.
 *
 * **This is what makes the week in progress true.** Practice is written to disk before the network
 * is touched, so between finishing a session and delivering it the server has never heard of it —
 * and a ring that sits still at the exact moment somebody finished practicing is the product
 * failing while it is being used. `AppModel.reapplyPendingFacts` does the same thing for the same
 * reason.
 *
 * Marked `isPending` so a screen can say so. It is not marked *met* differently, because it counts:
 * the whole argument in `judgement.js` for this client computing anything at all is that it holds
 * practice the server has not seen.
 */
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
  /** Never true here, and read by the screens. The demo is the other implementation. */
  isDemo = false;

  #profile = null;
  #studios = [];
  #studioId = null;
  #snapshot = null;
  /**
   * A pinned instant, or null for "read the clock at every load".
   *
   * Null is the shipping case: the week grid and the board's end date are recomputed on each load,
   * so a tab left open over midnight on a Sunday reloads into the right week. It is a parameter at
   * all for the reason `studio_leaderboard` takes `p_now` rather than calling `now()` — a clock
   * read inside the thing under test is a clock a test cannot move.
   */
  #clock = null;

  /** Whether this project has `claim_time_zone` at all. Null until the first attempt answers. */
  #canClaim = null;

  /**
   * Signs the current session's owner in to their studio.
   *
   * Throws `notSignedIn` rather than returning an empty store: "who is looking at this" is not a
   * question with a blank answer, and every screen past the door assumes it has been answered.
   */
  static async open({ now = null, studioId = rememberedStudio() } = {}) {
    if (!isSignedIn()) throw StoreError.notSignedIn();
    const store = new SupabaseStore(now);
    await store.reload({ studioId });
    return store;
  }

  constructor(now = null) {
    this.#clock = now;
  }


  /**
   * Who is signed in, which studios they are in, and everything inside the selected one.
   *
   * The profile and the studio list are fetched first because the second query set needs the
   * studio's id and its creation date; everything after that goes out at once. Seven requests in
   * parallel on school wi-fi is one round trip, not seven.
   */
  async reload({ studioId = this.#studioId } = {}) {
    const now = this.#clock ?? new Date();

    const [profiles, studios] = await Promise.all([
      select("profiles", query({ id: `eq.${uuid(currentUserId())}`, select: "*" })),
      select("studios", query({ select: "*", order: "created_at.asc" })),
    ]);

    const row = profiles?.[0];
    if (!row) {
      throw new StoreError(
        "server",
        "Signed in, but your profile wasn't found. Check the on_auth_user_created trigger.",
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

  /**
   * Declares this studio's clock, once, from the instructor's device.
   *
   * Until somebody claims, **the server judges this studio's weeks in UTC** — that is what
   * `studio_time_zone()` answers for a null column — while every client judges them in the device's
   * zone. Nothing errors; the leaderboard is simply about a different seven days than the screen
   * above it, and only for sessions logged late on the last evening of a week. That is the shape of
   * bug this project fears most, so the window is closed on load rather than left to a settings
   * screen nobody visits.
   *
   * Instructor-only and refuses to overwrite, both enforced by the database — a performer on a
   * school trip must not set the week boundary for a studio they are merely in, and an instructor
   * at a competition in another state must not move it from a hotel.
   *
   * Silent throughout. It is idempotent and runs on every load, so the next load is the retry, and
   * there is nothing here a person could act on if they were told.
   */
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

  /** Everything inside one studio. The seven queries, plus the board. */
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

  /**
   * The board, read from the server and never derived.
   *
   * Points, ranks and streak history are about *other people*: a client cannot compute them
   * correctly offline regardless, because it does not hold anybody else's latest practice. They
   * come from `studio_leaderboard` in `0004_judgement.sql`, which is the same construction
   * `ScoreEngine` is checked against by `ScoringParityTests`.
   *
   * **`available: false` is not the same as an empty board**, and that distinction is the whole
   * reason this returns a pair. 0004 is committed but not applied to the production project yet,
   * so on that project this function does not exist and PostgREST answers PGRST202. Rendering
   * zeroes there would be inventing a leaderboard; rendering an empty list would say every
   * performer scored nothing, which is a lie somebody would act on. The caller says so instead.
   */
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

  /**
   * Folds whatever is still in the outbox into the loaded snapshot.
   *
   * Called after every load and after every enqueue. Without it a session vanishes from the
   * performer's own week the moment the screen re-renders and reappears when it lands — which
   * reads as practice being lost, at the one moment somebody is watching for the opposite.
   */
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

  /** Every studio this person is in. The picker's list, not the selected one. */
  joinedStudios() { return this.#studios; }

  profile() { return this.#profile; }

  /**
   * The role held **in the selected studio**, never the account role.
   *
   * Somebody who instructs one studio and performs in another is the normal case, not an edge one,
   * and reading `profiles.role` here is how a performer gets handed the instructor's dashboard.
   */
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

  /** False where `0004_judgement.sql` has not been applied. See `#loadStandings`. */
  get standingsAvailable() { return this.#snapshot?.standingsAvailable ?? false; }

  /**
   * The other half of the question `DemoStore` answers, said out loud rather than left undefined.
   *
   * This was right by accident — an absent property is falsy, so every `store.isDemo` check
   * happened to reach the correct conclusion here while reaching the **wrong** one on the demo,
   * where the same absence meant "not the demo". A fact this store's callers branch on should not
   * be answered by the absence of a line.
   */
  get isDemo() { return false; }

  /** Sessions of this person's own that are on disk and not yet on the server. */
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


  /**
   * A new studio, with a join code minted here and retried on collision.
   *
   * The alphabet lives in Swift and the database only checks a shape — deliberately, so there is
   * one definition of it — which means the client generates the code and the unique index is what
   * decides. Three attempts against 191 million codes is not a real limit.
   */
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
    throw last ?? new StoreError("server", "Couldn't allocate a join code.", 500);
  }

  /**
   * `create_studio`, against either version of it.
   *
   * **PostgREST resolves an RPC by its argument *names*, not just by its name**, so sending
   * `p_time_zone` to a project that has not applied 0002 is not "an argument the function ignores"
   * — it is PGRST202, no function matches, and the first screen a new instructor cannot get past.
   * 0002 itself has a longer note on the same class of failure from the other direction: it drops
   * the three-argument function rather than leaving both, because two overloads make a
   * three-argument call ambiguous and PostgREST answers 300.
   *
   * So: ask for the zone, and fall back to the older shape when the project has never heard of it.
   * Migrations 0002–0005 are committed and not yet applied to production, so this is not a
   * hypothetical compatibility gesture — it is the only shape that works today.
   */
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

  /**
   * The studio's scoring rules, or null to put it back on the product default.
   *
   * Null is sent explicitly rather than omitted: leaving the key out is "change nothing", and the
   * whole point of clearing is to return to the default. The bounds are Postgres' — `clamp_scoring`
   * in 0003 — so a client cannot store a set where a week of raw minutes outscores finishing the
   * work, which is the one thing an instructor will do in complete good faith.
   */
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
    if (!created) throw new StoreError("server", "The assignment was not returned after being created.", 500);

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

  /**
   * The plan, upserted so a point that kept its id keeps the ticks against it.
   *
   * The delete is `not.in` rather than wholesale, and that is the difference between an instructor
   * fixing a typo and an instructor wiping the studio's week: `focus_marks` point at these rows.
   * `not.in.()` is not valid PostgREST, so an empty plan is the one case that really is wholesale.
   */
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


  /**
   * A finished session. **Returns as soon as it is on disk**, never after the network.
   *
   * This is the one write that does not go straight out, and the reason is the whole argument for
   * `outbox.js`: a practice room is a basement, and a submit button that can lose forty minutes is
   * one nobody trusts twice. The queue is at-least-once and every delivery is idempotent at the
   * database, which is what `practice_logs_one_per_instant` is for.
   *
   * The flush is started and deliberately **not awaited** — awaiting it here would put the spinner
   * back at the end of a practice session, on the worst connection in the building, for a write
   * that is already durable.
   */
  async logPractice(draft) {
    const item = await enqueue({ ...draft, studioId: draft.studioId ?? this.#studioId });
    await this.applyPending();
    this.flush().catch(() => { /* the queue keeps it; the bar says so */ });
    return item;
  }

  /** Delivers what is queued, then folds whatever is left back into the snapshot. */
  async flush(options) {
    const result = await flush(options);
    if (result.delivered > 0) await this.reload();
    await this.applyPending();
    return result;
  }

  outboxStatus() { return outboxStatus(); }
  queued() { return queued(); }
  setAside() { return setAside(); }

  /**
   * Throws away a session the server has **never seen** — one still in the outbox.
   *
   * **`deleteLog` cannot do this and appeared to.** A set-aside session's id is an outbox id, not a
   * `practice_logs` row, so the DELETE matched nothing, PostgREST answered 204, the screen announced
   * "Session deleted" — and `applyPending` put the session straight back, because it was still on
   * disk. The one state *only the performer can clear* was the one state the button could not clear,
   * and it said otherwise.
   *
   * `outbox.discard` existed the whole time and was called by nothing. iOS has had
   * `discardPending` since v11.
   */
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

  /**
   * One line back, and the moment it was heard.
   *
   * An empty representation is what a policy refusal looks like on a PATCH — the statement
   * succeeded having matched no rows, because a `USING` clause hides rows rather than raising. A
   * performer cannot acknowledge their own session, and this is where that refusal surfaces.
   */
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

  /** A short-lived URL for one clip. Minted per playback and never persisted — see `supabase.js`. */
  clipURL(path) { return signedClipUrl(path); }


  /**
   * Ticking, and un-ticking, one instruction for one week.
   *
   * Upserted rather than inserted so a double tap on a bad connection is one row rather than an
   * error somebody has to interpret. The week is passed in rather than computed here, because the
   * week grid is the studio's and `judgement.js` is the one thing allowed to build it.
   */
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

  /**
   * Seen, which nobody taps.
   *
   * The screen does it on the performer's behalf the instant a banner is drawn, which is why a
   * failure here is swallowed: it is not a thing anybody asked for, so it is not a thing anybody
   * should be told failed.
   */
  async markNudgeSeen(id) {
    try {
      await patch("nudges", query({ id: `eq.${uuid(id)}` }), { seen_at: iso(new Date()) });
    } catch { /* see above */ }
  }


  /**
   * This browser's push subscription. Upserted, because it is written on every load.
   *
   * One row per browser rather than per person: somebody with a Chromebook at school and a phone
   * at home has two and both should ring. The endpoint is the key because it is what the push
   * service considers the identity of a subscription.
   */
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

  /**
   * Replaces the reminder plan for the **selected studio**, atomically.
   *
   * The payload is finished text. Nothing on the server composes a reminder — see the header of
   * `0006_reminders.sql`, and `reminders.js` for the only place these sentences come from.
   *
   * Scoped to one studio because somebody in two of them is the normal case, and the plan written
   * by the studio they happen to be looking at must not delete the other one's. Same rule as
   * anything else read from `studio`.
   */
  /**
   * `studioId` is a parameter, and the default is the only reason this used to look correct.
   *
   * `replace_reminder_plan` is scoped to one studio — it deletes that studio's rows and inserts
   * the payload — so a person in two studios needs one call per studio. Reading the selected one
   * off `this` made that impossible to express, which is how the web came to plan for whichever
   * studio happened to be open. See `syncPlan`.
   */
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


/**
 * A PostgREST 404 for a function that is not there, told apart from a 404 for a row that is not.
 *
 * PGRST202 is "no function matches this name and argument list". It is the answer a project gets
 * where `0004_judgement.sql` has not been applied — which is the production project today.
 */
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

/**
 * Turns `0005`'s entitlement refusal into something the shell can raise a purchase prompt for.
 *
 * The migration raises a **named, catchable condition** rather than prose — `IPT_NO_ACCOUNT` —
 * precisely so both clients can match on it without depending on wording a future edit could
 * quietly change. Everything else passes through untouched.
 */
function accountGate(error, action = "createStudio") {
  const said = `${error?.message ?? ""} ${error?.body?.message ?? ""}`;
  return /IPT_NO_ACCOUNT/.test(said) ? StoreError.needsAccount(action) : error;
}

/**
 * A join code, in the alphabet `JoinCode` defines — **copied, and copied exactly**.
 *
 * The alphabet lives in Swift and the database checks only a shape (`^[A-Z0-9]{6}$`), deliberately,
 * so that a client can mint a code without a round trip. That makes this the second construction of
 * something with no gate over it, so the characters are worth stating rather than remembering:
 * `O 0 I 1 L S 5 B 8 Z 2` are out because the code's primary transport is an instructor saying it
 * across a band room, and `9` goes too because it is heard as `G`. Twenty-four characters, 24⁶ ≈
 * 191 million codes, and collisions are caught by the unique index rather than assumed away.
 *
 * A code minted from a *different* alphabet would still be accepted by the database and still work
 * — and would quietly reintroduce every pair the list above exists to remove.
 */
const JOIN_ALPHABET = "ACDEFGHJKMNPQRTUVWXY3467";
const JOIN_LENGTH = 6;

/**
 * A typed code, normalised the way `JoinCode.init?(_:)` normalises it — **including the hyphen.**
 *
 * This client did not, and the app spells the code with one everywhere a person meets it: the
 * roster shows "RUD-MNT", the setup card shows "RUD-MNT", and the join field's own placeholder is
 * "ACD-EFG". A performer who typed exactly what they were shown, or exactly what the example
 * suggested, sent "RUD-MNT" to a function that matches `upper(trim(p_code))` against "RUDMNT" —
 * and was told there was no such studio.
 *
 * It worked on an iPhone the whole time, because `JoinCode` has filtered whitespace and `-` since
 * it was written. So this was not a broken feature; it was a feature that worked on one client, at
 * the very first thing a performer ever does, on the client school Chromebooks run.
 *
 * Whitespace goes too, for the person who types the two halves with a space, and because iOS has
 * always accepted that.
 */
export function normaliseJoinCode(raw) {
  return String(raw ?? "").toUpperCase().replace(/[\s-]/g, "");
}

/** Whether a normalised code could exist at all — the alphabet is the whole design. */
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
