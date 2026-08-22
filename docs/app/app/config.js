/**
 * Where this client points, and what is safe to have here.
 *
 * ## The anon key is meant to be public
 *
 * It identifies the project, not a person. Every rule that decides what anybody may read or write
 * is a row-level-security policy in Postgres, enforced against the user's own JWT — which is the
 * decision that made a second client cheap in the first place. `supabase/migrations/0001_init.sql`
 * says it in the first paragraph: the client holds an anon key and a user JWT, so anything the
 * policies permit is what the product permits.
 *
 * What must **never** appear in this file, or anywhere under `web/`, is the `service_role` key. It
 * bypasses row-level security entirely, and the iOS app deliberately does not carry one either.
 * `make web-audit` greps for it, because "we would never" is not a control.
 *
 * ## Why this is a plain file and not a build-time substitution
 *
 * There is no bundler. The values differ per environment, so deployment writes this file — see
 * `web/README.md`. Keeping it a real module means the app runs from a checkout with no tooling at
 * all, which is what `make web` does.
 */

export const CONFIG = {
  supabaseUrl: globalThis.__IPT_SUPABASE_URL__ ?? "https://ztvfbdxyjdoeofxmojan.supabase.co",
  supabaseAnonKey: globalThis.__IPT_SUPABASE_ANON_KEY__ ?? "sb_publishable_ebS1tB1SI33MnvSWuOszIQ_eDE07Tau",

  /**
   * The VAPID **public** key, and only ever the public one.
   *
   * It is a P-256 point, base64url, and it is meant to be here: a browser needs it to mint a
   * subscription, and every push service reads it off the wire. The private half lives in one
   * place — the `send-reminders` function's secrets — because anybody holding it can make every
   * subscribed device in the studio buzz. `docs/notifications.md` has the rest.
   *
   * Empty rather than a placeholder, because unlike the two values above there is a **correct
   * behaviour for absent**: a deployment that has not set up reminders should say so on the
   * Settings screen and offer nothing, not fail loudly. A subscription minted against a nonsense
   * key succeeds and then never receives anything, which is the silent kind of broken.
   */
  vapidPublicKey: globalThis.__IPT_VAPID_PUBLIC_KEY__ ?? "",
};

export function isConfigured() {
  return !CONFIG.supabaseUrl.includes("REPLACE_ME") &&
    !CONFIG.supabaseAnonKey.includes("REPLACE_ME");
}

/** Whether this deployment can send reminders at all. See `vapidPublicKey`. */
export function remindersConfigured() {
  return CONFIG.vapidPublicKey.length > 0;
}

/** The bucket clips live in. Private — every playback is a freshly minted signed URL. */
export const CLIP_BUCKET = "clips";

/**
 * `<studio>/<performer>/<log>.m4a`, lowercased.
 *
 * A transcription of `ClipObjectPath`, and the comment there is the reason this needs care: the
 * storage policies do not read a table to decide who may touch a clip, they read **the object's
 * own name**. Segment one is the studio, segment two is the performer. So the order of these two
 * segments is a security rule expressed as a string format, and getting it wrong produces a 403
 * that looks exactly like a network problem.
 *
 * Lowercase is not cosmetic either: `auth.uid()::text` renders a uuid in lowercase and the policy
 * compares the second segment to it as text.
 *
 * The extension matches the bucket's `allowed_mime_types`, which permits `audio/mp4` and nothing
 * a browser's default `MediaRecorder` produces on Chrome — see `recorder.js`.
 */
export function clipObjectPath(studioId, performerId, logId) {
  return `${studioId}/${performerId}/${logId}`.toLowerCase() + ".m4a";
}
