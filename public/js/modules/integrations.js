(function () {
  let deps = {};

  function configure(nextDeps) {
    deps = nextDeps || {};
  }

  function mappingTextToRows(text) {
    return String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      const [local, remote] = line.split("=>").map(part => part.trim());
      return { local, remote, direction: "both" };
    });
  }

  function mappingRowsToText(rows) {
    return (rows || []).map(row => `${row.local} => ${row.remote}`).join("\n");
  }

  function render() {
    const options = deps.state.integrations.length
      ? deps.state.integrations.map(row => `<option value="${row.id}">${row.label || row.provider}</option>`).join("")
      : `<option value="">Maak eerst een koppeling</option>`;
    deps.el("mappingIntegration").innerHTML = options;
    const first = deps.state.integrations[0];
    if (first) deps.el("mappingForm").elements.mappingText.value = mappingRowsToText(first.config?.fieldMapping || []);
    const needsAttention = deps.state.integrations.filter(row => row.syncSummary?.needsAttention || row.mappingSummary?.needsAttention);
    const connected = deps.state.integrations.filter(row => row.status === "connected").length;
    const missingSecrets = deps.state.integrations.filter(row => !row.hasSecret).length;
    const logs = deps.state.integrations.flatMap(row => (row.syncLogs || []).map(log => ({ ...log, provider: row.provider, integrationId: row.id })));
    const failedLogs = logs.filter(log => log.status === "failed" && !log.resolved);
    const next = missingSecrets
      ? { title: `${missingSecrets} koppeling zonder secret`, detail: "Bewaar credentials in de versleutelde vault voordat sync actief wordt.", tone: "warning" }
      : needsAttention.length
        ? { title: `${needsAttention.length} koppeling vraagt aandacht`, detail: "Controleer mapping en syncfouten voordat pilotdata naar ERP gaat.", tone: "critical" }
        : deps.state.integrations.length
          ? { title: "Koppelingen gezond", detail: "Sync en mapping zijn klaar voor pilotgebruik.", tone: "success" }
          : { title: "Nog geen koppeling", detail: "Voeg Robaws, Exact of een generieke REST-koppeling toe.", tone: "info" };

    deps.el("integrationFocus").innerHTML = `
      <section class="integration-focus-grid">
        <article class="integration-focus-card primary">
          <p class="eyebrow">Connector health</p>
          <h2>${deps.escapeHtml(next.title)}</h2>
          <p>${deps.escapeHtml(next.detail)}</p>
          <span class="status-badge ${next.tone}">${needsAttention.length || missingSecrets ? "Actie nodig" : "Gezond"}</span>
        </article>
        <article class="integration-focus-card">
          <span>Verbonden</span>
          <strong>${connected}/${deps.state.integrations.length}</strong>
          <small>actieve koppelingen</small>
        </article>
        <article class="integration-focus-card">
          <span>Sync fouten</span>
          <strong>${failedLogs.length}</strong>
          <small>${logs.length} logs totaal</small>
        </article>
        <article class="integration-focus-card">
          <span>Mapping issues</span>
          <strong>${deps.state.integrations.filter(row => row.mappingSummary?.needsAttention).length}</strong>
          <small>velden nakijken</small>
        </article>
      </section>
    `;

    deps.renderList("integrationCards", deps.state.integrations, row => `
      <div class="data-row ${row.syncSummary?.needsAttention || row.mappingSummary?.needsAttention ? "kpi-open" : ""}">
        <strong>${row.label || row.provider}</strong>
        <small>${row.status} - ${row.syncSummary?.lastSyncAt || "nog niet gesynchroniseerd"} - secret: ${row.hasSecret ? "aanwezig" : "ontbreekt"}</small>
        <small>Syncs: ${row.syncSummary?.success || 0} OK, ${row.syncSummary?.failed || 0} fouten, ${row.syncSummary?.retryableFailures || 0} retrybaar, ${row.syncSummary?.retries || 0} retries</small>
        <small>Mappings: ${row.mappingSummary?.valid || 0} geldig, ${row.mappingSummary?.invalid || 0} ongeldig</small>
      </div>
    `, "Nog geen koppelingen.");

    deps.renderList("integrationRows", deps.state.integrations, row => `
      <div class="data-row">
        <strong>${row.label || row.provider}</strong>
        <small>${row.provider} - ${row.config?.environment || "test"} - ${row.config?.fieldMapping?.length || 0} mappings</small>
        <small>Mappingstatus: ${row.mappingSummary?.needsAttention ? "nakijken" : "klaar"}</small>
        <small>Laatste sync: ${row.syncSummary?.lastStatus || "never"}${row.syncSummary?.lastErrorCode ? ` (${row.syncSummary.lastErrorCode})` : ""}${row.syncSummary?.lastMessage ? ` - ${row.syncSummary.lastMessage}` : ""}</small>
        <small>Open foutcodes: ${(row.syncSummary?.openErrorCodes || []).join(", ") || "geen"}</small>
        <div class="row-actions">
          <button class="small-action" data-sync-integration="${row.id}" type="button">Sync nu</button>
        </div>
      </div>
    `, "Nog geen koppelingen.");

    deps.renderList("syncLogRows", logs, log => `
      <div class="data-row ${log.retryable ? "kpi-open" : ""}">
        <strong>${log.provider} - ${log.status}${log.resolved ? " - opgelost" : ""}</strong>
        <small>${log.at}${log.errorCode ? ` - ${log.errorCode}` : ""} - push werkbonnen ${log.pushed?.workorders || 0}, facturen ${log.pushed?.invoices || 0}</small>
        <div class="row-actions">
          ${log.retryable ? `<button class="small-action" data-retry-sync="${log.integrationId}" data-sync-id="${log.id}" type="button">Retry</button>` : ""}
        </div>
      </div>
    `, "Nog geen sync logs.");

    document.querySelectorAll("[data-sync-integration]").forEach(button => {
      button.addEventListener("click", () => runSync(button.dataset.syncIntegration));
    });
    document.querySelectorAll("[data-retry-sync]").forEach(button => {
      button.addEventListener("click", () => retrySync(button.dataset.retrySync, button.dataset.syncId));
    });
  }

  async function refresh() {
    if (!deps.token()) {
      deps.setIntegrationNotice("Login met de demo admin om integraties te beheren.", false);
      return;
    }
    const result = await deps.api(`/api/tenants/${deps.tenantId}/integrations`);
    deps.state.integrations = result.rows || [];
    render();
    deps.setIntegrationNotice("Integraties zijn bijgewerkt.");
  }

  async function connect(form) {
    if (!deps.token()) return deps.setIntegrationNotice("Login eerst met de demo admin.", false);
    try {
      await deps.api(`/api/tenants/${deps.tenantId}/integrations/connect`, { method: "POST", body: JSON.stringify(deps.formData(form)) });
      deps.setIntegrationNotice("Koppeling opgeslagen.");
      await refresh();
    } catch (error) {
      deps.setIntegrationNotice(error.message, false);
    }
  }

  async function saveMapping(form) {
    if (!deps.token()) return deps.setIntegrationNotice("Login eerst met de demo admin.", false);
    const data = deps.formData(form);
    if (!data.integrationId) return deps.setIntegrationNotice("Kies eerst een integratie.", false);
    try {
      await deps.api(`/api/tenants/${deps.tenantId}/integrations/${data.integrationId}/mapping`, {
        method: "POST",
        body: JSON.stringify({ fieldMapping: mappingTextToRows(data.mappingText) })
      });
      deps.setIntegrationNotice("Mapping opgeslagen.");
      await refresh();
    } catch (error) {
      deps.setIntegrationNotice(error.message, false);
    }
  }

  async function runSync(integrationId) {
    try {
      await deps.api(`/api/tenants/${deps.tenantId}/integrations/${integrationId}/sync`, { method: "POST", body: "{}" });
      deps.setIntegrationNotice("Sync uitgevoerd.");
      await refresh();
    } catch (error) {
      deps.setIntegrationNotice(error.message, false);
    }
  }

  async function retrySync(integrationId, syncId) {
    try {
      const result = await deps.api(`/api/tenants/${deps.tenantId}/integrations/${integrationId}/retry`, {
        method: "POST",
        body: JSON.stringify({ syncId })
      });
      deps.setIntegrationNotice(result.result?.duplicate ? "Retry was al verwerkt." : "Retry uitgevoerd.");
      await refresh();
    } catch (error) {
      deps.setIntegrationNotice(error.message, false);
    }
  }

  window.WorkFlowProIntegrations = {
    configure,
    render,
    refresh,
    connect,
    saveMapping,
    runSync,
    retrySync
  };
}());
