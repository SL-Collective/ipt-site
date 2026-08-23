/**
 * The backend, over plain HTTP. No SDK.
 *
 * ## Why no SDK
 *
 * `@supabase/supabase-js` is ~40 KB gzipped plus its dependency tree, and it would be the only
 * thing in this project requiring a bundler, a lockfile and a supply chain. The surface actually
 * used here is small enough to read in one sitting: GoTrue's token endpoints, PostgREST's query
 * grammar, and two Storage calls. A school Chromebook on school wi-fi downloads what it needs and
 * nothing else, and there is no package that can be compromised on a Tuesday.
 *
 * ## What this file is not allowed to do
 *
 * **No filtering that a policy should be doing.** A performer may not read another performer's
 * note or clip, and that is enforced by row-level security in Postgres — never by a `.filter()`
 * here. A client-side privacy control is one a debugger switches off. This client asks for what it
 * wants and the database decides; where a request would return more than it should, the fix goes
 * in the migration.
 */

import { CLIP_BUCKET, CONFIG } from "./config.js";

const SESSION_KEY = "ipt.session";

/** Errors, in the same vocabulary `StoreError` uses in Swift, so both clients say the same thing. */
export class StoreError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
  static notSignedIn() {
    return new StoreError("notSignedIn", "You're signed out. Sign in and try again.");
  }
  static needsEmailConfirmation() {
    return new StoreError(
      "needsEmailConfirmation",
      "Check your email and tap the link to confirm your address, then sign in.",
    );
  }
  static noSuchStudio() {
    return new StoreError("noSuchStudio", "No studio has that code. Check it with your instructor.");
  }
  static notPermitted() {
    return new StoreError("notPermitted", "You don't have access to that.");
  }
  /**
   * `why` is kept for diagnosis and **not** put in front of a person.
   *
   * Every browser words this differently and none of them words it for a musician: "Failed to
   * fetch", "Load failed", "NetworkError when attempting to fetch resource". Appended to a clear
   * sentence it does the same job the bare status does — it gets nothing across except the feeling
   * that something technical went wrong. Same rule as `humanize()`, which shows a status only when
   * it has no sentence to show instead.
   */
  static network(why) {
    const error = new StoreError("network", "Couldn't reach the server. Check your connection and try again.");
    error.detail = why;
    return error;
  }
  /**
   * The two doors, refused for want of a purchase.
   *
   * `0005_entitlement.sql` raises `IPT_NO_ACCOUNT` — a named, catchable condition rather than
   * prose — from `create_studio` and `join_studio`, and nowhere else. Practice already logged is
   * never gated: nobody's record is held hostage. `store.js` matches on the condition and the shell
   * turns this one kind into the purchase prompt rather than into an error somebody has to read.
   */
  static needsAccount(action = "createStudio") {
    const error = new StoreError(
      "needsAccount",
      "IPT is $4.99 once, for instructors and performers alike.",
    );
    error.action = action;
    return error;
  }
}

/**
 * Turns a PostgREST or GoTrue error body into a sentence.
 *
 * A transcription of `humanized()` in `SupabaseStore.swift`, and it carries that file's one
 * deliberate omission: **duplicate key is left untranslated on purpose.** The outbox is
 * at-least-once, so a resent session reports success *as* a duplicate, and `createLog` below finds
 * it by looking for "23505" in this exact string. Humanising it would turn every resent session
 * into a fresh insert and silently double somebody's week — no error, no crash, nothing to notice.
 */
function humanize(body, status) {
  const raw = (body?.message ?? body?.error_description ?? body?.msg ?? body?.error ?? "").toString();
  const code = body?.code ?? "";
  const lower = `${raw} ${code}`.toLowerCase();

  if (lower.includes("rate limit") && lower.includes("email")) {
    return "Too many sign-up emails right now. Wait a few minutes and try again.";
  }
  if (lower.includes("error sending confirmation email") || lower.includes("error sending")) {
    return "The confirmation email couldn't be sent just now. Try again in a minute. Your account may already exist, so try signing in first.";
  }
  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return "There's already an account for that email. Sign in instead.";
  }
  if (lower.includes("invalid login credentials")) {
    return "That email and password don't match. Check both and try again.";
  }
  if (lower.includes("email_address_invalid") || (lower.includes("is invalid") && lower.includes("email"))) {
    return "That doesn't look like an email address that can receive mail. Check it for typos.";
  }
  if (lower.includes("password should be at least") || lower.includes("weak_password")) {
    return "That password is too short. Use at least 8 characters.";
  }
  if (lower.includes("email not confirmed")) {
    return "Check your email and tap the link to confirm your address, then sign in.";
  }

  if (code === "23505" || lower.includes("duplicate key")) return raw; // load-bearing, see above

  if (lower.includes("foreign key constraint") || lower.includes("violates foreign key")) {
    return "That assignment isn't there any more. Your instructor may have deleted it, but your practice is still saved here.";
  }
  if (lower.includes("row-level security") || lower.includes("42501")) {
    return "You're not in that studio any more, so this couldn't be saved to it. Your practice is still here.";
  }
  if (lower.includes("violates check constraint") || lower.includes("23514")) {
    return "The server wouldn't accept one of these values. Check the dates and numbers and try again.";
  }
  if (lower.includes("null value in column") || lower.includes("23502")) {
    return "Something required was missing. Check the form and try again.";
  }
  if (lower.includes("deadlock") || lower.includes("statement timeout") || lower.includes("57014")) {
    return "The server was busy. Try again in a moment.";
  }
  if (status === 401 || status === 403) return "You don't have access to that.";
  return raw || `The server returned ${status}.`;
}


let session = null;
let refreshTimer = null;

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(next) {
  session = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
  }
  scheduleRefresh();
}

/**
 * Refresh a minute before expiry, not on a 401.
 *
 * Reacting to a 401 means the failing request is the one the performer just made — most often the
 * submit at the end of a session — and retrying it after refreshing risks sending it twice. The
 * outbox is idempotent so that would survive, but the right place to lose a race is not there.
 *
 * **The timer alone is not the guarantee.** A timer does not run in a closed Chromebook lid, so a
 * session restored the next morning is already stale and everything `boot()` fires before the
 * timer's five-second floor would go out with a dead token. A 401 is a *refusal*, and a refusal is
 * what the outbox is never allowed to wait out — five mornings like that and real practice would
 * be set aside as server-refused. So `request()` checks the stored expiry before attaching the
 * header and refreshes first; the timer only keeps that check from ever firing mid-rehearsal.
 */
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (!session?.expires_at) return;
  const ms = session.expires_at * 1000 - Date.now() - 60_000;
  refreshTimer = setTimeout(() => { refreshSession().catch(() => {}); }, Math.max(ms, 5_000));
}

/**
 * One refresh in flight, ever. GoTrue rotates refresh tokens, so two concurrent refreshes are not
 * wasteful — they are fatal: the loser presents a rotated-away token, is refused, and the refusal
 * path signs the person out. `SupabaseClient.swift` holds the same rule for the same reason.
 */
let refreshInFlight = null;

function refreshSession() {
  if (!session?.refresh_token) return Promise.resolve(null);
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const res = await fetch(`${CONFIG.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: CONFIG.supabaseAnonKey, "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!res.ok) {
      saveSession(null);
      return null;
    }
    saveSession(normaliseSession(await res.json()));
    return session;
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

/** Stale means within a minute of expiry — the same margin the timer aims for. */
function tokenIsStale() {
  return !!session?.expires_at && session.expires_at * 1000 - Date.now() < 60_000;
}

function normaliseSession(payload) {
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: payload.expires_at ??
      Math.floor(Date.now() / 1000) + (payload.expires_in ?? 3600),
    user: payload.user ?? session?.user ?? null,
  };
}

export function currentUserId() {
  return session?.user?.id ?? null;
}

export function isSignedIn() {
  return !!session?.access_token;
}

export function restoreSession() {
  session = loadSession();
  scheduleRefresh();
  return session;
}


async function request(path, { method = "GET", body, headers = {}, auth = true } = {}) {
  const h = {
    apikey: CONFIG.supabaseAnonKey,
    ...headers,
  };
  if (auth) {
    if (!session?.access_token) throw StoreError.notSignedIn();
    if (tokenIsStale()) {
      try {
        await refreshSession();
      } catch (cause) {
        throw StoreError.network(cause?.message ?? "No connection.");
      }
      if (!session?.access_token) throw StoreError.notSignedIn();
    }
    h.authorization = `Bearer ${session.access_token}`;
  }
  if (body !== undefined && !(body instanceof Blob)) h["content-type"] = "application/json";

  let res;
  try {
    res = await fetch(`${CONFIG.supabaseUrl}${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : (body instanceof Blob ? body : JSON.stringify(body)),
    });
  } catch (cause) {
    throw StoreError.network(cause?.message ?? "No connection.");
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") return null;

  const text = await res.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { message: text }; }
  }

  if (!res.ok) {
    const err = new StoreError("server", humanize(payload, res.status), res.status);
    err.body = payload;
    throw err;
  }
  return payload;
}


export async function signUp({ email, password, displayName, role = "performer" }) {
  const payload = await request("/auth/v1/signup", {
    auth: false,
    method: "POST",
    body: { email, password, data: { display_name: displayName, role } },
  });

  if (payload?.access_token) {
    saveSession(normaliseSession(payload));
    return { confirmed: true };
  }
  return { confirmed: false };
}

export async function signIn({ email, password }) {
  try {
    const payload = await request("/auth/v1/token?grant_type=password", {
      auth: false,
      method: "POST",
      body: { email, password },
    });
    saveSession(normaliseSession(payload));
    return session.user;
  } catch (err) {
    if (err.body?.error_code === "email_not_confirmed" ||
        /email not confirmed/i.test(err.message)) {
      throw StoreError.needsEmailConfirmation();
    }
    throw err;
  }
}

/**
 * Adopts the session GoTrue hands back on the end of a confirmation link.
 *
 * **The confirmation link comes back as a hash fragment**, and this app is a hash-routed
 * single-page app — so `#access_token=…&refresh_token=…&type=signup` arrives where a route
 * belongs. Consuming it is not optional: left there it is a route the router does not recognise,
 * and the person who just confirmed their email lands on the sign-in screen holding a perfectly
 * good session in their address bar.
 *
 * The user is **fetched rather than decoded**. The tokens carry the id in a claim, and reading it
 * would mean a base64url JWT parser in the client for a value the server will hand over for one
 * request — one that also proves the token is live, which a decode cannot.
 */
export async function adoptSession(payload) {
  saveSession(normaliseSession(payload));
  const user = await request("/auth/v1/user");
  saveSession({ ...session, user });
  return user;
}

/**
 * Another confirmation email.
 *
 * Worth having rather than telling somebody to sign up again: a second sign-up with the same
 * address does not fail loudly on GoTrue, it returns an obfuscated user and sends nothing — which
 * looks exactly like the app working and leaves them waiting for a mail that is never coming.
 */
export function resendConfirmation(email) {
  return request("/auth/v1/resend", {
    auth: false,
    method: "POST",
    body: { type: "signup", email },
  });
}

/**
 * What a fragment the browser arrived with is asking for.
 *
 * **This was tested by grepping `main.js` for the string `params.get("type") === "recovery"`.** That
 * is a check on the presence of a line, not on what happens, and it is the shape this project has a
 * section about: it passes for as long as the thing it tests is not real, and it cannot fail for any
 * regression that keeps the text and changes the meaning. The reason it was written that way is
 * plain enough — the decision lived inside a function that adopts sessions over the network, inside
 * a module that runs `boot()` on import, and nothing could reach it.
 *
 * So the decision comes out and the network stays behind. Four kinds, and the distinction that
 * matters most is the last one:
 *
 *   · `none`    — an ordinary route, or a fragment with nothing in it for us.
 *   · `error`   — GoTrue said why, and its `+`-encoded spaces are undone here.
 *   · `session` — a confirmation link. Adopt it and carry on.
 *   · `recovery` — **a reset link is not a sign-in.** It proves control of an inbox, and the one
 *     thing owed before anything else is a new password. Without this distinction the reset email
 *     signed people in silently and left the forgotten password unchanged: a reset that resets
 *     nothing, and somebody locked out of their own studio the next time they tried the old one.
 */
export function authRedirectIntent(hash) {
  const raw = (hash ?? "").startsWith("#") ? hash.slice(1) : (hash ?? "");
  if (!raw.includes("access_token=") && !raw.includes("error_description=")) return { kind: "none" };

  const params = new URLSearchParams(raw);
  const problem = params.get("error_description");
  if (problem) return { kind: "error", problem: problem.replace(/\+/g, " ") };

  return {
    kind: params.get("type") === "recovery" ? "recovery" : "session",
    tokens: {
      access_token: params.get("access_token"),
      refresh_token: params.get("refresh_token"),
      expires_in: Number(params.get("expires_in")) || undefined,
    },
  };
}

/**
 * Sends the password-reset email. The link lands back on this origin, where
 * `consumeAuthRedirect` adopts the session and — because the fragment says `type=recovery` —
 * the shell asks for a new password before anything else happens. GoTrue deliberately answers
 * success for an unknown address, and this passes that through: "no account has that email" at
 * the door is an account-enumeration oracle.
 */
export function requestPasswordReset(email) {
  const redirect = encodeURIComponent(location.origin);
  return request(`/auth/v1/recover?redirect_to=${redirect}`, {
    auth: false,
    method: "POST",
    body: { email },
  });
}

/** The new password, set on the recovery session the reset link carried. */
export function updatePassword(password) {
  return request("/auth/v1/user", { method: "PUT", body: { password } });
}

export async function signOut() {
  try {
    await request("/auth/v1/logout", { method: "POST" });
  } catch {
  }
  saveSession(null);
}


/**
 * `select` with PostgREST's query grammar, passed through rather than wrapped in a builder.
 *
 * A fluent builder would be a second, smaller construction of a query language that already
 * exists and is documented. The call sites read as what they send.
 */
export function select(table, query = "") {
  const q = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  return request(`/rest/v1/${table}${q}`);
}

/**
 * `select`, in pages, until the server has nothing left to give.
 *
 * ==========================================================================================
 * The silent wrong number
 * ==========================================================================================
 *
 * PostgREST caps how many rows one request may return. The cap is a platform setting — the Data
 * API's "Max rows" — it is **not** set anywhere in this repository, and a capped response looks
 * exactly like a complete one: 200, a JSON array, no error, no warning. The client that reads it
 * then computes a studio's totals from part of the data and shows a number that is confidently
 * wrong.
 *
 * That is the worst failure this product has available to it. Every screen here is a claim about
 * how much somebody practiced; a total that is quietly short is worse than an error, because an
 * error is something a person can see.
 *
 * And it is not a large-studio problem. `#loadStudio` asks for **every practice log since the
 * studio was created** — twenty performers logging three sessions a week is sixty rows a week, so
 * a common default of a thousand rows is one semester. The pilot database holds thirty-three rows
 * today, which is why nothing has gone wrong yet and why nothing would have warned anybody.
 *
 * ==========================================================================================
 * Why paging, and why it does not need to know the cap
 * ==========================================================================================
 *
 * The obvious fix is to ask for a count and compare — but `count=exact` makes Postgres scan the
 * whole table on every load, against an 8 second `statement_timeout`, to answer a question we do
 * not otherwise need answered.
 *
 * So this pages instead, and **advances by what actually came back rather than by the page size**.
 * That distinction is the whole design: `offset += pageSize` silently truncates whenever the
 * server's cap is smaller than the page asked for, which is precisely the unknown being defended
 * against. Advancing by `page.length` is correct for any cap, including one changed later in a
 * dashboard by somebody who never reads this file. It stops when a page comes back empty.
 *
 * The caller must pass a stable `order`, or paging over a shifting sort can repeat and skip rows.
 * That is asserted rather than assumed.
 */
export async function selectAll(table, query = "", { pageSize = 1000 } = {}) {
  if (!/(^|&|\?)order=/.test(query)) {
    throw new Error(`selectAll(${table}) needs a stable order, or paging can repeat and skip rows`);
  }
  const rows = [];
  let offset = 0;
  for (let page = 0; page < 500; page += 1) {
    const got = await select(table, `${query}&limit=${pageSize}&offset=${offset}`);
    if (!Array.isArray(got)) return got;
    rows.push(...got);
    if (got.length === 0) return rows;
    offset += got.length;
  }
  return rows;
}

export function rpc(fn, args = {}) {
  return request(`/rest/v1/rpc/${fn}`, { method: "POST", body: args });
}

/**
 * `resolution` is how an upsert is asked for — `merge-duplicates` to overwrite, `ignore-duplicates`
 * to leave the existing row alone. Both are used: a focus point that kept its id keeps the ticks
 * against it, and a double-tapped focus mark on a bad connection is one row rather than an error
 * somebody has to interpret.
 */
export function insert(table, rows, { returning = "representation", resolution } = {}) {
  const prefer = [`return=${returning}`];
  if (resolution) prefer.push(`resolution=${resolution}`);
  return request(`/rest/v1/${table}`, {
    method: "POST",
    body: rows,
    headers: { prefer: prefer.join(",") },
  });
}

export function patch(table, query, values) {
  return request(`/rest/v1/${table}?${query}`, {
    method: "PATCH",
    body: values,
    headers: { prefer: "return=representation" },
  });
}

export function remove(table, query) {
  return request(`/rest/v1/${table}?${query}`, { method: "DELETE" });
}


/**
 * Uploads a clip.
 *
 * The content type is fixed at `audio/mp4` because the bucket's `allowed_mime_types` permits only
 * that family, and because an instructor's iPhone plays these back through AVFoundation, which
 * cannot decode WebM or Opus at all. `recorder.js` is what guarantees the bytes match the claim —
 * a browser's default `MediaRecorder` on Chrome would produce WebM and this upload would 400.
 */
export async function uploadClip(objectPath, blob) {
  return request(`/storage/v1/object/${CLIP_BUCKET_PATH(objectPath)}`, {
    method: "POST",
    body: blob,
    headers: { "content-type": "audio/mp4", "x-upsert": "false" },
  });
}

const CLIP_BUCKET_PATH = (p) => `${CLIP_BUCKET}/${p}`;

/**
 * A short-lived URL the player can stream.
 *
 * Minted per playback and never persisted: clips live in a private bucket, and a signed URL
 * written into a row is a broken player three hours later.
 */
export async function signedClipUrl(objectPath, expiresIn = 3600) {
  const res = await request(`/storage/v1/object/sign/${CLIP_BUCKET_PATH(objectPath)}`, {
    method: "POST",
    body: { expiresIn },
  });
  return `${CONFIG.supabaseUrl}/storage/v1${res.signedURL ?? res.signedUrl}`;
}

export async function deleteClip(objectPath) {
  return request(`/storage/v1/object/${CLIP_BUCKET_PATH(objectPath)}`, { method: "DELETE" });
}
