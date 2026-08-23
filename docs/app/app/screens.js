/**
 * Every screen, as a function that returns an element.
 *
 * ## What these are allowed to compute
 *
 * The week in progress, and only that: "have I met this week's target, right now". That is the one
 * judgement a client cannot delegate, because the outbox means it holds practice the server has
 * never seen — see the opening of `judgement.js`.
 *
 * **Points, ranks and streak history are read, never derived.** On a real project they come from
 * `0004_judgement.sql`; in the demo they come from the export, computed by `ScoreEngine`. If a
 * number about *other people* is wanted here and is not in the data, the answer is to add it to the
 * server's projection — never to work it out in this file.
 */

import { el, replace } from "./dom.js";
import {
  weekTitle,
  assignmentProgress,
  audienceIncludes,
  isActiveDuring,
  progressFraction,
  standingStreak,
  weekMet,
} from "./judgement.js";
import { amountPhrase, clock, compactDuration, completionPhrase, count, groupedCode, longDuration, noun, targetPhrase, weekPhrase, whenPhrase } from "./format.js";
import { guidancePhrase, targetGuidance } from "./guidance.js";
import { instructorPhrase, refusal, refusalSentence } from "./selfreport.js";
import {
  cleanTempo,
  focusCoverage,
  assignmentAudience,
  memberSinceDates,
  focusPointPhrase,
  focusProgress,
  linePhrase,
  marksByAssignment,
  TEMPO_RANGE,
  uncoveredInstructions,
} from "./coverage.js";
import { countIn } from "./recording-prefs.js";
import { pastTerms, seasonWindow, termsFrom } from "./terms.js";
import { isSetUp, nextStep, setupSteps, setupTitle } from "./setup.js";
import { groupBySection, instructorSummary, performerSummary, spanFrom } from "./report.js";
import { lengthPhrase } from "./quiet.js";
import { avatar, card, emptyState, field, heading, meter, notice, performerRow, pill, ring, stat, weekStrip } from "./ui.js";
import { currentWeek, performerWeekRows, studioWeekRows, weekProgress, weekTrend } from "./trend.js";
import { reachedMilestones } from "./milestones.js";
import { spanRows } from "./spans.js";
import { checkoutURLFor } from "./words.js";
import { deletionCost, finishedPhrase, heardPhrase, listeningOrder, positionPhrase, REMOVAL_UNDOABLE, savingPhrase, waitingPhrase } from "./listening.js";


/**
 * The week on screen, and the way to move it — the week half of iOS's `SpanBar`.
 *
 * Without `onStepWeek` it is the same quiet caption it always was: the setup screen, and any
 * caller that has not wired a stepper, must not grow two dead chevrons. The forward chevron
 * disables at the current week — *next week has not happened and a dashboard for it would be a
 * claim about the future* — and the back chevron at the studio's first week, because the grid is
 * every week since the studio was created and there is nothing before it.
 *
 * The title is `weekTitle`'s word for the two weeks a person is actually looking at, and the
 * dates alone beyond that — *never a bare date range for this week and last.*
 */
function spanLine(store, span, onStepSpan, onPickSpan) {
  const zone = store.studio().time_zone;
  const title = span.title ?? (weekTitle(span.weeks[0], store.weeks().at(-1).start,
    store.studio().week_starts_on, zone) ?? weekPhrase(span.weeks[0], zone));
  const subtitle = span.subtitle ?? weekPhrase(span.weeks[0], zone);
  const labelParts = () => {
    const parts = (title === subtitle ? subtitle : `${title} · ${subtitle}`).split(" · ");
    return parts.flatMap((part, index) => [
      el("span", { class: "nobr", text: index < parts.length - 1 ? `${part} ·` : part }),
      index < parts.length - 1 ? " " : null,
    ]);
  };
  if (!onStepSpan && !onPickSpan) return el("p", { class: "caption" }, labelParts());

  const chevron = (delta, glyph, name, enabled) =>
    el("button", {
      type: "button",
      class: "button--quiet",
      id: delta < 0 ? "week-back" : "week-forward",
      "aria-label": name,
      disabled: !enabled,
      style: "min-width: 44px; padding: 0.4rem 0.6rem",
      onClick: () => onStepSpan?.(delta),
      text: glyph,
    });

  const grid = store.weeks();
  const steppable = span.kind !== "season" && span.kind !== "custom" && span.kind !== "term";
  const canBack = steppable && grid.some((w) => w.start < span.weeks[0].start);
  const canForward = steppable && grid.some((w) => w.start > span.weeks[span.weeks.length - 1].start);

  const eras = pastTerms(termsFrom(store.terms()), {
    studioCreatedAt: store.studio().created_at,
    now: store.weeks().at(-1).start,
  });
  const picker = el("select", {
    id: "span-kind",
    "aria-label": "Time range",
    style: "width: auto; max-width: 100%",
    onChange: (e) => onPickSpan?.(e.target.value),
  },
    el("option", { value: "week", selected: span.kind === "week" ? "" : null, text: "Week" }),
    el("option", { value: "month", selected: span.kind === "month" ? "" : null, text: "Month" }),
    el("option", { value: "season", selected: span.kind === "season" ? "" : null, text: "Season" }),
    eras.map((term) =>
      el("option", {
        value: `term:${term.id}`,
        selected: span.kind === "term" && span.termId === term.id ? "" : null,
        text: term.name,
      })
    ),
    el("option", { value: "custom", selected: span.kind === "custom" ? "" : null, text: "Custom range…" }),
  );

  return el(
    "div",
    { class: "row-between", style: "align-items: center; gap: 0.5rem; flex-wrap: wrap" },
    chevron(-1, "‹", span.kind === "month" ? "Previous month" : "Previous week", canBack),
    el(
      "div",
      {
        class: "row",
        style: "align-items: center; justify-content: center; gap: 0.6rem; flex: 1 1 auto; flex-wrap: wrap",
      },
      el("p", { class: "caption", style: "margin: 0; flex: 0 1 auto; min-width: 0" }, labelParts()),
      onPickSpan ? picker : null,
    ),
    chevron(1, "›", span.kind === "month" ? "Next month" : "Next week", canForward),
  );
}

/**
 * The hand-picked stretch's editor: two dates and an Apply, in the studio's own zone. Drawn only
 * for the custom kind — the other ranges must not grow dead chrome — and shared by both screens
 * that hold a span, because a form written twice is a form that drifts.
 */
function customRangeEditor(viewed, onApplyCustom) {
  if (viewed.kind !== "custom" || !onApplyCustom) return null;
  const from = el("input", { type: "date", id: "custom-from" });
  from.value = viewed.fromValue ?? "";
  const to = el("input", { type: "date", id: "custom-to" });
  to.value = viewed.toValue ?? "";
  return el(
    "form",
    { onSubmit: (e) => { e.preventDefault(); onApplyCustom(from.value, to.value); } },
    field("From", from),
    field("To", to,
      "Practice weeks are whole weeks, so a range covers the weeks your dates fall in."),
    el("button", { type: "submit", class: "button--quiet", text: "Apply" }),
  );
}


/**
 * The sign-in screen, the sign-up screen, and the way into the demo.
 *
 * One screen with two modes rather than two routes, because the person who arrives here does not
 * know which one they need until they have read both labels, and a route change to find out loses
 * whatever they had typed.
 *
 * **It quotes no price**, and that is deliberate rather than an omission. The price lives in
 * `Entitlement` and reaches this client through the export, which is not loaded until somebody
 * opens the demo — so putting a figure here would mean typing one into JavaScript, which is the
 * second construction the export exists to prevent. A price that is merely *stale* is worse than
 * one you have to tap once to see. It appears in every purchase prompt and on the You screen, both
 * of which have the real value.
 */
export function doorScreen({
  mode = "signIn",
  value = "",
  onSignIn,
  onSignUp,
  onForgot = null,
  onModeChange,
  onEnterDemo,
  onInstall,
  problem = null,
  message = null,
  busy = false,
} = {}) {
  const isNew = mode === "signUp";

  const name = el("input", { type: "text", autocomplete: "name", required: true, id: "auth-name" });
  const email = el("input", { type: "email", autocomplete: "email", required: true, id: "auth-email" });
  email.value = value ?? "";
  const password = el("input", {
    type: "password",
    autocomplete: isNew ? "new-password" : "current-password",
    required: true,
    minlength: "8",
    id: "auth-password",
  });
  const role = el(
    "select",
    { id: "auth-role" },
    el("option", { value: "performer", text: "Performer: I practice" }),
    el("option", { value: "instructor", text: "Instructor: I assign practice" }),
  );

  const form = el(
    "form",
    {
      class: "stack",
      onSubmit: (event) => {
        event.preventDefault();
        if (busy) return;
        const credentials = { email: email.value.trim(), password: password.value };
        if (isNew) onSignUp?.({ ...credentials, displayName: name.value.trim(), role: role.value });
        else onSignIn?.(credentials);
      },
    },
    el("h2", { text: isNew ? "Create an account" : "Sign in" }),
    problem && notice(problem, { kind: "error" }),
    message && notice(message),
    isNew && field("Your name", name, "What your studio sees. Your instructor is looking for it on a roster."),
    field("Email", email),
    field("Password", password, isNew ? "At least 8 characters." : undefined),
    isNew && field("You are", role),
    el("button", {
      class: "button--primary",
      style: "width:100%",
      type: "submit",
      disabled: busy,
      text: busy ? "Working…" : (isNew ? "Create account" : "Sign in"),
    }),
    el("button", {
      class: "button--quiet",
      style: "width:100%",
      type: "button",
      onClick: () => onModeChange?.(isNew ? "signIn" : "signUp"),
      text: isNew ? "I already have an account" : "New here? Create an account",
    }),
    onForgot && !isNew && el("button", {
      class: "button--plain",
      style: "width:100%; color: var(--muted); font-size: 0.85rem; min-height: 44px",
      type: "button",
      id: "forgot-password",
      onClick: () => onForgot(email.value.trim()),
      text: "Forgot your password?",
    }),
  );

  return el(
    "main",
    { id: "main", class: "page", "data-room": "percussion" },
    el(
      "div",
      { style: "text-align:center; display:grid; gap:0.35rem; margin-bottom:0.5rem" },
      el(
        "h1",
        { class: "wordmark", style: "font-size:3rem; letter-spacing:0.04em" },
        el("span", { text: "IP" }),
        el("span", { class: "wordmark-t", text: "T" }),
      ),
      el("p", { class: "caption", text: "Individual Practice Time" }),
    ),
    card({ class: "stack" }, form),
    el("a", {
      href: "https://iptmusic.com/privacy",
      target: "_blank",
      rel: "noopener",
      class: "caption",
      style: "text-align:center; display:block; color: var(--muted); min-height: 44px; padding-top: 12px",
      text: "Privacy policy",
    }),
    card(
      { class: "card--tinted stack" },
      el("h2", { class: "micro", style: "color: var(--accent)", text: "See it working" }),
      el("p", {
        class: "caption",
        text:
          "A real studio with three weeks of practice in it: a roster, assigned work, standings, " +
          "and recordings. No account, nothing to set up.",
      }),
      el("button", {
        class: "button--primary",
        style: "width:100%",
        type: "button",
        id: "demo-door",
        onClick: onEnterDemo,
        text: "Look inside a demo studio",
      }),
    ),
    onInstall && card(
      { class: "stack" },
      el("h2", { text: "Add IPT to this device" }),
      el("p", {
        class: "caption",
        text:
          "It opens from your home screen and keeps working when the wi-fi does not, which in a " +
          "practice room it often does not.",
      }),
      el("button", {
        type: "button",
        style: "width:100%",
        onClick: onInstall,
        id: "install",
        text: "Install",
      }),
    ),
  );
}

/**
 * What a new account is waiting for.
 *
 * **Sign-up succeeding without a session is normal, not a failure** — with email confirmation on,
 * which is the correct production setting and the one this project runs, GoTrue creates the account
 * and returns no token until somebody clicks the link. Saying so is the whole screen. The iOS side
 * spent a debugging session on this exact shape, blaming a database trigger that had worked
 * perfectly, so it is named here rather than left as a silent nothing-happened.
 */
/**
 * Where the reset email lands. The person holding this screen proved control of the inbox —
 * the recovery session in hand is the proof — so the only thing left to collect is the new
 * password, with the same floor the sign-up form states.
 */
export function resetPasswordScreen({ onSave, busy = false, problem = null } = {}) {
  const password = el("input", {
    type: "password", id: "new-password", autocomplete: "new-password",
    required: true, minlength: "8",
  });
  return el(
    "main",
    { id: "main", class: "page", "data-room": "percussion" },
    el("h1", { text: "Choose a new password" }),
    card(
      { class: "stack" },
      el(
        "form",
        {
          class: "stack",
          onSubmit: (e) => { e.preventDefault(); if (!busy) onSave?.(password.value); },
        },
        problem && notice(problem, { kind: "error" }),
        field("New password", password, "At least 8 characters."),
        el("button", {
          class: "button--primary",
          style: "width:100%",
          type: "submit",
          disabled: busy,
          text: busy ? "Working…" : "Save and continue",
        }),
      ),
    ),
  );
}

export function confirmScreen({ email, onBack, onResend, busy = false, message = null }) {
  return el(
    "main",
    { id: "main", class: "page", "data-room": "percussion", style: "place-content:center; min-height:70vh" },
    el("h1", { text: "Check your email" }),
    card(
      { class: "stack" },
      el("p", { text: `We sent a confirmation link to ${email}.` }),
      el("p", {
        class: "caption",
        text:
          "Open it on this device and IPT signs you in. If it opens somewhere else, come back here " +
          "and sign in. The account is already made.",
      }),
      message && notice(message),
      onResend && el("button", {
        type: "button",
        style: "width:100%",
        disabled: busy,
        onClick: onResend,
        text: "Send it again",
      }),
      el("button", {
        class: "button--quiet",
        style: "width:100%",
        type: "button",
        onClick: onBack,
        text: "Back to sign in",
      }),
    ),
  );
}

/**
 * An account with no studio in it yet.
 *
 * *Empty states act; they do not describe.* The first screen a new instructor ever saw said "share
 * your join code" and gave no way to see one — so both doors are on this screen, and which one
 * somebody wants is decided by a sentence about what they do rather than by a word for a role.
 */
export function studioSetupScreen({ profile, onCreate, onJoin, onSignOut, onCancel = null, problem = null, busy = false }) {
  const studioName = el("input", { type: "text", required: true, id: "studio-name" });
  const code = el("input", {
    type: "text",
    required: true,
    id: "join-code",
    autocapitalize: "characters",
    autocomplete: "off",
    spellcheck: "false",
    maxlength: "8",
  });

  return el(
    "main",
    { id: "main", class: "page", "data-room": "sax" },
    el("h1", { text: `Welcome, ${profile.display_name}` }),
    problem && notice(problem, { kind: "error" }),
    card(
      { class: "stack" },
      el(
        "form",
        {
          class: "stack",
          onSubmit: (e) => { e.preventDefault(); if (!busy) onJoin?.(code.value.trim()); },
        },
        el("h2", { text: "Join a studio" }),
        el("p", { class: "caption", text: "Your instructor gives out one code for the whole studio." }),
        field("Join code", code),
        el("button", { class: "button--primary", style: "width:100%", type: "submit", disabled: busy, text: "Join" }),
      ),
    ),
    card(
      { class: "stack" },
      el(
        "form",
        {
          class: "stack",
          onSubmit: (e) => { e.preventDefault(); if (!busy) onCreate?.(studioName.value.trim()); },
        },
        el("h2", { text: "Start a studio" }),
        el("p", {
          class: "caption",
          text: "A roster, the work you assign, and a code you hand out once. Everything else hangs off it.",
        }),
        field("Studio name", studioName, "What your performers will see: “Wind Ensemble”, “Studio of J. Reyes”."),
        el("button", { style: "width:100%", type: "submit", disabled: busy, text: "Create studio" }),
      ),
    ),
    onCancel
      ? el("button", { class: "button--quiet", style: "width:100%", type: "button", onClick: onCancel, text: "Back to my studio" })
      : el("button", { class: "button--quiet", style: "width:100%", type: "button", onClick: onSignOut, text: "Sign out" }),
  );
}


/**
 * @param quiet a `QuietStretch` worth asking about, or null. **Offered, never done** — the app can
 *   see three silent weeks and cannot know whether the building was shut or the program fell
 *   apart, and naming it a break is the instructor's call.
 * @param onDeclareBreak accepts it. @param onDismissBreak declines, for good.
 */
export function studioScreen(store, {
  onPrompt, onListen, onOpenPerformer, quiet = null, onDeclareBreak, onDismissBreak,
  span = null, onStepSpan = null, onPickSpan = null, onApplyCustom = null,
  onAssign = null,
}) {
  const grid = store.weeks();
  const viewed = span ?? {
    kind: "week",
    weeks: [currentWeek(store)],
    title: null,
    subtitle: null,
    periodName: "the week before",
  };
  const single = viewed.kind === "week";
  const viewedWeek = viewed.weeks[viewed.weeks.length - 1];
  const isCurrentWeek = single && viewedWeek.start.getTime() === currentWeek(store).start.getTime();
  const performers = store.performers();
  const byPerformer = Object.fromEntries(store.standings().map((s) => [s.performerId, s]));

  let rows;
  let joinedLater;
  if (single) {
    const pass = studioWeekRows(store, viewed.weeks[0]);
    rows = pass.rows;
    joinedLater = pass.joinedLater;
  } else {
    const summed = spanRows(viewed.weeks, (w) => studioWeekRows(store, w));
    rows = summed.rows.map((r) => ({
      person: r.person,
      met: r.weeksMet,
      assigned: r.weeksWithWork,
      hasWork: r.weeksWithWork > 0,
      isMet: r.weeksWithWork > 0 && r.weeksMet === r.weeksWithWork,
      seconds: r.seconds,
      clips: r.clips,
    }));
    joinedLater = performers.length - summed.members;
  }

  const firstIndex = grid.findIndex((w) => w.start.getTime() === viewed.weeks[0].start.getTime());
  const beforeWeeks = firstIndex >= viewed.weeks.length
    ? grid.slice(firstIndex - viewed.weeks.length, firstIndex)
    : [];
  const trend = beforeWeeks.length
    ? weekTrend({
        now: rows,
        before: single
          ? studioWeekRows(store, beforeWeeks[0]).rows
          : spanRows(beforeWeeks, (w) => studioWeekRows(store, w)).rows.map((r) => ({
              hasWork: r.weeksWithWork > 0,
              isMet: r.weeksWithWork > 0 && r.weeksMet === r.weeksWithWork,
              seconds: r.seconds,
              clips: r.clips,
            })),
        periodName: viewed.periodName,
      })
    : null;

  const withWork = single ? rows : rows.filter((r) => r.hasWork);
  const met = (single ? rows : withWork).filter((r) => r.isMet).length;
  const silent = rows.filter((r) => r.seconds === 0).length;
  const totalSeconds = rows.reduce((n, r) => n + r.seconds, 0);
  const unheard = store.logs().filter((l) => l.hasClip && !l.wasHeard).length;

  const ordered = [...rows].sort((a, b) => {
    const rate = (w) => (w.assigned ? w.met / w.assigned : 0);
    return rate(a) - rate(b) || a.seconds - b.seconds;
  });

  const assignmentCount = store.assignments().length;
  const setupDone = isSetUp(assignmentCount, performers.length);
  const hasPerformers = performers.length > 0;
  const joinCode = store.studio().join_code;

  return el(
    "main",
    { id: "main", class: "page" },
    el(
      "div",
      { class: "stack", style: "gap:0.25rem" },
      el("h1", { text: setupTitle(store.studio().name, assignmentCount, performers.length) }),
      setupDone && spanLine(store, viewed, onStepSpan, onPickSpan),
      setupDone && customRangeEditor(viewed, onApplyCustom),
    ),
    setupDone && joinedLater > 0 && el("p", {
      class: "caption",
      text: `${joinedLater === 1 ? "1 performer" : `${joinedLater} performers`} joined after ${
        viewed.kind === "month" ? "this month"
          : viewed.kind === "season" ? "this season"
          : viewed.kind === "custom" ? "this stretch" : "this week"
      }.`,
    }),
    !setupDone && card(
      { class: "stack" },
      el("h2", { text: "Two things, in this order" }),
      el(
        "ol",
        { class: "stack", style: "margin:0; padding:0; list-style:none; gap:0.9rem" },
        setupSteps(assignmentCount, performers.length).map((step, index) =>
          el(
            "li",
            { class: "stack", style: "gap:0.2rem" },
            el(
              "div",
              { class: "row", style: "gap:0.5rem; align-items:baseline" },
              pill(step.isDone ? "Done" : `Step ${index + 1}`, step.isDone ? "met" : "accent"),
              el("h3", { text: step.title }),
            ),
            el("p", { class: "caption", text: step.detail }),
          )
        ),
      ),
      nextStep(assignmentCount, performers.length)?.kind === "assign" && onAssign && el("button", {
        class: "button--primary",
        style: "width:100%",
        type: "button",
        onClick: onAssign,
        text: "Assign something",
      }),
      joinCode && setupSteps(assignmentCount, performers.length)[0].isDone && el(
        "div",
        { class: "row-between" },
        el("span", { class: "micro", text: "Join code" }),
        el("span", {
          class: "numeral",
          style: "font-size:1.3rem; font-weight:700; letter-spacing:0.12em",
          text: groupedCode(joinCode),
        }),
      ),
    ),
    quiet && card(
      { class: "card--tinted stack" },
      el("h2", { text: `Was that ${lengthPhrase(quiet)} a break?` }),
      el("p", {
        class: "caption",
        text: "Nobody logged any practice. If the studio was off, saying so stops those weeks "
          + "counting against anybody's streak. If it wasn't, leave it. The record stays as it is.",
      }),
      el(
        "div",
        { class: "row", style: "gap:0.5rem; flex-wrap:wrap" },
        el("button", {
          class: "button--primary", type: "button",
          text: "Yes, it was a break", onClick: () => onDeclareBreak?.(quiet),
        }),
        el("button", { type: "button", text: "No, leave it", onClick: () => onDismissBreak?.(quiet) }),
      ),
    ),
    hasPerformers && assignmentCount > 0 && el(
      "div",
      { class: "stat-grid" },
      single
        ? stat(`${met}/${rows.length}`, "met the target")
        : stat(withWork.length ? `${met}/${withWork.length}` : "—", "finished every week",
               { accent: false }),
      stat(String(silent), "no practice yet", { accent: silent > 0 }),
      stat(compactDuration(totalSeconds),
        single ? (isCurrentWeek ? "practiced this week" : "practiced that week") : "studio total"),
      stat(String(unheard), `${noun(unheard, "clip")} to hear`, { accent: unheard > 0 }),
    ),
    trend && el(
      "p",
      { class: "caption", style: "display:flex; gap:0.45rem; align-items:baseline" },
      el("span", {
        "aria-hidden": "true",
        style: trend.direction === "level" ? "" : "color: var(--accent)",
        text: trend.direction === "up" ? "↗" : trend.direction === "down" ? "↘" : "→",
      }),
      el("span", {}, trend.headline, trend.detail ? ` ${trend.detail}` : ""),
    ),
    unheard > 0 && (onListen || onPrompt) &&
      el("button", {
        class: "button--primary",
        style: "width:100%",
        type: "button",
        onClick: () => (onListen ? onListen() : onPrompt("acknowledgeSession")),
        text: `Listen to all ${unheard}`,
      }),
    hasPerformers && heading(
      "The roster",
      store.isInstructor
        ? el(
          "div",
          { class: "row", style: "align-items: center; gap: 0.75rem" },
          el("span", { class: "caption numeral", text: count(performers.length, "performer") }),
          el("a", {
            class: "caption",
            href: "#/roster",
            style: "min-height: 44px; display: inline-flex; align-items: center",
            text: "Manage",
          }),
        )
        : count(performers.length, "performer"),
    ),
    hasPerformers && el(
      "div",
      { class: "stack" },
      ordered.map((w) =>
        performerRow(w.person, w, {
          streak: byPerformer[w.person.id]?.currentStreak ?? 0,
          onOpen: onOpenPerformer,
          periodLabel: single ? "this week"
            : viewed.kind === "month" ? "this month"
            : viewed.kind === "season" ? "this season" : "this stretch",
          metNoun: single ? "met this week" : "weeks finished in full",
        })
      ),
    ),
  );
}

/**
 * What the studio has and has not worked on, for one assignment in the week being viewed.
 *
 * **The reason a focus point is worth building** rather than being a private checklist. "Met it this
 * week" tells an instructor who is behind; this tells them *what to teach on Monday* — and it
 * arrives a week earlier than a leaderboard could manage, because somebody can be at 100% of their
 * minutes and still have skipped the hard bar every single time.
 *
 * Two rules carried over from the iOS card, both of which were bugs there first:
 *
 *   · **The headline earns its line only when it says something the list cannot.** When everything
 *     has been touched by somebody but not by everybody, `headline` names the weakest line — which
 *     is the first row of the list, verbatim, with the same numbers. So it is not drawn there.
 *   · **Green is arrival, and nothing else.** A studio's weakest instruction is information, not
 *     good news; amber is a gap, and `met` is only ever everybody, done.
 *
 * No meter on the rows. "2 of 5" already carries the fraction, and the width a bar would take comes
 * straight out of the instructor's own words — which *are* their teaching, and are the last thing
 * on this card that should give up room.
 */
function planCoverage(assignment, coverage) {
  if (!coverage.hasPlan) return null;

  const headline = coverage.isFullyCovered || coverage.untouched.length > 0
    ? coverage.headline
    : null;

  return el(
    "div",
    { class: "stack", style: "gap:0.4rem" },
    el("hr", { class: "divider" }),
    el(
      "div",
      { class: "row-between" },
      el("h4", { class: "micro", text: "The plan" }),
      el("span", { class: "caption numeral", text: count(coverage.lines.length, "line") }),
    ),
    headline && el("p", {
      class: "caption",
      style: coverage.isFullyCovered ? "color: var(--met)" : "color: var(--ink)",
      text: headline,
    }),
    el(
      "ul",
      { class: "stack", style: "margin:0; padding:0; list-style:none; gap:0.3rem" },
      coverage.lines.map((line) =>
        el(
          "li",
          { class: "row-between", style: "align-items:baseline; gap:0.75rem" },
          el("span", {
            class: "caption grow",
            style: line.isUntouched ? "color: var(--ink)" : undefined,
            text: focusPointPhrase(line.point),
          }),
          el("span", {
            class: "caption numeral plan-count",
            style: line.isUntouched ? "color: var(--accent)" : undefined,
            text: linePhrase(line),
          }),
        )
      ),
    ),
  );
}

export function assignmentsScreen(store, { onPrompt, onNew, onEdit, onDuplicate, onFinish }) {
  const week = currentWeek(store);
  const assignments = store.assignments();
  const performers = store.roster().filter((p) => p.role === "performer");
  const marks = marksByAssignment(store.focusMarks(), new Set([week.start.getTime()]));
  const memberSince = memberSinceDates({
    joined: Object.fromEntries(store.roster().map((m) => [m.id, m.joined_at ?? null])),
    facts: store.facts(),
  });

  const rows = assignments.map((assignment) => {
    const audience = performers.filter((p) => audienceIncludes(assignment, p.id));
    const metCount = audience.filter((p) => {
      const facts = store.facts().filter((f) =>
        f.performerId === p.id && f.assignmentId === assignment.id &&
        f.startedAt >= week.start && f.startedAt < week.end
      );
      return assignmentProgress(facts, assignment.target, store.rules()).isMet;
    }).length;

    return card(
      { class: "stack" },
      el(
        "div",
        { class: "row-between" },
        onEdit
          ? el("h3", {}, el("button", {
            class: "button--plain",
            type: "button",
            style: "color:inherit; font: inherit; text-align:left",
            onClick: () => onEdit(assignment),
            text: assignment.title,
          }))
          : el("h3", { text: assignment.title }),
        assignment.is_optional
          ? pill("Optional")
          : audience.length
          ? pill(`${metCount}/${audience.length} met`, metCount === audience.length ? "met" : undefined)
          : pill(performers.length ? "No one assigned" : "No performers yet"),
      ),
      assignment.section && el("p", { class: "caption", text: assignment.section }),
      el("p", { class: "caption", text: targetPhrase(assignment.target) }),
      !assignment.whole_studio && (audience.length
        ? el("p", { class: "caption", text: `For ${audience.map((p) => p.display_name).join(", ")}` })
        : el("p", { class: "caption", text: "The performers this was for have left the studio. Edit it to choose who it is for now." })),
      planCoverage(
        assignment,
        focusCoverage({
          points: assignment.focus_points,
          marks: marks.get(assignment.id) ?? [],
          rosterCount: assignmentAudience({
            assignment,
            performers,
            weeks: [week],
            memberSince: memberSince,
          }).length,
        }),
      ),
      onFinish && !assignment.closes_at && el("button", {
        type: "button",
        "aria-label": `Finish ${assignment.title}`,
        onClick: () => onFinish(assignment),
        text: "Finish it",
      }),
      (onDuplicate || onPrompt) && el("button", {
        type: "button",
        class: "button--quiet",
        style: "width:100%",
        "aria-label": `Set ${assignment.title} again for this week`,
        onClick: () => (onDuplicate ? onDuplicate(assignment) : onPrompt("assignWork")),
        text: "Set again this week",
      }),
    );
  });

  return el(
    "main",
    { id: "main", class: "page" },
    el("h1", { text: "Assignments" }),
    el(
      "p",
      { class: "caption" },
      "The instruction you would give in the room, on the stand while they practice.",
    ),
    heading("Open work", count(assignments.length, "assignment")),
    el("div", { class: "stack" }, rows),
    (onNew || onPrompt) && el("button", {
      type: "button",
      style: "width:100%",
      onClick: () => (onNew ? onNew() : onPrompt("assignWork")),
      text: "New assignment",
    }),
  );
}

/**
 * One performer, and the one thing an instructor can do about them from here.
 *
 * ==========================================================================================
 * Why a nudge exists at all
 * ==========================================================================================
 *
 * The gap it closes is that an instructor could see somebody who had not logged anything all week
 * — the dashboard is built to show exactly that — and then **do nothing**, because doing something
 * meant leaving the app for a phone number they may not have, for a fourteen-year-old who does not
 * answer texts from teachers.
 *
 * It is still not chat: one direction, no threads, no reply field, and no history for the performer
 * to answer into. If it ever grows one, that is a new decision against §8 rather than an extension
 * of this one.
 *
 * The suggestions come from `Nudge.suggestions` through the export, and they are written **as an
 * opening rather than a telling-off**: an instructor reaching for this is looking at somebody who
 * is behind, and the difference between "you haven't logged anything" and "checking in — anything
 * getting in the way?" is whether the performer opens the app again.
 */
/** A performer's first name, or "They" — `PerformerDetailView.firstName`, same fallback. */
function firstNameOf(performer) {
  return String(performer?.display_name ?? "").split(" ")[0] || "They";
}

export function performerScreen(store, {
  performer, onNudge, onBack, suggestions = [], busy = false, problem = null,
  span = null, onStepSpan = null, onPickSpan = null, onApplyCustom = null,
  selfReportMark = "",
}) {
  const viewed = span ?? {
    kind: "week",
    weeks: [currentWeek(store)],
    title: null,
    subtitle: null,
    periodName: "the week before",
  };
  const single = viewed.kind === "week";
  const viewedWeek = viewed.weeks[viewed.weeks.length - 1];
  const isCurrentWeek = single && viewedWeek.start.getTime() === currentWeek(store).start.getTime();
  const weekWord = isCurrentWeek ? "this week" : "that week";
  const { week, progress, byId } = weekProgress(store, performer.id, viewedWeek);
  const required = Object.entries(progress).filter(([id]) => !byId[id].is_optional);
  const metCount = required.filter(([, p]) => p.isMet).length;
  const standing = store.standings().find((s) => s.performerId === performer.id);
  const theirs = store.logs()
    .filter((l) => l.performerId === performer.id
      && l.startedAt >= viewed.weeks[0].start && l.startedAt < week.end);

  const spanRowsFor = single ? [] : performerWeekRows(store, performer.id, viewed.weeks);
  const rangeWithWork = spanRowsFor.filter((r) => r.hasWork);
  const rangeMet = rangeWithWork.filter((r) => r.isMet).length;
  const rangeAssigned = spanRowsFor.reduce((n, r) => n + r.assigned, 0);
  const rangeMetAssignments = spanRowsFor.reduce((n, r) => n + r.met, 0);
  const completionPhrase = rangeAssigned > 0
    ? `${Math.round((rangeMetAssignments / rangeAssigned) * 100)}%`
    : "—";
  const rangeSeconds = spanRowsFor.reduce((n, r) => n + r.seconds, 0);
  const rangeClips = spanRowsFor.reduce((n, r) => n + r.clips, 0);

  const listed = single ? required : store.assignments()
    .filter((a) => !a.is_optional
      && audienceIncludes(a, performer.id)
      && viewed.weeks.some((w) => isActiveDuring(a, w)))
    .map((a) => [a.id, progress[a.id] ?? assignmentProgress([], a.target, store.rules())]);
  const assignmentOf = (id) => byId[id] ?? store.assignments().find((a) => a.id === id);
  const sent = store.nudges().filter((n) => n.toPerformerId === performer.id);

  const message = el("input", { type: "text", id: "nudge", maxlength: "280" });

  return el(
    "main",
    { id: "main", class: "page" },
    el(
      "div",
      { class: "row", style: "gap:0.85rem" },
      avatar(performer),
      el(
        "div",
        { class: "grow stack", style: "gap:0.15rem" },
        el("h1", { text: performer.display_name }),
        el("p", { class: "caption", text: performer.instrument ?? "Performer" }),
      ),
    ),
    spanLine(store, viewed, onStepSpan, onPickSpan),
    customRangeEditor(viewed, onApplyCustom),
    single
      ? el(
        "div",
        { class: "stat-grid" },
        required.length
          ? stat(`${metCount}/${required.length}`, `met ${weekWord}`)
          : stat("—", `nothing set ${weekWord}`),
        stat(compactDuration(Object.values(progress).reduce((n, p) => n + p.countedSeconds, 0)), "practiced"),
        stat(String(standing?.currentStreak ?? 0), `${noun(standing?.currentStreak ?? 0, "week")} of streak`),
        stat(String(theirs.filter((l) => l.hasClip).length), `${noun(theirs.filter((l) => l.hasClip).length, "clip")} ${weekWord}`),
      )
      : card(
        { class: "stack", style: "gap:0.8rem" },
        el(
          "div",
          { class: "row-between" },
          el("h2", { text: "Across this range" }),
          el("span", { class: "caption numeral", text: completionPhrase }),
        ),
        rangeWithWork.length > 0 && el("p", {
          style: "font-weight:600",
          text: `${rangeMet} of ${rangeWithWork.length} ${rangeWithWork.length === 1 ? "week" : "weeks"} finished in full`,
        }),
        weekStrip(spanRowsFor),
        el(
          "div",
          { class: "row", style: "gap:1rem; align-items:baseline" },
          el("span", { class: "numeral", style: "font-weight:700", text: compactDuration(rangeSeconds) }),
          el("span", { class: "caption", text: "practiced" }),
          el("span", { class: "numeral", style: "font-weight:700", text: String(rangeClips) }),
          el("span", { class: "caption", text: rangeClips === 1 ? "clip" : "clips" }),
        ),
      ),
    heading(
      single ? "This week's work" : "Assignments",
      single
        ? weekPhrase(week, store.studio().time_zone)
        : `${rangeMet} of ${rangeWithWork.length} ${rangeWithWork.length === 1 ? "week" : "weeks"}`,
    ),
    listed.length === 0
      ? emptyState(
        "Nothing assigned",
        `${firstNameOf(performer)} had no assignments in this range.`,
      )
      : el(
        "div",
        { class: "stack" },
        listed.map(([id, p]) =>
          card(
            { class: "stack" },
            el(
              "div",
              { class: "row-between" },
              el("h3", { text: assignmentOf(id).title }),
              p.isMet ? pill("Met", "met") : pill(amountPhrase(p)),
            ),
            meter(progressFraction(p), {
              met: p.isMet,
              label: `${assignmentOf(id).title}, ${performer.display_name}`,
              valueText: amountPhrase(p),
            }),
            theirPlan(assignmentOf(id), { performerId: performer.id, assignmentId: id, startedAt: week.start }, store),
          )
        ),
      ),
    heading("Sessions", theirs.length > 0 ? String(theirs.length) : null),
    (() => {
      const phrase = instructorPhrase(theirs.filter((l) => l.selfReported).length, theirs.length);
      return phrase && el("p", { class: "caption", text: phrase });
    })(),
    theirs.length === 0
      ? card({ class: "stack" }, el("p", { class: "caption", text: "No sessions logged in this range." }))
      : el(
        "div",
        { class: "stack" },
        theirs.map((s) =>
          el(
            "div",
            { class: "card--inset row-between" },
            el(
              "div",
              { class: "stack", style: "gap:0.15rem" },
              el("span", { style: "font-weight:600", text: assignmentOf(s.assignmentId)?.title ?? "Practice" }),
              el("span", { class: "caption", text: whenPhrase(s.startedAt, store.studio().time_zone) }),
              s.hasClip && el("span", { class: "caption", text: heardPhrase(s) }),
              s.selfReported && selfReportMark && el("span", { class: "caption", text: selfReportMark }),
            ),
            el(
              "div",
              { class: "row", style: "gap:0.5rem" },
              s.hasClip && pill("Clip", "accent"),
              el("span", { class: "caption numeral", text: compactDuration(s.duration) }),
            ),
          )
        ),
      ),
    card(
      { class: "stack" },
      el("h2", { text: "Send one line" }),
      el("p", {
        class: "caption",
        text: "They see it once, next time they open IPT. There is no reply. This is not a message thread.",
      }),
      problem && notice(problem, { kind: "error" }),
      el(
        "form",
        {
          class: "stack",
          onSubmit: (e) => { e.preventDefault(); if (!busy) onNudge(message.value.trim()); },
        },
        field("Your message", message),
        el(
          "div",
          { class: "stack" },
          suggestions.map((text) =>
            el("button", {
              type: "button",
              class: "button--quiet",
              style: "text-align:left; justify-content:flex-start",
              onClick: () => { message.value = text; message.focus(); },
              text,
            })
          ),
        ),
        el("button", { class: "button--primary", style: "width:100%", type: "submit", disabled: busy, text: busy ? "Sending…" : "Send" }),
      ),
      sent.length > 0 && el("p", {
        class: "caption",
        text: `You have sent ${count(sent.length, "message")} to ${performer.display_name}. ` +
          `The last was ${whenPhrase(sent[0].createdAt, store.studio().time_zone)}.`,
      }),
    ),
    el("button", { class: "button--quiet", style: "width:100%", type: "button", onClick: onBack, text: "Back to the studio" }),
  );
}

/**
 * Writing an assignment: the other half of the instructor's job, and the half a Chromebook could
 * not do until now.
 *
 * ==========================================================================================
 * Every problem at once, never one at a time
 * ==========================================================================================
 *
 * `AssignmentDraft.problems` returns them all, deliberately — *a form that reveals one error at a
 * time is a form people submit four times* — and the messages are its, word for word, so an
 * instructor who has used both clients is told the same thing by both.
 *
 * ==========================================================================================
 * What is missing from this form on purpose
 * ==========================================================================================
 *
 * **`opens_at` cannot be edited on an existing assignment.** Moving it would retroactively change
 * which sessions ever counted toward it, so somebody's met week could become unmet by an
 * instructor fixing a typo. `SupabaseStore` leaves it out of the update payload for the same
 * reason; here it simply is not drawn.
 *
 * A blank row at the bottom of the plan is dropped rather than rejected: an empty line is how
 * people stop typing, not an error.
 */
export function assignmentEditorScreen(store, { assignment = null, onSave, onCancel, onDelete, busy = false, problem = null }) {
  const performers = store.performers();
  const isNew = !assignment?.id;

  const title = el("input", { type: "text", required: true, id: "a-title", maxlength: "120" });
  title.value = assignment?.title ?? "";
  const section = el("input", { type: "text", id: "a-section", maxlength: "60" });
  section.value = assignment?.section ?? "";

  const kind = el(
    "select",
    { id: "a-kind" },
    el("option", { value: "minutes", text: "Minutes a week" }),
    el("option", { value: "sessions", text: "Sessions a week" }),
  );
  kind.value = assignment?.target.kind ?? "minutes";
  const amount = el("input", { type: "number", id: "a-amount", min: "1", max: "10000", required: true });
  amount.value = String(assignment?.target.amount ?? 90);

  const guidance = targetGuidance(store.weeks(), store.facts(), termsFrom(store.terms()), new Date());
  const guidanceNote = el("p", {
    class: "caption",
    text: guidance ? guidancePhrase(guidance) : "",
  });
  const settleGuidance = () => {
    guidanceNote.hidden = !guidance || kind.value !== "minutes";
  };
  settleGuidance();
  kind.addEventListener("change", settleGuidance);

  const optional = el("input", { type: "checkbox", id: "a-optional", class: "check" });
  optional.checked = assignment?.is_optional ?? false;

  const takeLength = el(
    "select",
    { id: "a-take" },
    el("option", { value: "0", text: "Default: 5 minutes" }),
    ...[6, 8, 10, 12, 15].map((m) =>
      el("option", { value: String(m), text: `Up to ${m} minutes` })),
  );
  takeLength.value = String(assignment?.take_minutes ?? 0);

  const MAX_POINTS = 8;
  const points = el("div", { class: "stack" });
  const addLine = el("button", { type: "button", text: "Add a line", onClick: () => addPoint()?.focus() });
  const atCap = el("p", { class: "caption", hidden: true, text: "Eight is the most. A longer list gets skimmed." });

  /**
   * Numbers every row and settles the button, after **every** add and remove.
   *
   * Both halves were wrong when this was written by hand at creation time. Removing the second of
   * four left the rest labelled 1, 3, 4 — and a new line after that took a number one of them
   * already had, so two fields announced themselves identically to a screen reader. And the button
   * stayed pressable at the cap and silently did nothing, which is the same fault as a dead
   * affordance anywhere else: *chrome that cannot succeed.*
   */
  const renumber = () => {
    [...points.children].forEach((row, index) => {
      const input = row.querySelector("input");
      row.querySelector("label").textContent = `Thing to work on ${index + 1}`;
      row.querySelector("button").setAttribute("aria-label", `Remove thing to work on ${index + 1}`);
      input.setAttribute("aria-label", `Thing to work on ${index + 1}`);
    });
    const full = points.children.length >= MAX_POINTS;
    addLine.disabled = full;
    atCap.hidden = !full;
  };

  const addPoint = (text = "", tempo = null) => {
    if (points.children.length >= MAX_POINTS) return null;
    const input = el("input", { type: "text", maxlength: "80" });
    input.value = text;
    const beat = el("input", {
      type: "number", inputmode: "numeric",
      min: String(TEMPO_RANGE.min), max: String(TEMPO_RANGE.max),
      placeholder: "—",
      style: "width:5.5rem",
    });
    beat.value = tempo == null ? "" : String(tempo);
    const row = el(
      "div",
      { class: "row plan-row", style: "gap:0.5rem; align-items:end" },
      el("div", { class: "grow" }, field("Thing to work on", input)),
      el("div", {}, field("♩ =", beat)),
      el("button", {
        type: "button",
        class: "button--quiet",
        text: "Remove",
        onClick: () => { row.remove(); renumber(); },
      }),
    );
    row.dataset.point = "";
    points.append(row);
    renumber();
    return input;
  };
  for (const point of assignment?.focus_points ?? []) addPoint(point.text, point.tempo ?? null);
  renumber();

  const wholeStudio = el("input", { type: "checkbox", id: "a-whole", class: "check" });
  wholeStudio.checked = assignment ? assignment.whole_studio : true;
  const chosen = new Set(assignment?.audience ?? []);

  /**
   * The audience, **grouped into sections, each with one control that takes the whole section**.
   *
   * This was a flat column of checkboxes: a forty-person studio meant forty ticks, every week, from
   * the person who pays and quits first — while every profile already carries the instrument that
   * says which of them belong together. iOS has had the grouped picker since v20; the web had the
   * version the product review was complaining about.
   *
   * The heading **states the count rather than showing a checkbox**, which is iOS's reasoning and
   * holds here: a section is three states — none, some, all — and a checkbox that renders "some" as
   * unticked lies about what a tap will do. Tapping takes the whole section unless it is already
   * whole, in which case it clears it.
   *
   * `groupBySection` is `StudioSection.group`, imported rather than rewritten — it already carries
   * the rules that "Snare" and "snare" are one section named by the first spelling seen, and that
   * anybody with no instrument falls into a trailing group rather than disappearing.
   */
  const audience = el("div", { class: "stack", hidden: wholeStudio.checked });

  const settleSection = (section, countEl, actionEl) => {
    const ids = section.members.map((m) => m.id);
    const picked = ids.filter((id) => chosen.has(id)).length;
    const whole = picked === ids.length && ids.length > 0;
    countEl.textContent = `${picked} of ${ids.length}`;
    actionEl.textContent = whole ? "Clear" : "All";
    return whole;
  };

  for (const section of groupBySection(performers)) {
    const ids = section.members.map((m) => m.id);
    const count = el("span", { class: "caption numeral" });
    const action = el("span", { class: "caption", style: "color: var(--accent)" });
    const boxes = new Map();

    const header = el("button", {
      type: "button",
      class: "section-pick",
      onClick: () => {
        const whole = ids.every((id) => chosen.has(id)) && ids.length > 0;
        for (const id of ids) {
          if (whole) chosen.delete(id); else chosen.add(id);
          boxes.get(id).checked = !whole;
        }
        settleSection(section, count, action);
        header.setAttribute("aria-label", label());
      },
    }, el("span", { class: "micro", text: section.name }), el("span", { class: "grow" }), count, action);

    const label = () => {
      const picked = ids.filter((id) => chosen.has(id)).length;
      const whole = picked === ids.length && ids.length > 0;
      return `${section.name}, ${picked} of ${ids.length} selected. ${whole ? "Clears" : "Selects"} the section.`;
    };

    audience.append(header);
    for (const person of section.members) {
      const box = el("input", { type: "checkbox", class: "check", id: `who-${person.id}` });
      box.checked = chosen.has(person.id);
      box.addEventListener("change", () => {
        if (box.checked) chosen.add(person.id); else chosen.delete(person.id);
        settleSection(section, count, action);
        header.setAttribute("aria-label", label());
      });
      boxes.set(person.id, box);
      audience.append(el("div", { class: "check-list" }, field(person.display_name, box)));
    }
    settleSection(section, count, action);
    header.setAttribute("aria-label", label());
  }
  wholeStudio.addEventListener("change", () => { audience.hidden = wholeStudio.checked; });

  const problems = el("div", { class: "stack" });

  return el(
    "main",
    { id: "main", class: "page" },
    el("h1", { text: isNew ? "New assignment" : "Edit assignment" }),
    el(
      "form",
      {
        class: "stack",
        onSubmit: (event) => {
          event.preventDefault();
          if (busy) return;
          const draft = {
            title: title.value,
            section: section.value,
            target: { kind: kind.value, amount: Number(amount.value) },
            isOptional: optional.checked,
            takeMinutes: Number(takeLength.value) || null,
            focusPoints: [...points.querySelectorAll("[data-point]")]
              .map((row, position) => ({
                text: row.querySelector('input[type="text"]').value.trim(),
                tempo: cleanTempo(row.querySelector('input[type="number"]').value),
                position,
              }))
              .filter((p) => p.text),
            wholeStudio: wholeStudio.checked,
            audience: wholeStudio.checked ? [] : [...chosen],
            opensAt: assignment?.opens_at ?? new Date(),
          };
          const found = assignmentProblems(draft);
          replace(problems, ...found.map((p) => notice(p, { kind: "error" })));
          if (found.length) {
            problems.querySelector(".notice")?.scrollIntoView({ block: "nearest" });
            return;
          }
          onSave(draft);
        },
      },
      problem && notice(problem, { kind: "error" }),
      problems,
      card(
        { class: "stack" },
        el("h2", { text: "The work" }),
        field("Title", title, "What the performer sees: “Delécluse Étude 9, mm. 17–24”."),
        field("Section", section, "Optional. Percussion, Low Brass, Color Guard."),
      ),
      card(
        { class: "stack" },
        el("h2", { text: "The weekly target" }),
        field("Counted in", kind),
        field("Amount", amount),
        guidanceNote,
        el("div", { class: "check-list" }, field("Extra, not expected", optional)),
        field(
          "Recording length", takeLength,
          "Five minutes suits a passage or an étude. Set it longer for a run of the show or a full movement.",
        ),
        el("p", {
          class: "caption",
          text: "Optional work never breaks somebody's week, and never rescues one. It still counts minutes and points.",
        }),
      ),
      card(
        { class: "stack" },
        el("h2", { text: "What to work on" }),
        el("p", {
          class: "caption",
          text: "The instruction you would give in the room, on the stand while they practice.",
        }),
        points,
        addLine,
        atCap,
      ),
      card(
        { class: "stack" },
        el("h2", { text: "Who it is for" }),
        el("div", { class: "check-list" }, field("The whole studio", wholeStudio)),
        audience,
      ),
      el("button", {
        class: "button--primary",
        style: "width:100%",
        type: "submit",
        disabled: busy,
        text: busy ? "Saving…" : (isNew ? "Assign it" : "Save changes"),
      }),
      el("button", { class: "button--quiet", style: "width:100%", type: "button", onClick: onCancel, text: "Cancel" }),
      !isNew && onDelete && el("button", {
        class: "button--quiet",
        style: "width:100%; color: var(--live)",
        type: "button",
        onClick: onDelete,
        text: "Delete this assignment",
      }),
    ),
  );
}

/**
 * Every problem with a draft, in `AssignmentDraft.Problem`'s words.
 *
 * Copied deliberately and kept next to the form that shows them: these are product sentences, not
 * validation strings, and an instructor who uses both clients must not be told two different things
 * about the same mistake.
 */
/** The bound Swift's `AssignmentDraft.Problem.takeTooLong` uses. Kept beside the copy it belongs to. */
export const MAX_TAKE_MINUTES = 15;

export function assignmentProblems(draft) {
  const found = [];
  if (!draft.title.trim()) found.push("Give the assignment a title.");
  if (!(draft.target.amount > 0)) found.push("The weekly target has to be more than zero.");
  if (draft.closesAt && new Date(draft.closesAt) <= new Date(draft.opensAt)) {
    found.push("The end date is before the start date.");
  }
  if (!draft.wholeStudio && (draft.audience ?? []).length === 0) {
    found.push("Pick at least one performer, or assign it to the whole studio.");
  }
  if ((draft.focusPoints ?? []).length > 8) {
    found.push("Keep it to 8 things to work on. A longer list gets skimmed.");
  }
  if (draft.takeMinutes != null &&
      (draft.takeMinutes < 1 || draft.takeMinutes > MAX_TAKE_MINUTES)) {
    found.push(`A recording can be at most ${MAX_TAKE_MINUTES} minutes.`);
  }
  return found;
}

/**
 * The instructor's listening queue.
 *
 * ==========================================================================================
 * This is the screen the product rests on
 * ==========================================================================================
 *
 * Assign → practice → record → **listen** → feel heard → record again. Every rival dies at the
 * fourth step, and a performer needs about two weeks of silence before they stop attaching clips.
 * A director with eighteen unheard takes could otherwise only reach them one performer at a time:
 * open the roster, tap a name, scroll, play, mark heard, go back. Eighteen times. That is not a
 * feature gap — it is the reason the loop quietly stops happening in week three.
 *
 * So this is one queue, in `listeningOrder`, and the reply is one line. **Not chat**: one
 * direction, no threads, no reply field for the performer. If it ever grows one, that is a new
 * decision, not an extension of this one.
 *
 * The clip is loaded **on demand** — a signed URL per playback, minted when somebody presses play
 * rather than for eighteen clips on arrival. They are short-lived by design, so a page that minted
 * them all up front would hand out URLs that expire while the instructor is still working down the
 * queue.
 */
/**
 * One performer's plan for the take being listened to.
 *
 * Silent without a plan, exactly as `FocusProgress.phrase` is: an assignment with no plan is not an
 * assignment scoring zero, and a card headed "Their plan" over nothing is chrome that cannot say
 * anything.
 *
 * The week is the one the **take** belongs to, not today's. An instructor works down a queue, and
 * the clip at the bottom of it may be from a fortnight ago — showing this week's ticks against it
 * would be the right numbers about the wrong seven days.
 */
function theirPlan(assignment, log, store) {
  if (!assignment || (assignment.focus_points ?? []).length === 0) return null;

  const takeWeek = store.weeks().find((w) => log.startedAt >= w.start && log.startedAt < w.end);
  if (!takeWeek) return null;

  const worked = store.focusMarks()
    .filter((m) =>
      m.performerId === log.performerId &&
      m.assignmentId === assignment.id &&
      new Date(m.weekStart).getTime() === takeWeek.start.getTime()
    )
    .map((m) => m.focusPointId);

  const plan = focusProgress({ points: assignment.focus_points, worked });

  return el(
    "div",
    { class: "card--inset stack", style: "gap:0.35rem" },
    el(
      "div",
      { class: "row-between" },
      el("h3", { class: "micro", text: "Their plan" }),
      el("span", { class: "caption numeral plan-count", text: plan.phrase }),
    ),
    el(
      "ul",
      { class: "stack", style: "margin:0; padding:0; list-style:none; gap:0.25rem" },
      plan.points.map((point) =>
        el(
          "li",
          { class: "row", style: "gap:0.45rem; align-items:baseline" },
          el("span", {
            class: "caption",
            style: `flex:0 0 auto; color: var(${plan.isWorked(point.id) ? "--met" : "--muted"})`,
            text: plan.isWorked(point.id) ? "Worked" : "Not yet",
          }),
          el("span", {
            class: "caption grow",
            style: plan.isWorked(point.id) ? "color: var(--muted)" : "color: var(--ink)",
            text: focusPointPhrase(point),
          }),
        )
      ),
    ),
  );
}

export function listeningScreen(store, {
  onAcknowledge, onBack, clipURL, now = new Date(),
  rate = 1, rates = [], onRateChange = null,
} = {}) {
  const queue = listeningOrder(store.logs());
  const people = Object.fromEntries(store.roster().map((p) => [p.id, p]));

  let applyRate = null;
  const onRate = (fn) => { applyRate = fn; };
  const assignments = Object.fromEntries(store.assignments().map((a) => [a.id, a]));
  const heard = store.logs().filter((l) => l.hasClip && l.wasHeard).length;
  const waiting = waitingPhrase(store.logs(), now);
  const secondsLeftToHear = queue.reduce((total, log) => total + (log.clip?.seconds ?? 0), 0);

  const card_ = (log, index) => {
    const person = people[log.performerId];
    const note = el("input", { type: "text", id: `reply-${log.id}`, maxlength: "280" });
    const player = el("div", { class: "stack" });
    const status = el("p", { class: "caption", text: "" });

    const play = el("button", {
      class: "button--primary",
      style: "width:100%",
      type: "button",
      text: `Play ${clock(log.clip?.seconds ?? 0)}`,
      onClick: async () => {
        play.disabled = true;
        status.textContent = "Loading…";
        try {
          const audio = el("audio", { controls: true, preload: "auto", style: "width:100%" });
          audio.src = await clipURL(log.clip.path);
          audio.preservesPitch = true;
          audio.playbackRate = rate;
          onRate?.((next) => { audio.playbackRate = next; });
          play.replaceWith(audio);
          status.textContent = "";
          audio.play().catch(() => {
            status.textContent = "Press play.";
          });
          for (const [i, at] of (log.clip.markers ?? []).entries()) {
            player.append(el("button", {
              class: "button--quiet",
              type: "button",
              text: `Marked moment ${i + 1} · ${clock(at)}`,
              onClick: () => { audio.currentTime = at; audio.play().catch(() => {}); },
            }));
          }
        } catch (error) {
          play.disabled = false;
          status.textContent = error?.message ?? "That recording wouldn't load.";
        }
      },
    });
    player.append(play);

    const marked = log.clip?.markers ?? [];
    if (marked.length) {
      player.append(el("p", {
        class: "caption",
        style: "margin:0; color: var(--accent)",
        text: marked.length === 1 ? "They marked one spot" : `They marked ${marked.length} spots`,
      }));
    }

    return card(
      { class: "stack" },
      el(
        "div",
        { class: "row", style: "gap:0.85rem" },
        avatar(person ?? { id: log.performerId, display_name: "?" }),
        el(
          "div",
          { class: "grow stack", style: "gap:0.15rem" },
          el("h2", { text: person?.display_name ?? "Someone" }),
          el("span", {
            class: "caption",
            text: `${assignments[log.assignmentId]?.title ?? "Practice"} · ${whenPhrase(log.startedAt, store.studio().time_zone)}`,
          }),
        ),
        pill(positionPhrase(index, queue.length)),
      ),
      log.note && el("p", { class: "caption", text: `“${log.note}”` }),
      player,
      status,
      theirPlan(assignments[log.assignmentId], log, store),
      el(
        "form",
        {
          class: "stack",
          onSubmit: (event) => {
            event.preventDefault();
            onAcknowledge(log, note.value.trim() || null);
          },
        },
        field("Say one thing back (optional)", note),
        el("button", { type: "submit", style: "width:100%", text: "Heard it" }),
      ),
    );
  };

  return el(
    "main",
    { id: "main", class: "page" },
    el("h1", { text: "Listening" }),
    queue.length > 0 && rates.length > 0 && onRateChange && el(
      "div",
      { class: "row", style: "gap:0.5rem; align-items:center; flex-wrap:wrap" },
      el("span", { class: "caption", id: "rate-label", text: "Speed" }),
      el(
        "div",
        { role: "group", "aria-labelledby": "rate-label", class: "row", style: "gap:0.35rem; flex-wrap:wrap" },
        ...rates.map((r) =>
          el("button", {
            type: "button",
            class: r.value === rate ? "button--primary" : "button",
            "aria-label": r.spokenLabel,
            "aria-pressed": r.value === rate ? "true" : "false",
            text: r.label,
            onClick: () => {
              applyRate?.(r.value);
              onRateChange(r.value);
            },
          })
        ),
      ),
      savingPhrase(rate, secondsLeftToHear) && el("p", {
        class: "caption",
        style: "margin: 0; flex-basis: 100%",
        text: savingPhrase(rate, secondsLeftToHear),
      }),
    ),
    queue.length === 0
      ? card(
        { class: "stack", style: "text-align:center" },
        el("h2", { text: finishedPhrase(heard) }),
        el("p", { class: "caption", text: "When somebody attaches a recording to a session, it arrives here." }),
        el("button", { type: "button", onClick: onBack, text: "Back to the studio" }),
      )
      : el(
        "div",
        { class: "stack" },
        el("p", {
          class: "caption",
          text: waiting
            ? `${count(queue.length, "clip")} waiting, ${waiting}.`
            : `${count(queue.length, "clip")} waiting.`,
        }),
        ...queue.map(card_),
        el("button", { class: "button--quiet", type: "button", style: "width:100%", onClick: onBack, text: "Back to the studio" }),
      ),
  );
}


/**
 * The performer's own week.
 *
 * **The two actions are handed in rather than decided here**, which is what lets one screen serve
 * both stores without knowing which one answered. In the demo `onPractice` raises the purchase
 * prompt — *the blocked action is the walkthrough* — and against a real studio it starts a session.
 * `onFocusPoint` is optional for the same reason and is absent on a live studio, where ticking
 * happens inside the session screen, at the moment somebody actually worked on the instruction.
 */
/**
 * @param onDeleteSession lets a performer throw away one of their own sessions. **Only theirs, and
 *   only they may do it** — *a take is the performer's before it is the instructor's*, and the same
 *   rule governs a session set aside by the outbox: it is still practice they actually did. iOS has
 *   offered this since v11; the web store had `deleteLog` and nothing ever called it.
 */
export function practiceScreen(store, {
  onPrompt, onPractice, onFocusPoint, onNudgeSeen, onDeleteSession,
  onAddSession = null, selfReportMark = "",
  onClipURL = null,
  span = null, onStepSpan = null, onPickSpan = null, onApplyCustom = null,
  seenMilestoneKeys = null, onMilestoneSeen = null,
} = {}) {
  const me = store.profile();
  const viewed = span ?? {
    kind: "week",
    weeks: [currentWeek(store)],
    title: null,
    subtitle: null,
    periodName: "the week before",
  };
  const single = viewed.kind === "week";
  const viewedWeek = viewed.weeks[viewed.weeks.length - 1];
  const isCurrentWeek = single && viewedWeek.start.getTime() === currentWeek(store).start.getTime();
  const practice = isCurrentWeek
    ? (onPractice ?? (onPrompt && (() => onPrompt("logPractice"))))
    : null;
  const tick = isCurrentWeek
    ? (onFocusPoint ?? (onPrompt && (() => onPrompt("markFocusPoint"))))
    : null;
  const { week, progress, byId } = weekProgress(store, me.id, viewedWeek);
  const standing = store.standings().find((s) => s.performerId === me.id);

  const required = Object.entries(progress).filter(([id]) => !byId[id].is_optional);
  const metCount = required.filter(([, p]) => p.isMet).length;
  const isMet = weekMet(progress, byId);

  const priorStreak = Math.max(0, (standing?.currentStreak ?? 0) - (isMet ? 1 : 0));
  const streak = isCurrentWeek ? standingStreak(priorStreak, isMet) : 0;

  const spanWeeks = single ? [] : performerWeekRows(store, me.id, viewed.weeks);
  const weeksWithWork = spanWeeks.filter((r) => r.hasWork);
  const weeksMet = weeksWithWork.filter((r) => r.isMet).length;
  const weeksPhrase = weeksWithWork.length > 0
    ? `${weeksMet} of ${weeksWithWork.length} ${weeksWithWork.length === 1 ? "week" : "weeks"}`
    : "nothing assigned";
  const spanSeconds = spanWeeks.reduce((n, r) => n + r.seconds, 0);

  const totalSeconds = Object.values(progress).reduce((n, p) => n + p.countedSeconds, 0);

  let milestone = null;
  if (seenMilestoneKeys && isCurrentWeek) {
    const mine = store.facts().filter((f) => f.performerId === me.id);
    const history = store.weeks().map((w, index, weeks) => ({
      countedSeconds: Object.values(weekProgress(store, me.id, w, mine).progress)
        .reduce((n, p) => n + p.countedSeconds, 0),
      streakLength: index === weeks.length - 1 ? (isMet ? streak : 0) : 0,
    }));
    const clips = mine.filter((f) => f.hasClip).length;
    milestone = reachedMilestones({ weeks: history, clipCount: clips })
      .find((m) => !seenMilestoneKeys.has(`${me.id}-${m.id}`)) ?? null;
  }
  const fraction = required.length
    ? required.reduce((n, [, p]) => n + progressFraction(p), 0) / required.length
    : 0;

  const spanStart = viewed.weeks[0].start;
  const inRange = store.logs()
    .filter((l) => l.startedAt >= spanStart && l.startedAt < week.end);
  const mySessions = inRange.slice(0, 8);

  const myMarks = new Map();
  for (const mark of store.focusMarks()) {
    if (mark.performerId !== me.id) continue;
    if (new Date(mark.weekStart).getTime() !== week.start.getTime()) continue;
    const list = myMarks.get(mark.assignmentId) ?? [];
    list.push(mark.focusPointId);
    myMarks.set(mark.assignmentId, list);
  }

  const unseen = store.nudges().filter((n) => n.toPerformerId === me.id && !n.seenAt);
  const latest = unseen[0];
  if (latest && onNudgeSeen) onNudgeSeen(latest);

  return el(
    "main",
    { id: "main", class: "page" },
    el(
      "div",
      { class: "stack", style: "gap:0.25rem" },
      el("h1", { text: store.studio().name }),
      spanLine(store, viewed, onStepSpan, onPickSpan),
      customRangeEditor(viewed, onApplyCustom),
    ),
    latest && card(
      { class: "card--tinted stack" },
      el("h2", { class: "micro", style: "color: var(--accent)", text: "From your instructor" }),
      el("p", { text: latest.message }),
    ),
    milestone && card(
      { class: "card--tinted stack" },
      el(
        "div",
        { class: "row-between", style: "align-items:flex-start" },
        el("h2", { text: milestone.title }),
        el("button", {
          type: "button",
          class: "button--quiet",
          "aria-label": "Dismiss",
          onClick: () => onMilestoneSeen?.(milestone),
          text: "✕",
        }),
      ),
      el("p", { class: "caption", text: milestone.detail }),
    ),
    single
      ? card(
        { class: "row", style: "gap:1.1rem; align-items:center; flex-wrap:wrap; justify-content:center" },
        ring(fraction, required.length ? `${Math.floor(fraction * 100)}%` : "—",
          required.length ? `${metCount} of ${required.length} done` : "nothing set"),
        el(
          "div",
          { class: "grow stack", style: "gap:0.45rem; min-width:8.75rem" },
          el("div", { class: "numeral", style: "font-size:1.25rem; font-weight:700", text: longDuration(totalSeconds) }),
          el("p", { class: "caption", text: "practiced" }),
          streak >= 2 && pill(`${streak}-week streak`, "accent"),
          isMet && pill("Everything assigned this week is done", "met", { wraps: true }),
        ),
      )
      : card(
        { class: "stack", style: "gap:0.9rem" },
        el(
          "div",
          { class: "row", style: "gap:0.6rem; align-items:baseline" },
          el("span", {
            class: "numeral",
            style: "font-size:2.4rem; font-weight:700"
              + (weeksWithWork.length > 0 && weeksMet === weeksWithWork.length ? "; color: var(--met)" : ""),
            text: weeksWithWork.length > 0 ? `${weeksMet}` : "—",
          }),
          el(
            "div",
            { class: "stack", style: "gap:0" },
            el("span", {
              style: "font-weight:600",
              text: weeksWithWork.length > 0
                ? `of ${weeksWithWork.length} ${weeksWithWork.length === 1 ? "week" : "weeks"}`
                : "nothing assigned",
            }),
            el("span", { class: "caption", text: "finished in full" }),
          ),
        ),
        weekStrip(spanWeeks),
        el(
          "div",
          { class: "row", style: "gap:0.5rem; align-items:baseline" },
          el("span", { class: "numeral", style: "font-weight:700", text: compactDuration(spanSeconds) }),
          el("span", { class: "caption", text: "practiced" }),
        ),
      ),
    heading(
      single ? "This week's work" : "Assigned in this range",
      single ? `${metCount} of ${required.length} done` : weeksPhrase,
    ),
    required.length === 0
      ? emptyState("Nothing assigned yet", "When your instructor assigns work, it appears here.")
      : el(
        "div",
        { class: "stack" },
        required.map(([id, p]) => {
          const assignment = byId[id];
          return card(
            { class: "stack" },
            el(
              "div",
              { class: "row-between" },
              el("h3", { text: assignment.title }),
              p.isMet ? pill("Met", "met") : pill(amountPhrase(p)),
            ),
            assignment.section && el("p", { class: "caption", text: assignment.section }),
            meter(progressFraction(p), {
              met: p.isMet,
              label: `${assignment.title} progress`,
              valueText: amountPhrase(p),
            }),
            assignment.focus_points.length > 0 && (() => {
              const plan = focusProgress({
                points: assignment.focus_points,
                worked: myMarks.get(assignment.id) ?? [],
              });
              return el(
                "div",
                { class: "stack", style: "gap:0.3rem" },
                el(
                  "div",
                  { class: "row-between" },
                  el("span", { class: "micro", text: "The plan" }),
                  el("span", { class: "caption numeral plan-count", text: plan.phrase }),
                ),
                el(
                  "ul",
                  { class: "stack", style: "margin:0; padding-left:1.1rem; gap:0.25rem" },
                  plan.points.map((point) =>
                    el(
                      "li",
                      { class: "caption", style: plan.isWorked(point.id) ? "color: var(--muted)" : undefined },
                      tick
                        ? el("button", {
                          class: "button--plain",
                          type: "button",
                          style: "text-align:left; color:inherit; font-weight:400",
                          onClick: () => tick(point, assignment),
                          text: focusPointPhrase(point),
                        })
                        : focusPointPhrase(point),
                    )
                  ),
                ),
              );
            })(),
            practice && el("button", {
              class: "button--primary",
              type: "button",
              onClick: () => practice(assignment),
              text: p.isMet ? "Keep practicing" : "Start practicing",
            }),
          );
        }),
      ),
    heading("Your sessions",
      inRange.length > 0 ? longDuration(inRange.reduce((n, s) => n + s.duration, 0)) : null),
    mySessions.length === 0 && card(
      { class: "stack" },
      el("p", { class: "caption", text: isCurrentWeek ? "Nothing logged yet this week." : "Nothing logged in this range." }),
      isCurrentWeek && onAddSession && el("button", {
        class: "button", type: "button",
        text: "Add practice you already did",
        onClick: onAddSession,
      }),
    ),
    mySessions.length > 0 &&
      el(
        "div",
        { class: "stack" },
        mySessions.map((s) =>
          el(
            "div",
            { class: "card--inset row-between" },
            el(
              "div",
              { class: "stack", style: "gap:0.15rem" },
              el("span", { style: "font-weight:600", text: byId[s.assignmentId]?.title ?? "Practice" }),
              el("span", { class: "caption", text: whenPhrase(s.startedAt, store.studio().time_zone) }),
              s.hasClip && !s.isPending &&
                el("span", { class: "caption", text: heardPhrase(s) }),
              s.instructorNote && el("span", { class: "caption", text: `“${s.instructorNote}”` }),
              s.selfReported && selfReportMark &&
                el("span", { class: "caption", text: selfReportMark }),
            ),
            el(
              "div",
              { class: "row", style: "gap:0.5rem" },
              s.isSetAside ? pill("Not accepted") : s.isPending && pill("Waiting to send"),
              s.hasClip && (onClipURL
                ? el("button", {
                  class: "button--plain",
                  type: "button",
                  "aria-label": "Play your recording",
                  text: "\u25B6 Clip",
                  onClick: async (event) => {
                    const button = event.currentTarget;
                    button.disabled = true;
                    try {
                      const audio = el("audio", { controls: "", preload: "none", style: "max-width:100%" });
                      audio.src = await onClipURL(s.clip.path);
                      button.replaceWith(audio);
                      const first = (s.clip.markers ?? [])[0];
                      if (first) audio.currentTime = first;
                      audio.play().catch(() => {});
                    } catch {
                      button.disabled = false;
                      button.textContent = "Wouldn't load";
                    }
                  },
                })
                : pill("Clip", "accent")),
              el("span", { class: "caption numeral", text: compactDuration(s.duration) }),
              onDeleteSession && el("button", {
                class: "button--plain", type: "button",
                style: "color: var(--live); min-height:44px; padding:0 0.6rem",
                "aria-label": `Delete the session from ${whenPhrase(s.startedAt, store.studio().time_zone)}`,
                onClick: () => onDeleteSession(s),
                text: "Delete",
              }),
            ),
          )
        ),
      ),
  );
}

/**
 * One practice session, running.
 *
 * ==========================================================================================
 * The screen owns its clock, and hands back the same number it displayed
 * ==========================================================================================
 *
 * There is one elapsed time here, read from `Date.now()` at submit, and the ticking display is
 * derived from it. Two constructions of "how long has this been running" — a counter incremented
 * every second and a duration computed at the end — is how a display and a stored duration end up
 * disagreeing, and a tab that is backgrounded for twenty minutes is where they part company: a
 * browser throttles `setInterval` to once a minute in a hidden tab, so the counter would arrive at
 * the end tens of minutes short of the practice that actually happened.
 *
 * ==========================================================================================
 * Recording is optional, and refusing to record is not refusing to practice
 * ==========================================================================================
 *
 * The take is offered where the browser can make one an instructor's iPhone can play — that is
 * `capabilities()`'s single question, feature-tested rather than sniffed. Where it cannot, the
 * session still saves, because *practice is never lost; the clip is not practice.*
 *
 * `returns` an element carrying a `dispose` function: the shell calls it when the screen is
 * replaced, so a timer and a live microphone cannot outlive the screen that opened them.
 */
/**
 * @param onBlocked non-null in the demo: raises the walkthrough for `action` instead of doing it.
 *   **Asked before the microphone, not after.** The prompt has to land at the moment of *intent* —
 *   spending a browser's one-time microphone offer on a studio that does not exist is the same
 *   mistake as the demo that would have spent a real person's notification permission on Ana Reyes.
 */
/**
 * How long this assignment's take may run, said in the words the rest of the app uses.
 *
 * Falls silent rather than guessing when the capability did not report one — *say nothing rather
 * than something uncertain*, and a wrong number here is a performer planning a run of the show
 * around a limit that is not theirs.
 */
function takeLengthPhrase(maxSeconds) {
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) return "";
  const minutes = Math.round(maxSeconds / 60);
  return `Up to ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

/**
 * @param countInSeconds the wait this performer chose. **Defaults to none**, which is the safe
 *   direction for a caller that forgets: a missing count-in is a working recorder, while a
 *   surprise pause is a screen that appears to have ignored a press. The shell reads the stored
 *   value and hands it over, the same way it hands over `push.preferences()` — a screen that
 *   reached into `localStorage` itself could not be built by a test without one.
 */
/**
 * Writing down practice the app did not time.
 *
 * The performer's half of `SelfReport`, on the client a school hands out — which is the client
 * where this matters most, because the phone that would have run the timer is the thing the
 * district told them to put away.
 *
 * **Every refusal comes from `selfreport.js`**, which is Swift's rule transcribed and gated
 * against it. A validity check written inline here would be a second construction with nothing
 * proving the two agree, on a form where being wrong in either direction is silent: too strict
 * and real practice cannot be recorded, too loose and `0010`'s trigger rejects it *after* this
 * screen said it was fine.
 */
export function addSessionScreen(store, { onSave, onCancel, busy = false, problem = null } = {}) {
  const me = store.profile();
  const { week, byId } = weekProgress(store, me.id);
  const zone = store.studio().time_zone;

  const choices = Object.keys(byId).map((id) => byId[id]);

  if (choices.length === 0) {
    return el(
      "main",
      { id: "main", class: "page" },
      el("h1", { text: "Add practice" }),
      card(
        { class: "stack" },
        el("p", {
          text: "There is nothing assigned to you this week, so there is nothing to add practice against yet.",
        }),
      ),
      el("button", { class: "button", type: "button", text: "Back", onClick: onCancel }),
    );
  }

  const assignment = el(
    "select",
    { id: "s-assignment" },
    ...choices.map((a) => el("option", { value: a.id, text: a.title })),
  );

  const started = el("input", { type: "datetime-local", id: "s-started" });
  started.min = localInput(week.start, zone);
  started.max = localInput(new Date(), zone);
  started.value = localInput(new Date(), zone);

  const minutes = el(
    "select",
    { id: "s-minutes" },
    ...[5, 10, 15, 20, 25, 30, 40, 45, 50, 60, 75, 90, 105, 120, 150, 180, 240]
      .map((m) => el("option", { value: String(m), text: longDuration(m * 60) })),
  );
  minutes.value = "30";

  const note = el("textarea", { id: "s-note", rows: "2", placeholder: "Ran the opener four times" });

  const refusalNote = el("p", { class: "caption" });
  const submit = el("button", {
    class: "button--primary", type: "submit", style: "width:100%", text: "Add",
  });

  const settle = () => {
    const at = new Date(started.value);
    const kind = Number.isNaN(at.getTime())
      ? "notThisWeek"
      : refusal(at, Number(minutes.value) * 60, week, new Date());
    refusalNote.textContent = refusalSentence(kind) ?? "";
    refusalNote.hidden = !kind;
    submit.disabled = busy || !!kind;
  };
  settle();
  started.addEventListener("input", settle);
  minutes.addEventListener("change", settle);

  const form = el(
    "form",
    {
      onSubmit: (e) => {
        e.preventDefault();
        if (submit.disabled) return;
        onSave?.({
          assignmentId: assignment.value,
          startedAt: new Date(started.value),
          duration: Number(minutes.value) * 60,
          note: note.value.trim(),
        });
      },
    },
    card(
      { class: "stack" },
      field("What you practiced", assignment),
      field("Started", started),
      field("How long", minutes),
      field("Note", note, "Optional. What you worked on, for your instructor."),
      refusalNote,
      submit,
    ),
  );

  return el(
    "main",
    { id: "main", class: "page" },
    el("h1", { text: "Add practice" }),
    el("p", {
      class: "caption",
      text: "For practice you did without the timer running. It counts the same, and your instructor sees that you added it afterwards.",
    }),
    problem && notice(problem, { kind: "error" }),
    form,
    el("button", { class: "button", type: "button", text: "Back", onClick: onCancel }),
  );
}

/**
 * An instant as a `datetime-local` control speaks it — local wall-clock, no zone, no seconds.
 *
 * In the **studio's** zone, not the browser's. A performer on a trip who typed 7 AM means 7 AM
 * where the studio is, and the week they land in belongs to the studio: that is the whole reason
 * `studios.time_zone` exists, and taking the device's zone here would put a session in a
 * different week from the one their instructor sees it in.
 */
function localInput(instant, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || undefined,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(instant instanceof Date ? instant : new Date(instant));
  const at = (type) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = at("hour") === "24" ? "00" : at("hour");
  return `${at("year")}-${at("month")}-${at("day")}T${hour}:${at("minute")}`;
}

export function sessionScreen(store, {
  assignment, capabilities, countIns = [], countInSeconds = 0, onCountIn, onSave, onCancel, onBlocked,
}) {
  const startedAt = new Date();
  const rules = store.rules();
  const floorSeconds = rules.minimumCountableSession;

  const display = el("div", { class: "session-clock numeral", text: clock(0) });
  const belowFloor = el("p", {
    class: "caption",
    text: `Sessions under ${Math.floor(floorSeconds / 60)} minutes don't count toward the target.`,
  });
  const note = el("textarea", { rows: "2", id: "session-note" });

  const ticked = new Set();
  const focusRows = assignment.focus_points.map((point) => {
    const box = el("input", { type: "checkbox", id: `fp-${point.id}`, class: "check" });
    box.addEventListener("change", () => {
      if (box.checked) ticked.add(point.id);
      else ticked.delete(point.id);
    });
    return el("li", {}, field(focusPointPhrase(point), box));
  });

  const takeState = el("p", { class: "caption", text: "No recording yet." });
  let take = null;
  let recording = null; // { stop() }
  let countingIn = null; // an AbortController while the count-in is running

  /**
   * The wait between "Record" and the first note, offered where the need is discovered.
   *
   * iOS puts this in the session rather than only in Settings, and its comment says why: *this is
   * the moment somebody thinks about it — they are looking at Start, about to put the phone down
   * and walk to an instrument*, and the pilot asked for it even while it existed in Settings, which
   * is the only evidence about discoverability that counts.
   *
   * A native `<select>` rather than a hand-built radio group, deliberately. It is the web's
   * equivalent of the `Menu` iOS uses — one tap, never leaves the session — and it comes with
   * keyboard support, a screen-reader role and a touch picker that no reimplementation gets right
   * for free. It also sidesteps the trap this repo has now documented twice: *a control that
   * re-renders on change loses its own focus*, and a select changes nothing but itself.
   *
   * Drawn only when the words are here. The options are `CountIn`'s and they ride the export; a
   * picker offering bare numbers with no sentence about who each is for is the thing that makes a
   * choice unmakeable, which is the same rule the notification dial follows.
   */
  const countInField = countIns.length > 0 && (() => {
    const select = el("select", {
      id: "count-in",
      onChange: () => onCountIn?.(Number(select.value)),
    });
    const chosen = countInSeconds;
    for (const option of countIns) {
      const node = el("option", { value: String(option.seconds), text: `${option.label}: ${option.detail}` });
      if (option.seconds === chosen) node.selected = true;
      select.append(node);
    }
    return field("Count-in before recording", select);
  })();


  const recordButton = el("button", {
    type: "button",
    style: "width:100%",
    text: "Record a take",
    onClick: async () => {
      if (onBlocked) { onBlocked("recordTake"); return; }
      if (recording) { recording.stop(); return; }
      if (countingIn) { countingIn.abort(); return; }

      recordButton.textContent = "Stop the take";
      recordButton.className = "button--primary";
      try {
        const seconds = countInSeconds;
        if (seconds > 0) {
          countingIn = new AbortController();
          takeState.textContent = `Starting in ${seconds}…`;
          const { aborted } = await countIn(seconds, {
            signal: countingIn.signal,
            onTick: (left) => { takeState.textContent = `Starting in ${left}…`; },
          });
          countingIn = null;
          if (aborted) {
            takeState.textContent = take ? `Take attached · ${clock(take.duration)}` : "No recording yet.";
            recordButton.textContent = take ? "Record it again" : "Record a take";
            recordButton.className = "";
            return;
          }
        }
        recording = await capabilities.start({
          onTick: (seconds) => {
            const left = capabilities.remaining?.(seconds) ?? null;
            takeState.textContent = left == null
              ? `Recording · ${clock(seconds)}`
              : `Recording · ${clock(seconds)} · stops in ${left}s`;
          },
        });
        take = await recording.done;
        takeState.textContent = `Take attached · ${clock(take.duration)}`;
      } catch (error) {
        take = null;
        takeState.textContent = error?.message ?? "That take didn't record.";
      } finally {
        recording = null;
        countingIn = null;
        recordButton.textContent = take ? "Record it again" : "Record a take";
        recordButton.className = "";
      }
    },
  });

  const elapsedSeconds = () => Math.floor((Date.now() - startedAt.getTime()) / 1000);
  const timer = setInterval(() => {
    display.textContent = clock(elapsedSeconds());
    belowFloor.hidden = elapsedSeconds() >= floorSeconds;
  }, 1000);

  const screen = el(
    "main",
    { id: "main", class: "page" },
    el(
      "div",
      { class: "stack", style: "gap:0.25rem" },
      el("h1", { text: assignment.title }),
      el("p", { class: "caption", text: targetPhrase(assignment.target) }),
    ),
    card({ class: "stack", style: "text-align:center" }, display, belowFloor),
    capabilities.canRecord
      ? card(
        { class: "stack" },
        el("h2", { text: "Record a take" }),
        el("p", {
          class: "caption",
          text:
            "Tip: play your click out loud in the room. The take captures you and the click "
            + "together, so your instructor can hear how they line up. "
            + takeLengthPhrase(capabilities.maxSeconds),
        }),
        takeState,
        recordButton,
        countInField,
      )
      : card(
        { class: "stack" },
        el("h2", { text: "Recording" }),
        el("p", { class: "caption", text: capabilities.reason }),
      ),
    focusRows.length > 0 && card(
      { class: "stack" },
      el("h2", { text: "What to work on" }),
      el("ul", { class: "stack check-list", style: "margin:0; padding:0; list-style:none" }, focusRows),
    ),
    card({ class: "stack" }, el("h2", { text: "Anything to say?" }), field("Note for your instructor", note)),
    el("button", {
      class: "button--primary",
      style: "width:100%",
      type: "button",
      text: "Save this session",
      onClick: () => {
        recording?.stop();
        onSave({
          assignmentId: assignment.id,
          startedAt,
          duration: elapsedSeconds(),
          note: note.value.trim() || null,
          clip: take?.blob ?? null,
          clipDuration: take?.duration ?? null,
          markers: [],
          focusPointIds: [...ticked],
        });
      },
    }),
    el("button", {
      class: "button--quiet",
      style: "width:100%",
      type: "button",
      text: "Discard this session",
      onClick: () => { recording?.stop(); onCancel(); },
    }),
  );

  screen.dispose = () => {
    clearInterval(timer);
    recording?.stop();
  };
  return screen;
}


export function standingsScreen(store, { onDisplay } = {}) {
  const standings = store.standings();
  const people = Object.fromEntries(store.roster().map((p) => [p.id, p]));
  const me = store.profile();

  const window = seasonWindow(termsFrom(store.terms()), {
    studioCreatedAt: store.studio().created_at,
    now: new Date(),
  });
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", timeZone: store.studio().time_zone,
  });

  return el(
    "main",
    { id: "main", class: "page" },
    el("h1", { text: "Standings" }),
    el("p", {
      class: "caption",
      text: `${window.term ? window.term.name : "All season"} · ${fmt.format(window.from)} – ${fmt.format(window.to)}`,
    }),
    el("p", {
      class: "caption",
      text: "Points reward finishing the work, not the clock. The board is this studio only.",
    }),
    onDisplay && el("button", {
      style: "width:100%",
      text: "Put the top ten on the screen",
      onClick: () => onDisplay(),
    }),
    el(
      "ol",
      { class: "stack", style: "list-style:none; margin:0; padding:0" },
      standings.map((s) => {
        const person = people[s.performerId];
        const isMe = person?.id === me.id;
        return el(
          "li",
          {
            class: "card row",
            style: `gap:0.85rem; ${isMe ? "border-color: var(--accent)" : ""}`,
            "aria-current": isMe ? "true" : undefined,
          },
          el("span", { class: "rank numeral", text: `${s.rank}` }),
          avatar(person),
          el(
            "div",
            { class: "grow stack", style: "gap:0.2rem" },
            el(
              "div",
              { class: "row", style: "gap:0.5rem; flex-wrap:wrap" },
              el("span", { style: "font-weight:600", text: person.display_name }),
              isMe && pill("You", "accent"),
            ),
            el(
              "div",
              { class: "row", style: "gap: 0.5rem; flex-wrap: wrap" },
              el("span", {
                class: "caption",
                style: "white-space: nowrap",
                text: `${completionPhrase(s.assignmentsMet, s.assignmentsAssigned)} of assigned work`,
              }),
              el("span", {
                class: "caption numeral",
                style: "white-space: nowrap",
                text: compactDuration(s.practiceSeconds),
              }),
            ),
          ),
          el(
            "div",
            { style: "text-align:right" },
            el("div", { class: "numeral", style: "font-weight:700", text: String(s.points) }),
            el("div", { class: "caption", text: "points" }),
          ),
        );
      }),
    ),
  );
}


export function youScreen(store, {
  onHelp,
  onLeave, offer, onSignOut, outbox = null, onSwitchStudio, onAnotherStudio = null, onDeleteAccount, onReminders,
  onTerms, onScoring, onRoster, onSeason, onLeaveStudio, onSaveProfile, onDeleteStudio,
}) {
  const me = store.profile();
  const studio = store.studio();
  const others = store.joinedStudios?.() ?? (store.studio() ? [store.studio()] : []);
  const buyerLink = checkoutURLFor(offer, store.isDemo ? null : me?.id);

  return el(
    "main",
    { id: "main", class: "page" },
    el("h1", { text: "You" }),
    card(
      { class: "row", style: "gap:0.85rem" },
      avatar(me),
      el(
        "div",
        { class: "grow stack", style: "gap:0.15rem" },
        el("span", { style: "font-weight:600", text: me.display_name }),
        el("span", { class: "caption", text: store.isInstructor ? "Instructor" : me.instrument ?? "Performer" }),
      ),
    ),
    outbox && !outbox.quiet && card(
      { class: "stack" },
      el("h2", { text: "Practice waiting to send" }),
      outbox.waiting > 0 && el("p", {
        class: "caption",
        text: `${count(outbox.waiting, "session")} on this device, waiting for a connection. ` +
          `It counts toward your week already, and it is not going anywhere.`,
      }),
      outbox.setAside > 0 && notice(
        `${count(outbox.setAside, "session")} the server wouldn't accept. The work it was against ` +
          `may have been removed. It is still yours; only you can throw it away.`,
        { kind: "error" },
      ),
    ),
    studio && store.isInstructor && studio.join_code && card(
      { class: "stack" },
      el("h2", { text: "Your join code" }),
      el("p", { class: "numeral", style: "font-size:1.6rem; font-weight:700; letter-spacing:0.12em", text: groupedCode(studio.join_code) }),
      el("p", { class: "caption", text: "Performers choose “Join a studio” and type this. It never uses characters that sound alike, so it is safe to read out across a rehearsal room. Everyone joins as a performer. To add another instructor, open the roster and make them one." }),
    ),
    others.length > 0 && card(
      { class: "stack" },
      el("h2", { text: "Your studios" }),
      ...others.map((s) =>
        el("button", {
          type: "button",
          style: "width:100%",
          "aria-current": s.id === studio?.id ? "true" : undefined,
          onClick: () => onSwitchStudio?.(s.id),
          text: s.id === studio?.id ? `${s.name} · open` : s.name,
        })
      ),
      onAnotherStudio && el("p", { class: "caption", text: "An instructor running two programs keeps them separate: each studio has its own roster, its own assignments and its own standings." }),
      onAnotherStudio && el("button", {
        class: "button--quiet", type: "button", style: "width:100%",
        onClick: onAnotherStudio,
        text: "Start or join another studio",
      }),
    ),
    offer && store.isDemo && card(
      { class: "stack" },
      el("h2", { text: "Getting IPT" }),
      el("p", { class: "caption", text: offer.line }),
      el("p", { class: "caption", text: offer.reassurance }),
      el("p", {
        class: "caption",
        text: !offer.isBuyable
          ? "Not on sale yet. This demo is the whole app, and it stays free."
          : buyerLink
          ? "Buying opens in a new tab. It attaches to the account you are signed in to here."
          : "Create a free account first. Buying attaches the purchase to the account you are signed in to.",
      }),
      buyerLink && el("a", {
        class: "button--primary",
        style: "width:100%; display:block; text-align:center",
        href: buyerLink,
        target: "_blank",
        rel: "noopener",
        text: `Get IPT for ${offer.priceText}`,
      }),
    ),
    (onTerms || onScoring || onRoster) && card(
      { class: "stack" },
      el("h2", { text: "Running this studio" }),
      onRoster && el("button", {
        type: "button", style: "width:100%", onClick: onRoster, text: "Roster",
      }),
      onScoring && el("button", {
        type: "button", style: "width:100%", onClick: onScoring, text: "Scoring",
      }),
      onTerms && el("button", {
        type: "button", style: "width:100%", onClick: onTerms, text: "Terms",
      }),
      el("p", {
        class: "caption",
        text: "Who is in the studio, how it is scored, and when it is running.",
      }),
    ),
    onReminders && card(
      { class: "stack" },
      el("h2", { text: "Reminders" }),
      el("p", {
        class: "caption",
        text: store.isInstructor
          ? "A summary when the practice week closes, and how often you hear from IPT."
          : "Practice reminders on this device, and how often you hear from IPT.",
      }),
      el("button", { type: "button", style: "width:100%", onClick: onReminders, text: "Reminders" }),
    ),
    onSeason && card(
      { class: "stack" },
      el("h2", { text: "The season" }),
      el("p", {
        class: "caption",
        text: store.isInstructor
          ? "A written summary of the studio, to send to a booster club, a head of department or a parent."
          : "A written summary of your season, to keep or to send to anybody you like.",
      }),
      el("button", { type: "button", style: "width:100%", onClick: onSeason, text: "See the summary" }),
    ),
    onHelp && card(
      { class: "stack" },
      el("h2", { text: "How IPT works" }),
      el("p", {
        class: "caption",
        text: "The idea, and the questions people actually ask: what counts as a week being met, "
          + "who can hear your recordings, why a number rounded the way it did.",
      }),
      el("button", { type: "button", style: "width:100%", onClick: onHelp, text: "How IPT works" }),
      el("a", {
        href: "https://iptmusic.com/privacy",
        target: "_blank",
        rel: "noopener",
        class: "caption",
        style: "text-align:center; display:block; color: var(--muted); min-height: 44px; padding-top: 12px",
        text: "Privacy policy",
      }),
    ),
    onLeave && el("button", { class: "button--quiet", style: "width:100%", type: "button", onClick: onLeave, text: "Leave the demo" }),
    onSaveProfile && card(
      { class: "stack" },
      el("h2", { text: "Your details" }),
      el("p", {
        class: "caption",
        text: "Your instrument groups you into a section on the roster. Both are visible to your "
          + "studio.",
      }),
      (() => {
        const name = el("input", { type: "text", id: "me-name", maxlength: "60", required: true });
        name.value = me.display_name ?? "";
        const instrument = el("input", { type: "text", id: "me-instrument", maxlength: "40" });
        instrument.value = me.instrument ?? "";
        const said = el("p", { class: "caption", role: "status", text: "" });
        return el(
          "form",
          {
            class: "stack",
            onSubmit: (event) => {
              event.preventDefault();
              const trimmed = name.value.trim();
              if (!trimmed) { said.textContent = "Your name can't be empty."; return; }
              onSaveProfile({ displayName: trimmed, instrument: instrument.value.trim() || null });
            },
          },
          field("Your name", name),
          field("Instrument", instrument, "Optional. Percussion, Low Brass, Color Guard."),
          el("button", { class: "button--primary", style: "width:100%", type: "submit", text: "Save" }),
          said,
        );
      })(),
    ),
    onLeaveStudio && card(
      { class: "stack" },
      el("h2", { text: "Leaving" }),
      el("p", {
        class: "caption",
        text: "You stop seeing it. Your instructor keeps what you sent them, and the studio's standings stop counting you.",
      }),
      el("button", {
        class: "button--quiet", style: "width:100%; color: var(--live)", type: "button",
        onClick: onLeaveStudio, text: `Leave ${store.studio()?.name ?? "this studio"}`,
      }),
    ),
    onDeleteStudio && card(
      { class: "stack" },
      el("h2", { text: "Deleting this studio" }),
      el("p", {
        class: "caption",
        text: "This ends it for everybody in it, not just for you. The confirmation says exactly "
          + "how much practice that is before anything happens.",
      }),
      el("button", {
        class: "button--quiet", style: "width:100%; color: var(--live)", type: "button",
        onClick: onDeleteStudio, text: `Delete ${store.studio()?.name ?? "this studio"}`,
      }),
    ),
    onSignOut && el("button", { class: "button--quiet", style: "width:100%", type: "button", onClick: onSignOut, text: "Sign out" }),
    onDeleteAccount && el(
      "details",
      { class: "card stack" },
      el("summary", { style: "font-weight:600; min-height:44px; display:flex; align-items:center", text: "Delete your account" }),
      el("p", { class: "caption", text: deletionCost({
        studios: store.joinedStudios?.() ?? [],
        logs: store.logs(),
        roster: store.roster(),
        profileId: me.id,
      }).phrase }),
      el("p", { class: "caption", text: "It cannot be undone, and support cannot bring it back." }),
      el("button", {
        style: "width:100%; color: var(--live)",
        type: "button",
        onClick: onDeleteAccount,
        text: "Delete my account",
      }),
    ),
  );
}

/**
 * Reminders, and the honest sentence when there cannot be any.
 *
 * ## Why this screen says so much about what it cannot do
 *
 * A browser cannot schedule a notification, so the whole feature depends on Web Push — and Web Push
 * is *absent* on more devices than it is present on for this audience. On iOS Safari it works only
 * once the app is on the Home Screen; in the in-app browsers a managed Chromebook often runs it does
 * not work at all; and somebody who has said no once can only undo that in browser settings.
 *
 * Every one of those is a state where a button would do nothing. **Chrome that cannot succeed is
 * what makes a new app feel broken rather than new**, and the alternative to naming the reason is a
 * performer concluding the app is broken and an instructor concluding they are being ignored. So
 * each case gets its own sentence and no button it cannot honour.
 *
 * ## What the dial's words are, and where they come from
 *
 * `NotificationVolume`, exported through `demo-studio.json` with the rest of the product sentences.
 * "up to 6 a week" is a promise about how often this app interrupts a fourteen-year-old, and two
 * clients quietly promising different numbers is exactly the drift that export exists to prevent.
 */
export function remindersScreen({
  capability,
  /**
   * Whether a subscription **actually exists**, which is a different question from whether
   * permission was granted and is the only one worth drawing a state from. See `push.capability`.
   */
  subscribed = false,
  configured,
  preferences,
  volumes,
  isInstructor,
  onVolume,
  onEnable,
  onDisable,
  busy = false,
  problem = null,
}) {
  const detail = (v) => (isInstructor ? v.instructorDetail : v.performerDetail);
  const expectation = (v) => (isInstructor ? v.instructorExpectation : v.performerExpectation);

  const theOtherAnswer = el("p", {
    class: "caption",
    text: "IPT on an iPhone reminds you without any of this. It schedules them on the phone itself.",
  });

  const unavailable = (title, ...body) =>
    card({ class: "stack" }, el("h2", { text: title }), ...body, theOtherAnswer);

  let head;
  if (!configured) {
    head = unavailable(
      "Reminders aren't switched on for this site yet",
      el("p", { class: "caption", text: "Nothing is wrong with your browser. This is on us." }),
    );
  } else if (capability === "unsupported") {
    head = unavailable(
      "This browser can't show reminders",
      el("p", {
        class: "caption",
        text: "It doesn't support notifications from a website. Chrome on a Chromebook or an " +
          "Android phone does, and so does Safari once IPT is on your Home Screen.",
      }),
    );
  } else if (capability === "needsInstall") {
    head = unavailable(
      "Add IPT to your Home Screen first",
      el("p", {
        class: "caption",
        text: "On an iPhone or iPad, a website can only send reminders once it has been added to " +
          "the Home Screen. Tap Share, then Add to Home Screen, then open IPT from there.",
      }),
    );
  } else if (capability === "denied") {
    head = unavailable(
      "Reminders are blocked for this site",
      el("p", {
        class: "caption",
        text: "Your browser is set to refuse notifications from IPT, and only your browser's " +
          "settings for this site can change that back.",
      }),
    );
  } else if (!subscribed) {
    head = card(
      { class: "stack" },
      el("h2", { text: "Practice reminders" }),
      el("p", {
        class: "caption",
        text: isInstructor
          ? "One summary at the end of the practice week, and a note when a new one opens."
          : "A nudge on the days you're behind, a warning before a streak breaks, and a wrap-up " +
            "when the week closes.",
      }),
      el("button", {
        type: "button",
        style: "width:100%",
        disabled: busy || undefined,
        onClick: onEnable,
        text: busy ? "Just a moment…" : "Turn on reminders",
      }),
      problem && notice(problem, { kind: "error", role: "alert" }),
    );
  } else {
    head = card(
      { class: "stack" },
      el("h2", { text: "Reminders are on" }),
      el("p", {
        class: "caption",
        text: "They're sent to this browser. Turning them on somewhere else adds that device too; " +
          "it doesn't move them.",
      }),
      el("button", {
        type: "button",
        class: "button--quiet",
        style: "width:100%",
        disabled: busy || undefined,
        onClick: onDisable,
        text: "Turn off reminders on this browser",
      }),
      problem && notice(problem, { kind: "error", role: "alert" }),
    );
  }

  return el(
    "main",
    { id: "main", class: "page" },
    el("h1", { text: "Reminders" }),
    head,
    volumes.length > 0 && card(
      { class: "stack" },
      el("h2", { text: "How much you hear from IPT" }),
      el(
        "div",
        { role: "radiogroup", "aria-label": "How much you hear from IPT", class: "options" },
        ...volumes.map((v, index) =>
          el(
            "button",
            {
              type: "button",
              role: "radio",
              "aria-checked": preferences.volume === v.name ? "true" : "false",
              tabindex: preferences.volume === v.name ? "0" : "-1",
              style: "width:100%",
              "data-volume": v.name,
              onKeyDown: (event) => {
                const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
                if (!step) return;
                event.preventDefault();
                onVolume?.(volumes[(index + step + volumes.length) % volumes.length].name);
              },
              onClick: () => onVolume?.(v.name),
            },
            el("span", { style: "font-weight:600", text: v.label }),
            el("span", { class: "caption", text: `${expectation(v)}: ${detail(v)}` }),
          )
        ),
      ),
    ),
    capability === "granted" && card(
      { class: "stack" },
      el("h2", { text: "What this can't do yet" }),
      el("p", {
        class: "caption",
        text: "Being told your instructor heard a take arrives when you next open IPT, not the " +
          "moment they listen. Scheduled reminders, the ones above, are sent to your device.",
      }),
    ),
  );
}

/**
 * The standings, where the server cannot answer for them.
 *
 * **Not an empty board**, which is the point. `0004_judgement.sql` is committed and not applied to
 * the production project, so `studio_leaderboard` is not there to ask — and a list of performers on
 * zero points is a claim about how much everybody practiced, made by a client that does not know.
 * *Say nothing rather than something uncertain*, and say which nothing it is.
 */
export function standingsUnavailableScreen() {
  return el(
    "main",
    { id: "main", class: "page" },
    el("h1", { text: "Standings" }),
    card(
      { class: "stack" },
      el("h2", { text: "Not available from this studio yet" }),
      el("p", {
        class: "caption",
        text:
          "Points and ranks are worked out by the server, never by this device. It does not hold " +
          "anybody else's latest practice. This project has not been given that yet.",
      }),
      el("p", {
        class: "caption",
        text: "Everything else works: assigned work, your own week, and every session you log.",
      }),
    ),
  );
}


/**
 * Terms — when the studio is actually running.
 *
 * The reason this screen exists at all is that **a break is not a miss.** Without terms, summer,
 * winter break and exam weeks all read as weeks somebody failed to practice, and a marching band's
 * guaranteed annual summer resets every streak in the studio. A number that punishes you for the
 * calendar teaches people the number is arbitrary.
 *
 * A studio with no terms is always in session, which is exactly how one behaved before terms
 * existed — so this must never read as a setup step standing between a new instructor and their
 * first assignment. Hence the empty state says "this is fine" rather than "you have not finished".
 */
export function termsScreen(store, { onSave, onDelete, onBack, busy = false, problem = null }) {
  const terms = [...store.terms()].sort((a, b) => new Date(a.starts_on) - new Date(b.starts_on));
  const timeZone = store.studio()?.time_zone ?? undefined;

  const name = el("input", { type: "text", id: "term-name", maxlength: "60" });
  const startsOn = el("input", { type: "date", id: "term-starts" });
  const endsOn = el("input", { type: "date", id: "term-ends" });

  return el(
    "main",
    { id: "main", class: "page" },
    el("h1", { text: "Terms" }),

    terms.length === 0
      ? card(
        { class: "stack" },
        el("h2", { text: "This studio runs all year" }),
        el("p", {
          class: "caption",
          text: "Which is fine, and is what happens if you never add a term. Add one when your " +
            "program has a break in it: weeks outside a term are not weeks anybody missed, so " +
            "nobody's streak dies over the summer.",
        }),
      )
      : card(
        { class: "stack" },
        el("h2", { text: "When this studio is running" }),
        ...terms.map((term) =>
          el(
            "div",
            { class: "row", style: "gap:0.6rem" },
            el(
              "div",
              { class: "grow stack", style: "gap:0.1rem" },
              el("span", { style: "font-weight:600", text: term.name }),
              el("span", { class: "caption", text: termRange(term, timeZone) }),
            ),
            el("button", {
              type: "button",
              class: "button--quiet",
              style: "color: var(--live)",
              "aria-label": `Delete the term ${term.name}`,
              disabled: busy || undefined,
              onClick: () => onDelete?.(term),
              text: "Delete",
            }),
          )
        ),
        el("p", {
          class: "caption",
          text: "No practice is deleted. The weeks it covered stop counting as term time, which " +
            "can only lengthen somebody's streak.",
        }),
      ),

    card(
      { class: "stack" },
      el("h2", { text: "Add a term" }),
      field("Name", name, "“Fall season”, “Spring semester”."),
      field("Starts", startsOn),
      field("Ends", endsOn, "Leave blank for a term with no end: a studio that just keeps going."),
      problem && notice(problem, { kind: "error", role: "alert" }),
      el("button", {
        type: "button",
        class: "button--primary",
        style: "width:100%",
        disabled: busy || undefined,
        onClick: () => onSave?.({
          name: name.value,
          startsOn: startsOn.value,
          endsOn: endsOn.value || null,
        }),
        text: busy ? "Saving…" : "Add term",
      }),
      el("p", {
        class: "caption",
        text: "Overlapping terms are fine. Weeks inside a term are judged as usual. A missed week " +
          "still ends a streak. Weeks outside one are not missed weeks.",
      }),
    ),
    onBack && el("button", {
      class: "button--quiet", style: "width:100%", type: "button", onClick: onBack,
      text: "Back to You",
    }),
  );
}

/**
 * Last week's assignment, ready to be this week's — `AssignmentDraft.init(duplicating:)`.
 *
 * A second construction of a product rule, and licensed the way `ListeningQueue`'s was: **proved by
 * properties rather than by a copied expected list**, because the thing that must match is a set of
 * decisions rather than a set of bytes. `screens_test.js` asserts all three.
 *
 * The decisions:
 *
 *   · **No id.** That is what makes the editor treat it as new. Carrying the id over would make
 *     "set it again" overwrite last week's assignment — losing the record of what was asked for,
 *     and retroactively changing which sessions ever counted.
 *   · **No closing date.** Copying one that has already passed produces an assignment that is
 *     closed the moment it is made: invisible on every screen, counted by nothing, with no error to
 *     explain it.
 *   · **The title unchanged.** "Rudiment Ladder" in week 12 *is* "Rudiment Ladder"; "(copy)" would
 *     put a word on a performer's screen that means something only to whoever pressed the button.
 *
 * Focus-point identity needs no handling here and that is worth saying rather than leaving to be
 * rediscovered: this client's editor sends `{text, position}` and never an id, so a fresh identity
 * is a property of how it saves. Swift has to do it explicitly because its drafts carry `FocusPoint`
 * values, ids and all.
 */
export function duplicateOf(assignment) {
  return {
    id: null,
    title: assignment.title,
    section: assignment.section ?? null,
    target: { ...assignment.target },
    is_optional: assignment.is_optional,
    take_minutes: assignment.take_minutes ?? null,
    focus_points: assignment.focus_points.map((point, position) => ({
      text: point.text, tempo: point.tempo ?? null, position,
    })),
    whole_studio: assignment.whole_studio,
    audience: [...(assignment.audience ?? [])],
    closes_at: null,
  };
}

/**
 * `TermDraft`'s rules, in its sentences. Every problem at once — *a form that reveals one error at
 * a time is a form people submit four times.*
 */
export function termProblems(draft) {
  const problems = [];
  if (!draft.name?.trim()) problems.push("Give the term a name.");
  if (!draft.startsOn) problems.push("Say when it starts.");
  if (draft.startsOn && draft.endsOn && new Date(draft.endsOn) <= new Date(draft.startsOn)) {
    problems.push("The end has to be after the start.");
  }
  return problems;
}

function termRange(term, timeZone) {
  const day = (value) => new Date(value).toLocaleDateString(undefined, {
    month: "short", day: "numeric", year: "numeric", timeZone,
  });
  return term.ends_on ? `${day(term.starts_on)} – ${day(term.ends_on)}` : `From ${day(term.starts_on)}`;
}

/**
 * Scoring — presets before sliders.
 *
 * A wall of weights makes a director responsible for calibrating a system they did not want to
 * think about, and almost every studio is one of four. **Running a studio without a leaderboard is
 * a first-class choice, not a degraded one** — it is how this sells to the many educators who think
 * gamified practice is actively harmful — so "No points" is a preset beside the others rather than
 * a switch hidden underneath them.
 *
 * There is no slider here and that is deliberate rather than unfinished: the one thing an
 * instructor will do in complete good faith is crank raw minutes above finishing the work, which
 * turns IPT back into a practice card. `clamp_scoring()` in `0003` refuses it at the database, and
 * a screen that offered the slider would be offering a control the server silently overrules.
 */
export function scoringScreen(store, { presets, onChoose, onBack, busy = false, problem = null }) {
  const rules = store.rules();
  const current = presets.find((p) => sameRules(rules, { ...rules, ...p.rules }));

  return el(
    "main",
    { id: "main", class: "page" },
    el("h1", { text: "Scoring" }),

    presets.length === 0
      ? card({ class: "stack" }, el("h2", { text: "Loading the presets…" }))
      : card(
        { class: "stack" },
        el("h2", { text: "How this studio is scored" }),
        el(
          "div",
          { role: "radiogroup", "aria-label": "How this studio is scored", class: "options" },
          ...presets.map((preset, index) =>
            el(
              "button",
              {
                type: "button",
                role: "radio",
                "aria-checked": current?.name === preset.name ? "true" : "false",
                tabindex: current?.name === preset.name ? "0" : "-1",
                "data-preset": preset.name,
                style: "width:100%",
                disabled: busy || undefined,
                onKeyDown: (event) => {
                  const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
                  if (!step) return;
                  event.preventDefault();
                  onChoose?.(presets[(index + step + presets.length) % presets.length]);
                },
                onClick: () => onChoose?.(preset),
              },
              el("span", { style: "font-weight:600", text: preset.title }),
              el("span", { class: "caption", text: preset.detail }),
            )
          ),
        ),
        !current && notice(
          "This studio's weights aren't one of these. They were tuned somewhere else. Choosing " +
            "one below will replace them.",
          { kind: "quiet" },
        ),
        problem && notice(problem, { kind: "error", role: "alert" }),
      ),

    card(
      { class: "stack" },
      el("h2", { text: "What points never do" }),
      el("p", {
        class: "caption",
        text: "Finishing the assigned work always counts for more than time on the clock. " +
          "One set of rules covers the whole season, so changing this restates the weeks already " +
          "practiced as well as the ones ahead. Nobody's practice is lost or changed, only what " +
          "it is worth.",
      }),
      el("p", {
        class: "caption",
        text: "Ticking a focus point earns no points, on purpose. It is there to help somebody " +
          "keep their place in the work, not to be scored. Points come from minutes practiced, " +
          "and a session somebody added afterwards is marked as such wherever it appears, so you " +
          "can always see what the app timed.",
      }),
    ),
    onBack && el("button", {
      class: "button--quiet", style: "width:100%", type: "button", onClick: onBack,
      text: "Back to You",
    }),
  );
}

/** Whether two rule sets are the same scoring. Compared key by key, over the keys a preset sets. */
function sameRules(a, b) {
  return Object.keys(b).every((key) => a[key] === b[key]);
}

/**
 * The roster — who is in the studio, and what they may do in it.
 *
 * Two destructive-ish actions, and the whole design is in what they say they cost. `DeletionCost`
 * exists on iOS because *"all associated data will be removed" tells somebody nothing*; the same
 * rule applies to a change that removes nobody's data at all, from the other direction — an
 * instructor who does not know that removing somebody keeps their practice will not do it, and one
 * who assumes it deletes everything will not do it either.
 */
export function rosterScreen(store, { onSetRole, onRemove, onBack, busy = false, problem = null }) {
  const me = store.profile()?.id;
  const roster = [...store.roster()].sort((a, b) => a.display_name.localeCompare(b.display_name));
  const instructors = roster.filter((m) => m.role === "instructor").length;

  return el(
    "main",
    { id: "main", class: "page" },
    el("h1", { text: "Roster" }),

    roster.length <= 1
      ? emptyState(
        "Nobody has joined yet",
        "Performers choose “Join a studio” and type this code. It never contains characters that " +
          "sound alike, so it survives being read out across a rehearsal room.",
        store.studio()?.join_code
          ? el("p", {
            class: "numeral",
            style: "font-size:1.6rem; font-weight:700; letter-spacing:0.12em; margin:0.4rem 0 0",
            text: groupedCode(store.studio().join_code),
          })
          : null,
      )
      : card(
        { class: "stack" },
        el("h2", { text: `${count(roster.length, "person", "people")} in this studio` }),
        ...roster.map((member) => rosterRow(member, {
          isMe: member.id === me,
          isLastInstructor: member.role === "instructor" && instructors <= 1,
          isOwner: member.id === store.studio()?.owner_id,
          busy,
          onSetRole,
          onRemove,
        })),
      ),
    problem && notice(problem, { kind: "error", role: "alert" }),
    onBack && el("button", {
      class: "button--quiet", style: "width:100%", type: "button", onClick: onBack,
      text: "Back to You",
    }),
  );
}

/**
 * One person, with what can be done to them folded away.
 *
 * **Drawn as a disclosure rather than two buttons per row**, and that was decided by looking. Six
 * performers meant six red "Remove" buttons stacked down the screen, which reads as *a page for
 * removing people* rather than a roster — and red in this app means one thing, "a hand on it now",
 * which six of at once devalues. The buttons also took enough width at 375px that every name
 * wrapped: "Ana Reyes" over two lines, which is a person's name broken in half on the screen their
 * instructor manages them from.
 *
 * `<details>` is the control the account-deletion card already uses, and it is the accessible
 * default: one focus stop per person, announced as expandable, keyboard-operable and closed by
 * Escape — four things a hand-rolled toggle would each have to be taught, and would be taught
 * slightly wrong.
 *
 * The consequences are **visible text, not `title` tooltips**. A tooltip does not exist on a touch
 * device at all, and this is the one screen where the consequence *is* the decision: nobody reading
 * "Remove" knows the practice history survives it, and nobody reading "Make instructor" knows it
 * hands over every performer's recordings and every note ever written to them.
 */
function rosterRow(member, { isMe, isLastInstructor, isOwner, busy, onSetRole, onRemove }) {
  const isInstructor = member.role === "instructor";

  const identity = el(
    "div",
    { class: "row grow", style: "gap:0.75rem" },
    avatar(member),
    el(
      "div",
      { class: "grow stack", style: "gap:0.1rem" },
      el("span", {
        style: "font-weight:600",
        text: isMe ? `${member.display_name} (you)` : member.display_name,
      }),
      el("span", {
        class: "caption",
        text: isInstructor ? "Instructor" : member.instrument ?? "Performer",
      }),
    ),
  );

  if (isMe || isLastInstructor || isOwner) {
    return el(
      "div",
      { class: "stack", style: "gap:0.25rem" },
      identity,
      isLastInstructor && el("p", {
        class: "caption",
        text: "The only instructor. Someone has to be able to assign work, so this one can't be " +
          "changed or removed.",
      }),
      !isMe && !isLastInstructor && isOwner && el("p", {
        class: "caption",
        text: "This studio's owner. They can't be removed or made a performer. Transferring the " +
          "studio is how it changes hands.",
      }),
    );
  }

  return el(
    "details",
    { class: "stack", style: "gap:0.5rem" },
    el(
      "summary",
      { class: "roster-summary" },
      identity,
      el("span", { class: "caption", "aria-hidden": "true", text: "Manage" }),
    ),
    el(
      "div",
      { class: "stack", style: "gap:0.35rem" },
      el("p", {
        class: "caption",
        text: isInstructor
          ? "As a performer they go back on the leaderboard, and stop being able to assign work or " +
            "hear anybody else's recordings."
          : "An instructor can assign practice, hear everyone's clips and read every note. They " +
            "come off the leaderboard, and the practice they've logged stops counting toward it.",
      }),
      el("button", {
        type: "button",
        class: "button--quiet",
        style: "width:100%",
        disabled: busy || undefined,
        "aria-label": isInstructor
          ? `Make ${member.display_name} a performer`
          : `Make ${member.display_name} an instructor`,
        onClick: () => onSetRole?.(member, isInstructor ? "performer" : "instructor"),
        text: isInstructor ? "Make performer" : "Make instructor",
      }),
      el("p", {
        class: "caption",
        text: "Removing them takes their practice out of the studio's standings and totals, "
          + `including weeks already finished. ${REMOVAL_UNDOABLE}`,
      }),
      el("button", {
        type: "button",
        class: "button--quiet",
        style: "width:100%; color: var(--live)",
        disabled: busy || undefined,
        "aria-label": `Remove ${member.display_name} from the studio`,
        onClick: () => onRemove?.(member),
        text: "Remove from studio",
      }),
    ),
  );
}

/**
 * The board on the band-room screen, for the ten minutes before rehearsal starts.
 *
 * ## Why this exists at all
 *
 * The marching arts are a small, tight world where directors copy each other constantly, and what
 * spreads is what one director **shows** another. This product's most showable moment is a studio
 * leaderboard up on the screen at the front of the room while everybody unpacks. It is the only
 * growth loop IPT has that is not "somebody tweets about it", and it costs almost nothing — the
 * board is `studio_leaderboard`, computed by the server, so there is **no second construction of
 * any rule here.** This is a presentation and nothing else.
 *
 * It lives on the web rather than on iOS on purpose: the thing in a band room is a Chromebook, a
 * laptop on the podium or a smart TV, and none of them can install an app.
 *
 * ## It shows the top of the board and never the bottom
 *
 * The full board ranks everybody, and every performer can already see all of it on their own phone.
 * A screen on a **wall** is a different act. "Jonah Park — 0%" projected in front of the ensemble is
 * not information any more, it is a fourteen-year-old being named to a room, and the app would be
 * the thing that did it. *Being behind is information* holds on somebody's own screen; it does not
 * survive being put on a wall.
 *
 * So this shows a leading group and the studio's own totals, says out loud that it is showing a top
 * ten, and leaves the complete board on Standings where it belongs. Nothing here reports who has not
 * logged, and it never will.
 *
 * @param onExit leaves the display. A screen with no way out is a trap, and the one person who needs
 *   it is a director in front of a room who has to get on with rehearsal.
 */
export function displayScreen(store, { top = 10, onExit, awake = null } = {}) {
  const standings = store.standings();
  const people = Object.fromEntries(store.roster().map((p) => [p.id, p]));

  const earned = standings.filter((s) => (s.practiceSeconds ?? 0) > 0 || s.points > 0);
  const leaders = earned.slice(0, top);

  const totalSeconds = earned.reduce((sum, s) => sum + (s.practiceSeconds ?? 0), 0);
  const finished = earned.filter((s) => s.assignmentsAssigned > 0 && s.assignmentsMet >= s.assignmentsAssigned).length;
  const withWork = earned.filter((s) => s.assignmentsAssigned > 0).length;

  const rows = leaders.map((s) => {
    const person = people[s.performerId];
    return el(
      "li",
      { class: "display-row" },
      el("span", { class: "display-rank numeral", text: `${s.rank}` }),
      el("span", { class: "display-name", text: person?.display_name ?? "—" }),
      s.currentStreak >= 2
        ? el("span", { class: "display-streak", text: `${s.currentStreak}-week streak` })
        : el("span", { class: "display-streak" }),
      el("span", { class: "display-points numeral", text: `${s.points}` }),
    );
  });

  return el(
    "main",
    { id: "main", class: "display dark-locked" },
    el(
      "header",
      { class: "display-head" },
      el("h1", { class: "display-title", text: store.studio()?.name ?? "Studio" }),
      el("p", { class: "display-when", text: "The season so far" }),
    ),
    leaders.length === 0
      ? el("p", { class: "display-empty", text: "No practice logged yet." })
      : el("ol", { class: "display-board" }, ...rows),
    el(
      "footer",
      { class: "display-foot" },
      el("p", {
        class: "display-total",
        text: `${longDuration(totalSeconds)} practiced this season`
          + (withWork > 0 ? ` · ${finished} of ${withWork} have finished everything assigned` : ""),
      }),
      earned.length > leaders.length
        ? el("p", { class: "display-note", text: `Top ${leaders.length} of ${earned.length}. The full board is on Standings.` })
        : null,
      awake === false
        ? el("p", { class: "display-note", text: "This browser won't keep the screen awake. Check your display settings." })
        : null,
      el("button", { class: "display-exit", text: "Leave display", onClick: () => onExit?.() }),
    ),
  );
}

/**
 * The season, as something that can leave the app.
 *
 * *A record that cannot leave the app is not a record — it is a screen.* An instructor has to justify
 * this to a booster club, a principal or a parent at a concert; a performer's season otherwise simply
 * stops. `StudioReport` writes both, and `web/app/report.js` is the transcription a parity gate holds
 * to Swift's exact text.
 *
 * ## Why the text is on the page rather than behind a button
 *
 * The obvious build is a "Share" button over `navigator.share`, and on a Chromebook that is a button
 * that does nothing: the API is absent or refuses outside a narrow set of gestures. **The artefact
 * itself is the feature**, so it is rendered — selectable, printable, and readable before anybody
 * decides to send it. Copy and share are conveniences layered on top, and each says what happened.
 *
 * ## And it refuses to print half a report
 *
 * `weeksMet`, `weeksWithWork` and `bestStreak` come only from a project carrying `0009`. Without
 * them there is no honest report to write — "0 of 0 weeks finished in full" is a sentence somebody
 * would forward to a principal — so the screen says which nothing it is, exactly as the standings
 * screen does for a project without `0004`. *Absent is not empty.*
 */
export function seasonScreen(store, { onCopy, onShare, canShare = false, said = null } = {}) {
  const me = store.profile();
  const studio = store.studio();
  const standings = store.standings();
  const roster = store.roster().filter((p) => p.role === "performer");
  const zone = studio?.time_zone;

  const spans = new Map();
  for (const row of standings) {
    const span = spanFrom(row);
    if (span) spans.set(row.performerId, span);
  }

  const window = seasonWindow(termsFrom(store.terms()), {
    studioCreatedAt: studio.created_at,
    now: new Date(),
  });
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", year: "numeric", timeZone: zone,
  });
  const dates = `${fmt.format(window.from)} – ${fmt.format(window.to)}`;
  const range = window.term ? `${window.term.name} · ${dates}` : dates;

  if (spans.size === 0) {
    return el(
      "main",
      { id: "main", class: "page" },
      el("h1", { text: "The season" }),
      card(
        { class: "stack", style: "text-align:center" },
        el("h2", { text: "Not available from this studio yet" }),
        el("p", {
          class: "caption",
          text: standings.length === 0
            ? "There is no practice logged in this studio yet, so there is nothing to write up."
            : "This studio's server hasn't been updated with the numbers a season summary needs: "
              + "how many weeks each performer finished, and their best run. Nothing is missing from "
              + "anybody's record; it just cannot be summarized from here yet.",
        }),
      ),
    );
  }

  const text = store.isInstructor
    ? instructorSummary({
      studioName: studio.name,
      range,
      performers: roster,
      summaries: Object.fromEntries(spans),
      uncovered: uncoveredInstructions({
        assignments: store.assignments(),
        weeks: store.weeks(),
        marks: store.focusMarks(),
        performers: roster,
        memberSince: memberSinceDates({
          joined: Object.fromEntries(store.roster().map((m) => [m.id, m.joined_at ?? null])),
          facts: store.facts(),
        }),
      }),
    })
    : performerSummary({
      name: me.display_name,
      studioName: studio.name,
      range,
      summary: spans.get(me.id) ?? { weeksWithWork: 0 },
    });

  return el(
    "main",
    { id: "main", class: "page" },
    el("h1", { text: "The season" }),
    el("p", {
      class: "caption",
      text: store.isInstructor
        ? "Everything below is plain text. Send it, paste it into an email, or print this page."
        : "Yours to keep. Send it, paste it anywhere, or print this page.",
    }),
    el("textarea", {
      class: "season-text",
      id: "season-text",
      readonly: true,
      rows: String(Math.min(28, text.split("\n").length + 1)),
      "aria-label": "The season summary, as text",
      text,
    }),
    el(
      "div",
      { class: "row", style: "gap:0.5rem; flex-wrap:wrap" },
      el("button", { class: "button--primary", text: "Copy it", onClick: () => onCopy?.(text) }),
      canShare && el("button", { text: "Send it", onClick: () => onShare?.(text) }),
    ),
    said && el("p", { class: "caption", role: "status", text: said }),
  );
}

/**
 * The manual — `Welcome`'s three cards and `Help`'s questions, in Swift's words.
 *
 * **The web had two hand-written paragraphs.** Sixty words where the iPhone has three cards and
 * five answers, and they were a second construction of sentences Core already owns — invisible to
 * `check_labels.py`, because the two never shared an opening for it to compare.
 *
 * The rule this exists for is `Welcome`'s own:
 *
 * > **Shown once, and findable forever.** Anything a person sees once and cannot get back is
 * > useless to exactly the person who needed it.
 *
 * The web has no tour at all, so this is the *only* place it is said — which makes the gap worse
 * than iOS's would have been, not milder.
 *
 * It explains **rules, not controls**: the rules are what somebody cannot work out by looking, and
 * they are the ones that make a number feel arbitrary when it is not.
 *
 * @param help the exported block. Null until it has loaded — the screen draws the cards it has and
 *   never a heading over nothing, the same way the reminders dial waits for its words.
 */
/**
 * The three cards the app gets to say for itself, once.
 *
 * **iOS presented this to every new instructor and every new performer, and the web only ever
 * showed it to somebody who went looking in Help.** The client a school is most likely to hand a
 * student was the one that never explained itself: a director who buys on a Chromebook, makes a
 * studio and lands on a setup checklist gets the *what to do* and none of the *why it works this
 * way* — which is the whole of the argument the landing page makes to get them there.
 *
 * The same objections the iOS version was built against apply here and are answered the same way:
 *
 *   · **Skippable from the first frame**, in the corner, in plain words. A tour you have to escape
 *     is worse than no tour.
 *   · **Three cards and a dot for each**, so the whole thing is a known quantity before it starts
 *     and nobody is deciding whether to bail out of an unknown number of screens.
 *   · **Nothing here names a control or a screen**, so moving a button never turns it into a lie.
 *   · **It is not the only copy of itself** — every word is also under Help, which serves the
 *     person who skipped it and the person who has forgotten.
 *
 * Every sentence comes from the export, including the word on the closing button, because two
 * clients typing the same idea separately is the drift `check_labels.py` exists to catch.
 */
export function welcomeScreen(store, { help = null, page = 0, onPage, onFinish } = {}) {
  const isInstructor = store?.isInstructor ?? false;
  const pages = (isInstructor ? help?.instructor : help?.performer) ?? [];
  const finish = (isInstructor ? help?.instructorFinish : help?.performerFinish) ?? "Get started";

  if (pages.length === 0) return el("main", { id: "main", class: "page" });

  const index = Math.min(Math.max(page, 0), pages.length - 1);
  const item = pages[index];
  const isLast = index >= pages.length - 1;

  return el(
    "main",
    {
      id: "main",
      class: "page welcome",
      "data-room": isInstructor ? "upright" : "snare",
    },
    el(
      "div",
      { class: "row-between" },
      el("span", {}),
      el("button", {
        class: "button--quiet", type: "button", text: "Skip",
        onClick: () => onFinish?.(),
      }),
    ),
    card(
      { class: "stack welcome-card" },
      el("h1", { text: item.title }),
      el("p", { class: "welcome-body", text: item.body }),
    ),
    el(
      "div",
      {
        class: "welcome-dots",
        role: "img",
        "aria-label": `Page ${index + 1} of ${pages.length}`,
      },
      ...pages.map((_, n) =>
        el("span", { class: n === index ? "welcome-dot welcome-dot--on" : "welcome-dot" })
      ),
    ),
    el("button", {
      class: "button button--primary", style: "width:100%", type: "button",
      text: isLast ? finish : "Next",
      onClick: () => (isLast ? onFinish?.() : onPage?.(index + 1)),
    }),
  );
}

export function helpScreen(store, { help = null, onBack } = {}) {
  const isInstructor = store?.isInstructor ?? false;
  const keepsScore = store?.rules?.().keepsScore ?? true;

  const pages = (isInstructor ? help?.instructor : help?.performer) ?? [];
  const questions = (isInstructor
    ? (keepsScore ? help?.instructorQuestions : help?.instructorQuestionsNoPoints)
    : (keepsScore ? help?.performerQuestions : help?.performerQuestionsNoPoints)) ?? [];

  return el(
    "main",
    { id: "main", class: "page" },
    el("h1", { text: "How IPT works" }),
    pages.length > 0 && heading("The idea"),
    pages.length > 0 && el(
      "div",
      { class: "stack" },
      pages.map((page) =>
        card(
          { class: "stack", style: "gap:0.3rem" },
          el("h3", { text: page.title }),
          el("p", { class: "caption", text: page.body }),
        )
      ),
    ),
    questions.length > 0 && heading("Questions people ask"),
    questions.length > 0 && el(
      "div",
      { class: "stack" },
      questions.map((item) =>
        card(
          { class: "stack", style: "gap:0.3rem" },
          el("h3", { text: item.question }),
          el("p", { class: "caption", text: item.answer }),
        )
      ),
    ),
    pages.length === 0 && questions.length === 0 && card(
      { class: "stack", style: "text-align:center" },
      el("h2", { text: "Just a moment" }),
      el("p", { class: "caption", text: "Fetching the words this screen is made of." }),
    ),
    onBack && el("button", { type: "button", style: "width:100%", onClick: onBack, text: "Back to You" }),
  );
}
