/**
 * The shell: who is signed in, what is on screen, and the two things that can interrupt it.
 *
 * ## Routing is a hash, and that is a decision
 *
 * `#/studio` rather than `/studio`, because a path router needs the host to rewrite every unknown
 * path to `index.html` — and this app is meant to be servable by *anything* that serves static
 * files, including `python3 -m http.server`, which is what `make web` runs. A hash costs a
 * character in the URL and removes an entire class of "works locally, 404s in production".
 *
 * It costs one thing, and it is paid for in `adoptSession`: GoTrue's confirmation link comes back
 * as a **hash fragment**, so a route and a session arrive in the same place.
 *
 * ## One store interface, two implementations
 *
 * `DemoStore` and `SupabaseStore` answer the same questions in the same shapes, so the screens do
 * not know which one is behind them — that is the whole reason demo mode was built first, and it
 * is why nothing in `screens.js` had to change to gain a backend. What differs is here: what a
 * blocked write means, and what to do when one fails.
 *
 * ## A refusal is not a bad connection
 *
 * The two interruptions are deliberately not the same kind of thing:
 *
 *   · **A refusal** — the server has an opinion about this person, or about what they just tried.
 *     It has an actor and a moment, so it is an alert: something they did, answered.
 *   · **Losing signal** — a condition. It lasts, it recurs on every refresh, and there is nothing
 *     to acknowledge, so it is a quiet bar that clears itself. The modal version of that put a
 *     dialog over a performer's practice screen every time a band hall dropped a bar.
 *
 * That is the rule `CachingStore.swift` states, and it is the one this file exists to keep.
 */

import { el, replace } from "./dom.js";
import { field } from "./ui.js";
import { assignmentCost, deletionCost, removalCost } from "./listening.js";
import { markMilestoneSeen, seenMilestones } from "./milestones.js";
import { civilDate, instantAtCivilMidnight } from "./judgement.js";
import { customWeeks, pastTermWeeks, monthWeeks, seasonWeeks, spanSubtitle, spanTitle } from "./spans.js";
import { DemoBlocked, checkoutURLFor, vocabulary } from "./words.js";
import { countInSeconds, saveCountInSeconds } from "./recording-prefs.js";
import { declaringBreak, mostRecentQuiet } from "./quiet.js";
import { termsFrom } from "./terms.js";
import { SupabaseStore, isPlausibleJoinCode } from "./store.js";
import { CONFIG, isConfigured, remindersConfigured } from "./config.js";
import * as push from "./push.js";
import {
  adoptSession,
  isSignedIn,
  requestPasswordReset,
  resendConfirmation,
  signOut as supabaseSignOut,
  updatePassword,
  restoreSession,
  signIn,
  signUp,
  StoreError,
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
  youScreen,
} from "./screens.js";

const root = document.getElementById("app");
const announcer = document.getElementById("announcer");

/** Everything mutable about this sitting, in one place. */
const state = {
  /** "door" | "confirm" | "setup" | "studio" — where in the app somebody is, before routing. */
  mode: "door",
  store: null,
  inDemo: false,
  /** The door's own state: which form, what it is saying, and whether it is mid-request. */
  auth: { mode: "signIn", problem: null, message: null, busy: false, email: "" },
  /** The running practice session, if there is one. Never a route: a reload would lose the clock. */
  session: null,
  /** The assignment being written or edited: `{ assignment | null }`, or null for neither. */
  editing: null,
  /** The performer being looked at, if any. A state and not a route, like the editor. */
  viewing: null,
  /**
   * The dashboard's time range — null means the current week. `{kind: "week"|"month", anchorMs}`,
   * `{kind: "season"}`, or `{kind: "custom", fromMs, toMs}`; instants are epoch milliseconds so a strict comparison against the
   * grid needs no translation, and null rather than "the last week at load" so a tab left open
   * across Sunday midnight follows the studio into the new week instead of freezing in the old
   * one.
   */
  viewedSpan: null,
  /**
   * The demo's milestone ledger, per visit — the showroom seeds fresh people on every entry, so
   * a persisted key would be a permanent stain for looking around. Null outside the demo, where
   * the ledger is localStorage keyed by profile id (`milestones.js`).
   */
  demoMilestonesSeen: null,
  /** `Nudge.suggestions`, fetched once from the export the first time a nudge box is drawn. */
  suggestions: [],
  /**
   * `NotificationVolume`'s labels and "up to 6 a week" lines, fetched once.
   *
   * The same channel `DemoAction`'s copy and `Entitlement`'s offer travel on, for the same reason:
   * they are product sentences and a second set of them here would drift the first time either was
   * improved. Null until the reminders screen is opened — a client that never goes there never
   * fetches it.
   */
  vocabulary: null,
  /**
   * The reminders screen's own state. `busy` is a permission prompt in flight; `subscribed` is
   * **read back from the browser**, never inferred from `Notification.permission` — a browser can
   * hold permission and have no subscription at all.
   */
  reminders: { busy: false, problem: null, subscribed: false },
  /**
   * The three instructor settings screens — terms, scoring, roster — share one `busy` and one
   * `problem`, because only one of them is on screen at a time.
   *
   * **Declared here rather than invented by the first write.** `settingsWrite` assigns this key, so
   * until an instructor saved something it did not exist — and the `hashchange` handler reads
   * `state.settings.problem` on *every* navigation. It threw before reaching `render()`, which meant
   * **no tab in the web client changed the screen at all**: the hash moved, nothing redrew, and the
   * app looked frozen while reporting nothing on screen. Found by opening the demo and clicking a
   * tab; no gate saw it, because `main.js` is the one module no test imports.
   */
  settings: { busy: false, problem: null },
  addSession: { busy: false, problem: null },
  playbackRate: 1,
  playbackRates: [],
  selfReportMark: "",
  /** Mid password reset: the recovery link landed here and a new password is owed. */
  resettingPassword: false,
  /** What the season screen last said back — "Copied", or why it could not. */
  seasonSaid: null,
  /** Set when an instructor declines the break offer, for this sitting. */
  dismissedBreak: false,
  outbox: null,
  offline: false,
};

/**
 * The browser tab's name for a screen.
 *
 * **One place, because the demo suffix was being appended in one of two.** The route-driven screens
 * built their title as `… — IPT demo`; the four screens that are a *state* rather than a route — the
 * assignment editor, a performer, a running session, setup — wrote their own and said plain "IPT".
 * That was invisible while the demo could not reach the editor at all, and stopped being invisible
 * the moment it could: a director evaluating IPT had a tab claiming to be the real thing, next to
 * their own studio's tab, with nothing to tell them apart.
 */
function titleFor(name) {
  return state.inDemo ? `${name} · IPT demo` : `${name} · IPT`;
}

/** The screen currently mounted, so anything it owns can be torn down before it is replaced. */
let mounted = null;


/**
 * Tells a screen reader what just happened.
 *
 * A single-page app replaces its own content with no notice at all — WCAG 4.1.3 — so a route change
 * or a seat change is silent to anybody not looking at the screen. One polite live region for the
 * whole app, because two of them interrupt each other.
 */
function announce(message) {
  announcer.textContent = "";
  setTimeout(() => { announcer.textContent = message; }, 0);
}


/**
 * Raises a `<dialog>` and takes it away again, whichever way it is dismissed.
 *
 * **The `close` event is not something to rely on for cleanup.** Every prompt in v24 removed itself
 * from a `close` listener, and in the browser this was exercised in that event never fires at all:
 * `close()` hid the dialog and left the element in `<body>` forever, holding its closure with it.
 * Invisible, unbounded, and exactly the shape this project already has a rule about — *a browser's
 * answer about itself is a claim, not a fact.*
 *
 * **That fix covered the button and left the keyboard.** It made the dismiss path remove the node
 * itself and then said the listener "stays for the dismissals the browser owns, chiefly Escape" —
 * which hands the one path `dismiss()` never runs to the one event just measured as unreliable.
 * Re-measured 22 August in the same engine: `dialog.close()` sets `open` to false, fires **no**
 * `close` event, and leaves the node in the body. So a person who answers a destructive question
 * with Escape — the keyboard user this `<dialog>` was chosen for in the first place — leaves one
 * behind every time, and three of these are raised from this file.
 *
 * Both events, and neither trusted alone. `cancel` is the browser-owned dismissal and fires
 * *before* the close, so it can do the work; `close` stays for engines that fire it; `dismiss()`
 * still removes the node itself. Removing an already-removed node is a no-op, so all three
 * overlapping is a property rather than a risk — which is the point, since which of them runs is
 * a fact about the browser and not about this code.
 */
function raise(dialog) {
  const takeAway = () => { dialog.close(); dialog.remove(); };
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("cancel", takeAway);
  document.body.append(dialog);
  dialog.showModal();
  return takeAway;
}

/**
 * Explains the feature somebody just reached for, then offers the purchase.
 *
 * A native `<dialog>`, which is the accessible default: it traps focus, closes on Escape, marks the
 * rest of the page inert, and restores focus to whatever opened it — four things a div would each
 * have to be taught, and would be taught slightly wrong.
 *
 * The copy is `DemoAction`'s, exported from Swift, so both clients say the same words about the
 * same feature — and so does the *live* client, which raises this same prompt when `0005` refuses
 * a door for want of a purchase. The feature comes first and the price second, deliberately: a
 * prompt that opened with "Buy IPT to continue" would have spent the one moment somebody is
 * actually curious.
 */
/**
 * Asks before something irreversible, in the app's own voice.
 *
 * **Not `window.confirm`, which is what these were.** Four reasons, and only the first is about
 * looking nice:
 *
 *   · It is an operating-system box with none of this app's type, color or spacing in it.
 *   · **Chrome prefixes it with the origin** — "127.0.0.1:8788 says" — which on a school-issued
 *     Chromebook reads like the browser warning you about the page, at the exact moment somebody
 *     is deciding whether to trust what it says.
 *   · It flattens to one paragraph. *Name what a destructive action costs, in numbers* is a rule
 *     this product follows everywhere, and it needs a heading and a body to follow it.
 *   · It blocks the main thread, so nothing else in the app can even paint behind it.
 *
 * A native `<dialog>` is the accessible default — focus trapped, Escape closes, the rest of the page
 * inert, focus restored to whatever opened it — and `raise` already handles the teardown that the
 * `close` event does not.
 *
 * **Focus starts on the refusal**, and the refusal is a plain button rather than anything the
 * platform might decide not to draw. That is the rule this project already paid for on iOS, where a
 * `role: .cancel` button was silently dropped whenever a dialog was presented as a popover — leaving
 * "delete this and 33 logged sessions" with no visible way out.
 */
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
    ? { action: state.store.action(actionName), offer: state.store.offer() }
    : await vocabulary().then((v) => ({ action: v.actions[actionName], offer: v.offer }));
  const { action, offer } = words;
  if (!action) return;

  const promptBuyerLink = checkoutURLFor(
    offer,
    state.store && !state.store.isDemo ? state.store.profile()?.id : null,
  );

  let dismiss;
  const dialog = el(
    "dialog",
    { "aria-labelledby": "prompt-title" },
    el(
      "div",
      { class: "stack" },
      el("h2", { id: "prompt-title", text: action.title }),
      el("p", { class: "muted", text: action.blurb }),
      action.isPurchasable && el("hr", { class: "divider" }),
      action.isPurchasable && el("p", { style: "font-weight:600", text: offer.line }),
      action.isPurchasable && el("p", { class: "caption", text: offer.reassurance }),
      action.isPurchasable && el("p", {
        class: "caption",
        text: !offer.isBuyable
          ? "IPT is not on sale yet. This demo is the whole app, and it stays free."
          : promptBuyerLink
          ? "Buying opens in a new tab. It attaches to the account you are signed in to here."
          : "Create a free account first. Buying attaches the purchase to the account you are signed in to.",
      }),
      action.isPurchasable && promptBuyerLink && el("a", {
        class: "button--primary",
        style: "width:100%; display:block; text-align:center",
        href: promptBuyerLink,
        target: "_blank",
        rel: "noopener",
        text: `Get IPT for ${offer.priceText}`,
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

/**
 * Something the server refused, said once, with a way out.
 *
 * An alert, because it is an *event*: somebody did a thing and this is the answer. Losing signal
 * gets `offlineBar` instead, and the difference between those two is the rule this file keeps.
 */
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

/**
 * The backstop, matching the iPhone's.
 *
 * Screens ask at the moment of intent, which is a courtesy — it puts the explanation in front of
 * somebody *before* they have done work that cannot be saved. This is what makes a forgotten call
 * site harmless: any write that reaches a store and is refused throws, and the right thing still
 * happens. One prompt, reachable two ways.
 */
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

/**
 * What a `StoreError` means, and which of the three voices it gets.
 *
 * The `network` branch is the one worth being careful about: it must never become a dialog, and it
 * must never be treated as a reason to sign somebody out. A performer in a basement is still signed
 * in, their practice is still on disk, and the queue is still going to deliver it.
 */
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
      state.viewedSpan = null;
      state.mode = "door";
      state.auth = { ...state.auth, busy: false, problem: "You're signed out. Sign in and carry on." };
      render();
      break;
    default:
      showRefusal(error.message);
  }
}


/** The frame around the showroom: what this is, whose eyes, and the way out. */
function demoBar() {
  const seats = ["instructor", "performer"];

  /**
   * A real radio group, not two buttons that look like one.
   *
   * `role="radio"` is a promise about behaviour, not a styling hook: a screen-reader user who meets
   * a radiogroup expects **arrow keys to move the selection** and expects exactly one stop in the
   * tab order for the whole group. Declaring the role and implementing neither is worse than using
   * plain buttons, because it announces a control that then does not work the way it was announced.
   *
   * So: roving tabindex (only the checked seat is tabbable), and arrows that wrap.
   */
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
        el("button", { class: "button--plain", style: "color:var(--accent)", type: "button", onClick: leaveDemo, text: "Leave" }),
      ),
      el("div", { class: "segmented", role: "radiogroup", "aria-label": "Viewing as" }, buttons),
    ),
  );
}

/**
 * A condition, not an event.
 *
 * It clears itself the moment a request succeeds, it has no button, and it never covers anything.
 * `role="status"` rather than `alert`: this is not something to interrupt somebody mid-practice
 * about, it is something to let them notice.
 */
function offlineBar() {
  const waiting = state.outbox?.waiting ?? 0;
  return el("div", { class: "offline-bar", role: "status" }, el("p", {
    class: "caption",
    text: waiting > 0
      ? `No connection. ${waiting === 1 ? "One session is" : `${waiting} sessions are`} saved on this device and will send themselves.`
      : "No connection. Anything you do is saved on this device.",
  }));
}

/** The tabs available to the seat currently being viewed. */
function tabsFor(store) {
  return store.isInstructor
    ? [
      { href: "#/studio", label: "Studio", glyph: "▦" },
      { href: "#/assignments", label: "Assignments", glyph: "☰" },
      { href: "#/standings", label: "Standings", glyph: "★" },
      { href: "#/you", label: "You", glyph: "●" },
    ]
    : [
      { href: "#/practice", label: "Practice", glyph: "▲" },
      { href: "#/standings", label: "Standings", glyph: "★" },
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


/**
 * Screens a seat can reach that are **not** tabs.
 *
 * The listening queue is one of these deliberately: a fifth tab would put it beside Standings as
 * though they were the same kind of thing, when it is somewhere an instructor goes *because the
 * dashboard sent them there* — and the dashboard already carries the count that does the sending.
 */
/**
 * Routes that exist without a tab, and **the single authority on whether one is reachable.**
 *
 * `currentRoute` rewrites anything not listed here to the first tab, silently — which is right for
 * a stale link and lethal for a route somebody forgot to add. Four screens were built, drawn,
 * screenshotted and gated before anybody noticed that every button leading to them bounced to the
 * studio home: the `case` blocks were dead code and nothing said so, because nothing drives this
 * router. `routes_test.js` is what makes that impossible now.
 *
 * The role check lives here rather than in each `case`, so there is one construction of "may this
 * person be on this screen" instead of five that can drift.
 */
/**
 * The span and its three handlers — one builder, because the instructor's dashboard and the
 * performer's practice screen hold the same time control and two copies of "what does the
 * chevron do" is how they stop agreeing. State is `state.viewedSpan`, shared across the two
 * screens the way iOS's `AppModel.span` is one value for the whole session.
 */
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
  return [...routes, "#/listening", "#/terms", "#/scoring", "#/roster", "#/display"];
}



/**
 * Held while the display is up, released the moment it is not.
 *
 * **Feature-tested and then exercised**, because a browser's answer about itself is a claim: Safari
 * and every Chromium have `wakeLock` on `navigator`, and the request still rejects on an
 * unfocused tab, over plain http on some builds, and whenever the OS is in a low-power mode. So the
 * screen is told what actually happened rather than what was advertised — a director who props a
 * laptop on the podium and finds it asleep in twenty minutes should know the app could not stop it.
 *
 * The sentinel is also **re-taken on `visibilitychange`**: the browser drops it whenever the tab is
 * hidden and does not give it back, so a display that survived one alt-tab would otherwise sleep.
 */
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


/**
 * Everything the display owns while it is up: the wake lock, a slow refresh, and Escape.
 *
 * Returns the teardown, which `show()` calls when the screen is replaced — so none of it can outlive
 * the screen. Written as one function because all three have the same lifetime and three separate
 * listeners would each need their own removal.
 */
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


/**
 * Copying and sending the season summary.
 *
 * Both report what actually happened rather than assuming. `navigator.clipboard.writeText` rejects
 * on a page without focus, in a browser that requires a stricter gesture, and over plain http on
 * some builds; `navigator.share` rejects when somebody **cancels the sheet**, which is not a failure
 * and must not be reported as one. *A refusal is not a bad connection*, and neither is a decision
 * not to send something.
 */
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


/**
 * Accepts the break — writes the terms either side of the quiet stretch.
 *
 * Terms say when a studio **is** running, so this is never one edit. `declaringBreak` works out
 * which terms should exist and this saves only the difference: a term it returns carrying an
 * existing id is an edit of that one, and a term without is new. Saving all of them unconditionally
 * would duplicate every untouched term in the studio.
 */
async function declareBreak(stretch) {
  const rows = state.store.terms();
  const existing = termsFrom(rows).map((term, index) => ({
    ...term, id: rows[index].id, name: rows[index].name,
  }));
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


/**
 * Leaves somebody else's studio.
 *
 * The confirmation says what actually happens, and the two halves are not the same: the instructor
 * keeps every session and recording — `practice_logs_read` is `performer_id = auth.uid() or
 * is_instructor_of(studio_id)`, which asks nothing about membership — while the studio's standings
 * and totals lose them, because every summary is rebuilt from current membership. Both are proved in
 * `supabase/harness/checks.sql`.
 */
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


/** Your own name and instrument. `instrument` is what groups you into a section, so it is not cosmetic. */
async function saveProfile(draft) {
  await settingsWrite(async () => {
    await state.store.updateProfile(draft);
    announce("Your details were saved");
  });
}

/**
 * Deleting a studio you own, which ends everybody else's work in it.
 *
 * Named with the same numbers `DeletionCost` puts on iOS — *name what a destructive action costs, in
 * numbers* — because "all associated data will be removed" tells an instructor nothing about the
 * room full of other people's practice they are about to end.
 */
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


/**
 * A performer throwing away one of their own sessions.
 *
 * *A take is the performer's before it is the instructor's*, and a session the server set aside is
 * still practice they actually did — which is exactly why only they may clear it. The confirmation
 * says what goes, in the same words iOS uses under the same action.
 */
/**
 * Practice written down after the fact.
 *
 * Straight through the same outbox a timed session uses — *practice is never lost* is one promise,
 * and a second path to keep it would be a second construction of the thing this product can least
 * afford to get wrong twice. The draft simply carries `selfReported`.
 */
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
      : "The time and any clip attached to it are removed from your week.",
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

/** Finishing a piece: it stops being assigned after this week, and nothing logged against it moves. */
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

/**
 * The dashboard's span, built for the screen: weeks, words and the trend's period name, all from
 * `spans.js` so the screen renders a decision rather than making one. Null state is the current
 * week. A month is clamped to the grid — the weeks the studio has actually lived — and a held
 * anchor that no longer intersects it falls back to the current week rather than an empty screen.
 */
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

function currentRoute() {
  const hash = location.hash || "#/";
  if (state.mode !== "studio") return "#/";
  const tabs = tabsFor(state.store).map((t) => t.href);
  const allowed = [...tabs, ...extraRoutesFor(state.store)];
  if (!allowed.includes(hash)) return tabs[0];
  return hash;
}

/**
 * Puts a screen on the page.
 *
 * `mounted.dispose` is what stops a practice session's clock — and its microphone — outliving the
 * screen that opened them. A timer left running in a replaced subtree is invisible until it writes
 * to an element nobody can see, or until somebody wonders why the tab is warm.
 */
function show(...nodes) {
  mounted?.dispose?.();
  mounted = nodes.find((n) => n?.dispose) ?? null;
  replace(root, ...nodes);
}

/**
 * The screen last announced, so arriving somewhere new is said once and staying put is silent.
 *
 * `null` until the first paint, which is why the first screen announces too: a person who lands on
 * the sign-in page with a screen reader gets told what it is.
 */
let announcedScreen = null;

/**
 * Paint, then tell somebody who cannot see it what happened.
 *
 * ==========================================================================================
 * The half of this that was written and never wired
 * ==========================================================================================
 *
 * The note on `announce` says a single-page app "replaces its own content with no notice at all —
 * WCAG 4.1.3 — so a **route change** or a seat change is silent to anybody not looking at the
 * screen". The live region it describes has existed for months and **no route change ever called
 * it**: every caller was a prompt, a refusal or a copy confirmation. Tapping Standings replaced
 * the whole page in silence. Measured, not assumed — clearing the region, navigating, and reading
 * it back returns "".
 *
 * ==========================================================================================
 * And focus, which is the other half of the same tap
 * ==========================================================================================
 *
 * `replace()` removes the element the keyboard was standing on, and focus falls to `<body>`.
 * Measured the same way: focus a tab link, activate it, read `document.activeElement` — `BODY`. A
 * keyboard user who moves to Standings is then tabbing from the top of the document again, past
 * the skip link and the whole demo bar, to reach what they just asked for.
 *
 * So the new screen's heading takes focus. `tabindex="-1"` makes it focusable without putting it
 * in the tab order, which is the standard shape for this — and a heading is the right target
 * rather than the first control, because it says *where you are* before offering what to do.
 *
 * **Only when the screen actually changed.** `render()` runs for far more than navigation — every
 * outbox tick, every state change — and moving focus on each one would fight the person typing.
 * The title is the name the app already computed for this screen, so it is the thing to compare.
 */
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
    show(studioSetupScreen({
      profile: state.store.profile(),
      problem: state.auth.problem,
      busy: state.auth.busy,
      onCreate: handleCreateStudio,
      onJoin: handleJoinStudio,
      onSignOut: handleSignOut,
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
    }));
    document.title = titleFor(state.editing.assignment ? "Edit assignment" : "New assignment");
    return;
  }

  if (state.session) {
    show(sessionScreen(state.store, {
      assignment: state.session.assignment,
      capabilities: state.session.capabilities,
      countIns: state.session.countIns ?? [],
      countInSeconds: countInSeconds(),
      onCountIn: (seconds) => { saveCountInSeconds(seconds); },
      onSave: saveSession,
      onBlocked: state.inDemo ? ((name) => showPrompt(name)) : null,
      onCancel: () => { state.session = null; render(); announce("Session discarded"); },
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
        onRateChange: (value) => { state.playbackRate = value; render(); },
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
      });
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
        onBack: () => { location.hash = "#/you"; },
        busy: state.settings.busy,
        problem: state.settings.problem,
      });
      title = "Roster";
      break;
    case "#/reminders":
      screen = remindersScreen({
        capability: push.capability(),
        subscribed: state.reminders.subscribed,
        configured: remindersConfigured(),
        preferences: push.preferences(),
        volumes: state.vocabulary?.notificationVolumes ?? [],
        isInstructor: store.isInstructor,
        busy: state.reminders.busy,
        problem: state.reminders.problem,
        onVolume: setReminderVolume,
        onEnable: enableReminders,
        onDisable: disableReminders,
      });
      title = "Reminders";
      if (!state.vocabulary && !isDemo) loadExportedWords();
      if (!isDemo) refreshSubscription();
      break;
    case "#/you":
      screen = youScreen(store, {
        onHelp: () => { location.hash = "#/help"; },
        onLeave: isDemo ? leaveDemo : null,
        onLeaveStudio: store.studio()?.owner_id && store.studio().owner_id !== store.profile().id
          ? leaveStudio
          : null,
        onSaveProfile: isDemo ? null : saveProfile,
        onDeleteStudio: !isDemo && store.studio()?.owner_id === store.profile().id
          ? deleteStudioAndLeave
          : null,
        onSignOut: isDemo ? null : handleSignOut,
        onDeleteAccount: isDemo ? null : deleteAccount,
        offer: isDemo ? store.offer() : null,
        outbox: state.outbox,
        onSwitchStudio: switchStudio,
        onTerms: store.isInstructor
          ? () => { location.hash = "#/terms"; }
          : null,
        onScoring: store.isInstructor
          ? () => { location.hash = "#/scoring"; }
          : null,
        onRoster: store.isInstructor
          ? () => { location.hash = "#/roster"; }
          : null,
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
        onNudgeSeen: isDemo ? null : markSeenOnce,
        onAddSession: () => go("#/add-session"),
        selfReportMark: state.selfReportMark,
      });
      title = "Practice";
      break;
    default:
      screen = studioScreen(store, {
        onPrompt,
        ...spanControls(store),
        quiet: store.isInstructor && store.facts().length > 0 && !state.dismissedBreak
          ? mostRecentQuiet(store.weeks(), store.facts(), termsFrom(store.terms()), new Date())
          : null,
        onDeclareBreak: declareBreak,
        onDismissBreak: () => { state.dismissedBreak = true; render(); announce("Left as it is"); },
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


/**
 * Runs a door action with the form locked, and puts whatever the server said back on the form.
 *
 * **Except the one refusal that is not an error message.** `0005` refuses `create_studio` and
 * `join_studio` for want of a purchase, and the answer to that is the prompt that explains the
 * feature and then the price — not a red sentence under a text field. Everything else belongs on
 * the form, next to the thing somebody typed.
 */
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

function handleSignIn({ email, password }) {
  return attempt(async () => {
    state.auth.email = email;
    await signIn({ email, password });
    await enterStudio();
  });
}

function handleSignUp({ email, password, displayName, role }) {
  return attempt(async () => {
    state.auth.email = email;
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
  state.outbox = null;
  seenNudges.clear();
  state.mode = "door";
  state.auth = { mode: "signIn", problem: null, message: null, busy: false, email: "" };
  location.hash = "#/";
  render();
  announce("Signed out");
}

function handleCreateStudio(name) {
  return attempt(async () => {
    await state.store.createStudio({ name });
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

/**
 * Somebody in two studios is the normal case, not an edge one.
 *
 * Reported rather than written onto a form: this is pressed from inside the app, where there is no
 * form to write on.
 */
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
  location.hash = tabsFor(state.store)[0].href;
  await refreshOutbox();
  push.syncPlan(state.store);
  render();
  announce(message);
}

/**
 * Signs somebody in to what they are actually in.
 *
 * An account with no studio is not an error and not an empty dashboard — it is the two doors, on
 * their own screen. *Empty states act; they do not describe.*
 */
async function enterStudio() {
  state.store = await SupabaseStore.open();
  state.viewedSpan = null;
  state.inDemo = false;
  forgetExportedWords();
  state.session = null;
  state.auth = { ...state.auth, busy: false, problem: null, message: null };

  requestDurableStorage().catch(() => {});

  if (!state.store.hasStudio) {
    state.mode = "setup";
    render();
    return;
  }

  state.mode = "studio";
  await state.store.applyPending();
  await refreshOutbox();
  push.syncPlan(state.store);

  const home = tabsFor(state.store)[0].href;
  const wanted = tabsFor(state.store).some((t) => t.href === location.hash) ? location.hash : home;
  if (location.hash === wanted) render();
  else location.hash = wanted;

  announce(`${state.store.studio().name}, viewing as ${state.store.role}`);
  setTimeout(() => document.getElementById("main")?.focus(), 0);
  drainOutbox();
}


/**
 * Opens a session against one assignment.
 *
 * The recording capability is resolved **before** the screen is drawn, so the screen never offers a
 * take it cannot make. *Feature-test, then exercise* — a capability that has never run is a
 * capability you do not have, and both halves of that were paid for on this path already:
 * `getUserMedia` delivered stereo while claiming mono, and `AudioEncoder.isConfigSupported` said
 * stereo AAC was supported right before the encoder failed on the first frame.
 */
async function startSession(assignment) {
  const [capabilities, words] = await Promise.all([
    recordingCapability(assignment),
    vocabulary().then((v) => v.countIns).catch(() => []),
  ]);
  state.session = { assignment, capabilities, countIns: words };
  render();
  document.getElementById("main")?.focus();
  announce(`Practicing ${assignment.title}`);
}

async function recordingCapability(assignment) {
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
    /** What this take may run to, so the screen's own sentence cannot contradict the recorder. */
    maxSeconds: limit,
    /**
     * Seconds left, or null while that is too far away to say — handed to the screen rather than
     * imported by it, because `recorder.js` pulls `mp4.js` behind it and neither belongs in the
     * bundle a Chromebook downloads before it has been asked to record anything. Same reason this
     * whole module is a dynamic import.
     */
    remaining: (elapsed) => secondsBeforeLimit(elapsed, limit),
    /** Starts a take and hands back a handle: `stop()` ends it, `done` resolves with the clip. */
    async start({ onTick } = {}) {
      const stream = await openMicrophone();
      const controller = new AbortController();
      const done = record(stream, { onTick, signal: controller.signal, maxSeconds: limit })
        .finally(() => stream.getTracks().forEach((track) => track.stop()));
      return { stop: () => controller.abort(), done };
    },
  };
}

/**
 * The end of a session: on disk first, then the network.
 *
 * `logPractice` returns as soon as the queue has it, which is why this can close the screen
 * immediately. The performer watching a spinner at the end of a practice session, on the worst
 * connection in the building, for a write that is already durable, is the mistake the iOS version
 * made once.
 */
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

/**
 * Marks a nudge seen **once**, however many times its banner is drawn.
 *
 * The screen calls this from its render, which is right — the moment it is on screen is the moment
 * it has been seen — but a render happens on every route change, every flush and every reload, and
 * the store does not reload after this write, so the banner keeps being drawn until something else
 * refetches. Without the guard that is one PATCH per render, forever, for a thing nobody pressed.
 * Same shape as the double flush the outbox had: correct behaviour, repeated silently.
 */
const seenNudges = new Set();

function markSeenOnce(nudge) {
  if (seenNudges.has(nudge.id)) return;
  seenNudges.add(nudge.id);
  state.store.markNudgeSeen(nudge.id);
}

/**
 * Opens one performer, fetching the suggestion copy the first time it is needed.
 *
 * The four openings live in `Nudge.suggestions` and reach this client through the same export as
 * the purchase prompt's words — one channel for product copy, so a sentence improved in Swift is
 * improved in both clients rather than in one.
 */
async function openPerformer(performer) {
  if (!state.suggestions.length) {
    try { state.suggestions = (await vocabulary()).nudgeSuggestions ?? []; } catch { /* the box still works */ }
  }
  state.viewing = { performer };
  render();
  document.getElementById("main")?.focus();
}

/**
 * Sends one line, and goes back to the dashboard that sent you here.
 *
 * Back rather than staying: an instructor doing this is working down a list of people who need
 * them, and leaving them on the screen they have just finished with is one more tap between them
 * and the next person.
 */
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

/**
 * Ends the account, having said what that costs.
 *
 * **A submission requirement on iOS** — guideline 5.1.1(v) — and the same account signs in here, so
 * an account deletable only from a phone the person may not own is not really deletable. The cost is
 * already on screen in numbers; this is the second, deliberate step, and it asks for the word rather
 * than accepting a stray tap on a red button.
 */
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

/**
 * Writes the assignment, then goes back to the list.
 *
 * The store reloads the whole studio on a successful write, so the list this returns to is the
 * server's answer rather than an optimistic patch — an assignment that the database changed on the
 * way in (a trimmed title, a trigger, another instructor editing at the same moment) shows what it
 * actually became.
 */
async function saveAssignment(draft) {
  state.auth = { ...state.auth, busy: true };
  state.editing = { ...state.editing, problem: null };
  render();
  try {
    const existing = state.editing.assignment;
    if (existing) await state.store.updateAssignment(existing.id, draft);
    else await state.store.createAssignment(draft);
    state.editing = null;
    state.auth = { ...state.auth, busy: false };
    render();
    announce(existing ? "Assignment saved" : "Assignment created");
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

/**
 * Deleting an assignment, which takes every session logged against it.
 *
 * Confirmed **with the cost in numbers**: "all associated data will be removed" tells somebody
 * nothing, and this is an instructor ending a room full of other people's work. The count comes
 * from the studio already loaded, so it is the real one.
 */
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

/**
 * Marks one take heard, with or without a line back.
 *
 * **It notifies, and that was a reversal.** Telling somebody once that they were heard is the read
 * receipt arriving, not chat — and silent, it only ever reached a performer who happened to reopen
 * the app, who is precisely not the one who has drifted away.
 *
 * The screen is re-rendered from the store afterwards rather than patched in place: the queue's
 * order is a function of what is still unheard, and hand-removing a card would be a second, quieter
 * construction of `listeningOrder`.
 */
async function acknowledge(log, note) {
  try {
    await state.store.acknowledgeLog(log.id, note);
    render();
    announce("Heard");
  } catch (error) {
    report(error);
  }
}


/**
 * One place for all six writes, because they differ only in what they say and what they call.
 *
 * A refusal is reported **on the screen that raised it**, not as an alert: somebody just pressed a
 * button and is owed an answer next to it. That is the same rule the sign-in form and the
 * assignment editor already follow.
 */
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

async function chooseScoring(preset) {
  await settingsWrite(async () => {
    await state.store.setScoring(preset.rules);
    announce(`Scoring set to ${preset.title}`);
  });
  document.querySelector('.options [aria-checked="true"]')?.focus();
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


/**
 * The product sentences Swift owns, fetched once and kept.
 *
 * `NotificationVolume`'s labels and "up to 6 a week" lines, and `ScoringPreset`'s titles, blurbs
 * and already-clamped weights. Fetched at the moment a screen needs them rather than on load, the
 * same way `showPrompt` fetches the offer: somebody who never opens these screens never downloads
 * a demo studio to read ten sentences out of.
 */
/**
 * `PlaybackRate`'s options, for the listening queue's speed control.
 *
 * Through `vocabulary()` rather than `loadExportedWords`, and the difference matters: the latter
 * is called only by the two settings screens, so a control reading `state.vocabulary` is one that
 * appears only after somebody has visited Settings — which is nowhere near the listening queue.
 * Both paths read the same `demo-studio.json`; this one does not wait for a screen nobody opened.
 */
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

/**
 * `asked` rather than `if (state.vocabulary)`, because null is a real answer here.
 *
 * The demo's answer **is** null — deliberately, since the demo store already is the export — and
 * the two settings screens ask for the words with `if (!state.vocabulary) loadExportedWords()` on
 * every render. So a null answer is indistinguishable from never having asked, and this function
 * ends in `render()`: the screen renders, asks again, gets null again, renders again. An unbounded
 * loop, reachable only in the demo, and only once `store.isDemo` started telling the truth — which
 * is why the flag and this latch had to land together. Remembering the *question* rather than
 * inferring it from the answer is the fix; it is the same shape as `standingsAvailable` being a
 * separate fact from an empty board, for the same reason: **absent is not empty.**
 */
let wordsAsked = false;

/** Called on every store swap: the answer belongs to the store that gave it. */
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

/**
 * Whether this browser really holds a subscription, asked of the browser rather than assumed.
 *
 * `Notification.permission` says only that somebody once said yes. A subscription can be dropped
 * by a key rotation or lost to a failure after the prompt, and a screen that reported "reminders
 * are on" from the permission alone would be telling a performer their reminders work while
 * nothing is ever delivered — silently, and for good.
 */
async function refreshSubscription() {
  const subscribed = (await push.current()) != null;
  if (subscribed === state.reminders.subscribed) return;
  state.reminders = { ...state.reminders, subscribed };
  if (currentRoute() === "#/reminders") render();
}

function setReminderVolume(volume) {
  push.savePreferences({ volume });
  render();
  push.syncPlan(state.store);

  const level = state.vocabulary?.notificationVolumes?.find((v) => v.name === volume);
  announce(`Reminders set to ${level?.label ?? volume}`);

  document.querySelector('.options [aria-checked="true"]')?.focus();
}

/**
 * Asks, subscribes, and plans — from a click, which is the only place it can happen.
 *
 * A refusal here is said **on this screen**, not as an alert: somebody just pressed a button and is
 * owed an answer next to it. The same rule the sign-in form follows.
 */
async function enableReminders() {
  state.reminders = { ...state.reminders, busy: true, problem: null };
  render();
  try {
    await push.enable(state.store, CONFIG.vapidPublicKey);
    await push.syncPlan(state.store);
    state.reminders = { busy: false, problem: null, subscribed: true };
    announce("Reminders are on for this browser");
  } catch (error) {
    state.reminders = {
      busy: false, problem: error.message, subscribed: (await push.current()) != null,
    };
  }
  render();
}

async function disableReminders() {
  state.reminders = { ...state.reminders, busy: true, problem: null };
  render();
  try {
    await push.disable(state.store);
    state.reminders = { busy: false, problem: null, subscribed: false };
    announce("Reminders are off for this browser");
  } catch (error) {
    state.reminders = {
      busy: false, problem: error.message, subscribed: (await push.current()) != null,
    };
  }
  render();
}


async function refreshOutbox() {
  if (!state.store?.outboxStatus) return;
  try { state.outbox = await state.store.outboxStatus(); } catch { state.outbox = null; }
}

/**
 * Delivers whatever is waiting, and lets the result decide what the bar says.
 *
 * A failure here is never reported as an alert — the queue's own judgement has already decided
 * whether this was a bad connection (wait, forever) or a refusal (retry, then set aside with a
 * reason only the performer can clear).
 */
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
  state.inDemo = true;
  state.mode = "studio";
  state.store.viewAs("instructor");
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


/**
 * The service worker, registered after load rather than during it.
 *
 * Registering competes with the app's own first render for the same network and main thread, and
 * the worker is worth nothing on a first visit — it exists for the *second* one. Waiting until the
 * page has loaded costs nothing and keeps the first paint clean.
 *
 * A failure here is deliberately swallowed: no worker means no offline shell, which is exactly how
 * the app behaved before this existed. It is not a reason to show anybody an error.
 */
if ("serviceWorker" in navigator) {
  addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
    });
  });
}

/**
 * The install prompt, held rather than fired.
 *
 * Chrome hands over a `beforeinstallprompt` event and lets the page decide *when* to use it. Firing
 * it on arrival is what has taught everybody to dismiss install prompts without reading them — so
 * this keeps the event and shows a quiet affordance on the sign-in screen, which is where somebody
 * on a Chromebook is deciding whether this is a thing they will come back to.
 *
 * It is offered once. `appinstalled` and a dismissal both clear it, and nothing re-offers.
 */
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
  render();
});

const observer = new MutationObserver(() => {
  const main = document.getElementById("main");
  if (main && !main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
});
observer.observe(root, { childList: true, subtree: true });


/**
 * Reads a session out of the hash, if the browser arrived here from a confirmation email.
 *
 * GoTrue's link lands on `#access_token=…&refresh_token=…&type=signup`, which in a hash-routed app
 * is a route nothing recognises. **The hash is cleared with `replaceState`**, not by assigning to
 * `location.hash`: assigning leaves the tokens in the browser's history, where the back button and
 * every screenshot of the address bar can still reach them.
 */
async function consumeAuthRedirect() {
  const raw = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  if (!raw.includes("access_token=") && !raw.includes("error_description=")) return false;

  const params = new URLSearchParams(raw);
  history.replaceState(null, "", `${location.pathname}${location.search}#/`);

  const problem = params.get("error_description");
  if (problem) {
    state.auth = { ...state.auth, problem: problem.replace(/\+/g, " ") };
    return false;
  }

  const isRecovery = params.get("type") === "recovery";
  try {
    await adoptSession({
      access_token: params.get("access_token"),
      refresh_token: params.get("refresh_token"),
      expires_in: Number(params.get("expires_in")) || undefined,
    });
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
    state.auth = { ...state.auth, problem: "Type your email above first, then tap this again.", message: null };
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
