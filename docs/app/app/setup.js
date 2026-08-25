
export function setupSteps(assignments, performers) {
  return [
    {
      kind: "assign",
      title: "Assign something to practice",
      detail: "A piece and a weekly target. Everything else in IPT hangs off this. Without one " +
        "there is nothing for anybody to do.",
      isDone: assignments > 0,
    },
    {
      kind: "invite",
      title: "Invite your performers",
      detail: "Read the join code out in rehearsal. They type it once and they're in.",
      isDone: performers > 0,
    },
  ];
}

export function isSetUp(assignments, performers) {
  return setupSteps(assignments, performers).every((step) => step.isDone);
}

export function nextStep(assignments, performers) {
  return setupSteps(assignments, performers).find((step) => !step.isDone) ?? null;
}

export function setupTitle(studioName, assignments, performers) {
  return isSetUp(assignments, performers) ? studioName : `Set up ${studioName}`;
}
