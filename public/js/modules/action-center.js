(function () {
  let deps = {};

  function configure(nextDeps) {
    deps = nextDeps || {};
  }

  function render() {
    const { state, el, escapeHtml, renderList, setView } = deps;
    const summary = state.notificationSummary || {};
    const unread = state.notifications.filter(row => row.status !== "read");
    const critical = unread.filter(row => row.priority === "high" || ["support", "billing"].includes(row.type));
    const approvals = unread.filter(row => ["billing", "expense", "leave", "workorder"].includes(row.type));
    const automatic = state.notifications.filter(row => row.status === "read").length;
    const nextItems = (critical.length ? critical : unread).slice(0, 4);
    const cards = [
      ["Kritiek", critical.length, "Vereist onmiddellijke aandacht"],
      ["Wacht op goedkeuring", approvals.length, "Jouw actie vereist"],
      ["SLA risico", summary.highPriority || 0, "Risico op vertraging"],
      ["Automatisch opgelost", automatic, "Laatste 7 dagen"]
    ];

    el("notificationCards").innerHTML = cards.map(([label, value, detail]) => `
      <article class="metric action-kpi">
        <span class="metric-label">${label}</span>
        <strong>${value}</strong>
        <small>${value === 1 ? "actie" : "acties"} - ${detail}</small>
      </article>
    `).join("");

    const assistantItems = [
      [`${critical.length} kritieke acties`, "Vereist onmiddellijke aandacht"],
      [`${approvals.length} wachten op goedkeuring`, "Goedkeuringen eerst behandelen"],
      [`${summary.supportEscalations || 0} support escalaties`, "Controleer actieve toegang"],
      [`${summary.queued || 0} reminders vandaag`, "Planning en werkbonnen opvolgen"]
    ];

    el("notificationFocus").innerHTML = `
      <section class="action-center-layout">
        <div class="action-center-main">
          <article class="action-center-primary">
            <p class="eyebrow">Volgende beste actie</p>
            <h2>${nextItems[0] ? escapeHtml(nextItems[0].title) : "Geen dringende acties"}</h2>
            <p>${nextItems[0] ? escapeHtml(nextItems[0].body || "Bekijk deze actie en markeer ze als gelezen wanneer ze is opgevolgd.") : "Alles is rustig. Genereer reminders om planning, werkbonnen, billing en support opnieuw te controleren."}</p>
            <div class="action-center-primary-actions">
              <button id="actionCenterGenerate" type="button">${nextItems.length ? "Reminders vernieuwen" : "Reminders genereren"}</button>
              <span>${unread.length} open acties</span>
            </div>
          </article>
          <article class="action-center-list">
            <div class="panel-head">
              <div>
                <p class="eyebrow">Actiequeue</p>
                <h2>Vandaag opvolgen</h2>
              </div>
            </div>
            <div class="action-items">
              ${nextItems.length ? nextItems.map(row => `
                <div class="action-item ${row.priority === "high" ? "critical" : ""}">
                  <span>${escapeHtml(row.priority === "high" ? "Kritiek" : row.type || "Info")}</span>
                  <div>
                    <strong>${escapeHtml(row.title)}</strong>
                    <small>${escapeHtml(row.body || row.sourceRef || "Actie opvolgen.")}</small>
                  </div>
                  ${row.status === "read" ? "" : `<button class="small-action" data-read-notification="${row.id}" type="button">Klaar</button>`}
                </div>
              `).join("") : `<div class="empty">Geen open acties.</div>`}
            </div>
          </article>
        </div>
        <aside class="action-assistant">
          <div class="assistant-head">
            <p class="eyebrow">Assistent</p>
            <h2>Samenvatting prioriteiten</h2>
          </div>
          <div class="assistant-list">
            ${assistantItems.map(([label, detail], index) => `
              <div class="assistant-row ${index === 0 && critical.length ? "critical" : ""}">
                <span>${index + 1}</span>
                <div>
                  <strong>${escapeHtml(label)}</strong>
                  <small>${escapeHtml(detail)}</small>
                </div>
              </div>
            `).join("")}
          </div>
          <button class="secondary-action" data-jump-view="admin" type="button">Volledig overzicht bekijken</button>
        </aside>
      </section>
    `;

    renderList("notificationRows", state.notifications, row => `
      <div class="data-row">
        <strong>${escapeHtml(row.title)}</strong>
        <small>${escapeHtml(row.type)} - ${escapeHtml(row.channel)} - ${escapeHtml(row.audience)} - ${escapeHtml(row.status)} - ${escapeHtml(row.priority)}</small>
        <small>${escapeHtml(row.body || "")}${row.sourceRef ? ` - bron ${escapeHtml(row.sourceRef)}` : ""}</small>
        <div class="row-actions">
          ${row.status === "read" ? "" : `<button class="small-action" data-read-notification="${row.id}" type="button">Markeer gelezen</button>`}
        </div>
      </div>
    `, "Nog geen notificaties.");

    document.querySelectorAll("[data-read-notification]").forEach(button => {
      button.addEventListener("click", () => markRead(button.dataset.readNotification));
    });
    document.querySelectorAll("[data-jump-view]").forEach(button => {
      button.addEventListener("click", () => setView(button.dataset.jumpView));
    });
    const actionCenterGenerate = el("actionCenterGenerate");
    if (actionCenterGenerate) actionCenterGenerate.addEventListener("click", generate);
  }

  async function refresh() {
    const { token, api, tenantId, state, setNotificationNotice } = deps;
    if (!token()) {
      setNotificationNotice("Login met de demo admin om notificaties te beheren.", false);
      return;
    }
    const result = await api(`/api/tenants/${tenantId}/notifications`);
    state.notifications = result.rows || [];
    state.notificationSummary = result.summary || {};
    render();
    setNotificationNotice("Notificaties zijn bijgewerkt.");
  }

  async function createFromForm(form) {
    const { token, api, tenantId, formData, setNotificationNotice } = deps;
    if (!token()) return setNotificationNotice("Login eerst met de demo admin.", false);
    try {
      await api(`/api/tenants/${tenantId}/notifications`, {
        method: "POST",
        body: JSON.stringify(formData(form))
      });
      setNotificationNotice("Notificatie aangemaakt.");
      await refresh();
    } catch (error) {
      setNotificationNotice(error.message, false);
    }
  }

  async function generate() {
    const { token, api, tenantId, setNotificationNotice } = deps;
    if (!token()) return setNotificationNotice("Login eerst met de demo admin.", false);
    try {
      const result = await api(`/api/tenants/${tenantId}/notifications/reminders`, { method: "POST", body: "{}" });
      setNotificationNotice(`${result.rows.length} reminders aangemaakt.`);
      await refresh();
    } catch (error) {
      setNotificationNotice(error.message, false);
    }
  }

  async function markRead(notificationId) {
    const { api, tenantId, setNotificationNotice } = deps;
    try {
      await api(`/api/tenants/${tenantId}/notifications/${notificationId}/read`, { method: "POST", body: "{}" });
      setNotificationNotice("Notificatie gemarkeerd als gelezen.");
      await refresh();
    } catch (error) {
      setNotificationNotice(error.message, false);
    }
  }

  window.WorkFlowProActionCenter = {
    configure,
    render,
    refresh,
    createFromForm,
    generate,
    markRead
  };
}());
