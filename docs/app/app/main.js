
import { el, replace } from "./dom.js";
import { field } from "./ui.js";
import { assignmentCost, deletionCost, removalCost } from "./listening.js";
import { markMilestoneSeen, seenMilestones, markWelcomeSeen, seenWelcomes } from "./milestones.js";
import { civilDate, instantAtCivilMidnight } from "./judgement.js";
import { customWeeks, pastTermWeeks, monthWeeks, seasonWeeks, spanSubtitle, spanTitle } from "./spans.js";
import { DemoBlocked, checkoutURLFor, vocabulary } from "./words.js";
import { isAndroidApp } from "./android.js";
import { countInSeconds, saveCountInSeconds } from "./recording-prefs.js";
import { outcomeFor } from "./age-gate.js";

import { termsFrom } from "./terms.js";
import { SupabaseStore, isPlausibleJoinCode } from "./store.js";
import { CONFIG, isConfigured, remindersConfigured } from "./config.js";
import { longDuration } from "./format.js";
import {
  belongsTo as sessionBelongsTo,
  clearOpenSession,
  HEARTBEAT_MS,
  offerFor,
  readOpenSession,
  saveOpenSession,
  watchedSeconds,
} from "./open-session.js";
import {
  adoptSession,
  authRedirectIntent,
  isSignedIn,
  requestPasswordReset,
  resendConfirmation,
  signOut as supabaseSignOut,
  updatePassword,
  restoreSession,
  signIn,
  signUp,
  StoreError, useSharedDevice,
} from "./supabase.js";
import { requestDurableStorage } from "./outbox.js";
import {
  addSessionScreen,
  assignmentEditorScreen,
  assignmentsScreen,
  confirmScreen,
  doorScreen,
  resetPasswordScreen,
  helpScreen,
  listeningScreen,
  performerScreen,
  practiceScreen,
  remindersScreen,
  rosterScreen,
  scoringScreen,
  sessionScreen,
  standingsScreen,
  standingsUnavailableScreen,
  displayScreen,
  seasonScreen,
  studioScreen,
  duplicateOf,
  studioSetupScreen,
  termProblems,
  termsScreen,
  parentRouteScreen,
  welcomeScreen,
  youScreen,
} from "./screens.js";

const root = document.getElementById("app");
const announcer = document.getElementById("announcer");

const state = {
  mode: "door",
  store: null,
  inDemo: false,
  auth: { mode: "signIn", problem: null, message: null, busy: false, email: "", asParent: false },
  session: null,
  purchase: undefined,
  loadingPurchase: false,
  report: null,
  guidanceNote: null,
  exporting: false,
  push: null,
  durableStorage: null,
  welcome: null,
  demoWelcomedSeats: new Set(),
  editing: null,
  viewing: null,
  rosterSearch: "",
  weekStarts: [],
  viewedSpan: null,
  demoMilestonesSeen: null,
  suggestions: [],
  vocabulary: null,
  reminders: { busy: false, problem: null, subscribed: false },
  settings: { busy: false, problem: null },
  addSession: { busy: false, problem: null },
  playbackRate: 1,
  playbackRates: [],
  selfReportMark: "",
  resettingPassword: false,
  seasonSaid: null,
  dismissedBreak: false,
  dismissedSeason: false,
  studioOffers: null,
  outbox: null,
  offline: false,
};

function titleFor(name) {
  return state.inDemo ? `${name} · IPT demo` : `${name} · IPT`;
}

let mounted = null;


function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}


function announce(message) {
  announcer.textContent = "";
  setTimeout(() => { announcer.textContent = message; }, 0);
}


function raise(dialog) {
  const takeAway = () => { dialog.close(); dialog.remove(); };
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("cancel", takeAway);
  document.body.append(dialog);
  dialog.showModal();
  return takeAway;
}

function askToConfirm({ title, message, confirmText, cancelText = "Keep it", typeToConfirm = null }) {
  return new Promise((resolve) => {
    let dismiss;
    const settle = (answer) => { dismiss(); resolve(answer); };

    const cancel = el("button", {
      class: "button--quiet", style: "width:100%", type: "button",
      onClick: () => settle(false), text: cancelText,
    });

    const typed = typeToConfirm
      ? el("input", { type: "text", id: "confirm-word", autocapitalize: "characters", autocomplete: "off" })
      : null;
    const go = el("button", {
      style: "width:100%; color: var(--live)", type: "button",
      disabled: typeToConfirm ? true : undefined,
      onClick: () => settle(true), text: confirmText,
    });
    if (typed) {
      typed.addEventListener("input", () => {
        go.disabled = typed.value.trim().toUpperCase() !== typeToConfirm;
      });
    }

    const dialog = el(
      "dialog",
      { "aria-labelledby": "confirm-title" },
      el(
        "div",
        { class: "stack" },
        el("h2", { id: "confirm-title", text: title }),
        el("p", { class: "muted", text: message }),
        typed && field(`Type ${typeToConfirm} to confirm`, typed),
        go,
        cancel,
      ),
    );

    dialog.addEventListener("cancel", () => resolve(false));
    dismiss = raise(dialog);
    cancel.focus();
  });
}

async function showPrompt(actionName) {
  const words = state.store?.action
    ? { action: state.store.action(actionName), offer: state.store.offer(), supportEmail: null }
    : await vocabulary().then((v) => ({
      action: v.actions[actionName], offer: v.offer, supportEmail: v.supportEmail,
    }));
  const { action, offer, supportEmail } = words;
  if (!action) return;

  const promptBuyerLink = checkoutURLFor(
    offer,
    state.store && !state.store.isDemo ? state.store.profile()?.id : null,
  );

  const sells = action.isPurchasable && !isAndroidApp();

  let dismiss;
  const dialog = el(
    "dialog",
    { "aria-labelledby": "prompt-title" },
    el(
      "div",
      { class: "stack" },
      el("h2", { id: "prompt-title", text: action.title }),
      el("p", { class: "muted", text: action.blurb }),
      sells && el("hr", { class: "divider" }),
      sells && el("p", { style: "font-weight:600", text: offer.line }),
      sells && el("p", { class: "caption", text: offer.reassurance }),
      sells && el("p", {
        class: "caption",
        text: !offer.isBuyable
          ? "IPT is not on sale yet. This demo is the whole app, and it stays free."
          : promptBuyerLink
          ? "Buying opens in a new tab. It attaches to the account you are signed in to here."
          : "Create a free account first. Buying attaches the purchase to the account you are signed in to.",
      }),
      sells && promptBuyerLink && el("a", {
        class: "button--primary",
        style: "width:100%; display:block; text-align:center",
        href: promptBuyerLink,
        target: "_blank",
        rel: "noopener",
        text: `Get IPT for ${offer.priceText}`,
      }),
      sells && promptBuyerLink && el(
        "p",
        { class: "caption" },
        "Already bought it? Close this and try again: a payment takes a few seconds to reach us.",
        supportEmail ? " If it still asks, write to " : null,
        supportEmail ? el("a", { href: `mailto:${supportEmail}`, text: supportEmail }) : null,
        supportEmail ? "." : null,
      ),
      action.isPurchasable && isAndroidApp() && el("p", {
        class: "caption",
        text: state.inDemo
          ? "This needs an IPT account. One account works on every device you sign in on."
          : "This account doesn't have IPT yet. Once it does, it works on every device you sign in on.",
      }),
      state.inDemo && action.isPurchasable && el("button", {
        class: "button--primary",
        style: "width:100%",
        type: "button",
        onClick: () => { dismiss(); leaveDemo(); goToSignUp(); },
        text: "Create a free account",
      }),
      el("button", {
        class: "button--quiet",
        style: "width:100%",
        type: "button",
        onClick: () => dismiss(),
        text: action.isPurchasable ? "Keep looking around" : "Close",
      }),
    ),
  );

  dismiss = raise(dialog);
  announce(action.title);
}

function showRefusal(message) {
  let dismiss;
  const dialog = el(
    "dialog",
    { "aria-labelledby": "refusal-title" },
    el(
      "div",
      { class: "stack" },
      el("h2", { id: "refusal-title", text: "That didn't go through" }),
      el("p", { class: "muted", text: message }),
      el("button", {
        class: "button--primary",
        style: "width:100%",
        type: "button",
        onClick: () => dismiss(),
        text: "OK",
      }),
    ),
  );
  dismiss = raise(dialog);
  announce(message);
}

addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  if (reason instanceof DemoBlocked) {
    event.preventDefault();
    showPrompt(reason.action);
    return;
  }
  if (reason instanceof StoreError) {
    event.preventDefault();
    report(reason);
  }
});

function report(error) {
  if (error instanceof DemoBlocked) { showPrompt(error.action); return; }
  switch (error.kind) {
    case "network":
      state.offline = true;
      render();
      break;
    case "needsAccount":
      showPrompt(error.action ?? "createStudio");
      break;
    case "notSignedIn":
      state.store = null;
      state.session = null;
      state.editing = null;
      state.viewing = null;
      state.purchase = undefined;
      state.viewedSpan = null;
      state.mode = "door";
      state.auth = { ...state.auth, busy: false, problem: "You're signed out. Sign in and carry on." };
      render();
      break;
    default:
      showRefusal(error.message);
  }
}


function demoBar() {
  const seats = ["instructor", "performer"];

  const buttons = seats.map((role, index) =>
    el("button", {
      type: "button",
      role: "radio",
      "aria-checked": String(state.store.role === role),
      tabindex: state.store.role === role ? "0" : "-1",
      text: role === "instructor" ? "Instructor" : "Performer",
      onClick: () => switchSeat(role),
      onKeydown: (event) => {
        const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
        const step = keys[event.key];
        if (!step) return;
        event.preventDefault();
        switchSeat(seats[(index + step + seats.length) % seats.length]);
      },
    })
  );

  return el(
    "div",
    { class: "demo-bar" },
    el(
      "div",
      { class: "demo-bar__inner" },
      el(
        "div",
        { class: "row-between" },
        el(
          "div",
          {},
          el("p", { class: "micro", text: "Demo studio" }),
          el("p", { class: "caption", text: "Look around. Nothing here can be changed." }),
        ),
        el("button", { class: "button--plain no-shrink", style: "color:var(--accent)", type: "button", onClick: leaveDemo, text: "Leave" }),
      ),
      el("div", { class: "segmented", role: "radiogroup", "aria-label": "Viewing as" }, buttons),
    ),
  );
}

function offlineBar() {
  const waiting = state.outbox?.waiting ?? 0;
  return el("div", { class: "offline-bar", role: "status" }, el("p", {
    class: "caption",
    text: waiting > 0
      ? `No connection. ${waiting === 1 ? "One session is" : `${waiting} sessions are`} saved on this device and will send themselves.`
      : "No connection. Anything you do is saved on this device.",
  }));
}

function tabsFor(store) {
  const standings = { href: "#/standings", label: "Standings", glyph: "★" };
  const board = store.rules?.().keepsScore !== false ? [standings] : [];
  return store.isInstructor
    ? [
      { href: "#/studio", label: "Studio", glyph: "▦" },
      { href: "#/assignments", label: "Assignments", glyph: "☰" },
      ...board,
      { href: "#/you", label: "You", glyph: "●" },
    ]
    : [
      { href: "#/practice", label: "Practice", glyph: "▲" },
      ...board,
      { href: "#/you", label: "You", glyph: "●" },
    ];
}

function tabBar(current) {
  return el(
    "nav",
    { class: "tabbar", "aria-label": "Sections" },
    el(
      "ul",
      {},
      tabsFor(state.store).map((tab) =>
        el(
          "li",
          {},
          el(
            "a",
            { href: tab.href, "aria-current": tab.href === current ? "page" : undefined },
            el("span", { class: "tab-glyph", "aria-hidden": "true", text: tab.glyph }),
            el("span", { class: "tab-label", text: tab.label }),
          ),
        )
      ),
    ),
  );
}


function spanControls(store) {
  return {
    span: spanFor(store),
    onPickSpan: (kind) => {
      const weeks = store.weeks();
      state.viewedSpan = kind === "week"
        ? null
        : kind === "month"
        ? { kind: "month", anchorMs: weeks[weeks.length - 1].start.getTime() }
        : kind === "season"
        ? { kind: "season" }
        : kind.startsWith("term:")
        ? { kind: "term", termId: kind.slice(5) }
        : {
          kind: "custom",
          fromMs: weeks[Math.max(0, weeks.length - 4)].start.getTime(),
          toMs: weeks[weeks.length - 1].start.getTime(),
        };
      render();
      document.getElementById("span-kind")?.focus();
    },
    onApplyCustom: (fromValue, toValue) => {
      const zone = store.studio().time_zone;
      const held = state.viewedSpan?.kind === "custom" ? state.viewedSpan : null;
      const parse = (value, fallback) => {
        if (!value) return fallback;
        const [y, m, d] = value.split("-").map(Number);
        return instantAtCivilMidnight(y, m, d, zone);
      };
      state.viewedSpan = {
        kind: "custom",
        fromMs: parse(fromValue, held?.fromMs ?? store.weeks()[0].start.getTime()),
        toMs: parse(toValue, held?.toMs ?? store.weeks().at(-1).start.getTime()),
      };
      render();
      document.getElementById("custom-from")?.focus();
    },
    onStepSpan: (delta) => {
      const weeks = store.weeks();
      const shown = spanFor(store);
      if (shown.kind === "season") return;
      if (shown.kind === "month") {
        const anchor = new Date(state.viewedSpan?.anchorMs ?? weeks[weeks.length - 1].start.getTime());
        const zone = store.studio().time_zone;
        const { year, month } = civilDate(anchor, zone);
        const moved = new Date(instantAtCivilMidnight(
          month + delta < 1 ? year - 1 : month + delta > 12 ? year + 1 : year,
          ((month + delta - 1 + 12) % 12) + 1,
          1, zone));
        const target = monthWeeks(moved, weeks[weeks.length - 1].start, store.studio().week_starts_on, zone);
        const gridStarts = new Set(weeks.map((w) => w.start.getTime()));
        if (!target.some((w) => gridStarts.has(w.start.getTime()))) return;
        state.viewedSpan = { kind: "month", anchorMs: moved.getTime() };
      } else {
        const current = shown.weeks[0];
        const index = weeks.findIndex((w) => w.start.getTime() === current.start.getTime());
        const next = weeks[index + delta];
        if (!next) return;
        state.viewedSpan = next.start.getTime() === weeks.at(-1).start.getTime()
          ? null
          : { kind: "week", anchorMs: next.start.getTime() };
      }
      render();
      const pressed = document.getElementById(delta < 0 ? "week-back" : "week-forward");
      const other = document.getElementById(delta < 0 ? "week-forward" : "week-back");
      (pressed?.hasAttribute("disabled") ? other : pressed)?.focus();
    },
  };
}

function extraRoutesFor(store) {
  const routes = state.inDemo
    ? ["#/season", "#/help", "#/add-session"]
    : ["#/reminders", "#/season", "#/help", "#/add-session"];
  if (!store.isInstructor) return routes;
  const board = store.rules?.().keepsScore !== false ? ["#/display"] : [];
  return [...routes, "#/listening", "#/terms", "#/scoring", "#/roster", ...board];
}



let wakeSentinel = null;
let wakeSupported = null;

async function holdScreenAwake() {
  if (!("wakeLock" in navigator)) { wakeSupported = false; return; }
  try {
    wakeSentinel = await navigator.wakeLock.request("screen");
    wakeSupported = true;
    wakeSentinel.addEventListener("release", () => { wakeSentinel = null; });
  } catch {
    wakeSentinel = null;
    wakeSupported = false;
  }
}

function releaseScreen() {
  wakeSentinel?.release?.().catch(() => {});
  wakeSentinel = null;
}

addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (currentRoute() === "#/display" && !wakeSentinel) holdScreenAwake();
});


function holdDisplay() {
  holdScreenAwake();

  const refresh = setInterval(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      await state.store.reload?.();
    } catch {
      return;
    }
    if (currentRoute() === "#/display") render();
  }, 120_000);

  const onKey = (event) => { if (event.key === "Escape") leaveDisplay(); };
  addEventListener("keydown", onKey);

  return () => {
    clearInterval(refresh);
    removeEventListener("keydown", onKey);
    releaseScreen();
  };
}

function leaveDisplay() {
  releaseScreen();
  location.hash = "#/standings";
}


let offersPending = false;
async function loadStudioOffers() {
  const store = state.store;
  if (offersPending || !store?.isInstructor || store.facts().length === 0) return;
  offersPending = true;
  try {
    const { lengthPhrase, mostRecentQuiet, seasonMessage, seasonOffer } = await import("./quiet.js");
    const terms = termsFrom(store.terms());
    const now = new Date();

    const stretch = state.dismissedBreak
      ? null
      : mostRecentQuiet(store.weeks(), store.facts(), terms, now);
    const season = state.dismissedSeason
      ? null
      : seasonOffer(store.weeks(), store.facts(), terms, now);

    const next = {
      quiet: stretch ? { ...stretch, title: `Was that ${lengthPhrase(stretch)} a break?` } : null,
      season: season ? { ...season, message: seasonMessage(season) } : null,
    };
    const same = JSON.stringify(next) === JSON.stringify(state.studioOffers);
    if (!same) { state.studioOffers = next; render(); }
  } catch {
  } finally {
    offersPending = false;
  }
}

let guidancePending = false;
async function loadGuidance() {
  if (guidancePending || !state.editing) return;
  guidancePending = true;
  try {
    const { guidancePhrase, targetGuidance } = await import("./guidance.js");
    const guidance = targetGuidance(
      state.store.weeks(), state.store.facts(), termsFrom(state.store.terms()), new Date());
    const note = guidance ? guidancePhrase(guidance) : null;
    if (note !== state.guidanceNote) { state.guidanceNote = note; render(); }
  } catch {
  } finally {
    guidancePending = false;
  }
}

let pushModule = null;
async function pushing() {
  pushModule ??= await import("./push.js");
  return pushModule;
}

function syncReminderPlan(store) {
  pushing().then((push) => push.syncPlan(store)).catch(() => {});
}

let pushPending = false;
async function loadPush() {
  if (state.push || pushPending) return;
  pushPending = true;
  try {
    state.push = await pushing();
    render();
  } catch {
  } finally {
    pushPending = false;
  }
}

let reportPending = false;
async function loadReport() {
  if (state.report || reportPending) return;
  reportPending = true;
  try {
    state.report = await import("./report.js");
    render();
  } catch {
  } finally {
    reportPending = false;
  }
}

async function copySeason(text) {
  try {
    await navigator.clipboard.writeText(text);
    state.seasonSaid = "Copied.";
    announce("The season summary was copied");
  } catch {
    state.seasonSaid = "This browser wouldn't let the page copy it. Select the text above instead.";
  }
  render();
}

async function shareSeason(text) {
  try {
    await navigator.share({ text });
    state.seasonSaid = null;
  } catch (error) {
    state.seasonSaid = error?.name === "AbortError"
      ? null
      : "This browser wouldn't open a share sheet. Copy it instead.";
  }
  render();
}


async function declareBreak(stretch) {
  const rows = state.store.terms();
  const existing = termsFrom(rows).map((term, index) => ({
    ...term, id: rows[index].id, name: rows[index].name,
  }));
  const { declaringBreak } = await import("./quiet.js");
  const wanted = declaringBreak(existing, stretch, {
    studioCreatedAt: new Date(state.store.studio().created_at),
  });

  const ok = await settingsWrite(async () => {
    for (const term of wanted) {
      const before = existing.find((e) => e.id === term.id);
      const unchanged = before
        && new Date(before.startsOn).getTime() === new Date(term.startsOn).getTime()
        && (before.endsOn == null) === (term.endsOn == null)
        && (before.endsOn == null
          || new Date(before.endsOn).getTime() === new Date(term.endsOn).getTime());
      if (unchanged) continue;
      await state.store.saveTerm({
        id: term.id,
        name: term.name,
        startsOn: new Date(term.startsOn).toISOString(),
        endsOn: term.endsOn == null ? null : new Date(term.endsOn).toISOString(),
      });
    }
  });
  if (!ok) return;
  state.dismissedBreak = true;
  announce("The break was declared");
  render();
}


async function leaveStudio() {
  const studio = state.store.studio();
  const sure = await askToConfirm({
    title: `Leave ${studio.name}?`,
    message: "You stop seeing this studio. Your instructor keeps the sessions and recordings you already sent them; the studio's standings and totals stop counting you. Rejoining with the join code brings it all back.",
    confirmText: "Leave it",
  });
  if (!sure) return;

  try {
    await state.store.leaveStudio();
    announce(`Left ${studio.name}`);
    state.mode = state.store.studio() ? "studio" : "setup";
    render();
  } catch (error) {
    report(error);
  }
}


async function saveProfile(draft) {
  await settingsWrite(async () => {
    await state.store.updateProfile(draft);
    announce("Your details were saved");
  });
}

async function exportEverything() {
  if (state.exporting) return;
  state.exporting = true;
  render();
  try {
    const { buildDocument, filename, toCSV, toJSON } = await import("./export.js");
    const store = state.store;
    const mine = store.isInstructor
      ? store.logs()
      : store.logs().filter((l) => l.performerId === store.profile()?.id);

    const clipURLs = {};
    for (const log of mine) {
      if (!log.clip?.path) continue;
      try { clipURLs[log.clip.path] = await store.clipURL(log.clip.path); } catch { /* absent */ }
    }

    const document_ = buildDocument(store, { clipURLs });
    if (!document_) return;
    save(toJSON(document_), filename(document_, "json"), "application/json");
    save(toCSV(document_), filename(document_, "csv"), "text/csv");
    announce("Your data was downloaded");
  } catch {
    settingsSaid("That didn't work. Try again in a moment.");
  } finally {
    state.exporting = false;
    render();
  }
}

function save(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function changeEmail(wanted) {
  const current = state.store.profile()?.email;
  if (wanted === current) {
    settingsSaid("That is already your address.");
    return;
  }
  const sure = await askToConfirm({
    title: "Change your sign-in address?",
    message: `IPT will send a confirmation link to ${wanted}. Nothing changes until you follow it, `
      + `so you keep signing in with the address you have now until then. If ${wanted} is wrong, `
      + `the link goes nowhere and nothing happens.`,
    confirmText: "Send the link",
  });
  if (!sure) { settingsSaid(""); return; }

  await settingsWrite(async () => {
    await state.store.updateEmail(wanted);
    settingsSaid(`Check ${wanted} for the link. Until you follow it, sign in with your old address.`);
    announce("A confirmation link was sent to the new address");
  });
}

function settingsSaid(text) {
  const said = document.querySelector("#me-email")?.form?.querySelector('[role="status"]');
  if (said) said.textContent = text;
}

async function deleteStudioAndLeave() {
  const studio = state.store.studio();
  const cost = deletionCost({
    studios: [studio],
    logs: state.store.logs(),
    roster: state.store.roster(),
    profileId: state.store.profile().id,
  });
  const sure = await askToConfirm({
    title: `Delete ${studio.name}?`,
    message: `${cost.phrase} It cannot be undone, support cannot bring it back, and the people in it aren't told.`,
    confirmText: "Delete it",
    typeToConfirm: "DELETE",
  });
  if (!sure) return;
  try {
    await state.store.deleteStudio();
    announce(`Deleted ${studio.name}`);
    state.mode = state.store.studio() ? "studio" : "setup";
    render();
  } catch (error) {
    report(error);
  }
}


async function addSession(entry) {
  state.addSession = { busy: true, problem: null };
  render();
  try {
    await state.store.logPractice({
      assignmentId: entry.assignmentId,
      studioId: state.store.studio().id,
      startedAt: entry.startedAt,
      duration: entry.duration,
      note: entry.note || null,
      selfReported: true,
    });
    state.addSession = { busy: false, problem: null };
    go("#/practice");
  } catch (err) {
    state.addSession = {
      busy: false,
      problem: err instanceof DemoBlocked ? null : (err?.message ?? "That could not be saved."),
    };
    if (err instanceof DemoBlocked) report(err);
    render();
  }
}

async function deleteSession(session) {
  const unsent = session.isPending || session.isSetAside;
  const sure = await askToConfirm({
    title: unsent ? "Throw this session away?" : "Delete this session?",
    message: unsent
      ? "It hasn't been sent yet, so it will be gone for good, including the recording."
      : "The minutes, the recording, and anything your instructor wrote back all go. "
        + "To keep the session and remove only the audio, use Remove the recording.",
    confirmText: unsent ? "Throw it away" : "Delete",
  });
  if (!sure) return;
  try {
    if (unsent) await state.store.discardPending(session.id);
    else await state.store.deleteLog(session.id);
    announce(unsent ? "Session thrown away" : "Session deleted");
    render();
  } catch (error) {
    report(error);
  }
}

async function removeClipFrom(session) {
  const sure = await askToConfirm({
    title: "Remove the recording?",
    message: "The audio is deleted for good. The session, its minutes and anything your "
      + "instructor wrote stay where they are.",
    confirmText: "Remove it",
  });
  if (!sure) return;
  try {
    await state.store.removeClip(session.id);
    announce("Recording removed");
    render();
  } catch (error) {
    report(error);
  }
}

async function finishAssignment(assignment) {
  const sure = await askToConfirm({
    title: `Finish “${assignment.title}”?`,
    message: "It stops being assigned after this week. Everything logged against it stays, and this "
      + "week still counts.",
    confirmText: "Finish it",
    cancelText: "Keep it running",
  });
  if (!sure) return;
  try {
    await state.store.closeAssignment(assignment.id, state.store.weeks().at(-1).end);
    announce(`Finished ${assignment.title}`);
    render();
  } catch (error) {
    report(error);
  }
}

function spanFor(store) {
  const weeks = store.weeks();
  const studio = store.studio();
  const zone = studio.time_zone;
  const startsOn = studio.week_starts_on;
  const now = weeks[weeks.length - 1].start;
  const held = state.viewedSpan;

  if (held?.kind === "season") {
    const { weeks: inSeason, termName } = seasonWeeks({
      terms: store.terms(),
      studioCreatedAt: studio.created_at,
      now: weeks[weeks.length - 1].end > new Date() ? new Date() : weeks[weeks.length - 1].start,
      weekStartsOn: startsOn,
      timeZone: zone,
    });
    const gridStarts = new Set(weeks.map((w) => w.start.getTime()));
    const clamped = inSeason.filter((w) => gridStarts.has(w.start.getTime()));
    const shown = clamped.length ? clamped : [weeks[weeks.length - 1]];
    return {
      kind: "season",
      weeks: shown,
      title: spanTitle("season", { now, weeks: shown, timeZone: zone, weekStartsOn: startsOn, termName }),
      subtitle: spanSubtitle(shown, zone),
      periodName: "the same stretch before it",
    };
  }

  if (held?.kind === "custom") {
    const from = new Date(held.fromMs);
    const to = new Date(held.toMs);
    const inRange = customWeeks(from, to, now, startsOn, zone);
    const gridStarts = new Set(weeks.map((w) => w.start.getTime()));
    const clamped = inRange.filter((w) => gridStarts.has(w.start.getTime()));
    const shown = clamped.length ? clamped : [weeks[weeks.length - 1]];
    const civil = (ms) => {
      const { year, month, day } = civilDate(new Date(ms), zone);
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    };
    return {
      kind: "custom",
      weeks: shown,
      title: spanTitle("custom", { now, weeks: shown, timeZone: zone, weekStartsOn: startsOn }),
      subtitle: spanSubtitle(shown, zone),
      periodName: "the stretch before it",
      fromValue: civil(held.fromMs),
      toValue: civil(held.toMs),
    };
  }

  if (held?.kind === "term") {
    const term = termsFrom(store.terms()).find((t) => t.id === held.termId);
    if (term) {
      const weeks = pastTermWeeks({
        startsOn: term.startsOn,
        endsOn: term.endsOn ?? null,
        studioCreatedAt: store.studio().created_at,
        now,
        weekStartsOn: startsOn,
        timeZone: zone,
      });
      return {
        kind: "term",
        termId: term.id,
        weeks,
        title: term.name,
        subtitle: spanSubtitle(weeks, zone),
        periodName: "the season before it",
      };
    }
  }

  if (held?.kind === "month") {
    const anchor = new Date(held.anchorMs);
    const inMonth = monthWeeks(anchor, now, startsOn, zone);
    const gridStarts = new Set(weeks.map((w) => w.start.getTime()));
    const clamped = inMonth.filter((w) => gridStarts.has(w.start.getTime()));
    const shown = clamped.length ? clamped : [weeks[weeks.length - 1]];
    return {
      kind: "month",
      weeks: shown,
      title: spanTitle("month", { anchor, now, weeks: shown, timeZone: zone, weekStartsOn: startsOn }),
      subtitle: spanSubtitle(shown, zone),
      periodName: "the month before",
    };
  }

  let week = weeks[weeks.length - 1];
  if (held?.kind === "week" && held.anchorMs != null) {
    week = weeks.find((w) => w.start.getTime() === held.anchorMs) ?? week;
  }
  return {
    kind: "week",
    weeks: [week],
    title: null,
    subtitle: null,
    periodName: "the week before",
  };
}

function welcomeKey() {
  const who = state.store?.profile?.()?.id ?? "anon";
  return `${who}:${state.store?.isInstructor ? "instructor" : "performer"}`;
}

function hasSeenWelcome() {
  if (state.inDemo) return state.demoWelcomedSeats.has(welcomeSeat());
  return seenWelcomes().has(welcomeKey());
}

function markWelcome() {
  if (state.inDemo) {
    state.demoWelcomedSeats.add(welcomeSeat());
    return;
  }
  markWelcomeSeen(welcomeKey());
}

function welcomeSeat() {
  return state.store?.isInstructor ? "instructor" : "performer";
}

async function openWelcomeIfNew() {
  if (state.welcome !== null) return;
  if (hasSeenWelcome()) return;

  if (!state.vocabulary) await loadExportedWords();

  const help = state.vocabulary?.help;
  const records = state.store?.studio?.()?.records_audio !== false;
  const pages = state.store?.isInstructor
    ? (records ? help?.instructor : help?.instructorSilent ?? help?.instructor)
    : (records ? help?.performer : help?.performerSilent ?? help?.performer);
  if (!pages?.length) return;

  markWelcome();
  state.welcome = 0;
}

function currentRoute() {
  const hash = location.hash || "#/";
  if (state.mode !== "studio") return "#/";
  const tabs = tabsFor(state.store).map((t) => t.href);
  const allowed = [...tabs, ...extraRoutesFor(state.store)];
  if (!allowed.includes(hash)) return tabs[0];
  return hash;
}

function show(...nodes) {
  mounted?.dispose?.();
  mounted = nodes.find((n) => n?.dispose) ?? null;
  replace(root, ...nodes);
}

let announcedScreen = null;

function render() {
  paintScreen();

  const name = document.title.replace(/ · IPT(?: demo)?$/, "");
  if (name === announcedScreen) return;
  announcedScreen = name;
  announce(name);

  const heading = root.querySelector("h1");
  if (!heading) return;
  heading.setAttribute("tabindex", "-1");
  heading.focus();
}

function paintScreen() {
  const isDemo = state.inDemo;

  if (state.welcome !== null && state.mode === "studio") {
    show(welcomeScreen(state.store, {
      help: state.vocabulary?.help ?? null,
      page: state.welcome,
      onPage: (n) => { state.welcome = n; render(); },
      onFinish: () => { state.welcome = null; markWelcome(); render(); },
    }));
    document.title = titleFor("Welcome");
    return;
  }

  if (state.resettingPassword) {
    show(resetPasswordScreen({
      busy: state.auth.busy,
      problem: state.auth.problem,
      onSave: saveNewPassword,
    }));
    document.title = "Choose a new password · IPT";
    return;
  }

  if (state.mode === "door") {
    show(doorScreen({
      mode: state.auth.mode,
      value: state.auth.email,
      problem: state.auth.problem,
      message: state.auth.message,
      busy: state.auth.busy,
      draft: state.auth.draft ?? null,
      onSignIn: handleSignIn,
      onSignUp: handleSignUp,
      onForgot: sendPasswordReset,
      onModeChange: (mode) => {
        state.auth = { mode, problem: null, message: null, busy: false, email: state.auth.email };
        render();
      },
      onEnterDemo: enterDemo,
      onInstall: installEvent ? offerInstall : null,
    }));
    document.title = "IPT: Individual Practice Time";
    return;
  }

  if (state.mode === "parentRoute") {
    show(parentRouteScreen({
      onContinueAsParent: () => {
        state.mode = "door";
        state.auth = { ...state.auth, mode: "signUp", asParent: true, problem: null };
        render();
        announce("Continuing as a parent or guardian");
      },
      onBack: () => {
        state.mode = "door";
        state.auth = {
          mode: "signIn", problem: null, message: null, busy: false,
          email: state.auth.email, asParent: false,
        };
        render();
      },
    }));
    document.title = titleFor("Setting up an account");
    return;
  }

  if (state.mode === "confirm") {
    show(confirmScreen({
      email: state.auth.email,
      message: state.auth.message,
      busy: state.auth.busy,
      onResend: handleResend,
      onBack: () => {
        state.mode = "door";
        state.auth = { mode: "signIn", problem: null, message: null, busy: false, email: state.auth.email };
        render();
      },
    }));
    document.title = titleFor("Confirm your email");
    return;
  }

  if (state.mode === "setup") {
    if (!state.weekStarts.length) loadWeekStarts();
    show(studioSetupScreen({
      profile: state.store.profile(),
      problem: state.auth.problem,
      busy: state.auth.busy,
      onCreate: handleCreateStudio,
      weekStarts: state.weekStarts,
      onJoin: handleJoinStudio,
      onSignOut: handleSignOut,
      onCancel: state.store.hasStudio
        ? () => { state.mode = "studio"; state.auth = { ...state.auth, problem: null }; render(); }
        : null,
    }));
    document.title = titleFor("Your studio");
    return;
  }

  if (state.viewing) {
    if (!state.selfReportMark) loadSessionMark();
    show(performerScreen(state.store, {
      performer: state.viewing.performer,
      ...spanControls(state.store),
      selfReportMark: state.selfReportMark,
      suggestions: state.suggestions,
      busy: state.auth.busy,
      problem: state.viewing.problem,
      onNudge: sendNudge,
      onBack: () => { state.viewing = null; render(); },
    }));
    document.title = titleFor(state.viewing.performer.display_name);
    return;
  }

  if (state.editing) {
    show(assignmentEditorScreen(state.store, {
      assignment: state.editing.assignment,
      busy: state.auth.busy,
      problem: state.editing.problem,
      onSave: saveAssignment,
      onCancel: () => { state.editing = null; render(); },
      onDelete: state.editing.assignment ? removeAssignment : null,
      guidanceNote: state.guidanceNote,
    }));
    loadGuidance();
    document.title = titleFor(state.editing.assignment ? "Edit assignment" : "New assignment");
    return;
  }

  if (state.session) {
    show(sessionScreen(state.store, {
      assignment: state.session.assignment,
      capabilities: state.session.capabilities,
      countIns: state.session.countIns ?? [],
      countInSeconds: countInSeconds(),
      startedAt: state.session.startedAt,
      draft: state.session.draft,
      onCountIn: (seconds) => { saveCountInSeconds(seconds); },
      onSave: saveSession,
      onBlocked: state.inDemo ? ((name) => showPrompt(name)) : null,
      onCancel: () => {
        state.session = null;
        clearOpenSession();
        render();
        announce("Session discarded");
      },
    }));
    document.title = titleFor("Practicing");
    return;
  }

  const route = currentRoute();
  const store = state.store;
  const onPrompt = isDemo ? ((name) => showPrompt(name)) : null;

  let screen;
  let title;
  switch (route) {
    case "#/assignments":
      screen = assignmentsScreen(store, {
        onPrompt,
        onNew: () => { state.editing = { assignment: null }; render(); },
        onEdit: (assignment) => { state.editing = { assignment }; render(); },
        onFinish: finishAssignment,
        onDuplicate: (assignment) => {
          state.editing = { assignment: duplicateOf(assignment) };
          render();
          announce(`Setting ${assignment.title} again. Check it over and save`);
        },
      });
      title = "Assignments";
      break;
    case "#/listening":
      if (!state.playbackRates.length) loadPlaybackRates();
      screen = listeningScreen(store, {
        rate: state.playbackRate,
        rates: state.playbackRates,
        onRateChange: (value) => { state.playbackRate = value; },
        clipURL: (path) => store.clipURL(path),
        onAcknowledge: acknowledge,
        onBack: () => { location.hash = "#/studio"; },
      });
      title = "Listening";
      break;
    case "#/standings":
      screen = isDemo || store.standingsAvailable
        ? standingsScreen(store, {
          onDisplay: store.isInstructor && (isDemo || store.standingsAvailable)
            ? () => { location.hash = "#/display"; }
            : null,
        })
        : standingsUnavailableScreen();
      title = "Standings";
      break;
    case "#/add-session":
      screen = addSessionScreen(store, {
        busy: state.addSession.busy,
        problem: state.addSession.problem,
        onCancel: () => go("#/practice"),
        onSave: addSession,
      });
      title = "Add practice";
      break;
    case "#/season":
      screen = seasonScreen(store, {
        canShare: typeof navigator !== "undefined" && typeof navigator.share === "function",
        said: state.seasonSaid,
        onCopy: copySeason,
        onShare: shareSeason,
        report: state.report,
      });
      loadReport();
      title = "The season";
      break;
    case "#/display":
      screen = displayScreen(store, {
        awake: wakeSupported,
        onExit: leaveDisplay,
      });
      screen.dispose = holdDisplay();
      title = "Display";
      break;
    case "#/help":
      screen = helpScreen(store, {
        help: state.vocabulary?.help ?? null,
        supportEmail: state.vocabulary?.supportEmail || null,
        onBack: () => { location.hash = "#/you"; },
      });
      title = "How IPT works";
      if (!state.vocabulary) loadExportedWords();
      break;
    case "#/terms":
      screen = termsScreen(store, {
        onSave: saveTerm,
        onDelete: deleteTerm,
        onBack: () => { location.hash = "#/you"; },
        busy: state.settings.busy,
        problem: state.settings.problem,
      });
      title = "Terms";
      break;
    case "#/scoring":
      screen = scoringScreen(store, {
        presets: state.vocabulary?.scoringPresets ?? [],
        onChoose: chooseScoring,
        onBack: () => { location.hash = "#/you"; },
        busy: state.settings.busy,
        problem: state.settings.problem,
      });
      title = "Scoring";
      if (!state.vocabulary) loadExportedWords();
      break;
    case "#/roster":
      screen = rosterScreen(store, {
        onSetRole: setMemberRole,
        onRemove: removeMember,
        onHandOver: handOverStudio,
        onCorrect: correctMember,
        onBack: () => { location.hash = "#/you"; },
        busy: state.settings.busy,
        problem: state.settings.problem,
      });
      title = "Roster";
      break;
    case "#/reminders":
      loadPush();
      screen = remindersScreen({
        capability: state.push?.capability() ?? null,
        subscribed: state.reminders.subscribed,
        configured: remindersConfigured(),
        preferences: state.push?.preferences() ?? null,
        volumes: state.vocabulary?.notificationVolumes ?? [],
        isInstructor: store.isInstructor,
        busy: state.reminders.busy,
        problem: state.reminders.problem,
        onVolume: setReminderVolume,
        onPreference: setReminderPreference,
        onEnable: enableReminders,
        onDisable: disableReminders,
      });
      title = "Reminders";
      if (!state.vocabulary && !isDemo) loadExportedWords();
      if (!isDemo) refreshSubscription();
      break;
    case "#/you":
      if (state.purchase === undefined && !state.loadingPurchase) {
        state.loadingPurchase = true;
        store.accountPurchase()
          .then((row) => { state.purchase = row; render(); })
          .catch(() => {})
          .finally(() => { state.loadingPurchase = false; });
      }
      screen = youScreen(store, {
        purchase: state.purchase,
        onCreateAccount: state.inDemo ? () => { leaveDemo(); goToSignUp(); } : null,
        scoringPresets: state.vocabulary?.scoringPresets ?? [],
        onHelp: () => { location.hash = "#/help"; },
        onLeave: isDemo ? leaveDemo : null,
        onLeaveStudio: store.studio()?.owner_id && store.studio().owner_id !== store.profile().id
          ? leaveStudio
          : null,
        onSaveProfile: isDemo ? null : saveProfile,
        onSaveEmail: isDemo ? null : changeEmail,
        onExport: isDemo ? null : exportEverything,
        exporting: state.exporting,
        onDeleteStudio: !isDemo && store.studio()?.owner_id === store.profile().id
          ? deleteStudioAndLeave
          : null,
        onSignOut: isDemo ? null : handleSignOut,
        onDeleteAccount: isDemo ? null : deleteAccount,
        offer: isDemo ? store.offer() : null,
        outbox: state.outbox,
        onSwitchStudio: switchStudio,
        durable: state.durableStorage,
        onInstall: installEvent ? offerInstall : null,
        onAnotherStudio: () => {
          state.mode = "setup";
          state.auth = { ...state.auth, problem: null, message: null };
          render();
        },
        onTerms: store.isInstructor
          ? () => { location.hash = "#/terms"; }
          : null,
        onScoring: store.isInstructor
          ? () => { location.hash = "#/scoring"; }
          : null,
        onRoster: store.isInstructor
          ? () => { location.hash = "#/roster"; }
          : null,
        onSetRecordsAudio: store.isInstructor ? setRecordsAudio : null,
        onReminders: isDemo ? null : () => { location.hash = "#/reminders"; },
        onSeason: () => { location.hash = "#/season"; },
      });
      title = "You";
      break;
    case "#/practice":
      if (!state.selfReportMark) loadSessionMark();
      screen = practiceScreen(store, {
        onPrompt,
        onClipURL: (path) => store.clipURL(path),
        ...spanControls(store),
        seenMilestoneKeys: isDemo ? state.demoMilestonesSeen : seenMilestones(),
        onMilestoneSeen: (milestone) => {
          const me = store.profile();
          if (isDemo) state.demoMilestonesSeen.add(`${me.id}-${milestone.id}`);
          else markMilestoneSeen(me.id, milestone.id);
          render();
          document.getElementById("main")?.focus();
        },
        onPractice: startSession,
        onDeleteSession: isDemo ? null : deleteSession,
        onRemoveClip: removeClipFrom,
        onNudgeSeen: isDemo ? null : markSeenOnce,
        onAddSession: () => go("#/add-session"),
        selfReportMark: state.selfReportMark,
      });
      title = "Practice";
      break;
    default:
      loadStudioOffers();
      screen = studioScreen(store, {
        onPrompt,
        ...spanControls(store),
        rosterSearch: state.rosterSearch,
        onRosterSearch: (value) => {
          const field = document.getElementById("roster-search");
          const at = field ? field.selectionStart : null;
          state.rosterSearch = value;
          render();
          const again = document.getElementById("roster-search");
          if (!again) return;
          again.focus();
          if (at !== null) again.setSelectionRange(at, at);
        },
        quiet: state.studioOffers?.quiet ?? null,
        onDeclareBreak: declareBreak,
        onDismissBreak: () => { state.dismissedBreak = true; render(); announce("Left as it is"); },
        season: state.studioOffers?.season ?? null,
        onSetUpSeason: () => { location.hash = "#/terms"; },
        onDismissSeason: () => { state.dismissedSeason = true; render(); announce("Left as it is"); },
        onOpenPerformer: openPerformer,
        onListen: () => { location.hash = "#/listening"; },
        onAssign: () => { state.editing = { assignment: null }; render(); },
      });
      title = "Studio";
  }

  const fullBleed = route === "#/display";
  document.body.classList.toggle("no-chrome", fullBleed);
  show(
    !fullBleed && isDemo && demoBar(),
    state.offline && offlineBar(),
    screen,
    !fullBleed && tabBar(route),
  );
  document.title = isDemo ? titleFor(title) : `${title} · ${store.studio()?.name ?? "IPT"}`;
}


async function attempt(work) {
  state.auth = { ...state.auth, busy: true, problem: null };
  render();
  try {
    await work();
  } catch (error) {
    state.auth = { ...state.auth, busy: false, problem: null };
    if (error instanceof DemoBlocked) {
      render();
      showPrompt(error.action);
      return;
    }
    if (error instanceof StoreError && error.kind === "needsAccount") {
      render();
      report(error);
      return;
    }
    state.auth = { ...state.auth, problem: error.message ?? String(error) };
    render();
  }
}

function handleSignIn({ email, password, sharedDevice = false }) {
  return attempt(async () => {
    state.auth.email = email;
    useSharedDevice(sharedDevice);
    await signIn({ email, password });
    await enterStudio();
  });
}

function handleSignUp({ email, password, displayName, role, bornOn }) {
  const outcome = outcomeFor(bornOn);
  if (outcome === "needsAParent" && state.auth.asParent) {
  } else if (outcome !== "mayCreateAccount") {
    state.mode = outcome === "needsAParent" ? "parentRoute" : "door";
    state.auth = {
      ...state.auth,
      busy: false,
      draft: { displayName, bornOn, role },
      email,
      problem: outcome === "implausible"
        ? "Check the date of birth. That one isn't a date anybody was born on."
        : null,
    };
    render();
    if (outcome === "needsAParent") announce("A parent or guardian sets this account up");
    return;
  }

  return attempt(async () => {
    state.auth.email = email;
    state.auth.draft = null;
    const { confirmed } = await signUp({ email, password, displayName, role });
    if (!confirmed) {
      state.mode = "confirm";
      state.auth = { ...state.auth, busy: false, message: null };
      render();
      announce("Check your email");
      return;
    }
    await enterStudio();
  });
}

function handleResend() {
  return attempt(async () => {
    await resendConfirmation(state.auth.email);
    state.auth = { ...state.auth, busy: false, message: "Sent. It can take a minute to arrive." };
    render();
  });
}

async function handleSignOut() {
  await state.store?.signOut?.();
  state.store = null;
  state.viewedSpan = null;
  state.session = null;
  state.editing = null;
  state.viewing = null;
  state.purchase = undefined;
  state.outbox = null;
  seenNudges.clear();
  state.mode = "door";
  state.auth = { mode: "signIn", problem: null, message: null, busy: false, email: "" };
  location.hash = "#/";
  render();
  announce("Signed out");
}

function handleCreateStudio(name, weekStartsOn) {
  return attempt(async () => {
    await state.store.createStudio({ name, weekStartsOn });
    await afterStudioChange(`${name} is ready`);
  });
}

function handleJoinStudio(code) {
  return attempt(async () => {
    if (!isPlausibleJoinCode(code)) {
      throw new Error(
        "That code has a character a join code never uses. Codes leave out O, 0, I, 1, L, S, 5, " +
        "B, 8, Z and 2 so they survive being read out. Check it and try again.",
      );
    }
    const studio = await state.store.joinStudio(code);
    await afterStudioChange(`Joined ${studio.name}`);
  });
}

async function switchStudio(id) {
  try {
    await state.store.selectStudio(id);
    await afterStudioChange(`${state.store.studio().name} is open`);
  } catch (error) {
    report(error);
  }
}

async function afterStudioChange(message) {
  state.auth = { ...state.auth, busy: false, problem: null };
  state.mode = "studio";
  await openWelcomeIfNew();
  location.hash = tabsFor(state.store)[0].href;
  await refreshOutbox();
  syncReminderPlan(state.store);
  render();
  announce(message);
}

async function enterStudio() {
  state.store = await SupabaseStore.open();
  state.viewedSpan = null;
  state.inDemo = false;
  forgetExportedWords();
  state.session = null;
  state.purchase = undefined;
  state.auth = { ...state.auth, busy: false, problem: null, message: null };

  requestDurableStorage()
    .then((result) => {
      if (state.durableStorage?.granted === result.granted) return;
      state.durableStorage = result;
      render();
    })
    .catch(() => {});

  if (!state.store.hasStudio) {
    state.mode = "setup";
    render();
    return;
  }

  state.mode = "studio";
  await openWelcomeIfNew();
  await state.store.applyPending();
  await refreshOutbox();
  syncReminderPlan(state.store);

  const home = tabsFor(state.store)[0].href;
  const wanted = tabsFor(state.store).some((t) => t.href === location.hash) ? location.hash : home;
  if (location.hash === wanted) render();
  else location.hash = wanted;

  announce(`${state.store.studio().name}, viewing as ${state.store.role}`);
  offerInterruptedSession();
  setTimeout(() => document.getElementById("main")?.focus(), 0);
  drainOutbox();
}

function beatOpenSession() {
  if (!state.session || !state.store) return;
  saveOpenSession({
    assignmentId: state.session.assignment.id,
    performerId: state.store.profile()?.id,
    startedAt: state.session.startedAt,
    note: state.session.draft?.note ?? "",
    markers: state.session.draft?.markers ?? [],
  });
}

setInterval(beatOpenSession, HEARTBEAT_MS);

async function offerInterruptedSession() {
  const held = readOpenSession();
  if (!held) return;

  const me = state.store?.profile()?.id;
  const assignment = state.store?.assignments()?.find((a) => a.id === held.assignmentId);
  if (!sessionBelongsTo(held, me) || !assignment) { clearOpenSession(); return; }

  const floor = state.store.rules().minimumCountableSession;
  const offer = offerFor(held, new Date(), floor);
  if (offer === "nothingToKeep") {
    clearOpenSession();
    return;
  }

  const sure = await askToConfirm({
    title: "Pick up where you left off?",
    message: `You had a session running on ${assignment.title}. `
      + `It counted ${longDuration(watchedSeconds(held))} before this tab closed.`,
    confirmText: "Save those minutes",
    cancelText: "Throw it away",
  });
  clearOpenSession();
  if (!sure) return;

  try {
    await state.store.logPractice({
      assignmentId: held.assignmentId,
      startedAt: held.startedAt,
      duration: watchedSeconds(held),
      note: held.note.trim() || null,
      clip: null,
      clipDuration: null,
      markers: [],
      focusPointIds: [],
    });
    await refreshOutbox();
    render();
    announce("Session saved");
  } catch (error) {
    report(error);
  }
}


async function startSession(assignment) {
  const [capabilities, words] = await Promise.all([
    recordingCapability(assignment),
    vocabulary().then((v) => v.countIns).catch(() => []),
  ]);
  state.session = {
    assignment,
    capabilities,
    countIns: words,
    startedAt: new Date(),
    draft: { note: "", ticked: [], markers: [] },
  };
  render();
  document.getElementById("main")?.focus();
  announce(`Practicing ${assignment.title}`);
}

async function recordingCapability(assignment) {
  if (state.store?.studio?.()?.records_audio === false) {
    return { canRecord: false, reason: null };
  }

  const { capabilities, openMicrophone, record, secondsBeforeLimit, takeSeconds } =
    await import("./recorder.js");
  const caps = await capabilities();
  if (!caps.canProduceCompatibleClip) {
    return {
      canRecord: false,
      reason: caps.canRecord
        ? "This browser can't record in a format your instructor's phone can play, so this session " +
          "saves without a take. Chrome, Edge and Safari all can."
        : "This browser won't give a page a microphone, so this session saves without a take.",
    };
  }
  const limit = takeSeconds(assignment?.take_minutes ?? null);
  return {
    canRecord: true,
    maxSeconds: limit,
    remaining: (elapsed) => secondsBeforeLimit(elapsed, limit),
    async start({ onTick } = {}) {
      const stream = await openMicrophone();
      const controller = new AbortController();
      const done = record(stream, { onTick, signal: controller.signal, maxSeconds: limit })
        .finally(() => stream.getTracks().forEach((track) => track.stop()));
      return { stop: () => controller.abort(), done };
    },
  };
}

async function saveSession(draft) {
  const assignment = state.session?.assignment;
  const week = state.store.weeks().at(-1);

  try {
    await state.store.logPractice({ ...draft, studioId: state.store.studioId });
  } catch (error) {
    report(error);
    return;
  }

  state.session = null;
  clearOpenSession();
  for (const focusPointId of week ? draft.focusPointIds ?? [] : []) {
    state.store.setFocusMark({
      focusPointId,
      assignmentId: assignment.id,
      weekStart: week.start,
      worked: true,
    }).catch(() => {});
  }

  await refreshOutbox();
  render();
  announce("Session saved");
}

const seenNudges = new Set();

function markSeenOnce(nudge) {
  if (seenNudges.has(nudge.id)) return;
  seenNudges.add(nudge.id);
  state.store.markNudgeSeen(nudge.id);
}

async function openPerformer(performer) {
  if (!state.suggestions.length) {
    try { state.suggestions = (await vocabulary()).nudgeSuggestions ?? []; } catch { /* the box still works */ }
  }
  state.viewing = { performer };
  render();
  document.getElementById("main")?.focus();
}

async function sendNudge(message) {
  if (!message) {
    state.viewing = { ...state.viewing, problem: "Write something first." };
    render();
    return;
  }
  state.auth = { ...state.auth, busy: true };
  render();
  try {
    await state.store.sendNudge({ to: state.viewing.performer.id, message });
    state.auth = { ...state.auth, busy: false };
    state.viewing = null;
    render();
    announce("Sent");
  } catch (error) {
    state.auth = { ...state.auth, busy: false };
    if (error instanceof DemoBlocked) {
      state.viewing = { ...state.viewing, problem: null };
      render();
      showPrompt(error.action);
      return;
    }
    if (error instanceof StoreError && error.kind === "needsAccount") { render(); report(error); return; }
    state.viewing = { ...state.viewing, problem: error.message ?? String(error) };
    render();
  }
}

async function deleteAccount() {
  const cost = deletionCost({
    studios: state.store.joinedStudios?.() ?? [],
    logs: state.store.logs(),
    roster: state.store.roster(),
    profileId: state.store.profile()?.id,
    selectedStudioId: state.store.studio()?.id ?? null,
  });

  const lines = [cost.phrase];
  if (cost.affectsOthers) {
    lines.push("The people in your studios lose everything they logged, and they aren't told.");
  }
  if (cost.succession) lines.push(cost.succession);
  lines.push("It cannot be undone, and support cannot bring it back.");

  const sure = await askToConfirm({
    title: "Delete your account?",
    message: lines.join(" "),
    confirmText: "Delete my account",
    cancelText: "Keep my account",
    typeToConfirm: "DELETE",
  });
  if (!sure) return;
  try {
    await state.store.deleteAccount();
    state.store = null;
    state.viewedSpan = null;
    state.mode = "door";
    state.auth = { mode: "signIn", problem: null, message: "Your account is gone.", busy: false, email: "" };
    location.hash = "#/";
    render();
    announce("Account deleted");
  } catch (error) {
    report(error);
  }
}

async function saveAssignment(draft) {
  state.auth = { ...state.auth, busy: true };
  state.editing = { ...state.editing, problem: null };
  render();
  try {
    const existing = state.editing.assignment;
    if (existing?.id) await state.store.updateAssignment(existing.id, draft);
    else await state.store.createAssignment(draft);
    state.editing = null;
    state.auth = { ...state.auth, busy: false };
    render();
    announce(existing?.id ? "Assignment saved" : "Assignment created");
  } catch (error) {
    state.auth = { ...state.auth, busy: false };
    if (error instanceof DemoBlocked) {
      state.editing = { ...state.editing, problem: null };
      render();
      showPrompt(error.action);
      return;
    }
    if (error instanceof StoreError && error.kind === "needsAccount") { render(); report(error); return; }
    state.editing = { ...state.editing, problem: error.message ?? String(error) };
    render();
  }
}

async function removeAssignment() {
  const assignment = state.editing?.assignment;
  if (!assignment) return;
  const cost = assignmentCost({ logs: state.store.logs(), assignmentId: assignment.id });
  const sure = await askToConfirm({
    title: `Delete “${assignment.title}”${cost.titleTail}?`,
    message: cost.phrase,
    confirmText: "Delete it",
  });
  if (!sure) return;

  try {
    await state.store.deleteAssignment(assignment.id);
    state.editing = null;
    render();
    announce("Assignment deleted");
  } catch (error) {
    report(error);
  }
}

async function acknowledge(log, note) {
  try {
    await state.store.acknowledgeLog(log.id, note);
    announce("Heard");
  } catch (error) {
    report(error);
    throw error;
  }
}


async function settingsWrite(work) {
  state.settings = { busy: true, problem: null };
  render();
  let ok = true;
  try {
    await work();
    state.settings = { busy: false, problem: null };
  } catch (error) {
    ok = false;
    if (error instanceof DemoBlocked) {
      state.settings = { busy: false, problem: null };
      showPrompt(error.action);
    } else {
      state.settings = { busy: false, problem: humanProblem(error) };
    }
  }
  render();
  return ok;
}

function humanProblem(error) {
  return error?.body?.message || error?.message || "That didn't work. Try again in a moment.";
}

async function saveTerm(draft) {
  const problems = termProblems(draft);
  if (problems.length > 0) {
    state.settings = { busy: false, problem: problems.join(" ") };
    render();
    return;
  }
  await settingsWrite(async () => {
    await state.store.saveTerm({
      name: draft.name.trim(),
      startsOn: new Date(`${draft.startsOn}T00:00:00`).toISOString(),
      endsOn: draft.endsOn ? new Date(`${draft.endsOn}T00:00:00`).toISOString() : null,
    });
    announce(`Added the term ${draft.name.trim()}`);
  });
}

async function deleteTerm(term) {
  const sure = await askToConfirm({
    title: `Delete the term “${term.name}”?`,
    message: "No practice is deleted. The weeks it covered stop counting as term time, which can " +
      "only lengthen somebody's streak.",
    confirmText: "Delete the term",
  });
  if (!sure) return;
  await settingsWrite(async () => {
    await state.store.deleteTerm(term.id);
    announce(`Deleted the term ${term.name}`);
  });
}

async function setRecordsAudio(wanted) {
  if (!wanted) {
    const sure = await askToConfirm({
      title: "Turn recording off for this studio?",
      message: "Nobody is offered a record button, and clips are worth no points. Recordings " +
        "already made are untouched, and turning it back on restores their points.",
      confirmText: "Turn recording off",
    });
    if (!sure) return;
  }
  await settingsWrite(async () => {
    await state.store.setRecordsAudio(wanted);
    announce(wanted ? "Recording turned on" : "Recording turned off");
  });
}

async function chooseScoring(preset) {
  await settingsWrite(async () => {
    await state.store.setScoring(preset.rules);
    announce(`Scoring set to ${preset.title}`);
  });
  document.querySelector('.options [aria-checked="true"]')?.focus();
}

async function correctMember(member, correction) {
  await settingsWrite(async () => {
    await state.store.correctMember(member.id, correction);
    announce(correction.displayName
      ? `This studio now shows ${correction.displayName}`
      : `${member.account_display_name} is shown as they typed it again`);
  });
}

async function setMemberRole(member, role) {
  const becomingInstructor = role === "instructor";
  const sure = await askToConfirm({
    title: becomingInstructor
      ? `Make ${member.display_name} an instructor?`
      : `Make ${member.display_name} a performer?`,
    message: becomingInstructor
      ? "They'll be able to assign practice, hear everyone's clips and read every note. They come " +
        "off the leaderboard, and any practice they've logged stops counting toward it."
      : "They go back on the leaderboard, and they stop being able to assign work or hear " +
        "anybody else's recordings.",
    confirmText: becomingInstructor ? "Make them an instructor" : "Make them a performer",
    cancelText: "Leave it as it is",
  });
  if (!sure) return;
  await settingsWrite(async () => {
    await state.store.setRole(member.id, role);
    announce(`${member.display_name} is now ${becomingInstructor ? "an instructor" : "a performer"}`);
  });
}

async function removeMember(member) {
  const sure = await askToConfirm({
    title: `Remove ${member.display_name} from the studio?`,
    message: removalCost({ logs: state.store.logs(), performerId: member.id }),
    confirmText: "Remove them",
  });
  if (!sure) return;
  await settingsWrite(async () => {
    await state.store.removeMember(member.id);
    announce(`Removed ${member.display_name}`);
  });
}

async function handOverStudio(member) {
  const sure = await askToConfirm({
    title: `Hand ${state.store.studio()?.name ?? "this studio"} to ${member.display_name}?`,
    message: "You'll stay an instructor here and keep everything you can do today, except owning "
      + "it. They'll be able to delete the studio and everyone's practice in it, and to remove "
      + "you. Only they can hand it back.",
    confirmText: "Hand it over",
    cancelText: "Keep it",
  });
  if (!sure) return;
  await settingsWrite(async () => {
    await state.store.transferStudio(member.id);
    announce(`${member.display_name} owns this studio now`);
  });
}


async function loadWeekStarts() {
  if (state.weekStarts.length) return;
  try {
    state.weekStarts = (await vocabulary()).weekStarts ?? [];
  } catch {
    state.weekStarts = [];
  }
  render();
}

async function loadPlaybackRates() {
  if (state.playbackRates.length) return;
  try {
    state.playbackRates = (await vocabulary()).playbackRates ?? [];
  } catch {
    state.playbackRates = [];
  }
  render();
}

async function loadSessionMark() {
  if (state.selfReportMark) return;
  try {
    state.selfReportMark = (await vocabulary()).selfReportMark ?? "";
  } catch {
    return;
  }
  render();
}

let wordsAsked = false;

function forgetExportedWords() {
  wordsAsked = false;
  state.vocabulary = null;
}

async function loadExportedWords() {
  if (wordsAsked) return;
  wordsAsked = true;
  try {
    state.vocabulary = await vocabulary();
  } catch {
    state.vocabulary = null;
  }
  render();
}

async function refreshSubscription() {
  const subscribed = (await (await pushing()).current()) != null;
  if (subscribed === state.reminders.subscribed) return;
  state.reminders = { ...state.reminders, subscribed };
  if (currentRoute() === "#/reminders") render();
}

function setReminderPreference(patch) {
  pushing().then((push) => push.savePreferences(patch)).catch(() => {});
  render();
  syncReminderPlan(state.store);
}

function setReminderVolume(volume) {
  pushing().then((push) => push.savePreferences({ volume })).catch(() => {});
  render();
  syncReminderPlan(state.store);

  const level = state.vocabulary?.notificationVolumes?.find((v) => v.name === volume);
  announce(`Reminders set to ${level?.label ?? volume}`);

  document.querySelector('.options [aria-checked="true"]')?.focus();
}

async function enableReminders() {
  state.reminders = { ...state.reminders, busy: true, problem: null };
  render();
  try {
    await (await pushing()).enable(state.store, CONFIG.vapidPublicKey);
    await syncReminderPlan(state.store);
    state.reminders = { busy: false, problem: null, subscribed: true };
    announce("Reminders are on for this browser");
  } catch (error) {
    state.reminders = {
      busy: false, problem: error.message, subscribed: (await (await pushing()).current()) != null,
    };
  }
  render();
}

async function disableReminders() {
  state.reminders = { ...state.reminders, busy: true, problem: null };
  render();
  try {
    await (await pushing()).disable(state.store);
    state.reminders = { busy: false, problem: null, subscribed: false };
    announce("Reminders are off for this browser");
  } catch (error) {
    state.reminders = {
      busy: false, problem: error.message, subscribed: (await (await pushing()).current()) != null,
    };
  }
  render();
}


async function refreshOutbox() {
  if (!state.store?.outboxStatus) return;
  try { state.outbox = await state.store.outboxStatus(); } catch { state.outbox = null; }
}

async function drainOutbox() {
  if (!state.store?.flush || state.inDemo) return;
  try {
    const result = await state.store.flush();
    state.offline = result.stillWaiting > 0 && !!result.lastError;
  } catch {
    state.offline = true;
  }
  await refreshOutbox();
  render();
}

addEventListener("online", () => {
  state.offline = false;
  drainOutbox();
});
addEventListener("offline", () => {
  state.offline = true;
  render();
});


async function enterDemo() {
  const { DemoStore } = await import("./demo.js");
  state.store = await DemoStore.open();
  state.viewedSpan = null;
  forgetExportedWords();
  state.demoMilestonesSeen = new Set();
  state.demoWelcomedSeats = new Set();
  state.inDemo = true;
  state.mode = "studio";
  state.store.viewAs("instructor");
  await openWelcomeIfNew();
  location.hash = "#/studio";
  render();
  announce("Demo studio, viewing as instructor");
  document.getElementById("main")?.focus();
}

function switchSeat(role) {
  if (state.store.role === role) return;
  state.store.viewAs(role);

  const target = tabsFor(state.store)[0].href;
  if (location.hash === target) render();
  else location.hash = target;

  announce(`Viewing as ${role}`);

  setTimeout(() => document.querySelector('.segmented [aria-checked="true"]')?.focus(), 0);
}

function goToSignUp() {
  state.auth = { ...state.auth, mode: "signUp", problem: null, message: null };
  render();
}

function leaveDemo() {
  state.inDemo = false;
  state.store = null;
  state.viewedSpan = null;
  forgetExportedWords();
  state.mode = "door";
  location.hash = "#/";
  render();
  announce("Left the demo");
}


if ("serviceWorker" in navigator) {
  addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
    });
  });
}

let installEvent = null;

addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installEvent = event;
  if (state.mode === "door") render();
});

addEventListener("appinstalled", () => {
  installEvent = null;
  if (state.mode === "door") render();
});

async function offerInstall() {
  if (!installEvent) return;
  const event = installEvent;
  installEvent = null;
  render();
  await event.prompt();
}

addEventListener("hashchange", () => {
  if (state.settings.problem) state.settings = { ...state.settings, problem: null };
  if (state.addSession.problem) state.addSession = { ...state.addSession, problem: null };

  if (state.editing) state.editing = null;
  if (state.viewing) state.viewing = null;

  render();
});

const observer = new MutationObserver(() => {
  const main = document.getElementById("main");
  if (main && !main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
});
observer.observe(root, { childList: true, subtree: true });


async function consumeAuthRedirect() {
  const intent = authRedirectIntent(location.hash);
  if (intent.kind === "none") return false;

  history.replaceState(null, "", `${location.pathname}${location.search}#/`);

  if (intent.kind === "error") {
    state.auth = { ...state.auth, problem: intent.problem };
    return false;
  }

  const isRecovery = intent.kind === "recovery";
  try {
    await adoptSession(intent.tokens);
  } catch (error) {
    if (isRecovery) {
      await supabaseSignOut();
      state.auth = { ...state.auth, problem: "That reset link has expired. Request a new one below." };
      return false;
    }
    throw error;
  }
  if (isRecovery) state.resettingPassword = true;
  return true;
}

function sendPasswordReset(email) {
  if (!email) {
    state.auth = { ...state.auth, problem: "Type your email above first, then try this again.", message: null };
    render();
    return;
  }
  return attempt(async () => {
    state.auth = { ...state.auth, email, message: null };
    await requestPasswordReset(email);
    state.auth = {
      ...state.auth,
      busy: false,
      message: `We sent a reset link to ${email}. It opens here, where you'll choose a new password.`,
    };
    render();
  });
}

function saveNewPassword(password) {
  if ((password ?? "").length < 8) {
    state.auth = { ...state.auth, problem: "At least 8 characters." };
    render();
    return;
  }
  return attempt(async () => {
    await updatePassword(password);
    state.resettingPassword = false;
    state.auth = { ...state.auth, message: null };
    await enterStudio();
  });
}

async function boot() {
  restoreSession();

  if (location.hash === "#/demo") {
    location.hash = "#/studio";
    await enterDemo();
    return;
  }

  try {
    await consumeAuthRedirect();
  } catch (error) {
    state.auth = { ...state.auth, problem: error.message ?? String(error) };
  }

  if (isSignedIn() && isConfigured()) {
    try {
      await enterStudio();
      return;
    } catch (error) {
      if (error instanceof StoreError && error.kind === "network") state.offline = true;
      else state.auth = { ...state.auth, problem: error.message ?? String(error) };
    }
  }
  render();
}

boot();
