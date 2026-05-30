/**
 * stock-module.js
 * Stockbeheer UI · voorraad per werf · min/max alerts · mutatiehistoriek
 * Gebruik: public/stock-module.js — rendert in #stockPage
 *
 * Vereisten: window.token, window.tenantId, window.state
 */

(function () {
  "use strict";

  function esc(v) {
    return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function venueName(venueId) {
    return (window.state?.venues || []).find(v => v.id === venueId)?.name || venueId || "Geen werf";
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

  // ── alert helpers ─────────────────────────────────────────────────────────────

  function alertColor(level) {
    return { leeg: "#e53535", kritiek: "#f28b18", laag: "#f59e0b", ok: "#11975d", unknown: "#5f728c" }[level] || "#5f728c";
  }

  function alertLabel(level) {
    return { leeg: "Leeg", kritiek: "Kritiek", laag: "Laag", ok: "OK", unknown: "Onbekend" }[level] || level;
  }

  // ── styles ────────────────────────────────────────────────────────────────────

  const STYLES = `
<style id="stock-styles">
.stock-wrap { font-family:Inter,"Segoe UI",Arial,sans-serif; color:#0f2744; }
.stock-kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:18px; }
.stock-kpi { background:#fff; border:1px solid #d9e3ef; border-radius:8px; padding:12px 14px; }
.stock-kpi span { font-size:11px; color:#5f728c; text-transform:uppercase; letter-spacing:.04em; display:block; }
.stock-kpi strong { font-size:22px; font-weight:800; display:block; line-height:1.2; }
.stock-kpi small { font-size:11px; color:#5f728c; }
.stock-kpi.alert-leeg strong { color:#e53535; }
.stock-kpi.alert-kritiek strong { color:#f28b18; }

.stock-toolbar { display:flex; gap:10px; margin-bottom:14px; align-items:center; flex-wrap:wrap; }
.stock-toolbar h3 { margin:0; font-size:16px; flex:1; }
.stock-search { border:1px solid #d9e3ef; border-radius:6px; padding:6px 10px; font-size:14px; width:220px; }
.stock-filter { border:1px solid #d9e3ef; border-radius:6px; padding:6px 10px; font-size:13px; background:#fff; }
.stock-btn { padding:7px 14px; border-radius:6px; font-size:13px; cursor:pointer; border:1px solid #004a68; background:#004a68; color:#fff; }
.stock-btn.secondary { background:#fff; color:#0f2744; border-color:#d9e3ef; }
.stock-btn:hover { opacity:.88; }

.stock-table-wrap { background:#fff; border:1px solid #d9e3ef; border-radius:8px; overflow:auto; }
.stock-table { width:100%; border-collapse:collapse; font-size:14px; }
.stock-table th { text-align:left; padding:10px 14px; background:#f6f9fc; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.05em; color:#5f728c; border-bottom:1px solid #d9e3ef; white-space:nowrap; }
.stock-table td { padding:10px 14px; border-bottom:1px solid #f0f4f8; vertical-align:middle; }
.stock-table tr:last-child td { border-bottom:none; }
.stock-table tr:hover td { background:#fafbfd; }
.stock-table tr.stock-row { cursor:pointer; }

.stock-alert-dot { display:inline-flex; align-items:center; gap:5px; }
.stock-alert-dot::before { content:""; width:8px; height:8px; border-radius:50%; background:var(--dot-color,#5f728c); flex-shrink:0; }
.stock-qty-bar { display:flex; align-items:center; gap:8px; }
.stock-qty-track { flex:1; min-width:60px; height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden; }
.stock-qty-fill { height:100%; border-radius:3px; transition:width .3s; }
.stock-badge { display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:700; }

/* Mutatie panel */
.stock-drawer-backdrop { position:fixed; inset:0; background:rgba(15,39,68,.38); z-index:200; display:flex; align-items:flex-start; justify-content:flex-end; }
.stock-drawer { background:#fff; width:min(560px,100vw); height:100vh; overflow-y:auto; box-shadow:-6px 0 32px rgba(0,0,0,.15); font-family:Inter,"Segoe UI",Arial,sans-serif; }
.stock-drawer-head { position:sticky; top:0; background:#fff; border-bottom:1px solid #d9e3ef; padding:16px 20px; display:flex; align-items:center; gap:10px; z-index:10; }
.stock-drawer-head h3 { margin:0; font-size:17px; flex:1; }
.stock-drawer-close { background:none; border:none; font-size:21px; cursor:pointer; color:#5f728c; }
.stock-drawer-body { padding:20px; }
.stock-section-title { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:#5f728c; margin-bottom:10px; }
.stock-detail-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:20px; }
.stock-detail-item span { font-size:11px; color:#5f728c; display:block; }
.stock-detail-item strong { font-size:15px; }
.stock-mut-form { background:#f6f9fc; border:1px solid #d9e3ef; border-radius:8px; padding:16px; margin-bottom:20px; }
.stock-mut-form label { display:grid; gap:5px; font-size:13px; font-weight:700; margin-bottom:10px; }
.stock-mut-form input, .stock-mut-form select, .stock-mut-form textarea { border:1px solid #d9e3ef; border-radius:6px; padding:7px 10px; font-size:14px; width:100%; min-height:38px; }
.stock-mut-form .form-row { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.stock-mut-form .stock-btn { width:100%; padding:9px; font-size:14px; margin-top:4px; }
.stock-mut-list { display:grid; gap:8px; }
.stock-mut-row { background:#fff; border:1px solid #d9e3ef; border-radius:7px; padding:10px 14px; }
.stock-mut-row .mut-head { display:flex; align-items:center; gap:8px; margin-bottom:3px; }
.stock-mut-row .mut-type { font-size:11px; font-weight:700; padding:2px 8px; border-radius:10px; background:#e2e8f0; color:#5f728c; }
.stock-mut-row .mut-type.aanvulling { background:#dcfce7; color:#11975d; }
.stock-mut-row .mut-type.gebruik { background:#fff7ed; color:#f28b18; }
.stock-mut-row .mut-type.reservatie { background:#ede9fe; color:#7c3aed; }
.stock-mut-row .mut-type.correctie { background:#fef3c7; color:#b45309; }
.stock-mut-row .mut-type.transfer { background:#dbeafe; color:#1268d6; }
.stock-mut-row .mut-delta { font-weight:800; font-size:15px; }
.stock-mut-row small { font-size:12px; color:#5f728c; }
</style>`;

  // ── module state ──────────────────────────────────────────────────────────────

  const st = {
    items: [],
    summary: {},
    loading: false,
    search: "",
    filterAlert: "",
    filterVenue: ""
  };

  // ── fetch ─────────────────────────────────────────────────────────────────────

  async function loadStock() {
    if (!window.token) return;
    st.loading = true;
    renderStockPage();
    try {
      const params = new URLSearchParams({ tenantId: window.tenantId });
      if (st.filterAlert) params.set("alertOnly", "true");
      if (st.filterVenue) params.set("venueId", st.filterVenue);
      const data = await apiCall(`/api/tenants/${window.tenantId}/stock?${params}`);
      st.items = data.items || [];
      st.summary = data.summary || {};
    } catch (err) {
      console.warn("Stock laden mislukt:", err.message);
    }
    st.loading = false;
    renderStockPage();
  }

  // ── main render ───────────────────────────────────────────────────────────────

  function renderStockPage() {
    const container = document.getElementById("stockPage");
    if (!container) return;

    if (!window.token) {
      container.innerHTML = `${STYLES}<div class="stock-wrap"><div style="padding:40px;text-align:center;color:#5f728c">Login om stockbeheer te gebruiken.</div></div>`;
      return;
    }

    if (st.loading) {
      container.innerHTML = `${STYLES}<div class="stock-wrap"><div style="padding:40px;text-align:center;color:#5f728c">Stock laden...</div></div>`;
      return;
    }

    const venues = window.state?.venues || [];
    const s = st.summary;
    const filtered = st.items.filter(item => {
      if (st.search) {
        const q = st.search.toLowerCase();
        if (!item.name.toLowerCase().includes(q) && !(item.sku || "").toLowerCase().includes(q)) return false;
      }
      if (st.filterAlert && item.alert !== st.filterAlert) return false;
      if (st.filterVenue && item.venueId !== st.filterVenue) return false;
      return true;
    });

    const kpisHtml = `
      <div class="stock-kpis">
        <div class="stock-kpi"><span>Totaal artikelen</span><strong>${s.total ?? st.items.length}</strong></div>
        <div class="stock-kpi alert-leeg"><span>Leeg</span><strong>${s.leeg ?? 0}</strong><small>aanvullen vereist</small></div>
        <div class="stock-kpi alert-kritiek"><span>Kritiek</span><strong>${s.kritiek ?? 0}</strong><small>onder minimum</small></div>
        <div class="stock-kpi"><span>OK</span><strong>${s.ok ?? 0}</strong><small>op niveau</small></div>
      </div>`;

    const tableHtml = `
      <div class="stock-table-wrap">
        <table class="stock-table">
          <thead>
            <tr>
              <th>Artikel</th>
              <th>Werf / Locatie</th>
              <th>Voorraad</th>
              <th>Min / Max</th>
              <th>Status</th>
              <th>Categorie</th>
              <th>Acties</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length ? filtered.map(item => {
              const color = alertColor(item.alert);
              const pct = item.maxQty ? Math.min(100, (item.qty / item.maxQty) * 100) : item.qty > 0 ? 60 : 0;
              return `
                <tr class="stock-row" data-id="${esc(item.id)}">
                  <td>
                    <strong>${esc(item.name)}</strong>
                    ${item.sku ? `<small style="display:block;color:#5f728c">${esc(item.sku)}</small>` : ""}
                  </td>
                  <td>
                    <div>${esc(venueName(item.venueId))}</div>
                    ${item.location ? `<small style="color:#5f728c">${esc(item.location)}</small>` : ""}
                  </td>
                  <td>
                    <div class="stock-qty-bar">
                      <strong>${item.qty ?? "–"} ${esc(item.unit || "")}</strong>
                    </div>
                    <div class="stock-qty-track" style="width:80px">
                      <div class="stock-qty-fill" style="width:${pct}%;background:${color}"></div>
                    </div>
                    ${item.reserved ? `<small style="color:#7c3aed">${item.reserved} gereserveerd</small>` : ""}
                  </td>
                  <td>
                    ${item.minQty != null ? `<small>min: ${item.minQty}</small><br>` : ""}
                    ${item.maxQty != null ? `<small>max: ${item.maxQty}</small>` : "–"}
                  </td>
                  <td>
                    <span class="stock-alert-dot stock-badge" style="--dot-color:${color};color:${color};background:${color}18">
                      ${alertLabel(item.alert)}
                    </span>
                  </td>
                  <td><small>${esc(item.category || "–")}</small></td>
                  <td>
                    <button class="stock-btn secondary" style="padding:4px 10px;font-size:12px" data-action="open" data-id="${esc(item.id)}">Detail</button>
                  </td>
                </tr>`;
            }).join("") : `<tr><td colspan="7" style="text-align:center;padding:30px;color:#5f728c">Geen stockartikelen gevonden.</td></tr>`}
          </tbody>
        </table>
      </div>`;

    container.innerHTML = `
      ${STYLES}
      <div class="stock-wrap">
        ${kpisHtml}
        <div class="stock-toolbar">
          <h3>Stockbeheer</h3>
          <input class="stock-search" type="search" placeholder="Zoek artikel of SKU..." value="${esc(st.search)}" id="stock-search">
          <select class="stock-filter" id="stock-filter-alert">
            <option value="">Alle statussen</option>
            <option value="leeg" ${st.filterAlert === "leeg" ? "selected" : ""}>Leeg</option>
            <option value="kritiek" ${st.filterAlert === "kritiek" ? "selected" : ""}>Kritiek</option>
            <option value="laag" ${st.filterAlert === "laag" ? "selected" : ""}>Laag</option>
            <option value="ok" ${st.filterAlert === "ok" ? "selected" : ""}>OK</option>
          </select>
          <select class="stock-filter" id="stock-filter-venue">
            <option value="">Alle werven</option>
            ${venues.map(v => `<option value="${esc(v.id)}" ${st.filterVenue === v.id ? "selected" : ""}>${esc(v.name)}</option>`).join("")}
          </select>
          <button class="stock-btn secondary" id="stock-refresh">↻ Vernieuwen</button>
          <button class="stock-btn" id="stock-new">+ Nieuw artikel</button>
        </div>
        ${tableHtml}
      </div>`;

    bindStockEvents(container);
  }

  // ── events ────────────────────────────────────────────────────────────────────

  function bindStockEvents(container) {
    document.getElementById("stock-search")?.addEventListener("input", e => { st.search = e.target.value; renderStockPage(); });
    document.getElementById("stock-filter-alert")?.addEventListener("change", e => { st.filterAlert = e.target.value; renderStockPage(); });
    document.getElementById("stock-filter-venue")?.addEventListener("change", e => { st.filterVenue = e.target.value; renderStockPage(); });
    document.getElementById("stock-refresh")?.addEventListener("click", loadStock);
    document.getElementById("stock-new")?.addEventListener("click", () => openItemDrawer(null));

    container.querySelectorAll("[data-action='open']").forEach(btn => {
      btn.addEventListener("click", e => { e.stopPropagation(); openItemDrawer(btn.dataset.id); });
    });
    container.querySelectorAll(".stock-row").forEach(row => {
      row.addEventListener("click", () => openItemDrawer(row.dataset.id));
    });
  }

  // ── item drawer ───────────────────────────────────────────────────────────────

  function openItemDrawer(itemId) {
    closeDrawer();
    const item = itemId ? st.items.find(i => i.id === itemId) : null;
    const isNew = !itemId;
    const venues = window.state?.venues || [];

    const backdrop = document.createElement("div");
    backdrop.id = "stock-drawer-backdrop";
    backdrop.className = "stock-drawer-backdrop";

    const mutationsHtml = !isNew && item?.mutations?.length ? item.mutations.map(m => {
      const sign = m.delta > 0 ? "+" : "";
      return `
        <div class="stock-mut-row">
          <div class="mut-head">
            <span class="mut-type ${m.type}">${esc(m.type)}</span>
            <span class="mut-delta" style="color:${m.delta > 0 ? "#11975d" : "#e53535"}">${sign}${m.delta} ${esc(item?.unit || "")}</span>
            <small style="margin-left:auto">${esc(m.createdAt?.slice(0,10) || "–")}</small>
          </div>
          <small>${esc(m.reason || "")} · ${esc(m.actor || "")}</small>
        </div>`;
    }).join("") : "<p style='color:#5f728c;font-size:14px'>Geen mutaties.</p>";

    backdrop.innerHTML = `
      <div class="stock-drawer" role="dialog" aria-modal="true">
        <div class="stock-drawer-head">
          <h3>${isNew ? "Nieuw artikel" : esc(item?.name || "Artikel")}</h3>
          <button class="stock-drawer-close" id="stock-drawer-close">×</button>
        </div>
        <div class="stock-drawer-body">

          <!-- Artikel form -->
          <div class="stock-section-title">${isNew ? "Artikel aanmaken" : "Gegevens aanpassen"}</div>
          <div class="stock-mut-form">
            <label>Naam <input type="text" id="sd-name" value="${esc(item?.name || "")}" placeholder="bv. Cement 25kg" required></label>
            <div class="form-row">
              <label>SKU / Code <input type="text" id="sd-sku" value="${esc(item?.sku || "")}" placeholder="CEM-25"></label>
              <label>Eenheid <input type="text" id="sd-unit" value="${esc(item?.unit || "stuks")}" placeholder="stuks, liter, m²..."></label>
            </div>
            <div class="form-row">
              <label>Categorie <input type="text" id="sd-cat" value="${esc(item?.category || "algemeen")}" placeholder="algemeen"></label>
              <label>Werf
                <select id="sd-venue">
                  <option value="">— Geen werf —</option>
                  ${venues.map(v => `<option value="${esc(v.id)}" ${item?.venueId === v.id ? "selected" : ""}>${esc(v.name)}</option>`).join("")}
                </select>
              </label>
            </div>
            <div class="form-row">
              <label>Min. voorraad <input type="number" id="sd-min" value="${item?.minQty ?? ""}" placeholder="bv. 10" min="0"></label>
              <label>Max. voorraad <input type="number" id="sd-max" value="${item?.maxQty ?? ""}" placeholder="bv. 100" min="0"></label>
            </div>
            ${isNew ? `<label>Beginvoorraad <input type="number" id="sd-qty" value="0" min="0"></label>` : ""}
            <div class="form-row">
              <label>Locatie <input type="text" id="sd-loc" value="${esc(item?.location || "")}" placeholder="bv. Rek B2"></label>
              <label>Leverancier <input type="text" id="sd-sup" value="${esc(item?.supplier || "")}" placeholder="Leveranciernaam"></label>
            </div>
            <button class="stock-btn" id="sd-save">${isNew ? "Artikel aanmaken" : "Wijzigingen opslaan"}</button>
          </div>

          ${!isNew ? `
          <!-- Mutatie toevoegen -->
          <div class="stock-section-title">Mutatie registreren</div>
          <div class="stock-mut-form">
            <div class="form-row">
              <label>Type
                <select id="sd-mut-type">
                  <option value="aanvulling">Aanvulling (+)</option>
                  <option value="gebruik">Gebruik (−)</option>
                  <option value="correctie">Correctie</option>
                  <option value="reservatie">Reservatie</option>
                  <option value="transfer">Transfer naar andere werf</option>
                </select>
              </label>
              <label>Hoeveelheid
                <input type="number" id="sd-mut-delta" placeholder="bv. 5" step="0.01">
              </label>
            </div>
            <label>Reden <input type="text" id="sd-mut-reason" placeholder="Optionele omschrijving"></label>
            <button class="stock-btn" id="sd-mut-save">Mutatie registreren</button>
          </div>

          <!-- Historie -->
          <div class="stock-section-title">Mutatiehistoriek</div>
          <div class="stock-mut-list">${mutationsHtml}</div>
          ` : ""}
        </div>
      </div>`;

    document.body.appendChild(backdrop);
    bindDrawerEvents(backdrop, item, isNew);
  }

  function closeDrawer() {
    document.getElementById("stock-drawer-backdrop")?.remove();
  }

  function bindDrawerEvents(backdrop, item, isNew) {
    document.getElementById("stock-drawer-close")?.addEventListener("click", closeDrawer);
    backdrop.addEventListener("click", e => { if (e.target === backdrop) closeDrawer(); });

    // Opslaan
    document.getElementById("sd-save")?.addEventListener("click", async () => {
      const payload = {
        name: document.getElementById("sd-name")?.value.trim(),
        sku: document.getElementById("sd-sku")?.value.trim(),
        unit: document.getElementById("sd-unit")?.value.trim() || "stuks",
        category: document.getElementById("sd-cat")?.value.trim() || "algemeen",
        venueId: document.getElementById("sd-venue")?.value || null,
        minQty: document.getElementById("sd-min")?.value !== "" ? Number(document.getElementById("sd-min").value) : null,
        maxQty: document.getElementById("sd-max")?.value !== "" ? Number(document.getElementById("sd-max").value) : null,
        location: document.getElementById("sd-loc")?.value.trim() || null,
        supplier: document.getElementById("sd-sup")?.value.trim() || null
      };
      if (isNew) payload.qty = Number(document.getElementById("sd-qty")?.value || 0);

      try {
        if (isNew) {
          await apiCall(`/api/tenants/${window.tenantId}/stock`, {
            method: "POST", body: JSON.stringify(payload)
          });
        } else {
          await apiCall(`/api/tenants/${window.tenantId}/stock/${item.id}`, {
            method: "PATCH", body: JSON.stringify(payload)
          });
        }
        closeDrawer();
        await loadStock();
        if (window.showToast) window.showToast(isNew ? "Artikel aangemaakt." : "Artikel bijgewerkt.");
      } catch (err) { alert(err.message); }
    });

    // Mutatie
    document.getElementById("sd-mut-save")?.addEventListener("click", async () => {
      const type = document.getElementById("sd-mut-type")?.value;
      const delta = Number(document.getElementById("sd-mut-delta")?.value);
      const reason = document.getElementById("sd-mut-reason")?.value.trim();
      if (!delta || delta === 0) { alert("Hoeveelheid is verplicht."); return; }

      // Gebruik en reservatie: negatieve delta verwacht
      const signedDelta = ["gebruik", "reservatie"].includes(type) ? -Math.abs(delta) : Math.abs(delta);

      try {
        await apiCall(`/api/tenants/${window.tenantId}/stock/${item.id}/mutations`, {
          method: "POST", body: JSON.stringify({ type, delta: signedDelta, reason })
        });
        closeDrawer();
        await loadStock();
        if (window.showToast) window.showToast("Mutatie geregistreerd.");
      } catch (err) { alert(err.message); }
    });
  }

  // ── expose ────────────────────────────────────────────────────────────────────

  window.stockInit = loadStock;
  window.stockRender = renderStockPage;
  window.stockLoad = loadStock;
})();
