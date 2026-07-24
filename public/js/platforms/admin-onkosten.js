/* ── Onkosten · uitgesplitst schermmodule (strangler-extractie) ──────────────
 * Letterlijke verplaatsing van het onkostenscherm uit
 * public/js/platforms/admin.js (renderExpenses + de tabelbouwer, de
 * werkbon-koppelmodal en de beoordelingsmodal). De code is NIET herschreven:
 * alleen de omhulling veranderde. Wat het scherm met andere schermen deelt
 * (esc, api, uName) blijft in admin.js staan en wordt hier via window.wfpAdmin
 * opgehaald · nooit gekopieerd, want twee waarheden lopen uit elkaar zodra
 * iemand er één aanpast.
 */
(function () {
  "use strict";
  const A = window.wfpAdmin;
  if (!A) return;
  const esc = A.esc;
  const api = A.api;

  // i18n leest de globale woordenlijst, precies zoals admin.js en
  // admin-verlof.js het doen. De sleutels blijven in de i18n-bundel; dit is
  // een lezer, geen tweede waarheid.
  function tA(key, fallback) { return window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback; }

  // Gedeelde helper · blijft in admin.js (dashboard, rapporten, prikklok en
  // werkbonnen gebruiken hem ook) en wordt hier alleen doorgegeven. Laat
  // opgezocht, zodat de volgorde van de scripttags niet uitmaakt.
  const uName = rec => A.uName(rec);

  async function renderExpenses() {
    const data = await api("GET", "/expenses");
    const expenses = data.expenses || data || [];
    // Werkbonnen voor de koppel-kolom (doorrekenen aan klant via werkbon-factuur).
    const woData = await api("GET", "/workorders").catch(() => ({ workorders: [] }));
    const allWos = woData.workorders || [];
    const woById = Object.fromEntries(allWos.map(w => [w.id, w]));

    const pending   = expenses.filter(e => ["pending","ingediend"].includes(e.status));
    const approved  = expenses.filter(e => ["goedgekeurd","approved"].includes(e.status));
    const rejected  = expenses.filter(e => e.status === "geweigerd");
    const totalPend = pending.reduce((s,e) => s+Number(e.amount||0), 0);
    const totalAppr = approved.reduce((s,e) => s+Number(e.amount||0), 0);
    const fmtE = n => new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n);

    const content = document.getElementById("admContent");
    content.innerHTML = `
<div class="adm-kpis" style="margin-bottom:14px;">
  <div class="adm-kpi adm-kpi-amber">
    <div class="adm-kpi-label">${tA("adm.exp.fPending","In behandeling")}</div>
    <div class="adm-kpi-value">${pending.length}</div>
    <div class="adm-kpi-sub">${fmtE(totalPend)}</div>
  </div>
  <div class="adm-kpi adm-kpi-green">
    <div class="adm-kpi-label">${tA("emp.status.goedgekeurd","Goedgekeurd")}</div>
    <div class="adm-kpi-value">${approved.length}</div>
    <div class="adm-kpi-sub">${fmtE(totalAppr)}</div>
  </div>
  <div class="adm-kpi adm-kpi-red">
    <div class="adm-kpi-label">${tA("emp.status.geweigerd","Geweigerd")}</div>
    <div class="adm-kpi-value">${rejected.length}</div>
    <div class="adm-kpi-sub">${tA("adm.exp.claims","declaraties")}</div>
  </div>
  <div class="adm-kpi adm-kpi-blue">
    <div class="adm-kpi-label">${tA("adm.exp.totalSubmitted","Totaal ingediend")}</div>
    <div class="adm-kpi-value">${expenses.length}</div>
    <div class="adm-kpi-sub">${tA("adm.exp.allStatusesSub","alle statussen")}</div>
  </div>
</div>
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">${tA("adm.exp.title","Onkostennota's")} <span style="background:var(--wf-blue-l);color:var(--wf-blue);border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${expenses.length}</span></h3>
    <select id="admExpFilter">
      <option value="">${tA("adm.allStatuses","Alle statussen")}</option>
      <option value="ingediend">${tA("adm.exp.fPending","In behandeling")}</option>
      <option value="goedgekeurd">${tA("emp.status.goedgekeurd","Goedgekeurd")}</option>
      <option value="geweigerd">${tA("emp.status.geweigerd","Geweigerd")}</option>
    </select>
  </div>
  <div class="adm-card-body adm-table-wrap" id="admExpTable"></div>
</div>`;

    function buildExpRows(rows) {
      if (!rows.length) return `<div class="adm-empty">${tA("adm.exp.none","Geen onkosten gevonden")}</div>`;
      return `<table class="adm-table">
        <thead><tr><th>${tA("adm.thEmployee","Medewerker")}</th><th>${tA("adm.date","Datum")}</th><th>${tA("adm.thCategory","Categorie")}</th><th>${tA("adm.amount","Bedrag")}</th><th>${tA("adm.thDescription","Omschrijving")}</th><th>${tA("adm.thWorkorder","Werkbon")}</th><th>${tA("adm.status","Status")}</th><th>${tA("adm.actions","Acties")}</th></tr></thead>
        <tbody>${rows.map(e => {
          const wo = e.workorderId ? woById[e.workorderId] : null;
          const woCell = e.invoiceId
            ? `<span class="adm-status adm-status-paid" title="Doorgerekend op factuur">op factuur</span>`
            : wo
              ? `${esc(wo.number || wo.title || e.workorderId)}${e.billable === false ? ' <span style="font-size:10.5px;color:var(--gray-400);" title="Wordt niet doorgerekend aan de klant">niet doorrekenen</span>' : ""}`
              : "-";
          return `<tr>
          <td>${esc(uName(e))}</td>
          <td>${esc(e.date)}</td>
          <td>${esc(e.category||"-")}</td>
          <td style="font-weight:600;">€ ${Number(e.amount||0).toFixed(2)}</td>
          <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(e.description||"")}">${esc(e.description||"-")}</td>
          <td style="white-space:nowrap;font-size:12px;">${woCell}</td>
          <td>
            <span class="adm-status adm-status-${e.status}">${esc(e.status)}</span>
            ${e.reviewNote ? `<div style="font-size:11px;color:var(--gray-500);margin-top:2px;" title="${esc(e.reviewNote)}">${esc(e.reviewNote.slice(0,30))}${e.reviewNote.length>30?"…":""}</div>` : ""}
          </td>
          <td style="white-space:nowrap;">${["pending","ingediend"].includes(e.status) ? `
            <button class="adm-btn adm-btn-success adm-btn-sm adm-exp-review" data-id="${e.id}" data-dec="goedgekeurd" data-name="${esc(uName(e))}" data-amount="${e.amount}" data-cat="${esc(e.category||"")}">Goed</button>
            <button class="adm-btn adm-btn-danger  adm-btn-sm adm-exp-review" data-id="${e.id}" data-dec="geweigerd"  data-name="${esc(uName(e))}" data-amount="${e.amount}" data-cat="${esc(e.category||"")}">Weigeren</button>
          ` : ""}
          ${!e.invoiceId ? `<button class="adm-btn adm-btn-secondary adm-btn-sm adm-exp-link" data-id="${e.id}" style="margin-left:4px;">Werkbon</button>` : ""}</td>
        </tr>`;}).join("")}</tbody>
      </table>`;
    }

    // Werkbon koppelen/wijzigen + doorreken-vlag (billable) per onkost.
    function openExpenseLinkModal(expId, refresh) {
      const e = expenses.find(x => x.id === expId);
      if (!e) return;
      let modal = document.getElementById("admExpLinkModal");
      if (!modal) {
        modal = document.createElement("div");
        modal.id = "admExpLinkModal";
        modal.style.cssText = "position:fixed;inset:0;background:rgba(11,19,32,.42);z-index:600;display:flex;align-items:center;justify-content:center;padding:16px";
        document.body.appendChild(modal);
      }
      const openWos = allWos.filter(w => !w.invoiceId);
      modal.innerHTML = `
<div style="background:#fff;border-radius:14px;width:420px;max-width:100%;padding:24px;box-shadow:0 20px 60px rgba(11,19,32,.2)">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
    <h2 style="font-size:16px;font-weight:600;margin:0;color:var(--gray-900)">Onkost koppelen aan werkbon</h2>
    <button id="expLinkClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400)">×</button>
  </div>
  <div style="font-size:13px;color:var(--gray-500);margin-bottom:14px;">€ ${Number(e.amount||0).toFixed(2)} · ${esc(e.description || e.category || "")}</div>
  <form id="expLinkForm" style="display:flex;flex-direction:column;gap:14px">
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Werkbon</label>
      <select name="workorderId" style="width:100%;">
        <option value="">Geen (ontkoppelen)</option>
        ${openWos.map(w => `<option value="${esc(w.id)}" ${e.workorderId===w.id?"selected":""}>${esc(w.number ? w.number+" · " : "")}${esc(w.title||"Werkbon")}</option>`).join("")}
      </select>
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
      <input type="checkbox" name="billable" ${e.billable === false ? "" : "checked"}> Doorrekenen aan de klant op de werkbon-factuur
    </label>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button type="button" id="expLinkCancel" class="adm-btn adm-btn-secondary adm-btn-sm">Annuleren</button>
      <button type="submit" class="adm-btn adm-btn-primary adm-btn-sm">Opslaan</button>
    </div>
  </form>
</div>`;
      const close = () => modal.remove();
      document.getElementById("expLinkClose").addEventListener("click", close);
      document.getElementById("expLinkCancel").addEventListener("click", close);
      modal.addEventListener("click", ev => { if (ev.target === modal) close(); });
      document.getElementById("expLinkForm").addEventListener("submit", async ev => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        try {
          const patch = { workorderId: fd.get("workorderId") || null, billable: !!fd.get("billable") };
          await api("PATCH", `/expenses/${expId}`, patch);
          e.workorderId = patch.workorderId; e.billable = patch.billable;
          window.showToast && window.showToast(patch.workorderId ? "Onkost gekoppeld aan werkbon" : "Onkost ontkoppeld", "success");
          close(); refresh();
        } catch (err) { window.showToast && window.showToast(err.message, "error"); }
      });
    }

    function wireExpBtns() {
      const refreshTable = () => {
        const sel = document.getElementById("admExpFilter");
        const f = sel?.value || "";
        const rows = f ? expenses.filter(e => e.status === f || (f==="ingediend" && e.status==="pending")) : expenses;
        const tbl = document.getElementById("admExpTable"); if (tbl) { tbl.innerHTML = buildExpRows(rows); wireExpBtns(); }
      };
      content.querySelectorAll(".adm-exp-review").forEach(btn => {
        btn.addEventListener("click", () => openExpenseReviewModal(btn.dataset, refreshTable));
      });
      content.querySelectorAll(".adm-exp-link").forEach(btn => {
        btn.addEventListener("click", () => openExpenseLinkModal(btn.dataset.id, refreshTable));
      });
    }

    const tbl = document.getElementById("admExpTable");
    if (tbl) { tbl.innerHTML = buildExpRows(expenses); wireExpBtns(); }

    document.getElementById("admExpFilter")?.addEventListener("change", e => {
      const f = e.target.value;
      const rows = f ? expenses.filter(exp => exp.status === f || (f==="ingediend" && exp.status==="pending")) : expenses;
      const t = document.getElementById("admExpTable"); if (t) { t.innerHTML = buildExpRows(rows); wireExpBtns(); }
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
      style="width:100%;resize:vertical;box-sizing:border-box"></textarea>
  </div>
  <div id="expReviewErr" style="display:none;color:var(--wf-red);font-size:12px;margin-bottom:8px;"></div>
  <div style="display:flex;gap:8px;justify-content:flex-end;">
    <button id="expReviewCancel" class="adm-btn adm-btn-secondary adm-btn-sm">Annuleren</button>
    <button id="expReviewConfirm" class="adm-btn ${isApprove?"adm-btn-success":"adm-btn-danger"} adm-btn-sm">${isApprove?"Goedkeuren":"Weigeren"}</button>
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

  A.views = A.views || {};
  A.views.expenses = renderExpenses;
}());
