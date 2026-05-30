/**
 * WorkFlow Pro – Service Worker (PWA)
 *
 * Strategie:
 *  - App Shell (HTML/CSS/JS/fonts): Cache-first + stale-while-revalidate
 *  - API-calls  (/api/**):         Network-first + fallback naar cache
 *  - Navigatieverzoeken:           index.html als offline-fallback
 *  - Push-notificaties:            Voorbereid (Web Push API)
 *
 * Versie ophogen bij elke release om de oude cache te busten.
 */

const CACHE_VERSION = "wfp-v2";
const SHELL_CACHE   = `${CACHE_VERSION}-shell`;
const API_CACHE     = `${CACHE_VERSION}-api`;

// Bestanden die altijd gecachet moeten zijn (app shell)
const SHELL_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/main.js",
  "/manifest.json",
  "/js/platforms/admin.js",
  "/js/platforms/manager.js",
  "/js/platforms/employee.js",
  "/js/platforms/superadmin.js",
  "/js/platform-router.js"
];

// ── Install ────────────────────────────────────────────────────
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS.map(url => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: verwijder verouderde caches ──────────────────────
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith("wfp-") && !key.startsWith(CACHE_VERSION))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ──────────────────────────────────────────────────────
self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);

  // Sla alles buiten eigen origin over
  if (url.origin !== self.location.origin) return;

  // Mutaties nooit cachen
  if (request.method !== "GET") return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstApi(request, url));
  } else {
    event.respondWith(cacheFirstShell(request));
  }
});

// ── Cache-first (app shell) ────────────────────────────────────
async function cacheFirstShell(request) {
  const cached = await caches.match(request);
  if (cached) {
    // Stale-while-revalidate: refresh op achtergrond
    refreshInBackground(SHELL_CACHE, request);
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Navigatieverzoeken: geef index.html als offline-fallback
    if (request.mode === "navigate") {
      const fallback = await caches.match("/index.html");
      if (fallback) return fallback;
    }
    return new Response("WorkFlow Pro is offline. Controleer je internetverbinding.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  }
}

// ── Network-first (API) ────────────────────────────────────────
// Alleen publieke, niet-gevoelige endpoints worden gecachet.
const CACHEABLE_API_PATHS = ["/api/health", "/api/status", "/api/releases"];

async function networkFirstApi(request, url) {
  try {
    const response = await fetch(request);
    if (response.ok && CACHEABLE_API_PATHS.some(p => url.pathname.startsWith(p))) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ ok: false, offline: true, error: "Offline – geen netwerk beschikbaar" }),
      { status: 503, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
}

function refreshInBackground(cacheName, request) {
  fetch(request).then(response => {
    if (!response.ok) return;
    caches.open(cacheName).then(cache => cache.put(request, response));
  }).catch(() => {});
}

// ── Push-notificaties ──────────────────────────────────────────
self.addEventListener("push", event => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { data = { title: "WorkFlow Pro", body: event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || "WorkFlow Pro", {
      body: data.body || "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: data.tag || "wfp-notification",
      renotify: !!data.renotify,
      data: { url: data.url || "/" }
    })
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(windowClients => {
      const existing = windowClients.find(c => c.url === url && "focus" in c);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
