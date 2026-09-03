
export const CONFIRM_TITLE = "Change your sign-in address?";
export const CONFIRM_ACTION = "Send the link";

export const SETTINGS_LABEL = "Your email address";
export const SETTINGS_DETAIL =
  "Sign-ins and reset links go to this address. If you are leaving a school, change it to one "
  + "you will keep before the old one closes.";

export const NOT_AN_ADDRESS = "That does not look like an email address.";
export const UNCHANGED = "That is already your address.";

export function checkEmail(wanted, current) {
  const typed = String(wanted ?? "").trim();
  const parts = typed.split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1] || /\s/.test(typed)) return NOT_AN_ADDRESS;
  if (current && typed.toLowerCase() === String(current).trim().toLowerCase()) return UNCHANGED;
  return null;
}

export const confirmation = (wanted) =>
  `IPT will send a confirmation link to ${wanted}. Nothing changes until you follow it, so you `
  + `keep signing in with the address you have now until then. If ${wanted} is wrong, the link `
  + `goes nowhere and nothing happens.`;

export const sentTo = (wanted) =>
  `Check ${wanted} for the link. Until you follow it, sign in with your old address.`;
