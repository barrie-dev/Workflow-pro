"use strict";
/**
 * Offline-schrijfqueue voor veldwerk (P1). Slaat acties (prikklok in/uit,
 * werkbon afronden) lokaal op in IndexedDB wanneer er geen netwerk is, en speelt
 * ze idempotent af zodra de verbinding terug is · de server dedupliceert op id
 * (mobile/sync → mobileSync.processedIds). Zo verliest een monteur op een werf
 * zonder signaal nooit een actie.
 *
 * Gebruik vanuit een platform-shell:
 *   wfpOfflineQueue.configure({ post: payload => api("POST", "/mobile/sync", payload) });
 *   await wfpOfflineQueue.run(() => api("POST", "/me/clock/in", {}),
 *                             { action: "clock_in", payload: {} });
 * `run` probeert eerst online; faalt dat door netwerk, dan komt de actie in de
 * queue en krijgt de gebruiker "opgeslagen · wordt gesynchroniseerd".
 */
(function () {
  const DB_NAME = "wfp-offline";
  const STORE = "queue";
  let _post = null;        // injectie: stuurt {items:[...]} naar de server
  let _db = null;

  function openDb() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      if (!("indexedDB" in window)) return reject(new Error("no-indexeddb"));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id" }); };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror = () => reject(req.error || new Error("indexeddb-open-failed"));
    });
  }
  function tx(mode) { return openDb().then(db => db.transaction(STORE, mode).objectStore(STORE)); }
  function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

  // localStorage-fallback wanneer IndexedDB ontbreekt (privémodus e.d.).
  const LS_KEY = "wfp_offline_queue";
  function lsRead() { try { return JSON.parse(localStorage.getItem(LS_KEY) || "[]"); } catch (_) { return []; } }
  function lsWrite(items) { try { localStorage.setItem(LS_KEY, JSON.stringify(items)); } catch (_) {} }

  async function allItems() {
    try { const store = await tx("readonly"); return await reqP(store.getAll()); }
    catch (_) { return lsRead(); }
  }
  async function putItem(item) {
    try { const store = await tx("readwrite"); await reqP(store.put(item)); }
    catch (_) { const items = lsRead(); items.push(item); lsWrite(items); }
    emitStatus();
  }
  async function removeIds(ids) {
    const set = new Set(ids);
    try { const store = await tx("readwrite"); for (const id of ids) await reqP(store.delete(id)); }
    catch (_) { lsWrite(lsRead().filter(i => !set.has(i.id))); }
    emitStatus();
  }

  function genId() { return `q_${Date.now()}_${Math.random().toString(16).slice(2)}`; }

  function configure(opts) { if (opts && typeof opts.post === "function") _post = opts.post; }

  async function pending() { return (await allItems()).length; }

  async function enqueue(item) {
    const row = {
      id: item.id || genId(),
      action: item.action,
      workorderId: item.workorderId || null,
      payload: item.payload || {},
      createdAt: new Date().toISOString(),
    };
    await putItem(row);
    return row;
  }

  // Probeer een actie online; bij netwerkfout → queue (offline-veilig). Geeft
  // { online:true } of { online:false, queued:true } terug.
  async function run(onlineFn, queueItem) {
    if (navigator.onLine !== false) {
      try { const res = await onlineFn(); flush().catch(() => {}); return { online: true, result: res }; }
      catch (e) {
        // Alleen bij een echte netwerk-/offline-fout queuen; functionele 4xx-fouten
        // (bv. al ingeklokt) horen NIET in de queue.
        if (!isNetworkError(e)) throw e;
      }
    }
    await enqueue(queueItem);
    return { online: false, queued: true };
  }

  function isNetworkError(e) {
    const m = String((e && e.message) || e || "").toLowerCase();
    return navigator.onLine === false || /failed to fetch|networkerror|load failed|fetch|offline|netwerk/.test(m);
  }

  // Speel de queue af via de geïnjecteerde poster. Verwijdert verwerkte +
  // duplicate items; behoudt items die (tijdelijk) faalden.
  let _flushing = false;
  async function flush() {
    if (_flushing || !_post) return { skipped: true };
    const items = await allItems();
    if (!items.length) return { empty: true };
    if (navigator.onLine === false) return { offline: true };
    _flushing = true;
    try {
      const resp = await _post({ items });
      const results = (resp && (resp.sync ? resp.sync.results : resp.results)) || [];
      const done = results.filter(r => r.ok).map(r => r.id);
      if (done.length) await removeIds(done);
      emitStatus();
      return { flushed: done.length, remaining: (await allItems()).length };
    } catch (_) {
      return { error: true }; // netwerk weg tijdens flush → later opnieuw
    } finally { _flushing = false; }
  }

  function emitStatus() {
    pending().then(n => {
      document.dispatchEvent(new CustomEvent("wfp:offline-queue", { detail: { pending: n, online: navigator.onLine !== false } }));
    });
  }

  // Auto-flush zodra de verbinding terugkomt + bij laden.
  window.addEventListener("online", () => { emitStatus(); flush().catch(() => {}); });
  window.addEventListener("offline", emitStatus);
  document.addEventListener("DOMContentLoaded", () => { emitStatus(); setTimeout(() => flush().catch(() => {}), 1500); });

  window.wfpOfflineQueue = { configure, enqueue, run, flush, pending };
})();
