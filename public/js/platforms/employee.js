/* ============================================================
   Monargo One – Employee Platform  (mobiel-first)
   public/js/platforms/employee.js
   ============================================================ */
(function () {
  "use strict";

  let _currentView = "today";
  let _clockActive = null;
  let _empPlanningWeekOffset = 0;

  // ── API ────────────────────────────────────────────────────
  // Gedeelde kern (token/tenantId/esc/fetch+401) → public/js/core.js
  const token = () => window.wfpCore.token();
  const tenantId = () => window.wfpCore.tenantId();
  const esc = v => window.wfpCore.esc(v);

  function api(method, path, body) {
    const tid = tenantId();
    const skipPrefix = !tid || path.startsWith("/tenants/") || path.startsWith("/auth/");
    const fullPath = skipPrefix ? path : `/tenants/${tid}${path}`;
    return window.wfpCore.request("/api" + fullPath, { method, body: body ? JSON.stringify(body) : undefined });
  }

  // ── Offline-veilige prikklok (veldwerk zonder signaal) ──────
  // Configureer de offline-queue met een poster naar de tenant-sync-endpoint.
  if (window.wfpOfflineQueue) {
    window.wfpOfflineQueue.configure({ post: payload => api("POST", "/mobile/sync", payload) });
  }
  // Probeer online in/uit te klokken; bij netwerkverlies komt de actie in de
  // IndexedDB-queue en wordt ze later idempotent gesynchroniseerd.
  // Best-effort GPS-positie voor locatie-geverifieerd inklokken ("coördinaten
  // tegen valsspelen"). Faalt stil → inklokken blijft mogelijk zonder geo.
  function currentPosition() {
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: new Date().toISOString() }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    });
  }

  async function clockAction(dir) {
    const path = dir === "in" ? "/me/clock/in" : "/me/clock/out";
    const action = dir === "in" ? "clock_in" : "clock_out";
    const payload = dir === "in" ? { geo: await currentPosition() } : {};
    if (window.wfpOfflineQueue) {
      const r = await window.wfpOfflineQueue.run(() => api("POST", path, payload), { action, payload });
      if (r.queued) {
        window.showToast && window.showToast(`${dir === "in" ? "Inklokken" : "Uitklokken"} offline opgeslagen — wordt gesynchroniseerd zodra je verbinding hebt.`, "info");
        return;
      }
    } else {
      await api("POST", path, payload);
    }
    window.showToast && window.showToast(dir === "in" ? "Ingeklokt ✓" : "Uitgeklokt ✓", "success");
  }

  // Toon een discrete badge zolang er offline acties wachten op synchronisatie.
  document.addEventListener("wfp:offline-queue", e => {
    const n = (e.detail && e.detail.pending) || 0;
    let bar = document.getElementById("empOfflineBar");
    if (!n) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "empOfflineBar";
      bar.style.cssText = "position:fixed;left:0;right:0;bottom:64px;z-index:50;margin:0 12px;padding:8px 12px;border-radius:10px;background:#fef3c7;color:#92400e;font-size:12.5px;font-weight:600;box-shadow:0 2px 10px rgba(0,0,0,.12);text-align:center";
      document.body.appendChild(bar);
    }
    const online = e.detail && e.detail.online;
    bar.textContent = online
      ? `⏳ ${n} actie(s) worden gesynchroniseerd…`
      : `📴 Offline — ${n} actie(s) bewaard, sync zodra je verbinding hebt`;
  });

  // Verberg tabs voor modules die niet in het pakket van de tenant zitten.
  function applyEntitlements() {
    fetch("/api/me", { headers: { Authorization: "Bearer " + token() } })
      .then(r => r.json())
      .then(d => {
        if (d && d.terminology && window.wfpTerms) window.wfpTerms.set(d.terminology);
        if (d && d.supportSession && d.supportSession.active) renderSupportBanner(d.supportSession);
        const ent = d && d.entitlements;
        window._wfpEnt = ent || null; // stash voor sectie-gating in 'Meer'
        if (!ent || ent.views === "*") return;
        const allowed = new Set(ent.views || []);
        const alias = { clock: "clocking" };          // tab-naam → catalogus-view
        const alwaysShow = new Set(["today", "more"]); // persoonlijke kern-tabs
        document.querySelectorAll(".emp-tab[data-view]").forEach(a => {
          const v = a.getAttribute("data-view");
          const cv = alias[v] || v;
          if (!alwaysShow.has(v) && !allowed.has(cv)) a.style.display = "none";
        });
      })
      .catch(() => {});
  }

  // GDPR-transparantie: toon een vaste banner tijdens een support-sessie.
  function renderSupportBanner(s) {
    if (document.getElementById("wfpSupportBanner")) return;
    const scope = s.scope === "write" ? "lezen + schrijven" : "alleen-lezen";
    const b = document.createElement("div");
    b.id = "wfpSupportBanner";
    b.setAttribute("role", "status");
    b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#b91c1c;color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:6px 16px;display:flex;align-items:center;justify-content:center;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,.2)";
    const span = document.createElement("span");
    span.textContent = `🛟 Support-sessie actief — ${s.agent || "supportmedewerker"} (${scope}). Deze sessie wordt geaudit.`;
    b.appendChild(span);
    const exit = document.createElement("button");
    exit.textContent = "Sessie verlaten";
    exit.style.cssText = "background:#fff;color:#b91c1c;border:none;border-radius:6px;font:600 12px system-ui,sans-serif;padding:5px 12px;cursor:pointer;flex-shrink:0";
    exit.onclick = () => window.WorkFlowProPlatformRouter && window.WorkFlowProPlatformRouter.exitSupportSession();
    b.appendChild(exit);
    document.body.appendChild(b);
    document.body.style.paddingTop = "38px";
  }

  // Is een module-view actief voor deze tenant? (super_admin/onbekend → ja)
  function viewEnabled(view) {
    const e = window._wfpEnt;
    if (!e || e.views === "*") return true;
    return (e.views || []).includes(view);
  }

  // ── Shell ──────────────────────────────────────────────────
  function buildShell() {
    const el = document.getElementById("platform-employee");
    if (!el) return;

    el.innerHTML = `
<div class="emp-layout">

  <!-- Top header -->
  <header class="emp-header">
    <div class="emp-header-left">
      <div class="emp-logo-mark">M</div>
      <div>
        <div class="emp-header-greeting" id="empGreeting">Goedemorgen</div>
        <div class="emp-header-name" id="empHeaderName">Medewerker</div>
      </div>
    </div>
    <div class="emp-header-right">
      <button class="emp-icon-btn" id="empMsgBtn" title="Berichten">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
        <span class="emp-notif-dot hidden" id="empMsgDot"></span>
      </button>
      <div style="position:relative">
        <button class="emp-icon-btn" id="empBellBtn" title="Notificaties">
          <svg viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
          <span class="emp-notif-dot hidden" id="empBellDot"></span>
        </button>
        <div id="empNotifPanel" style="position:fixed;top:64px;right:12px;width:320px;background:#fff;border-radius:14px;border:1px solid #e2e8f0;box-shadow:0 8px 32px rgba(0,0,0,.15);z-index:999;display:none">
          <div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:8px">
            <span style="font-size:13px;font-weight:700;color:#0f172a;flex:1">Mijn notificaties</span>
            <button id="empNotifMarkAll" style="background:none;border:none;cursor:pointer;font-size:11px;color:#38bdf8;font-weight:600;padding:3px 6px;border-radius:6px">Alles gelezen</button>
          </div>
          <div id="empNotifList" style="max-height:320px;overflow-y:auto"><div style="padding:28px;text-align:center;font-size:13px;color:#94a3b8">Laden…</div></div>
        </div>
      </div>
      <button class="emp-icon-btn" id="empLogoutBtn" title="Uitloggen">
        <svg viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
      </button>
    </div>
  </header>

  <!-- Main content area -->
  <main class="emp-main" id="empMain">
    <div class="emp-loading">Laden…</div>
  </main>

  <!-- Bottom tab bar -->
  <nav class="emp-tabbar" aria-label="Hoofdnavigatie">
    <button class="emp-tab active" data-view="today">
      <svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>
      <span>Vandaag</span>
    </button>
    <button class="emp-tab" data-view="planning">
      <svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/></svg>
      <span>Planning</span>
    </button>
    <button class="emp-tab emp-tab-clock" data-view="clock">
      <svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>
      <span>Prikklok</span>
    </button>
    <button class="emp-tab" data-view="leaves">
      <svg viewBox="0 0 24 24"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>
      <span>Verlof</span>
    </button>
    <button class="emp-tab" data-view="more">
      <svg viewBox="0 0 24 24"><path d="M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
      <span>Meer</span>
    </button>
  </nav>
</div>

<!-- Leave request sheet -->
<div class="emp-sheet-overlay hidden" id="empSheetOverlay"></div>
<div class="emp-sheet hidden" id="empLeaveSheet">
  <div class="emp-sheet-handle"></div>
  <div class="emp-sheet-header">
    <h2>Verlof aanvragen</h2>
    <button class="emp-sheet-close" id="empLeaveSheetClose">&times;</button>
  </div>
  <div class="emp-sheet-body">
    <form id="empLeaveForm">
      <div class="emp-form-group">
        <label>Type verlof</label>
        <select name="type" required>
          <option value="">Kies type…</option>
          <option value="vakantie">Vakantie</option>
          <option value="ziekte">Ziekte</option>
          <option value="overmacht">Overmacht</option>
          <option value="educatie">Educatief verlof</option>
          <option value="onbetaald">Onbetaald verlof</option>
        </select>
      </div>
      <div class="emp-form-row">
        <div class="emp-form-group"><label>Van</label><input type="date" name="startDate" required></div>
        <div class="emp-form-group"><label>Tot</label><input type="date" name="endDate" required></div>
      </div>
      <div class="emp-form-group">
        <label>Reden (optioneel)</label>
        <textarea name="reason" rows="3" placeholder="Toelichting…"></textarea>
      </div>
      <button type="submit" class="emp-btn emp-btn-primary emp-btn-full">Indienen</button>
    </form>
  </div>
</div>

<!-- Expense sheet -->
<div class="emp-sheet hidden" id="empExpSheet">
  <div class="emp-sheet-handle"></div>
  <div class="emp-sheet-header">
    <h2>Onkosten indienen</h2>
    <button class="emp-sheet-close" id="empExpSheetClose">&times;</button>
  </div>
  <div class="emp-sheet-body">
    <form id="empExpForm">
      <div class="emp-form-group">
        <label>Categorie</label>
        <select name="category" required>
          <option value="">Kies categorie…</option>
          <option value="transport">Transport</option>
          <option value="maaltijd">Maaltijd</option>
          <option value="materiaal">Materiaal</option>
          <option value="telefoon">Telefoon/Internet</option>
          <option value="hotel">Hotel/Verblijf</option>
          <option value="overig">Overig</option>
        </select>
      </div>
      <div class="emp-form-group"><label>Datum</label><input type="date" name="date" required></div>
      <div class="emp-form-group"><label>Bedrag (€)</label><input type="number" name="amount" step="0.01" min="0" required placeholder="0.00"></div>
      <div class="emp-form-group"><label>Omschrijving</label><input name="description" required placeholder="Waarvoor?"></div>
      <button type="submit" class="emp-btn emp-btn-primary emp-btn-full">Indienen</button>
    </form>
  </div>
</div>

<style>
/* ── Base ───────────────────────────────────── */
#platform-employee {
  font-family: 'Inter', system-ui, sans-serif;
  height: 100vh;
  background: #f1f5f9;
  overflow: hidden;
}
.emp-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  max-width: 480px;
  margin: 0 auto;
  background: #f1f5f9;
  position: relative;
}

/* ── Header ─────────────────────────────────── */
.emp-header {
  background: rgba(255,255,255,.85);
  backdrop-filter: saturate(180%) blur(20px);
  color: var(--ink);
  border-bottom: 1px solid var(--line);
  padding: 16px 16px 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}
.emp-header-left { display: flex; align-items: center; gap: 12px; }
.emp-logo-mark {
  background: var(--wf-blue);
  color: #fff;
  width: 36px; height: 36px;
  border-radius: 11px;
  display: grid; place-items: center;
  font-weight: 600; font-size: 13px;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(0,113,227,.30);
}
.emp-header-greeting { font-size: 11px; color: var(--muted); }
.emp-header-name { font-size: 17px; font-weight: 600; color: var(--ink); letter-spacing: -.3px; }
.emp-header-right { display: flex; gap: 6px; }
.emp-icon-btn {
  background: var(--gray-100);
  border: none;
  color: var(--gray-600);
  width: 36px; height: 36px;
  border-radius: 10px;
  display: grid; place-items: center;
  cursor: pointer;
  position: relative;
}
.emp-icon-btn svg { width: 18px; height: 18px; fill: currentColor; }
.emp-icon-btn:hover { background: var(--gray-200); }
.emp-notif-dot {
  position: absolute;
  top: 6px; right: 6px;
  width: 8px; height: 8px;
  background: var(--wf-red);
  border-radius: 50%;
  border: 2px solid var(--surface);
}

/* ── Main ───────────────────────────────────── */
.emp-main {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  padding-bottom: 80px;
}
.emp-loading { text-align: center; color: #94a3b8; padding: 40px; }
@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(1.4)} }

/* ── Tab bar ────────────────────────────────── */
.emp-tabbar {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 480px;
  background: #fff;
  border-top: 1px solid #e2e8f0;
  display: flex;
  padding: 6px 0 env(safe-area-inset-bottom, 6px);
  z-index: 50;
}
.emp-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  background: none;
  border: none;
  color: #94a3b8;
  font-size: 10px;
  padding: 4px 0;
  cursor: pointer;
  transition: color .15s;
}
.emp-tab svg { width: 20px; height: 20px; fill: currentColor; }
.emp-tab.active { color: var(--wf-blue); }
.emp-tab-clock { color: var(--wf-blue); }
.emp-tab-clock.clocked-in { color: #10b981; }

/* ── Cards ──────────────────────────────────── */
.emp-card {
  background: var(--surface);
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 14px;
  border: 1px solid var(--line);
}
.emp-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  margin: 0 0 10px;
}

/* ── Clock widget ───────────────────────────── */
.emp-clock-widget { text-align: center; padding: 28px 20px 22px; }
.emp-clock-ring { position: relative; width: 232px; height: 232px; margin: 0 auto 22px; }
.emp-clock-ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
.emp-clock-ring .track { fill: none; stroke: var(--gray-100); stroke-width: 9; }
.emp-clock-ring .prog { fill: none; stroke: var(--wf-blue); stroke-width: 9; stroke-linecap: round;
  transition: stroke-dashoffset .7s ease, stroke .3s; }
.emp-clock-ring.on .prog { stroke: var(--wf-green); }
.emp-clock-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.emp-clock-time {
  font-size: 42px; font-weight: 600; color: var(--ink);
  letter-spacing: -1.5px; font-variant-numeric: tabular-nums; line-height: 1;
}
.emp-clock-date { font-size: 12.5px; color: var(--muted); margin-top: 8px; text-transform: capitalize; }
.emp-clock-chip {
  display: inline-flex; align-items: center; gap: 6px; margin-top: 11px;
  font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 980px;
}
.emp-clock-chip.on { background: var(--wf-green-l); color: #0a7a3f; }
.emp-clock-chip.off { background: var(--gray-100); color: var(--muted); }
.emp-clock-chip .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.emp-clock-chip.on .dot { animation: empPulse 1.6s ease-in-out infinite; }
@keyframes empPulse { 0%,100% { opacity: 1; } 50% { opacity: .3; } }
.emp-clock-btn {
  width: 100%; max-width: 300px; height: 56px; border-radius: 980px; border: none;
  font-size: 16px; font-weight: 600; cursor: pointer; margin: 0 auto;
  display: inline-flex; align-items: center; justify-content: center; gap: 9px;
  transition: transform .1s, box-shadow .2s, background .2s;
}
.emp-clock-btn svg { width: 22px; height: 22px; fill: currentColor; }
.emp-clock-btn:active { transform: scale(.97); }
.emp-clock-btn-in  { background: var(--wf-blue); color: #fff; box-shadow: 0 8px 24px rgba(0,113,227,.32); }
.emp-clock-btn-out { background: var(--wf-red);  color: #fff; box-shadow: 0 8px 24px rgba(220,38,38,.28); }
.emp-clock-stats { display: flex; gap: 10px; margin-top: 22px; }
.emp-clock-stat { flex: 1; background: var(--gray-50); border: 1px solid var(--line); border-radius: 14px; padding: 12px; }
.emp-clock-stat-val { font-size: 20px; font-weight: 600; color: var(--ink); letter-spacing: -.5px; font-variant-numeric: tabular-nums; }
.emp-clock-stat-lbl { font-size: 11px; color: var(--muted); margin-top: 2px; }

/* ── Shift item ─────────────────────────────── */
.emp-shift-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid #f1f5f9;
}
.emp-shift-item:last-child { border-bottom: none; }
.emp-shift-time {
  background: #e0f2fe;
  color: var(--wf-blue-d);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  font-weight: 600;
  min-width: 80px;
  text-align: center;
}
.emp-shift-info { flex: 1; }
.emp-shift-title { font-size: 13px; font-weight: 500; color: #0f172a; }
.emp-shift-sub { font-size: 11px; color: #94a3b8; }

/* ── Status pill ────────────────────────────── */
.emp-pill {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
}
.emp-pill-green { background: #d1fae5; color: #059669; }
.emp-pill-amber { background: #fef3c7; color: #d97706; }
.emp-pill-red { background: #fee2e2; color: #dc2626; }
.emp-pill-blue { background: #dbeafe; color: var(--wf-blue); }
.emp-pill-gray { background: #f1f5f9; color: #64748b; }

/* ── Action row ─────────────────────────────── */
.emp-action-row { display: flex; gap: 10px; margin-bottom: 12px; }
.emp-action-btn {
  flex: 1;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  color: #374151;
  text-align: center;
}
.emp-action-btn svg { width: 22px; height: 22px; fill: currentColor; color: var(--wf-blue); }
.emp-action-btn:hover { background: #f8fafc; border-color: var(--wf-blue); }
.emp-action-btn-danger { border-color: #fca5a5; background: #fef2f2; color: #dc2626; }
.emp-action-btn-danger svg { color: #ef4444; }
.emp-action-btn-danger:hover { background: #fee2e2; border-color: #f87171; }

/* ── List item ──────────────────────────────── */
.emp-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid #f1f5f9;
}
.emp-list-item:last-child { border-bottom: none; }
.emp-list-icon {
  width: 36px; height: 36px;
  border-radius: 10px;
  background: #e0f2fe;
  display: grid; place-items: center;
  flex-shrink: 0;
}
.emp-list-icon svg { width: 18px; height: 18px; fill: var(--wf-blue-d); }
.emp-list-info { flex: 1; min-width: 0; }
.emp-list-title { font-size: 13px; font-weight: 500; color: #0f172a; }
.emp-list-sub { font-size: 11px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── Buttons ────────────────────────────────── */
.emp-btn {
  padding: 10px 18px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: none;
}
.emp-btn-primary { background: var(--wf-blue); color: #fff; }
.emp-btn-primary:hover { background: var(--wf-blue-d); }
.emp-btn-outline { background: transparent; color: var(--wf-blue); border: 1.5px solid var(--wf-blue); }
.emp-btn-full { width: 100%; margin-top: 8px; }
.emp-btn-sm { padding: 6px 12px; font-size: 12px; border-radius: 8px; }

/* ── Form ───────────────────────────────────── */
.emp-form-group { margin-bottom: 14px; }
.emp-form-group label { display: block; font-size: 12px; font-weight: 500; color: #374151; margin-bottom: 5px; }
.emp-form-group input, .emp-form-group select, .emp-form-group textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 10px;
  font-size: 14px;
  box-sizing: border-box;
}
.emp-form-group input:focus, .emp-form-group select:focus, .emp-form-group textarea:focus {
  outline: none;
  border-color: var(--wf-blue);
  box-shadow: 0 0 0 3px rgba(14,165,233,.15);
}
.emp-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

/* ── Sheet (bottom drawer) ──────────────────── */
.emp-sheet-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.4);
  z-index: 100;
}
.emp-sheet {
  position: fixed;
  bottom: 0; left: 50%;
  transform: translateX(-50%);
  width: 100%; max-width: 480px;
  background: #fff;
  border-radius: 20px 20px 0 0;
  z-index: 101;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  transition: transform .3s;
}
.emp-sheet.hidden { transform: translateX(-50%) translateY(100%); }
.emp-sheet-handle {
  width: 36px; height: 4px;
  background: #e2e8f0;
  border-radius: 2px;
  margin: 12px auto 0;
  flex-shrink: 0;
}
.emp-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #f1f5f9;
  flex-shrink: 0;
}
.emp-sheet-header h2 { font-size: 16px; font-weight: 600; margin: 0; }
.emp-sheet-close { background: none; border: none; font-size: 22px; cursor: pointer; color: #94a3b8; }
.emp-sheet-body { flex: 1; overflow-y: auto; padding: 16px; }

/* ── Empty ──────────────────────────────────── */
.emp-empty { text-align: center; padding: 32px 0; color: #94a3b8; }
.emp-empty-icon { font-size: 32px; margin-bottom: 6px; }
.emp-empty-text { font-size: 13px; }

/* ── Calendar week ──────────────────────────── */
.emp-week-nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.emp-week-nav button { background: #f1f5f9; border: none; border-radius: 8px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
.emp-week-label { font-size: 13px; font-weight: 600; color: #0f172a; }
.emp-day-strip { display: flex; gap: 6px; margin-bottom: 12px; overflow-x: auto; padding-bottom: 4px; }
.emp-day-pill {
  flex-shrink: 0;
  display: flex; flex-direction: column; align-items: center;
  padding: 8px 10px; border-radius: 10px;
  font-size: 11px; color: #64748b; cursor: pointer;
  min-width: 44px;
  border: 1.5px solid transparent;
}
.emp-day-pill.today { border-color: var(--wf-blue); color: var(--wf-blue); }
.emp-day-pill.has-shift { background: var(--wf-blue); color: #fff; }
.emp-day-num { font-size: 16px; font-weight: 700; line-height: 1.2; }

/* ── Breed scherm: medewerker op pc krijgt een echte pc-view ──
   Mobiel-first blijft de basis; vanaf 860px verbreedt de layout en
   verhuist de bottom-tabbar naar een boven-navbalk met labels. */
@media (min-width: 860px) {
  .emp-layout { max-width: 960px; box-shadow: 0 0 0 1px #e2e8f0; }
  .emp-header { padding: 18px 28px 22px; border-radius: 0; }
  /* Tabbar van onder naar boven (tussen header en inhoud) */
  .emp-tabbar {
    order: 1;
    position: static;
    transform: none;
    left: auto; bottom: auto;
    width: auto; max-width: none;
    border-top: none;
    border-bottom: 1px solid #e2e8f0;
    padding: 8px 20px;
    gap: 6px;
  }
  .emp-main { order: 2; padding: 28px 32px; padding-bottom: 32px; }
  .emp-tab {
    flex: 0 0 auto;
    flex-direction: row;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    padding: 9px 16px;
    border-radius: 10px;
  }
  .emp-tab svg { width: 18px; height: 18px; }
  .emp-tab:hover { background: #f1f5f9; color: #475569; }
  .emp-tab.active { background: #e0f2fe; color: #0369a1; }
  /* Inhoud mag de breedte benutten: kaarten in twee kolommen */
  .emp-cards-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
}
</style>`;

    // tab nav
    el.querySelectorAll(".emp-tab[data-view]").forEach(btn => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });

    // logout
    document.getElementById("empLogoutBtn")?.addEventListener("click", () => {
      localStorage.removeItem("wfp_token");
      location.reload();
    });

    // msg btn
    document.getElementById("empMsgBtn")?.addEventListener("click", () => switchView("messages"));

    // ── Notification bell ──────────────────────────────────────
    (function() {
      const bellBtn   = document.getElementById("empBellBtn");
      const bellDot   = document.getElementById("empBellDot");
      const panel     = document.getElementById("empNotifPanel");
      const list      = document.getElementById("empNotifList");
      let _notifs     = [];

      function fmtTime(iso) {
        if (!iso) return "";
        const d = new Date(iso), now = new Date();
        const diff = Math.floor((now - d) / 60000);
        if (diff < 1) return "Zonet";
        if (diff < 60) return `${diff}m geleden`;
        if (diff < 1440) return `${Math.floor(diff/60)}u geleden`;
        return d.toLocaleDateString("nl-BE");
      }

      function renderList() {
        if (!_notifs.length) {
          list.innerHTML = `<div style="padding:28px;text-align:center;font-size:13px;color:#94a3b8">Geen notificaties</div>`;
          return;
        }
        list.innerHTML = _notifs.slice(0, 20).map(n => {
          const unread = n.status !== "read";
          return `<div class="emp-notif-row" data-nid="${esc(n.id)}" style="padding:10px 16px;border-bottom:1px solid #f8fafc;cursor:pointer;display:flex;gap:10px;background:${unread?"#f0f9ff":"#fff"}">
            <div style="width:7px;height:7px;border-radius:50%;background:${unread?"#38bdf8":"#cbd5e1"};margin-top:5px;flex-shrink:0"></div>
            <div style="flex:1">
              <div style="font-size:12.5px;color:#0f172a;font-weight:${unread?600:400}">${esc(n.title||"Notificatie")}</div>
              ${n.body ? `<div style="font-size:11.5px;color:#64748b;margin-top:2px">${esc(n.body)}</div>` : ""}
              <div style="font-size:10.5px;color:#94a3b8;margin-top:2px">${fmtTime(n.createdAt)}</div>
            </div>
          </div>`;
        }).join("");
        list.querySelectorAll(".emp-notif-row").forEach(row => {
          row.addEventListener("click", async () => {
            const nid = row.dataset.nid;
            const n = _notifs.find(x => x.id === nid);
            if (!n || n.status === "read") return;
            n.status = "read";
            row.style.background = "#fff";
            row.querySelector("div").style.background = "#cbd5e1";
            row.querySelector("div + div > div").style.fontWeight = 400;
            try { await api("POST", `/me/notifications/${nid}/read`, {}); } catch(_){}
            updateDot();
          });
        });
      }

      function updateDot() {
        const unread = _notifs.filter(n => n.status !== "read").length;
        if (bellDot) {
          bellDot.classList.toggle("hidden", unread === 0);
          if (unread > 0 && unread <= 9) bellDot.style.setProperty("--count", unread);
        }
      }

      async function loadNotifs() {
        if (document.getElementById("platform-employee")?.classList.contains("hidden")) return;
        try {
          const d = await api("GET", "/me/notifications");
          _notifs = d.rows || [];
          updateDot();
          if (panel.style.display !== "none") renderList();
        } catch(_){}
      }

      bellBtn?.addEventListener("click", async e => {
        e.stopPropagation();
        const isOpen = panel.style.display === "block";
        panel.style.display = isOpen ? "none" : "block";
        if (!isOpen) {
          list.innerHTML = `<div style="padding:28px;text-align:center;font-size:13px;color:#94a3b8">Laden…</div>`;
          await loadNotifs();
          renderList();
        }
      });

      document.addEventListener("click", e => {
        if (!bellBtn?.contains(e.target) && !panel?.contains(e.target)) {
          if (panel) panel.style.display = "none";
        }
      });

      document.getElementById("empNotifMarkAll")?.addEventListener("click", async () => {
        const unread = _notifs.filter(n => n.status !== "read");
        await Promise.all(unread.map(n => api("POST", `/me/notifications/${n.id}/read`, {}).catch(()=>{})));
        _notifs.forEach(n => n.status = "read");
        updateDot();
        renderList();
      });

      // Laad bij start en poll elke 30 seconden
      loadNotifs();
      setInterval(loadNotifs, 30000);
    })();

    // sheet overlays
    document.getElementById("empSheetOverlay")?.addEventListener("click", closeSheets);
    document.getElementById("empLeaveSheetClose")?.addEventListener("click", closeSheets);
    document.getElementById("empExpSheetClose")?.addEventListener("click", closeSheets);

    // leave form
    document.getElementById("empLeaveForm")?.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = e.target.querySelector("[type=submit]");
      btn.disabled = true; btn.textContent = "Indienen…";
      try {
        const fd = new FormData(e.target);
        const result = await api("POST", "/me/leaves", Object.fromEntries(fd));
        const days = result.leave?.days || result.row?.days || "";
        closeSheets();
        window.showToast && window.showToast(`Verlofaanvraag ingediend ✓${days?" ("+days+" dag"+(days!==1?"en":"")+")":" "}`, "success");
        switchView("leaves");
      } catch(err) {
        btn.disabled = false; btn.textContent = "Indienen";
        window.showToast && window.showToast(err.message || "Fout bij indienen", "error");
      }
    });

    // expense form
    document.getElementById("empExpForm")?.addEventListener("submit", async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await api("POST", "/me/expenses", Object.fromEntries(fd));
      closeSheets();
      window.showToast && window.showToast("Onkosten ingediend ✓", "success");
      switchView("expenses");
    });
  }

  // ── Navigation ─────────────────────────────────────────────
  function switchView(view) {
    _currentView = view;
    document.querySelectorAll(".emp-tab").forEach(b => {
      const isActive = b.dataset.view === view;
      b.classList.toggle("active", isActive);
      if (isActive) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    const main = document.getElementById("empMain");
    main.innerHTML = `<div class="emp-loading">Laden…</div>`;

    const renders = {
      today: renderToday,
      planning: renderPlanning,
      clock: renderClock,
      leaves: renderLeaves,
      more: renderMore,
      expenses: renderExpenses,
      workorders: renderWorkorders,
      messages: renderMessages,
      timesheet: renderTimesheet
    };
    if (renders[view]) renders[view]();
  }

  // ── Today ──────────────────────────────────────────────────
  async function renderToday() {
    const [dash, balData, notifData] = await Promise.all([
      api("GET", "/me/dashboard"),
      api("GET", "/me/leaves/balance").catch(() => null),
      api("GET", "/me/notifications").catch(() => null)
    ]);
    const today = new Date();
    const dateStr = today.toLocaleDateString("nl-BE", { weekday: "long", day: "numeric", month: "long" });

    _clockActive = dash.clockedIn;
    updateClockTab();

    const main = document.getElementById("empMain");
    main.innerHTML = `
<div class="emp-card">
  <p class="emp-card-title">Vandaag</p>
  <div style="font-size:14px;color:#64748b;margin-bottom:12px;">${dateStr}</div>

  ${dash.clockedIn ? `
  <div style="display:flex;align-items:center;gap:8px;background:#d1fae5;border-radius:10px;padding:10px 12px;">
    <span style="width:8px;height:8px;background:#10b981;border-radius:50%;flex-shrink:0;animation:pulse 2s infinite;"></span>
    <div style="flex:1;">
      <div style="font-size:13px;font-weight:600;color:#065f46;">Je bent ingeklokt</div>
      <div style="font-size:11px;color:#059669;">Sinds ${dash.activeClock?.clockedIn ? new Date(dash.activeClock.clockedIn).toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit"}) : "—"}</div>
    </div>
    <div id="empClockDuration" style="font-size:18px;font-weight:700;color:#065f46;font-family:monospace;"></div>
  </div>` : `
  <div style="display:flex;align-items:center;gap:8px;background:#f1f5f9;border-radius:10px;padding:10px 12px;">
    <span style="width:8px;height:8px;background:#94a3b8;border-radius:50%;flex-shrink:0;"></span>
    <div style="font-size:13px;color:#64748b;">Nog niet ingeklokt</div>
  </div>`}

  ${dash.todayShifts?.length ? `
  <div style="margin-top:14px;">
    <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Mijn shifts vandaag</div>
    ${dash.todayShifts.map(s => `
    <div class="emp-shift-item">
      <div class="emp-shift-time">${s.start||""}${s.end?`–${s.end}`:""}</div>
      <div class="emp-shift-info">
        <div class="emp-shift-title">${s.location||s.title||"Shift"}</div>
        <div class="emp-shift-sub">${esc(s.notes||"")}</div>
      </div>
    </div>`).join("")}
  </div>` : ""}
</div>

<div class="emp-action-row">
  <button class="emp-action-btn ${dash.clockedIn?"emp-action-btn-danger":""}" id="empActClock">
    <svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>
    ${dash.clockedIn ? "Uitkloppen" : "Inkloppen"}
  </button>
  <button class="emp-action-btn" id="empActWO">
    <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
    ${(window.wfpTerms && window.wfpTerms.t("jobPlural")) || "Werkbonnen"}${dash.openWorkorders > 0 ? ` (${dash.openWorkorders})` : ""}
  </button>
  <button class="emp-action-btn" id="empActLeave">
    <svg viewBox="0 0 24 24"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>
    Verlof
  </button>
  <button class="emp-action-btn" id="empActExp">
    <svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>
    Onkosten
  </button>
</div>

${dash.urgentWorkorders > 0 ? `
<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px;cursor:pointer;" id="empUrgentWO">
  <span style="font-size:20px;">🔴</span>
  <div style="flex:1">
    <div style="font-size:13px;font-weight:700;color:#dc2626;">${dash.urgentWorkorders} urgente werkbon${dash.urgentWorkorders > 1 ? "nen" : ""}</div>
    <div style="font-size:12px;color:#ef4444;">Hoge prioriteit — actie vereist</div>
  </div>
  <svg viewBox="0 0 24 24" style="width:16px;fill:#dc2626;flex-shrink:0"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
</div>` : ""}

<div class="emp-card">
  <p class="emp-card-title">Mijn overzicht</p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
    <div style="background:${dash.openWorkorders>0?"#eff6ff":"#f8fafc"};border-radius:10px;padding:12px;text-align:center;cursor:pointer;" id="empKpiWO">
      <div style="font-size:22px;font-weight:700;color:${dash.openWorkorders>0?"#1d4ed8":"#0f172a"};">${dash.openWorkorders ?? 0}</div>
      <div style="font-size:11px;color:#94a3b8;">Open werkbonnen</div>
    </div>
    <div style="background:${dash.unreadMessages>0?"#fef3c7":"#f8fafc"};border-radius:10px;padding:12px;text-align:center;cursor:pointer;" id="empKpiMsg">
      <div style="font-size:22px;font-weight:700;color:${dash.unreadMessages>0?"#92400e":"#0f172a"};">${dash.unreadMessages ?? 0}</div>
      <div style="font-size:11px;color:#94a3b8;">Ongelezen berichten</div>
    </div>
    <div style="background:#f8fafc;border-radius:10px;padding:12px;text-align:center;cursor:pointer;" id="empKpiLeave">
      <div style="font-size:22px;font-weight:700;color:#0f172a;">${dash.pendingLeaves ?? 0}</div>
      <div style="font-size:11px;color:#94a3b8;">Verlof aangevraagd</div>
    </div>
    <div style="background:#f8fafc;border-radius:10px;padding:12px;text-align:center;cursor:pointer;" id="empKpiExp">
      <div style="font-size:22px;font-weight:700;color:#0f172a;">${dash.pendingExpenses ?? 0}</div>
      <div style="font-size:11px;color:#94a3b8;">Onkosten in behandeling</div>
    </div>
  </div>
</div>

${balData ? (() => {
  const pct = balData.quota > 0 ? Math.round((balData.remaining / balData.quota) * 100) : 0;
  const color = pct > 50 ? "#10b981" : pct > 20 ? "#f59e0b" : "#ef4444";
  return `<div class="emp-card" style="cursor:pointer;" id="empLeaveBalCard">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <p class="emp-card-title" style="margin:0">Verlofkrediet ${new Date().getFullYear()}</p>
    <span style="font-size:12px;color:${color};font-weight:700;">${balData.remaining} van ${balData.quota} dagen resterend</span>
  </div>
  <div style="background:#f1f5f9;border-radius:6px;height:10px;overflow:hidden;">
    <div style="width:${pct}%;background:${color};height:100%;border-radius:6px;transition:width .5s;"></div>
  </div>
  <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:11px;color:#94a3b8;">
    <span>${balData.used ?? 0} opgenomen</span>
    <span>${balData.remaining} beschikbaar</span>
  </div>
</div>`;
})() : ""}

${(() => {
  const unread = (notifData?.rows || []).filter(n => n.status !== "read").slice(0, 3);
  if (!unread.length) return "";
  const fmtT = iso => { if (!iso) return ""; const diff = Math.floor((Date.now()-new Date(iso))/60000); if (diff<60) return `${diff}m`; if (diff<1440) return `${Math.floor(diff/60)}u`; return new Date(iso).toLocaleDateString("nl-BE"); };
  return `<div class="emp-card">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
    <p class="emp-card-title" style="margin:0">Ongelezen meldingen</p>
    <span style="font-size:11px;color:#38bdf8;font-weight:600;">${unread.length}</span>
  </div>
  ${unread.map(n => `
  <div style="display:flex;gap:8px;padding:7px 0;border-bottom:1px solid #f8fafc;">
    <div style="width:7px;height:7px;border-radius:50%;background:#38bdf8;margin-top:5px;flex-shrink:0;"></div>
    <div style="flex:1;">
      <div style="font-size:12.5px;font-weight:600;color:#0f172a;">${esc(n.title||"Melding")}</div>
      ${n.body?`<div style="font-size:11.5px;color:#64748b;">${esc(n.body)}</div>`:""}
    </div>
    <div style="font-size:10.5px;color:#94a3b8;flex-shrink:0;">${fmtT(n.createdAt)}</div>
  </div>`).join("")}
</div>`;
})()}`;

    document.getElementById("empActClock")?.addEventListener("click", async () => {
      try {
        await clockAction(dash.clockedIn ? "out" : "in");
        renderToday();
      } catch(e) { window.showToast(e.message, "error"); }
    });
    document.getElementById("empActWO")?.addEventListener("click", () => switchView("workorders"));
    document.getElementById("empLeaveBalCard")?.addEventListener("click", () => switchView("leaves"));
    document.getElementById("empActLeave")?.addEventListener("click", openLeaveSheet);
    document.getElementById("empActExp")?.addEventListener("click", openExpSheet);
    document.getElementById("empUrgentWO")?.addEventListener("click", () => switchView("workorders"));
    document.getElementById("empKpiWO")?.addEventListener("click", () => switchView("workorders"));
    document.getElementById("empKpiMsg")?.addEventListener("click", () => switchView("messages"));
    document.getElementById("empKpiLeave")?.addEventListener("click", () => switchView("leaves"));
    document.getElementById("empKpiExp")?.addEventListener("click", () => switchView("expenses"));

    // set unread dot
    if (dash.unreadMessages > 0) {
      document.getElementById("empMsgDot")?.classList.remove("hidden");
    }

    // Live clock duration counter
    if (dash.clockedIn && dash.activeClock?.clockedIn) {
      const clockStart = new Date(dash.activeClock.clockedIn).getTime();
      const durEl = document.getElementById("empClockDuration");
      if (durEl) {
        const updateDur = () => {
          const secs = Math.floor((Date.now() - clockStart) / 1000);
          const h = Math.floor(secs / 3600);
          const m = Math.floor((secs % 3600) / 60);
          const s = secs % 60;
          durEl.textContent = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
        };
        updateDur();
        const timer = setInterval(() => { if (!document.getElementById("empClockDuration")) { clearInterval(timer); return; } updateDur(); }, 1000);
      }
    }
  }

  // ── Clock ──────────────────────────────────────────────────
  async function renderClock() {
    const data = await api("GET", "/me/clock");
    _clockActive = !!data.active;
    updateClockTab();

    let elapsed = 0;
    if (data.active) {
      elapsed = (Date.now() - new Date(data.active.clockedIn).getTime()) / 3600000;
    }

    const R = 108, CIRC = 2 * Math.PI * R;                 // ring-omtrek
    const WORKDAY = 8;                                       // referentie voor de voortgangsring
    const startLabel = data.active ? new Date(data.active.clockedIn).toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit"}) : "";

    const main = document.getElementById("empMain");
    main.innerHTML = `
<div class="emp-card emp-clock-widget">
  <div class="emp-clock-ring ${data.active ? "on" : ""}" id="empRingWrap">
    <svg viewBox="0 0 240 240">
      <circle class="track" cx="120" cy="120" r="${R}"></circle>
      <circle class="prog" id="empRing" cx="120" cy="120" r="${R}"
        stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${CIRC.toFixed(1)}"></circle>
    </svg>
    <div class="emp-clock-center">
      <div class="emp-clock-time" id="empLiveClock">--:--</div>
      <div class="emp-clock-date">${new Date().toLocaleDateString("nl-BE",{weekday:"long",day:"numeric",month:"long"})}</div>
      <div class="emp-clock-chip ${data.active ? "on" : "off"}"><span class="dot"></span>${data.active ? `Actief sinds ${startLabel}` : "Niet ingeklokt"}</div>
    </div>
  </div>

  <button class="emp-clock-btn ${data.active ? "emp-clock-btn-out" : "emp-clock-btn-in"}" id="empClockToggle">
    <svg viewBox="0 0 24 24"><path d="${data.active ? "M6 6h12v12H6z" : "M8 5v14l11-7z"}"/></svg>
    ${data.active ? "Uitkloppen" : "Inkloppen"}
  </button>

  <div class="emp-clock-stats">
    <div class="emp-clock-stat"><div class="emp-clock-stat-val" id="empSession">${elapsed.toFixed(1)} u</div><div class="emp-clock-stat-lbl">Huidige sessie</div></div>
    <div class="emp-clock-stat"><div class="emp-clock-stat-val">${data.todayHours} u</div><div class="emp-clock-stat-lbl">Vandaag totaal</div></div>
  </div>
</div>

<div class="emp-card">
  <p class="emp-card-title">Recente registraties</p>
  ${(data.clocks||[]).slice(0,5).map(c => `
  <div class="emp-list-item">
    <div class="emp-list-icon"><svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2z"/></svg></div>
    <div class="emp-list-info">
      <div class="emp-list-title">${c.clockedIn?.slice(0,10)||"—"}</div>
      <div class="emp-list-sub">${c.clockedIn ? new Date(c.clockedIn).toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit"}) : "—"} – ${c.clockedOut ? new Date(c.clockedOut).toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit"}) : "Lopend"}</div>
    </div>
    <span class="emp-pill ${c.status==="in"?"emp-pill-green":"emp-pill-gray"}">${c.status==="in"?"Actief":"Klaar"}</span>
  </div>`).join("") || '<div class="emp-empty"><div class="emp-empty-icon">🕐</div><div class="emp-empty-text">Geen registraties</div></div>'}
</div>`;

    // live clock tick — tijd, sessieduur en voortgangsring
    const tick = () => {
      const el = document.getElementById("empLiveClock");
      if (el) el.textContent = new Date().toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
      if (data.active) {
        const h = (Date.now() - new Date(data.active.clockedIn).getTime()) / 3600000;
        const sEl = document.getElementById("empSession");
        if (sEl) sEl.textContent = h.toFixed(1) + " u";
        const ring = document.getElementById("empRing");
        if (ring) ring.setAttribute("stroke-dashoffset", (CIRC * (1 - Math.min(h / WORKDAY, 1))).toFixed(1));
      }
    };
    tick();
    const tid = setInterval(() => { if (_currentView !== "clock") { clearInterval(tid); return; } tick(); }, 1000);

    document.getElementById("empClockToggle")?.addEventListener("click", async () => {
      try {
        await clockAction(data.active ? "out" : "in");
        clearInterval(tid);
        renderClock();
      } catch(e) { window.showToast(e.message, "error"); }
    });
  }

  // ── Planning ───────────────────────────────────────────────
  function getWeekStartFromOffset(offset) {
    const now = new Date();
    const base = getWeekStart(now);
    base.setDate(base.getDate() + offset * 7);
    return base;
  }

  async function renderPlanning() {
    const main = document.getElementById("empMain");
    main.innerHTML = `<div class="emp-card" style="padding:24px;text-align:center;color:#94a3b8;">Laden…</div>`;

    const weekStart = getWeekStartFromOffset(_empPlanningWeekOffset);
    const weekEnd   = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
    const from = weekStart.toISOString().slice(0,10);
    const to   = weekEnd.toISOString().slice(0,10);

    const data = await api("GET", `/me/planning?from=${from}&to=${to}`);
    const shifts = data.shifts || [];

    const today = new Date().toISOString().slice(0,10);
    const isCurrentWeek = _empPlanningWeekOffset === 0;

    const days = Array.from({length:7}, (_,i) => {
      const d = new Date(weekStart); d.setDate(weekStart.getDate()+i);
      return d.toISOString().slice(0,10);
    });

    // Week label
    const weekLabel = isCurrentWeek
      ? "Deze week"
      : `${weekStart.toLocaleDateString("nl-BE",{day:"numeric",month:"short"})} – ${weekEnd.toLocaleDateString("nl-BE",{day:"numeric",month:"short",year:"numeric"})}`;

    main.innerHTML = `
<div class="emp-card">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
    <p class="emp-card-title" style="margin:0;">${esc(weekLabel)}</p>
    <div style="display:flex;gap:6px;">
      <button class="emp-btn emp-btn-secondary emp-btn-sm" id="empPlanPrev" style="padding:4px 10px;font-size:12px;">‹</button>
      ${!isCurrentWeek ? `<button class="emp-btn emp-btn-secondary emp-btn-sm" id="empPlanNow" style="padding:4px 10px;font-size:12px;">Nu</button>` : ""}
      <button class="emp-btn emp-btn-secondary emp-btn-sm" id="empPlanNext" style="padding:4px 10px;font-size:12px;">›</button>
    </div>
  </div>
  <div class="emp-day-strip">
    ${days.map(d => {
      const hasShift = shifts.some(s => s.date === d);
      const dd = new Date(d);
      return `<div class="emp-day-pill ${d===today?"today":""} ${hasShift?"has-shift":""}">
        <span>${dd.toLocaleDateString("nl-BE",{weekday:"short"})[0].toUpperCase()}</span>
        <span class="emp-day-num">${dd.getDate()}</span>
      </div>`;
    }).join("")}
  </div>
</div>

${shifts.length ? shifts.map(s => `
<div class="emp-card">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
    <div style="font-size:13px;font-weight:600;color:#0f172a;">${new Date(s.date).toLocaleDateString("nl-BE",{weekday:"long",day:"numeric",month:"long"})}</div>
    ${s.date===today?'<span class="emp-pill emp-pill-blue">Vandaag</span>':""}
  </div>
  <div class="emp-shift-item" style="border:none;padding:0;">
    <div class="emp-shift-time">${esc(s.start||"")}${s.end?`–${esc(s.end)}`:""}</div>
    <div class="emp-shift-info">
      <div class="emp-shift-title">${esc(s.location||s.title||"Shift")}</div>
      <div class="emp-shift-sub">${esc(s.notes||"")}</div>
    </div>
  </div>
</div>`).join("") : `<div class="emp-empty"><div class="emp-empty-icon">📅</div><div class="emp-empty-text">Geen shifts gepland deze week</div></div>`}`;

    document.getElementById("empPlanPrev")?.addEventListener("click", () => {
      _empPlanningWeekOffset--; renderPlanning();
    });
    document.getElementById("empPlanNext")?.addEventListener("click", () => {
      _empPlanningWeekOffset++; renderPlanning();
    });
    document.getElementById("empPlanNow")?.addEventListener("click", () => {
      _empPlanningWeekOffset = 0; renderPlanning();
    });
  }

  // ── Leaves ─────────────────────────────────────────────────
  async function renderLeaves() {
    const [data, balData] = await Promise.all([
      api("GET", "/me/leaves"),
      api("GET", "/me/leaves/balance").catch(() => null)
    ]);
    const leaves = data.leaves || [];
    const bal = balData || {};
    const main = document.getElementById("empMain");

    const balPct = bal.quota ? Math.min(100, Math.round((bal.used / bal.quota) * 100)) : 0;
    const balColor = balPct >= 90 ? "#ef4444" : balPct >= 70 ? "#f59e0b" : "#10b981";

    main.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
  <div style="font-size:16px;font-weight:600;">Mijn verlof</div>
  <button class="emp-btn emp-btn-primary emp-btn-sm" id="empNewLeave">+ Aanvragen</button>
</div>

${bal.quota != null ? `
<div class="emp-card" style="margin-bottom:10px;">
  <p class="emp-card-title" style="margin-bottom:8px;">Vakantiesaldo ${bal.year || ""}</p>
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
    <span style="font-size:13px;color:#0f172a;"><strong>${bal.remaining ?? "—"}</strong> resterende dagen</span>
    <span style="font-size:12px;color:#64748b;">${bal.used ?? 0} / ${bal.quota ?? "?"} gebruikt</span>
  </div>
  <div style="background:#f1f5f9;border-radius:4px;height:6px;overflow:hidden;">
    <div style="background:${balColor};height:6px;width:${balPct}%;border-radius:4px;transition:width .3s;"></div>
  </div>
</div>` : ""}

${data.absentNow ? `<div style="background:#fef3c7;border-radius:10px;padding:12px;margin-bottom:12px;font-size:13px;color:#92400e;">Je bent momenteel afwezig wegens goedgekeurd verlof.</div>` : ""}

<div class="emp-card">
  <p class="emp-card-title">Verlofaanvragen</p>
  ${leaves.length ? leaves.map(l => `
  <div class="emp-list-item" style="flex-wrap:wrap;gap:6px;">
    <div class="emp-list-icon" style="background:#fef9c3;">
      <svg viewBox="0 0 24 24" style="fill:#ca8a04"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>
    </div>
    <div class="emp-list-info" style="flex:1;min-width:0;">
      <div class="emp-list-title">${esc(l.type||"Verlof")} — ${l.startDate} t/m ${l.endDate}</div>
      <div class="emp-list-sub">${esc(l.reason||"")}${l.reviewNote?` · <em>${esc(l.reviewNote)}</em>`:""}</div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;">
      <span class="emp-pill ${l.status==="goedgekeurd"?"emp-pill-green":l.status==="geweigerd"?"emp-pill-red":l.status==="geannuleerd"?"":"emp-pill-amber"}">${esc(l.status)}</span>
      ${l.status==="aangevraagd" ? `<button class="emp-btn emp-btn-danger emp-btn-sm emp-leave-cancel" data-id="${esc(l.id)}" style="font-size:11px;padding:3px 8px;">Intrekken</button>` : ""}
    </div>
  </div>`).join("") : '<div class="emp-empty"><div class="emp-empty-icon">📅</div><div class="emp-empty-text">Geen verlofaanvragen</div></div>'}
</div>`;

    document.getElementById("empNewLeave")?.addEventListener("click", openLeaveSheet);
    document.querySelectorAll(".emp-leave-cancel").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Verlofaanvraag intrekken?")) return;
        btn.disabled = true; btn.textContent = "…";
        try {
          await api("DELETE", `/me/leaves/${btn.dataset.id}`);
          window.showToast && window.showToast("Aanvraag ingetrokken", "success");
          renderLeaves();
        } catch(e) { window.showToast(e.message, "error"); btn.disabled = false; btn.textContent = "Intrekken"; }
      });
    });
  }

  // ── Expenses ───────────────────────────────────────────────
  async function renderExpenses() {
    const data = await api("GET", "/me/expenses");
    const expenses = data.expenses || [];
    const main = document.getElementById("empMain");

    main.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
  <div style="font-size:16px;font-weight:600;">Mijn onkosten</div>
  <button class="emp-btn emp-btn-primary emp-btn-sm" id="empNewExp">+ Indienen</button>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
  <div class="emp-card" style="margin:0;text-align:center;">
    <div style="font-size:22px;font-weight:700;">${data.pending ?? 0}</div>
    <div style="font-size:11px;color:#94a3b8;">In behandeling</div>
  </div>
  <div class="emp-card" style="margin:0;text-align:center;">
    <div style="font-size:22px;font-weight:700;">€${(data.totalApproved||0).toFixed(0)}</div>
    <div style="font-size:11px;color:#94a3b8;">Goedgekeurd</div>
  </div>
</div>

<div class="emp-card">
  <p class="emp-card-title">Declaraties</p>
  ${expenses.length ? expenses.map(e => {
    const isPending = ["aangevraagd","ingediend","pending"].includes(e.status);
    return `
  <div class="emp-list-item" style="flex-wrap:wrap;gap:6px;">
    <div class="emp-list-icon" style="background:#fef3c7;">
      <svg viewBox="0 0 24 24" style="fill:#d97706"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>
    </div>
    <div class="emp-list-info" style="flex:1;min-width:0;">
      <div class="emp-list-title">€${Number(e.amount||0).toFixed(2)} — ${esc(e.category||"—")}</div>
      <div class="emp-list-sub">${esc(e.date)} · ${esc(e.description||"")}${e.reviewNote?` · <em>${esc(e.reviewNote)}</em>`:""}</div>
    </div>
    <div style="display:flex;gap:6px;align-items:center;">
      <span class="emp-pill ${e.status==="goedgekeurd"||e.status==="approved"?"emp-pill-green":e.status==="geweigerd"?"emp-pill-red":"emp-pill-amber"}">${esc(e.status)}</span>
      ${isPending ? `<button class="emp-btn emp-btn-danger emp-btn-sm emp-exp-delete" data-id="${esc(e.id)}" style="font-size:11px;padding:3px 8px;">✕</button>` : ""}
    </div>
  </div>`;}).join("") : '<div class="emp-empty"><div class="emp-empty-icon">🧾</div><div class="emp-empty-text">Geen declaraties</div></div>'}
</div>`;

    document.getElementById("empNewExp")?.addEventListener("click", openExpSheet);
    document.querySelectorAll(".emp-exp-delete").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Declaratie verwijderen?")) return;
        btn.disabled = true; btn.textContent = "…";
        try {
          await api("DELETE", `/me/expenses/${btn.dataset.id}`);
          window.showToast && window.showToast("Declaratie verwijderd", "success");
          renderExpenses();
        } catch(e) { window.showToast(e.message, "error"); btn.disabled = false; btn.textContent = "✕"; }
      });
    });
  }

  // ── Workorders ─────────────────────────────────────────────
  async function renderWorkorders() {
    const data = await api("GET", "/me/workorders");
    const workorders = data.workorders || [];
    const main = document.getElementById("empMain");

    const done = ["Voltooid", "Afgewerkt", "done"];
    const inProg = ["in_progress"];

    main.innerHTML = `
<div style="font-size:16px;font-weight:600;margin-bottom:12px;">Mijn werkbonnen</div>
<div class="emp-card">
  <p class="emp-card-title">${data.open ?? 0} open · ${data.urgent ?? 0} urgent</p>
  ${workorders.length ? workorders.map(w => {
    const isDone = done.includes(w.status);
    const isInProg = inProg.includes(w.status);
    let actionBtn = "";
    if (!isDone && !isInProg) {
      actionBtn = `<button class="emp-wo-start emp-pill" data-id="${esc(w.id)}" style="background:#3b82f6;color:#fff;border:none;cursor:pointer;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;">▶ Start</button>`;
    } else if (isInProg) {
      actionBtn = `<button class="emp-wo-done emp-pill" data-id="${esc(w.id)}" style="background:#10b981;color:#fff;border:none;cursor:pointer;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:600;">✓ Voltooid</button>`;
    }
    return `
  <div class="emp-list-item emp-wo-row" data-id="${esc(w.id)}" style="gap:10px;align-items:center;cursor:pointer;">
    <div class="emp-list-icon" style="background:${isDone?"#dcfce7":isInProg?"#fef9c3":"#eff6ff"};">
      <svg viewBox="0 0 24 24" style="fill:${isDone?"#16a34a":isInProg?"#ca8a04":"#3b82f6"}"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
    </div>
    <div class="emp-list-info" style="flex:1;min-width:0;">
      <div class="emp-list-title">${esc(w.title||"Werkbon")}</div>
      <div class="emp-list-sub">${esc(w.clientName||"")}${w.clientName&&(w.scheduledDate||w.createdAt)?" · ":""}${esc(w.scheduledDate||w.createdAt?.slice(0,10)||"")}</div>
    </div>
    ${actionBtn || `<span class="emp-pill ${isDone?"emp-pill-green":"emp-pill-blue"}">${esc(w.status||"—")}</span>`}
  </div>`;
  }).join("") : '<div class="emp-empty"><div class="emp-empty-icon">📋</div><div class="emp-empty-text">Geen werkbonnen</div></div>'}
</div>`;

    // Wire start/done buttons
    main.querySelectorAll(".emp-wo-start").forEach(btn => {
      btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = "…";
        try { await api("PATCH", `/me/workorders/${btn.dataset.id}`, { status: "in_progress" }); renderWorkorders(); }
        catch(e) { window.showToast(e.message, "error"); btn.disabled = false; btn.textContent = "▶ Start"; }
      });
    });
    main.querySelectorAll(".emp-wo-done").forEach(btn => {
      btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = "…";
        try { await api("PATCH", `/me/workorders/${btn.dataset.id}`, { status: "Voltooid" }); renderWorkorders(); }
        catch(e) { window.showToast(e.message, "error"); btn.disabled = false; btn.textContent = "✓ Voltooid"; }
      });
    });

    // Tap row → detail sheet
    main.querySelectorAll(".emp-wo-row").forEach(row => {
      row.addEventListener("click", e => {
        if (e.target.closest("button")) return; // don't open if clicking action btn
        const wo = workorders.find(w => w.id === row.dataset.id);
        if (wo) openWorkorderSheet(wo);
      });
    });
  }

  // ── Workorder detail sheet ─────────────────────────────────
  function openWorkorderSheet(wo) {
    const done    = ["Voltooid","Afgewerkt","done"].includes(wo.status);
    const inProg  = wo.status === "in_progress";
    const priorityLabel = { hoog:"🔴 Hoog", normaal:"🟡 Normaal", laag:"🟢 Laag" }[wo.priority] || wo.priority || "—";

    const sheet = document.createElement("div");
    sheet.style.cssText = "position:fixed;inset:0;z-index:1100;display:flex;flex-direction:column;justify-content:flex-end;";
    sheet.innerHTML = `
<div id="woSheetScrim" style="position:absolute;inset:0;background:rgba(15,23,42,.45);"></div>
<div style="position:relative;background:#fff;border-radius:20px 20px 0 0;max-height:85vh;overflow-y:auto;padding:0 0 32px;">
  <!-- Handle -->
  <div style="display:flex;justify-content:center;padding:12px 0 4px;">
    <div style="width:40px;height:4px;background:#e2e8f0;border-radius:2px;"></div>
  </div>
  <!-- Header -->
  <div style="padding:8px 20px 16px;border-bottom:1px solid #f1f5f9;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
      <div style="font-size:16px;font-weight:700;color:#0f172a;line-height:1.3;">${esc(wo.title||"Werkbon")}</div>
      <span class="emp-pill ${done?"emp-pill-green":inProg?"emp-pill-amber":"emp-pill-blue"}" style="white-space:nowrap;">${esc(wo.status||"—")}</span>
    </div>
    ${wo.number ? `<div style="font-size:12px;color:#94a3b8;font-family:monospace;margin-top:2px;">#${esc(wo.number)}</div>` : ""}
  </div>
  <!-- Details -->
  <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px;">
    ${wo.description ? `
    <div>
      <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Omschrijving</div>
      <div style="font-size:14px;color:#374151;line-height:1.5;">${esc(wo.description)}</div>
    </div>` : ""}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div>
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Klant</div>
        <div style="font-size:13px;color:#0f172a;">${esc(wo.clientName||"—")}</div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Prioriteit</div>
        <div style="font-size:13px;">${priorityLabel}</div>
      </div>
      <div>
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Geplande datum</div>
        <div style="font-size:13px;color:#0f172a;">${wo.scheduledDate || "—"}</div>
      </div>
      ${wo.startedAt ? `<div>
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Gestart op</div>
        <div style="font-size:13px;color:#0f172a;">${new Date(wo.startedAt).toLocaleString("nl-BE",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</div>
      </div>` : ""}
      ${wo.completedAt ? `<div>
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;">Voltooid op</div>
        <div style="font-size:13px;color:#16a34a;">${new Date(wo.completedAt).toLocaleString("nl-BE",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</div>
      </div>` : ""}
    </div>
    ${wo.notes||wo.note ? `
    <div>
      <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Notities</div>
      <div style="font-size:13px;color:#374151;background:#f8fafc;border-radius:8px;padding:10px;line-height:1.5;">${esc(wo.notes||wo.note)}</div>
    </div>` : ""}
  </div>
  <!-- Action buttons -->
  ${!done ? `
  <div style="padding:0 20px;display:flex;flex-direction:column;gap:10px;">
    ${!inProg ? `<button id="woSheetStart" class="emp-btn emp-btn-primary" style="padding:12px;font-size:14px;font-weight:600;">▶ Start werkbon</button>` : ""}
    ${inProg  ? `<button id="woSheetDone"  class="emp-btn emp-btn-primary" style="padding:12px;font-size:14px;font-weight:600;background:#10b981;">✓ Afsluiten & notitie toevoegen</button>` : ""}
  </div>` : `
  <div style="padding:0 20px 8px;">
    <div style="background:#d1fae5;border-radius:8px;padding:10px 14px;font-size:13px;color:#065f46;font-weight:600;">✅ Werkbon voltooid${wo.completedAt?" op "+new Date(wo.completedAt).toLocaleDateString("nl-BE"):""}</div>
    ${wo.completionNote?`<div style="margin-top:8px;font-size:12px;color:#64748b;background:#f8fafc;border-radius:6px;padding:8px;">${esc(wo.completionNote)}</div>`:""}
  </div>`}
  <!-- Foto's sectie -->
  <div style="padding:0 20px;margin-top:12px;">
    <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Foto's</div>
    ${(wo.photos||[]).length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;">${(wo.photos||[]).map(p=>`<img src="${p}" style="width:80px;height:80px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;">`).join("")}</div>` : `<div style="font-size:12px;color:#94a3b8;">Geen foto's</div>`}
    <label id="woAddPhotoBtn" style="display:inline-flex;align-items:center;gap:6px;margin-top:8px;background:#f1f5f9;border-radius:8px;padding:7px 12px;font-size:13px;cursor:pointer;font-weight:500;color:#374151;">
      📷 Foto toevoegen <input type="file" accept="image/*" capture="environment" id="woPhotoInput" style="display:none;">
    </label>
    <div id="woPhotoPreview" style="margin-top:8px;"></div>
  </div>
</div>`;

    document.body.appendChild(sheet);
    const close = () => sheet.remove();
    document.getElementById("woSheetScrim").addEventListener("click", close);

    document.getElementById("woSheetStart")?.addEventListener("click", async () => {
      try {
        await api("PATCH", `/me/workorders/${wo.id}`, { status: "in_progress" });
        window.showToast && window.showToast("Werkbon gestart ▶", "success");
        close(); renderWorkorders();
      } catch(e) { window.showToast(e.message, "error"); }
    });

    // Photo upload (stores as base64 on workorder)
    document.getElementById("woPhotoInput")?.addEventListener("change", async e => {
      const file = e.target.files[0]; if (!file) return;
      const preview = document.getElementById("woPhotoPreview");
      if (file.size > 3 * 1024 * 1024) { window.showToast("Foto is te groot (max 3MB)", "warning"); return; }
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const b64 = ev.target.result;
        if (preview) preview.innerHTML = `<img src="${b64}" style="width:100px;height:100px;object-fit:cover;border-radius:8px;border:2px solid #10b981;">`;
        try {
          const existing = wo.photos || [];
          await api("PATCH", `/me/workorders/${wo.id}`, { photos: [...existing, b64] });
          window.showToast && window.showToast("Foto opgeslagen ✓", "success");
          wo.photos = [...existing, b64];
        } catch(err) { window.showToast("Upload fout: "+err.message, "error"); }
      };
      reader.readAsDataURL(file);
    });

    document.getElementById("woSheetDone")?.addEventListener("click", () => {
      // Show completion dialog inline
      const actionDiv = document.querySelector("#woSheetDone")?.parentElement;
      if (actionDiv) actionDiv.innerHTML = `
<div style="background:#f0fdf4;border-radius:10px;padding:14px;">
  <div style="font-size:13px;font-weight:600;margin-bottom:8px;">Werkbon afsluiten</div>
  <textarea id="woCompletionNote" rows="3" placeholder="Optionele notitie bij afronding (bijv. uitgevoerde werkzaamheden, materiaal gebruikt…)"
    style="width:100%;padding:8px;border:1px solid #d1fae5;border-radius:8px;font-size:13px;resize:vertical;"></textarea>
  <div style="display:flex;gap:8px;margin-top:10px;">
    <button id="woCompleteCancelBtn" class="emp-btn emp-btn-secondary" style="flex:1;padding:10px;">Annuleren</button>
    <button id="woCompleteConfirmBtn" class="emp-btn emp-btn-primary" style="flex:2;padding:10px;background:#10b981;font-weight:600;">✓ Bevestigen</button>
  </div>
</div>`;
      document.getElementById("woCompleteCancelBtn")?.addEventListener("click", close);
      document.getElementById("woCompleteConfirmBtn")?.addEventListener("click", async () => {
        const note = document.getElementById("woCompletionNote")?.value?.trim();
        try {
          await api("PATCH", `/me/workorders/${wo.id}`, { status: "Voltooid", completionNote: note||undefined });
          window.showToast && window.showToast("Werkbon voltooid ✓", "success");
          close(); renderWorkorders();
        } catch(e) { window.showToast(e.message, "error"); }
      });
    });
  }

  // ── Messages ───────────────────────────────────────────────
  async function renderMessages() {
    const data = await api("GET", "/me/messages");
    const messages = data.messages || [];
    const unread = data.unread || 0;
    const main = document.getElementById("empMain");

    // Update badge
    const dot = document.getElementById("empMsgDot");
    if (dot) dot.classList.toggle("hidden", unread === 0);

    main.innerHTML = `
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
  <div style="font-size:16px;font-weight:600;">Berichten${unread>0?` <span style="background:#ef4444;color:#fff;border-radius:999px;padding:1px 7px;font-size:11px;vertical-align:middle;">${unread}</span>`:""}</div>
  <button id="empComposeBtn" style="background:var(--wf-blue);color:#fff;border:none;border-radius:8px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;">+ Bericht</button>
</div>
<div class="emp-card">
  ${messages.length ? messages.map(m => {
    const isUnread = !m.readBy?.includes(window._wfpCurrentUser?.id) && m.senderId !== window._wfpCurrentUser?.id;
    return `
  <div class="emp-list-item emp-msg-item" data-id="${esc(m.id)}" style="background:${isUnread?"#eff6ff":"#fff"};border-radius:10px;margin-bottom:4px;cursor:pointer;">
    <div class="emp-list-icon" style="background:${isUnread?"#dbeafe":"#e0f2fe"};">
      <svg viewBox="0 0 24 24" style="fill:${isUnread?"var(--wf-blue)":"var(--wf-blue-d)"}"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
    </div>
    <div class="emp-list-info" style="flex:1;min-width:0;">
      <div class="emp-list-title" style="${isUnread?"font-weight:700;":""}">
        ${esc(m.senderName||m.senderId||"Systeem")}
        ${m.subject ? `<span style="font-size:11px;color:#64748b;margin-left:4px">· ${esc(m.subject)}</span>` : ""}
      </div>
      <div class="emp-list-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(m.body||m.message||"—")}</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0;margin-left:8px;">
      <div style="font-size:10px;color:#94a3b8;">${m.createdAt ? new Date(m.createdAt).toLocaleDateString("nl-BE",{day:"numeric",month:"short"}) : ""}</div>
      ${isUnread ? '<div style="width:8px;height:8px;border-radius:50%;background:#3b82f6;"></div>' : ""}
    </div>
  </div>`;
  }).join("") : '<div class="emp-empty"><div class="emp-empty-icon">💬</div><div class="emp-empty-text">Geen berichten</div></div>'}
</div>`;

    document.getElementById("empComposeBtn")?.addEventListener("click", openComposeSheet);

    // Click message → open detail sheet
    document.querySelectorAll(".emp-msg-item").forEach(el => {
      el.addEventListener("click", () => {
        const msg = messages.find(m => m.id === el.dataset.id);
        if (msg) openMessageSheet(msg);
      });
    });
  }

  function openMessageSheet(msg) {
    const sheet = document.createElement("div");
    sheet.style.cssText = "position:fixed;inset:0;z-index:1100;display:flex;flex-direction:column;justify-content:flex-end;";
    const dateStr = msg.createdAt ? new Date(msg.createdAt).toLocaleString("nl-BE",{day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"}) : "";
    sheet.innerHTML = `
<div style="position:absolute;inset:0;background:rgba(15,23,42,.45);" id="msgSheetScrim"></div>
<div style="position:relative;background:#fff;border-radius:20px 20px 0 0;max-height:80vh;overflow-y:auto;padding:0 0 32px;">
  <div style="display:flex;justify-content:center;padding:12px 0 4px;">
    <div style="width:40px;height:4px;background:#e2e8f0;border-radius:2px;"></div>
  </div>
  <div style="padding:12px 20px 16px;border-bottom:1px solid #f1f5f9;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <div style="font-size:16px;font-weight:700;color:#0f172a;">${esc(msg.subject||"Bericht")}</div>
      <button id="msgSheetClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8;padding:2px">×</button>
    </div>
    <div style="margin-top:6px;font-size:12px;color:#94a3b8;">Van: <strong>${esc(msg.senderName||msg.senderId||"Systeem")}</strong> · ${dateStr}</div>
  </div>
  <div style="padding:16px 20px;">
    <p style="font-size:14px;color:#374151;line-height:1.7;white-space:pre-wrap;margin:0;">${esc(msg.body||msg.message||"—")}</p>
  </div>
</div>`;
    document.body.appendChild(sheet);
    const close = () => sheet.remove();
    document.getElementById("msgSheetClose").addEventListener("click", close);
    document.getElementById("msgSheetScrim").addEventListener("click", close);

    // Mark as read if unread
    const uid = window._wfpCurrentUser?.id;
    if (uid && !msg.readBy?.includes(uid) && msg.senderId !== uid) {
      api("PATCH", `/me/messages/${msg.id}/read`, {}).catch(() => {});
    }
  }

  function openComposeSheet() {
    // Reuse the bottom sheet mechanism or create a simple modal
    let modal = document.getElementById("empComposeModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "empComposeModal";
      modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:600;display:flex;align-items:flex-end;justify-content:center";
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
<div style="background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:540px;padding:20px 20px 32px;box-shadow:0 -4px 32px rgba(0,0,0,.15)">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
    <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin:0">Nieuw bericht</h3>
    <button id="empComposeClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8;padding:2px">×</button>
  </div>
  <form id="empComposeForm" style="display:flex;flex-direction:column;gap:12px">
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px">Aan</label>
      <select name="recipientRole" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">
        <option value="">Alle teamleden</option>
        <option value="manager">Manager(s)</option>
        <option value="tenant_admin">Admin</option>
      </select>
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px">Onderwerp</label>
      <input name="subject" placeholder="Onderwerp van je bericht" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px">Bericht *</label>
      <textarea name="body" required rows="3" placeholder="Schrijf je bericht…" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;resize:none"></textarea>
    </div>
    <div id="empComposeErr" style="display:none;background:#fef2f2;color:#dc2626;border-radius:8px;padding:8px 10px;font-size:12px"></div>
    <button type="submit" style="padding:11px;background:var(--wf-blue);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;">Versturen</button>
  </form>
</div>`;

    const close = () => modal.remove();
    document.getElementById("empComposeClose").addEventListener("click", close);
    modal.addEventListener("click", e => { if (e.target === modal) close(); });
    document.getElementById("empComposeForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = document.getElementById("empComposeErr");
      const btn = e.target.querySelector("[type=submit]");
      const body = Object.fromEntries(new FormData(e.target).entries());
      btn.disabled = true; btn.textContent = "Bezig…";
      try {
        await api("POST", "/messages", body);
        close();
        renderMessages();
      } catch(err) {
        errEl.textContent = err.message; errEl.style.display = "";
        btn.disabled = false; btn.textContent = "Versturen";
      }
    });
  }

  // ── Tijdregistratie (timesheet) ────────────────────────────
  let _tsMonthOffset = 0;
  async function renderTimesheet() {
    const main = document.getElementById("empMain");
    main.innerHTML = `<div class="emp-loading">Laden…</div>`;

    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() + _tsMonthOffset, 1);
    const year = d.getFullYear(), month = d.getMonth();
    const from = new Date(year, month, 1).toISOString().slice(0,10);
    const to   = new Date(year, month+1, 0).toISOString().slice(0,10);
    const monthLabel = d.toLocaleDateString("nl-BE",{month:"long",year:"numeric"});

    const data = await api("GET", `/me/clock`);
    const allClocks = data.clocks || [];
    const clocks = allClocks.filter(c => (c.clockedIn||"").slice(0,7) === `${year}-${String(month+1).padStart(2,"0")}`);

    // Group by day
    const byDay = {};
    clocks.forEach(c => {
      const day = (c.clockedIn||"").slice(0,10);
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(c);
    });

    const totalHours = clocks.reduce((s,c) => {
      if (!c.clockedOut) return s;
      return s + (new Date(c.clockedOut)-new Date(c.clockedIn))/3600000;
    }, 0);
    const workedDays = Object.keys(byDay).length;

    // CSV download
    function exportCSV() {
      const rows = [["Datum","Inkloktijd","Uitkloktijd","Uren","Lopend"]];
      clocks.forEach(c => {
        const h = c.clockedOut ? ((new Date(c.clockedOut)-new Date(c.clockedIn))/3600000).toFixed(2) : "";
        rows.push([c.clockedIn?.slice(0,10)||"", c.clockedIn?.slice(11,16)||"", c.clockedOut?.slice(11,16)||"", h, c.clockedOut?"":"Ja"]);
      });
      const csv = rows.map(r=>r.map(v=>`"${v}"`).join(";")).join("\n");
      const a = document.createElement("a");
      a.href = "data:text/csv;charset=utf-8,﻿"+encodeURIComponent(csv);
      a.download = `tijdregistratie-${from.slice(0,7)}.csv`;
      a.click();
    }

    main.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
  <div style="display:flex;gap:8px;align-items:center;">
    <button class="emp-btn emp-btn-secondary emp-btn-sm" id="tsPrev">‹</button>
    <span style="font-size:14px;font-weight:600;text-transform:capitalize;">${monthLabel}</span>
    <button class="emp-btn emp-btn-secondary emp-btn-sm" id="tsNext" ${_tsMonthOffset===0?"disabled":""}>›</button>
    ${_tsMonthOffset!==0?`<button class="emp-btn emp-btn-secondary emp-btn-sm" id="tsNow">Nu</button>`:""}
  </div>
  <button class="emp-btn emp-btn-secondary emp-btn-sm" id="tsExport">📥 CSV</button>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px;">
  <div class="emp-card" style="margin:0;text-align:center;">
    <div style="font-size:22px;font-weight:700;color:#0f172a;">${totalHours.toFixed(1)}</div>
    <div style="font-size:11px;color:#94a3b8;">Uren gewerkt</div>
  </div>
  <div class="emp-card" style="margin:0;text-align:center;">
    <div style="font-size:22px;font-weight:700;color:#0f172a;">${workedDays}</div>
    <div style="font-size:11px;color:#94a3b8;">Dagen aanwezig</div>
  </div>
  <div class="emp-card" style="margin:0;text-align:center;">
    <div style="font-size:22px;font-weight:700;color:#0f172a;">${workedDays?((totalHours/workedDays).toFixed(1)):"—"}</div>
    <div style="font-size:11px;color:#94a3b8;">Gem. uur/dag</div>
  </div>
</div>

<div class="emp-card">
  <p class="emp-card-title">Dagdetail — ${monthLabel}</p>
  ${Object.keys(byDay).length ? Object.entries(byDay).sort((a,b)=>a[0].localeCompare(b[0])).map(([day, dc]) => {
    const dayHours = dc.reduce((s,c)=>s+(c.clockedOut?(new Date(c.clockedOut)-new Date(c.clockedIn))/3600000:0),0);
    const dayName = new Date(day).toLocaleDateString("nl-BE",{weekday:"short",day:"numeric",month:"short"});
    return `<div style="padding:8px 0;border-bottom:1px solid #f8fafc;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <span style="font-size:13px;font-weight:600;color:#0f172a;text-transform:capitalize;">${dayName}</span>
        <span style="font-size:12px;font-weight:700;color:#10b981;">${dayHours.toFixed(1)} u</span>
      </div>
      ${dc.map(c=>`<div style="font-size:11.5px;color:#64748b;display:flex;gap:8px;padding:1px 0;">
        <span>${c.clockedIn?new Date(c.clockedIn).toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit"}):"—"}</span>
        <span>–</span>
        <span>${c.clockedOut?new Date(c.clockedOut).toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit"}):`<span style="color:#f59e0b">Lopend</span>`}</span>
        <span style="margin-left:auto;">${c.clockedOut?((new Date(c.clockedOut)-new Date(c.clockedIn))/3600000).toFixed(1)+" u":""}</span>
      </div>`).join("")}
    </div>`;
  }).join("") : `<div class="emp-empty"><div class="emp-empty-icon">🕐</div><div class="emp-empty-text">Geen registraties in ${monthLabel}</div></div>`}
</div>`;

    document.getElementById("tsPrev")?.addEventListener("click", () => { _tsMonthOffset--; renderTimesheet(); });
    document.getElementById("tsNext")?.addEventListener("click", () => { _tsMonthOffset++; renderTimesheet(); });
    document.getElementById("tsNow")?.addEventListener("click", () => { _tsMonthOffset = 0; renderTimesheet(); });
    document.getElementById("tsExport")?.addEventListener("click", exportCSV);
  }

  // ── More ───────────────────────────────────────────────────
  async function renderMore() {
    const main = document.getElementById("empMain");
    // Laad profieldata
    let profile = {};
    try {
      const res = await api("GET", "/me");
      profile = res.user || {};
    } catch (_) {}

    main.innerHTML = `
<div style="font-size:16px;font-weight:600;margin-bottom:12px;">Meer</div>
<div class="emp-card">
  ${viewEnabled("workorders") ? `<div class="emp-list-item" id="empMoreWO" style="cursor:pointer;">
    <div class="emp-list-icon"><svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg></div>
    <div class="emp-list-info"><div class="emp-list-title">${(window.wfpTerms && window.wfpTerms.t("jobPlural")) || "Werkbonnen"}</div><div class="emp-list-sub">Mijn ${((window.wfpTerms && window.wfpTerms.t("jobPlural")) || "werkbonnen").toLowerCase()} bekijken</div></div>
    <svg viewBox="0 0 24 24" style="width:16px;fill:#94a3b8;flex-shrink:0;"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
  </div>` : ""}
  ${viewEnabled("expenses") ? `<div class="emp-list-item" id="empMoreExp" style="cursor:pointer;">
    <div class="emp-list-icon" style="background:#fef3c7;"><svg viewBox="0 0 24 24" style="fill:#d97706"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg></div>
    <div class="emp-list-info"><div class="emp-list-title">Onkosten</div><div class="emp-list-sub">Declaraties bekijken & indienen</div></div>
    <svg viewBox="0 0 24 24" style="width:16px;fill:#94a3b8;flex-shrink:0;"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
  </div>` : ""}
  ${viewEnabled("messages") ? `<div class="emp-list-item" id="empMoreMsg" style="cursor:pointer;">
    <div class="emp-list-icon" style="background:#e0f2fe;"><svg viewBox="0 0 24 24" style="fill:var(--wf-blue-d)"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg></div>
    <div class="emp-list-info"><div class="emp-list-title">Berichten</div><div class="emp-list-sub">Team communicatie</div></div>
    <svg viewBox="0 0 24 24" style="width:16px;fill:#94a3b8;flex-shrink:0;"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
  </div>` : ""}
  <div class="emp-list-item" id="empMoreTimesheet" style="cursor:pointer;">
    <div class="emp-list-icon" style="background:#f0fdf4;"><svg viewBox="0 0 24 24" style="fill:#16a34a"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg></div>
    <div class="emp-list-info"><div class="emp-list-title">Tijdregistratie</div><div class="emp-list-sub">Maandoverzicht van mijn uren</div></div>
    <svg viewBox="0 0 24 24" style="width:16px;fill:#94a3b8;flex-shrink:0;"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
  </div>
</div>

<!-- Mijn profiel -->
<div style="font-size:13px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin:16px 0 8px;">Mijn profiel</div>
<div class="emp-card">
  <form id="empProfileForm" style="display:flex;flex-direction:column;gap:12px;">
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Naam</label>
      <input name="name" value="${profile.name||""}" placeholder="Volledige naam" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Telefoon</label>
      <input name="phone" type="tel" value="${profile.phone||""}" placeholder="+32 ..." style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Adres</label>
      <input name="address" value="${profile.address||""}" placeholder="Straat 1, 1000 Brussel" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">IBAN <span style="font-weight:400;color:#94a3b8;">(voor onkostenvergoeding)</span></label>
      <input name="iban" value="${profile.iban||""}" placeholder="BE68 5390 0754 7034" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;font-family:monospace;" autocomplete="off">
    </div>
    <div id="empProfileMsg" style="display:none;padding:8px 10px;border-radius:8px;font-size:12px;"></div>
    <button type="submit" style="padding:10px;background:var(--wf-blue);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">Opslaan</button>
  </form>
</div>

<!-- Wachtwoord wijzigen -->
<div style="font-size:13px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin:16px 0 8px;">Wachtwoord</div>
<div class="emp-card">
  <form id="empPwForm" style="display:flex;flex-direction:column;gap:12px;">
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Huidig wachtwoord</label>
      <input name="currentPassword" type="password" required style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Nieuw wachtwoord</label>
      <input name="newPassword" type="password" required minlength="8" style="width:100%;padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
    </div>
    <div id="empPwMsg" style="display:none;padding:8px 10px;border-radius:8px;font-size:12px;"></div>
    <button type="submit" style="padding:10px;background:#0f172a;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">Wijzigen</button>
  </form>
</div>
<div style="text-align:center;font-size:11px;color:#94a3b8;padding:18px 0 8px;">Powered by <strong style="color:#64748b">Monargo</strong></div>`;

    document.getElementById("empMoreWO")?.addEventListener("click", () => switchView("workorders"));
    document.getElementById("empMoreExp")?.addEventListener("click", () => switchView("expenses"));
    document.getElementById("empMoreMsg")?.addEventListener("click", () => switchView("messages"));
    document.getElementById("empMoreTimesheet")?.addEventListener("click", () => switchView("timesheet"));

    document.getElementById("empProfileForm")?.addEventListener("submit", async e => {
      e.preventDefault();
      const msgEl = document.getElementById("empProfileMsg");
      const body = Object.fromEntries(new FormData(e.target).entries());
      try {
        await api("PATCH", "/me", body);
        msgEl.style.cssText = "display:block;background:#d1fae5;color:#065f46;padding:8px 10px;border-radius:8px;font-size:12px;";
        msgEl.textContent = "Profiel opgeslagen ✓";
        setTimeout(() => { msgEl.style.display = "none"; }, 3000);
        // Update header name
        const nameEl = document.getElementById("empHeaderName");
        if (nameEl && body.name) nameEl.textContent = body.name;
      } catch (err) {
        msgEl.style.cssText = "display:block;background:#fee2e2;color:#dc2626;padding:8px 10px;border-radius:8px;font-size:12px;";
        msgEl.textContent = err.message;
      }
    });

    document.getElementById("empPwForm")?.addEventListener("submit", async e => {
      e.preventDefault();
      const msgEl = document.getElementById("empPwMsg");
      const { currentPassword, newPassword } = Object.fromEntries(new FormData(e.target).entries());
      try {
        await api("POST", "/auth/change-password", { currentPassword, newPassword });
        msgEl.style.cssText = "display:block;background:#d1fae5;color:#065f46;padding:8px 10px;border-radius:8px;font-size:12px;";
        msgEl.textContent = "Wachtwoord gewijzigd ✓";
        e.target.reset();
        setTimeout(() => { msgEl.style.display = "none"; }, 3000);
      } catch (err) {
        msgEl.style.cssText = "display:block;background:#fee2e2;color:#dc2626;padding:8px 10px;border-radius:8px;font-size:12px;";
        msgEl.textContent = err.message;
      }
    });
  }

  // ── Sheets ─────────────────────────────────────────────────
  function openLeaveSheet() {
    document.getElementById("empSheetOverlay").classList.remove("hidden");
    document.getElementById("empLeaveSheet").classList.remove("hidden");
    // set default dates
    const today = new Date().toISOString().slice(0,10);
    const form = document.getElementById("empLeaveForm");
    if (form) { form.startDate.value = today; form.endDate.value = today; }
  }

  function openExpSheet() {
    document.getElementById("empSheetOverlay").classList.remove("hidden");
    document.getElementById("empExpSheet").classList.remove("hidden");
    const today = new Date().toISOString().slice(0,10);
    const form = document.getElementById("empExpForm");
    if (form) form.date.value = today;
  }

  function closeSheets() {
    document.getElementById("empSheetOverlay")?.classList.add("hidden");
    document.getElementById("empLeaveSheet")?.classList.add("hidden");
    document.getElementById("empExpSheet")?.classList.add("hidden");
  }

  // ── Helpers ────────────────────────────────────────────────
  function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d;
  }

  function updateClockTab() {
    const tab = document.querySelector(".emp-tab-clock");
    if (tab) tab.classList.toggle("clocked-in", !!_clockActive);
  }

  function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return "Goedemorgen";
    if (h < 18) return "Goedemiddag";
    return "Goedenavond";
  }

  // ── Init ───────────────────────────────────────────────────
  function init() {
    buildShell();
    applyEntitlements();
    // Catalogus-view-namen → employee-tabnamen (bv. 'clocking' → 'clock')
    const navAlias = { clocking: "clock" };
    window.WfpBoden && window.WfpBoden.mount({ navigate: v => switchView(navAlias[v] || v) });
    try {
      const user = window._wfpCurrentUser || {};
      const name = user.name || user.email || "Medewerker";
      const nameEl = document.getElementById("empHeaderName");
      if (nameEl) nameEl.textContent = name;
      const grEl = document.getElementById("empGreeting");
      if (grEl) grEl.textContent = getGreeting();
    } catch (_) {}
    switchView("today");
  }

  window.wfp_employeeInit = init;
}());
