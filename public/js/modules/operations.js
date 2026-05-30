(function () {
  let deps = {};

  function configure(nextDeps) {
    deps = nextDeps || {};
  }

  function renderPlanningExperience() {
    if (!deps.token()) {
      deps.el("planningExperience").innerHTML = `
        <div class="experience-empty">
          <strong>Login om de nieuwe planning-look te testen.</strong>
          <small>Gebruik bovenaan "Login demo admin" en open daarna opnieuw Planning.</small>
        </div>
      `;
      return;
    }

    const users = deps.state.users.filter(user => user.role !== "tenant_admin");
    const shifts = deps.state.planning
      .slice()
      .sort((a, b) => `${a.date || ""} ${a.start || a.startsAt || ""}`.localeCompare(`${b.date || ""} ${b.start || b.startsAt || ""}`));
    const today = deps.todayValue();
    const shiftDates = Array.from(new Set(shifts.map(shift => shift.date).filter(Boolean))).sort();
    const nextDate = shiftDates.find(date => date >= today) || shiftDates[shiftDates.length - 1] || today;
    const dayShifts = shifts.filter(shift => shift.date === nextDate);
    const uniquePlannedUsers = new Set(dayShifts.map(shift => shift.userId));
    const unplannedUsers = users.filter(user => !uniquePlannedUsers.has(user.id));
    const openWorkorders = deps.state.workorders.filter(row => !["Voltooid", "Afgewerkt"].includes(row.status));
    const linkedWorkorders = deps.state.workorders.length;
    const conflicts = dayShifts.length - uniquePlannedUsers.size;
    const planningReady = dayShifts.length > 0 && openWorkorders.length > 0;

    deps.el("planningExperience").innerHTML = `
      <div class="experience-kpis">
        <article><span>Gepland</span><strong>${dayShifts.length}</strong><small>${deps.escapeHtml(nextDate)}</small></article>
        <article><span>Beschikbaar</span><strong>${unplannedUsers.length}</strong><small>nog vrij</small></article>
        <article><span>Conflicten</span><strong>${Math.max(0, conflicts)}</strong><small>zelfde medewerker</small></article>
        <article><span>Werkbonnen</span><strong>${linkedWorkorders}</strong><small>gekoppeld</small></article>
      </div>
      <div class="planning-focus">
        <section class="experience-panel planning-day-panel">
          <div class="experience-panel-head">
            <div>
              <h3>Planning voor ${deps.escapeHtml(nextDate)}</h3>
              <p>${dayShifts.length} opdrachten gepland, ${unplannedUsers.length} medewerkers nog vrij.</p>
            </div>
            <span class="status-badge ${planningReady ? "success" : "warning"}">${planningReady ? "Klaar voor uitvoering" : "Aanvullen"}</span>
          </div>
          <div class="planning-day-list">
            ${dayShifts.length ? dayShifts.map(shift => `
              <article class="planning-shift-row">
                <div class="planner-person compact">
                  <span>${deps.escapeHtml(deps.personName(shift.userId).slice(0, 2).toUpperCase() || "WF")}</span>
                  <div>
                    <strong>${deps.escapeHtml(deps.personName(shift.userId))}</strong>
                    <small>${deps.escapeHtml(deps.venueName(shift.venueId))}</small>
                  </div>
                </div>
                <div>
                  <strong>${deps.escapeHtml(shift.start || shift.startsAt || "08:00")} - ${deps.escapeHtml(shift.end || shift.endsAt || "16:30")}</strong>
                  <small>${deps.escapeHtml(shift.project || shift.client || "Klantopdracht")}</small>
                </div>
                <span class="status-badge info">${openWorkorders.length ? "Werkbon beschikbaar" : "Werkbon koppelen"}</span>
              </article>
            `).join("") : `<div class="experience-empty">Nog geen planning voor deze dag. Maak een eerste shift aan.</div>`}
          </div>
        </section>
        <aside class="experience-panel assistant-panel">
          <h3>Assistent</h3>
          <div class="assistant-item ${conflicts ? "warning" : "success"}"><strong>${conflicts ? "Conflict controleren" : "Geen conflict"}</strong><small>${conflicts ? "Een medewerker heeft meer dan een opdracht op dezelfde dag." : "De planning heeft geen dubbele bezetting."}</small></div>
          <div class="assistant-item ${openWorkorders.length ? "info" : "warning"}"><strong>Werkbonnen klaarzetten</strong><small>${openWorkorders.length ? `${openWorkorders.length} open werkbonnen zijn beschikbaar voor de mobiele flow.` : "Maak of koppel een werkbon voordat de ploeg vertrekt."}</small></div>
          <div class="assistant-item info"><strong>Mobiel voorbereiden</strong><small>Laat veldmedewerkers hun Vandaag-scherm openen voor vertrek.</small></div>
          <button type="button" data-jump-view="workorders">Werkbonnen openen</button>
        </aside>
      </div>
    `;
    document.querySelectorAll("[data-jump-view]").forEach(button => {
      button.addEventListener("click", () => deps.setView(button.dataset.jumpView));
    });
  }

  function renderWorkorderExperience() {
    if (!deps.token()) {
      deps.el("workorderExperience").innerHTML = `
        <div class="experience-empty">
          <strong>Login om de nieuwe werkbonnen-look te testen.</strong>
          <small>Gebruik bovenaan "Login demo admin" en open daarna opnieuw Werkbonnen.</small>
        </div>
      `;
      return;
    }

    const workorders = deps.state.workorders.length ? deps.state.workorders : [];
    const isDone = row => ["Voltooid", "Afgewerkt"].includes(row.status);
    const needsReview = row => ["Review", "Voltooid"].includes(row.status);
    const openWorkorders = workorders.filter(row => !isDone(row));
    const selected = openWorkorders[0] || workorders[0] || {};
    const openCount = workorders.filter(row => (row.status || "Nieuw") !== "Voltooid").length;
    const reviewCount = workorders.filter(needsReview).length;
    const missingEvidence = openWorkorders.filter(row => !(row.files || []).length || !row.signed).length;
    const readyForInvoice = workorders.filter(row => ["Klaar voor facturatie", "Afgerond", "Afgewerkt"].includes(row.status)).length;
    const selectedChecklist = selected.checklist || [];
    const selectedChecklistDone = selectedChecklist.filter(item => item.done).length;
    const selectedChecklistTotal = selectedChecklist.length || 1;
    const selectedMissing = [
      selectedChecklistDone < selectedChecklistTotal ? "Checklist nog niet volledig" : "",
      (selected.files || []).length ? "" : "Foto/bewijsstuk ontbreekt",
      selected.signed ? "" : "Handtekening ontbreekt"
    ].filter(Boolean);
    const primaryLabel = selectedMissing.length ? "Maak mobiel klaar" : "Zet klaar voor facturatie";

    deps.el("workorderExperience").innerHTML = `
      <div class="experience-kpis">
        <article><span>Open</span><strong>${openCount}</strong><small>werkbonnen</small></article>
        <article><span>Review</span><strong>${reviewCount}</strong><small>wacht op controle</small></article>
        <article><span>Bewijs nodig</span><strong>${missingEvidence}</strong><small>mobiel afronden</small></article>
        <article><span>Facturatie</span><strong>${readyForInvoice}</strong><small>klaar</small></article>
      </div>
      <div class="workorder-focus">
        <section class="experience-panel workorder-list-panel">
          <div class="experience-panel-head">
            <div>
              <h3>Werkbonnen die actie vragen</h3>
              <p>${openWorkorders.length} open, ${missingEvidence} missen nog bewijs of handtekening.</p>
            </div>
            <button class="secondary-action small-action" data-jump-view="mobile" type="button">Mobiel bekijken</button>
          </div>
          <div class="workorder-action-list">
            ${openWorkorders.length ? openWorkorders.map(row => {
              const checklist = row.checklist || [];
              const done = checklist.filter(item => item.done).length;
              const total = checklist.length || 1;
              const evidenceReady = (row.files || []).length && row.signed;
              return `
                <article class="workorder-action-row ${row.id === selected.id ? "active" : ""}" data-workorder-id="${row.id}" style="cursor:pointer">
                  <div>
                    <span class="status-badge ${deps.statusTone(row.status)}">${deps.escapeHtml(row.status || "Nieuw")}</span>
                    <strong>${deps.escapeHtml(row.title || "Werkbon")}</strong>
                    <small>${deps.escapeHtml(deps.venueName(row.venueId))} - ${deps.escapeHtml(deps.personName(row.userId))}</small>
                  </div>
                  <div class="workorder-progress">
                    <span>Checklist ${done}/${total}</span>
                    <span>${evidenceReady ? "Bewijs klaar" : "Bewijs nodig"}</span>
                  </div>
                </article>
              `;
            }).join("") : `<div class="empty">Geen open werkbonnen.</div>`}
          </div>
        </section>

        <aside class="experience-panel detail-panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Volgende werkbon</p>
              <h3>${deps.escapeHtml(selected.title || "Geen werkbon geselecteerd")}</h3>
            </div>
            <button type="button" data-jump-view="mobile">${primaryLabel}</button>
          </div>
          <div class="detail-stack">
            <div><span>Werf</span><strong>${deps.escapeHtml(deps.venueName(selected.venueId))}</strong></div>
            <div><span>Uitvoerder</span><strong>${deps.escapeHtml(deps.personName(selected.userId))}</strong></div>
            <div><span>Status</span><strong>${deps.escapeHtml(selected.status || "Nieuw")}</strong></div>
            <div><span>Checklist</span><strong>${selectedChecklistDone}/${selectedChecklistTotal}</strong></div>
          </div>
          <h3>Wat ontbreekt nog?</h3>
          <div class="workorder-missing-list">
            ${selectedMissing.length ? selectedMissing.map(item => `
              <div class="assistant-item warning"><strong>${deps.escapeHtml(item)}</strong><small>Laat de veldmedewerker dit afronden via de mobiele Vandaag-flow.</small></div>
            `).join("") : `<div class="assistant-item success"><strong>Klaar voor facturatie</strong><small>Alle minimale veldgegevens zijn aanwezig.</small></div>`}
          </div>
        </aside>
      </div>
    `;
    document.querySelectorAll("[data-jump-view]").forEach(button => {
      button.addEventListener("click", () => deps.setView(button.dataset.jumpView));
    });
    // Klik op werkbon-rij opent het detail panel
    document.querySelectorAll(".workorder-action-row[data-workorder-id]").forEach(row => {
      row.addEventListener("click", () => {
        if (window.openWorkorderDetail) window.openWorkorderDetail(row.dataset.workorderId);
      });
    });
  }

  window.WorkFlowProOperations = {
    configure,
    renderPlanningExperience,
    renderWorkorderExperience
  };
}());
