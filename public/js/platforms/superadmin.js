/* ============================================================
   WorkFlow Pro – Super Admin Platform  (volledig)
   Views: Dashboard · Tenants · Gebruikers · Facturatie ·
          Systeem · Audit · Instellingen
   ============================================================ */
(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────
  let _view  = "dashboard";
  let _cache = { tenants: [], users: [] };

  // ── Helpers ────────────────────────────────────────────────
  const token  = () => localStorage.getItem("wfp_token") || "";
  const esc    = v => String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const fmtD   = iso => iso ? new Date(iso).toLocaleDateString("nl-BE") : "—";
  const fmtDT  = iso => iso ? new Date(iso).toLocaleString("nl-BE",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "—";
  const fmtEur = n  => new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(Number(n||0));

  async function api(path, opts = {}) {
    const r = await fetch(path, {
      ...opts,
      headers: { "Content-Type":"application/json", Authorization:`Bearer ${token()}`, ...(opts.headers||{}) }
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  }

  const planColor  = { starter:"badge-blue", business:"badge-green", enterprise:"badge-purple" };
  const statusColor= { active:"badge-green", trial:"badge-yellow", suspended:"badge-red", churned:"badge-gray" };
  const roleColor  = { super_admin:"badge-purple", tenant_admin:"badge-blue", manager:"badge-teal", employee:"badge-gray" };
  const badge = (text, color) => `<span class="sa-badge ${color||"badge-gray"}">${esc(text)}</span>`;

  // ── CSS ────────────────────────────────────────────────────
  const CSS = `
<style>
#platform-superadmin{font-family:'Inter',system-ui,-apple-system,sans-serif;height:100vh;overflow:hidden}
#platform-superadmin *{box-sizing:border-box;margin:0;padding:0}

/* Layout */
.sa-layout{display:flex;height:100vh;background:#f1f5f9}
.sa-sidebar{width:248px;min-width:248px;background:#0f172a;display:flex;flex-direction:column;overflow-y:auto;flex-shrink:0;transition:transform .2s}
.sa-main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
.sa-topbar{height:56px;background:#fff;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;padding:0 20px;gap:12px;flex-shrink:0}
.sa-topbar-title{font-size:15px;font-weight:600;color:#0f172a;flex:1}
.sa-topbar-actions{display:flex;gap:8px}
.sa-content{flex:1;overflow-y:auto;padding:22px 24px}

/* Sidebar brand */
.sa-brand{display:flex;align-items:center;gap:12px;padding:18px 16px 16px;border-bottom:1px solid rgba(255,255,255,.06)}
.sa-brand-mark{width:38px;height:38px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:10px;display:grid;place-items:center;font-weight:800;font-size:13px;color:#fff;flex-shrink:0;box-shadow:0 2px 8px rgba(99,102,241,.4)}
.sa-brand-name{font-size:14px;font-weight:700;color:#f1f5f9;line-height:1.2}
.sa-brand-sub{font-size:11px;color:#6366f1;font-weight:600;letter-spacing:.5px;text-transform:uppercase}

/* Nav */
.sa-nav{padding:10px 8px;flex:1}
.sa-nav-section{font-size:10px;font-weight:700;color:#334155;letter-spacing:.8px;padding:12px 12px 4px;text-transform:uppercase}
.sa-nav-item{display:flex;align-items:center;gap:10px;width:100%;padding:8.5px 12px;border:none;background:none;border-radius:8px;color:#64748b;font-size:13px;font-weight:500;cursor:pointer;text-align:left;transition:all .12s;position:relative;white-space:nowrap}
.sa-nav-item svg{width:17px;height:17px;flex-shrink:0;fill:currentColor;opacity:.8}
.sa-nav-item:hover{background:rgba(255,255,255,.06);color:#cbd5e1}
.sa-nav-item.active{background:linear-gradient(90deg,rgba(99,102,241,.25),rgba(99,102,241,.1));color:#a5b4fc;font-weight:600}
.sa-nav-item.active svg{opacity:1;color:#818cf8}
.sa-nav-item .nav-badge{margin-left:auto;background:#ef4444;color:#fff;border-radius:99px;font-size:10px;padding:1px 5px;font-weight:700;min-width:18px;text-align:center}
.sa-nav-divider{height:1px;background:rgba(255,255,255,.06);margin:6px 10px}

/* Sidebar footer */
.sa-sidebar-footer{padding:12px;border-top:1px solid rgba(255,255,255,.06)}
.sa-user-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.sa-user-av{width:32px;height:32px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;color:#fff;flex-shrink:0}
.sa-user-nm{font-size:12px;font-weight:600;color:#e2e8f0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sa-user-rl{font-size:10px;color:#6366f1;font-weight:600;text-transform:uppercase}
.sa-btn-logout{width:100%;padding:7px;border:1px solid rgba(255,255,255,.08);background:transparent;color:#64748b;border-radius:8px;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .12s}
.sa-btn-logout:hover{background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.3);color:#f87171}
.sa-btn-logout svg{width:14px;height:14px;fill:currentColor}

/* Page header */
.sa-page-head{display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap}
.sa-page-head h1{font-size:19px;font-weight:700;color:#0f172a}
.sa-page-head .cnt{background:#e0e7ff;color:#4f46e5;border-radius:99px;font-size:12px;padding:2px 9px;font-weight:700;vertical-align:middle;margin-left:6px}
.sa-spacer{flex:1}

/* KPI cards */
.sa-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:13px;margin-bottom:22px}
.sa-kpi{background:#fff;border-radius:12px;padding:17px 18px;border:1px solid #e2e8f0;position:relative;overflow:hidden;cursor:default}
.sa-kpi::after{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:var(--kpi-color,#4f46e5);border-radius:3px 3px 0 0}
.sa-kpi-label{font-size:11.5px;color:#64748b;font-weight:500;margin-bottom:5px}
.sa-kpi-value{font-size:27px;font-weight:800;color:#0f172a;line-height:1.1}
.sa-kpi-sub{font-size:11px;color:#94a3b8;margin-top:3px}
.kpi-indigo{--kpi-color:#6366f1}
.kpi-blue{--kpi-color:#3b82f6}
.kpi-green{--kpi-color:#10b981}
.kpi-purple{--kpi-color:#8b5cf6}
.kpi-orange{--kpi-color:#f59e0b}
.kpi-red{--kpi-color:#ef4444}
.kpi-teal{--kpi-color:#14b8a6}

/* Cards */
.sa-card{background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:16px}
.sa-card-head{padding:13px 18px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:8px}
.sa-card-title{font-size:13.5px;font-weight:600;color:#0f172a;flex:1}
.sa-card-sub{font-size:11px;color:#94a3b8}

/* Grid */
.sa-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.sa-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px}

/* Tables */
.sa-tbl-wrap{overflow-x:auto}
.sa-tbl{width:100%;border-collapse:collapse;font-size:13px}
.sa-tbl th{padding:9px 14px;text-align:left;font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc;border-bottom:1px solid #e2e8f0;white-space:nowrap}
.sa-tbl td{padding:11px 14px;border-bottom:1px solid #f8fafc;color:#334155;vertical-align:middle}
.sa-tbl tr:last-child td{border-bottom:none}
.sa-tbl tr:hover td{background:#fafafa}
.sa-tbl .main{font-weight:600;color:#0f172a}
.sa-tbl .sub{font-size:11px;color:#94a3b8;margin-top:2px}
.sa-tbl .mono{font-family:monospace;font-size:11px}

/* Badges */
.sa-badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;white-space:nowrap}
.badge-green{background:#dcfce7;color:#15803d}
.badge-blue{background:#dbeafe;color:#1d4ed8}
.badge-purple{background:#ede9fe;color:#6d28d9}
.badge-teal{background:#ccfbf1;color:#0f766e}
.badge-yellow{background:#fef9c3;color:#a16207}
.badge-orange{background:#ffedd5;color:#c2410c}
.badge-red{background:#fee2e2;color:#b91c1c}
.badge-gray{background:#f1f5f9;color:#475569}
.badge-dark{background:#1e293b;color:#e2e8f0}

/* Buttons */
.sa-btn{padding:7px 14px;border-radius:8px;font-size:12.5px;font-weight:600;cursor:pointer;border:1.5px solid transparent;display:inline-flex;align-items:center;gap:5px;transition:all .12s;white-space:nowrap}
.sa-btn svg{width:14px;height:14px;fill:currentColor}
.btn-primary{background:#4f46e5;color:#fff;border-color:#4f46e5}
.btn-primary:hover{background:#4338ca}
.btn-secondary{background:#fff;color:#374151;border-color:#e2e8f0}
.btn-secondary:hover{background:#f8fafc;border-color:#cbd5e1}
.btn-danger{background:#fff;color:#dc2626;border-color:#fecaca}
.btn-danger:hover{background:#fef2f2}
.btn-success{background:#fff;color:#16a34a;border-color:#bbf7d0}
.btn-success:hover{background:#f0fdf4}
.btn-ghost{background:transparent;color:#64748b;border-color:transparent}
.btn-ghost:hover{background:#f1f5f9;color:#374151}
.sa-btn.sm{padding:4px 9px;font-size:11.5px;border-radius:6px}
.sa-actions{display:flex;gap:5px;flex-wrap:wrap}

/* Filters */
.sa-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center}
.sa-filters input,.sa-filters select{padding:6.5px 11px;border:1px solid #e2e8f0;border-radius:8px;font-size:12.5px;color:#374151;background:#fff}
.sa-filters input:focus,.sa-filters select:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.1)}

/* Empty / loader / error */
.sa-empty{padding:36px;text-align:center;color:#94a3b8;font-size:13px}
.sa-empty-icon{font-size:30px;margin-bottom:8px}
.sa-loader{padding:36px;text-align:center;color:#94a3b8;font-size:13px}
.sa-error{margin:16px 0;padding:14px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;color:#dc2626;font-size:13px}

/* Drawer / modal */
.sa-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:300;display:flex;align-items:stretch;justify-content:flex-end}
.sa-drawer{width:480px;max-width:100%;background:#fff;overflow-y:auto;padding:0;box-shadow:-4px 0 32px rgba(0,0,0,.15);display:flex;flex-direction:column}
.sa-drawer-hd{padding:20px 24px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:10px}
.sa-drawer-hd h2{font-size:16px;font-weight:700;color:#0f172a;flex:1}
.sa-drawer-close{background:none;border:none;cursor:pointer;color:#94a3b8;padding:4px;border-radius:6px;font-size:18px}
.sa-drawer-close:hover{color:#374151;background:#f1f5f9}
.sa-drawer-body{padding:20px 24px;flex:1;display:flex;flex-direction:column;gap:16px}
.sa-drawer-ft{padding:14px 24px;border-top:1px solid #f1f5f9;display:flex;gap:8px}

/* Form fields */
.sa-field{display:flex;flex-direction:column;gap:5px}
.sa-field label{font-size:11.5px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.4px}
.sa-field input,.sa-field select,.sa-field textarea{padding:8px 11px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;color:#0f172a;background:#fff;width:100%}
.sa-field input:focus,.sa-field select:focus,.sa-field textarea:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.1)}
.sa-field .hint{font-size:11px;color:#94a3b8}
.sa-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}

/* Detail rows */
.sa-detail{background:#f8fafc;border-radius:9px;padding:13px 15px;display:flex;flex-direction:column;gap:9px}
.sa-detail-row{display:flex;justify-content:space-between;align-items:center;font-size:12.5px}
.sa-detail-label{color:#64748b}
.sa-detail-value{font-weight:600;color:#0f172a;text-align:right;max-width:60%}

/* Stat cards in drawer */
.sa-stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.sa-stat-card{background:#f8fafc;border-radius:8px;padding:10px;text-align:center}
.sa-stat-card .sv{font-size:20px;font-weight:800;color:#0f172a}
.sa-stat-card .sl{font-size:11px;color:#64748b;margin-top:2px}

/* Divider */
.sa-divider{height:1px;background:#f1f5f9}

/* Inline alert */
.sa-alert{padding:10px 14px;border-radius:8px;font-size:12.5px;display:flex;align-items:flex-start;gap:8px}
.alert-info{background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe}
.alert-warn{background:#fffbeb;color:#92400e;border:1px solid #fde68a}
.alert-success{background:#f0fdf4;color:#14532d;border:1px solid #bbf7d0}
.alert-error{background:#fef2f2;color:#7f1d1d;border:1px solid #fecaca}

/* Mobile */
.sa-menu-toggle{display:none;background:none;border:none;cursor:pointer;padding:4px;color:#64748b}
.sa-menu-toggle svg{width:20px;height:20px;fill:currentColor}
@media(max-width:820px){
  .sa-menu-toggle{display:flex}
  .sa-sidebar{position:fixed;left:0;top:0;height:100%;z-index:200;transform:translateX(-100%)}
  .sa-sidebar.open{transform:translateX(0)}
  .sa-grid2,.sa-grid3{grid-template-columns:1fr}
  .sa-form-grid{grid-template-columns:1fr}
}
</style>`;

  // ── Shell HTML ──────────────────────────────────────────────
  function buildShell() {
    const el = document.getElementById("platform-superadmin");
    if (!el) return;
    el.innerHTML = CSS + `
<div class="sa-layout">
  <aside class="sa-sidebar" id="saSidebar">
    <div class="sa-brand">
      <div class="sa-brand-mark">SA</div>
      <div>
        <div class="sa-brand-name">WorkFlow Pro</div>
        <div class="sa-brand-sub">Super Admin</div>
      </div>
    </div>

    <nav class="sa-nav">
      <div class="sa-nav-section">Beheer</div>
      <button class="sa-nav-item active" data-view="dashboard">
        <svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>Dashboard
      </button>
      <button class="sa-nav-item" data-view="tenants">
        <svg viewBox="0 0 24 24"><path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/></svg>Tenants
        <span class="nav-badge" id="navBadgeTenants" style="display:none">0</span>
      </button>
      <button class="sa-nav-item" data-view="users">
        <svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>Gebruikers
      </button>

      <div class="sa-nav-divider"></div>
      <div class="sa-nav-section">Financieel</div>
      <button class="sa-nav-item" data-view="billing">
        <svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>Facturatie / MRR
      </button>

      <div class="sa-nav-divider"></div>
      <div class="sa-nav-section">Systeem</div>
      <button class="sa-nav-item" data-view="integrations">
        <svg viewBox="0 0 24 24"><path d="M22 7h-7V2H9v5H2v15h20V7zM11 4h2v3h-2V4zm9 16H4V9h16v11zM9 13h2v2H9v-2zm4 0h2v2h-2v-2z"/></svg>Integraties
      </button>
      <button class="sa-nav-item" data-view="system">
        <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>Systeem
        <span class="nav-badge" id="navBadgeErrors" style="display:none">0</span>
      </button>
      <button class="sa-nav-item" data-view="support">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg>Support
        <span class="nav-badge" id="navBadgeSupport" style="display:none">0</span>
      </button>
      <button class="sa-nav-item" data-view="audit">
        <svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm2-8h8v2H8zm0 4h5v2H8z"/></svg>Audit Log
      </button>
      <button class="sa-nav-item" data-view="settings">
        <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>Instellingen
      </button>
    </nav>

    <div class="sa-sidebar-footer">
      <div class="sa-user-row">
        <div class="sa-user-av" id="saUserAv">S</div>
        <div style="flex:1;min-width:0">
          <div class="sa-user-nm" id="saUserNm">Super Admin</div>
          <div class="sa-user-rl">Super Admin</div>
        </div>
      </div>
      <button class="sa-btn-logout" id="saLogout">
        <svg viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
        Uitloggen
      </button>
    </div>
  </aside>

  <main class="sa-main">
    <header class="sa-topbar">
      <button class="sa-menu-toggle" id="saMenuToggle">
        <svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
      </button>
      <div class="sa-topbar-title" id="saTopTitle">Dashboard</div>
      <div class="sa-topbar-actions" id="saTopActions"></div>
    </header>
    <div class="sa-content" id="saContent"><div class="sa-loader">Laden…</div></div>
  </main>
</div>`;

    // Nav
    el.querySelectorAll(".sa-nav-item[data-view]").forEach(btn => {
      btn.addEventListener("click", () => {
        el.querySelectorAll(".sa-nav-item").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        _view = btn.dataset.view;
        document.getElementById("saTopTitle").textContent = {
          dashboard:"Dashboard", tenants:"Tenants", users:"Gebruikers",
          billing:"Facturatie / MRR", integrations:"Integraties", system:"Systeem", support:"Support",
          audit:"Audit Log", settings:"Instellingen"
        }[_view] || _view;
        document.getElementById("saTopActions").innerHTML = "";
        document.getElementById("saSidebar").classList.remove("open");
        renderView();
      });
    });

    document.getElementById("saMenuToggle")?.addEventListener("click", () => {
      document.getElementById("saSidebar").classList.toggle("open");
    });

    document.getElementById("saLogout")?.addEventListener("click", () => {
      localStorage.removeItem("wfp_token");
      window.WorkFlowProPlatformRouter?.showLogin();
    });

    renderView();
  }

  // ── Router ─────────────────────────────────────────────────
  const VIEWS = { dashboard, tenants, users, billing, integrations, system, support, audit, settings };
  function renderView() { (VIEWS[_view] || dashboard)(); }

  // ══════════════════════════════════════════════════════════
  // VIEW: Dashboard
  // ══════════════════════════════════════════════════════════
  async function dashboard() {
    const c = content(); c.innerHTML = loader();
    try {
      const [st, sup] = await Promise.all([
        api("/api/admin/stats"),
        api("/api/admin/support?limit=5").catch(()=>({tickets:[]}))
      ]);
      const openTickets = (sup.tickets||[]).filter(t=>t.status!=="closed");
      badge_update("navBadgeTenants", st.tenants?.total);
      badge_update("navBadgeErrors",  st.errors24h);
      badge_update("navBadgeSupport", openTickets.length);

      c.innerHTML = `
<div class="sa-kpis">
  <div class="sa-kpi kpi-indigo">
    <div class="sa-kpi-label">Tenants totaal</div>
    <div class="sa-kpi-value">${st.tenants?.total||0}</div>
    <div class="sa-kpi-sub">${st.tenants?.active||0} actief · ${st.tenants?.trial||0} trial</div>
  </div>
  <div class="sa-kpi kpi-green">
    <div class="sa-kpi-label">MRR (schatting)</div>
    <div class="sa-kpi-value">${fmtEur(st.mrr)}</div>
    <div class="sa-kpi-sub">ARR ${fmtEur(st.arr)}</div>
  </div>
  <div class="sa-kpi kpi-blue">
    <div class="sa-kpi-label">Gebruikers totaal</div>
    <div class="sa-kpi-value">${st.users?.total||0}</div>
    <div class="sa-kpi-sub">${st.users?.active||0} actief</div>
  </div>
  <div class="sa-kpi kpi-orange">
    <div class="sa-kpi-label">Support open</div>
    <div class="sa-kpi-value">${openTickets.length}</div>
    <div class="sa-kpi-sub">tickets</div>
  </div>
  <div class="sa-kpi ${(st.errors24h||0)>0?"kpi-red":"kpi-teal"}">
    <div class="sa-kpi-label">Errors (24h)</div>
    <div class="sa-kpi-value">${st.errors24h||0}</div>
    <div class="sa-kpi-sub">${(st.errors24h||0)===0?"Systeem gezond":"Controleer Systeem"}</div>
  </div>
  <div class="sa-kpi kpi-purple">
    <div class="sa-kpi-label">Server uptime</div>
    <div class="sa-kpi-value">${fmtUptime(st.uptime||0)}</div>
    <div class="sa-kpi-sub">${st.releaseChannel||"dev"} · ${(st.commitSha||"local").slice(0,7)}</div>
  </div>
</div>

<div class="sa-grid2">
  <div class="sa-card">
    <div class="sa-card-head">
      <div class="sa-card-title">Recente tenants</div>
      <button class="sa-btn btn-ghost sm" onclick="document.querySelector('[data-view=tenants]').click()">Alle →</button>
    </div>
    <div id="dashTenantList"><div class="sa-loader">…</div></div>
  </div>
  <div class="sa-card">
    <div class="sa-card-head">
      <div class="sa-card-title">Open support tickets</div>
      <button class="sa-btn btn-ghost sm" onclick="document.querySelector('[data-view=support]').click()">Alle →</button>
    </div>
    ${openTickets.length ? openTickets.slice(0,5).map(t=>`
    <div style="padding:10px 16px;border-bottom:1px solid #f8fafc;display:flex;align-items:center;gap:10px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.subject||t.title||"Ticket")}</div>
        <div style="font-size:11px;color:#94a3b8">${esc(t.tenantName||t.tenantId||"—")} · ${fmtD(t.createdAt)}</div>
      </div>
      ${badge(t.priority||"normaal", t.priority==="hoog"?"badge-red":"badge-gray")}
    </div>`).join("") : `<div class="sa-empty"><div class="sa-empty-icon">✅</div>Geen open tickets</div>`}
  </div>
</div>`;

      // Laad tenants apart
      try {
        const td = await api("/api/admin/tenants");
        _cache.tenants = td.tenants||[];
        const el = document.getElementById("dashTenantList");
        if (el) el.innerHTML = _cache.tenants.length ? `
        <div class="sa-tbl-wrap"><table class="sa-tbl">
          <thead><tr><th>Naam</th><th>Plan</th><th>Status</th><th>Gebruikers</th></tr></thead>
          <tbody>${_cache.tenants.slice(0,6).map(t=>`<tr>
            <td><div class="main">${esc(t.name)}</div><div class="sub">${esc(t.id)}</div></td>
            <td>${badge(t.plan, planColor[t.plan])}</td>
            <td>${badge(t.status, statusColor[t.status])}</td>
            <td>${t.counts?.users||0}</td>
          </tr>`).join("")}</tbody>
        </table></div>` : `<div class="sa-empty"><div class="sa-empty-icon">🏢</div>Geen tenants — <button class="sa-btn btn-primary sm" style="margin-top:8px" onclick="document.querySelector('[data-view=tenants]').click()">+ Aanmaken</button></div>`;
      } catch(_) {}
    } catch(e) { content().innerHTML = err(e); }
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: Tenants
  // ══════════════════════════════════════════════════════════
  async function tenants() {
    const c = content(); c.innerHTML = loader();
    try {
      const td = await api("/api/admin/tenants");
      _cache.tenants = td.tenants||[];
      topAction(`<button class="sa-btn btn-primary" id="saNewTenant">+ Nieuwe tenant</button>`);
      c.innerHTML = `
<div class="sa-page-head">
  <h1>Tenants<span class="cnt">${_cache.tenants.length}</span></h1><div class="sa-spacer"></div>
</div>
<div class="sa-filters">
  <input id="tfSearch" placeholder="Zoek naam, e-mail, ID…" style="flex:1;min-width:180px">
  <select id="tfPlan"><option value="">Alle plannen</option><option>starter</option><option>business</option><option>enterprise</option></select>
  <select id="tfStatus"><option value="">Alle statussen</option><option>trial</option><option>active</option><option>suspended</option></select>
</div>
<div class="sa-card">
  <div class="sa-tbl-wrap">
    <table class="sa-tbl">
      <thead><tr><th>Tenant</th><th>Plan</th><th>Status</th><th>Gebruikers</th><th>Werkbonnen</th><th>Aangemaakt</th><th>Acties</th></tr></thead>
      <tbody id="tenantTbody"></tbody>
    </table>
    <div id="tenantEmpty" class="sa-empty" style="display:none"><div class="sa-empty-icon">🏢</div>Geen tenants gevonden</div>
  </div>
</div>`;

      renderTenantRows(_cache.tenants);
      document.getElementById("saNewTenant")?.addEventListener("click", newTenantDrawer);
      ["tfSearch","tfPlan","tfStatus"].forEach(id => {
        document.getElementById(id)?.addEventListener("input", filterTenants);
        document.getElementById(id)?.addEventListener("change", filterTenants);
      });
    } catch(e) { c.innerHTML = err(e); }
  }

  function filterTenants() {
    const q = (document.getElementById("tfSearch")?.value||"").toLowerCase();
    const p = document.getElementById("tfPlan")?.value||"";
    const s = document.getElementById("tfStatus")?.value||"";
    renderTenantRows(_cache.tenants.filter(t => {
      const txt = `${t.name} ${t.billingEmail||""} ${t.id}`.toLowerCase();
      return (!q||txt.includes(q)) && (!p||t.plan===p) && (!s||t.status===s);
    }));
  }

  function renderTenantRows(rows) {
    const tb = document.getElementById("tenantTbody");
    const em = document.getElementById("tenantEmpty");
    if (!tb) return;
    if (em) em.style.display = rows.length ? "none" : "";
    tb.innerHTML = rows.map(t=>`<tr>
      <td><div class="main">${esc(t.name)}</div><div class="sub">${esc(t.billingEmail||t.id)}</div></td>
      <td>${badge(t.plan, planColor[t.plan])}</td>
      <td>${badge(t.status, statusColor[t.status])}</td>
      <td>${t.counts?.users||0}</td>
      <td>${t.counts?.workorders||0}</td>
      <td><span class="sub">${fmtD(t.createdAt)}</span></td>
      <td><div class="sa-actions">
        <button class="sa-btn btn-secondary sm" data-tid="${esc(t.id)}" data-act="detail">Detail</button>
        ${t.status!=="suspended"
          ? `<button class="sa-btn btn-danger sm" data-tid="${esc(t.id)}" data-act="suspend">Pauzeer</button>`
          : `<button class="sa-btn btn-success sm" data-tid="${esc(t.id)}" data-act="activate">Activeer</button>`}
      </div></td>
    </tr>`).join("");
    tb.querySelectorAll("[data-act]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.tid, act = btn.dataset.act;
        if (act==="detail") tenantDetailDrawer(id);
        else if (act==="suspend") confirmSuspend(id);
        else if (act==="activate") doActivate(id);
      });
    });
  }

  async function confirmSuspend(id) {
    const t = _cache.tenants.find(x=>x.id===id);
    if (!confirm(`Tenant "${t?.name||id}" pauzeren?`)) return;
    try { await api(`/api/admin/tenants/${id}/suspend`,{method:"POST"}); tenants(); }
    catch(e) { alert(e.message); }
  }
  async function doActivate(id) {
    try { await api(`/api/admin/tenants/${id}/activate`,{method:"POST"}); tenants(); }
    catch(e) { alert(e.message); }
  }

  function tenantDetailDrawer(id) {
    const t = _cache.tenants.find(x=>x.id===id);
    if (!t) return;
    openDrawer(`${esc(t.name)}`, `
<div class="sa-detail">
  <div class="sa-detail-row"><span class="sa-detail-label">ID</span><span class="sa-detail-value mono">${esc(t.id)}</span></div>
  <div class="sa-detail-row"><span class="sa-detail-label">Naam</span><span class="sa-detail-value">${esc(t.name)}</span></div>
  <div class="sa-detail-row"><span class="sa-detail-label">Plan</span><span class="sa-detail-value">${badge(t.plan,planColor[t.plan])}</span></div>
  <div class="sa-detail-row"><span class="sa-detail-label">Status</span><span class="sa-detail-value">${badge(t.status,statusColor[t.status])}</span></div>
  <div class="sa-detail-row"><span class="sa-detail-label">Billing e-mail</span><span class="sa-detail-value">${esc(t.billingEmail||"—")}</span></div>
  <div class="sa-detail-row"><span class="sa-detail-label">Aangemaakt</span><span class="sa-detail-value">${fmtD(t.createdAt)}</span></div>
</div>

<div class="sa-stat-grid">
  <div class="sa-stat-card"><div class="sv">${t.counts?.users||0}</div><div class="sl">Gebruikers</div></div>
  <div class="sa-stat-card"><div class="sv">${t.counts?.workorders||0}</div><div class="sl">Werkbonnen</div></div>
  <div class="sa-stat-card"><div class="sv">${t.counts?.invoices||0}</div><div class="sl">Facturen</div></div>
</div>

<div class="sa-divider"></div>
<div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px">Plan wijzigen</div>
<div style="display:flex;gap:8px;flex-wrap:wrap">
  ${["starter","business","enterprise"].map(p=>`<button class="sa-btn ${t.plan===p?"btn-primary":"btn-secondary"} sm" data-plan="${p}" id="planBtn_${p}">${p}</button>`).join("")}
</div>

<div class="sa-divider"></div>
<div style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px">Acties</div>
<div style="display:flex;gap:8px;flex-wrap:wrap">
  ${t.status!=="suspended"
    ? `<button class="sa-btn btn-danger sm" id="drawerSuspend" data-id="${esc(t.id)}">⏸ Pauzeer tenant</button>`
    : `<button class="sa-btn btn-success sm" id="drawerActivate" data-id="${esc(t.id)}">▶ Activeer tenant</button>`}
</div>`,
    // footer
    `<button class="sa-btn btn-secondary" id="closeDrawer">Sluiten</button>`);

    document.getElementById("closeDrawer")?.addEventListener("click", closeDrawer);
    document.getElementById("drawerSuspend")?.addEventListener("click", async e => {
      if (!confirm("Pauzeren?")) return;
      try { await api(`/api/admin/tenants/${e.target.dataset.id}/suspend`,{method:"POST"}); closeDrawer(); tenants(); }
      catch(ex) { alert(ex.message); }
    });
    document.getElementById("drawerActivate")?.addEventListener("click", async e => {
      try { await api(`/api/admin/tenants/${e.target.dataset.id}/activate`,{method:"POST"}); closeDrawer(); tenants(); }
      catch(ex) { alert(ex.message); }
    });
    // Plan buttons
    document.querySelectorAll("[id^=planBtn_]").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/admin/tenants/${t.id}`,{method:"PATCH",body:JSON.stringify({plan:btn.dataset.plan})});
          closeDrawer(); tenants();
        } catch(ex) { alert(ex.message); }
      });
    });
  }

  function newTenantDrawer() {
    openDrawer("Nieuwe tenant aanmaken", `
<form id="newTenantForm">
  <div class="sa-form-grid">
    <div class="sa-field" style="grid-column:1/-1"><label>Bedrijfsnaam *</label><input name="name" required placeholder="Bouwbedrijf Janssen BV"></div>
    <div class="sa-field" style="grid-column:1/-1"><label>Billing e-mail *</label><input name="billingEmail" type="email" required placeholder="finance@janssen.be"></div>
    <div class="sa-field"><label>Plan</label>
      <select name="plan"><option value="starter">Starter (€9/user)</option><option value="business" selected>Business (€18/user)</option><option value="enterprise">Enterprise (€29/user)</option></select>
    </div>
    <div class="sa-field"><label>Status</label>
      <select name="status"><option value="trial" selected>Trial</option><option value="active">Actief</option></select>
    </div>
  </div>
  <div class="sa-divider"></div>
  <div style="font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:10px">Admin-gebruiker (optioneel)</div>
  <div class="sa-form-grid">
    <div class="sa-field"><label>Admin naam</label><input name="adminName" placeholder="Jan Janssen"></div>
    <div class="sa-field"><label>Admin e-mail</label><input name="adminEmail" type="email" placeholder="jan@janssen.be"></div>
    <div class="sa-field" style="grid-column:1/-1"><label>Admin wachtwoord</label><input name="adminPassword" type="password" placeholder="Min. 10 tekens met cijfer en hoofdletter"></div>
  </div>
</form>`,
    `<button class="sa-btn btn-primary" id="submitNewTenant">Tenant aanmaken</button>
     <button class="sa-btn btn-secondary" id="closeDrawer">Annuleren</button>`);

    document.getElementById("closeDrawer")?.addEventListener("click", closeDrawer);
    document.getElementById("submitNewTenant")?.addEventListener("click", async () => {
      const form = document.getElementById("newTenantForm");
      if (!form.checkValidity()) { form.reportValidity(); return; }
      const body = Object.fromEntries(new FormData(form).entries());
      const btn = document.getElementById("submitNewTenant");
      btn.disabled = true; btn.textContent = "Bezig…";
      try { await api("/api/admin/tenants",{method:"POST",body:JSON.stringify(body)}); closeDrawer(); tenants(); }
      catch(e) { btn.disabled=false; btn.textContent="Tenant aanmaken"; alert(e.message); }
    });
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: Gebruikers
  // ══════════════════════════════════════════════════════════
  async function users() {
    const c = content(); c.innerHTML = loader();
    try {
      const [ud, td] = await Promise.all([api("/api/admin/users"), api("/api/admin/tenants").catch(()=>({tenants:[]}))]);
      _cache.users   = ud.users||[];
      _cache.tenants = td.tenants||[];
      const tmap = Object.fromEntries(_cache.tenants.map(t=>[t.id,t]));

      c.innerHTML = `
<div class="sa-page-head"><h1>Gebruikers<span class="cnt">${_cache.users.length}</span></h1></div>
<div class="sa-filters">
  <input id="ufSearch" placeholder="Naam, e-mail…" style="flex:1;min-width:180px">
  <select id="ufRole"><option value="">Alle rollen</option><option value="super_admin">Super Admin</option><option value="tenant_admin">Tenant Admin</option><option value="manager">Manager</option><option value="employee">Medewerker</option></select>
  <select id="ufActive"><option value="">Alle</option><option value="1">Actief</option><option value="0">Inactief</option></select>
</div>
<div class="sa-card">
  <div class="sa-tbl-wrap">
    <table class="sa-tbl">
      <thead><tr><th>Naam</th><th>E-mail</th><th>Rol</th><th>Tenant</th><th>Status</th><th>MFA</th><th>Vergrendeld</th><th>Acties</th></tr></thead>
      <tbody id="userTbody"></tbody>
    </table>
  </div>
</div>`;

      function renderUserRows() {
        const q = (document.getElementById("ufSearch")?.value||"").toLowerCase();
        const rl = document.getElementById("ufRole")?.value||"";
        const ac = document.getElementById("ufActive")?.value;
        const rows = _cache.users.filter(u => {
          const txt = `${u.name||""} ${u.email} ${u.role}`.toLowerCase();
          const isActive = u.active !== false;
          return (!q||txt.includes(q)) && (!rl||u.role===rl) && (ac===""||( ac==="1"?isActive:!isActive ));
        });
        const tb = document.getElementById("userTbody");
        if (!tb) return;
        tb.innerHTML = rows.map(u => {
          const t = tmap[u.tenantId];
          const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
          return `<tr>
            <td><div class="main">${esc(u.name||u.email)}</div></td>
            <td style="font-size:12px">${esc(u.email)}</td>
            <td>${badge(u.role, roleColor[u.role])}</td>
            <td><span class="sub">${esc(t?.name||(u.tenantId?"…":"—"))}</span></td>
            <td>${u.active!==false?badge("Actief","badge-green"):badge("Inactief","badge-red")}</td>
            <td>${u.mfaEnabled?badge("Aan","badge-green"):badge("Uit","badge-gray")}</td>
            <td>${locked?badge("🔒 Vergrendeld","badge-orange"):badge("OK","badge-green")}</td>
            <td><div class="sa-actions">
              <button class="sa-btn btn-secondary sm" data-uid="${esc(u.id)}" data-act="detail">Detail</button>
              ${u.active!==false
                ? `<button class="sa-btn btn-danger sm" data-uid="${esc(u.id)}" data-act="deactivate">Deact.</button>`
                : `<button class="sa-btn btn-success sm" data-uid="${esc(u.id)}" data-act="activate">Activeer</button>`}
              ${locked?`<button class="sa-btn btn-ghost sm" data-uid="${esc(u.id)}" data-act="unlock">Ontgrendel</button>`:""}
            </div></td>
          </tr>`;
        }).join("");

        tb.querySelectorAll("[data-act]").forEach(btn => {
          const uid = btn.dataset.uid, act = btn.dataset.act;
          btn.addEventListener("click", async () => {
            if (act==="detail") { userDetailDrawer(uid, tmap); return; }
            if (act==="deactivate") {
              if (!confirm("Gebruiker deactiveren?")) return;
              try { await api(`/api/admin/users/${uid}`,{method:"PATCH",body:JSON.stringify({active:false})}); users(); } catch(e){alert(e.message);}
            }
            if (act==="activate") {
              try { await api(`/api/admin/users/${uid}`,{method:"PATCH",body:JSON.stringify({active:true})}); users(); } catch(e){alert(e.message);}
            }
            if (act==="unlock") {
              try { await api(`/api/admin/users/${uid}/unlock`,{method:"POST"}); users(); } catch(e){alert(e.message);}
            }
          });
        });
      }

      renderUserRows();
      ["ufSearch","ufRole","ufActive"].forEach(id => {
        document.getElementById(id)?.addEventListener("input", renderUserRows);
        document.getElementById(id)?.addEventListener("change", renderUserRows);
      });
    } catch(e) { content().innerHTML = err(e); }
  }

  function userDetailDrawer(uid, tmap) {
    const u = _cache.users.find(x=>x.id===uid);
    if (!u) return;
    const t = tmap?.[u.tenantId];
    const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
    openDrawer(`${esc(u.name||u.email)}`, `
<div class="sa-detail">
  <div class="sa-detail-row"><span class="sa-detail-label">ID</span><span class="sa-detail-value mono">${esc(u.id)}</span></div>
  <div class="sa-detail-row"><span class="sa-detail-label">Naam</span><span class="sa-detail-value">${esc(u.name||"—")}</span></div>
  <div class="sa-detail-row"><span class="sa-detail-label">E-mail</span><span class="sa-detail-value">${esc(u.email)}</span></div>
  <div class="sa-detail-row"><span class="sa-detail-label">Rol</span><span class="sa-detail-value">${badge(u.role,roleColor[u.role])}</span></div>
  <div class="sa-detail-row"><span class="sa-detail-label">Tenant</span><span class="sa-detail-value">${esc(t?.name||u.tenantId||"—")}</span></div>
  <div class="sa-detail-row"><span class="sa-detail-label">Status</span><span class="sa-detail-value">${u.active!==false?badge("Actief","badge-green"):badge("Inactief","badge-red")}</span></div>
  <div class="sa-detail-row"><span class="sa-detail-label">MFA</span><span class="sa-detail-value">${u.mfaEnabled?badge("Ingeschakeld","badge-green"):badge("Uitgeschakeld","badge-gray")}</span></div>
  <div class="sa-detail-row"><span class="sa-detail-label">Vergrendeld tot</span><span class="sa-detail-value">${locked?fmtDT(u.lockedUntil):"—"}</span></div>
  <div class="sa-detail-row"><span class="sa-detail-label">Aangemaakt</span><span class="sa-detail-value">${fmtD(u.createdAt)}</span></div>
</div>
${locked?`<div class="sa-alert alert-warn">⚠️ Account is vergrendeld na teveel mislukte aanmeldingen.</div>`:""}
<div class="sa-divider"></div>
<div style="font-size:13px;font-weight:600;margin-bottom:8px">Acties</div>
<div style="display:flex;gap:8px;flex-wrap:wrap">
  <button class="sa-btn btn-secondary sm" id="drawerPwReset">🔑 Wachtwoord resetten</button>
  ${locked?`<button class="sa-btn btn-success sm" id="drawerUnlock">🔓 Ontgrendelen</button>`:""}
  ${u.active!==false
    ? `<button class="sa-btn btn-danger sm" id="drawerDeactivate">Deactiveren</button>`
    : `<button class="sa-btn btn-success sm" id="drawerActivate">Activeren</button>`}
</div>
<div id="pwResetResult"></div>`,
    `<button class="sa-btn btn-secondary" id="closeDrawer">Sluiten</button>`);

    document.getElementById("closeDrawer")?.addEventListener("click", closeDrawer);
    document.getElementById("drawerPwReset")?.addEventListener("click", async () => {
      const btn = document.getElementById("drawerPwReset");
      btn.disabled=true; btn.textContent="Bezig…";
      try {
        const r = await api(`/api/admin/users/${uid}/reset-password`,{method:"POST"});
        document.getElementById("pwResetResult").innerHTML = `<div class="sa-alert alert-success" style="margin-top:10px">✅ Tijdelijk wachtwoord: <strong style="font-family:monospace">${esc(r.tempPassword)}</strong><br><small>Geef dit eenmalig door aan de gebruiker.</small></div>`;
      } catch(e) { alert(e.message); btn.disabled=false; btn.textContent="🔑 Wachtwoord resetten"; }
    });
    document.getElementById("drawerUnlock")?.addEventListener("click", async () => {
      try { await api(`/api/admin/users/${uid}/unlock`,{method:"POST"}); closeDrawer(); users(); } catch(e){alert(e.message);}
    });
    document.getElementById("drawerDeactivate")?.addEventListener("click", async () => {
      if (!confirm("Gebruiker deactiveren?")) return;
      try { await api(`/api/admin/users/${uid}`,{method:"PATCH",body:JSON.stringify({active:false})}); closeDrawer(); users(); } catch(e){alert(e.message);}
    });
    document.getElementById("drawerActivate")?.addEventListener("click", async () => {
      try { await api(`/api/admin/users/${uid}`,{method:"PATCH",body:JSON.stringify({active:true})}); closeDrawer(); users(); } catch(e){alert(e.message);}
    });
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: Facturatie / MRR
  // ══════════════════════════════════════════════════════════
  async function billing() {
    const c = content(); c.innerHTML = loader();
    try {
      const bd = await api("/api/admin/billing");
      const rows = bd.rows||[];
      c.innerHTML = `
<div class="sa-kpis">
  <div class="sa-kpi kpi-green">
    <div class="sa-kpi-label">MRR totaal (schatting)</div>
    <div class="sa-kpi-value">${fmtEur(bd.totalMrr)}</div>
    <div class="sa-kpi-sub">Maandelijks terugkerende omzet</div>
  </div>
  <div class="sa-kpi kpi-purple">
    <div class="sa-kpi-label">ARR totaal (schatting)</div>
    <div class="sa-kpi-value">${fmtEur(bd.totalArr)}</div>
    <div class="sa-kpi-sub">Jaarlijkse omzet</div>
  </div>
  <div class="sa-kpi kpi-blue">
    <div class="sa-kpi-label">Actieve tenants</div>
    <div class="sa-kpi-value">${rows.filter(r=>r.status==="active").length}</div>
    <div class="sa-kpi-sub">van ${rows.length} totaal</div>
  </div>
  <div class="sa-kpi kpi-orange">
    <div class="sa-kpi-label">Gem. MRR per tenant</div>
    <div class="sa-kpi-value">${rows.filter(r=>r.mrr>0).length ? fmtEur(bd.totalMrr / rows.filter(r=>r.mrr>0).length) : "—"}</div>
    <div class="sa-kpi-sub">actieve tenants</div>
  </div>
</div>
<div class="sa-alert alert-info" style="margin-bottom:16px">ℹ️ Schattingen gebaseerd op plan × gebruikers. Koppel Stripe voor werkelijke facturatie.</div>
<div class="sa-card">
  <div class="sa-card-head"><div class="sa-card-title">MRR per tenant</div></div>
  <div class="sa-tbl-wrap">
    <table class="sa-tbl">
      <thead><tr><th>Tenant</th><th>Plan</th><th>Status</th><th>Gebruikers</th><th>Prijs/user</th><th>MRR</th><th>ARR</th></tr></thead>
      <tbody>
        ${rows.map(r=>`<tr>
          <td><div class="main">${esc(r.name)}</div><div class="sub">${esc(r.billingEmail||r.id)}</div></td>
          <td>${badge(r.plan, planColor[r.plan])}</td>
          <td>${badge(r.status, statusColor[r.status])}</td>
          <td>${r.users}</td>
          <td>${fmtEur(r.mrrUnit)}</td>
          <td style="font-weight:700;color:${r.mrr>0?"#15803d":"#94a3b8"}">${r.mrr>0?fmtEur(r.mrr):"—"}</td>
          <td style="color:#94a3b8">${r.arr>0?fmtEur(r.arr):"—"}</td>
        </tr>`).join("")}
      </tbody>
      <tfoot>
        <tr style="background:#f8fafc;font-weight:700">
          <td colspan="5" style="padding:10px 14px;font-size:12px;color:#64748b">TOTAAL</td>
          <td style="padding:10px 14px;font-size:14px;color:#15803d">${fmtEur(bd.totalMrr)}</td>
          <td style="padding:10px 14px;font-size:14px;color:#374151">${fmtEur(bd.totalArr)}</td>
        </tr>
      </tfoot>
    </table>
  </div>
</div>`;
    } catch(e) { content().innerHTML = err(e); }
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: Systeem
  // ══════════════════════════════════════════════════════════
  async function system() {
    const c = content(); c.innerHTML = loader();
    try {
      const [hd, sd, ed] = await Promise.all([
        api("/api/health"),
        api("/api/status").catch(()=>({})),
        api("/api/admin/errors?limit=50")
      ]);
      const errors = ed.errors||[];
      const badge_e = n => `<span class="nav-badge" style="display:inline-block;margin-left:0;background:${n>0?"#ef4444":"#10b981"}">${n}</span>`;
      c.innerHTML = `
<div class="sa-kpis">
  <div class="sa-kpi kpi-teal">
    <div class="sa-kpi-label">Server status</div>
    <div class="sa-kpi-value" style="font-size:18px">✅ Online</div>
    <div class="sa-kpi-sub">Uptime ${fmtUptime(hd.uptime||0)}</div>
  </div>
  <div class="sa-kpi kpi-blue">
    <div class="sa-kpi-label">Versie</div>
    <div class="sa-kpi-value" style="font-size:18px">${esc(hd.version||"—")}</div>
    <div class="sa-kpi-sub">${esc(hd.releaseChannel||"—")} · ${esc((hd.commitSha||"local").slice(0,8))}</div>
  </div>
  <div class="sa-kpi kpi-indigo">
    <div class="sa-kpi-label">Opslag</div>
    <div class="sa-kpi-value" style="font-size:18px">${esc(hd.storageAdapter||"json")}</div>
    <div class="sa-kpi-sub">${hd.storeReady?"Verbonden":"⚠️ Niet verbonden"}</div>
  </div>
  <div class="sa-kpi ${errors.length>0?"kpi-red":"kpi-teal"}">
    <div class="sa-kpi-label">Errors (opgeslagen)</div>
    <div class="sa-kpi-value">${errors.length}</div>
    <div class="sa-kpi-sub">recent</div>
  </div>
</div>

<div class="sa-card">
  <div class="sa-card-head">
    <div class="sa-card-title">Server errors ${badge_e(errors.length)}</div>
    <button class="sa-btn btn-secondary sm" onclick="system()">↻ Vernieuwen</button>
  </div>
  ${errors.length ? `
  <div class="sa-tbl-wrap">
    <table class="sa-tbl">
      <thead><tr><th>Tijdstip</th><th>Status</th><th>Methode</th><th>Pad</th><th>Bericht</th><th>Tenant</th></tr></thead>
      <tbody>
        ${errors.map(e=>`<tr>
          <td><span class="mono">${esc((e.at||"").slice(0,19).replace("T"," "))}</span></td>
          <td>${badge(e.status||"?", Number(e.status)>=500?"badge-red":"badge-orange")}</td>
          <td><span class="mono">${esc(e.method||"—")}</span></td>
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span class="mono" style="font-size:11px">${esc(e.path||"—")}</span></td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${esc(e.message||"—")}</td>
          <td><span class="sub">${esc(e.tenantId||"—")}</span></td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>` : `<div class="sa-empty"><div class="sa-empty-icon">✅</div>Geen server errors — systeem is gezond</div>`}
</div>`;
    } catch(e) { content().innerHTML = err(e); }
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: Support
  // ══════════════════════════════════════════════════════════
  async function support() {
    const c = content(); c.innerHTML = loader();
    try {
      const sd = await api("/api/admin/support");
      const tickets = sd.tickets||[];
      const open = tickets.filter(t=>t.status!=="closed");
      badge_update("navBadgeSupport", open.length);
      c.innerHTML = `
<div class="sa-page-head"><h1>Support Tickets<span class="cnt">${tickets.length}</span></h1></div>
<div class="sa-filters">
  <input id="stSearch" placeholder="Zoek…" style="flex:1;min-width:180px">
  <select id="stStatus"><option value="">Alle</option><option value="open">Open</option><option value="closed">Gesloten</option></select>
  <select id="stPrio"><option value="">Alle prioriteiten</option><option value="hoog">Hoog</option><option value="normaal">Normaal</option></select>
</div>
<div class="sa-card">
  ${tickets.length ? `
  <div class="sa-tbl-wrap">
    <table class="sa-tbl" id="stTable">
      <thead><tr><th>Onderwerp</th><th>Tenant</th><th>Status</th><th>Prioriteit</th><th>Aangemaakt</th></tr></thead>
      <tbody id="stTbody"></tbody>
    </table>
  </div>` : `<div class="sa-empty"><div class="sa-empty-icon">🎫</div>Geen support tickets</div>`}
</div>`;

      function renderST() {
        const q  = (document.getElementById("stSearch")?.value||"").toLowerCase();
        const st = document.getElementById("stStatus")?.value||"";
        const pr = document.getElementById("stPrio")?.value||"";
        const rows = tickets.filter(t => {
          const txt = `${t.subject||t.title||""} ${t.tenantName||t.tenantId||""}`.toLowerCase();
          return (!q||txt.includes(q))&&(!st||t.status===st)&&(!pr||t.priority===pr);
        });
        const tb = document.getElementById("stTbody");
        if (tb) tb.innerHTML = rows.map(t=>`<tr>
          <td><div class="main">${esc(t.subject||t.title||"Ticket")}</div></td>
          <td><span class="sub">${esc(t.tenantName||t.tenantId||"—")}</span></td>
          <td>${badge(t.status, t.status==="closed"?"badge-green":t.status==="open"?"badge-yellow":"badge-gray")}</td>
          <td>${badge(t.priority||"normaal", t.priority==="hoog"?"badge-red":"badge-gray")}</td>
          <td><span class="sub">${fmtD(t.createdAt)}</span></td>
        </tr>`).join("");
      }
      renderST();
      ["stSearch","stStatus","stPrio"].forEach(id => {
        document.getElementById(id)?.addEventListener("input", renderST);
        document.getElementById(id)?.addEventListener("change", renderST);
      });
    } catch(e) { content().innerHTML = err(e); }
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: Audit Log
  // ══════════════════════════════════════════════════════════
  async function audit() {
    const c = content(); c.innerHTML = loader();
    try {
      const d = await api("/api/audit?limit=200");
      const events = d.rows||d.events||[];
      c.innerHTML = `
<div class="sa-page-head"><h1>Audit Log<span class="cnt">${events.length}</span></h1>
  <div class="sa-spacer"></div>
  <button class="sa-btn btn-secondary sm" id="auditExport">⬇ CSV</button>
</div>
<div class="sa-filters">
  <input id="auSearch" placeholder="Actor of detail…" style="flex:1;min-width:180px">
  <select id="auArea"><option value="">Alle gebieden</option>${[...new Set(events.map(e=>e.area).filter(Boolean))].map(a=>`<option>${a}</option>`).join("")}</select>
  <select id="auLimit"><option value="50">50</option><option value="100" selected>100</option><option value="200">200</option></select>
</div>
<div class="sa-card">
  <div class="sa-tbl-wrap">
    <table class="sa-tbl">
      <thead><tr><th>Tijdstip</th><th>Actor</th><th>Actie</th><th>Gebied</th><th>Tenant</th><th>Detail</th></tr></thead>
      <tbody id="auTbody"></tbody>
    </table>
    <div id="auEmpty" class="sa-empty" style="display:none"><div class="sa-empty-icon">📋</div>Geen events</div>
  </div>
</div>`;

      let _rows = events;
      function renderAuditRows() {
        const q  = (document.getElementById("auSearch")?.value||"").toLowerCase();
        const ar = document.getElementById("auArea")?.value||"";
        const lm = Number(document.getElementById("auLimit")?.value||100);
        const filtered = _rows.filter(e => {
          const txt = `${e.actor||""} ${e.detail||""}`.toLowerCase();
          return (!q||txt.includes(q))&&(!ar||e.area===ar);
        }).slice(0,lm);
        const tb = document.getElementById("auTbody");
        const em = document.getElementById("auEmpty");
        if (em) em.style.display = filtered.length?"none":"";
        if (tb) tb.innerHTML = filtered.map(e=>`<tr>
          <td><span class="mono" style="font-size:11px">${esc((e.at||"").slice(0,19).replace("T"," "))}</span></td>
          <td style="font-size:12px">${esc(e.actor||"—")}</td>
          <td style="font-size:12.5px;font-weight:500">${esc(e.action||"—")}</td>
          <td>${badge(e.area||"—","badge-blue")}</td>
          <td><span class="sub">${esc(e.tenantId||"—")}</span></td>
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span class="sub">${esc(e.detail||"—")}</span></td>
        </tr>`).join("");
      }
      renderAuditRows();
      ["auSearch","auArea","auLimit"].forEach(id => {
        document.getElementById(id)?.addEventListener("input", renderAuditRows);
        document.getElementById(id)?.addEventListener("change", renderAuditRows);
      });
      document.getElementById("auditExport")?.addEventListener("click", () => {
        const csv = "﻿" + ["Tijdstip;Actor;Actie;Gebied;Tenant;Detail",
          ...events.map(e=>[e.at||"",e.actor||"",e.action||"",e.area||"",e.tenantId||"",e.detail||""].map(v=>`"${v}"`).join(";"))
        ].join("\n");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
        a.download = `audit-${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
      });
    } catch(e) { content().innerHTML = err(e); }
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: Instellingen
  // ══════════════════════════════════════════════════════════
  async function integrations() {
    const c = content(); c.innerHTML = loader();
    try {
      const d = await api("/api/admin/integrations");
      const cfg = d.config || {};
      const statusPill = ok => ok ? badge("Geconfigureerd","badge-green") : badge("Dummy","badge-orange");
      c.innerHTML = `
<div class="sa-card">
  <div class="sa-card-head"><div class="sa-card-title">Integraties &amp; API-sleutels</div><div class="sa-card-sub">Beheer hier de echte sleutels. Standaard staan dummy-waarden ingesteld zodat niets crasht.</div></div>
  <div style="padding:16px;display:flex;flex-direction:column;gap:8px">
    <div style="font-size:12px;color:#92400e;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 12px">
      ⚠️ Geheime sleutels worden gemaskeerd getoond. Laat een veld op de gemaskeerde waarde staan om het ongewijzigd te laten; typ een nieuwe waarde om te overschrijven.
    </div>
  </div>
</div>

<form id="saIntegrationsForm">
  <div class="sa-card">
    <div class="sa-card-head"><div class="sa-card-title">💳 Stripe — betalingen</div><div class="sa-card-sub">${statusPill(cfg.stripe?.configured)} ${cfg.stripe?.mode?badge(cfg.stripe.mode, cfg.stripe.mode==="live"?"badge-green":"badge-blue"):""}</div></div>
    <div style="padding:16px;display:grid;gap:12px">
      <label class="sa-fld"><span>Secret key</span><input name="stripe.secretKey" value="${esc(cfg.stripe?.secretKey||"")}" placeholder="sk_live_..."></label>
      <label class="sa-fld"><span>Webhook secret</span><input name="stripe.webhookSecret" value="${esc(cfg.stripe?.webhookSecret||"")}" placeholder="whsec_..."></label>
    </div>
  </div>

  <div class="sa-card">
    <div class="sa-card-head"><div class="sa-card-title">📧 Peppol — e-facturatie (BE)</div><div class="sa-card-sub">${statusPill(cfg.peppol?.configured)}</div></div>
    <div style="padding:16px;display:grid;gap:12px">
      <label class="sa-fld"><span>Provider</span>
        <select name="peppol.provider">
          ${["mock","billit","digiteal","unifiedpost"].map(p=>`<option value="${p}" ${cfg.peppol?.provider===p?"selected":""}>${p}</option>`).join("")}
        </select>
      </label>
      <label class="sa-fld"><span>API-sleutel</span><input name="peppol.apiKey" value="${esc(cfg.peppol?.apiKey||"")}" placeholder="peppol_..."></label>
    </div>
  </div>

  <div class="sa-card">
    <div class="sa-card-head"><div class="sa-card-title">✉️ E-mail — verzending</div><div class="sa-card-sub">${statusPill(cfg.email?.configured)}</div></div>
    <div style="padding:16px;display:grid;gap:12px">
      <label class="sa-fld"><span>Provider</span>
        <select name="email.provider">
          ${["log","resend","sendgrid"].map(p=>`<option value="${p}" ${cfg.email?.provider===p?"selected":""}>${p}</option>`).join("")}
        </select>
      </label>
      <label class="sa-fld"><span>API-sleutel</span><input name="email.apiKey" value="${esc(cfg.email?.apiKey||"")}" placeholder="re_... (Resend) / SG... (SendGrid)"></label>
      <label class="sa-fld"><span>Afzender</span><input name="email.from" value="${esc(cfg.email?.from||"")}" placeholder="WorkFlow Pro &lt;noreply@bedrijf.be&gt;"></label>
    </div>
  </div>

  <div class="sa-card">
    <div class="sa-card-head"><div class="sa-card-title">🏢 KBO — bedrijfsopzoeking</div><div class="sa-card-sub">${statusPill(cfg.kbo?.configured)}</div></div>
    <div style="padding:16px;display:grid;gap:12px">
      <label class="sa-fld"><span>Provider</span>
        <select name="kbo.provider">
          ${["mock","cbe-open-data"].map(p=>`<option value="${p}" ${cfg.kbo?.provider===p?"selected":""}>${p}</option>`).join("")}
        </select>
      </label>
      <label class="sa-fld"><span>API-sleutel (optioneel)</span><input name="kbo.apiKey" value="${esc(cfg.kbo?.apiKey||"")}" placeholder="optioneel"></label>
    </div>
  </div>

  <div style="display:flex;gap:10px;align-items:center;margin:4px 0 24px">
    <button type="submit" class="sa-btn btn-primary">Opslaan</button>
    <span id="saIntStatus" style="font-size:13px"></span>
  </div>
</form>
<style>
.sa-fld{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:600;color:#334155}
.sa-fld input,.sa-fld select{padding:9px 11px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;font-family:inherit;font-weight:400}
.sa-fld input:focus,.sa-fld select:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.12)}
</style>`;

      document.getElementById("saIntegrationsForm").addEventListener("submit", async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const body = { stripe:{}, peppol:{}, email:{}, kbo:{} };
        for (const [k,v] of fd.entries()) { const [s,f]=k.split("."); if(body[s]) body[s][f]=v; }
        const st = document.getElementById("saIntStatus");
        st.textContent = "Opslaan…"; st.style.color = "#64748b";
        try {
          await api("/api/admin/integrations", { method:"PUT", body: JSON.stringify(body) });
          st.textContent = "✓ Opgeslagen"; st.style.color = "#15803d";
          setTimeout(() => integrations(), 700);
        } catch(err) { st.textContent = "Fout: "+err.message; st.style.color = "#dc2626"; }
      });
    } catch(e) { content().innerHTML = err(e); }
  }

  async function settings() {
    const c = content(); c.innerHTML = loader();
    try {
      const [hd, rel] = await Promise.all([api("/api/health"), api("/api/releases").catch(()=>({release:{}}))]);
      const rel2 = rel.release||{};
      c.innerHTML = `
<div class="sa-grid2">
  <div class="sa-card">
    <div class="sa-card-head"><div class="sa-card-title">Systeem info</div></div>
    <div style="padding:16px">
      <div class="sa-detail">
        <div class="sa-detail-row"><span class="sa-detail-label">Applicatie</span><span class="sa-detail-value">${esc(hd.app||"WorkFlow Pro")}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Versie</span><span class="sa-detail-value">${esc(hd.version||"—")}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Release channel</span><span class="sa-detail-value">${badge(hd.releaseChannel||"dev", hd.releaseChannel==="production"?"badge-green":"badge-orange")}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Commit SHA</span><span class="sa-detail-value mono">${esc((hd.commitSha||"local").slice(0,12))}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Opslag adapter</span><span class="sa-detail-value">${badge(hd.storageAdapter||"json", hd.storageAdapter==="postgres"?"badge-green":"badge-blue")}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Server uptime</span><span class="sa-detail-value">${fmtUptime(hd.uptime||0)}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Modules</span><span class="sa-detail-value">${hd.modules||"—"}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Tijd server</span><span class="sa-detail-value mono" style="font-size:11px">${esc(hd.time||"")}</span></div>
      </div>
    </div>
  </div>

  <div class="sa-card">
    <div class="sa-card-head"><div class="sa-card-title">Release info</div></div>
    <div style="padding:16px">
      <div class="sa-detail">
        <div class="sa-detail-row"><span class="sa-detail-label">Versie</span><span class="sa-detail-value">${esc(rel2.version||"—")}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Channel</span><span class="sa-detail-value">${esc(rel2.channel||"—")}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Commit</span><span class="sa-detail-value mono">${esc(rel2.commitSha||"—")}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Build at</span><span class="sa-detail-value">${fmtDT(rel2.builtAt)}</span></div>
      </div>
    </div>
  </div>
</div>

<div class="sa-card">
  <div class="sa-card-head"><div class="sa-card-title">Beveiliging — MFA verplichten</div></div>
  <div style="padding:16px">
    <p style="font-size:13px;color:#64748b;margin:0 0 12px">Schakelt 2FA in voor álle beheerders (tenant-admins + super-admins) die nog geen MFA hebben. Bij hun volgende login is een authenticator-code vereist. De secrets en recovery codes worden hieronder éénmalig getoond.</p>
    <button id="saMfaEnforce" class="sa-btn btn-primary">🛡️ MFA verplichten voor alle beheerders</button>
    <div id="saMfaResult" style="margin-top:14px"></div>
  </div>
</div>

<div class="sa-card">
  <div class="sa-card-head"><div class="sa-card-title">Productie checklist</div></div>
  <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
    ${checklist([
      [hd.storageAdapter==="postgres", "Opslag op PostgreSQL/Supabase (STORAGE_ADAPTER=postgres)"],
      [hd.releaseChannel==="production", "Release channel = production (RELEASE_CHANNEL=production)"],
      [hd.commitSha && hd.commitSha!=="local-dev", "Commit SHA is gezet (COMMIT_SHA)"],
      [true, "CSP headers actief (via http.js)"],
      [true, "Rate limiting actief (via rate-limit.js)"],
      [true, "Graceful shutdown actief (SIGTERM handler)"],
    ])}
  </div>
</div>`;

      document.getElementById("saMfaEnforce")?.addEventListener("click", async () => {
        if (!confirm("MFA verplicht maken voor álle beheerders?\n\nBij de volgende login is een authenticator-code vereist. Bewaar de getoonde secrets en recovery codes — ze worden maar één keer getoond.")) return;
        const btn = document.getElementById("saMfaEnforce");
        const out = document.getElementById("saMfaResult");
        btn.disabled = true; btn.textContent = "Bezig…";
        try {
          const d = await api("/api/admin/mfa/enforce", { method: "POST", body: "{}" });
          const enrolled = d.enrolled || [];
          if (!enrolled.length) {
            out.innerHTML = `<div style="color:#15803d;font-weight:600;font-size:13px">✅ Alle beheerders hebben al MFA actief.</div>`;
            btn.textContent = "🛡️ MFA verplichten voor alle beheerders"; btn.disabled = false;
            return;
          }
          out.innerHTML = `
<div style="font-size:12px;color:#92400e;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;margin-bottom:10px">
  ⚠️ Bewaar onderstaande gegevens nu. Ze worden niet opnieuw getoond. Voeg de sleutel toe aan een authenticator-app.
</div>
${enrolled.map(e => `
  <div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:10px">
    <div style="font-weight:600;font-size:13px;color:#0f172a;margin-bottom:6px">${esc(e.name||e.email)} <span style="color:#94a3b8;font-weight:400">· ${esc(e.email)}</span></div>
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(e.otpauth||"")}" alt="QR" style="width:96px;height:96px;border:3px solid #e2e8f0;border-radius:8px" onerror="this.style.display='none'">
      <div style="flex:1;min-width:180px">
        <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.4px">Geheime sleutel</div>
        <div class="mono" style="background:#f1f5f9;padding:6px 10px;border-radius:6px;font-size:12px;word-break:break-all;margin:3px 0 8px">${esc(e.secret||"")}</div>
        <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.4px">Recovery codes</div>
        <div class="mono" style="font-size:11.5px;color:#374151;line-height:1.7">${(e.recoveryCodes||[]).map(c=>esc(c)).join(" &nbsp; ")}</div>
      </div>
    </div>
  </div>`).join("")}
<div style="color:#15803d;font-weight:600;font-size:13px;margin-top:4px">✅ ${enrolled.length} beheerder(s) ingeschreven — Foundation-MFA voldaan.</div>`;
          btn.textContent = "Ingeschreven ✓";
        } catch(e) {
          out.innerHTML = `<div style="color:#dc2626;font-size:13px">Fout: ${esc(e.message)}</div>`;
          btn.textContent = "🛡️ MFA verplichten voor alle beheerders"; btn.disabled = false;
        }
      });
    } catch(e) { content().innerHTML = err(e); }
  }

  function checklist(items) {
    return items.map(([ok, label]) => `
    <div style="display:flex;align-items:center;gap:10px;font-size:13px;padding:6px 10px;background:${ok?"#f0fdf4":"#fef2f2"};border-radius:7px;border:1px solid ${ok?"#bbf7d0":"#fecaca"}">
      <span style="font-size:16px">${ok?"✅":"❌"}</span>
      <span style="color:${ok?"#14532d":"#7f1d1d"}">${label}</span>
    </div>`).join("");
  }

  // ── Drawer helpers ──────────────────────────────────────────
  function openDrawer(title, bodyHtml, footerHtml = "") {
    closeDrawer();
    const bd = document.createElement("div");
    bd.id = "saBackdrop";
    bd.className = "sa-backdrop";
    bd.innerHTML = `
<div class="sa-drawer">
  <div class="sa-drawer-hd">
    <h2>${title}</h2>
    <button class="sa-drawer-close" id="drawerCloseX">&times;</button>
  </div>
  <div class="sa-drawer-body">${bodyHtml}</div>
  ${footerHtml ? `<div class="sa-drawer-ft">${footerHtml}</div>` : ""}
</div>`;
    bd.addEventListener("click", e => { if (e.target === bd) closeDrawer(); });
    document.getElementById("platform-superadmin")?.appendChild(bd);
    document.getElementById("drawerCloseX")?.addEventListener("click", closeDrawer);
  }
  function closeDrawer() { document.getElementById("saBackdrop")?.remove(); }

  // ── Utils ───────────────────────────────────────────────────
  function content()  { return document.getElementById("saContent"); }
  function loader()   { return `<div class="sa-loader">Laden…</div>`; }
  function err(e)     { return `<div class="sa-error">❌ ${esc(e.message)}</div>`; }
  function topAction(html) { const el = document.getElementById("saTopActions"); if (el) el.innerHTML = html; }
  function badge_update(id, n) {
    const el = document.getElementById(id);
    if (el) { el.textContent = n; el.style.display = n > 0 ? "" : "none"; }
  }
  function fmtUptime(s) {
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
    return h > 0 ? `${h}u ${m}m` : `${m}m`;
  }

  // ── Init ─────────────────────────────────────────────────────
  window.wfp_superadminInit = buildShell;
}());
