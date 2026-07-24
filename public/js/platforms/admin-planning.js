/* ── Planning · teamplanning, capaciteit en shiftdrawer ──────────────────────
 * Letterlijk uit public/js/platforms/admin.js geknipt (regels 2228-2678 van de
 * monoliet). Alleen de omhulling veranderde: deze werkruimte LEEST de gedeelde
 * context window.wfpAdmin en registreert zichzelf in A.views.planning en
 * A.drawers.shift. Er is bewust niets herschreven of opgeruimd · een extractie
 * die onderweg gedrag wijzigt is niet te reviewen.
 */
(function () {
  "use strict";

  const A = window.wfpAdmin;
  if (!A) return;

  // Alles wat NIET meeverhuisde komt uit de gedeelde context · nooit kopieren,
  // anders ontstaan er twee waarheden.
  const api = A.api;
  const esc = A.esc;
  const tA = A.tA;
  const uName = A.uName;
  const uiConfirm = A.uiConfirm;
  const viewEnabled = A.viewEnabled;
  const getWeekStart = A.getWeekStart;
  const openDrawer = A.openDrawer;
  const closeDrawer = A.closeDrawer;
  const openWorkorderDrawer = A.openWorkorderDrawer;

  // ── Planning ───────────────────────────────────────────────
  let _planningWeekOffset = 0; // weeks relative to current week
  let _planningMode = "week"; // week | day | capacity
  let _planningEmployee = "";
  let _planningLocation = "";

  async function renderPlanning() {
    const today = new Date().toISOString().slice(0, 10);
    const baseWeek = getWeekStart(new Date());
    baseWeek.setDate(baseWeek.getDate() + _planningWeekOffset * 7);
    const weekEnd = new Date(baseWeek); weekEnd.setDate(baseWeek.getDate() + 6);
    const from = baseWeek.toISOString().slice(0, 10);
    const to = weekEnd.toISOString().slice(0, 10);

    const [planData, leaveData, employeeData, workorderData, venueData] = await Promise.all([
      api("GET", `/manager/planning?from=${from}&to=${to}`),
      api("GET", `/leaves?from=${from}&to=${to}&status=goedgekeurd`).catch(() => ({ leaves: [] })),
      api("GET", "/employees").catch(() => ({ employees: [] })),
      viewEnabled("workorders") ? api("GET", "/workorders").catch(() => ({ workorders: [] })) : { workorders: [] },
      viewEnabled("venues") ? api("GET", "/venues").catch(() => ({ venues: [] })) : { venues: [] }
    ]);
    const rawShifts = Array.isArray(planData) ? planData : (planData.shifts || []);
    const venues = venueData.venues || venueData.rows || [];
    const venueById = Object.fromEntries(venues.map(venue => [venue.id, venue]));
    const allShifts = rawShifts.map(shift => {
      const venue = venueById[shift.venueId];
      const legacyLocation = shift.venueId && !venue ? shift.venueId : "";
      return {
        ...shift,
        venueName: venue?.name || shift.venueName || null,
        locationLabel: shift.location || venue?.name || shift.venueName || legacyLocation || ""
      };
    });
    const employees = (employeeData.employees || employeeData || [])
      .filter(user => !["tenant_admin", "super_admin"].includes(user.role) && user.active !== false);
    const workorders = workorderData.workorders || workorderData || [];
    // Build leave map: userId → Set of dates on leave
    const leaveMap = {};
    (leaveData.leaves || []).forEach(l => {
      if (!l.userId || !l.startDate || !l.endDate) return;
      for (let d = new Date(l.startDate); d.toISOString().slice(0,10) <= l.endDate; d.setDate(d.getDate()+1)) {
        const dk = d.toISOString().slice(0,10);
        if (!leaveMap[l.userId]) leaveMap[l.userId] = {};
        leaveMap[l.userId][dk] = l.type || "verlof";
      }
    });

    const weekDays = [];
    for (let d = new Date(baseWeek); d <= weekEnd; d.setDate(d.getDate() + 1)) {
      weekDays.push(d.toISOString().slice(0, 10));
    }
    const days = _planningMode === "day" ? [today >= from && today <= to ? today : from] : weekDays;

    const locations = [...new Set(allShifts.map(shift => shift.locationLabel).filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b)));
    const shifts = allShifts.filter(shift =>
      (!_planningEmployee || shift.userId === _planningEmployee) &&
      (!_planningLocation || shift.locationLabel === _planningLocation)
    );
    const visibleEmployees = employees.filter(user => !_planningEmployee || user.id === _planningEmployee);

    const toMinutes = value => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
      return match ? Number(match[1]) * 60 + Number(match[2]) : null;
    };
    const plannedMinutes = shifts.reduce((sum, shift) => {
      const start = toMinutes(shift.start), end = toMinutes(shift.end);
      return sum + (start != null && end != null ? Math.max(0, end - start) : 0);
    }, 0);
    const groups = {};
    shifts.forEach(shift => { const key = `${shift.userId}::${shift.date}`; (groups[key] ||= []).push(shift); });
    let conflictCount = 0;
    Object.values(groups).forEach(rows => {
      const sorted = rows.map(row => ({ start:toMinutes(row.start), end:toMinutes(row.end) })).filter(row => row.start != null && row.end != null).sort((a,b) => a.start - b.start);
      for (let index = 1; index < sorted.length; index += 1) if (sorted[index].start < sorted[index - 1].end) conflictCount += 1;
    });
    const leavePeople = Object.keys(leaveMap).length;
    const capacityHours = _planningMode === "day" ? 8 : 40;
    const capacityBase = Math.max(1, visibleEmployees.length || new Set(shifts.map(s => s.userId)).size) * capacityHours * 60;
    const capacityPct = Math.round(plannedMinutes / capacityBase * 100);
    const openWorkorders = workorders.filter(order => !["Voltooid", "Afgewerkt", "geannuleerd", "cancelled"].includes(order.status));
    const unscheduled = openWorkorders.filter(order => !order.scheduledDate || !order.userId).slice(0, 5);

    const weekLabel = `${new Date(from).toLocaleDateString("nl-BE",{day:"numeric",month:"short"})} – ${new Date(to).toLocaleDateString("nl-BE",{day:"numeric",month:"short",year:"numeric"})}`;

    const content = document.getElementById("admContent");
    content.innerHTML = `
<div class="adm-planning-page">
  <section class="adm-planning-title">
    <div><span class="adm-eyebrow">Resource planning</span><h2>Teamplanning</h2><p>Zie capaciteit, beschikbaarheid en opdrachten in één rustig werkvlak.</p></div>
    <button class="adm-btn adm-btn-primary" id="admAddShift">+ Nieuwe planning</button>
  </section>
  <section class="adm-planning-toolbar">
    <div class="adm-week-navigation">
      <button type="button" id="admPrevWeek" aria-label="Vorige week">‹</button>
      <button type="button" id="admNextWeek" aria-label="Volgende week">›</button>
      <button type="button" class="adm-today-button" id="admTodayWeek">Vandaag</button>
      <strong>${weekLabel}</strong>
    </div>
    <div class="adm-planning-controls">
      <select id="admPlanningEmployee" aria-label="Filter medewerker"><option value="">Alle medewerkers</option>${employees.map(user => `<option value="${esc(user.id)}" ${_planningEmployee === user.id ? "selected" : ""}>${esc(user.name || user.email)}</option>`).join("")}</select>
      <select id="admPlanningLocation" aria-label="Filter locatie"><option value="">Alle locaties</option>${locations.map(location => `<option value="${esc(location)}" ${_planningLocation === location ? "selected" : ""}>${esc(location)}</option>`).join("")}</select>
      <div class="adm-view-switch" role="group" aria-label="Planningweergave">
        <button type="button" data-planning-mode="week" class="${_planningMode === "week" ? "active" : ""}">Week</button>
        <button type="button" data-planning-mode="day" class="${_planningMode === "day" ? "active" : ""}">Dag</button>
        <button type="button" data-planning-mode="capacity" class="${_planningMode === "capacity" ? "active" : ""}">Capaciteit</button>
      </div>
    </div>
  </section>
  <section class="adm-planning-metrics">
    <span><small>Geplande uren</small><b>${(plannedMinutes / 60).toLocaleString("nl-BE", { maximumFractionDigits:1 })} u</b></span>
    <span><small>Actieve shifts</small><b>${shifts.length}</b></span>
    <span><small>Op verlof</small><b>${leavePeople}</b></span>
    <span><small>Conflicten</small><b class="${conflictCount ? "metric-red" : "metric-green"}">${conflictCount}</b></span>
    <div><span>Weekcapaciteit</span><i><b style="width:${Math.min(100, capacityPct)}%"></b></i><strong>${capacityPct}%</strong></div>
  </section>
  ${_planningMode === "capacity" ? renderPlanningCapacity(shifts, visibleEmployees, leaveMap, from) : `
  <div class="adm-planning-workspace">
    <section class="adm-modern-planner" style="--day-count:${days.length};--planner-min:${190 + days.length * 160}px">
      <div class="adm-modern-planner-head"><span>Medewerker</span>${days.map(d => {
        const date = new Date(`${d}T12:00:00`);
        return `<div class="${d === today ? "today" : ""}"><b>${esc(date.toLocaleDateString("nl-BE", { weekday:"short", day:"numeric", month:"short" }).replace(".", ""))}</b>${d === today ? "<i></i>" : ""}</div>`;
      }).join("")}</div>
      ${renderPlanningRows(shifts, days, leaveMap, visibleEmployees)}
    </section>
    <aside class="adm-planning-side">
      <section class="adm-planning-side-card"><div class="adm-side-card-head"><span class="adm-eyebrow">Nog te plannen</span><b>${unscheduled.length}</b></div>
        ${unscheduled.map(order => `<button type="button" class="adm-unscheduled-work" data-id="${esc(order.id)}"><i class="${order.priority === "urgent" ? "urgent" : ""}"></i><span><b>${esc(order.title || order.number || "Werkbon")}</b><small>${esc(order.clientName || order.customerName || "Nog geen klant")} · ${esc(order.status || "open")}</small></span><em>→</em></button>`).join("") || `<p class="adm-side-empty">Alle open opdrachten zijn toegewezen.</p>`}
      </section>
      <section class="adm-planning-insight ${conflictCount ? "warning" : "ok"}"><span>${conflictCount ? "!" : "✓"}</span><div><b>${conflictCount ? `${conflictCount} planningsconflict${conflictCount === 1 ? "" : "en"}` : "Planning is conflictvrij"}</b><p>${conflictCount ? "Controleer overlappende shifts voor je de week publiceert." : "Geen overlappende shifts in deze selectie."}</p></div></section>
      <button type="button" class="adm-copy-week" id="admCopyWeek">⧉ Kopieer deze week</button>
    </aside>
  </div>`}
</div>`;
    document.getElementById("admAddShift")?.addEventListener("click", () => openShiftDrawer(from, to, null, shifts));
    document.getElementById("admPrevWeek")?.addEventListener("click", () => { _planningWeekOffset--; renderPlanning(); });
    document.getElementById("admNextWeek")?.addEventListener("click", () => { _planningWeekOffset++; renderPlanning(); });
    document.getElementById("admTodayWeek")?.addEventListener("click", () => { _planningWeekOffset = 0; renderPlanning(); });
    document.getElementById("admPlanningEmployee")?.addEventListener("change", event => { _planningEmployee = event.target.value; renderPlanning(); });
    document.getElementById("admPlanningLocation")?.addEventListener("change", event => { _planningLocation = event.target.value; renderPlanning(); });
    document.querySelectorAll("[data-planning-mode]").forEach(button => button.addEventListener("click", () => { _planningMode = button.dataset.planningMode; renderPlanning(); }));
    document.getElementById("admCopyWeek")?.addEventListener("click", async () => {
      if (!shifts.length) { window.showToast && window.showToast(tA("adm.plan.copyNone","Geen shifts om te kopiëren"), "info"); return; }
      const btn = document.getElementById("admCopyWeek");
      btn.disabled = true; btn.textContent = tA("adm.busy","Bezig…");
      try {
        const nextWeekBase = new Date(baseWeek); nextWeekBase.setDate(nextWeekBase.getDate() + 7);
        let copied = 0;
        for (const s of shifts) {
          const oldDate = new Date(s.date);
          const newDate = new Date(oldDate); newDate.setDate(oldDate.getDate() + 7);
          await api("POST", "/planning", {
            userId: s.userId,
            date: newDate.toISOString().slice(0,10),
            start: s.start,
            end: s.end,
            venueId: s.venueId || null,
            note: s.note || "",
            workorderId: s.workorderId || null
          });
          copied++;
        }
        window.showToast && window.showToast(tA("adm.plan.copied","{n} shifts gekopieerd naar volgende week").replace("{n}", copied), "success");
        _planningWeekOffset++;
        renderPlanning();
      } catch(e) { window.showToast && window.showToast(e.message, "error"); btn.disabled = false; btn.textContent = tA("adm.plan.copyWeek","⧉ Kopieer week"); }
    });
    document.querySelectorAll(".adm-shift-pill").forEach(pill => {
      pill.setAttribute("draggable", "true");
      pill.addEventListener("dragstart", event => {
        pill.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", pill.dataset.id);
      });
      pill.addEventListener("dragend", () => pill.classList.remove("is-dragging"));
      pill.addEventListener("click", () => {
        const shift = shifts.find(s => s.id === pill.dataset.id);
        if (shift) openShiftDrawer(from, to, shift, shifts);
      });
    });
    document.querySelectorAll(".adm-planner-cell").forEach(cell => {
      cell.addEventListener("dragover", event => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        cell.classList.add("is-drop-target");
      });
      cell.addEventListener("dragleave", event => {
        if (!cell.contains(event.relatedTarget)) cell.classList.remove("is-drop-target");
      });
      cell.addEventListener("drop", async event => {
        event.preventDefault();
        cell.classList.remove("is-drop-target");
        const shiftId = event.dataTransfer.getData("text/plain");
        const shift = shifts.find(row => row.id === shiftId);
        const userId = cell.dataset.user;
        const date = cell.dataset.date;
        if (!shift || !userId || !date || (shift.userId === userId && shift.date === date)) return;
        cell.classList.add("is-saving");
        try {
          await api("PATCH", `/planning/${shift.id}`, { userId, date });
          window.showToast && window.showToast(`Planning verplaatst naar ${new Date(`${date}T12:00:00`).toLocaleDateString("nl-BE", { weekday:"short", day:"numeric", month:"short" })}.`, "success");
          renderPlanning();
        } catch (error) {
          cell.classList.remove("is-saving");
          window.showToast && window.showToast(error.message, "error");
        }
      });
    });
    document.querySelectorAll(".adm-empty-slot").forEach(slot => slot.addEventListener("click", () => openShiftDrawer(from, to, null, shifts, { userId:slot.dataset.user, date:slot.dataset.date })));
    document.querySelectorAll(".adm-unscheduled-work").forEach(button => button.addEventListener("click", () => {
      const order = workorders.find(row => row.id === button.dataset.id);
      if (order) openWorkorderDrawer(order, workorders);
    }));
  }

  function renderPlanningCapacity(shifts, employees, leaveMap, referenceDate) {
    const rows = employees.length ? employees : [...new Map(shifts.map(shift => [shift.userId, { id:shift.userId, name:uName(shift) }])).values()];
    if (!rows.length) return `<div class="adm-planning-empty">Voeg medewerkers en shifts toe om capaciteit te berekenen.</div>`;
    return `<section class="adm-capacity-board">${rows.map((user, index) => {
      const userShifts = shifts.filter(shift => shift.userId === user.id);
      const minutes = userShifts.reduce((sum, shift) => {
        const [sh, sm] = String(shift.start || "0:0").split(":").map(Number), [eh, em] = String(shift.end || "0:0").split(":").map(Number);
        return sum + Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
      }, 0);
      const pct = Math.round(minutes / (40 * 60) * 100);
      const initials = String(user.name || user.email || "M").split(/\s+/).slice(0,2).map(value => value[0]).join("").toUpperCase();
      const onLeave = Object.keys(leaveMap[user.id] || {}).length;
      return `<article><i class="capacity-avatar color-${index % 5}">${esc(initials)}</i><span class="capacity-person"><b>${esc(user.name || user.email || "Medewerker")}</b><small>${user.function || user.role || "Team"}</small></span><span class="person-capacity"><span><b>${(minutes / 60).toLocaleString("nl-BE", { maximumFractionDigits:1 })} u</b><small>van 40 u</small></span><i><b style="width:${Math.min(100,pct)}%"></b></i></span><em class="${pct >= 95 ? "nearly-full" : "available"}">${onLeave ? `${onLeave}d verlof` : pct >= 95 ? "Bijna vol" : "Beschikbaar"}</em><button type="button" class="adm-empty-slot" data-user="${esc(user.id)}" data-date="${esc(referenceDate)}">+ Inplannen</button></article>`;
    }).join("")}</section>`;
  }

  // Persoonlijke kleuren per medewerker (cyclisch)
  const PLAN_COLORS = [
    ["var(--wf-blue-l)","var(--wf-blue)"],["var(--wf-green-l)","var(--wf-green)"],["var(--wf-yellow-l)","var(--wf-yellow)"],
    ["var(--wf-purple-l)","var(--wf-purple)"],["var(--wf-purple-l)","var(--wf-purple)"],["var(--wf-blue-l)","var(--wf-blue-d)"],
    ["var(--wf-red-l)","var(--wf-red)"],["var(--wf-blue-l)","var(--wf-blue)"]
  ];
  const _planColorMap = {};
  let _planColorIdx = 0;
  function planColor(userId) {
    if (!_planColorMap[userId]) {
      _planColorMap[userId] = PLAN_COLORS[_planColorIdx % PLAN_COLORS.length];
      _planColorIdx++;
    }
    return _planColorMap[userId];
  }

  function renderPlanningRows(shifts, days, leaveMap = {}, employees = []) {
    const today = new Date().toISOString().slice(0,10);
    const byUser = {};
    shifts.forEach(s => {
      if (!byUser[s.userId]) byUser[s.userId] = { name: uName(s), days: {} };
      if (!byUser[s.userId].days[s.date]) byUser[s.userId].days[s.date] = [];
      byUser[s.userId].days[s.date].push(s);
    });
    employees.forEach(user => {
      if (!byUser[user.id]) byUser[user.id] = { id:user.id, name:user.name || user.email, role:user.function || user.role || "Team", days:{} };
      else { byUser[user.id].id = user.id; byUser[user.id].role = user.function || user.role || "Team"; }
    });
    // Also add leave-only users to the grid
    Object.keys(leaveMap).forEach(uid => {
      if (!byUser[uid]) {
        const leaveUser = Object.values(leaveMap[uid] || {});
        byUser[uid] = { id:uid, name: uid, role:"Verlof", days: {}, leaveOnly: true };
      }
    });
    if (!Object.keys(byUser).length) return `<div class="adm-planning-empty">Nog geen medewerkers of shifts in deze selectie.</div>`;
    return Object.entries(byUser).map(([userId, u], rowIndex) => {
      const [bg, fg] = planColor(userId || "x");
      const totalShifts = Object.values(u.days).reduce((s,d)=>s+d.length,0);
      const initials = String(u.name || "M").split(/\s+/).slice(0,2).map(value => value[0]).join("").toUpperCase();
      return `<div class="adm-modern-planner-row">
        <div class="adm-planner-person"><i class="color-${rowIndex % 5}">${esc(initials)}</i><span><b>${esc(u.name)}</b><small>${esc(u.role || `${totalShifts} shifts`)} · ${totalShifts} shift${totalShifts === 1 ? "" : "s"}</small></span></div>
        ${days.map(d => {
          const dayShifts = u.days[d] || [];
          const isToday = d === today;
          const onLeave = leaveMap[userId]?.[d];
          return `<div class="adm-planner-cell ${isToday ? "today" : ""} ${onLeave ? "on-leave" : ""}" data-user="${esc(userId)}" data-date="${esc(d)}">
            ${onLeave && !dayShifts.length ? `<span class="adm-leave-slot"><i></i>${esc(onLeave)}</span>` : ""}
            ${dayShifts.map(s =>
              `<button type="button" class="adm-shift-pill" data-id="${esc(s.id)}" title="${esc(s.note||s.locationLabel||"")} · klik om te bewerken" style="--shift-bg:${bg};--shift-color:${fg}"><span><b>${esc(s.note || s.project || s.locationLabel || "Geplande opdracht")}</b><em>${esc(s.status || "Shift")}</em></span><small>${esc(s.locationLabel || "Locatie nog te bepalen")}</small><time>${esc(s.start||"")}${s.end?` – ${esc(s.end)}`:""}</time></button>`
            ).join("")||(!onLeave?`<button type="button" class="adm-empty-slot" data-user="${esc(userId)}" data-date="${esc(d)}">+ Inplannen</button>`:"")}
          </div>`;
        }).join("")}
      </div>`;
    }).join("");
  }

  // ── Shift drawer (admin) ───────────────────────────────────
  function openShiftDrawer(weekFrom, weekTo, shift = null, allShifts = [], prefill = {}) {
    const today = new Date().toISOString().slice(0, 10);
    Promise.all([
      api("GET", "/employees"),
      api("GET", "/venues").catch(() => ({ venues: [] }))
    ]).then(([data, venueData]) => {
      const employees = data.employees || [];
      const venues = venueData.venues || venueData.rows || [];
      const selectedVenueId = shift?.venueId || prefill.venueId || "";
      const selectedVenue = venues.find(venue => venue.id === selectedVenueId);
      const legacyLocation = selectedVenue ? "" : (shift?.venueId || "");
      const isEdit = !!shift;
      const drawer = document.getElementById("admDrawer");
      drawer.dataset.editorKind = "planning";
      document.getElementById("admDrawerContext").textContent = isEdit ? "Operaties · Planningdetail" : "Operaties · Nieuwe planning";
      document.getElementById("admDrawerTitle").textContent = isEdit ? (shift.note || shift.project || "Planning bewerken") : "Nieuwe planning";
      document.getElementById("admDrawerBody").innerHTML = `
<form id="admShiftForm" class="adm-planning-detail">
  <input type="hidden" name="workorderId" value="${esc(shift?.workorderId || prefill.workorderId || "")}">
  <div class="adm-planning-detail-status">
    <span class="mn-status ${isEdit ? "mn-status-info" : "mn-status-warning"}">${isEdit ? esc(shift.status || "Gepland") : "Nieuwe planning"}</span>
    <span>${isEdit ? `Laatst gekend op ${esc(shift.date || "")}` : "Vul de opdracht en uitvoering in"}</span>
  </div>
  <div class="adm-planning-detail-grid">
  <div class="adm-planning-detail-main">
  <section class="adm-planning-detail-section">
    <div class="adm-planning-detail-heading"><span>01</span><div><h3>Opdracht en uitvoering</h3><p>Wie voert de opdracht uit, waar en wanneer?</p></div></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Medewerker *</label>
      <select name="userId" required>
        <option value="">- Kies medewerker -</option>
        ${employees.map(u => `<option value="${esc(u.id)}" ${(shift?.userId||prefill.userId)===u.id?"selected":""}>${esc(u.name || u.email)}</option>`).join("")}
      </select>
    </div>
    <div class="adm-form-group"><label>Datum *</label>
      <input name="date" type="date" value="${shift?.date || prefill.date || weekFrom || today}" required>
    </div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Starttijd *</label>
      <input name="start" type="time" value="${shift?.start || "07:00"}" required>
    </div>
    <div class="adm-form-group"><label>Eindtijd *</label>
      <input name="end" type="time" value="${shift?.end || "17:00"}" required>
    </div>
  </div>
  <div class="adm-form-group"><label>Werf / locatie</label>
    <select name="venueId" id="shiftVenue">
      <option value="">Geen vaste werf</option>
      ${venues.map(venue => `<option value="${venue.id}" ${selectedVenueId === venue.id ? "selected" : ""}>${esc(venue.name || venue.address || "Locatie")}</option>`).join("")}
    </select>
    <div class="adm-form-hint">Bewaar de echte werfkoppeling voor werkbon, planning en rapportage.</div>
    ${legacyLocation ? `<div class="planning-legacy-location">Oude vrije locatie: <strong>${esc(legacyLocation)}</strong>. Kies een bestaande werf om dit record te normaliseren.</div>` : ""}
  </div>
  <div class="adm-form-group"><label>Notitie</label>
    <textarea name="note" rows="4" placeholder="Werkafspraken, instructies of aandachtspunten">${esc(shift?.note||prefill.note||"")}</textarea>
  </div>
  </section>
  ${isEdit ? `<section class="adm-planning-detail-section">
    <div class="adm-planning-detail-heading"><span>02</span><div><h3>Gekoppelde informatie</h3><p>Alles wat nodig is voor een vlotte uitvoering.</p></div></div>
    <div class="adm-planning-links">
      <button type="button"><span>▣</span><b>Werkbon</b><small>${shift.workorderId ? "Gekoppeld aan deze planning" : "Nog geen werkbon gekoppeld"}</small></button>
      <button type="button"><span>⌁</span><b>Documenten</b><small>Voeg plannen, foto's of bijlagen toe</small></button>
      <button type="button"><span>◇</span><b>Materiaal</b><small>Registreer benodigd materiaal</small></button>
      <button type="button"><span>✎</span><b>Interne notities</b><small>Deel context met het team</small></button>
    </div>
  </section>` : ""}
  </div>
  <aside class="adm-planning-detail-aside">
    <section><span class="adm-eyebrow">Samenvatting</span>
      <dl>
        <div><dt>Datum</dt><dd>${esc(shift?.date || prefill.date || weekFrom || today)}</dd></div>
        <div><dt>Tijd</dt><dd>${esc(shift?.start || "07:00")} tot ${esc(shift?.end || "17:00")}</dd></div>
        <div><dt>Locatie</dt><dd>${esc(selectedVenue?.name || "Nog te bepalen")}</dd></div>
        <div><dt>Werkbon</dt><dd>${shift?.workorderId ? "Gekoppeld" : "Niet gekoppeld"}</dd></div>
      </dl>
    </section>
    <section class="adm-planning-attention"><span>i</span><div><b>Controle vóór opslaan</b><p>Monargo controleert beschikbaarheid, verlof en overlappende planning via de backend.</p></div></section>
    ${isEdit ? `<section><span class="adm-eyebrow">Activiteit</span><div class="adm-planning-activity"><i></i><div><b>Planning beschikbaar</b><p>Klik op opslaan om wijzigingen vast te leggen.</p></div></div></section>` : ""}
  </aside>
  </div>
  ${!isEdit ? `
  <div style="background:var(--gray-50);border-radius:8px;padding:12px;margin-bottom:4px;">
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;cursor:pointer;">
      <input type="checkbox" id="shiftRecurring" style="width:16px;height:16px;"> Wekelijks herhalen
    </label>
    <div id="shiftRecurWrap" style="display:none;margin-top:10px;">
      <div class="adm-form-row">
        <div class="adm-form-group"><label>Aantal weken</label>
          <select id="shiftRecurWeeks" style="width:100%;padding:7px">
            <option value="2">2 weken</option>
            <option value="4" selected>4 weken</option>
            <option value="8">8 weken</option>
            <option value="12">12 weken</option>
          </select>
        </div>
        <div class="adm-form-group" style="align-self:flex-end;padding-bottom:4px;font-size:12px;color:var(--gray-500);" id="shiftRecurInfo">
          Maakt 4 shifts aan
        </div>
      </div>
    </div>
  </div>` : ""}
  <div id="admShiftErr" style="display:none;color:var(--wf-red);font-size:12px;padding:4px 0;"></div>
  <div class="adm-form-actions" style="justify-content:space-between;">
    ${isEdit ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="admShiftDelete">Verwijderen</button>` : `<span></span>`}
    <div style="display:flex;gap:8px;">
      <button type="button" class="adm-btn adm-btn-secondary" id="admShiftCancel">Annuleren</button>
      <button type="submit" class="adm-btn adm-btn-primary">${isEdit ? "Opslaan" : "Aanmaken"}</button>
    </div>
  </div>
</form>`;
      openDrawer();
      document.getElementById("admShiftCancel").addEventListener("click", closeDrawer);

      // Recurring toggle
      document.getElementById("shiftRecurring")?.addEventListener("change", e => {
        const wrap = document.getElementById("shiftRecurWrap");
        if (wrap) wrap.style.display = e.target.checked ? "" : "none";
      });
      document.getElementById("shiftRecurWeeks")?.addEventListener("change", e => {
        const info = document.getElementById("shiftRecurInfo");
        if (info) info.textContent = `Maakt ${e.target.value} shifts aan`;
      });

      if (isEdit) {
        document.getElementById("admShiftDelete").addEventListener("click", async () => {
          if (!await uiConfirm(`Shift verwijderen voor ${uName(shift)} op ${shift.date}?`, { title: "Shift verwijderen", danger: true, confirmLabel: "Verwijderen" })) return;
          try {
            await api("DELETE", `/planning/${shift.id}`);
            closeDrawer(); renderPlanning();
          } catch(err) { window.showToast(err.message, "error"); }
        });
      }

      document.getElementById("admShiftForm").addEventListener("submit", async e => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target).entries());
        body.venueId = body.venueId || null;
        const errEl = document.getElementById("admShiftErr");
        const submitBtn = e.target.querySelector("[type=submit]");
        errEl.style.display = "none";
        submitBtn.disabled = true; submitBtn.textContent = "Bezig…";
        try {
          if (isEdit) {
            await api("PATCH", `/planning/${shift.id}`, body);
          } else {
            const isRecurring = document.getElementById("shiftRecurring")?.checked;
            const weeks = isRecurring ? Number(document.getElementById("shiftRecurWeeks")?.value || 4) : 1;
            const baseDate = new Date(body.date);
            for (let w = 0; w < weeks; w++) {
              const d = new Date(baseDate); d.setDate(baseDate.getDate() + w*7);
              await api("POST", "/planning", { ...body, date: d.toISOString().slice(0,10) });
            }
            if (weeks > 1) window.showToast && window.showToast(`${weeks} shifts aangemaakt`, "success");
          }
          closeDrawer(); renderPlanning();
        } catch (err) {
          errEl.textContent = err.message; errEl.style.display = "";
          submitBtn.disabled = false; submitBtn.textContent = isEdit ? "Opslaan" : "Aanmaken";
        }
      });
    }).catch(err => window.showToast(err.message, "error"));
  }

  A.views = A.views || {};
  A.views.planning = renderPlanning;
  A.drawers = A.drawers || {};
  // Verhuisde mee uit de drawer-registry van admin.js (was regel 9143-9146).
  A.drawers.shift = prefill => {
    const today = new Date().toISOString().slice(0,10);
    openShiftDrawer(today, today, null, [], prefill || {});
  };
}());
