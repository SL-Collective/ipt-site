/**
 * The pieces every screen is built from.
 *
 * The vocabulary deliberately matches `App/Design/Components.swift` — card, stat, meter, pill,
 * avatar — so that a change to what a "stat tile" means has one obvious counterpart on each side
 * rather than two things that merely look similar.
 *
 * Nothing here picks a color. Every value is a token from `tokens.css`, generated from
 * `Brand.swift` and measured by `ContrastTests` in both appearances.
 */

import { el, svg } from "./dom.js";
import { compactDuration, completionPhrase, count, initials, paintStyle } from "./format.js";

export function card(props, ...children) {
  return el("div", { ...props, class: `card ${props?.class ?? ""}`.trim() }, ...children);
}

/**
 * A labelled number.
 *
 * The label is part of the element rather than a sibling, because a number with no unit or noun
 * beside it is the bug this app names most often — and because a screen reader reading "13" alone
 * has been told nothing.
 */
export function stat(value, label, { accent = false } = {}) {
  const silent = value === "—";
  const wide = !silent && String(value).length > 7;
  return el(
    "div",
    { class: wide ? "stat stat--wide" : "stat" },
    el(
      "div",
      { class: `stat__value numeral ${accent ? "stat__value--accent" : ""}` },
      silent ? el("span", { "aria-hidden": "true", text: value }) : value,
      silent ? el("span", { class: "visually-hidden", text: "none" }) : null,
    ),
    el("div", { class: "caption", text: label }),
  );
}

/**
 * A progress meter.
 *
 * `aria-valuetext` carries the words rather than the raw percentage, so VoiceOver says "40 of 120
 * min" instead of "33 percent" — which is the number somebody actually needs and the one the
 * sighted version shows beside it.
 */
export function meter(fraction, { met = false, label, valueText } = {}) {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  return el(
    "div",
    {
      class: "meter",
      role: "progressbar",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": String(Math.floor(clamped * 100)),
      "aria-valuetext": valueText ?? undefined,
      "aria-label": label ?? undefined,
    },
    el("div", {
      class: `meter__fill ${met ? "meter__fill--met" : ""}`,
      style: `width: ${clamped * 100}%`,
    }),
  );
}

export function pill(text, variant, { wraps = false } = {}) {
  const classes = ["pill", variant ? `pill--${variant}` : "", wraps ? "pill--wraps" : ""];
  return el("span", { class: classes.filter(Boolean).join(" "), text });
}

/**
 * Somebody's initials on their color.
 *
 * `aria-hidden` because the name is always rendered next to it — announcing "A R" before "Ana
 * Reyes" is noise, and an avatar carries no information a screen reader needs twice.
 */
export function avatar(person) {
  return el("span", {
    class: "avatar",
    "aria-hidden": "true",
    style: paintStyle(person),
    text: initials(person.display_name),
  });
}

/**
 * A performer row, for the instructor's weekly view.
 *
 * **Takes this week's numbers, named as such.** The first version took the exported season standing
 * and rendered it under a heading that said "This week" — so the web read 34h 03m where the iPhone
 * read 11h 51m for the same studio, and the roster showed season completion rates beside a weekly
 * title. Nothing looked broken; the numbers were simply about a different period than the words
 * above them. Which is precisely the failure this project fears most: silent, plausible, and about
 * somebody's practice.
 *
 * `streak` is the one figure here that is *not* weekly, and it comes from the server's standing
 * because a streak is a claim about every finished week and cannot be computed from one.
 */
export function performerRow(person, week, {
  streak = 0, onOpen = null,
  periodLabel = "this week", metNoun = "met this week",
} = {}) {
  const rate = completionPhrase(week.met, week.assigned);
  const fraction = week.assigned ? week.met / week.assigned : 0;

  const body = el(
    "div",
    { class: "grow stack", style: "gap: 0.4rem" },
    el(
      "div",
      { class: "row-between" },
      el("span", { style: "font-weight: 600", text: person.display_name }),
      el("span", { class: "caption numeral", text: rate }),
    ),
    meter(fraction, {
      met: fraction >= 1,
      label: `${person.display_name}, ${periodLabel}`,
      valueText: week.assigned ? `${week.met} of ${week.assigned} ${metNoun}` : "nothing assigned",
    }),
    el(
      "div",
      { class: "row", style: "gap: 0.5rem; flex-wrap: wrap" },
      person.instrument && el("span", { class: "caption", text: person.instrument }),
      streak >= 2 && pill(`${streak}-week streak`, "accent"),
      week.clips > 0 && el("span", { class: "caption", text: count(week.clips, "clip") }),
      el("span", { class: "caption", text: compactDuration(week.seconds) }),
    ),
  );

  const row = el("div", { class: "card row", style: "gap: 0.85rem; align-items: flex-start" }, avatar(person), body);
  if (!onOpen) return row;

  return el("button", {
    class: "row-button",
    type: "button",
    "aria-label": `${person.display_name}, ${rate} of this week's work`,
    onClick: () => onOpen(person),
  }, row);
}

/**
 * The progress ring on the performer's own week.
 *
 * SVG rather than a div, because the shape carries the meaning and a rounded rectangle pretending
 * to be a circle reads as a bug at any size. Marked `aria-hidden` — the same numbers are in text
 * immediately beside it, and a screen reader reading a ring twice is worse than not reading it.
 */
export function ring(fraction, centreText, subText) {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const met = clamped >= 1;

  return el(
    "div",
    { style: "position: relative; width: 132px; height: 132px; flex: 0 0 auto" },
    svg(
      "svg",
      { viewBox: "0 0 132 132", width: "132", height: "132", "aria-hidden": "true", focusable: "false" },
      svg("circle", {
        cx: 66, cy: 66, r: radius, fill: "none",
        stroke: "var(--inset)", "stroke-width": 11,
      }),
      svg("circle", {
        cx: 66, cy: 66, r: radius, fill: "none",
        stroke: met ? "var(--met)" : "var(--accent-fill)",
        "stroke-width": 11, "stroke-linecap": "round",
        "stroke-dasharray": `${circumference}`,
        "stroke-dashoffset": `${circumference * (1 - clamped)}`,
        transform: "rotate(-90 66 66)",
      }),
    ),
    el(
      "div",
      {
        style: "position:absolute; inset:0; display:grid; place-content:center; text-align:center; gap:2px",
      },
      el(
        "div",
        { class: "numeral", style: "font-size:1.5rem; font-weight:700" },
        centreText === "—" ? el("span", { "aria-hidden": "true", text: centreText }) : centreText,
      ),
      subText && el("div", { class: "caption", text: subText }),
    ),
  );
}

/** A section heading with an optional trailing figure. */
export function heading(title, trailing) {
  return el(
    "div",
    { class: "row-between" },
    el("h2", { text: title }),
    typeof trailing === "string" ? el("span", { class: "caption numeral", text: trailing })
      : (trailing || null),
  );
}

/**
 * A labelled control.
 *
 * **The label is drawn here and the control is told what it is**, rather than left to draw its own.
 * That is the same rule `FieldRow` states in Swift, and it was paid for: a compact `DatePicker`
 * drops its own label when the row is tight, and at an accessibility text size every row is tight —
 * so the term editor showed two unlabelled date pills and nothing wrapped, nothing overlapped, the
 * words were simply gone. A `placeholder` is not a label either: it disappears the moment somebody
 * types, which is exactly when they are most likely to have forgotten what the field was.
 *
 * `hint` is rendered *under* the control and tied to it with `aria-describedby` — above it, at a
 * large text size, the explanation becomes the screen and pushes the control off the fold.
 */
export function field(label, control, hint) {
  const id = control.getAttribute("id") ?? `field-${Math.random().toString(36).slice(2, 9)}`;
  control.setAttribute("id", id);
  if (hint) control.setAttribute("aria-describedby", `${id}-hint`);
  return el(
    "div",
    { class: "field" },
    el("label", { for: id, class: "field__label", text: label }),
    control,
    hint && el("p", { id: `${id}-hint`, class: "caption", text: hint }),
  );
}

/**
 * A message about what just happened, in the one voice that suits it.
 *
 * `kind: "error"` is for something somebody tried to do and the server refused — it is an event,
 * it has an actor, and it belongs on screen next to the thing they pressed. Losing signal is not
 * that: it is a *condition*, it recurs on every refresh and has nothing to acknowledge, so it is
 * `kind: "quiet"` and it clears itself. The modal version of that put a dialog over a performer's
 * practice screen every time a band hall dropped a bar.
 */
export function notice(text, { kind = "quiet", role } = {}) {
  return el("p", {
    class: `notice notice--${kind}`,
    role: role ?? (kind === "error" ? "alert" : "status"),
    text,
  });
}

/**
 * An empty state that *acts*.
 *
 * "Empty states act; they do not describe" — the first screen a new instructor saw said "share your
 * join code" and offered no way to see the join code. If there is nothing to do here, this takes no
 * action prop and says only what is true.
 */
export function emptyState(title, detail, action) {
  return card(
    { class: "stack", style: "text-align:center" },
    el("h3", { text: title }),
    el("p", { class: "caption", text: detail }),
    action,
  );
}

/**
 * One mark per week, met or not — iOS's `WeekStrip`, as marks a screen reader is told about once.
 *
 * The clearest possible answer to the question a span exists to ask — *are they consistent?* A
 * row of eight marks says "missed one in the middle, fine since" faster than any number can.
 * Three states, three treatments: a week where nothing was logged is *inset grey*, not a short
 * amber bar — at this height "barely started" and "never started" would otherwise be the same
 * two pixels, and they are the two weeks that most need telling apart. Heights are iOS's own
 * fractions (`WeekStrip.heightFraction`): met fills, started sits between 0.34 and 0.9 by the
 * mean progress `fraction` the row carries, silence is a stub.
 */
export function weekStrip(rows) {
  const withWork = rows.filter((r) => r.hasWork);
  const silent = withWork.filter((r) => r.seconds === 0).length;
  const spoken = withWork.length === 0
    ? "nothing assigned"
    : `${withWork.filter((r) => r.isMet).length} of ${withWork.length} ${withWork.length === 1 ? "week" : "weeks"} finished${
      silent > 0 ? `, ${silent} with nothing logged` : ""
    }`;

  const height = 34;
  const fractionOf = (r) => {
    if (!r.hasWork || r.seconds === 0) return 0.16;
    if (r.isMet) return 1;
    return Math.max(0.34, Math.min(r.fraction, 0.9));
  };

  const gap = rows.length > 104 ? 0 : rows.length > 52 ? 1 : rows.length > 16 ? 2 : 4;
  const minWidth = rows.length > 104 ? 0 : 1;

  return el(
    "div",
    {
      class: "week-strip",
      role: "img",
      "aria-label": `Week by week: ${spoken}`,
      style: `display:flex; align-items:flex-end; gap:${gap}px; height:${height}px`,
    },
    rows.map((r) =>
      el("span", {
        style: `flex:1 1 0; min-width:${minWidth}px; border-radius:${rows.length > 16 ? 1.5 : 4}px;`
          + ` height:${Math.max(height * fractionOf(r), 6)}px;`
          + ` background:${!r.hasWork || r.seconds === 0 ? "var(--inset)" : r.isMet ? "var(--met)" : "var(--accent)"}`,
      })
    ),
  );
}
