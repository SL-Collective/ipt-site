
import {
  el,
} from "./dom.js";
import {
  SETTINGS_DETAIL,
  SETTINGS_LABEL,
} from "./email-change.js";
import {
  detail as welcomeDetail,
  firstName as welcomeFirstName,
  greeting as welcomeGreeting,
  recordDetail as welcomeRecordDetail,
  recordHeading as welcomeRecordHeading,
} from "./studio-welcome.js";
import {
  clock,
  count,
} from "./format.js";
import {
  refusal,
} from "./selfreport.js";
import {
  AGE_QUESTION,
  AGE_REASON,
  isoDay,
  PARENT_DIRECT_NOTICE,
  PARENT_WORDS,
} from "./age-gate.js";
import {
  card,
  field,
  heading,
  notice,
} from "./ui.js";

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
          "and sign in. The account is already made. It can take a few minutes, and it may be in " +
          "spam. A school address in particular can hold it.",
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


export function emailCard(me, onSaveEmail) {
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

export function deleteAccountCard(phrase, onDeleteAccount) {
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

export function policyLinks() {
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
