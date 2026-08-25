
const FIXTURE = new URL("./demo-studio.json", import.meta.url);

export class DemoBlocked extends Error {
  constructor(action) {
    super(`${action} needs an account. This is the demo studio, so it is read-only.`);
    this.name = "DemoBlocked";
    this.action = action;
  }
}

let cached = null;

export async function fixture() {
  if (cached) return cached;
  const res = await fetch(FIXTURE);
  if (!res.ok) throw new Error(`demo-studio.json is missing (${res.status}); run \`make test\``);
  cached = await res.json();
  return cached;
}

export async function vocabulary() {
  const data = await fixture();
  return {
    actions: Object.fromEntries(data.actions.map((a) => [a.name, a])),
    offer: data.offer,
    nudgeSuggestions: data.nudgeSuggestions ?? [],
    scoringPresets: data.scoringPresets ?? [],
    notificationVolumes: data.notificationVolumes ?? [],
    weekStarts: data.weekStarts ?? [],
    countIns: data.countIns ?? [],
    playbackRates: data.playbackRates ?? [],
    selfReportMark: data.selfReportMark ?? "",
    privacyPolicyURL: data.privacyPolicyURL ?? "",
    supportEmail: data.supportEmail ?? "",
    help: data.help ?? null,
  };
}


export function checkoutURLFor(offer, profileID) {
  if (!offer?.isBuyable || !offer?.checkoutBase || !profileID) return null;
  try {
    const url = new URL(offer.checkoutBase);
    url.searchParams.append("client_reference_id", String(profileID).toLowerCase());
    return url.toString();
  } catch {
    return null;
  }
}
