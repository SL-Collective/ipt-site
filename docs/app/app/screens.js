
import { el, replace } from "./dom.js";
import { assignmentBylines, heardFrom } from "./bylines.js";
import { completionWorthPhrase, helpAudience, scoringSummary, studioExitDetail, termsSummary } from "./settings-summary.js";
import { isAndroidApp } from "./android.js";
import { SETTINGS_DETAIL, SETTINGS_LABEL } from "./email-change.js";
import {
  detail as welcomeDetail,
  firstName as welcomeFirstName,
  greeting as welcomeGreeting,
  recordDetail as welcomeRecordDetail,
  recordHeading as welcomeRecordHeading,
} from "./studio-welcome.js";
import {
  weekTitle,
  workHeading,
  assignmentProgress,
  audienceIncludes,
  MAX_FOCUS_POINTS,
  isActiveDuring,
  progressFraction,
  standingStreak,
  weekMet,
} from "./judgement.js";
import { amountPhrase, clock, clockValue, compactDuration, completionPhrase, count, groupedCode, longDuration, markerPhrase, noun, playbackStart, progressPercent, receiptSentence, startPhrase, targetPhrase, timeFromClock, weekPhrase, whenPhrase } from "./format.js";
import { instructorPhrase, refusal, refusalSentence } from "./selfreport.js";
import {
  gapPhrase, POINTS_FOOTNOTE, POINTS_HEADING, pointsPhrase, scoringRuleLines, standingFacts,
  STREAK_THRESHOLD, studioPulse, tiedAtTopPhrase,
} from "./standings.js";
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
  groupBySection as groupBySectionFn,
} from "./coverage.js";
import { AGE_QUESTION, AGE_REASON, isoDay, PARENT_DIRECT_NOTICE, PARENT_WORDS } from "./age-gate.js";
import { countIn, lossPhrase, marking, removingMark } from "./recording-prefs.js";
import { pastTerms, seasonWindow, termsFrom } from "./terms.js";
import { isSetUp, nextStep, setupSteps, setupTitle } from "./setup.js";

import { avatar, card, emptyState, field, heading, meter, notice, performerRow, pill, ring, rowMenu, stat, weekStrip } from "./ui.js";
import { currentWeek, performerWeekRows, studioWeekRows, weekProgress, weekTrend } from "./trend.js";
import { reachedMilestones } from "./milestones.js";
import { spanRows } from "./spans.js";
import { checkoutURLFor } from "./words.js";
import { deletionCost, finishedPhrase, heardPhrase, listeningOrder, nextUnheard, oldestWaitingDays, PATIENCE_DAYS, positionPhrase, REMOVAL_UNDOABLE, savingPhrase, waitingPhrase } from "./listening.js";


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
        style: "align-items: center; justify-content: center; gap: 0.6rem; flex: 1 1 0; min-width: 0; flex-wrap: wrap",
      },
      el("p", { class: "caption", style: "margin: 0; flex: 0 1 auto; min-width: 0" }, labelParts()),
      onPickSpan ? picker : null,
    ),
    chevron(1, "›", span.kind === "month" ? "Next month" : "Next week", canForward),
  );
}

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
  draft = null,
  now = new Date(),
} = {}) {
  const isNew = mode === "signUp";

  const name = el("input", { type: "text", autocomplete: "name", required: true, id: "auth-name" });
  name.value = draft?.displayName ?? "";
  const email = el("input", { type: "email", autocomplete: "email", required: true, id: "auth-email" });
  const shared = el("input", { type: "checkbox", class: "check", id: "auth-shared" });
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

  const born = el("input", {
    type: "date",
    id: "auth-born",
    required: true,
    autocomplete: "bday",
    max: isoDay(now),
  });
  born.value = draft?.bornOn ?? "";

  const form = el(
    "form",
    {
      class: "stack",
      onSubmit: (event) => {
        event.preventDefault();
        if (busy) return;
        const credentials = { email: email.value.trim(), password: password.value };
        if (isNew) {
          onSignUp?.({
            ...credentials,
            displayName: name.value.trim(),
            role: role.value,
            bornOn: born.value,
          });
        } else onSignIn?.({ ...credentials, sharedDevice: shared.checked });
      },
    },
    el("h2", { text: isNew ? "Create an account" : "Sign in" }),
    problem && notice(problem, { kind: "error" }),
    message && notice(message),
    isNew && field("Your name", name, "What your studio sees. Your instructor is looking for it on a roster."),
    field("Email", email),
    field("Password", password, isNew ? "At least 8 characters." : undefined),
    !isNew && el("div", { class: "check-list" }, field(
      "This is a shared computer",
      shared,
      "Signs you out when you close this tab, instead of staying signed in.",
    )),
    isNew && field("You are", role),
    isNew && field(AGE_QUESTION, born, AGE_REASON),
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
      el("p", { class: "caption tagline", text: "Individual Practice Time" }),
    ),
    card({ class: "stack" }, form),
    el("p", {
      class: "caption",
      style: "text-align:center; padding-top: 4px",
      text: "Creating an account accepts the Terms of use.",
    }),
    el(
      "div",
      { class: "row", style: "gap: 0; justify-content: center" },
      el("a", {
        href: "https://iptmusic.com/privacy",
        target: "_blank",
        rel: "noopener",
        class: "caption policy-link",
        style: "min-height:44px; padding:0 0.9rem; display:flex; align-items:center",
        text: "Privacy policy",
      }),
      el("span", {
        class: "caption",
        "aria-hidden": "true",
        style: "color: var(--muted); align-self: center",
        text: "·",
      }),
      el("a", {
        href: "https://iptmusic.com/terms",
        target: "_blank",
        rel: "noopener",
        class: "caption policy-link",
        style: "min-height:44px; padding:0 0.9rem; display:flex; align-items:center",
        text: "Terms of use",
      }),
    ),
    card(
      { class: "card--tinted stack" },
      el("h2", { class: "micro", style: "color: var(--accent)", text: "See it working" }),
      el("p", {
        class: "caption",
        text:
          "A real studio with three weeks of practice in it: a roster, assigned work, standings, " +
          "and recordings you can play. No account, nothing to set up.",
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

export function resetPasswordScreen({ onSave, busy = false, problem = null } = {}) {
  const password = el("input", {
    type: "password", id: "new-password", autocomplete: "new-password",
    required: true, minlength: "8",
  });
  return el(
    "main",
    { id: "main", class: "page", "data-room": "door" },
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

export function parentRouteScreen({ onContinueAsParent, onBack } = {}) {
  return el(
    "main",
    { id: "main", class: "page", "data-room": "percussion" },
    el("h1", { text: PARENT_WORDS.heading }),
    el("p", { class: "caption", text: PARENT_WORDS.explanation }),
    card(
      { class: "stack" },
      el("h2", { text: PARENT_WORDS.noticeHeading }),
      el("p", { class: "caption", text: PARENT_DIRECT_NOTICE }),
    ),
    onContinueAsParent && el("button", {
      class: "button--primary", style: "width:100%", type: "button",
      onClick: onContinueAsParent,
      text: "I'm the parent or guardian, continue",
    }),
    el("p", { class: "caption", text: PARENT_WORDS.school }),
    onBack && el("button", {
      class: "button--quiet", style: "width:100%", type: "button",
      onClick: onBack, text: "Back to sign in",
    }),
  );
}

export function confirmScreen({ email, onBack, onResend, busy = false, message = null }) {
  return el(
    "main",
    { id: "main", class: "page", "data-room": "window", style: "place-content:center; min-height:70vh" },
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

export function studioSetupScreen({ profile, onCreate, onJoin, onSignOut, onCancel = null, problem = null, busy = false, weekStarts = [], weekStartsFailed = false, onRetryWeekStarts = null, hasPracticed = null, onExport = null, exporting = false, exportProblem = null, onSaveEmail = null, onDeleteAccount = null }) {
  const studioName = el("input", { type: "text", required: true, id: "studio-name" });
  const weekStart = { value: String(weekStarts.find((d) => d.isStandard)?.value ?? 2) };
  const wordsReady = weekStarts.length > 0;
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
    el("h1", {
      text: welcomeGreeting(welcomeFirstName(profile.display_name), hasPracticed ?? true),
      id: "studioless-greeting",
    }),
    el("p", {
      class: "caption on-room",
      text: welcomeDetail(profile.role === "instructor", hasPracticed ?? false),
      id: "studioless-detail",
    }),
    problem && notice(problem, { kind: "error" }),
    hasPracticed === true && onExport && card(
      { class: "stack" },
      el("h2", { text: welcomeRecordHeading }),
      el("p", { class: "caption", text: welcomeRecordDetail }),
      exportProblem && el("p", { class: "caption", role: "alert", text: exportProblem }),
      el("button", {
        type: "button", style: "width:100%", onClick: onExport, id: "studioless-export",
        text: exporting ? "Putting it together…" : "Export",
        disabled: exporting || undefined,
      }),
    ),
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
          onSubmit: (e) => {
            e.preventDefault();
            if (!busy) onCreate?.(studioName.value.trim(), Number(weekStart.value));
          },
        },
        el("h2", { text: "Start a studio" }),
        el("p", {
          class: "caption",
          text: "A roster, the work you assign, and a code you hand out once. Everything else hangs off it.",
        }),
        field("Studio name", studioName, "What your performers will see: “Wind Ensemble”, “Studio of J. Reyes”."),
        weekStarts.length > 0 && el(
          "div",
          { class: "stack", style: "gap:0.35rem" },
          el("label", { class: "caption", for: "week-start", text: "Practice week starts" }),
          el(
            "select",
            {
              id: "week-start",
              onChange: (event) => { weekStart.value = event.currentTarget.value; },
            },
            ...weekStarts.map((d) =>
              el("option", { value: String(d.value), selected: d.isStandard || undefined, text: d.label })
            ),
          ),
          el("p", {
            class: "caption",
            text: "Everyone's week, and the leaderboard, turns over on this day. "
              + "It cannot be changed later, because it decides which week every past session counts in.",
          }),
        ),
        !wordsReady && !weekStartsFailed && el("p", {
          class: "caption",
          text: "Getting the week-start options. A studio's week cannot be changed once it is made, "
            + "so this waits rather than choosing one for you.",
        }),
        !wordsReady && weekStartsFailed && el(
          "div",
          { class: "stack", style: "gap:0.35rem" },
          el("p", {
            class: "caption",
            text: "Couldn't load the week-start options. A studio's week can't be changed once "
              + "it's made, so IPT won't pick one for you.",
          }),
          onRetryWeekStarts && el("button", {
            type: "button",
            style: "width:100%",
            onClick: onRetryWeekStarts,
            text: "Try again",
          }),
        ),
        el("button", {
          style: "width:100%",
          type: "submit",
          disabled: busy || !wordsReady,
          text: "Create studio",
        }),
      ),
    ),
    onSaveEmail && emailCard(profile, onSaveEmail),
    onDeleteAccount && deleteAccountCard(
      "Everything IPT holds about you, permanently. The confirmation says exactly how much before anything happens.",
      onDeleteAccount,
    ),
    (onSaveEmail || onDeleteAccount) && policyLinks(),
    onCancel
      ? el("button", { class: "button--quiet", style: "width:100%", type: "button", onClick: onCancel, text: "Back to my studio" })
      : el("button", { class: "button--quiet", style: "width:100%", type: "button", onClick: onSignOut, text: "Sign out" }),
  );
}


export function studioScreen(store, {
  onPrompt, onListen, onOpenPerformer, quiet = null, onDeclareBreak, onDismissBreak,
  season = null, onSetUpSeason, onDismissSeason,
  span = null, onStepSpan = null, onPickSpan = null, onApplyCustom = null,
  onAssign = null,
  rosterSearch = "", onRosterSearch = null,
  groupBySection = false, onGroupBySection = null,
  now = new Date(),
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

  const query = rosterSearch.trim().toLowerCase();
  const shown = query
    ? ordered.filter((w) =>
      (w.person.display_name ?? "").toLowerCase().includes(query) ||
      (w.person.instrument ?? "").toLowerCase().includes(query)
    )
    : ordered;

  const searchable = !!onRosterSearch && performers.length > 0;

  const assignmentCount = store.assignments().length;
  const setupDone = isSetUp(assignmentCount, performers.length);
  const hasPerformers = performers.length > 0;
  const joinCode = store.studio().join_code;

  const rowFor = (w, { showsInstrument = true } = {}) =>
    performerRow(w.person, w, {
      streak: byPerformer[w.person.id]?.currentStreak ?? 0,
      onOpen: onOpenPerformer,
      showsInstrument,
      periodLabel: single ? "this week"
        : viewed.kind === "month" ? "this month"
        : viewed.kind === "season" ? "this season" : "this stretch",
      metNoun: single ? "met this week" : "weeks finished in full",
    });
  const sectionScore = (members) => {
    const withWork = members.filter((r) => r.hasWork);
    if (withWork.length === 0) return "—";
    return `${withWork.filter((r) => r.isMet).length} of ${withWork.length}`;
  };
  const sectioned = () => {
    const rowById = new Map(shown.map((w) => [w.person.id, w]));
    return groupBySectionFn(shown.map((w) => w.person)).map((section) => {
      const members = section.members.map((m) => rowById.get(m.id)).filter(Boolean);
      return el(
        "div",
        { class: "stack", style: "gap:0.6rem" },
        heading(section.name, sectionScore(members), { level: 3 }),
        el("div", { class: "stack roster-list" }, members.map((w) => rowFor(w, { showsInstrument: false }))),
      );
    });
  };
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
              { class: "row", style: "gap:0.5rem; align-items:baseline; flex-wrap:wrap" },
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
      el("h2", { text: quiet.title }),
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
    season && card(
      { class: "card--tinted stack" },
      el("h2", { text: "Start a new season?" }),
      el("p", { class: "caption", text: season.message }),
      el(
        "div",
        { class: "row", style: "gap:0.5rem; flex-wrap:wrap" },
        el("button", {
          class: "button--primary", type: "button",
          text: "Set up a season", onClick: () => onSetUpSeason?.(season),
        }),
        el("button", { type: "button", text: "No, leave it", onClick: () => onDismissSeason?.(season) }),
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
      (recordsAudio(store) || unheard > 0) &&
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
    unheard > 0 && waitingPhrase(store.logs(), now) &&
      el("p", {
        class: "caption",
        style: (oldestWaitingDays(store.logs(), now) ?? 0) >= PATIENCE_DAYS ? "color: var(--accent)" : "",
      },
      el("span", { "aria-hidden": "true", text: "◷ " }),
      waitingPhrase(store.logs(), now)),
    hasPerformers && heading(
      "The roster",
      store.isInstructor
        ? el(
          "div",
          { class: "row", style: "align-items: center; gap: 0.75rem" },
          el("span", { class: "caption numeral", text: count(performers.length, "performer") }),
          el("a", {
            class: "caption no-shrink",
            href: "#/roster",
            style: "min-height: 44px; display: inline-flex; align-items: center",
            text: "Manage",
          }),
        )
        : count(performers.length, "performer"),
    ),
    hasPerformers && onGroupBySection && el(
      "label",
      { class: "row", style: "align-items:center; gap:0.6rem; min-height:44px", for: "roster-by-section" },
      el("input", {
        type: "checkbox", class: "check", id: "roster-by-section",
        checked: groupBySection ? "checked" : null,
        onChange: (event) => onGroupBySection(event.currentTarget.checked),
      }),
      el("span", { text: "Group by section" }),
    ),
    hasPerformers && searchable && el(
      "div",
      { class: "stack", style: "gap:0.35rem" },
      el("label", { class: "caption", for: "roster-search", text: "Find a performer" }),
      el("input", {
        id: "roster-search",
        type: "search",
        value: rosterSearch,
        autocomplete: "off",
        onInput: (event) => onRosterSearch(event.currentTarget.value),
      }),
    ),
    hasPerformers && searchable && query && shown.length === 0 && emptyState(
      "Nobody matches that.",
      `No performer in this studio has “${rosterSearch.trim()}” in their name or their instrument.`,
    ),
    hasPerformers && shown.length > 0 && groupBySection && el(
      "div", { class: "stack", style: "gap:1.1rem" }, sectioned(),
    ),
    hasPerformers && shown.length > 0 && !groupBySection && el(
      "div",
      { class: "stack roster-list" },
      shown.map((w) => rowFor(w)),
    ),
  );
}

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

  const bylines = assignmentBylines(assignments, store.roster(), store.profile()?.id);

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
          ? audience.length
            ? pill(`${metCount} of ${audience.length} took it on`, undefined, { wraps: true })
            : pill("Optional")
          : audience.length
          ? pill(`${metCount} of ${audience.length} met it this week`,
                 metCount === audience.length ? "met" : undefined, { wraps: true })
          : pill(performers.length ? "No one assigned" : "No performers yet", undefined, { wraps: true }),
      ),
      assignment.section && el("p", { class: "caption", text: assignment.section }),
      bylines.line(assignment) && el("p", { class: "caption", text: bylines.line(assignment) }),
      el("p", { class: "caption", text: targetPhrase(assignment.target) }),
      !assignment.whole_studio && (audience.length
        ? el("p", { class: "caption", text: `For ${audience.map((p) => p.display_name).join(", ")}` })
        : el("p", { class: "caption", text: "The performers this was for have left the studio. Edit it to choose who it is for now." })),
      planCoverage(
        assignment,
        focusCoverage({
          points: assignment.focus_points,
          marks: marks.get(assignment.id) ?? [],
          audience: assignmentAudience({
            assignment,
            performers,
            weeks: [week],
            memberSince: memberSince,
          }).map((p) => p.id),
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
      "The work you have assigned, and the notes performers read while they practice.",
    ),
    (onNew || onPrompt) && el("button", {
      type: "button",
      class: "button--primary",
      style: "width:100%",
      onClick: () => (onNew ? onNew() : onPrompt("assignWork")),
      text: "New assignment",
    }),
    heading("Open work", count(assignments.length, "assignment")),
    el("div", { class: "stack" }, rows),
  );
}

function firstNameOf(performer) {
  return String(performer?.display_name ?? "").split(" ")[0] || "They";
}

export function performerScreen(store, {
  performer, onNudge, onBack, suggestions = [], busy = false, problem = null,
  span = null, onStepSpan = null, onPickSpan = null, onApplyCustom = null,
  selfReportMark = "",
  now = new Date(),
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
  const detailBylines = assignmentBylines(store.assignments(), store.roster(), store.profile()?.id);
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
        stat(String(standing?.currentStreak ?? 0), "week streak"),
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
      single
        ? workHeading(week, now, store.studio().week_starts_on ?? 2, store.studio().time_zone)
        : "Assignments",
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
            detailBylines.line(assignmentOf(id)) &&
              el("p", { class: "caption", text: detailBylines.line(assignmentOf(id)) }),
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

export function assignmentEditorScreen(store, {
  assignment = null, onSave, onCancel, onDelete, busy = false, problem = null,
  guidanceNote: guidanceText = null,
  now = new Date(),
}) {
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
  const PRESETS = { minutes: [60, 90, 120, 150], sessions: [3, 4, 5, 6] };
  const presetRow = el("div", { class: "row", style: "gap:0.4rem; flex-wrap:wrap", "aria-label": "Quick amounts" });
  const drawPresets = () => {
    presetRow.replaceChildren(...(PRESETS[kind.value] ?? []).map((n) => el("button", {
      type: "button", class: "button--quiet",
      style: "min-height:44px; padding:0 0.4rem; flex:1 1 0; max-width:5rem; text-align:center",
      text: String(n),
      onClick: () => { amount.value = String(n); amount.dispatchEvent(new Event("input", { bubbles: true })); },
    })));
  };
  drawPresets();
  kind.addEventListener("change", drawPresets);

  const guidanceNote = el("p", { class: "caption", text: guidanceText ?? "" });
  const settleGuidance = () => {
    guidanceNote.hidden = !guidanceText || kind.value !== "minutes";
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

  const addPoint = (text = "", tempo = null, id = null) => {
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
      {
        class: "row plan-row",
        style: "gap:0.5rem; align-items:end",
        ...(id ? { "data-point-id": id } : {}),
      },
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
  for (const point of assignment?.focus_points ?? []) {
    addPoint(point.text, point.tempo ?? null, point.id ?? null);
  }
  renumber();

  const wholeStudio = el("input", { type: "checkbox", id: "a-whole", class: "check" });
  wholeStudio.checked = assignment ? assignment.whole_studio : true;
  const chosen = new Set(assignment?.audience ?? []);
  let draftChanged = () => {};

  const audience = el("div", { class: "stack", hidden: wholeStudio.checked });

  const settleSection = (section, countEl, actionEl) => {
    const ids = section.members.map((m) => m.id);
    const picked = ids.filter((id) => chosen.has(id)).length;
    const whole = picked === ids.length && ids.length > 0;
    countEl.textContent = `${picked} of ${ids.length}`;
    actionEl.textContent = whole ? "Clear" : "All";
    return whole;
  };

  for (const section of groupBySectionFn(performers)) {
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
          draftChanged();
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
        draftChanged();
        settleSection(section, count, action);
        header.setAttribute("aria-label", label());
      });
      boxes.set(person.id, box);
      audience.append(el("div", { class: "check-list" }, field(person.display_name, box)));
    }
    settleSection(section, count, action);
    header.setAttribute("aria-label", label());
  }
  const laterJoiners = el("p", {
    class: "caption",
    text: "Includes performers who join later.",
    hidden: !wholeStudio.checked,
  });
  wholeStudio.addEventListener("change", () => {
    audience.hidden = wholeStudio.checked;
    laterJoiners.hidden = !wholeStudio.checked;
  });

  const problems = el("div", { class: "stack" });

  const previewTitle = el("p", { style: "margin:0; font-weight:600; font-size:1.05rem" });
  const previewSection = el("p", { class: "caption", style: "margin:0" });
  const previewTarget = el("p", { class: "caption", style: "margin:0" });
  const previewWorth = el("p", { class: "caption", style: "margin:0; color: var(--accent)" });
  const preview = card(
    { class: "card--tinted stack", style: "gap:0.35rem" },
    el("h2", { class: "micro", style: "color: var(--accent)", text: "They'll see" }),
    previewTitle, previewSection, previewTarget, previewWorth,
  );
  const sayPreview = () => {
    const words = title.value.trim();
    previewTitle.textContent = words || "Your piece";
    const where = section.value.trim();
    previewSection.hidden = !where;
    previewSection.textContent = where;
    const audienceWords = wholeStudio.checked
      ? "whole studio"
      : count(chosen.size, "performer");
    previewTarget.textContent =
      `${targetPhrase({ kind: kind.value, amount: Number(amount.value) || 0 })} · ${audienceWords}`;
    const worth = completionWorthPhrase(store.rules(), store.rules().keepsScore !== false);
    previewWorth.hidden = !worth;
    if (worth) previewWorth.textContent = worth;
  };
  for (const control of [title, section, kind, amount, wholeStudio]) {
    control.addEventListener("input", sayPreview);
    control.addEventListener("change", sayPreview);
  }
  draftChanged = sayPreview;
  sayPreview();

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
                id: row.dataset.pointId || undefined,
                text: row.querySelector('input[type="text"]').value.trim(),
                tempo: cleanTempo(row.querySelector('input[type="number"]').value),
                position,
              }))
              .filter((p) => p.text),
            wholeStudio: wholeStudio.checked,
            audience: wholeStudio.checked ? [] : [...chosen],
            opensAt: assignment?.opens_at ?? now,
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
        field("Measures or section", section, "Optional. “mm. 41–68”, “the shed at letter C”."),
      ),
      card(
        { class: "stack" },
        el("h2", { text: "The weekly target" }),
        field("Counted in", kind),
        field("Amount", amount),
      presetRow,
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
        laterJoiners,
        audience,
      ),
      preview,
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
  if ((draft.focusPoints ?? []).length > MAX_FOCUS_POINTS) {
    found.push(`Keep it to ${MAX_FOCUS_POINTS} things to work on. A longer list gets skimmed.`);
  }
  if (draft.takeMinutes != null &&
      (draft.takeMinutes < 1 || draft.takeMinutes > MAX_TAKE_MINUTES)) {
    found.push(`A recording can be at most ${MAX_TAKE_MINUTES} minutes.`);
  }
  return found;
}

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
      { class: "row-between", style: "flex-wrap:wrap" },
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

function registerRateButton(into, button) {
  into.push(button);
  return button;
}

export function listeningScreen(store, {
  onAcknowledge, onUnacknowledge = null, onBack, clipURL,
  now = new Date(),
  rate = 1, rates = [], onRateChange = null,
} = {}) {
  const queue = listeningOrder(store.logs());
  const people = Object.fromEntries(store.roster().map((p) => [p.id, p]));

  const players = [];
  const applyRate = (next) => { for (const audio of players) audio.playbackRate = next; };
  const onRate = (audio) => {
    players.push(audio);
    audio.addEventListener("play", () => {
      for (const other of players) if (other !== audio && !other.paused) other.pause();
    });
  };
  const assignments = Object.fromEntries(store.assignments().map((a) => [a.id, a]));
  const heard = store.logs().filter((l) => l.hasClip && l.wasHeard).length;
  const waiting = waitingPhrase(store.logs(), now);
  const secondsLeftToHear = queue.reduce((total, log) => total + (log.clip?.seconds ?? 0), 0);

  const cards = [];

  const advanceFrom = (index) => {
    const at = nextUnheard(cards.map((c) => !c || c.done), index);
    const next = at >= 0 ? cards[at] : null;
    if (next) {
      next.heading?.focus?.({ preventScroll: true });
      next.element.scrollIntoView?.({ block: "start" });
      return;
    }
    if (finish && finish.hidden) {
      finish.hidden = false;
      finish.querySelector("h2").textContent = finishedPhrase(heard + cards.filter((c) => c.done).length);
      finish.querySelector("h2").focus?.({ preventScroll: true });
      finish.scrollIntoView?.({ block: "center" });
    }
  };

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
          onRate(audio);
          const firstMark = (log.clip.markers ?? [])[0];
          if (firstMark != null) audio.currentTime = playbackStart(firstMark);
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
              onClick: () => { audio.currentTime = playbackStart(at); audio.play().catch(() => {}); },
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
        text: startPhrase(marked.length),
      }));
    }

    const heading = el("h2", { tabindex: "-1", text: person?.display_name ?? "Someone" });

    const node = card(
      { class: "stack" },
      el(
        "div",
        { class: "row", style: "gap:0.85rem" },
        avatar(person ?? { id: log.performerId, display_name: "?" }),
        el(
          "div",
          { class: "grow stack", style: "gap:0.15rem" },
          heading,
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
      (() => {
        const submit = el("button", { type: "submit", style: "width:100%", text: "Heard it" });
        const noteField = field("Say something back", note,
                                "Optional. One line, and they'll see it.");
        const done = el("p", { class: "caption", hidden: true });
        const undo = el("button", {
          type: "button", class: "button--quiet", hidden: true, text: "Undo",
          onClick: async () => {
            undo.hidden = true;
            try {
              await onUnacknowledge?.(log);
              done.hidden = true;
              noteField.hidden = false;
              submit.hidden = false;
              submit.disabled = false;
              submit.textContent = "Heard it";
              if (cards[index]) cards[index].done = false;
            } catch {
              undo.hidden = false;
            }
          },
        });
        const form = el(
          "form",
          {
            class: "stack",
            onSubmit: async (event) => {
              event.preventDefault();
              submit.disabled = true;
              submit.textContent = "Saving…";
              try {
                await onAcknowledge(log, note.value.trim() || null);
                noteField.hidden = true;
                submit.hidden = true;
                done.hidden = false;
                done.textContent = note.value.trim()
                  ? `Heard, and you said “${note.value.trim()}”`
                  : "Heard.";
                if (cards[index]) cards[index].done = true;
                if (onUnacknowledge) {
                  undo.hidden = false;
                  setTimeout(() => { undo.hidden = true; }, 8000);
                }
                advanceFrom(index);
              } catch {
                submit.disabled = false;
                submit.textContent = "Heard it";
              }
            },
          },
          noteField,
          submit,
          undo,
          done,
        );
        return form;
      })(),
    );
    cards[index] = { element: node, heading, done: false };
    return node;
  };

  const finish = queue.length > 0
    ? card(
      { class: "stack", style: "text-align:center" },
      el("h2", { tabindex: "-1", text: "" }),
      el("p", { class: "caption", text: "When somebody attaches a recording to a session, it arrives here." }),
      el("button", { type: "button", onClick: onBack, text: "Back to the studio" }),
    )
    : null;
  if (finish) finish.hidden = true;

  return el(
    "main",
    {
      id: "main",
      class: "page",
      ...(queue.length === 0 ? { "data-room": "kit" } : {}),
    },
    el("h1", { text: "Listening" }),
    queue.length > 0 && rates.length > 0 && onRateChange && ((() => {
      const buttons = [];
      let savingLine = null;
      const repaint = (value) => {
        for (const [index, button] of buttons.entries()) {
          const chosen = rates[index].value === value;
          button.className = chosen ? "button--primary" : "button";
          button.setAttribute("aria-pressed", chosen ? "true" : "false");
        }
        if (savingLine) {
          const phrase = savingPhrase(value, secondsLeftToHear);
          savingLine.textContent = phrase ?? "";
          savingLine.hidden = !phrase;
        }
      };
      return el(
      "div",
      { class: "row", style: "gap:0.5rem; align-items:center; flex-wrap:wrap" },
      el("span", { class: "caption", id: "rate-label", text: "Speed" }),
      el(
        "div",
        { role: "group", "aria-labelledby": "rate-label", class: "row", style: "gap:0.35rem; flex-wrap:wrap" },
        ...rates.map((r) =>
          registerRateButton(buttons, el("button", {
            type: "button",
            class: r.value === rate ? "button--primary" : "button",
            "aria-label": r.spokenLabel,
            "aria-pressed": r.value === rate ? "true" : "false",
            text: r.label,
            onClick: () => {
              applyRate(r.value);
              onRateChange(r.value);
              repaint(r.value);
            },
          }))
        ),
      ),
      (savingLine = el("p", {
        class: "caption",
        style: "margin: 0; flex-basis: 100%",
        hidden: savingPhrase(rate, secondsLeftToHear) ? undefined : true,
        text: savingPhrase(rate, secondsLeftToHear) ?? "",
      })),
    );
    })()),
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
        finish,
        el("button", { class: "button--quiet", type: "button", style: "width:100%", onClick: onBack, text: "Back to the studio" }),
      ),
  );
}


export function practiceScreen(store, {
  onPrompt, onPractice, onNudgeSeen, onDeleteSession, onRemoveClip,
  onAddSession = null, selfReportMark = "",
  onClipURL = null,
  span = null, onStepSpan = null, onPickSpan = null, onApplyCustom = null,
  seenMilestoneKeys = null, onMilestoneSeen = null,
  now = new Date(),
} = {}) {
  const me = store.profile();
  const roster = store.roster();
  const instructorCount = roster.filter((m) => m.role === "instructor").length;
  const ownerName = roster.find((m) => m.id === store.studio()?.owner_id)?.display_name ?? null;
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
  const { week, progress, byId } = weekProgress(store, me.id, viewedWeek);
  const standing = store.standings().find((s) => s.performerId === me.id);

  const required = Object.entries(progress).filter(([id]) => !byId[id].is_optional);
  const mineBylines = assignmentBylines(store.assignments(), store.roster(), store.profile()?.id);
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

  const loggedSeconds = inRange.reduce((n, l) => n + (l.duration ?? 0), 0);
  const uncountedSeconds = Math.max(0, loggedSeconds - totalSeconds);
  const uncountedNote = () => uncountedSeconds > 0 && el("p", {
    class: "caption",
    text: `${longDuration(uncountedSeconds)} of this isn't counted toward the work: sessions `
      + "under two minutes, and any logged against work that is no longer assigned to you.",
  });
  const mySessions = inRange;

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
        ring(fraction, required.length ? `${progressPercent(fraction, isMet)}%` : "—",
          required.length ? `${metCount} of ${required.length} done` : "nothing set"),
        el(
          "div",
          { class: "grow stack", style: "gap:0.45rem; min-width:8.75rem" },
          el("div", { class: "numeral", style: "font-size:1.25rem; font-weight:700", text: longDuration(totalSeconds) }),
          el("p", { class: "caption", text: "practiced" }),
          uncountedNote(),
          streak >= 2 && pill(`${streak}-week streak`, "accent", { wraps: true }),
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
      single
        ? workHeading(week, now, store.studio().week_starts_on ?? 2, store.studio().time_zone)
        : "Assigned in this range",
      single ? (required.length ? `${metCount} of ${required.length} done` : null) : weeksPhrase,
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
            mineBylines.line(assignment) &&
              el("p", { class: "caption", text: mineBylines.line(assignment) }),
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
                  "div",
                  { class: "row", style: "gap:0.45rem; align-items:baseline; flex-wrap:wrap" },
                  el("span", {
                    class: "micro no-shrink",
                    style: `color: var(${plan.isComplete ? "--met" : "--accent"})`,
                    text: plan.isComplete ? "✓" : "☰",
                    "aria-hidden": "true",
                  }),
                  el("span", {
                    class: "caption",
                    style: plan.isComplete ? "color: var(--met)" : "",
                    text: plan.summaryPhrase ?? "",
                  }),
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
    ),
    isCurrentWeek && Object.keys(byId).length > 0 && onAddSession && el("button", {
      class: "button", type: "button",
      text: "Add practice you already did",
      onClick: onAddSession,
    }),
    mySessions.length > 0 &&
      el(
        "div",
        { class: "stack" },
        mySessions.map((s) =>
          el(
            "div",
            { class: "card--inset stack", style: "gap:0.5rem" },
            el(
              "div",
              { class: "row-between" },
              el(
              "div",
              { class: "stack grow", style: "gap:0.15rem" },
              el("span", { style: "font-weight:600", text: byId[s.assignmentId]?.title ?? "Practice" }),
              el("span", { class: "caption", text: whenPhrase(s.startedAt, store.studio().time_zone) }),
              s.hasClip && !s.isPending &&
                el("span", { class: "caption", text: heardPhrase(s) }),
              (s.clip?.markers ?? []).length > 0 && el("span", {
                class: "caption",
                style: "color: var(--accent)",
                text: markerPhrase(s.clip.markers.length, true),
              }),
              s.selfReported && selfReportMark &&
                el("span", { class: "caption", text: selfReportMark }),
            ),
              el(
                "div",
                { class: "row no-shrink", style: "gap:0.5rem" },
                el("span", { class: "caption numeral", text: compactDuration(s.duration) }),
                rowMenu(
                  `Manage the session from ${whenPhrase(s.startedAt, store.studio().time_zone)}`,
                  [
                    onRemoveClip && s.clip && el("button", {
                      class: "button--plain", type: "button",
                      onClick: () => onRemoveClip(s),
                      text: "Remove the recording",
                    }),
                    onDeleteSession && el("button", {
                      class: "button--plain", type: "button",
                      style: "color: var(--live)",
                      onClick: () => onDeleteSession(s),
                      text: "Delete session",
                    }),
                  ],
                ),
              ),
            ),
            s.instructorNote && card(
              { class: "card--tinted stack", style: "gap:0.2rem" },
              el("p", { style: "margin:0", text: `“${s.instructorNote}”` }),
              el("span", {
                class: "caption",
                text: s.heardAt
                  ? `${heardFrom(instructorCount, ownerName)} · ${whenPhrase(s.heardAt, store.studio().time_zone)}`
                  : heardFrom(instructorCount, ownerName),
              }),
            ),
            el(
              "div",
              { class: "row", style: "gap:0.5rem" },
              s.isSetAside
                ? pill("Couldn't be added to the studio. It's still saved here.", "accent", { wraps: true })
                : s.isPending && pill("Waiting to send"),
              s.hasClip && (onClipURL
                ? el("button", {
                  class: "button--plain no-shrink",
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
            ),
          )
        ),
      ),
  );
}

function takeLengthPhrase(maxSeconds) {
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) return "";
  const minutes = Math.round(maxSeconds / 60);
  return `Up to ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

export function addSessionScreen(store, {
  onSave, onCancel, busy = false, problem = null,
  now = new Date(),
} = {}) {
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
          text: "There is nothing assigned to you this week, so there is nothing to add practice against.",
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
  started.max = localInput(now, zone);
  started.value = localInput(now, zone);

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
      : refusal(at, Number(minutes.value) * 60, week, now);
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
  assignment, capabilities, countIns = [], countInSeconds = 0, draft = {},
  startedAt = new Date(),
  onCountIn, onSave, onCancel, onBlocked,
  onConfirm,
}) {
  const rules = store.rules();
  const floorSeconds = rules.minimumCountableSession;

  const elapsedSeconds = () => Math.floor((Date.now() - startedAt.getTime()) / 1000);
  const display = el("div", { class: "session-clock numeral", text: clock(elapsedSeconds()) });
  const belowFloor = el("p", {
    class: "caption",
    text: `Sessions under ${Math.floor(floorSeconds / 60)} minutes don't count toward the target.`,
    hidden: Math.floor((Date.now() - startedAt.getTime()) / 1000) >= floorSeconds,
  });
  const note = el("textarea", {
    rows: "2", id: "session-note", placeholder: "Left hand still drags out of the roll",
  });
  note.value = draft.note ?? "";
  note.addEventListener("input", () => { draft.note = note.value; });

  const ticked = new Set(draft.ticked ?? []);
  const focusRows = assignment.focus_points.map((point) => {
    const box = el("input", { type: "checkbox", id: `fp-${point.id}`, class: "check" });
    box.checked = ticked.has(point.id);
    box.addEventListener("change", () => {
      if (onBlocked) {
        box.checked = false;
        onBlocked("markFocusPoint");
        return;
      }
      if (box.checked) ticked.add(point.id);
      else ticked.delete(point.id);
      draft.ticked = [...ticked];
    });
    return el("li", {}, field(focusPointPhrase(point), box));
  });

  const takeState = el("p", { class: "caption", text: "No recording yet." });
  const liveDot = el("span", { class: "live-dot", "aria-hidden": "true" });
  const liveWord = el("span", { class: "live-word", text: "Recording" });
  const liveClock = el("span", { class: "live-clock numeral", text: "" });
  const liveLeft = el("span", { class: "live-left nobr", text: "" });
  const liveMarks = el("span", { class: "live-left nobr", text: "" });

  const liveFill = el("span", { class: "live-level__fill" });
  const liveLevel = el("span", { class: "live-level", "aria-hidden": "true" }, liveFill);
  const liveBar = el("p", { class: "live-bar", hidden: true },
                     liveDot, liveWord, " ", liveClock, " ", liveLeft, " ", liveMarks, liveLevel);

  let markers = draft.markers ?? [];
  let elapsedInTake = 0;
  const markButton = el("button", {
    class: "button", type: "button", hidden: true,
    text: "Mark this spot",
    onClick: () => {
      const before = markers.length;
      markers = marking(elapsedInTake, markers);
      draft.markers = markers;
      if (markers.length > before) {
        markButton.classList.add("is-marked");
        setTimeout(() => markButton.classList.remove("is-marked"), 700);
        liveMarks.textContent = `· ${markers.length} marked`;
      }
    },
  });

  const previewURL = (t) => {
    if (!t?.blob) return null;
    if (draft.previewFor !== t) {
      if (draft.previewURL) URL.revokeObjectURL(draft.previewURL);
      draft.previewURL = URL.createObjectURL(t.blob);
      draft.previewFor = t;
    }
    return draft.previewURL;
  };

  const markedLine = el("p", { class: "caption", style: "margin:0; color: var(--accent)", hidden: true });
  const sayMarks = () => {
    const words = markerPhrase(markers.length, true);
    markedLine.hidden = !words;
    if (words) markedLine.textContent = words;
  };

  const takePlayer = el("div", { class: "stack", style: "gap:0.5rem", hidden: true });
  const drawPlayer = (t) => {
    replace(takePlayer);
    takePlayer.hidden = !t;
    if (!t) return;
    const url = previewURL(t);
    if (!url) return;   // a take restored from a draft with no blob behind it

    const audio = el("audio", { controls: true, preload: "metadata", style: "width:100%", src: url });
    const first = markers[0];
    if (first != null) {
      audio.addEventListener("loadedmetadata", () => {
        audio.currentTime = playbackStart(first);
      }, { once: true });
    }

    const chips = el("div", { class: "row", style: "gap:0.4rem" });
    const drawChips = () => {
      replace(chips);
      for (const at of markers) {
        chips.append(el(
          "span",
          { class: "row", style: "gap:0" },
          el("button", {
            class: "button--quiet", type: "button",
            text: clock(at),
            "aria-label": `Play from the mark at ${clock(at)}`,
            onClick: () => { audio.currentTime = playbackStart(at); audio.play().catch(() => {}); },
          }),
          el("button", {
            class: "button--quiet", type: "button",
            text: "✕",
            "aria-label": `Remove the mark at ${clock(at)}`,
            onClick: () => {
              markers = removingMark(at, markers);
              draft.markers = markers;
              drawChips();
              sayMarks();
            },
          }),
        ));
      }
    };

    const markHere = el("button", {
      class: "button", type: "button", style: "width:100%",
      text: "Mark this spot",
      onClick: () => {
        const before = markers.length;
        const at = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        markers = marking(at, markers);
        draft.markers = markers;
        if (markers.length > before) {
          drawChips();
          sayMarks();
        }
      },
    });

    takePlayer.append(audio, markHere, chips);
    drawChips();
  };

  let take = draft.take ?? null;
  if (take) takeState.textContent = `Take attached · ${clock(take.duration)}`;
  sayMarks();
  drawPlayer(take);
  let recording = null; // { stop() }
  let countingIn = null; // an AbortController while the count-in is running

  const countInField = countIns.length > 0 && (() => {
    const select = el("select", {
      id: "count-in",
      onChange: () => {
        onCountIn?.(Number(select.value));
        const picked = countIns.find((o) => String(o.seconds) === select.value);
        if (explanation) explanation.textContent = picked?.detail ?? "";
      },
    });
    const chosen = countInSeconds;
    for (const option of countIns) {
      const node = el("option", { value: String(option.seconds), text: option.label });
      if (option.seconds === chosen) node.selected = true;
      select.append(node);
    }
    const detail = countIns.find((o) => o.seconds === chosen)?.detail ?? "";
    const wrapper = field("Count-in before recording", select, detail || undefined);
    const explanation = wrapper.querySelector(".caption");
    return wrapper;
  })();


  const recordButton = el("button", {
    type: "button",
    style: "width:100%",
    text: take ? "Record it again" : "Record a take",
    onClick: async () => {
      if (onBlocked) { onBlocked("recordTake"); return; }
      if (recording) { recording.stop(); return; }
      const losing = take && lossPhrase(take.duration, markers.length);
      if (losing && onConfirm) {
        const sure = await onConfirm({
          title: "Throw this take away?",
          message: losing,
          confirmText: "Throw it away",
          cancelText: "Keep it",
        });
        if (!sure) return;
      }
      if (countingIn) { countingIn.abort(); return; }

      recordButton.textContent = "Stop the take";
      recordButton.className = "button--primary";
      markers = [];
      draft.markers = markers;
      sayMarks();
      drawPlayer(null);
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
        let shown = 0;
        recording = await capabilities.start({
          onLevel: (peak) => {
            shown = peak > shown ? peak : shown * 0.85 + peak * 0.15;
            liveFill.style.transform = `scaleX(${Math.min(1, shown * 1.6).toFixed(3)})`;
          },
          onTick: (seconds) => {
            elapsedInTake = seconds;
            const left = capabilities.remaining?.(seconds) ?? null;
            liveClock.textContent = clock(seconds);
            liveLeft.textContent = left == null ? "" : `· stops in ${left}s`;
            liveBar.setAttribute("aria-live", left == null ? "off" : "polite");
            takeState.textContent = "";
          },
        });
        liveBar.hidden = false;
        markButton.hidden = false;
        take = await recording.done;
        markers = markers.filter((at) => at <= take.duration);
        draft.markers = markers;
        draft.take = take;
        takeState.textContent = take.interrupted
          ? `${take.interrupted} Take attached · ${clock(take.duration)}`
          : `Take attached · ${clock(take.duration)}`;
        sayMarks();
        drawPlayer(take);
      } catch (error) {
        take = null;
        draft.take = null;
        takeState.textContent = error?.message ?? "That take didn't record.";
        drawPlayer(null);
      } finally {
        recording = null;
        countingIn = null;
        liveBar.hidden = true;
        markButton.hidden = true;
        liveClock.textContent = "";
        liveLeft.textContent = "";
        liveMarks.textContent = "";
        liveFill.style.transform = "scaleX(0)";
        recordButton.textContent = take ? "Record it again" : "Record a take";
        recordButton.className = "";
      }
    },
  });

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
        liveBar,
        takeState,
        markedLine,
        takePlayer,
        recordButton,
        markButton,
        countInField,
      )
      : capabilities.reason
        ? card(
          { class: "stack" },
          el("h2", { text: "Recording" }),
          el("p", { class: "caption", text: capabilities.reason }),
        )
        : null,
    focusRows.length > 0 && card(
      { class: "stack" },
      el("h2", { text: "What to work on" }),
      el("ul", { class: "stack check-list", style: "margin:0; padding:0; list-style:none" }, focusRows),
    ),
    card(
      { class: "stack" },
      el("h2", { text: "How did it go?" }),
      field("Note for your instructor", note,
            "Optional. What you worked on, or anything you want help with."),
    ),
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
          markers,
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


function summaryFacts(...facts) {
  return el(
    "div",
    { class: "row", style: "gap:0.35rem 1.1rem; align-items:baseline; flex-wrap:wrap" },
    ...facts.filter(Boolean).map(([value, label, accent = false]) =>
      el(
        "span",
        { class: "row", style: "gap:0.4rem; align-items:baseline" },
        el("span", {
          class: "numeral",
          style: `font-weight:700; font-size:1.25rem${accent ? "; color: var(--accent)" : ""}`,
          text: value,
        }),
        el("span", { class: "caption", text: label }),
      )
    ),
  );
}


export function standingsScreen(store, {
  onDisplay,
  now = new Date(),
} = {}) {
  const people = Object.fromEntries(store.roster().map((p) => [p.id, p]));
  const me = store.profile();
  const audible = recordsAudio(store);
  const rules = store.rules();
  const standings = store.standings().map((s) => ({
    ...s,
    displayName: people[s.performerId]?.display_name ?? "Someone",
  }));
  const mine = standings.find((s) => s.performerId === me.id) ?? null;

  const window = seasonWindow(termsFrom(store.terms()), {
    studioCreatedAt: store.studio().created_at,
    now,
  });
  const fmt = new Intl.DateTimeFormat(undefined, {
    month: "short", day: "numeric", timeZone: store.studio().time_zone,
  });
  const periodName = window.term ? window.term.name : "All season";

  const pulse = studioPulse(standings);
  const tied = tiedAtTopPhrase(standings);

  return el(
    "main",
    { id: "main", class: "page" },
    el("h1", { text: "Standings" }),
    el("p", {
      class: "caption",
      text: `${periodName} · ${fmt.format(window.from)} – ${fmt.format(window.to)}`,
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
    standings.length === 0
      ? emptyState(
        "No standings yet",
        "Once performers join and start logging, this ranks the studio.",
      )
      : standings.every((s) => (s.points ?? 0) === 0)
      ? emptyState(
        "Nothing on the board yet",
        "The first practice of the week puts the first name up here.",
      )
      : el(
        "div",
        { class: "stack" },
        card(
          { class: "stack" },
          heading("The studio", periodName.toLowerCase()),
          summaryFacts(
            [compactDuration(pulse.practiceSeconds), pulse.practicedLabel],
            audible && [String(pulse.clipCount), pulse.clipsLabel],
            [String(pulse.onStreak), pulse.streakLabel, pulse.onStreak > 0],
          ),
        ),
        mine && card(
          { class: "stack", style: "border-color: var(--accent)" },
          heading("You"),
          summaryFacts(
            [`#${mine.rank}`, "in the studio"],
            [String(mine.points), "points", true],
            [
              mine.currentStreak > 0 ? String(mine.currentStreak) : "—",
              "week streak",
              mine.currentStreak >= STREAK_THRESHOLD,
            ],
          ),
          el("p", { class: "caption", text: gapPhrase(mine, standings, rules.completionPoints) }),
        ),
        tied && el("p", { class: "caption", text: tied }),
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
              avatar(person ?? { id: s.performerId, display_name: "Someone" }),
              el(
                "div",
                { class: "grow stack", style: "gap:0.2rem; flex-basis:0" },
                el(
                  "div",
                  { class: "row", style: "gap:0.5rem; flex-wrap:wrap" },
                  el("span", { style: "font-weight:600", text: person?.display_name ?? "Someone" }),
                  isMe && pill("You", "accent"),
                ),
                el(
                  "div",
                  { class: "row", style: "gap:0.4rem; flex-wrap:wrap" },
                  ...standingFacts(s, audible).map((fact, at) =>
                    el("span", {
                      class: "caption",
                      style: at === 0 ? "" : "white-space:nowrap",
                      text: at === 0 ? fact : `· ${fact}`,
                    })
                  ),
                  s.currentStreak >= STREAK_THRESHOLD
                    && pill(`${s.currentStreak}-week streak`, "accent", { wraps: true }),
                ),
              ),
              el(
                "div",
                { style: "text-align:right; flex-shrink:0" },
                el("div", { class: "numeral", style: "font-weight:700", text: String(s.points) }),
                el("div", { class: "caption", style: "white-space:nowrap", text: "points" }),
              ),
            );
          }),
        ),
        el(
          "div",
          { class: "stack" },
          heading(POINTS_HEADING),
          card(
            { class: "stack" },
            ...scoringRuleLines(rules, audible).map((line) =>
              el(
                "div",
                { class: "row", style: "gap:0.85rem; align-items:baseline" },
                el(
                  "div",
                  { class: "grow stack", style: "gap:0.1rem; flex-basis:0" },
                  el("span", { text: line.label }),
                  line.ceiling && el("span", { class: "caption", text: line.ceiling }),
                ),
                el("span", {
                  class: "numeral no-shrink",
                  style: "color: var(--accent)",
                  text: pointsPhrase(line.points),
                }),
              )
            ),
            el("p", { class: "caption", text: POINTS_FOOTNOTE }),
          ),
        ),
      ),
  );
}


export function youScreen(store, {
  onHelp,
  onLeave, offer, onSignOut, outbox = null, onSwitchStudio, onAnotherStudio = null, onDeleteAccount, onReminders,
  durable = null, onInstall = null,
  onTerms, onScoring, onRoster, onSeason, onLeaveStudio, onSaveProfile, onDeleteStudio,
  purchase = undefined,
  onCreateAccount = null,
  scoringPresets = [],
  onSetRecordsAudio = null,
  onRenameStudio = null,
  onRotateJoinCode = null,
  onSaveEmail = null,
  onExport = null,
  exporting = false,
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
        text: durable && !durable.granted
          ? `${count(outbox.waiting, "session")} on this device, waiting for a connection. ` +
            `It counts toward your week already. Adding IPT to your home screen keeps it safe if ` +
            `you are away from the app for a while.`
          : `${count(outbox.waiting, "session")} on this device, waiting for a connection. ` +
            `It counts toward your week already, and it is not going anywhere.`,
      }),
      outbox.waiting > 0 && durable && !durable.granted && onInstall && el("button", {
        class: "button--quiet", type: "button", style: "width:100%",
        onClick: onInstall,
        text: "Add IPT to your home screen",
      }),
      outbox.setAside > 0 && notice(
        `${count(outbox.setAside, "session")} the server wouldn't accept. The work it was against ` +
          `may have been removed. It is still yours; only you can throw it away.`,
        { kind: "holding" },
      ),
    ),
    studio && store.isInstructor && studio.join_code && card(
      { class: "stack" },
      el("h2", { text: "Your join code" }),
      el("p", { class: "numeral", style: "font-size:1.6rem; font-weight:700; letter-spacing:0.12em", text: groupedCode(studio.join_code) }),
      el("p", { class: "caption", text: "Performers choose “Join a studio” and type this. " + "Capitals, spaces and dashes make no difference, and the code leaves out the characters people mix up. There is no O or 0, and no I or 1." + " Everyone joins as a performer. To add another instructor, open the roster and make them one." }),
      onRotateJoinCode && el("button", {
        type: "button", class: "button--quiet", style: "width:100%",
        onClick: onRotateJoinCode, text: "Replace the code",
      }),
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
    offer && store.isDemo && !isAndroidApp() && card(
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
      !buyerLink && offer.isBuyable && onCreateAccount && el("button", {
        class: "button--primary",
        style: "width:100%",
        type: "button",
        onClick: onCreateAccount,
        text: "Create a free account",
      }),
    ),
    (onTerms || onScoring || onRoster) && card(
      { class: "stack" },
      el("h2", { text: "Running this studio" }),
      onRoster && el("button", {
        type: "button", style: "width:100%", onClick: onRoster, text: "Roster",
      }),
      onScoring && settingButton(
        "Scoring",
        scoringSummary(store.rules(), store.rules().keepsScore !== false, scoringPresets,
          recordsAudio(store)),
        onScoring,
      ),
      onTerms && settingButton("Terms", termsSummary(termsFrom(store.terms())), onTerms),
      onSetRecordsAudio && el(
        "button",
        {
          type: "button",
          role: "switch",
          class: "row-between",
          style: "width:100%",
          "aria-checked": recordsAudio(store) ? "true" : "false",
          "data-records-audio": recordsAudio(store) ? "on" : "off",
          onClick: () => onSetRecordsAudio(!recordsAudio(store)),
        },
        el("span", { text: "Recording" }),
        el("span", { class: "caption", text: recordsAudio(store) ? "On" : "Off" }),
      ),
      onSetRecordsAudio && el("p", {
        class: "caption",
        text: recordsAudio(store)
          ? "Performers can attach a short take to a session."
          : "Off for this whole studio. Nobody is offered a record button, and clips are worth no points. Recordings already made are untouched.",
      }),
      el("p", {
        class: "caption",
        text: onSetRecordsAudio
          ? "Who is in the studio, how it is scored, when it is running, and whether it records."
          : "Who is in the studio, how it is scored, and when it is running.",
      }),
      onRenameStudio && (() => {
        const nameField = el("input", { type: "text", id: "studio-name", maxlength: "80", required: true });
        nameField.value = store.studio()?.name ?? "";
        return el("form", {
          class: "stack",
          onSubmit: (event) => {
            event.preventDefault();
            const wanted = nameField.value.trim();
            if (!wanted || wanted === store.studio()?.name) return;
            onRenameStudio(wanted);
          },
        },
          field("Studio name", nameField, "What performers see at the top of every screen, and on the season report."),
          el("button", { class: "button--quiet", style: "width:100%", type: "submit", text: "Save name" }),
        );
      })(),
    ),
    onReminders && card(
      { class: "stack" },
      el("h2", { text: "Notifications" }),
      el("p", {
        class: "caption",
        text: store.isInstructor
          ? "A summary when the practice week closes, and how often you hear from IPT."
          : "Practice reminders on this device, and how often you hear from IPT.",
      }),
      el("button", { type: "button", style: "width:100%", onClick: onReminders, text: "Reminders" }),
    ),
    onExport && card(
      { class: "stack" },
      el("h2", { text: "Your data" }),
      el("p", {
        class: "caption",
        text: store.isInstructor
          ? "The studio's roster, assignments and every session, as a file."
          : "Every session you have logged, your notes and your recordings, as a file.",
      }),
      el("button", {
        type: "button", style: "width:100%", onClick: onExport,
        text: exporting ? "Putting it together…" : "Export",
        disabled: exporting || undefined,
      }),
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
        text: recordsAudio(store)
          ? "The idea, and the questions people actually ask: what counts as a week being met, "
            + "who can hear your recordings, why a number rounded the way it did."
          : "The idea, and the questions people actually ask: what counts as a week being met, "
            + "who can read what you write, why a number rounded the way it did.",
      }),
      settingButton("How IPT works", helpAudience(store.isInstructor), onHelp),
      el("a", {
        href: "https://iptmusic.com/privacy",
        target: "_blank",
        rel: "noopener",
        class: "caption",
        style: "text-align:center; display:block; color: var(--muted); min-height: 44px; padding-top: 12px",
        text: "Privacy policy",
      }),
      el("a", {
        href: "https://iptmusic.com/terms",
        target: "_blank",
        rel: "noopener",
        class: "caption",
        style: "text-align:center; display:block; color: var(--muted); min-height: 44px; padding-top: 12px",
        text: "Terms of use",
      }),
      el("a", {
        href: "https://iptmusic.com/refunds",
        target: "_blank",
        rel: "noopener",
        class: "caption",
        style: "text-align:center; display:block; color: var(--muted); min-height: 44px; padding-top: 12px",
        text: "Refunds",
      }),
    ),
    !store.isDemo && purchase !== undefined && card(
      { class: "stack" },
      el("h2", { text: "Your IPT account" }),
      purchase
        ? el("p", { text: receiptSentence(purchase), "data-account-receipt": "" })
        : el("p", { class: "caption", text: "No purchase on this account yet." }),
    ),
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
          field("Instrument or part", instrument,
                "Optional. “Snare”, “Marimba 2”. It groups the roster into sections, so everyone in the studio sees it."),
          el("button", { class: "button--primary", style: "width:100%", type: "submit", text: "Save" }),
          said,
        );
      })(),
    ),
    onSaveEmail && emailCard(me, onSaveEmail),
    onLeaveStudio && card(
      { class: "stack" },
      el("h2", { text: "Leaving" }),
      el("p", {
        class: "caption",
        text: studioExitDetail(store.isInstructor),
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
    onLeave && el("button", { class: "button--quiet", style: "width:100%", type: "button", onClick: onLeave, text: "Leave the demo" }),
    onDeleteAccount && deleteAccountCard(deletionCost({
      studios: store.joinedStudios?.() ?? [],
      logs: store.logs(),
      roster: store.roster(),
      profileId: me.id,
    }).phrase, onDeleteAccount),
  );
}

function emailCard(me, onSaveEmail) {
  const address = el("input", { type: "email", id: "me-email", required: true });
  address.value = me?.email ?? "";
  const said = el("p", { class: "caption", role: "status", text: "" });
  return card(
    { class: "stack" },
    el("h2", { text: SETTINGS_LABEL }),
    el("p", { class: "caption", text: SETTINGS_DETAIL }),
    el(
      "form",
      {
        class: "stack",
        onSubmit: (event) => {
          event.preventDefault();
          const wanted = address.value.trim();
          if (!wanted) { said.textContent = "Enter the address you want to use."; return; }
          said.textContent = "Sending…";
          onSaveEmail(wanted);
        },
      },
      field("Email address", address),
      el("button", { class: "button--primary", style: "width:100%", type: "submit",
                     text: "Change my address" }),
      said,
    ),
  );
}

function deleteAccountCard(phrase, onDeleteAccount) {
  return el(
    "details",
    { class: "card stack" },
    el("summary", { style: "font-weight:600; min-height:44px; display:flex; align-items:center", text: "Delete your account" }),
    el("p", { class: "caption", text: phrase }),
    el("p", { class: "caption", text: "It cannot be undone, and support cannot bring it back." }),
    el("button", {
      style: "width:100%; color: var(--live)",
      type: "button",
      onClick: onDeleteAccount,
      text: "Delete my account",
      id: "delete-account",
    }),
  );
}

function policyLinks() {
  const link = (href, text) => el("a", {
    href, target: "_blank", rel: "noopener", class: "caption policy-link",
    style: "min-height:44px; padding:0 0.9rem; display:flex; align-items:center", text,
  });
  const dot = () => el("span", {
    class: "caption", "aria-hidden": "true", style: "color: var(--muted); align-self: center", text: "·",
  });
  return el(
    "div",
    { class: "row", style: "gap: 0; justify-content: center; flex-wrap: wrap" },
    link("https://iptmusic.com/privacy", "Privacy policy"), dot(),
    link("https://iptmusic.com/terms", "Terms of use"), dot(),
    link("https://iptmusic.com/refunds", "Refunds"),
  );
}

export function remindersScreen({
  capability,
  subscribed = false,
  configured,
  preferences,
  volumes,
  isInstructor,
  onVolume,
  onPreference = null,
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
    subscribed && preferences && card(
      { class: "stack" },
      el("h2", { text: "When" }),
      field(
        isInstructor ? "Daily digest" : "Daily reminder",
        (() => {
          const at = el("input", { type: "time", id: "daily-time" });
          at.value = clockValue(preferences.dailyTime);
          at.addEventListener("change", () => {
            const parsed = timeFromClock(at.value);
            if (parsed) onPreference?.({ dailyTime: parsed });
          });
          return at;
        })(),
        isInstructor
          ? "When the day's submissions are summarized."
          : "After rehearsal, before it gets late.",
      ),

      (() => {
        const on = el("input", { type: "checkbox", class: "check", id: "quiet-hours" });
        on.checked = preferences.quietHours != null;
        const from = el("input", { type: "time", id: "quiet-from" });
        const to = el("input", { type: "time", id: "quiet-to" });
        from.value = clockValue(preferences.quietHours?.start ?? { hour: 21, minute: 30 });
        to.value = clockValue(preferences.quietHours?.end ?? { hour: 7, minute: 30 });
        const times = el(
          "div",
          { class: "stack", style: "gap:0.5rem", hidden: on.checked ? undefined : true },
          field("From", from),
          field("To", to),
        );
        const send = () => {
          if (!on.checked) return onPreference?.({ quietHours: null });
          const start = timeFromClock(from.value);
          const end = timeFromClock(to.value);
          if (start && end) onPreference?.({ quietHours: { start, end } });
        };
        on.addEventListener("change", () => { times.hidden = !on.checked; send(); });
        from.addEventListener("change", send);
        to.addEventListener("change", send);
        return el(
          "div",
          { class: "stack", style: "gap:0.5rem" },
          el("div", { class: "check-list" }, field(
            "Quiet hours",
            on,
            on.checked ? "Nothing arrives between these times." : "Reminders can arrive at any time.",
          )),
          times,
        );
      })(),
    ),

    subscribed && preferences && card(
      { class: "stack" },
      el("h2", { text: "What" }),
      el(
        "div",
        { class: "check-list" },
        ...(isInstructor
          ? [
              ["wantsListeningNudge", "Takes waiting to be heard",
               "A nudge when a recording has been waiting a few days. Nothing arrives if nobody is waiting."],
              ["wantsWeeklySummary", "Weekly summary", "One note as the practice week closes."],
            ]
          : [
              ["wantsStreakAlerts", "Streak about to break",
               "Near the end of a week where a streak you've built is still on the line."],
              ["wantsLastChance", "Last day of the practice week",
               "One reminder on the final day if a target is still open."],
              ["wantsWeeklyWrap", "Weekly wrap-up",
               "What you practiced and where your streak stands, once the week closes."],
            ]
        ).map(([key, title, detailText]) => {
          const box = el("input", { type: "checkbox", class: "check", id: `pref-${key}` });
          box.checked = preferences[key] !== false;
          box.addEventListener("change", () => onPreference?.({ [key]: box.checked }));
          return field(title, box, detailText);
        }),
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
          "anybody else's latest practice, and this studio's server has not been set up to work " +
          "them out yet.",
      }),
      el("p", {
        class: "caption",
        text: "Everything else works: assigned work, your own week, and every session you log.",
      }),
    ),
  );
}


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
          text: "Which is fine for a first year. Add a term when your program has a break: weeks " +
            "outside one are not weeks anybody missed, so nobody's streak dies over the summer. " +
            "Terms also scope the standings, so somebody who joins next year is not a year of " +
            "practice behind.",
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

export function scoringScreen(store, { presets, onChoose, onBack, busy = false, problem = null }) {
  const rules = store.rules();
  const silent = recordsAudio(store) === false;
  const comparable = silent
    ? (r) => { const { clipBonus: _b, clipBonusWeeklyCap: _c, ...rest } = r; return rest; }
    : (r) => r;
  const current = presets.find((p) =>
    sameRules(comparable(rules), { ...comparable(rules), ...comparable(p.rules) })
  );

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
      el("h2", { text: "What it pays" }),
      ...scoringRuleLines(rules, recordsAudio(store)).map((line) =>
        el(
          "div",
          { class: "row", style: "gap:0.85rem; align-items:baseline" },
          el(
            "div",
            { class: "grow stack", style: "gap:0.1rem; flex-basis:0" },
            el("span", { text: line.label }),
            line.ceiling && el("span", { class: "caption", text: line.ceiling }),
          ),
          el("span", {
            class: "numeral no-shrink",
            style: "color: var(--accent)",
            text: pointsPhrase(line.points),
          }),
        )
      ),
      el("p", { class: "caption", text: POINTS_FOOTNOTE }),
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
        text: recordsAudio(store)
          ? "Ticking a focus point earns no points, in every preset. Points come from finishing "
            + "what was assigned, keeping a streak, and attaching a recording; minutes are worth "
            + "the least and are capped. A session somebody added afterward is marked as such "
            + "wherever it appears, so you can always see what the app timed."
          : "Ticking a focus point earns no points, in every preset. Points come from finishing "
            + "what was assigned and keeping a streak; minutes are worth the least and are "
            + "capped. A session somebody added afterward is marked as such wherever it appears, "
            + "so you can always see what the app timed.",
      }),
    ),
    onBack && el("button", {
      class: "button--quiet", style: "width:100%", type: "button", onClick: onBack,
      text: "Back to You",
    }),
  );
}

function settingButton(label, value, onClick) {
  return el("button", {
    type: "button",
    class: "row-between",
    style: "width:100%",
    onClick,
  }, el("span", { text: label }), value ? el("span", { class: "caption", text: value }) : null);
}

function recordsAudio(store) {
  return store?.studio?.()?.records_audio !== false;
}

function sameRules(a, b) {
  return Object.keys(b).every((key) => a[key] === b[key]);
}

export function rosterScreen(
  store,
  { onSetRole, onRemove, onHandOver, onCorrect, onBack, busy = false, problem = null },
) {
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
        "Performers choose “Join a studio” and type this code. " +
          "Capitals, spaces and dashes make no difference, and the code leaves out the characters people mix up. There is no O or 0, and no I or 1.",
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
          iAmTheOwner: !!me && me === store.studio()?.owner_id,
          busy,
          onSetRole,
          onRemove,
          onHandOver,
          onCorrect,
        })),
      ),
    problem && notice(problem, { kind: "error", role: "alert" }),
    onBack && el("button", {
      class: "button--quiet", style: "width:100%", type: "button", onClick: onBack,
      text: "Back to You",
    }),
  );
}

function rosterRow(
  member,
  { isMe, isLastInstructor, isOwner, iAmTheOwner, busy, onSetRole, onRemove, onHandOver, onCorrect },
) {
  const isInstructor = member.role === "instructor";
  const canHandOver = !!onHandOver && iAmTheOwner && isInstructor && !isOwner && !isMe;

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
      el("span", { class: "caption no-shrink", "aria-hidden": "true", text: "Manage" }),
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
      canHandOver && el("p", {
        class: "caption",
        text: "You'll stay an instructor here and keep everything you can do today, except owning "
          + "it. They'll be able to delete the studio and everyone's practice in it, and to remove "
          + "you. Only they can hand it back.",
      }),
      canHandOver && el("button", {
        type: "button",
        class: "button--quiet",
        style: "width:100%",
        disabled: busy || undefined,
        "aria-label": `Hand this studio over to ${member.display_name}`,
        onClick: () => onHandOver?.(member),
        text: "Hand this studio over",
      }),
      onCorrect && correctionForm(member, { busy, onCorrect }),
    ),
  );
}

function correctionForm(member, { busy, onCorrect }) {
  const name = el("input", { type: "text", maxlength: "80", required: true });
  name.value = member.display_name ?? "";
  const instrument = el("input", { type: "text", maxlength: "40" });
  instrument.value = member.instrument ?? "";

  return el(
    "details",
    { class: "stack", style: "gap:0.5rem" },
    el("summary", { class: "caption", text: "Fix what this studio shows" }),
    el("p", {
      class: "caption",
      text: "This changes the roster, the standings and the wall display in this studio only. "
        + "Their own account is not touched, and if they are in another studio their name there "
        + "does not change. Clearing a box puts back what they typed.",
    }),
    el(
      "form",
      {
        class: "stack",
        onSubmit: (event) => {
          event.preventDefault();
          onCorrect?.(member, {
            displayName: name.value.trim() || null,
            instrument: instrument.value.trim() || null,
          });
        },
      },
      field("Shown as", name),
      field("Instrument or part", instrument),
      el("button", {
        class: "button--quiet",
        style: "width:100%",
        type: "submit",
        disabled: busy || undefined,
        "aria-label": `Save what this studio shows for ${member.display_name}`,
        text: "Save",
      }),
    ),
    member.is_corrected && el("p", {
      class: "caption",
      text: `They typed “${member.account_display_name}”`
        + (member.account_instrument ? `, ${member.account_instrument}.` : "."),
    }),
  );
}

export function displayScreen(store, { top = 10, onExit, awake = null } = {}) {
  const standings = store.standings();
  const people = Object.fromEntries(store.roster().map((p) => [p.id, p]));

  const earned = standings.filter((s) => (s.practiceSeconds ?? 0) > 0 || s.points > 0);
  const leaders = earned.slice(0, top);

  const totalSeconds = earned.reduce((sum, s) => sum + (s.practiceSeconds ?? 0), 0);

  const finished = standings.filter((s) => s.assignmentsAssigned > 0 && s.assignmentsMet >= s.assignmentsAssigned).length;
  const withWork = standings.filter((s) => s.assignmentsAssigned > 0).length;

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

export function seasonScreen(
  store,
  {
    onCopy, onShare, canShare = false, said = null, report = null,
    now = new Date(),
  } = {},
) {
  if (!report) {
    return el(
      "main",
      { id: "main", class: "page" },
      el("h1", { text: "The season" }),
      card(
        { class: "stack", style: "text-align:center" },
        el("h2", { text: "Just a moment" }),
        el("p", { class: "caption", text: "Putting the summary together." }),
      ),
    );
  }
  const { instructorSummary, performerSummary, spanFrom } = report;
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
    now,
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
      uncovered: report.uncoveredInstructions({
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

  const fitted = (box) => {
    if (typeof requestAnimationFrame !== "function") return box;
    requestAnimationFrame(() => {
      if (!box.isConnected) return;
      box.style.height = "auto";
      box.style.height = `${box.scrollHeight + 2}px`;
    });
    return box;
  };
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
    fitted(el("textarea", {
      class: "season-text",
      id: "season-text",
      readonly: true,
      rows: String(text.split("\n").length + 1),
      onMount: (node) => requestAnimationFrame(() => {
        node.style.height = "auto";
        node.style.height = `${node.scrollHeight + 2}px`;
      }),
      "aria-label": "The season summary, as text",
      text,
    })),
    el("pre", { class: "season-print", "aria-hidden": "true", text }),
    el(
      "div",
      { class: "row", style: "gap:0.5rem; flex-wrap:wrap" },
      el("button", { class: "button--primary", text: "Copy it", onClick: () => onCopy?.(text) }),
      canShare && el("button", { text: "Send it", onClick: () => onShare?.(text) }),
    ),
    said && el("p", { class: "caption", role: "status", text: said }),
  );
}

export function welcomeScreen(store, { help = null, page = 0, onPage, onFinish } = {}) {
  const isInstructor = store?.isInstructor ?? false;
  const records = recordsAudio(store);
  const pages = (isInstructor
    ? (records ? help?.instructor : help?.instructorSilent ?? help?.instructor)
    : (records ? help?.performer : help?.performerSilent ?? help?.performer)) ?? [];
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

export function helpScreen(store, { help = null, supportEmail = null, onBack } = {}) {
  const isInstructor = store?.isInstructor ?? false;
  const keepsScore = store?.rules?.().keepsScore ?? true;

  const records = recordsAudio(store);
  const pages = (isInstructor
    ? (records ? help?.instructor : help?.instructorSilent ?? help?.instructor)
    : (records ? help?.performer : help?.performerSilent ?? help?.performer)) ?? [];
  const questions = (isInstructor
    ? (keepsScore
      ? (records ? help?.instructorQuestions : help?.instructorQuestionsSilent ?? help?.instructorQuestions)
      : (records ? help?.instructorQuestionsNoPoints : help?.instructorQuestionsNoPointsSilent ?? help?.instructorQuestionsNoPoints))
    : (keepsScore
      ? (records ? help?.performerQuestions : help?.performerQuestionsSilent ?? help?.performerQuestions)
      : (records ? help?.performerQuestionsNoPoints : help?.performerQuestionsNoPointsSilent ?? help?.performerQuestionsNoPoints))) ?? [];

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
    supportEmail && el(
      "p",
      { class: "caption", style: "text-align:center" },
      "Still stuck? Write to ",
      el("a", { href: `mailto:${supportEmail}`, text: supportEmail }),
      ". A person reads it.",
    ),
    onBack && el("button", { type: "button", style: "width:100%", onClick: onBack, text: "Back to You" }),
  );
}
