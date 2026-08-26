
import {
  assignmentProgress,
  audienceIncludes,
  isActiveDuring,
  weekContaining,
} from "./judgement.js";
import { listeningBacklog } from "./listening.js";
let planner = null;
async function reminders() {
  planner ??= await import("./reminders.js");
  return planner;
}
import { termsFrom } from "./terms.js";

const PREFERENCES_KEY = "ipt.notifications";

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

export async function current() {
  if (capability() !== "granted") return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

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


export async function syncPlan(store, { now = new Date() } = {}) {
  try {
    if (!store || store.isDemo || !store.hasStudio) return null;
    if (capability() !== "granted") return null;

    const subscription = await current();
    if (!subscription) return null;
    await register(store, subscription);

    const plan = await planFor(store, { now });

    for (const [studioId, items] of planByStudio(plan, store)) {
      await store.replaceReminderPlan(items, studioId);
    }
    return plan;
  } catch {
    return null;
  }
}

export function planByStudio(plan, store) {
  const byStudio = new Map((store.joinedStudios?.() ?? []).map((s) => [s.id, []]));
  if (!byStudio.size && store.studioId) byStudio.set(store.studioId, []);
  for (const item of plan) {
    const key = item.studioId ?? store.studioId;
    if (byStudio.has(key)) byStudio.get(key).push(item);
  }
  return byStudio;
}

export async function planFor(store, { now = new Date(), preferences: prefs = preferences() } = {}) {
  const { capped, instructorPlan, performerPlan, weeklyAnchor } = await reminders();
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
    const anchor = anchorFor(store, other, { now, preferences: prefs, weeklyAnchor });
    if (anchor) items.push(anchor);
  }

  const anchor = anchorFor(store, studio, {
    weeklyAnchor,
    now,
    preferences: prefs,
    isInstructor: store.isInstructor,
    nextWeek,
    timeZone,
  });
  return capped(anchor ? [...items, anchor] : items);
}

function anchorFor(store, studio, { now, preferences: prefs, isInstructor, nextWeek, timeZone, weeklyAnchor }) {
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
    role: isInstructor === undefined || isInstructor === null
      ? roleIn(store, studio)
      : (isInstructor ? "instructor" : "performer"),
    nextWeek: next,
    timeZone: zone,
  });
  return anchor ? { ...anchor, studioId: studio.id } : null;
}

function roleIn(store, studio) {
  const me = store.profile()?.id;
  if (!me) return null;
  return studio.owner_id === me ? "instructor" : null;
}

function assignmentsFor(store, week) {
  const me = store.profile()?.id;
  return store.assignments().filter((a) => audienceIncludes(a, me) && isActiveDuring(a, week));
}

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
