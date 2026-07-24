/* ── Werkbonnen · schermmodule uit admin.js ───────────────────────
 * Een-op-een extractie van de view "workorders" uit public/js/platforms/admin.js.
 * Meeverhuisd omdat het UITSLUITEND van dit scherm is: de filterstand
 * (_woFilterStatus/_woFilterUser/_woFilterSearch), woBillable en tWoPrio.
 * De code is LETTERLIJK overgenomen · geen gedragswijziging, geen opruiming.
 *
 * Wat gedeeld is met andere schermen blijft in de kern en wordt hier uit
 * window.wfpAdmin gelezen: uName, tWoStatus, uiConfirm en openWorkorderDrawer.
 * Die staan er nog NIET op; admin.js moet ze exposeren voor dit bestand werkt.
 * Kopieren is geen alternatief · dan zijn er twee waarheden.
 */
(function () {
  "use strict";
  const A = window.wfpAdmin;
  if (!A) return;

  // Wel al gedeeld via de kern.
  const api = A.api;
  const esc = A.esc;
  const switchView = A.switchView;

  // Nog NIET gedeeld via de kern · zie het rapport (risico). Bewust geen
  // lokale kopie: deze helpers horen op een plek te staan.
  const uName = A.uName;
  const tWoStatus = A.tWoStatus;
  const uiConfirm = A.uiConfirm;
  const openWorkorderDrawer = A.openWorkorderDrawer;

  // i18n-shim, identiek aan admin.js en admin-domains.js: leest dezelfde
  // globale woordenlijst window.wfpI18n, dus geen tweede waarheid.
  function tA(key, fallback) { return window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback; }

  // Werkbon-prioriteit vertalen (alleen dit scherm gebruikt dit).
  function tWoPrio(p) {
    const k = String(p || "normaal").toLowerCase();
    const map = { hoog: "adm.wo.prioHigh", normaal: "adm.wo.prioNormal", laag: "adm.wo.prioLow" };
    return map[k] ? tA(map[k], p || "normaal") : (p || "normaal");
  }

  let _woFilterStatus = "";
  let _woFilterUser   = "";
  let _woFilterSearch = "";

  // Toont de "→ Factuur"-knop enkel als er iets factureerbaars is (uren of vast
  // bedrag) en de werkbon nog niet gefactureerd is. De server valideert het tarief.
  function woBillable(w) {
    if (w.invoiceId) return false;
    const fixed = w.billableAmount ?? w.fixedPrice;
    if (fixed != null && Number(fixed) > 0) return true;
    if (Number(w.billableHours ?? w.clockedHours ?? w.hours ?? 0) > 0) return true;
    return Array.isArray(w.materials) && w.materials.some(m => Number(m.qty) > 0 && Number(m.unitPrice) > 0);
  }

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
    <h3 class="adm-card-title">${(window.wfpTerms && window.wfpTerms.t("jobPlural")) || tA("nav.workorders","Werkbonnen")}
      <span style="background:var(--wf-blue-l);color:var(--wf-blue);border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${workorders.length}/${allWorkorders.length}</span>
    </h3>
    <button class="adm-btn adm-btn-primary adm-btn-sm" id="admNewWO">+ ${(window.wfpTerms && window.wfpTerms.t("jobSingular")) || tA("emp.wo.default","Werkbon")}</button>
  </div>

  <!-- Filter bar -->
  <div style="display:flex;gap:10px;flex-wrap:wrap;padding:0 20px 14px;border-bottom:1px solid var(--gray-100);">
    <input id="admWoSearch" type="search" placeholder="${tA("adm.wo.searchPh","Zoek op titel / klant…")}" value="${esc(_woFilterSearch)}"
      style="flex:1;min-width:160px;10px">
    <select id="admWoStatusFilter" style="min-width:140px">
      <option value="">${tA("adm.allStatuses","Alle statussen")}</option>
      <option value="open"        ${_woFilterStatus==="open"?"selected":""}>${tA("dash.woseg.open","Open")} (${statusCounts.open||0})</option>
      <option value="in_progress" ${_woFilterStatus==="in_progress"?"selected":""}>${tA("dash.woseg.inprog","In uitvoering")} (${statusCounts.in_progress||0})</option>
      <option value="done"        ${_woFilterStatus==="done"?"selected":""}>${tA("dash.woseg.done","Voltooid")} (${doneCount})</option>
      <option value="geannuleerd" ${_woFilterStatus==="geannuleerd"?"selected":""}>${tA("dash.woseg.cancelled","Geannuleerd")} (${statusCounts.geannuleerd||0})</option>
    </select>
    <select id="admWoUserFilter" style="min-width:160px">
      <option value="">${tA("adm.wo.allEmployees","Alle medewerkers")}</option>
      ${employees.map(u => `<option value="${esc(u.id)}" ${_woFilterUser===u.id?"selected":""}>${esc(u.name||u.email)}</option>`).join("")}
    </select>
    ${(_woFilterStatus||_woFilterUser||_woFilterSearch) ? `<button class="adm-btn adm-btn-secondary adm-btn-sm" id="admWoClearFilter" style="white-space:nowrap;">${tA("adm.wo.clearFilters","Wis filters")}</button>` : ""}
  </div>

  <div class="adm-card-body adm-table-wrap">
    <table class="adm-table">
      <thead><tr><th>#</th><th>${tA("adm.thTitle","Titel")}</th><th>${tA("adm.thEmployee","Medewerker")}</th><th>${tA("adm.thCustomer","Klant")}</th><th>${tA("adm.status","Status")}</th><th>${tA("adm.thPriority","Prioriteit")}</th><th>${tA("adm.date","Datum")}</th><th>${tA("adm.actions","Acties")}</th></tr></thead>
      <tbody>
        ${workorders.map(w => `
        <tr class="adm-row-link adm-wo-row" data-id="${w.id}" title="Open werkbon">
          <td style="font-family:monospace;font-size:12px;">${w.number || w.id.slice(-4)}</td>
          <td>${esc(w.title || "-")}</td>
          <td>${esc(uName(w) || "-")}</td>
          <td>${esc(w.clientName || "-")}</td>
          <td><span class="adm-status adm-status-${(w.status||"").toLowerCase().replace(/\s/g,"-")}">${esc(tWoStatus(w.status))}</span></td>
          <td><span style="font-size:12px;">${w.priority==="hoog"?'<span class="adm-dot" style="background:var(--wf-red)"></span>':w.priority==="laag"?'<span class="adm-dot" style="background:var(--wf-green)"></span>':'<span class="adm-dot" style="background:var(--wf-yellow)"></span>'} ${esc(tWoPrio(w.priority))}</span></td>
          <td>${w.scheduledDate || w.createdAt?.slice(0,10) || "-"}</td>
          <td style="white-space:nowrap;">
            ${w.invoiceId
              ? `<span style="font-size:11px;color:var(--wf-green);font-weight:600;">✓ ${tA("adm.wo.invoiced","gefactureerd")}</span>`
              : (woBillable(w) ? `<button class="adm-btn adm-btn-success adm-btn-sm adm-wo-invoice" data-id="${w.id}" title="Maak factuur van deze werkbon">→ ${tA("adm.wo.toInvoice","Factuur")}</button>` : "")}
            <button class="adm-btn adm-btn-secondary adm-btn-sm adm-wo-edit" data-id="${w.id}">${tA("adm.edit","Bewerken")}</button>
          </td>
        </tr>`).join("") || `<tr><td colspan="8" class="adm-empty">${_woFilterStatus||_woFilterUser||_woFilterSearch ? tA("adm.wo.noResults","Geen resultaten voor deze filters") : `${tA("adm.wo.emptyTitle","Nog geen werkbonnen.")}<br><button class="adm-btn adm-btn-primary adm-btn-sm" id="admEmptyNewWO" style="margin-top:10px">+ ${tA("adm.wo.emptyBtn","Eerste werkbon aanmaken")}</button>`}</td></tr>`}
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
    document.getElementById("admEmptyNewWO")?.addEventListener("click", () => openWorkorderDrawer(null, allWorkorders));
    document.querySelectorAll(".adm-wo-edit").forEach(btn => {
      btn.addEventListener("click", e => { e.stopPropagation(); openWorkorderDrawer(allWorkorders.find(w => w.id === btn.dataset.id), allWorkorders); });
    });
    document.querySelectorAll(".adm-wo-invoice").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        if (!await uiConfirm("De geklokte of factureerbare uren, of het vaste bedrag, worden overgenomen in een nieuwe klantfactuur.", { title: "Factuur maken van deze werkbon", confirmLabel: "Factuur aanmaken" })) return;
        try {
          const d = await api("POST", `/workorders/${btn.dataset.id}/invoice`, {});
          window.showToast && window.showToast(`Factuur ${d.invoice?.number || ""} aangemaakt`, "success");
          switchView("facturen");
        } catch (err) {
          window.showToast && window.showToast(err.message || "Factureren mislukt", "error");
        }
      });
    });
    document.querySelectorAll(".adm-wo-row").forEach(row => {
      row.addEventListener("click", () => openWorkorderDrawer(allWorkorders.find(w => w.id === row.dataset.id), allWorkorders));
    });
  }

  A.views = A.views || {};
  A.views.workorders = renderWorkorders;
}());
