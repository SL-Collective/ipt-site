
import { el, svg } from "./dom.js";
import { compactDuration, completionPhrase, count, initials, paintStyle } from "./format.js";

export function card(props, ...children) {
  return el("div", { ...props, class: `card ${props?.class ?? ""}`.trim() }, ...children);
}

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

export function avatar(person) {
  return el("span", {
    class: "avatar",
    "aria-hidden": "true",
    style: paintStyle(person),
    text: initials(person.display_name),
  });
}

export function performerRow(person, week, {
  streak = 0, onOpen = null,
  periodLabel = "this week", metNoun = "met this week",
} = {}) {
  const rate = week.assigned ? `${week.met} of ${week.assigned}` : completionPhrase(week.met, week.assigned);
  const fraction = week.assigned ? week.met / week.assigned : 0;
  const valueText = week.assigned ? `${week.met} of ${week.assigned} ${metNoun}` : "nothing assigned";

  const body = el(
    "div",
    { class: "grow stack", style: "gap: 0.4rem" },
    el(
      "div",
      { class: "row-between" },
      el("span", { style: "font-weight: 600", text: person.display_name }),
      el("span", { class: "caption numeral", text: rate }),
    ),
    meter(fraction, { met: fraction >= 1, label: `${person.display_name}, ${periodLabel}`, valueText }),
    el(
      "div",
      { class: "row", style: "gap: 0.5rem; flex-wrap: wrap" },
      person.instrument && el("span", { class: "caption", text: person.instrument }),
      streak >= 2 && pill(`${streak}-week streak`, "accent", { wraps: true }),
      week.clips > 0 && el("span", { class: "caption", text: count(week.clips, "clip") }),
      el("span", { class: "caption", text: compactDuration(week.seconds) }),
    ),
  );

  const row = el("div", { class: "card row", style: "gap: 0.85rem; align-items: flex-start" }, avatar(person), body);
  if (!onOpen) return row;

  return el("button", {
    class: "row-button",
    type: "button",
    "aria-label": `${person.display_name}, ${valueText}`,
    onClick: () => onOpen(person),
  }, row);
}

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

export function heading(title, trailing) {
  return el(
    "div",
    { class: "row-between" },
    el("h2", { text: title }),
    typeof trailing === "string" ? el("span", { class: "caption numeral", text: trailing })
      : (trailing || null),
  );
}

export function field(label, control, hint) {
  const id = control.getAttribute("id") ?? `field-${Math.random().toString(36).slice(2, 9)}`;
  control.setAttribute("id", id);
  if (hint) control.setAttribute("aria-describedby", `${id}-hint`);
  return el(
    "div",
    { class: "field" },
    el("label", { for: id, class: "field__label", text: label }),
    control.type === "password" ? withReveal(control) : control,
    hint && el("p", { id: `${id}-hint`, class: "caption", text: hint }),
  );
}

function withReveal(control) {
  const toggle = el("button", {
    type: "button",
    class: "button--quiet reveal",
    "aria-pressed": "false",
    "aria-controls": control.getAttribute("id"),
    text: "Show",
    onClick: () => {
      const shown = control.type === "text";
      control.type = shown ? "password" : "text";
      toggle.textContent = shown ? "Show" : "Hide";
      toggle.setAttribute("aria-pressed", shown ? "false" : "true");
      control.focus();
      const end = control.value.length;
      try { control.setSelectionRange(end, end); } catch { /* type=password refuses this in Safari */ }
    },
  });
  return el("div", { class: "field__with-action" }, control, toggle);
}

export function notice(text, { kind = "quiet", role } = {}) {
  return el("p", {
    class: `notice notice--${kind}`,
    role: role ?? (kind === "error" ? "alert" : "status"),
    text,
  });
}

export function emptyState(title, detail, action) {
  return card(
    { class: "stack", style: "text-align:center" },
    el("h3", { text: title }),
    el("p", { class: "caption", text: detail }),
    action,
  );
}

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
