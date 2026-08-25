
export const MAXIMUM_DURATION = 43_200;

const MINIMUM_DURATION = 60;

export function refusal(startedAt, duration, week, now) {
  const at = startedAt instanceof Date ? startedAt.getTime() : startedAt;
  const present = now instanceof Date ? now.getTime() : now;
  const start = week.start instanceof Date ? week.start.getTime() : week.start;
  const end = week.end instanceof Date ? week.end.getTime() : week.end;

  if (at > present) return "inTheFuture";
  if (at < start || at >= end) return "notThisWeek";
  if (duration > MAXIMUM_DURATION) return "tooLong";
  if (duration < MINIMUM_DURATION) return "tooShort";
  return null;
}

const REFUSAL_SENTENCES = Object.freeze({
  inTheFuture: "That hasn't happened yet. Log practice once you have done it.",
  notThisWeek: "You can only add practice from this week. Last week has already been counted.",
  tooLong: "That is longer than a session can be. Twelve hours is the limit.",
  tooShort: "That is too short to count. Give it at least a minute.",
});

export function refusalSentence(kind) {
  return kind ? REFUSAL_SENTENCES[kind] ?? null : null;
}

export function instructorPhrase(selfReported, total) {
  if (!(selfReported > 0) || !(total > 0)) return null;
  if (selfReported === total) {
    return total === 1
      ? "Added afterwards, not timed by the app"
      : `All ${total} added afterwards, not timed by the app`;
  }
  return `${selfReported} of ${total} added afterwards, not timed by the app`;
}
