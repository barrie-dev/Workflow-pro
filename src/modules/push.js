"use strict";
/**
 * Web-push notificaties (P1). Echte browser-pushmeldingen via VAPID + de vetted
 * `web-push` library (RFC 8291-payload-encryptie zelf bouwen is foutgevoelig).
 *
 * - Geconfigureerd zodra VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY env-vars staan; anders
 *   is push uitgeschakeld (client toont dan gewoon geen toestel-opt-in).
 * - Abonnementen leven op de gebruiker (user.pushSubscriptions[]), gededupliceerd op
 *   endpoint. Verlopen abonnementen (404/410) worden automatisch opgeruimd.
 */
const webpush = require("web-push");
const { config } = require("../lib/config");

let _vapidSet = false;
function ensureVapid() {
  if (_vapidSet) return true;
  const { publicKey, privateKey, subject } = config.webpush || {};
  if (!publicKey || !privateKey) return false;
  try { webpush.setVapidDetails(subject || "mailto:support@workflowpro.be", publicKey, privateKey); _vapidSet = true; return true; }
  catch (_) { return false; }
}

function pushConfigured() {
  return !!(config.webpush && config.webpush.publicKey && config.webpush.privateKey);
}
function publicKey() { return (config.webpush && config.webpush.publicKey) || ""; }

// Dedup-merge van een nieuw abonnement in een bestaande lijst (puur, testbaar).
function mergeSubscription(list, sub) {
  const existing = Array.isArray(list) ? list.filter(s => s && s.endpoint !== sub.endpoint) : [];
  return [...existing, { endpoint: sub.endpoint, keys: sub.keys || {}, createdAt: new Date().toISOString() }].slice(-10);
}

function saveSubscription(store, user, sub) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    const e = new Error("Ongeldig push-abonnement");
    e.status = 400;
    throw e;
  }
  const next = mergeSubscription(user.pushSubscriptions, sub);
  store.update("users", user.id, { pushSubscriptions: next });
  return { count: next.length };
}

function removeSubscription(store, user, endpoint) {
  const next = (user.pushSubscriptions || []).filter(s => s.endpoint !== endpoint);
  store.update("users", user.id, { pushSubscriptions: next });
  return { count: next.length };
}

// Verstuur een push naar alle abonnementen van de opgegeven gebruikers. Ruimt
// verlopen abonnementen op. Fire-and-forget; faalt nooit hard.
async function sendPushToUsers(store, users, notification) {
  if (!ensureVapid()) return { sent: 0, configured: false };
  const payload = JSON.stringify({
    title: notification.title || "Monargo One",
    body: notification.body || "",
    url: (config.appUrl || "").replace(/\/+$/, "") || "/",
    tag: notification.sourceRef || notification.id || undefined,
  });
  let sent = 0;
  for (const user of users) {
    const subs = user.pushSubscriptions || [];
    if (!subs.length) continue;
    const stale = [];
    for (const sub of subs) {
      try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload); sent += 1; }
      catch (err) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) stale.push(sub.endpoint);
      }
    }
    if (stale.length) {
      store.update("users", user.id, { pushSubscriptions: subs.filter(s => !stale.includes(s.endpoint)) });
    }
  }
  return { sent, configured: true };
}

module.exports = { pushConfigured, publicKey, saveSubscription, removeSubscription, sendPushToUsers, mergeSubscription };
