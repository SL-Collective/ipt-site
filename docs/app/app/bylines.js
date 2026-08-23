/**
 * Who set an assignment, and when saying so earns its line.
 *
 * The web's half of a rule `Sources/IPTCore/Attribution.swift` also states, pinned by
 * `Tests/IPTCoreTests/Fixtures/attribution/cases.json` and `web/tests/bylines_test.js`. Read the
 * Swift for the reasoning; what follows is the same rule and must stay the same rule.
 */

/**
 * Whether this studio's assignments should say who set them.
 *
 * Two conditions, and the second is the one a simpler rule would drop: more than one instructor
 * now, **or** more than one person in the authorship of the work on screen. A studio that used to
 * have two instructors still needs bylines after one leaves, because the assignments the departed
 * instructor set are still listed and are still not yours.
 */
export function bylinesNeeded(assignments, members) {
  if (members.filter((m) => m.role === "instructor").length > 1) return true;
  const authors = new Set(assignments.map((a) => a.created_by).filter(Boolean));
  return authors.size > 1;
}

/**
 * The bylines for one screenful, worked out once.
 *
 * Built per screen rather than per row: `bylinesNeeded` is a question about the whole list and the
 * roster, and its answer cannot differ between two rows of the same list.
 */
export function assignmentBylines(assignments, members, viewer) {
  const shown = bylinesNeeded(assignments, members);
  const names = new Map(members.map((m) => [m.id, m.display_name]));

  /** "you", a display name, or null when nobody recorded who set it. */
  function name(assignment) {
    const author = assignment?.created_by;
    if (!author) return null;
    if (author === viewer) return "you";
    return names.get(author) ?? "a former instructor";
  }

  return {
    isShown: shown,
    name,
    /** The whole sentence, or null when no byline belongs on this screen. */
    line(assignment) {
      if (!shown) return null;
      const who = name(assignment);
      return who === null ? null : `Assigned by ${who}`;
    },
  };
}
