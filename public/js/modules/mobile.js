(function () {
  let deps = {};

  function configure(nextDeps) {
    deps = nextDeps || {};
  }

  function saveQueue() {
    localStorage.setItem("workflowProQueue", JSON.stringify(deps.state.queue));
    deps.setText("queueCount", String(deps.state.queue.length));
  }

  function render(today) {
    if (!today) {
      deps.el("mobileShiftRows").innerHTML = `<div class="empty">Login om mobiele planning te laden.</div>`;
      deps.el("mobileWorkorderRows").innerHTML = `<div class="empty">Login om werkbonnen te laden.</div>`;
      deps.setText("queueCount", String(deps.state.queue.length));
      deps.setText("mobileLastSync", "Nog niet");
      deps.setText("mobileSyncDetail", "0 acties verwerkt");
      return;
    }

    const offlineHints = today.offlineHints || {};
    deps.setText("mobileTodayDate", today.date || "-");
    deps.setText("mobileTodayUser", today.user?.name || "Veldteam");
    deps.setText("mobileIntro", today.preview
      ? `Preview voor ${today.user?.name || "veldmedewerker"} op ${today.date}. Admin ziet wat de medewerker mobiel zal gebruiken.`
      : "Mobiele dagflow geladen met planning, werkbonnen, PWA-status en offline wachtrij.");
    deps.setText("queueCount", String(deps.state.queue.length));
    deps.setText("mobileLastSync", deps.shortDateTime(offlineHints.lastSyncedAt));
    deps.setText("mobileSyncDetail", `${offlineHints.processedCount || 0} acties verwerkt`);

    deps.renderList("mobileShiftRows", today.shifts || [], shift => `
      <div class="mobile-day-card">
        <span class="status-badge info">Planning</span>
        <strong>${deps.escapeHtml(shift.start || shift.startsAt || "?")} tot ${deps.escapeHtml(shift.end || shift.endsAt || "?")}</strong>
        <small>${deps.escapeHtml(shift.project || "Planning")} - ${deps.escapeHtml(deps.venueName(shift.venueId))}</small>
      </div>
    `, "Geen planning voor vandaag.");

    deps.renderList("mobileWorkorderRows", today.openWorkorders || [], workorder => `
      <div class="mobile-workorder">
        <div>
          <span class="status-badge ${deps.statusTone(workorder.status)}">${deps.escapeHtml(workorder.status || "Nieuw")}</span>
          <strong>${deps.escapeHtml(workorder.title)}</strong>
          <small>${deps.escapeHtml(deps.venueName(workorder.venueId))} - ${(workorder.files?.length || 0) ? `${workorder.files.length} foto's` : "foto nodig"} - ${workorder.signed ? "getekend" : "handtekening nodig"}</small>
        </div>
        <div class="mobile-actions">
          <button class="small-action" data-mobile-photo="${workorder.id}" type="button">Foto</button>
          <button class="small-action" data-mobile-sign="${workorder.id}" type="button">Handtekening</button>
          <button class="small-action" data-mobile-complete="${workorder.id}" type="button">Afronden</button>
        </div>
      </div>
    `, "Geen open werkbonnen.");

    document.querySelectorAll("[data-mobile-photo]").forEach(button => {
      button.addEventListener("click", () => workorderAction(button.dataset.mobilePhoto, "photo"));
    });
    document.querySelectorAll("[data-mobile-sign]").forEach(button => {
      button.addEventListener("click", () => workorderAction(button.dataset.mobileSign, "signature"));
    });
    document.querySelectorAll("[data-mobile-complete]").forEach(button => {
      button.addEventListener("click", () => workorderAction(button.dataset.mobileComplete, "complete"));
    });
  }

  async function refresh() {
    deps.setText("pwaStatus", "Controle");
    deps.setText("pwaDetail", "Manifest actief, service worker wordt nagekeken");
    if (!deps.token()) {
      render(null);
      return;
    }
    await deps.refreshOps();
    const result = await deps.api(`/api/tenants/${deps.tenantId}/mobile/today`);
    deps.state.mobile = result.today;
    render(result.today);
  }

  function payload(action) {
    if (action === "photo") return { name: `werf-foto-${Date.now()}.jpg`, type: "image/jpeg", size: 420000 };
    if (action === "signature") return { signerName: "Klant akkoord" };
    return { note: "Afgerond via mobiele flow" };
  }

  function queueId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `queue_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  async function workorderAction(workorderId, action) {
    const queued = { id: queueId(), workorderId, action, payload: payload(action), at: new Date().toISOString(), attempts: 0 };
    if (!navigator.onLine) {
      deps.state.queue.push(queued);
      saveQueue();
      deps.setText("mobileIntro", "Geen verbinding. Actie lokaal bewaard voor sync.");
      return;
    }
    try {
      await deps.api(`/api/tenants/${deps.tenantId}/mobile/workorders/${workorderId}/${action}`, {
        method: "POST",
        body: JSON.stringify(queued.payload)
      });
      deps.setText("mobileIntro", "Mobiele actie opgeslagen.");
      await refresh();
      await deps.refreshAll();
    } catch (error) {
      deps.state.queue.push(queued);
      saveQueue();
      deps.setText("mobileIntro", `Actie in offline wachtrij geplaatst: ${error.message}`);
    }
  }

  async function syncQueue() {
    if (!deps.token() || !navigator.onLine || !deps.state.queue.length) return;
    const pending = deps.state.queue.map(item => ({ ...item, id: item.id || queueId(), attempts: Number(item.attempts || 0) + 1 }));
    deps.state.queue = [];
    saveQueue();
    try {
      const result = await deps.api(`/api/tenants/${deps.tenantId}/mobile/sync`, {
        method: "POST",
        body: JSON.stringify({ items: pending })
      });
      const failedIds = new Set((result.sync?.results || []).filter(row => !row.ok).map(row => row.id));
      deps.state.queue = pending.filter(item => failedIds.has(item.id));
      saveQueue();
      const processed = result.sync?.processed || 0;
      const failed = result.sync?.failed || 0;
      deps.setText("mobileIntro", failed
        ? `${processed} mobiele acties gesynchroniseerd, ${failed} blijven in de wachtrij.`
        : `${processed} mobiele acties gesynchroniseerd.`);
    } catch (error) {
      deps.state.queue = pending;
      saveQueue();
      deps.setText("mobileIntro", `Sync tijdelijk niet gelukt: ${error.message}`);
      return;
    }
    if (!deps.state.queue.length) await refresh();
  }

  window.WorkFlowProMobile = {
    configure,
    saveQueue,
    render,
    refresh,
    workorderAction,
    syncQueue
  };
}());
