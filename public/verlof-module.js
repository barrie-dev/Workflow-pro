/**
 * verlof-module.js
 * Verlofbeheer UI · aanvragen · goedkeuren/weigeren · kalenderoverzicht
 * Rendert in: #verlofPage
 * Vereisten: window.token, window.tenantId, window.state
 */
(function () {
  "use strict";

  function esc(v) {
    return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function userName(userId) {
    return (window.state?.users || []).find(u => u.id === userId)?.name || userId || "Onbekend";
  }

  async function apiCall(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(window.token ? { Authorization: `Bearer ${window.token}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "API-fout");
    return data;
  }

  // ── styles ──────────────────────────────────────────────────────────────────

  const STYLES = `
<style id="verlof-styles">
.verlof-wrap { font-family:Inter,"Segoe UI",Arial,sans-serif; color:#0f2744; padding:20px; }
.verlof-kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:18px; }
.verlof-kpi { background:#fff; border:1px solid #d9e3ef; border-radius:8px; padding:12px 14px; }
.verlof-kpi span { font-size:11px; color:#5f728c; text-transform:uppercase; letter-spacing:.04em; display:block; }
.verlof-kpi strong { font-size:22px; font-weight:800; display:block; line-height:1.2; }
.verlof-kpi small { font-size:11px; color:#5f728c; }
.verlof-kpi.alert strong { color:#e53535; }
.verlof-kpi.warn strong { color:#f28b18; }

.verlof-toolbar { display:flex; gap:10px; margin-bottom:14px; align-items:center; flex-wrap:wrap; }
.verlof-toolbar h3 { margin:0; font-size:16px; flex:1; }
.verlof-filter { border:1px solid #d9e3ef; border-radius:6px; padding:6px 10px; font-size:13px; background:#fff; }

.verlof-table { width:100%; border-collapse:collapse; font-size:13px; background:#fff; border:1px solid #d9e3ef; border-radius:8px; overflow:hidden; }
.verlof-table th { background:#f5f8fc; padding:10px 14px; text-align:left; font-weight:600; font-size:12px; color:#5f728c; text-transform:uppercase; letter-spacing:.04em; border-bottom:1px solid #d9e3ef; }
.verlof-table td { padding:10px 14px; border-bottom:1px solid #f0f4f9; vertical-align:middle; }
.verlof-table tr:last-child td { border-bottom:none; }
.verlof-table tr:hover td { background:#f8fafc; }
.verlof-table .actions { display:flex; gap:6px; }

.badge { display:inline-block; padding:2px 8px; border-radius:20px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
.badge.aangevraagd { background:#fff3cd; color:#856404; }
.badge.goedgekeurd { background:#d1fae5; color:#065f46; }
.badge.geweigerd { background:#fee2e2; color:#991b1b; }
.badge.geannuleerd { background:#f3f4f6; color:#6b7280; }
.badge.vakantie { background:#dbeafe; color:#1e40af; }
.badge.ziekte { background:#ffe4e6; color:#9f1239; }
.badge.overmacht { background:#fef3c7; color:#92400e; }
.badge.educatie { background:#ede9fe; color:#5b21b6; }
.badge.onbetaald { background:#f3f4f6; color:#374151; }
.badge.feestdag { background:#ecfdf5; color:#065f46; }

.verlof-btn { padding:5px 12px; border-radius:6px; border:none; cursor:pointer; font-size:12px; font-weight:600; }
.verlof-btn.primary { background:#1a56db; color:#fff; }
.verlof-btn.primary:hover { background:#1648c8; }
.verlof-btn.success { background:#059669; color:#fff; }
.verlof-btn.danger { background:#dc2626; color:#fff; }
.verlof-btn.secondary { background:#f5f8fc; color:#0f2744; border:1px solid #d9e3ef; }
.verlof-btn:disabled { opacity:.45; cursor:not-allowed; }

/* drawer */
.verlof-drawer-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.35); z-index:1100; display:flex; justify-content:flex-end; }
.verlof-drawer { width:480px; max-width:100vw; background:#fff; height:100%; overflow-y:auto; padding:24px; box-shadow:-4px 0 24px rgba(0,0,0,.12); }
.verlof-drawer h2 { margin:0 0 20px; font-size:18px; }
.verlof-field { margin-bottom:14px; }
.verlof-field label { display:block; font-size:12px; font-weight:600; color:#5f728c; margin-bottom:4px; text-transform:uppercase; }
.verlof-field input, .verlof-field select, .verlof-field textarea {
  width:100%; padding:8px 10px; border:1px solid #d9e3ef; border-radius:6px; font-size:14px; box-sizing:border-box; }
.verlof-field textarea { min-height:72px; resize:vertical; }
.verlof-drawer-footer { margin-top:20px; display:flex; gap:10px; }

/* kalender */
.verlof-cal { margin-top:24px; }
.verlof-cal-head { display:flex; align-items:center; gap:14px; margin-bottom:12px; }
.verlof-cal-head h3 { margin:0; font-size:15px; flex:1; }
.verlof-cal-nav { background:none; border:1px solid #d9e3ef; border-radius:6px; padding:4px 10px; cursor:pointer; font-size:14px; }
.verlof-cal-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; }
.verlof-cal-day-name { text-align:center; font-size:11px; font-weight:700; color:#5f728c; padding:4px 0; text-transform:uppercase; }
.verlof-cal-cell { min-height:52px; border:1px solid #e9eff6; border-radius:4px; padding:4px; font-size:11px; background:#fff; }
.verlof-cal-cell.today { border-color:#1a56db; background:#eff4ff; }
.verlof-cal-cell.other-month { background:#f8fafc; color:#c0ccdb; }
.verlof-cal-cell .cal-date { font-weight:700; font-size:12px; margin-bottom:2px; }
.verlof-cal-cell .cal-absent { font-size:10px; background:#dbeafe; color:#1e40af; border-radius:3px; padding:1px 4px; margin:1px 0; display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

.verlof-empty { padding:40px; text-align:center; color:#5f728c; }
</style>`;

  // ── state ────────────────────────────────────────────────────────────────────

  const st = {
    leaves: [],
    summary: {},
    filterStatus: "",
    filterType: "",
    filterUser: "",
    calYear: new Date().getFullYear(),
    calMonth: new Date().getMonth() + 1,
    calData: null,
    drawerOpen: false,
    drawerLeave: null  // null = nieuw, object = detail/edit
  };

  // ── data laden ───────────────────────────────────────────────────────────────

  async function loadLeaves() {
    const container = document.getElementById("verlofPage");
    if (!container) return;

    if (!window.token) {
      container.innerHTML = `${STYLES}<div class="verlof-wrap"><div class="verlof-empty">Login om verlofbeheer te gebruiken.</div></div>`;
      return;
    }

    try {
      const params = new URLSearchParams({ tenantId: window.tenantId });
      if (st.filterStatus) params.set("status", st.filterStatus);
      if (st.filterType) params.set("type", st.filterType);
      if (st.filterUser) params.set("userId", st.filterUser);

      const [leavesData, calData] = await Promise.all([
        apiCall(`/api/tenants/${window.tenantId}/leaves?${params}`),
        apiCall(`/api/tenants/${window.tenantId}/leaves/calendar?year=${st.calYear}&month=${st.calMonth}`)
      ]);

      st.leaves = leavesData.leaves || [];
      st.summary = leavesData.summary || {};
      st.calData = calData;

      renderVerlofPage();
    } catch (e) {
      const container2 = document.getElementById("verlofPage");
      if (container2) container2.innerHTML = `${STYLES}<div class="verlof-wrap"><div class="verlof-empty" style="color:#e53535">${esc(e.message)}</div></div>`;
    }
  }

  // ── render ───────────────────────────────────────────────────────────────────

  function renderVerlofPage() {
    const container = document.getElementById("verlofPage");
    if (!container) return;

    const isAdmin = ["tenant_admin", "super_admin"].includes(window.state?.currentUser?.role);

    const users = window.state?.users || [];
    const userOptions = users.filter(u => u.role !== "super_admin" && u.active !== false)
      .map(u => `<option value="${esc(u.id)}"${st.filterUser === u.id ? " selected" : ""}>${esc(u.name || u.email)}</option>`)
      .join("");

    container.innerHTML = `${STYLES}
<div class="verlof-wrap">
  <div class="verlof-kpis">
    <div class="verlof-kpi warn">
      <span>Aangevraagd</span>
      <strong>${st.summary.aangevraagd || 0}</strong>
      <small>wacht op beslissing</small>
    </div>
    <div class="verlof-kpi">
      <span>Goedgekeurd</span>
      <strong>${st.summary.goedgekeurd || 0}</strong>
      <small>dit overzicht</small>
    </div>
    <div class="verlof-kpi${(st.summary.absentToday || 0) > 0 ? " alert" : ""}">
      <span>Vandaag afwezig</span>
      <strong>${st.summary.absentToday || 0}</strong>
      <small>medewerkers</small>
    </div>
    <div class="verlof-kpi">
      <span>Geweigerd</span>
      <strong>${st.summary.geweigerd || 0}</strong>
      <small>dit overzicht</small>
    </div>
  </div>

  <div class="verlof-toolbar">
    <h3>Verlofaanvragen</h3>
    <select class="verlof-filter" id="vf-status">
      <option value="">Alle statussen</option>
      <option value="aangevraagd"${st.filterStatus === "aangevraagd" ? " selected" : ""}>Aangevraagd</option>
      <option value="goedgekeurd"${st.filterStatus === "goedgekeurd" ? " selected" : ""}>Goedgekeurd</option>
      <option value="geweigerd"${st.filterStatus === "geweigerd" ? " selected" : ""}>Geweigerd</option>
      <option value="geannuleerd"${st.filterStatus === "geannuleerd" ? " selected" : ""}>Geannuleerd</option>
    </select>
    <select class="verlof-filter" id="vf-type">
      <option value="">Alle types</option>
      <option value="vakantie"${st.filterType === "vakantie" ? " selected" : ""}>Vakantie</option>
      <option value="ziekte"${st.filterType === "ziekte" ? " selected" : ""}>Ziekte</option>
      <option value="overmacht"${st.filterType === "overmacht" ? " selected" : ""}>Overmacht</option>
      <option value="educatie"${st.filterType === "educatie" ? " selected" : ""}>Educatie</option>
      <option value="onbetaald"${st.filterType === "onbetaald" ? " selected" : ""}>Onbetaald</option>
    </select>
    ${isAdmin ? `<select class="verlof-filter" id="vf-user"><option value="">Alle medewerkers</option>${userOptions}</select>` : ""}
    <button class="verlof-btn primary" id="verlof-new">+ Nieuwe aanvraag</button>
  </div>

  ${st.leaves.length ? `
  <table class="verlof-table">
    <thead>
      <tr>
        <th>Medewerker</th>
        <th>Type</th>
        <th>Van</th>
        <th>Tot</th>
        <th>Dagen</th>
        <th>Status</th>
        <th>Reden</th>
        ${isAdmin ? "<th>Acties</th>" : ""}
      </tr>
    </thead>
    <tbody>
      ${st.leaves.map(l => `
      <tr>
        <td><strong>${esc(userName(l.userId))}</strong></td>
        <td><span class="badge ${esc(l.type)}">${esc(l.type)}</span></td>
        <td>${esc(l.startDate)}</td>
        <td>${esc(l.endDate)}</td>
        <td>${l.days}</td>
        <td><span class="badge ${esc(l.status)}">${esc(l.status)}</span></td>
        <td><small>${esc(l.reason || "-")}</small></td>
        ${isAdmin ? `
        <td>
          <div class="actions">
            ${l.status === "aangevraagd" ? `
              <button class="verlof-btn success" data-action="approve" data-id="${esc(l.id)}" title="Goedkeuren">✓</button>
              <button class="verlof-btn danger" data-action="reject" data-id="${esc(l.id)}" title="Weigeren">✗</button>
            ` : ""}
            ${["aangevraagd", "goedgekeurd"].includes(l.status) ? `
              <button class="verlof-btn secondary" data-action="cancel" data-id="${esc(l.id)}" title="Annuleren">↩</button>
            ` : ""}
          </div>
        </td>` : ""}
      </tr>`).join("")}
    </tbody>
  </table>` : `<div class="verlof-empty">Geen verlofaanvragen gevonden.</div>`}

  ${renderCalendar()}
</div>`;

    bindEvents(container);
  }

  function renderCalendar() {
    if (!st.calData) return "";
    const { year, month, days } = st.calData;
    const MONTHS = ["", "Januari", "Februari", "Maart", "April", "Mei", "Juni", "Juli", "Augustus", "September", "Oktober", "November", "December"];
    const DAYS = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];
    const today = new Date().toISOString().slice(0, 10);

    // eerste dag van de maand (0=zo, 1=ma…)
    const firstDow = new Date(year, month - 1, 1).getDay();
    const startOffset = (firstDow + 6) % 7; // ma=0

    const lastDay = new Date(year, month, 0).getDate();
    const cells = [];

    // lege cellen voor
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= lastDay; d++) cells.push(d);

    const users = window.state?.users || [];

    return `
<div class="verlof-cal">
  <div class="verlof-cal-head">
    <h3>Kalender — ${MONTHS[month]} ${year}</h3>
    <button class="verlof-cal-nav" id="cal-prev">‹</button>
    <button class="verlof-cal-nav" id="cal-next">›</button>
  </div>
  <div class="verlof-cal-grid">
    ${DAYS.map(d => `<div class="verlof-cal-day-name">${d}</div>`).join("")}
    ${cells.map(d => {
      if (!d) return `<div class="verlof-cal-cell other-month"></div>`;
      const pad = n => String(n).padStart(2, "0");
      const dateStr = `${year}-${pad(month)}-${pad(d)}`;
      const absentIds = days[dateStr] || [];
      const isToday = dateStr === today;
      const absentNames = absentIds.map(uid => {
        const u = users.find(u => u.id === uid);
        return u ? (u.name || u.email).split(" ")[0] : uid;
      });
      return `
      <div class="verlof-cal-cell${isToday ? " today" : ""}">
        <div class="cal-date">${d}</div>
        ${absentNames.slice(0, 3).map(n => `<span class="cal-absent">${esc(n)}</span>`).join("")}
        ${absentNames.length > 3 ? `<span class="cal-absent">+${absentNames.length - 3}</span>` : ""}
      </div>`;
    }).join("")}
  </div>
</div>`;
  }

  // ── events ───────────────────────────────────────────────────────────────────

  function bindEvents(container) {
    container.querySelector("#verlof-new")?.addEventListener("click", () => openDrawer(null));
    container.querySelector("#vf-status")?.addEventListener("change", e => { st.filterStatus = e.target.value; loadLeaves(); });
    container.querySelector("#vf-type")?.addEventListener("change", e => { st.filterType = e.target.value; loadLeaves(); });
    container.querySelector("#vf-user")?.addEventListener("change", e => { st.filterUser = e.target.value; loadLeaves(); });
    container.querySelector("#cal-prev")?.addEventListener("click", () => {
      st.calMonth--;
      if (st.calMonth < 1) { st.calMonth = 12; st.calYear--; }
      loadLeaves();
    });
    container.querySelector("#cal-next")?.addEventListener("click", () => {
      st.calMonth++;
      if (st.calMonth > 12) { st.calMonth = 1; st.calYear++; }
      loadLeaves();
    });

    container.querySelectorAll("[data-action='approve']").forEach(btn => {
      btn.addEventListener("click", () => reviewLeave(btn.dataset.id, "goedgekeurd"));
    });
    container.querySelectorAll("[data-action='reject']").forEach(btn => {
      btn.addEventListener("click", () => reviewLeaveWithNote(btn.dataset.id, "geweigerd"));
    });
    container.querySelectorAll("[data-action='cancel']").forEach(btn => {
      btn.addEventListener("click", () => reviewLeave(btn.dataset.id, "geannuleerd"));
    });
  }

  // ── acties ───────────────────────────────────────────────────────────────────

  async function reviewLeave(leaveId, decision, note = "") {
    try {
      await apiCall(`/api/tenants/${window.tenantId}/leaves/${leaveId}/review`, {
        method: "POST",
        body: JSON.stringify({ decision, reviewNote: note })
      });
      if (window.showToast) window.showToast(decision === "goedgekeurd" ? "Verlof goedgekeurd." : "Verlof geannuleerd.");
      await loadLeaves();
    } catch (e) {
      if (window.showToast) window.showToast(e.message, false);
    }
  }

  function reviewLeaveWithNote(leaveId, decision) {
    const note = window.prompt("Reden voor weigering (optioneel):") || "";
    reviewLeave(leaveId, decision, note);
  }

  // ── drawer ───────────────────────────────────────────────────────────────────

  function openDrawer(leave) {
    const existing = document.getElementById("verlof-drawer-backdrop");
    if (existing) existing.remove();

    const users = window.state?.users || [];
    const isAdmin = ["tenant_admin", "super_admin"].includes(window.state?.currentUser?.role);

    const userOptions = users.filter(u => u.active !== false && u.role !== "super_admin")
      .map(u => `<option value="${esc(u.id)}">${esc(u.name || u.email)}</option>`)
      .join("");

    const today = new Date().toISOString().slice(0, 10);

    const backdrop = document.createElement("div");
    backdrop.id = "verlof-drawer-backdrop";
    backdrop.className = "verlof-drawer-backdrop";
    backdrop.innerHTML = `
      <div class="verlof-drawer" id="verlof-drawer">
        <h2>${leave ? "Verlofdetail" : "Nieuwe verlofaanvraag"}</h2>
        <form id="verlof-form">
          ${isAdmin ? `
          <div class="verlof-field">
            <label>Medewerker</label>
            <select name="userId" required>
              <option value="">Kies medewerker…</option>
              ${userOptions}
            </select>
          </div>` : ""}
          <div class="verlof-field">
            <label>Type</label>
            <select name="type">
              <option value="vakantie">Vakantie</option>
              <option value="ziekte">Ziekte</option>
              <option value="overmacht">Overmacht</option>
              <option value="educatie">Educatie</option>
              <option value="onbetaald">Onbetaald verlof</option>
            </select>
          </div>
          <div class="verlof-field">
            <label>Startdatum</label>
            <input type="date" name="startDate" value="${today}" required min="${today}">
          </div>
          <div class="verlof-field">
            <label>Einddatum</label>
            <input type="date" name="endDate" value="${today}" required min="${today}">
          </div>
          <div class="verlof-field">
            <label>Reden (optioneel)</label>
            <textarea name="reason" placeholder="Korte toelichting…"></textarea>
          </div>
          <div class="verlof-drawer-footer">
            <button class="verlof-btn primary" type="submit">Aanvraag indienen</button>
            <button class="verlof-btn secondary" type="button" id="verlof-drawer-close">Annuleren</button>
          </div>
        </form>
      </div>`;

    document.body.appendChild(backdrop);

    backdrop.addEventListener("click", e => { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelector("#verlof-drawer-close").addEventListener("click", () => backdrop.remove());
    backdrop.querySelector("#verlof-form").addEventListener("submit", async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd.entries());
      try {
        await apiCall(`/api/tenants/${window.tenantId}/leaves`, {
          method: "POST",
          body: JSON.stringify(data)
        });
        backdrop.remove();
        if (window.showToast) window.showToast("Verlofaanvraag ingediend.");
        await loadLeaves();
      } catch (err) {
        if (window.showToast) window.showToast(err.message, false);
      }
    });
  }

  window.verlofInit = loadLeaves;
  window.verlofLoad = loadLeaves;
  window.verlofRender = renderVerlofPage;
}());
