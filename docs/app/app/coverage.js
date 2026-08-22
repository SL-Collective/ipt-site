/**
 * What the studio has and has not worked on — `IPTCore.FocusCoverage`, transcribed.
 *
 * ## Why the web needed this
 *
 * A focus point exists because *minutes are what the app can count, not what makes somebody
 * better*: the instructor's actual instruction, present at the moment they cannot be in the room.
 * It has two halves, and only one of them shipped here.
 *
 * The **performer's** half — tick the lines you worked on — has been on both clients since the
 * feature landed. The **instructor's** half is the reason it is worth building at all: an
 * instructor who walks into Monday's rehearsal knowing that two of eighteen people have worked the
 * roll release teaches the roll release. On the web, the assignment card listed the instructor's
 * own words back at them as bullet points, with no numbers on any of them and no way to tell a plan
 * the whole studio had worked through from one nobody had opened.
 *
 * Same class of divergence as the quiet-studio offer and the section picker: a capability that
 * exists in Core, reachable on one client, invisible to every gate because both sides are
 * individually correct. `Tools/check_capabilities.py` cannot see this one — it derives its surface
 * from the two *stores*, and this is a computation over reads.
 *
 * ## This is not the judgement, and that is why it can live here
 *
 * Points, ranks, streak history and span totals are about *other people* and stay in `0004`. A tick
 * is not scoreable — *a focus point is never worth points, and that is load-bearing* — so nothing
 * here is a number the server owns. It is a count of rows the client already holds, and the row
 * policy is what makes it safe: `focus_marks_read` is `performer_id = auth.uid() or
 * is_instructor_of(studio_id)`, so a performer's own client can only ever count their own.
 *
 * `web/tests/coverage_test.js` holds every line of it to Swift's answers over one exported fixture.
 *
 * @module
 */

import { audienceIncludes, isActiveDuring } from "./judgement.js";

/**
 * Below this many performers the headline says nothing at all.
 *
 * `FocusCoverage.minimumRosterForHeadline`. "Nobody has worked on this" across a roster of one is
 * not an insight about the studio, it is a fact about a person, and it belongs on their row.
 */
export const MINIMUM_ROSTER_FOR_HEADLINE = 3;

/**
 * The lowest and highest a metronome mark may be — `FocusPoint.tempoRange`.
 *
 * Outside it the instructor has mistyped, and `cleanTempo` drops it rather than storing a number
 * nobody can play. Named here so the form and the reader cannot disagree about what is a tempo.
 */
export const TEMPO_RANGE = Object.freeze({ min: 20, max: 300 });

/** `FocusPoint.cleanTempo` — nil for anything that is not a tempo, rather than a coerced one. */
export function cleanTempo(raw) {
  const tempo = Number(raw);
  return Number.isInteger(tempo) && tempo >= TEMPO_RANGE.min && tempo <= TEMPO_RANGE.max
    ? tempo
    : null;
}

/**
 * The whole instruction on one line — `FocusPoint.phrase`.
 *
 * **The web stored a tempo, preserved it through a duplicate, and showed it nowhere.** `FocusPoint`
 * says why the field exists at all: *playing too fast is the single most common way teenage
 * practice fails, and "slow it down" does not produce a number whereas ♩ = 72 does.* An instructor
 * set one on their phone and no performer on a Chromebook ever saw it.
 *
 * The note value carries the unit, which is why this is not a bare number beside a sentence.
 */
export function focusPointPhrase(point) {
  const tempo = cleanTempo(point?.tempo);
  return tempo == null ? point.text : `${point.text} (♩ = ${tempo})`;
}

/** `FocusCoverage.Line.phrase` — "2 of 18", always with its denominator, because 2 means nothing. */
export function linePhrase(line) {
  return `${line.workedCount} of ${line.rosterCount}`;
}

/**
 * One assignment's plan, in one week or across a span, as the studio has worked it.
 *
 * @param points the instructor's list — `assignment.focus_points`, in the instructor's order.
 * @param marks every tick for **this assignment and this period**, from anyone. The caller narrows;
 *   this collapses duplicates, so a double-tap cannot inflate coverage.
 * @param rosterCount the performers the assignment is actually *for*, not the whole studio — an
 *   assignment aimed at the two snares is not 2-of-18 covered.
 */
export function focusCoverage({ points = [], marks = [], rosterCount = 0 }) {
  const byPoint = new Map();
  for (const mark of marks) {
    const who = byPoint.get(mark.focusPointId) ?? new Set();
    who.add(mark.performerId);
    byPoint.set(mark.focusPointId, who);
  }

  const lines = points
    .slice()
    .map((point) => {
      const workedCount = byPoint.get(point.id)?.size ?? 0;
      return {
        point,
        workedCount,
        rosterCount,
        isUntouched: workedCount === 0,
        fraction: rosterCount > 0 ? workedCount / rosterCount : 0,
      };
    })
    .sort((a, b) =>
      a.workedCount !== b.workedCount
        ? a.workedCount - b.workedCount
        : a.point.position - b.point.position
    );

  const hasPlan = lines.length > 0;
  const untouched = lines.filter((l) => l.isUntouched);

  const isFullyCovered = hasPlan && rosterCount > 0 &&
    lines.every((l) => l.workedCount === rosterCount);

  return {
    lines,
    rosterCount,
    hasPlan,
    untouched,
    isFullyCovered,
    headline: headlineFor(lines, rosterCount, untouched, hasPlan),
  };
}

/** `FocusCoverage.headline` — the one sentence worth putting on the screen, or nothing at all. */
function headlineFor(lines, rosterCount, untouched, hasPlan) {
  if (!hasPlan || rosterCount < MINIMUM_ROSTER_FOR_HEADLINE) return null;

  if (untouched.length === lines.length) return "Nobody has started this plan yet.";
  if (untouched.length > 0) {
    const first = untouched[0];
    return untouched.length === 1
      ? `Nobody has worked on “${first.point.text}” yet.`
      : `${untouched.length} of these have gone untouched.`;
  }

  const weakest = lines[0];
  if (!weakest) return null;
  if (weakest.workedCount === rosterCount) return "The whole studio has worked through this plan.";
  return `“${weakest.point.text}”: ${linePhrase(weakest)} so far.`;
}

/**
 * How much of one assignment's plan **one person** has worked through — `IPTCore.FocusProgress`.
 *
 * The other half of this feature, and the web had neither. `focusCoverage` above answers the
 * instructor's question about the studio; this answers the question the performer and the
 * instructor both ask about a single person, and iOS puts it on four screens: a performer's own
 * week, the running session, the instructor's view of that performer, and the listening queue —
 * where knowing which lines a take was *about* is most of what makes the take legible.
 *
 * @param points the instructor's list, in the instructor's order.
 * @param worked the focus-point ids this person ticked, for this assignment and this week.
 */
export function focusProgress({ points = [], worked = [] }) {
  const ids = new Set(points.map((p) => p.id));
  const ticked = new Set([...worked].filter((id) => ids.has(id)));
  const ordered = points.slice().sort((a, b) => a.position - b.position);

  const total = ordered.length;
  const workedCount = ticked.size;
  const hasPlan = total > 0;
  const remaining = ordered.filter((p) => !ticked.has(p.id));

  return {
    points: ordered,
    worked: ticked,
    total,
    workedCount,
    hasPlan,
    isComplete: hasPlan && workedCount === total,
    isWorked: (id) => ticked.has(id),
    remaining,
    /** The one to do next, so a single line can name it instead of showing a list. */
    nextUp: remaining[0] ?? null,
    fraction: total > 0 ? workedCount / total : 0,
    /**
     * "3 of 5 worked on", or **nothing at all** when there is no plan — an assignment without one
     * is not an assignment scoring zero, and this app does not put "0 of 0" on a screen.
     */
    phrase: hasPlan ? `${workedCount} of ${total} worked on` : null,
  };
}

/**
 * Every tick, grouped by the assignment it belongs to and narrowed to a set of weeks.
 *
 * Exported because both callers need exactly this and both would otherwise write the `weekStart`
 * comparison out again — and getting *that* wrong is silent: `new Date(undefined)` is an Invalid
 * Date, every comparison against it is false, and the studio simply appears never to have ticked
 * anything. The same trap `termsFrom` exists to close.
 *
 * @param weekStarts a `Set` of week-start milliseconds, or null for every week.
 */
export function marksByAssignment(marks, weekStarts = null) {
  const byAssignment = new Map();
  for (const mark of marks) {
    if (weekStarts && !weekStarts.has(new Date(mark.weekStart).getTime())) continue;
    const its = byAssignment.get(mark.assignmentId) ?? [];
    its.push(mark);
    byAssignment.set(mark.assignmentId, its);
  }
  return byAssignment;
}

/**
 * Each person's fail-safe membership instant — `ScoreEngine.memberSinceDates`, transcribed.
 *
 * The earlier of the declared join and their first practice, because `join_studio` stamps
 * `joined_at` with `now()`: a performer removed in March and re-added in June holds a membership
 * beginning in June, and a filter reading it literally deletes their spring. Practice is evidence
 * of membership, so this rule can only ever remove weeks that are *empty* for that person.
 *
 * Absent from the result means "has always been here" — a seeded demo, or a roster row with no
 * join date. `joined` values may be strings or Dates (a store row carries the database's string);
 * a null or missing one is skipped rather than fed to `new Date(undefined)`, which is an Invalid
 * Date that silently loses every comparison.
 *
 * Inside the coverage parity gate, not beside it: the fixture's span cases carry raw `joined` and
 * `facts`, and both sides resolve for themselves.
 */
export function memberSinceDates({ joined = {}, facts = [] }) {
  const first = new Map();
  for (const fact of facts) {
    if (joined[fact.performerId] == null) continue;
    const at = new Date(fact.startedAt);
    const current = first.get(fact.performerId);
    if (current === undefined || at < current) first.set(fact.performerId, at);
  }
  const result = new Map();
  for (const [id, declared] of Object.entries(joined)) {
    if (declared == null) continue;
    const joinedAt = new Date(declared);
    const practiced = first.get(id);
    result.set(id, practiced !== undefined && practiced < joinedAt ? practiced : joinedAt);
  }
  return result;
}

/**
 * The performers an assignment's denominator may honestly count — `FocusCoverage.audience`.
 *
 * "2 of 18 have worked this" was current roster ∩ audience, so a performer who joined in March
 * sat in the denominator of an assignment that closed in October. Somebody counts only if one of
 * `weeks` — **the weeks that could have carried a tick**, which is the caller's judgement — was
 * also theirs. The comparison is `since < week.end`: half-open, the same one an assignment's
 * opening and the judgement's membership both get.
 */
export function assignmentAudience({ assignment, performers, weeks, memberSince }) {
  if (weeks.length === 0) return [];
  return performers.filter((p) => {
    if (!audienceIncludes(assignment, p.id)) return false;
    const since = memberSince?.get(p.id);
    if (since == null) return true;
    return weeks.some((week) => since < week.end);
  });
}

/**
 * Instructions nobody in the studio has worked on, across a span — `FocusCoverage.uncovered`.
 *
 * The one line in the season report that tells the reader what to *do*. A head of department
 * reading "3 of 4 weeks" learns how hard somebody worked; "nobody has touched the roll release"
 * tells them what next week's rehearsal is for.
 *
 * **Across the span, not one week of it.** The Swift this is transcribed from lived in `AppModel`
 * and read a single week's ticks while selecting assignments over the whole range, so a season
 * report called every instruction from an assignment that closed in October untouched — however
 * many people had worked through it. Both sides answer the same way now, and the fixture carries a
 * closed assignment for exactly that reason.
 *
 * @param weeks the span being reported on.
 * @param marks every tick this client may read, unfiltered — this narrows them.
 * @param performers the roster minus instructors, for the denominator.
 */
export function uncoveredInstructions({ assignments = [], weeks = [], marks = [], performers = [], memberSince = new Map() }) {
  const starts = new Set(weeks.map((w) => w.start.getTime()));
  const byAssignment = marksByAssignment(marks, starts);
  const out = [];

  for (const assignment of assignments) {
    const points = assignment.focus_points ?? [];
    if (points.length === 0) continue;
    if (!weeks.some((week) => isActiveDuring(assignment, week))) continue;

    const activeWeeks = weeks.filter((week) => isActiveDuring(assignment, week));
    const audience = assignmentAudience({ assignment, performers, weeks: activeWeeks, memberSince });
    if (audience.length === 0) continue;
    const its = byAssignment.get(assignment.id) ?? [];
    const coverage = focusCoverage({ points, marks: its, rosterCount: audience.length });
    for (const line of coverage.untouched) out.push(`${assignment.title}: ${line.point.text}`);
  }

  return out;
}
