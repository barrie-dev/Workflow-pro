/* ============================================================
   Monargo One – Super Admin Platform  (volledig)
   Views: Dashboard · Tenants · Gebruikers · Facturatie ·
          Systeem · Audit · Instellingen
   ============================================================ */
(function () {
  "use strict";

  // ── State ──────────────────────────────────────────────────
  let _view  = "dashboard";
  let _cache = { tenants: [], users: [] };
  let _platform = null; // { scopes, isGod, allScopes } · platform-rechten van de ingelogde super_admin

  // ── Helpers ────────────────────────────────────────────────
  const token  = () => window.wfpCore.token();
  const esc    = v => window.wfpCore.esc(v);
  // i18n-helper voor de superadmin-shell (t()-gebaseerd, dynamisch opgebouwd).
  const tS = (key, fallback) => window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback;
  let _saLangHandler = null;
  function saViewTitle(v) {
    const map = {
      dashboard:["sa.dashboard","Dashboard"], tenants:["sa.tenants","Tenants"],
      billing:["sa.billing","Facturatie / MRR"], modules:["sa.modules","Modules & Bundels"], integrations:["sa.integrations","Integraties"], system:["sa.system","Systeem"], ops:["sa.ops","Operations"], security:["sa.securityGov","Beveiliging & governance"], support:["sa.support","Support"],
      staff:["sa.staff","Platformteam"], resellers:["sa.resellers","Resellers"], audit:["sa.audit","Audit Log"], communication:["sa.communication","Communicatie"], settings:["sa.settings","Instellingen"]
    };
    const e = map[v]; return e ? tS(e[0], e[1]) : v;
  }
  const fmtD   = iso => iso ? new Date(iso).toLocaleDateString("nl-BE") : "-";
  const fmtDT  = iso => iso ? new Date(iso).toLocaleString("nl-BE",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "-";
  const fmtEur = n  => new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(Number(n||0));

  // Dunne wrapper rond de gedeelde fetch-engine (core.js). Superadmin-paden zijn
  // al volledige /api-paden (geen tenant-prefix).
  function api(path, opts = {}) { return window.wfpCore.request(path, opts); }

  const planColor  = { starter:"badge-blue", business:"badge-green", enterprise:"badge-purple" };
  const statusColor= { active:"badge-green", trial:"badge-yellow", suspended:"badge-red", churned:"badge-gray" };
  const roleColor  = { super_admin:"badge-purple", tenant_admin:"badge-blue", manager:"badge-teal", employee:"badge-gray" };
  const badge = (text, color) => `<span class="sa-badge ${color||"badge-gray"}">${esc(text)}</span>`;

  // ── CSS ────────────────────────────────────────────────────
  const CSS = `
<style>
#platform-superadmin{font-family:'Inter',system-ui,-apple-system,sans-serif;height:100vh;overflow:hidden}
/* box-sizing globally; margin/padding reset only on text elements so class-based spacing is preserved.
   A blanket star-selector margin/padding reset here has ID-specificity and would clobber every .sa- padding. */
#platform-superadmin *{box-sizing:border-box}
#platform-superadmin h1,#platform-superadmin h2,#platform-superadmin h3,#platform-superadmin h4,#platform-superadmin p,#platform-superadmin figure,#platform-superadmin ul,#platform-superadmin ol{margin:0;padding:0}
#platform-superadmin ul,#platform-superadmin ol{list-style:none}
#platform-superadmin button{margin:0}

/* Layout */
.sa-layout{display:flex;height:100vh;background:var(--bg)}
.sa-sidebar{width:248px;min-width:248px;background:linear-gradient(180deg,#091525 0%,#0b1320 62%,#101d30 100%);border-right:none;display:flex;flex-direction:column;overflow-y:auto;flex-shrink:0;transition:transform .2s}
.sa-main{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
.sa-topbar{height:56px;background:rgba(255,255,255,.8);backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 20px;gap:12px;flex-shrink:0}
.sa-topbar-title{font-size:15px;font-weight:600;color:var(--ink);flex:1}
.sa-topbar-actions{display:flex;gap:8px}
.sa-content{flex:1;overflow-y:auto;padding:22px 24px}

/* Sidebar brand */
.sa-brand{display:flex;align-items:center;gap:12px;padding:18px 16px 16px;border-bottom:1px solid rgba(255,255,255,.10)}
.sa-brand-mark{width:38px;height:38px;background:var(--wf-blue);border-radius:11px;display:grid;place-items:center;font-weight:600;font-size:13px;color:#fff;flex-shrink:0;box-shadow:0 4px 12px rgba(0,113,227,.30)}
.sa-brand-name{font-size:14px;font-weight:600;color:#fff;line-height:1.2}
.sa-brand-sub{font-size:11px;color:rgba(255,255,255,.52);font-weight:600;letter-spacing:.3px}

/* Nav */
.sa-nav{padding:10px 8px;flex:1}
.sa-nav-section{font-size:10px;font-weight:700;color:rgba(255,255,255,.35);letter-spacing:.8px;padding:12px 12px 4px;text-transform:uppercase}
.sa-nav-item{display:flex;align-items:center;gap:10px;width:100%;padding:8.5px 12px;border:none;background:none;border-radius:9px;color:rgba(255,255,255,.70);font-size:13px;font-weight:500;cursor:pointer;text-align:left;transition:all .12s;position:relative;white-space:nowrap}
.sa-nav-item svg{width:17px;height:17px;flex-shrink:0;fill:currentColor;opacity:.7}
.sa-nav-item:hover{background:rgba(255,255,255,.07);color:#fff}
.sa-nav-item.active{background:linear-gradient(135deg,#0b7bf1,#0067d4);color:#fff;font-weight:600;box-shadow:0 8px 22px rgba(0,113,227,.28),inset 0 1px 0 rgba(255,255,255,.18)}
.sa-nav-item.active svg{opacity:1;color:#fff}
.sa-nav-item .nav-badge{margin-left:auto;background:var(--wf-red);color:#fff;border-radius:99px;font-size:10px;padding:1px 5px;font-weight:700;min-width:18px;text-align:center}
.sa-nav-divider{height:1px;background:rgba(255,255,255,.09);margin:6px 10px}

/* Sidebar footer */
.sa-sidebar-footer{padding:12px;border-top:1px solid rgba(255,255,255,.10)}
.sa-user-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.sa-user-av{width:32px;height:32px;background:var(--wf-blue);border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:600;color:#fff;flex-shrink:0}
.sa-user-nm{font-size:12px;font-weight:600;color:#fff;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sa-user-rl{font-size:10px;color:rgba(255,255,255,.48);font-weight:600;text-transform:uppercase}
.sa-btn-logout{width:100%;padding:7px;border:1px solid rgba(255,255,255,.11);background:transparent;color:rgba(255,255,255,.58);border-radius:8px;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .12s}
.sa-btn-logout:hover{background:var(--wf-red-l);border-color:var(--wf-red-l);color:var(--wf-red)}
.sa-btn-logout svg{width:14px;height:14px;fill:currentColor}

/* Page header */
.sa-page-head{display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap}
.sa-page-head h1{font-size:24px;font-weight:600;color:var(--ink);letter-spacing:-.5px}
.sa-page-head .cnt{background:var(--wf-blue-l);color:var(--wf-blue-d);border-radius:99px;font-size:12px;padding:2px 9px;font-weight:600;vertical-align:middle;margin-left:6px}
.sa-spacer{flex:1}
.sa-hero{display:flex;align-items:center;gap:22px;padding:23px 25px;border-radius:20px;margin-bottom:18px;color:#fff;background:linear-gradient(125deg,#091525 0%,#102c51 68%,#0874dd 150%);box-shadow:0 18px 42px rgba(9,28,51,.15);position:relative;overflow:hidden}
.sa-hero:after{content:"";position:absolute;width:220px;height:220px;border-radius:50%;right:-75px;top:-125px;background:rgba(88,178,255,.18)}
.sa-hero-copy{position:relative;z-index:1;flex:1}.sa-hero-kicker{font-size:10px;font-weight:750;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,.52);margin-bottom:6px}.sa-hero h1{font-size:24px;line-height:1.15;letter-spacing:-.55px;margin:0 0 5px}.sa-hero p{font-size:12.5px;line-height:1.5;color:rgba(255,255,255,.64);margin:0}
.sa-hero-actions{position:relative;z-index:1;display:grid;grid-template-columns:1fr 1fr;gap:8px;min-width:280px}.sa-hero-action{border:1px solid rgba(255,255,255,.11);background:rgba(255,255,255,.08);color:rgba(255,255,255,.82);border-radius:10px;padding:9px 11px;font-size:11.5px;font-weight:650;cursor:pointer;text-align:left;transition:background .14s,transform .14s}.sa-hero-action:hover{background:rgba(255,255,255,.14);color:#fff;transform:translateY(-1px)}

/* KPI cards */
.sa-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:13px;margin-bottom:22px}
.sa-kpi{background:var(--surface);border-radius:16px;padding:18px;border:1px solid var(--line);position:relative;overflow:hidden;cursor:default}
.sa-kpi::after{content:none}
.sa-kpi-label{font-size:11.5px;color:var(--muted);font-weight:500;margin-bottom:5px}
.sa-kpi-value{font-size:27px;font-weight:600;color:var(--ink);line-height:1.1;letter-spacing:-.5px}
.sa-kpi-sub{font-size:11px;color:var(--gray-400);margin-top:3px}
.kpi-indigo{--kpi-color:var(--wf-blue)}
.kpi-blue{--kpi-color:var(--wf-blue)}
.kpi-green{--kpi-color:var(--wf-green)}
.kpi-purple{--kpi-color:var(--wf-purple)}
.kpi-orange{--kpi-color:var(--wf-yellow)}
.kpi-red{--kpi-color:var(--wf-red)}
.kpi-teal{--kpi-color:var(--wf-green)}

/* Cards */
.sa-card{background:#fff;border-radius:var(--radius-card);border:1px solid var(--line);overflow:hidden;margin-bottom:18px;box-shadow:var(--shadow-card)}
.sa-card-head{padding:13px 18px;border-bottom:1px solid var(--gray-100);display:flex;align-items:center;gap:8px}
.sa-card-title{font-size:13.5px;font-weight:600;color:var(--gray-900);flex:1}
.sa-card-sub{font-size:11px;color:var(--gray-400)}

/* Grid */
.sa-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.sa-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px}

/* Tables */
.sa-tbl-wrap{overflow-x:auto}
.sa-tbl{width:100%;border-collapse:collapse;font-size:13px}
.sa-tbl th{padding:10px 14px;text-align:left;font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;background:var(--surface-subtle);border-bottom:1px solid var(--line);white-space:nowrap}
.sa-tbl td{padding:11px 14px;border-bottom:1px solid var(--gray-50);color:var(--gray-700);vertical-align:middle}
.sa-tbl tr:last-child td{border-bottom:none}
.sa-tbl tr:hover td{background:var(--gray-50)}
.sa-tbl .main{font-weight:600;color:var(--gray-900)}
.sa-tbl .sub{font-size:11px;color:var(--gray-400);margin-top:2px}
.sa-tbl .mono{font-family:monospace;font-size:11px}

/* Badges */
.sa-badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;white-space:nowrap}
.badge-green{background:var(--wf-green-l);color:var(--wf-green)}
.badge-blue{background:var(--wf-blue-l);color:var(--wf-blue)}
.badge-purple{background:var(--wf-purple-l);color:var(--wf-purple)}
.badge-teal{background:var(--wf-green-l);color:var(--wf-green)}
.badge-yellow{background:var(--wf-yellow-l);color:var(--wf-yellow)}
.badge-orange{background:var(--wf-orange-l);color:var(--wf-orange)}
.badge-red{background:var(--wf-red-l);color:var(--wf-red)}
.badge-gray{background:var(--gray-100);color:var(--gray-600)}
.badge-dark{background:var(--gray-800);color:var(--gray-200)}

/* Buttons */
.sa-btn{padding:8px 15px;border-radius:10px;font-size:12.5px;font-weight:600;cursor:pointer;border:1px solid transparent;display:inline-flex;align-items:center;gap:6px;transition:all .14s;white-space:nowrap}
.sa-btn svg{width:14px;height:14px;fill:currentColor}
.btn-primary{background:var(--wf-blue);color:#fff;border-color:var(--wf-blue)}
.btn-primary:hover{background:var(--blue-hover);border-color:var(--blue-hover)}
.btn-primary:active{background:var(--blue-active);border-color:var(--blue-active)}
.btn-secondary{background:#fff;color:var(--ink);border-color:var(--line-strong)}
.btn-secondary:hover{background:var(--bg);border-color:#bfc7d3}
.btn-danger{background:#fff;color:var(--wf-red);border-color:var(--wf-red-l)}
.btn-danger:hover{background:var(--wf-red-l)}
.btn-success{background:#fff;color:var(--wf-green);border-color:var(--wf-green-l)}
.btn-success:hover{background:var(--wf-green-l)}
.btn-ghost{background:transparent;color:var(--gray-500);border-color:transparent}
.btn-ghost:hover{background:var(--gray-100);color:var(--gray-700)}
.sa-btn.sm{padding:4px 9px;font-size:11.5px;border-radius:6px}
.sa-actions{display:flex;gap:5px;flex-wrap:wrap}

/* Filters */
.sa-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center}
.sa-filters input,.sa-filters select{padding:6.5px 11px;border:1px solid var(--gray-200);border-radius:8px;font-size:12.5px;color:var(--gray-700);background:#fff}
.sa-filters input:focus,.sa-filters select:focus{outline:none;border-color:var(--wf-blue);box-shadow:var(--ring)}

/* Empty / loader / error */
.sa-empty{padding:36px;text-align:center;color:var(--gray-400);font-size:13px}
.sa-empty-icon{font-size:30px;margin-bottom:8px}
.sa-loader{padding:36px;text-align:center;color:var(--gray-400);font-size:13px}
.sa-error{margin:16px 0;padding:14px 16px;background:var(--wf-red-l);border:1px solid var(--wf-red-l);border-radius:8px;color:var(--wf-red);font-size:13px}

/* Drawer / modal */
.sa-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:300;display:flex;align-items:stretch;justify-content:flex-end}
.sa-drawer{width:480px;max-width:100%;background:#fff;overflow-y:auto;padding:0;box-shadow:-4px 0 32px rgba(0,0,0,.15);display:flex;flex-direction:column}
.sa-drawer-hd{padding:20px 24px 16px;border-bottom:1px solid var(--gray-100);display:flex;align-items:center;gap:10px}
.sa-drawer-hd h2{font-size:16px;font-weight:600;color:var(--gray-900);flex:1}
.sa-drawer-close{background:none;border:none;cursor:pointer;color:var(--gray-400);padding:4px;border-radius:6px;font-size:18px}
.sa-drawer-close:hover{color:var(--gray-700);background:var(--gray-100)}
.sa-drawer-body{padding:20px 24px;flex:1;display:flex;flex-direction:column;gap:16px}
.sa-drawer-ft{padding:14px 24px;border-top:1px solid var(--gray-100);display:flex;gap:8px}

/* Form fields */
.sa-field{display:flex;flex-direction:column;gap:5px}
.sa-field label{font-size:11.5px;font-weight:700;color:var(--gray-700);text-transform:uppercase;letter-spacing:.4px}
.sa-field input,.sa-field select,.sa-field textarea{padding:8px 11px;border:1px solid var(--line);border-radius:10px;font-size:13px;color:var(--gray-900);background-color:#fff;width:100%}
.sa-field select{padding-right:32px}
.sa-field input:focus,.sa-field select:focus,.sa-field textarea:focus{outline:none;border-color:var(--wf-blue);box-shadow:var(--ring)}
.sa-field .hint{font-size:11px;color:var(--gray-400)}
.sa-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}

/* Detail rows */
.sa-detail{background:var(--gray-50);border-radius:9px;padding:13px 15px;display:flex;flex-direction:column;gap:9px}
.sa-detail-row{display:flex;justify-content:space-between;align-items:center;font-size:12.5px}
.sa-detail-label{color:var(--gray-500)}
.sa-detail-value{font-weight:600;color:var(--gray-900);text-align:right;max-width:60%}

/* Stat cards in drawer */
.sa-stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.sa-stat-card{background:var(--gray-50);border-radius:8px;padding:10px;text-align:center}
.sa-stat-card .sv{font-size:20px;font-weight:700;color:var(--gray-900)}
.sa-stat-card .sl{font-size:11px;color:var(--gray-500);margin-top:2px}

/* Divider */
.sa-divider{height:1px;background:var(--gray-100)}

/* Inline alert */
.sa-alert{padding:10px 14px;border-radius:8px;font-size:12.5px;display:flex;align-items:flex-start;gap:8px}
.alert-info{background:var(--wf-blue-l);color:var(--wf-blue);border:1px solid var(--wf-blue-l)}
.alert-warn{background:var(--wf-yellow-l);color:var(--wf-yellow);border:1px solid var(--wf-yellow-l)}
.alert-success{background:var(--wf-green-l);color:var(--wf-green);border:1px solid var(--wf-green-l)}
.alert-error{background:var(--wf-red-l);color:var(--wf-red);border:1px solid var(--wf-red-l)}

/* Mobile */
.sa-menu-toggle{display:none;background:none;border:none;cursor:pointer;padding:4px;color:var(--gray-500)}
.sa-menu-toggle svg{width:20px;height:20px;fill:currentColor}
@media(max-width:820px){
  .sa-menu-toggle{display:flex}
  .sa-sidebar{position:fixed;left:0;top:0;height:100%;z-index:200;transform:translateX(-100%)}
  .sa-sidebar.open{transform:translateX(0)}
  .sa-grid2,.sa-grid3{grid-template-columns:1fr}
  .sa-form-grid{grid-template-columns:1fr}
  .sa-content{padding:17px 15px}
  .sa-hero{align-items:flex-start;flex-direction:column;padding:21px}
  .sa-hero-actions{min-width:0;width:100%}
  .sa-topbar{padding:0 14px}
  .sa-topbar-actions .sa-btn{padding:7px 10px}
}
@media(max-width:460px){.sa-hero-actions{grid-template-columns:1fr}.sa-kpis{grid-template-columns:1fr 1fr}.sa-kpi{padding:14px}.sa-kpi-value{font-size:23px}.sa-drawer-hd,.sa-drawer-body,.sa-drawer-ft{padding-left:17px;padding-right:17px}}
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
        <div class="sa-brand-name">Monargo One</div>
        <div class="sa-brand-sub">Super Admin</div>
      </div>
    </div>

    <nav class="sa-nav">
      <div class="sa-nav-section">${tS("sa.navManage","Beheer")}</div>
      <button class="sa-nav-item active" data-view="dashboard">
        <svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>${tS("sa.dashboard","Dashboard")}
      </button>
      <button class="sa-nav-item" data-view="tenants">
        <svg viewBox="0 0 24 24"><path d="M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z"/></svg>${tS("sa.tenants","Tenants")}
        <span class="nav-badge" id="navBadgeTenants" style="display:none">0</span>
      </button>

      <div class="sa-nav-divider"></div>
      <div class="sa-nav-section">${tS("sa.navFinance","Financieel")}</div>
      <button class="sa-nav-item" data-view="billing">
        <svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>${tS("sa.billing","Facturatie / MRR")}
      </button>
      <button class="sa-nav-item" data-view="modules">
        <svg viewBox="0 0 24 24"><path d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z"/></svg>${tS("sa.modules","Modules &amp; Bundels")}
      </button>

      <div class="sa-nav-divider"></div>
      <div class="sa-nav-section">${tS("sa.navSystem","Systeem")}</div>
      <button class="sa-nav-item" data-view="integrations">
        <svg viewBox="0 0 24 24"><path d="M22 7h-7V2H9v5H2v15h20V7zM11 4h2v3h-2V4zm9 16H4V9h16v11zM9 13h2v2H9v-2zm4 0h2v2h-2v-2z"/></svg>${tS("sa.integrations","Integraties")}
      </button>
      <button class="sa-nav-item" data-view="system">
        <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>${tS("sa.system","Systeem")}
        <span class="nav-badge" id="navBadgeErrors" style="display:none">0</span>
      </button>
      <button class="sa-nav-item" data-view="ops">
        <svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>${tS("sa.ops","Operations")}
        <span class="nav-badge" id="navBadgeOps" style="display:none">0</span>
      </button>
      <button class="sa-nav-item" data-view="security">
        <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>${tS("sa.security","Beveiliging")}
        <span class="nav-badge" id="navBadgeSecurity" style="display:none">0</span>
      </button>
      <button class="sa-nav-item" data-view="support">
        <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>${tS("sa.support","Support-toegang")}
        <span class="nav-badge" id="navBadgeSupport" style="display:none">0</span>
      </button>
      <button class="sa-nav-item" data-view="staff">
        <svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>${tS("sa.staff","Platformteam")}
      </button>
      <button class="sa-nav-item" data-view="resellers">
        <svg viewBox="0 0 24 24"><path d="M12 2l9 4v6c0 5-3.8 9.7-9 11-5.2-1.3-9-6-9-11V6l9-4zm0 2.2L5 7v5c0 3.9 2.9 7.6 7 8.9 4.1-1.3 7-5 7-8.9V7l-7-2.8zM11 8h2v3h3v2h-3v3h-2v-3H8v-2h3V8z"/></svg>${tS("sa.resellers","Resellers")}
      </button>
      <button class="sa-nav-item" data-view="audit">
        <svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6zm2-8h8v2H8zm0 4h5v2H8z"/></svg>${tS("sa.audit","Audit Log")}
      </button>
      <button class="sa-nav-item" data-view="communication">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12zM6 7h12v2H6zm0 4h8v2H6z"/></svg>${tS("sa.communication","Communicatie")}
      </button>
      <button class="sa-nav-item" data-view="settings">
        <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>${tS("sa.settings","Instellingen")}
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
        ${tS("rsp.logout","Uitloggen")}
      </button>
    </div>
    <div style="padding:8px 12px 12px;font-size:10.5px;color:rgba(255,255,255,.4);text-align:center">Powered by <strong style="color:rgba(255,255,255,.65)">Monargo</strong></div>
  </aside>

  <main class="sa-main">
    <header class="sa-topbar">
      <button class="sa-menu-toggle" id="saMenuToggle">
        <svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
      </button>
      <div class="sa-topbar-title" id="saTopTitle">${tS("sa.dashboard","Dashboard")}</div>
      <div class="sa-topbar-actions" id="saTopActions"></div>
      <button id="saLangToggle" title="NL / FR / EN" style="margin-left:8px;background:var(--surface);color:var(--ink);border:1px solid var(--line-strong,var(--gray-200));border-radius:9px;padding:7px 11px;font-size:12px;font-weight:600;cursor:pointer">NL</button>
    </header>
    <div class="sa-content" id="saContent"><div class="sa-loader">${tS("adm.loading","Laden…")}</div></div>
  </main>
</div>`;

    // Nav
    el.querySelectorAll(".sa-nav-item[data-view]").forEach(btn => {
      btn.addEventListener("click", () => {
        el.querySelectorAll(".sa-nav-item").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        _view = btn.dataset.view;
        document.getElementById("saTopTitle").textContent = saViewTitle(_view);
        document.getElementById("saTopActions").innerHTML = "";
        document.getElementById("saSidebar").classList.remove("open");
        renderView();
      });
    });

    document.getElementById("saMenuToggle")?.addEventListener("click", () => {
      document.getElementById("saSidebar").classList.toggle("open");
    });

    // NL/FR/EN taalwissel: knop toont de taal waarnaar je overschakelt.
    if (window.wfpI18n) {
      const paintLang = () => {
        const b = document.getElementById("saLangToggle");
        if (b) b.textContent = window.wfpI18n.nextLang(window.wfpI18n.lang).toUpperCase();
      };
      paintLang();
      document.getElementById("saLangToggle")?.addEventListener("click", () => window.wfpI18n.cycleLang());
      document.removeEventListener("wfp:langchange", _saLangHandler);
      _saLangHandler = () => buildShell();
      document.addEventListener("wfp:langchange", _saLangHandler);
    }

    document.getElementById("saLogout")?.addEventListener("click", () => {
      localStorage.removeItem("wfp_token");
      window.WorkFlowProPlatformRouter?.showLogin();
    });

    // Gedelegeerde handler (CSP blokkeert inline onclick in gerenderde HTML):
    // data-nav → navigeer naar view, data-action="refresh" → herlaad huidige view.
    document.getElementById("platform-superadmin").addEventListener("click", e => {
      const navEl = e.target.closest("[data-nav]");
      if (navEl) {
        const target = document.querySelector(`.sa-nav-item[data-view="${navEl.dataset.nav}"]`);
        if (target) target.click();
        return;
      }
      const actEl = e.target.closest("[data-action='refresh']");
      if (actEl) renderView();
    });

    applyPlatformScopes();
    renderView();
  }

  // Verberg nav-secties waartoe dit teamlid geen platform-scope heeft. De god
  // ziet alles; "Platformteam" is god-only; Dashboard is altijd zichtbaar.
  async function applyPlatformScopes() {
    try {
      const me = await fetch("/api/me", { headers: { Authorization: "Bearer " + token() } }).then(r => r.json());
      _platform = me.platform || { scopes: [], isGod: false, allScopes: [] };
      if (me.user) { const nm = document.getElementById("saUserNm"); if (nm) nm.textContent = me.user.name || "Super Admin"; }
      if (_platform.isGod) return; // god: volledige toegang
      const scopes = new Set(_platform.scopes || []);
      document.querySelectorAll(".sa-nav-item[data-view]").forEach(btn => {
        const v = btn.getAttribute("data-view");
        if (v === "dashboard") return;
        const reqScope = (v === "ops" || v === "security") ? "system" : (v === "communication" ? "settings" : v); // ops/security→system, communicatie→settings
        if (v === "staff" || !scopes.has(reqScope)) btn.style.display = "none";
      });
      if (_view !== "dashboard" && !scopes.has(_view)) { _view = "dashboard"; renderView(); }
    } catch (_) {}
  }

  // ── Operations: backups, webhook-/betaal-events, e-mail-log, readiness ──────
  async function ops() {
    const c = content(); c.innerHTML = loader();
    let rd = {}, ev = {}, ml = {}, bk = {};
    try {
      [rd, ev, ml, bk] = await Promise.all([
        api("/api/admin/readiness").catch(() => ({})),
        api("/api/admin/events").catch(() => ({})),
        api("/api/admin/mail-log").catch(() => ({})),
        api("/api/admin/backups").catch(() => ({})),
      ]);
    } catch (e) { c.innerHTML = `<div class="sa-card"><div class="sa-card-body">${esc(e.message)}</div></div>`; return; }
    const r = rd.readiness || { score: 0, blockers: 0, checks: [] };
    const evRows = ev.events || [];
    const mail = ml.mail || [];
    const bkRows = bk.rows || [];
    const evStatus = s => s === "failed" || s === "payment_failed" ? "badge-red" : (s === "processed" || s === "invoice_paid" || s === "active" ? "badge-green" : "badge-gray");
    c.innerHTML = `
<div class="sa-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px">
  <div class="sa-card"><div class="sa-card-body"><div style="font-size:12px;color:var(--gray-500)">Productie-readiness</div><div style="font-size:26px;font-weight:700;color:${r.score>=90?"var(--wf-green)":r.score>=60?"var(--wf-yellow)":"var(--wf-red)"}">${r.score}%</div><div style="font-size:12px;color:var(--gray-500)">${r.blockers} P0-blockers</div></div></div>
  <div class="sa-card"><div class="sa-card-body"><div style="font-size:12px;color:var(--gray-500)">Betaal-events (fout)</div><div style="font-size:26px;font-weight:700;color:${(ev.failed||0)?"var(--wf-red)":"var(--wf-green)"}">${ev.failed||0}</div><div style="font-size:12px;color:var(--gray-500)">${ev.total||0} totaal</div></div></div>
  <div class="sa-card"><div class="sa-card-body"><div style="font-size:12px;color:var(--gray-500)">Backups ontbreken/oud</div><div style="font-size:26px;font-weight:700;color:${(bk.missing||0)+(bk.stale||0)?"var(--wf-yellow)":"var(--wf-green)"}">${(bk.missing||0)+(bk.stale||0)}</div><div style="font-size:12px;color:var(--gray-500)">van ${bk.tenants||0} tenants</div></div></div>
  <div class="sa-card"><div class="sa-card-body"><div style="font-size:12px;color:var(--gray-500)">E-mail live</div><div style="font-size:26px;font-weight:700;color:${ml.live?"var(--wf-green)":"var(--wf-yellow)"}">${ml.live?"Ja":"Log"}</div><div style="font-size:12px;color:var(--gray-500)">${mail.filter(m=>!m.ok).length} recente fouten</div></div></div>
</div>

<div class="sa-card" style="margin-bottom:16px"><div class="sa-card-head"><div class="sa-card-title">Productie-readiness</div></div>
  <div class="sa-card-body" style="padding:12px 16px;display:flex;flex-direction:column;gap:5px">
    ${(r.checks||[]).map(ch => `<div style="display:flex;gap:8px;align-items:center;font-size:13px">
      <span style="font-weight:700;color:${ch.ok?"var(--wf-green)":ch.priority==="P0"?"var(--wf-red)":"var(--wf-yellow)"}">${ch.ok?"✓":"!"}</span>
      <strong style="min-width:200px">${esc(ch.label)}</strong>
      <span style="color:var(--gray-500)">${esc(ch.detail||"")}</span></div>`).join("") || "<div style='color:var(--gray-500)'>Geen checks.</div>"}
  </div></div>

<div class="sa-card" style="margin-bottom:16px"><div class="sa-card-head"><div class="sa-card-title">Backups per tenant</div></div>
  <div class="sa-tbl-wrap"><table class="sa-tbl"><thead><tr><th>Tenant</th><th>Aantal</th><th>Laatste</th><th>Status</th><th>Bewaarbeleid</th><th></th></tr></thead><tbody>
    ${bkRows.map(b => `<tr data-bk="${esc(b.tenantId)}"><td>${esc(b.tenant)}</td><td>${b.count}</td><td>${b.latestAt?fmtDT(b.latestAt):"-"}</td>
      <td>${badge(b.status==="ok"?"vers":b.status==="stale"?`${b.ageDays}d oud`:"ontbreekt", b.status==="ok"?"badge-green":b.status==="stale"?"badge-yellow":"badge-red")}</td>
      <td><button class="sa-btn btn-secondary sm bk-policy" data-id="${esc(b.tenantId)}" data-name="${esc(b.tenant)}">Beleid</button></td>
      <td><button class="sa-btn btn-secondary sm bk-make" data-id="${esc(b.tenantId)}">Backup maken</button></td></tr>`).join("") || "<tr><td colspan=6 style='color:var(--gray-500)'>Geen tenants.</td></tr>"}
  </tbody></table></div></div>

<div class="sa-card" style="margin-bottom:16px"><div class="sa-card-head"><div class="sa-card-title">Webhook-/betaal-events</div></div>
  <div class="sa-tbl-wrap"><table class="sa-tbl"><thead><tr><th>Tijd</th><th>Tenant</th><th>Type</th><th>Actie</th><th>Status</th></tr></thead><tbody>
    ${evRows.map(e => `<tr><td>${fmtDT(e.at)}</td><td>${esc(e.tenant)}</td><td style="font-family:monospace;font-size:12px">${esc(e.type)}</td><td>${esc(e.action||"-")}</td><td>${badge(e.status||"-", evStatus(e.status||e.action))}</td></tr>`).join("") || "<tr><td colspan=5 style='color:var(--gray-500)'>Nog geen events.</td></tr>"}
  </tbody></table></div></div>

<div class="sa-card"><div class="sa-card-head"><div class="sa-card-title">E-mail-log (recent)</div></div>
  <div class="sa-tbl-wrap"><table class="sa-tbl"><thead><tr><th>Tijd</th><th>Aan</th><th>Onderwerp</th><th>Provider</th><th>Status</th></tr></thead><tbody>
    ${mail.map(m => `<tr><td>${fmtDT(m.at)}</td><td>${esc(m.to)}</td><td>${esc(m.subject)}</td><td>${esc(m.provider)}</td><td>${badge(m.ok?"ok":"fout", m.ok?"badge-green":"badge-red")}</td></tr>`).join("") || "<tr><td colspan=5 style='color:var(--gray-500)'>Nog geen verzendingen op deze server-instance.</td></tr>"}
  </tbody></table></div></div>`;
    c.querySelectorAll(".bk-make").forEach(btn => btn.addEventListener("click", async () => {
      btn.disabled = true; btn.textContent = "Bezig…";
      try { await api(`/api/admin/backups/${btn.dataset.id}`, { method: "POST" }); window.showToast && window.showToast("Backup gemaakt", "success"); ops(); }
      catch (e) { window.showToast && window.showToast(e.message, "error"); btn.disabled = false; btn.textContent = "Backup maken"; }
    }));
    c.querySelectorAll(".bk-policy").forEach(btn => btn.addEventListener("click", () => openBackupPolicy(btn.dataset.id, btn.dataset.name)));
  }

  // Superadmin: backup-bewaarbeleid PER TENANT instellen (frequentie, retentie…).
  async function openBackupPolicy(tenantId, tenantName) {
    let d;
    try { d = await api(`/api/admin/backups/${tenantId}/policy`); }
    catch (e) { window.showToast && window.showToast(e.message, "error"); return; }
    const p = d.policy || {};
    const presets = d.presets || [30, 90, 180, 365, 730, 2555];
    const yrs = days => days < 365 ? `${days} dagen` : (days % 365 === 0 ? `${days / 365} jaar` : `${Math.round(days / 365 * 10) / 10} jaar`);
    const opts = presets.map(v => `<option value="${v}" ${p.retentionDays === v ? "selected" : ""}>${yrs(v)}</option>`).join("")
      + (presets.includes(p.retentionDays) ? "" : `<option value="${esc(p.retentionDays)}" selected>${yrs(p.retentionDays)}</option>`);
    const c = d.counts || { total: 0, toKeep: 0, toPrune: 0 };
    openDrawer(`Bewaarbeleid · ${esc(tenantName || tenantId)}`, `
  <div style="font-size:12px;color:var(--gray-500);margin-bottom:4px">${c.total} backup(s) · ${c.toKeep} behouden${c.toPrune ? ` · <span style="color:var(--wf-yellow)">${c.toPrune} buiten termijn</span>` : ""}</div>
  <div class="sa-field"><label>Bewaartermijn backups</label>
    <select id="bpRetention">${opts}</select></div>
  <div class="sa-field"><label>Frequentie</label>
    <select id="bpFreq">
      <option value="daily" ${p.frequency === "daily" ? "selected" : ""}>Dagelijks</option>
      <option value="weekly" ${p.frequency === "weekly" ? "selected" : ""}>Wekelijks</option>
    </select></div>
  <div class="sa-field"><label>Minimaal te behouden (nieuwste backups blijven altijd)</label>
    <input id="bpKeepMin" type="number" min="1" max="${esc(d.limits?.maxKeepMinimum || 30)}" value="${esc(p.keepMinimum)}"></div>
  <label style="display:flex;align-items:center;gap:9px;font-size:13px;color:var(--gray-700);cursor:pointer">
    <input id="bpLegalHold" type="checkbox" ${p.legalHold ? "checked" : ""} style="width:16px;height:16px">
    <span><strong>Legal hold</strong> · opruiming volledig stilleggen (audit/geschil/GDPR-verzoek)</span></label>
  <div style="font-size:11.5px;color:var(--gray-400);line-height:1.5;border-top:1px solid var(--gray-100);padding-top:10px">
    GDPR art. 5(1)(e): backups buiten de termijn worden automatisch opgeruimd. DR-backups ≠ wettelijk archief (facturen 7j, sociale/arbeidstijd 5j rusten op de live-data).
    ${p.updatedAt ? `<div style="margin-top:6px">Laatst gewijzigd ${fmtDT(p.updatedAt)}${p.updatedBy ? ` door ${esc(p.updatedBy)}` : ""}</div>` : ""}
  </div>`,
      `<button class="sa-btn btn-primary" id="bpSave">Opslaan</button>
       <button class="sa-btn btn-secondary" id="closeDrawer">Annuleren</button>`);
    document.getElementById("closeDrawer")?.addEventListener("click", closeDrawer);
    document.getElementById("bpSave")?.addEventListener("click", async () => {
      const btn = document.getElementById("bpSave");
      btn.disabled = true; btn.textContent = "Opslaan…";
      try {
        await api(`/api/admin/backups/${tenantId}/policy`, { method: "PUT", body: JSON.stringify({
          retentionDays: parseInt(document.getElementById("bpRetention").value, 10),
          frequency: document.getElementById("bpFreq").value,
          keepMinimum: parseInt(document.getElementById("bpKeepMin").value, 10),
          legalHold: document.getElementById("bpLegalHold").checked,
        })});
        window.showToast && window.showToast("Bewaarbeleid opgeslagen", "success");
        closeDrawer(); ops();
      } catch (e) {
        window.showToast && window.showToast(e.message, "error");
        btn.disabled = false; btn.textContent = "Opslaan";
      }
    });
  }

  // ── Beveiliging & governance: MFA, vergrendelde accounts, GDPR/DPA, API-keys ─
  async function security() {
    const c = content(); c.innerHTML = loader();
    let sec = {}, gd = {}, kg = {};
    try {
      [sec, gd, kg] = await Promise.all([
        api("/api/admin/security").catch(() => ({})),
        api("/api/admin/gdpr-overview").catch(() => ({})),
        api("/api/admin/api-key-governance").catch(() => ({})),
      ]);
    } catch (e) { c.innerHTML = `<div class="sa-card"><div class="sa-card-body">${esc(e.message)}</div></div>`; return; }
    const s = sec.security || { mfa: { rows: [] }, locked: [], supportAccess: [] };
    const mfa = s.mfa || { rows: [] };
    const gdprRows = gd.rows || [];
    const gov = kg.governance || { rows: [], blockers: 0, warnings: 0, checked: 0 };
    c.innerHTML = `
<div class="sa-kpis" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px">
  <div class="sa-card"><div class="sa-card-body"><div style="font-size:12px;color:var(--gray-500)">Admins met MFA klaar</div><div style="font-size:26px;font-weight:700;color:${mfa.readyAdmins===mfa.totalAdmins?"var(--wf-green)":"var(--wf-yellow)"}">${mfa.readyAdmins||0}/${mfa.totalAdmins||0}</div><div style="font-size:12px;color:var(--gray-500)">${mfa.missingMfa||0} zonder MFA</div></div></div>
  <div class="sa-card"><div class="sa-card-body"><div style="font-size:12px;color:var(--gray-500)">Vergrendelde accounts</div><div style="font-size:26px;font-weight:700;color:${(s.locked||[]).length?"var(--wf-red)":"var(--wf-green)"}">${(s.locked||[]).length}</div><div style="font-size:12px;color:var(--gray-500)">na mislukte logins</div></div></div>
  <div class="sa-card"><div class="sa-card-body"><div style="font-size:12px;color:var(--gray-500)">DPA ontbreekt</div><div style="font-size:26px;font-weight:700;color:${(gd.dpaMissing||0)?"var(--wf-yellow)":"var(--wf-green)"}">${gd.dpaMissing||0}</div><div style="font-size:12px;color:var(--gray-500)">van ${gd.tenants||0} tenants</div></div></div>
  <div class="sa-card"><div class="sa-card-body"><div style="font-size:12px;color:var(--gray-500)">Open GDPR-verzoeken</div><div style="font-size:26px;font-weight:700;color:${(gd.openRequests||0)?"var(--wf-yellow)":"var(--wf-green)"}">${gd.openRequests||0}</div><div style="font-size:12px;color:var(--gray-500)">export/verwijdering</div></div></div>
  <div class="sa-card"><div class="sa-card-body"><div style="font-size:12px;color:var(--gray-500)">API-key-issues</div><div style="font-size:26px;font-weight:700;color:${gov.blockers?"var(--wf-red)":gov.warnings?"var(--wf-yellow)":"var(--wf-green)"}">${gov.blockers||0}/${gov.warnings||0}</div><div style="font-size:12px;color:var(--gray-500)">P0/P1 · ${gov.checked||0} keys</div></div></div>
</div>

<div class="sa-card" style="margin-bottom:16px"><div class="sa-card-head"><div class="sa-card-title">MFA-status admins</div></div>
  <div class="sa-tbl-wrap"><table class="sa-tbl"><thead><tr><th>Naam</th><th>E-mail</th><th>Rol</th><th>Status</th></tr></thead><tbody>
    ${(mfa.rows||[]).map(u => `<tr><td>${esc(u.name||"-")}</td><td>${esc(u.email)}</td><td>${esc(u.role)}</td><td>${u.ready?badge("klaar","badge-green"):badge(u.mfaEnabled?"niet afgedwongen":"geen MFA","badge-red")}</td></tr>`).join("") || "<tr><td colspan=4 style='color:var(--gray-500)'>Geen admins gevonden.</td></tr>"}
  </tbody></table></div></div>

${(s.locked||[]).length ? `<div class="sa-card" style="margin-bottom:16px"><div class="sa-card-head"><div class="sa-card-title">Vergrendelde accounts</div></div>
  <div class="sa-tbl-wrap"><table class="sa-tbl"><thead><tr><th>E-mail</th><th>Mislukte logins</th><th>Vergrendeld tot</th></tr></thead><tbody>
    ${s.locked.map(u => `<tr><td>${esc(u.email)}</td><td>${u.failedLogins}</td><td>${fmtDT(u.lockedUntil)}</td></tr>`).join("")}
  </tbody></table></div></div>` : ""}

<div class="sa-card" style="margin-bottom:16px"><div class="sa-card-head"><div class="sa-card-title">GDPR / DPA per tenant</div></div>
  <div class="sa-tbl-wrap"><table class="sa-tbl"><thead><tr><th>Tenant</th><th>DPA</th><th>Open verzoeken</th><th>Totaal</th><th>Support-toegang</th></tr></thead><tbody>
    ${gdprRows.map(r => `<tr><td>${esc(r.tenant)}</td><td>${r.dpaAccepted?badge("aanvaard","badge-green"):badge("ontbreekt","badge-red")}</td><td>${r.openRequests||0}</td><td>${r.totalRequests||0}</td><td>${r.supportAccess?badge("aan","badge-yellow"):"-"}</td></tr>`).join("") || "<tr><td colspan=5 style='color:var(--gray-500)'>Geen tenants.</td></tr>"}
  </tbody></table></div></div>

<div class="sa-card"><div class="sa-card-head"><div class="sa-card-title">API-key-governance</div></div>
  <div class="sa-card-body" style="padding:12px 16px">
    ${(gov.openP0||[]).concat(gov.openP1||[]).length ? (gov.openP0||[]).concat(gov.openP1||[]).map(i => `<div style="display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:4px"><span style="font-weight:700;color:${i.priority==="P0"?"var(--wf-red)":"var(--wf-yellow)"}">!</span><strong>${esc((i.key&&i.key.label)||(i.key&&i.key.id)||"key")}</strong><span style="color:var(--gray-500)">${esc(i.detail||i.code||"")}</span></div>`).join("") : "<div style='color:var(--wf-green);font-size:13px'>Geen openstaande API-key-issues.</div>"}
  </div></div>`;
  }

  // ── Communicatie: platform-aankondiging/onderhoudsbanner + releases ────────
  async function communication() {
    const c = content(); c.innerHTML = loader();
    let ann = { active: false, level: "info", message: "" }, rel = {};
    try {
      const [a, r] = await Promise.all([
        api("/api/admin/announcement").catch(() => ({})),
        fetch("/api/releases").then(x => x.json()).catch(() => ({})),
      ]);
      ann = a.announcement || ann;
      rel = (r && r.release) || {};
    } catch (_) {}
    const lvl = (v, label) => `<option value="${v}" ${ann.level === v ? "selected" : ""}>${label}</option>`;
    const notes = rel.notes || rel.changelog || [];
    c.innerHTML = `
<div class="sa-card" style="margin-bottom:16px"><div class="sa-card-head"><div class="sa-card-title">Platform-aankondiging / onderhoudsbanner</div></div>
  <div class="sa-card-body" style="padding:16px;max-width:640px">
    <div style="font-size:12.5px;color:var(--gray-500);margin-bottom:12px">Wordt bovenaan elke gebruiker-shell getoond zolang ze actief staat. Gebruik 'onderhoud' om een geplande downtime aan te kondigen.</div>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:14px;font-weight:600">
      <input type="checkbox" id="annActive" ${ann.active ? "checked" : ""}> Banner actief
    </label>
    <label style="display:block;font-size:12.5px;font-weight:600;margin-bottom:4px">Niveau</label>
    <select id="annLevel" style="margin-bottom:12px;width:200px">
      ${lvl("info", "Info (blauw)")}${lvl("warning", "Waarschuwing (oranje)")}${lvl("maintenance", "Onderhoud (rood)")}
    </select>
    <label style="display:block;font-size:12.5px;font-weight:600;margin-bottom:4px">Bericht</label>
    <textarea id="annMessage" rows="3" maxlength="500" style="width:100%;margin-bottom:12px" placeholder="Bv. Gepland onderhoud zondag 02:00–04:00. Excuses voor het ongemak.">${esc(ann.message || "")}</textarea>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="sa-btn btn-primary sm" id="annSave">Opslaan</button>
      <span id="annMsg" style="font-size:12.5px;color:var(--wf-green)"></span>
    </div>
  </div></div>

<div class="sa-card"><div class="sa-card-head"><div class="sa-card-title">Releases &amp; roadmap</div>${rel.version ? badge("v" + esc(rel.version), "badge-blue") : ""}</div>
  <div class="sa-card-body" style="padding:16px">
    ${notes.length ? notes.map(n => `<div style="margin-bottom:12px">
        <div style="font-weight:600;font-size:13.5px">${esc(n.version || n.title || "")} ${n.date ? `<span style="font-weight:400;color:var(--gray-500);font-size:12px">- ${esc(n.date)}</span>` : ""}</div>
        ${Array.isArray(n.items || n.changes) ? `<ul style="margin:4px 0 0 18px;font-size:13px;color:var(--gray-600)">${(n.items || n.changes).map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : (n.summary ? `<div style="font-size:13px;color:var(--gray-600)">${esc(n.summary)}</div>` : "")}
      </div>`).join("") : "<div style='font-size:13px;color:var(--gray-500)'>Geen release-notes beschikbaar.</div>"}
  </div></div>`;
    document.getElementById("annSave").addEventListener("click", async () => {
      const payload = { announcement: {
        active: document.getElementById("annActive").checked,
        level: document.getElementById("annLevel").value,
        message: document.getElementById("annMessage").value.trim(),
      } };
      const msg = document.getElementById("annMsg"); msg.textContent = "";
      try { await api("/api/admin/announcement", { method: "PUT", body: JSON.stringify(payload) }); msg.textContent = "Opgeslagen · banner wordt direct toegepast."; }
      catch (e) { msg.style.color = "var(--wf-red)"; msg.textContent = e.message; }
    });
  }

  // ── Router ─────────────────────────────────────────────────
  const VIEWS = { dashboard, tenants, billing, modules, integrations, system, ops, security, support, staff, resellers, audit, communication, settings };
  function renderView() { (VIEWS[_view] || dashboard)(); }

  // ══════════════════════════════════════════════════════════
  // VIEW: Dashboard
  // ══════════════════════════════════════════════════════════
  async function dashboard() {
    const c = content(); c.innerHTML = loader();
    try {
      const [st, sup] = await Promise.all([
        api("/api/admin/stats"),
        api("/api/admin/support").catch(()=>({rows:[]}))
      ]);
      const supRows = sup.rows||[];
      const activeSessions = supRows.filter(r=>r.session);
      badge_update("navBadgeTenants", st.tenants?.total);
      badge_update("navBadgeErrors",  st.errors24h);
      badge_update("navBadgeSupport", activeSessions.length);

      c.innerHTML = `
<section class="sa-hero">
  <div class="sa-hero-copy">
    <div class="sa-hero-kicker">Platform command center</div>
    <h1>Alles onder controle</h1>
    <p>Start bij klanten, omzet, support of systeemgezondheid en handel direct vanuit dezelfde omgeving.</p>
  </div>
  <div class="sa-hero-actions">
    <button class="sa-hero-action" data-nav="tenants">Tenants beheren →</button>
    <button class="sa-hero-action" data-nav="billing">MRR bekijken →</button>
    <button class="sa-hero-action" data-nav="support">Support openen →</button>
    <button class="sa-hero-action" data-nav="system">Systeemstatus →</button>
  </div>
</section>
<div class="sa-kpis">
  <div class="sa-kpi kpi-indigo">
    <div class="sa-kpi-label">${tS("sa.tenantsTotal","Tenants totaal")}</div>
    <div class="sa-kpi-value">${st.tenants?.total||0}</div>
    <div class="sa-kpi-sub">${st.tenants?.active||0} ${tS("adm.active","actief").toLowerCase()} · ${st.tenants?.trial||0} trial</div>
  </div>
  <div class="sa-kpi kpi-green">
    <div class="sa-kpi-label">${tS("sa.mrrEst","MRR (schatting)")}</div>
    <div class="sa-kpi-value">${fmtEur(st.mrr)}</div>
    <div class="sa-kpi-sub">ARR ${fmtEur(st.arr)}</div>
  </div>
  <div class="sa-kpi kpi-blue">
    <div class="sa-kpi-label">${tS("sa.usersTotal","Gebruikers totaal")}</div>
    <div class="sa-kpi-value">${st.users?.total||0}</div>
    <div class="sa-kpi-sub">${st.users?.active||0} ${tS("adm.active","actief").toLowerCase()}</div>
  </div>
  <div class="sa-kpi kpi-orange">
    <div class="sa-kpi-label">${tS("sa.supportSessionsActive","Support-sessies actief")}</div>
    <div class="sa-kpi-value">${activeSessions.length}</div>
    <div class="sa-kpi-sub">${tS("sa.tenantsConsented","{n} tenants gaven toestemming").replace("{n}", supRows.filter(r=>r.allowed).length)}</div>
  </div>
  <div class="sa-kpi ${(st.errors24h||0)>0?"kpi-red":"kpi-teal"}">
    <div class="sa-kpi-label">${tS("sa.errors24h","Errors (24h)")}</div>
    <div class="sa-kpi-value">${st.errors24h||0}</div>
    <div class="sa-kpi-sub">${(st.errors24h||0)===0?tS("sa.systemHealthy","Systeem gezond"):tS("sa.checkSystem","Controleer Systeem")}</div>
  </div>
  <div class="sa-kpi kpi-purple">
    <div class="sa-kpi-label">${tS("sa.serverUptime","Server uptime")}</div>
    <div class="sa-kpi-value">${fmtUptime(st.uptime||0)}</div>
    <div class="sa-kpi-sub">${st.releaseChannel||"dev"} · ${(st.commitSha||"local").slice(0,7)}</div>
  </div>
</div>

<div class="sa-grid2">
  <div class="sa-card">
    <div class="sa-card-head">
      <div class="sa-card-title">${tS("sa.recentTenants","Recente tenants")}</div>
      <button class="sa-btn btn-ghost sm" data-nav="tenants">${tS("sa.allArrow","Alle →")}</button>
    </div>
    <div id="dashTenantList"><div class="sa-loader">…</div></div>
  </div>
  <div class="sa-card">
    <div class="sa-card-head">
      <div class="sa-card-title">${tS("sa.activeSupportSessions","Actieve support-sessies")}</div>
      <button class="sa-btn btn-ghost sm" data-nav="support">${tS("sa.allArrow","Alle →")}</button>
    </div>
    ${activeSessions.length ? activeSessions.slice(0,5).map(r=>`
    <div style="padding:10px 16px;border-bottom:1px solid var(--gray-50);display:flex;align-items:center;gap:10px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--gray-900);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.tenantName||r.tenantId||"-")}</div>
        <div style="font-size:11px;color:var(--gray-400)">${esc(r.session.agent||"agent")} · ${tS("sa.expires","verloopt")} ${fmtD(r.session.expiresAt)}</div>
      </div>
      ${badge(r.session.scope==="read"?tS("mgr.scopeRead","alleen-lezen"):tS("sa.readWrite","lezen+schrijven"), r.session.scope==="read"?"badge-gray":"badge-red")}
    </div>`).join("") : `<div class="sa-empty">${tS("sa.noActiveSupport","Geen actieve support-sessies")}</div>`}
  </div>
</div>`;

      // Laad tenants apart
      try {
        const td = await api("/api/admin/tenants");
        _cache.tenants = td.tenants||[];
        const el = document.getElementById("dashTenantList");
        if (el) el.innerHTML = _cache.tenants.length ? `
        <div class="sa-tbl-wrap"><table class="sa-tbl">
          <thead><tr><th>${tS("adm.cust.thName","Naam")}</th><th>${tS("sa.plan","Plan")}</th><th>${tS("adm.status","Status")}</th><th>${tS("sa.users","Gebruikers")}</th></tr></thead>
          <tbody>${_cache.tenants.slice(0,6).map(t=>`<tr>
            <td><div class="main">${esc(t.name)}</div><div class="sub">${esc(t.id)}</div></td>
            <td>${badge(t.plan, planColor[t.plan])}</td>
            <td>${badge(t.status, statusColor[t.status])}</td>
            <td>${t.counts?.users||0}</td>
          </tr>`).join("")}</tbody>
        </table></div>` : `<div class="sa-empty">${tS("sa.noTenants","Geen tenants")} · <button class="sa-btn btn-primary sm" style="margin-top:8px" data-nav="tenants">+ ${tS("adm.createBtn","Aanmaken")}</button></div>`;
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
      topAction(`<button class="sa-btn btn-primary" id="saNewTenant">+ ${tS("sa.newTenant","Nieuwe tenant")}</button>`);
      c.innerHTML = `
<div class="sa-page-head">
  <h1>${tS("sa.tenants","Tenants")}<span class="cnt">${_cache.tenants.length}</span></h1><div class="sa-spacer"></div>
</div>
<div class="sa-filters">
  <input id="tfSearch" placeholder="${tS("sa.searchTenantPh","Zoek naam, e-mail, ID…")}" style="flex:1;min-width:180px">
  <select id="tfPlan"><option value="">${tS("sa.allPlans","Alle plannen")}</option><option>starter</option><option>business</option><option>enterprise</option></select>
  <select id="tfStatus"><option value="">${tS("adm.allStatuses","Alle statussen")}</option><option>trial</option><option>active</option><option>suspended</option></select>
</div>
<div class="sa-card">
  <div class="sa-tbl-wrap">
    <table class="sa-tbl">
      <thead><tr><th>${tS("sa.tenant","Tenant")}</th><th>${tS("sa.plan","Plan")}</th><th>${tS("adm.status","Status")}</th><th>${tS("sa.users","Gebruikers")}</th><th>${(window.wfpTerms && window.wfpTerms.t("jobPlural")) || tS("nav.workorders","Werkbonnen")}</th><th>${tS("sa.created","Aangemaakt")}</th><th>${tS("adm.actions","Acties")}</th></tr></thead>
      <tbody id="tenantTbody"></tbody>
    </table>
    <div id="tenantEmpty" class="sa-empty" style="display:none">${tS("sa.noTenantsFound","Geen tenants gevonden")}</div>
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
    catch(e) { window.showToast(e.message, "error"); }
  }
  async function doActivate(id) {
    try { await api(`/api/admin/tenants/${id}/activate`,{method:"POST"}); tenants(); }
    catch(e) { window.showToast(e.message, "error"); }
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
  <div class="sa-detail-row"><span class="sa-detail-label">Billing e-mail</span><span class="sa-detail-value">${esc(t.billingEmail||"-")}</span></div>
  <div class="sa-detail-row"><span class="sa-detail-label">Aangemaakt</span><span class="sa-detail-value">${fmtD(t.createdAt)}</span></div>
</div>

<div class="sa-stat-grid">
  <div class="sa-stat-card"><div class="sv">${t.counts?.users||0}</div><div class="sl">Gebruikers</div></div>
  <div class="sa-stat-card"><div class="sv">${t.counts?.workorders||0}</div><div class="sl">Werkbonnen</div></div>
  <div class="sa-stat-card"><div class="sv">${t.counts?.invoices||0}</div><div class="sl">Facturen</div></div>
</div>

<div class="sa-divider"></div>
<div style="font-size:13px;font-weight:600;color:var(--gray-700);margin-bottom:8px">Plan wijzigen</div>
<div style="display:flex;gap:8px;flex-wrap:wrap">
  ${["starter","business","enterprise"].map(p=>`<button class="sa-btn ${t.plan===p?"btn-primary":"btn-secondary"} sm" data-plan="${p}" id="planBtn_${p}">${p}</button>`).join("")}
</div>

<div class="sa-divider"></div>
<div style="font-size:13px;font-weight:600;color:var(--gray-700);margin-bottom:8px">Acties</div>
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
      catch(ex) { window.showToast(ex.message, "error"); }
    });
    document.getElementById("drawerActivate")?.addEventListener("click", async e => {
      try { await api(`/api/admin/tenants/${e.target.dataset.id}/activate`,{method:"POST"}); closeDrawer(); tenants(); }
      catch(ex) { window.showToast(ex.message, "error"); }
    });
    // Plan buttons
    document.querySelectorAll("[id^=planBtn_]").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/admin/tenants/${t.id}`,{method:"PATCH",body:JSON.stringify({plan:btn.dataset.plan})});
          closeDrawer(); tenants();
        } catch(ex) { window.showToast(ex.message, "error"); }
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
  <div style="font-size:12px;font-weight:600;color:var(--gray-500);text-transform:uppercase;letter-spacing:.4px;margin-bottom:10px">Admin-gebruiker (optioneel)</div>
  <div class="sa-form-grid">
    <div class="sa-field"><label>Admin naam</label><input name="adminName" placeholder="Jan Janssen"></div>
    <div class="sa-field"><label>Admin e-mail</label><input name="adminEmail" type="email" placeholder="jan@janssen.be"></div>
    <div class="sa-field" style="grid-column:1/-1;font-size:12px;color:var(--gray-500)">De admin ontvangt een activatiemail om zelf een wachtwoord in te stellen · je kiest er hier geen.</div>
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
      try {
        const r = await api("/api/admin/tenants",{method:"POST",body:JSON.stringify(body)});
        closeDrawer(); tenants();
        if (r && r.activationLink) window.showToast("Tenant aangemaakt. Activatielink (dev): " + r.activationLink, "success");
        else window.showToast("Tenant aangemaakt · admin krijgt een activatiemail.", "success");
      }
      catch(e) { btn.disabled=false; btn.textContent="Tenant aanmaken"; window.showToast(e.message, "error"); }
    });
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: Facturatie / MRR
  // ══════════════════════════════════════════════════════════
  async function billing() {
    const c = content(); c.innerHTML = loader();
    try {
      const [bd, lc] = await Promise.all([api("/api/admin/billing"), api("/api/admin/lifecycle").catch(() => ({}))]);
      const rows = bd.rows||[];
      const life = (lc && lc.lifecycle) || null;
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
    <div class="sa-kpi-value">${rows.filter(r=>r.mrr>0).length ? fmtEur(bd.totalMrr / rows.filter(r=>r.mrr>0).length) : "-"}</div>
    <div class="sa-kpi-sub">actieve tenants</div>
  </div>
</div>
<div class="sa-alert alert-info" style="margin-bottom:16px">ℹ️ Schattingen gebaseerd op plan × gebruikers. Koppel Stripe voor werkelijke facturatie.</div>
${life ? `<div class="sa-card" style="margin-bottom:16px"><div class="sa-card-head"><div class="sa-card-title">Lifecycle &amp; conversie</div></div>
  <div class="sa-card-body" style="padding:14px 16px">
    <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:10px">
      <div><div style="font-size:11px;color:var(--gray-500)">Trials</div><div style="font-size:20px;font-weight:700;color:var(--wf-yellow)">${life.counts.trial}</div></div>
      <div><div style="font-size:11px;color:var(--gray-500)">Actief (betalend)</div><div style="font-size:20px;font-weight:700;color:var(--wf-green)">${life.counts.active}</div></div>
      <div><div style="font-size:11px;color:var(--gray-500)">Opgezegd</div><div style="font-size:20px;font-weight:700;color:var(--wf-red)">${life.counts.canceled}</div></div>
      <div><div style="font-size:11px;color:var(--gray-500)">Conversie</div><div style="font-size:20px;font-weight:700">${life.conversionPct}%</div></div>
      <div><div style="font-size:11px;color:var(--gray-500)">Nieuw (30d)</div><div style="font-size:20px;font-weight:700">${life.recentSignups}</div></div>
    </div>
    ${life.trials.length ? `<div style="font-size:12px;font-weight:600;color:var(--gray-500);margin-bottom:4px">Trials (oudste eerst · opvolgen)</div>
    <div class="sa-tbl-wrap"><table class="sa-tbl"><thead><tr><th>Tenant</th><th>Plan</th><th>Trial-leeftijd</th><th>Laatste activiteit</th></tr></thead><tbody>
      ${life.trials.slice(0,15).map(t => `<tr><td>${esc(t.tenant)}</td><td>${esc(t.plan||"-")}</td><td>${t.ageDays!=null?t.ageDays+" d":"-"}</td><td>${t.lastActivityAt?fmtDT(t.lastActivityAt):"nooit"}</td></tr>`).join("")}
    </tbody></table></div>` : "<div style='font-size:12.5px;color:var(--gray-500)'>Geen openstaande trials.</div>"}
  </div></div>` : ""}
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
          <td style="font-weight:600;color:${r.mrr>0?"var(--wf-green)":"var(--gray-400)"}">${r.mrr>0?fmtEur(r.mrr):"-"}</td>
          <td style="color:var(--gray-400)">${r.arr>0?fmtEur(r.arr):"-"}</td>
        </tr>`).join("")}
      </tbody>
      <tfoot>
        <tr style="background:var(--gray-50);font-weight:600">
          <td colspan="5" style="padding:10px 14px;font-size:12px;color:var(--gray-500)">TOTAAL</td>
          <td style="padding:10px 14px;font-size:14px;color:var(--wf-green)">${fmtEur(bd.totalMrr)}</td>
          <td style="padding:10px 14px;font-size:14px;color:var(--gray-700)">${fmtEur(bd.totalArr)}</td>
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
      const badge_e = n => `<span class="nav-badge" style="display:inline-block;margin-left:0;background:${n>0?"var(--wf-red)":"var(--wf-green)"}">${n}</span>`;
      c.innerHTML = `
<div class="sa-kpis">
  <div class="sa-kpi kpi-teal">
    <div class="sa-kpi-label">Server status</div>
    <div class="sa-kpi-value" style="font-size:18px">Online</div>
    <div class="sa-kpi-sub">Uptime ${fmtUptime(hd.uptime||0)}</div>
  </div>
  <div class="sa-kpi kpi-blue">
    <div class="sa-kpi-label">Versie</div>
    <div class="sa-kpi-value" style="font-size:18px">${esc(hd.version||"-")}</div>
    <div class="sa-kpi-sub">${esc(hd.releaseChannel||"-")} · ${esc((hd.commitSha||"local").slice(0,8))}</div>
  </div>
  <div class="sa-kpi kpi-indigo">
    <div class="sa-kpi-label">Opslag</div>
    <div class="sa-kpi-value" style="font-size:18px">${esc(hd.storageAdapter||"json")}</div>
    <div class="sa-kpi-sub">${hd.storeReady?"Verbonden":"Niet verbonden"}</div>
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
    <button class="sa-btn btn-secondary sm" data-action="refresh">↻ Vernieuwen</button>
  </div>
  ${errors.length ? `
  <div class="sa-tbl-wrap">
    <table class="sa-tbl">
      <thead><tr><th>Tijdstip</th><th>Status</th><th>Methode</th><th>Pad</th><th>Bericht</th><th>Tenant</th></tr></thead>
      <tbody>
        ${errors.map(e=>`<tr>
          <td><span class="mono">${esc((e.at||"").slice(0,19).replace("T"," "))}</span></td>
          <td>${badge(e.status||"?", Number(e.status)>=500?"badge-red":"badge-orange")}</td>
          <td><span class="mono">${esc(e.method||"-")}</span></td>
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span class="mono" style="font-size:11px">${esc(e.path||"-")}</span></td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${esc(e.message||"-")}</td>
          <td><span class="sub">${esc(e.tenantId||"-")}</span></td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>` : `<div class="sa-empty">Geen server errors · systeem is gezond</div>`}
</div>`;
    } catch(e) { content().innerHTML = err(e); }
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: Resellers (platform-partnerprogramma + commissie)
  // ══════════════════════════════════════════════════════════
  async function resellers() {
    const c = content(); c.innerHTML = loader();
    try {
      const [d, po] = await Promise.all([api("/api/admin/resellers"), api("/api/admin/reseller-payouts").catch(() => ({}))]);
      const rows = d.resellers || [];
      const canManage = !!d.canManage;
      const payouts = (po && po.rows) || [];
      c.innerHTML = `
<div class="sa-page-head"><h1>Resellers<span class="cnt">${rows.length}</span></h1></div>
${payouts.length ? `<div class="sa-card" style="margin-bottom:16px"><div class="sa-card-head"><div class="sa-card-title">Uit te betalen commissie (per maand)</div>
  <button class="sa-btn btn-secondary sm" id="poCsv">CSV</button></div>
  <div class="sa-card-body" style="padding:0 0 6px">
    <div style="padding:12px 16px;font-size:13px;color:var(--gray-600)">Totaal verschuldigd: <strong>${fmtEur(po.totalMonthly||0)}/maand</strong></div>
    <div class="sa-tbl-wrap"><table class="sa-tbl"><thead><tr><th>Reseller</th><th>Klanten</th><th>MRR</th><th>Commissie/maand</th></tr></thead><tbody>
      ${payouts.map(r => `<tr><td>${esc(r.reseller)}</td><td>${r.clients}</td><td>${fmtEur(r.mrr)}</td><td style="font-weight:600;color:var(--wf-green)">${fmtEur(r.commissionMonthly)}</td></tr>`).join("")}
    </tbody></table></div></div></div>` : ""}
<div class="sa-card" style="margin-bottom:16px"><div style="padding:14px 16px;font-size:13px;color:var(--gray-600);line-height:1.5">
  Resellers brengen klanten aan en verdienen een terugkerende commissie (% van het abonnement). Ze beheren hun eigen klanten via het reseller-portaal en zien enkel commerciële gegevens · geen operationele klantdata.
  ${canManage ? "" : "<br><strong>Alleen de hoofd-superadmin kan resellers aanmaken of wijzigen.</strong>"}
</div></div>
${canManage ? `
<div class="sa-card" style="margin-bottom:16px">
  <div class="sa-card-head"><div class="sa-card-title">Nieuwe reseller</div></div>
  <div style="padding:14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:680px">
    <input id="rsName" placeholder="Naam (partner/bedrijf)">
    <input id="rsContact" placeholder="Contact-e-mail (optioneel)">
    <input id="rsLogin" type="email" placeholder="Login-e-mail">
    <div><label style="font-size:12px;color:var(--gray-500)">Commissie %</label><input id="rsPct" type="number" min="0" max="100" value="10" style="width:100%"></div>
    <div style="grid-column:1/3;font-size:12px;color:var(--gray-500)">De reseller ontvangt een activatiemail om zelf een wachtwoord in te stellen.</div>
    <div style="grid-column:1/3;display:flex;gap:8px;align-items:center"><button class="sa-btn btn-primary sm" id="rsCreate">Reseller toevoegen</button><span id="rsMsg" style="font-size:12.5px;color:var(--wf-red)"></span></div>
  </div>
</div>` : ""}
<div class="sa-card"><div class="sa-tbl-wrap"><table class="sa-tbl">
  <thead><tr><th>Reseller</th><th>Status</th><th>Commissie</th><th>Klanten</th><th>MRR</th><th>Commissie/mnd</th><th></th></tr></thead>
  <tbody id="rsBody"></tbody>
</table></div></div>`;

      // CSV-export via geautoriseerde fetch (geen token in URL) → blob-download.
      document.getElementById("poCsv")?.addEventListener("click", async () => {
        try {
          const r = await fetch("/api/admin/reseller-payouts?format=csv", { headers: { Authorization: "Bearer " + token() } });
          if (!r.ok) throw new Error("Export mislukt");
          const blob = await r.blob();
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob); a.download = "reseller-payouts.csv";
          document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
        } catch (e) { window.showToast && window.showToast(e.message, "error"); }
      });

      function render() {
        const tb = document.getElementById("rsBody");
        tb.innerHTML = rows.map(r => {
          const status = r.status === "active" ? badge("actief", "badge-green")
            : r.status === "pending" ? badge("in aanvraag", "badge-orange")
            : badge("gepauzeerd", "badge-gray");
          let action = `<span class="sub">-</span>`;
          if (canManage) {
            action = `<button class="sa-btn btn-secondary sm" data-edit="${r.id}">Commissie</button> `
              + (r.status === "pending" ? `<button class="sa-btn btn-primary sm" data-resume="${r.id}">Goedkeuren</button>`
                : r.status === "active" ? `<button class="sa-btn btn-secondary sm" data-pause="${r.id}">Pauzeren</button>`
                : `<button class="sa-btn btn-primary sm" data-resume="${r.id}">Activeren</button>`);
          }
          return `<tr>
            <td><div class="main">${esc(r.name)}</div>${r.contactEmail ? `<span class="sub">${esc(r.contactEmail)}</span>` : ""}</td>
            <td>${status}</td>
            <td>${r.defaultCommissionPct || 0}%</td>
            <td>${r.clientCount || 0}</td>
            <td>${fmtEur(r.totalMrr || 0)}</td>
            <td style="font-weight:600;color:var(--wf-green)">${fmtEur(r.totalCommission || 0)}</td>
            <td style="text-align:right">${action}</td>
          </tr>`;
        }).join("") || `<tr><td colspan="7"><div class="sa-empty">Nog geen resellers</div></td></tr>`;
        tb.querySelectorAll("[data-pause]").forEach(b => b.addEventListener("click", () => setStatus(b.dataset.pause, "paused")));
        tb.querySelectorAll("[data-resume]").forEach(b => b.addEventListener("click", () => setStatus(b.dataset.resume, "active")));
        tb.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => editPct(b.dataset.edit)));
      }
      async function setStatus(id, status) { try { await api(`/api/admin/resellers/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); resellers(); } catch (e) { alert(e.message); } }
      function editPct(id) {
        const r = rows.find(x => x.id === id) || {};
        const pct = window.prompt(`Commissie-% voor ${r.name}:`, String(r.defaultCommissionPct || 0));
        if (pct == null) return;
        api(`/api/admin/resellers/${id}`, { method: "PATCH", body: JSON.stringify({ defaultCommissionPct: Number(pct) }) }).then(() => resellers()).catch(e => alert(e.message));
      }
      if (canManage) {
        document.getElementById("rsCreate").addEventListener("click", async () => {
          const name = document.getElementById("rsName").value.trim();
          const contactEmail = document.getElementById("rsContact").value.trim();
          const loginEmail = document.getElementById("rsLogin").value.trim();
          const defaultCommissionPct = Number(document.getElementById("rsPct").value) || 0;
          const msg = document.getElementById("rsMsg"); msg.textContent = "";
          if (!name || !loginEmail) { msg.textContent = "Naam en login-e-mail zijn verplicht."; return; }
          try {
            const r = await api("/api/admin/resellers", { method: "POST", body: JSON.stringify({ name, contactEmail, loginEmail, defaultCommissionPct }) });
            if (r && r.activationLink) window.showToast("Reseller aangemaakt. Activatielink (dev): " + r.activationLink, "success");
            resellers();
          }
          catch (e) { msg.textContent = e.message; }
        });
      }
      render();
    } catch (e) { content().innerHTML = err(e); }
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: Platformteam (eigen support-medewerkers / super_admins)
  // ══════════════════════════════════════════════════════════
  const SCOPE_LABELS = { tenants:"Tenants", billing:"Facturatie", modules:"Modules & Bundels", integrations:"Integraties", system:"Systeem", support:"Support-toegang", audit:"Audit", settings:"Instellingen" };
  async function staff() {
    const c = content(); c.innerHTML = loader();
    try {
      const d = await api("/api/admin/staff");
      const rows = d.staff || [];
      const canManage = !!d.canManage;
      const allScopes = d.allScopes || Object.keys(SCOPE_LABELS);
      const scopeChecks = (checked, idPrefix) => allScopes.map(s =>
        `<label style="display:inline-flex;align-items:center;gap:6px;margin:3px 12px 3px 0;font-size:13px"><input type="checkbox" data-scope="${s}" id="${idPrefix}-${s}"${checked.includes(s)?" checked":""}> ${esc(SCOPE_LABELS[s]||s)}</label>`).join("");
      c.innerHTML = `
<div class="sa-page-head"><h1>Platformteam<span class="cnt">${rows.length}</span></h1></div>
<div class="sa-card" style="margin-bottom:16px">
  <div style="padding:14px 16px;font-size:13px;color:var(--gray-600);line-height:1.5">
    Platform-medewerkers krijgen toegang tot de platform-secties die je per persoon aanvinkt
    (bv. enkel Support, of ook Facturatie/Modules). Uitzonderingen: enkel de hoofd-superadmin
    beheert het team, en de hoofd-superadmin zelf kan nooit gedeactiveerd of gewijzigd worden.
    ${canManage ? "" : `<br><strong>Alleen de hoofd-superadmin kan teamleden beheren.</strong>`}
  </div>
</div>
${canManage ? `
<div class="sa-card" style="margin-bottom:16px">
  <div class="sa-card-head"><div class="sa-card-title">Nieuw teamlid</div></div>
  <div style="padding:14px 16px;display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:640px">
    <input id="stfName" placeholder="Naam">
    <input id="stfEmail" type="email" placeholder="E-mail">
    <div style="grid-column:1/3;font-size:12px;color:var(--gray-500)">Het teamlid ontvangt een activatiemail om zelf een wachtwoord in te stellen.</div>
    <div style="grid-column:1/3">
      <div style="font-size:12px;color:var(--gray-500);margin-bottom:6px">Toegang tot platform-secties:</div>
      <div id="stfScopes">${scopeChecks(allScopes, "ns")}</div>
    </div>
    <div style="grid-column:1/3;display:flex;gap:8px;align-items:center">
      <button class="sa-btn btn-primary sm" id="stfCreate">Teamlid toevoegen</button>
      <span id="stfMsg" style="font-size:12.5px;color:var(--wf-red)"></span>
    </div>
  </div>
</div>` : ""}
<div class="sa-card">
  <div class="sa-tbl-wrap">
    <table class="sa-tbl">
      <thead><tr><th>Naam</th><th>E-mail</th><th>Toegang</th><th>Status</th><th></th></tr></thead>
      <tbody id="stfBody"></tbody>
    </table>
  </div>
</div>`;

      function scopesText(u) {
        if (u.protected) return badge("alle secties","badge-red");
        const sc = u.scopes || [];
        if (sc.length >= allScopes.length) return badge("alle secties","badge-blue");
        if (sc.length === 0) return `<span class="sub">geen</span>`;
        return sc.map(s => `<span class="sub" style="margin-right:6px">${esc(SCOPE_LABELS[s]||s)}</span>`).join("");
      }
      function render() {
        const tb = document.getElementById("stfBody");
        tb.innerHTML = rows.map(u => {
          const tags = (u.protected ? badge("hoofd-superadmin","badge-red") : "") + (u.isYou ? ` ${badge("jij","badge-blue")}` : "");
          const status = u.active ? badge("actief","badge-green") : badge("gedeactiveerd","badge-gray");
          let action = `<span class="sub">-</span>`;
          if (canManage && !u.protected && !u.isYou) {
            action = `<button class="sa-btn btn-secondary sm" data-scopes="${u.id}">Rechten</button> `
              + (u.active
                ? `<button class="sa-btn btn-secondary sm" data-deact="${u.id}">Deactiveren</button>`
                : `<button class="sa-btn btn-primary sm" data-act="${u.id}">Heractiveren</button>`);
          }
          return `<tr>
            <td><div class="main">${esc(u.name||"-")}</div>${tags}</td>
            <td><span class="sub">${esc(u.email)}</span></td>
            <td>${scopesText(u)}</td>
            <td>${status}</td>
            <td style="text-align:right">${action}</td>
          </tr>`;
        }).join("") || `<tr><td colspan="5"><div class="sa-empty">Geen teamleden</div></td></tr>`;
        tb.querySelectorAll("[data-deact]").forEach(b=>b.addEventListener("click",()=>setActive(b.dataset.deact,false)));
        tb.querySelectorAll("[data-act]").forEach(b=>b.addEventListener("click",()=>setActive(b.dataset.act,true)));
        tb.querySelectorAll("[data-scopes]").forEach(b=>b.addEventListener("click",()=>editScopes(b.dataset.scopes)));
      }
      async function setActive(id, active) {
        try { await api(`/api/admin/staff/${id}`, { method:"PATCH", body: JSON.stringify({ active }) }); staff(); }
        catch(e){ alert(e.message); }
      }
      function editScopes(id) {
        const u = rows.find(r=>r.id===id) || {};
        const ov = document.createElement("div");
        ov.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;";
        ov.innerHTML = `
<div style="background:#fff;border-radius:16px;width:100%;max-width:440px;padding:22px 24px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
  <h3 style="margin:0 0 4px;font-size:17px;color:var(--gray-900)">Rechten van ${esc(u.name||u.email)}</h3>
  <div style="font-size:13px;color:var(--gray-500);margin-bottom:14px">Vink aan tot welke platform-secties deze persoon toegang heeft.</div>
  <div id="esScopes">${scopeChecks(u.scopes||[], "es")}</div>
  <div id="esMsg" style="display:none;color:var(--wf-red);font-size:12.5px;margin-top:8px"></div>
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
    <button class="sa-btn btn-secondary sm" id="esCancel">Annuleren</button>
    <button class="sa-btn btn-primary sm" id="esSave">Opslaan</button>
  </div>
</div>`;
        document.body.appendChild(ov);
        const close=()=>ov.remove();
        ov.addEventListener("click",e=>{ if(e.target===ov) close(); });
        ov.querySelector("#esCancel").addEventListener("click", close);
        ov.querySelector("#esSave").addEventListener("click", async () => {
          const scopes = [...ov.querySelectorAll("#esScopes input:checked")].map(i=>i.dataset.scope);
          try { await api(`/api/admin/staff/${id}`, { method:"PATCH", body: JSON.stringify({ platformScopes: scopes }) }); close(); staff(); }
          catch(e){ const m=ov.querySelector("#esMsg"); m.textContent=e.message; m.style.display=""; }
        });
      }
      if (canManage) {
        document.getElementById("stfCreate").addEventListener("click", async () => {
          const name = document.getElementById("stfName").value.trim();
          const email = document.getElementById("stfEmail").value.trim();
          const platformScopes = [...document.querySelectorAll("#stfScopes input:checked")].map(i=>i.dataset.scope);
          const msg = document.getElementById("stfMsg");
          msg.textContent = "";
          if (!name || !email) { msg.textContent = "Naam en e-mail zijn verplicht."; return; }
          try {
            const r = await api("/api/admin/staff", { method:"POST", body: JSON.stringify({ name, email, platformScopes }) });
            if (r && r.activationLink) window.showToast("Teamlid aangemaakt. Activatielink (dev): " + r.activationLink, "success");
            staff();
          } catch(e){ msg.textContent = e.message; }
        });
      }
      render();
    } catch(e){ content().innerHTML = err(e); }
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: Support-toegang (GDPR · impersonatie met toestemming)
  // ══════════════════════════════════════════════════════════
  async function support() {
    const c = content(); c.innerHTML = loader();
    try {
      const sd = await api("/api/admin/support");
      const rows = sd.rows||[];
      const active = rows.filter(r=>r.session);
      badge_update("navBadgeSupport", active.length);

      // GDPR: tenant-gebruikers worden NIET vooraf geladen. Pas bij het starten
      // van een sessie halen we ze op via een consent-gated endpoint (alleen als
      // de klant support-toegang toestond).
      const roleRank = { tenant_admin:0, manager:1, employee:2 };
      const roleLabel = { tenant_admin:"beheerder", manager:"werfleider", employee:"medewerker" };

      function scopeBadge(scope){ return scope==="read" ? badge("alleen-lezen","badge-gray") : badge("lezen+schrijven","badge-red"); }

      c.innerHTML = `
<div class="sa-page-head"><h1>Support-toegang<span class="cnt">${active.length}</span></h1></div>
<div class="sa-card" style="margin-bottom:16px">
  <div style="padding:14px 16px;font-size:13px;color:var(--gray-600);line-height:1.5">
    <strong>GDPR-conforme support.</strong> Een support-sessie kan alleen starten als de klant toestemming gaf.
    De sessie neemt de exacte gebruikerssessie over (impersonatie), is tijdgebonden met automatische
    verlenging bij activiteit tot een harde limiet, en wordt volledig geaudit.
  </div>
</div>
<div class="sa-card">
  <div class="sa-tbl-wrap">
    <table class="sa-tbl">
      <thead><tr><th>Tenant</th><th>Toestemming</th><th>Actieve sessie</th><th>Verloopt</th><th></th></tr></thead>
      <tbody id="supBody"></tbody>
    </table>
  </div>
</div>`;

      function render() {
        const tb = document.getElementById("supBody");
        tb.innerHTML = rows.map(r=>{
          const consent = r.allowed
            ? badge("toegestaan","badge-green")
            : badge("geweigerd","badge-gray");
          const sess = r.session
            ? `${scopeBadge(r.session.scope)} <span class="sub">${esc(r.session.agent||"agent")}</span>`
            : `<span class="sub">-</span>`;
          const expiry = r.session
            ? `<span class="sub">${fmtD(r.session.expiresAt)}<br>hard: ${fmtD(r.session.hardExpiresAt)}</span>`
            : `<span class="sub">-</span>`;
          const action = r.session
            ? `<button class="sa-btn btn-secondary sm" data-end="${r.tenantId}">Sessie beëindigen</button>`
            : (r.allowed
                ? `<button class="sa-btn btn-primary sm" data-start="${r.tenantId}">Start sessie</button>`
                : `<span class="sub">Wacht op toestemming klant</span>`);
          return `<tr>
            <td><div class="main">${esc(r.tenantName||r.tenantId)}</div>${r.consentBy?`<span class="sub">door ${esc(r.consentBy)}</span>`:""}</td>
            <td>${consent}</td>
            <td>${sess}</td>
            <td>${expiry}</td>
            <td style="text-align:right">${action}</td>
          </tr>`;
        }).join("") || `<tr><td colspan="5"><div class="sa-empty">Geen tenants</div></td></tr>`;

        tb.querySelectorAll("[data-start]").forEach(b=>b.addEventListener("click", ()=>startSession(b.dataset.start)));
        tb.querySelectorAll("[data-end]").forEach(b=>b.addEventListener("click", ()=>endSession(b.dataset.end)));
      }

      async function startSession(tenantId) {
        const row = rows.find(r=>r.tenantId===tenantId) || {};
        // Consent-gated: gebruikers pas ophalen bij het starten (klant gaf toestemming).
        let users = [];
        try { const r = await api(`/api/admin/support/${tenantId}/users`); users = (r.users||[]).slice().sort((a,b)=>(roleRank[a.role]??9)-(roleRank[b.role]??9) || String(a.name||"").localeCompare(String(b.name||""))); }
        catch(e){ alert(e.message || "Kon gebruikers niet ophalen"); return; }
        const ov = document.createElement("div");
        ov.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;";
        ov.innerHTML = `
<div style="background:#fff;border-radius:16px;width:100%;max-width:440px;padding:22px 24px;box-shadow:0 20px 60px rgba(0,0,0,.25)">
  <h3 style="margin:0 0 4px;font-size:17px;color:var(--gray-900)">Support-sessie starten</h3>
  <div style="font-size:13px;color:var(--gray-500);margin-bottom:16px">${esc(row.tenantName||tenantId)}</div>
  <label style="display:block;font-size:13px;font-weight:600;color:var(--gray-700);margin-bottom:6px">Wie neem je over?</label>
  <select id="supUser" style="width:100%;margin-bottom:14px">
    ${users.length ? users.map(u=>`<option value="${u.id}">${esc(u.name||u.email)} · ${roleLabel[u.role]||u.role}${u.email?` (${esc(u.email)})`:""}</option>`).join("") : `<option value="">Geen gebruikers gevonden</option>`}
  </select>
  <label style="display:block;font-size:13px;font-weight:600;color:var(--gray-700);margin-bottom:6px">Rechten</label>
  <select id="supScope" style="width:100%;margin-bottom:14px">
    <option value="read">Alleen-lezen (aanbevolen)</option>
    <option value="write">Lezen + schrijven</option>
  </select>
  <label style="display:block;font-size:13px;font-weight:600;color:var(--gray-700);margin-bottom:6px">Reden (verplicht, wordt geaudit)</label>
  <input id="supReason" placeholder="bv. factuur kan niet verstuurd worden" style="width:100%;margin-bottom:8px">
  <div id="supErr" style="display:none;color:var(--wf-red);font-size:12.5px;margin-bottom:8px"></div>
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
    <button class="sa-btn btn-secondary sm" id="supCancel">Annuleren</button>
    <button class="sa-btn btn-primary sm" id="supGo">Sessie overnemen</button>
  </div>
</div>`;
        document.body.appendChild(ov);
        const close = () => ov.remove();
        ov.addEventListener("click", e => { if (e.target === ov) close(); });
        ov.querySelector("#supCancel").addEventListener("click", close);
        ov.querySelector("#supGo").addEventListener("click", async () => {
          const impersonatedUserId = ov.querySelector("#supUser").value;
          const scope = ov.querySelector("#supScope").value;
          const reason = ov.querySelector("#supReason").value.trim();
          const errEl = ov.querySelector("#supErr");
          if (!impersonatedUserId) { errEl.textContent = "Geen gebruiker geselecteerd."; errEl.style.display = ""; return; }
          if (!reason) { errEl.textContent = "Reden is verplicht."; errEl.style.display = ""; return; }
          try {
            const r = await api("/api/admin/support/start", { method:"POST", body: JSON.stringify({ tenantId, impersonatedUserId, scope, reason }) });
            close();
            alert(`Support-sessie gestart als ${r.session.impersonatedUserEmail||r.session.impersonatedUserId} (${r.session.scope==="write"?"lezen+schrijven":"alleen-lezen"}).\nJe neemt nu de sessie van deze gebruiker over. Verloopt ${fmtD(r.session.expiresAt)} · hard ${fmtD(r.session.hardExpiresAt)}.\nGebruik "Sessie verlaten" in de banner om terug te keren naar je eigen account.`);
            // Bewaar het eigen agent-token + tenant zodat "Sessie verlaten" je terugzet.
            try { sessionStorage.setItem("wfp_agent_token", token()); sessionStorage.setItem("wfp_support_tenant", tenantId); } catch(_){}
            // Overname in DIT tabblad (pop-up/nieuw tabblad wordt op mobiel geblokkeerd).
            localStorage.setItem("wfp_token", r.supportToken);
            const me = await fetch("/api/me", { headers: { Authorization: "Bearer " + r.supportToken } }).then(x => x.json());
            if (!me || !me.ok || !me.user) throw new Error("Support-sessie kon niet starten");
            document.getElementById("loginPage")?.classList.add("hidden");
            if (window.WorkFlowProPlatformRouter) window.WorkFlowProPlatformRouter.showPlatform(me.user.role);
            else location.reload();
          } catch(e){ errEl.textContent = e.message; errEl.style.display = ""; }
        });
      }
      async function endSession(tenantId) {
        if (!window.confirm("Support-sessie nu beëindigen?")) return;
        try { await api("/api/admin/support/end", { method:"POST", body: JSON.stringify({ tenantId }) }); support(); }
        catch(e){ alert(e.message); }
      }

      render();
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
  <button class="sa-btn btn-secondary sm" id="auditExport">CSV</button>
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
    <div id="auEmpty" class="sa-empty" style="display:none">Geen events</div>
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
          <td style="font-size:12px">${esc(e.actor||"-")}</td>
          <td style="font-size:12.5px;font-weight:500">${esc(e.action||"-")}</td>
          <td>${badge(e.area||"-","badge-blue")}</td>
          <td><span class="sub">${esc(e.tenantId||"-")}</span></td>
          <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><span class="sub">${esc(e.detail||"-")}</span></td>
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
  // VIEW: Modules & Bundels
  // ══════════════════════════════════════════════════════════
  let _modTab = "bundles";
  async function modules() {
    const c = content(); c.innerHTML = loader();
    try {
      const [cat, bun, ten] = await Promise.all([
        api("/api/admin/catalog"),
        api("/api/admin/bundles"),
        api("/api/admin/tenants"),
      ]);
      const catalog = cat.modules || [];
      const groups = [...new Set(catalog.map(m => m.group))];
      const bundles = bun.bundles || [];
      const tenants = ten.tenants || [];

      // Module/submodule keuzeraster. selSubs = { modKey: [subKey] }
      function grid(prefix, selMods, selSubs, opts) {
        const showSubs = !opts || opts.subs !== false;
        return groups.map(g => `
          <div style="margin-bottom:12px">
            <div style="font-size:10.5px;font-weight:700;color:var(--gray-500);text-transform:uppercase;letter-spacing:.5px;margin:8px 0 5px">${esc(g)}</div>
            ${catalog.filter(m => m.group === g).map(m => {
              const on = selMods.includes(m.key);
              const subs = m.submodules || [];
              return `
              <div style="border:1px solid var(--gray-200);border-radius:9px;padding:9px 11px;margin-bottom:7px;background:${on ? "var(--wf-blue-l)" : "#fff"}">
                <label style="display:flex;align-items:center;gap:9px;font-size:13px;font-weight:600;color:var(--gray-900);cursor:pointer">
                  <input type="checkbox" class="${prefix}-mod" data-key="${m.key}" ${on ? "checked" : ""} style="width:16px;height:16px">
                  ${esc(m.label)}
                </label>
                ${showSubs && subs.length ? `<div class="${prefix}-subwrap" data-mod="${m.key}" style="margin:7px 0 0 25px;display:${on ? "flex" : "none"};flex-wrap:wrap;gap:4px 16px">
                  ${subs.map(s => {
                    const son = (selSubs[m.key] || []).includes(s.key);
                    return `<label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--gray-600);cursor:pointer">
                      <input type="checkbox" class="${prefix}-sub" data-mod="${m.key}" data-sub="${s.key}" ${son ? "checked" : ""}> ${esc(s.label)}</label>`;
                  }).join("")}
                </div>` : ""}
              </div>`;
            }).join("")}
          </div>`).join("");
      }

      // Toon/verberg submodules wanneer een module aan/uit gaat.
      function wireSubToggle(root, prefix) {
        root.querySelectorAll(`.${prefix}-mod`).forEach(cb => cb.addEventListener("change", () => {
          const wrap = root.querySelector(`.${prefix}-subwrap[data-mod="${cb.dataset.key}"]`);
          if (wrap) wrap.style.display = cb.checked ? "flex" : "none";
        }));
      }
      function readMods(root, prefix) { return [...root.querySelectorAll(`.${prefix}-mod:checked`)].map(x => x.dataset.key); }
      function readSubs(root, prefix, mods) {
        const out = {};
        [...root.querySelectorAll(`.${prefix}-sub:checked`)].forEach(x => {
          if (!mods.includes(x.dataset.mod)) return;
          (out[x.dataset.mod] = out[x.dataset.mod] || []).push(x.dataset.sub);
        });
        return out;
      }

      c.innerHTML = `
<div class="sa-filters" style="margin-bottom:16px">
  <button class="sa-btn ${_modTab === "bundles" ? "btn-primary" : "btn-secondary"} sm" id="tabBundles">Bundels samenstellen</button>
  <button class="sa-btn ${_modTab === "tenants" ? "btn-primary" : "btn-secondary"} sm" id="tabTenants">Vrijgave per tenant</button>
  <button class="sa-btn ${_modTab === "addons" ? "btn-primary" : "btn-secondary"} sm" id="tabAddons">Add-ons</button>
</div>
<div id="modPanel"></div>`;

      document.getElementById("tabBundles").addEventListener("click", () => { _modTab = "bundles"; renderPanel(); });
      document.getElementById("tabTenants").addEventListener("click", () => { _modTab = "tenants"; renderPanel(); });
      document.getElementById("tabAddons").addEventListener("click", () => { _modTab = "addons"; renderPanel(); });

      function renderPanel() {
        document.getElementById("tabBundles").className = `sa-btn ${_modTab === "bundles" ? "btn-primary" : "btn-secondary"} sm`;
        document.getElementById("tabTenants").className = `sa-btn ${_modTab === "tenants" ? "btn-primary" : "btn-secondary"} sm`;
        document.getElementById("tabAddons").className = `sa-btn ${_modTab === "addons" ? "btn-primary" : "btn-secondary"} sm`;
        if (_modTab === "bundles") renderBundles();
        else if (_modTab === "addons") renderAddons();
        else renderTenants();
      }

      // ── Add-ons: naam, prijs, omschrijving, actief · superadmin-bewerkbaar ──
      async function renderAddons() {
        const panel = document.getElementById("modPanel");
        panel.innerHTML = loader();
        let addons = [];
        try { addons = (await api("/api/admin/addons")).addons || []; }
        catch (e) { panel.innerHTML = `<div class="sa-card"><div class="sa-card-body">${esc(e.message)}</div></div>`; return; }
        panel.innerHTML = `
<div class="sa-card">
  <div class="sa-card-head"><div class="sa-card-title">Add-ons (naam, prijs &amp; omschrijving)</div></div>
  <div class="sa-card-body" style="padding:16px;display:flex;flex-direction:column;gap:14px">
    <div style="font-size:12.5px;color:var(--gray-500)">Pas de commerciële naam, maandprijs en omschrijving van elke add-on aan. Dit verschijnt bij de klant (prijzen/aanbod). À-la-carte toekennen per tenant gebeurt via "Vrijgave per tenant".</div>
    ${addons.map(a => `
      <div class="sa-addon-row" data-key="${esc(a.key)}" style="border:1px solid var(--gray-200);border-radius:10px;padding:12px;display:grid;grid-template-columns:1fr 130px;gap:10px">
        <div>
          <div style="font-size:11px;color:var(--gray-400);font-family:monospace;margin-bottom:4px">${esc(a.key)}</div>
          <input class="ao-label" value="${esc(a.label)}" placeholder="Naam" style="width:100%;font-weight:600;margin-bottom:6px">
          <textarea class="ao-desc" rows="2" placeholder="Omschrijving" style="width:100%;font-size:12.5px;resize:vertical">${esc(a.description)}</textarea>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label style="font-size:11px;color:var(--gray-500)">€/maand
            <input class="ao-monthly" type="number" min="0" step="1" value="${a.monthly ?? ""}" style="width:100%">
          </label>
          <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--gray-600);cursor:pointer">
            <input class="ao-active" type="checkbox" ${a.active ? "checked" : ""}> Actief
          </label>
          <button class="sa-btn btn-secondary sm ao-reset" type="button" data-label="${esc(a.defaults.label)}" data-monthly="${a.defaults.monthly ?? ""}" data-desc="${esc(a.defaults.description)}">Standaard</button>
        </div>
      </div>`).join("")}
    <div style="display:flex;gap:8px;align-items:center">
      <button class="sa-btn btn-primary sm" id="aoSave">Add-ons opslaan</button>
      <span id="aoMsg" style="font-size:12.5px;color:var(--wf-green)"></span>
    </div>
  </div>
</div>
<div id="planPricesCard" style="margin-top:16px"></div>`;
        renderPlanPrices();
        panel.querySelectorAll(".ao-reset").forEach(btn => btn.addEventListener("click", () => {
          const row = btn.closest(".sa-addon-row");
          row.querySelector(".ao-label").value = btn.dataset.label;
          row.querySelector(".ao-monthly").value = btn.dataset.monthly;
          row.querySelector(".ao-desc").value = btn.dataset.desc;
        }));
        document.getElementById("aoSave").addEventListener("click", async () => {
          const payload = { addons: {} };
          panel.querySelectorAll(".sa-addon-row").forEach(row => {
            payload.addons[row.dataset.key] = {
              label: row.querySelector(".ao-label").value.trim(),
              description: row.querySelector(".ao-desc").value.trim(),
              monthly: row.querySelector(".ao-monthly").value,
              active: row.querySelector(".ao-active").checked,
            };
          });
          const msg = document.getElementById("aoMsg"); msg.textContent = "";
          try { await api("/api/admin/addons", { method: "PUT", body: JSON.stringify(payload) }); msg.textContent = "Opgeslagen ✓"; }
          catch (e) { msg.style.color = "var(--wf-red)"; msg.textContent = e.message; }
        });
      }

      // ── Bundel-prijzen (basis/jaar + per seat/jaar + inbegrepen seats) ──────
      async function renderPlanPrices() {
        const card = document.getElementById("planPricesCard");
        if (!card) return;
        let plans = [];
        try { plans = (await api("/api/admin/plan-prices")).plans || []; } catch (_) { return; }
        card.innerHTML = `
<div class="sa-card"><div class="sa-card-head"><div class="sa-card-title">Bundel-prijzen</div></div>
  <div class="sa-card-body" style="padding:16px">
    <div style="font-size:12.5px;color:var(--gray-500);margin-bottom:10px">Basisprijs per jaar + prijs per extra gebruiker/jaar + inbegrepen gebruikers, per bundel. €0 basis = 'op aanvraag' (bv. enterprise).</div>
    <div class="sa-tbl-wrap"><table class="sa-tbl"><thead><tr><th>Bundel</th><th>Basis €/jaar</th><th>Per seat €/jaar</th><th>Inbegrepen seats</th></tr></thead><tbody>
      ${plans.map(p => `<tr class="pp-row" data-key="${esc(p.key)}">
        <td><strong>${esc(p.label)}</strong></td>
        <td><input class="pp-base" type="number" min="0" value="${p.baseAnnual}" style="width:100px"></td>
        <td><input class="pp-seat" type="number" min="0" value="${p.seatAnnual}" style="width:100px"></td>
        <td><input class="pp-inc" type="number" min="0" value="${p.includedSeats}" style="width:80px"></td>
      </tr>`).join("")}
    </tbody></table></div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:10px">
      <button class="sa-btn btn-primary sm" id="ppSave">Prijzen opslaan</button>
      <span id="ppMsg" style="font-size:12.5px;color:var(--wf-green)"></span>
    </div>
  </div></div>`;
        document.getElementById("ppSave").addEventListener("click", async () => {
          const planPrices = {};
          card.querySelectorAll(".pp-row").forEach(row => {
            planPrices[row.dataset.key] = {
              baseAnnual: row.querySelector(".pp-base").value,
              seatAnnual: row.querySelector(".pp-seat").value,
              includedSeats: row.querySelector(".pp-inc").value,
            };
          });
          const msg = document.getElementById("ppMsg"); msg.textContent = "";
          try { await api("/api/admin/plan-prices", { method: "PUT", body: JSON.stringify({ planPrices }) }); msg.textContent = "Opgeslagen ✓"; }
          catch (e) { msg.style.color = "var(--wf-red)"; msg.textContent = e.message; }
        });
      }

      // ── Bundels samenstellen ──────────────────────────────
      function renderBundles() {
        const panel = document.getElementById("modPanel");
        panel.innerHTML = `
<div class="sa-card">
  <div class="sa-card-head">
    <div class="sa-card-title">Bundel bewerken</div>
    <select id="bunSel" class="sa-btn btn-secondary sm" style="font-weight:600">
      ${bundles.map(b => `<option value="${b.key}">${esc(b.label)} (${b.modules.length} modules)</option>`).join("")}
      <option value="__new">+ Nieuwe bundel…</option>
    </select>
  </div>
  <div class="sa-card-body" id="bunEditor" style="padding:16px"></div>
</div>`;
        const sel = document.getElementById("bunSel");
        sel.addEventListener("change", () => editBundle(sel.value));
        editBundle(bundles[0] ? bundles[0].key : "__new");
      }

      function editBundle(key) {
        const ed = document.getElementById("bunEditor");
        const isNew = key === "__new";
        const b = isNew ? { key: "", label: "", description: "", modules: [], submodules: {}, custom: false, active: true, order: (bundles.length + 1) } : bundles.find(x => x.key === key);
        ed.innerHTML = `
<div class="sa-form-grid" style="margin-bottom:14px">
  <div class="sa-field"><label>Bundel-key</label><input id="bKey" value="${esc(b.key)}" ${isNew ? "" : "disabled"} placeholder="bv. pro"></div>
  <div class="sa-field"><label>Naam</label><input id="bLabel" value="${esc(b.label)}" placeholder="bv. Pro"></div>
</div>
<div class="sa-field" style="margin-bottom:14px"><label>Omschrijving</label><input id="bDesc" value="${esc(b.description || "")}" placeholder="Korte omschrijving"></div>
<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--gray-600);margin-bottom:10px"><input type="checkbox" id="bCustom" ${b.custom ? "checked" : ""}> Op aanvraag (custom · klant kan niet zelf kiezen)</label>
<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--gray-600);margin-bottom:14px"><input type="checkbox" id="bPopular" ${b.popular ? "checked" : ""}> Meest gekozen (uitgelicht in prijzen &amp; abonnementsscherm)</label>
<div style="font-size:12px;font-weight:600;color:var(--gray-900);margin-bottom:6px">Inbegrepen modules &amp; submodules</div>
<div id="bGrid">${grid("b", b.modules, b.submodules || {})}</div>
<div style="display:flex;gap:8px;margin-top:14px">
  <button class="sa-btn btn-primary" id="bSave">${isNew ? "Bundel aanmaken" : "Wijzigingen opslaan"}</button>
  ${(!isNew && !b.custom) ? `<button class="sa-btn btn-danger" id="bDelete">Verwijderen</button>` : ""}
  <span id="bMsg" style="font-size:12.5px;align-self:center;color:var(--gray-500)"></span>
</div>`;
        wireSubToggle(ed, "b");
        document.getElementById("bSave").addEventListener("click", async () => {
          const mods = readMods(ed, "b");
          const payload = {
            key: (document.getElementById("bKey").value || b.key).trim().toLowerCase(),
            label: document.getElementById("bLabel").value.trim() || document.getElementById("bKey").value,
            description: document.getElementById("bDesc").value.trim(),
            custom: document.getElementById("bCustom").checked,
            popular: document.getElementById("bPopular").checked,
            active: true, order: b.order,
            modules: mods,
            submodules: readSubs(ed, "b", mods),
          };
          try {
            await api("/api/admin/bundles", { method: "POST", body: JSON.stringify(payload) });
            window.showToast && window.showToast(`Bundel '${payload.label}' opgeslagen`, "success");
            modules();
          } catch (e) { window.showToast && window.showToast(e.message, "error"); }
        });
        const del = document.getElementById("bDelete");
        if (del) del.addEventListener("click", async () => {
          if (!confirm(`Bundel '${b.label}' verwijderen?`)) return;
          try {
            await api(`/api/admin/bundles/${b.key}`, { method: "DELETE" });
            window.showToast && window.showToast("Bundel verwijderd", "success");
            modules();
          } catch (e) { window.showToast && window.showToast(e.message, "error"); }
        });
      }

      // ── Vrijgave per tenant ───────────────────────────────
      function renderTenants() {
        const panel = document.getElementById("modPanel");
        panel.innerHTML = `
<div class="sa-card">
  <div class="sa-card-head">
    <div class="sa-card-title">Modules vrijgeven per tenant</div>
    <select id="tenSel" class="sa-btn btn-secondary sm" style="font-weight:600">
      ${tenants.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}
    </select>
  </div>
  <div class="sa-card-body" id="tenEditor" style="padding:16px"></div>
</div>`;
        if (!tenants.length) { document.getElementById("tenEditor").innerHTML = `<div class="sa-empty">Geen tenants</div>`; return; }
        const sel = document.getElementById("tenSel");
        sel.addEventListener("change", () => editTenant(sel.value));
        editTenant(tenants[0].id);
      }

      async function editTenant(tid) {
        const ed = document.getElementById("tenEditor");
        ed.innerHTML = loader();
        try {
          const d = await api(`/api/admin/tenants/${tid}/entitlements`);
          const ent = d.entitlements || {};
          const tenant = tenants.find(t => t.id === tid) || {};
          const baseBundle = bundles.find(b => b.key === ent.plan) || { modules: [] };
          ed.innerHTML = `
<div class="sa-form-grid" style="margin-bottom:14px">
  <div class="sa-field"><label>Bundel (plan)</label>
    <select id="tPlan">${bundles.map(b => `<option value="${b.key}" ${b.key === ent.plan ? "selected" : ""}>${esc(b.label)}</option>`).join("")}</select>
  </div>
  <div class="sa-field"><label>Actieve modules</label><input value="${ent.modules.length} van ${catalog.length}" disabled></div>
</div>
<div class="sa-alert alert-info" style="margin-bottom:12px">Aangevinkt = vrijgegeven voor deze tenant. Wijk je af van de bundel, dan wordt dat als uitzondering bewaard. Wissel van bundel hierboven om de basis te resetten.</div>
<div id="tGrid">${grid("t", ent.modules, ent.submodules || {}, { subs: false })}</div>
<div style="display:flex;gap:8px;margin-top:14px">
  <button class="sa-btn btn-primary" id="tSave">Opslaan</button>
  <span style="font-size:12px;align-self:center;color:var(--gray-400)">Baseline bundel '${esc(baseBundle.label || ent.plan)}': ${baseBundle.modules.length} modules</span>
</div>`;
          // Bij bundelwissel: herlaad raster op die bundel-baseline (nog niet opgeslagen).
          document.getElementById("tPlan").addEventListener("change", e => {
            const nb = bundles.find(b => b.key === e.target.value) || { modules: [], submodules: {} };
            document.getElementById("tGrid").innerHTML = grid("t", nb.modules, nb.submodules || {}, { subs: false });
          });
          document.getElementById("tSave").addEventListener("click", async () => {
            const plan = document.getElementById("tPlan").value;
            const nb = bundles.find(b => b.key === plan) || { modules: [] };
            const chosen = readMods(ed, "t");
            const add = chosen.filter(k => !nb.modules.includes(k));
            const remove = nb.modules.filter(k => !chosen.includes(k));
            try {
              await api(`/api/admin/tenants/${tid}/modules`, { method: "PATCH", body: JSON.stringify({ plan, moduleOverrides: { add, remove } }) });
              window.showToast && window.showToast(`Modules van ${tenant.name} bijgewerkt ✓ (${add.length} extra, ${remove.length} ingetrokken)`, "success");
              editTenant(tid);
            } catch (e) { window.showToast && window.showToast(e.message, "error"); }
          });
        } catch (e) { ed.innerHTML = err(e); }
      }

      renderPanel();
    } catch (e) { content().innerHTML = err(e); }
  }

  // ══════════════════════════════════════════════════════════
  // VIEW: Instellingen
  // ══════════════════════════════════════════════════════════
  async function integrations() {
    const c = content(); c.innerHTML = loader();
    try {
      const [d, tint] = await Promise.all([
        api("/api/admin/integrations"),
        api("/api/admin/tenant-integrations").catch(() => ({ rows: [], total: 0, connected: 0 })),
      ]);
      const cfg = d.config || {};
      const statusPill = ok => ok ? badge("Geconfigureerd","badge-green") : badge("Dummy","badge-orange");
      c.innerHTML = `
<div class="sa-card">
  <div class="sa-card-head"><div class="sa-card-title">Integraties &amp; API-sleutels</div><div class="sa-card-sub">Beheer hier de echte sleutels. Standaard staan dummy-waarden ingesteld zodat niets crasht.</div></div>
  <div style="padding:16px;display:flex;flex-direction:column;gap:8px">
    <div style="font-size:12px;color:var(--wf-yellow);background:var(--wf-yellow-l);border:1px solid var(--wf-yellow-l);border-radius:8px;padding:10px 12px">
      Geheime sleutels worden gemaskeerd getoond. Laat een veld op de gemaskeerde waarde staan om het ongewijzigd te laten; typ een nieuwe waarde om te overschrijven.
    </div>
  </div>
</div>

<form id="saIntegrationsForm">
  <div class="sa-int-sec">Betalingen</div>
  <div class="sa-card">
    <div class="sa-card-head"><div class="sa-card-title">Stripe · betalingen</div><div class="sa-card-sub">${statusPill(cfg.stripe?.keyConfigured)} ${cfg.stripe?.mode?badge(cfg.stripe.mode==="live"?"LIVE":"SANDBOX", cfg.stripe.mode==="live"?"badge-green":"badge-blue"):""}</div></div>
    <div style="padding:16px;display:grid;gap:12px">
      <label class="sa-fld"><span>Actieve omgeving</span>
        <select name="stripe.mode" id="saStripeMode">
          <option value="test" ${cfg.stripe?.mode!=="live"?"selected":""}>Sandbox (testsleutels · geen echte betalingen)</option>
          <option value="live" ${cfg.stripe?.mode==="live"?"selected":""}>Live (echte betalingen)</option>
        </select>
      </label>
      <div style="font-size:11.5px;color:var(--gray-500);margin-top:-4px">Wissel hier tussen sandbox en live. Beide sleutelsets blijven bewaard · omschakelen is één klik, geen sleutels opnieuw invoeren.</div>

      <div style="font-size:11px;font-weight:600;color:var(--gray-500);border-bottom:1px solid var(--line);padding-bottom:5px;margin-top:2px">Sandbox-sleutels (test)</div>
      <label class="sa-fld"><span>Secret key (sk_test_…)</span><input name="stripe.testSecretKey" value="${esc(cfg.stripe?.testSecretKey||"")}" placeholder="sk_test_..." autocomplete="off"></label>
      <label class="sa-fld"><span>Publishable key (pk_test_…)</span><input name="stripe.testPublishableKey" value="${esc(cfg.stripe?.testPublishableKey||"")}" placeholder="pk_test_..." autocomplete="off"></label>
      <label class="sa-fld"><span>Webhook secret (test)</span><input name="stripe.testWebhookSecret" value="${esc(cfg.stripe?.testWebhookSecret||"")}" placeholder="whsec_..." autocomplete="off"></label>

      <div style="font-size:11px;font-weight:600;color:var(--gray-500);border-bottom:1px solid var(--line);padding-bottom:5px;margin-top:2px">Live-sleutels</div>
      <label class="sa-fld"><span>Secret key (sk_live_…)</span><input name="stripe.liveSecretKey" value="${esc(cfg.stripe?.liveSecretKey||"")}" placeholder="sk_live_..." autocomplete="off"></label>
      <label class="sa-fld"><span>Publishable key (pk_live_…)</span><input name="stripe.livePublishableKey" value="${esc(cfg.stripe?.livePublishableKey||"")}" placeholder="pk_live_..." autocomplete="off"></label>
      <label class="sa-fld"><span>Webhook secret (live)</span><input name="stripe.liveWebhookSecret" value="${esc(cfg.stripe?.liveWebhookSecret||"")}" placeholder="whsec_..." autocomplete="off"></label>
      <div style="font-size:11px;color:var(--gray-400)">Gemaskeerde waarden (••••) laten staan = sleutel behouden. Zie <a href="https://docs.stripe.com/keys" target="_blank" rel="noopener" style="color:var(--wf-blue)">docs.stripe.com/keys</a>.</div>
    </div>
  </div>

  <div class="sa-int-sec">E-facturatie (Peppol)</div>
  <div class="sa-card">
    <div class="sa-card-head"><div class="sa-card-title">Peppol · e-facturatie (BE)</div><div class="sa-card-sub">${statusPill(cfg.peppol?.configured)}</div></div>
    <div style="padding:16px;display:grid;gap:12px">
      <label class="sa-fld"><span>Provider</span>
        <select name="peppol.provider">
          ${["mock","billit","digiteal","unifiedpost"].map(p=>`<option value="${p}" ${cfg.peppol?.provider===p?"selected":""}>${p}</option>`).join("")}
        </select>
      </label>
      <label class="sa-fld"><span>API-sleutel</span><input name="peppol.apiKey" value="${esc(cfg.peppol?.apiKey||"")}" placeholder="peppol_..."></label>
    </div>
  </div>

  <div class="sa-int-sec">Communicatie</div>
  <div class="sa-card">
    <div class="sa-card-head"><div class="sa-card-title">E-mail · verzending</div><div class="sa-card-sub">${statusPill(cfg.email?.configured)}</div></div>
    <div style="padding:16px;display:grid;gap:12px">
      <label class="sa-fld"><span>Provider</span>
        <select name="email.provider">
          ${["log","resend","sendgrid"].map(p=>`<option value="${p}" ${cfg.email?.provider===p?"selected":""}>${p}</option>`).join("")}
        </select>
      </label>
      <label class="sa-fld"><span>API-sleutel</span><input name="email.apiKey" value="${esc(cfg.email?.apiKey||"")}" placeholder="re_... (Resend) / SG... (SendGrid)"></label>
      <label class="sa-fld"><span>Afzender</span><input name="email.from" value="${esc(cfg.email?.from||"")}" placeholder="Monargo One &lt;noreply@bedrijf.be&gt;"></label>
    </div>
  </div>

  <div class="sa-int-sec">Bedrijfsdata</div>
  <div class="sa-card">
    <div class="sa-card-head"><div class="sa-card-title">KBO · bedrijfsopzoeking</div><div class="sa-card-sub">${statusPill(cfg.kbo?.configured)}</div></div>
    <div style="padding:16px;display:grid;gap:12px">
      <label class="sa-fld"><span>Provider</span>
        <select name="kbo.provider">
          ${["mock","cbe-open-data"].map(p=>`<option value="${p}" ${cfg.kbo?.provider===p?"selected":""}>${p}</option>`).join("")}
        </select>
      </label>
      <label class="sa-fld"><span>API-sleutel (optioneel)</span><input name="kbo.apiKey" value="${esc(cfg.kbo?.apiKey||"")}" placeholder="optioneel"></label>
    </div>
  </div>

  <div class="sa-int-sec">Compliance (BE bouw)</div>
  <div class="sa-card">
    <div class="sa-card-head"><div class="sa-card-title">Checkin@Work (CIAW) + Limosa · RSZ-gateway</div><div class="sa-card-sub">${statusPill(cfg.ciaw?.configured)}</div></div>
    <div style="padding:16px;display:grid;gap:12px">
      <div style="font-size:12px;color:var(--gray-500);font-weight:400">Deze RSZ-gateway dekt <strong>zowel de Checkin@Work-aanwezigheidsaangiftes als de Limosa-meldingen</strong>. Zonder live provider draait alles in mock-modus. Het RSZ-werkgeversnummer stelt elke klant zelf in (Compliance → Checkin@Work).</div>
      <label class="sa-fld"><span>Provider</span>
        <select name="ciaw.provider">
          ${["mock","rsz"].map(p=>`<option value="${p}" ${cfg.ciaw?.provider===p?"selected":""}>${p}</option>`).join("")}
        </select>
      </label>
      <label class="sa-fld"><span>API-sleutel</span><input name="ciaw.apiKey" value="${esc(cfg.ciaw?.apiKey||"")}" placeholder="ciaw_..."></label>
      <label class="sa-fld"><span>API-host</span><input name="ciaw.baseHost" value="${esc(cfg.ciaw?.baseHost||"")}" placeholder="api.checkinatwork.be"></label>
    </div>
  </div>

  <div class="sa-int-sec">AI-assistent</div>
  <div class="sa-card">
    <div class="sa-card-head"><div class="sa-card-title">Mona · slimme assistent (OpenAI)</div><div class="sa-card-sub">${statusPill(cfg.openai?.configured)}</div></div>
    <div style="padding:16px;display:grid;gap:12px">
      <div style="font-size:12px;color:var(--gray-500);font-weight:400">Zonder echte sleutel draait Mona in <strong>gratis demo-modus</strong> met gesimuleerde antwoorden voor QA. Vul de OpenAI-sleutel in om de echte AI te activeren. Mona respecteert altijd de rechten van de ingelogde gebruiker.</div>
      <label class="sa-fld"><span>OpenAI API-sleutel</span><input name="openai.apiKey" value="${esc(cfg.openai?.apiKey||"")}" placeholder="sk-..."></label>
      <label class="sa-fld"><span>Model</span><input name="openai.model" value="${esc(cfg.openai?.model||"")}" placeholder="bv. gpt-4o-mini of gpt-4o"></label>
    </div>
  </div>

  <div style="display:flex;gap:10px;align-items:center;margin:4px 0 24px">
    <button type="submit" class="sa-btn btn-primary">Opslaan</button>
    <span id="saIntStatus" style="font-size:13px"></span>
  </div>
</form>

<div class="sa-card" style="margin-top:8px">
  <div class="sa-card-head"><div class="sa-card-title">Klant-koppelingen (alleen-lezen)</div><div class="sa-card-sub">${(tint.connected||0)}/${(tint.total||0)} verbonden · eigen ERP/boekhouding van klanten · beheerd door de klant zelf</div></div>
  <div class="sa-tbl-wrap"><table class="sa-tbl"><thead><tr><th>Tenant</th><th>Koppeling</th><th>Status</th><th>Sleutel</th><th>Laatste sync</th></tr></thead><tbody>
    ${(tint.rows||[]).map(r => `<tr><td>${esc(r.tenant)}</td><td>${esc(r.provider)}</td><td>${esc(r.status)}</td><td>${r.hasSecret?badge("ingesteld","badge-green"):badge("geen","badge-gray")}</td><td style="font-size:12px;color:var(--gray-500)">${r.lastSyncAt?fmtDT(r.lastSyncAt):"-"}</td></tr>`).join("") || "<tr><td colspan=5 style='color:var(--gray-500);padding:14px'>Nog geen klant-koppelingen. Klanten verbinden hun ERP via hun eigen Koppelingen-scherm.</td></tr>"}
  </tbody></table></div>
</div>
<style>
.sa-int-sec{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--gray-500);margin:20px 4px 8px;padding-top:6px;border-top:1px solid var(--gray-100)}
.sa-int-sec:first-of-type{border-top:none;margin-top:4px;padding-top:0}
.sa-fld{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:600;color:var(--gray-700)}
.sa-fld input,.sa-fld select{padding:9px 11px;border:1.5px solid var(--gray-200);border-radius:8px;font-size:13px;font-family:inherit;font-weight:400}
.sa-fld input:focus,.sa-fld select:focus{outline:none;border-color:var(--wf-blue);box-shadow:0 0 0 3px rgba(37,99,235,.12)}
</style>`;

      document.getElementById("saIntegrationsForm").addEventListener("submit", async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const body = { stripe:{}, peppol:{}, email:{}, kbo:{}, ciaw:{}, openai:{} };
        for (const [k,v] of fd.entries()) { const [s,f]=k.split("."); if(body[s]) body[s][f]=v; }
        const st = document.getElementById("saIntStatus");
        st.textContent = "Opslaan…"; st.style.color = "var(--gray-500)";
        try {
          await api("/api/admin/integrations", { method:"PUT", body: JSON.stringify(body) });
          st.textContent = "✓ Opgeslagen"; st.style.color = "var(--wf-green)";
          setTimeout(() => integrations(), 700);
        } catch(err) { st.textContent = "Fout: "+err.message; st.style.color = "var(--wf-red)"; }
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
        <div class="sa-detail-row"><span class="sa-detail-label">Applicatie</span><span class="sa-detail-value">${esc(hd.app||"Monargo One")}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Versie</span><span class="sa-detail-value">${esc(hd.version||"-")}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Release channel</span><span class="sa-detail-value">${badge(hd.releaseChannel||"dev", hd.releaseChannel==="production"?"badge-green":"badge-orange")}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Commit SHA</span><span class="sa-detail-value mono">${esc((hd.commitSha||"local").slice(0,12))}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Opslag adapter</span><span class="sa-detail-value">${badge(hd.storageAdapter||"json", hd.storageAdapter==="postgres"?"badge-green":"badge-blue")}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Server uptime</span><span class="sa-detail-value">${fmtUptime(hd.uptime||0)}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Modules</span><span class="sa-detail-value">${hd.modules||"-"}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Tijd server</span><span class="sa-detail-value mono" style="font-size:11px">${esc(hd.time||"")}</span></div>
      </div>
    </div>
  </div>

  <div class="sa-card">
    <div class="sa-card-head"><div class="sa-card-title">Release info</div></div>
    <div style="padding:16px">
      <div class="sa-detail">
        <div class="sa-detail-row"><span class="sa-detail-label">Versie</span><span class="sa-detail-value">${esc(rel2.version||"-")}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Channel</span><span class="sa-detail-value">${esc(rel2.channel||"-")}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Commit</span><span class="sa-detail-value mono">${esc(rel2.commitSha||"-")}</span></div>
        <div class="sa-detail-row"><span class="sa-detail-label">Build at</span><span class="sa-detail-value">${fmtDT(rel2.builtAt)}</span></div>
      </div>
    </div>
  </div>
</div>

<div class="sa-card">
  <div class="sa-card-head"><div class="sa-card-title">Beveiliging · MFA verplichten</div></div>
  <div style="padding:16px">
    <p style="font-size:13px;color:var(--gray-500);margin:0 0 12px">Schakelt 2FA in voor álle beheerders (tenant-admins + super-admins) die nog geen MFA hebben. Bij hun volgende login is een authenticator-code vereist. De secrets en recovery codes worden hieronder éénmalig getoond.</p>
    <button id="saMfaEnforce" class="sa-btn btn-primary">MFA verplichten voor alle beheerders</button>
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
        if (!confirm("MFA verplicht maken voor álle beheerders?\n\nBij de volgende login is een authenticator-code vereist. Bewaar de getoonde secrets en recovery codes · ze worden maar één keer getoond.")) return;
        const btn = document.getElementById("saMfaEnforce");
        const out = document.getElementById("saMfaResult");
        btn.disabled = true; btn.textContent = "Bezig…";
        try {
          const d = await api("/api/admin/mfa/enforce", { method: "POST", body: "{}" });
          const enrolled = d.enrolled || [];
          if (!enrolled.length) {
            out.innerHTML = `<div style="color:var(--wf-green);font-weight:600;font-size:13px">Alle beheerders hebben al MFA actief.</div>`;
            btn.textContent = "MFA verplichten voor alle beheerders"; btn.disabled = false;
            return;
          }
          out.innerHTML = `
<div style="font-size:12px;color:var(--wf-yellow);background:var(--wf-yellow-l);border:1px solid var(--wf-yellow-l);border-radius:8px;padding:10px 12px;margin-bottom:10px">
  Bewaar onderstaande gegevens nu. Ze worden niet opnieuw getoond. Voeg de sleutel toe aan een authenticator-app.
</div>
${enrolled.map(e => `
  <div style="border:1px solid var(--gray-200);border-radius:10px;padding:12px;margin-bottom:10px">
    <div style="font-weight:600;font-size:13px;color:var(--gray-900);margin-bottom:6px">${esc(e.name||e.email)} <span style="color:var(--gray-400);font-weight:400">· ${esc(e.email)}</span></div>
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="flex:1;min-width:180px">
        <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.4px">Geheime sleutel</div>
        <div class="mono" style="background:var(--gray-100);padding:6px 10px;border-radius:6px;font-size:12px;word-break:break-all;margin:3px 0 8px">${esc(e.secret||"")}</div>
        <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.4px">Recovery codes</div>
        <div class="mono" style="font-size:11.5px;color:var(--gray-700);line-height:1.7">${(e.recoveryCodes||[]).map(c=>esc(c)).join(" &nbsp; ")}</div>
      </div>
    </div>
  </div>`).join("")}
<div style="color:var(--wf-green);font-weight:600;font-size:13px;margin-top:4px">${enrolled.length} beheerder(s) ingeschreven · Foundation-MFA voldaan.</div>`;
          btn.textContent = "Ingeschreven ✓";
        } catch(e) {
          out.innerHTML = `<div style="color:var(--wf-red);font-size:13px">Fout: ${esc(e.message)}</div>`;
          btn.textContent = "MFA verplichten voor alle beheerders"; btn.disabled = false;
        }
      });
    } catch(e) { content().innerHTML = err(e); }
  }

  function checklist(items) {
    return items.map(([ok, label]) => `
    <div style="display:flex;align-items:center;gap:10px;font-size:13px;padding:6px 10px;background:${ok?"var(--wf-green-l)":"var(--wf-red-l)"};border-radius:7px;border:1px solid ${ok?"var(--wf-green-l)":"var(--wf-red-l)"}">
      <span style="font-size:16px">${ok?"":""}</span>
      <span style="color:${ok?"var(--wf-green)":"var(--wf-red)"}">${label}</span>
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
  function loader()   { return `<div class="sa-loader">${tS("adm.loading","Laden…")}</div>`; }
  function err(e)     { return `<div class="sa-error">${esc(e.message)}</div>`; }
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
