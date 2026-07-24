/* ── Verlof · uitgesplitst schermmodule (strangler-extractie) ────────────────
 * Letterlijke verplaatsing van het verlofscherm uit public/js/platforms/admin.js
 * (renderLeaves + tabbladen Aanvragen/Kalender/Saldi + de aanmaak-drawer).
 * De code is NIET herschreven: alleen de omhulling veranderde. Wat het scherm
 * met andere schermen deelt (uName, empNameById, tLeaveType, tLeaveStatus,
 * openLeaveReviewModal) blijft in admin.js staan en wordt hier via
 * window.wfpAdmin opgehaald · nooit gekopieerd, want twee waarheden lopen uit
 * elkaar zodra iemand er één aanpast.
 */
(function () {
  "use strict";
  const A = window.wfpAdmin;
  if (!A) return;
  const esc = A.esc;
  const api = A.api;
  const openDrawer = A.openDrawer;
  const closeDrawer = A.closeDrawer;
  // _state is in admin.js een stabiele (nooit herbonden) referentie · een
  // schrijf naar _state.employees hieronder is dus dezelfde cache als de shell.
  const _state = A.state;

  // i18n leest de globale woordenlijst, precies zoals admin.js en
  // admin-domains.js het doen. De sleutels blijven in de i18n-bundel; dit is
  // een lezer, geen tweede waarheid.
  function tA(key, fallback) { return window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback; }

  // Gedeelde helpers · blijven in admin.js (dashboard en rapporten gebruiken ze
  // ook) en worden hier alleen doorgegeven.
  const uName = rec => A.uName(rec);
  const empNameById = id => A.empNameById(id);
  const tLeaveType = tp => A.tLeaveType(tp);
  const tLeaveStatus = s => A.tLeaveStatus(s);
  const openLeaveReviewModal = (leaveId, decision, leave, onDone) => A.openLeaveReviewModal(leaveId, decision, leave, onDone);

  // Gelokaliseerde maand-/dagnamen voor de verlofkalender.
  function monthNames() {
    const lang = (window.wfpI18n && window.wfpI18n.lang) || "nl";
    const M = {
      nl: ["","Januari","Februari","Maart","April","Mei","Juni","Juli","Augustus","September","Oktober","November","December"],
      fr: ["","Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"],
      en: ["","January","February","March","April","May","June","July","August","September","October","November","December"]
    };
    return M[lang] || M.nl;
  }
  function weekdayShort() {
    const lang = (window.wfpI18n && window.wfpI18n.lang) || "nl";
    const D = {
      nl: ["Ma","Di","Wo","Do","Vr","Za","Zo"],
      fr: ["Lu","Ma","Me","Je","Ve","Sa","Di"],
      en: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
    };
    return D[lang] || D.nl;
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
    <h3 class="adm-card-title">${tA("nav.leaves","Verlof")}</h3>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <button class="adm-btn adm-btn-sm ${_leaveTab==="aanvragen"?"adm-btn-primary":"adm-btn-secondary"}" id="admLeaveTabReq">${tA("adm.leave.tabRequests","Aanvragen")}</button>
      <button class="adm-btn adm-btn-sm ${_leaveTab==="kalender"?"adm-btn-primary":"adm-btn-secondary"}" id="admLeaveTabCal">${tA("adm.leave.tabCalendar","Kalender")}</button>
      <button class="adm-btn adm-btn-sm ${_leaveTab==="saldi"?"adm-btn-primary":"adm-btn-secondary"}" id="admLeaveTabBal">${tA("adm.leave.tabBalances","Saldi")}</button>
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="admLeaveNew" style="margin-left:8px;">${tA("adm.leave.new","+ Verlof aanmaken")}</button>
    </div>
  </div>
  <div class="adm-card-body" id="admLeaveBody" style="padding:0;"></div>
</div>`;

    document.getElementById("admLeaveTabReq").addEventListener("click", () => { _leaveTab = "aanvragen"; renderLeaveBody(); });
    document.getElementById("admLeaveTabCal").addEventListener("click", () => { _leaveTab = "kalender"; renderLeaveBody(); });
    document.getElementById("admLeaveTabBal").addEventListener("click", () => { _leaveTab = "saldi"; renderLeaveBody(); });
    document.getElementById("admLeaveNew").addEventListener("click", () => openCreateLeaveDrawer());
    renderLeaveBody();
  }

  async function openCreateLeaveDrawer(preselectedUserId = null) {
    let employees = [];
    try { const d = await api("GET", "/employees"); employees = d.employees || []; } catch(_){}
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById("admDrawerTitle").textContent = tA("adm.leave.newTitle","Verlof aanmaken");
    document.getElementById("admDrawerBody").innerHTML = `
<form id="createLeaveForm">
  <div class="adm-form-group">
    <label>${tA("adm.leave.employee","Medewerker")} *</label>
    <select name="userId" required>
      <option value="">${tA("adm.leave.pickEmployee","- Kies medewerker -")}</option>
      ${employees.map(u => `<option value="${esc(u.id)}" ${preselectedUserId===u.id?"selected":""}>${esc(u.name||u.email)}</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-group">
    <label>${tA("adm.leave.typeLabel","Type verlof")}</label>
    <select name="type">
      <option value="vakantie">${tA("adm.ltype.vakantie","Vakantie")}</option>
      <option value="ziekte">${tA("adm.ltype.ziekte","Ziekte")}</option>
      <option value="adv">${tA("adm.ltype.adv","ADV")}</option>
      <option value="bijzonder">${tA("adm.ltype.bijzonder","Bijzonder verlof")}</option>
      <option value="onbetaald">${tA("adm.ltype.onbetaald","Onbetaald verlof")}</option>
    </select>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group">
      <label>${tA("adm.leave.from","Van")} *</label>
      <input name="startDate" type="date" value="${today}" required>
    </div>
    <div class="adm-form-group">
      <label>${tA("adm.leave.to","Tot")} *</label>
      <input name="endDate" type="date" value="${today}" required>
    </div>
  </div>
  <div class="adm-form-group">
    <label>${tA("adm.status","Status")}</label>
    <select name="status">
      <option value="goedgekeurd">${tA("adm.lstatus.approved","Goedgekeurd")}</option>
      <option value="aangevraagd">${tA("adm.lstatus.requested","Aangevraagd")}</option>
    </select>
  </div>
  <div class="adm-form-group">
    <label>${tA("adm.leave.reasonLabel","Reden / notitie")}</label>
    <textarea name="reason" rows="2" style="width:100%" placeholder="${tA("adm.leave.optNote","Optionele opmerking")}"></textarea>
  </div>
  <div id="createLeaveErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="createLeaveCancel">${tA("adm.cancel","Annuleren")}</button>
    <button type="submit" class="adm-btn adm-btn-primary">${tA("adm.leave.create","Aanmaken")}</button>
  </div>
</form>`;
    openDrawer();
    document.getElementById("createLeaveCancel").addEventListener("click", closeDrawer);
    document.getElementById("createLeaveForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = document.getElementById("createLeaveErr");
      const body = Object.fromEntries(new FormData(e.target).entries());
      // Calculate days
      if (body.startDate && body.endDate) {
        const days = Math.round((new Date(body.endDate) - new Date(body.startDate)) / 86400000) + 1;
        body.days = Math.max(1, days);
      }
      try {
        await api("POST", "/leaves", body);
        closeDrawer();
        _leaveTab = "aanvragen";
        renderLeaves();
        window.showToast && window.showToast(tA("adm.leave.created","Verlof aangemaakt"), "success");
      } catch(err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = ""; }
      }
    });
  }

  async function renderLeaveBody() {
    // Update tab button styles
    ["aanvragen","kalender","saldi"].forEach(t => {
      const btn = document.getElementById(t==="aanvragen"?"admLeaveTabReq":t==="kalender"?"admLeaveTabCal":"admLeaveTabBal");
      if (btn) { btn.className = `adm-btn adm-btn-sm ${_leaveTab===t?"adm-btn-primary":"adm-btn-secondary"}`; }
    });

    const body = document.getElementById("admLeaveBody");
    if (!body) return;
    body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--gray-400);font-size:13px;">${tA("adm.loading","Laden…")}</div>`;

    if (_leaveTab === "aanvragen") {
      const data = await api("GET", "/leaves");
      const leaves = data.leaves || data || [];
      body.innerHTML = `
<div style="padding:12px 16px;border-bottom:1px solid var(--gray-100);display:flex;gap:8px;align-items:center;">
  <select id="admLeaveFilter">
    <option value="">${tA("adm.allStatuses","Alle statussen")}</option>
    <option value="aangevraagd">${tA("adm.lstatus.requested","Aangevraagd")}</option>
    <option value="goedgekeurd">${tA("adm.lstatus.approved","Goedgekeurd")}</option>
    <option value="geweigerd">${tA("adm.lstatus.rejected","Geweigerd")}</option>
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
    const MONTHS = monthNames();

    let calData;
    try {
      calData = await api("GET", `/leaves/calendar?year=${_leaveCalYear}&month=${_leaveCalMonth}`);
    } catch(e) {
      container.innerHTML = `<div style="padding:24px;color:var(--wf-red);">${esc(e.message)}</div>`;
      return;
    }
    const { days = {}, leaves = [] } = calData;

    // Build userId→name map · fetch employees if not yet loaded
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
      cells += `<div style="min-height:52px;border-radius:8px;padding:4px 6px;background:${isToday?"var(--wf-blue-l)":isWeekend?"var(--gray-50)":"#fff"};border:1px solid ${isToday?"var(--wf-blue-l)":"var(--gray-200)"};">
        <div style="font-size:11px;font-weight:${isToday?"700":"500"};color:${isWeekend?"var(--gray-400)":isToday?"var(--wf-blue)":"var(--gray-700)"};margin-bottom:2px;">${d}</div>
        ${userIds.slice(0,3).map(uid => { const nm = empMap[uid] || empNameById(uid) || tA("adm.unknown","Onbekend"); return `<div style="font-size:10px;background:var(--wf-blue-l);color:var(--wf-blue);border-radius:4px;padding:1px 4px;margin-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(nm)}">${esc(nm.split(" ")[0])}</div>`; }).join("")}
        ${userIds.length > 3 ? `<div style="font-size:10px;color:var(--gray-500);">+${userIds.length-3}</div>` : ""}
      </div>`;
    }

    container.innerHTML = `
<div style="padding:16px;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admCalPrev">‹</button>
    <span style="font-size:15px;font-weight:600;min-width:160px;text-align:center;">${MONTHS[_leaveCalMonth]} ${_leaveCalYear}</span>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admCalNext">›</button>
    <span style="font-size:12px;color:var(--gray-500);margin-left:8px;">${leaves.length} ${tA("adm.leave.approvedCount","goedgekeurde verloven")}</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px;">
    ${weekdayShort().map(d=>`<div style="text-align:center;font-size:11px;font-weight:600;color:var(--gray-500);padding:4px 0;">${d}</div>`).join("")}
  </div>
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">${cells}</div>
  ${leaves.length ? `
  <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--gray-100);">
    <div class="adm-form-section">${tA("adm.leave.thisMonth","Verloven deze maand")}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
    ${leaves.map(l=>`<div style="font-size:12px;background:var(--wf-green-l);border:1px solid var(--wf-green-l);border-radius:6px;padding:4px 8px;color:var(--wf-green);">
      <strong>${esc(empMap[l.userId]||uName(l))}</strong> · ${esc(tLeaveType(l.type))} · ${l.startDate}→${l.endDate} (${l.days}${tA("adm.leave.daysAbbr","d")})
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
      container.innerHTML = `<div style="padding:24px;color:var(--wf-red);">${esc(e.message)}</div>`;
      return;
    }
    const balance = balData.balance || [];
    if (!balance.length) {
      container.innerHTML = `<div style="padding:24px;text-align:center;color:var(--gray-400);">${tA("adm.leave.noEmployees","Geen medewerkers gevonden.")}</div>`;
      return;
    }
    const dAbbr = tA("adm.leave.daysAbbr","d");

    container.innerHTML = `
<div style="padding:16px;">
  <div style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">${tA("adm.leave.balanceIntro","Vakantiesaldo {year} · op basis van goedgekeurde verlofaanvragen").replace("{year}", year)}</div>
  <table class="adm-table">
    <thead><tr><th>${tA("adm.thEmployee","Medewerker")}</th><th>${tA("adm.leave.thQuota","Quota")}</th><th>${tA("adm.leave.thUsed","Gebruikt")}</th><th>${tA("adm.leave.thRemaining","Resterend")}</th><th>${tA("adm.leave.thProgress","Voortgang")}</th></tr></thead>
    <tbody>${balance.map(b => {
      const pct = b.quota ? Math.min(100, Math.round((b.used / b.quota) * 100)) : 0;
      const color = pct >= 90 ? "var(--wf-red)" : pct >= 70 ? "var(--wf-yellow)" : "var(--wf-green)";
      return `<tr>
        <td><div style="font-weight:500;">${esc(b.name)}</div><div style="font-size:11px;color:var(--gray-400);">${esc(b.email)}</div></td>
        <td>${b.quota}${dAbbr}</td>
        <td>${b.used}${dAbbr}</td>
        <td style="font-weight:600;color:${b.remaining<=2?"var(--wf-red)":b.remaining<=5?"var(--wf-yellow)":"var(--wf-green)"};">${b.remaining}${dAbbr}</td>
        <td style="min-width:120px;">
          <div style="background:var(--gray-100);border-radius:20px;height:8px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${color};border-radius:20px;transition:width .3s;"></div>
          </div>
          <div style="font-size:10px;color:var(--gray-400);margin-top:2px;">${pct}%</div>
        </td>
      </tr>`;
    }).join("")}</tbody>
  </table>
</div>`;
  }

  function renderLeaveTable(leaves) {
    if (!leaves.length) return `<div class="adm-empty"><div class="adm-empty-text">${tA("adm.leave.noRequests","Geen verlofaanvragen")}</div></div>`;
    return `<table class="adm-table">
      <thead><tr><th>${tA("adm.thEmployee","Medewerker")}</th><th>${tA("adm.leave.thType","Type")}</th><th>${tA("adm.leave.from","Van")}</th><th>${tA("adm.leave.to","Tot")}</th><th>${tA("adm.leave.thReason","Reden")}</th><th>${tA("adm.status","Status")}</th><th>${tA("adm.leave.thNote","Opmerking")}</th><th>${tA("adm.actions","Acties")}</th></tr></thead>
      <tbody>${leaves.map(l => `
        <tr>
          <td>${esc(uName(l))}</td>
          <td>${esc(tLeaveType(l.type))}</td>
          <td>${esc(l.startDate||"")}</td>
          <td>${esc(l.endDate||"")}</td>
          <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(l.reason||"")}">${esc(l.reason||"-")}</td>
          <td><span class="adm-status adm-status-${l.status}">${esc(tLeaveStatus(l.status))}</span></td>
          <td style="font-size:12px;color:var(--gray-500);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(l.reviewNote||"")}">${esc(l.reviewNote||"-")}</td>
          <td style="white-space:nowrap;">${l.status==="aangevraagd" ? `
            <button class="adm-btn adm-btn-success adm-btn-sm adm-leave-action" data-id="${esc(l.id)}" data-status="goedgekeurd">${tA("adm.leave.approveShort","Goed")}</button>
            <button class="adm-btn adm-btn-danger adm-btn-sm adm-leave-action" data-id="${esc(l.id)}" data-status="geweigerd">${tA("adm.leave.reject","Weigeren")}</button>
          ` : "-"}</td>
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

  A.views = A.views || {};
  A.views.leaves = renderLeaves;
}());
