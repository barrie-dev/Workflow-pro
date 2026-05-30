/**
 * wagenpark-module.js
 * Wagenparkbeheer UI · voertuigen · km-log · service & keuring alerts
 * Rendert in: #wagenparkPage
 * Vereisten: window.token, window.tenantId, window.state
 */
(function () {
  "use strict";

  function esc(v) {
    return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function personName(userId) {
    const u = (window.state?.users || []).find(u => u.id === userId);
    return u ? (u.name || u.email) : (userId ? userId : "Niet toegewezen");
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
<style id="wagenpark-styles">
.wp-wrap { font-family:Inter,"Segoe UI",Arial,sans-serif; color:#0f2744; padding:20px; }
.wp-kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:18px; }
.wp-kpi { background:#fff; border:1px solid #d9e3ef; border-radius:8px; padding:12px 14px; }
.wp-kpi span { font-size:11px; color:#5f728c; text-transform:uppercase; letter-spacing:.04em; display:block; }
.wp-kpi strong { font-size:22px; font-weight:800; display:block; line-height:1.2; }
.wp-kpi small { font-size:11px; color:#5f728c; }
.wp-kpi.alert strong { color:#e53535; }
.wp-kpi.warn strong { color:#f28b18; }

.wp-toolbar { display:flex; gap:10px; margin-bottom:14px; align-items:center; flex-wrap:wrap; }
.wp-toolbar h3 { margin:0; font-size:16px; flex:1; }
.wp-filter { border:1px solid #d9e3ef; border-radius:6px; padding:6px 10px; font-size:13px; background:#fff; }
.wp-search { border:1px solid #d9e3ef; border-radius:6px; padding:6px 10px; font-size:14px; width:200px; }

.wp-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:14px; }
.wp-card { background:#fff; border:1px solid #d9e3ef; border-radius:10px; overflow:hidden; cursor:pointer; transition:box-shadow .15s; }
.wp-card:hover { box-shadow:0 4px 16px rgba(15,39,68,.1); }
.wp-card-head { padding:14px 16px 10px; border-bottom:1px solid #f0f4f9; display:flex; align-items:center; gap:10px; }
.wp-card-icon { width:40px; height:40px; border-radius:8px; background:#eff4ff; display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0; }
.wp-card-title { font-size:15px; font-weight:700; line-height:1.2; }
.wp-card-plate { font-size:12px; font-weight:700; background:#f5f8fc; border:1px solid #d9e3ef; border-radius:4px; padding:2px 6px; color:#0f2744; letter-spacing:.08em; }
.wp-card-body { padding:12px 16px; display:flex; flex-direction:column; gap:6px; }
.wp-card-row { display:flex; justify-content:space-between; font-size:12px; }
.wp-card-row span { color:#5f728c; }
.wp-card-row strong { font-weight:600; }
.wp-card-alerts { padding:8px 16px 12px; display:flex; gap:6px; flex-wrap:wrap; }

.wp-badge { display:inline-block; padding:2px 8px; border-radius:20px; font-size:11px; font-weight:700; }
.wp-badge.ok { background:#d1fae5; color:#065f46; }
.wp-badge.binnenkort { background:#fef3c7; color:#92400e; }
.wp-badge.dringend { background:#ffe4e6; color:#9f1239; }
.wp-badge.vervallen { background:#fee2e2; color:#991b1b; }
.wp-badge.onbekend { background:#f3f4f6; color:#6b7280; }
.wp-badge.actief { background:#d1fae5; color:#065f46; }
.wp-badge.in_onderhoud { background:#fef3c7; color:#92400e; }
.wp-badge.buiten_dienst { background:#fee2e2; color:#991b1b; }
.wp-badge.verkocht { background:#f3f4f6; color:#6b7280; }

.wp-btn { padding:6px 14px; border-radius:6px; border:none; cursor:pointer; font-size:13px; font-weight:600; }
.wp-btn.primary { background:#1a56db; color:#fff; }
.wp-btn.primary:hover { background:#1648c8; }
.wp-btn.secondary { background:#f5f8fc; color:#0f2744; border:1px solid #d9e3ef; }
.wp-btn.danger { background:#dc2626; color:#fff; }
.wp-btn.success { background:#059669; color:#fff; }

/* drawer */
.wp-drawer-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.35); z-index:1100; display:flex; justify-content:flex-end; }
.wp-drawer { width:520px; max-width:100vw; background:#fff; height:100%; overflow-y:auto; padding:24px; box-shadow:-4px 0 24px rgba(0,0,0,.12); }
.wp-drawer h2 { margin:0 0 6px; font-size:18px; }
.wp-drawer-tabs { display:flex; gap:2px; margin-bottom:20px; border-bottom:2px solid #e9eff6; }
.wp-drawer-tab { padding:8px 16px; background:none; border:none; cursor:pointer; font-size:13px; font-weight:600; color:#5f728c; border-bottom:2px solid transparent; margin-bottom:-2px; }
.wp-drawer-tab.active { color:#1a56db; border-bottom-color:#1a56db; }
.wp-drawer-section { margin-bottom:20px; }
.wp-drawer-section h4 { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:#5f728c; margin:0 0 10px; }
.wp-field { margin-bottom:12px; }
.wp-field label { display:block; font-size:12px; font-weight:600; color:#5f728c; margin-bottom:4px; }
.wp-field input, .wp-field select, .wp-field textarea {
  width:100%; padding:7px 10px; border:1px solid #d9e3ef; border-radius:6px; font-size:14px; box-sizing:border-box; }
.wp-field-row { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.wp-drawer-footer { display:flex; gap:10px; margin-top:16px; padding-top:16px; border-top:1px solid #e9eff6; }

.wp-km-log { font-size:13px; }
.wp-km-log-row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f0f4f9; }
.wp-km-log-row:last-child { border-bottom:none; }
.wp-km-log-row .km-date { color:#5f728c; font-size:11px; }

.wp-empty { padding:40px; text-align:center; color:#5f728c; }
</style>`;

  // ── state ────────────────────────────────────────────────────────────────────

  const st = {
    vehicles: [],
    summary: {},
    filterStatus: "",
    search: "",
    drawerVehicle: null,
    drawerTab: "info"
  };

  // ── laden ────────────────────────────────────────────────────────────────────

  async function loadWagenpark() {
    const container = document.getElementById("wagenparkPage");
    if (!container) return;

    if (!window.token) {
      container.innerHTML = `${STYLES}<div class="wp-wrap"><div class="wp-empty">Login om het wagenpark te beheren.</div></div>`;
      return;
    }

    try {
      const params = new URLSearchParams({ tenantId: window.tenantId });
      if (st.filterStatus) params.set("status", st.filterStatus);
      const data = await apiCall(`/api/tenants/${window.tenantId}/vehicles?${params}`);
      st.vehicles = data.vehicles || [];
      st.summary = data.summary || {};
      renderWagenparkPage();
    } catch (e) {
      const c = document.getElementById("wagenparkPage");
      if (c) c.innerHTML = `${STYLES}<div class="wp-wrap"><div class="wp-empty" style="color:#e53535">${esc(e.message)}</div></div>`;
    }
  }

  // ── render ───────────────────────────────────────────────────────────────────

  function renderWagenparkPage() {
    const container = document.getElementById("wagenparkPage");
    if (!container) return;

    const filtered = st.vehicles.filter(v => {
      if (st.search) {
        const q = st.search.toLowerCase();
        return (v.model || "").toLowerCase().includes(q) || (v.plate || "").toLowerCase().includes(q) || (v.brand || "").toLowerCase().includes(q);
      }
      return true;
    });

    container.innerHTML = `${STYLES}
<div class="wp-wrap">
  <div class="wp-kpis">
    <div class="wp-kpi">
      <span>Totaal</span>
      <strong>${st.summary.total || 0}</strong>
      <small>voertuigen</small>
    </div>
    <div class="wp-kpi">
      <span>Actief</span>
      <strong>${st.summary.actief || 0}</strong>
      <small>in dienst</small>
    </div>
    <div class="wp-kpi${(st.summary.serviceAlert || 0) > 0 ? " alert" : ""}">
      <span>Service alert</span>
      <strong>${st.summary.serviceAlert || 0}</strong>
      <small>dringend/vervallen</small>
    </div>
    <div class="wp-kpi${(st.summary.inspectionAlert || 0) > 0 ? " warn" : ""}">
      <span>Keuring alert</span>
      <strong>${st.summary.inspectionAlert || 0}</strong>
      <small>dringend/vervallen</small>
    </div>
  </div>

  <div class="wp-toolbar">
    <h3>Voertuigen</h3>
    <input class="wp-search" type="text" id="wp-search" placeholder="Zoek model, kenteken…" value="${esc(st.search)}">
    <select class="wp-filter" id="wp-filter-status">
      <option value="">Alle statussen</option>
      <option value="actief"${st.filterStatus === "actief" ? " selected" : ""}>Actief</option>
      <option value="in_onderhoud"${st.filterStatus === "in_onderhoud" ? " selected" : ""}>In onderhoud</option>
      <option value="buiten_dienst"${st.filterStatus === "buiten_dienst" ? " selected" : ""}>Buiten dienst</option>
    </select>
    <button class="wp-btn primary" id="wp-new">+ Voertuig toevoegen</button>
  </div>

  ${filtered.length ? `<div class="wp-grid">
    ${filtered.map(v => renderVehicleCard(v)).join("")}
  </div>` : `<div class="wp-empty">Geen voertuigen gevonden.</div>`}
</div>`;

    bindEvents(container);
  }

  function fuelIcon(fuel) {
    return { diesel: "⛽", benzine: "⛽", elektrisch: "⚡", hybride: "⚡", cng: "💨", lpg: "🔵" }[fuel] || "🚗";
  }

  function renderVehicleCard(v) {
    const icon = fuelIcon(v.fuel);
    const alerts = [
      { label: "Service", status: v.serviceStatus },
      { label: "Keuring", status: v.inspectionStatus },
      { label: "Verzekering", status: v.insuranceStatus }
    ].filter(a => a.status !== "ok" && a.status !== "onbekend");

    return `
<div class="wp-card" data-vehicle-id="${esc(v.id)}">
  <div class="wp-card-head">
    <div class="wp-card-icon">${icon}</div>
    <div style="flex:1">
      <div class="wp-card-title">${esc(v.brand ? `${v.brand} ${v.model}` : v.model)}</div>
      <div style="margin-top:3px"><span class="wp-card-plate">${esc(v.plate)}</span></div>
    </div>
    <span class="wp-badge ${esc(v.status || "actief")}">${esc(v.status || "actief")}</span>
  </div>
  <div class="wp-card-body">
    <div class="wp-card-row"><span>Bestuurder</span><strong>${esc(personName(v.driverId))}</strong></div>
    <div class="wp-card-row"><span>Kilometerstand</span><strong>${Number(v.mileage || 0).toLocaleString("nl-BE")} km</strong></div>
    <div class="wp-card-row"><span>Volgende service</span><strong>${esc(v.nextService || "Niet gepland")}</strong></div>
    <div class="wp-card-row"><span>Brandstof</span><strong>${esc(v.fuel || "-")}</strong></div>
  </div>
  ${alerts.length ? `<div class="wp-card-alerts">
    ${alerts.map(a => `<span class="wp-badge ${esc(a.status)}">${esc(a.label)}: ${esc(a.status)}</span>`).join("")}
  </div>` : ""}
</div>`;
  }

  // ── events ───────────────────────────────────────────────────────────────────

  function bindEvents(container) {
    container.querySelector("#wp-new")?.addEventListener("click", () => openDrawer(null));
    container.querySelector("#wp-search")?.addEventListener("input", e => { st.search = e.target.value; renderWagenparkPage(); });
    container.querySelector("#wp-filter-status")?.addEventListener("change", e => { st.filterStatus = e.target.value; loadWagenpark(); });
    container.querySelectorAll(".wp-card[data-vehicle-id]").forEach(card => {
      card.addEventListener("click", async () => {
        const id = card.dataset.vehicleId;
        try {
          const data = await apiCall(`/api/tenants/${window.tenantId}/vehicles/${id}`);
          openDrawer(data.vehicle);
        } catch (e) {
          if (window.showToast) window.showToast(e.message, false);
        }
      });
    });
  }

  // ── drawer ───────────────────────────────────────────────────────────────────

  function openDrawer(vehicle) {
    const existing = document.getElementById("wp-drawer-backdrop");
    if (existing) existing.remove();
    st.drawerVehicle = vehicle;
    st.drawerTab = "info";
    renderDrawer();
  }

  function renderDrawer() {
    const existing = document.getElementById("wp-drawer-backdrop");
    if (existing) existing.remove();

    const v = st.drawerVehicle;
    const users = window.state?.users || [];
    const driverOptions = users.filter(u => u.active !== false)
      .map(u => `<option value="${esc(u.id)}"${v && v.driverId === u.id ? " selected" : ""}>${esc(u.name || u.email)}</option>`)
      .join("");

    const backdrop = document.createElement("div");
    backdrop.id = "wp-drawer-backdrop";
    backdrop.className = "wp-drawer-backdrop";

    const tabs = [
      { key: "info", label: "Info" },
      { key: "km", label: "Kilometerstand" },
      { key: "service", label: "Service" }
    ];

    backdrop.innerHTML = `
<div class="wp-drawer" id="wp-drawer">
  <h2>${v ? `${v.brand ? `${esc(v.brand)} ` : ""}${esc(v.model)}` : "Nieuw voertuig"}</h2>
  ${v ? `<div style="margin-bottom:12px"><span class="wp-card-plate">${esc(v.plate)}</span> <span class="wp-badge ${esc(v.status || "actief")}">${esc(v.status || "actief")}</span></div>` : ""}
  <div class="wp-drawer-tabs">
    ${tabs.map(t => `<button class="wp-drawer-tab${st.drawerTab === t.key ? " active" : ""}" data-tab="${t.key}">${t.label}</button>`).join("")}
  </div>

  ${st.drawerTab === "info" ? renderDrawerInfo(v, driverOptions) : ""}
  ${st.drawerTab === "km" ? renderDrawerKm(v) : ""}
  ${st.drawerTab === "service" ? renderDrawerService(v) : ""}
</div>`;

    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", e => { if (e.target === backdrop) { backdrop.remove(); } });
    backdrop.querySelectorAll(".wp-drawer-tab").forEach(btn => {
      btn.addEventListener("click", () => { st.drawerTab = btn.dataset.tab; renderDrawer(); });
    });
    bindDrawerEvents(backdrop, v);
  }

  function renderDrawerInfo(v, driverOptions) {
    const today = new Date().toISOString().slice(0, 10);
    return `
<form id="wp-form-info">
  <div class="wp-drawer-section">
    <h4>Basisinfo</h4>
    <div class="wp-field-row">
      <div class="wp-field"><label>Merk</label><input name="brand" value="${esc(v?.brand || "")}" placeholder="Ford"></div>
      <div class="wp-field"><label>Model *</label><input name="model" value="${esc(v?.model || "")}" required placeholder="Transit Custom"></div>
    </div>
    <div class="wp-field-row">
      <div class="wp-field"><label>Nummerplaat *</label><input name="plate" value="${esc(v?.plate || "")}" required placeholder="1-ABC-123" ${v ? "readonly" : ""}></div>
      <div class="wp-field"><label>Jaar</label><input name="year" type="number" value="${esc(v?.year || "")}" placeholder="2022" min="1990" max="2030"></div>
    </div>
    <div class="wp-field-row">
      <div class="wp-field">
        <label>Brandstof</label>
        <select name="fuel">
          ${["diesel","benzine","elektrisch","hybride","cng","lpg"].map(f => `<option value="${f}"${(v?.fuel||"diesel")===f?" selected":""}>${f}</option>`).join("")}
        </select>
      </div>
      <div class="wp-field">
        <label>Status</label>
        <select name="status">
          ${["actief","in_onderhoud","buiten_dienst","verkocht"].map(s => `<option value="${s}"${(v?.status||"actief")===s?" selected":""}>${s}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="wp-field"><label>VIN / Chassisnummer</label><input name="vin" value="${esc(v?.vin || "")}" placeholder="WF0TXXTTGT1A00001"></div>
    <div class="wp-field"><label>Toegewezen bestuurder</label>
      <select name="driverId"><option value="">Niet toegewezen</option>${driverOptions}</select>
    </div>
    <div class="wp-field"><label>Notities</label><textarea name="notes">${esc(v?.notes || "")}</textarea></div>
  </div>
  <div class="wp-drawer-footer">
    <button class="wp-btn primary" type="submit">${v ? "Wijzigingen opslaan" : "Voertuig aanmaken"}</button>
    <button class="wp-btn secondary" type="button" id="wp-drawer-close">Sluiten</button>
  </div>
</form>`;
  }

  function renderDrawerKm(v) {
    if (!v) return `<div class="wp-empty">Sla het voertuig eerst op.</div>`;
    const logs = v.mileageLogs || [];
    return `
<div class="wp-drawer-section">
  <h4>Huidige stand: ${Number(v.mileage || 0).toLocaleString("nl-BE")} km</h4>
  <form id="wp-form-km">
    <div class="wp-field"><label>Nieuwe kilometerstand *</label>
      <input name="mileage" type="number" min="${v.mileage || 0}" step="1" placeholder="${(v.mileage || 0) + 100}" required>
    </div>
    <div class="wp-field"><label>Notitie (optioneel)</label><input name="note" placeholder="Na rit Antwerpen"></div>
    <div class="wp-drawer-footer">
      <button class="wp-btn primary" type="submit">Kilometerstand opslaan</button>
      <button class="wp-btn secondary" type="button" id="wp-drawer-close">Sluiten</button>
    </div>
  </form>
  <h4 style="margin-top:20px">Historiek</h4>
  <div class="wp-km-log">
    ${logs.length ? logs.map(l => `
    <div class="wp-km-log-row">
      <div>
        <strong>${Number(l.mileage).toLocaleString("nl-BE")} km</strong>
        ${l.note ? `<small style="color:#5f728c"> — ${esc(l.note)}</small>` : ""}
      </div>
      <div style="text-align:right">
        <div>+${Number(l.delta || 0).toLocaleString("nl-BE")} km</div>
        <div class="km-date">${esc(l.loggedAt?.slice(0,10))} · ${esc(l.actor)}</div>
      </div>
    </div>`).join("") : `<div class="wp-empty">Nog geen km-logs.</div>`}
  </div>`;
  }

  function renderDrawerService(v) {
    if (!v) return `<div class="wp-empty">Sla het voertuig eerst op.</div>`;
    const sb = s => `<span class="wp-badge ${esc(s)}">${esc(s)}</span>`;
    return `
<div class="wp-drawer-section">
  <h4>Service & administratie</h4>
  <div class="wp-field-row" style="margin-bottom:12px">
    <div><span style="font-size:12px;color:#5f728c">Service</span><br>${sb(v.serviceStatus)}</div>
    <div><span style="font-size:12px;color:#5f728c">Keuring</span><br>${sb(v.inspectionStatus)}</div>
    <div><span style="font-size:12px;color:#5f728c">Verzekering</span><br>${sb(v.insuranceStatus)}</div>
  </div>
  <form id="wp-form-service">
    <div class="wp-field-row">
      <div class="wp-field"><label>Volgende service</label><input name="nextService" type="date" value="${esc(v.nextService || "")}"></div>
      <div class="wp-field"><label>Keuringsdatum</label><input name="inspectionDate" type="date" value="${esc(v.inspectionDate || "")}"></div>
    </div>
    <div class="wp-field-row">
      <div class="wp-field"><label>Verzekering vervaldatum</label><input name="insuranceExpiry" type="date" value="${esc(v.insuranceExpiry || "")}"></div>
      <div class="wp-field"><label>Verzekeraar</label><input name="insuranceCompany" value="${esc(v.insuranceCompany || "")}" placeholder="Belfius, Axa…"></div>
    </div>
    <div class="wp-drawer-footer">
      <button class="wp-btn primary" type="submit">Datums opslaan</button>
      <button class="wp-btn secondary" type="button" id="wp-drawer-close">Sluiten</button>
    </div>
  </form>`;
  }

  function bindDrawerEvents(backdrop, v) {
    backdrop.querySelector("#wp-drawer-close")?.addEventListener("click", () => backdrop.remove());

    // Info form
    backdrop.querySelector("#wp-form-info")?.addEventListener("submit", async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target).entries());
      try {
        if (v) {
          await apiCall(`/api/tenants/${window.tenantId}/vehicles/${v.id}`, { method: "PATCH", body: JSON.stringify(data) });
          if (window.showToast) window.showToast("Voertuig bijgewerkt.");
        } else {
          await apiCall(`/api/tenants/${window.tenantId}/vehicles`, { method: "POST", body: JSON.stringify(data) });
          if (window.showToast) window.showToast("Voertuig aangemaakt.");
        }
        backdrop.remove();
        await loadWagenpark();
      } catch (err) { if (window.showToast) window.showToast(err.message, false); }
    });

    // Km form
    backdrop.querySelector("#wp-form-km")?.addEventListener("submit", async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target).entries());
      try {
        const res = await apiCall(`/api/tenants/${window.tenantId}/vehicles/${v.id}/mileage`, { method: "POST", body: JSON.stringify(data) });
        if (window.showToast) window.showToast("Kilometerstand opgeslagen.");
        st.drawerVehicle = res.vehicle;
        renderDrawer();
        loadWagenpark();
      } catch (err) { if (window.showToast) window.showToast(err.message, false); }
    });

    // Service form
    backdrop.querySelector("#wp-form-service")?.addEventListener("submit", async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(e.target).entries());
      try {
        const res = await apiCall(`/api/tenants/${window.tenantId}/vehicles/${v.id}/service`, { method: "POST", body: JSON.stringify(data) });
        if (window.showToast) window.showToast("Service-info opgeslagen.");
        st.drawerVehicle = res.vehicle;
        renderDrawer();
        loadWagenpark();
      } catch (err) { if (window.showToast) window.showToast(err.message, false); }
    });
  }

  window.wagenparkInit = loadWagenpark;
  window.wagenparkLoad = loadWagenpark;
  window.wagenparkRender = renderWagenparkPage;
}());
