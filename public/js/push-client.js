"use strict";
/**
 * Web-push client-helper. Vraagt toestemming, abonneert dit toestel met de
 * VAPID-publieke sleutel van de server en registreert het abonnement. De SW
 * (sw.js) toont de melding bij een 'push'-event. Tenant-scope wordt uit het
 * sessietoken afgeleid (zelfde aanpak als de platform-shells).
 */
(function () {
  function token() { return localStorage.getItem("wfp_token") || ""; }
  function tenantId() {
    try { return JSON.parse(atob(token().split(".")[0])).tenantId || ""; } catch (_) { return ""; }
  }
  function api(method, path, body) {
    const tid = tenantId();
    const full = tid ? `/api/tenants/${tid}${path}` : `/api${path}`;
    return fetch(full, {
      method,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "Push-fout"); return d; });
  }

  function supported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function status() {
    if (!supported()) return { supported: false };
    let subscribed = false;
    try { const reg = await navigator.serviceWorker.ready; subscribed = !!(await reg.pushManager.getSubscription()); } catch (_) {}
    return { supported: true, permission: Notification.permission, subscribed };
  }

  // Schakel push in voor dit toestel. Geeft een sprekende fout bij weigering.
  async function enable() {
    if (!supported()) throw new Error("Dit toestel/deze browser ondersteunt geen meldingen.");
    const key = await api("GET", "/me/push/key");
    if (!key.enabled || !key.publicKey) throw new Error("Push is (nog) niet geconfigureerd door de beheerder.");
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Meldingen zijn geweigerd. Sta ze toe in je browserinstellingen.");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key.publicKey),
    });
    await api("POST", "/me/push/subscribe", { subscription: sub.toJSON() });
    return { subscribed: true };
  }

  async function disable() {
    if (!supported()) return { subscribed: false };
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      try { await api("POST", "/me/push/unsubscribe", { endpoint: sub.endpoint }); } catch (_) {}
      await sub.unsubscribe();
    }
    return { subscribed: false };
  }

  window.wfpPush = { supported, status, enable, disable };
})();
