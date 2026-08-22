/**
 * The service worker: what makes IPT survive a school network.
 *
 * ==========================================================================================
 * What this is for, which is not "offline mode"
 * ==========================================================================================
 *
 * A practice room is a basement, and a school Chromebook on school wi-fi is the other half of the
 * same problem. This app already has an answer for practice itself — the outbox writes a session to
 * disk before the network is touched — but that answer is worth nothing if the *app* will not load.
 * A performer who opens IPT in a band hall and gets a browser error page has lost the session,
 * whatever the outbox would have done for them.
 *
 * So the job here is narrow: **the app's own files always load.** Not the data — the shell.
 *
 * ==========================================================================================
 * Two strategies, and why they are not the same one
 * ==========================================================================================
 *
 * · **The shell** — HTML, JS, CSS, the demo fixture — is cache-first. These are versioned by the
 *   cache name below, they change only when a deploy happens, and serving them from disk is the
 *   difference between an app that opens and one that does not.
 *
 * · **Supabase** — every `/auth/`, `/rest/` and `/storage/` request — is **never touched.** Not
 *   cached, not intercepted, not retried. That is a deliberate refusal and it is the same rule
 *   `CachingStore` states in Swift: *a cached answer must never stand in for a refusal.* A 4xx from
 *   PostgREST means the server has an opinion about this person — removed from the studio, role
 *   changed, session revoked — and answering it from a cache shows them what they may no longer be
 *   allowed to see while looking exactly like the app working.
 *
 * There is no offline data layer here and there should not be one without the same care
 * `CachingStore` took: it serves a cached read *only* in place of a network failure, never in place
 * of a refusal, and it returns nothing rather than `[]` when it has nothing — because an empty
 * array renders as "you have no assignments", which is a lie somebody would act on.
 */

/**
 * Bumping this is the deploy.
 *
 * Every asset is fetched fresh when the name changes and the old cache is deleted on activate, so
 * there is no per-file versioning to keep in step and no possibility of a half-updated app — the
 * shape of bug where new JavaScript meets old CSS and only one screen is wrong.
 *
 * **The bump belongs in the same commit as the shell change**, never on a deploy checklist: v7
 * sat unchanged through a session that edited ten shell files, and the browser that had v7
 * cached demonstrated exactly what a deployed user would have gotten — the old app, forever,
 * with the demo door silently doing nothing. A deploy step somebody has to remember is the
 * "described control" failure wearing ops clothing.
 */
const CACHE = "ipt-shell-v46";

/**
 * The whole shell. Small enough to list, and listed rather than globbed on purpose: a glob would
 * silently start caching whatever somebody drops into `web/`, and this file is downloaded in full
 * by a Chromebook before the app is usable.
 */
const SHELL = [
  "./",
  "./index.html",
  "./styles/tokens.css",
  "./styles/app.css",
  "./app/main.js",
  "./app/dom.js",
  "./app/format.js",
  "./app/ui.js",
  "./app/screens.js",
  "./app/judgement.js",
  "./app/listening.js",
  "./app/trend.js",
  "./app/milestones.js",
  "./app/spans.js",
  "./app/guidance.js",
  "./app/coverage.js",
  "./app/report.js",
  "./app/quiet.js",
  "./app/reminders.js",
  "./app/setup.js",
  "./app/terms.js",
  "./app/push.js",
  "./app/words.js",
  "./app/demo.js",
  "./app/demo-studio.json",
  "./app/config.js",
  "./app/supabase.js",
  "./app/store.js",
  "./app/outbox.js",
  "./app/recording-prefs.js",
  "./app/selfreport.js",
  "./app/demo-clip.js",
  "./app/recorder.js",
  "./app/mp4.js",
  "./manifest.webmanifest",
];


self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("./index.html").then((r) => r ?? Response.error())),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});


self.addEventListener("push", (event) => {
  let notification = { title: "New practice week", body: "Open IPT to see what's due." };
  try {
    const payload = event.data?.json();
    if (payload?.title && payload?.body) notification = payload;
  } catch { /* the fallback above is the answer */ }

  event.waitUntil(self.registration.showNotification(notification.title, {
    body: notification.body,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: notification.kind ?? "ipt",
    renotify: true,
    data: { kind: notification.kind ?? null, studioId: notification.studioId ?? null },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const routes = {
    practiceReminder: "#/practice",
    streakAtRisk: "#/practice",
    lastChance: "#/practice",
    weeklyWrap: "#/you",
    weeklySummary: "#/",
    listeningBacklog: "#/listening",
    weekOpens: "#/",
  };
  const target = new URL(routes[event.notification.data?.kind] ?? "#/", self.location.origin + "/");

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      if (new URL(client.url).origin === target.origin) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target.href).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
