/**
 * The words this app says, and the refusal that names one.
 *
 * ==========================================================================================
 * Why this is its own file
 * ==========================================================================================
 *
 * These four things used to live in `demo.js`, and that put the whole demo studio on the cold
 * path of every load — including a signed-in director's, who will never open it. `demo.js` and
 * `demo-clip.js` are eleven kilobytes gzipped, and `web/tests/speed_test.js` measures what a
 * first paint waits for: on the band-hall profile (1 Mbit/s) that is most of a tenth of a second
 * spent parsing a studio nobody asked to see. `demo.js` is dynamically imported now, and what a
 * live client genuinely needs from it moved here.
 *
 * This is a first-paint saving and not a bandwidth one, which is worth stating precisely because
 * the two get confused: `sw.js` precaches `demo.js` either way, so the same bytes still reach the
 * device. What changed is that they no longer sit between a performer and their first screen.
 *
 * ==========================================================================================
 * Why the refusal belongs with the vocabulary
 * ==========================================================================================
 *
 * `DemoBlocked` is not merely thrown near these words, it *indexes* them: it carries an action
 * name, and `vocabulary().actions[name]` is the sentence that names that action. A catch site
 * holding one without the other has half a message. They are one idea and they ship together.
 *
 * `DemoBlocked` is also caught synchronously, in `instanceof` checks all over `main.js`, which is
 * the reason this module is statically imported while `demo.js` is not: you cannot `await` an
 * import inside a `catch`. `demo.js` re-exports it so its own tests and readers still find it
 * where they expect, and ES modules being singletons, both names are the same class.
 */

/** Where the exported studio lives, relative to this module. */
const FIXTURE = new URL("./demo-studio.json", import.meta.url);

/**
 * Thrown by every write. `kind` matches the Swift `DemoAction` case names, so the two clients name
 * the same feature and the copy can be shared when the web screens land.
 */
export class DemoBlocked extends Error {
  constructor(action) {
    super(`${action} needs an account. This is the demo studio, so it is read-only.`);
    this.name = "DemoBlocked";
    this.action = action;
  }
}

let cached = null;

/** Loads and caches the exported studio. */
export async function fixture() {
  if (cached) return cached;
  const res = await fetch(FIXTURE);
  if (!res.ok) throw new Error(`demo-studio.json is missing (${res.status}); run \`make test\``);
  cached = await res.json();
  return cached;
}

/**
 * The blocked-feature copy and the offer, without the studio around them.
 *
 * Both are exported from Swift — `DemoAction` and `Entitlement` — and this is the only channel
 * either one reaches the web through. **The live client reads them from here too**, because the
 * entitlement gate in `0005` refuses `create_studio` and `join_studio` for a signed-in person with
 * no purchase, and the words that prompt has to say are the same words the demo says about the same
 * two features. Typing them again in JavaScript would be the second construction the export exists
 * to prevent, and the copy that drifted would be the copy attached to the price.
 */
export async function vocabulary() {
  const data = await fixture();
  return {
    actions: Object.fromEntries(data.actions.map((a) => [a.name, a])),
    offer: data.offer,
    nudgeSuggestions: data.nudgeSuggestions ?? [],
    scoringPresets: data.scoringPresets ?? [],
    notificationVolumes: data.notificationVolumes ?? [],
    countIns: data.countIns ?? [],
    playbackRates: data.playbackRates ?? [],
    selfReportMark: data.selfReportMark ?? "",
    privacyPolicyURL: data.privacyPolicyURL ?? "",
    help: data.help ?? null,
  };
}


/**
 * Where *this person* buys, built from the base the export carries.
 *
 * `Entitlement.checkoutURL(for:)` in Swift, and the reasoning is there in full. The short version:
 * checkout is a Stripe Payment Link, so there is no request of ours in the middle of it to
 * remember who is buying. `client_reference_id` comes back verbatim on
 * `checkout.session.completed` and is the only thread connecting a payment to an account.
 *
 * **Null when there is no account to attach it to**, which is the demo. `DemoStore` profiles are
 * seeded and match nothing in the database, so carrying one to Stripe would take somebody's $4.99
 * and hand the webhook an id belonging to no profile.
 *
 * Built with `URL` rather than string concatenation, because a Payment Link may already carry
 * query items and a hand-written `?` appended twice silently loses the first set.
 */
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
