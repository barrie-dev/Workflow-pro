(function () {
  let deps = {};

  function configure(nextDeps) {
    deps = nextDeps || {};
  }

  function serviceDueSoon(vehicle) {
    if (!vehicle.nextService) return false;
    const service = new Date(vehicle.nextService);
    if (Number.isNaN(service.getTime())) return false;
    const days = Math.ceil((service.getTime() - Date.now()) / 86400000);
    return days <= 14;
  }

  function render() {
    const { state, el, escapeHtml, personName, optionList, renderList } = deps;
    const lowStock = state.stock.filter(row => Number(row.quantity || 0) < Number(row.minLevel || 0));
    const reserved = state.stock.reduce((sum, row) => sum + Number(row.reserved || 0), 0);
    const serviceSoon = state.vehicles.filter(serviceDueSoon);
    const selectedStock = lowStock[0] || state.stock[0] || null;
    const selectedVehicle = serviceSoon[0] || state.vehicles[0] || null;
    const next = lowStock.length
      ? { title: `${lowStock.length} artikel(en) onder minimum`, detail: "Maak een bestelvoorstel of verhoog voorraad voordat werkbonnen materiaal missen.", tone: "warning" }
      : serviceSoon.length
        ? { title: `${serviceSoon.length} voertuig(en) met service`, detail: "Plan onderhoud voordat de planning capaciteit verliest.", tone: "info" }
        : { title: "Stock en wagenpark gezond", detail: "Geen lage voorraad of dringende onderhoudsactie gevonden.", tone: "success" };

    el("assetCards").innerHTML = [
      ["Stock laag", lowStock.length, "artikelen"],
      ["Gereserveerd", reserved, "items"],
      ["Artikelen", state.stock.length, "in voorraad"],
      ["Onderhoud gepland", serviceSoon.length, "voertuigen"]
    ].map(([label, value, detail]) => `
      <article class="metric asset-kpi">
        <span class="metric-label">${label}</span>
        <strong>${value}</strong>
        <small>${detail}</small>
      </article>
    `).join("");

    el("assetFocus").innerHTML = `
      <section class="asset-focus-layout">
        <article class="asset-action-panel">
          <p class="eyebrow">Aanbevolen actie</p>
          <h2>${escapeHtml(next.title)}</h2>
          <p>${escapeHtml(next.detail)}</p>
          <span class="status-badge ${next.tone}">${next.tone === "success" ? "Ok" : "Actie nodig"}</span>
        </article>
        <article class="asset-detail-panel">
          <div class="panel-head compact">
            <div>
              <p class="eyebrow">Voorraad detail</p>
              <h2>${selectedStock ? escapeHtml(selectedStock.name || selectedStock.title || "Artikel") : "Geen artikel"}</h2>
            </div>
          </div>
          ${selectedStock ? `
            <dl class="ops-detail-list">
              <div><dt>SKU</dt><dd>${escapeHtml(selectedStock.sku || "-")}</dd></div>
              <div><dt>Locatie</dt><dd>${escapeHtml(selectedStock.location || "-")}</dd></div>
              <div><dt>Voorraad</dt><dd>${Number(selectedStock.quantity || 0)}</dd></div>
              <div><dt>Minimum</dt><dd>${Number(selectedStock.minLevel || 0)}</dd></div>
            </dl>
          ` : `<div class="empty">Voeg een artikel toe om voorraadstatus te zien.</div>`}
        </article>
        <article class="asset-detail-panel">
          <div class="panel-head compact">
            <div>
              <p class="eyebrow">Wagenpark detail</p>
              <h2>${selectedVehicle ? escapeHtml(selectedVehicle.model || "Voertuig") : "Geen voertuig"}</h2>
            </div>
          </div>
          ${selectedVehicle ? `
            <dl class="ops-detail-list">
              <div><dt>Kenteken</dt><dd>${escapeHtml(selectedVehicle.plate || "-")}</dd></div>
              <div><dt>Bestuurder</dt><dd>${escapeHtml(personName(selectedVehicle.driverId))}</dd></div>
              <div><dt>Kilometerstand</dt><dd>${Number(selectedVehicle.mileage || 0).toLocaleString("nl-BE")} km</dd></div>
              <div><dt>Service</dt><dd>${escapeHtml(selectedVehicle.nextService || "-")}</dd></div>
            </dl>
          ` : `<div class="empty">Voeg een voertuig toe om onderhoud te plannen.</div>`}
        </article>
      </section>
    `;

    renderList("stockRows", state.stock, row => {
      const low = Number(row.quantity || 0) < Number(row.minLevel || 0);
      return `
        <div class="data-row ${low ? "kpi-open" : "kpi-ok"}">
          <strong>${escapeHtml(row.name || row.title || "Artikel")}</strong>
          <small>${escapeHtml(row.sku || "-")} - ${escapeHtml(row.location || "Geen locatie")} - voorraad ${Number(row.quantity || 0)} / minimum ${Number(row.minLevel || 0)}</small>
          <small>${low ? "Bestelvoorstel nodig" : "Voorraad ok"}${row.reserved ? ` - gereserveerd ${row.reserved}` : ""}</small>
        </div>
      `;
    }, "Nog geen stockartikelen.");

    renderList("vehicleRows", state.vehicles, row => `
      <div class="data-row ${serviceDueSoon(row) ? "kpi-open" : "kpi-ok"}">
        <strong>${escapeHtml(row.model || "Voertuig")} - ${escapeHtml(row.plate || "-")}</strong>
        <small>${Number(row.mileage || 0).toLocaleString("nl-BE")} km - bestuurder ${escapeHtml(personName(row.driverId))}</small>
        <small>Volgende service: ${escapeHtml(row.nextService || "nog te plannen")}${serviceDueSoon(row) ? " - onderhoud plannen" : ""}</small>
      </div>
    `, "Nog geen voertuigen.");

    el("vehicleDriver").innerHTML = optionList(state.users, "Geen bestuurder");
  }

  async function refresh() {
    const { token, state, listModuleRows, setAssetNotice } = deps;
    if (!token()) {
      setAssetNotice("Login met de demo admin om stock en wagenpark te beheren.", false);
      return;
    }
    const [stock, vehicles, users] = await Promise.all([
      listModuleRows("stock"),
      listModuleRows("vehicles"),
      state.users.length ? Promise.resolve(state.users) : listModuleRows("users")
    ]);
    state.stock = stock;
    state.vehicles = vehicles;
    state.users = users;
    render();
    setAssetNotice("Stock en wagenpark zijn bijgewerkt.");
  }

  async function submit(form, key, mapper) {
    const { token, createModuleRow, setAssetNotice, futureDateValue } = deps;
    if (!token()) return setAssetNotice("Login eerst met de demo admin.", false);
    try {
      await createModuleRow(key, mapper(Object.fromEntries(new FormData(form).entries())));
      form.reset();
      if (form.id === "vehicleForm") form.elements.nextService.value = futureDateValue(14);
      if (form.id === "stockForm") {
        form.elements.quantity.value = "8";
        form.elements.minLevel.value = "12";
      }
      await refresh();
      setAssetNotice("Opgeslagen.");
    } catch (error) {
      setAssetNotice(error.message, false);
    }
  }

  window.WorkFlowProAssets = {
    configure,
    serviceDueSoon,
    render,
    refresh,
    submit
  };
}());
