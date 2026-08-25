
export function bylinesNeeded(assignments, members) {
  if (members.filter((m) => m.role === "instructor").length > 1) return true;
  const authors = new Set(assignments.map((a) => a.created_by).filter(Boolean));
  return authors.size > 1;
}

export function assignmentBylines(assignments, members, viewer) {
  const shown = bylinesNeeded(assignments, members);
  const names = new Map(members.map((m) => [m.id, m.display_name]));

  function name(assignment) {
    const author = assignment?.created_by;
    if (!author) return null;
    if (author === viewer) return "you";
    return names.get(author) ?? "a former instructor";
  }

  return {
    isShown: shown,
    name,
    line(assignment) {
      if (!shown) return null;
      const who = name(assignment);
      return who === null ? null : `Assigned by ${who}`;
    },
  };
}
