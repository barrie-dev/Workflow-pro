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
    const scope = s.scope === "write" ? tM("mgr.scopeWrite","lezen + schrijven") : tM("mgr.scopeRead","alleen-lezen");
    const b = document.createElement("div");
    b.id = "wfpSupportBanner";
    b.setAttribute("role", "status");
    b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:var(--wf-red);color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:6px 16px;display:flex;align-items:center;justify-content:center;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,.2)";
    const span = document.createElement("span");
    span.textContent = tM("mgr.supportBanner","Support-sessie actief · {a} ({s}). Deze sessie wordt geaudit.").replace("{a}", s.agent || tM("mgr.supportAgent","supportmedewerker")).replace("{s}", scope);
    b.appendChild(span);
    const exit = document.createElement("button");
    exit.textContent = tM("mgr.leaveSession","Sessie verlaten");
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
      <span class="mgr-logo-text">Monargo <small>Manager</small></span>
    </div>
    <nav class="mgr-nav">
      <a class="mgr-nav-item active" data-view="dashboard" href="#" tabindex="0">
        <svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
        <span data-i18n="nav.dashboard">Dagstart</span>
      </a>
      <a class="mgr-nav-item" data-view="team" href="#">
        <svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
        <span data-i18n="nav.team">Mijn team</span>
      </a>
      <a class="mgr-nav-item" data-view="planning" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/></svg>
        <span data-i18n="nav.planning">Planning</span>
      </a>
      <a class="mgr-nav-item" data-view="clocking" href="#">
        <svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>
        <span data-i18n="nav.clocking">Prikklok</span>
      </a>
      <a class="mgr-nav-item" data-view="leaves" href="#">
        <svg viewBox="0 0 24 24"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>
        <span data-i18n="nav.leaves">Verlof</span>
        <span class="mgr-badge" id="mgrLeaveBadge" style="display:none">0</span>
      </a>
      <a class="mgr-nav-item" data-view="expenses" href="#">
        <svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>
        <span data-i18n="nav.expenses">Onkosten</span>
        <span class="mgr-badge" id="mgrExpBadge" style="display:none">0</span>
      </a>
      <a class="mgr-nav-item" data-view="workorders" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        <span data-term="jobPlural">Werkbonnen</span>
      </a>
      <a class="mgr-nav-item" data-view="messages" href="#">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
        <span data-i18n="nav.messages">Berichten</span>
        <span class="mgr-badge" id="mgrMsgBadge" style="display:none">0</span>
      </a>
      <a class="mgr-nav-item" data-view="vehicles" href="#">
        <svg viewBox="0 0 24 24"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>
        <span data-i18n="nav.vehicles">Voertuigen</span>
      </a>
      <a class="mgr-nav-item" data-view="reports" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/></svg>
        <span data-i18n="nav.reports">Rapporten</span>
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
      <button class="mgr-clockbtn" id="mgrLangToggle" title="Changer de langue / Taal wisselen" style="margin-left:auto;">FR</button>
      <button class="mgr-clockbtn" id="mgrClockBtn" title="Klok jezelf in of uit">
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
.mgr-sidebar { width:248px; background:linear-gradient(180deg,#091525 0%,#0b1320 62%,#101d30 100%); color:rgba(255,255,255,.80); border-right:none; display:flex; flex-direction:column; flex-shrink:0; }
.mgr-logo { display:flex; align-items:center; gap:10px; padding:20px 16px; border-bottom:1px solid rgba(255,255,255,.10); }
.mgr-logo-mark { background:var(--wf-blue); color:#fff; width:32px; height:32px; border-radius:9px; display:grid; place-items:center; font-weight:600; font-size:13px; flex-shrink:0; box-shadow:0 4px 12px rgba(0,113,227,.35); }
.mgr-logo-text { font-weight:600; font-size:15px; letter-spacing:-.2px; color:#fff; }
.mgr-nav { padding:12px 8px; flex:1; }
.mgr-nav-item { display:flex; align-items:center; gap:10px; padding:9px 10px; border-radius:9px; color:rgba(255,255,255,.72); text-decoration:none; font-size:13.5px; transition:background .15s,color .15s; }
.mgr-nav-item svg { width:18px; height:18px; fill:currentColor; flex-shrink:0; opacity:.7; }
.mgr-nav-item:hover { background:rgba(255,255,255,.07); color:#fff; }
.mgr-nav-item:hover svg { opacity:1; }
.mgr-nav-item.active { background:linear-gradient(135deg,#0b7bf1,#0067d4); color:#fff; font-weight:600; box-shadow:0 8px 22px rgba(0,113,227,.28),inset 0 1px 0 rgba(255,255,255,.18); }
.mgr-nav-item.active svg { opacity:1; }
.mgr-badge { margin-left:auto; background:var(--wf-red); color:#fff; border-radius:999px; font-size:11px; padding:1px 6px; font-weight:600; }
.mgr-nav-flyout { position:fixed; z-index:240; min-width:200px; max-width:270px; background:var(--ink); border:1px solid rgba(255,255,255,.12); border-radius:12px; padding:8px; box-shadow:var(--shadow-elevated); display:none; flex-direction:column; gap:2px; }
.mgr-nav-flyout.open { display:flex; }
.mgr-nav-flyout-title { font-size:10.5px; font-weight:700; color:rgba(255,255,255,.45); text-transform:uppercase; letter-spacing:.07em; padding:5px 10px 6px; }
.mgr-nav-flyout-item { display:block; width:100%; text-align:left; background:none; border:none; cursor:pointer; font-family:inherit; font-size:13px; font-weight:500; color:rgba(255,255,255,.78); padding:8px 10px; border-radius:8px; transition:background .12s, color .12s; }
.mgr-nav-flyout-item:hover { background:rgba(255,255,255,.08); color:#fff; }
.mgr-sidebar-footer { padding:12px; border-top:1px solid rgba(255,255,255,.10); display:flex; align-items:center; gap:8px; }
.mgr-user-chip { display:flex; align-items:center; gap:8px; flex:1; min-width:0; }
.mgr-user-avatar { width:32px; height:32px; border-radius:50%; background:var(--wf-blue); color:#fff; display:grid; place-items:center; font-weight:600; font-size:13px; flex-shrink:0; }
.mgr-user-info { min-width:0; }
.mgr-user-name { font-size:13px; font-weight:500; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.mgr-user-role { font-size:11px; color:rgba(255,255,255,.55); }
.mgr-logout-btn { background:none; border:none; color:rgba(255,255,255,.55); cursor:pointer; padding:4px; border-radius:6px; }
.mgr-logout-btn:hover { color:#fff; background:rgba(255,255,255,.10); }
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
.mgr-daystart { position:relative; overflow:hidden; display:flex; align-items:center; justify-content:space-between; gap:24px; margin-bottom:18px; padding:22px; border:1px solid rgba(0,113,227,.14); border-radius:20px; background:linear-gradient(120deg,#fff 0%,#f7fbff 58%,#edf6ff 100%); box-shadow:0 18px 55px rgba(11,19,32,.055); }
.mgr-daystart::after { content:""; position:absolute; width:240px; height:240px; right:-90px; top:-150px; border-radius:50%; background:radial-gradient(circle,rgba(0,113,227,.17),transparent 68%); pointer-events:none; }
.mgr-daystart-copy { position:relative; z-index:1; }
.mgr-daystart-copy small { color:var(--wf-blue); font-size:10px; font-weight:750; letter-spacing:.09em; text-transform:uppercase; }
.mgr-daystart-copy h2 { margin:4px 0 5px; color:var(--ink); font-size:23px; letter-spacing:-.6px; }
.mgr-daystart-copy p { margin:0; color:var(--muted); font-size:12.5px; }
.mgr-focus-actions { position:relative; z-index:1; display:grid; grid-template-columns:repeat(4,minmax(112px,1fr)); gap:8px; }
.mgr-focus-btn { border:1px solid rgba(11,19,32,.08); border-radius:13px; background:rgba(255,255,255,.88); min-height:58px; padding:9px 11px; color:var(--ink); text-align:left; font-family:inherit; cursor:pointer; transition:transform .16s,box-shadow .16s,border-color .16s; }
.mgr-focus-btn:hover { transform:translateY(-2px); border-color:rgba(0,113,227,.28); box-shadow:0 12px 28px rgba(11,19,32,.08); }
.mgr-focus-btn strong,.mgr-focus-btn small { display:block; }
.mgr-focus-btn strong { font-size:12px; }
.mgr-focus-btn small { margin-top:2px; color:var(--muted); font-size:9.5px; }
.mgr-btn { min-height:40px; padding:0 18px; border-radius:var(--radius-sm); font-size:14px; font-weight:600; cursor:pointer; border:1px solid transparent; font-family:inherit; line-height:1; white-space:nowrap; display:inline-flex; align-items:center; justify-content:center; gap:6px; transition:background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease); }
.mgr-btn:focus-visible { outline:none; box-shadow:0 0 0 2px rgba(0,113,227,.20); }
.mgr-btn-primary { background:var(--wf-blue); color:#fff; }
.mgr-btn-primary:hover { background:var(--blue-hover); }
.mgr-btn-primary:active { background:var(--blue-active); }
.mgr-btn-success { background:var(--wf-green); color:#fff; }
.mgr-btn-danger { background:var(--wf-red); color:#fff; }
.mgr-btn-danger:hover { background:#b91c1c; }
.mgr-btn-secondary { background:var(--surface); color:var(--ink); border-color:var(--line-strong); }
.mgr-btn-secondary:hover { background:var(--bg); border-color:#bfc7d3; }
.mgr-btn-sm { min-height:32px; padding:0 12px; font-size:13px; border-radius:var(--radius-xs); }
.mgr-kpis { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:14px; margin-bottom:20px; }
.mgr-kpi { background:var(--surface); border-radius:16px; padding:18px; border:1px solid var(--line); }
.mgr-kpi-link { cursor:pointer; transition:border-color .12s, transform .12s; }
.mgr-kpi-link:hover { transform:translateY(-2px); border-color:var(--gray-300); }
.mgr-kpi-label { font-size:12px; color:var(--muted); margin-bottom:6px; }
.mgr-kpi-value { font-size:28px; font-weight:600; color:var(--ink); letter-spacing:-.5px; }
.mgr-kpi-sub { font-size:11.5px; color:var(--gray-400); margin-top:2px; }
.mgr-card { background:var(--surface); border-radius:var(--radius-card); border:1px solid var(--line); box-shadow:var(--shadow-card); margin-bottom:18px; overflow:hidden; }
.mgr-card-header { display:flex; align-items:center; justify-content:space-between; padding:15px 18px; border-bottom:1px solid var(--line); }
.mgr-card-title { font-size:15px; font-weight:600; color:var(--ink); margin:0; letter-spacing:-.2px; }
.mgr-card-body { padding:16px; }
.mgr-table-wrap { overflow-x:auto; }
table.mgr-table { width:100%; border-collapse:collapse; font-size:13px; }
.mgr-table th { text-align:left; padding:12px; color:var(--muted); font-size:12px; font-weight:600; border-bottom:1px solid var(--line); background:var(--surface-subtle); }
.mgr-table td { padding:14px 12px; border-bottom:1px solid var(--gray-100); color:var(--text); vertical-align:middle; }
.mgr-table tr:last-child td { border-bottom:none; }
.mgr-table tr:hover td { background:var(--gray-50); }
.mgr-status { display:inline-flex; align-items:center; gap:5px; height:24px; padding:0 9px; border-radius:999px; font-size:12px; font-weight:600; }
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
  .mgr-daystart { align-items:flex-start; flex-direction:column; }
  .mgr-focus-actions { width:100%; grid-template-columns:repeat(2,minmax(0,1fr)); }
}

/* Monargo Workspace · manager */
.mgr-layout { background:#f6f6f9; }
.mgr-sidebar { width:232px; background:#202343; }
.mgr-logo { min-height:64px; padding:14px; border-color:rgba(255,255,255,.08); }
.mgr-logo-mark { width:34px; height:34px; background:#5b5ce2; border-radius:9px; box-shadow:none; }
.mgr-logo-text { color:#fff; font-size:14px; }
.mgr-logo-text small { margin-left:4px; color:rgba(255,255,255,.58); font-size:12px; }
.mgr-nav { padding:8px 9px; overflow-y:auto; }
.mgr-nav-item { min-height:42px; padding:9px 11px; border-radius:8px; color:rgba(255,255,255,.74); font-size:14px; }
.mgr-nav-item svg { width:16px; height:16px; }
.mgr-nav-item.active { background:#5b5ce2; box-shadow:none; }
.mgr-sidebar-footer { padding:12px 14px; }
.mgr-main { min-width:0; background:#f6f6f9; }
.mgr-topbar { height:58px; padding:0 20px; background:#fff; border-color:#e7e7ed; backdrop-filter:none; }
.mgr-page-title { color:#34364b; font-size:18px; }
.mgr-clockbtn { min-height:40px; padding:0 13px; border-radius:9px; font-size:13px; }
.mgr-content { padding:20px 24px 36px; }
.mgr-daystart { min-height:98px; padding:16px 18px; margin-bottom:10px; background:#fff; border:1px solid #e1e2e8; border-radius:12px; box-shadow:none; }
.mgr-daystart::after { display:none; }
.mgr-daystart-copy small { color:#595bcd; font-size:12px; }
.mgr-daystart-copy h2 { margin:4px 0; color:#292b40; font-size:22px; }
.mgr-daystart-copy p { color:#76798b; font-size:14px; line-height:1.45; }
.mgr-focus-actions { gap:4px; }
.mgr-focus-btn { min-height:68px; padding:11px 13px; background:#fafafd; border:0; border-radius:9px; }
.mgr-focus-btn:hover { transform:none; background:#f2f2ff; border-color:transparent; box-shadow:none; }
.mgr-focus-btn strong { color:#46485d; font-size:14px; }
.mgr-focus-btn small { margin-top:4px; color:#7e8193; font-size:12px; line-height:1.35; }
.mgr-kpis { grid-template-columns:repeat(6,minmax(125px,1fr)); gap:9px; margin-bottom:10px; }
.mgr-kpi { min-height:88px; position:relative; padding:14px 15px; border-color:#e1e2e8; border-radius:11px; overflow:hidden; }
.mgr-kpi::before { content:""; width:20px; height:3px; position:absolute; top:0; left:15px; background:#5b5ce2; border-radius:0 0 3px 3px; }
.mgr-kpi:nth-child(2)::before { background:#00a86b; }.mgr-kpi:nth-child(3)::before,.mgr-kpi:nth-child(4)::before { background:#e98c24; }.mgr-kpi:nth-child(5)::before { background:#df5867; }
.mgr-kpi-link:hover { transform:none; border-color:#cfd0ea; }
.mgr-kpi-label { margin-bottom:6px; font-size:12px; }.mgr-kpi-value { font-size:28px; }.mgr-kpi-sub { font-size:12px; }
.mgr-card { margin-bottom:10px; border-color:#e1e2e8; border-radius:12px; box-shadow:none; }
.mgr-card-header { min-height:58px; padding:13px 17px; }.mgr-card-title { font-size:15px; }.mgr-card-body { padding:17px; }
.mgr-team-grid { gap:10px; }.mgr-team-card { padding:15px; border-color:#e4e4ea; border-radius:10px; }.mgr-team-card-name { font-size:14px; }.mgr-team-card-role { font-size:12px; }
.mgr-btn { min-height:40px; padding:0 15px; border-radius:9px; font-size:14px; }.mgr-btn-sm { min-height:36px; padding:0 11px; font-size:13px; }
.mgr-table th { padding:12px 14px; font-size:12px; }.mgr-table td { padding:13px 14px; font-size:14px; }.mgr-status { min-height:26px; border-radius:6px; font-size:12px; }
#mgrShiftModal>div,#mgrClkAddModal>div,#mgrLeaveModal>div,#mgrOwnExpModal>div,#mgrWoModal>div,#mgrMsgModal>div { width:min(760px,calc(100vw - 40px)) !important; max-width:760px !important; padding:30px !important; }
@media (max-width:1200px) { .mgr-kpis { grid-template-columns:repeat(3,1fr); }.mgr-daystart { align-items:flex-start; flex-direction:column; }.mgr-focus-actions { width:100%; } }
@media (max-width:768px) { .mgr-sidebar { width:270px; }.mgr-content { padding:16px 13px 32px; }.mgr-kpis { grid-template-columns:repeat(2,1fr); } #mgrShiftModal>div,#mgrClkAddModal>div,#mgrLeaveModal>div,#mgrOwnExpModal>div,#mgrWoModal>div,#mgrMsgModal>div { width:100% !important; max-height:calc(100dvh - 24px) !important; padding:22px 18px !important; } }
</style>`;

    el.querySelectorAll(".mgr-nav-item[data-view]").forEach(a => {
      a.addEventListener("click", e => { e.preventDefault(); switchView(a.dataset.view); hideMgrFlyout(true); });
      a.addEventListener("mouseenter", () => showMgrFlyout(a, a.dataset.view));
      a.addEventListener("mouseleave", () => hideMgrFlyout());
    });
    document.getElementById("mgrMenuToggle").addEventListener("click", () => {
      document.getElementById("mgrSidebar").classList.toggle("open");
    });
    document.getElementById("mgrLogoutBtn").addEventListener("click", () => {
      localStorage.removeItem("wfp_token");
      location.reload();
    });
    wireMgrClock();
    // NL/FR/EN: vertaal de nav + herhaal bij taalwissel. De knop cycelt
    // NL → FR → EN en toont de taal waarnaar je overschakelt.
    if (window.wfpI18n) {
      const root = document.getElementById("platform-manager");
      const paintLang = () => {
        const b = document.getElementById("mgrLangToggle");
        if (b) b.textContent = window.wfpI18n.nextLang(window.wfpI18n.lang).toUpperCase();
      };
      window.wfpI18n.apply(root);
      paintLang();
      document.getElementById("mgrLangToggle")?.addEventListener("click", () => window.wfpI18n.cycleLang());
      document.addEventListener("wfp:langchange", () => {
        window.wfpI18n.apply(root); paintLang();
        // t()-gebaseerde scherminhoud herrenderen (titel + huidige view).
        const t = document.getElementById("mgrPageTitle");
        if (t) t.textContent = window.wfpI18n.t(`nav.${_currentView}`, LABELS[_currentView] || _currentView);
        if (_currentView) switchView(_currentView);
      });
    }
  }

  // i18n-helper voor de manager-shell (t()-gebaseerde, dynamisch opgebouwde inhoud).
  function tM(key, fallback) { return window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback; }
  function confirmM(message, title) {
    const dialog = window.wfpAdmin && window.wfpAdmin.askDialog;
    return typeof dialog === "function" ? dialog({ eyebrow: tM("mgr.dialog.action", "Actie controleren"), title, message, confirmLabel: tM("mgr.dialog.confirm", "Bevestigen"), danger: true }) : Promise.resolve(null);
  }
  // Werkbon-status/prioriteit + verlof-type/status vertalen (server = NL/canoniek).
  function tmWoStatus(s) {
    if (!s) return "-";
    const k = String(s).toLowerCase().replace(/\s+/g, "_");
    const map = { open:"dash.woseg.open", nieuw:"dash.woseg.open", in_progress:"dash.woseg.inprog", in_uitvoering:"dash.woseg.inprog", bezig:"dash.woseg.inprog", done:"dash.woseg.done", voltooid:"dash.woseg.done", afgewerkt:"dash.woseg.done", afgerond:"dash.woseg.done", geannuleerd:"dash.woseg.cancelled", cancelled:"dash.woseg.cancelled" };
    return map[k] ? tM(map[k], s) : s;
  }
  function tmWoPrio(p) {
    const k = String(p || "normaal").toLowerCase();
    const map = { hoog:"adm.wo.prioHigh", normaal:"adm.wo.prioNormal", laag:"adm.wo.prioLow" };
    return map[k] ? tM(map[k], p || "normaal") : (p || "normaal");
  }
  function tmLeaveType(tp) {
    const k = String(tp || "").toLowerCase();
    const known = ["vakantie","ziekte","adv","bijzonder","onbetaald","verlof"];
    return known.includes(k) ? tM("adm.ltype." + k, tp || "-") : (tp || "-");
  }
  function tmLeaveStatus(s) {
    const k = String(s || "").toLowerCase();
    const map = { aangevraagd:"adm.lstatus.requested", goedgekeurd:"adm.lstatus.approved", geweigerd:"adm.lstatus.rejected" };
    return map[k] ? tM(map[k], s || "") : (s || "");
  }
  function tmExpStatus(s) {
    const k = String(s || "").toLowerCase();
    const map = { ingediend:"adm.exp.fPending", pending:"adm.exp.fPending", goedgekeurd:"adm.lstatus.approved", approved:"adm.lstatus.approved", geweigerd:"adm.lstatus.rejected" };
    return map[k] ? tM(map[k], s || "") : (s || "");
  }
  function tmVehStatus(s) {
    const k = String(s || "active").toLowerCase();
    const map = { active:"adm.veh.stActive", actief:"adm.veh.stActive", maintenance:"adm.veh.stMaint", inactive:"adm.veh.stInactive", inactief:"adm.veh.stInactive" };
    return map[k] ? tM(map[k], s || "actief") : (s || "actief");
  }
  function mgrMonthNames() {
    const lang = (window.wfpI18n && window.wfpI18n.lang) || "nl";
    const M = {
      nl: ["","Januari","Februari","Maart","April","Mei","Juni","Juli","Augustus","September","Oktober","November","December"],
      fr: ["","Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"],
      en: ["","January","February","March","April","May","June","July","August","September","October","November","December"]
    };
    return M[lang] || M.nl;
  }
  function mgrWeekdayShort() {
    const lang = (window.wfpI18n && window.wfpI18n.lang) || "nl";
    const D = { nl:["Ma","Di","Wo","Do","Vr","Za","Zo"], fr:["Lu","Ma","Me","Je","Ve","Sa","Di"], en:["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] };
    return D[lang] || D.nl;
  }

  // ── Hover-submenu per module (flyout naast de zijbalk) ─────
  // Zelfde patroon als de admin-shell: acties en subonderdelen van de module,
  // GEEN lijstfilters (die staan al in de view zelf).
  function mgrSubmenus() {
    return {
      planning: [
        { label: "+ " + tM("mgr.fly.newShift", "Nieuwe shift"), go: { view: "planning", click: "mgrAddShift" } }
      ],
      clocking: [
        { label: "+ " + tM("mgr.fly.registration", "Registratie"), go: { view: "clocking", click: "mgrClkAdd" } }
      ],
      leaves: [
        { label: tM("adm.leave.tabRequests", "Aanvragen"), go: { view: "leaves", click: "mgrLeaveTabReq" } },
        { label: tM("adm.leave.tabCalendar", "Kalender"), go: { view: "leaves", click: "mgrLeaveTabCal" } },
        { label: tM("adm.leave.tabBalances", "Saldi"), go: { view: "leaves", click: "mgrLeaveTabBal" } },
        { label: "+ " + tM("mgr.fly.register", "Registreren"), go: { view: "leaves", click: "mgrLeaveNew" } }
      ],
      expenses: [
        { label: "+ " + tM("mgr.fly.submitExpense", "Onkost indienen"), go: { view: "expenses", click: "mgrExpOwn" } }
      ],
      workorders: [
        { label: "+ " + ((window.wfpTerms && window.wfpTerms.t("jobSingular")) || tM("emp.wo.default", "Werkbon")), go: { view: "workorders", click: "mgrNewWO" } }
      ]
    };
  }

  let _mgrFlyTimer = null;
  function hideMgrFlyout(now) {
    clearTimeout(_mgrFlyTimer);
    const fly = document.getElementById("mgrNavFlyout");
    if (!fly) return;
    if (now) { fly.classList.remove("open"); return; }
    _mgrFlyTimer = setTimeout(() => fly.classList.remove("open"), 140);
  }

  function showMgrFlyout(anchor, view) {
    if (!window.matchMedia("(hover: hover)").matches) return;
    const items = mgrSubmenus()[view] || [];
    if (!items.length) { hideMgrFlyout(); return; }
    let fly = document.getElementById("mgrNavFlyout");
    if (!fly) {
      fly = document.createElement("div");
      fly.id = "mgrNavFlyout";
      fly.className = "mgr-nav-flyout";
      fly.addEventListener("mouseenter", () => clearTimeout(_mgrFlyTimer));
      fly.addEventListener("mouseleave", () => hideMgrFlyout());
      document.getElementById("platform-manager").appendChild(fly);
    }
    const title = anchor.textContent.trim().replace(/\d+$/, "").trim();
    fly.innerHTML = `<div class="mgr-nav-flyout-title">${esc(title)}</div>`
      + items.map((i, idx) => `<button type="button" class="mgr-nav-flyout-item" data-idx="${idx}">${esc(i.label)}</button>`).join("");
    fly.querySelectorAll(".mgr-nav-flyout-item").forEach(btn => {
      btn.addEventListener("click", () => {
        hideMgrFlyout(true);
        const item = items[Number(btn.dataset.idx)];
        switchView(item.go.view);
        if (!item.go.click) return;
        let tries = 0;
        const t = setInterval(() => {
          tries += 1;
          const target = document.getElementById(item.go.click);
          if (target) { target.click(); clearInterval(t); }
          else if (tries > 25) clearInterval(t);
        }, 120);
      });
    });
    fly.classList.add("open");
    const r = anchor.getBoundingClientRect();
    fly.style.top = `${Math.max(8, Math.min(r.top - 6, window.innerHeight - fly.offsetHeight - 8))}px`;
    fly.style.left = `${r.right + 8}px`;
    clearTimeout(_mgrFlyTimer);
  }

  // ── Persoonlijke prikklok (topbar) · manager kan zichzelf in-/uitklokken ──
  function wireMgrClock() {
    const btn = document.getElementById("mgrClockBtn");
    if (!btn) return;
    const lbl = document.getElementById("mgrClockLbl");
    let active = null, timer = null;
    const paint = () => {
      if (active) {
        const h = (Date.now() - new Date(active.clockedIn).getTime()) / 3600000;
        btn.classList.add("on"); lbl.textContent = `${tM("mgr.clockOut","Uitklokken")} · ${h.toFixed(1)} ${tM("adm.rep.hoursUnit","u")}`;
      } else { btn.classList.remove("on"); lbl.textContent = tM("mgr.clockIn","Inklokken"); }
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
        window.showToast && window.showToast(active ? tM("mgr.clockedOut","Uitgeklokt") : tM("mgr.clockedIn","Ingeklokt"), "success");
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
    document.getElementById("mgrPageTitle").textContent = window.wfpI18n
      ? window.wfpI18n.t(`nav.${view}`, LABELS[view] || view)
      : (LABELS[view] || view);
    document.getElementById("mgrContent").innerHTML = `<div class="mgr-loading">${tM("adm.loading","Laden…")}</div>`;
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

    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Goedemorgen" : hour < 18 ? "Goedemiddag" : "Goedenavond";
    const firstName = (document.getElementById("mgrUserName")?.textContent || "").trim().split(" ")[0];
    const dateLabel = new Intl.DateTimeFormat("nl-BE", { weekday:"long", day:"numeric", month:"long" }).format(new Date());
    content.innerHTML = `
<section class="mgr-daystart">
  <div class="mgr-daystart-copy"><small>${esc(dateLabel)}</small><h2>${greeting}${firstName && firstName !== "Manager" ? `, ${esc(firstName)}` : ""}</h2><p>Stuur bij op uitzonderingen en laat je team doorwerken.</p></div>
  <div class="mgr-focus-actions">
    <button class="mgr-focus-btn" data-focus-view="planning"><strong>Planning</strong><small>Bezetting bijsturen</small></button>
    <button class="mgr-focus-btn" data-focus-view="workorders"><strong>Werkbonnen</strong><small>Uitvoering opvolgen</small></button>
    <button class="mgr-focus-btn" data-focus-view="leaves"><strong>Verlof</strong><small>${dash.pendingLeaves || 0} te verwerken</small></button>
    <button class="mgr-focus-btn" data-focus-view="expenses"><strong>Onkosten</strong><small>${dash.pendingExpenses || 0} te verwerken</small></button>
  </div>
</section>
<div class="mgr-kpis">
  <div class="mgr-kpi mgr-kpi-link" data-goto="team" title="${tM("mgr.toTeam","Naar team")}">
    <div class="mgr-kpi-label">${tM("nav.team","Team")}</div>
    <div class="mgr-kpi-value">${dash.team ?? "-"}</div>
    <div class="mgr-kpi-sub">${tM("nav.employees","Medewerkers")}</div>
  </div>
  <div class="mgr-kpi mgr-kpi-link" data-goto="clocking" title="${tM("mgr.toClocking","Naar prikklok")}">
    <div class="mgr-kpi-label">${tM("mgr.clockedInLabel","Ingeklokt")}</div>
    <div class="mgr-kpi-value" style="color:var(--wf-green)">${dash.clockedIn ?? "-"}</div>
    <div class="mgr-kpi-sub">${tM("mgr.nowActive","Nu actief")}</div>
  </div>
  <div class="mgr-kpi mgr-kpi-link" data-goto="leaves" title="${tM("mgr.toLeaves","Naar verlof")}">
    <div class="mgr-kpi-label">${tM("mgr.absent","Afwezig")}</div>
    <div class="mgr-kpi-value" style="color:var(--wf-yellow)">${dash.absentToday ?? "-"}</div>
    <div class="mgr-kpi-sub">${tM("mgr.today","Vandaag")}</div>
  </div>
  <div class="mgr-kpi mgr-kpi-link" data-goto="leaves" title="${tM("mgr.toLeaves","Naar verlof")}">
    <div class="mgr-kpi-label">${tM("nav.leaves","Verlof")}</div>
    <div class="mgr-kpi-value" style="color:var(--wf-yellow)">${dash.pendingLeaves ?? "-"}</div>
    <div class="mgr-kpi-sub">${tM("mgr.toProcess","Te verwerken")}</div>
  </div>
  <div class="mgr-kpi mgr-kpi-link" data-goto="expenses" title="${tM("mgr.toExpenses","Naar onkosten")}">
    <div class="mgr-kpi-label">${tM("nav.expenses","Onkosten")}</div>
    <div class="mgr-kpi-value" style="color:var(--wf-red)">${dash.pendingExpenses ?? "-"}</div>
    <div class="mgr-kpi-sub">${tM("mgr.toProcess","Te verwerken")}</div>
  </div>
  <div class="mgr-kpi mgr-kpi-link" data-goto="workorders" title="${tM("mgr.toWorkorders","Naar werkbonnen")}">
    <div class="mgr-kpi-label">${(window.wfpTerms && window.wfpTerms.t("jobPlural")) || tM("nav.workorders","Werkbonnen")}</div>
    <div class="mgr-kpi-value" style="color:var(--wf-purple)">${dash.openWorkorders ?? "-"}</div>
    <div class="mgr-kpi-sub">${tM("dash.woseg.open","Open")}</div>
  </div>
</div>

<div class="mgr-card">
  <div class="mgr-card-header">
    <h3 class="mgr-card-title">${tM("mgr.teamToday","Team overzicht · vandaag")}</h3>
    <button class="mgr-btn mgr-btn-primary mgr-btn-sm" id="mgrViewTeam">${tM("mgr.fullTeam","Volledig team")}</button>
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
        <div class="mgr-team-card-role">${u.function||u.jobTitle||u.role||"-"}</div>
        <div class="mgr-team-card-badges">
          ${u.absent ? `<span style="background:var(--wf-red-l);color:var(--wf-red);border-radius:4px;padding:2px 6px;font-size:10px;">${tM("mgr.absent","Afwezig")}</span>` : ""}
          ${u.planned ? `<span style="background:var(--wf-blue-l);color:var(--wf-blue);border-radius:4px;padding:2px 6px;font-size:10px;">${tM("mgr.planned","Ingepland")}</span>` : ""}
        </div>
      </div>`).join("") || `<p style="color:var(--gray-400);font-size:13px;">${tM("mgr.noTeam","Geen teamleden")}</p>`}
    </div>
  </div>
</div>`;

    document.getElementById("mgrViewTeam")?.addEventListener("click", () => switchView("team"));
    document.querySelectorAll("[data-focus-view]").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.focusView)));
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
    <h3 class="mgr-card-title">${team.length} ${tM("mgr.teamMembers","teamleden")}</h3>
  </div>
  <div class="mgr-card-body mgr-table-wrap">
    <table class="mgr-table">
      <thead><tr><th></th><th>${tM("adm.cust.thName","Naam")}</th><th>${tM("mgr.function","Functie")}</th><th>${tM("adm.status","Status")}</th><th>${tM("mgr.absent","Afwezig")}</th><th>${tM("mgr.planned","Ingepland")}</th></tr></thead>
      <tbody>
        ${team.map(u => `
        <tr>
          <td><span class="mgr-avatar">${(u.name||"?")[0].toUpperCase()}</span></td>
          <td>${esc(u.name||u.email)}</td>
          <td>${u.function||u.jobTitle||"-"}</td>
          <td>${u.clockedIn ? `<span class="mgr-status mgr-status-active">${tM("mgr.clockedInLabel","Ingeklokt")}</span>` : `<span class="mgr-status mgr-status-pending">${tM("mgr.notClocked","Niet geklokt")}</span>`}</td>
          <td>${u.absent ? "✓" : "-"}</td>
          <td>${u.planned ? "✓" : "-"}</td>
        </tr>`).join("") || `<tr><td colspan="6" class="mgr-empty">${tM("mgr.noTeam","Geen teamleden")}</td></tr>`}
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

    const MGR_COLORS = [["var(--wf-blue-l)","var(--wf-blue)"],["var(--wf-green-l)","var(--wf-green)"],["var(--wf-yellow-l)","var(--wf-yellow)"],["var(--wf-orange-l)","var(--wf-orange)"],["var(--gray-200)","var(--gray-500)"],["var(--wf-blue-l)","var(--wf-blue-d)"],["var(--wf-red-l)","var(--wf-red)"],["var(--wf-blue-l)","var(--wf-blue)"]];
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
    <h3 class="mgr-card-title">${tM("nav.planning","Planning")}</h3>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <button class="mgr-btn mgr-btn-secondary mgr-btn-sm" id="mgrPrevWeek">‹</button>
      <span style="font-size:12px;font-weight:500;min-width:160px;text-align:center;">${weekLabel}</span>
      <button class="mgr-btn mgr-btn-secondary mgr-btn-sm" id="mgrNextWeek">›</button>
      ${_mgrWeekOffset !== 0 ? `<button class="mgr-btn mgr-btn-secondary mgr-btn-sm" id="mgrTodayWeek">${tM("mgr.now","Nu")}</button>` : ""}
      <button class="mgr-btn mgr-btn-primary mgr-btn-sm" id="mgrAddShift">+ ${tM("mgr.shift","Shift")}</button>
    </div>
  </div>
  <div class="mgr-card-body mgr-table-wrap">
    <table class="mgr-table">
      <thead>
        <tr>
          <th>${tM("adm.thEmployee","Medewerker")}</th>
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
              </div>`).join("")||`<span style="color:var(--gray-200);font-size:11px;">-</span>`}
            </td>`;
          }).join("")}
        </tr>`;}).join("") || `<tr><td colspan="${days.length+1}" class="mgr-empty">${tM("mgr.noShifts","Geen shifts")}</td></tr>`}
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
    <h2 style="font-size:17px;font-weight:600;margin:0;color:var(--gray-900)">${isEdit ? tM("mgr.shiftEdit","Shift bewerken") : tM("mgr.shiftAdd","Shift toevoegen")}</h2>
    <button id="shiftClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400)">×</button>
  </div>
  <form id="shiftForm" style="display:flex;flex-direction:column;gap:14px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("adm.thEmployee","Medewerker")} *</label>
        <select name="userId" required style="width:100%;10px">
          <option value="">${tM("adm.leave.pickEmployee","- Kies medewerker -")}</option>
          ${team.map(u => `<option value="${esc(u.id||u.userId||"")}" ${shift?.userId===(u.id||u.userId)?"selected":""}>${esc(u.name||u.email)}</option>`).join("")}
        </select>
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("adm.date","Datum")} *</label>
        <input name="date" type="date" value="${shift?.date || weekFrom}" required style="width:100%;10px">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("mgr.startTime","Starttijd")} *</label>
        <input name="start" type="time" value="${shift?.start || "07:00"}" required style="width:100%;10px">
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("mgr.endTime","Eindtijd")} *</label>
        <input name="end" type="time" value="${shift?.end || "17:00"}" required style="width:100%;10px">
      </div>
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("mgr.venueSite","Locatie / Werf")}</label>
      <input name="venueId" placeholder="${tM("mgr.venueOpt","Locatie (optioneel)")}" value="${esc(shift?.venueId||shift?.location||"")}" style="width:100%;10px">
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("mgr.note","Notitie")}</label>
      <input name="note" placeholder="${tM("mgr.noteOpt","Optionele notitie")}" value="${esc(shift?.note||"")}" style="width:100%;10px">
    </div>
    <div id="shiftErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:10px;font-size:13px"></div>
    <div style="display:flex;gap:10px;${isEdit?"justify-content:space-between":"justify-content:flex-end"};padding-top:4px">
      ${isEdit ? `<button type="button" id="shiftDelete" style="padding:8px 14px;background:var(--wf-red-l);color:var(--wf-red);border:1px solid var(--wf-red-l);border-radius:8px;font-size:13px;cursor:pointer;">${tM("adm.delete","Verwijderen")}</button>` : ""}
      <div style="display:flex;gap:8px;">
        <button type="button" id="shiftCancel" style="padding:8px 16px;border:1px solid var(--gray-200);background:#fff;border-radius:8px;font-size:13px;cursor:pointer">${tM("adm.cancel","Annuleren")}</button>
        <button type="submit" style="padding:8px 20px;background:var(--wf-blue);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">${isEdit ? tM("adm.save","Opslaan") : tM("adm.createBtn","Aanmaken")}</button>
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
          if (!await confirmM(tM("mgr.shiftDelConfirm","Shift verwijderen voor {n} op {d}?").replace("{n}", shift.userName||shift.userId).replace("{d}", shift.date), tM("mgr.shiftDelTitle", "Shift verwijderen"))) return;
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
        submitBtn.disabled = true; submitBtn.textContent = tM("adm.bill.busy","Bezig…");
        try {
          if (isEdit) await api("PATCH", `/planning/${shift.id}`, body);
          else await api("POST", "/planning", body);
          close(); renderPlanning();
        } catch(err) {
          errEl.textContent = err.message; errEl.style.display = "";
          submitBtn.disabled = false; submitBtn.textContent = isEdit ? tM("adm.save","Opslaan") : tM("adm.createBtn","Aanmaken");
        }
      });
    }).catch(() => {
      window.showToast(tM("mgr.teamLoadFail","Teamleden konden niet geladen worden."), "error");
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
    content.innerHTML = `<div class="mgr-card"><div class="mgr-card-body" style="padding:24px;text-align:center;color:var(--gray-400);">${tM("adm.loading","Laden…")}</div></div>`;

    let clocks;
    try { clocks = await loadMgrClockData(); }
    catch(e) { content.innerHTML = `<div class="mgr-card"><div class="mgr-card-body" style="color:var(--wf-red);padding:24px;">${e.message}</div></div>`; return; }

    const todayStr = new Date().toISOString().slice(0,10);
    const isToday  = _mgrClockDate === todayStr;
    const d        = new Date(_mgrClockDate);
    const dateLabel = d.toLocaleDateString("nl-BE",{weekday:"long",day:"numeric",month:"long",year:"numeric"});

    // KPI counts (canonieke velden: clockIn/clockOut HH:MM + durationMinutes)
    const totalIn  = clocks.filter(c => c.clockIn && !c.clockOut).length;
    const totalAll = clocks.length;
    const totalHours = (clocks.reduce((sum,c) => sum + (c.durationMinutes || 0), 0) / 60).toFixed(1);

    content.innerHTML = `
<div class="mgr-card" style="margin-bottom:16px;">
  <div class="mgr-card-header" style="flex-wrap:wrap;gap:8px;">
    <h3 class="mgr-card-title" style="text-transform:capitalize;">${dateLabel}</h3>
    <div style="display:flex;gap:6px;align-items:center;">
      <button class="mgr-btn mgr-btn-secondary mgr-btn-sm" id="mgrClkPrev">‹ ${tM("mgr.prev","Vorige")}</button>
      ${!isToday ? `<button class="mgr-btn mgr-btn-secondary mgr-btn-sm" id="mgrClkToday">${tM("mgr.today","Vandaag")}</button>` : ""}
      <button class="mgr-btn mgr-btn-secondary mgr-btn-sm" id="mgrClkNext" ${isToday?"disabled":""}>${tM("mgr.next","Volgende")} ›</button>
      <input type="date" id="mgrClkPicker" value="${_mgrClockDate}" style="padding:5px 8px;cursor:pointer" max="${todayStr}">
      <button class="mgr-btn mgr-btn-primary mgr-btn-sm" id="mgrClkAdd" title="${tM("mgr.clkAddTitle","Vergeten prik handmatig toevoegen")}">+ ${tM("mgr.fly.registration","Registratie")}</button>
    </div>
  </div>
  <div class="mgr-card-body" style="display:flex;gap:16px;flex-wrap:wrap;padding-bottom:0;">
    <div class="mgr-kpi"><div class="mgr-kpi-val">${totalAll}</div><div class="mgr-kpi-lbl">${tM("mgr.registrations","Registraties")}</div></div>
    <div class="mgr-kpi"><div class="mgr-kpi-val" style="color:var(--wf-green);">${totalIn}</div><div class="mgr-kpi-lbl">${tM("mgr.stillClockedIn","Nog ingeklokt")}</div></div>
    <div class="mgr-kpi"><div class="mgr-kpi-val">${totalHours}</div><div class="mgr-kpi-lbl">${tM("adm.rep.totalHours","Totaal uren")}</div></div>
  </div>
</div>

<div class="mgr-card">
  <div class="mgr-card-body mgr-table-wrap" style="padding-top:0;">
    <table class="mgr-table">
      <thead><tr><th>${tM("adm.thEmployee","Medewerker")}</th><th>${tM("adm.clk.clockIn","Inkloktijd")}</th><th>${tM("adm.clk.clockOut","Uitkloktijd")}</th><th>${tM("adm.clk.hours","Uren")}</th><th>${tM("adm.status","Status")}</th><th>${tM("adm.actions","Acties")}</th></tr></thead>
      <tbody>
        ${clocks.map(c => {
          const stillIn = c.clockIn && !c.clockOut;
          const h = c.durationMinutes != null ? (c.durationMinutes/60).toFixed(1) : "-";
          const marker = c.corrected
            ? ` <span class="mgr-status" style="background:var(--wf-yellow-l);color:#92400e;" title="${tM("mgr.correctedTitle","Tijden gecorrigeerd door een beheerder")}">${tM("mgr.corrected","gecorrigeerd")}</span>`
            : (c.manual ? ` <span class="mgr-status" style="background:var(--gray-100);color:var(--gray-600);" title="${tM("mgr.manualTitle","Handmatig geregistreerd")}">${tM("mgr.manual","manueel")}</span>` : "");
          return `<tr>
            <td>${esc(c.userName||c.userId)}</td>
            <td>${esc(c.clockIn || "-")}</td>
            <td>${stillIn ? `<span style="color:var(--wf-yellow)">${tM("mgr.stillIn","nog ingeklokt")}</span>` : esc(c.clockOut || "-")}</td>
            <td>${h}</td>
            <td>${stillIn
              ? `<span class="mgr-status mgr-status-active">${tM("mgr.clockedInLabel","Ingeklokt")}</span>`
              : `<span class="mgr-status mgr-status-inactive">${tM("adm.clk.clockedOut","Uitgeklokt")}</span>`}${marker}</td>
            <td style="white-space:nowrap;">
              <button class="mgr-btn mgr-btn-secondary mgr-btn-sm mgr-clk-edit" data-id="${esc(c.id)}"
                data-cin="${esc(c.clockIn||"")}" data-cout="${esc(c.clockOut||"")}" data-name="${esc(c.userName||c.userId)}"
                title="${tM("mgr.correctTimes","Corrigeer tijden")}" style="font-size:12px;">${tM("adm.clk.correct","Corrigeer")}</button>
              ${stillIn ? `<button class="mgr-btn mgr-btn-danger mgr-btn-sm mgr-clk-forceout" data-id="${esc(c.id)}" data-name="${esc(c.userName||c.userId)}"
                title="${tM("mgr.forceOutTitle","Nu uitkloppen")}" style="font-size:12px;margin-left:4px;">${tM("mgr.forceOut","Uitkloppen")}</button>` : ""}
            </td>
          </tr>`;
        }).join("") || `<tr><td colspan="6" class="mgr-empty">${tM("mgr.noClocksDate","Geen registraties voor deze datum")}</td></tr>`}
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
        if (!await confirmM(tM("mgr.forceOutConfirm","{n} nu uitkloppen?").replace("{n}", name), tM("mgr.forceOutTitle", "Medewerker uitklokken"))) return;
        btn.disabled = true; btn.textContent = "…";
        try {
          await api("PATCH", `/clocks/${btn.dataset.id}`, { clockOut: new Date().toTimeString().slice(0, 5), note: tM("mgr.clockedOutByMgr","Uitgeklokt door manager") });
          renderClocking();
        } catch(e) { window.showToast(e.message, "error"); btn.disabled = false; btn.textContent = tM("mgr.forceOut","Uitkloppen"); }
      });
    });
    document.getElementById("mgrClkAdd")?.addEventListener("click", openManualClockModal);
  }

  // ── Handmatige registratie: vergeten prik toevoegen voor een teamlid ──
  function openManualClockModal() {
    api("GET", "/manager/dashboard").catch(() => ({ teamList: [] })).then(dash => {
      const team = dash.teamList || [];
      let modal = document.getElementById("mgrClkAddModal");
      if (!modal) {
        modal = document.createElement("div");
        modal.id = "mgrClkAddModal";
        modal.style.cssText = "position:fixed;inset:0;background:rgba(11,19,32,.42);z-index:600;display:flex;align-items:center;justify-content:center;padding:16px";
        document.body.appendChild(modal);
      }
      modal.innerHTML = `
<div style="background:#fff;border-radius:14px;width:420px;max-width:100%;padding:24px;box-shadow:0 20px 60px rgba(11,19,32,.2)">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
    <h2 style="font-size:16px;font-weight:600;margin:0;color:var(--gray-900)">${tM("mgr.clkAddTitle2","Registratie toevoegen")}</h2>
    <button id="clkAddClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400)">×</button>
  </div>
  <form id="mgrClkAddForm" style="display:flex;flex-direction:column;gap:14px">
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("adm.thEmployee","Medewerker")} *</label>
      <select name="userId" required style="width:100%;">
        <option value="">${tM("mgr.chooseEmployee","Kies een medewerker")}</option>
        ${(window._wfpCurrentUser ? `<option value="${esc(window._wfpCurrentUser.id)}">${tM("mgr.myself","Mezelf")} (${esc(window._wfpCurrentUser.name || window._wfpCurrentUser.email || "")})</option>` : "")}
        ${team.filter(u => !window._wfpCurrentUser || u.id !== window._wfpCurrentUser.id).map(u => `<option value="${esc(u.id)}">${esc(u.name || u.email)}</option>`).join("")}
      </select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("adm.date","Datum")} *</label>
        <input name="date" type="date" required value="${_mgrClockDate}" max="${new Date().toISOString().slice(0,10)}" style="width:100%;">
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("adm.leave.from","Van")} *</label>
        <input name="clockIn" type="time" required value="07:00" style="width:100%;">
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("adm.leave.to","Tot")}</label>
        <input name="clockOut" type="time" style="width:100%;">
      </div>
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("mgr.reason","Reden")} *</label>
      <input name="note" required placeholder="${tM("mgr.reasonInPh","bv. vergeten in te klokken")}" style="width:100%;">
    </div>
    <div id="clkAddErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:10px;font-size:13px"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button type="button" id="clkAddCancel2" style="padding:8px 16px;border:1px solid var(--line-strong);background:#fff;border-radius:10px;font-size:13px;cursor:pointer">${tM("adm.cancel","Annuleren")}</button>
      <button type="submit" style="padding:8px 20px;background:var(--wf-blue);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer">${tM("mgr.add","Toevoegen")}</button>
    </div>
  </form>
</div>`;
      const close = () => modal.remove();
      document.getElementById("clkAddClose").addEventListener("click", close);
      document.getElementById("clkAddCancel2").addEventListener("click", close);
      modal.addEventListener("click", e => { if (e.target === modal) close(); });
      document.getElementById("mgrClkAddForm").addEventListener("submit", async e => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target).entries());
        if (!body.clockOut) delete body.clockOut;
        const errEl = document.getElementById("clkAddErr");
        const btn = e.target.querySelector("[type=submit]");
        btn.disabled = true; btn.textContent = tM("adm.bill.busy","Bezig…");
        try {
          await api("POST", "/clocks/manual", body);
          window.showToast && window.showToast(tM("mgr.regAdded","Registratie toegevoegd"), "success");
          close();
          renderClocking();
        } catch (err) {
          errEl.textContent = err.message; errEl.style.display = "";
          btn.disabled = false; btn.textContent = tM("mgr.add","Toevoegen");
        }
      });
    });
  }

  function openClockCorrectionModal({ id, cin, cout, name }) {
    const modal = document.createElement("div");
    modal.style.cssText = "position:fixed;inset:0;background:rgba(11,19,32,.42);z-index:600;display:flex;align-items:center;justify-content:center;padding:16px";
    modal.innerHTML = `
<div style="background:#fff;border-radius:14px;width:420px;max-width:100%;padding:24px;box-shadow:0 20px 60px rgba(11,19,32,.2)">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
    <h2 style="font-size:16px;font-weight:600;margin:0;color:var(--gray-900)">${tM("mgr.clkCorrectTitle","Kloktijd corrigeren")}</h2>
    <button id="clkCorrClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400)">×</button>
  </div>
  <div style="font-size:13px;color:var(--gray-500);margin-bottom:16px;">${tM("adm.thEmployee","Medewerker")}: <strong>${esc(name)}</strong> · ${tM("mgr.currentTimes","huidige tijden")}: ${esc(cin || "-")} ${tM("adm.leave.to","tot").toLowerCase()} ${esc(cout || tM("mgr.stillIn","nog ingeklokt"))}</div>
  <form id="clkCorrForm" style="display:flex;flex-direction:column;gap:14px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("adm.clk.clockIn","Inkloktijd")} *</label>
        <input name="clockIn" type="time" value="${esc(cin || "")}" required style="width:100%;">
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("mgr.clockOutEmpty","Uitkloktijd (leeg = nog ingeklokt)")}</label>
        <input name="clockOut" type="time" value="${esc(cout || "")}" style="width:100%;">
      </div>
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("mgr.correctionReason","Reden van correctie")} *</label>
      <input name="note" required placeholder="${tM("mgr.reasonOutPh","bv. vergeten uit te klokken")}" style="width:100%;">
    </div>
    <div style="font-size:11.5px;color:var(--gray-400);">${tM("mgr.auditNote","De originele tijden blijven bewaard in het correctiespoor (audit).")}</div>
    <div id="clkCorrErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:10px;font-size:13px"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button type="button" id="clkCorrCancel" style="padding:8px 16px;border:1px solid var(--line-strong);background:#fff;border-radius:10px;font-size:13px;cursor:pointer">${tM("adm.cancel","Annuleren")}</button>
      <button type="submit" style="padding:8px 20px;background:var(--wf-blue);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer">${tM("adm.save","Opslaan")}</button>
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
        const patch = { clockIn: fd.clockIn, note: fd.note };
        // Expliciet leeggemaakt veld = terug naar "nog ingeklokt".
        patch.clockOut = fd.clockOut ? fd.clockOut : null;
        await api("PATCH", `/clocks/${id}`, patch);
        window.showToast && window.showToast("Kloktijd gecorrigeerd", "success");
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
    <h3 class="mgr-card-title">${tM("nav.leaves","Verlof")}</h3>
    <div style="display:flex;gap:6px;">
      <button class="mgr-btn mgr-btn-sm ${_mgrLeaveTab==="aanvragen"?"mgr-btn-primary":"mgr-btn-secondary"}" id="mgrLeaveTabReq">${tM("adm.leave.tabRequests","Aanvragen")}</button>
      <button class="mgr-btn mgr-btn-sm ${_mgrLeaveTab==="kalender"?"mgr-btn-primary":"mgr-btn-secondary"}" id="mgrLeaveTabCal">${tM("adm.leave.tabCalendar","Kalender")}</button>
      <button class="mgr-btn mgr-btn-sm ${_mgrLeaveTab==="saldi"?"mgr-btn-primary":"mgr-btn-secondary"}" id="mgrLeaveTabBal">${tM("adm.leave.tabBalances","Saldi")}</button>
      <button class="mgr-btn mgr-btn-primary mgr-btn-sm" id="mgrLeaveNew">+ ${tM("mgr.fly.register","Registreren")}</button>
    </div>
  </div>
  <div class="mgr-card-body" id="mgrLeaveBody" style="padding:0;"></div>
</div>`;

    document.getElementById("mgrLeaveTabReq").addEventListener("click", () => { _mgrLeaveTab = "aanvragen"; renderMgrLeaveBody(); });
    document.getElementById("mgrLeaveTabCal").addEventListener("click", () => { _mgrLeaveTab = "kalender"; renderMgrLeaveBody(); });
    document.getElementById("mgrLeaveTabBal").addEventListener("click", () => { _mgrLeaveTab = "saldi"; renderMgrLeaveBody(); });
    document.getElementById("mgrLeaveNew").addEventListener("click", openLeaveModal);
    renderMgrLeaveBody();
  }

  // ── Verlof registreren voor een teamlid (bv. ziektemelding) ──
  // Registreert de manager het voor iemand anders, dan is het meteen goedgekeurd
  // (de manager is de goedkeurder); eigen verlof gaat als aanvraag naar de admin.
  function openLeaveModal() {
    api("GET", "/manager/dashboard").catch(() => ({ teamList: [] })).then(dash => {
      const team = dash.teamList || [];
      let modal = document.getElementById("mgrLeaveModal");
      if (!modal) {
        modal = document.createElement("div");
        modal.id = "mgrLeaveModal";
        modal.style.cssText = "position:fixed;inset:0;background:rgba(11,19,32,.42);z-index:500;display:flex;align-items:center;justify-content:center;padding:16px";
        document.body.appendChild(modal);
      }
      const today = new Date().toISOString().slice(0, 10);
      modal.innerHTML = `
<div style="background:#fff;border-radius:14px;width:440px;max-width:100%;max-height:90vh;overflow-y:auto;padding:24px;box-shadow:0 20px 60px rgba(11,19,32,.2)">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
    <h2 style="font-size:17px;font-weight:600;margin:0;color:var(--gray-900)">${tM("mgr.leaveRegister","Verlof registreren")}</h2>
    <button id="lvClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400)">×</button>
  </div>
  <form id="lvForm" style="display:flex;flex-direction:column;gap:14px">
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("adm.thEmployee","Medewerker")} *</label>
      <select name="userId" required style="width:100%;">
        <option value="">${tM("mgr.chooseEmployee","Kies een medewerker")}</option>
        ${(window._wfpCurrentUser ? `<option value="${esc(window._wfpCurrentUser.id)}">${tM("mgr.myself","Mezelf")} (${esc(window._wfpCurrentUser.name || window._wfpCurrentUser.email || "")})</option>` : "")}
        ${team.filter(u => !window._wfpCurrentUser || u.id !== window._wfpCurrentUser.id).map(u => `<option value="${esc(u.id)}">${esc(u.name || u.email)}</option>`).join("")}
      </select>
      <div style="font-size:11.5px;color:var(--gray-400);margin-top:4px;">${tM("mgr.leaveRegisterNote","Voor een teamlid: meteen goedgekeurd. Voor jezelf: aanvraag ter goedkeuring door de beheerder.")}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("adm.leave.thType","Type")}</label>
        <select name="type" style="width:100%;">
          <option value="ziekte">${tM("adm.ltype.ziekte","Ziekte")}</option>
          <option value="vakantie">${tM("adm.ltype.vakantie","Vakantie")}</option>
          <option value="overmacht">${tM("mgr.ltForceMajeure","Overmacht")}</option>
          <option value="educatie">${tM("mgr.ltEducational","Educatief")}</option>
          <option value="onbetaald">${tM("adm.ltype.onbetaald","Onbetaald")}</option>
        </select>
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("mgr.reasonOptional","Reden (optioneel)")}</label>
        <input name="reason" placeholder="${tM("mgr.reasonFluPh","bv. griep")}" style="width:100%;">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("adm.leave.from","Van")} *</label>
        <input name="startDate" type="date" required value="${today}" style="width:100%;">
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("mgr.upToAndIncl","Tot en met")} *</label>
        <input name="endDate" type="date" required value="${today}" style="width:100%;">
      </div>
    </div>
    <div id="lvErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:10px;font-size:13px"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:4px">
      <button type="button" id="lvCancel" style="padding:8px 16px;border:1px solid var(--line-strong);background:#fff;border-radius:10px;font-size:13px;cursor:pointer">${tM("adm.cancel","Annuleren")}</button>
      <button type="submit" style="padding:8px 20px;background:var(--wf-blue);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer">${tM("mgr.fly.register","Registreren")}</button>
    </div>
  </form>
</div>`;
      const close = () => modal.remove();
      document.getElementById("lvClose").addEventListener("click", close);
      document.getElementById("lvCancel").addEventListener("click", close);
      modal.addEventListener("click", e => { if (e.target === modal) close(); });
      document.getElementById("lvForm").addEventListener("submit", async e => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target).entries());
        const errEl = document.getElementById("lvErr");
        const btn = e.target.querySelector("[type=submit]");
        btn.disabled = true; btn.textContent = tM("adm.bill.busy","Bezig…");
        try {
          await api("POST", "/leaves", body);
          const own = window._wfpCurrentUser && body.userId === window._wfpCurrentUser.id;
          window.showToast && window.showToast(own ? tM("mgr.leaveReqSubmitted","Verlofaanvraag ingediend (ter goedkeuring)") : tM("mgr.leaveRegApproved","Verlof geregistreerd en goedgekeurd"), "success");
          close();
          renderLeaves();
        } catch (err) {
          errEl.textContent = err.message; errEl.style.display = "";
          btn.disabled = false; btn.textContent = tM("mgr.fly.register","Registreren");
        }
      });
    });
  }

  async function renderMgrLeaveBody() {
    ["aanvragen","kalender","saldi"].forEach(t => {
      const id = t==="aanvragen"?"mgrLeaveTabReq":t==="kalender"?"mgrLeaveTabCal":"mgrLeaveTabBal";
      const btn = document.getElementById(id);
      if (btn) btn.className = `mgr-btn mgr-btn-sm ${_mgrLeaveTab===t?"mgr-btn-primary":"mgr-btn-secondary"}`;
    });

    const body = document.getElementById("mgrLeaveBody");
    if (!body) return;
    body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--gray-400);font-size:13px;">${tM("adm.loading","Laden…")}</div>`;

    if (_mgrLeaveTab === "aanvragen") {
      const data = await api("GET", "/leaves");
      const leaves = data.leaves || data || [];

      // update badge
      const pending = leaves.filter(l => l.status === "aangevraagd").length;
      const badge = document.getElementById("mgrLeaveBadge");
      if (badge) { badge.textContent = pending; badge.style.display = pending ? "" : "none"; }

      body.innerHTML = `<div class="mgr-table-wrap">
        <table class="mgr-table">
          <thead><tr><th>${tM("adm.thEmployee","Medewerker")}</th><th>${tM("adm.leave.thType","Type")}</th><th>${tM("adm.leave.from","Van")}</th><th>${tM("adm.leave.to","Tot")}</th><th>${tM("adm.leave.thReason","Reden")}</th><th>${tM("adm.status","Status")}</th><th>${tM("adm.actions","Acties")}</th></tr></thead>
          <tbody>
            ${leaves.map(l => `
            <tr>
              <td>${esc(l.userName||l.userId)}</td>
              <td>${esc(tmLeaveType(l.type))}</td>
              <td>${esc(l.startDate)}</td>
              <td>${esc(l.endDate)}</td>
              <td style="font-size:12px;color:var(--gray-500);max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(l.reason||"")}">${esc(l.reason||"-")}</td>
              <td><span class="mgr-status mgr-status-${l.status}">${esc(tmLeaveStatus(l.status))}</span></td>
              <td>${l.status==="aangevraagd" ? `
                <button class="mgr-btn mgr-btn-success mgr-btn-sm mgr-leave-approve" data-id="${esc(l.id)}" data-dec="goedgekeurd">${tM("adm.leave.approveShort","Goed")}</button>
                <button class="mgr-btn mgr-btn-danger mgr-btn-sm mgr-leave-approve" data-id="${esc(l.id)}" data-dec="geweigerd">${tM("adm.leave.reject","Weigeren")}</button>
              ` : `<span style="font-size:11px;color:var(--gray-400);">${l.reviewNote ? `${esc(l.reviewNote)}` : "-"}</span>`}</td>
            </tr>`).join("") || `<tr><td colspan="7" class="mgr-empty">${tM("mgr.noRequests","Geen aanvragen")}</td></tr>`}
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
    const MONTHS_NL = mgrMonthNames();

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
    <span style="font-size:12px;color:var(--gray-500);margin-left:8px;">${leaves.length} ${tM("mgr.leavesLc","verloven")}</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px;">
    ${mgrWeekdayShort().map(d=>`<div style="text-align:center;font-size:11px;font-weight:600;color:var(--gray-500);padding:4px 0;">${d}</div>`).join("")}
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
      container.innerHTML = `<div style="padding:24px;text-align:center;color:var(--gray-400);">${tM("adm.leave.noEmployees","Geen medewerkers gevonden.")}</div>`;
      return;
    }
    const dAbbr = tM("adm.leave.daysAbbr","d");
    container.innerHTML = `
<div style="padding:16px;">
  <div style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">${tM("mgr.leaveBalance","Vakantiesaldo")} ${year}</div>
  <table class="mgr-table">
    <thead><tr><th>${tM("adm.thEmployee","Medewerker")}</th><th>${tM("adm.leave.thQuota","Quota")}</th><th>${tM("adm.leave.thUsed","Gebruikt")}</th><th>${tM("adm.leave.thRemaining","Resterend")}</th><th>${tM("adm.leave.thProgress","Voortgang")}</th></tr></thead>
    <tbody>${balance.map(b => {
      const pct = b.quota ? Math.min(100, Math.round((b.used/b.quota)*100)) : 0;
      const color = pct>=90?"var(--wf-red)":pct>=70?"var(--wf-yellow)":"var(--wf-green)";
      return `<tr>
        <td><div style="font-weight:500;">${esc(b.name)}</div><div style="font-size:11px;color:var(--gray-400);">${esc(b.email)}</div></td>
        <td>${b.quota}${dAbbr}</td><td>${b.used}${dAbbr}</td>
        <td style="font-weight:600;color:${b.remaining<=2?"var(--wf-red)":b.remaining<=5?"var(--wf-yellow)":"var(--wf-green)"};">${b.remaining}${dAbbr}</td>
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
    const label = isApprove ? tM("adm.leave.approveTitle","Verlof goedkeuren") : tM("adm.leave.rejectTitle","Verlof weigeren");
    const btnClass = isApprove ? "mgr-btn-success" : "mgr-btn-danger";

    // Build inline modal overlay
    const overlay = document.createElement("div");
    overlay.id = "mgrLeaveModal";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:100%;max-width:400px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2);">
  <div style="font-size:15px;font-weight:600;margin-bottom:4px;">${label}</div>
  <div style="font-size:13px;color:var(--gray-500);margin-bottom:16px;">
    ${esc(leave.userName||leave.userId)} · ${esc(tmLeaveType(leave.type||"verlof"))} · ${leave.startDate} ${tM("mgr.upToAndIncl","t/m").toLowerCase()} ${leave.endDate}
  </div>
  <div style="margin-bottom:16px;">
    <label style="font-size:12px;font-weight:600;color:var(--gray-700);display:block;margin-bottom:4px;">${isApprove?tM("adm.leave.noteOptional","Opmerking (optioneel)"):tM("mgr.noteFeedback","Opmerking (optioneel · geeft feedback aan medewerker)")}</label>
    <textarea id="mgrLeaveNote" rows="3" placeholder="${tM("adm.leave.notePh","Voeg een opmerking toe…")}"
      style="width:100%;resize:vertical;box-sizing:border-box"></textarea>
  </div>
  <div id="mgrLeaveModalErr" style="display:none;color:var(--wf-red);font-size:12px;margin-bottom:8px;"></div>
  <div style="display:flex;gap:8px;justify-content:flex-end;">
    <button id="mgrLeaveModalCancel" class="mgr-btn mgr-btn-secondary mgr-btn-sm">${tM("adm.cancel","Annuleren")}</button>
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
        window.showToast && window.showToast(isApprove ? tM("mgr.leaveApproved","Verlof goedgekeurd") : tM("mgr.leaveRejected","Verlof geweigerd"), isApprove ? "success" : "info");
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
  <div class="mgr-kpi"><div class="mgr-kpi-label">${tM("adm.exp.fPending","In behandeling")}</div><div class="mgr-kpi-value" style="color:var(--wf-yellow)">${pending.length}</div><div class="mgr-kpi-sub">${fmtE(pending.reduce((s,e)=>s+Number(e.amount||0),0))}</div></div>
  <div class="mgr-kpi"><div class="mgr-kpi-label">${tM("adm.lstatus.approved","Goedgekeurd")}</div><div class="mgr-kpi-value" style="color:var(--wf-green)">${approved.length}</div><div class="mgr-kpi-sub">${fmtE(approved.reduce((s,e)=>s+Number(e.amount||0),0))}</div></div>
  <div class="mgr-kpi"><div class="mgr-kpi-label">${tM("adm.exp.totalSubmitted","Totaal ingediend")}</div><div class="mgr-kpi-value">${expenses.length}</div></div>
</div>
<div class="mgr-card">
  <div class="mgr-card-header">
    <h3 class="mgr-card-title">${tM("adm.exp.title","Onkostennota's")}</h3>
    <div style="display:flex;gap:6px;align-items:center;">
      <select id="mgrExpFilter" style="padding:5px 9px;font-size:12px">
        <option value="">${tM("mgr.all","Alle")}</option>
        <option value="ingediend">${tM("adm.exp.fPending","In behandeling")}</option>
        <option value="goedgekeurd">${tM("adm.lstatus.approved","Goedgekeurd")}</option>
        <option value="geweigerd">${tM("adm.lstatus.rejected","Geweigerd")}</option>
      </select>
      <button class="mgr-btn mgr-btn-primary mgr-btn-sm" id="mgrExpOwn" title="${tM("mgr.expOwnTitle","Eigen onkost indienen (ter goedkeuring door de beheerder)")}">+ ${tM("mgr.fly.submitExpense","Onkost indienen")}</button>
    </div>
  </div>
  <div class="mgr-card-body mgr-table-wrap">
    <table class="mgr-table">
      <thead><tr><th>${tM("adm.thEmployee","Medewerker")}</th><th>${tM("adm.date","Datum")}</th><th>${tM("adm.thCategory","Categorie")}</th><th>${tM("adm.amount","Bedrag")}</th><th>${tM("adm.status","Status")}</th><th>${tM("adm.actions","Acties")}</th></tr></thead>
      <tbody id="mgrExpTbody"></tbody>
    </table>
  </div>
</div>`;

    function buildExpRows(rows) {
      return rows.map(e => `<tr>
        <td>${esc(e.userName||e.userId)}</td>
        <td>${esc(e.date)}</td>
        <td>${esc(e.category||"-")}</td>
        <td style="font-weight:600;">€ ${Number(e.amount||0).toFixed(2)}</td>
        <td><span class="mgr-status mgr-status-${e.status}">${esc(tmExpStatus(e.status))}</span>${e.reviewNote?`<div style="font-size:11px;color:var(--gray-500);margin-top:2px;">${esc(e.reviewNote.slice(0,30))}${e.reviewNote.length>30?"…":""}</div>`:""}</td>
        <td style="white-space:nowrap;">${["pending","ingediend"].includes(e.status)?`
          <button class="mgr-btn mgr-btn-success mgr-btn-sm mgr-exp-review" data-id="${e.id}" data-dec="goedgekeurd" data-name="${esc(e.userName||e.userId)}" data-amount="${e.amount}" data-cat="${esc(e.category||"")}">${tM("adm.leave.approveShort","Goed")}</button>
          <button class="mgr-btn mgr-btn-danger  mgr-btn-sm mgr-exp-review" data-id="${e.id}" data-dec="geweigerd"  data-name="${esc(e.userName||e.userId)}" data-amount="${e.amount}" data-cat="${esc(e.category||"")}">${tM("adm.leave.reject","Weigeren")}</button>
        `:"-"}</td>
      </tr>`).join("") || `<tr><td colspan="6" class="mgr-empty">${tM("mgr.noExpenses","Geen onkosten")}</td></tr>`;
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
    document.getElementById("mgrExpOwn")?.addEventListener("click", openOwnExpenseModal);
  }

  // ── Eigen onkost indienen (manager) · gaat als aanvraag naar de beheerder ──
  function openOwnExpenseModal() {
    api("GET", "/workorders").catch(() => ({ workorders: [] })).then(woData => {
      const openWos = (woData.workorders || []).filter(w => !["Voltooid", "Afgewerkt", "geannuleerd"].includes(w.status));
      let modal = document.getElementById("mgrOwnExpModal");
      if (!modal) {
        modal = document.createElement("div");
        modal.id = "mgrOwnExpModal";
        modal.style.cssText = "position:fixed;inset:0;background:rgba(11,19,32,.42);z-index:600;display:flex;align-items:center;justify-content:center;padding:16px";
        document.body.appendChild(modal);
      }
      const today = new Date().toISOString().slice(0, 10);
      modal.innerHTML = `
<div style="background:#fff;border-radius:14px;width:440px;max-width:100%;max-height:90vh;overflow-y:auto;padding:24px;box-shadow:0 20px 60px rgba(11,19,32,.2)">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
    <h2 style="font-size:16px;font-weight:600;margin:0;color:var(--gray-900)">${tM("mgr.expOwnTitle2","Eigen onkost indienen")}</h2>
    <button id="ownExpClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400)">×</button>
  </div>
  <form id="mgrOwnExpForm" style="display:flex;flex-direction:column;gap:14px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("adm.thCategory","Categorie")} *</label>
        <select name="category" required style="width:100%;">
          <option value="transport">${tM("mgr.catTransport","Transport")}</option>
          <option value="maaltijd">${tM("mgr.catMeal","Maaltijd")}</option>
          <option value="materiaal">${tM("mgr.catMaterial","Materiaal")}</option>
          <option value="telefoon">${tM("mgr.catPhone","Telefoon/Internet")}</option>
          <option value="hotel">${tM("mgr.catHotel","Hotel/Verblijf")}</option>
          <option value="overig">${tM("mgr.catOther","Overig")}</option>
        </select>
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("mgr.amountEur","Bedrag (€)")} *</label>
        <input name="amount" type="number" step="0.01" min="0" required placeholder="0.00" style="width:100%;">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("adm.date","Datum")} *</label>
        <input name="date" type="date" required value="${today}" style="width:100%;">
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("adm.thDescription","Omschrijving")} *</label>
        <input name="description" required placeholder="${tM("mgr.forWhatPh","Waarvoor?")}" style="width:100%;">
      </div>
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("mgr.woForCustomer","Werkbon (optioneel · voor doorrekening aan de klant)")}</label>
      <select name="workorderId" style="width:100%;">
        <option value="">${tM("mgr.noWo","Geen werkbon")}</option>
        ${openWos.map(w => `<option value="${esc(w.id)}">${esc(w.number ? w.number + " · " : "")}${esc(w.title || ((window.wfpTerms && window.wfpTerms.t("jobSingular")) || "Werkbon"))}</option>`).join("")}
      </select>
    </div>
    <div id="ownExpErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:10px;font-size:13px"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button type="button" id="ownExpCancel" style="padding:8px 16px;border:1px solid var(--line-strong);background:#fff;border-radius:10px;font-size:13px;cursor:pointer">${tM("adm.cancel","Annuleren")}</button>
      <button type="submit" style="padding:8px 20px;background:var(--wf-blue);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer">${tM("mgr.submit","Indienen")}</button>
    </div>
  </form>
</div>`;
      const close = () => modal.remove();
      document.getElementById("ownExpClose").addEventListener("click", close);
      document.getElementById("ownExpCancel").addEventListener("click", close);
      modal.addEventListener("click", e => { if (e.target === modal) close(); });
      document.getElementById("mgrOwnExpForm").addEventListener("submit", async e => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target).entries());
        if (!body.workorderId) delete body.workorderId;
        const errEl = document.getElementById("ownExpErr");
        const btn = e.target.querySelector("[type=submit]");
        btn.disabled = true; btn.textContent = tM("adm.bill.busy","Bezig…");
        try {
          await api("POST", "/me/expenses", body);
          window.showToast && window.showToast(tM("mgr.expSubmitted","Onkost ingediend (ter goedkeuring)"), "success");
          close();
          renderExpenses();
        } catch (err) {
          errEl.textContent = err.message; errEl.style.display = "";
          btn.disabled = false; btn.textContent = tM("mgr.submit","Indienen");
        }
      });
    });
  }

  function openExpenseReviewModal({ id, dec, name, amount, cat }, onDone) {
    const isApprove = dec === "goedgekeurd";
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:100%;max-width:400px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2);">
  <div style="font-size:15px;font-weight:600;margin-bottom:4px;">${isApprove ? tM("mgr.expApproveTitle","Onkost goedkeuren") : tM("mgr.expRejectTitle","Onkost weigeren")}</div>
  <div style="font-size:13px;color:var(--gray-500);margin-bottom:16px;">${esc(name)} · ${esc(cat)} · <strong>€ ${Number(amount||0).toFixed(2)}</strong></div>
  <div style="margin-bottom:16px;">
    <label style="font-size:12px;font-weight:600;color:var(--gray-700);display:block;margin-bottom:4px;">${isApprove?tM("adm.leave.noteOptional","Opmerking (optioneel)"):tM("mgr.noteRequiredReject","Opmerking (verplicht bij weigering)")}</label>
    <textarea id="expReviewNote" rows="3" placeholder="${isApprove?tM("mgr.approvedForPayout","Goedgekeurd voor uitbetaling…"):tM("mgr.giveReason","Geef een reden op…")}"
      style="width:100%;resize:vertical;box-sizing:border-box"></textarea>
  </div>
  <div id="expReviewErr" style="display:none;color:var(--wf-red);font-size:12px;margin-bottom:8px;"></div>
  <div style="display:flex;gap:8px;justify-content:flex-end;">
    <button id="expReviewCancel" class="mgr-btn mgr-btn-secondary mgr-btn-sm">${tM("adm.cancel","Annuleren")}</button>
    <button id="expReviewConfirm" class="mgr-btn ${isApprove?"mgr-btn-success":"mgr-btn-danger"} mgr-btn-sm">${isApprove?tM("mgr.approve","Goedkeuren"):tM("adm.leave.reject","Weigeren")}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    document.getElementById("expReviewCancel").addEventListener("click", close);
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
    document.getElementById("expReviewConfirm").addEventListener("click", async () => {
      const note = document.getElementById("expReviewNote").value.trim();
      const errEl = document.getElementById("expReviewErr");
      if (!isApprove && !note) { errEl.textContent = tM("mgr.reasonRequiredReject","Geef een reden op bij weigering."); errEl.style.display = ""; return; }
      const confirmBtn = document.getElementById("expReviewConfirm");
      confirmBtn.disabled = true; confirmBtn.textContent = "…";
      try {
        await api("PATCH", `/expenses/${id}`, { status: dec, reviewNote: note || undefined });
        close();
        window.showToast && window.showToast(isApprove ? tM("mgr.expApproved","Onkost goedgekeurd") : tM("mgr.expRejected","Onkost geweigerd"), isApprove ? "success" : "info");
        onDone();
      } catch(e) {
        errEl.textContent = e.message; errEl.style.display = "";
        confirmBtn.disabled = false; confirmBtn.textContent = isApprove ? tM("mgr.approve","Goedkeuren") : tM("adm.leave.reject","Weigeren");
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
    <h3 class="mgr-card-title">${(window.wfpTerms && window.wfpTerms.t("jobPlural")) || tM("nav.workorders","Werkbonnen")} <span style="background:var(--wf-blue-l);color:var(--wf-blue-d);border-radius:999px;padding:2px 9px;font-size:11px;font-weight:600">${workorders.length}</span></h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <input id="woSearch" placeholder="${tM("mgr.woSearchPh","Zoek titel, klant…")}" style="padding:5px 9px;font-size:12px;min-width:160px">
      <select id="woFilter" style="padding:5px 9px;font-size:12px">
        <option value="">${tM("adm.allStatuses","Alle statussen")}</option>
        <option value="open">${tM("dash.woseg.open","Open")}</option>
        <option value="in_progress">${tM("dash.woseg.inprog","In uitvoering")}</option>
        <option value="done">${tM("dash.woseg.done","Voltooid")}</option>
        <option value="geannuleerd">${tM("dash.woseg.cancelled","Geannuleerd")}</option>
      </select>
      <button class="mgr-btn mgr-btn-primary mgr-btn-sm" id="mgrNewWO">+ ${(window.wfpTerms && window.wfpTerms.t("jobSingular")) || tM("emp.wo.default","Werkbon")}</button>
    </div>
  </div>
  <div class="mgr-card-body mgr-table-wrap">
    <table class="mgr-table">
      <thead><tr><th>#</th><th>${tM("adm.thTitle","Titel")}</th><th>${tM("adm.thEmployee","Medewerker")}</th><th>${tM("adm.status","Status")}</th><th>${tM("adm.thPriority","Prioriteit")}</th><th>${tM("adm.date","Datum")}</th><th>${tM("adm.actions","Acties")}</th></tr></thead>
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
    if (!rows.length) return `<tr><td colspan="7" class="mgr-empty">${tM("mgr.noWorkorders","Geen werkbonnen")}</td></tr>`;
    return rows.map(w => `<tr class="mgr-wo-row" data-id="${esc(w.id)}" style="cursor:pointer;">
      <td style="font-family:monospace;font-weight:600">${w.number||w.id.slice(-4)}</td>
      <td><strong>${esc(w.title||"-")}</strong>${w.clientName ? `<br><span style="font-size:11px;color:var(--gray-500)">${esc(w.clientName)}</span>` : ""}</td>
      <td>${esc(w.userName||w.userId||"-")}</td>
      <td><span class="mgr-status ${statusClass[w.status]||"mgr-status-pending"}">${esc(tmWoStatus(w.status))}</span></td>
      <td><span style="font-size:11px;font-weight:600;color:${prioColor[w.priority]||"var(--gray-400)"}">${esc(tmWoPrio(w.priority))}</span></td>
      <td>${w.scheduledDate||w.createdAt?.slice(0,10)||"-"}</td>
      <td style="white-space:nowrap">
        <button class="mgr-btn mgr-btn-secondary mgr-btn-sm wo-detail" data-id="${esc(w.id)}">${tM("adm.cust.detail","Detail")}</button>
        ${w.status !== "done" ? `<button class="mgr-btn mgr-btn-success mgr-btn-sm wo-done" data-id="${esc(w.id)}">${tM("dash.woseg.done","Voltooid")}</button>` : ""}
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
      `<option value="${s}" ${wo.status===s?"selected":""}>${esc(tmWoStatus(s))}</option>`).join("");

    overlay.innerHTML = `
<div style="background:#fff;border-radius:14px;width:540px;max-width:100%;max-height:90vh;overflow-y:auto;padding:0;box-shadow:0 20px 60px rgba(0,0,0,.2)">
  <div style="padding:20px 24px;border-bottom:1px solid var(--gray-100);display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="font-size:11px;color:var(--gray-400);font-weight:600;text-transform:uppercase;letter-spacing:.5px">${(window.wfpTerms && window.wfpTerms.t("jobSingular")) || tM("emp.wo.default","Werkbon")} #${esc(wo.number||wo.id.slice(-6))}</div>
      <h2 style="font-size:17px;font-weight:600;margin:4px 0 0;color:var(--gray-900)">${esc(wo.title||"-")}</h2>
    </div>
    <button id="woDetailClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400);padding:4px 8px">×</button>
  </div>
  <div style="padding:20px 24px;display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div>
      <div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">${tM("adm.status","Status").toUpperCase()}</div>
      <span class="mgr-status ${statusClass[wo.status]||"mgr-status-pending"}">${esc(tmWoStatus(wo.status))}</span>
    </div>
    <div>
      <div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">${tM("adm.thPriority","Prioriteit").toUpperCase()}</div>
      <span style="font-size:13px;font-weight:600;color:${prioColor[wo.priority]||"var(--gray-400)"}">${esc(tmWoPrio(wo.priority))}</span>
    </div>
    <div>
      <div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">${tM("adm.thEmployee","Medewerker").toUpperCase()}</div>
      <span style="font-size:13px">${esc(wo.userName||wo.userId||"-")}</span>
    </div>
    <div>
      <div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">${tM("adm.thCustomer","Klant").toUpperCase()}</div>
      <span style="font-size:13px">${esc(wo.clientName||"-")}</span>
    </div>
    <div>
      <div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">${tM("mgr.plannedOn","Gepland op").toUpperCase()}</div>
      <span style="font-size:13px">${esc(wo.scheduledDate||"-")}</span>
    </div>
    <div>
      <div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">${tM("mgr.createdOn","Aangemaakt").toUpperCase()}</div>
      <span style="font-size:13px">${wo.createdAt ? new Date(wo.createdAt).toLocaleDateString("nl-BE") : "-"}</span>
    </div>
    ${wo.location ? `<div style="grid-column:1/-1"><div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">${tM("mgr.location","Locatie").toUpperCase()}</div><span style="font-size:13px">${esc(wo.location)}</span></div>` : ""}
    ${wo.description ? `<div style="grid-column:1/-1"><div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">${tM("mgr.descriptionCaps","Beschrijving").toUpperCase()}</div><p style="font-size:13px;color:var(--gray-700);margin:0;white-space:pre-wrap;background:var(--gray-50);border-radius:8px;padding:10px">${esc(wo.description)}</p></div>` : ""}
    ${wo.notes ? `<div style="grid-column:1/-1"><div style="font-size:11px;color:var(--gray-400);font-weight:600;margin-bottom:4px">${tM("mgr.notesCaps","Notities").toUpperCase()}</div><p style="font-size:13px;color:var(--gray-700);margin:0;white-space:pre-wrap;background:var(--wf-yellow-l);border-radius:8px;padding:10px">${esc(wo.notes)}</p></div>` : ""}
  </div>
  ${wo.status !== "done" && wo.status !== "geannuleerd" ? `
  <div style="padding:16px 24px;border-top:1px solid var(--gray-100);background:var(--gray-50);border-radius:0 0 14px 14px">
    <div style="font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:8px">${tM("mgr.changeStatus","Status wijzigen")}</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <select id="woDetailStatus">${statusOpts}</select>
      <textarea id="woDetailNote" placeholder="${tM("adm.leave.noteOptional","Opmerking (optioneel)")}" rows="2" style="flex:1;resize:vertical;min-width:150px"></textarea>
      <button id="woDetailSave" class="mgr-btn mgr-btn-primary mgr-btn-sm">${tM("adm.save","Opslaan")}</button>
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
    // Modal opent ALTIJD meteen; team en klanten laden op de achtergrond.
    // Klantenlijst is permission-aware: heeft de manager geen klanten-recht,
    // dan blijft de vrije invoer werken (geen 403-blokkade).
    Promise.all([
      api("GET", "/manager/dashboard").catch(() => ({ teamList: [] })),
      api("GET", "/customers").catch(() => ({ customers: [] })),
    ]).then(([dash, custData]) => {
      const team = dash.teamList || [];
      const customers = custData.customers || [];
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
    <h2 style="font-size:17px;font-weight:600;margin:0;color:var(--gray-900)">${tM("mgr.newWo","Nieuwe werkbon")}</h2>
    <button id="woClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400)">×</button>
  </div>
  <form id="woForm" style="display:flex;flex-direction:column;gap:14px">
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("adm.thTitle","Titel")} *</label>
      <input name="title" required placeholder="${tM("mgr.woTitlePh","Omschrijving van de opdracht")}" style="width:100%;10px">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("adm.thEmployee","Medewerker")}</label>
        <select name="userId" style="width:100%;10px">
          <option value="">${tM("mgr.unassigned","- Niet toegewezen -")}</option>
          ${team.map(u => `<option value="${esc(u.id)}">${esc(u.name||u.email)}</option>`).join("")}
        </select>
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("adm.thCustomer","Klant")}</label>
        ${customers.length ? `
        <select name="customerId" id="mgrWoCustSel" style="width:100%;">
          <option value="">${tM("mgr.chooseCustomer","Kies een klant")}</option>
          ${customers.map(c => `<option value="${esc(c.id)}" data-name="${esc(c.name||"")}">${esc(c.name||c.email||c.id)}</option>`).join("")}
        </select>
        <input name="clientName" id="mgrWoClientName" placeholder="${tM("mgr.orTypeName","Of typ een naam")}" style="width:100%;margin-top:6px;">` : `
        <input name="clientName" placeholder="${tM("mgr.customerName","Naam klant")}" style="width:100%;">`}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("mgr.plannedOn","Gepland op")}</label>
        <input name="scheduledDate" type="date" style="width:100%;10px">
      </div>
      <div>
        <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("adm.thPriority","Prioriteit")}</label>
        <select name="priority" style="width:100%;10px">
          <option value="normaal" selected>${tM("adm.wo.prioNormal","Normaal")}</option>
          <option value="hoog">${tM("adm.wo.prioHigh","Hoog")}</option>
          <option value="laag">${tM("adm.wo.prioLow","Laag")}</option>
        </select>
      </div>
    </div>
    <div id="woErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:10px;font-size:13px"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:4px">
      <button type="button" id="woCancel" style="padding:8px 16px;border:1px solid var(--gray-200);background:#fff;border-radius:8px;font-size:13px;cursor:pointer">${tM("adm.cancel","Annuleren")}</button>
      <button type="submit" style="padding:8px 20px;background:var(--wf-blue);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">${tM("adm.createBtn","Aanmaken")}</button>
    </div>
  </form>
</div>`;
      const close = () => modal.remove();
      document.getElementById("woClose").addEventListener("click", close);
      document.getElementById("woCancel").addEventListener("click", close);
      modal.addEventListener("click", e => { if (e.target === modal) close(); });
      // Klant-selectie vult de naam automatisch in (blijft overschrijfbaar).
      document.getElementById("mgrWoCustSel")?.addEventListener("change", e => {
        const opt = e.target.selectedOptions[0];
        const nameInp = document.getElementById("mgrWoClientName");
        if (opt && nameInp) nameInp.value = opt.dataset.name || "";
      });
      document.getElementById("woForm").addEventListener("submit", async e => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target).entries());
        if (!body.customerId) delete body.customerId;
        const errEl = document.getElementById("woErr");
        const btn = e.target.querySelector("[type=submit]");
        btn.disabled = true; btn.textContent = tM("adm.bill.busy","Bezig…");
        try {
          await api("POST", "/workorders", body);
          close();
          renderWorkorders();
        } catch (err) {
          errEl.textContent = err.message; errEl.style.display = "";
          btn.disabled = false; btn.textContent = tM("adm.createBtn","Aanmaken");
        }
      });
    }).catch(() => window.showToast(tM("mgr.teamLoadFail2","Team kon niet geladen worden."), "error"));
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
    <h3 class="mgr-card-title">${tM("nav.messages","Berichten")}</h3>
    <button class="mgr-btn mgr-btn-primary mgr-btn-sm" id="mgrNewMsg">+ ${tM("mgr.newMessage","Nieuw bericht")}</button>
  </div>
  <div class="mgr-card-body">
    ${messages.length === 0 ? `<div class="mgr-empty">${tM("mgr.noMessages","Geen berichten")}</div>` :
    messages.map(m => `
    <div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--gray-100);align-items:flex-start">
      <div style="width:34px;height:34px;border-radius:50%;background:var(--wf-blue-l);color:var(--wf-blue-d);display:grid;place-items:center;font-size:12px;font-weight:600;flex-shrink:0">${(m.fromName||"?")[0].toUpperCase()}</div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
          <span style="font-size:13px;font-weight:600;color:var(--gray-900)">${esc(m.fromName||m.fromId||"System")}</span>
          <span style="font-size:11px;color:var(--gray-400)">${m.createdAt ? new Date(m.createdAt).toLocaleString("nl-BE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : ""}</span>
          ${!m.read ? `<span style="background:var(--wf-blue);color:#fff;border-radius:4px;padding:1px 6px;font-size:10px">${tM("mgr.newCaps","NIEUW")}</span>` : ""}
        </div>
        <div style="font-size:13px;color:var(--gray-700)">${esc(m.body||m.content||m.message||"")}</div>
        ${m.toName||m.toId ? `<div style="font-size:11px;color:var(--gray-400);margin-top:2px">${tM("mgr.to","Aan")}: ${esc(m.toName||m.toId)}</div>` : ""}
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
    <h2 style="font-size:16px;font-weight:600;margin:0;color:var(--gray-900)">${tM("mgr.newMessage","Nieuw bericht")}</h2>
    <button id="msgClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400)">×</button>
  </div>
  <form id="msgForm" style="display:flex;flex-direction:column;gap:14px">
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("mgr.subject","Onderwerp")} *</label>
      <input name="subject" required placeholder="${tM("mgr.subjectPh","Onderwerp van het bericht")}" style="width:100%;10px">
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("mgr.message","Bericht")} *</label>
      <textarea name="body" required rows="4" placeholder="${tM("mgr.messagePh","Schrijf hier je bericht…")}" style="width:100%;10px;resize:vertical"></textarea>
    </div>
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">${tM("mgr.toRoleEveryone","Aan (rol / iedereen)")}</label>
      <select name="toRole" style="width:100%;10px">
        <option value="all">${tM("adm.wo.allEmployees","Alle medewerkers")}</option>
        <option value="employee">${tM("nav.employees","Medewerkers")}</option>
        <option value="manager">${tM("mgr.managers","Managers")}</option>
      </select>
    </div>
    <div id="msgErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:10px;font-size:13px"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button type="button" id="msgCancel" style="padding:8px 16px;border:1px solid var(--gray-200);background:#fff;border-radius:8px;font-size:13px;cursor:pointer">${tM("adm.cancel","Annuleren")}</button>
      <button type="submit" style="padding:8px 20px;background:var(--wf-blue);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">${tM("mgr.send","Versturen")}</button>
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
      btn.disabled = true; btn.textContent = tM("adm.bill.busy","Bezig…");
      try {
        await api("POST", "/messages", body);
        close(); renderMessages();
      } catch(err) {
        errEl.textContent = err.message; errEl.style.display = "";
        btn.disabled = false; btn.textContent = tM("mgr.send","Versturen");
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
    <h3 class="mgr-card-title">${tM("nav.vehicles","Voertuigen")} <span style="background:var(--wf-blue-l);color:var(--wf-blue-d);border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${vehicles.length}</span></h3>
    <button class="mgr-btn mgr-btn-primary mgr-btn-sm" id="mgrNewVehicle">+ ${tM("mgr.vehicle","Voertuig")}</button>
  </div>
  ${vehicles.length === 0 ? `<div class="mgr-card-body"><div class="mgr-empty">${tM("mgr.noVehicles","Nog geen voertuigen · klik \"+ Voertuig\" om te starten")}</div></div>` : `
  <div class="mgr-card-body mgr-table-wrap">
    <table class="mgr-table">
      <thead><tr><th>${tM("adm.veh.thNamePlate","Naam / Kenteken")}</th><th>${tM("adm.veh.thBrandModel","Merk / Model")}</th><th>${tM("adm.veh.thMileage","KM-stand")}</th><th>${tM("adm.status","Status")}</th><th>${tM("adm.veh.thNextService","Volgende service")}</th><th>${tM("adm.actions","Acties")}</th></tr></thead>
      <tbody>
        ${vehicles.map(v => `<tr>
          <td><strong>${esc(v.name||v.plate||"-")}</strong><br><span style="font-size:11px;color:var(--gray-400);font-family:monospace">${esc(v.plate||"")}</span></td>
          <td>${esc(v.brand||"")} ${esc(v.model||"")}</td>
          <td>${v.mileage ? Number(v.mileage).toLocaleString("nl-BE") + " km" : "-"}</td>
          <td><span class="mgr-status ${statusCss[v.status]||"mgr-status-pending"}">${esc(tmVehStatus(v.status))}</span></td>
          <td>${v.nextService ? new Date(v.nextService).toLocaleDateString("nl-BE") : "-"}</td>
          <td style="white-space:nowrap;">
            <button class="mgr-btn mgr-btn-secondary mgr-btn-sm mgr-veh-edit" data-id="${v.id}" style="margin-right:4px;">${tM("adm.edit","Bewerken")}</button>
            <button class="mgr-btn mgr-btn-secondary mgr-btn-sm mgr-veh-mileage" data-id="${v.id}" data-name="${esc(v.name||v.plate||"")}" data-mileage="${v.mileage||0}" title="${tM("mgr.logKm","KM loggen")}">KM</button>
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
    <h3 style="margin:0;font-size:16px;font-weight:600;">${isEdit ? tM("adm.veh.editTitle","Voertuig bewerken") : tM("adm.veh.newTitle","Nieuw voertuig")}</h3>
    <button id="vehClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400);">×</button>
  </div>
  <form id="vehForm" style="display:flex;flex-direction:column;gap:12px;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">${tM("adm.cust.thName","Naam")} *</label>
        <input name="name" value="${esc(vehicle?.name||"")}" required placeholder="${tM("adm.veh.namePh","Bestelwagen 1")}" style="width:100%;box-sizing:border-box"></div>
      <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">${tM("adm.veh.plate","Kenteken")}</label>
        <input name="plate" value="${esc(vehicle?.plate||"")}" placeholder="1-ABC-234" style="width:100%;box-sizing:border-box;font-family:monospace"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">${tM("adm.veh.brand","Merk")}</label>
        <input name="brand" value="${esc(vehicle?.brand||"")}" placeholder="Ford" style="width:100%;box-sizing:border-box"></div>
      <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">${tM("adm.veh.model","Model")}</label>
        <input name="model" value="${esc(vehicle?.model||"")}" placeholder="Transit" style="width:100%;box-sizing:border-box"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">${tM("adm.veh.curMileage","Huidige KM-stand")}</label>
        <input name="mileage" type="number" value="${vehicle?.mileage||""}" placeholder="0" min="0" style="width:100%;box-sizing:border-box"></div>
      <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">${tM("adm.veh.thNextService","Volgende service")}</label>
        <input name="nextService" type="date" value="${vehicle?.nextService||""}" style="width:100%;box-sizing:border-box"></div>
    </div>
    <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">${tM("adm.status","Status")}</label>
      <select name="status" style="width:100%">
        <option value="active" ${!vehicle||vehicle.status==="active"?"selected":""}>${tM("adm.veh.stActive","Actief")}</option>
        <option value="maintenance" ${vehicle?.status==="maintenance"?"selected":""}>${tM("adm.veh.stMaint","In onderhoud")}</option>
        <option value="inactive" ${vehicle?.status==="inactive"?"selected":""}>${tM("adm.veh.stInactive","Inactief")}</option>
      </select>
    </div>
    <div id="vehErr" style="display:none;color:var(--wf-red);font-size:12px;"></div>
    <div style="display:flex;justify-content:${isEdit?"space-between":"flex-end"};gap:8px;padding-top:4px;">
      ${isEdit ? `<button type="button" id="vehDelete" style="padding:8px 12px;background:var(--wf-red-l);color:var(--wf-red);border:1px solid var(--wf-red-l);border-radius:8px;font-size:12px;cursor:pointer;">${tM("adm.delete","Verwijderen")}</button>` : ""}
      <div style="display:flex;gap:8px;">
        <button type="button" id="vehCancel" style="padding:8px 16px;border:1px solid var(--gray-200);background:#fff;border-radius:8px;font-size:13px;cursor:pointer;">${tM("adm.cancel","Annuleren")}</button>
        <button type="submit" style="padding:8px 20px;background:var(--wf-blue);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">${isEdit?tM("adm.save","Opslaan"):tM("adm.createBtn","Aanmaken")}</button>
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
        if (!await confirmM(tM("adm.veh.deleteConfirm",'Voertuig "{n}" permanent verwijderen?').replace("{n}", vehicle.name||vehicle.plate), tM("adm.veh.deleteTitle", "Voertuig verwijderen"))) return;
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
      submitBtn.disabled = true; submitBtn.textContent = tM("adm.bill.busy","Bezig…");
      try {
        if (isEdit) await api("PATCH", `/vehicles/${vehicle.id}`, body);
        else await api("POST", "/vehicles", body);
        close(); renderVehicles();
      } catch(err) {
        errEl.textContent = err.message; errEl.style.display = "";
        submitBtn.disabled = false; submitBtn.textContent = isEdit ? tM("adm.save","Opslaan") : tM("adm.createBtn","Aanmaken");
      }
    });
  }

  // ── Mileage modal ──────────────────────────────────────────
  function openMileageModal(vehicleId, vehicleName, currentMileage) {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
<div style="background:#fff;border-radius:14px;width:100%;max-width:360px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2);">
  <h3 style="margin:0 0 4px;font-size:15px;font-weight:600;">${tM("mgr.logMileage","KM-stand loggen")}</h3>
  <p style="font-size:13px;color:var(--gray-500);margin:0 0 16px;">${esc(vehicleName)} · ${tM("mgr.currentReading","Huidige stand")}: <strong>${Number(currentMileage).toLocaleString("nl-BE")} km</strong></p>
  <form id="mileageForm" style="display:flex;flex-direction:column;gap:12px;">
    <div>
      <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">${tM("mgr.newMileage","Nieuwe KM-stand")} *</label>
      <input name="mileage" type="number" min="${currentMileage+1}" required placeholder="${currentMileage + 100}"
        style="width:100%;font-size:14px;box-sizing:border-box">
    </div>
    <div>
      <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">${tM("mgr.remark","Opmerking")}</label>
      <input name="note" placeholder="${tM("mgr.deliveryPh","Bijv. levering Brussel")}" style="width:100%;box-sizing:border-box">
    </div>
    <div id="mileageErr" style="display:none;color:var(--wf-red);font-size:12px;"></div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button type="button" id="mileageCancel" style="padding:8px 16px;border:1px solid var(--gray-200);background:#fff;border-radius:8px;font-size:13px;cursor:pointer;">${tM("adm.cancel","Annuleren")}</button>
      <button type="submit" style="padding:8px 20px;background:var(--wf-blue);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;">${tM("adm.save","Opslaan")}</button>
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
        document.getElementById("mileageErr").textContent = tM("mgr.mileageHigher","Nieuwe KM-stand moet hoger zijn dan {n} km.").replace("{n}", Number(currentMileage).toLocaleString("nl-BE"));
        document.getElementById("mileageErr").style.display = "";
        return;
      }
      const submitBtn = e.target.querySelector("[type=submit]");
      submitBtn.disabled = true; submitBtn.textContent = tM("mgr.saving","Opslaan…");
      try {
        await api("POST", `/vehicles/${vehicleId}/mileage`, { mileage: newMileage, note: fd.get("note") || undefined });
        close(); renderVehicles();
        window.showToast && window.showToast(tM("mgr.mileageUpdated","KM-stand bijgewerkt naar {n} km").replace("{n}", newMileage.toLocaleString("nl-BE")), "success");
      } catch(err) {
        document.getElementById("mileageErr").textContent = err.message;
        document.getElementById("mileageErr").style.display = "";
        submitBtn.disabled = false; submitBtn.textContent = tM("adm.save","Opslaan");
      }
    });
  }

  // ── Rapporten ──────────────────────────────────────────────
  async function renderReports() {
    const content = document.getElementById("mgrContent");
    content.innerHTML = `<div class="mgr-loading">${tM("adm.loading","Laden…")}</div>`;
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
      content.innerHTML = `<div style="padding:20px;color:var(--wf-red)">${tM("adm.error","Fout")}: ${esc(e.message)}</div>`;
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
  <h2 style="font-size:17px;font-weight:600;color:var(--gray-900);margin:0">${tM("nav.reports","Rapporten")}</h2>
  <div style="display:flex;align-items:center;gap:8px">
    <label style="font-size:12px;color:var(--gray-500);font-weight:600">${tM("mgr.period","Periode")}:</label>
    <select id="rptPeriod">
      ${monthOpts.join("")}
    </select>
  </div>
</div>

<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:18px">
  <div class="mgr-kpi"><div class="mgr-kpi-label">${tM("mgr.woOpen","Werkbonnen open")}</div><div class="mgr-kpi-value">${woOpen}</div><div class="mgr-kpi-sub">${woUrgent} ${tM("mgr.urgent","urgent")}</div></div>
  <div class="mgr-kpi"><div class="mgr-kpi-label">${tM("mgr.completedPeriod","Voltooid (periode)")}</div><div class="mgr-kpi-value" style="color:var(--wf-green)">${woDone}</div><div class="mgr-kpi-sub">${tM("mgr.ofCreated","van {n} aangemaakt").replace("{n}", woThisPeriod.length)}</div></div>
  <div class="mgr-kpi"><div class="mgr-kpi-label">${tM("mgr.leavePeriod","Verlof (periode)")}</div><div class="mgr-kpi-value">${lvApproved}</div><div class="mgr-kpi-sub">${lvPending} ${tM("mgr.toReview","te beoordelen")}</div></div>
  <div class="mgr-kpi"><div class="mgr-kpi-label">${tM("mgr.expPeriod","Onkosten (periode)")}</div><div class="mgr-kpi-value">${fmtEur(expAmt)}</div><div class="mgr-kpi-sub">${fmtEur(expApproved)} ${tM("adm.lstatus.approved","goedgekeurd").toLowerCase()} · ${expPending} ${tM("dash.woseg.open","open").toLowerCase()}</div></div>
</div>

<div class="mgr-card">
  <div class="mgr-card-header">
    <h3 class="mgr-card-title">${tM("mgr.teamOverview","Team overzicht")}</h3>
    <span style="font-size:11px;color:var(--gray-400)">${period}</span>
  </div>
  <div class="mgr-card-body mgr-table-wrap">
    <table class="mgr-table">
      <thead>
        <tr>
          <th>${tM("adm.thEmployee","Medewerker")}</th>
          <th>${tM("mgr.wbOpen","WB open")}</th>
          <th>${tM("mgr.wbDone","WB voltooid")}</th>
          <th>${tM("mgr.leaveOpen","Verlof open")}</th>
          <th>${tM("mgr.expOpen","Onkosten open")}</th>
          <th>${tM("mgr.expPeriod","Onkosten (periode)")}</th>
          <th>${tM("adm.status","Status")}</th>
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
          <td><span class="mgr-status ${u.active!==false?"mgr-status-active":"mgr-status-inactive"}">${u.active!==false?tM("adm.active","Actief"):tM("adm.inactive","Inactief")}</span></td>
        </tr>`).join("") : `<tr><td colspan="7" class="mgr-empty">${tM("mgr.noTeam","Geen teamleden")}</td></tr>`}
      </tbody>
    </table>
  </div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
  <div class="mgr-card">
    <div class="mgr-card-header"><h3 class="mgr-card-title">${tM("mgr.top5Wo","Top 5 werkbonnen open")}</h3></div>
    <div class="mgr-card-body">
      ${workorders.filter(w => !["done","Voltooid","Afgewerkt","geannuleerd"].includes(w.status))
        .sort((a,b) => (b.priority==="hoog"?1:0)-(a.priority==="hoog"?1:0))
        .slice(0,5).map(w => `
      <div style="padding:7px 0;border-bottom:1px solid var(--gray-50);display:flex;align-items:center;gap:8px">
        <span style="font-size:10px;font-weight:700;color:${w.priority==="hoog"?"var(--wf-red)":"var(--gray-400)"};background:${w.priority==="hoog"?"var(--wf-red-l)":"var(--gray-50)"};padding:2px 6px;border-radius:4px">${esc(tmWoPrio(w.priority))}</span>
        <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px">${esc(w.title||"-")}</div>
        <span style="font-size:11px;color:var(--gray-400);flex-shrink:0">${esc(w.userName||w.userId||"-")}</span>
      </div>`).join("") || `<div style="padding:12px 0;font-size:12px;color:var(--gray-400)">${tM("mgr.noOpenWo","Geen open werkbonnen")}</div>`}
    </div>
  </div>
  <div class="mgr-card">
    <div class="mgr-card-header"><h3 class="mgr-card-title">${tM("mgr.leaveReqReview","Verlofaanvragen te beoordelen")}</h3></div>
    <div class="mgr-card-body">
      ${leaves.filter(l => l.status === "aangevraagd").slice(0,5).map(l => `
      <div style="padding:7px 0;border-bottom:1px solid var(--gray-50);display:flex;align-items:center;justify-content:space-between;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;font-weight:600;color:var(--gray-900);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.userName||l.userId||"-")}</div>
          <div style="font-size:11px;color:var(--gray-400)">${esc(tmLeaveType(l.type||"verlof"))} · ${l.startDate||""}${l.endDate&&l.endDate!==l.startDate?" → "+l.endDate:""}</div>
        </div>
        <div style="display:flex;gap:5px">
          <button class="mgr-btn mgr-btn-success mgr-btn-sm rpt-lv-ok" data-id="${esc(l.id)}" data-name="${esc(l.userName||l.userId||"")}" data-type="${esc(l.type||"Verlof")}">✓</button>
          <button class="mgr-btn mgr-btn-danger mgr-btn-sm rpt-lv-rej" data-id="${esc(l.id)}" data-name="${esc(l.userName||l.userId||"")}" data-type="${esc(l.type||"Verlof")}">✕</button>
        </div>
      </div>`).join("") || `<div style="padding:12px 0;font-size:12px;color:var(--gray-400)">${tM("mgr.noRequests","Geen aanvragen")}</div>`}
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
      if (diff < 1) return tM("mgr.justNow","Zonet");
      if (diff < 60) return `${diff}${tM("mgr.minAgo","m geleden")}`;
      if (diff < 1440) return `${Math.floor(diff/60)}${tM("mgr.hrAgo","u geleden")}`;
      return new Date(iso).toLocaleDateString("nl-BE");
    }

    function renderMgrNotifList() {
      if (!_mgrNotifs.length) {
        mgrList.innerHTML = `<div style="padding:28px;text-align:center;font-size:13px;color:var(--gray-400)">${tM("mgr.noNotifs","Geen notificaties")}</div>`;
        return;
      }
      mgrList.innerHTML = _mgrNotifs.slice(0, 15).map(n => {
        const isRead = n.status === "read";
        return `<div class="mgr-notif-item" data-nid="${esc(n.id)}" style="padding:10px 16px;border-bottom:1px solid var(--gray-50);cursor:pointer;display:flex;gap:10px;background:${isRead?"#fff":"var(--wf-blue-l)"}">
          <div style="width:7px;height:7px;border-radius:50%;background:${isRead?"var(--gray-300)":"var(--wf-blue)"};margin-top:5px;flex-shrink:0"></div>
          <div style="flex:1">
            <div style="font-size:12.5px;color:var(--gray-700);font-weight:${isRead?400:600}">${esc(n.title||n.message||tM("mgr.notification","Notificatie"))}</div>
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
        mgrList.innerHTML = `<div style="padding:28px;text-align:center;font-size:13px;color:var(--gray-400)">${tM("adm.loading","Laden…")}</div>`;
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
