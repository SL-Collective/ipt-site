/**
 * What a settings row says **before** it is opened.
 *
 * The web's half of `Sources/IPTCore/SettingsSummary.swift`, pinned by
 * `Tests/IPTCoreTests/Fixtures/settings/cases.json` and `web/tests/settings_summary_test.js`.
 *
 * These rows shipped here as bare buttons while iOS showed the current value beside each one, so
 * the same product answered "how is this studio scored" on a phone and refused to on a Chromebook.
 * Every parity gate passed and structurally had to: one asks whether a screen exists, the other
 * whether a client can act, and neither asks what a screen says on the way in.
 */

/** Which of the two manuals this reader gets. */
export function helpAudience(isInstructor) {
  return isInstructor ? "For instructors" : "For performers";
}

/**
 * The preset a studio is on, or "Off".
 *
 * `presets` arrives with the vocabulary export and is empty until it loads, which is why an empty
 * list returns null rather than "Custom": a studio whose presets have not arrived yet is not a
 * studio that has been moved off them, and the row says nothing rather than something wrong.
 */
export function scoringSummary(rules, keepsScore, presets) {
  if (!keepsScore) return "Off";
  if (!presets || presets.length === 0) return null;
  const match = presets.find((p) => Object.keys(p.rules).every((k) => rules[k] === p.rules[k]));
  return match ? match.name : "Custom";
}

/**
 * Whether a date falls inside a declared term. Nil outside every one of them.
 *
 * **Deliberately not `currentTerm` from `terms.js`**, which is the obvious reuse and the wrong
 * question. That one falls back to the last term that *started* when today is inside none, because
 * its job is picking a season window and a window has to land somewhere. Asked "which term is it
 * now" in July, it answers "Spring" — so a summary built on it would name a term all summer, where
 * Swift's `TermSchedule.term(on:)` returns nothing and the row is meant to count them instead.
 *
 * Last match wins, so a term edited to overlap its predecessor resolves to the newer one, and an
 * absent `endsOn` means open-ended. Both mirror the Swift.
 */
function termOn(terms, date) {
  const inside = (terms ?? []).filter((t) => {
    const startsOn = new Date(t.startsOn);
    if (!(date >= startsOn)) return false;
    if (t.endsOn === null || t.endsOn === undefined) return true;
    return date <= new Date(t.endsOn);
  });
  return inside.length > 0 ? inside[inside.length - 1] : null;
}

/**
 * "All year", the current term's name, or how many terms there are.
 *
 * The third branch is the summer, and it must not read as an error: weeks outside a term are not
 * weeks anybody missed, which is the whole point of the feature. "All year" is never phrased as
 * something missing either, because declaring terms is opt-in.
 */
export function termsSummary(terms, date = new Date()) {
  const list = terms ?? [];
  if (list.length === 0) return "All year";
  const current = termOn(list, date);
  if (current) return current.name;
  return list.length === 1 ? "1 term" : `${list.length} terms`;
}
