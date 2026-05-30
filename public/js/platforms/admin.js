/* ============================================================
   WorkFlow Pro – Tenant Admin Platform
   public/js/platforms/admin.js
   ============================================================ */
(function () {
  "use strict";

  // ── State ─────────────────────────────────────────────────
  let _currentView = "dashboard";
  let _state = {
    dashboard: null,
    employees: [],
    planning: [],
    leaves: [],
    expenses: [],
    workorders: [],
    messages: [],
    audit: []
  };

  // ── API helpers ────────────────────────────────────────────
  function token() {
    return localStorage.getItem("wfp_token") || "";
  }

  function tenantId() {
    try {
      const payload = JSON.parse(atob(token().split(".")[0]));
      return payload.tenantId;
    } catch (_) { return ""; }
  }

  const esc = v => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

  function api(method, path, body) {
    // Voeg automatisch /tenants/:id toe voor alle tenant-scoped routes
    const tid = tenantId();
    const skipPrefix = !tid || path.startsWith("/tenants/") || path.startsWith("/auth/") || path.startsWith("/super/") || path.startsWith("/audit") || path.startsWith("/modules/");
    const fullPath = skipPrefix ? path : `/tenants/${tid}${path}`;
    return fetch("/api" + fullPath, {
      method,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
      body: body ? JSON.stringify(body) : undefined
    }).then(async r => {
      const data = await r.json();
      if (!r.ok) throw Object.assign(new Error(data.error || "API fout"), { status: r.status, data });
      return data;
    });
  }

  // ── Shell ──────────────────────────────────────────────────
  function buildShell() {
    const el = document.getElementById("platform-admin");
    if (!el) return;

    el.innerHTML = `
<div class="adm-layout">
  <!-- Sidebar -->
  <aside class="adm-sidebar" id="admSidebar">
    <div class="adm-logo">
      <span class="adm-logo-mark">WP</span>
      <span class="adm-logo-text">WorkFlow Pro</span>
    </div>
    <nav class="adm-nav">
      <a class="adm-nav-item active" data-view="dashboard" href="#">
        <svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
        Dashboard
      </a>
      <a class="adm-nav-item" data-view="employees" href="#">
        <svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
        Medewerkers
      </a>
      <a class="adm-nav-item" data-view="planning" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/></svg>
        Planning
      </a>
      <a class="adm-nav-item" data-view="clocking" href="#">
        <svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>
        Prikklok
      </a>
      <a class="adm-nav-item" data-view="leaves" href="#">
        <svg viewBox="0 0 24 24"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>
        Verlof
        <span class="adm-badge" id="admLeaveBadge" style="display:none">0</span>
      </a>
      <a class="adm-nav-item" data-view="expenses" href="#">
        <svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>
        Onkosten
        <span class="adm-badge" id="admExpenseBadge" style="display:none">0</span>
      </a>
      <a class="adm-nav-item" data-view="workorders" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        Werkbonnen
      </a>
      <a class="adm-nav-item" data-view="messages" href="#">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
        Berichten
        <span class="adm-badge" id="admMsgBadge" style="display:none">0</span>
      </a>
      <a class="adm-nav-item" data-view="reports" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 14l-5-5 1.41-1.41L12 14.17l7.59-7.59L21 8l-9 9z"/></svg>
        Rapportages
      </a>
      <div class="adm-nav-divider"></div>
      <a class="adm-nav-item" data-view="customers" href="#">
        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
        Klanten
      </a>
      <a class="adm-nav-item" data-view="venues" href="#">
        <svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
        Locaties
      </a>
      <a class="adm-nav-item" data-view="vehicles" href="#">
        <svg viewBox="0 0 24 24"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>
        Voertuigen
      </a>
      <a class="adm-nav-item" data-view="stock" href="#">
        <svg viewBox="0 0 24 24"><path d="M20 6h-2.18c.07-.44.18-.88.18-1.36C18 2.1 15.9 0 13.36 0c-1.3 0-2.48.52-3.35 1.36L9 2.37 7.99 1.36C7.12.52 5.94 0 4.64 0 2.1 0 0 2.1 0 4.64c0 .48.11.92.18 1.36H2c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zM2 20V8h9v12H2zm11 0V8h9v12h-9z"/></svg>
        Stock
      </a>
      <a class="adm-nav-item" data-view="billing" href="#">
        <svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>
        Facturatie
        <span class="adm-badge" id="admInvoiceBadge" style="display:none">0</span>
      </a>
      <div class="adm-nav-divider"></div>
      <a class="adm-nav-item" data-view="audit" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/></svg>
        Audittrail
      </a>
      <a class="adm-nav-item" data-view="settings" href="#">
        <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
        Instellingen
      </a>
    </nav>
    <div class="adm-sidebar-footer">
      <div class="adm-user-chip" id="admUserChip">
        <div class="adm-user-avatar" id="admUserAvatar">A</div>
        <div class="adm-user-info">
          <div class="adm-user-name" id="admUserName">Admin</div>
          <div class="adm-user-role">Beheerder</div>
        </div>
      </div>
      <button class="adm-logout-btn" id="admLogoutBtn" title="Uitloggen">
        <svg viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
      </button>
    </div>
  </aside>

  <!-- Main content -->
  <main class="adm-main" id="admMain">
    <header class="adm-topbar">
      <button class="adm-menu-toggle" id="admMenuToggle">
        <svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
      </button>
      <h1 class="adm-page-title" id="admPageTitle">Dashboard</h1>
      <div class="adm-topbar-actions">
        <button class="adm-btn adm-btn-primary" id="admPrimaryAction" style="display:none">+ Toevoegen</button>
      </div>
      <div class="adm-bell-wrap">
        <button class="adm-bell-btn" id="admBellBtn" title="Notificaties">
          <svg viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
          <span class="adm-bell-dot" id="admBellDot"></span>
        </button>
        <div class="adm-notif-panel" id="admNotifPanel">
          <div class="adm-notif-hd">
            <span class="adm-notif-hd-title">Notificaties</span>
            <button class="adm-notif-hd-clear" id="admNotifMarkAll">Alles gelezen</button>
          </div>
          <div class="adm-notif-list" id="admNotifList"><div class="adm-notif-empty">Laden…</div></div>
        </div>
      </div>
    </header>
    <div class="adm-content" id="admContent">
      <div class="adm-loading">Laden…</div>
    </div>
  </main>
</div>

<!-- Employee drawer -->
<div class="adm-overlay hidden" id="admOverlay"></div>
<aside class="adm-drawer hidden" id="admDrawer">
  <div class="adm-drawer-header">
    <h2 id="admDrawerTitle">Medewerker toevoegen</h2>
    <button class="adm-drawer-close" id="admDrawerClose">&times;</button>
  </div>
  <div class="adm-drawer-body" id="admDrawerBody"></div>
</aside>

<style>
/* ── Layout ─────────────────────────────────── */
#platform-admin { font-family: 'Inter', system-ui, sans-serif; height: 100vh; overflow: hidden; }
.adm-layout { display:flex; height:100vh; background:#f8f9fb; }

/* ── Sidebar ────────────────────────────────── */
.adm-sidebar { width:240px; background:#1e293b; color:#e2e8f0; display:flex; flex-direction:column; flex-shrink:0; overflow-y:auto; }
.adm-logo { display:flex; align-items:center; gap:10px; padding:20px 16px; border-bottom:1px solid #334155; }
.adm-logo-mark { background:#6366f1; color:#fff; width:32px; height:32px; border-radius:8px; display:grid; place-items:center; font-weight:700; font-size:13px; flex-shrink:0; }
.adm-logo-text { font-weight:600; font-size:15px; }
.adm-nav { padding:12px 8px; flex:1; }
.adm-nav-item { display:flex; align-items:center; gap:10px; padding:9px 10px; border-radius:8px; color:#94a3b8; text-decoration:none; font-size:13.5px; transition:background .15s,color .15s; position:relative; }
.adm-nav-item svg { width:18px; height:18px; fill:currentColor; flex-shrink:0; }
.adm-nav-item:hover { background:#334155; color:#e2e8f0; }
.adm-nav-item.active { background:#4f46e5; color:#fff; }
.adm-badge { margin-left:auto; background:#ef4444; color:#fff; border-radius:999px; font-size:11px; padding:1px 6px; font-weight:600; }
.adm-nav-divider { height:1px; background:#334155; margin:8px 10px; }
.adm-sidebar-footer { padding:12px; border-top:1px solid #334155; display:flex; align-items:center; gap:8px; }
.adm-user-chip { display:flex; align-items:center; gap:8px; flex:1; min-width:0; }
.adm-user-avatar { width:32px; height:32px; border-radius:50%; background:#4f46e5; color:#fff; display:grid; place-items:center; font-weight:600; font-size:13px; flex-shrink:0; }
.adm-user-info { min-width:0; }
.adm-user-name { font-size:13px; font-weight:500; color:#e2e8f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.adm-user-role { font-size:11px; color:#64748b; }
.adm-logout-btn { background:none; border:none; color:#64748b; cursor:pointer; padding:4px; border-radius:6px; }
.adm-logout-btn:hover { color:#ef4444; background:#1f2937; }
.adm-logout-btn svg { width:18px; height:18px; fill:currentColor; display:block; }

/* ── Main ───────────────────────────────────── */
.adm-main { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.adm-topbar { display:flex; align-items:center; gap:12px; padding:0 20px; height:56px; background:#fff; border-bottom:1px solid #e2e8f0; flex-shrink:0; }
.adm-menu-toggle { background:none; border:none; cursor:pointer; padding:4px; color:#64748b; display:none; }
.adm-menu-toggle svg { width:20px; height:20px; fill:currentColor; display:block; }
.adm-page-title { font-size:16px; font-weight:600; flex:1; color:#0f172a; margin:0; }
.adm-content { flex:1; overflow-y:auto; padding:20px; }
/* ── Notification bell ─────────────────────── */
.adm-bell-wrap { position:relative; }
.adm-bell-btn { background:none; border:none; cursor:pointer; padding:6px; border-radius:8px; color:#64748b; display:flex; align-items:center; justify-content:center; position:relative; transition:background .1s; }
.adm-bell-btn:hover { background:#f1f5f9; color:#374151; }
.adm-bell-btn svg { width:20px; height:20px; fill:currentColor; }
.adm-bell-dot { position:absolute; top:4px; right:4px; width:8px; height:8px; background:#ef4444; border-radius:50%; border:2px solid #fff; display:none; }
.adm-notif-panel { position:absolute; right:0; top:calc(100% + 8px); width:340px; background:#fff; border-radius:12px; border:1px solid #e2e8f0; box-shadow:0 8px 32px rgba(0,0,0,.12); z-index:400; display:none; }
.adm-notif-panel.open { display:block; }
.adm-notif-hd { padding:12px 16px; border-bottom:1px solid #f1f5f9; display:flex; align-items:center; gap:8px; }
.adm-notif-hd-title { font-size:13px; font-weight:700; color:#0f172a; flex:1; }
.adm-notif-hd-clear { background:none; border:none; cursor:pointer; font-size:11px; color:#6366f1; font-weight:600; padding:3px 6px; border-radius:6px; }
.adm-notif-hd-clear:hover { background:#eff6ff; }
.adm-notif-list { max-height:340px; overflow-y:auto; }
.adm-notif-item { padding:10px 16px; border-bottom:1px solid #f8fafc; cursor:pointer; display:flex; gap:10px; align-items:flex-start; transition:background .1s; }
.adm-notif-item:hover { background:#fafafa; }
.adm-notif-item.unread { background:#eff6ff; }
.adm-notif-item.unread:hover { background:#e0f2fe; }
.adm-notif-dot { width:7px; height:7px; border-radius:50%; background:#6366f1; margin-top:5px; flex-shrink:0; }
.adm-notif-dot.read { background:#cbd5e1; }
.adm-notif-body { font-size:12.5px; color:#374151; flex:1; }
.adm-notif-time { font-size:10.5px; color:#94a3b8; margin-top:2px; }
.adm-notif-empty { padding:28px 16px; text-align:center; font-size:13px; color:#94a3b8; }

/* ── Buttons ────────────────────────────────── */
.adm-btn { padding:8px 16px; border-radius:8px; font-size:13px; font-weight:500; cursor:pointer; border:none; }
.adm-btn-primary { background:#4f46e5; color:#fff; }
.adm-btn-primary:hover { background:#4338ca; }
.adm-btn-secondary { background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; }
.adm-btn-secondary:hover { background:#e2e8f0; }
.adm-btn-success { background:#10b981; color:#fff; }
.adm-btn-warning { background:#f59e0b; color:#fff; }
.adm-btn-danger { background:#ef4444; color:#fff; }
.adm-btn-sm { padding:5px 10px; font-size:12px; }

/* ── KPI Cards ──────────────────────────────── */
.adm-kpis { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:16px; margin-bottom:24px; }
.adm-kpi { background:#fff; border-radius:12px; padding:16px; border:1px solid #e2e8f0; }
.adm-kpi-label { font-size:12px; color:#64748b; margin-bottom:6px; }
.adm-kpi-value { font-size:26px; font-weight:700; color:#0f172a; }
.adm-kpi-sub { font-size:12px; color:#94a3b8; margin-top:2px; }
.adm-kpi-icon { float:right; width:36px; height:36px; border-radius:10px; display:grid; place-items:center; }
.adm-kpi-icon svg { width:18px; height:18px; fill:#fff; }
.adm-kpi-blue .adm-kpi-icon { background:#3b82f6; }
.adm-kpi-green .adm-kpi-icon { background:#10b981; }
.adm-kpi-amber .adm-kpi-icon { background:#f59e0b; }
.adm-kpi-red .adm-kpi-icon { background:#ef4444; }
.adm-kpi-purple .adm-kpi-icon { background:#8b5cf6; }

/* ── Cards ──────────────────────────────────── */
.adm-card { background:#fff; border-radius:12px; border:1px solid #e2e8f0; margin-bottom:20px; }
.adm-card-header { display:flex; align-items:center; justify-content:space-between; padding:14px 16px; border-bottom:1px solid #f1f5f9; }
.adm-card-title { font-size:14px; font-weight:600; color:#0f172a; margin:0; }
.adm-card-body { padding:16px; }

/* ── Table ──────────────────────────────────── */
.adm-table-wrap { overflow-x:auto; }
table.adm-table { width:100%; border-collapse:collapse; font-size:13px; }
.adm-table th { text-align:left; padding:8px 12px; color:#64748b; font-weight:500; border-bottom:2px solid #f1f5f9; white-space:nowrap; }
.adm-table td { padding:10px 12px; border-bottom:1px solid #f8f9fb; color:#374151; vertical-align:middle; }
.adm-table tr:last-child td { border-bottom:none; }
.adm-table tr:hover td { background:#f8f9fb; }

/* ── Status badges ──────────────────────────── */
.adm-status { display:inline-flex; align-items:center; gap:4px; padding:3px 8px; border-radius:999px; font-size:11px; font-weight:500; }
.adm-status::before { content:''; width:6px; height:6px; border-radius:50%; background:currentColor; }
.adm-status-active,.adm-status-goedgekeurd,.adm-status-approved { background:#d1fae5; color:#059669; }
.adm-status-pending,.adm-status-aangevraagd,.adm-status-ingediend { background:#fef3c7; color:#d97706; }
.adm-status-inactive,.adm-status-geweigerd,.adm-status-geannuleerd { background:#fee2e2; color:#dc2626; }
.adm-status-open,.adm-status-nieuw { background:#dbeafe; color:#2563eb; }
.adm-status-voltooid,.adm-status-afgewerkt { background:#e9d5ff; color:#7c3aed; }

/* ── Avatar ─────────────────────────────────── */
.adm-avatar { width:30px; height:30px; border-radius:50%; background:#e0e7ff; color:#4f46e5; display:inline-grid; place-items:center; font-size:12px; font-weight:600; }

/* ── Drawer ─────────────────────────────────── */
.adm-overlay { position:fixed; inset:0; background:rgba(0,0,0,.4); z-index:200; }
.adm-drawer { position:fixed; top:0; right:0; height:100vh; width:380px; background:#fff; z-index:201; box-shadow:-4px 0 20px rgba(0,0,0,.1); display:flex; flex-direction:column; transition:transform .25s; }
.adm-drawer.hidden { transform:translateX(100%); }
.adm-overlay.hidden { display:none; }
.adm-drawer-header { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e2e8f0; }
.adm-drawer-header h2 { font-size:16px; font-weight:600; margin:0; }
.adm-drawer-close { background:none; border:none; font-size:22px; cursor:pointer; color:#94a3b8; line-height:1; }
.adm-drawer-body { flex:1; overflow-y:auto; padding:20px; }

/* ── Form ───────────────────────────────────── */
.adm-form-group { margin-bottom:16px; }
.adm-form-group label { display:block; font-size:12px; font-weight:500; color:#374151; margin-bottom:5px; }
.adm-form-group input, .adm-form-group select, .adm-form-group textarea {
  width:100%; padding:8px 10px; border:1px solid #d1d5db; border-radius:8px; font-size:13px; box-sizing:border-box;
}
.adm-form-group input:focus, .adm-form-group select:focus, .adm-form-group textarea:focus {
  outline:none; border-color:#4f46e5; box-shadow:0 0 0 3px rgba(79,70,229,.1);
}
.adm-form-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.adm-form-actions { display:flex; gap:10px; justify-content:flex-end; padding-top:12px; border-top:1px solid #f1f5f9; margin-top:12px; }

/* ── Sections grid ──────────────────────────── */
.adm-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
@media (max-width:900px) { .adm-grid-2 { grid-template-columns:1fr; } }

/* ── Loading ────────────────────────────────── */
.adm-loading { text-align:center; color:#94a3b8; padding:40px; }

/* ── Empty ──────────────────────────────────── */
.adm-empty { text-align:center; padding:40px; color:#94a3b8; }
.adm-empty-icon { font-size:36px; margin-bottom:8px; }
.adm-empty-text { font-size:14px; }

/* ── Toggle sidebar on mobile ───────────────── */
@media (max-width:768px) {
  .adm-sidebar { position:fixed; left:0; top:0; z-index:100; transform:translateX(-100%); transition:transform .25s; }
  .adm-sidebar.open { transform:translateX(0); }
  .adm-menu-toggle { display:block; }
}
</style>`;

    // nav click
    el.querySelectorAll(".adm-nav-item[data-view]").forEach(a => {
      a.addEventListener("click", e => {
        e.preventDefault();
        switchView(a.dataset.view);
      });
    });

    // sidebar toggle
    document.getElementById("admMenuToggle").addEventListener("click", () => {
      document.getElementById("admSidebar").classList.toggle("open");
    });

    // logout
    document.getElementById("admLogoutBtn").addEventListener("click", () => {
      localStorage.removeItem("wfp_token");
      location.reload();
    });

    // drawer close
    document.getElementById("admDrawerClose").addEventListener("click", closeDrawer);
    document.getElementById("admOverlay").addEventListener("click", closeDrawer);

    // primary action btn
    document.getElementById("admPrimaryAction").addEventListener("click", () => {
      if (_currentView === "employees") openEmployeeDrawer(null);
      if (_currentView === "messages") openMessageDrawer();
      if (_currentView === "customers") openCustomerDrawer(null);
      if (_currentView === "venues") openVenueDrawer(null);
      if (_currentView === "vehicles") openVehicleDrawer(null);
      if (_currentView === "stock") openStockDrawer(null);
    });
  }

  // ── Navigation ─────────────────────────────────────────────
  const VIEW_LABELS = {
    dashboard: "Dashboard", employees: "Medewerkers", planning: "Planning",
    clocking: "Prikklok", leaves: "Verlof", expenses: "Onkosten",
    workorders: "Werkbonnen", messages: "Berichten", reports: "Rapportages",
    customers: "Klanten", venues: "Locaties", vehicles: "Voertuigen",
    stock: "Stock", billing: "Facturatie",
    audit: "Audittrail", settings: "Instellingen"
  };

  const VIEW_BTN_LABEL = {
    employees: "+ Medewerker", messages: "+ Bericht", customers: "+ Klant",
    venues: "+ Locatie", vehicles: "+ Voertuig", stock: "+ Artikel"
  };

  function switchView(view) {
    _currentView = view;
    document.querySelectorAll(".adm-nav-item").forEach(a => {
      a.classList.toggle("active", a.dataset.view === view);
    });
    document.getElementById("admPageTitle").textContent = VIEW_LABELS[view] || view;

    const btn = document.getElementById("admPrimaryAction");
    const hasBtn = VIEW_BTN_LABEL[view];
    btn.style.display = hasBtn ? "" : "none";
    if (hasBtn) btn.textContent = hasBtn;

    const content = document.getElementById("admContent");
    content.innerHTML = `<div class="adm-loading">Laden…</div>`;

    const renders = {
      dashboard: renderDashboard,
      employees: renderEmployees,
      planning: renderPlanning,
      clocking: renderClocking,
      leaves: renderLeaves,
      expenses: renderExpenses,
      workorders: renderWorkorders,
      messages: renderMessages,
      reports: renderReports,
      customers: renderCustomers,
      venues: renderVenues,
      vehicles: renderVehicles,
      stock: renderStock,
      billing: renderBilling,
      audit: renderAudit,
      settings: renderSettings
    };
    if (renders[view]) renders[view]();
  }

  // ── Dashboard ──────────────────────────────────────────────
  async function renderDashboard() {
    const [dash, pending] = await Promise.all([
      api("GET", "/manager/dashboard"),
      api("GET", "/leaves?status=aangevraagd")
    ]);

    const content = document.getElementById("admContent");
    content.innerHTML = `
<div class="adm-kpis">
  <div class="adm-kpi adm-kpi-blue">
    <div class="adm-kpi-icon"><svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg></div>
    <div class="adm-kpi-label">Team</div>
    <div class="adm-kpi-value">${dash.team ?? "—"}</div>
    <div class="adm-kpi-sub">Actieve medewerkers</div>
  </div>
  <div class="adm-kpi adm-kpi-green">
    <div class="adm-kpi-icon"><svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg></div>
    <div class="adm-kpi-label">Ingeklokt</div>
    <div class="adm-kpi-value">${dash.clockedIn ?? "—"}</div>
    <div class="adm-kpi-sub">Van ${dash.team ?? "?"} medewerkers</div>
  </div>
  <div class="adm-kpi adm-kpi-amber">
    <div class="adm-kpi-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg></div>
    <div class="adm-kpi-label">Verlof aanvragen</div>
    <div class="adm-kpi-value">${dash.pendingLeaves ?? "—"}</div>
    <div class="adm-kpi-sub">Wacht op goedkeuring</div>
  </div>
  <div class="adm-kpi adm-kpi-red">
    <div class="adm-kpi-icon"><svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg></div>
    <div class="adm-kpi-label">Onkosten</div>
    <div class="adm-kpi-value">${dash.pendingExpenses ?? "—"}</div>
    <div class="adm-kpi-sub">Te verwerken</div>
  </div>
  <div class="adm-kpi adm-kpi-purple">
    <div class="adm-kpi-icon"><svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg></div>
    <div class="adm-kpi-label">Werkbonnen</div>
    <div class="adm-kpi-value">${dash.openWorkorders ?? "—"}</div>
    <div class="adm-kpi-sub">Openstaand</div>
  </div>
</div>

<div class="adm-grid-2">
  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">Team vandaag</h3>
    </div>
    <div class="adm-card-body adm-table-wrap">
      <table class="adm-table">
        <thead><tr><th>Medewerker</th><th>Status</th><th>Ingepland</th></tr></thead>
        <tbody>
          ${(dash.teamList || []).slice(0,8).map(u => `
          <tr>
            <td><span class="adm-avatar">${(u.name||"?")[0]}</span> ${u.name||u.email}</td>
            <td>${u.absent ? '<span class="adm-status adm-status-inactive">Afwezig</span>' : u.clockedIn ? '<span class="adm-status adm-status-active">Ingeklokt</span>' : '<span class="adm-status adm-status-pending">Niet geklokt</span>'}</td>
            <td>${u.planned ? "✓" : "—"}</td>
          </tr>`).join("") || '<tr><td colspan="3" class="adm-empty">Geen teamleden</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">Verlof aanvragen <span style="background:#fef3c7;color:#92400e;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;">${(pending.leaves||pending||[]).length}</span></h3>
      <a href="#" class="adm-btn adm-btn-secondary adm-btn-sm" id="admViewAllLeaves">Alles bekijken</a>
    </div>
    <div class="adm-card-body adm-table-wrap">
      <table class="adm-table">
        <thead><tr><th>Medewerker</th><th>Type</th><th>Periode</th><th>Actie</th></tr></thead>
        <tbody>
          ${((pending.leaves||pending)||[]).slice(0,5).map(l => `
          <tr>
            <td>${esc(l.userName||l.userId)}</td>
            <td>${esc(l.type||"—")}</td>
            <td style="white-space:nowrap">${esc(l.startDate)} – ${esc(l.endDate)}</td>
            <td style="white-space:nowrap">
              <button class="adm-btn adm-btn-success adm-btn-sm adm-dash-lv-ok" data-id="${esc(l.id)}">✓ Goed</button>
              <button class="adm-btn adm-btn-danger adm-btn-sm adm-dash-lv-rej" data-id="${esc(l.id)}">✗ Weiger</button>
            </td>
          </tr>`).join("") || '<tr><td colspan="4" class="adm-empty">Geen aanvragen</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>
</div>`;

    document.getElementById("admViewAllLeaves")?.addEventListener("click", e => { e.preventDefault(); switchView("leaves"); });

    const pendingLeaves = pending.leaves || pending || [];
    document.querySelectorAll(".adm-dash-lv-ok").forEach(btn => {
      btn.addEventListener("click", () => {
        const leave = pendingLeaves.find(l => l.id === btn.dataset.id);
        openLeaveReviewModal(btn.dataset.id, "goedgekeurd", leave, renderDashboard);
      });
    });
    document.querySelectorAll(".adm-dash-lv-rej").forEach(btn => {
      btn.addEventListener("click", () => {
        const leave = pendingLeaves.find(l => l.id === btn.dataset.id);
        openLeaveReviewModal(btn.dataset.id, "geweigerd", leave, renderDashboard);
      });
    });
  }

  // ── Employees ──────────────────────────────────────────────
  let _empShowInactive = false;

  async function renderEmployees() {
    const data = await api("GET", "/employees?includeInactive=true");
    const employees = data.employees || data || [];
    _state.employees = employees;

    const activeCount   = employees.filter(u => u.active !== false).length;
    const inactiveCount = employees.filter(u => u.active === false).length;
    const visible = _empShowInactive ? employees : employees.filter(u => u.active !== false);

    const content = document.getElementById("admContent");
    content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">${activeCount} actief${inactiveCount ? ` · ${inactiveCount} inactief` : ""}</h3>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <input type="search" placeholder="Zoeken…" id="admEmpSearch" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;width:180px;">
      ${inactiveCount ? `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#64748b;cursor:pointer;">
        <input type="checkbox" id="admEmpShowInactive" ${_empShowInactive?"checked":""}> Toon inactief
      </label>` : ""}
    </div>
  </div>
  <div class="adm-card-body adm-table-wrap" id="admEmpTable">
    ${renderEmployeeTable(visible)}
  </div>
</div>`;

    document.getElementById("admEmpSearch").addEventListener("input", e => {
      const q = e.target.value.toLowerCase();
      const base = _empShowInactive ? employees : employees.filter(u => u.active !== false);
      const filtered = base.filter(u => (u.name||"").toLowerCase().includes(q) || (u.email||"").toLowerCase().includes(q) || (u.function||"").toLowerCase().includes(q));
      document.getElementById("admEmpTable").innerHTML = renderEmployeeTable(filtered);
      bindEmpActions();
    });
    document.getElementById("admEmpShowInactive")?.addEventListener("change", e => {
      _empShowInactive = e.target.checked; renderEmployees();
    });
    bindEmpActions();
  }

  function renderEmployeeTable(employees) {
    if (!employees.length) return `<div class="adm-empty"><div class="adm-empty-icon">👥</div><div class="adm-empty-text">Geen medewerkers gevonden</div></div>`;
    return `<table class="adm-table">
      <thead><tr><th></th><th>Naam</th><th>E-mail</th><th>Functie</th><th>Rol</th><th>Status</th><th>Acties</th></tr></thead>
      <tbody>${employees.map(u => `
        <tr>
          <td><span class="adm-avatar" style="background:${u.active===false?"#f1f5f9":"#e0e7ff"};color:${u.active===false?"#94a3b8":"#4f46e5"}">${(u.name||u.email||"?")[0].toUpperCase()}</span></td>
          <td><div style="font-weight:600;color:${u.active===false?"#94a3b8":"#0f172a"}">${esc(u.name||"—")}</div><div style="font-size:11px;color:#94a3b8">${esc(u.phone||"")}</div></td>
          <td style="font-size:12px">${esc(u.email)}</td>
          <td style="font-size:12px;color:#64748b">${esc(u.function||u.jobTitle||"—")}</td>
          <td><span class="adm-status ${u.role==="manager"?"adm-status-pending":"adm-status-open"}">${u.role==="manager"?"Manager":u.role==="tenant_admin"?"Admin":"Medewerker"}</span></td>
          <td>${u.active!==false ? '<span class="adm-status adm-status-active">Actief</span>' : '<span class="adm-status adm-status-inactive">Inactief</span>'}</td>
          <td style="white-space:nowrap">
            <button class="adm-btn adm-btn-secondary adm-btn-sm adm-edit-emp" data-id="${esc(u.id)}">✏ Bewerken</button>
            <button class="adm-btn adm-btn-sm ${u.active!==false?"adm-btn-warning":"adm-btn-success"} adm-toggle-emp" data-id="${esc(u.id)}" data-active="${u.active!==false}">${u.active!==false?"⏸ Deactiveer":"▶ Activeer"}</button>
          </td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  }

  function bindEmpActions() {
    document.querySelectorAll(".adm-edit-emp").forEach(btn => {
      btn.addEventListener("click", () => {
        const emp = _state.employees.find(u => u.id === btn.dataset.id);
        openEmployeeDrawer(emp);
      });
    });
    document.querySelectorAll(".adm-toggle-emp").forEach(btn => {
      btn.addEventListener("click", async () => {
        const isActive = btn.dataset.active === "true";
        const emp = _state.employees.find(u => u.id === btn.dataset.id);
        if (!confirm(`${isActive ? "Deactiveer" : "Activeer"} ${emp?.name || emp?.email}?`)) return;
        btn.disabled = true;
        try {
          await api("PATCH", `/employees/${btn.dataset.id}`, { active: !isActive });
          renderEmployees();
        } catch(e) { alert(e.message); btn.disabled = false; }
      });
    });
  }

  function openEmployeeDrawer(emp) {
    const title = document.getElementById("admDrawerTitle");
    const body = document.getElementById("admDrawerBody");
    title.textContent = emp ? "Medewerker bewerken" : "Medewerker toevoegen";
    body.innerHTML = `
<form id="admEmpForm">
  <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">Persoonsgegevens</div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Voornaam *</label><input name="firstName" value="${esc(emp?.firstName||(emp?.name?.split(" ")[0])||"")}" required placeholder="Jan"></div>
    <div class="adm-form-group"><label>Achternaam *</label><input name="lastName" value="${esc(emp?.lastName||(emp?.name?.split(" ").slice(1).join(" "))||"")}" required placeholder="Janssen"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>E-mail *</label><input name="email" type="email" value="${esc(emp?.email||"")}" ${emp?"readonly style='background:#f8fafc;color:#64748b'":""} required placeholder="jan@bedrijf.be"></div>
    <div class="adm-form-group"><label>Telefoon</label><input name="phone" value="${esc(emp?.phone||"")}" placeholder="+32 4xx xx xx xx"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Functie</label><input name="function" value="${esc(emp?.function||emp?.jobTitle||"")}" placeholder="Technieker, Chauffeur…"></div>
    <div class="adm-form-group"><label>Rol</label>
      <select name="role">
        <option value="employee" ${(emp?.role||"employee")==="employee"?"selected":""}>Medewerker</option>
        <option value="manager" ${emp?.role==="manager"?"selected":""}>Manager</option>
      </select>
    </div>
  </div>

  <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 10px;">Adres & IBAN</div>
  <div class="adm-form-group"><label>Adres</label><input name="address" value="${esc(emp?.address||"")}" placeholder="Straat 1, 1000 Brussel"></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>IBAN</label><input name="iban" value="${esc(emp?.iban||"")}" placeholder="BE68 5390 0754 7034"></div>
    <div class="adm-form-group"><label>Rijksregisternr.</label><input name="nationalId" value="${esc(emp?.nationalId||"")}" placeholder="00.00.00-000.00"></div>
  </div>

  <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 10px;">Verlof</div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Vakantiedagen / jaar</label>
      <input name="leaveQuota" type="number" min="0" max="365" value="${esc(emp?.leaveQuota ?? 20)}" placeholder="20">
    </div>
    <div class="adm-form-group" style="align-self:flex-end;padding-bottom:4px;font-size:12px;color:#64748b;">
      Standaard: 20 dagen. Wijzig voor deeltijdse of contractuele afwijkingen.
    </div>
  </div>

  ${!emp ? `
  <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 10px;">Toegang</div>
  <div class="adm-form-group"><label>Tijdelijk wachtwoord</label><input name="tempPassword" placeholder="Laat leeg voor auto-generatie" autocomplete="new-password"></div>` : ""}

  <div id="admEmpFormErr" style="display:none;background:#fef2f2;color:#dc2626;border-radius:8px;padding:8px;font-size:12px;margin-top:8px;"></div>
  <div class="adm-form-actions" style="margin-top:16px;">
    <button type="button" class="adm-btn adm-btn-secondary" id="admEmpCancel">Annuleren</button>
    ${emp ? `<button type="button" class="adm-btn adm-btn-warning adm-btn-sm" id="admEmpPwReset">🔑 Wachtwoord reset</button>` : ""}
    <button type="submit" class="adm-btn adm-btn-primary">${emp ? "Opslaan" : "Aanmaken"}</button>
  </div>
</form>
${emp ? `
<div style="margin-top:20px;padding-top:16px;border-top:1px solid #f1f5f9;">
  <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Accountbeheer</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <button class="adm-btn adm-btn-sm ${emp.active!==false?"adm-btn-warning":"adm-btn-success"}" id="admEmpToggle">${emp.active!==false?"⏸ Deactiveer account":"▶ Activeer account"}</button>
  </div>
</div>` : ""}`;

    document.getElementById("admEmpCancel").addEventListener("click", closeDrawer);

    document.getElementById("admEmpPwReset")?.addEventListener("click", async () => {
      const newPw = prompt("Nieuw tijdelijk wachtwoord (min. 8 tekens):");
      if (!newPw) return;
      if (newPw.length < 8) { alert("Wachtwoord moet minstens 8 tekens zijn."); return; }
      try {
        await api("PATCH", `/employees/${emp.id}`, { newPassword: newPw });
        alert(`Wachtwoord van ${emp.name||emp.email} is gewijzigd.`);
      } catch(e) { alert(e.message); }
    });

    document.getElementById("admEmpToggle")?.addEventListener("click", async () => {
      const isActive = emp.active !== false;
      if (!confirm(`${isActive?"Deactiveer":"Activeer"} account van ${emp.name||emp.email}?`)) return;
      try {
        await api("PATCH", `/employees/${emp.id}`, { active: !isActive });
        closeDrawer(); renderEmployees();
      } catch(e) { alert(e.message); }
    });

    document.getElementById("admEmpForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = document.getElementById("admEmpFormErr");
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd);
      data.name = `${data.firstName} ${data.lastName}`.trim();
      delete data.firstName; delete data.lastName;
      if (data.leaveQuota !== undefined) data.leaveQuota = Number(data.leaveQuota) || 20;
      try {
        if (emp) await api("PATCH", `/employees/${emp.id}`, data);
        else await api("POST", "/employees", data);
        closeDrawer();
        renderEmployees();
      } catch(err) {
        errEl.textContent = err.message; errEl.style.display = "block";
      }
    });

    openDrawer();
  }

  // ── Planning ───────────────────────────────────────────────
  let _planningWeekOffset = 0; // weeks relative to current week

  async function renderPlanning() {
    const today = new Date().toISOString().slice(0, 10);
    const baseWeek = getWeekStart(new Date());
    baseWeek.setDate(baseWeek.getDate() + _planningWeekOffset * 7);
    const weekEnd = new Date(baseWeek); weekEnd.setDate(baseWeek.getDate() + 6);
    const from = baseWeek.toISOString().slice(0, 10);
    const to = weekEnd.toISOString().slice(0, 10);

    const data = await api("GET", `/manager/planning?from=${from}&to=${to}`);
    const shifts = Array.isArray(data) ? data : (data.shifts || []);

    const days = [];
    for (let d = new Date(baseWeek); d <= weekEnd; d.setDate(d.getDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
    }

    const weekLabel = `${new Date(from).toLocaleDateString("nl-BE",{day:"numeric",month:"short"})} – ${new Date(to).toLocaleDateString("nl-BE",{day:"numeric",month:"short",year:"numeric"})}`;

    const content = document.getElementById("admContent");
    content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Planning</h3>
    <div style="display:flex;gap:8px;align-items:center;">
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admPrevWeek">‹ Vorige</button>
      <span style="font-size:13px;font-weight:500;min-width:180px;text-align:center;">${weekLabel}</span>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admNextWeek">Volgende ›</button>
      ${_planningWeekOffset !== 0 ? `<button class="adm-btn adm-btn-secondary adm-btn-sm" id="admTodayWeek">Vandaag</button>` : ""}
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="admAddShift">+ Shift</button>
    </div>
  </div>
  <div class="adm-card-body adm-table-wrap">
    <table class="adm-table">
      <thead><tr><th>Medewerker</th>${days.map(d => `<th style="${d===today?"color:#0ea5e9;font-weight:700":""}">${formatDate(d)}</th>`).join("")}</tr></thead>
      <tbody>
        ${renderPlanningRows(shifts, days)}
      </tbody>
    </table>
  </div>
</div>`;
    document.getElementById("admAddShift")?.addEventListener("click", () => openShiftDrawer(from, to, null, shifts));
    document.getElementById("admPrevWeek")?.addEventListener("click", () => { _planningWeekOffset--; renderPlanning(); });
    document.getElementById("admNextWeek")?.addEventListener("click", () => { _planningWeekOffset++; renderPlanning(); });
    document.getElementById("admTodayWeek")?.addEventListener("click", () => { _planningWeekOffset = 0; renderPlanning(); });
    document.querySelectorAll(".adm-shift-pill").forEach(pill => {
      pill.addEventListener("click", () => {
        const shift = shifts.find(s => s.id === pill.dataset.id);
        if (shift) openShiftDrawer(from, to, shift, shifts);
      });
    });
  }

  function renderPlanningRows(shifts, days) {
    const byUser = {};
    shifts.forEach(s => {
      if (!byUser[s.userId]) byUser[s.userId] = { name: s.userName || s.userId, days: {} };
      if (!byUser[s.userId].days[s.date]) byUser[s.userId].days[s.date] = [];
      byUser[s.userId].days[s.date].push(s);
    });
    if (!Object.keys(byUser).length) return `<tr><td colspan="${days.length+1}" class="adm-empty">Geen shifts deze week</td></tr>`;
    return Object.values(byUser).map(u => `
      <tr>
        <td>${u.name}</td>
        ${days.map(d => `<td>${(u.days[d]||[]).map(s =>
          `<span class="adm-shift-pill" data-id="${s.id}" title="Klik om te bewerken"
            style="background:#e0e7ff;color:#4338ca;border-radius:4px;padding:2px 6px;font-size:11px;cursor:pointer;display:inline-block;margin-bottom:2px;">
            ${esc(s.start||"")}${s.end?`–${esc(s.end)}`:""}</span>`
        ).join(" ")||"—"}</td>`).join("")}
      </tr>`).join("");
  }

  // ── Shift drawer (admin) ───────────────────────────────────
  function openShiftDrawer(weekFrom, weekTo, shift = null, allShifts = []) {
    const today = new Date().toISOString().slice(0, 10);
    api("GET", "/employees").then(data => {
      const employees = data.employees || [];
      const isEdit = !!shift;
      document.getElementById("admDrawerTitle").textContent = isEdit ? "Shift bewerken" : "Shift toevoegen";
      document.getElementById("admDrawerBody").innerHTML = `
<form id="admShiftForm">
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Medewerker *</label>
      <select name="userId" required>
        <option value="">— Kies medewerker —</option>
        ${employees.map(u => `<option value="${esc(u.id)}" ${shift?.userId===u.id?"selected":""}>${esc(u.name || u.email)}</option>`).join("")}
      </select>
    </div>
    <div class="adm-form-group"><label>Datum *</label>
      <input name="date" type="date" value="${shift?.date || weekFrom || today}" required>
    </div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Starttijd *</label>
      <input name="start" type="time" value="${shift?.start || "07:00"}" required>
    </div>
    <div class="adm-form-group"><label>Eindtijd *</label>
      <input name="end" type="time" value="${shift?.end || "17:00"}" required>
    </div>
  </div>
  <div class="adm-form-group"><label>Locatie / Werf</label>
    <input name="venueId" placeholder="Locatienaam (optioneel)" value="${esc(shift?.venueId||shift?.location||"")}">
  </div>
  <div class="adm-form-group"><label>Notitie</label>
    <input name="note" placeholder="Optionele notitie" value="${esc(shift?.note||"")}">
  </div>
  <div id="admShiftErr" style="display:none;color:#ef4444;font-size:12px;padding:4px 0;"></div>
  <div class="adm-form-actions" style="justify-content:space-between;">
    ${isEdit ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="admShiftDelete">🗑 Verwijderen</button>` : `<span></span>`}
    <div style="display:flex;gap:8px;">
      <button type="button" class="adm-btn adm-btn-secondary" id="admShiftCancel">Annuleren</button>
      <button type="submit" class="adm-btn adm-btn-primary">${isEdit ? "Opslaan" : "Aanmaken"}</button>
    </div>
  </div>
</form>`;
      openDrawer();
      document.getElementById("admShiftCancel").addEventListener("click", closeDrawer);

      if (isEdit) {
        document.getElementById("admShiftDelete").addEventListener("click", async () => {
          if (!confirm(`Shift verwijderen voor ${shift.userName||shift.userId} op ${shift.date}?`)) return;
          try {
            await api("DELETE", `/planning/${shift.id}`);
            closeDrawer(); renderPlanning();
          } catch(err) { alert(err.message); }
        });
      }

      document.getElementById("admShiftForm").addEventListener("submit", async e => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target).entries());
        const errEl = document.getElementById("admShiftErr");
        const submitBtn = e.target.querySelector("[type=submit]");
        errEl.style.display = "none";
        submitBtn.disabled = true; submitBtn.textContent = "Bezig…";
        try {
          if (isEdit) await api("PATCH", `/planning/${shift.id}`, body);
          else await api("POST", "/planning", body);
          closeDrawer(); renderPlanning();
        } catch (err) {
          errEl.textContent = err.message; errEl.style.display = "";
          submitBtn.disabled = false; submitBtn.textContent = isEdit ? "Opslaan" : "Aanmaken";
        }
      });
    }).catch(err => alert(err.message));
  }

  // ── Clocking ───────────────────────────────────────────────
  let _clockDate = new Date().toISOString().slice(0, 10);

  async function renderClocking() {
    const content = document.getElementById("admContent");

    // Always reset to today if view freshly entered
    if (!content.querySelector("#admClockDate")) {
      content.innerHTML = `
<div class="adm-card" style="margin-bottom:14px">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Prikklok overzicht</h3>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="date" id="admClockDate" value="${_clockDate}" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admClockPrev">‹ Vorige</button>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admClockToday">Vandaag</button>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admClockNext">Volgende ›</button>
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="admClockAdd">+ Correctie</button>
    </div>
  </div>
</div>
<div class="adm-card">
  <div class="adm-card-body adm-table-wrap" id="admClockTable"><div class="adm-loading">Laden…</div></div>
</div>`;

      document.getElementById("admClockDate").addEventListener("change", e => {
        _clockDate = e.target.value;
        loadClockData();
      });
      document.getElementById("admClockPrev").addEventListener("click", () => {
        const d = new Date(_clockDate); d.setDate(d.getDate() - 1);
        _clockDate = d.toISOString().slice(0, 10);
        document.getElementById("admClockDate").value = _clockDate;
        loadClockData();
      });
      document.getElementById("admClockNext").addEventListener("click", () => {
        const d = new Date(_clockDate); d.setDate(d.getDate() + 1);
        _clockDate = d.toISOString().slice(0, 10);
        document.getElementById("admClockDate").value = _clockDate;
        loadClockData();
      });
      document.getElementById("admClockToday").addEventListener("click", () => {
        _clockDate = new Date().toISOString().slice(0, 10);
        document.getElementById("admClockDate").value = _clockDate;
        loadClockData();
      });
      document.getElementById("admClockAdd").addEventListener("click", openClockCorrectionDrawer);
    }

    loadClockData();
  }

  async function loadClockData() {
    const tableEl = document.getElementById("admClockTable");
    if (!tableEl) return;
    tableEl.innerHTML = `<div class="adm-loading">Laden…</div>`;
    try {
      const data = await api("GET", `/clocks?date=${_clockDate}`);
      const clocks = data.clocks || data || [];

      const totalHours = clocks.reduce((sum, c) => {
        if (!c.clockedOut) return sum;
        return sum + (new Date(c.clockedOut) - new Date(c.clockedIn)) / 3600000;
      }, 0);
      const ingeklokt = clocks.filter(c => c.status === "in" || !c.clockedOut).length;

      tableEl.innerHTML = `
<div style="display:flex;gap:12px;padding:12px 16px 0;flex-wrap:wrap;">
  <div style="background:#eff6ff;border-radius:8px;padding:8px 14px;text-align:center">
    <div style="font-size:18px;font-weight:700;color:#1d4ed8">${clocks.length}</div>
    <div style="font-size:11px;color:#64748b">Registraties</div>
  </div>
  <div style="background:${ingeklokt>0?"#d1fae5":"#f8fafc"};border-radius:8px;padding:8px 14px;text-align:center">
    <div style="font-size:18px;font-weight:700;color:${ingeklokt>0?"#065f46":"#94a3b8"}">${ingeklokt}</div>
    <div style="font-size:11px;color:#64748b">Nog ingeklokt</div>
  </div>
  <div style="background:#f0fdf4;border-radius:8px;padding:8px 14px;text-align:center">
    <div style="font-size:18px;font-weight:700;color:#15803d">${totalHours.toFixed(1)} u</div>
    <div style="font-size:11px;color:#64748b">Totaal uren</div>
  </div>
</div>
<table class="adm-table" style="margin-top:10px">
  <thead><tr><th>Medewerker</th><th>Inkloktijd</th><th>Uitkloktijd</th><th>Uren</th><th>Status</th><th>Actie</th></tr></thead>
  <tbody>
    ${clocks.map(c => {
      const hours = c.clockedOut ? ((new Date(c.clockedOut) - new Date(c.clockedIn)) / 3600000).toFixed(1) : "—";
      const noOut = !c.clockedOut;
      return `<tr>
        <td style="font-weight:500">${esc(c.userName || c.userId)}</td>
        <td>${c.clockedIn ? new Date(c.clockedIn).toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit"}) : "—"}</td>
        <td>${c.clockedOut ? new Date(c.clockedOut).toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit"}) : '<span style="color:#f59e0b">Niet uitgeklokt</span>'}</td>
        <td>${hours}</td>
        <td>${c.status==="in"||noOut ? '<span class="adm-status adm-status-active">Ingeklokt</span>' : '<span class="adm-status adm-status-inactive">Uitgeklokt</span>'}</td>
        <td>${noOut ? `<button class="adm-btn adm-btn-warning adm-btn-sm clk-force-out" data-id="${esc(c.id)}" data-uid="${esc(c.userId)}">Klokt uit</button>` : `<button class="adm-btn adm-btn-secondary adm-btn-sm clk-edit" data-id="${esc(c.id)}">✏ Corrigeer</button>`}</td>
      </tr>`;
    }).join("") || '<tr><td colspan="6" class="adm-empty">Geen klokregistraties voor deze datum</td></tr>'}
  </tbody>
</table>`;

      // Wire force-out buttons
      document.querySelectorAll(".clk-force-out").forEach(btn => {
        btn.addEventListener("click", async () => {
          const now = new Date().toISOString();
          btn.disabled = true;
          try { await api("PATCH", `/clocks/${btn.dataset.id}`, { clockedOut: now, status: "out" }); loadClockData(); }
          catch(e) { alert(e.message); btn.disabled = false; }
        });
      });
      // Wire edit buttons
      document.querySelectorAll(".clk-edit").forEach(btn => {
        btn.addEventListener("click", () => openClockEditDrawer(btn.dataset.id, clocks));
      });

    } catch(e) {
      tableEl.innerHTML = `<div class="adm-empty" style="color:#dc2626">Fout: ${e.message}</div>`;
    }
  }

  function openClockCorrectionDrawer() {
    // Load employees to pick from
    const empPromise = (_state.employees && _state.employees.length)
      ? Promise.resolve({ employees: _state.employees })
      : api("GET", "/employees");

    empPromise.then(data => {
      const employees = data.employees || [];
      document.getElementById("admDrawerTitle").textContent = "Klokregistratie toevoegen";
      document.getElementById("admDrawerBody").innerHTML = `
<form id="clkAddForm">
  <div class="adm-form-group"><label>Medewerker *</label>
    <select name="userId" required>
      <option value="">— Kies medewerker —</option>
      ${employees.map(u => `<option value="${esc(u.id)}">${esc(u.name||u.email)}</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Datum *</label>
      <input name="date" type="date" value="${_clockDate}" required>
    </div>
    <div class="adm-form-group"><label>Inkloktijd *</label>
      <input name="clockInTime" type="time" value="07:00" required>
    </div>
  </div>
  <div class="adm-form-group"><label>Uitkloktijd (leeg = nog ingeklokt)</label>
    <input name="clockOutTime" type="time">
  </div>
  <div class="adm-form-group"><label>Notitie</label>
    <input name="note" placeholder="Reden van correctie">
  </div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="clkAddCancel">Annuleren</button>
    <button type="submit" class="adm-btn adm-btn-primary">Opslaan</button>
  </div>
</form>`;
      openDrawer();
      document.getElementById("clkAddCancel").addEventListener("click", closeDrawer);
      document.getElementById("clkAddForm").addEventListener("submit", async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const date = fd.get("date");
        const clockInTime = fd.get("clockInTime");
        const clockOutTime = fd.get("clockOutTime");
        const userId = fd.get("userId");
        const emp = employees.find(u => u.id === userId);
        const body = {
          userId,
          userName: emp?.name || emp?.email || userId,
          clockedIn: `${date}T${clockInTime}:00.000Z`,
          clockedOut: clockOutTime ? `${date}T${clockOutTime}:00.000Z` : null,
          status: clockOutTime ? "out" : "in",
          note: fd.get("note") || "Handmatige correctie",
          manual: true
        };
        try {
          await api("POST", "/clocks/manual", body);
          closeDrawer(); loadClockData();
        } catch(err) { alert(err.message); }
      });
    }).catch(e => alert(e.message));
  }

  function openClockEditDrawer(clockId, clocks) {
    const clk = clocks.find(c => c.id === clockId);
    if (!clk) return;
    const inTime = clk.clockedIn ? new Date(clk.clockedIn).toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit",hour12:false}) : "";
    const outTime = clk.clockedOut ? new Date(clk.clockedOut).toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit",hour12:false}) : "";
    document.getElementById("admDrawerTitle").textContent = `Klok corrigeren — ${esc(clk.userName||clk.userId)}`;
    document.getElementById("admDrawerBody").innerHTML = `
<form id="clkEditForm">
  <div class="adm-form-group"><label>Medewerker</label>
    <input value="${esc(clk.userName||clk.userId)}" disabled style="background:#f8fafc">
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Inkloktijd *</label>
      <input name="clockInTime" type="time" value="${inTime}" required>
    </div>
    <div class="adm-form-group"><label>Uitkloktijd</label>
      <input name="clockOutTime" type="time" value="${outTime}">
    </div>
  </div>
  <div class="adm-form-group"><label>Reden correctie</label>
    <input name="note" placeholder="Bijv. vergeten uitkloktijd" value="${esc(clk.note||"")}">
  </div>
  <div id="clkEditErr" style="display:none;color:#ef4444;font-size:12px;padding:6px 0;margin-bottom:4px;"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="clkEditCancel">Annuleren</button>
    <button type="submit" class="adm-btn adm-btn-primary">Opslaan</button>
  </div>
</form>`;
    openDrawer();
    document.getElementById("clkEditCancel").addEventListener("click", closeDrawer);
    document.getElementById("clkEditForm").addEventListener("submit", async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const date = _clockDate;
      const clockInTime  = fd.get("clockInTime");
      const clockOutTime = fd.get("clockOutTime");
      const errEl = document.getElementById("clkEditErr");
      errEl.style.display = "none";

      // Validation
      const nowStr = new Date().toISOString().slice(0,10);
      const inISO  = `${date}T${clockInTime}:00`;
      const outISO = clockOutTime ? `${date}T${clockOutTime}:00` : null;

      if (date > nowStr) {
        errEl.textContent = "Datum mag niet in de toekomst liggen."; errEl.style.display = ""; return;
      }
      if (date === nowStr) {
        const nowTime = new Date().toTimeString().slice(0,5);
        if (clockInTime > nowTime) {
          errEl.textContent = "Inkloktijd mag niet in de toekomst liggen."; errEl.style.display = ""; return;
        }
        if (outISO && clockOutTime > nowTime) {
          errEl.textContent = "Uitkloktijd mag niet in de toekomst liggen."; errEl.style.display = ""; return;
        }
      }
      if (outISO && outISO <= inISO) {
        errEl.textContent = "Uitkloktijd moet na inkloktijd liggen."; errEl.style.display = ""; return;
      }

      const body = {
        clockedIn:  `${date}T${clockInTime}:00.000Z`,
        clockedOut: outISO ? `${date}T${clockOutTime}:00.000Z` : null,
        status: clockOutTime ? "out" : "in",
        note: fd.get("note") || undefined
      };
      const submitBtn = e.target.querySelector("[type=submit]");
      submitBtn.disabled = true; submitBtn.textContent = "Opslaan…";
      try {
        await api("PATCH", `/clocks/${clockId}`, body);
        closeDrawer(); loadClockData();
      } catch(err) {
        errEl.textContent = err.message; errEl.style.display = "";
        submitBtn.disabled = false; submitBtn.textContent = "Opslaan";
      }
    });
  }

  // ── Leaves ─────────────────────────────────────────────────
  let _leaveTab = "aanvragen";
  let _leaveCalYear  = new Date().getFullYear();
  let _leaveCalMonth = new Date().getMonth() + 1;

  async function renderLeaves() {
    const content = document.getElementById("admContent");
    content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Verlof</h3>
    <div style="display:flex;gap:6px;">
      <button class="adm-btn adm-btn-sm ${_leaveTab==="aanvragen"?"adm-btn-primary":"adm-btn-secondary"}" id="admLeaveTabReq">Aanvragen</button>
      <button class="adm-btn adm-btn-sm ${_leaveTab==="kalender"?"adm-btn-primary":"adm-btn-secondary"}" id="admLeaveTabCal">Kalender</button>
      <button class="adm-btn adm-btn-sm ${_leaveTab==="saldi"?"adm-btn-primary":"adm-btn-secondary"}" id="admLeaveTabBal">Saldi</button>
    </div>
  </div>
  <div class="adm-card-body" id="admLeaveBody" style="padding:0;"></div>
</div>`;

    document.getElementById("admLeaveTabReq").addEventListener("click", () => { _leaveTab = "aanvragen"; renderLeaveBody(); });
    document.getElementById("admLeaveTabCal").addEventListener("click", () => { _leaveTab = "kalender"; renderLeaveBody(); });
    document.getElementById("admLeaveTabBal").addEventListener("click", () => { _leaveTab = "saldi"; renderLeaveBody(); });
    renderLeaveBody();
  }

  async function renderLeaveBody() {
    // Update tab button styles
    ["aanvragen","kalender","saldi"].forEach(t => {
      const btn = document.getElementById(t==="aanvragen"?"admLeaveTabReq":t==="kalender"?"admLeaveTabCal":"admLeaveTabBal");
      if (btn) { btn.className = `adm-btn adm-btn-sm ${_leaveTab===t?"adm-btn-primary":"adm-btn-secondary"}`; }
    });

    const body = document.getElementById("admLeaveBody");
    if (!body) return;
    body.innerHTML = `<div style="padding:24px;text-align:center;color:#94a3b8;font-size:13px;">Laden…</div>`;

    if (_leaveTab === "aanvragen") {
      const data = await api("GET", "/leaves");
      const leaves = data.leaves || data || [];
      body.innerHTML = `
<div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;display:flex;gap:8px;align-items:center;">
  <select id="admLeaveFilter" style="padding:6px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
    <option value="">Alle statussen</option>
    <option value="aangevraagd">Aangevraagd</option>
    <option value="goedgekeurd">Goedgekeurd</option>
    <option value="geweigerd">Geweigerd</option>
  </select>
</div>
<div class="adm-table-wrap" id="admLeaveTable">${renderLeaveTable(leaves)}</div>`;
      document.getElementById("admLeaveFilter").addEventListener("change", e => {
        const filtered = e.target.value ? leaves.filter(l => l.status === e.target.value) : leaves;
        document.getElementById("admLeaveTable").innerHTML = renderLeaveTable(filtered);
        bindLeaveActions(leaves);
      });
      bindLeaveActions(leaves);

    } else if (_leaveTab === "kalender") {
      await renderLeaveCalendar(body);

    } else {
      await renderLeaveBalance(body);
    }
  }

  async function renderLeaveCalendar(container) {
    const MONTHS_NL = ["","Januari","Februari","Maart","April","Mei","Juni","Juli","Augustus","September","Oktober","November","December"];
    const DAYS_NL   = ["Zo","Ma","Di","Wo","Do","Vr","Za"];

    let calData;
    try {
      calData = await api("GET", `/leaves/calendar?year=${_leaveCalYear}&month=${_leaveCalMonth}`);
    } catch(e) {
      container.innerHTML = `<div style="padding:24px;color:#ef4444;">${esc(e.message)}</div>`;
      return;
    }
    const { days = {}, leaves = [] } = calData;

    // Build userId→name map — fetch employees if not yet loaded
    if (!_state.employees?.length) {
      try { const d = await api("GET", "/employees?includeInactive=true"); _state.employees = d.employees || d || []; } catch(_) {}
    }
    const empMap = {};
    (_state.employees||[]).forEach(u => { empMap[u.id] = u.name || u.email; });
    leaves.forEach(l => { if (l.userId && l.userName && !empMap[l.userId]) empMap[l.userId] = l.userName; });

    const firstDow = new Date(_leaveCalYear, _leaveCalMonth - 1, 1).getDay(); // 0=Sun
    const lastDay  = new Date(_leaveCalYear, _leaveCalMonth, 0).getDate();

    // calendar grid
    let cells = "";
    let col = firstDow === 0 ? 6 : firstDow - 1; // shift: Mon=0
    for (let i = 0; i < col; i++) cells += `<div></div>`;
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${_leaveCalYear}-${String(_leaveCalMonth).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const userIds = days[dateStr] || [];
      const dow = new Date(_leaveCalYear, _leaveCalMonth - 1, d).getDay();
      const isWeekend = dow === 0 || dow === 6;
      const isToday = dateStr === new Date().toISOString().slice(0,10);
      cells += `<div style="min-height:52px;border-radius:8px;padding:4px 6px;background:${isToday?"#eff6ff":isWeekend?"#f8fafc":"#fff"};border:1px solid ${isToday?"#bfdbfe":"#e2e8f0"};">
        <div style="font-size:11px;font-weight:${isToday?"700":"500"};color:${isWeekend?"#94a3b8":isToday?"#2563eb":"#374151"};margin-bottom:2px;">${d}</div>
        ${userIds.slice(0,3).map(uid => `<div style="font-size:10px;background:#dbeafe;color:#1e40af;border-radius:4px;padding:1px 4px;margin-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(empMap[uid]||uid)}">${esc((empMap[uid]||uid).split(" ")[0])}</div>`).join("")}
        ${userIds.length > 3 ? `<div style="font-size:10px;color:#64748b;">+${userIds.length-3}</div>` : ""}
      </div>`;
    }

    container.innerHTML = `
<div style="padding:16px;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admCalPrev">‹</button>
    <span style="font-size:15px;font-weight:600;min-width:160px;text-align:center;">${MONTHS_NL[_leaveCalMonth]} ${_leaveCalYear}</span>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admCalNext">›</button>
    <span style="font-size:12px;color:#64748b;margin-left:8px;">${leaves.length} goedgekeurde verloven</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px;">
    ${["Ma","Di","Wo","Do","Vr","Za","Zo"].map(d=>`<div style="text-align:center;font-size:11px;font-weight:600;color:#64748b;padding:4px 0;">${d}</div>`).join("")}
  </div>
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">${cells}</div>
  ${leaves.length ? `
  <div style="margin-top:16px;padding-top:12px;border-top:1px solid #f1f5f9;">
    <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Verloven deze maand</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
    ${leaves.map(l=>`<div style="font-size:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:4px 8px;color:#166534;">
      <strong>${esc(empMap[l.userId]||l.userId)}</strong> · ${esc(l.type)} · ${l.startDate}→${l.endDate} (${l.days}d)
    </div>`).join("")}
    </div>
  </div>` : ""}
</div>`;

    document.getElementById("admCalPrev").addEventListener("click", () => {
      _leaveCalMonth--;
      if (_leaveCalMonth < 1) { _leaveCalMonth = 12; _leaveCalYear--; }
      renderLeaveCalendar(container);
    });
    document.getElementById("admCalNext").addEventListener("click", () => {
      _leaveCalMonth++;
      if (_leaveCalMonth > 12) { _leaveCalMonth = 1; _leaveCalYear++; }
      renderLeaveCalendar(container);
    });
  }

  async function renderLeaveBalance(container) {
    const year = new Date().getFullYear();
    let balData;
    try {
      balData = await api("GET", `/leaves/balance?year=${year}`);
    } catch(e) {
      container.innerHTML = `<div style="padding:24px;color:#ef4444;">${esc(e.message)}</div>`;
      return;
    }
    const balance = balData.balance || [];
    if (!balance.length) {
      container.innerHTML = `<div style="padding:24px;text-align:center;color:#94a3b8;">Geen medewerkers gevonden.</div>`;
      return;
    }

    container.innerHTML = `
<div style="padding:16px;">
  <div style="font-size:13px;color:#64748b;margin-bottom:12px;">Vakantiesaldo ${year} — op basis van goedgekeurde verlofaanvragen</div>
  <table class="adm-table">
    <thead><tr><th>Medewerker</th><th>Quota</th><th>Gebruikt</th><th>Resterend</th><th>Voortgang</th></tr></thead>
    <tbody>${balance.map(b => {
      const pct = b.quota ? Math.min(100, Math.round((b.used / b.quota) * 100)) : 0;
      const color = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#10b981";
      return `<tr>
        <td><div style="font-weight:500;">${esc(b.name)}</div><div style="font-size:11px;color:#94a3b8;">${esc(b.email)}</div></td>
        <td>${b.quota}d</td>
        <td>${b.used}d</td>
        <td style="font-weight:600;color:${b.remaining<=2?"#ef4444":b.remaining<=5?"#f59e0b":"#10b981"};">${b.remaining}d</td>
        <td style="min-width:120px;">
          <div style="background:#f1f5f9;border-radius:20px;height:8px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${color};border-radius:20px;transition:width .3s;"></div>
          </div>
          <div style="font-size:10px;color:#94a3b8;margin-top:2px;">${pct}%</div>
        </td>
      </tr>`;
    }).join("")}</tbody>
  </table>
</div>`;
  }

  function renderLeaveTable(leaves) {
    if (!leaves.length) return `<div class="adm-empty"><div class="adm-empty-icon">📅</div><div class="adm-empty-text">Geen verlofaanvragen</div></div>`;
    return `<table class="adm-table">
      <thead><tr><th>Medewerker</th><th>Type</th><th>Van</th><th>Tot</th><th>Reden</th><th>Status</th><th>Opmerking</th><th>Acties</th></tr></thead>
      <tbody>${leaves.map(l => `
        <tr>
          <td>${esc(l.userName || l.userId)}</td>
          <td>${esc(l.type||"—")}</td>
          <td>${esc(l.startDate||"")}</td>
          <td>${esc(l.endDate||"")}</td>
          <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(l.reason||"")}">${esc(l.reason||"—")}</td>
          <td><span class="adm-status adm-status-${l.status}">${esc(l.status||"")}</span></td>
          <td style="font-size:12px;color:#64748b;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(l.reviewNote||"")}">${esc(l.reviewNote||"—")}</td>
          <td style="white-space:nowrap;">${l.status==="aangevraagd" ? `
            <button class="adm-btn adm-btn-success adm-btn-sm adm-leave-action" data-id="${esc(l.id)}" data-status="goedgekeurd">✓ Goed</button>
            <button class="adm-btn adm-btn-danger adm-btn-sm adm-leave-action" data-id="${esc(l.id)}" data-status="geweigerd">✗ Weiger</button>
          ` : "—"}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  }

  function bindLeaveActions(leaves) {
    document.querySelectorAll(".adm-leave-action").forEach(btn => {
      btn.addEventListener("click", () => {
        const decision = btn.dataset.status || btn.dataset.decision;
        const leave    = leaves.find(l => l.id === btn.dataset.id);
        openLeaveReviewModal(btn.dataset.id, decision, leave, () => renderLeaves());
      });
    });
  }

  function openLeaveReviewModal(leaveId, decision, leave, onDone) {
    const isApprove = decision === "goedgekeurd";
    const label = isApprove ? "Verlof goedkeuren" : "Verlof weigeren";
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
<div style="background:#fff;border-radius:14px;width:420px;max-width:100%;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2);">
  <h3 style="font-size:15px;font-weight:700;margin:0 0 6px;">${label}</h3>
  <p style="font-size:13px;color:#64748b;margin:0 0 16px;">${esc(leave?.userName||leave?.userId||"")} · ${esc(leave?.type||"verlof")} · ${leave?.startDate||""}${leave?.endDate&&leave?.endDate!==leave?.startDate?" → "+leave?.endDate:""}</p>
  <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Opmerking ${isApprove?"(optioneel)":"(optioneel)"}</label>
  <textarea id="admLeaveNote" rows="3" placeholder="Voeg een opmerking toe…"
    style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea>
  <div id="admLeaveModalErr" style="display:none;color:#ef4444;font-size:12px;margin-top:6px;"></div>
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
    <button id="admLeaveModalCancel" class="adm-btn adm-btn-secondary adm-btn-sm">Annuleren</button>
    <button id="admLeaveModalConfirm" class="adm-btn ${isApprove?"adm-btn-success":"adm-btn-danger"} adm-btn-sm">${label}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
    document.getElementById("admLeaveModalCancel").addEventListener("click", close);
    document.getElementById("admLeaveModalConfirm").addEventListener("click", async () => {
      const reviewNote = document.getElementById("admLeaveNote").value.trim();
      const confirmBtn = document.getElementById("admLeaveModalConfirm");
      const errEl      = document.getElementById("admLeaveModalErr");
      confirmBtn.disabled = true; confirmBtn.textContent = "…";
      try {
        await api("PATCH", `/leaves/${leaveId}/review`, { decision, reviewNote: reviewNote || undefined });
        close();
        if (onDone) onDone();
      } catch(e) {
        errEl.textContent = e.message; errEl.style.display = "block";
        confirmBtn.disabled = false; confirmBtn.textContent = label;
      }
    });
  }

  // ── Expenses ───────────────────────────────────────────────
  async function renderExpenses() {
    const data = await api("GET", "/expenses");
    const expenses = data.expenses || data || [];

    const content = document.getElementById("admContent");
    content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Onkostennota's <span style="background:#e0f2fe;color:#0284c7;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${expenses.length}</span></h3>
  </div>
  <div class="adm-card-body adm-table-wrap">
    <table class="adm-table">
      <thead><tr><th>Medewerker</th><th>Datum</th><th>Categorie</th><th>Bedrag</th><th>Omschrijving</th><th>Status</th><th>Acties</th></tr></thead>
      <tbody>
        ${expenses.map(e => `
        <tr>
          <td>${esc(e.userName || e.userId)}</td>
          <td>${esc(e.date)}</td>
          <td>${esc(e.category||"—")}</td>
          <td style="font-weight:600;">€ ${Number(e.amount||0).toFixed(2)}</td>
          <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(e.description||"")}">${esc(e.description||"—")}</td>
          <td>
            <span class="adm-status adm-status-${e.status}">${esc(e.status)}</span>
            ${e.reviewNote ? `<div style="font-size:11px;color:#64748b;margin-top:2px;" title="${esc(e.reviewNote)}">💬 ${esc(e.reviewNote.slice(0,30))}${e.reviewNote.length>30?"…":""}</div>` : ""}
          </td>
          <td style="white-space:nowrap;">${["pending","ingediend"].includes(e.status) ? `
            <button class="adm-btn adm-btn-success adm-btn-sm adm-exp-review" data-id="${e.id}" data-dec="goedgekeurd" data-name="${esc(e.userName||e.userId)}" data-amount="${e.amount}" data-cat="${esc(e.category||"")}">✓ Goed</button>
            <button class="adm-btn adm-btn-danger  adm-btn-sm adm-exp-review" data-id="${e.id}" data-dec="geweigerd"  data-name="${esc(e.userName||e.userId)}" data-amount="${e.amount}" data-cat="${esc(e.category||"")}">✗ Weiger</button>
          ` : "—"}</td>
        </tr>`).join("") || '<tr><td colspan="7" class="adm-empty">Geen onkosten</td></tr>'}
      </tbody>
    </table>
  </div>
</div>`;

    content.querySelectorAll(".adm-exp-review").forEach(btn => {
      btn.addEventListener("click", () => openExpenseReviewModal(btn.dataset, renderExpenses));
    });
  }

  function openExpenseReviewModal({ id, dec, name, amount, cat }, onDone) {
    const isApprove = dec === "goedgekeurd";
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:100%;max-width:400px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2);">
  <div style="font-size:15px;font-weight:700;margin-bottom:4px;">${isApprove ? "Onkost goedkeuren" : "Onkost weigeren"}</div>
  <div style="font-size:13px;color:#64748b;margin-bottom:16px;">${esc(name)} · ${esc(cat)} · <strong>€ ${Number(amount||0).toFixed(2)}</strong></div>
  <div style="margin-bottom:16px;">
    <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Opmerking ${isApprove?"(optioneel)":"(verplicht bij weigering)"}</label>
    <textarea id="expReviewNote" rows="3" placeholder="${isApprove?"Goedgekeurd voor uitbetaling…":"Geef een reden op…"}"
      style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea>
  </div>
  <div id="expReviewErr" style="display:none;color:#ef4444;font-size:12px;margin-bottom:8px;"></div>
  <div style="display:flex;gap:8px;justify-content:flex-end;">
    <button id="expReviewCancel" class="adm-btn adm-btn-secondary adm-btn-sm">Annuleren</button>
    <button id="expReviewConfirm" class="adm-btn ${isApprove?"adm-btn-success":"adm-btn-danger"} adm-btn-sm">${isApprove?"✓ Goedkeuren":"✗ Weigeren"}</button>
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
        window.showToast && window.showToast(isApprove ? "Onkost goedgekeurd ✓" : "Onkost geweigerd", isApprove ? "success" : "info");
        onDone();
      } catch(e) {
        errEl.textContent = e.message; errEl.style.display = "";
        confirmBtn.disabled = false; confirmBtn.textContent = isApprove ? "✓ Goedkeuren" : "✗ Weigeren";
      }
    });
  }

  // ── Workorders ─────────────────────────────────────────────
  let _woFilterStatus = "";
  let _woFilterUser   = "";
  let _woFilterSearch = "";

  async function renderWorkorders() {
    const content = document.getElementById("admContent");

    // load workorders + employees in parallel for the filter dropdown
    const [woData, empData] = await Promise.all([
      api("GET", "/workorders"),
      api("GET", "/employees").catch(() => ({ employees: [] }))
    ]);
    const allWorkorders = woData.workorders || woData || [];
    const employees     = empData.employees || [];

    // Status groups
    const DONE_STATUSES = new Set(["Voltooid","Afgewerkt","done"]);
    const statusGroupMatch = (w) => {
      if (!_woFilterStatus) return true;
      if (_woFilterStatus === "done") return DONE_STATUSES.has(w.status);
      return w.status === _woFilterStatus;
    };
    // apply filters client-side
    const workorders = allWorkorders.filter(w => {
      if (!statusGroupMatch(w)) return false;
      if (_woFilterUser   && w.userId !== _woFilterUser)   return false;
      if (_woFilterSearch) {
        const q = _woFilterSearch.toLowerCase();
        const hay = `${w.title||""} ${w.clientName||""} ${w.userName||""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const statusCounts = {};
    allWorkorders.forEach(w => { statusCounts[w.status] = (statusCounts[w.status]||0)+1; });
    const doneCount = ["Voltooid","Afgewerkt","done"].reduce((s,k) => s+(statusCounts[k]||0), 0);

    content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Werkbonnen
      <span style="background:#e0f2fe;color:#0284c7;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${workorders.length}/${allWorkorders.length}</span>
    </h3>
    <button class="adm-btn adm-btn-primary adm-btn-sm" id="admNewWO">+ Werkbon</button>
  </div>

  <!-- Filter bar -->
  <div style="display:flex;gap:10px;flex-wrap:wrap;padding:0 20px 14px;border-bottom:1px solid #f1f5f9;">
    <input id="admWoSearch" type="search" placeholder="Zoek op titel / klant…" value="${esc(_woFilterSearch)}"
      style="flex:1;min-width:160px;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;font-size:13px;">
    <select id="admWoStatusFilter" style="border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;font-size:13px;min-width:140px;">
      <option value="">Alle statussen</option>
      <option value="open"        ${_woFilterStatus==="open"?"selected":""}>Open (${statusCounts.open||0})</option>
      <option value="in_progress" ${_woFilterStatus==="in_progress"?"selected":""}>In uitvoering (${statusCounts.in_progress||0})</option>
      <option value="done"        ${_woFilterStatus==="done"?"selected":""}>Voltooid (${doneCount})</option>
      <option value="geannuleerd" ${_woFilterStatus==="geannuleerd"?"selected":""}>Geannuleerd (${statusCounts.geannuleerd||0})</option>
    </select>
    <select id="admWoUserFilter" style="border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;font-size:13px;min-width:160px;">
      <option value="">Alle medewerkers</option>
      ${employees.map(u => `<option value="${esc(u.id)}" ${_woFilterUser===u.id?"selected":""}>${esc(u.name||u.email)}</option>`).join("")}
    </select>
    ${(_woFilterStatus||_woFilterUser||_woFilterSearch) ? `<button class="adm-btn adm-btn-secondary adm-btn-sm" id="admWoClearFilter" style="white-space:nowrap;">✕ Wis filters</button>` : ""}
  </div>

  <div class="adm-card-body adm-table-wrap">
    <table class="adm-table">
      <thead><tr><th>#</th><th>Titel</th><th>Medewerker</th><th>Klant</th><th>Status</th><th>Prioriteit</th><th>Datum</th><th>Acties</th></tr></thead>
      <tbody>
        ${workorders.map(w => `
        <tr>
          <td style="font-family:monospace;font-size:12px;">${w.number || w.id.slice(-4)}</td>
          <td>${esc(w.title || "—")}</td>
          <td>${esc(w.userName || w.userId || "—")}</td>
          <td>${esc(w.clientName || "—")}</td>
          <td><span class="adm-status adm-status-${(w.status||"").toLowerCase().replace(/\s/g,"-")}">${esc(w.status||"—")}</span></td>
          <td><span style="font-size:12px;">${w.priority==="hoog"?"🔴":w.priority==="laag"?"🟢":"🟡"} ${esc(w.priority||"normaal")}</span></td>
          <td>${w.scheduledDate || w.createdAt?.slice(0,10) || "—"}</td>
          <td><button class="adm-btn adm-btn-secondary adm-btn-sm adm-wo-edit" data-id="${w.id}">✏</button></td>
        </tr>`).join("") || `<tr><td colspan="8" class="adm-empty">${_woFilterStatus||_woFilterUser||_woFilterSearch ? "Geen resultaten voor deze filters" : "Geen werkbonnen"}</td></tr>`}
      </tbody>
    </table>
  </div>
</div>`;

    // Filter events (re-render on change, state persists)
    document.getElementById("admWoSearch")?.addEventListener("input", e => {
      _woFilterSearch = e.target.value.trim(); renderWorkorders();
    });
    document.getElementById("admWoStatusFilter")?.addEventListener("change", e => {
      _woFilterStatus = e.target.value; renderWorkorders();
    });
    document.getElementById("admWoUserFilter")?.addEventListener("change", e => {
      _woFilterUser = e.target.value; renderWorkorders();
    });
    document.getElementById("admWoClearFilter")?.addEventListener("click", () => {
      _woFilterStatus = ""; _woFilterUser = ""; _woFilterSearch = ""; renderWorkorders();
    });

    document.getElementById("admNewWO")?.addEventListener("click", () => openWorkorderDrawer(null, allWorkorders));
    document.querySelectorAll(".adm-wo-edit").forEach(btn => {
      btn.addEventListener("click", () => openWorkorderDrawer(allWorkorders.find(w => w.id === btn.dataset.id), allWorkorders));
    });
  }

  // ── Werkbon drawer ─────────────────────────────────────────
  function openWorkorderDrawer(workorder, _preloadedWOs) {
    api("GET", "/employees").then(data => {
      const employees = data.employees || [];
      document.getElementById("admDrawerTitle").textContent = workorder ? "Werkbon bewerken" : "Nieuwe werkbon";
      document.getElementById("admDrawerBody").innerHTML = `
<form id="woForm">
  <div class="adm-form-group"><label>Titel *</label>
    <input name="title" value="${esc(workorder?.title || "")}" required placeholder="Omschrijving van de opdracht">
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Medewerker</label>
      <select name="userId">
        <option value="">— Niet toegewezen —</option>
        ${employees.map(u => `<option value="${esc(u.id)}" ${workorder?.userId === u.id ? "selected" : ""}>${esc(u.name || u.email)}</option>`).join("")}
      </select>
    </div>
    <div class="adm-form-group"><label>Klant</label>
      <input name="clientName" value="${esc(workorder?.clientName || "")}" placeholder="Naam klant">
    </div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Gepland op</label>
      <input name="scheduledDate" type="date" value="${esc(workorder?.scheduledDate || "")}">
    </div>
    <div class="adm-form-group"><label>Prioriteit</label>
      <select name="priority">
        <option value="normaal" ${!workorder || workorder?.priority === "normaal" ? "selected" : ""}>Normaal</option>
        <option value="hoog" ${workorder?.priority === "hoog" ? "selected" : ""}>Hoog</option>
        <option value="laag" ${workorder?.priority === "laag" ? "selected" : ""}>Laag</option>
      </select>
    </div>
  </div>
  <div class="adm-form-group"><label>Status</label>
    <select name="status">
      <option value="open" ${!workorder || workorder?.status === "open" ? "selected" : ""}>Open</option>
      <option value="in_progress" ${workorder?.status === "in_progress" ? "selected" : ""}>In uitvoering</option>
      <option value="Voltooid" ${workorder?.status === "Voltooid" ? "selected" : ""}>Voltooid</option>
      <option value="Afgewerkt" ${workorder?.status === "Afgewerkt" ? "selected" : ""}>Afgewerkt</option>
      <option value="geannuleerd" ${workorder?.status === "geannuleerd" ? "selected" : ""}>Geannuleerd</option>
    </select>
  </div>
  <div class="adm-form-group"><label>Omschrijving</label>
    <textarea name="description" rows="3" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">${esc(workorder?.description || "")}</textarea>
  </div>
  <div class="adm-form-group"><label>Notities</label>
    <textarea name="notes" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">${esc(workorder?.notes || "")}</textarea>
  </div>
  <div id="woFormErr" style="display:none;background:#fef2f2;color:#dc2626;border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="woCancel">Annuleren</button>
    ${workorder ? `<button type="button" class="adm-btn adm-btn-danger" id="woDelete">🗑 Verwijderen</button>` : ""}
    <button type="submit" class="adm-btn adm-btn-primary">${workorder ? "Opslaan" : "Aanmaken"}</button>
  </div>
</form>`;
      openDrawer();
      document.getElementById("woCancel").addEventListener("click", closeDrawer);
      document.getElementById("woDelete")?.addEventListener("click", async () => {
        if (!confirm(`Werkbon "${workorder.title}" verwijderen?`)) return;
        try {
          await api("DELETE", `/workorders/${workorder.id}`);
          closeDrawer(); renderWorkorders();
        } catch(err) {
          const errEl = document.getElementById("woFormErr");
          if (errEl) { errEl.textContent = err.message; errEl.style.display = "block"; }
        }
      });
      document.getElementById("woForm").addEventListener("submit", async e => {
        e.preventDefault();
        const errEl = document.getElementById("woFormErr");
        const body = Object.fromEntries(new FormData(e.target).entries());
        try {
          if (workorder) await api("PATCH", `/workorders/${workorder.id}`, body);
          else await api("POST", "/workorders", body);
          closeDrawer();
          renderWorkorders();
        } catch (err) {
          if (errEl) { errEl.textContent = err.message; errEl.style.display = "block"; }
          else alert(err.message);
        }
      });
    }).catch(err => alert(err.message));
  }

  // ── Messages ───────────────────────────────────────────────
  async function renderMessages() {
    const data = await api("GET", "/messages");
    const messages = data.messages || data || [];

    const toLabel = m => {
      if (m.recipientId) return `👤 Persoonlijk`;
      if (m.toRole === "all") return "📢 Alle medewerkers";
      if (m.toRole === "employee") return "👷 Medewerkers";
      if (m.toRole === "manager") return "👔 Managers";
      return "📢 Iedereen";
    };

    const content = document.getElementById("admContent");
    content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Berichten <span style="background:#e0f2fe;color:#0284c7;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${messages.length}</span></h3>
  </div>
  <div class="adm-card-body adm-table-wrap">
    <table class="adm-table">
      <thead><tr><th>Van</th><th>Aan</th><th>Onderwerp</th><th>Bericht</th><th>Datum</th><th>Acties</th></tr></thead>
      <tbody>
        ${messages.length ? messages.map(m => `
        <tr>
          <td>${esc(m.senderName||m.senderId||"Systeem")}</td>
          <td><span style="font-size:11px;background:#f1f5f9;border-radius:4px;padding:2px 6px;">${toLabel(m)}</span></td>
          <td style="font-weight:500;">${esc(m.subject||"—")}</td>
          <td style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#64748b;font-size:12px;" title="${esc(m.body||m.message||"")}">${esc(m.body||m.message||"—")}</td>
          <td style="white-space:nowrap;font-size:12px;color:#94a3b8;">${m.createdAt?.slice(0,16)||""}</td>
          <td>
            <button class="adm-btn adm-btn-secondary adm-btn-sm adm-msg-view" data-id="${esc(m.id)}" title="Bekijk bericht">👁</button>
            <button class="adm-btn adm-btn-danger adm-btn-sm adm-msg-del" data-id="${esc(m.id)}" title="Verwijder" style="margin-left:4px;">🗑</button>
          </td>
        </tr>`).join("") : '<tr><td colspan="6" class="adm-empty">Geen berichten</td></tr>'}
      </tbody>
    </table>
  </div>
</div>`;

    content.querySelectorAll(".adm-msg-view").forEach(btn => {
      btn.addEventListener("click", () => {
        const msg = messages.find(m => m.id === btn.dataset.id);
        if (!msg) return;
        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;";
        overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:100%;max-width:480px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2);">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
    <div>
      <div style="font-size:16px;font-weight:700;color:#0f172a;">${esc(msg.subject||"Bericht")}</div>
      <div style="font-size:12px;color:#64748b;margin-top:4px;">Van: <strong>${esc(msg.senderName||msg.senderId||"?")}</strong> · ${toLabel(msg)} · ${msg.createdAt?.slice(0,16)||""}</div>
    </div>
    <button id="msgViewClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8;padding:0;line-height:1;">×</button>
  </div>
  <div style="background:#f8fafc;border-radius:10px;padding:14px;font-size:14px;line-height:1.6;color:#374151;white-space:pre-wrap;">${esc(msg.body||msg.message||"")}</div>
  <div style="margin-top:16px;display:flex;justify-content:flex-end;">
    <button id="msgViewOk" class="adm-btn adm-btn-primary adm-btn-sm">Sluiten</button>
  </div>
</div>`;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        document.getElementById("msgViewClose").addEventListener("click", close);
        document.getElementById("msgViewOk").addEventListener("click", close);
        overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
      });
    });

    content.querySelectorAll(".adm-msg-del").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Bericht verwijderen?")) return;
        btn.disabled = true; btn.textContent = "…";
        try {
          await api("DELETE", `/messages/${btn.dataset.id}`);
          renderMessages();
        } catch(e) { alert(e.message); btn.disabled = false; btn.textContent = "🗑"; }
      });
    });
  }

  function openMessageDrawer() {
    const employeesReady = _state.employees && _state.employees.length > 0
      ? Promise.resolve({ employees: _state.employees })
      : api("GET", "/employees");

    employeesReady.then(data => {
      const employees = data.employees || [];
      _state.employees = employees;
      const title = document.getElementById("admDrawerTitle");
      const body = document.getElementById("admDrawerBody");
      title.textContent = "Nieuw bericht";
      body.innerHTML = `
<form id="admMsgForm">
  <div class="adm-form-group"><label>Sturen naar</label>
    <select name="toMode" id="admMsgToMode" style="margin-bottom:8px;">
      <option value="all">📢 Alle medewerkers</option>
      <option value="role_employee">👷 Alleen medewerkers (rol: employee)</option>
      <option value="role_manager">👔 Alleen managers</option>
      <option value="person">👤 Specifieke persoon</option>
    </select>
    <select name="recipientId" id="admMsgRecipient" style="display:none;">
      <option value="">— Kies persoon —</option>
      ${employees.map(u => `<option value="${esc(u.id)}">${esc(u.name || u.email)} (${esc(u.role||"")})</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-group"><label>Onderwerp</label><input name="subject" required placeholder="Onderwerp van het bericht"></div>
  <div class="adm-form-group"><label>Bericht *</label><textarea name="body" rows="5" required placeholder="Schrijf hier je bericht…" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea></div>
  <div id="admMsgErr" style="display:none;color:#ef4444;font-size:12px;padding-bottom:4px;"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="admMsgCancel">Annuleren</button>
    <button type="submit" class="adm-btn adm-btn-primary">Verzenden</button>
  </div>
</form>`;
      openDrawer();
      document.getElementById("admMsgCancel").addEventListener("click", closeDrawer);

      // Show/hide person picker based on toMode
      document.getElementById("admMsgToMode").addEventListener("change", e => {
        document.getElementById("admMsgRecipient").style.display = e.target.value === "person" ? "" : "none";
      });

      document.getElementById("admMsgForm").addEventListener("submit", async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const toMode = fd.get("toMode");
        const errEl = document.getElementById("admMsgErr");
        errEl.style.display = "none";

        const body = {
          subject: fd.get("subject"),
          body: fd.get("body")
        };

        if (toMode === "person") {
          const rid = fd.get("recipientId");
          if (!rid) { errEl.textContent = "Kies een ontvanger."; errEl.style.display = ""; return; }
          body.recipientId = rid;
        } else if (toMode === "role_employee") {
          body.toRole = "employee";
          body.toName = "Alle medewerkers";
        } else if (toMode === "role_manager") {
          body.toRole = "manager";
          body.toName = "Alle managers";
        }
        // toMode === "all" → no recipientId/toRole → server broadcasts

        const submitBtn = e.target.querySelector("[type=submit]");
        submitBtn.disabled = true; submitBtn.textContent = "Verzenden…";
        try {
          await api("POST", "/messages", body);
          closeDrawer();
          window.showToast && window.showToast("Bericht verzonden ✓", "success");
          renderMessages();
        } catch (err) {
          errEl.textContent = err.message; errEl.style.display = "";
          submitBtn.disabled = false; submitBtn.textContent = "Verzenden";
        }
      });
    }).catch(err => alert(err.message));
  }

  // ── Reports ────────────────────────────────────────────────
  async function renderReports() {
    const content = document.getElementById("admContent");

    // Periode-kiezer
    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);
    const firstOfMonth = thisMonth + "-01";
    const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

    content.innerHTML = `
<div class="adm-card" style="margin-bottom:16px;">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Rapportages</h3>
    <div style="display:flex;gap:8px;align-items:center;">
      <input type="date" id="repFrom" value="${firstOfMonth}" style="padding:6px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
      <span style="font-size:13px;color:#94a3b8;">t/m</span>
      <input type="date" id="repTo" value="${lastOfMonth}" style="padding:6px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="repLoad">Laden</button>
    </div>
  </div>
</div>

<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px;" id="repKpis">
  <div class="adm-kpi adm-kpi-blue"><div class="adm-kpi-label">Totaal uren</div><div class="adm-kpi-value" id="repKpiHours">—</div><div class="adm-kpi-sub">Geregistreerd</div></div>
  <div class="adm-kpi adm-kpi-green"><div class="adm-kpi-label">Goedgekeurde onkosten</div><div class="adm-kpi-value" id="repKpiExpenses">—</div><div class="adm-kpi-sub">Totaal bedrag</div></div>
  <div class="adm-kpi adm-kpi-amber"><div class="adm-kpi-label">Verlofdagen</div><div class="adm-kpi-value" id="repKpiLeaves">—</div><div class="adm-kpi-sub">Goedgekeurd</div></div>
  <div class="adm-kpi adm-kpi-purple"><div class="adm-kpi-label">Werkbonnen voltooid</div><div class="adm-kpi-value" id="repKpiWO">—</div><div class="adm-kpi-sub">In periode</div></div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
  <!-- Uren per medewerker -->
  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">Uren per medewerker</h3>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repExportClocks">CSV export</button>
    </div>
    <div class="adm-card-body adm-table-wrap" id="repClocksTable">
      <div class="adm-loading">Klik op Laden…</div>
    </div>
  </div>

  <!-- Onkosten overzicht -->
  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">Onkosten overzicht</h3>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repExportExpenses">CSV export</button>
    </div>
    <div class="adm-card-body adm-table-wrap" id="repExpensesTable">
      <div class="adm-loading">Klik op Laden…</div>
    </div>
  </div>

  <!-- Verlof overzicht -->
  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">Verlof overzicht</h3>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repExportLeaves">CSV export</button>
    </div>
    <div class="adm-card-body adm-table-wrap" id="repLeavesTable">
      <div class="adm-loading">Klik op Laden…</div>
    </div>
  </div>

  <!-- Werkbonnen status -->
  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">Werkbonnen status</h3>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repExportWO">CSV export</button>
    </div>
    <div class="adm-card-body adm-table-wrap" id="repWOTable">
      <div class="adm-loading">Klik op Laden…</div>
    </div>
  </div>
</div>`;

    // Cache data voor CSV export
    let _repData = { clocks: [], expenses: [], leaves: [], workorders: [] };

    async function loadReportData() {
      const from = document.getElementById("repFrom").value;
      const to   = document.getElementById("repTo").value;
      if (!from || !to) return;

      try {
        const [clocksRes, expensesRes, leavesRes, woRes] = await Promise.all([
          api("GET", `/clocks?from=${from}&to=${to}`),
          api("GET", `/expenses`),
          api("GET", `/leaves?from=${from}&to=${to}`),
          api("GET", `/workorders`)
        ]);

        const clocks    = clocksRes.clocks || [];
        const expenses  = (expensesRes.expenses || []).filter(e => e.date >= from && e.date <= to);
        const leaves    = leavesRes.leaves || [];
        const workorders = (woRes.workorders || []).filter(w =>
          (w.scheduledDate || w.createdAt?.slice(0,10) || "") >= from &&
          (w.scheduledDate || w.createdAt?.slice(0,10) || "") <= to
        );
        _repData = { clocks, expenses, leaves, workorders };

        // ── KPIs ─────────────────────────────────────────────
        const totalHours = clocks.reduce((sum, c) => {
          if (!c.clockedOut) return sum;
          return sum + (new Date(c.clockedOut) - new Date(c.clockedIn)) / 3600000;
        }, 0);
        const approvedExpenses = expenses.filter(e => ["goedgekeurd","approved"].includes(e.status));
        const totalExp = approvedExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
        const approvedLeaves = leaves.filter(l => l.status === "goedgekeurd");
        const leaveDays = approvedLeaves.reduce((s, l) => {
          if (!l.startDate || !l.endDate) return s;
          const diff = (new Date(l.endDate) - new Date(l.startDate)) / 86400000 + 1;
          return s + diff;
        }, 0);
        const completedWO = workorders.filter(w => ["Voltooid","Afgewerkt"].includes(w.status)).length;

        document.getElementById("repKpiHours").textContent = totalHours.toFixed(1) + " u";
        document.getElementById("repKpiExpenses").textContent = "€" + totalExp.toFixed(0);
        document.getElementById("repKpiLeaves").textContent = leaveDays + " d";
        document.getElementById("repKpiWO").textContent = completedWO;

        // ── Uren per medewerker ───────────────────────────────
        const hoursByUser = {};
        clocks.forEach(c => {
          if (!hoursByUser[c.userId]) hoursByUser[c.userId] = { name: c.userName || c.userId, hours: 0, days: new Set() };
          if (c.clockedOut) {
            hoursByUser[c.userId].hours += (new Date(c.clockedOut) - new Date(c.clockedIn)) / 3600000;
            hoursByUser[c.userId].days.add(c.clockedIn?.slice(0,10));
          }
        });
        const hourRows = Object.values(hoursByUser).sort((a,b) => b.hours - a.hours);
        document.getElementById("repClocksTable").innerHTML = hourRows.length
          ? `<table class="adm-table"><thead><tr><th>Medewerker</th><th>Dagen</th><th>Uren</th><th>Gem/dag</th></tr></thead><tbody>
             ${hourRows.map(r => `<tr><td>${r.name}</td><td>${r.days.size}</td><td>${r.hours.toFixed(1)}</td><td>${r.days.size ? (r.hours/r.days.size).toFixed(1) : "—"}</td></tr>`).join("")}
             </tbody></table>`
          : '<div class="adm-empty">Geen kloktijden in deze periode</div>';

        // ── Onkosten ──────────────────────────────────────────
        document.getElementById("repExpensesTable").innerHTML = expenses.length
          ? `<table class="adm-table"><thead><tr><th>Medewerker</th><th>Datum</th><th>Categorie</th><th>Bedrag</th><th>Status</th></tr></thead><tbody>
             ${expenses.map(e => `<tr><td>${e.userName||e.userId}</td><td>${e.date}</td><td>${e.category||"—"}</td><td>€${Number(e.amount||0).toFixed(2)}</td><td><span class="adm-status adm-status-${e.status}">${e.status}</span></td></tr>`).join("")}
             </tbody></table>`
          : '<div class="adm-empty">Geen onkosten in deze periode</div>';

        // ── Verlof ────────────────────────────────────────────
        document.getElementById("repLeavesTable").innerHTML = leaves.length
          ? `<table class="adm-table"><thead><tr><th>Medewerker</th><th>Type</th><th>Van</th><th>Tot</th><th>Status</th></tr></thead><tbody>
             ${leaves.map(l => `<tr><td>${l.userName||l.userId}</td><td>${l.type||"—"}</td><td>${l.startDate}</td><td>${l.endDate}</td><td><span class="adm-status adm-status-${l.status}">${l.status}</span></td></tr>`).join("")}
             </tbody></table>`
          : '<div class="adm-empty">Geen verlof in deze periode</div>';

        // ── Werkbonnen ────────────────────────────────────────
        const woByStatus = {};
        workorders.forEach(w => { woByStatus[w.status||"Onbekend"] = (woByStatus[w.status||"Onbekend"]||0)+1; });
        document.getElementById("repWOTable").innerHTML = workorders.length
          ? `<table class="adm-table"><thead><tr><th>#</th><th>Titel</th><th>Medewerker</th><th>Status</th><th>Datum</th></tr></thead><tbody>
             ${workorders.map(w => `<tr><td>${w.number||w.id.slice(-4)}</td><td>${w.title||"—"}</td><td>${w.userName||w.userId||"—"}</td><td><span class="adm-status adm-status-${(w.status||"").toLowerCase()}">${w.status||"—"}</span></td><td>${w.scheduledDate||w.createdAt?.slice(0,10)||"—"}</td></tr>`).join("")}
             </tbody></table>`
          : '<div class="adm-empty">Geen werkbonnen in deze periode</div>';

      } catch (err) {
        document.getElementById("repClocksTable").innerHTML = `<div class="adm-empty" style="color:#ef4444;">Fout: ${err.message}</div>`;
      }
    }

    function csvDownload(filename, rows, headers) {
      const lines = [headers.join(";"), ...rows.map(r => r.map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(";"))];
      const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
    }

    document.getElementById("repLoad").addEventListener("click", loadReportData);
    document.getElementById("repExportClocks").addEventListener("click", () => {
      const rows = (_repData.clocks||[]).map(c => {
        const h = c.clockedOut ? ((new Date(c.clockedOut)-new Date(c.clockedIn))/3600000).toFixed(2) : "";
        return [c.userName||c.userId, c.clockedIn?.slice(0,10), c.clockedIn?.slice(11,16)||"", c.clockedOut?.slice(11,16)||"", h];
      });
      csvDownload("uren-export.csv", rows, ["Medewerker","Datum","Inkloktijd","Uitkloktijd","Uren"]);
    });
    document.getElementById("repExportExpenses").addEventListener("click", () => {
      const rows = (_repData.expenses||[]).map(e => [e.userName||e.userId, e.date, e.category||"", e.description||"", e.amount||0, e.status]);
      csvDownload("onkosten-export.csv", rows, ["Medewerker","Datum","Categorie","Omschrijving","Bedrag","Status"]);
    });
    document.getElementById("repExportLeaves").addEventListener("click", () => {
      const rows = (_repData.leaves||[]).map(l => [l.userName||l.userId, l.type||"", l.startDate, l.endDate, l.reason||"", l.status]);
      csvDownload("verlof-export.csv", rows, ["Medewerker","Type","Van","Tot","Reden","Status"]);
    });
    document.getElementById("repExportWO").addEventListener("click", () => {
      const rows = (_repData.workorders||[]).map(w => [w.number||w.id.slice(-4), w.title||"", w.userName||w.userId||"", w.status||"", w.scheduledDate||w.createdAt?.slice(0,10)||""]);
      csvDownload("werkbonnen-export.csv", rows, ["#","Titel","Medewerker","Status","Datum"]);
    });

    // Direct laden
    loadReportData();
  }

  // ── Audit trail ────────────────────────────────────────────
  async function renderAudit() {
    const content = document.getElementById("admContent");
    const todayStr = new Date().toISOString().slice(0,10);
    const weekAgoStr = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
    content.innerHTML = `
<div class="adm-card" style="margin-bottom:16px;">
  <div class="adm-card-header" style="flex-wrap:wrap;gap:8px;">
    <h3 class="adm-card-title">Audittrail</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <input placeholder="Actor (e-mail)" id="auditActor" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;width:160px;">
      <select id="auditArea" style="padding:6px 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
        <option value="">Alle gebieden</option>
        <option value="auth">Auth</option>
        <option value="employees">Medewerkers</option>
        <option value="leaves">Verlof</option>
        <option value="expenses">Onkosten</option>
        <option value="workorders">Werkbonnen</option>
        <option value="planning">Planning</option>
        <option value="clocking">Prikklok</option>
        <option value="messages">Berichten</option>
        <option value="vehicles">Voertuigen</option>
        <option value="stock">Stock</option>
        <option value="settings">Instellingen</option>
      </select>
      <input type="date" id="auditFrom" value="${weekAgoStr}" style="padding:6px 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
      <span style="font-size:12px;color:#94a3b8;">t/m</span>
      <input type="date" id="auditTo" value="${todayStr}" style="padding:6px 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
      <input type="number" placeholder="Max" id="auditLimit" value="200" min="10" max="1000" style="padding:6px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;width:70px;">
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="auditLoad">↻ Laden</button>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="auditExport">⬇ CSV</button>
    </div>
  </div>
</div>
<div id="auditSummary" style="display:none;background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#0369a1;"></div>
<div class="adm-card">
  <div class="adm-card-body adm-table-wrap" id="auditTable">
    <div class="adm-loading">Laden…</div>
  </div>
</div>`;

    let _auditRows = [];

    async function loadAudit() {
      const actor = document.getElementById("auditActor").value.trim();
      const area  = document.getElementById("auditArea").value;
      const from  = document.getElementById("auditFrom").value;
      const to    = document.getElementById("auditTo").value;
      const limit = document.getElementById("auditLimit").value || 200;
      const tableEl = document.getElementById("auditTable");
      const summaryEl = document.getElementById("auditSummary");
      tableEl.innerHTML = '<div class="adm-loading">Laden…</div>';
      summaryEl.style.display = "none";
      try {
        let qs = `?limit=${limit}&tenantId=${tenantId()}`;
        if (actor) qs += `&actor=${encodeURIComponent(actor)}`;
        if (area)  qs += `&area=${encodeURIComponent(area)}`;
        if (from)  qs += `&from=${encodeURIComponent(from)}`;
        if (to)    qs += `&to=${encodeURIComponent(to + "T23:59:59")}`;
        const data = await api("GET", `/audit${qs}`);
        _auditRows = data.rows || [];
        // Summary bar
        if (_auditRows.length) {
          const actors = new Set(_auditRows.map(r => r.actor)).size;
          const areas  = new Set(_auditRows.filter(r=>r.area).map(r => r.area)).size;
          const fails  = _auditRows.filter(r => r.action?.includes("fail") || r.action?.includes("lock") || r.action?.includes("denied")).length;
          summaryEl.innerHTML = `📊 <strong>${_auditRows.length}</strong> events &nbsp;·&nbsp; <strong>${actors}</strong> actoren &nbsp;·&nbsp; <strong>${areas}</strong> gebieden${fails ? ` &nbsp;·&nbsp; <span style="color:#dc2626;font-weight:600;">⚠ ${fails} fouten/weigeringen</span>` : ""}`;
          summaryEl.style.display = "block";
        }
        renderAuditTable(_auditRows);
      } catch (err) {
        tableEl.innerHTML = `<div class="adm-empty" style="color:#ef4444;">Fout: ${err.message}</div>`;
      }
    }

    function renderAuditTable(rows) {
      if (!rows.length) {
        document.getElementById("auditTable").innerHTML = '<div class="adm-empty"><div class="adm-empty-icon">📋</div><div class="adm-empty-text">Geen audit-events gevonden</div></div>';
        return;
      }
      document.getElementById("auditTable").innerHTML = `
      <table class="adm-table">
        <thead><tr><th>Tijdstip</th><th>Actor</th><th>Actie</th><th>Gebied</th><th>Detail</th></tr></thead>
        <tbody>
          ${rows.map(r => `
          <tr>
            <td style="white-space:nowrap;font-size:12px;">${r.at ? new Date(r.at).toLocaleString("nl-BE",{dateStyle:"short",timeStyle:"short"}) : "—"}</td>
            <td style="font-size:12px;">${r.actor||"systeem"}</td>
            <td><span class="adm-status ${r.action?.includes("fail")||r.action?.includes("lock")||r.action?.includes("denied") ? "adm-status-inactive" : "adm-status-active"}">${r.action||"—"}</span></td>
            <td style="font-size:12px;">${r.area||"—"}</td>
            <td style="font-size:12px;color:#64748b;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.detail||""}">${r.detail||"—"}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    }

    document.getElementById("auditLoad").addEventListener("click", loadAudit);
    document.getElementById("auditExport").addEventListener("click", () => {
      const lines = ["Tijdstip;Actor;Actie;Gebied;Detail",
        ..._auditRows.map(r => [r.at||"",r.actor||"",r.action||"",r.area||"",r.detail||""].map(v=>`"${v}"`).join(";"))
      ];
      const blob = new Blob(["﻿"+lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "audit-export.csv"; a.click();
    });

    // Audit endpoint zit op /api/audit (niet tenant-scoped), speciale behandeling
    document.getElementById("auditLoad").click();
  }

  // ── Klanten ────────────────────────────────────────────────
  async function renderCustomers() {
    const content = document.getElementById("admContent");
    try {
      const data = await api("GET", "/customers");
      const rows = data.customers || data.rows || [];
      content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Klanten <span style="background:#e0e7ff;color:#4f46e5;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${rows.length}</span></h3>
    <input id="custSearch" placeholder="Zoek naam, e-mail…" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;min-width:200px;">
  </div>
  ${rows.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-icon">🏢</div><div class="adm-empty-text">Nog geen klanten — klik "+ Klant" om te starten</div></div>`
    : `<div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>Naam</th><th>Contactpersoon</th><th>E-mail</th><th>Telefoon</th><th>BTW-nr</th><th>Acties</th></tr></thead>
        <tbody id="custTbody">${buildCustRows(rows)}</tbody>
      </table></div>`}
</div>`;
      document.getElementById("custSearch")?.addEventListener("input", e => {
        const q = e.target.value.toLowerCase();
        const tb = document.getElementById("custTbody");
        if (tb) tb.innerHTML = buildCustRows(rows.filter(r => `${r.name} ${r.contactName||""} ${r.email||""} ${r.phone||""}`.toLowerCase().includes(q)));
        document.querySelectorAll(".cust-edit").forEach(b => b.addEventListener("click", () => openCustomerDrawer(rows.find(x => x.id === b.dataset.id))));
      });
      document.querySelectorAll(".cust-edit").forEach(b => b.addEventListener("click", () => openCustomerDrawer(rows.find(x => x.id === b.dataset.id))));
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:#dc2626">Fout: ${e.message}</div>`; }
  }
  function buildCustRows(rows) {
    return rows.map(c => `<tr>
      <td><strong>${esc(c.name)}</strong></td>
      <td>${esc(c.contactName||"—")}</td>
      <td><a href="mailto:${esc(c.email||"")}" style="color:#4f46e5">${esc(c.email||"—")}</a></td>
      <td>${esc(c.phone||"—")}</td>
      <td style="font-family:monospace;font-size:12px">${esc(c.vatNumber||"—")}</td>
      <td><button class="adm-btn adm-btn-secondary adm-btn-sm cust-edit" data-id="${c.id}">✏ Bewerk</button></td>
    </tr>`).join("");
  }
  function openCustomerDrawer(customer) {
    document.getElementById("admDrawerTitle").textContent = customer ? "Klant bewerken" : "Nieuwe klant";
    document.getElementById("admDrawerBody").innerHTML = `
<form id="custForm">
  <div class="adm-form-group"><label>Naam *</label><input name="name" value="${esc(customer?.name||"")}" required placeholder="Bedrijfsnaam BV"></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Contactpersoon</label><input name="contactName" value="${esc(customer?.contactName||"")}" placeholder="Jan Janssen"></div>
    <div class="adm-form-group"><label>BTW-nummer</label><input name="vatNumber" value="${esc(customer?.vatNumber||"")}" placeholder="BE0000.000.000"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>E-mail</label><input name="email" type="email" value="${esc(customer?.email||"")}"></div>
    <div class="adm-form-group"><label>Telefoon</label><input name="phone" value="${esc(customer?.phone||"")}"></div>
  </div>
  <div class="adm-form-group"><label>Adres</label><input name="address" value="${esc(customer?.address||"")}"></div>
  <div class="adm-form-group"><label>Notities</label><textarea name="notes" rows="3" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px">${esc(customer?.notes||"")}</textarea></div>
  <div id="custFormErr" style="display:none;background:#fef2f2;color:#dc2626;border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="custCancel">Annuleren</button>
    ${customer ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="custDelete">🗑 Verwijderen</button>` : ""}
    <button type="submit" class="adm-btn adm-btn-primary">${customer ? "Opslaan" : "Aanmaken"}</button>
  </div>
</form>`;
    openDrawer();
    document.getElementById("custCancel").addEventListener("click", closeDrawer);
    document.getElementById("custDelete")?.addEventListener("click", async () => {
      if (!confirm(`Klant "${customer.name}" verwijderen?`)) return;
      try {
        await api("DELETE", `/customers/${customer.id}`);
        closeDrawer(); renderCustomers();
      } catch(err) {
        const e = document.getElementById("custFormErr");
        if (e) { e.textContent = err.message; e.style.display = "block"; }
      }
    });
    document.getElementById("custForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = document.getElementById("custFormErr");
      const body = Object.fromEntries(new FormData(e.target).entries());
      try {
        if (customer) await api("PATCH", `/customers/${customer.id}`, body);
        else await api("POST", "/customers", body);
        closeDrawer(); renderCustomers();
      } catch(err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = "block"; }
        else alert(err.message);
      }
    });
  }

  // ── Locaties ────────────────────────────────────────────────
  async function renderVenues() {
    const content = document.getElementById("admContent");
    try {
      const data = await api("GET", "/venues");
      const rows = data.venues || data.rows || [];
      content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Locaties / Werven <span style="background:#e0e7ff;color:#4f46e5;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${rows.length}</span></h3>
    <input id="venSearch" placeholder="Zoek locatie…" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;min-width:180px;">
  </div>
  ${rows.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-icon">📍</div><div class="adm-empty-text">Nog geen locaties — klik "+ Locatie"</div></div>`
    : `<div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>Naam</th><th>Adres</th><th>Contactpersoon</th><th>Telefoon</th><th>Actief</th><th>Acties</th></tr></thead>
        <tbody id="venTbody">${buildVenRows(rows)}</tbody>
      </table></div>`}
</div>`;
      document.getElementById("venSearch")?.addEventListener("input", e => {
        const q = e.target.value.toLowerCase();
        const tb = document.getElementById("venTbody");
        if (tb) tb.innerHTML = buildVenRows(rows.filter(r => `${r.name} ${r.address||""}`.toLowerCase().includes(q)));
        document.querySelectorAll(".ven-edit").forEach(b => b.addEventListener("click", () => openVenueDrawer(rows.find(x => x.id === b.dataset.id))));
      });
      document.querySelectorAll(".ven-edit").forEach(b => b.addEventListener("click", () => openVenueDrawer(rows.find(x => x.id === b.dataset.id))));
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:#dc2626">Fout: ${e.message}</div>`; }
  }
  function buildVenRows(rows) {
    return rows.map(v => `<tr>
      <td><strong>${esc(v.name)}</strong></td>
      <td>${esc(v.address||"—")}</td>
      <td>${esc(v.contactName||"—")}</td>
      <td>${esc(v.phone||"—")}</td>
      <td>${v.active !== false ? '<span class="adm-status adm-status-active">Actief</span>' : '<span class="adm-status adm-status-inactive">Inactief</span>'}</td>
      <td><button class="adm-btn adm-btn-secondary adm-btn-sm ven-edit" data-id="${v.id}">✏ Bewerk</button></td>
    </tr>`).join("");
  }
  function openVenueDrawer(venue) {
    document.getElementById("admDrawerTitle").textContent = venue ? "Locatie bewerken" : "Nieuwe locatie";
    document.getElementById("admDrawerBody").innerHTML = `
<form id="venForm">
  <div class="adm-form-group"><label>Naam *</label><input name="name" value="${esc(venue?.name||"")}" required placeholder="Werf Brussel Noord"></div>
  <div class="adm-form-group"><label>Adres</label><input name="address" value="${esc(venue?.address||"")}" placeholder="Straat 1, 1000 Brussel"></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Contactpersoon</label><input name="contactName" value="${esc(venue?.contactName||"")}"></div>
    <div class="adm-form-group"><label>Telefoon</label><input name="phone" value="${esc(venue?.phone||"")}"></div>
  </div>
  <div class="adm-form-group"><label>Notities</label><textarea name="notes" rows="3" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px">${esc(venue?.notes||"")}</textarea></div>
  <div class="adm-form-group"><label><input type="checkbox" name="active" value="true" ${venue?.active !== false ? "checked" : ""}> Actieve locatie</label></div>
  <div id="venFormErr" style="display:none;background:#fef2f2;color:#dc2626;border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="venCancel">Annuleren</button>
    ${venue ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="venDelete">🗑 Verwijderen</button>` : ""}
    <button type="submit" class="adm-btn adm-btn-primary">${venue ? "Opslaan" : "Aanmaken"}</button>
  </div>
</form>`;
    openDrawer();
    document.getElementById("venCancel").addEventListener("click", closeDrawer);
    document.getElementById("venDelete")?.addEventListener("click", async () => {
      if (!confirm(`Locatie "${venue.name}" verwijderen?`)) return;
      try {
        await api("DELETE", `/venues/${venue.id}`);
        closeDrawer(); renderVenues();
      } catch(err) {
        const e = document.getElementById("venFormErr");
        if (e) { e.textContent = err.message; e.style.display = "block"; }
      }
    });
    document.getElementById("venForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = document.getElementById("venFormErr");
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      body.active = fd.has("active");
      try {
        if (venue) await api("PATCH", `/venues/${venue.id}`, body);
        else await api("POST", "/venues", body);
        closeDrawer(); renderVenues();
      } catch(err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = "block"; }
        else alert(err.message);
      }
    });
  }

  // ── Voertuigen ─────────────────────────────────────────────
  async function renderVehicles() {
    const content = document.getElementById("admContent");
    try {
      const data = await api("GET", "/vehicles");
      const vehicles = data.vehicles || [];
      const alerts = data.alerts || [];
      content.innerHTML = `
${alerts.length ? `<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:12px 16px;margin-bottom:14px;font-size:13px;color:#92400e">
  ⚠️ <strong>${alerts.length} alert${alerts.length>1?"s":""}</strong>: ${alerts.map(a=>esc(a.message||a.type)).join(", ")}
</div>` : ""}
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Voertuigen <span style="background:#e0e7ff;color:#4f46e5;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${vehicles.length}</span></h3>
  </div>
  ${vehicles.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-icon">🚗</div><div class="adm-empty-text">Geen voertuigen geregistreerd</div></div>`
    : `<div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>Naam / Kenteken</th><th>Merk / Model</th><th>Chauffeur</th><th>KM-stand</th><th>Status</th><th>Volgende service</th><th>Acties</th></tr></thead>
        <tbody>${vehicles.map(v => `<tr>
          <td><strong>${esc(v.name||v.plate||"—")}</strong><br><span style="font-size:11px;color:#94a3b8;font-family:monospace">${esc(v.plate||"")}</span></td>
          <td>${esc(v.brand||"")} ${esc(v.model||"")}</td>
          <td>${esc(v.driverName||v.driverId||"—")}</td>
          <td>${v.mileage ? Number(v.mileage).toLocaleString("nl-BE") + " km" : "—"}</td>
          <td><span class="adm-status adm-status-${v.status||"active"}">${esc(v.status||"actief")}</span></td>
          <td>${v.nextService ? new Date(v.nextService).toLocaleDateString("nl-BE") : "—"}</td>
          <td>
            <button class="adm-btn adm-btn-secondary adm-btn-sm veh-edit" data-id="${v.id}">✏</button>
            <button class="adm-btn adm-btn-secondary adm-btn-sm veh-km" data-id="${v.id}">KM log</button>
          </td>
        </tr>`).join("")}</tbody>
      </table></div>`}
</div>`;
      document.querySelectorAll(".veh-edit").forEach(b => b.addEventListener("click", () => openVehicleDrawer(vehicles.find(x => x.id === b.dataset.id))));
      document.querySelectorAll(".veh-km").forEach(b => b.addEventListener("click", () => openMileageDrawer(b.dataset.id)));
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:#dc2626">Fout: ${e.message}</div>`; }
  }
  function openVehicleDrawer(vehicle) {
    document.getElementById("admDrawerTitle").textContent = vehicle ? "Voertuig bewerken" : "Nieuw voertuig";
    document.getElementById("admDrawerBody").innerHTML = `
<form id="vehForm">
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Naam / Code *</label><input name="name" value="${esc(vehicle?.name||"")}" required placeholder="Bestelwagen 1"></div>
    <div class="adm-form-group"><label>Kenteken</label><input name="plate" value="${esc(vehicle?.plate||"")}" placeholder="1-ABC-234" style="text-transform:uppercase"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Merk</label><input name="brand" value="${esc(vehicle?.brand||"")}" placeholder="Ford"></div>
    <div class="adm-form-group"><label>Model</label><input name="model" value="${esc(vehicle?.model||"")}" placeholder="Transit"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Bouwjaar</label><input name="year" type="number" value="${esc(vehicle?.year||"")}" placeholder="2022"></div>
    <div class="adm-form-group"><label>Huidige KM-stand</label><input name="mileage" type="number" value="${esc(vehicle?.mileage||"")}" placeholder="50000"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Status</label>
      <select name="status">
        <option value="active" ${vehicle?.status==="active"?"selected":""}>Actief</option>
        <option value="maintenance" ${vehicle?.status==="maintenance"?"selected":""}>In onderhoud</option>
        <option value="inactive" ${vehicle?.status==="inactive"?"selected":""}>Inactief</option>
      </select>
    </div>
    <div class="adm-form-group"><label>Volgende service (datum)</label><input name="nextService" type="date" value="${esc(vehicle?.nextService||"")}"></div>
  </div>
  <div class="adm-form-actions" style="justify-content:space-between;">
    ${vehicle ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="vehDelete">🗑 Verwijderen</button>` : `<span></span>`}
    <div style="display:flex;gap:8px;">
      <button type="button" class="adm-btn adm-btn-secondary" id="vehCancel">Annuleren</button>
      <button type="submit" class="adm-btn adm-btn-primary">${vehicle ? "Opslaan" : "Aanmaken"}</button>
    </div>
  </div>
</form>`;
    openDrawer();
    document.getElementById("vehCancel").addEventListener("click", closeDrawer);
    if (vehicle) {
      document.getElementById("vehDelete").addEventListener("click", async () => {
        if (!confirm(`Voertuig "${vehicle.name||vehicle.plate}" permanent verwijderen?`)) return;
        try { await api("DELETE", `/vehicles/${vehicle.id}`); closeDrawer(); renderVehicles(); }
        catch(err) { alert(err.message); }
      });
    }
    document.getElementById("vehForm").addEventListener("submit", async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      if (body.year) body.year = Number(body.year);
      if (body.mileage) body.mileage = Number(body.mileage);
      try {
        if (vehicle) await api("PATCH", `/vehicles/${vehicle.id}`, body);
        else await api("POST", "/vehicles", body);
        closeDrawer(); renderVehicles();
      } catch(err) { alert(err.message); }
    });
  }
  function openMileageDrawer(vehicleId) {
    document.getElementById("admDrawerTitle").textContent = "KM-registratie";
    document.getElementById("admDrawerBody").innerHTML = `
<form id="kmForm">
  <div class="adm-form-group"><label>Datum *</label><input name="date" type="date" value="${new Date().toISOString().slice(0,10)}" required></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>KM bij vertrek</label><input name="startKm" type="number" placeholder="50000" required></div>
    <div class="adm-form-group"><label>KM bij aankomst</label><input name="endKm" type="number" placeholder="50250"></div>
  </div>
  <div class="adm-form-group"><label>Doel / Notitie</label><input name="note" placeholder="Werf Brussel — materiaal levering"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="kmCancel">Annuleren</button>
    <button type="submit" class="adm-btn adm-btn-primary">Opslaan</button>
  </div>
</form>`;
    openDrawer();
    document.getElementById("kmCancel").addEventListener("click", closeDrawer);
    document.getElementById("kmForm").addEventListener("submit", async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      if (body.startKm) body.startKm = Number(body.startKm);
      if (body.endKm) body.endKm = Number(body.endKm);
      try {
        await api("POST", `/vehicles/${vehicleId}/mileage`, body);
        closeDrawer(); renderVehicles();
      } catch(err) { alert(err.message); }
    });
  }

  // ── Stock ──────────────────────────────────────────────────
  async function renderStock() {
    const content = document.getElementById("admContent");
    try {
      const data = await api("GET", "/stock");
      const items = data.items || data.stock || [];
      const alerts = data.alerts || [];
      const totalValue = items.reduce((s, i) => s + (Number(i.quantity||0) * Number(i.unitPrice||0)), 0);
      content.innerHTML = `
<div class="adm-kpis" style="margin-bottom:16px">
  <div class="adm-kpi adm-kpi-blue"><div class="adm-kpi-label">Artikelen</div><div class="adm-kpi-value">${items.length}</div></div>
  <div class="adm-kpi adm-kpi-${alerts.length>0?"red":"green"}"><div class="adm-kpi-label">Lage voorraad alerts</div><div class="adm-kpi-value">${alerts.length}</div></div>
  <div class="adm-kpi adm-kpi-purple"><div class="adm-kpi-label">Totale stockwaarde</div><div class="adm-kpi-value" style="font-size:18px">${new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(totalValue)}</div></div>
</div>
${alerts.length ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px 16px;margin-bottom:14px;font-size:13px;color:#7f1d1d">
  ⚠️ Lage voorraad: ${alerts.map(a=>esc(a.name||a.itemId)).join(", ")}
</div>` : ""}
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Stockbeheer</h3>
    <input id="stSearch" placeholder="Zoek artikel…" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;min-width:160px;">
  </div>
  ${items.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-icon">📦</div><div class="adm-empty-text">Geen stockartikelen</div></div>`
    : `<div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>Artikel</th><th>SKU</th><th>Categorie</th><th>Hoeveelheid</th><th>Eenheid</th><th>Min. stock</th><th>Prijs/stuk</th><th>Acties</th></tr></thead>
        <tbody id="stTbody">${buildStockRows(items)}</tbody>
      </table></div>`}
</div>`;
      document.getElementById("stSearch")?.addEventListener("input", e => {
        const q = e.target.value.toLowerCase();
        const tb = document.getElementById("stTbody");
        if (tb) tb.innerHTML = buildStockRows(items.filter(i => `${i.name} ${i.sku||""} ${i.category||""}`.toLowerCase().includes(q)));
        wireStockBtns(items);
      });
      wireStockBtns(items);
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:#dc2626">Fout: ${e.message}</div>`; }
  }
  function buildStockRows(rows) {
    return rows.map(i => {
      const low = i.minQuantity && Number(i.quantity||0) <= Number(i.minQuantity||0);
      return `<tr style="${low?"background:#fef2f2":""}">
        <td><strong>${esc(i.name)}</strong>${low?` <span style="background:#fee2e2;color:#dc2626;border-radius:4px;padding:1px 5px;font-size:10px">LAAG</span>`:""}</td>
        <td style="font-family:monospace;font-size:12px">${esc(i.sku||"—")}</td>
        <td>${esc(i.category||"—")}</td>
        <td style="font-weight:700;color:${low?"#dc2626":"#0f172a"}">${esc(i.quantity??0)}</td>
        <td>${esc(i.unit||"st")}</td>
        <td>${esc(i.minQuantity||"—")}</td>
        <td>${i.unitPrice ? new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(i.unitPrice) : "—"}</td>
        <td>
          <button class="adm-btn adm-btn-secondary adm-btn-sm st-edit" data-id="${i.id}">✏</button>
          <button class="adm-btn adm-btn-secondary adm-btn-sm st-mut" data-id="${i.id}">± Mutatie</button>
        </td>
      </tr>`;
    }).join("");
  }
  function wireStockBtns(items) {
    document.querySelectorAll(".st-edit").forEach(b => b.addEventListener("click", () => openStockDrawer(items.find(x => x.id === b.dataset.id))));
    document.querySelectorAll(".st-mut").forEach(b => b.addEventListener("click", () => openMutationDrawer(b.dataset.id)));
  }
  function openStockDrawer(item) {
    document.getElementById("admDrawerTitle").textContent = item ? "Artikel bewerken" : "Nieuw artikel";
    document.getElementById("admDrawerBody").innerHTML = `
<form id="stForm">
  <div class="adm-form-group"><label>Naam *</label><input name="name" value="${esc(item?.name||"")}" required placeholder="Kabel 3x2.5mm²"></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>SKU / Code</label><input name="sku" value="${esc(item?.sku||"")}" placeholder="KAB-325"></div>
    <div class="adm-form-group"><label>Categorie</label><input name="category" value="${esc(item?.category||"")}" placeholder="Kabels"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Hoeveelheid</label><input name="quantity" type="number" step="0.01" value="${esc(item?.quantity??0)}"></div>
    <div class="adm-form-group"><label>Eenheid</label><input name="unit" value="${esc(item?.unit||"st")}" placeholder="st / m / kg"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Minimale voorraad</label><input name="minQuantity" type="number" value="${esc(item?.minQuantity||"")}"></div>
    <div class="adm-form-group"><label>Prijs per eenheid (€)</label><input name="unitPrice" type="number" step="0.01" value="${esc(item?.unitPrice||"")}"></div>
  </div>
  <div class="adm-form-actions" style="justify-content:space-between;">
    ${item ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="stDelete">🗑 Verwijderen</button>` : `<span></span>`}
    <div style="display:flex;gap:8px;">
      <button type="button" class="adm-btn adm-btn-secondary" id="stCancel">Annuleren</button>
      <button type="submit" class="adm-btn adm-btn-primary">${item ? "Opslaan" : "Aanmaken"}</button>
    </div>
  </div>
</form>`;
    openDrawer();
    document.getElementById("stCancel").addEventListener("click", closeDrawer);
    if (item) {
      document.getElementById("stDelete").addEventListener("click", async () => {
        if (!confirm(`Artikel "${item.name}" permanent verwijderen? Alle stockhistorie gaat verloren.`)) return;
        try { await api("DELETE", `/stock/${item.id}`); closeDrawer(); renderStock(); }
        catch(err) { alert(err.message); }
      });
    }
    document.getElementById("stForm").addEventListener("submit", async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      if (body.quantity !== undefined) body.quantity = Number(body.quantity);
      if (body.minQuantity) body.minQuantity = Number(body.minQuantity);
      if (body.unitPrice) body.unitPrice = Number(body.unitPrice);
      try {
        if (item) await api("PATCH", `/stock/${item.id}`, body);
        else await api("POST", "/stock", body);
        closeDrawer(); renderStock();
      } catch(err) { alert(err.message); }
    });
  }
  function openMutationDrawer(itemId) {
    document.getElementById("admDrawerTitle").textContent = "Stockmutatie";
    document.getElementById("admDrawerBody").innerHTML = `
<form id="mutForm">
  <p style="font-size:13px;color:#64748b;margin-bottom:12px">Pas de voorraad aan met een positieve (aanvulling) of negatieve (gebruik) waarde.</p>
  <div class="adm-form-group"><label>Hoeveelheid (+ aanvulling / − gebruik) *</label><input name="delta" type="number" step="0.01" required placeholder="bv. -5 of +20"></div>
  <div class="adm-form-group"><label>Reden</label><input name="reason" placeholder="Gebruikt op werf Brussel"></div>
  <div class="adm-form-group"><label>Datum</label><input name="date" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="mutCancel">Annuleren</button>
    <button type="submit" class="adm-btn adm-btn-primary">Verwerken</button>
  </div>
</form>`;
    openDrawer();
    document.getElementById("mutCancel").addEventListener("click", closeDrawer);
    document.getElementById("mutForm").addEventListener("submit", async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      body.delta = Number(body.delta);
      try {
        await api("POST", `/stock/${itemId}/mutations`, body);
        closeDrawer(); renderStock();
      } catch(err) { alert(err.message); }
    });
  }

  // ── Facturatie ─────────────────────────────────────────────
  async function renderBilling() {
    const content = document.getElementById("admContent");
    try {
      const sumData = await api("GET", "/billing/summary");
      const billing = sumData.billing || {};
      const invoices = (billing.invoiceHistory || []);
      const badge = document.getElementById("admInvoiceBadge");
      const openInvoices = invoices.filter(i => i.status === "open" || i.status === "overdue");
      if (badge) { badge.textContent = openInvoices.length; badge.style.display = openInvoices.length ? "" : "none"; }
      const fmtEur = n => new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(Number(n||0));
      const statusCss = { open:"adm-status-open", paid:"adm-status-goedgekeurd", overdue:"adm-status-inactive", draft:"adm-status-pending" };
      content.innerHTML = `
<div class="adm-kpis" style="margin-bottom:16px">
  <div class="adm-kpi adm-kpi-green"><div class="adm-kpi-label">Plan</div><div class="adm-kpi-value" style="font-size:18px;text-transform:capitalize">${esc(billing.plan||"—")}</div><div class="adm-kpi-sub">${esc(billing.status||"")}</div></div>
  <div class="adm-kpi adm-kpi-blue"><div class="adm-kpi-label">Maandprijs</div><div class="adm-kpi-value" style="font-size:20px">${fmtEur(billing.monthlyAmount||0)}</div><div class="adm-kpi-sub">excl. BTW</div></div>
  <div class="adm-kpi adm-kpi-purple"><div class="adm-kpi-label">Facturen totaal</div><div class="adm-kpi-value">${invoices.length}</div><div class="adm-kpi-sub">${openInvoices.length} openstaand</div></div>
  <div class="adm-kpi ${billing.paymentMethod?"adm-kpi-green":"adm-kpi-amber"}"><div class="adm-kpi-label">Betaalmethode</div><div class="adm-kpi-value" style="font-size:16px">${billing.paymentMethod?esc(billing.paymentMethod):"Niet ingesteld"}</div></div>
</div>

${billing.status === "trial" ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
  <span style="font-size:20px">⏳</span>
  <div>
    <div style="font-size:14px;font-weight:600;color:#92400e">Gratis proefperiode actief</div>
    <div style="font-size:12px;color:#a16207;margin-top:2px">Voeg een betaalmethode toe voor naadloze overgang naar een betalend abonnement.</div>
  </div>
</div>` : ""}

<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Factuurgeschiedenis</h3>
  </div>
  ${invoices.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-icon">🧾</div><div class="adm-empty-text">Geen facturen gevonden</div></div>`
    : `<div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>Factuur #</th><th>Datum</th><th>Vervaldatum</th><th>Omschrijving</th><th>Bedrag</th><th>Status</th></tr></thead>
        <tbody>${invoices.map(i => `<tr>
          <td style="font-family:monospace;font-weight:600">${esc(i.number||i.id.slice(-6))}</td>
          <td>${i.date ? new Date(i.date).toLocaleDateString("nl-BE") : "—"}</td>
          <td>${i.dueDate ? new Date(i.dueDate).toLocaleDateString("nl-BE") : "—"}</td>
          <td>${esc(i.description||i.title||"Abonnement WorkFlow Pro")}</td>
          <td style="font-weight:600">${fmtEur(i.amount)}</td>
          <td><span class="adm-status ${statusCss[i.status]||"adm-status-pending"}">${esc(i.status||"—")}</span></td>
        </tr>`).join("")}</tbody>
      </table></div>`}
</div>`;
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:#dc2626">Fout: ${e.message}</div>`; }
  }

  // ── Settings ───────────────────────────────────────────────
  async function renderSettings() {
    const content = document.getElementById("admContent");
    content.innerHTML = `<div class="adm-loading">Laden…</div>`;
    let tenant = {};
    try {
      const res = await api("GET", "/settings");
      tenant = res.tenant || {};
    } catch (_) {}

    content.innerHTML = `
<div class="adm-grid-2">
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">Bedrijfsgegevens</h3></div>
    <div class="adm-card-body">
      <form id="admOrgForm">
        <div class="adm-form-group"><label>Bedrijfsnaam</label>
          <input name="name" value="${esc(tenant.name || "")}" placeholder="Naam organisatie">
        </div>
        <div class="adm-form-group"><label>BTW-nummer</label>
          <input name="vatNumber" value="${esc(tenant.vatNumber || "")}" placeholder="BE0000.000.000">
        </div>
        <div class="adm-form-group"><label>Adres</label>
          <input name="address" value="${esc(tenant.address || "")}" placeholder="Straat + nr, gemeente">
        </div>
        <div class="adm-form-row">
          <div class="adm-form-group"><label>Contact e-mail</label>
            <input name="contactEmail" type="email" value="${esc(tenant.contactEmail || "")}" placeholder="info@bedrijf.be">
          </div>
          <div class="adm-form-group"><label>Telefoon</label>
            <input name="phone" value="${esc(tenant.phone || "")}" placeholder="+32 ...">
          </div>
        </div>
        <div id="admOrgMsg" style="display:none;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;"></div>
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">Opslaan</button></div>
      </form>
    </div>
  </div>
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">Abonnement &amp; plan</h3></div>
    <div class="adm-card-body">
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:#64748b;">Huidig plan</span>
          <strong style="text-transform:capitalize;">${esc(tenant.plan || "—")}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:#64748b;">Status</span>
          <span class="adm-status adm-status-${tenant.status === "active" ? "active" : tenant.status === "trial" ? "pending" : "inactive"}">${esc(tenant.status || "—")}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:#64748b;">Facturatie e-mail</span>
          <span>${esc(tenant.billingEmail || "—")}</span>
        </div>
        <hr style="border:none;border-top:1px solid #f1f5f9;margin:4px 0;">
        <button class="adm-btn adm-btn-secondary" onclick="window.location='#billing'" style="width:100%;">Factuurgeschiedenis bekijken</button>
      </div>
    </div>
  </div>
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">Beveiliging</h3></div>
    <div class="adm-card-body">
      <p style="font-size:13px;color:#64748b;margin-bottom:12px;">MFA (Two-Factor Authenticatie) voegt een extra beveiligingslaag toe aan uw account.</p>
      <button class="adm-btn adm-btn-primary" id="admMfaSetup">MFA instellen / beheren</button>
    </div>
  </div>
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">Wachtwoord wijzigen</h3></div>
    <div class="adm-card-body">
      <form id="admPwForm">
        <div class="adm-form-group"><label>Huidig wachtwoord</label>
          <input name="currentPassword" type="password" required autocomplete="current-password">
        </div>
        <div class="adm-form-group"><label>Nieuw wachtwoord</label>
          <input name="newPassword" type="password" required autocomplete="new-password" minlength="8">
        </div>
        <div id="admPwMsg" style="display:none;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;"></div>
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">Wijzigen</button></div>
      </form>
    </div>
  </div>
</div>`;

    // Save company settings
    document.getElementById("admOrgForm").addEventListener("submit", async e => {
      e.preventDefault();
      const msgEl = document.getElementById("admOrgMsg");
      const body = Object.fromEntries(new FormData(e.target).entries());
      try {
        await api("PATCH", "/settings", body);
        msgEl.style.cssText = "display:block;background:#d1fae5;color:#065f46;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;";
        msgEl.textContent = "Instellingen opgeslagen ✓";
        setTimeout(() => { msgEl.style.display = "none"; }, 3000);
      } catch (err) {
        msgEl.style.cssText = "display:block;background:#fee2e2;color:#dc2626;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;";
        msgEl.textContent = err.message;
      }
    });

    // Change password
    document.getElementById("admPwForm").addEventListener("submit", async e => {
      e.preventDefault();
      const msgEl = document.getElementById("admPwMsg");
      const { currentPassword, newPassword } = Object.fromEntries(new FormData(e.target).entries());
      try {
        await api("POST", "/auth/change-password", { currentPassword, newPassword });
        msgEl.style.cssText = "display:block;background:#d1fae5;color:#065f46;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;";
        msgEl.textContent = "Wachtwoord gewijzigd ✓";
        e.target.reset();
        setTimeout(() => { msgEl.style.display = "none"; }, 3000);
      } catch (err) {
        msgEl.style.cssText = "display:block;background:#fee2e2;color:#dc2626;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;";
        msgEl.textContent = err.message;
      }
    });

    document.getElementById("admMfaSetup")?.addEventListener("click", () => {
      window.showToast && window.showToast("MFA configuratie — beschikbaar in volgende versie", "info");
    });
  }

  // ── Helpers ────────────────────────────────────────────────
  function openDrawer() {
    document.getElementById("admDrawer").classList.remove("hidden");
    document.getElementById("admOverlay").classList.remove("hidden");
  }

  function closeDrawer() {
    document.getElementById("admDrawer").classList.add("hidden");
    document.getElementById("admOverlay").classList.add("hidden");
  }

  function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d;
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString("nl-BE", { weekday: "short", day: "numeric", month: "short" });
  }

  // ── Init ───────────────────────────────────────────────────
  function init() {
    buildShell();

    // Sync user name from token
    try {
      const p = JSON.parse(atob(token().split(".")[0]));
      const user = window._wfpCurrentUser || {};
      const name = user.name || user.email || "Admin";
      const el = document.getElementById("admUserName");
      if (el) el.textContent = name;
      const av = document.getElementById("admUserAvatar");
      if (av) av.textContent = name[0].toUpperCase();
    } catch (_) {}

    // ── Notification bell ────────────────────────────────────
    const bellBtn   = document.getElementById("admBellBtn");
    const bellDot   = document.getElementById("admBellDot");
    const notifPanel = document.getElementById("admNotifPanel");
    const notifList  = document.getElementById("admNotifList");
    let _notifCache  = [];

    function fmtNotifTime(iso) {
      if (!iso) return "";
      const d = new Date(iso), now = new Date();
      const diff = Math.floor((now - d) / 60000);
      if (diff < 1) return "Zonet";
      if (diff < 60) return `${diff}m geleden`;
      if (diff < 1440) return `${Math.floor(diff/60)}u geleden`;
      return d.toLocaleDateString("nl-BE");
    }

    function renderNotifList() {
      if (!_notifCache.length) {
        notifList.innerHTML = `<div class="adm-notif-empty">🔔 Geen notificaties</div>`;
        return;
      }
      notifList.innerHTML = _notifCache.slice(0, 20).map(n => `
      <div class="adm-notif-item ${n.read ? "" : "unread"}" data-nid="${esc(n.id)}">
        <div class="adm-notif-dot ${n.read ? "read" : ""}"></div>
        <div class="adm-notif-body">
          <div>${esc(n.title || n.message || "Notificatie")}</div>
          ${n.body ? `<div style="color:#64748b;margin-top:2px;font-size:11.5px">${esc(n.body)}</div>` : ""}
          <div class="adm-notif-time">${fmtNotifTime(n.createdAt)}</div>
        </div>
      </div>`).join("");

      notifList.querySelectorAll(".adm-notif-item").forEach(item => {
        item.addEventListener("click", async () => {
          const nid = item.dataset.nid;
          if (!item.classList.contains("unread")) return;
          item.classList.remove("unread"); item.querySelector(".adm-notif-dot").classList.add("read");
          try { await api("POST", `/notifications/${nid}/read`, {}); } catch(_){}
          const n = _notifCache.find(x => x.id === nid);
          if (n) n.read = true;
          updateBellDot();
        });
      });
    }

    function updateBellDot() {
      const unread = _notifCache.filter(n => !n.read).length;
      if (bellDot) bellDot.style.display = unread > 0 ? "" : "none";
    }

    async function loadNotifications() {
      try {
        const d = await api("GET", "/notifications");
        _notifCache = d.rows || [];
        updateBellDot();
        if (notifPanel.classList.contains("open")) renderNotifList();
      } catch(_){}
    }

    bellBtn?.addEventListener("click", async e => {
      e.stopPropagation();
      const isOpen = notifPanel.classList.toggle("open");
      if (isOpen) {
        notifList.innerHTML = `<div class="adm-notif-empty">Laden…</div>`;
        await loadNotifications();
        renderNotifList();
      }
    });

    document.addEventListener("click", e => {
      if (!document.getElementById("admBellBtn")?.contains(e.target) && !notifPanel?.contains(e.target)) {
        notifPanel?.classList.remove("open");
      }
    });

    document.getElementById("admNotifMarkAll")?.addEventListener("click", async () => {
      const unread = _notifCache.filter(n => !n.read);
      await Promise.all(unread.map(n => api("POST", `/notifications/${n.id}/read`, {}).catch(() => {})));
      _notifCache.forEach(n => n.read = true);
      updateBellDot();
      renderNotifList();
    });

    // Load on startup to show dot if unread notifications exist
    loadNotifications();

    switchView("dashboard");
  }

  window.wfp_adminInit = init;
}());
