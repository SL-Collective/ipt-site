/**
 * Every number this client puts on screen passes through here.
 *
 * A transcription of `DurationText` and the display rules around it, and a second construction for
 * the same reason `judgement.js` is one: the browser cannot run Swift. What makes it permissible is
 * that these are the *least* subtle rules in the app and `format_test.js` checks them against the
 * cases that have actually gone wrong.
 *
 * Three rules, all of which this repository has paid for:
 *
 * · **Round down, never up.** 44:59 of a 45-minute target is not met, and telling a performer they
 *   practiced 43 minutes when they did 42:40 is a lie in the app's favour. It is the one error that
 *   discredits every other number on the board.
 * · **Never a bare number.** A duration always carries `min`/`hr`, and a percentage always carries
 *   its sign. A stray count with no unit is a bug.
 * · **Say nothing rather than something uncertain.** A performer with nothing assigned shows "—",
 *   not 0%. They have not completed zero percent of nothing, and this figure is peer-visible.
 */

/** "42 min", "1 hr 05 min", "0 min". */
export function longDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours} hr ${String(minutes).padStart(2, "0")} min`;
}

/** "42m", "1h 05m" — for rows where the long form wraps. */
export function compactDuration(seconds) {
  const total = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

/** "04:31" / "1:04:31" — running timers and clip scrubbers only. */
export function clock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * A completion rate, or **null** when there is nothing to complete.
 *
 * Returning null rather than 0 is the whole point — see `LeaderboardEntry.completionRate`, which
 * makes the same distinction for the same reason.
 */
export function completionRate(met, assigned) {
  if (!assigned) return null;
  return met / assigned;
}

/** "67%", or "—" when there was nothing assigned. */
export function completionPhrase(met, assigned) {
  const rate = completionRate(met, assigned);
  if (rate == null) return "—";
  return `${Math.floor(rate * 100)}%`;
}

/** What a target asks for, in words. Mirrors `PracticeTarget.phrase`. */
export function targetPhrase(target) {
  return target.kind === "minutes"
    ? `${target.amount} min this week`
    : `${target.amount} ${target.amount === 1 ? "session" : "sessions"} this week`;
}

/** How much of a target has been done, in the target's own unit. */
export function amountPhrase(progress) {
  const { target } = progress;
  return target.kind === "minutes"
    ? `${progress.countedMinutes} of ${target.amount} min`
    : `${progress.countedSessions} of ${target.amount} sessions`;
}

/** A weekday-and-date label for a session row. */
export function whenPhrase(date, timeZone) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZone,
  }).format(date);
}

/** "Aug 10 – Aug 16", the label under a week. */
export function weekPhrase(week, timeZone) {
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone });
  const lastDay = new Date(week.end.getTime() - 1000);
  return `${fmt.format(week.start)} – ${fmt.format(lastDay)}`;
}

/**
 * "1 clip", "3 clips".
 *
 * Small, and worth having rather than interpolating: "1 clips" appeared on the first render of the
 * roster, and a plural that is wrong on exactly the count of one is the kind of thing that survives
 * every review because nobody's test data has one of anything.
 */
export function count(n, singular, plural = `${singular}s`) {
  return `${n} ${noun(n, singular, plural)}`;
}

/**
 * The noun alone, agreeing with a number rendered *beside* it rather than inside it.
 *
 * A stat tile draws the figure and its label as two elements, so `count` cannot be used and the
 * label was written as a constant — which is how "1 clips this week" and "3 hasn't logged" both
 * reached the screen. The same failure `count` already exists to prevent, one layout apart: a
 * plural that is wrong on exactly the count of one survives every review, because nobody's test
 * data has one of anything.
 */
export function noun(n, singular, plural = `${singular}s`) {
  return n === 1 ? singular : plural;
}

/** Initials for an avatar, matching `Profile.initials`. */
export function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Somebody's color, in front of their whole studio — `Paint`, transcribed and gated.
 *
 * The first version of this was the join-code lesson in color: eight hexes written from memory
 * that matched *neither* of Swift's appearance tables, a derivation that hashed the UUID's
 * string where Swift sums its bytes (so the same unchosen performer wore different colors on
 * the phone and the Chromebook), and the chosen paint ignored outright. The values live in
 * `tokens.css` now, generated from the paint parity fixture; this file only picks the *name*,
 * exactly as `Paint.derived(from:)` does, and `web/tests/paints_test.js` holds both halves to
 * Swift's own answers.
 */
const PAINT_NAMES = ["amber", "rose", "plum", "indigo", "teal", "moss", "clay", "slate"];

/** `Profile.color`: the chosen paint when there is one, `Paint.derived(from:)` otherwise. */
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

/** The avatar's whole appearance: the fill and its *measured* label, by token, per theme. */
export function paintStyle(person) {
  const name = paintNameFor(person);
  return `background: var(--paint-${name}); color: var(--on-paint-${name})`;
}

/**
 * "ACD-EFG" — `JoinCode.grouped` in Swift, and the form a code is *said* in.
 *
 * The two clients showed this differently and nobody decided to: iOS has grouped it since the
 * type was written, on the reasoning in its own doc comment — grouped for reading aloud and for
 * typing into a segmented field — while the web printed the raw six characters everywhere it
 * appeared. A code's whole transport is an instructor saying it across a rehearsal room, so the
 * half that reads it aloud in threes is the half that is right.
 *
 * Anything not six characters is returned untouched rather than sliced into a shape it does not
 * have. There is no such code today, and a formatter that mangles the one unexpected value it
 * meets is how a screen ends up showing "AB-" to somebody.
 */
export function groupedCode(code) {
  const value = String(code ?? "");
  if (value.length !== 6) return value;
  return `${value.slice(0, 3)}-${value.slice(3)}`;
}
