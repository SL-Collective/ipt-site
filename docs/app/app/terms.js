/**
 * When a studio is running — `IPTCore.TermSchedule`, and the `terms` half of `0004_judgement.sql`.
 *
 * ## Why this is its own module
 *
 * It lived inside `reminders.js`, and that is the reason it carried a two-version-old bug. v32b
 * fixed `startsOn <= weekEnd` to `<` in Swift and mirrored it in `0004`; **the JavaScript copy was
 * not found, because nobody looking for "does this studio run this week" would open a file about
 * notifications.** *A lesson written where the bug happened, rather than where the pattern lives, is
 * a lesson the next author does not meet* — and the same is true of the code.
 *
 * Three consumers now: the reminder planner, the target guidance, and the screens. There is one
 * construction of each rule here, and `web/tests/terms_test.js` asserts both against the boundaries
 * Swift and the SQL use.
 *
 * @module
 */

/**
 * Whether the studio was running during `[weekStart, weekEnd)`.
 *
 * A term counts if it overlaps the week *at all*, not if it contains the whole week — requiring
 * containment silently discards the first and last week of every term. Empty means always running,
 * which is how every studio behaved before terms existed: declaring terms must never become a setup
 * step between a new instructor and their first assignment.
 *
 * **`startsOn < weekEnd`, strictly.** A practice week is `[start, end)`, so `weekEnd` is the *next*
 * week's first instant — and `<=` counted a term beginning exactly there as overlapping this week,
 * leaking it one week backwards. That is not an edge case: it is the commonest real declaration, a
 * term starting on the day the week turns over. Swift compares `<` in `TermSchedule.isInSession` and
 * `0004_judgement.sql` mirrors it as `t.starts_on < f.week_end`; this copy did not move for two
 * versions, so a studio with "Spring starts 5 January" was reminded to practice through the last
 * week of the holiday — the exact thing declaring a term exists to prevent.
 *
 * `endsOn` stays **inclusive** and is deliberately not the same question: it is a *day* an instructor
 * chose, so a term ending on the 20th covers the week containing the 20th.
 */
export function isInSession(terms, weekStart, weekEnd) {
  if (!terms || terms.length === 0) return true;
  return terms.some((term) => {
    const startsOn = new Date(term.startsOn);
    if (!(startsOn < weekEnd)) return false;
    if (term.endsOn === null || term.endsOn === undefined) return true;
    return new Date(term.endsOn) >= weekStart;
  });
}

/**
 * Term rows as `isInSession` reads them.
 *
 * **The store hands screens normalised shapes, and `terms` is the one it leaves in the database's
 * own words** — `starts_on`, `ends_on`. Every caller therefore has to translate, and a caller that
 * forgets does not crash: `new Date(undefined)` is an Invalid Date, every comparison against it is
 * false, so *every term stops matching* and a studio that declared terms silently behaves as though
 * it were never in session. That is the same family as the first web reminder plan reading eight
 * field names wrong at once and planning nothing, forever, with every test passing.
 *
 * One translation, exported, so the second caller cannot write a different one.
 */
export function termsFrom(rows) {
  return (rows ?? []).map((t) => ({ id: t.id ?? null, name: t.name ?? null, startsOn: t.starts_on, endsOn: t.ends_on ?? null }));
}

/**
 * The term to show by default — `TermSchedule.current`.
 *
 * The one running now; failing that, the most recent one that has **ended**, because a director
 * opening the app in July wants the spring that just finished rather than an empty screen.
 *
 * Last match wins, so a term edited to overlap its predecessor resolves to the newer one rather
 * than to whichever happened to sort first. Overlaps are the instructor's mistake to make and this
 * app's job to survive.
 */
export function currentTerm(terms, now = new Date()) {
  const list = terms ?? [];
  const at = list.filter((t) => {
    const startsOn = new Date(t.startsOn);
    if (!(now >= startsOn)) return false;
    if (t.endsOn === null || t.endsOn === undefined) return true;
    return now <= new Date(t.endsOn);
  });
  if (at.length > 0) return at[at.length - 1];

  const started = list.filter((t) => new Date(t.startsOn) <= now);
  return started.length > 0 ? started[started.length - 1] : null;
}

/**
 * What "the season" actually means for this studio, right now — `WeekCalendar.weeks(in: .season)`.
 *
 * **This is the flexibility a studio that outlives one year depends on, and the web did not have
 * it.** Unbounded, a season is every week since the studio was created, and the Swift says what
 * that costs:
 *
 * > a studio reused across years puts a senior three years of points ahead of a freshman who cannot
 * > ever catch up, and the only escape was a new studio each September and thirty teenagers
 * > re-invited.
 *
 * iOS has read the term since terms existed. The web asked `studio_leaderboard` for
 * `created_at → now` on every load, so an instructor who typed "Spring 2027" into the Terms screen —
 * the whole reason that screen exists — saw no effect on the board at all, and a four-year studio's
 * standings were four years deep with no way to say otherwise.
 *
 * A term that has **ended** stops at its end date rather than at today, so a director opening this
 * in July sees the spring that finished and not a spring padded with eight empty summer weeks.
 *
 * A studio with no terms keeps exactly the behaviour it has always had: everything since it was
 * created. *Declaring terms must never become a setup step between a new instructor and their first
 * assignment.*
 *
 * @returns `{ from, to, term }` — `term` is null when the studio has never declared one.
 */
export function seasonWindow(terms, { studioCreatedAt, now = new Date() }) {
  const created = new Date(studioCreatedAt);
  const term = currentTerm(terms, now);
  if (!term) return { from: created < now ? created : now, to: now, term: null };

  const start = new Date(Math.max(new Date(term.startsOn).getTime(), created.getTime()));
  const declaredEnd = term.endsOn === null || term.endsOn === undefined ? now : new Date(term.endsOn);
  const end = new Date(Math.min(declaredEnd.getTime(), now.getTime()));
  return { from: start < end ? start : end, to: end, term };
}

/**
 * The eras a studio can look back at — `TermSchedule.pastTerms`: every begun term except the
 * one "Season" already shows, newest first, the order somebody scanning a menu for last spring
 * reads in.
 */
export function pastTerms(terms, { studioCreatedAt, now }) {
  const showing = seasonWindow(terms, { studioCreatedAt, now }).term;
  return terms
    .filter((t) => new Date(t.startsOn) <= now && t.id !== showing?.id)
    .sort((a, b) => new Date(b.startsOn) - new Date(a.startsOn));
}
