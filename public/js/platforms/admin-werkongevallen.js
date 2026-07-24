/* ── Werkongevallen (register + aangifte-opvolging verzekeraar) · uitgesplitste werkruimte ─
 * Letterlijke extractie uit public/js/platforms/admin.js (regels 2853-3059).
 * Er is bewust NIETS herschreven: alleen de omhulling is nieuw. Wat het scherm
 * niet zelf meebrengt komt uit de gedeelde context window.wfpAdmin, zodat er
 * geen tweede waarheid ontstaat.
 */
(function () {
  "use strict";

  const A = window.wfpAdmin;
  if (!A) return;

  // Gedeelde context · alles wat in admin.js bleef staan, komt hiervandaan.
  const api = A.api;
  const esc = A.esc;
  const tA = A.tA;
  const uiConfirm = A.uiConfirm;
  const openDrawer = A.openDrawer;
  const closeDrawer = A.closeDrawer;
  const tenantId = A.tenantId;
  const token = A.token;

  // ── Werkongevallen (register + aangifte-opvolging verzekeraar) ────────────
  let _incFilter = "alle";

  function tIncSeverity(s) {
    const map = { licht: "adm.inc.sevLight", werkverlet: "adm.inc.sevLostTime", ernstig: "adm.inc.sevSerious", dodelijk: "adm.inc.sevFatal" };
    return map[s] ? tA(map[s], s) : (s || "-");
  }
  function tIncStatus(s) {
    const map = { open: "adm.inc.stOpen", gemeld: "adm.inc.stReported", gesloten: "adm.inc.stClosed" };
    return map[s] ? tA(map[s], s) : (s || "-");
  }
  // Aangifte-deadline verzekeraar: 8 kalenderdagen na de dag van het ongeval.
  function incDeadline(i, today) {
    const d = new Date(`${i.date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 8);
    const deadline = d.toISOString().slice(0, 10);
    const daysLeft = Math.round((new Date(`${deadline}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
    return { deadline, daysLeft };
  }

  async function renderIncidents() {
    const content = document.getElementById("admContent");
    let rows = [];
    try { const d = await api("GET", "/incidents"); rows = d.incidents || []; }
    catch (e) { content.innerHTML = `<div style="padding:20px;color:var(--wf-red)">${tA("adm.error","Fout")}: ${e.message}</div>`; return; }

    const today = new Date().toISOString().slice(0, 10);
    const filtered = _incFilter === "open" ? rows.filter(i => i.status === "open")
      : _incFilter === "ernstig" ? rows.filter(i => ["ernstig", "dodelijk"].includes(i.severity))
      : rows;
    const sevCss = { licht: "adm-status-active", werkverlet: "adm-status-pending", ernstig: "adm-status-overdue", dodelijk: "adm-status-overdue" };
    const stCss = { open: "adm-status-open", gemeld: "adm-status-goedgekeurd", gesloten: "adm-status-voltooid" };
    const reportCell = i => {
      if (i.insurerReportedAt) return `<span style="color:var(--wf-green);font-weight:600;">✓ ${tA("adm.inc.reported","gemeld")} ${new Date(`${i.insurerReportedAt}T12:00:00`).toLocaleDateString("nl-BE")}</span>`;
      const { deadline, daysLeft } = incDeadline(i, today);
      const dl = new Date(`${deadline}T12:00:00`).toLocaleDateString("nl-BE");
      if (daysLeft < 0) return `<span style="color:var(--wf-red);font-weight:600;">${tA("adm.inc.overdue","Te laat")} · ${dl}</span>`;
      const urgent = daysLeft <= 2;
      return `<span style="${urgent ? "color:var(--wf-red);font-weight:600;" : ""}">${tA("adm.inc.dueBy","vóór")} ${dl} (${daysLeft}${tA("adm.leave.daysAbbr","d")})</span>`;
    };

    content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">${tA("nav.incidents","Werkongevallen")} <span style="background:var(--wf-blue-l);color:var(--wf-blue);border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${filtered.length}</span></h3>
    <div style="display:flex;gap:8px;align-items:center;">
      <select id="admIncFilter">
        <option value="alle" ${_incFilter==="alle"?"selected":""}>${tA("mgr.all","Alle")}</option>
        <option value="open" ${_incFilter==="open"?"selected":""}>${tA("adm.inc.stOpen","Open")}</option>
        <option value="ernstig" ${_incFilter==="ernstig"?"selected":""}>${tA("adm.inc.sevSerious","Ernstig")}</option>
      </select>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admIncCsv">${tA("adm.inc.csvBtn","CSV verzekeraar")}</button>
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="admNewInc">+ ${tA("adm.inc.singular","Werkongeval")}</button>
    </div>
  </div>
  <div style="padding:8px 20px;font-size:12px;color:var(--gray-500);border-bottom:1px solid var(--gray-100);">${tA("adm.inc.deadlineHint","Aangifte bij de verzekeraar: binnen 8 kalenderdagen na het ongeval. Ernstig ongeval: omstandig verslag aan de inspectie binnen 10 dagen. Dodelijk ongeval: onmiddellijk melden.")}</div>
  ${filtered.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-text">${tA("adm.inc.empty","Geen werkongevallen geregistreerd")}</div><button class="adm-btn adm-btn-primary adm-btn-sm" id="admEmptyNewInc" style="margin-top:12px">+ ${tA("adm.inc.emptyBtn","Eerste werkongeval registreren")}</button></div>`
    : `<div class="adm-card-body adm-table-wrap">
    <table class="adm-table">
      <thead><tr><th>${tA("adm.date","Datum")}</th><th>${tA("adm.inc.thEmployee","Medewerker")}</th><th>${tA("adm.inc.thLocation","Locatie")}</th><th>${tA("adm.inc.thSeverity","Ernst")}</th><th>${tA("adm.inc.thReport","Aangifte verzekeraar")}</th><th>${tA("adm.status","Status")}</th><th>${tA("adm.actions","Acties")}</th></tr></thead>
      <tbody>
        ${filtered.map(i => `
        <tr class="adm-row-link adm-inc-row" data-id="${esc(i.id)}">
          <td style="font-weight:600;">${new Date(`${i.date}T12:00:00`).toLocaleDateString("nl-BE",{day:"numeric",month:"short",year:"numeric"})}${i.time ? `<div style="font-size:11px;color:var(--gray-400)">${esc(i.time)}</div>` : ""}</td>
          <td><strong>${esc(i.employeeName || "-")}</strong></td>
          <td>${esc(i.location || "-")}</td>
          <td><span class="adm-status ${sevCss[i.severity]||"adm-status-pending"}">${esc(tIncSeverity(i.severity))}</span></td>
          <td style="font-size:12px;">${reportCell(i)}</td>
          <td><span class="adm-status ${stCss[i.status]||"adm-status-open"}">${esc(tIncStatus(i.status))}</span></td>
          <td style="white-space:nowrap;"><button class="adm-btn adm-btn-secondary adm-btn-sm adm-inc-edit" data-id="${esc(i.id)}">${tA("adm.edit","Bewerken")}</button></td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`}
</div>`;

    document.getElementById("admIncFilter")?.addEventListener("change", e => { _incFilter = e.target.value; renderIncidents(); });
    document.getElementById("admNewInc")?.addEventListener("click", () => openIncidentDrawer(null));
    document.getElementById("admEmptyNewInc")?.addEventListener("click", () => openIncidentDrawer(null));
    document.getElementById("admIncCsv")?.addEventListener("click", async () => {
      try {
        const r = await fetch(`/api/tenants/${tenantId()}/incidents?format=csv`, { headers: { Authorization: "Bearer " + token() } });
        if (!r.ok) throw new Error(tA("adm.inc.exportErr","Export mislukt"));
        const blob = await r.blob(); const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = `werkongevallen-${today}.csv`;
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
      } catch (e) { window.showToast && window.showToast(e.message, "error"); }
    });
    content.querySelectorAll(".adm-inc-edit").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); openIncidentDrawer(rows.find(x => x.id === b.dataset.id)); }));
    content.querySelectorAll(".adm-inc-row").forEach(row => row.addEventListener("click", e => {
      if (e.target.closest("button")) return;
      openIncidentDrawer(rows.find(x => x.id === row.dataset.id));
    }));
  }

  async function openIncidentDrawer(inc) {
    const [empData, venData] = await Promise.all([
      api("GET", "/employees").catch(() => ({ employees: [] })),
      api("GET", "/venues").catch(() => ({ venues: [] })),
    ]);
    const employees = (empData.employees || []).filter(u => u.active !== false);
    const venues = venData.venues || [];
    const today = new Date().toISOString().slice(0, 10);
    const isEdit = !!inc;
    document.getElementById("admDrawerTitle").textContent = isEdit ? tA("adm.inc.editTitle","Werkongeval bewerken") : tA("adm.inc.newTitle","Werkongeval registreren");
    document.getElementById("admDrawerBody").innerHTML = `
<form id="incForm">
  <div class="adm-form-group"><label>${tA("adm.inc.thEmployee","Medewerker")}</label>
    <select name="employeeId" id="incEmpSel" style="width:100%">
      <option value="">${tA("adm.quote.manualFill","- Handmatig invullen -")}</option>
      ${employees.map(u => `<option value="${esc(u.id)}" ${inc?.employeeId === u.id ? "selected" : ""} data-name="${esc(u.name||"")}">${esc(u.name || u.email)}</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-group"><label>${tA("adm.inc.empName","Naam medewerker")} *</label>
    <input name="employeeName" id="incEmpName" value="${esc(inc?.employeeName || "")}" required></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${tA("adm.inc.dateLabel","Datum ongeval")} *</label>
      <input name="date" type="date" value="${esc(inc?.date || today)}" max="${today}" required></div>
    <div class="adm-form-group"><label>${tA("adm.apt.thTime","Tijd")}</label>
      <input name="time" type="time" value="${esc(inc?.time || "")}"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${(window.wfpTerms && window.wfpTerms.t("venue")) || tA("adm.inc.thLocation","Locatie")}</label>
      <select name="venueId" id="incVenueSel" style="width:100%">
        <option value="">-</option>
        ${venues.map(v => `<option value="${esc(v.id)}" ${inc?.venueId === v.id ? "selected" : ""} data-name="${esc(v.name||"")}">${esc(v.name)}</option>`).join("")}
      </select>
    </div>
    <div class="adm-form-group"><label>${tA("adm.inc.locLabel","Locatie (vrije tekst)")}</label>
      <input name="location" id="incLocation" value="${esc(inc?.location || "")}"></div>
  </div>
  <div class="adm-form-group"><label>${tA("adm.inc.thSeverity","Ernst")} *</label>
    <select name="severity" id="incSeverity" required>
      <option value="licht" ${(inc?.severity ?? "licht") === "licht" ? "selected" : ""}>${tA("adm.inc.sevLight","Licht (EHBO, geen werkverlet)")}</option>
      <option value="werkverlet" ${inc?.severity === "werkverlet" ? "selected" : ""}>${tA("adm.inc.sevLostTime","Met werkverlet")}</option>
      <option value="ernstig" ${inc?.severity === "ernstig" ? "selected" : ""}>${tA("adm.inc.sevSerious","Ernstig")}</option>
      <option value="dodelijk" ${inc?.severity === "dodelijk" ? "selected" : ""}>${tA("adm.inc.sevFatal","Dodelijk")}</option>
    </select>
  </div>
  <div id="incSevWarn" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:8px;font-size:12px;margin-bottom:10px;"></div>
  <div class="adm-form-group"><label>${tA("adm.inc.descLabel","Omschrijving van het ongeval")} *</label>
    <textarea name="description" rows="3" style="width:100%" required>${esc(inc?.description || "")}</textarea>
  </div>
  <div class="adm-form-group"><label>${tA("adm.inc.witLabel","Getuigen (namen)")}</label>
    <input name="witnesses" value="${esc(inc?.witnesses || "")}"></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${tA("adm.inc.reportedLabel","Aangifte verzekeraar op")}</label>
      <input name="insurerReportedAt" type="date" value="${esc(inc?.insurerReportedAt || "")}"></div>
    ${isEdit ? `<div class="adm-form-group"><label>${tA("adm.status","Status")}</label>
      <select name="status">
        <option value="open" ${inc.status === "open" ? "selected" : ""}>${tA("adm.inc.stOpen","Open")}</option>
        <option value="gemeld" ${inc.status === "gemeld" ? "selected" : ""}>${tA("adm.inc.stReported","Gemeld")}</option>
        <option value="gesloten" ${inc.status === "gesloten" ? "selected" : ""}>${tA("adm.inc.stClosed","Gesloten")}</option>
      </select>
    </div>` : ""}
  </div>
  <div id="incFormErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions" style="${isEdit ? "justify-content:space-between;" : ""}">
    ${isEdit ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="incDelete">${tA("adm.delete","Verwijderen")}</button>` : ""}
    <div style="display:flex;gap:8px;">
      <button type="button" class="adm-btn adm-btn-secondary" id="incCancel">${tA("adm.cancel","Annuleren")}</button>
      <button type="submit" class="adm-btn adm-btn-primary">${isEdit ? tA("adm.save","Opslaan") : tA("adm.createBtn","Aanmaken")}</button>
    </div>
  </div>
</form>`;
    openDrawer();
    document.getElementById("incCancel").addEventListener("click", closeDrawer);
    document.getElementById("incEmpSel")?.addEventListener("change", e => {
      const opt = e.target.selectedOptions[0];
      if (!opt || !opt.value) return;
      document.getElementById("incEmpName").value = opt.dataset.name || "";
    });
    document.getElementById("incVenueSel")?.addEventListener("change", e => {
      const opt = e.target.selectedOptions[0];
      const loc = document.getElementById("incLocation");
      if (opt && opt.value && !loc.value) loc.value = opt.dataset.name || "";
    });
    const sevWarn = () => {
      const v = document.getElementById("incSeverity").value;
      const el = document.getElementById("incSevWarn");
      if (v === "dodelijk") { el.textContent = tA("adm.inc.fatalWarn","Dodelijk ongeval: verwittig de inspectie (Toezicht Welzijn op het Werk) onmiddellijk en bezorg binnen 10 dagen een omstandig verslag."); el.style.display = ""; }
      else if (v === "ernstig") { el.textContent = tA("adm.inc.seriousWarn","Ernstig arbeidsongeval: bezorg de inspectie (Toezicht Welzijn op het Werk) binnen 10 dagen een omstandig verslag."); el.style.display = ""; }
      else el.style.display = "none";
    };
    document.getElementById("incSeverity").addEventListener("change", sevWarn);
    sevWarn();
    document.getElementById("incDelete")?.addEventListener("click", async () => {
      if (!await uiConfirm(tA("adm.inc.deleteConfirm","Werkongeval van {d} verwijderen?").replace("{d}", inc.date), { title: "Registratie verwijderen", danger: true, confirmLabel: tA("adm.delete","Verwijderen") })) return;
      try { await api("DELETE", `/incidents/${inc.id}`); closeDrawer(); renderIncidents(); }
      catch (err) { const el = document.getElementById("incFormErr"); if (el) { el.textContent = err.message; el.style.display = ""; } }
    });
    document.getElementById("incForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = document.getElementById("incFormErr");
      const body = Object.fromEntries(new FormData(e.target).entries());
      if (!body.employeeId) delete body.employeeId;
      if (!body.venueId) delete body.venueId;
      try {
        if (isEdit) await api("PATCH", `/incidents/${inc.id}`, body);
        else await api("POST", "/incidents", body);
        closeDrawer(); renderIncidents();
        window.showToast && window.showToast(isEdit ? tA("adm.inc.savedToast","Werkongeval opgeslagen") : tA("adm.inc.createdToast","Werkongeval geregistreerd"), "success");
      } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = ""; }
      }
    });
  }
  A.views = A.views || {};
  A.drawers = A.drawers || {};
  A.views.incidents = renderIncidents;
  A.drawers.incident = openIncidentDrawer;
}());
