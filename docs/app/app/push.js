/**
 * Reminders on the web: asking, subscribing, and keeping the plan up to date.
 *
 * ==========================================================================================
 * The shape, in one paragraph
 * ==========================================================================================
 *
 * A browser cannot schedule a notification. So the device **plans** — with `reminders.js`, which
 * `web/tests/reminders_test.js` proves says exactly what `ReminderPlanner` says — writes the plan
 * to `scheduled_reminders`, and a cron-driven courier delivers each row verbatim at its time. The
 * server composes nothing. `docs/notifications.md` is the whole argument; `0006_reminders.sql` is
 * the schema.
 *
 * ==========================================================================================
 * Three things a browser lies about, and one it merely refuses
 * ==========================================================================================
 *
 * **A browser's answer about itself is a claim, not a fact** — this project has been caught by that
 * twice on the recording path alone. So nothing here trusts a capability it has not exercised:
 *
 *   · `Notification` and `PushManager` existing does not mean a subscription can be minted. On iOS
 *     Safari both exist **in a tab**, where `pushManager.subscribe` then fails — push is only
 *     available to a PWA added to the Home Screen. `capability()` reports that case by name so the
 *     screen can say the true thing rather than offering a button that cannot work.
 *   · `Notification.permission === "granted"` does not mean a subscription still exists. A browser
 *     drops one when its keys rotate, and Chrome does it on some updates. So the subscription is
 *     read back from the browser on every load and re-registered if it changed, rather than being
 *     remembered.
 *   · A service worker registration can exist and be **unable** to subscribe, because the in-app
 *     browsers a school Chromebook often runs refuse service workers entirely. That is the same
 *     reason `web/README.md` says the worker has never been proved to install.
 *
 * And the refusal: `requestPermission()` must be called from a **click**. iOS Safari enforces it
 * strictly and Chrome is heading the same way, so `enable()` is only ever called from a button.
 */

import {
  assignmentProgress,
  audienceIncludes,
  isActiveDuring,
  weekContaining,
} from "./judgement.js";
import { listeningBacklog } from "./listening.js";
import { capped, instructorPlan, performerPlan, weeklyAnchor } from "./reminders.js";
import { termsFrom } from "./terms.js";

const PREFERENCES_KEY = "ipt.notifications";

/**
 * `NotificationPreferences.standard`, which is Swift's default and has to stay Swift's default: a
 * performer who uses both clients must not be reminded differently by each.
 */
export const STANDARD_PREFERENCES = Object.freeze({
  volume: "balanced",
  dailyTime: { hour: 18, minute: 30 },
  quietHours: { start: { hour: 21, minute: 30 }, end: { hour: 7, minute: 30 } },
  wantsStreakAlerts: true,
  wantsWeeklyWrap: true,
  wantsLastChance: true,
  wantsWeeklySummary: true,
  wantsListeningNudge: true,
});

/**
 * Held on the device rather than in the database, deliberately.
 *
 * These are settings about *this browser's* notifications, and the plan they produce is written to
 * the server anyway — so storing them there too would be a second copy of the same decision, and
 * the one somebody edited last would win by accident. iOS keeps them in `Preferences` for the same
 * reason.
 */
export function preferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "null");
    return stored ? { ...STANDARD_PREFERENCES, ...stored } : { ...STANDARD_PREFERENCES };
  } catch {
    return { ...STANDARD_PREFERENCES };
  }
}

export function savePreferences(next) {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ ...preferences(), ...next }));
}


/**
 * What the *platform* allows, which is not the same question as whether reminders are on.
 *
 * `granted` means **permission is held and nothing more.** A browser can hold permission and have
 * no subscription at all — it drops one when its keys rotate, Chrome drops one on some updates, and
 * a first attempt that failed after the prompt leaves exactly this state behind. Reporting that as
 * "reminders are on" is the failure this whole module's header warns about: *a browser's answer
 * about itself is a claim, not a fact.* `Notification.permission` is the claim; a live subscription
 * is the fact, and only `current()` can answer it.
 *
 * @returns one of:
 *   `unsupported`     — no service worker or no Push API. Nothing to offer.
 *   `needsInstall`    — iOS Safari in a tab: push works, but only once added to the Home Screen.
 *   `denied`          — the person said no. Only their browser settings can undo it.
 *   `granted`         — permission is held. Ask `current()` whether anything is subscribed.
 *   `available`       — everything is in place and nobody has been asked yet.
 */
export function capability() {
  if (typeof Notification === "undefined" ||
      !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "unsupported";
  }
  if (isIOSSafari() && !isStandalone()) return "needsInstall";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted") return "granted";
  return "available";
}

function isStandalone() {
  return globalThis.matchMedia?.("(display-mode: standalone)").matches === true ||
    navigator.standalone === true;
}

function isIOSSafari() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}


function urlBase64ToUint8Array(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    .padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/**
 * Asks, subscribes and registers — from a click, and only from a click.
 *
 * Returns the subscription, or throws with a sentence somebody can act on. The distinction the
 * caller needs is between "they said no" (nothing to retry, and the app must not ask again) and
 * "this did not work" (worth another go), so the two arrive as different messages rather than as
 * one generic failure.
 */
export async function enable(store, vapidPublicKey) {
  if (capability() === "unsupported") {
    throw new Error("This browser can't show reminders.");
  }
  if (!vapidPublicKey) {
    throw new Error("Reminders aren't configured for this deployment yet.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Reminders are switched off for this site in your browser's settings.");
  }

  const registration = await activeRegistration();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  await register(store, subscription);
  return subscription;
}

/**
 * A registration with a **running** worker, or a refusal that says so.
 *
 * `navigator.serviceWorker.ready` is the obvious call here and it is a trap: it is a promise that
 * resolves when a worker becomes active and **never rejects**. On a browser that refuses to
 * register one at all it simply stays pending forever — which was measured, not guessed, in the
 * in-app browser this project develops in: `PushManager` present, registration absent, `ready`
 * still pending after three seconds. Awaiting it meant a performer who granted permission got a
 * button stuck on "Just a moment…" with no error and no way out but a reload, having spent the one
 * permission prompt a site ever gets.
 *
 * `register()` is the honest version: it **rejects** when the browser refuses. The race is for the
 * remaining case — a registration that exists and never activates — where there is nothing to
 * reject and something has to give up.
 */
async function activeRegistration({ timeout = 10_000 } = {}) {
  let registration = await navigator.serviceWorker.getRegistration();
  if (!registration) registration = await navigator.serviceWorker.register("./sw.js");
  if (registration.active) return registration;

  const ready = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => setTimeout(() => resolve(null), timeout)),
  ]);
  if (!ready) {
    throw new Error("IPT couldn't finish starting up in this browser. Try reloading the page.");
  }
  return ready;
}

/** The subscription this browser currently holds, or null. Read back, never remembered. */
export async function current() {
  if (capability() !== "granted") return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** Stops this browser being reminded, and takes the row and the plan with it. */
export async function disable(store) {
  const subscription = await current();
  if (subscription) {
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => {});
    await store?.forgetPushSubscription(endpoint).catch(() => {});
  }
  await store?.replaceReminderPlan([]).catch(() => {});
}

async function register(store, subscription) {
  const json = subscription.toJSON();
  await store.registerPushSubscription({
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  });
}


/**
 * Rebuilds this person's plan for the selected studio and writes it down.
 *
 * Called on every load, exactly as iOS reschedules on every foreground, and for the same reason:
 * the plan names this week's numbers, so it is only true for as long as those numbers are. The
 * write is one statement — see `replace_reminder_plan` — because a delete-then-insert from a band
 * hall can lose its connection in the middle and leave somebody with no reminders at all.
 *
 * Silent on failure by design. Nobody asked for this, it runs by itself on a screen about
 * something else, and the next load is the retry — the same treatment `claimTimeZone` and
 * `markNudgeSeen` get. What it must never do is throw into a render.
 */
export async function syncPlan(store, { now = new Date() } = {}) {
  try {
    if (!store || store.isDemo || !store.hasStudio) return null;
    if (capability() !== "granted") return null;

    const subscription = await current();
    if (!subscription) return null;
    await register(store, subscription);

    const plan = planFor(store, { now });

    for (const [studioId, items] of planByStudio(plan, store)) {
      await store.replaceReminderPlan(items, studioId);
    }
    return plan;
  } catch {
    return null;
  }
}

/**
 * One payload per studio, because `replace_reminder_plan` is scoped to one.
 *
 * Exported and pure for the reason `TakeRules` was lifted out of `PracticeRecorder`: everything
 * around it needs a browser — `Notification`, a service worker, a live subscription — and this
 * part needs nothing and is where the damage would be. Filing marching band's anchor under
 * concert band writes it into the wrong studio's rows and then deletes it on the next load, and
 * nothing on any screen would ever say so.
 *
 * **Every joined studio appears, including those the plan has nothing for.** An empty payload is
 * how a studio's rows are cleared when the dial is turned down; skipping it would leave a courier
 * delivering reminders that were withdrawn. Untagged items fall back to the open studio, which is
 * where the dated ones are computed from.
 */
export function planByStudio(plan, store) {
  const byStudio = new Map((store.joinedStudios?.() ?? []).map((s) => [s.id, []]));
  if (!byStudio.size && store.studioId) byStudio.set(store.studioId, []);
  for (const item of plan) {
    const key = item.studioId ?? store.studioId;
    if (byStudio.has(key)) byStudio.get(key).push(item);
  }
  return byStudio;
}

/**
 * The plan itself, pure and exported so a test can read it without a network.
 *
 * The **studio's** zone, not the device's: a week boundary belongs to the studio, and a performer
 * on a trip must not get a different Sunday from their instructor. `studios.time_zone` is what
 * `claim_time_zone` fills in; falling back to the device matches `Studio.resolvedTimeZone`, which
 * is where every shipped build already put it.
 *
 * `preferences` is a parameter rather than read from `localStorage` here so a test can hand it a
 * dial position without a browser global — the same reason `SupabaseStore` takes a clock. A test
 * that has to reach into `globalThis` to set up its input is a test that stops working the day the
 * runtime grows the real thing.
 */
export function planFor(store, { now = new Date(), preferences: prefs = preferences() } = {}) {
  const studio = store.studio();
  if (!studio) return [];

  const timeZone = studio.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const weekStartsOn = studio.week_starts_on ?? 2;
  const week = weekContaining(now, weekStartsOn, timeZone);
  const nextWeek = weekContaining(new Date(week.end.getTime() + 1), weekStartsOn, timeZone);
  const terms = termsFrom(store.terms());

  const dated = store.isInstructor
    ? instructorPlan({
      now, week, studioName: studio.name, preferences: prefs, terms, timeZone,
      backlog: listeningBacklog(store.logs()),
    })
    : performerPlan({
      now, week, summary: summaryFor(store, week), assignments: assignmentsFor(store, week),
      preferences: prefs, terms, timeZone,
    });

  const aboutAWeek = (item) => item.kind !== "listeningBacklog";
  const items = dated.map((item) => ({
    ...item,
    ...(aboutAWeek(item) ? { weekStart: week.start } : {}),
    studioId: store.studioId,
  }));

  for (const other of store.joinedStudios?.() ?? []) {
    if (other.id === store.studioId) continue;
    const anchor = anchorFor(store, other, { now, preferences: prefs });
    if (anchor) items.push(anchor);
  }

  const anchor = anchorFor(store, studio, {
    now,
    preferences: prefs,
    isInstructor: store.isInstructor,
    nextWeek,
    timeZone,
  });
  return capped(anchor ? [...items, anchor] : items);
}

/**
 * The repeating anchor for one studio, selected or not.
 *
 * Split out because it is now built for every studio somebody is in, and the arguments differ:
 * for the selected studio the week arithmetic has already been done, and for the others it has
 * to be done from that studio's own `week_starts_on` and clock. **A week boundary belongs to the
 * studio**, so a person in two studios genuinely has two different Mondays and the anchor for each
 * has to be built in its own zone rather than in the open one's.
 */
function anchorFor(store, studio, { now, preferences: prefs, isInstructor, nextWeek, timeZone }) {
  const zone = timeZone ?? studio.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const startsOn = studio.week_starts_on ?? 2;
  const next = nextWeek ?? (() => {
    const thisWeek = weekContaining(now, startsOn, zone);
    return weekContaining(new Date(thisWeek.end.getTime() + 1), startsOn, zone);
  })();

  const anchor = weeklyAnchor({
    studioName: studio.name,
    studioKey: studio.id,
    weekStartsOn: startsOn,
    preferences: prefs,
    isInstructor: isInstructor ?? roleIn(store, studio),
    nextWeek: next,
    timeZone: zone,
  });
  return anchor ? { ...anchor, studioId: studio.id } : null;
}

/**
 * Whether this person instructs a studio that is not the one loaded.
 *
 * `store.isInstructor` describes the **selected** studio only, which is right for a screen and
 * wrong for anything account-wide. Outside it the membership is not in memory, and ownership is
 * the one thing knowable from the studio row itself — the common case for a studio somebody
 * instructs but is not currently looking at. Exactly `AppModel.role(in:)`, for the same reason.
 * An assistant instructor in an unopened studio is read as a performer and gets the performer's
 * anchor, an hour earlier; the anchor carries no numbers, so the cost of being wrong is the hour.
 */
function roleIn(store, studio) {
  const me = store.profile()?.id;
  return Boolean(me) && studio.owner_id === me;
}

/** The assignments this performer actually has this week, in the studio's own order. */
function assignmentsFor(store, week) {
  const me = store.profile()?.id;
  return store.assignments().filter((a) => audienceIncludes(a, me) && isActiveDuring(a, week));
}

/**
 * This week's progress, in the shape `reminders.js` takes.
 *
 * Built the same way `screens.js` builds it — `judgement.js`'s `assignmentProgress` over
 * `store.facts()`, narrowed to one performer, one assignment and one week. Not a second count:
 * that function is the parity-gated one, and a reminder saying "35 min to go" while the ring on
 * screen says something else is the disagreement this whole design is about.
 *
 * `facts()` rather than the server's own copy, because `applyPending` has already folded the
 * outbox into it — a session finished ninety seconds ago and still queued counts, exactly as it
 * does on the screen the performer is looking at.
 */
function summaryFor(store, week) {
  const me = store.profile()?.id;
  const facts = store.facts();
  const rules = store.rules();
  const progress = {};
  const optionalIds = [];

  for (const assignment of assignmentsFor(store, week)) {
    if (assignment.is_optional) optionalIds.push(assignment.id);
    const mine = facts.filter((f) =>
      f.performerId === me &&
      f.assignmentId === assignment.id &&
      f.startedAt >= week.start && f.startedAt < week.end
    );
    progress[assignment.id] = assignmentProgress(mine, assignment.target, rules);
  }

  const standing = store.standings().find((row) => row.performerId === me);
  const streak = standing?.currentStreak ?? 0;
  return { progress, optionalIds, streakLength: streak, priorStreak: streak };
}
