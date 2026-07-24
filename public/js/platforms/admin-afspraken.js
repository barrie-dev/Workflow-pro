/* ── Afspraken (klantafspraken + automatische reminder-mail) · uitgesplitste werkruimte ─
 * Letterlijke extractie uit public/js/platforms/admin.js (regels 2683-2851).
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

  // ── Afspraken (klantafspraken + automatische reminder-mail) ─────────────
  let _aptFilter = "komend"; // komend | alle | geannuleerd

  function tAptStatus(s) {
    const map = { gepland: "adm.apt.stPlanned", bevestigd: "adm.apt.stConfirmed", uitgevoerd: "adm.apt.stDone", geannuleerd: "adm.apt.stCancelled" };
    return map[s] ? tA(map[s], s) : (s || "-");
  }

  async function renderAppointments() {
    const content = document.getElementById("admContent");
    let rows = [];
    try { const d = await api("GET", "/appointments"); rows = d.appointments || []; }
    catch (e) { content.innerHTML = `<div style="padding:20px;color:var(--wf-red)">${tA("adm.error","Fout")}: ${e.message}</div>`; return; }

    const today = new Date().toISOString().slice(0, 10);
    const filtered = _aptFilter === "komend" ? rows.filter(a => a.date >= today && a.status !== "geannuleerd")
      : _aptFilter === "geannuleerd" ? rows.filter(a => a.status === "geannuleerd")
      : rows;
    const statusCss = { gepland: "adm-status-pending", bevestigd: "adm-status-goedgekeurd", uitgevoerd: "adm-status-active", geannuleerd: "adm-status-inactive" };
    const reminderCell = a => {
      if (a.reminderSentAt) return `<span style="color:var(--wf-green);font-weight:600;">✓ ${tA("adm.apt.remSent","verstuurd")} ${new Date(a.reminderSentAt).toLocaleDateString("nl-BE")}</span>`;
      if (!a.customerEmail) return `<span style="color:var(--gray-400);">${tA("adm.apt.remNoEmail","geen e-mail")}</span>`;
      if (!a.reminderDays) return `<span style="color:var(--gray-400);">${tA("adm.apt.remOff","uit")}</span>`;
      return `${a.reminderDays}${tA("adm.leave.daysAbbr","d")} ${tA("adm.apt.remBefore","vooraf")}`;
    };

    content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">${tA("nav.appointments","Afspraken")} <span style="background:var(--wf-blue-l);color:var(--wf-blue);border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${filtered.length}</span></h3>
    <div style="display:flex;gap:8px;align-items:center;">
      <select id="admAptFilter">
        <option value="komend" ${_aptFilter==="komend"?"selected":""}>${tA("adm.apt.fUpcoming","Komende")}</option>
        <option value="alle" ${_aptFilter==="alle"?"selected":""}>${tA("mgr.all","Alle")}</option>
        <option value="geannuleerd" ${_aptFilter==="geannuleerd"?"selected":""}>${tA("adm.apt.stCancelled","Geannuleerd")}</option>
      </select>
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="admNewApt">+ ${tA("adm.apt.singular","Afspraak")}</button>
    </div>
  </div>
  ${filtered.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-text">${tA("adm.apt.empty","Geen afspraken")}</div><button class="adm-btn adm-btn-primary adm-btn-sm" id="admEmptyNewApt" style="margin-top:12px">+ ${tA("adm.apt.emptyBtn","Eerste afspraak aanmaken")}</button></div>`
    : `<div class="adm-card-body adm-table-wrap">
    <table class="adm-table">
      <thead><tr><th>${tA("adm.date","Datum")}</th><th>${tA("adm.apt.thTime","Tijd")}</th><th>${tA("adm.thCustomer","Klant")}</th><th>${(window.wfpTerms && window.wfpTerms.t("jobSingular")) || tA("emp.wo.default","Werkbon")}</th><th>${tA("adm.apt.thReminder","Reminder")}</th><th>${tA("adm.status","Status")}</th><th>${tA("adm.actions","Acties")}</th></tr></thead>
      <tbody>
        ${filtered.map(a => `
        <tr class="adm-row-link adm-apt-row" data-id="${esc(a.id)}">
          <td style="font-weight:600;${a.date === today ? "color:var(--wf-blue);" : ""}">${new Date(`${a.date}T12:00:00`).toLocaleDateString("nl-BE",{weekday:"short",day:"numeric",month:"short",year:"numeric"})}</td>
          <td>${esc(a.start || "")}${a.end ? ` – ${esc(a.end)}` : ""}</td>
          <td><strong>${esc(a.customerName || "-")}</strong>${a.customerEmail ? `<div style="font-size:11px;color:var(--gray-400)">${esc(a.customerEmail)}</div>` : ""}</td>
          <td>${a.workorderNumber ? esc(a.workorderNumber) : (a.workorderId ? esc(String(a.workorderId).slice(-4)) : "-")}</td>
          <td style="font-size:12px;">${reminderCell(a)}</td>
          <td><span class="adm-status ${statusCss[a.status]||"adm-status-pending"}">${esc(tAptStatus(a.status))}</span></td>
          <td style="white-space:nowrap;"><button class="adm-btn adm-btn-secondary adm-btn-sm adm-apt-edit" data-id="${esc(a.id)}">${tA("adm.edit","Bewerken")}</button></td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`}
</div>`;

    document.getElementById("admAptFilter")?.addEventListener("change", e => { _aptFilter = e.target.value; renderAppointments(); });
    document.getElementById("admNewApt")?.addEventListener("click", () => openAppointmentDrawer(null));
    document.getElementById("admEmptyNewApt")?.addEventListener("click", () => openAppointmentDrawer(null));
    content.querySelectorAll(".adm-apt-edit").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); openAppointmentDrawer(rows.find(x => x.id === b.dataset.id)); }));
    content.querySelectorAll(".adm-apt-row").forEach(row => row.addEventListener("click", e => {
      if (e.target.closest("button")) return;
      openAppointmentDrawer(rows.find(x => x.id === row.dataset.id));
    }));
  }

  async function openAppointmentDrawer(apt) {
    const [custData, woData] = await Promise.all([
      api("GET", "/customers").catch(() => ({ customers: [] })),
      api("GET", "/workorders").catch(() => ({ workorders: [] })),
    ]);
    const customers = custData.customers || [];
    const openWos = (woData.workorders || []).filter(w => !["Voltooid", "Afgewerkt", "done", "geannuleerd"].includes(w.status));
    const today = new Date().toISOString().slice(0, 10);
    const isEdit = !!apt;
    document.getElementById("admDrawerTitle").textContent = isEdit ? tA("adm.apt.editTitle","Afspraak bewerken") : tA("adm.apt.newTitle","Nieuwe afspraak");
    document.getElementById("admDrawerBody").innerHTML = `
<form id="aptForm">
  <div class="adm-form-group"><label>${tA("adm.thCustomer","Klant")}</label>
    <select name="customerId" id="aptCustSel" style="width:100%">
      <option value="">${tA("adm.quote.manualFill","- Handmatig invullen -")}</option>
      ${customers.map(c => `<option value="${esc(c.id)}" ${apt?.customerId === c.id ? "selected" : ""} data-name="${esc(c.name||"")}" data-email="${esc(c.email||"")}">${esc(c.name)}</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${tA("adm.quote.customerName","Klantnaam")} *</label>
      <input name="customerName" id="aptCustName" value="${esc(apt?.customerName || "")}" required></div>
    <div class="adm-form-group"><label>${tA("adm.apt.custEmail","E-mail klant (voor reminder)")}</label>
      <input name="customerEmail" id="aptCustEmail" type="email" value="${esc(apt?.customerEmail || "")}"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${tA("adm.date","Datum")} *</label>
      <input name="date" type="date" value="${esc(apt?.date || today)}" required></div>
    <div class="adm-form-group"><label>${tA("mgr.startTime","Starttijd")} *</label>
      <input name="start" type="time" value="${esc(apt?.start || "08:00")}" required></div>
    <div class="adm-form-group"><label>${tA("mgr.endTime","Eindtijd")}</label>
      <input name="end" type="time" value="${esc(apt?.end || "")}"></div>
  </div>
  <div class="adm-form-group"><label>${(window.wfpTerms && window.wfpTerms.t("jobSingular")) || tA("emp.wo.default","Werkbon")} (${tA("adm.apt.optional","optioneel")})</label>
    <select name="workorderId" style="width:100%">
      <option value="">${tA("mgr.noWo","Geen werkbon")}</option>
      ${openWos.map(w => `<option value="${esc(w.id)}" ${apt?.workorderId === w.id ? "selected" : ""}>${esc(w.number ? w.number + " · " : "")}${esc(w.title || "")}</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${tA("adm.apt.reminderLabel","Reminder naar klant")}</label>
      <select name="reminderDays">
        <option value="0" ${apt?.reminderDays === 0 ? "selected" : ""}>${tA("adm.apt.remNone","Geen reminder")}</option>
        <option value="1" ${(apt?.reminderDays ?? 1) === 1 ? "selected" : ""}>${tA("adm.apt.rem1","1 dag vooraf")}</option>
        <option value="2" ${apt?.reminderDays === 2 ? "selected" : ""}>${tA("adm.apt.rem2","2 dagen vooraf")}</option>
        <option value="3" ${apt?.reminderDays === 3 ? "selected" : ""}>${tA("adm.apt.rem3","3 dagen vooraf")}</option>
        <option value="7" ${apt?.reminderDays === 7 ? "selected" : ""}>${tA("adm.apt.rem7","1 week vooraf")}</option>
      </select>
    </div>
    ${isEdit ? `<div class="adm-form-group"><label>${tA("adm.status","Status")}</label>
      <select name="status">
        <option value="gepland" ${apt.status === "gepland" ? "selected" : ""}>${tA("adm.apt.stPlanned","Gepland")}</option>
        <option value="bevestigd" ${apt.status === "bevestigd" ? "selected" : ""}>${tA("adm.apt.stConfirmed","Bevestigd")}</option>
        <option value="uitgevoerd" ${apt.status === "uitgevoerd" ? "selected" : ""}>${tA("adm.apt.stDone","Uitgevoerd")}</option>
        <option value="geannuleerd" ${apt.status === "geannuleerd" ? "selected" : ""}>${tA("adm.apt.stCancelled","Geannuleerd")}</option>
      </select>
    </div>` : ""}
  </div>
  <div class="adm-form-group"><label>${tA("adm.apt.noteLabel","Notitie (komt mee in de reminder)")}</label>
    <textarea name="note" rows="2" style="width:100%">${esc(apt?.note || "")}</textarea>
  </div>
  ${isEdit && apt.reminderSentAt ? `<div style="font-size:12px;color:var(--wf-green);margin-bottom:8px;">✓ ${tA("adm.apt.remSentOn","Reminder verstuurd op")} ${new Date(apt.reminderSentAt).toLocaleString("nl-BE")}. ${tA("adm.apt.remResetHint","Wijzig je datum, tijd of reminder-instelling, dan wordt opnieuw een reminder gepland.")}</div>` : ""}
  <div id="aptFormErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions" style="${isEdit ? "justify-content:space-between;" : ""}">
    ${isEdit ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="aptDelete">${tA("adm.delete","Verwijderen")}</button>` : ""}
    <div style="display:flex;gap:8px;">
      <button type="button" class="adm-btn adm-btn-secondary" id="aptCancel">${tA("adm.cancel","Annuleren")}</button>
      <button type="submit" class="adm-btn adm-btn-primary">${isEdit ? tA("adm.save","Opslaan") : tA("adm.createBtn","Aanmaken")}</button>
    </div>
  </div>
</form>`;
    openDrawer();
    document.getElementById("aptCancel").addEventListener("click", closeDrawer);
    document.getElementById("aptCustSel")?.addEventListener("change", e => {
      const opt = e.target.selectedOptions[0];
      if (!opt || !opt.value) return;
      document.getElementById("aptCustName").value = opt.dataset.name || "";
      document.getElementById("aptCustEmail").value = opt.dataset.email || "";
    });
    document.getElementById("aptDelete")?.addEventListener("click", async () => {
      if (!await uiConfirm(tA("adm.apt.deleteConfirm","Afspraak van {d} verwijderen?").replace("{d}", apt.date), { title: "Afspraak verwijderen", danger: true, confirmLabel: tA("adm.delete","Verwijderen") })) return;
      try { await api("DELETE", `/appointments/${apt.id}`); closeDrawer(); renderAppointments(); }
      catch (err) { const el = document.getElementById("aptFormErr"); if (el) { el.textContent = err.message; el.style.display = ""; } }
    });
    document.getElementById("aptForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = document.getElementById("aptFormErr");
      const body = Object.fromEntries(new FormData(e.target).entries());
      body.reminderDays = Number(body.reminderDays || 0);
      if (!body.workorderId) delete body.workorderId;
      try {
        if (isEdit) await api("PATCH", `/appointments/${apt.id}`, body);
        else await api("POST", "/appointments", body);
        closeDrawer(); renderAppointments();
        window.showToast && window.showToast(isEdit ? tA("adm.apt.savedToast","Afspraak opgeslagen") : tA("adm.apt.createdToast","Afspraak aangemaakt"), "success");
      } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = ""; }
      }
    });
  }

  A.views = A.views || {};
  A.drawers = A.drawers || {};
  A.views.appointments = renderAppointments;
  A.drawers.appointment = openAppointmentDrawer;
}());
