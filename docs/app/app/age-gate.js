
export const AGE_QUESTION = "Date of birth";
export const AGE_REASON = "IPT asks so that accounts for children under 13 are set up by a parent. "
  + "It is not stored and it is not shown to anybody.";

export const PARENT_WORDS = {
  heading: "A parent or guardian sets this account up",
  explanation: "IPT accounts for anybody under 13 are set up by a parent or guardian rather than "
    + "by the performer. If you are their parent or guardian, you can set one up now. They sign in "
    + "afterward with the email address and password you choose here.",
  noticeHeading: "What a parent should know",
  school: "If IPT is being used by your school, your child's instructor can tell you whether the "
    + "school has already authorized it. Questions about any of this go to support@iptmusic.com, "
    + "and a person reads them.",
};

export const PARENT_DIRECT_NOTICE = "IPT keeps your child's name, their email address, a record of "
  + "the practice they log, and, if their instructor has recording turned on, short audio "
  + "recordings they choose to make. Their instructors can see all of it. Nobody else in the studio "
  + "can hear a recording or read a note. Nothing is sold, nothing is advertised to them, and you "
  + "can ask us to delete all of it at any time.";

const CONSENT_AGE = 13;

const EARLIEST_PLAUSIBLE_YEARS = 120;

export function outcomeFor(born, now = new Date()) {
  const birth = born instanceof Date ? born : parseDay(born);
  if (!birth || Number.isNaN(birth.getTime())) return "implausible";
  if (birth > now) return "implausible";

  const years = wholeYearsBetween(birth, now);
  if (years > EARLIEST_PLAUSIBLE_YEARS) return "implausible";
  return years >= CONSENT_AGE ? "mayCreateAccount" : "needsAParent";
}

function parseDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const parsed = new Date(year, month - 1, day);
  const real = parsed.getFullYear() === year
    && parsed.getMonth() === month - 1
    && parsed.getDate() === day;
  return real ? parsed : null;
}

function wholeYearsBetween(from, to) {
  let years = to.getFullYear() - from.getFullYear();
  const monthGap = to.getMonth() - from.getMonth();
  if (monthGap < 0 || (monthGap === 0 && to.getDate() < from.getDate())) years -= 1;
  return years;
}

export function isoDay(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
