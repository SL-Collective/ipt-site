
const CACHE = "ipt-shell-88309ab0";

const SHELL = [
  "./",
  "./styles/tokens.css",
  "./styles/app.css",
  "./app/main.js",
  "./app/open-session.js",
  "./app/dom.js",
  "./app/format.js",
  "./app/ui.js",
  "./app/screens.js",
  "./app/age-gate.js",
  "./app/export.js",
  "./app/judgement.js",
  "./app/bylines.js",
  "./app/settings-summary.js",
  "./app/android.js",
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
      fetch(request).catch(() => caches.match("./").then((r) => r ?? Response.error())),
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
