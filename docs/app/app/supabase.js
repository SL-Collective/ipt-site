
import { CLIP_BUCKET, CONFIG } from "./config.js";

const SESSION_KEY = "ipt.session";

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
  static network(why) {
    const error = new StoreError("network", "Couldn't reach the server. Check your connection and try again.");
    error.detail = why;
    return error;
  }
  static needsAccount(action = "createStudio") {
    const error = new StoreError(
      "needsAccount",
      "IPT is $4.99 once, for instructors and performers alike.",
    );
    error.action = action;
    return error;
  }
}

function humanize(body, status) {
  const raw = (body?.message ?? body?.error_description ?? body?.msg ?? body?.error ?? "").toString();
  const code = body?.code ?? "";
  const lower = `${raw} ${code}`.toLowerCase();

  const hint = (body?.hint ?? "").toString().trim();
  if (/^IPT_[A-Z_]+$/.test(raw.trim()) && hint) return hint;

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

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (!session?.expires_at) return;
  const ms = session.expires_at * 1000 - Date.now() - 60_000;
  refreshTimer = setTimeout(() => { refreshSession().catch(() => {}); }, Math.max(ms, 5_000));
}

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

export async function adoptSession(payload) {
  saveSession(normaliseSession(payload));
  const user = await request("/auth/v1/user");
  saveSession({ ...session, user });
  return user;
}

export function resendConfirmation(email) {
  return request("/auth/v1/resend", {
    auth: false,
    method: "POST",
    body: { type: "signup", email },
  });
}

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

export function requestPasswordReset(email) {
  const redirect = encodeURIComponent(location.origin);
  return request(`/auth/v1/recover?redirect_to=${redirect}`, {
    auth: false,
    method: "POST",
    body: { email },
  });
}

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


export function select(table, query = "") {
  const q = query ? (query.startsWith("?") ? query : `?${query}`) : "";
  return request(`/rest/v1/${table}${q}`);
}

export async function selectAll(table, query = "", { pageSize = 5000, window: waveWidth = 6 } = {}) {
  if (!/(^|&|\?)order=/.test(query)) {
    throw new Error(`selectAll(${table}) needs a stable order, or paging can repeat and skip rows`);
  }
  const ask = (limit, offset) => select(table, `${query}&limit=${limit}&offset=${offset}`);
  let budget = 500;
  const rows = [];

  const first = await ask(pageSize, 0);
  budget -= 1;
  if (!Array.isArray(first)) return first;
  rows.push(...first);
  if (first.length === 0) return rows;
  const size = first.length;

  if (size < pageSize) {
    if (budget <= 0) return rows;
    const second = await ask(size, size);
    budget -= 1;
    if (!Array.isArray(second)) return second;
    rows.push(...second);
    if (second.length < size) return rows;
  }

  let offset = rows.length;
  while (budget > 0) {
    const count = Math.min(waveWidth, budget);
    const starts = Array.from({ length: count }, (_, i) => offset + i * size);
    budget -= count;
    const wave = await Promise.all(starts.map((start) => ask(size, start)));

    for (let i = 0; i < wave.length; i += 1) {
      const page = wave[i];
      if (!Array.isArray(page)) return page;
      rows.push(...page);
      if (page.length >= size) continue;
      if (wave.slice(i + 1).every((p) => Array.isArray(p) && p.length === 0)) return rows;
      return await serialTail(ask, starts[i] + page.length, size, rows, budget);
    }
    offset += count * size;
  }
  return rows;
}

async function serialTail(ask, start, size, rows, budget) {
  let offset = start;
  let left = budget;
  while (left > 0) {
    left -= 1;
    const page = await ask(size, offset);
    if (!Array.isArray(page)) return page;
    rows.push(...page);
    if (page.length === 0) return rows;
    offset += page.length;
  }
  return rows;
}

export function rpc(fn, args = {}) {
  return request(`/rest/v1/rpc/${fn}`, { method: "POST", body: args });
}

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


export async function uploadClip(objectPath, blob) {
  return request(`/storage/v1/object/${CLIP_BUCKET_PATH(objectPath)}`, {
    method: "POST",
    body: blob,
    headers: { "content-type": "audio/mp4", "x-upsert": "false" },
  });
}

const CLIP_BUCKET_PATH = (p) => `${CLIP_BUCKET}/${p}`;

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
