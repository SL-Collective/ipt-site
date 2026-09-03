
export function longDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours} hr ${String(minutes).padStart(2, "0")} min`;
}

export function compactDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

export function markerPhrase(count, isOwn) {
  if (!Number.isFinite(count) || count < 1) return null;
  const who = isOwn ? "You" : "They";
  return count === 1 ? `${who} marked one spot` : `${who} marked ${count} spots`;
}

export function startPhrase(count) {
  if (!Number.isFinite(count) || count < 1) return null;
  return count === 1
    ? "Starts just before the spot they marked"
    : `Starts just before the first of ${count} spots they marked`;
}

export const MARKER_LEAD_IN_SECONDS = 3;

export function playbackStart(at) {
  return Math.max(0, at - MARKER_LEAD_IN_SECONDS);
}

export function clock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function completionRate(met, assigned) {
  if (!assigned) return null;
  return met / assigned;
}

export function completionPhrase(met, assigned) {
  const rate = completionRate(met, assigned);
  if (rate == null) return "—";
  return `${Math.floor(rate * 100)}%`;
}

export function targetPhrase(target) {
  return target.kind === "minutes"
    ? `${target.amount} min this week`
    : `${target.amount} ${target.amount === 1 ? "session" : "sessions"} this week`;
}

export function amountPhrase(progress) {
  const { target } = progress;
  return target.kind === "minutes"
    ? `${progress.countedMinutes} of ${target.amount} min`
    : `${progress.countedSessions} of ${target.amount} sessions`;
}

export function whenPhrase(date, timeZone) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZone,
  }).format(date);
}

export function weekPhrase(week, timeZone) {
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone });
  const lastDay = new Date(week.end.getTime() - 1000);
  return `${fmt.format(week.start)} – ${fmt.format(lastDay)}`;
}

export function count(n, singular, plural = `${singular}s`) {
  return `${n} ${noun(n, singular, plural)}`;
}

export function noun(n, singular, plural = `${singular}s`) {
  return n === 1 ? singular : plural;
}

export function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const PAINT_NAMES = ["amber", "rose", "plum", "indigo", "teal", "moss", "clay", "slate"];

export function paintNameFor(person) {
  if (person.paint && PAINT_NAMES.includes(person.paint)) return person.paint;
  const raw = String(person.id).replace(/-/g, "");
  let total = 0;
  if (/^[0-9a-fA-F]{32}$/.test(raw)) {
    for (let i = 0; i < raw.length; i += 2) total += parseInt(raw.slice(i, i + 2), 16);
  } else {
    for (const ch of raw) total += ch.charCodeAt(0);
  }
  return PAINT_NAMES[total % PAINT_NAMES.length];
}

export function paintStyle(person) {
  const name = paintNameFor(person);
  return `background: var(--paint-${name}); color: var(--on-paint-${name})`;
}

export function groupedCode(code) {
  const value = String(code ?? "");
  if (value.length !== 6) return value;
  return `${value.slice(0, 3)}-${value.slice(3)}`;
}

export function receiptSentence(purchase) {
  const day = (d) => new Intl.DateTimeFormat(undefined, {
    day: "numeric", month: "long", year: "numeric",
  }).format(d);

  if (purchase.refundedAt) {
    return `Refunded on ${day(purchase.refundedAt)}. `
      + "This account can no longer start or join a studio.";
  }
  if (purchase.isComp) {
    const note = (purchase.note ?? "").trim();
    return note ? `Given on ${day(purchase.purchasedAt)}. ${note}` : `Given on ${day(purchase.purchasedAt)}.`;
  }
  const amount = new Intl.NumberFormat(undefined, {
    style: "currency", currency: purchase.currency, currencyDisplay: "narrowSymbol",
  }).format(purchase.amountCents / 100);
  return `Bought on ${day(purchase.purchasedAt)}, ${amount}.`;
}

export function progressPercent(fraction, isMet) {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const floored = Math.floor(clamped * 100);
  return isMet ? floored : Math.min(floored, 99);
}

export function clockValue(time) {
  const hour = String(time?.hour ?? 0).padStart(2, "0");
  const minute = String(time?.minute ?? 0).padStart(2, "0");
  return `${hour}:${minute}`;
}

export function timeFromClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}
