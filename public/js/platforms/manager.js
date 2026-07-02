/* ============================================================
   Monargo One – Manager Platform
   public/js/platforms/manager.js
   ============================================================ */
(function () {
  "use strict";

  let _currentView = "dashboard";

  // ── API ────────────────────────────────────────────────────
  // Gedeelde kern (token/tenantId/esc/fetch+401) → public/js/core.js
  const token = () => window.wfpCore.token();
  const tenantId = () => window.wfpCore.tenantId();

  function api(method, path, body) {
    const tid = tenantId();
    const skipPrefix = !tid || path.startsWith("/tenants/") || path.startsWith("/auth/");
    const fullPath = skipPrefix ? path : `/tenants/${tid}${path}`;
    return window.wfpCore.request("/api" + fullPath, { method, body: body ? JSON.stringify(body) : undefined });
  }

  // Verberg nav-items voor modules die niet in het pakket van de tenant zitten.
  function applyEntitlements() {
    fetch("/api/me", { headers: { Authorization: "Bearer " + token() } })
      .then(r => r.json())
      .then(d => {
        if (d && d.supportSession && d.supportSession.active) renderSupportBanner(d.supportSession);
        const ent = d && d.entitlements;
        if (!ent || ent.views === "*") return;
        const allowed = new Set(ent.views || []);
        const alwaysShow = new Set(["dashboard", "team"]); // kern-views van de manager
        document.querySelectorAll(".mgr-nav-item[data-view]").forEach(a => {
          const v = a.getAttribute("data-view");
          if (!alwaysShow.has(v) && !allowed.has(v)) a.style.display = "none";
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
    b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:var(--wf-red);color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:6px 16px;display:flex;align-items:center;justify-content:center;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,.2)";
    const span = document.createElement("span");
    span.textContent = `Support-sessie actief — ${s.agent || "supportmedewerker"} (${scope}). Deze sessie wordt geaudit.`;
    b.appendChild(span);
    const exit = document.createElement("button");
    exit.textContent = "Sessie verlaten";
    exit.style.cssText = "background:#fff;color:var(--wf-red);border:none;border-radius:6px;font:600 12px system-ui,sans-serif;padding:5px 12px;cursor:pointer;flex-shrink:0";
    exit.onclick = () => window.WorkFlowProPlatformRouter && window.WorkFlowProPlatformRouter.exitSupportSession();
    b.appendChild(exit);
    document.body.appendChild(b);
    document.body.style.paddingTop = "38px";
  }

  // ── Shell ──────────────────────────────────────────────────
  function buildShell() {
    const el = document.getElementById("platform-manager");
    if (!el) return;

    el.innerHTML = `
<div class="mgr-layout">
  <aside class="mgr-sidebar" id="mgrSidebar">
    <div class="mgr-logo">
      <span class="mgr-logo-mark">M</span>
      <span class="mgr-logo-text">Monargo One</span>
    </div>
    <nav class="mgr-nav">
      <a class="mgr-nav-item active" data-view="dashboard" href="#" tabindex="0">
        <svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
        Dashboard
      </a>
      <a class="mgr-nav-item" data-view="team" href="#">
        <svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
        Mijn team
      </a>
      <a class="mgr-nav-item" data-view="planning" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/></svg>
        Planning
      </a>
      <a class="mgr-nav-item" data-view="clocking" href="#">
        <svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>
        Prikklok
      </a>
      <a class="mgr-nav-item" data-view="leaves" href="#">
        <svg viewBox="0 0 24 24"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>
        Verlof
        <span class="mgr-badge" id="mgrLeaveBadge" style="display:none">0</span>
      </a>
      <a class="mgr-nav-item" data-view="expenses" href="#">
        <svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>
        Onkosten
        <span class="mgr-badge" id="mgrExpBadge" style="display:none">0</span>
      </a>
      <a class="mgr-nav-item" data-view="workorders" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        Werkbonnen
      </a>
      <a class="mgr-nav-item" data-view="messages" href="#">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
        Berichten
        <span class="mgr-badge" id="mgrMsgBadge" style="display:none">0</span>
      </a>
      <a class="mgr-nav-item" data-view="vehicles" href="#">
        <svg viewBox="0 0 24 24"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>
        Voertuigen
      </a>
      <a class="mgr-nav-item" data-view="reports" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/></svg>
        Rapporten
      </a>
    </nav>
    <div class="mgr-sidebar-footer">
      <div class="mgr-user-chip">
        <div class="mgr-user-avatar" id="mgrUserAvatar">M</div>
        <div class="mgr-user-info">
          <div class="mgr-user-name" id="mgrUserName">Manager</div>
          <div class="mgr-user-role">Manager</div>
        </div>
      </div>
      <button class="mgr-logout-btn" id="mgrLogoutBtn" title="Uitloggen">
        <svg viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
      </button>
    </div>
    <div style="padding:8px 12px 12px;font-size:10.5px;color:var(--gray-500);text-align:center">Powered by <strong style="color:var(--gray-400)">Monargo</strong></div>
  </aside>

  <main class="mgr-main">
    <header class="mgr-topbar">
      <button class="mgr-menu-toggle" id="mgrMenuToggle">
        <svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
      </button>
      <h1 class="mgr-page-title" id="mgrPageTitle">Dashboard</h1>
      <button class="mgr-clockbtn" id="mgrClockBtn" title="Klok jezelf in of uit" style="margin-left:auto">
        <span class="mgr-clockbtn-dot"></span>
        <svg class="mgr-clockbtn-ico" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>
        <span id="mgrClockLbl">Inklokken</span>
      </button>
      <div style="position:relative">
        <button id="mgrBellBtn" title="Notificaties" style="background:none;border:none;cursor:pointer;padding:6px;border-radius:8px;color:var(--gray-500);display:flex;align-items:center;justify-content:center;transition:background .1s">
          <svg viewBox="0 0 24 24" style="width:20px;height:20px;fill:currentColor"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
          <span id="mgrBellDot" style="position:absolute;top:4px;right:4px;width:8px;height:8px;background:var(--wf-red);border-radius:50%;border:2px solid #fff;display:none"></span>
        </button>
        <div id="mgrNotifPanel" style="position:absolute;right:0;top:calc(100% + 8px);width:320px;background:#fff;border-radius:12px;border:1px solid var(--gray-200);box-shadow:0 8px 32px rgba(0,0,0,.12);z-index:400;display:none">
          <div style="padding:12px 16px;border-bottom:1px solid var(--gray-100);display:flex;align-items:center;gap:8px">
            <span style="font-size:13px;font-weight:600;color:var(--gray-900);flex:1">Notificaties</span>
            <button id="mgrNotifMarkAll" style="background:none;border:none;cursor:pointer;font-size:11px;color:var(--wf-blue);font-weight:600;padding:3px 6px;border-radius:6px">Alles gelezen</button>
          </div>
          <div id="mgrNotifList" style="max-height:320px;overflow-y:auto"><div style="padding:28px;text-align:center;font-size:13px;color:var(--gray-400)">Laden…</div></div>
        </div>
      </div>
    </header>
    <div class="mgr-content" id="mgrContent">
      <div class="mgr-loading">Laden…</div>
    </div>
  </main>
</div>

<style>
#platform-manager { font-family:var(--font-sans); height:100vh; overflow:hidden; }
.mgr-layout { display:flex; height:100vh; background:var(--bg); }
.mgr-sidebar { width:220px; background:var(--surface); color:var(--ink); border-right:1px solid var(--line); display:flex; flex-direction:column; flex-shrink:0; }
.mgr-logo { display:flex; align-items:center; gap:10px; padding:20px 16px; border-bottom:1px solid var(--line); }
.mgr-logo-mark { background:var(--wf-blue); color:#fff; width:32px; height:32px; border-radius:9px; display:grid; place-items:center; font-weight:600; font-size:13px; flex-shrink:0; }
.mgr-logo-text { font-weight:600; font-size:15px; letter-spacing:-.2px; }
.mgr-nav { padding:12px 8px; flex:1; }
.mgr-nav-item { display:flex; align-items:center; gap:10px; padding:9px 10px; border-radius:9px; color:var(--gray-600); text-decoration:none; font-size:13.5px; transition:background .15s,color .15s; }
.mgr-nav-item svg { width:18px; height:18px; fill:currentColor; flex-shrink:0; opacity:.7; }
.mgr-nav-item:hover { background:rgba(0,0,0,.045); color:var(--ink); }
.mgr-nav-item:hover svg { opacity:1; }
.mgr-nav-item.active { background:var(--wf-blue-l); color:var(--wf-blue); font-weight:600; }
.mgr-nav-item.active svg { opacity:1; }
.mgr-badge { margin-left:auto; background:var(--wf-red); color:#fff; border-radius:999px; font-size:11px; padding:1px 6px; font-weight:600; }
.mgr-sidebar-footer { padding:12px; border-top:1px solid var(--line); display:flex; align-items:center; gap:8px; }
.mgr-user-chip { display:flex; align-items:center; gap:8px; flex:1; min-width:0; }
.mgr-user-avatar { width:32px; height:32px; border-radius:50%; background:var(--wf-blue); color:#fff; display:grid; place-items:center; font-weight:600; font-size:13px; flex-shrink:0; }
.mgr-user-info { min-width:0; }
.mgr-user-name { font-size:13px; font-weight:500; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mgr-user-role { font-size:11px; color:var(--muted); }
.mgr-logout-btn { background:none; border:none; color:var(--gray-400); cursor:pointer; padding:4px; border-radius:6px; }
.mgr-logout-btn:hover { color:var(--wf-red); }
.mgr-logout-btn svg { width:18px; height:18px; fill:currentColor; display:block; }
.mgr-main { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.mgr-topbar { display:flex; align-items:center; gap:12px; padding:0 20px; height:56px; background:rgba(255,255,255,.8); backdrop-filter:saturate(180%) blur(20px); border-bottom:1px solid var(--line); flex-shrink:0; }
.mgr-clockbtn { display:inline-flex; align-items:center; gap:7px; height:34px; padding:0 14px; border-radius:980px; border:1px solid var(--line); background:var(--surface); color:var(--text); font-size:13px; font-weight:600; font-family:inherit; cursor:pointer; white-space:nowrap; transition:background .14s, border-color .14s, color .14s; }
.mgr-clockbtn:hover { background:var(--gray-50); border-color:var(--gray-300); }
.mgr-clockbtn .mgr-clockbtn-ico { width:16px; height:16px; fill:currentColor; opacity:.8; }
.mgr-clockbtn .mgr-clockbtn-dot { display:none; }
.mgr-clockbtn.on { background:var(--wf-green-l); color:var(--wf-green); border-color:transparent; }
.mgr-clockbtn.on .mgr-clockbtn-ico { display:none; }
.mgr-clockbtn.on .mgr-clockbtn-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:currentColor; animation:mgrClockPulse 1.6s ease-in-out infinite; }
@keyframes mgrClockPulse { 0%,100% { opacity:1; } 50% { opacity:.3; } }
@media (max-width:640px){ .mgr-clockbtn span:last-child { display:none; } .mgr-clockbtn { padding:0 10px; } }
.mgr-menu-toggle { background:none; border:none; cursor:pointer; padding:4px; color:var(--gray-500); display:none; }
.mgr-menu-toggle svg { width:20px; height:20px; fill:currentColor; display:block; }
.mgr-page-title { font-size:21px; font-weight:600; flex:1; color:var(--ink); margin:0; letter-spacing:-.4px; }
.mgr-content { flex:1; overflow-y:auto; padding:22px 24px; }
.mgr-btn { padding:9px 18px; border-radius:980px; font-size:13px; font-weight:600; cursor:pointer; border:none; transition:background .14s, transform .08s; }
.mgr-btn:active { transform:translateY(1px); }
.mgr-btn-primary { background:var(--wf-blue); color:#fff; }
.mgr-btn-primary:hover { background:var(--wf-blue-d); }
.mgr-btn-success { background:var(--wf-green); color:#fff; }
.mgr-btn-danger { background:var(--wf-red); color:#fff; }
.mgr-btn-secondary { background:var(--surface); color:var(--text); border:1px solid var(--line); }
.mgr-btn-sm { padding:6px 14px; font-size:12px; }
.mgr-kpis { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:14px; margin-bottom:20px; }
.mgr-kpi { background:var(--surface); border-radius:16px; padding:18px; border:1px solid var(--line); }
.mgr-kpi-link { cursor:pointer; transition:border-color .12s, transform .12s; }
.mgr-kpi-link:hover { transform:translateY(-2px); border-color:var(--gray-300); }
.mgr-kpi-label { font-size:12px; color:var(--muted); margin-bottom:6px; }
.mgr-kpi-value { font-size:28px; font-weight:600; color:var(--ink); letter-spacing:-.5px; }
.mgr-kpi-sub { font-size:11.5px; color:var(--gray-400); margin-top:2px; }
.mgr-card { background:var(--surface); border-radius:16px; border:1px solid var(--line); margin-bottom:18px; overflow:hidden; }
.mgr-card-header { display:flex; align-items:center; justify-content:space-between; padding:15px 18px; border-bottom:1px solid var(--line); }
.mgr-card-title { font-size:15px; font-weight:600; color:var(--ink); margin:0; letter-spacing:-.2px; }
.mgr-card-body { padding:16px; }
.mgr-table-wrap { overflow-x:auto; }
table.mgr-table { width:100%; border-collapse:collapse; font-size:13px; }
.mgr-table th { text-align:left; padding:8px 12px; color:var(--gray-500); font-weight:500; border-bottom:2px solid var(--gray-100); }
.mgr-table td { padding:10px 12px; border-bottom:1px solid var(--bg); color:var(--gray-700); vertical-align:middle; }
.mgr-table tr:last-child td { border-bottom:none; }
.mgr-table tr:hover td { background:var(--bg); }
.mgr-status { display:inline-flex; align-items:center; gap:4px; padding:3px 8px; border-radius:999px; font-size:11px; font-weight:500; }
.mgr-status::before { content:''; width:6px; height:6px; border-radius:50%; background:currentColor; }
.mgr-status-active,.mgr-status-goedgekeurd { background:var(--wf-green-l); color:var(--wf-green); }
.mgr-status-pending,.mgr-status-aangevraagd,.mgr-status-ingediend { background:var(--wf-yellow-l); color:var(--wf-yellow); }
.mgr-status-inactive,.mgr-status-geweigerd { background:var(--wf-red-l); color:var(--wf-red); }
.mgr-status-open { background:var(--wf-blue-l); color:var(--wf-blue); }
.mgr-avatar { width:28px; height:28px; border-radius:50%; background:var(--wf-blue-l); color:var(--wf-blue-d); display:inline-grid; place-items:center; font-size:11px; font-weight:600; }
.mgr-team-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:12px; }
.mgr-team-card { background:#fff; border:1px solid var(--gray-200); border-radius:10px; padding:14px; }
.mgr-team-card-name { font-size:13px; font-weight:600; color:var(--gray-900); margin:8px 0 4px; }
.mgr-team-card-role { font-size:11px; color:var(--gray-400); }
.mgr-team-card-badges { display:flex; gap:4px; flex-wrap:wrap; margin-top:8px; }
.mgr-loading { text-align:center; color:var(--gray-400); padding:40px; }
.mgr-empty { text-align:center; padding:40px; color:var(--gray-400); }
@media (max-width:768px) {
  .mgr-sidebar { position:fixed; left:0; top:0; z-index:100; transform:translateX(-100%); transition:transform .25s; }
  .mgr-sidebar.open { transform:translateX(0); }
  .mgr-menu-toggle { display:block; }
}
</style>`;

    el.querySelectorAll(".mgr-nav-item[data-view]").forEach(a => {
      a.addEventListener("click", e => { e.preventDefault(); switchView(a.dataset.view); });
    });
    document.getElementById("mgrMenuToggle").addEventListener("click", () => {
      document.getElementById("mgrSidebar").classList.toggle("open");
    });
    document.getElementById("mgrLogoutBtn").addEventListener("click", () => {
      localStorage.removeItem("wfp_token");
      location.reload();
    });
    wireMgrClock();
  }

  // ── Persoonlijke prikklok (topbar) — manager kan zichzelf in-/uitklokken ──
  function wireMgrClock() {
    const btn = document.getElementById("mgrClockBtn");
    if (!btn) return;
    const lbl = document.getElementById("mgrClockLbl");
    let active = null, timer = null;
    const paint = () => {
      if (active) {
        const h = (Date.now() - new Date(active.clockedIn).getTime()) / 3600000;
        btn.classList.add("on"); lbl.textContent = `Uitklokken · ${h.toFixed(1)} u`;
      } else { btn.classList.remove("on"); lbl.textContent = "Inklokken"; }
    };
    const refresh = async () => {
      try { const d = await api("GET", "/me/clock"); active = d.active || null; } catch (_) { active = null; }
      paint();
      if (timer) clearInterval(timer);
      if (active) timer = setInterval(() => {
        if (document.getElementById("platform-manager")?.classList.contains("hidden")) { clearInterval(timer); return; }
        paint();
      }, 30000);
    };
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await api("POST", active ? "/me/clock/out" : "/me/clock/in", {});
        window.showToast && window.showToast(active ? "Uitgeklokt" : "Ingeklokt", "success");
        await refresh();
      } catch (e) { window.showToast && window.showToast(e.message, "error"); }
      finally { btn.disabled = false; }
    });
    refresh();
  }

  // ── Nav ────────────────────────────────────────────────────
  const esc = v => window.wfpCore.esc(v);

  const LABELS = {
    dashboard: "Dashboard", team: "Mijn team", planning: "Planning",
    clocking: "Prikklok", leaves: "Verlof", expenses: "Onkosten",
    workorders: "Werkbonnen", messages: "Berichten", vehicles: "Voertuigen",
    reports: "Rapporten"
  };

  function switchView(view) {
    _currentView = view;
    document.querySelectorAll(".mgr-nav-item").forEach(a => {
      a.classList.toggle("active", a.dataset.view === view);
    });
    document.getElementById("mgrPageTitle").textContent = LABELS[view] || view;
    document.getElementById("mgrContent").innerHTML = `<div class="mgr-loading">Laden…</div>`;
    const renders = {
      dashboard: renderDashboard,
      team: renderTeam,
      planning: renderPlanning,
      clocking: renderClocking,
      leaves: renderLeaves,
      expenses: renderExpenses,
      workorders: renderWorkorders,
      messages: renderMessages,
      vehicles: renderVehicles,
      reports: renderReports
    };
    if (renders[view]) renders[view]();
  }

  // ── Dashboard ──────────────────────────────────────────────
  async function renderDashboard() {
    const dash = await api("GET", "/manager/dashboard");
    const content = document.getElementById("mgrContent");

    content.innerHTML = `
<div class="mgr-kpis">
  <div class="mgr-kpi mgr-kpi-link" data-goto="team" title="Naar team">
    <div class="mgr-kpi-label">Team</div>
    <div class="mgr-kpi-value">${dash.team ?? "—"}</div>
    <div class="mgr-kpi-sub">Medewerkers</div>
  </div>
  <div class="mgr-kpi mgr-kpi-link" data-goto="clocking" title="Naar prikklok">
    <div class="mgr-kpi-label">Ingeklokt</div>
    <div class="mgr-kpi-value" style="color:var(--wf-green)">${dash.clockedIn ?? "—"}</div>
    <div class="mgr-kpi-sub">Nu actief</div>
  </div>
  <div class="mgr-kpi mgr-kpi-link" data-goto="leaves" title="Naar verlof">
    <div class="mgr-kpi-label">Afwezig</div>
    <div class="mgr-kpi-value" style="color:var(--wf-yellow)">${dash.absentToday ?? "—"}</div>
    <div class="mgr-kpi-sub">Vandaag</div>
  </div>
  <div class="mgr-kpi mgr-kpi-link" data-goto="leaves" title="Naar verlof">
    <div class="mgr-kpi-label">Verlof</div>
    <div class="mgr-kpi-value" style="color:var(--wf-yellow)">${dash.pendingLeaves ?? "—"}</div>
    <div class="mgr-kpi-sub">Te verwerken</div>
  </div>
  <div class="mgr-kpi mgr-kpi-link" data-goto="expenses" title="Naar onkosten">
    <div class="mgr-kpi-label">Onkosten</div>
    <div class="mgr-kpi-value" style="color:var(--wf-red)">${dash.pendingExpenses ?? "—"}</div>
    <div class="mgr-kpi-sub">Te verwerken</div>
  </div>
  <div class="mgr-kpi mgr-kpi-link" data-goto="workorders" title="Naar werkbonnen">
    <div class="mgr-kpi-label">Werkbonnen</div>
    <div class="mgr-kpi-value" style="color:var(--wf-purple)">${dash.openWorkorders ?? "—"}</div>
    <div class="mgr-kpi-sub">Open</div>
  </div>
</div>

<div class="mgr-card">
  <div class="mgr-card-header">
    <h3 class="mgr-card-title">Team overzicht — vandaag</h3>
    <button class="mgr-btn mgr-btn-primary mgr-btn-sm" id="mgrViewTeam">Volledig team</button>
  </div>
  <div class="mgr-card-body">
    <div class="mgr-team-grid">
      ${(dash.teamList||[]).map(u => `
      <div class="mgr-team-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div class="mgr-avatar" style="width:36px;height:36px;font-size:14px;">${(u.name||"?")[0].toUpperCase()}</div>
          ${u.clockedIn ? '<span class="mgr-status mgr-status-active" style="font-size:10px;">●&nbsp;Live</span>' : ""}
        </div>
        <div class="mgr-team-card-name">${esc(u.name||u.email)}</div>
        <div class="mgr-team-card-role">${u.function||u.jobTitle||u.role||"—"}</div>
        <div class="mgr-team-card-badges">
          ${u.absent ? '<span style="background:var(--wf-red-l);color:var(--wf-red);border-radius:4px;padding:2px 6px;font-size:10px;">Afwezig</span>' : ""}
          ${u.planned ? '<span style="background:var(--wf-blue-l);color:var(--wf-blue);border-radius:4px;padding:2px 6px;font-size:10px;">Ingepland</span>' : ""}
        </div>
      </div>`).join("") || '<p style="color:var(--gray-400);font-size:13px;">Geen teamleden</p>'}
    </div>
  </div>
</div>`;

    document.getElementById("mgrViewTeam")?.addEventListener("click", () => switchView("team"));
    // KPI-kaarten → doorklikken
    document.querySelectorAll(".mgr-kpi-link").forEach(card => {
      card.addEventListener("click", () => switchView(card.dataset.goto));
    });
  }

  // ── Team ───────────────────────────────────────────────────
  async function renderTeam() {
    const dash = await api("GET", "/manager/dashboard");
    const team = dash.teamList || [];
    const content = document.getElementById("mgrContent");

    content.innerHTML = `
<div class="mgr-card">
  <div class="mgr-card-header">
    <h3 class="mgr-card-title">${team.length} teamleden</h3>
  </div>
  <div class="mgr-card-body mgr-table-wrap">
    <table class="mgr-table">
      <thead><tr><th></th><th>Naam</th><th>Functie</th><th>Status</th><th>Afwezig</th><th>Ingepland</th></tr></thead>
      <tbody>
        ${team.map(u => `
        <tr>
          <td><span class="mgr-avatar">${(u.name||"?")[0].toUpperCase()}</span></td>
          <td>${esc(u.name||u.email)}</td>
          <td>${u.function||u.jobTitle||"—"}</td>
          <td>${u.clockedIn ? '<span class="mgr-status mgr-status-active">Ingeklokt</span>' : '<span class="mgr-status mgr-status-pending">Niet geklokt</span>'}</td>
          <td>${u.absent ? "✓" : "—"}</td>
          <td>${u.planned ? "✓" : "—"}</td>
        </tr>`).join("") || '<tr><td colspan="6" class="mgr-empty">Geen teamleden</td></tr>'}
      </tbody>
    </table>
  </div>
</div>`;
  }

  // ── Report period state ────────────────────────────────────
  let _mgrReportPeriod = new Date().toISOString().slice(0, 7); // "YYYY-MM"

  // ── Planning ───────────────────────────────────────────────
  let _mgrWeekOffset = 0;

  async function renderPlanning() {
    const now = new Date();
    const todayStr = now.toISOString().slice(0,10);
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - (now.getDay()||7) + 1);
    weekStart.setDate(weekStart.getDate() + _mgrWeekOffset * 7);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
    const from = weekStart.toISOString().slice(0,10);
    const to = weekEnd.toISOString().slice(0,10);

    const data = await api("GET", `/manager/planning?from=${from}&to=${to}`);
    const shifts = Array.isArray(data) ? data : (data.shifts || []);

    const days = [];
    for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate()+1)) {
      days.push(d.toISOString().slice(0,10));
    }

    const MGR_COLORS = [["var(--wf-blue-l)","var(--wf-blue)"],["var(--wf-green-l)","var(--wf-green)"],["var(--wf-yellow-l)","var(--wf-yellow)"],["var(--wf-purple-l)","var(--wf-purple)"],["var(--wf-purple-l)","var(--wf-purple)"],["var(--wf-blue-l)","var(--wf-blue-d)"],["var(--wf-red-l)","var(--wf-red)"],["var(--wf-blue-l)","var(--wf-blue)"]];
    const mgrColorMap = {}; let mgrColorIdx = 0;
    const getMgrColor = uid => { if (!mgrColorMap[uid]) { mgrColorMap[uid]=MGR_COLORS[mgrColorIdx%MGR_COLORS.length]; mgrColorIdx++; } return mgrColorMap[uid]; };

    const byUser = {};
    shifts.forEach(s => {
      if (!byUser[s.userId]) byUser[s.userId] = { name: s.userName||s.userId, uid: s.userId, days: {} };
      if (!byUser[s.userId].days[s.date]) byUser[s.userId].days[s.date] = [];
      byUser[s.userId].days[s.date].push(s);
    });

    const weekLabel = `${new Date(from).toLocaleDateString("nl-BE",{day:"numeric",month:"short"})} – ${new Date(to).toLocaleDateString("nl-BE",{day:"numeric",month:"short",year:"numeric"})}`;

    const content = document.getElementById("mgrContent");
    content.innerHTML = `
<div class="mgr-card">
  <div class="mgr-card-header">
    <h3 class="mgr-card-title">Planning</h3>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <button class="mgr-btn mgr-btn-secondary mgr-btn-sm" id="mgrPrevWeek">‹</button>
      <span style="font-size:12px;font-weight:500;min-width:160px;text-align:center;">${weekLabel}</span>
      <button class="mgr-btn mgr-btn-secondary mgr-btn-sm" id="mgrNextWeek">›</button>
      ${_mgrWeekOffset !== 0 ? `<button class="mgr-btn mgr-btn-secondary mgr-btn-sm" id="mgrTodayWeek">Nu</button>` : ""}
      <button class="mgr-btn mgr-btn-primary mgr-btn-sm" id="mgrAddShift">+ Shift</button>
    </div>
  </div>
  <div class="mgr-card-body mgr-table-wrap">
    <table class="mgr-table">
      <thead>
        <tr>
          <th>Medewerker</th>
          ${days.map(d => { const dd = new Date(d); return `<th style="${d===todayStr?"color:var(--wf-blue);font-weight:600;background:var(--wf-blue-l)":""}">${dd.toLocaleDateString("nl-BE",{weekday:"short",day:"numeric",month:"numeric"})}</th>`; }).join("")}
        </tr>
      </thead>
      <tbody>
        ${Object.values(byUser).map(u => {
          const [bg,fg] = getMgrColor(u.uid);
          const totalShifts = Object.values(u.days).reduce((s,d)=>s+d.length,0);
          return `<tr>
          <td style="font-weight:500;white-space:nowrap;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${fg};margin-right:5px;vertical-align:middle;"></span>
            ${esc(u.name)} <span style="font-size:10px;color:var(--gray-400);">${totalShifts}×</span>
          </td>
          ${days.map(d => {
            const ds = u.days[d]||[];
            const isToday = d === todayStr;
            return `<td style="${isToday?"background:var(--wf-blue-l);":""}">
              ${ds.map(s=>`<div class="mgr-shift-pill" data-id="${s.id}"
                style="background:${bg};color:${fg};border:1px solid ${fg}30;border-radius:5px;padding:2px 7px;font-size:11px;font-weight:600;margin-bottom:2px;cursor:pointer;white-space:nowrap;">
                ${esc(s.start||"")}${s.end?`–${esc(s.end)}`:""}
              </div>`).join("")||`<span style="color:var(--gray-200);font-size:11px;">—</span>`}
            </td>`;
          }).join("")}
        </tr>`;}).join("") || `<tr><td colspan="${days.length+1}" class="mgr-empty">Geen shifts</td></tr>`}
      </tbody>
    </table>
  </div>
</div>`;

    document.getElementById("mgrAddShift")?.addEventListener("click", () => openShiftModal(from, to, null, shifts));
    document.getElementById("mgrPrevWeek")?.addEventListener("click", () => { _mgrWeekOffset--; renderPlanning(); });
    document.getElementById("mgrNextWeek")?.addEventListener("click", () => { _mgrWeekOffset++; renderPlanning(); });
    document.getElementById("mgrTodayWeek")?.addEventListener("click", () => { _mgrWeekOffset = 0; renderPlanning(); });
    document.querySelectorAll(".mgr-shift-pill").forEach(pill => {
      pill.addEventListener("click", () => {
        const shift = shifts.find(s => s.id === pill.dataset.id);
        if (shift) openShiftModal(from, to, shift, shifts);
      });
    });
  }

  // ── Shift modal ────────────────────────────────────────────
  function openShiftModal(weekFrom, weekTo, shift = null, allShifts = []) {
    const isEdit = !!shift;
    api("GET", "/manager/dashboard").then(dash => {
      const team = dash.teamList || [];
      let modal = document.getElementById("mgrShiftModal");
      if (!modal) {
        modal = document.createElement("div");
        modal.id = "mgrShiftModal";
        modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:500;display:flex;align-items:center;justify-content:center;padding:16px";
        document.body.appendChild(modal);
      }
      modal.innerHTML = `
<div style="background:#fff;border-radius:14px;width:480px;max-width:100%;max-height:90vh;overflow-y:auto;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2)">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
    <h2 style="font-size:17px;font-weight:600;margin:0;color:var(--gray-900)">${isEdit ? "Shift bewerken" : "Shift toevoegen"}</h2>
    <button id="shiftClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400)">×</button>
  </div>
  <form id="shiftForm" style="display:flex;flex-direction:column;gap:14px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Medewerker *</label>
        <select name="userId" required style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px">
          <option value="">— Kies medewerker —</option>
          ${team.map(u => `<option value="${esc(u.id||u.userId||"")}" ${shift?.userId===(u.id||u.userId)?"selected":""}>${esc(u.name||u.email)}</option>`).join("")}
        </select>
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Datum *</label>
        <input name="date" type="date" value="${shift?.date || weekFrom}" required style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Starttijd *</label>
        <input name="start" type="time" value="${shift?.start || "07:00"}" required style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px">
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Eindtijd *</label>
        <input name="end" type="time" value="${shift?.end || "17:00"}" required style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px">
      </div>
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Locatie / Werf</label>
      <input name="venueId" placeholder="Locatie (optioneel)" value="${esc(shift?.venueId||shift?.location||"")}" style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px">
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Notitie</label>
      <input name="note" placeholder="Optionele notitie" value="${esc(shift?.note||"")}" style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px">
    </div>
    <div id="shiftErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:10px;font-size:13px"></div>
    <div style="display:flex;gap:10px;${isEdit?"justify-content:space-between":"justify-content:flex-end"};padding-top:4px">
      ${isEdit ? `<button type="button" id="shiftDelete" style="padding:8px 14px;background:var(--wf-red-l);color:var(--wf-red);border:1px solid var(--wf-red-l);border-radius:8px;font-size:13px;cursor:pointer;">Verwijderen</button>` : ""}
      <div style="display:flex;gap:8px;">
        <button type="button" id="shiftCancel" style="padding:8px 16px;border:1px solid var(--gray-200);background:#fff;border-radius:8px;font-size:13px;cursor:pointer">Annuleren</button>
        <button type="submit" style="padding:8px 20px;background:var(--wf-blue);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">${isEdit ? "Opslaan" : "Aanmaken"}</button>
      </div>
    </div>
  </form>
</div>`;
      const close = () => modal.remove();
      document.getElementById("shiftClose").addEventListener("click", close);
      document.getElementById("shiftCancel").addEventListener("click", close);
      modal.addEventListener("click", e => { if (e.target === modal) close(); });

      if (isEdit) {
        document.getElementById("shiftDelete").addEventListener("click", async () => {
          if (!confirm(`Shift verwijderen voor ${shift.userName||shift.userId} op ${shift.date}?`)) return;
          try {
            await api("DELETE", `/planning/${shift.id}`);
            close(); renderPlanning();
          } catch(err) { window.showToast(err.message, "error"); }
        });
      }

      document.getElementById("shiftForm").addEventListener("submit", async e => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target).entries());
        const errEl = document.getElementById("shiftErr");
        errEl.style.display = "none";
        const submitBtn = e.target.querySelector("[type=submit]");
        submitBtn.disabled = true; submitBtn.textContent = "Bezig…";
        try {
          if (isEdit) await api("PATCH", `/planning/${shift.id}`, body);
          else await api("POST", "/planning", body);
          close(); renderPlanning();
        } catch(err) {
          errEl.textContent = err.message; errEl.style.display = "";
          submitBtn.disabled = false; submitBtn.textContent = isEdit ? "Opslaan" : "Aanmaken";
        }
      });
    }).catch(() => {
      window.showToast("Teamleden konden niet geladen worden.", "error");
    });
  }

  // ── Clocking ───────────────────────────────────────────────
  let _mgrClockDate = new Date().toISOString().slice(0,10);

  async function loadMgrClockData() {
    const data = await api("GET", `/clocks?date=${_mgrClockDate}`);
    return data.clocks || data || [];
  }

  async function renderClocking() {
    const content = document.getElementById("mgrContent");
    content.innerHTML = `<div class="mgr-card"><div class="mgr-card-body" style="padding:24px;text-align:center;color:var(--gray-400);">Laden…</div></div>`;

    let clocks;
    try { clocks = await loadMgrClockData(); }
    catch(e) { content.innerHTML = `<div class="mgr-card"><div class="mgr-card-body" style="color:var(--wf-red);padding:24px;">${e.message}</div></div>`; return; }

    const todayStr = new Date().toISOString().slice(0,10);
    const isToday  = _mgrClockDate === todayStr;
    const d        = new Date(_mgrClockDate);
    const dateLabel = d.toLocaleDateString("nl-BE",{weekday:"long",day:"numeric",month:"long",year:"numeric"});

    // KPI counts
    const totalIn  = clocks.filter(c => c.status === "in").length;
    const totalAll = clocks.length;
    const totalHours = clocks
      .filter(c => c.clockedIn && c.clockedOut)
      .reduce((sum,c) => sum + (new Date(c.clockedOut) - new Date(c.clockedIn))/3600000, 0)
      .toFixed(1);

    content.innerHTML = `
<div class="mgr-card" style="margin-bottom:16px;">
  <div class="mgr-card-header" style="flex-wrap:wrap;gap:8px;">
    <h3 class="mgr-card-title" style="text-transform:capitalize;">${dateLabel}</h3>
    <div style="display:flex;gap:6px;align-items:center;">
      <button class="mgr-btn mgr-btn-secondary mgr-btn-sm" id="mgrClkPrev">‹ Vorige</button>
      ${!isToday ? `<button class="mgr-btn mgr-btn-secondary mgr-btn-sm" id="mgrClkToday">Vandaag</button>` : ""}
      <button class="mgr-btn mgr-btn-secondary mgr-btn-sm" id="mgrClkNext" ${isToday?"disabled":""}>Volgende ›</button>
      <input type="date" id="mgrClkPicker" value="${_mgrClockDate}" style="border:1px solid var(--gray-200);border-radius:8px;padding:5px 8px;font-size:13px;cursor:pointer;" max="${todayStr}">
    </div>
  </div>
  <div class="mgr-card-body" style="display:flex;gap:16px;flex-wrap:wrap;padding-bottom:0;">
    <div class="mgr-kpi"><div class="mgr-kpi-val">${totalAll}</div><div class="mgr-kpi-lbl">Registraties</div></div>
    <div class="mgr-kpi"><div class="mgr-kpi-val" style="color:var(--wf-green);">${totalIn}</div><div class="mgr-kpi-lbl">Nog ingeklokt</div></div>
    <div class="mgr-kpi"><div class="mgr-kpi-val">${totalHours}</div><div class="mgr-kpi-lbl">Totaal uren</div></div>
  </div>
</div>

<div class="mgr-card">
  <div class="mgr-card-body mgr-table-wrap" style="padding-top:0;">
    <table class="mgr-table">
      <thead><tr><th>Medewerker</th><th>Inkloktijd</th><th>Uitkloktijd</th><th>Uren</th><th>Status</th><th>Acties</th></tr></thead>
      <tbody>
        ${clocks.map(c => {
          const h = c.clockedIn && c.clockedOut
            ? ((new Date(c.clockedOut)-new Date(c.clockedIn))/3600000).toFixed(1)
            : "—";
          const inTime  = c.clockedIn  ? new Date(c.clockedIn).toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit"}) : "—";
          const outTime = c.clockedOut ? new Date(c.clockedOut).toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit"}) : "—";
          return `<tr>
            <td>${esc(c.userName||c.userId)}</td>
            <td>${inTime}</td>
            <td>${outTime}</td>
            <td>${h}</td>
            <td>${c.status==="in"
              ? '<span class="mgr-status mgr-status-active">Ingeklokt</span>'
              : '<span class="mgr-status mgr-status-inactive">Uitgeklokt</span>'}</td>
            <td style="white-space:nowrap;">
              <button class="mgr-btn mgr-btn-secondary mgr-btn-sm mgr-clk-edit" data-id="${esc(c.id)}"
                data-in="${esc(c.clockedIn||"")}" data-out="${esc(c.clockedOut||"")}" data-name="${esc(c.userName||c.userId)}"
                title="Corrigeer tijden" style="font-size:12px;">Corrigeer</button>
              ${c.status==="in" ? `<button class="mgr-btn mgr-btn-danger mgr-btn-sm mgr-clk-forceout" data-id="${esc(c.id)}" data-name="${esc(c.userName||c.userId)}"
                title="Forceer uitklopping" style="font-size:12px;margin-left:4px;">⏹ Uitkloppen</button>` : ""}
            </td>
          </tr>`;
        }).join("") || '<tr><td colspan="6" class="mgr-empty">Geen registraties voor deze datum</td></tr>'}
      </tbody>
    </table>
  </div>
</div>`;

    // Navigation events
    document.getElementById("mgrClkPrev")?.addEventListener("click", () => {
      const d2 = new Date(_mgrClockDate); d2.setDate(d2.getDate()-1);
      _mgrClockDate = d2.toISOString().slice(0,10); renderClocking();
    });
    document.getElementById("mgrClkNext")?.addEventListener("click", () => {
      const d2 = new Date(_mgrClockDate); d2.setDate(d2.getDate()+1);
      const next = d2.toISOString().slice(0,10);
      if (next <= todayStr) { _mgrClockDate = next; renderClocking(); }
    });
    document.getElementById("mgrClkToday")?.addEventListener("click", () => {
      _mgrClockDate = todayStr; renderClocking();
    });
    document.getElementById("mgrClkPicker")?.addEventListener("change", e => {
      if (e.target.value && e.target.value <= todayStr) {
        _mgrClockDate = e.target.value; renderClocking();
      }
    });

    // Clock correction modals
    content.querySelectorAll(".mgr-clk-edit").forEach(btn => {
      btn.addEventListener("click", () => openClockCorrectionModal(btn.dataset));
    });
    content.querySelectorAll(".mgr-clk-forceout").forEach(btn => {
      btn.addEventListener("click", async () => {
        const name = btn.dataset.name;
        if (!confirm(`${name} forceren uit te kloppen?`)) return;
        btn.disabled = true; btn.textContent = "…";
        try {
          const now = new Date().toISOString();
          await api("PATCH", `/clocks/${btn.dataset.id}`, { clockedOut: now, status: "out" });
          renderClocking();
        } catch(e) { window.showToast(e.message, "error"); btn.disabled = false; btn.textContent = "⏹ Uitkloppen"; }
      });
    });
  }

  function openClockCorrectionModal({ id, in: clockedIn, out: clockedOut, name }) {
    // Parse existing times for the date picker
    const inDt  = clockedIn  ? new Date(clockedIn)  : null;
    const outDt = clockedOut ? new Date(clockedOut) : null;
    const toLocal = dt => dt ? dt.toISOString().slice(0,16) : "";

    const modal = document.createElement("div");
    modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:600;display:flex;align-items:center;justify-content:center;padding:16px";
    modal.innerHTML = `
<div style="background:#fff;border-radius:14px;width:420px;max-width:100%;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2)">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
    <h2 style="font-size:16px;font-weight:600;margin:0;color:var(--gray-900)">Kloktijd corrigeren</h2>
    <button id="clkCorrClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400)">×</button>
  </div>
  <div style="font-size:13px;color:var(--gray-500);margin-bottom:16px;">Medewerker: <strong>${esc(name)}</strong></div>
  <form id="clkCorrForm" style="display:flex;flex-direction:column;gap:14px">
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Inkloktijd *</label>
      <input name="clockedIn" type="datetime-local" value="${toLocal(inDt)}" required
        style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;">
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Uitkloktijd</label>
      <input name="clockedOut" type="datetime-local" value="${toLocal(outDt)}"
        style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;">
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Notitie bij correctie</label>
      <input name="note" placeholder="Reden voor correctie (optioneel)"
        style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;">
    </div>
    <div id="clkCorrErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:10px;font-size:13px"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button type="button" id="clkCorrCancel" style="padding:8px 16px;border:1px solid var(--gray-200);background:#fff;border-radius:8px;font-size:13px;cursor:pointer">Annuleren</button>
      <button type="submit" style="padding:8px 20px;background:var(--wf-blue);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Opslaan</button>
    </div>
  </form>
</div>`;
    document.body.appendChild(modal);
    const close = () => modal.remove();
    document.getElementById("clkCorrClose").addEventListener("click", close);
    document.getElementById("clkCorrCancel").addEventListener("click", close);
    modal.addEventListener("click", e => { if (e.target === modal) close(); });
    document.getElementById("clkCorrForm").addEventListener("submit", async e => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target).entries());
      const errEl = document.getElementById("clkCorrErr");
      const btn = e.target.querySelector("[type=submit]");
      btn.disabled = true; btn.textContent = "Bezig…";
      try {
        const patch = { clockedIn: new Date(fd.clockedIn).toISOString() };
        if (fd.clockedOut) patch.clockedOut = new Date(fd.clockedOut).toISOString();
        if (fd.note) patch.note = fd.note;
        // status: if we set clockedOut it becomes "out"
        if (fd.clockedOut) patch.status = "out";
        await api("PATCH", `/clocks/${id}`, patch);
        close(); renderClocking();
      } catch(err) {
        errEl.textContent = err.message; errEl.style.display = "";
        btn.disabled = false; btn.textContent = "Opslaan";
      }
    });
  }

  // ── Leaves ─────────────────────────────────────────────────
  let _mgrLeaveTab = "aanvragen";
  let _mgrCalYear  = new Date().getFullYear();
  let _mgrCalMonth = new Date().getMonth() + 1;

  async function renderLeaves() {
    const content = document.getElementById("mgrContent");
    content.innerHTML = `
<div class="mgr-card">
  <div class="mgr-card-header">
    <h3 class="mgr-card-title">Verlof</h3>
    <div style="display:flex;gap:6px;">
      <button class="mgr-btn mgr-btn-sm ${_mgrLeaveTab==="aanvragen"?"mgr-btn-primary":"mgr-btn-secondary"}" id="mgrLeaveTabReq">Aanvragen</button>
      <button class="mgr-btn mgr-btn-sm ${_mgrLeaveTab==="kalender"?"mgr-btn-primary":"mgr-btn-secondary"}" id="mgrLeaveTabCal">Kalender</button>
      <button class="mgr-btn mgr-btn-sm ${_mgrLeaveTab==="saldi"?"mgr-btn-primary":"mgr-btn-secondary"}" id="mgrLeaveTabBal">Saldi</button>
    </div>
  </div>
  <div class="mgr-card-body" id="mgrLeaveBody" style="padding:0;"></div>
</div>`;

    document.getElementById("mgrLeaveTabReq").addEventListener("click", () => { _mgrLeaveTab = "aanvragen"; renderMgrLeaveBody(); });
    document.getElementById("mgrLeaveTabCal").addEventListener("click", () => { _mgrLeaveTab = "kalender"; renderMgrLeaveBody(); });
    document.getElementById("mgrLeaveTabBal").addEventListener("click", () => { _mgrLeaveTab = "saldi"; renderMgrLeaveBody(); });
    renderMgrLeaveBody();
  }

  async function renderMgrLeaveBody() {
    ["aanvragen","kalender","saldi"].forEach(t => {
      const id = t==="aanvragen"?"mgrLeaveTabReq":t==="kalender"?"mgrLeaveTabCal":"mgrLeaveTabBal";
      const btn = document.getElementById(id);
      if (btn) btn.className = `mgr-btn mgr-btn-sm ${_mgrLeaveTab===t?"mgr-btn-primary":"mgr-btn-secondary"}`;
    });

    const body = document.getElementById("mgrLeaveBody");
    if (!body) return;
    body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--gray-400);font-size:13px;">Laden…</div>`;

    if (_mgrLeaveTab === "aanvragen") {
      const data = await api("GET", "/leaves");
      const leaves = data.leaves || data || [];

      // update badge
      const pending = leaves.filter(l => l.status === "aangevraagd").length;
      const badge = document.getElementById("mgrLeaveBadge");
      if (badge) { badge.textContent = pending; badge.style.display = pending ? "" : "none"; }

      body.innerHTML = `<div class="mgr-table-wrap">
        <table class="mgr-table">
          <thead><tr><th>Medewerker</th><th>Type</th><th>Van</th><th>Tot</th><th>Reden</th><th>Status</th><th>Acties</th></tr></thead>
          <tbody>
            ${leaves.map(l => `
            <tr>
              <td>${esc(l.userName||l.userId)}</td>
              <td>${esc(l.type||"—")}</td>
              <td>${esc(l.startDate)}</td>
              <td>${esc(l.endDate)}</td>
              <td style="font-size:12px;color:var(--gray-500);max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(l.reason||"")}">${esc(l.reason||"—")}</td>
              <td><span class="mgr-status mgr-status-${l.status}">${esc(l.status)}</span></td>
              <td>${l.status==="aangevraagd" ? `
                <button class="mgr-btn mgr-btn-success mgr-btn-sm mgr-leave-approve" data-id="${esc(l.id)}" data-dec="goedgekeurd">Goed</button>
                <button class="mgr-btn mgr-btn-danger mgr-btn-sm mgr-leave-approve" data-id="${esc(l.id)}" data-dec="geweigerd">Weigeren</button>
              ` : `<span style="font-size:11px;color:var(--gray-400);">${l.reviewNote ? `${esc(l.reviewNote)}` : "—"}</span>`}</td>
            </tr>`).join("") || '<tr><td colspan="7" class="mgr-empty">Geen aanvragen</td></tr>'}
          </tbody>
        </table>
      </div>`;

      body.querySelectorAll(".mgr-leave-approve").forEach(btn => {
        btn.addEventListener("click", () => openLeaveReviewModal(btn.dataset.id, btn.dataset.dec, leaves));
      });

    } else if (_mgrLeaveTab === "kalender") {
      await renderMgrLeaveCalendar(body);

    } else {
      await renderMgrLeaveBalance(body);
    }
  }

  async function renderMgrLeaveCalendar(container) {
    const MONTHS_NL = ["","Januari","Februari","Maart","April","Mei","Juni","Juli","Augustus","September","Oktober","November","December"];

    let calData, dashData;
    try {
      [calData, dashData] = await Promise.all([
        api("GET", `/leaves/calendar?year=${_mgrCalYear}&month=${_mgrCalMonth}`),
        api("GET", "/dashboard").catch(() => ({}))
      ]);
    } catch(e) {
      container.innerHTML = `<div style="padding:24px;color:var(--wf-red);">${esc(e.message)}</div>`;
      return;
    }
    const { days = {}, leaves = [] } = calData;

    const empMap = {};
    (dashData?.teamList||dashData?.team||[]).forEach(u => { empMap[u.id] = u.name || u.email; });
    leaves.forEach(l => { if (l.userId && l.userName && !empMap[l.userId]) empMap[l.userId] = l.userName; });

    const firstDow = new Date(_mgrCalYear, _mgrCalMonth - 1, 1).getDay();
    const lastDay  = new Date(_mgrCalYear, _mgrCalMonth, 0).getDate();
    let col = firstDow === 0 ? 6 : firstDow - 1;

    let cells = "";
    for (let i = 0; i < col; i++) cells += `<div></div>`;
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${_mgrCalYear}-${String(_mgrCalMonth).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const userIds = days[dateStr] || [];
      const dow = new Date(_mgrCalYear, _mgrCalMonth - 1, d).getDay();
      const isWeekend = dow === 0 || dow === 6;
      const isToday = dateStr === new Date().toISOString().slice(0,10);
      cells += `<div style="min-height:52px;border-radius:8px;padding:4px 6px;background:${isToday?"var(--wf-blue-l)":isWeekend?"var(--gray-50)":"#fff"};border:1px solid ${isToday?"var(--wf-blue-l)":"var(--gray-200)"};">
        <div style="font-size:11px;font-weight:${isToday?"700":"500"};color:${isWeekend?"var(--gray-400)":isToday?"var(--wf-blue)":"var(--gray-700)"};margin-bottom:2px;">${d}</div>
        ${userIds.slice(0,3).map(uid=>`<div style="font-size:10px;background:var(--wf-blue-l);color:var(--wf-blue);border-radius:4px;padding:1px 4px;margin-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(empMap[uid]||uid)}">${esc((empMap[uid]||uid).split(" ")[0])}</div>`).join("")}
        ${userIds.length>3?`<div style="font-size:10px;color:var(--gray-500);">+${userIds.length-3}</div>`:""}
      </div>`;
    }

    container.innerHTML = `
<div style="padding:16px;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
    <button class="mgr-btn mgr-btn-secondary mgr-btn-sm" id="mgrCalPrev">‹</button>
    <span style="font-size:15px;font-weight:600;min-width:160px;text-align:center;">${MONTHS_NL[_mgrCalMonth]} ${_mgrCalYear}</span>
    <button class="mgr-btn mgr-btn-secondary mgr-btn-sm" id="mgrCalNext">›</button>
    <span style="font-size:12px;color:var(--gray-500);margin-left:8px;">${leaves.length} verloven</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px;">
    ${["Ma","Di","Wo","Do","Vr","Za","Zo"].map(d=>`<div style="text-align:center;font-size:11px;font-weight:600;color:var(--gray-500);padding:4px 0;">${d}</div>`).join("")}
  </div>
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">${cells}</div>
</div>`;

    document.getElementById("mgrCalPrev").addEventListener("click", () => {
      _mgrCalMonth--; if (_mgrCalMonth < 1) { _mgrCalMonth = 12; _mgrCalYear--; }
      renderMgrLeaveCalendar(container);
    });
    document.getElementById("mgrCalNext").addEventListener("click", () => {
      _mgrCalMonth++; if (_mgrCalMonth > 12) { _mgrCalMonth = 1; _mgrCalYear++; }
      renderMgrLeaveCalendar(container);
    });
  }

  async function renderMgrLeaveBalance(container) {
    const year = new Date().getFullYear();
    let balData;
    try {
      balData = await api("GET", `/leaves/balance?year=${year}`);
    } catch(e) {
      container.innerHTML = `<div style="padding:24px;color:var(--wf-red);">${esc(e.message)}</div>`;
      return;
    }
    const balance = balData.balance || [];
    if (!balance.length) {
      container.innerHTML = `<div style="padding:24px;text-align:center;color:var(--gray-400);">Geen medewerkers gevonden.</div>`;
      return;
    }
    container.innerHTML = `
<div style="padding:16px;">
  <div style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">Vakantiesaldo ${year}</div>
  <table class="mgr-table">
    <thead><tr><th>Medewerker</th><th>Quota</th><th>Gebruikt</th><th>Resterend</th><th>Voortgang</th></tr></thead>
    <tbody>${balance.map(b => {
      const pct = b.quota ? Math.min(100, Math.round((b.used/b.quota)*100)) : 0;
      const color = pct>=90?"var(--wf-red)":pct>=70?"var(--wf-yellow)":"var(--wf-green)";
      return `<tr>
        <td><div style="font-weight:500;">${esc(b.name)}</div><div style="font-size:11px;color:var(--gray-400);">${esc(b.email)}</div></td>
        <td>${b.quota}d</td><td>${b.used}d</td>
        <td style="font-weight:600;color:${b.remaining<=2?"var(--wf-red)":b.remaining<=5?"var(--wf-yellow)":"var(--wf-green)"};">${b.remaining}d</td>
        <td style="min-width:100px;">
          <div style="background:var(--gray-100);border-radius:20px;height:8px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${color};border-radius:20px;"></div>
          </div>
          <div style="font-size:10px;color:var(--gray-400);margin-top:2px;">${pct}%</div>
        </td>
      </tr>`;
    }).join("")}</tbody>
  </table>
</div>`;
  }

  // ── Leave review modal ─────────────────────────────────────
  function openLeaveReviewModal(leaveId, decision, leaves, onDone) {
    const leave = leaves.find(l => l.id === leaveId);
    if (!leave) return;
    const isApprove = decision === "goedgekeurd";
    const label = isApprove ? "Verlof goedkeuren" : "Verlof weigeren";
    const btnClass = isApprove ? "mgr-btn-success" : "mgr-btn-danger";

    // Build inline modal overlay
    const overlay = document.createElement("div");
    overlay.id = "mgrLeaveModal";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:100%;max-width:400px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2);">
  <div style="font-size:15px;font-weight:600;margin-bottom:4px;">${label}</div>
  <div style="font-size:13px;color:var(--gray-500);margin-bottom:16px;">
    ${esc(leave.userName||leave.userId)} · ${esc(leave.type||"verlof")} · ${leave.startDate} t/m ${leave.endDate}
  </div>
  <div style="margin-bottom:16px;">
    <label style="font-size:12px;font-weight:600;color:var(--gray-700);display:block;margin-bottom:4px;">Opmerking ${isApprove?"(optioneel)":"(optioneel — geeft feedback aan medewerker)"}</label>
    <textarea id="mgrLeaveNote" rows="3" placeholder="Voeg een opmerking toe…"
      style="width:100%;border:1px solid var(--gray-200);border-radius:8px;padding:8px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea>
  </div>
  <div id="mgrLeaveModalErr" style="display:none;color:var(--wf-red);font-size:12px;margin-bottom:8px;"></div>
  <div style="display:flex;gap:8px;justify-content:flex-end;">
    <button id="mgrLeaveModalCancel" class="mgr-btn mgr-btn-secondary mgr-btn-sm">Annuleren</button>
    <button id="mgrLeaveModalConfirm" class="mgr-btn ${btnClass} mgr-btn-sm">${label}</button>
  </div>
</div>`;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById("mgrLeaveModalCancel").addEventListener("click", close);
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });

    document.getElementById("mgrLeaveModalConfirm").addEventListener("click", async () => {
      const reviewNote = document.getElementById("mgrLeaveNote").value.trim();
      const confirmBtn = document.getElementById("mgrLeaveModalConfirm");
      const errEl = document.getElementById("mgrLeaveModalErr");
      confirmBtn.disabled = true; confirmBtn.textContent = "…";
      try {
        await api("PATCH", `/leaves/${leaveId}/review`, { decision, reviewNote: reviewNote || undefined });
        close();
        window.showToast && window.showToast(isApprove ? "Verlof goedgekeurd" : "Verlof geweigerd", isApprove ? "success" : "info");
        if (onDone) onDone(); else renderLeaves();
      } catch(e) {
        errEl.textContent = e.message; errEl.style.display = "";
        confirmBtn.disabled = false; confirmBtn.textContent = label;
      }
    });
  }

  // ── Expenses ───────────────────────────────────────────────
  async function renderExpenses() {
    const data = await api("GET", "/expenses");
    const expenses = data.expenses || data || [];
    const content = document.getElementById("mgrContent");

    const pending  = expenses.filter(e => ["pending","ingediend"].includes(e.status));
    const approved = expenses.filter(e => ["goedgekeurd","approved"].includes(e.status));
    const fmtE = n => new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n);

    content.innerHTML = `
<div class="mgr-kpis" style="margin-bottom:12px;">
  <div class="mgr-kpi"><div class="mgr-kpi-label">In behandeling</div><div class="mgr-kpi-value" style="color:var(--wf-yellow)">${pending.length}</div><div class="mgr-kpi-sub">${fmtE(pending.reduce((s,e)=>s+Number(e.amount||0),0))}</div></div>
  <div class="mgr-kpi"><div class="mgr-kpi-label">Goedgekeurd</div><div class="mgr-kpi-value" style="color:var(--wf-green)">${approved.length}</div><div class="mgr-kpi-sub">${fmtE(approved.reduce((s,e)=>s+Number(e.amount||0),0))}</div></div>
  <div class="mgr-kpi"><div class="mgr-kpi-label">Totaal ingediend</div><div class="mgr-kpi-value">${expenses.length}</div></div>
</div>
<div class="mgr-card">
  <div class="mgr-card-header">
    <h3 class="mgr-card-title">Onkostennota's</h3>
    <select id="mgrExpFilter" style="padding:5px 9px;border:1px solid var(--gray-200);border-radius:8px;font-size:12px;">
      <option value="">Alle</option>
      <option value="ingediend">In behandeling</option>
      <option value="goedgekeurd">Goedgekeurd</option>
      <option value="geweigerd">Geweigerd</option>
    </select>
  </div>
  <div class="mgr-card-body mgr-table-wrap">
    <table class="mgr-table">
      <thead><tr><th>Medewerker</th><th>Datum</th><th>Categorie</th><th>Bedrag</th><th>Status</th><th>Acties</th></tr></thead>
      <tbody id="mgrExpTbody"></tbody>
    </table>
  </div>
</div>`;

    function buildExpRows(rows) {
      return rows.map(e => `<tr>
        <td>${esc(e.userName||e.userId)}</td>
        <td>${esc(e.date)}</td>
        <td>${esc(e.category||"—")}</td>
        <td style="font-weight:600;">€ ${Number(e.amount||0).toFixed(2)}</td>
        <td><span class="mgr-status mgr-status-${e.status}">${esc(e.status)}</span>${e.reviewNote?`<div style="font-size:11px;color:var(--gray-500);margin-top:2px;">${esc(e.reviewNote.slice(0,30))}${e.reviewNote.length>30?"…":""}</div>`:""}</td>
        <td style="white-space:nowrap;">${["pending","ingediend"].includes(e.status)?`
          <button class="mgr-btn mgr-btn-success mgr-btn-sm mgr-exp-review" data-id="${e.id}" data-dec="goedgekeurd" data-name="${esc(e.userName||e.userId)}" data-amount="${e.amount}" data-cat="${esc(e.category||"")}">Goed</button>
          <button class="mgr-btn mgr-btn-danger  mgr-btn-sm mgr-exp-review" data-id="${e.id}" data-dec="geweigerd"  data-name="${esc(e.userName||e.userId)}" data-amount="${e.amount}" data-cat="${esc(e.category||"")}">Weigeren</button>
        `:"—"}</td>
      </tr>`).join("") || '<tr><td colspan="6" class="mgr-empty">Geen onkosten</td></tr>';
    }

    const tbInit = document.getElementById("mgrExpTbody");
    if (tbInit) tbInit.innerHTML = buildExpRows(expenses);

    function wireExpBtns() {
      content.querySelectorAll(".mgr-exp-review").forEach(btn => {
        btn.addEventListener("click", () => openExpenseReviewModal(btn.dataset, renderExpenses));
      });
    }
    wireExpBtns();
    document.getElementById("mgrExpFilter")?.addEventListener("change", e => {
      const f = e.target.value;
      const rows = f ? expenses.filter(exp => exp.status === f || (f==="ingediend" && exp.status==="pending")) : expenses;
      const tb = document.getElementById("mgrExpTbody"); if (tb) { tb.innerHTML = buildExpRows(rows); wireExpBtns(); }
    });
  }

  function openExpenseReviewModal({ id, dec, name, amount, cat }, onDone) {
    const isApprove = dec === "goedgekeurd";
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:100%;max-width:400px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2);">
  <div style="font-size:15px;font-weight:600;margin-bottom:4px;">${isApprove ? "Onkost goedkeuren" : "Onkost weigeren"}</div>
  <div style="font-size:13px;color:var(--gray-500);margin-bottom:16px;">${esc(name)} · ${esc(cat)} · <strong>€ ${Number(amount||0).toFixed(2)}</strong></div>
  <div style="margin-bottom:16px;">
    <label style="font-size:12px;font-weight:600;color:var(--gray-700);display:block;margin-bottom:4px;">Opmerking ${isApprove?"(optioneel)":"(verplicht bij weigering)"}</label>
    <textarea id="expReviewNote" rows="3" placeholder="${isApprove?"Goedgekeurd voor uitbetaling…":"Geef een reden op…"}"
      style="width:100%;border:1px solid var(--gray-200);border-radius:8px;padding:8px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea>
  </div>
  <div id="expReviewErr" style="display:none;color:var(--wf-red);font-size:12px;margin-bottom:8px;"></div>
  <div style="display:flex;gap:8px;justify-content:flex-end;">
    <button id="expReviewCancel" class="mgr-btn mgr-btn-secondary mgr-btn-sm">Annuleren</button>
    <button id="expReviewConfirm" class="mgr-btn ${isApprove?"mgr-btn-success":"mgr-btn-danger"} mgr-btn-sm">${isApprove?"Goedkeuren":"Weigeren"}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    document.getElementById("expReviewCancel").addEventListener("click", close);
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
    document.getElementById("expReviewConfirm").addEventListener("click", async () => {
      const note = document.getElementById("expReviewNote").value.trim();
      const errEl = document.getElementById("expReviewErr");
      if (!isApprove && !note) { errEl.textContent = "Geef een reden op bij weigering."; errEl.style.display = ""; return; }
      const confirmBtn = document.getElementById("expReviewConfirm");
      confirmBtn.disabled = true; confirmBtn.textContent = "…";
      try {
        await api("PATCH", `/expenses/${id}`, { status: dec, reviewNote: note || undefined });
        close();
        window.showToast && window.showToast(isApprove ? "Onkost goedgekeurd" : "Onkost geweigerd", isApprove ? "success" : "info");
        onDone();
      } catch(e) {
        errEl.textContent = e.message; errEl.style.display = "";
        confirmBtn.disabled = false; confirmBtn.textContent = isApprove ? "Goedkeuren" : "Weigeren";
      }
    });
  }

  // ── Workorders ─────────────────────────────────────────────
  async function renderWorkorders() {
    const data = await api("GET", "/workorders");
    const workorders = data.workorders || data || [];
    const content = document.getElementById("mgrContent");
    const statusClass = { open:"mgr-status-open", "in_progress":"mgr-status-pending", done:"mgr-status-active", voltooid:"mgr-status-active", geannuleerd:"mgr-status-inactive" };
    const prioColor = { hoog:"var(--wf-red)", normaal:"var(--gray-400)", laag:"var(--gray-500)" };

    content.innerHTML = `
<div class="mgr-card">
  <div class="mgr-card-header">
    <h3 class="mgr-card-title">Werkbonnen <span style="background:var(--wf-blue-l);color:var(--wf-blue-d);border-radius:999px;padding:2px 9px;font-size:11px;font-weight:600">${workorders.length}</span></h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input id="woSearch" placeholder="Zoek titel, klant…" style="padding:5px 9px;border:1px solid var(--gray-200);border-radius:8px;font-size:12px;min-width:160px;">
      <select id="woFilter" style="padding:5px 9px;border:1px solid var(--gray-200);border-radius:8px;font-size:12px">
        <option value="">Alle statussen</option>
        <option value="open">Open</option>
        <option value="in_progress">In uitvoering</option>
        <option value="done">Voltooid</option>
        <option value="geannuleerd">Geannuleerd</option>
      </select>
      <button class="mgr-btn mgr-btn-primary mgr-btn-sm" id="mgrNewWO">+ Werkbon</button>
    </div>
  </div>
  <div class="mgr-card-body mgr-table-wrap">
    <table class="mgr-table">
      <thead><tr><th>#</th><th>Titel</th><th>Medewerker</th><th>Status</th><th>Prioriteit</th><th>Datum</th><th>Acties</th></tr></thead>
      <tbody id="woTbody">${buildWoRows(workorders, statusClass, prioColor)}</tbody>
    </table>
  </div>
</div>`;

    function applyWoFilters() {
      const q      = document.getElementById("woFilter")?.value || "";
      const search = (document.getElementById("woSearch")?.value || "").toLowerCase();
      let filtered = workorders;
      if (q) filtered = filtered.filter(w => w.status === q);
      if (search) filtered = filtered.filter(w =>
        (w.title||"").toLowerCase().includes(search) ||
        (w.clientName||"").toLowerCase().includes(search) ||
        (w.userName||"").toLowerCase().includes(search)
      );
      const tb = document.getElementById("woTbody");
      if (tb) tb.innerHTML = buildWoRows(filtered, statusClass, prioColor);
      wireWoBtns(workorders);
    }

    document.getElementById("woFilter")?.addEventListener("change", applyWoFilters);
    document.getElementById("woSearch")?.addEventListener("input", applyWoFilters);
    wireWoBtns(workorders);
    document.getElementById("mgrNewWO")?.addEventListener("click", () => openWoModal());
  }

  function buildWoRows(rows, statusClass, prioColor) {
    if (!rows.length) return '<tr><td colspan="7" class="mgr-empty">Geen werkbonnen</td></tr>';
    return rows.map(w => `<tr class="mgr-wo-row" data-id="${esc(w.id)}" style="cursor:pointer;">
      <td style="font-family:monospace;font-weight:600">${w.number||w.id.slice(-4)}</td>
      <td><strong>${esc(w.title||"—")}</strong>${w.clientName ? `<br><span style="font-size:11px;color:var(--gray-500)">${esc(w.clientName)}</span>` : ""}</td>
      <td>${esc(w.userName||w.userId||"—")}</td>
      <td><span class="mgr-status ${statusClass[w.status]||"mgr-status-pending"}">${esc(w.status||"—")}</span></td>
      <td><span style="font-size:11px;font-weight:600;color:${prioColor[w.priority]||"var(--gray-400)"}">${esc(w.priority||"—")}</span></td>
      <td>${w.scheduledDate||w.createdAt?.slice(0,10)||"—"}</td>
      <td style="white-space:nowrap">
        <button class="mgr-btn mgr-btn-secondary mgr-btn-sm wo-detail" data-id="${esc(w.id)}">Detail</button>
        ${w.status !== "done" ? `<button class="mgr-btn mgr-btn-success mgr-btn-sm wo-done" data-id="${esc(w.id)}">Voltooid</button>` : ""}
      </td>
    </tr>`).join("");
  }

  function wireWoBtns(workorders) {
    document.querySelectorAll(".wo-done").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        try { await api("PATCH", `/workorders/${btn.dataset.id}`, { status: "done" }); renderWorkorders(); }
        catch(e2) { window.showToast(e2.message, "error"); }
      });
    });
    document.querySelectorAll(".wo-detail").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        const wo = workorders.find(w => w.id === btn.dataset.id);
        if (wo) openWoDetailModal(wo, workorders);
      });
    });
    document.querySelectorAll(".mgr-wo-row").forEach(row => {
      row.addEventListener("click", () => {
        const wo = workorders.find(w => w.id === row.dataset.id);
        if (wo) openWoDetailModal(wo, workorders);
      });
    });
  }

  function openWoDetailModal(wo, allWorkorders) {
    const statusClass = { open:"mgr-status-open", "in_progress":"mgr-status-pending", done:"mgr-status-active", voltooid:"mgr-status-active", geannuleerd:"mgr-status-inactive" };
    const prioColor   = { hoog:"var(--wf-red)", normaal:"var(--gray-400)", laag:"var(--gray-500)" };
    let overlay = document.getElementById("mgrWoDetail");
    if (!overlay) { overlay = document.createElement("div"); overlay.id = "mgrWoDetail"; document.body.appendChild(overlay); }
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:500;display:flex;align-items:center;justify-content:center;padding:16px";

    const statusOpts = ["open","in_progress","done","geannuleerd"].map(s =>
      `<option value="${s}" ${wo.status===s?"selected":""}>${s}</option>`).join("");

    overlay.innerHTML = `
<div style="background:#fff;border-radius:14px;width:540px;max-width:100%;max-height:90vh;overflow-y:auto;padding:0;box-shadow:0 20px 60px rgba(0,0,0,.2)">
  <div style="padding:20px 24px;border-bottom:1px solid var(--gray-100);display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="font-size:11px;color:var(--gray-400);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Werkbon #${esc(wo.number||wo.id.slice(-6))}</div>
      <h2 style="font-size:17px;font-weight:600;margin:4px 0 0;color:var(--gray-900)">${esc(wo.title||"—")}</h2>
    </div>
    <button id="woDetailClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400);padding:4px 8px">×</button>
  </div>
  <div style="padding:20px 24px;display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div>
      <div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">STATUS</div>
      <span class="mgr-status ${statusClass[wo.status]||"mgr-status-pending"}">${esc(wo.status||"—")}</span>
    </div>
    <div>
      <div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">PRIORITEIT</div>
      <span style="font-size:13px;font-weight:600;color:${prioColor[wo.priority]||"var(--gray-400)"}">${esc(wo.priority||"—")}</span>
    </div>
    <div>
      <div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">MEDEWERKER</div>
      <span style="font-size:13px">${esc(wo.userName||wo.userId||"—")}</span>
    </div>
    <div>
      <div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">KLANT</div>
      <span style="font-size:13px">${esc(wo.clientName||"—")}</span>
    </div>
    <div>
      <div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">GEPLAND OP</div>
      <span style="font-size:13px">${esc(wo.scheduledDate||"—")}</span>
    </div>
    <div>
      <div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">AANGEMAAKT</div>
      <span style="font-size:13px">${wo.createdAt ? new Date(wo.createdAt).toLocaleDateString("nl-BE") : "—"}</span>
    </div>
    ${wo.location ? `<div style="grid-column:1/-1"><div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">LOCATIE</div><span style="font-size:13px">${esc(wo.location)}</span></div>` : ""}
    ${wo.description ? `<div style="grid-column:1/-1"><div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">BESCHRIJVING</div><p style="font-size:13px;color:var(--gray-700);margin:0;white-space:pre-wrap;background:var(--gray-50);border-radius:8px;padding:10px">${esc(wo.description)}</p></div>` : ""}
    ${wo.notes ? `<div style="grid-column:1/-1"><div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">NOTITIES</div><p style="font-size:13px;color:var(--gray-700);margin:0;white-space:pre-wrap;background:var(--wf-yellow-l);border-radius:8px;padding:10px">${esc(wo.notes)}</p></div>` : ""}
  </div>
  ${wo.status !== "done" && wo.status !== "geannuleerd" ? `
  <div style="padding:16px 24px;border-top:1px solid var(--gray-100);background:var(--gray-50);border-radius:0 0 14px 14px">
    <div style="font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:8px">Status wijzigen</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <select id="woDetailStatus" style="padding:7px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px">${statusOpts}</select>
      <textarea id="woDetailNote" placeholder="Opmerking (optioneel)" rows="2" style="flex:1;padding:7px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;resize:vertical;min-width:150px"></textarea>
      <button id="woDetailSave" class="mgr-btn mgr-btn-primary mgr-btn-sm">Opslaan</button>
    </div>
    <div id="woDetailErr" style="display:none;margin-top:8px;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:8px;font-size:12px"></div>
  </div>` : ""}
</div>`;

    const close = () => { overlay.remove(); };
    document.getElementById("woDetailClose").addEventListener("click", close);
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });

    document.getElementById("woDetailSave")?.addEventListener("click", async () => {
      const newStatus = document.getElementById("woDetailStatus").value;
      const note      = document.getElementById("woDetailNote").value.trim();
      const errEl     = document.getElementById("woDetailErr");
      try {
        const patch = { status: newStatus };
        if (note) patch.notes = (wo.notes ? wo.notes + "\n" : "") + `[${new Date().toLocaleDateString("nl-BE")}] ${note}`;
        await api("PATCH", `/workorders/${wo.id}`, patch);
        close();
        renderWorkorders();
      } catch(e) {
        errEl.textContent = e.message; errEl.style.display = "block";
      }
    });
  }

  // ── Werkbon aanmaken (manager) ─────────────────────────────
  function openWoModal() {
    api("GET", "/manager/dashboard").then(dash => {
      const team = dash.teamList || [];
      let modal = document.getElementById("mgrWoModal");
      if (!modal) {
        modal = document.createElement("div");
        modal.id = "mgrWoModal";
        modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:500;display:flex;align-items:center;justify-content:center;padding:16px";
        document.body.appendChild(modal);
      }
      modal.innerHTML = `
<div style="background:#fff;border-radius:14px;width:480px;max-width:100%;max-height:90vh;overflow-y:auto;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2)">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
    <h2 style="font-size:17px;font-weight:600;margin:0;color:var(--gray-900)">Nieuwe werkbon</h2>
    <button id="woClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400)">×</button>
  </div>
  <form id="woForm" style="display:flex;flex-direction:column;gap:14px">
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Titel *</label>
      <input name="title" required placeholder="Omschrijving van de opdracht" style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Medewerker</label>
        <select name="userId" style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px">
          <option value="">— Niet toegewezen —</option>
          ${team.map(u => `<option value="${esc(u.id)}">${esc(u.name||u.email)}</option>`).join("")}
        </select>
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Klant</label>
        <input name="clientName" placeholder="Naam klant" style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Gepland op</label>
        <input name="scheduledDate" type="date" style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px">
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Prioriteit</label>
        <select name="priority" style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px">
          <option value="normaal" selected>Normaal</option>
          <option value="hoog">Hoog</option>
          <option value="laag">Laag</option>
        </select>
      </div>
    </div>
    <div id="woErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:10px;font-size:13px"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:4px">
      <button type="button" id="woCancel" style="padding:8px 16px;border:1px solid var(--gray-200);background:#fff;border-radius:8px;font-size:13px;cursor:pointer">Annuleren</button>
      <button type="submit" style="padding:8px 20px;background:var(--wf-blue);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Aanmaken</button>
    </div>
  </form>
</div>`;
      const close = () => modal.remove();
      document.getElementById("woClose").addEventListener("click", close);
      document.getElementById("woCancel").addEventListener("click", close);
      modal.addEventListener("click", e => { if (e.target === modal) close(); });
      document.getElementById("woForm").addEventListener("submit", async e => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target).entries());
        const errEl = document.getElementById("woErr");
        const btn = e.target.querySelector("[type=submit]");
        btn.disabled = true; btn.textContent = "Bezig…";
        try {
          await api("POST", "/workorders", body);
          close();
          renderWorkorders();
        } catch (err) {
          errEl.textContent = err.message; errEl.style.display = "";
          btn.disabled = false; btn.textContent = "Aanmaken";
        }
      });
    }).catch(() => window.showToast("Team kon niet geladen worden.", "error"));
  }

  // ── Berichten ──────────────────────────────────────────────
  async function renderMessages() {
    const data = await api("GET", "/messages");
    const messages = data.messages || data || [];
    const content = document.getElementById("mgrContent");
    const unread = messages.filter(m => !m.read && m.toRole !== "manager").length;
    const badge = document.getElementById("mgrMsgBadge");
    if (badge) { badge.textContent = unread; badge.style.display = unread ? "" : "none"; }

    content.innerHTML = `
<div class="mgr-card">
  <div class="mgr-card-header">
    <h3 class="mgr-card-title">Berichten</h3>
    <button class="mgr-btn mgr-btn-primary mgr-btn-sm" id="mgrNewMsg">+ Nieuw bericht</button>
  </div>
  <div class="mgr-card-body">
    ${messages.length === 0 ? `<div class="mgr-empty">Geen berichten</div>` :
    messages.map(m => `
    <div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--gray-100);align-items:flex-start">
      <div style="width:34px;height:34px;border-radius:50%;background:var(--wf-blue-l);color:var(--wf-blue-d);display:grid;place-items:center;font-size:12px;font-weight:600;flex-shrink:0">${(m.fromName||"?")[0].toUpperCase()}</div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
          <span style="font-size:13px;font-weight:600;color:var(--gray-900)">${esc(m.fromName||m.fromId||"System")}</span>
          <span style="font-size:11px;color:var(--gray-400)">${m.createdAt ? new Date(m.createdAt).toLocaleString("nl-BE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : ""}</span>
          ${!m.read ? `<span style="background:var(--wf-blue);color:#fff;border-radius:4px;padding:1px 6px;font-size:10px">NIEUW</span>` : ""}
        </div>
        <div style="font-size:13px;color:var(--gray-700)">${esc(m.body||m.content||m.message||"")}</div>
        ${m.toName||m.toId ? `<div style="font-size:11px;color:var(--gray-400);margin-top:2px">Aan: ${esc(m.toName||m.toId)}</div>` : ""}
      </div>
    </div>`).join("")}
  </div>
</div>`;

    document.getElementById("mgrNewMsg")?.addEventListener("click", () => openMsgModal());
  }

  function openMsgModal() {
    let modal = document.getElementById("mgrMsgModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "mgrMsgModal";
      modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:500;display:flex;align-items:center;justify-content:center;padding:16px";
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
<div style="background:#fff;border-radius:14px;width:440px;max-width:100%;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2)">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
    <h2 style="font-size:16px;font-weight:600;margin:0;color:var(--gray-900)">Nieuw bericht</h2>
    <button id="msgClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400)">×</button>
  </div>
  <form id="msgForm" style="display:flex;flex-direction:column;gap:14px">
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Onderwerp *</label>
      <input name="subject" required placeholder="Onderwerp van het bericht" style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px">
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Bericht *</label>
      <textarea name="body" required rows="4" placeholder="Schrijf hier je bericht…" style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;resize:vertical"></textarea>
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Aan (rol / iedereen)</label>
      <select name="toRole" style="width:100%;padding:8px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px">
        <option value="all">Alle medewerkers</option>
        <option value="employee">Medewerkers</option>
        <option value="manager">Managers</option>
      </select>
    </div>
    <div id="msgErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:10px;font-size:13px"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button type="button" id="msgCancel" style="padding:8px 16px;border:1px solid var(--gray-200);background:#fff;border-radius:8px;font-size:13px;cursor:pointer">Annuleren</button>
      <button type="submit" style="padding:8px 20px;background:var(--wf-blue);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Versturen</button>
    </div>
  </form>
</div>`;
    const close = () => modal.remove();
    document.getElementById("msgClose").addEventListener("click", close);
    document.getElementById("msgCancel").addEventListener("click", close);
    modal.addEventListener("click", e => { if (e.target === modal) close(); });
    document.getElementById("msgForm").addEventListener("submit", async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      const errEl = document.getElementById("msgErr");
      const btn = e.target.querySelector("[type=submit]");
      btn.disabled = true; btn.textContent = "Bezig…";
      try {
        await api("POST", "/messages", body);
        close(); renderMessages();
      } catch(err) {
        errEl.textContent = err.message; errEl.style.display = "";
        btn.disabled = false; btn.textContent = "Versturen";
      }
    });
  }

  // ── Voertuigen ─────────────────────────────────────────────
  async function renderVehicles() {
    const data = await api("GET", "/vehicles");
    const vehicles = data.vehicles || [];
    const content = document.getElementById("mgrContent");
    const statusCss = { active:"mgr-status-active", maintenance:"mgr-status-pending", inactive:"mgr-status-inactive" };

    content.innerHTML = `
<div class="mgr-card">
  <div class="mgr-card-header">
    <h3 class="mgr-card-title">Voertuigen <span style="background:var(--wf-blue-l);color:var(--wf-blue-d);border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${vehicles.length}</span></h3>
    <button class="mgr-btn mgr-btn-primary mgr-btn-sm" id="mgrNewVehicle">+ Voertuig</button>
  </div>
  ${vehicles.length === 0 ? `<div class="mgr-card-body"><div class="mgr-empty">Nog geen voertuigen — klik "+ Voertuig" om te starten</div></div>` : `
  <div class="mgr-card-body mgr-table-wrap">
    <table class="mgr-table">
      <thead><tr><th>Naam / Kenteken</th><th>Merk / Model</th><th>KM-stand</th><th>Status</th><th>Volgende service</th><th>Acties</th></tr></thead>
      <tbody>
        ${vehicles.map(v => `<tr>
          <td><strong>${esc(v.name||v.plate||"—")}</strong><br><span style="font-size:11px;color:var(--gray-400);font-family:monospace">${esc(v.plate||"")}</span></td>
          <td>${esc(v.brand||"")} ${esc(v.model||"")}</td>
          <td>${v.mileage ? Number(v.mileage).toLocaleString("nl-BE") + " km" : "—"}</td>
          <td><span class="mgr-status ${statusCss[v.status]||"mgr-status-pending"}">${esc(v.status||"—")}</span></td>
          <td>${v.nextService ? new Date(v.nextService).toLocaleDateString("nl-BE") : "—"}</td>
          <td style="white-space:nowrap;">
            <button class="mgr-btn mgr-btn-secondary mgr-btn-sm mgr-veh-edit" data-id="${v.id}" style="margin-right:4px;"></button>
            <button class="mgr-btn mgr-btn-secondary mgr-btn-sm mgr-veh-mileage" data-id="${v.id}" data-name="${esc(v.name||v.plate||"")}" data-mileage="${v.mileage||0}" title="KM loggen">KM</button>
          </td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`}
</div>`;

    document.getElementById("mgrNewVehicle")?.addEventListener("click", () => openVehicleModal(null));
    content.querySelectorAll(".mgr-veh-edit").forEach(btn => {
      btn.addEventListener("click", () => openVehicleModal(vehicles.find(v => v.id === btn.dataset.id)));
    });
    content.querySelectorAll(".mgr-veh-mileage").forEach(btn => {
      btn.addEventListener("click", () => openMileageModal(btn.dataset.id, btn.dataset.name, Number(btn.dataset.mileage)));
    });
  }

  // ── Vehicle modal ──────────────────────────────────────────
  function openVehicleModal(vehicle) {
    const isEdit = !!vehicle;
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
<div style="background:#fff;border-radius:14px;width:100%;max-width:460px;max-height:90vh;overflow-y:auto;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2);">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
    <h3 style="margin:0;font-size:16px;font-weight:600;">${isEdit ? "Voertuig bewerken" : "Nieuw voertuig"}</h3>
    <button id="vehClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400);">×</button>
  </div>
  <form id="vehForm" style="display:flex;flex-direction:column;gap:12px;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Naam *</label>
        <input name="name" value="${esc(vehicle?.name||"")}" required placeholder="Bestelwagen 1" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;box-sizing:border-box;"></div>
      <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Kenteken</label>
        <input name="plate" value="${esc(vehicle?.plate||"")}" placeholder="1-ABC-234" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;box-sizing:border-box;font-family:monospace;"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Merk</label>
        <input name="brand" value="${esc(vehicle?.brand||"")}" placeholder="Ford" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;box-sizing:border-box;"></div>
      <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Model</label>
        <input name="model" value="${esc(vehicle?.model||"")}" placeholder="Transit" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;box-sizing:border-box;"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Huidige KM-stand</label>
        <input name="mileage" type="number" value="${vehicle?.mileage||""}" placeholder="0" min="0" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;box-sizing:border-box;"></div>
      <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Volgende service</label>
        <input name="nextService" type="date" value="${vehicle?.nextService||""}" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;box-sizing:border-box;"></div>
    </div>
    <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Status</label>
      <select name="status" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;">
        <option value="active" ${!vehicle||vehicle.status==="active"?"selected":""}>Actief</option>
        <option value="maintenance" ${vehicle?.status==="maintenance"?"selected":""}>In onderhoud</option>
        <option value="inactive" ${vehicle?.status==="inactive"?"selected":""}>Inactief</option>
      </select>
    </div>
    <div id="vehErr" style="display:none;color:var(--wf-red);font-size:12px;"></div>
    <div style="display:flex;justify-content:${isEdit?"space-between":"flex-end"};gap:8px;padding-top:4px;">
      ${isEdit ? `<button type="button" id="vehDelete" style="padding:8px 12px;background:var(--wf-red-l);color:var(--wf-red);border:1px solid var(--wf-red-l);border-radius:8px;font-size:12px;cursor:pointer;">Verwijderen</button>` : ""}
      <div style="display:flex;gap:8px;">
        <button type="button" id="vehCancel" style="padding:8px 16px;border:1px solid var(--gray-200);background:#fff;border-radius:8px;font-size:13px;cursor:pointer;">Annuleren</button>
        <button type="submit" style="padding:8px 20px;background:var(--wf-blue);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">${isEdit?"Opslaan":"Aanmaken"}</button>
      </div>
    </div>
  </form>
</div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    document.getElementById("vehClose").addEventListener("click", close);
    document.getElementById("vehCancel").addEventListener("click", close);
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });

    if (isEdit) {
      document.getElementById("vehDelete").addEventListener("click", async () => {
        if (!confirm(`Voertuig "${vehicle.name||vehicle.plate}" verwijderen?`)) return;
        try {
          await api("DELETE", `/vehicles/${vehicle.id}`);
          close(); renderVehicles();
        } catch(e) { window.showToast(e.message, "error"); }
      });
    }

    document.getElementById("vehForm").addEventListener("submit", async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      if (body.mileage) body.mileage = Number(body.mileage);
      const errEl = document.getElementById("vehErr");
      const submitBtn = e.target.querySelector("[type=submit]");
      errEl.style.display = "none";
      submitBtn.disabled = true; submitBtn.textContent = "Bezig…";
      try {
        if (isEdit) await api("PATCH", `/vehicles/${vehicle.id}`, body);
        else await api("POST", "/vehicles", body);
        close(); renderVehicles();
      } catch(err) {
        errEl.textContent = err.message; errEl.style.display = "";
        submitBtn.disabled = false; submitBtn.textContent = isEdit ? "Opslaan" : "Aanmaken";
      }
    });
  }

  // ── Mileage modal ──────────────────────────────────────────
  function openMileageModal(vehicleId, vehicleName, currentMileage) {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
<div style="background:#fff;border-radius:14px;width:100%;max-width:360px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2);">
  <h3 style="margin:0 0 4px;font-size:15px;font-weight:600;">KM-stand loggen</h3>
  <p style="font-size:13px;color:var(--gray-500);margin:0 0 16px;">${esc(vehicleName)} · Huidige stand: <strong>${Number(currentMileage).toLocaleString("nl-BE")} km</strong></p>
  <form id="mileageForm" style="display:flex;flex-direction:column;gap:12px;">
    <div>
      <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Nieuwe KM-stand *</label>
      <input name="mileage" type="number" min="${currentMileage+1}" required placeholder="${currentMileage + 100}"
        style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:8px;font-size:14px;box-sizing:border-box;">
    </div>
    <div>
      <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">Opmerking</label>
      <input name="note" placeholder="Bijv. levering Brussel" style="width:100%;padding:8px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px;box-sizing:border-box;">
    </div>
    <div id="mileageErr" style="display:none;color:var(--wf-red);font-size:12px;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button type="button" id="mileageCancel" style="padding:8px 16px;border:1px solid var(--gray-200);background:#fff;border-radius:8px;font-size:13px;cursor:pointer;">Annuleren</button>
      <button type="submit" style="padding:8px 20px;background:var(--wf-blue);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">Opslaan</button>
    </div>
  </form>
</div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    document.getElementById("mileageCancel").addEventListener("click", close);
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
    document.getElementById("mileageForm").addEventListener("submit", async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const newMileage = Number(fd.get("mileage"));
      if (newMileage <= currentMileage) {
        document.getElementById("mileageErr").textContent = `Nieuwe KM-stand moet hoger zijn dan ${Number(currentMileage).toLocaleString("nl-BE")} km.`;
        document.getElementById("mileageErr").style.display = "";
        return;
      }
      const submitBtn = e.target.querySelector("[type=submit]");
      submitBtn.disabled = true; submitBtn.textContent = "Opslaan…";
      try {
        await api("POST", `/vehicles/${vehicleId}/mileage`, { mileage: newMileage, note: fd.get("note") || undefined });
        close(); renderVehicles();
        window.showToast && window.showToast(`KM-stand bijgewerkt naar ${newMileage.toLocaleString("nl-BE")} km`, "success");
      } catch(err) {
        document.getElementById("mileageErr").textContent = err.message;
        document.getElementById("mileageErr").style.display = "";
        submitBtn.disabled = false; submitBtn.textContent = "Opslaan";
      }
    });
  }

  // ── Rapporten ──────────────────────────────────────────────
  async function renderReports() {
    const content = document.getElementById("mgrContent");
    content.innerHTML = '<div class="mgr-loading">Laden…</div>';
    try {
      const [woData, lvData, expData, dash] = await Promise.all([
        api("GET", "/workorders"),
        api("GET", "/leaves"),
        api("GET", "/expenses"),
        api("GET", "/manager/dashboard")
      ]);
      const workorders = woData.workorders || woData || [];
      const leaves     = lvData.leaves     || lvData     || [];
      const expenses   = expData.expenses  || expData    || [];
      const team       = dash.teamList     || dash.team  || [];
      _renderReportStats(content, workorders, leaves, expenses, team);
    } catch(e) {
      content.innerHTML = `<div style="padding:20px;color:var(--wf-red)">Fout: ${esc(e.message)}</div>`;
    }
  }

  function _renderReportStats(content, workorders, leaves, expenses, team) {
    const period = _mgrReportPeriod; // "YYYY-MM"
    const fmtEur = n => new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(n);

    // Generate last-12-months options
    const monthOpts = [];
    const now = new Date();
    for (let i = 0; i < 13; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const val = d.toISOString().slice(0, 7);
      const label = d.toLocaleDateString("nl-BE", { month: "long", year: "numeric" });
      monthOpts.push(`<option value="${val}" ${val===period?"selected":""}>${label}</option>`);
    }

    // Period-filtered stats
    const woThisPeriod  = workorders.filter(w => (w.createdAt||"").slice(0,7) === period);
    const woDone        = woThisPeriod.filter(w => ["done","Voltooid","Afgewerkt"].includes(w.status)).length;
    const woOpen        = workorders.filter(w => !["done","Voltooid","Afgewerkt","geannuleerd"].includes(w.status)).length;
    const woUrgent      = workorders.filter(w => w.priority === "hoog" && !["done","Voltooid"].includes(w.status)).length;
    const lvPeriod      = leaves.filter(l => (l.startDate||"").slice(0,7) === period);
    const lvApproved    = lvPeriod.filter(l => l.status === "goedgekeurd").length;
    const lvPending     = leaves.filter(l => l.status === "aangevraagd").length;
    const expPeriod     = expenses.filter(e => (e.date||"").slice(0,7) === period);
    const expPending    = expenses.filter(e => ["ingediend","pending"].includes(e.status)).length;
    const expAmt        = expPeriod.reduce((s, e) => s + Number(e.amount||0), 0);
    const expApproved   = expPeriod.filter(e => e.status === "goedgekeurd").reduce((s,e) => s + Number(e.amount||0), 0);

    // Per-person stats for period
    const perPerson = team.map(u => {
      const uWo  = workorders.filter(w => w.userId === u.id);
      const done = uWo.filter(w => ["done","Voltooid","Afgewerkt"].includes(w.status) && (w.createdAt||"").slice(0,7) === period).length;
      const open = uWo.filter(w => !["done","Voltooid","Afgewerkt","geannuleerd"].includes(w.status)).length;
      const uLv  = leaves.filter(l => l.userId === u.id && l.status === "aangevraagd").length;
      const uExp = expenses.filter(e => e.userId === u.id && ["ingediend","pending"].includes(e.status)).length;
      const uExpAmt = expPeriod.filter(e => e.userId === u.id).reduce((s,e) => s + Number(e.amount||0), 0);
      return { ...u, done, open, uLv, uExp, uExpAmt };
    });

    content.innerHTML = `
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
  <h2 style="font-size:17px;font-weight:600;color:var(--gray-900);margin:0">Rapporten</h2>
  <div style="display:flex;align-items:center;gap:8px">
    <label style="font-size:12px;color:var(--gray-500);font-weight:600">Periode:</label>
    <select id="rptPeriod" style="padding:6px 10px;border:1px solid var(--gray-200);border-radius:8px;font-size:13px">
      ${monthOpts.join("")}
    </select>
  </div>
</div>

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:18px">
  <div class="mgr-kpi"><div class="mgr-kpi-label">Werkbonnen open</div><div class="mgr-kpi-value">${woOpen}</div><div class="mgr-kpi-sub">${woUrgent} urgent</div></div>
  <div class="mgr-kpi"><div class="mgr-kpi-label">Voltooid (periode)</div><div class="mgr-kpi-value" style="color:var(--wf-green)">${woDone}</div><div class="mgr-kpi-sub">van ${woThisPeriod.length} aangemaakt</div></div>
  <div class="mgr-kpi"><div class="mgr-kpi-label">Verlof (periode)</div><div class="mgr-kpi-value">${lvApproved}</div><div class="mgr-kpi-sub">${lvPending} te beoordelen</div></div>
  <div class="mgr-kpi"><div class="mgr-kpi-label">Onkosten (periode)</div><div class="mgr-kpi-value">${fmtEur(expAmt)}</div><div class="mgr-kpi-sub">${fmtEur(expApproved)} goedgekeurd · ${expPending} open</div></div>
</div>

<div class="mgr-card">
  <div class="mgr-card-header">
    <h3 class="mgr-card-title">Team overzicht</h3>
    <span style="font-size:11px;color:var(--gray-400)">${period}</span>
  </div>
  <div class="mgr-card-body mgr-table-wrap">
    <table class="mgr-table">
      <thead>
        <tr>
          <th>Medewerker</th>
          <th>WB open</th>
          <th>WB voltooid</th>
          <th>Verlof open</th>
          <th>Onkosten open</th>
          <th>Onkosten (periode)</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${perPerson.length ? perPerson.map(u => `
        <tr>
          <td>
            <div style="font-weight:600;color:var(--gray-900)">${esc(u.name||u.email)}</div>
            <div style="font-size:11px;color:var(--gray-400)">${esc(u.function||u.role||"")}</div>
          </td>
          <td>${u.open > 0 ? `<span style="font-weight:600;color:var(--wf-yellow)">${u.open}</span>` : `<span style="color:var(--gray-400)">0</span>`}</td>
          <td>${u.done > 0 ? `<span style="font-weight:600;color:var(--wf-green)">${u.done}</span>` : `<span style="color:var(--gray-400)">0</span>`}</td>
          <td>${u.uLv > 0 ? `<span style="font-weight:600;color:var(--wf-purple)">${u.uLv}</span>` : `<span style="color:var(--gray-400)">0</span>`}</td>
          <td>${u.uExp > 0 ? `<span style="font-weight:600;color:var(--wf-yellow)">${u.uExp}</span>` : `<span style="color:var(--gray-400)">0</span>`}</td>
          <td style="font-size:12px">${fmtEur(u.uExpAmt)}</td>
          <td><span class="mgr-status ${u.active!==false?"mgr-status-active":"mgr-status-inactive"}">${u.active!==false?"Actief":"Inactief"}</span></td>
        </tr>`).join("") : '<tr><td colspan="7" class="mgr-empty">Geen teamleden</td></tr>'}
      </tbody>
    </table>
  </div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
  <div class="mgr-card">
    <div class="mgr-card-header"><h3 class="mgr-card-title">Top 5 werkbonnen open</h3></div>
    <div class="mgr-card-body">
      ${workorders.filter(w => !["done","Voltooid","Afgewerkt","geannuleerd"].includes(w.status))
        .sort((a,b) => (b.priority==="hoog"?1:0)-(a.priority==="hoog"?1:0))
        .slice(0,5).map(w => `
      <div style="padding:7px 0;border-bottom:1px solid var(--gray-50);display:flex;align-items:center;gap:8px">
        <span style="font-size:10px;font-weight:700;color:${w.priority==="hoog"?"var(--wf-red)":"var(--gray-400)"};background:${w.priority==="hoog"?"var(--wf-red-l)":"var(--gray-50)"};padding:2px 6px;border-radius:4px">${esc(w.priority||"normaal")}</span>
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px">${esc(w.title||"—")}</div>
        <span style="font-size:11px;color:var(--gray-400);flex-shrink:0">${esc(w.userName||w.userId||"—")}</span>
      </div>`).join("") || '<div style="padding:12px 0;font-size:12px;color:var(--gray-400)">Geen open werkbonnen</div>'}
    </div>
  </div>
  <div class="mgr-card">
    <div class="mgr-card-header"><h3 class="mgr-card-title">Verlofaanvragen te beoordelen</h3></div>
    <div class="mgr-card-body">
      ${leaves.filter(l => l.status === "aangevraagd").slice(0,5).map(l => `
      <div style="padding:7px 0;border-bottom:1px solid var(--gray-50);display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;font-weight:600;color:var(--gray-900);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.userName||l.userId||"—")}</div>
          <div style="font-size:11px;color:var(--gray-400)">${esc(l.type||"Verlof")} · ${l.startDate||""}${l.endDate&&l.endDate!==l.startDate?" → "+l.endDate:""}</div>
        </div>
        <div style="display:flex;gap:5px">
          <button class="mgr-btn mgr-btn-success mgr-btn-sm rpt-lv-ok" data-id="${esc(l.id)}" data-name="${esc(l.userName||l.userId||"")}" data-type="${esc(l.type||"Verlof")}">✓</button>
          <button class="mgr-btn mgr-btn-danger mgr-btn-sm rpt-lv-rej" data-id="${esc(l.id)}" data-name="${esc(l.userName||l.userId||"")}" data-type="${esc(l.type||"Verlof")}">✕</button>
        </div>
      </div>`).join("") || '<div style="padding:12px 0;font-size:12px;color:var(--gray-400)">Geen aanvragen</div>'}
    </div>
  </div>
</div>`;

    // Period picker
    document.getElementById("rptPeriod")?.addEventListener("change", e => {
      _mgrReportPeriod = e.target.value;
      _renderReportStats(content, workorders, leaves, expenses, team);
    });

    // Wire leave approve/reject via review modal
    content.querySelectorAll(".rpt-lv-ok").forEach(btn => {
      btn.addEventListener("click", () => openLeaveReviewModal(btn.dataset.id, "goedgekeurd", leaves, () => renderReports()));
    });
    content.querySelectorAll(".rpt-lv-rej").forEach(btn => {
      btn.addEventListener("click", () => openLeaveReviewModal(btn.dataset.id, "geweigerd", leaves, () => renderReports()));
    });
  }

  // ── Init ───────────────────────────────────────────────────
  function init() {
    buildShell();
    applyEntitlements();
    window.WfpBoden && window.WfpBoden.mount({ navigate: switchView });
    try {
      const user = window._wfpCurrentUser || {};
      const name = user.name || user.email || "Manager";
      const el = document.getElementById("mgrUserName");
      if (el) el.textContent = name;
      const av = document.getElementById("mgrUserAvatar");
      if (av) av.textContent = name[0].toUpperCase();
    } catch (_) {}

    // ── Notification bell ────────────────────────────────────
    const mgrBell  = document.getElementById("mgrBellBtn");
    const mgrDot   = document.getElementById("mgrBellDot");
    const mgrPanel = document.getElementById("mgrNotifPanel");
    const mgrList  = document.getElementById("mgrNotifList");
    let _mgrNotifs = [];

    function fmtMgrNotifTime(iso) {
      if (!iso) return "";
      const diff = Math.floor((Date.now() - new Date(iso)) / 60000);
      if (diff < 1) return "Zonet";
      if (diff < 60) return `${diff}m geleden`;
      if (diff < 1440) return `${Math.floor(diff/60)}u geleden`;
      return new Date(iso).toLocaleDateString("nl-BE");
    }

    function renderMgrNotifList() {
      if (!_mgrNotifs.length) {
        mgrList.innerHTML = `<div style="padding:28px;text-align:center;font-size:13px;color:var(--gray-400)">Geen notificaties</div>`;
        return;
      }
      mgrList.innerHTML = _mgrNotifs.slice(0, 15).map(n => {
        const isRead = n.status === "read";
        return `<div class="mgr-notif-item" data-nid="${esc(n.id)}" style="padding:10px 16px;border-bottom:1px solid var(--gray-50);cursor:pointer;display:flex;gap:10px;background:${isRead?"#fff":"var(--wf-blue-l)"}">
          <div style="width:7px;height:7px;border-radius:50%;background:${isRead?"var(--gray-300)":"var(--wf-blue)"};margin-top:5px;flex-shrink:0"></div>
          <div style="flex:1">
            <div style="font-size:12.5px;color:var(--gray-700);font-weight:${isRead?400:600}">${esc(n.title||n.message||"Notificatie")}</div>
            ${n.body ? `<div style="font-size:11.5px;color:var(--gray-500);margin-top:2px">${esc(n.body)}</div>` : ""}
            <div style="font-size:10.5px;color:var(--gray-400);margin-top:2px">${fmtMgrNotifTime(n.createdAt)}</div>
          </div>
        </div>`;
      }).join("");

      mgrList.querySelectorAll(".mgr-notif-item").forEach(item => {
        item.addEventListener("click", async () => {
          const nid = item.dataset.nid;
          const n = _mgrNotifs.find(x => x.id === nid);
          if (!n || n.status === "read") return;
          n.status = "read";
          item.style.background = "#fff";
          item.querySelector("div").style.background = "var(--gray-300)";
          try { await api("POST", `/notifications/${nid}/read`, {}); } catch(_){}
          updateMgrDot();
        });
      });
    }

    function updateMgrDot() {
      const unread = _mgrNotifs.filter(n => n.status !== "read").length;
      if (mgrDot) mgrDot.style.display = unread > 0 ? "" : "none";
    }

    async function loadMgrNotifications() {
      if (document.getElementById("platform-manager")?.classList.contains("hidden")) return;
      try {
        const d = await api("GET", "/notifications");
        _mgrNotifs = d.rows || [];
        updateMgrDot();
        if (mgrPanel.style.display !== "none") renderMgrNotifList();
      } catch(_){}
    }

    mgrBell?.addEventListener("click", async e => {
      e.stopPropagation();
      const isOpen = mgrPanel.style.display === "block";
      mgrPanel.style.display = isOpen ? "none" : "block";
      if (!isOpen) {
        mgrList.innerHTML = `<div style="padding:28px;text-align:center;font-size:13px;color:var(--gray-400)">Laden…</div>`;
        await loadMgrNotifications();
        renderMgrNotifList();
      }
    });

    mgrBell?.addEventListener("mouseover", () => {
      if (mgrBell) mgrBell.style.background = "var(--gray-100)";
    });
    mgrBell?.addEventListener("mouseleave", () => {
      if (mgrBell) mgrBell.style.background = "";
    });

    document.addEventListener("click", e => {
      if (!mgrBell?.contains(e.target) && !mgrPanel?.contains(e.target)) {
        if (mgrPanel) mgrPanel.style.display = "none";
      }
    });

    document.getElementById("mgrNotifMarkAll")?.addEventListener("click", async () => {
      const unread = _mgrNotifs.filter(n => n.status !== "read");
      await Promise.all(unread.map(n => api("POST", `/notifications/${n.id}/read`, {}).catch(() => {})));
      _mgrNotifs.forEach(n => n.status = "read");
      updateMgrDot();
      renderMgrNotifList();
    });

    loadMgrNotifications();
    setInterval(loadMgrNotifications, 30000);

    switchView("dashboard");
  }

  window.wfp_managerInit = init;
}());
