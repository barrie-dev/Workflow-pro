(function () {
  let deps = {};

  function configure(nextDeps) {
    deps = nextDeps || {};
  }

  function visibleView(view) {
    const redirects = {
      portal: "admin",
      sales: "notifications",
      mobile: "workorders",
      status: "admin",
      json: "admin",
      api: "integrations",
      demo: "start"
    };
    return redirects[view] || view || "notifications";
  }

  function runAction(action) {
    if (!deps.token()) {
      deps.el("login").click();
      return;
    }
    deps.setView(visibleView(action?.view));
  }

  function render(start) {
    if (!start) {
      deps.setText("startTenantName", "Werkruimte");
      deps.setText("startIntro", "Log in om planning, werkbonnen, tijd en onkosten in een rustig overzicht te zien.");
      deps.setText("startActivationScore", "0%");
      deps.setText("startNextTitle", "Welkom bij Monargo One");
      deps.setText("startNextDetail", "Start met inloggen en ga daarna rechtstreeks naar de belangrijkste klantactie.");
      deps.el("startNextAction").textContent = "Inloggen";
      deps.el("startCards").innerHTML = "";
      deps.el("startSections").innerHTML = `<article class="panel"><div class="empty">Nog geen werkruimte geladen.</div></article>`;
      return;
    }

    const activation = start.activation || {};
    const next = start.nextAction || {};
    const workspace = start.workspace || {};
    const assistant = workspace.assistant || {};
    const liveStatus = workspace.liveStatus || {};
    const priorityActions = workspace.priorityActions || [];
    deps.setText("startTenantName", "Werkruimte");
    deps.setText("startIntro", `${start.tenant?.name || "Klantomgeving"} - ${start.tenant?.plan || "business"} - ${workspace.date || "vandaag"}`);
    deps.setText("startActivationScore", `${activation.percent || 0}%`);
    deps.setText("startNextTitle", assistant.title || next.label || "Volgende beste actie");
    deps.setText("startNextDetail", assistant.detail || next.detail || "Werk de belangrijkste open stap af.");
    deps.el("startNextAction").textContent = assistant.primary?.label || next.label || "Open";

    const cards = workspace.metrics || [
      { label: "Stappen klaar", value: `${activation.doneSteps || 0}/${activation.totalSteps || 0}`, detail: "Activatie" },
      { label: "Pilot", value: activation.readyForPilot ? "Klaar" : "Open", detail: "Go/no-go" },
      { label: "Productie", value: activation.readyForProduction ? "Klaar" : "Open", detail: "Launch gate" },
      { label: "Fase", value: activation.currentPhase || "-", detail: "Roadmap" }
    ];
    deps.el("startCards").innerHTML = cards.map(card => `
      <article class="metric">
        <span class="metric-label">${deps.escapeHtml(card.label)}</span>
        <strong>${deps.escapeHtml(String(card.value))}</strong>
        <small>${deps.escapeHtml(card.detail || start.tenant?.name || "Tenant")}</small>
      </article>
    `).join("");

    const activationSteps = (start.sections || []).flatMap(section => section.steps || []);
    const openActivationSteps = activationSteps.filter(step => !step.done).slice(0, 4);
    const upcomingShifts = workspace.upcomingShifts || [];
    const liveBlockers = liveStatus.blockers || [];

    deps.el("startSections").innerHTML = `
      <article class="panel start-live-status ${liveStatus.ready ? "ready" : "blocked"}">
        <div>
          <p class="eyebrow">Klant live status</p>
          <h2>${deps.escapeHtml(liveStatus.label || "Nog niet klantklaar")}</h2>
          <p>${deps.escapeHtml(liveStatus.detail || "Maak de dagelijkse flow eerst werkbaar voor kantoor en werf.")}</p>
        </div>
        <div class="start-live-checks">
          ${liveBlockers.length ? liveBlockers.map(item => `<span>${deps.escapeHtml(item)}</span>`).join("") : `<span>Planning klaar</span><span>Werkbonnen klaar</span>`}
        </div>
      </article>

      <article class="panel start-section start-priorities">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Actiecentrum</p>
            <h2>Wat vraagt nu aandacht?</h2>
          </div>
        </div>
        <div class="steps">
          ${priorityActions.length ? priorityActions.map(item => `
            <div class="step start-action ${item.tone || "info"}">
              <span>${deps.escapeHtml(item.tone === "critical" ? "Nu" : item.tone === "warning" ? "Check" : "Open")}</span>
              <div>
                <strong>${deps.escapeHtml(item.label)}</strong>
                <small>${deps.escapeHtml(item.detail || "Open deze stap om verder te gaan.")}</small>
              </div>
              <button class="small-action" data-start-view="${item.view || "portal"}" type="button">Open</button>
            </div>
          `).join("") : `<div class="empty">Geen dringende acties. Alles is rustig.</div>`}
        </div>
      </article>

      <article class="panel start-section">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Planning</p>
            <h2>Komende werfplanning</h2>
          </div>
          <button class="secondary-action small-action" data-start-view="planning" type="button">Planning openen</button>
        </div>
        <div class="start-list">
          ${upcomingShifts.length ? upcomingShifts.map(shift => `
            <div class="start-list-item">
              <strong>${deps.escapeHtml(shift.project || "Planning")}</strong>
              <small>${deps.escapeHtml(shift.date || "-")} - ${deps.escapeHtml(shift.start || "?")} tot ${deps.escapeHtml(shift.end || "?")} - ${deps.escapeHtml(deps.venueName(shift.venueId))}</small>
            </div>
          `).join("") : `<div class="empty">Nog geen komende planning. Maak de eerste shift aan.</div>`}
        </div>
      </article>

      <article class="panel start-section">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Livegang</p>
            <h2>Laatste open activatiestappen</h2>
          </div>
        </div>
        <div class="steps">
          ${openActivationSteps.length ? openActivationSteps.map(step => `
            <div class="step">
              <span>Open</span>
              <div>
                <strong>${deps.escapeHtml(step.label)}</strong>
                <small>${deps.escapeHtml(step.actions?.[0]?.detail || "Nog af te werken.")}</small>
              </div>
              <button class="small-action" data-start-view="${step.actions?.[0]?.view || "portal"}" type="button">${deps.escapeHtml(step.actions?.[0]?.label || "Open")}</button>
            </div>
          `).join("") : `<div class="empty">Alle activatiestappen zijn afgerond.</div>`}
        </div>
      </article>
    `;

    document.querySelectorAll("[data-start-view]").forEach(button => {
      button.addEventListener("click", () => deps.setView(visibleView(button.dataset.startView)));
    });
  }

  async function refresh() {
    if (!deps.token()) {
      render(null);
      return;
    }
    try {
      const result = await deps.api(`/api/tenants/${deps.tenantId}/customer-start`);
      deps.state.customerStart = result.start;
      render(result.start);
    } catch (error) {
      deps.setText("startIntro", error.message);
    }
  }

  window.WorkFlowProCustomerStart = {
    configure,
    visibleView,
    runAction,
    render,
    refresh
  };
}());
