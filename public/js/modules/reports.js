(function () {
  let deps = {};

  function configure(nextDeps) {
    deps = nextDeps || {};
  }

  function render() {
    const {
      state,
      el,
      escapeHtml,
      renderList,
      venueName,
      personName,
      serviceDueSoon
    } = deps;
    const totals = state.report?.totals || {};
    const finance = state.report?.finance || {};
    const expenseTotal = Number(totals.expenseTotal || 0);
    const approvedTotal = Number(finance.approvedExpenseTotal || 0);
    const clockedHours = Number(totals.clockedHours || 0);
    const openWorkorders = state.workorders.filter(row => !["Voltooid", "Afgewerkt"].includes(row.status));
    const lowStock = state.stock.filter(row => Number(row.quantity || 0) < Number(row.minLevel || 0));
    const serviceSoon = state.vehicles.filter(serviceDueSoon);
    const billableReady = Math.max(0, approvedTotal * 1.2 + clockedHours * 68);
    const utilization = state.users.length ? Math.min(100, Math.round((state.planning.length / Math.max(1, state.users.length * 5)) * 100)) : 0;
    const nextInsight = lowStock.length
      ? { title: "Stockrisico beinvloedt uitvoering", detail: `${lowStock.length} artikel(en) staan onder minimum. Dit kan werkbonnen vertragen.`, tone: "warning" }
      : openWorkorders.length
        ? { title: "Werkbonnen nog niet factureerbaar", detail: `${openWorkorders.length} open werkbonnen blijven opvolging vragen.`, tone: "info" }
        : { title: "Operationele flow gezond", detail: "Uren, onkosten en werkbonnen zijn klaar voor beslissersrapportage.", tone: "success" };

    el("reportDashboardCards").innerHTML = [
      ["Omzet klaar voor facturatie", `EUR ${billableReady.toFixed(0)}`, `${state.workorders.length} werkbonnen`],
      ["Uren gewerkt", `${clockedHours.toFixed(1)} u`, `${state.planning.length} planningitems`],
      ["Werkbonnen open", openWorkorders.length, "vragen opvolging"],
      ["Onkosten", `EUR ${expenseTotal.toFixed(2)}`, `EUR ${approvedTotal.toFixed(2)} goedgekeurd`],
      ["Teambezetting", `${utilization}%`, "capaciteit"]
    ].map(([label, value, detail]) => `
      <article class="metric report-kpi">
        <span class="metric-label">${label}</span>
        <strong>${value}</strong>
        <small>${detail}</small>
      </article>
    `).join("");

    el("reportDashboardFocus").innerHTML = `
      <section class="report-focus-layout">
        <article class="report-insight-card primary">
          <p class="eyebrow">Inzicht</p>
          <h2>${escapeHtml(nextInsight.title)}</h2>
          <p>${escapeHtml(nextInsight.detail)}</p>
          <span class="status-badge ${nextInsight.tone}">${nextInsight.tone === "success" ? "Gezond" : "Aandacht"}</span>
        </article>
        <article class="report-insight-card">
          <span>Factureerbaar</span>
          <strong>${expenseTotal ? Math.round((approvedTotal / expenseTotal) * 100) : 100}%</strong>
          <small>onkosten goedgekeurd</small>
        </article>
        <article class="report-insight-card">
          <span>Stock risico</span>
          <strong>${lowStock.length}</strong>
          <small>onder minimum</small>
        </article>
        <article class="report-insight-card">
          <span>Wagenpark</span>
          <strong>${serviceSoon.length}</strong>
          <small>service binnen 14 dagen</small>
        </article>
      </section>
    `;

    const venueHours = state.venues.map(venue => {
      const hours = state.planning
        .filter(row => row.venueId === venue.id)
        .reduce((sum, row) => {
          const start = Number(String(row.start || row.startsAt || "08:00").slice(0, 2));
          const end = Number(String(row.end || row.endsAt || "16:00").slice(0, 2));
          return sum + Math.max(0, end - start);
        }, 0);
      return { venue, hours };
    }).filter(row => row.hours > 0).sort((a, b) => b.hours - a.hours);
    const maxHours = Math.max(1, ...venueHours.map(row => row.hours));
    el("reportVenueBars").innerHTML = venueHours.length ? venueHours.slice(0, 6).map(row => `
      <div class="bar-row">
        <span>${escapeHtml(row.venue.name || row.venue.code || "Werf")}</span>
        <div><i style="width:${Math.round((row.hours / maxHours) * 100)}%"></i></div>
        <strong>${row.hours} u</strong>
      </div>
    `).join("") : `<div class="empty">Nog geen uren per werf.</div>`;

    const statusCounts = state.workorders.reduce((acc, row) => {
      const status = row.status || "Nieuw";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    const totalWorkorders = Math.max(1, state.workorders.length);
    el("reportWorkorderStatus").innerHTML = `
      <div class="donut-summary">
        <strong>${state.workorders.length}</strong>
        <small>werkbonnen totaal</small>
      </div>
      <div class="status-breakdown">
        ${Object.entries(statusCounts).map(([status, count]) => `
          <div>
            <span>${escapeHtml(status)}</span>
            <strong>${count} (${Math.round((count / totalWorkorders) * 100)}%)</strong>
          </div>
        `).join("") || `<div class="empty">Nog geen werkbonnen.</div>`}
      </div>
    `;

    renderList("reportStockRisk", lowStock, row => `
      <div class="data-row kpi-open">
        <strong>${escapeHtml(row.name || row.title || "Artikel")}</strong>
        <small>${escapeHtml(row.location || "Geen locatie")} - voorraad ${Number(row.quantity || 0)} / minimum ${Number(row.minLevel || 0)}</small>
      </div>
    `, "Geen stockrisico's.");

    renderList("reportProjectRows", state.workorders.slice(0, 8), row => `
      <div class="data-row">
        <strong>${escapeHtml(row.title || "Werkbon")}</strong>
        <small>${escapeHtml(venueName(row.venueId))} - ${escapeHtml(personName(row.userId))} - ${escapeHtml(row.status || "Nieuw")}</small>
      </div>
    `, "Nog geen projecten om te rapporteren.");
  }

  async function refresh() {
    const { token, refreshOps, listModuleRows, state, setReportNotice } = deps;
    if (!token()) {
      setReportNotice("Login met de demo admin om rapportage te laden.", false);
      return;
    }
    await refreshOps();
    const [stock, vehicles] = await Promise.all([
      listModuleRows("stock"),
      listModuleRows("vehicles")
    ]);
    state.stock = stock;
    state.vehicles = vehicles;
    render();
    setReportNotice("Rapportage is bijgewerkt.");
  }

  window.WorkFlowProReports = {
    configure,
    render,
    refresh
  };
}());
