
export function firstName(displayName) {
  const first = String(displayName ?? "").split(" ").filter(Boolean)[0];
  return first ?? null;
}

export function greeting(name, hasPracticed) {
  if (!name) return hasPracticed ? "You're not in a studio." : "You're in.";
  return hasPracticed ? `You're not in a studio, ${name}.` : `You're in, ${name}.`;
}

export const recordHeading = "Your record";
export const recordDetail =
  "Every session you logged, your notes and your recordings, as a file. "
  + "One file for each studio you were in.";

export function detail(isInstructor, hasPracticed) {
  if (hasPracticed) {
    return "Nothing you logged has been deleted. Rejoining the studio you were in shows it "
      + "again; a different one starts a new record.";
  }
  return isInstructor
    ? "Start your studio and you'll get a code to read out. Or join one somebody else runs."
    : "Join the studio your instructor set up, or start one of your own.";
}
