/* ── 360°-dossiers · module-samenhang zichtbaar (#76, frontend) ──────────────
 * Zelfstandige view-renderer (window.wfpAdmin.views.dossiers). Kies een project
 * of klant en zie ALLE modulesporen in één dossier: counts, een saldo-/finance-
 * overzicht en één chronologische tijdlijn over de modules heen. Praat met de
 * bestaande endpoints GET projects/:id/dossier en customers/:id/dossier. Puur
 * additief: eigen bestand + één nav-item + één scripttag.
 */
(function () {
  "use strict";
  const A = window.wfpAdmin;
  if (!A) return;
  const esc = A.esc || (s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  const val = v => (typeof v === "function" ? v() : v);

  async function apiCall(path) {
    const tid = val(A.tenantId);
    const tok = val(A.token) || localStorage.getItem("wfp_token") || "";
    const res = await fetch(`/api/tenants/${tid}${path}`, { headers: { Authorization: "Bearer " + tok } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Actie mislukt"), { status: res.status, data });
    return data;
  }

  const MODULE_LABEL = {
    projects: "Project", quotes: "Offerte", invoices: "Factuur", payments: "Betaling",
    planning: "Planning", workorders: "Werkbon", changeOrders: "Meerwerk", worksites: "Werf",
    appointments: "Afspraak", incidents: "Werkongeval", contracts: "Contract", progressClaims: "Vorderingsstaat",
  };
  const COUNT_LABEL = {
    quotes: "Offertes", worksites: "Werven", planning: "Planning", workorders: "Werkbonnen",
    changeOrders: "Meerwerk", invoices: "Facturen", payments: "Betalingen", progressClaims: "Vorderingsstaten",
    appointments: "Afspraken", incidents: "Werkongevallen", expenses: "Onkosten", projects: "Projecten", contracts: "Contracten",
  };

  function eur(n) { return "€ " + Number(n || 0).toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "short", year: "numeric" }).format(d);
  }

  function chips(counts) {
    return Object.entries(counts || {}).filter(([, v]) => v > 0)
      .map(([k, v]) => `<span class="dos-chip"><b>${v}</b> ${esc(COUNT_LABEL[k] || k)}</span>`).join("") || `<span class="dos-empty">Nog geen gekoppelde records.</span>`;
  }

  function timeline(items) {
    if (!items || !items.length) return `<div class="dos-empty">Nog geen tijdlijn.</div>`;
    return `<ol class="dos-tl">${items.map(e => `
      <li class="dos-tl-item">
        <div class="dos-tl-dot"></div>
        <div class="dos-tl-body">
          <div class="dos-tl-top"><span class="dos-tl-mod">${esc(MODULE_LABEL[e.module] || e.module)}</span><span class="dos-tl-date">${esc(fmtDate(e.at))}</span></div>
          <div class="dos-tl-title">${esc(e.title || e.type)}</div>
        </div>
      </li>`).join("")}</ol>`;
  }

  function financeBlock(d, kind) {
    if (kind === "customer" && d.balance) {
      const b = d.balance;
      return `<div class="dos-fin">
        <div class="dos-fin-cell"><small>Gefactureerd</small><strong>${eur(b.invoiced)}</strong></div>
        <div class="dos-fin-cell"><small>Betaald</small><strong>${eur(b.paid)}</strong></div>
        <div class="dos-fin-cell ${b.outstanding > 0 ? "dos-open" : ""}"><small>Openstaand</small><strong>${eur(b.outstanding)}</strong></div>
      </div>`;
    }
    if (kind === "project" && d.finance && d.finance.budget) {
      const f = d.finance;
      return `<div class="dos-fin">
        <div class="dos-fin-cell"><small>Budget</small><strong>${eur(f.budget.total)}</strong></div>
        <div class="dos-fin-cell"><small>Gefactureerd</small><strong>${eur(f.invoiced && f.invoiced.total)}</strong></div>
        ${f.actual && f.actual.labor ? `<div class="dos-fin-cell"><small>Arbeid</small><strong>${Number(f.actual.labor.hours || 0)} u</strong></div>` : ""}
      </div>`;
    }
    return "";
  }

  function styles() {
    if (document.getElementById("dos-styles")) return "";
    return `<style id="dos-styles">
      .dos-wrap{max-width:900px}
      .dos-picker{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
      .dos-seg{display:inline-flex;border:1px solid var(--wf-border,#e5e9f0);border-radius:9px;overflow:hidden}
      .dos-seg button{border:0;background:var(--wf-surface,#fff);padding:7px 14px;font:600 13px system-ui;cursor:pointer;color:var(--wf-muted,#64748b)}
      .dos-seg button.active{background:var(--wf-primary,#0071E3);color:#fff}
      .dos-select{flex:1;min-width:220px;border:1px solid var(--wf-border,#e5e9f0);border-radius:9px;padding:8px 10px;font:inherit}
      .dos-card{background:var(--wf-surface,#fff);border:1px solid var(--wf-border,#e5e9f0);border-radius:14px;padding:18px}
      .dos-head h3{margin:0;font:600 17px system-ui}
      .dos-head .dos-sub{color:var(--wf-muted,#64748b);font-size:13px;margin:2px 0 0}
      .dos-fin{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
      .dos-fin-cell{flex:1;min-width:120px;background:var(--wf-chip,#f4f7fb);border-radius:10px;padding:10px 12px}
      .dos-fin-cell small{display:block;color:var(--wf-muted,#64748b);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
      .dos-fin-cell strong{font-size:16px}
      .dos-fin-cell.dos-open strong{color:var(--wf-red,#c0392b)}
      .dos-chips{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}
      .dos-chip{background:var(--wf-chip,#eef2f8);border-radius:20px;padding:3px 10px;font-size:12px;color:#334155}
      .dos-chip b{color:var(--wf-primary,#0071E3)}
      .dos-sec{margin:16px 0 6px;font:600 12px system-ui;text-transform:uppercase;letter-spacing:.04em;color:var(--wf-muted,#64748b)}
      .dos-tl{list-style:none;margin:0;padding:0;position:relative}
      .dos-tl:before{content:"";position:absolute;left:6px;top:4px;bottom:4px;width:2px;background:var(--wf-border,#e5e9f0)}
      .dos-tl-item{position:relative;padding:0 0 14px 24px}
      .dos-tl-dot{position:absolute;left:0;top:4px;width:14px;height:14px;border-radius:50%;background:#fff;border:3px solid var(--wf-primary,#0071E3)}
      .dos-tl-top{display:flex;gap:8px;align-items:baseline}
      .dos-tl-mod{font:600 11px system-ui;text-transform:uppercase;letter-spacing:.03em;color:var(--wf-primary,#0071E3)}
      .dos-tl-date{color:var(--wf-muted,#94a3b8);font-size:12px}
      .dos-tl-title{font-size:14px;color:var(--wf-text,#0b1320)}
      .dos-empty{color:var(--wf-muted,#94a3b8);font-size:13px;padding:6px 0}
      .dos-msg.err{color:var(--wf-red,#c0392b);font-size:13px}
    </style>`;
  }

  let _kind = "project";

  async function render() {
    const content = A.content();
    if (!content) return;
    content.innerHTML = `${styles()}<div class="dos-wrap">
      <div class="dos-picker">
        <div class="dos-seg">
          <button data-kind="project" class="${_kind === "project" ? "active" : ""}">Projecten</button>
          <button data-kind="customer" class="${_kind === "customer" ? "active" : ""}">Klanten</button>
        </div>
        <select class="dos-select" id="dosSelect"><option value="">Laden…</option></select>
      </div>
      <div id="dosView"><div class="dos-empty">Kies een ${_kind === "project" ? "project" : "klant"} om het 360°-dossier te zien.</div></div>
    </div>`;

    content.querySelectorAll(".dos-seg button").forEach(b => b.addEventListener("click", () => { _kind = b.dataset.kind; render(); }));

    // Vul de picker.
    const sel = content.querySelector("#dosSelect");
    try {
      if (_kind === "project") {
        const d = await apiCall("/projects");
        const list = d.projects || d.rows || [];
        sel.innerHTML = `<option value="">Kies een project…</option>` + list.map(p => `<option value="${esc(p.id)}">${esc((p.number ? p.number + " · " : "") + (p.name || p.id))}</option>`).join("");
      } else {
        const d = await apiCall("/customers");
        const list = d.customers || d.rows || [];
        sel.innerHTML = `<option value="">Kies een klant…</option>` + list.map(c => `<option value="${esc(c.id)}">${esc(c.name || c.id)}</option>`).join("");
      }
    } catch (e) {
      sel.innerHTML = `<option value="">Kon lijst niet laden</option>`;
    }
    sel.addEventListener("change", () => sel.value && loadDossier(sel.value));
  }

  async function loadDossier(id) {
    const view = document.getElementById("dosView");
    if (!view) return;
    view.innerHTML = `<div class="adm-loading">Dossier laden…</div>`;
    try {
      const path = _kind === "project" ? `/projects/${encodeURIComponent(id)}/dossier` : `/customers/${encodeURIComponent(id)}/dossier`;
      const d = (await apiCall(path)).dossier;
      const subject = _kind === "project" ? d.project : d.customer;
      const title = _kind === "project" ? ((subject.number ? subject.number + " · " : "") + (subject.name || "")) : (subject.name || "");
      view.innerHTML = `<div class="dos-card">
        <div class="dos-head"><h3>${esc(title)}</h3><p class="dos-sub">360°-dossier · alle modulesporen op één plek</p></div>
        ${financeBlock(d, _kind)}
        <div class="dos-chips">${chips(d.counts)}</div>
        <div class="dos-sec">Tijdlijn</div>
        ${timeline(d.timeline)}
      </div>`;
    } catch (e) {
      view.innerHTML = `<div class="dos-msg err">Kon dossier niet laden: ${esc(e.message)}</div>`;
    }
  }

  A.views = A.views || {};
  A.views.dossiers = render;
  if (A.VIEW_LABELS) A.VIEW_LABELS.dossiers = "360°-dossiers";
}());
