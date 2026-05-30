/**
 * planning-calendar.js
 * Weekkalender met drag & drop, conflictdetectie en shift-modal
 * Gebruik: voeg toe in public/ en importeer via <script src="/planning-calendar.js"></script>
 *
 * Vereisten: window.token, window.tenantId, window.state (van main.js)
 * Rendert in: #planningExperience
 */

(function () {
  "use strict";

  // ── helpers ──────────────────────────────────────────────────────────────────

  function el(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function pad(n) { return String(n).padStart(2, "0"); }

  function isoWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const year = d.getFullYear();
    const start = new Date(year, 0, 1);
    return { week: Math.ceil(((d - start) / 86400000 + 1) / 7), year };
  }

  function weekDays(mondayDate) {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mondayDate);
      d.setDate(d.getDate() + i);
      days.push(d.toISOString().slice(0, 10));
    }
    return days;
  }

  function getMondayOf(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d.toISOString().slice(0, 10);
  }

  function timeToMin(t) {
    if (!t) return null;
    const [h, m] = String(t).split(":").map(Number);
    return h * 60 + (m || 0);
  }

  function overlaps(a, b) {
    const as = timeToMin(a.start), ae = timeToMin(a.end);
    const bs = timeToMin(b.start), be = timeToMin(b.end);
    if (as == null || ae == null || bs == null || be == null) return false;
    return as < be && bs < ae;
  }

  function personName(userId) {
    const users = window.state?.users || [];
    const u = users.find(x => x.id === userId);
    return u ? u.name : userId || "–";
  }

  function venueName(venueId) {
    const venues = window.state?.venues || [];
    const v = venues.find(x => x.id === venueId);
    return v ? v.name : venueId || "–";
  }

  function shiftColor(shift) {
    // Deterministic kleur per medewerker
    const colors = ["#1268d6", "#00a7c8", "#11975d", "#f28b18", "#8b5cf6", "#e53535", "#0891b2", "#059669"];
    const users = window.state?.users || [];
    const idx = users.findIndex(u => u.id === shift.userId);
    return colors[Math.abs(idx) % colors.length];
  }

  function statusBadge(shift) {
    const hour = new Date().getHours();
    const today = new Date().toISOString().slice(0, 10);
    if (shift.date < today) return { label: "Afgelopen", cls: "cal-badge-muted" };
    if (shift.date === today) return { label: "Vandaag", cls: "cal-badge-today" };
    return { label: "Gepland", cls: "cal-badge-planned" };
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

  // ── state ─────────────────────────────────────────────────────────────────────

  const cal = {
    monday: getMondayOf(new Date().toISOString().slice(0, 10)),
    dragShiftId: null,
    dragSourceDate: null,
    modal: null,
    editShiftId: null,
    loading: false
  };

  // ── render ────────────────────────────────────────────────────────────────────

  const STYLES = `
<style id="cal-styles">
.cal-wrap { font-family: Inter,"Segoe UI",Arial,sans-serif; color: #0f2744; }
.cal-toolbar { display:flex; align-items:center; gap:12px; margin-bottom:16px; flex-wrap:wrap; }
.cal-toolbar h3 { margin:0; font-size:16px; }
.cal-toolbar .cal-week-label { font-size:13px; color:#5f728c; }
.cal-nav { display:flex; gap:6px; }
.cal-nav button { border:1px solid #d9e3ef; background:#fff; color:#0f2744; border-radius:6px; padding:5px 12px; cursor:pointer; font-size:13px; }
.cal-nav button:hover { background:#f6f9fc; }
.cal-nav button.primary { background:#004a68; color:#fff; border-color:#004a68; }

.cal-grid { display:grid; grid-template-columns: 80px repeat(7,1fr); gap:0; border:1px solid #d9e3ef; border-radius:8px; overflow:hidden; background:#fff; }
.cal-col-head { padding:8px 6px; text-align:center; font-size:12px; font-weight:700; border-bottom:1px solid #d9e3ef; background:#f6f9fc; }
.cal-col-head.today { background:#e6f0ff; color:#1268d6; }
.cal-col-head.weekend { color:#5f728c; background:#fafafa; }
.cal-col-head small { display:block; font-weight:400; color:#5f728c; font-size:11px; }

.cal-time-col { border-right:1px solid #d9e3ef; }
.cal-time-slot { height:52px; display:flex; align-items:flex-start; padding:4px 6px; font-size:11px; color:#a0aec0; border-bottom:1px solid #f0f4f8; }

.cal-day-col { border-right:1px solid #d9e3ef; min-height:520px; position:relative; background:#fff; transition:background .15s; }
.cal-day-col:last-child { border-right:none; }
.cal-day-col.weekend { background:#fafafa; }
.cal-day-col.today { background:#f0f6ff; }
.cal-day-col.drag-over { background:#e6f0ff; outline:2px dashed #1268d6; outline-offset:-2px; }

.cal-slot { height:52px; border-bottom:1px solid #f0f4f8; cursor:pointer; position:relative; }
.cal-slot:hover::after { content:"+ Shift"; position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:11px; color:#1268d6; background:rgba(18,104,214,.06); }

.cal-shift {
  position:absolute; left:4px; right:4px;
  border-radius:6px; padding:4px 7px;
  font-size:12px; cursor:grab; cursor:-webkit-grab;
  border-left:3px solid; overflow:hidden;
  box-shadow:0 1px 4px rgba(0,0,0,.1);
  transition:opacity .12s, box-shadow .12s;
  z-index:2;
}
.cal-shift:active { cursor:grabbing; opacity:.7; box-shadow:0 4px 12px rgba(0,0,0,.18); }
.cal-shift strong { display:block; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cal-shift small { display:block; font-size:11px; opacity:.82; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.cal-shift .cal-conflict { position:absolute; top:3px; right:4px; width:8px; height:8px; border-radius:50%; background:#e53535; }

.cal-badge-muted { background:#e2e8f0; color:#5f728c; border-radius:4px; padding:1px 5px; font-size:10px; }
.cal-badge-today { background:#dbeafe; color:#1268d6; border-radius:4px; padding:1px 5px; font-size:10px; }
.cal-badge-planned { background:#dcfce7; color:#11975d; border-radius:4px; padding:1px 5px; font-size:10px; }

.cal-kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:16px; }
.cal-kpi { background:#fff; border:1px solid #d9e3ef; border-radius:8px; padding:12px 14px; }
.cal-kpi span { font-size:11px; color:#5f728c; text-transform:uppercase; letter-spacing:.04em; display:block; }
.cal-kpi strong { font-size:22px; font-weight:800; display:block; line-height:1.2; }
.cal-kpi small { font-size:11px; color:#5f728c; }
.cal-kpi.alert strong { color:#e53535; }

.cal-unplanned { margin-top:10px; }
.cal-unplanned-title { font-size:12px; font-weight:700; color:#5f728c; margin-bottom:6px; }
.cal-person-chips { display:flex; flex-wrap:wrap; gap:6px; }
.cal-person-chip { background:#f6f9fc; border:1px solid #d9e3ef; border-radius:20px; padding:3px 10px; font-size:12px; cursor:pointer; }
.cal-person-chip:hover { background:#e6f0ff; border-color:#1268d6; color:#1268d6; }

/* Modal */
.cal-modal-backdrop { position:fixed; inset:0; background:rgba(15,39,68,.38); z-index:100; display:flex; align-items:center; justify-content:center; }
.cal-modal { background:#fff; border-radius:10px; box-shadow:0 20px 60px rgba(0,0,0,.2); width:min(520px,92vw); max-height:90vh; overflow-y:auto; padding:26px; position:relative; }
.cal-modal h3 { margin:0 0 18px; font-size:18px; }
.cal-modal label { display:grid; gap:5px; font-size:13px; font-weight:700; margin-bottom:12px; }
.cal-modal input, .cal-modal select, .cal-modal textarea { min-height:38px; padding:0 10px; border:1px solid #d9e3ef; border-radius:6px; font-size:14px; width:100%; }
.cal-modal textarea { padding:8px 10px; resize:vertical; min-height:60px; }
.cal-modal .form-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.cal-modal .modal-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:18px; }
.cal-modal .modal-actions button { padding:8px 18px; border-radius:6px; font-size:14px; cursor:pointer; }
.cal-modal .btn-primary { background:#004a68; color:#fff; border:1px solid #004a68; }
.cal-modal .btn-primary:hover { background:#003a52; }
.cal-modal .btn-secondary { background:#fff; color:#0f2744; border:1px solid #d9e3ef; }
.cal-modal .btn-danger { background:#fff; color:#e53535; border:1px solid #e53535; }
.cal-modal .btn-danger:hover { background:#fff5f5; }
.cal-modal-close { position:absolute; top:14px; right:16px; background:none; border:none; font-size:20px; cursor:pointer; color:#5f728c; line-height:1; }
.cal-modal .conflict-warning { background:#fff5f5; border:1px solid #fca5a5; border-radius:6px; padding:10px 12px; font-size:13px; color:#e53535; margin-bottom:12px; }

.cal-loading { text-align:center; padding:40px; color:#5f728c; font-size:14px; }
</style>`;

  function renderCalendar() {
    const container = el("planningExperience");
    if (!container) return;

    if (!window.token) {
      container.innerHTML = `<div class="experience-empty"><strong>Login om de planning-kalender te gebruiken.</strong></div>`;
      return;
    }

    const days = weekDays(cal.monday);
    const today = new Date().toISOString().slice(0, 10);
    const { week, year } = isoWeek(cal.monday);
    const dayNames = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];
    const monthNames = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

    const allShifts = window.state?.planning || [];
    const weekShifts = allShifts.filter(s => s.date >= days[0] && s.date <= days[6]);
    const users = (window.state?.users || []).filter(u => u.role !== "tenant_admin" && u.role !== "super_admin");
    const plannedThisWeek = new Set(weekShifts.map(s => s.userId));
    const unplanned = users.filter(u => !plannedThisWeek.has(u.id));
    const conflicts = detectConflicts(weekShifts);
    const todayShifts = weekShifts.filter(s => s.date === today);

    // KPI's
    const kpisHtml = `
      <div class="cal-kpis">
        <div class="cal-kpi"><span>Shifts deze week</span><strong>${weekShifts.length}</strong><small>over ${plannedThisWeek.size} medewerkers</small></div>
        <div class="cal-kpi ${conflicts.length ? "alert" : ""}"><span>Conflicten</span><strong>${conflicts.length}</strong><small>${conflicts.length ? "dubbele bezetting" : "geen overlap"}</small></div>
        <div class="cal-kpi"><span>Vandaag gepland</span><strong>${todayShifts.length}</strong><small>${today}</small></div>
        <div class="cal-kpi"><span>Niet ingepland</span><strong>${unplanned.length}</strong><small>medewerkers</small></div>
      </div>`;

    // Tijdsloten 07:00 – 19:00
    const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

    const timeColHtml = `
      <div class="cal-time-col">
        <div class="cal-col-head" style="height:44px"></div>
        ${HOURS.map(h => `<div class="cal-time-slot">${pad(h)}:00</div>`).join("")}
      </div>`;

    const dayColsHtml = days.map((date, i) => {
      const isToday = date === today;
      const isWeekend = i >= 5;
      const d = new Date(date);
      const dayShifts = weekShifts.filter(s => s.date === date);
      const conflictIds = new Set(conflicts.flatMap(c => [c.a, c.b]));

      const shiftsHtml = dayShifts.map(shift => {
        const startMin = timeToMin(shift.start) || 7 * 60;
        const endMin = timeToMin(shift.end) || 16 * 60;
        const topPx = ((startMin - 7 * 60) / 60) * 52 + 44; // 44px = header
        const heightPx = Math.max(26, ((endMin - startMin) / 60) * 52 - 4);
        const color = shiftColor(shift);
        const hasConflict = conflictIds.has(shift.id);
        const initials = personName(shift.userId).slice(0, 2).toUpperCase();

        return `
          <div class="cal-shift"
            style="top:${topPx}px;height:${heightPx}px;background:${color}18;border-left-color:${color};color:#0f2744"
            draggable="true"
            data-shift-id="${esc(shift.id)}"
            data-shift-date="${esc(shift.date)}"
            title="${esc(personName(shift.userId))} · ${esc(shift.start)}–${esc(shift.end)} · ${esc(venueName(shift.venueId))}">
            ${hasConflict ? `<div class="cal-conflict" title="Planningsconflict"></div>` : ""}
            <strong style="color:${color}">${esc(initials)} ${esc(personName(shift.userId))}</strong>
            <small>${esc(shift.start)}–${esc(shift.end)} · ${esc(venueName(shift.venueId))}</small>
          </div>`;
      }).join("");

      const slotsHtml = HOURS.map(h => `
        <div class="cal-slot" data-date="${esc(date)}" data-hour="${h}"></div>
      `).join("");

      return `
        <div class="cal-day-col ${isToday ? "today" : ""} ${isWeekend ? "weekend" : ""}"
          data-date="${esc(date)}"
          ondragover="event.preventDefault();event.currentTarget.classList.add('drag-over')"
          ondragleave="event.currentTarget.classList.remove('drag-over')"
          ondrop="window.__calDrop && window.__calDrop(event)">
          <div class="cal-col-head ${isToday ? "today" : ""} ${isWeekend ? "weekend" : ""}">
            ${dayNames[i]}<small>${d.getDate()} ${monthNames[d.getMonth()]}</small>
          </div>
          ${slotsHtml}
          ${shiftsHtml}
        </div>`;
    }).join("");

    const unplannedHtml = unplanned.length ? `
      <div class="cal-unplanned">
        <div class="cal-unplanned-title">Niet ingepland deze week:</div>
        <div class="cal-person-chips">
          ${unplanned.map(u => `<span class="cal-person-chip" data-user-id="${esc(u.id)}" title="Klik om te plannen">${esc(u.name)}</span>`).join("")}
        </div>
      </div>` : "";

    container.innerHTML = `
      ${STYLES}
      <div class="cal-wrap">
        ${kpisHtml}
        <div class="cal-toolbar">
          <h3>Weekkalender</h3>
          <span class="cal-week-label">Week ${week} · ${year}</span>
          <div class="cal-nav">
            <button id="cal-prev">← Vorige</button>
            <button id="cal-today">Vandaag</button>
            <button id="cal-next">Volgende →</button>
            <button id="cal-new-shift" class="primary">+ Nieuwe shift</button>
          </div>
        </div>
        <div class="cal-grid" id="cal-grid">
          ${timeColHtml}
          ${dayColsHtml}
        </div>
        ${unplannedHtml}
      </div>`;

    bindEvents(container);
  }

  function detectConflicts(shifts) {
    const conflicts = [];
    const byUser = {};
    for (const s of shifts) {
      if (!s.userId) continue;
      if (!byUser[s.userId]) byUser[s.userId] = [];
      byUser[s.userId].push(s);
    }
    for (const userShifts of Object.values(byUser)) {
      for (let i = 0; i < userShifts.length; i++) {
        for (let j = i + 1; j < userShifts.length; j++) {
          const a = userShifts[i], b = userShifts[j];
          if (a.date === b.date && overlaps(a, b)) {
            conflicts.push({ a: a.id, b: b.id, userId: a.userId, date: a.date });
          }
        }
      }
    }
    return conflicts;
  }

  // ── modal ─────────────────────────────────────────────────────────────────────

  function openModal(opts = {}) {
    closeModal();
    const users = (window.state?.users || []).filter(u => u.active !== false && u.role !== "super_admin");
    const venues = window.state?.venues || [];
    const shift = opts.shift || {};
    const isEdit = !!shift.id;
    cal.editShiftId = shift.id || null;

    const conflictHtml = opts.conflict ? `<div class="conflict-warning">⚠ Planningsconflict gedetecteerd. Controleer de tijden.</div>` : "";

    const backdrop = document.createElement("div");
    backdrop.className = "cal-modal-backdrop";
    backdrop.id = "cal-modal-backdrop";
    backdrop.innerHTML = `
      <div class="cal-modal" role="dialog" aria-modal="true" aria-label="Shift ${isEdit ? "aanpassen" : "aanmaken"}">
        <button class="cal-modal-close" id="cal-modal-close" aria-label="Sluiten">×</button>
        <h3>${isEdit ? "Shift aanpassen" : "Nieuwe shift"}</h3>
        ${conflictHtml}
        <label>Medewerker
          <select id="cal-modal-user" required>
            <option value="">— Kies medewerker —</option>
            ${users.map(u => `<option value="${esc(u.id)}" ${shift.userId === u.id ? "selected" : ""}>${esc(u.name)} (${esc(u.role)})</option>`).join("")}
          </select>
        </label>
        <label>Werf
          <select id="cal-modal-venue">
            <option value="">— Geen werf —</option>
            ${venues.map(v => `<option value="${esc(v.id)}" ${shift.venueId === v.id ? "selected" : ""}>${esc(v.name)}</option>`).join("")}
          </select>
        </label>
        <label>Datum
          <input type="date" id="cal-modal-date" value="${esc(shift.date || opts.date || new Date().toISOString().slice(0, 10))}" required>
        </label>
        <div class="form-row">
          <label>Starttijd
            <input type="time" id="cal-modal-start" value="${esc(shift.start || opts.start || "08:00")}" required>
          </label>
          <label>Eindtijd
            <input type="time" id="cal-modal-end" value="${esc(shift.end || "16:30")}" required>
          </label>
        </div>
        <label>Project / Opdracht
          <input type="text" id="cal-modal-project" placeholder="bv. Werf Antwerpen" value="${esc(shift.project || "")}">
        </label>
        <label>Notitie
          <textarea id="cal-modal-note" placeholder="Optionele notitie voor de medewerker">${esc(shift.note || "")}</textarea>
        </label>
        <div class="modal-actions">
          ${isEdit ? `<button class="btn-danger" id="cal-modal-delete">Verwijderen</button>` : ""}
          <button class="btn-secondary" id="cal-modal-cancel">Annuleren</button>
          <button class="btn-primary" id="cal-modal-save">${isEdit ? "Opslaan" : "Shift aanmaken"}</button>
        </div>
      </div>`;

    document.body.appendChild(backdrop);
    bindModalEvents(backdrop);
  }

  function closeModal() {
    const existing = el("cal-modal-backdrop");
    if (existing) existing.remove();
    cal.editShiftId = null;
  }

  function bindModalEvents(backdrop) {
    el("cal-modal-close")?.addEventListener("click", closeModal);
    el("cal-modal-cancel")?.addEventListener("click", closeModal);
    backdrop.addEventListener("click", e => { if (e.target === backdrop) closeModal(); });

    el("cal-modal-delete")?.addEventListener("click", async () => {
      if (!cal.editShiftId) return;
      if (!confirm("Shift verwijderen?")) return;
      try {
        await apiCall(`/api/modules/shifts/${cal.editShiftId}`, { method: "DELETE" });
        closeModal();
        await refreshAndRender();
      } catch (err) { alert(err.message); }
    });

    el("cal-modal-save")?.addEventListener("click", async () => {
      const userId = el("cal-modal-user")?.value;
      const venueId = el("cal-modal-venue")?.value;
      const date = el("cal-modal-date")?.value;
      const start = el("cal-modal-start")?.value;
      const end = el("cal-modal-end")?.value;
      const project = el("cal-modal-project")?.value;
      const note = el("cal-modal-note")?.value;

      if (!userId || !date || !start || !end) { alert("Medewerker, datum en tijden zijn verplicht."); return; }
      if (timeToMin(start) >= timeToMin(end)) { alert("Eindtijd moet na starttijd liggen."); return; }

      const body = { userId, venueId: venueId || undefined, date, start, end, project, note, tenantId: window.tenantId };
      try {
        if (cal.editShiftId) {
          await apiCall(`/api/modules/shifts/${cal.editShiftId}?tenantId=${window.tenantId}`, {
            method: "PATCH", body: JSON.stringify(body)
          });
        } else {
          await apiCall(`/api/modules/shifts?tenantId=${window.tenantId}`, {
            method: "POST", body: JSON.stringify(body)
          });
        }
        closeModal();
        await refreshAndRender();
      } catch (err) {
        if (err.message.includes("conflict")) {
          openModal({ shift: { userId, venueId, date, start, end, project, note }, conflict: true, date });
        } else { alert(err.message); }
      }
    });
  }

  // ── drag & drop ───────────────────────────────────────────────────────────────

  window.__calDrop = async function (event) {
    event.preventDefault();
    event.currentTarget.classList.remove("drag-over");
    if (!cal.dragShiftId) return;

    const newDate = event.currentTarget.dataset.date;
    if (!newDate || newDate === cal.dragSourceDate) return;

    try {
      await apiCall(`/api/modules/shifts/${cal.dragShiftId}?tenantId=${window.tenantId}`, {
        method: "PATCH",
        body: JSON.stringify({ date: newDate, tenantId: window.tenantId })
      });
      await refreshAndRender();
    } catch (err) { alert("Verplaatsen mislukt: " + err.message); }
    cal.dragShiftId = null;
    cal.dragSourceDate = null;
  };

  // ── navigatie ─────────────────────────────────────────────────────────────────

  function shiftWeek(delta) {
    const d = new Date(cal.monday);
    d.setDate(d.getDate() + delta * 7);
    cal.monday = d.toISOString().slice(0, 10);
    renderCalendar();
  }

  async function refreshAndRender() {
    if (!window.token) { renderCalendar(); return; }
    try {
      const [usersData, shiftsData, venuesData] = await Promise.all([
        apiCall(`/api/modules/users?tenantId=${window.tenantId}`),
        apiCall(`/api/modules/shifts?tenantId=${window.tenantId}`),
        apiCall(`/api/modules/venues?tenantId=${window.tenantId}`)
      ]);
      if (window.state) {
        window.state.users = usersData.rows || [];
        window.state.planning = shiftsData.rows || [];
        window.state.venues = venuesData.rows || [];
      }
    } catch (e) { /* gebruik bestaande state */ }
    renderCalendar();
  }

  // ── event binding ─────────────────────────────────────────────────────────────

  function bindEvents(container) {
    // Navigatie
    el("cal-prev")?.addEventListener("click", () => shiftWeek(-1));
    el("cal-next")?.addEventListener("click", () => shiftWeek(1));
    el("cal-today")?.addEventListener("click", () => {
      cal.monday = getMondayOf(new Date().toISOString().slice(0, 10));
      renderCalendar();
    });
    el("cal-new-shift")?.addEventListener("click", () => openModal());

    // Shift klik → edit modal
    container.querySelectorAll(".cal-shift").forEach(shiftEl => {
      shiftEl.addEventListener("click", e => {
        e.stopPropagation();
        const shiftId = shiftEl.dataset.shiftId;
        const shift = (window.state?.planning || []).find(s => s.id === shiftId);
        if (shift) openModal({ shift });
      });

      // Drag start
      shiftEl.addEventListener("dragstart", e => {
        cal.dragShiftId = shiftEl.dataset.shiftId;
        cal.dragSourceDate = shiftEl.dataset.shiftDate;
        shiftEl.style.opacity = "0.5";
      });
      shiftEl.addEventListener("dragend", () => { shiftEl.style.opacity = "1"; });
    });

    // Leeg slot klik → nieuwe shift
    container.querySelectorAll(".cal-slot").forEach(slot => {
      slot.addEventListener("click", e => {
        const date = slot.dataset.date;
        const hour = slot.dataset.hour;
        openModal({ date, start: `${pad(hour)}:00` });
      });
    });

    // Niet-ingeplande medewerker klik
    container.querySelectorAll(".cal-person-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const users = window.state?.users || [];
        const user = users.find(u => u.id === chip.dataset.userId);
        const today = new Date().toISOString().slice(0, 10);
        openModal({ shift: { userId: chip.dataset.userId }, date: today });
      });
    });
  }

  // ── init ──────────────────────────────────────────────────────────────────────

  function init() {
    refreshAndRender();
  }

  // Expose voor main.js
  window.calendarInit = init;
  window.calendarRender = renderCalendar;
  window.calendarRefresh = refreshAndRender;
})();
