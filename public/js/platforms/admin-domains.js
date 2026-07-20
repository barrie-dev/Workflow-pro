/* ============================================================
   Monargo One – domeinwerkruimtes (API-CONTRACTS-V2)
   Catalogus, personeelsfiches, vorderingsstaten, portfolio,
   webhooks en universele lijsten.

   Volgt het patroon van admin-work-os.js: leest helpers uit
   window.wfpAdmin en registreert renderers in A.views.
   Elke werkruimte draagt de DoD-states (h54 punt 4):
   loading, empty, error (met retry), conflict (409 met herladen)
   en archived (zichtbaar, niet bewerkbaar).
   ============================================================ */
(function () {
  "use strict";

  const A = window.wfpAdmin;
  if (!A) return;

  const api = A.api;
  const esc = A.esc;
  function t(key, fallback) { return window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback; }
  function toast(msg, kind) { if (window.showToast) window.showToast(msg, kind || "success"); }
  function money(v) { return new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" }).format(Number(v) || 0); }
  function fmtDate(v) {
    if (!v) return "–";
    const d = new Date(String(v).length === 10 ? `${v}T12:00:00` : v);
    return Number.isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat("nl-BE", { day: "numeric", month: "short", year: "numeric" }).format(d);
  }
  function drawerBody() { return document.getElementById("admDrawerBody"); }

  // ── Gedeelde DoD-states ─────────────────────────────────────
  function loadingHtml(msg) {
    return `<div class="adm-loading"><div class="adm-spinner"></div>${esc(msg)}</div>`;
  }
  function errorHtml(err, retryId) {
    // Foutstate met retry (DoD punt 4) · toon de servercode als die er is.
    const code = err && err.code ? ` <code>${esc(err.code)}</code>` : "";
    return `<div class="adm-card"><div class="adm-card-body">
      <div class="adm-empty"><div class="adm-empty-icon">⚠️</div>
        <div class="adm-empty-title">${esc(t("dom.errTitle", "Kon de gegevens niet laden"))}</div>
        <div class="adm-empty-text">${esc((err && err.message) || "Onbekende fout")}${code}</div>
        <button class="adm-btn" id="${retryId}">${esc(t("dom.retry", "Opnieuw proberen"))}</button>
      </div></div></div>`;
  }
  function emptyHtml(title, text, actionId, actionLabel) {
    return `<div class="adm-empty"><div class="adm-empty-icon">✨</div>
      <div class="adm-empty-title">${esc(title)}</div>
      <div class="adm-empty-text">${esc(text)}</div>
      ${actionId ? `<button class="adm-btn adm-btn-primary" id="${actionId}">${esc(actionLabel)}</button>` : ""}</div>`;
  }
  /**
   * Conflictafhandeling (contract: 409 VERSION_CONFLICT draagt currentVersion).
   * Geen generieke fout, maar "intussen gewijzigd" met een herlaad-keuze.
   */
  async function saveGuard(fn, reloadFn) {
    try { return await fn(); }
    catch (err) {
      if (err && err.code === "VERSION_CONFLICT") {
        const herladen = window.confirm(t("dom.conflict",
          "Dit record is intussen door iemand anders gewijzigd. Herladen om de laatste versie te zien? (Je eigen wijzigingen gaan verloren.)"));
        if (herladen && reloadFn) await reloadFn();
        return null;
      }
      toast((err && err.message) || "Opslaan mislukt", "error");
      return null;
    }
  }

  /* ============================================================
     1. Catalogus & prijzen (E13 · view "catalog")
     ============================================================ */
  const ART_STATUS = {
    draft: ["Concept", ""], active: ["Actief", "success"],
    temporarily_unavailable: ["Tijdelijk niet beschikbaar", "warn"],
    phased_out: ["Uitgefaseerd", "warn"], archived: ["Gearchiveerd", "muted"],
  };
  const ART_TRANSITIONS = {
    draft: ["active", "archived"], active: ["temporarily_unavailable", "phased_out", "archived"],
    temporarily_unavailable: ["active", "phased_out", "archived"], phased_out: ["active", "archived"], archived: [],
  };
  let catState = { search: "", includeArchived: false };

  async function renderCatalog() {
    const content = A.content();
    content.innerHTML = loadingHtml(t("dom.cat.loading", "Catalogus laden…"));
    let data;
    try { data = await api("GET", `/articles${catState.includeArchived ? "?includeArchived=1" : ""}`); }
    catch (err) {
      content.innerHTML = errorHtml(err, "catRetry");
      document.getElementById("catRetry")?.addEventListener("click", renderCatalog);
      return;
    }
    const all = data.articles || [];
    const q = catState.search.toLowerCase();
    const rows = q ? all.filter(a => `${a.number} ${a.name} ${a.articleGroup || ""}`.toLowerCase().includes(q)) : all;

    content.innerHTML = `
      <div class="adm-card"><div class="adm-card-header">
        <div><h2 class="adm-card-title">${esc(t("nav.catalog", "Catalogus & prijzen"))}</h2>
          <p class="adm-form-hint">${esc(t("dom.cat.sub", "Artikelen met kost- en verkoopprijs · voedt offertes, werkbonnen en facturen."))}</p></div>
        <div class="adm-form-row">
          <input type="search" id="catSearch" class="adm-input" placeholder="${esc(t("dom.searchPh", "Zoeken…"))}" value="${esc(catState.search)}">
          <label class="adm-form-hint"><input type="checkbox" id="catArchived" ${catState.includeArchived ? "checked" : ""}> ${esc(t("dom.showArchived", "Toon gearchiveerd"))}</label>
          <button class="adm-btn adm-btn-primary" id="catNew">+ ${esc(t("dom.cat.new", "Nieuw artikel"))}</button>
        </div></div>
      <div class="adm-card-body">${rows.length ? `
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr>
          <th>${esc(t("dom.cat.number", "Nummer"))}</th><th>${esc(t("dom.cat.name", "Naam"))}</th>
          <th>${esc(t("dom.cat.type", "Type"))}</th><th>${esc(t("dom.cat.unit", "Eenheid"))}</th>
          <th>${esc(t("dom.cat.cost", "Kostprijs"))}</th><th>${esc(t("dom.cat.sales", "Verkoopprijs"))}</th>
          <th>${esc(t("dom.status", "Status"))}</th><th></th></tr></thead>
        <tbody>${rows.map(a => {
          const [label, tone] = ART_STATUS[a.status] || [a.status, ""];
          return `<tr data-art="${esc(a.id)}" class="${a.status === "archived" ? "adm-row-muted" : ""}">
            <td>${esc(a.number || "-")}</td><td>${esc(a.name)}</td><td>${esc(a.type)}</td><td>${esc(a.unit)}</td>
            <td>${a.costPrice != null ? money(a.costPrice) : "–"}</td><td>${money(a.salesPrice)}</td>
            <td><span class="adm-badge ${tone}">${esc(label)}</span></td>
            <td><button class="adm-btn adm-btn-sm" data-art-open="${esc(a.id)}">${esc(t("dom.open", "Openen"))}</button></td></tr>`;
        }).join("")}</tbody></table></div>`
        : emptyHtml(
          t("dom.cat.emptyTitle", "Nog geen artikelen"),
          t("dom.cat.emptyText", "Bouw je bibliotheek met materiaal, arbeid en diensten. Prijzen stromen automatisch door naar offertes en facturen."),
          "catEmptyNew", t("dom.cat.new", "Nieuw artikel"))}
      </div></div>`;

    document.getElementById("catSearch")?.addEventListener("input", e => { catState.search = e.target.value; renderCatalog(); });
    document.getElementById("catArchived")?.addEventListener("change", e => { catState.includeArchived = e.target.checked; renderCatalog(); });
    document.getElementById("catNew")?.addEventListener("click", () => openArticleEditor(null));
    document.getElementById("catEmptyNew")?.addEventListener("click", () => openArticleEditor(null));
    content.querySelectorAll("[data-art-open]").forEach(b => b.addEventListener("click", async () => {
      try { const d = await api("GET", `/articles/${b.dataset.artOpen}`); openArticleEditor(d.article, d.priceRules || [], d.costBuildup); }
      catch (err) { toast(err.message, "error"); }
    }));
  }

  function openArticleEditor(article, priceRules, costBuildup) {
    const isArchived = article && article.status === "archived";
    const a = article || { type: "material", unit: "st", vatRate: 21, salesStrategy: "manual", status: "draft" };
    drawerBody().innerHTML = `
      <h3>${article ? esc(`${a.number || ""} · ${a.name}`) : esc(t("dom.cat.new", "Nieuw artikel"))}</h3>
      ${isArchived ? `<p class="adm-badge muted">${esc(t("dom.archivedNotice", "Gearchiveerd · alleen-lezen, blijft zichtbaar in historiek"))}</p>` : ""}
      <div class="adm-form-section">
        <div class="adm-form-row">
          <div class="adm-form-group"><label>${esc(t("dom.cat.name", "Naam"))} *</label><input id="artName" class="adm-input" value="${esc(a.name || "")}" ${isArchived ? "disabled" : ""}></div>
          <div class="adm-form-group"><label>${esc(t("dom.cat.type", "Type"))}</label>
            <select id="artType" class="adm-input" ${isArchived ? "disabled" : ""}>
              ${["material", "labor", "equipment", "subcontracting", "composite", "free"].map(x => `<option value="${x}" ${a.type === x ? "selected" : ""}>${x}</option>`).join("")}
            </select></div>
        </div>
        <div class="adm-form-row">
          <div class="adm-form-group"><label>${esc(t("dom.cat.unit", "Eenheid"))}</label><input id="artUnit" class="adm-input" value="${esc(a.unit || "st")}" ${isArchived ? "disabled" : ""}></div>
          <div class="adm-form-group"><label>${esc(t("dom.cat.cost", "Kostprijs"))}</label><input id="artCost" type="number" step="0.01" class="adm-input" value="${a.costPrice ?? ""}" ${isArchived ? "disabled" : ""}></div>
          <div class="adm-form-group"><label>${esc(t("dom.cat.sales", "Verkoopprijs"))}</label><input id="artSales" type="number" step="0.01" class="adm-input" value="${a.salesPrice ?? ""}" ${isArchived ? "disabled" : ""}></div>
          <div class="adm-form-group"><label>${esc(t("dom.cat.vat", "Btw %"))}</label>
            <select id="artVat" class="adm-input" ${isArchived ? "disabled" : ""}>${[0, 6, 12, 21].map(x => `<option ${Number(a.vatRate) === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        </div>
        <p class="adm-form-hint">${esc(t("dom.cat.marginHint", "Kost en verkoop staan los van elkaar: marge op verkoop is niet hetzelfde als opslag op kost."))}</p>
      </div>
      ${article && priceRules ? `<div class="adm-form-section"><h4>${esc(t("dom.cat.rules", "Prijsregels"))}</h4>
        ${priceRules.length ? `<table class="adm-table"><tbody>${priceRules.map(r =>
          `<tr><td>${esc(r.scope)}</td><td>${esc(r.customerId || r.priceGroup || "algemeen")}</td><td>${money(r.price)}</td><td>${esc(t("dom.cat.from", "vanaf"))} ${fmtDate(r.validFrom)}</td></tr>`).join("")}</tbody></table>`
          : `<p class="adm-form-hint">${esc(t("dom.cat.noRules", "Geen prijsregels · de artikelstrategie geldt."))}</p>`}</div>` : ""}
      ${costBuildup ? `<div class="adm-form-section"><h4>${esc(t("dom.cat.buildup", "Kostopbouw"))}</h4>
        <p>${esc(t("dom.cat.unitCost", "Kost per stuk"))}: <strong>${money(costBuildup.unitCost)}</strong></p></div>` : ""}
      <div class="adm-form-actions">
        ${!isArchived ? `<button class="adm-btn adm-btn-primary" id="artSave">${esc(t("dom.save", "Opslaan"))}</button>` : ""}
        ${article && !isArchived ? (ART_TRANSITIONS[a.status] || []).map(s =>
          `<button class="adm-btn" data-art-status="${s}">${esc((ART_STATUS[s] || [s])[0])}</button>`).join("") : ""}
        <button class="adm-btn" id="artCancel">${esc(t("dom.close", "Sluiten"))}</button>
      </div>`;
    A.openDrawer();
    document.getElementById("artCancel")?.addEventListener("click", () => A.closeDrawer());
    document.getElementById("artSave")?.addEventListener("click", async () => {
      const payload = {
        name: document.getElementById("artName").value,
        type: document.getElementById("artType").value,
        unit: document.getElementById("artUnit").value,
        costPrice: Number(document.getElementById("artCost").value) || 0,
        salesPrice: Number(document.getElementById("artSales").value) || 0,
        vatRate: Number(document.getElementById("artVat").value),
        expectedVersion: article ? article.version : undefined,
      };
      const res = await saveGuard(
        () => api(article ? "PATCH" : "POST", article ? `/articles/${article.id}` : "/articles", payload),
        renderCatalog);
      if (res) { A.closeDrawer(); toast(t("dom.saved", "Opgeslagen")); renderCatalog(); }
    });
    drawerBody().querySelectorAll("[data-art-status]").forEach(b => b.addEventListener("click", async () => {
      const res = await saveGuard(
        () => api("POST", `/articles/${article.id}/transition`, { status: b.dataset.artStatus }), renderCatalog);
      if (res) { A.closeDrawer(); renderCatalog(); }
    }));
  }

  /* ============================================================
     2. Personeelsfiches (h16 · view "employee_records")
     ============================================================ */
  const EMP_STATUS = {
    candidate: ["Kandidaat", ""], active: ["Actief", "success"],
    temporarily_absent: ["Tijdelijk afwezig", "warn"], left: ["Uit dienst", "muted"], archived: ["Gearchiveerd", "muted"],
  };
  const EMP_TRANSITIONS = {
    candidate: ["active", "archived"], active: ["temporarily_absent", "left", "archived"],
    temporarily_absent: ["active", "left", "archived"], left: ["archived", "active"], archived: [],
  };

  async function renderEmployeeRecords() {
    const content = A.content();
    content.innerHTML = loadingHtml(t("dom.emp.loading", "Personeelsfiches laden…"));
    let data, certs;
    try {
      [data, certs] = await Promise.all([
        api("GET", "/employee_records"),
        api("GET", "/employee_records/expiring-certificates?horizonDays=60").catch(() => ({ employees: [] })),
      ]);
    } catch (err) {
      content.innerHTML = errorHtml(err, "empRetry");
      document.getElementById("empRetry")?.addEventListener("click", renderEmployeeRecords);
      return;
    }
    const rows = data.employees || [];
    const expiring = new Map((certs.employees || []).map(e => [e.employeeId, e.certificates.length]));

    content.innerHTML = `
      <div class="adm-card"><div class="adm-card-header">
        <div><h2 class="adm-card-title">${esc(t("nav.employeeRecords", "Personeelsfiches"))}</h2>
          <p class="adm-form-hint">${esc(t("dom.emp.sub", "Fiches met datumgebonden tarieven, vaardigheden en attesten · los van de loginaccounts."))}</p></div>
        <button class="adm-btn adm-btn-primary" id="empNew">+ ${esc(t("dom.emp.new", "Nieuwe fiche"))}</button></div>
      <div class="adm-card-body">${rows.length ? `
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr>
          <th>${esc(t("dom.emp.name", "Naam"))}</th><th>${esc(t("dom.emp.role", "Functie"))}</th>
          <th>${esc(t("dom.status", "Status"))}</th><th>${esc(t("dom.emp.skills", "Vaardigheden"))}</th>
          <th>${esc(t("dom.emp.certs", "Attesten"))}</th><th></th></tr></thead>
        <tbody>${rows.map(e => {
          const [label, tone] = EMP_STATUS[e.status] || [e.status, ""];
          const exp = expiring.get(e.id);
          return `<tr>
            <td>${esc(e.name)}</td><td>${esc(e.jobTitle || "-")}</td>
            <td><span class="adm-badge ${tone}">${esc(label)}</span></td>
            <td>${(e.skills || []).map(s => `<span class="adm-badge">${esc(s.label)}</span>`).join(" ") || "–"}</td>
            <td>${exp ? `<span class="adm-badge warn">⚠ ${exp} ${esc(t("dom.emp.expiring", "vervalt"))}</span>` : (e.certificates || []).length || "–"}</td>
            <td><button class="adm-btn adm-btn-sm" data-emp-open="${esc(e.id)}">${esc(t("dom.open", "Openen"))}</button></td></tr>`;
        }).join("")}</tbody></table></div>`
        : emptyHtml(
          t("dom.emp.emptyTitle", "Nog geen personeelsfiches"),
          t("dom.emp.emptyText", "Maak fiches aan zodat werkbonnen automatisch het juiste uurtarief op de uitvoeringsdatum gebruiken."),
          "empEmptyNew", t("dom.emp.new", "Nieuwe fiche"))}
      </div></div>`;

    document.getElementById("empNew")?.addEventListener("click", () => openEmployeeEditor(null));
    document.getElementById("empEmptyNew")?.addEventListener("click", () => openEmployeeEditor(null));
    content.querySelectorAll("[data-emp-open]").forEach(b => b.addEventListener("click", async () => {
      try { const d = await api("GET", `/employee_records/${b.dataset.empOpen}`); openEmployeeEditor(d.employee); }
      catch (err) { toast(err.message, "error"); }
    }));
  }

  function openEmployeeEditor(emp) {
    const isArchived = emp && emp.status === "archived";
    const e = emp || { status: "active" };
    // costRates ontbreekt in de response voor niet-beheerders (contract):
    // dan verbergen we de tarievensectie volledig, geen leeg blok.
    const canSeeRates = !emp || Array.isArray(emp.costRates);
    drawerBody().innerHTML = `
      <h3>${emp ? esc(e.name) : esc(t("dom.emp.new", "Nieuwe fiche"))}</h3>
      ${isArchived ? `<p class="adm-badge muted">${esc(t("dom.archivedNotice", "Gearchiveerd · alleen-lezen, blijft zichtbaar in historiek"))}</p>` : ""}
      <div class="adm-form-section">
        <div class="adm-form-row">
          <div class="adm-form-group"><label>${esc(t("dom.emp.name", "Naam"))} *</label><input id="empName" class="adm-input" value="${esc(e.name || "")}" ${isArchived ? "disabled" : ""}></div>
          <div class="adm-form-group"><label>${esc(t("dom.emp.role", "Functie"))}</label><input id="empRole" class="adm-input" value="${esc(e.jobTitle || "")}" ${isArchived ? "disabled" : ""}></div>
        </div>
        <div class="adm-form-row">
          <div class="adm-form-group"><label>${esc(t("dom.emp.from", "In dienst vanaf"))}</label><input id="empFrom" type="date" class="adm-input" value="${esc(e.activeFrom || "")}" ${isArchived ? "disabled" : ""}></div>
          <div class="adm-form-group"><label>${esc(t("dom.emp.skillsCsv", "Vaardigheden (komma-gescheiden)"))}</label>
            <input id="empSkills" class="adm-input" value="${esc((e.skills || []).map(s => s.label).join(", "))}" ${isArchived ? "disabled" : ""}></div>
        </div>
      </div>
      ${canSeeRates ? `<div class="adm-form-section"><h4>${esc(t("dom.emp.rates", "Kosttarieven (per geldigheidsdatum)"))}</h4>
        ${(e.costRates || []).length ? `<table class="adm-table"><tbody>${(e.costRates || []).map(r =>
          `<tr><td>${esc(t("dom.cat.from", "vanaf"))} ${fmtDate(r.validFrom)}</td><td>${esc(t("dom.emp.cost", "kost"))} ${money(r.costRate)}/u</td><td>${esc(t("dom.emp.sales", "verkoop"))} ${money(r.salesRate)}/u</td></tr>`).join("")}</tbody></table>`
          : `<p class="adm-form-hint">${esc(t("dom.emp.noRates", "Nog geen tarieven · werkbonnen kunnen dan geen kost berekenen."))}</p>`}
        ${emp && !isArchived ? `<div class="adm-form-row">
          <input id="rateFrom" type="date" class="adm-input" title="${esc(t("dom.cat.from", "vanaf"))}">
          <input id="rateCost" type="number" step="0.01" class="adm-input" placeholder="${esc(t("dom.emp.cost", "kost"))}/u">
          <input id="rateSales" type="number" step="0.01" class="adm-input" placeholder="${esc(t("dom.emp.sales", "verkoop"))}/u">
          <button class="adm-btn" id="rateAdd">+ ${esc(t("dom.emp.addRate", "Tariefversie"))}</button></div>
        <p class="adm-form-hint">${esc(t("dom.emp.rateHint", "Oude versies blijven staan: historische werkbonnen behouden hun kost."))}</p>` : ""}</div>` : ""}
      ${emp ? `<div class="adm-form-section"><h4>${esc(t("dom.emp.avail", "Beschikbaarheid"))}</h4>
        <div class="adm-form-row"><input id="availDate" type="date" class="adm-input">
          <button class="adm-btn" id="availCheck">${esc(t("dom.emp.check", "Controleren"))}</button></div>
        <p class="adm-form-hint" id="availResult"></p></div>` : ""}
      <div class="adm-form-actions">
        ${!isArchived ? `<button class="adm-btn adm-btn-primary" id="empSave">${esc(t("dom.save", "Opslaan"))}</button>` : ""}
        ${emp && !isArchived ? (EMP_TRANSITIONS[e.status] || []).map(s =>
          `<button class="adm-btn" data-emp-status="${s}">${esc((EMP_STATUS[s] || [s])[0])}</button>`).join("") : ""}
        <button class="adm-btn" id="empCancel">${esc(t("dom.close", "Sluiten"))}</button>
      </div>`;
    A.openDrawer();
    document.getElementById("empCancel")?.addEventListener("click", () => A.closeDrawer());
    document.getElementById("empSave")?.addEventListener("click", async () => {
      const payload = {
        name: document.getElementById("empName").value,
        jobTitle: document.getElementById("empRole").value,
        activeFrom: document.getElementById("empFrom").value || null,
        skills: document.getElementById("empSkills").value.split(",").map(s => ({ label: s.trim() })).filter(s => s.label),
        expectedVersion: emp ? emp.version : undefined,
      };
      const res = await saveGuard(
        () => api(emp ? "PATCH" : "POST", emp ? `/employee_records/${emp.id}` : "/employee_records", payload),
        renderEmployeeRecords);
      if (res) { A.closeDrawer(); toast(t("dom.saved", "Opgeslagen")); renderEmployeeRecords(); }
    });
    document.getElementById("rateAdd")?.addEventListener("click", async () => {
      const res = await saveGuard(() => api("POST", `/employee_records/${emp.id}/rates`, {
        validFrom: document.getElementById("rateFrom").value,
        costRate: Number(document.getElementById("rateCost").value) || 0,
        salesRate: Number(document.getElementById("rateSales").value) || 0,
      }), renderEmployeeRecords);
      if (res) { toast(t("dom.emp.rateAdded", "Tariefversie toegevoegd")); const d = await api("GET", `/employee_records/${emp.id}`); openEmployeeEditor(d.employee); }
    });
    document.getElementById("availCheck")?.addEventListener("click", async () => {
      const date = document.getElementById("availDate").value;
      if (!date) return;
      try {
        const d = await api("GET", `/employee_records/${emp.id}/availability?date=${date}`);
        const av = d.availability;
        // blocking:false = waarschuwing (bevestigbaar), blocking:true = blokkade.
        document.getElementById("availResult").textContent = av.available
          ? t("dom.emp.availOk", "Beschikbaar volgens rooster")
          : `${av.blocking ? "⛔" : "⚠️"} ${(av.reasons || []).map(r => r.message).join(" · ")}`;
      } catch (err) { toast(err.message, "error"); }
    });
    drawerBody().querySelectorAll("[data-emp-status]").forEach(b => b.addEventListener("click", async () => {
      const res = await saveGuard(() => api("POST", `/employee_records/${emp.id}/transition`, { status: b.dataset.empStatus }), renderEmployeeRecords);
      if (res) { A.closeDrawer(); renderEmployeeRecords(); }
    }));
  }

  /* ============================================================
     3. Vorderingsstaten (R7 · view "progress-claims")
     ============================================================ */
  const CLAIM_STATUS = {
    draft: ["Concept", ""], internally_checked: ["Intern gecontroleerd", ""], sent: ["Verzonden", "warn"],
    in_discussion: ["In bespreking", "warn"], approved: ["Goedgekeurd", "success"],
    partially_approved: ["Deels goedgekeurd", "success"], rejected: ["Afgewezen", "error"],
    invoiced: ["Gefactureerd", "success"], closed: ["Afgesloten", "muted"],
  };
  const CLAIM_TRANSITIONS = {
    draft: ["internally_checked", "rejected"], internally_checked: ["sent", "draft", "rejected"],
    sent: ["in_discussion", "approved", "partially_approved", "rejected"],
    in_discussion: ["approved", "partially_approved", "rejected"],
    partially_approved: ["invoiced", "in_discussion", "approved"], approved: ["invoiced", "closed"],
    rejected: ["draft", "closed"], invoiced: ["closed"], closed: [],
  };

  async function renderProgressClaims() {
    const content = A.content();
    content.innerHTML = loadingHtml(t("dom.pc.loading", "Vorderingsstaten laden…"));
    let data, projects;
    try {
      [data, projects] = await Promise.all([
        api("GET", "/progress_claims"),
        api("GET", "/projects").catch(() => ({ projects: [] })),
      ]);
    } catch (err) {
      content.innerHTML = errorHtml(err, "pcRetry");
      document.getElementById("pcRetry")?.addEventListener("click", renderProgressClaims);
      return;
    }
    const rows = data.claims || [];
    const projById = new Map((projects.projects || []).map(p => [p.id, p]));

    content.innerHTML = `
      <div class="adm-card"><div class="adm-card-header">
        <div><h2 class="adm-card-title">${esc(t("nav.progressClaims", "Vorderingsstaten"))}</h2>
          <p class="adm-form-hint">${esc(t("dom.pc.sub", "Periodiek factureren op cumulatieve voortgang · met herziening, retentie en voorschot."))}</p></div>
        <button class="adm-btn adm-btn-primary" id="pcNew">+ ${esc(t("dom.pc.new", "Nieuwe staat"))}</button></div>
      <div class="adm-card-body">${rows.length ? `
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr>
          <th>${esc(t("dom.pc.number", "Nummer"))}</th><th>${esc(t("dom.pc.project", "Project"))}</th>
          <th>${esc(t("dom.status", "Status"))}</th><th>${esc(t("dom.pc.current", "Huidige periode"))}</th>
          <th>${esc(t("dom.pc.net", "Netto te betalen"))}</th><th></th></tr></thead>
        <tbody>${rows.map(c => {
          const [label, tone] = CLAIM_STATUS[c.status] || [c.status, ""];
          const proj = projById.get(c.projectId);
          return `<tr><td>${esc(c.number)}</td><td>${esc(proj ? proj.name : c.projectId)}</td>
            <td><span class="adm-badge ${tone}">${esc(label)}</span></td>
            <td>${money(c.totals ? c.totals.currentAmount : 0)}</td>
            <td><strong>${money(c.totals ? c.totals.netPayable : 0)}</strong></td>
            <td><button class="adm-btn adm-btn-sm" data-pc-open="${esc(c.id)}">${esc(t("dom.open", "Openen"))}</button></td></tr>`;
        }).join("")}</tbody></table></div>`
        : emptyHtml(
          t("dom.pc.emptyTitle", "Nog geen vorderingsstaten"),
          t("dom.pc.emptyText", "Start een staat op een project met een aanvaarde offerte. De lijnen komen automatisch uit offerte en meerwerk."),
          "pcEmptyNew", t("dom.pc.new", "Nieuwe staat"))}
      </div></div>`;

    const newClaim = async () => {
      const opts = (projects.projects || []).filter(p => !["cancelled", "archived"].includes(p.status));
      if (!opts.length) { toast(t("dom.pc.noProjects", "Geen actief project gevonden · maak eerst een project met een offerte"), "error"); return; }
      const name = window.prompt(`${t("dom.pc.pickProject", "Voor welk project? Typ het nummer")}:\n${opts.map(p => `${p.number || p.id} · ${p.name}`).join("\n")}`);
      if (!name) return;
      const proj = opts.find(p => (p.number || "").toLowerCase() === name.trim().toLowerCase() || p.id === name.trim());
      if (!proj) { toast(t("dom.pc.projectNotFound", "Project niet gevonden"), "error"); return; }
      try { const res = await api("POST", "/progress_claims", { projectId: proj.id }); openClaimDetail(res.claim.id); renderProgressClaims(); }
      catch (err) { toast(err.message, "error"); }
    };
    document.getElementById("pcNew")?.addEventListener("click", newClaim);
    document.getElementById("pcEmptyNew")?.addEventListener("click", newClaim);
    content.querySelectorAll("[data-pc-open]").forEach(b => b.addEventListener("click", () => openClaimDetail(b.dataset.pcOpen)));
  }

  async function openClaimDetail(id) {
    let d;
    try { d = await api("GET", `/progress_claims/${id}`); }
    catch (err) { toast(err.message, "error"); return; }
    const c = d.claim, tot = d.totals;
    const frozen = ["approved", "partially_approved", "invoiced", "closed"].includes(c.status);
    const [label] = CLAIM_STATUS[c.status] || [c.status];
    drawerBody().innerHTML = `
      <h3>${esc(c.number)} <span class="adm-badge">${esc(label)}</span></h3>
      ${frozen ? `<p class="adm-badge muted">${esc(t("dom.pc.frozen", "Goedgekeurde staat · bevroren, wijzig via de volgende vordering"))}</p>` : ""}
      <div class="adm-form-section"><h4>${esc(t("dom.pc.lines", "Lijnen (vorige → huidig → cumulatief)"))}</h4>
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr>
          <th>${esc(t("dom.pc.desc", "Omschrijving"))}</th><th>${esc(t("dom.pc.contract", "Contract"))}</th>
          <th>${esc(t("dom.pc.prev", "Vorige"))}</th><th>${esc(t("dom.pc.cum", "Cumulatief"))}</th>
          <th>${esc(t("dom.pc.cur", "Huidig"))}</th></tr></thead>
        <tbody>${c.lines.map(l => `<tr class="${l.disputed ? "adm-row-muted" : ""}">
          <td>${esc(l.description)}${l.disputed ? ` <span class="adm-badge warn">${esc(t("dom.pc.disputed", "betwist"))}</span>` : ""}</td>
          <td>${l.contractQty} ${esc(l.unit)}</td><td>${l.previousQty}</td>
          <td>${frozen ? l.cumulativeQty : `<input type="number" step="0.01" class="adm-input adm-input-sm" data-line-cum="${esc(l.id)}" value="${l.cumulativeQty}" style="width:90px">`}</td>
          <td>${money(l.currentAmount)}</td></tr>`).join("")}</tbody></table></div>
        ${!frozen ? `<button class="adm-btn" id="pcSaveLines">${esc(t("dom.pc.saveProgress", "Voortgang opslaan"))}</button>` : ""}</div>
      <div class="adm-form-section"><h4>${esc(t("dom.pc.totals", "Totalen · transparant"))}</h4>
        <table class="adm-table"><tbody>
          <tr><td>${esc(t("dom.pc.current", "Huidige periode"))}</td><td>${money(tot.currentAmount)}</td></tr>
          ${tot.priceRevision && tot.priceRevision.enabled ? `<tr><td>${esc(t("dom.pc.revision", "Prijsherziening"))}<br><small>${esc(tot.priceRevision.formulaText || "")}</small></td><td>${money(tot.priceRevision.amount)}</td></tr>` : ""}
          ${tot.retentionAmount ? `<tr><td>${esc(t("dom.pc.retention", "Retentie"))} ${tot.retentionPct}%</td><td>− ${money(tot.retentionAmount)}</td></tr>` : ""}
          ${tot.advanceAmount ? `<tr><td>${esc(t("dom.pc.advance", "Voorschotverrekening"))}</td><td>− ${money(tot.advanceAmount)}</td></tr>` : ""}
          <tr><td><strong>${esc(t("dom.pc.net", "Netto te betalen"))}</strong></td><td><strong>${money(tot.netPayable)}</strong></td></tr>
        </tbody></table></div>
      <div class="adm-form-actions">
        ${(CLAIM_TRANSITIONS[c.status] || []).map(s => `<button class="adm-btn" data-pc-status="${s}">${esc((CLAIM_STATUS[s] || [s])[0])}</button>`).join("")}
        ${["approved", "partially_approved"].includes(c.status) && !c.invoiceId ? `<button class="adm-btn adm-btn-primary" id="pcInvoice">${esc(t("dom.pc.invoice", "Factuur maken"))}</button>` : ""}
        <button class="adm-btn" id="pcClose">${esc(t("dom.close", "Sluiten"))}</button>
      </div>`;
    A.openDrawer();
    document.getElementById("pcClose")?.addEventListener("click", () => A.closeDrawer());
    document.getElementById("pcSaveLines")?.addEventListener("click", async () => {
      const lines = c.lines.map(l => {
        const input = drawerBody().querySelector(`[data-line-cum="${l.id}"]`);
        return { ...l, cumulativeQty: input ? Number(input.value) : l.cumulativeQty };
      });
      try {
        await api("PATCH", `/progress_claims/${c.id}`, { lines, expectedVersion: c.version });
        toast(t("dom.saved", "Opgeslagen")); openClaimDetail(c.id); renderProgressClaims();
      } catch (err) {
        if (err.code === "CONTRACT_QTY_EXCEEDED") {
          // Contractbewaking: markeer de regels en leg uit, geen generieke fout.
          toast(t("dom.pc.overrun", "Cumulatief boven de contracthoeveelheid · registreer eerst goedgekeurd meerwerk"), "error");
          (err.lines || []).forEach(l => {
            const input = drawerBody().querySelector(`[data-line-cum="${l.id}"]`);
            if (input) input.style.borderColor = "var(--adm-error, #d33)";
          });
        } else if (err.code === "VERSION_CONFLICT") { await saveGuard(() => { throw err; }, () => openClaimDetail(c.id)); }
        else toast(err.message, "error");
      }
    });
    drawerBody().querySelectorAll("[data-pc-status]").forEach(b => b.addEventListener("click", async () => {
      try { await api("POST", `/progress_claims/${c.id}/transition`, { status: b.dataset.pcStatus }); openClaimDetail(c.id); renderProgressClaims(); }
      catch (err) { toast(err.message, "error"); }
    }));
    document.getElementById("pcInvoice")?.addEventListener("click", async () => {
      try {
        const res = await api("POST", `/progress_claims/${c.id}/invoice`, {});
        toast(`${t("dom.pc.invoiced", "Factuur aangemaakt")}: ${res.invoice.number}`);
        A.closeDrawer(); renderProgressClaims();
      } catch (err) { toast(err.message, "error"); }
    });
  }

  /* ============================================================
     4. Portfolio & capaciteit (h38 · view "portfolio")
     ============================================================ */
  async function renderPortfolio() {
    const content = A.content();
    content.innerHTML = loadingHtml(t("dom.pf.loading", "Portfolio samenstellen…"));
    let pf, cap;
    try {
      [pf, cap] = await Promise.all([
        api("GET", "/portfolio"),
        api("GET", "/portfolio/capacity").catch(() => null),
      ]);
    } catch (err) {
      content.innerHTML = errorHtml(err, "pfRetry");
      document.getElementById("pfRetry")?.addEventListener("click", renderPortfolio);
      return;
    }
    const p = pf.portfolio;
    content.innerHTML = `
      <div class="adm-card"><div class="adm-card-header">
        <h2 class="adm-card-title">${esc(t("dom.pf.projects", "Projecten (vastgelegd werk)"))} · ${money(p.totals.projectBudget)}</h2></div>
      <div class="adm-card-body">${p.projects.length ? `
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr>
          <th>${esc(t("dom.pf.name", "Project"))}</th><th>${esc(t("dom.status", "Status"))}</th>
          <th>${esc(t("dom.pf.budget", "Budget"))}</th><th>${esc(t("dom.pf.drift", "Uitloop"))}</th><th></th></tr></thead>
        <tbody>${p.projects.map(x => `<tr>
          <td>${esc(x.number || "")} ${esc(x.name)}</td><td>${esc(x.status)}${x.overdue ? " ⚠️" : ""}</td>
          <td>${money(x.budgetAmount)}</td>
          <td>${x.hasBaseline ? (x.maxEndDriftDays > 0 ? `<span class="adm-badge warn">+${x.maxEndDriftDays}d</span>` : `<span class="adm-badge success">${esc(t("dom.pf.onTrack", "op schema"))}</span>`) : `<span class="adm-badge muted">${esc(t("dom.pf.noBaseline", "geen baseline"))}</span>`}</td>
          <td>${!x.hasBaseline ? `<button class="adm-btn adm-btn-sm" data-pf-baseline="${esc(x.projectId)}">${esc(t("dom.pf.setBaseline", "Baseline vastleggen"))}</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`
        : emptyHtml(t("dom.pf.emptyTitle", "Nog geen projecten"), t("dom.pf.emptyText", "Projecten verschijnen hier zodra ze zijn aangemaakt."), null, null)}
      </div></div>
      <div class="adm-card"><div class="adm-card-header">
        <h2 class="adm-card-title">${esc(t("dom.pf.pipeline", "Gewogen pipeline (offertes)"))} · ${money(p.totals.pipelineWeighted)}</h2>
        <p class="adm-form-hint">${esc(t("dom.pf.separate", "Bewust apart van de projecten: verwachte omzet is geen vastgelegde omzet."))}</p></div>
      <div class="adm-card-body">${p.weightedQuotes.length ? `
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr>
          <th>${esc(t("dom.pf.quote", "Offerte"))}</th><th>${esc(t("dom.pf.amount", "Bedrag"))}</th>
          <th>${esc(t("dom.pf.probability", "Kans"))}</th><th>${esc(t("dom.pf.weighted", "Gewogen"))}</th></tr></thead>
        <tbody>${p.weightedQuotes.map(q => `<tr>
          <td>${esc(q.number || "")} ${esc(q.clientName)}</td><td>${money(q.amount)}</td>
          <td>${Math.round(q.probability * 100)}%</td><td>${money(q.weightedAmount)}</td></tr>`).join("")}</tbody></table></div>`
        : `<p class="adm-form-hint">${esc(t("dom.pf.noQuotes", "Geen openstaande offertes."))}</p>`}
      </div></div>
      ${cap ? `<div class="adm-card"><div class="adm-card-header">
        <h2 class="adm-card-title">${esc(t("dom.pf.capacity", "Capaciteit per periode en rol"))}</h2></div>
      <div class="adm-card-body">${cap.capacity.shortfalls.length ? `
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr>
          <th>${esc(t("dom.pf.period", "Periode"))}</th><th>${esc(t("dom.emp.role", "Rol"))}</th>
          <th>${esc(t("dom.pf.available", "Beschikbaar"))}</th><th>${esc(t("dom.pf.planned", "Gepland"))}</th>
          <th>${esc(t("dom.pf.shortfall", "Tekort"))}</th></tr></thead>
        <tbody>${cap.capacity.shortfalls.map(s => `<tr>
          <td>${esc(s.period)}</td><td>${esc(s.role)}${s.role === "onbekend" ? ` <span class="adm-badge warn">${esc(t("dom.pf.dataGap", "geen fiche"))}</span>` : ""}</td>
          <td>${s.availableHours}u</td><td>${s.plannedHours}u</td>
          <td><span class="adm-badge error">${s.shortfallHours}u</span></td></tr>`).join("")}</tbody></table></div>`
        : `<p class="adm-form-hint">✅ ${esc(t("dom.pf.noShortfall", "Geen capaciteitstekorten in de komende periode."))}</p>`}
      </div></div>` : ""}`;

    content.querySelectorAll("[data-pf-baseline]").forEach(b => b.addEventListener("click", async () => {
      try { await api("POST", `/projects/${b.dataset.pfBaseline}/baseline`, {}); toast(t("dom.pf.baselineSet", "Baseline vastgelegd")); renderPortfolio(); }
      catch (err) { toast(err.message, "error"); }
    }));
  }

  /* ============================================================
     5. Webhooks (E19 · view "webhooks")
     ============================================================ */
  async function renderWebhooks() {
    const content = A.content();
    content.innerHTML = loadingHtml(t("dom.wh.loading", "Webhooks laden…"));
    let data;
    try { data = await api("GET", "/webhooks"); }
    catch (err) {
      content.innerHTML = errorHtml(err, "whRetry");
      document.getElementById("whRetry")?.addEventListener("click", renderWebhooks);
      return;
    }
    const endpoints = data.endpoints || [];
    const health = new Map(((data.health || {}).endpoints || []).map(h => [h.id, h]));

    content.innerHTML = `
      <div class="adm-card"><div class="adm-card-header">
        <div><h2 class="adm-card-title">${esc(t("nav.webhooks", "Webhooks"))}</h2>
          <p class="adm-form-hint">${esc(t("dom.wh.sub", "Ondertekende events naar externe systemen · at-least-once, dedupliceer op event-id."))}</p></div>
        <div class="adm-form-row">
          <button class="adm-btn" id="whDeliver">${esc(t("dom.wh.deliver", "Bezorgronde nu"))}</button>
          <button class="adm-btn adm-btn-primary" id="whNew">+ ${esc(t("dom.wh.new", "Nieuw endpoint"))}</button></div></div>
      <div class="adm-card-body">${endpoints.length ? `
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr>
          <th>URL</th><th>${esc(t("dom.wh.events", "Events"))}</th><th>${esc(t("dom.status", "Status"))}</th>
          <th>${esc(t("dom.wh.lastOk", "Laatste succes"))}</th><th>${esc(t("dom.wh.backlog", "Achterstand"))}</th><th></th></tr></thead>
        <tbody>${endpoints.map(ep => {
          const h = health.get(ep.id) || {};
          const tone = ep.status === "active" ? "success" : ep.status === "error" ? "error" : "muted";
          return `<tr><td><code>${esc(ep.url)}</code><br><small>${esc(ep.secretHint || "")}</small></td>
            <td>${(ep.eventTypes || []).map(e2 => `<span class="adm-badge">${esc(e2)}</span>`).join(" ")}</td>
            <td><span class="adm-badge ${tone}">${esc(ep.status)}</span>${h.lastError ? `<br><small>${esc(h.lastError)}</small>` : ""}</td>
            <td>${h.lastSuccessAt ? fmtDate(h.lastSuccessAt) : "–"}</td>
            <td>${h.backlog ? `<span class="adm-badge warn">${h.backlog}</span>` : "0"}</td>
            <td class="adm-form-row">
              ${ep.status === "error" || ep.status === "paused" ? `<button class="adm-btn adm-btn-sm" data-wh-resume="${esc(ep.id)}">${esc(t("dom.wh.resume", "Hervatten"))}</button>` : ""}
              <button class="adm-btn adm-btn-sm" data-wh-rotate="${esc(ep.id)}">${esc(t("dom.wh.rotate", "Secret roteren"))}</button>
              <button class="adm-btn adm-btn-sm" data-wh-del="${esc(ep.id)}">✕</button></td></tr>`;
        }).join("")}</tbody></table></div>`
        : emptyHtml(
          t("dom.wh.emptyTitle", "Nog geen webhooks"),
          t("dom.wh.emptyText", "Registreer een https-endpoint en ontvang ondertekende domeinevents zodra er iets gebeurt."),
          "whEmptyNew", t("dom.wh.new", "Nieuw endpoint"))}
      </div></div>`;

    const openNew = () => {
      drawerBody().innerHTML = `
        <h3>${esc(t("dom.wh.new", "Nieuw endpoint"))}</h3>
        <div class="adm-form-section">
          <div class="adm-form-group"><label>URL (https) *</label><input id="whUrl" class="adm-input" placeholder="https://voorbeeld.be/hooks/monargo"></div>
          <div class="adm-form-group"><label>${esc(t("dom.wh.eventsCsv", "Eventtypes (komma-gescheiden, * mag)"))} *</label>
            <input id="whEvents" class="adm-input" placeholder="invoice.*, workorder.approved"></div>
        </div>
        <div class="adm-form-actions">
          <button class="adm-btn adm-btn-primary" id="whCreate">${esc(t("dom.wh.create", "Registreren"))}</button>
          <button class="adm-btn" id="whCancel">${esc(t("dom.close", "Sluiten"))}</button></div>
        <div id="whSecretOut"></div>`;
      A.openDrawer();
      document.getElementById("whCancel")?.addEventListener("click", () => A.closeDrawer());
      document.getElementById("whCreate")?.addEventListener("click", async () => {
        try {
          const res = await api("POST", "/webhooks", {
            url: document.getElementById("whUrl").value,
            eventTypes: document.getElementById("whEvents").value.split(",").map(s => s.trim()).filter(Boolean),
          });
          // Het secret komt EENMALIG terug (contract) · toon met kopieerknop.
          document.getElementById("whSecretOut").innerHTML = `
            <div class="adm-form-section"><h4>⚠️ ${esc(t("dom.wh.secretOnce", "Signing secret · wordt niet opnieuw getoond"))}</h4>
            <div class="adm-form-row"><code id="whSecretVal">${esc(res.secret)}</code>
            <button class="adm-btn adm-btn-sm" id="whCopy">${esc(t("dom.wh.copy", "Kopiëren"))}</button></div></div>`;
          document.getElementById("whCopy")?.addEventListener("click", () => {
            navigator.clipboard.writeText(res.secret).then(() => toast(t("dom.wh.copied", "Gekopieerd")));
          });
          renderWebhooks();
        } catch (err) { toast(err.message, "error"); }
      });
    };
    document.getElementById("whNew")?.addEventListener("click", openNew);
    document.getElementById("whEmptyNew")?.addEventListener("click", openNew);
    document.getElementById("whDeliver")?.addEventListener("click", async () => {
      try { const r = await api("POST", "/webhooks/deliver", {}); toast(`${r.delivered} ${t("dom.wh.delivered", "bezorgd")}, ${r.failed} ${t("dom.wh.failed", "mislukt")}`); renderWebhooks(); }
      catch (err) { toast(err.message, "error"); }
    });
    content.querySelectorAll("[data-wh-resume]").forEach(b => b.addEventListener("click", async () => {
      const ep = endpoints.find(x => x.id === b.dataset.whResume);
      try { await api("PATCH", `/webhooks/${ep.id}`, { url: ep.url, eventTypes: ep.eventTypes, status: "active" }); renderWebhooks(); }
      catch (err) { toast(err.message, "error"); }
    }));
    content.querySelectorAll("[data-wh-rotate]").forEach(b => b.addEventListener("click", async () => {
      if (!window.confirm(t("dom.wh.rotateConfirm", "Nieuw secret genereren? Je ontvanger moet meteen bijgewerkt worden."))) return;
      try {
        const res = await api("POST", `/webhooks/${b.dataset.whRotate}/rotate-secret`, {});
        window.prompt(t("dom.wh.secretOnce", "Signing secret · wordt niet opnieuw getoond"), res.secret);
        renderWebhooks();
      } catch (err) { toast(err.message, "error"); }
    }));
    content.querySelectorAll("[data-wh-del]").forEach(b => b.addEventListener("click", async () => {
      if (!window.confirm(t("dom.wh.delConfirm", "Endpoint verwijderen?"))) return;
      try { await api("DELETE", `/webhooks/${b.dataset.whDel}`); renderWebhooks(); }
      catch (err) { toast(err.message, "error"); }
    }));
  }

  /* ============================================================
     6. Universele lijsten (h11 · view "lists")
     ============================================================ */
  let listState = { resource: null, search: "", status: "", cursor: null, selection: new Set() };

  async function renderLists() {
    const content = A.content();
    content.innerHTML = loadingHtml(t("dom.ls.loading", "Lijsten laden…"));
    let meta;
    try { meta = await api("GET", "/grid/resources"); }
    catch (err) {
      content.innerHTML = errorHtml(err, "lsRetry");
      document.getElementById("lsRetry")?.addEventListener("click", renderLists);
      return;
    }
    const resources = meta.resources || [];
    if (!resources.length) {
      content.innerHTML = `<div class="adm-card"><div class="adm-card-body">${emptyHtml(
        t("dom.ls.emptyTitle", "Geen lijsten beschikbaar"),
        t("dom.ls.emptyText", "Je rechten geven momenteel geen toegang tot doorzoekbare lijsten."), null, null)}</div></div>`;
      return;
    }
    if (!listState.resource || !resources.some(r => r.key === listState.resource)) listState.resource = resources[0].key;

    let result = null, queryErr = null;
    try {
      result = await api("POST", `/grid/${listState.resource}/query`, {
        search: listState.search || undefined,
        filters: listState.status ? [{ field: "status", op: "eq", value: listState.status }] : [],
        cursor: listState.cursor || undefined,
        limit: 50,
      });
    } catch (err) { queryErr = err; }

    const cols = result && result.rows.length
      ? ["number", "name", "title", "email", "status", "total", "createdAt"].filter(c => result.rows.some(r => r[c] !== undefined))
      : [];

    content.innerHTML = `
      <div class="adm-card"><div class="adm-card-header">
        <div><h2 class="adm-card-title">${esc(t("nav.lists", "Lijsten & export"))}</h2>
          <p class="adm-form-hint">${esc(t("dom.ls.sub", "Eén zoek-, bulk- en exportlaag over alle modules · rechten worden server-side afgedwongen."))}</p></div>
        <div class="adm-form-row">
          <select id="lsResource" class="adm-input">${resources.map(r => `<option value="${esc(r.key)}" ${r.key === listState.resource ? "selected" : ""}>${esc(r.key)}</option>`).join("")}</select>
          <input type="search" id="lsSearch" class="adm-input" placeholder="${esc(t("dom.searchPh", "Zoeken…"))}" value="${esc(listState.search)}">
          <button class="adm-btn" id="lsExport">${esc(t("dom.ls.export", "Exporteer CSV"))}</button>
        </div></div>
      <div class="adm-card-body">
        ${queryErr ? errorHtml(queryErr, "lsQueryRetry") : ""}
        ${result && result.hiddenColumns && result.hiddenColumns.length ? `<p class="adm-form-hint">🔒 ${esc(t("dom.ls.hidden", "Verborgen kolommen (geen recht)"))}: ${result.hiddenColumns.map(esc).join(", ")}</p>` : ""}
        ${result && result.rows.length ? `
        <div class="adm-form-row">
          <select id="lsBulkAction" class="adm-input">
            <option value="">${esc(t("dom.ls.bulkPick", "Bulkactie…"))}</option>
            <option value="set_status">${esc(t("dom.ls.bulkStatus", "Status wijzigen"))}</option>
            <option value="archive">${esc(t("dom.ls.bulkArchive", "Archiveren"))}</option>
            <option value="delete">${esc(t("dom.ls.bulkDelete", "Verwijderen"))}</option>
          </select>
          <button class="adm-btn" id="lsBulkRun" disabled>${esc(t("dom.ls.bulkRun", "Uitvoeren op selectie"))}</button>
          <span class="adm-form-hint" id="lsSelCount"></span></div>
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr>
          <th><input type="checkbox" id="lsSelAll"></th>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead>
        <tbody>${result.rows.map(r => `<tr>
          <td><input type="checkbox" data-ls-sel="${esc(r.id)}"></td>
          ${cols.map(c => `<td>${esc(String(r[c] ?? "–")).slice(0, 60)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
        <div class="adm-form-row">
          <span class="adm-form-hint">${result.total} ${esc(t("dom.ls.results", "resultaten"))}</span>
          ${result.nextCursor ? `<button class="adm-btn" id="lsMore">${esc(t("dom.ls.more", "Volgende pagina"))}</button>` : ""}
          ${listState.cursor ? `<button class="adm-btn" id="lsFirst">${esc(t("dom.ls.first", "Eerste pagina"))}</button>` : ""}
        </div>`
        : (!queryErr ? emptyHtml(t("dom.ls.noRows", "Geen resultaten"), t("dom.ls.noRowsText", "Pas je zoekterm of filters aan."), null, null) : "")}
      </div></div>`;

    document.getElementById("lsResource")?.addEventListener("change", e => { listState = { resource: e.target.value, search: "", status: "", cursor: null, selection: new Set() }; renderLists(); });
    document.getElementById("lsSearch")?.addEventListener("change", e => { listState.search = e.target.value; listState.cursor = null; renderLists(); });
    document.getElementById("lsQueryRetry")?.addEventListener("click", renderLists);
    document.getElementById("lsMore")?.addEventListener("click", () => { listState.cursor = result.nextCursor; renderLists(); });
    document.getElementById("lsFirst")?.addEventListener("click", () => { listState.cursor = null; renderLists(); });

    const bulkBtn = document.getElementById("lsBulkRun");
    const selCount = document.getElementById("lsSelCount");
    const syncSel = () => {
      const n = listState.selection.size;
      if (bulkBtn) bulkBtn.disabled = n === 0 || !document.getElementById("lsBulkAction").value;
      if (selCount) selCount.textContent = n ? `${n} ${t("dom.ls.selected", "geselecteerd")}` : "";
    };
    content.querySelectorAll("[data-ls-sel]").forEach(cb => cb.addEventListener("change", () => {
      cb.checked ? listState.selection.add(cb.dataset.lsSel) : listState.selection.delete(cb.dataset.lsSel);
      syncSel();
    }));
    document.getElementById("lsSelAll")?.addEventListener("change", e => {
      content.querySelectorAll("[data-ls-sel]").forEach(cb => {
        cb.checked = e.target.checked;
        e.target.checked ? listState.selection.add(cb.dataset.lsSel) : listState.selection.delete(cb.dataset.lsSel);
      });
      syncSel();
    });
    document.getElementById("lsBulkAction")?.addEventListener("change", syncSel);

    // Bulk: ALTIJD eerst de preview tonen (contract) · daarna per record rapporteren.
    bulkBtn?.addEventListener("click", async () => {
      const action = document.getElementById("lsBulkAction").value;
      const ids = [...listState.selection];
      let payload = {};
      if (action === "set_status") {
        const status = window.prompt(t("dom.ls.statusPrompt", "Nieuwe status:"));
        if (!status) return;
        payload = { status };
      }
      try {
        const prev = await api("POST", `/grid/${listState.resource}/bulk/preview`, { action, ids, payload });
        const skipped = prev.preview.skipped || [];
        const msg = `${prev.preview.affectedCount} ${t("dom.ls.willChange", "records worden gewijzigd")}` +
          (skipped.length ? `\n${skipped.length} ${t("dom.ls.skipped", "overgeslagen")}:\n` + skipped.slice(0, 5).map(s => `· ${s.id}: ${s.message}`).join("\n") : "");
        if (!window.confirm(`${msg}\n\n${t("dom.ls.proceed", "Doorgaan?")}`)) return;
        const run = await api("POST", `/grid/${listState.resource}/bulk`, { action, ids, payload });
        const failed = (run.job.results || []).filter(r => !r.ok);
        toast(`${run.job.succeeded} ${t("dom.ls.ok", "gelukt")}, ${run.job.failed} ${t("dom.wh.failed", "mislukt")}`, run.job.failed ? "error" : "success");
        if (failed.length) console.warn("Bulk overgeslagen/mislukt:", failed);
        listState.selection = new Set();
        renderLists();
      } catch (err) { toast(err.message, "error"); }
    });

    // Export: CSV met de actieve filtercontext; boven de limiet komt een job terug.
    document.getElementById("lsExport")?.addEventListener("click", async () => {
      try {
        const res = await fetch(`/api/tenants/${A.tenantId}/grid/${listState.resource}/export`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${A.token}` },
          body: JSON.stringify({
            search: listState.search || undefined,
            filters: listState.status ? [{ field: "status", op: "eq", value: listState.status }] : [],
          }),
        });
        if (res.status === 202) {
          const j = await res.json();
          toast(`${t("dom.ls.exportJob", "Grote export klaargezet · download geldig tot")} ${fmtDate(j.job.expiresAt)}`);
          window.open(j.job.downloadPath, "_blank");
          return;
        }
        if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `HTTP ${res.status}`); }
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${listState.resource}-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (err) { toast(err.message, "error"); }
    });
  }

  /* ============================================================
     7. Werkbon v2 · reviewflow (E07/h25)
     Decorator op het bestaande werkbonnenscherm: de legacy-renderer
     blijft onaangeroerd; wij zetten er een reviewpaneel boven.
     Ingediende werkbonnen → goedkeuren of afwijzen; goedgekeurde →
     correctieboeking (direct wijzigen is bevroren, contract E07).
     ============================================================ */
  // Legacy-statussen die canoniek "ingediend" betekenen (zie work-orders.js).
  const WO_SUBMITTED = new Set(["voltooid", "afgewerkt", "klaar", "submitted", "to_review"]);
  const WO_FROZEN = new Set(["approved", "locked", "partially_invoiced", "invoiced"]);

  async function injectWorkorderReview() {
    const content = A.content();
    if (!content || document.getElementById("woReviewPanel")) return;
    let data;
    try { data = await api("GET", "/workorders"); }
    catch (_) { return; }   // het legacy-scherm meldt zijn eigen fouten al
    const all = data.workorders || [];
    const toReview = all.filter(w => WO_SUBMITTED.has(String(w.status || "").toLowerCase()));
    const frozen = all.filter(w => WO_FROZEN.has(String(w.status || "").toLowerCase()));
    if (!toReview.length && !frozen.length) return;   // niets te doen → geen ruis

    const panel = document.createElement("div");
    panel.id = "woReviewPanel";
    panel.className = "adm-card";
    panel.innerHTML = `
      <div class="adm-card-header"><div>
        <h2 class="adm-card-title">${esc(t("dom.wo.review", "Werkbon-review"))}</h2>
        <p class="adm-form-hint">${esc(t("dom.wo.reviewSub", "Ingediende werkbonnen goedkeuren vóór facturatie · na goedkeuring wijzig je enkel via een correctieboeking."))}</p>
      </div></div>
      <div class="adm-card-body">
        ${toReview.length ? `<div class="adm-table-wrap"><table class="adm-table"><thead><tr>
          <th>${esc(t("dom.wo.number", "Nummer"))}</th><th>${esc(t("dom.wo.title", "Titel"))}</th>
          <th>${esc(t("dom.wo.date", "Datum"))}</th><th></th></tr></thead>
        <tbody>${toReview.map(w => `<tr>
          <td>${esc(w.number || "-")}</td><td>${esc(w.title || "")}</td><td>${fmtDate(w.date)}</td>
          <td class="adm-form-row">
            <button class="adm-btn adm-btn-sm adm-btn-primary" data-wo-approve="${esc(w.id)}">${esc(t("dom.wo.approve", "Goedkeuren"))}</button>
            <button class="adm-btn adm-btn-sm" data-wo-reject="${esc(w.id)}">${esc(t("dom.wo.reject", "Afwijzen"))}</button>
          </td></tr>`).join("")}</tbody></table></div>`
        : `<p class="adm-form-hint">✅ ${esc(t("dom.wo.nothingToReview", "Geen werkbonnen te reviewen."))}</p>`}
        ${frozen.length ? `<p class="adm-form-hint" style="margin-top:12px">${esc(t("dom.wo.frozenHint", "Goedgekeurde werkbonnen zijn bevroren"))}:
          ${frozen.slice(0, 8).map(w => `<button class="adm-btn adm-btn-sm" data-wo-correct="${esc(w.id)}">${esc(w.number || w.id)} · ${esc(t("dom.wo.correct", "correctie"))}</button>`).join(" ")}</p>` : ""}
      </div>`;
    content.insertBefore(panel, content.firstChild);

    panel.querySelectorAll("[data-wo-approve]").forEach(b => b.addEventListener("click", async () => {
      try {
        await api("POST", `/workorders/${b.dataset.woApprove}/submit`, {}).catch(() => {});  // legacy → submitted (idempotent pad)
        await api("POST", `/workorders/${b.dataset.woApprove}/review`, { decision: "approve", note: "" });
        toast(t("dom.wo.approved", "Werkbon goedgekeurd")); A.views.workorders();
      } catch (err) { toast(err.message, "error"); }
    }));
    panel.querySelectorAll("[data-wo-reject]").forEach(b => b.addEventListener("click", async () => {
      const note = window.prompt(t("dom.wo.rejectWhy", "Reden van afwijzing (gaat naar de technieker):"));
      if (note === null) return;
      try {
        await api("POST", `/workorders/${b.dataset.woReject}/submit`, {}).catch(() => {});
        await api("POST", `/workorders/${b.dataset.woReject}/review`, { decision: "reject", note });
        toast(t("dom.wo.rejected", "Teruggestuurd voor correctie")); A.views.workorders();
      } catch (err) { toast(err.message, "error"); }
    }));
    panel.querySelectorAll("[data-wo-correct]").forEach(b => b.addEventListener("click", () => openWorkorderCorrection(b.dataset.woCorrect)));
  }

  function openWorkorderCorrection(woId) {
    drawerBody().innerHTML = `
      <h3>${esc(t("dom.wo.correctionTitle", "Correctieboeking"))}</h3>
      <p class="adm-form-hint">${esc(t("dom.wo.correctionSub", "Een goedgekeurde werkbon wijzig je nooit rechtstreeks: elke correctie blijft auditbaar met reden, tijdstip en actor."))}</p>
      <div class="adm-form-section">
        <div class="adm-form-row">
          <div class="adm-form-group"><label>${esc(t("dom.wo.corrType", "Type"))}</label>
            <select id="corrType" class="adm-input">
              <option value="hours">${esc(t("dom.wo.corrHours", "Uren"))}</option>
              <option value="material">${esc(t("dom.wo.corrMaterial", "Materiaal"))}</option>
              <option value="equipment">${esc(t("dom.wo.corrEquipment", "Materieel"))}</option>
              <option value="other">${esc(t("dom.wo.corrOther", "Anders"))}</option>
            </select></div>
          <div class="adm-form-group"><label>${esc(t("dom.wo.corrQty", "Aantal / delta"))}</label>
            <input id="corrQty" type="number" step="0.01" class="adm-input"></div>
        </div>
        <div class="adm-form-group"><label>${esc(t("dom.wo.corrReason", "Reden"))} *</label>
          <input id="corrReason" class="adm-input" placeholder="${esc(t("dom.wo.corrReasonPh", "bv. extra uren nagemeld door de klant"))}"></div>
      </div>
      <div class="adm-form-actions">
        <button class="adm-btn adm-btn-primary" id="corrSave">${esc(t("dom.wo.corrSave", "Correctie boeken"))}</button>
        <button class="adm-btn" id="corrCancel">${esc(t("dom.close", "Sluiten"))}</button>
      </div>`;
    A.openDrawer();
    document.getElementById("corrCancel")?.addEventListener("click", () => A.closeDrawer());
    document.getElementById("corrSave")?.addEventListener("click", async () => {
      try {
        await api("POST", `/workorders/${woId}/corrections`, {
          type: document.getElementById("corrType").value,
          qty: Number(document.getElementById("corrQty").value) || null,
          reason: document.getElementById("corrReason").value,
        });
        toast(t("dom.wo.corrBooked", "Correctie geboekt · auditbaar vastgelegd"));
        A.closeDrawer(); A.views.workorders();
      } catch (err) {
        // REASON_REQUIRED verdient een gericht bericht, geen generieke fout.
        toast(err.code === "REASON_REQUIRED" ? t("dom.wo.corrNeedsReason", "Een correctie vereist een reden") : err.message, "error");
      }
    });
  }

  // ── Betalingen + allocatie (h45 · Finance-groep h49) ────────
  async function renderPayments() {
    const content = A.content();
    content.innerHTML = loadingHtml(t("dom.pay.loading", "Betalingen laden…"));
    let data;
    try { data = await api("GET", "/payments"); }
    catch (err) {
      content.innerHTML = errorHtml(err, "payRetry");
      document.getElementById("payRetry")?.addEventListener("click", renderPayments);
      return;
    }
    const rows = data.payments || [];
    const STATUS_TONE = { unallocated: "warn", partial: "", allocated: "success" };
    const statusLabel = s => t(`dom.pay.status.${s}`, { unallocated: "Niet toegewezen", partial: "Deels toegewezen", allocated: "Toegewezen" }[s] || s);

    content.innerHTML = `
      <div class="adm-card"><div class="adm-card-header">
        <div><h2 class="adm-card-title">${esc(t("nav.payments", "Betalingen"))}</h2>
          <p class="adm-form-hint">${esc(t("dom.pay.sub", "Registreer betalingen en wijs ze toe aan facturen · een factuur is pas betaald als het saldo nul is."))}</p></div>
        <button class="adm-btn adm-btn-primary" id="payNew">+ ${esc(t("dom.pay.new", "Betaling registreren"))}</button></div>
      <div class="adm-card-body">${rows.length ? `
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr>
          <th>${esc(t("dom.date", "Datum"))}</th><th>${esc(t("dom.pay.amount", "Bedrag"))}</th>
          <th>${esc(t("dom.pay.method", "Methode"))}</th><th>${esc(t("dom.pay.reference", "Referentie"))}</th>
          <th>${esc(t("dom.pay.open", "Niet toegewezen"))}</th><th>${esc(t("dom.status", "Status"))}</th><th></th></tr></thead>
        <tbody>${rows.map(p => `
          <tr><td>${fmtDate(p.date)}</td><td>${money(p.amount)}</td>
            <td>${esc(t(`dom.pay.method.${p.method}`, p.method))}</td>
            <td>${esc(p.reference || "-")}${p.note ? `<br><small>${esc(p.note)}</small>` : ""}</td>
            <td>${p.unallocatedAmount > 0 ? money(p.unallocatedAmount) : "0"}</td>
            <td><span class="adm-badge ${STATUS_TONE[p.status] || ""}">${esc(statusLabel(p.status))}</span></td>
            <td class="adm-form-row">
              ${p.unallocatedAmount > 0 ? `<button class="adm-btn adm-btn-sm adm-btn-primary" data-pay-alloc="${esc(p.id)}">${esc(t("dom.pay.allocate", "Toewijzen"))}</button>` : ""}
              ${(p.allocations || []).some(a => !a.reversedAt) ? `<button class="adm-btn adm-btn-sm" data-pay-detail="${esc(p.id)}">${esc(t("dom.pay.detail", "Toewijzingen"))}</button>` : ""}
            </td></tr>`).join("")}</tbody></table></div>`
        : emptyHtml(
          t("dom.pay.emptyTitle", "Nog geen betalingen"),
          t("dom.pay.emptyText", "Registreer een ontvangen betaling en wijs ze toe aan één of meer openstaande facturen."),
          "payEmptyNew", t("dom.pay.new", "Betaling registreren"))}
      </div></div>`;

    // ── Registreren ──
    const openNew = async () => {
      let customers = [];
      try { customers = (await api("GET", "/customers")).customers || []; } catch (_) { /* dropdown blijft leeg */ }
      drawerBody().innerHTML = `
        <h3>${esc(t("dom.pay.new", "Betaling registreren"))}</h3>
        <div class="adm-form-section">
          <div class="adm-form-group"><label>${esc(t("dom.date", "Datum"))} *</label>
            <input id="payDate" type="date" class="adm-input" value="${new Date().toISOString().slice(0, 10)}"></div>
          <div class="adm-form-group"><label>${esc(t("dom.pay.amount", "Bedrag"))} (EUR) *</label>
            <input id="payAmount" type="number" step="0.01" min="0.01" class="adm-input" placeholder="0.00"></div>
          <div class="adm-form-group"><label>${esc(t("dom.pay.method", "Methode"))}</label>
            <select id="payMethod" class="adm-input">
              ${["bank", "cash", "card", "online", "other"].map(m => `<option value="${m}">${esc(t(`dom.pay.method.${m}`, m))}</option>`).join("")}
            </select></div>
          <div class="adm-form-group"><label>${esc(t("dom.pay.customer", "Klant (voor voorstellen)"))}</label>
            <select id="payCustomer" class="adm-input"><option value="">${esc(t("dom.pay.noCustomer", "Geen klant"))}</option>
              ${customers.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}
            </select></div>
          <div class="adm-form-group"><label>${esc(t("dom.pay.reference", "Referentie"))}</label>
            <input id="payRef" class="adm-input" placeholder="+++090/9337/55493+++"></div>
          <div class="adm-form-group"><label>${esc(t("dom.pay.note", "Notitie"))}</label>
            <input id="payNote" class="adm-input"></div>
        </div>
        <div class="adm-form-actions">
          <button class="adm-btn adm-btn-primary" id="payCreate">${esc(t("dom.pay.create", "Registreren"))}</button>
          <button class="adm-btn" id="payCancel">${esc(t("dom.close", "Sluiten"))}</button></div>`;
      A.openDrawer();
      document.getElementById("payCancel")?.addEventListener("click", () => A.closeDrawer());
      document.getElementById("payCreate")?.addEventListener("click", async () => {
        try {
          const res = await api("POST", "/payments", {
            date: document.getElementById("payDate").value,
            amount: Number(document.getElementById("payAmount").value),
            method: document.getElementById("payMethod").value,
            customerId: document.getElementById("payCustomer").value || undefined,
            reference: document.getElementById("payRef").value,
            note: document.getElementById("payNote").value,
          });
          A.closeDrawer();
          toast(t("dom.pay.created", "Betaling geregistreerd"));
          await renderPayments();
          openAllocate(res.payment.id);          // direct door naar toewijzen
        } catch (err) { toast(err.message, "error"); }
      });
    };
    document.getElementById("payNew")?.addEventListener("click", openNew);
    document.getElementById("payEmptyNew")?.addEventListener("click", openNew);

    // ── Toewijzen (voorstel = preview, gebruiker bevestigt) ──
    async function openAllocate(paymentId) {
      let payment, suggestions;
      try {
        payment = (await api("GET", `/payments/${paymentId}`)).payment;
        suggestions = (await api("GET", `/payments/${paymentId}/suggestions`)).suggestions || [];
      } catch (err) { toast(err.message, "error"); return; }
      const unallocated = payment.amount - (payment.allocations || []).filter(a => !a.reversedAt).reduce((s, a) => s + a.amount, 0);
      drawerBody().innerHTML = `
        <h3>${esc(t("dom.pay.allocate", "Toewijzen"))} · ${money(unallocated)}</h3>
        <p class="adm-form-hint">${esc(t("dom.pay.allocHint", "Voorstellen op basis van de gestructureerde mededeling en de oudste open facturen. Pas bedragen aan of vink uit."))}</p>
        ${suggestions.length ? `<div class="adm-form-section">${suggestions.map((s, i) => `
          <div class="adm-form-row" style="align-items:center;gap:8px">
            <input type="checkbox" id="alC${i}" checked data-inv="${esc(s.invoiceId)}">
            <label for="alC${i}" style="flex:1">${esc(s.invoiceNumber)} · ${fmtDate(s.invoiceDate)}
              <small>(${esc(t("dom.pay.outstanding", "open"))}: ${money(s.outstanding)}${s.matchedBy === "structured_communication" ? ` · ${esc(t("dom.pay.refMatch", "referentie-match"))}` : ""})</small></label>
            <input type="number" step="0.01" min="0.01" class="adm-input" style="width:110px" id="alA${i}" value="${s.amount.toFixed(2)}">
          </div>`).join("")}</div>`
        : `<div class="adm-empty"><div class="adm-empty-text">${esc(t("dom.pay.noOpen", "Geen open facturen gevonden voor deze betaling."))}</div></div>`}
        <div class="adm-form-actions">
          <button class="adm-btn adm-btn-primary" id="alDo" ${suggestions.length ? "" : "disabled"}>${esc(t("dom.pay.allocConfirm", "Toewijzen"))}</button>
          <button class="adm-btn" id="alCancel">${esc(t("dom.close", "Sluiten"))}</button></div>`;
      A.openDrawer();
      document.getElementById("alCancel")?.addEventListener("click", () => A.closeDrawer());
      document.getElementById("alDo")?.addEventListener("click", async () => {
        const allocations = suggestions
          .map((s, i) => ({ box: document.getElementById(`alC${i}`), amt: document.getElementById(`alA${i}`), invoiceId: s.invoiceId }))
          .filter(x => x.box && x.box.checked)
          .map(x => ({ invoiceId: x.invoiceId, amount: Number(x.amt.value) }));
        if (!allocations.length) { toast(t("dom.pay.pickOne", "Vink minstens één factuur aan"), "error"); return; }
        try {
          const res = await api("POST", `/payments/${paymentId}/allocate`, { allocations });
          A.closeDrawer();
          toast((res.invoicesPaid || []).length
            ? t("dom.pay.allocPaid", "Toegewezen · factuur betaald: ") + res.invoicesPaid.map(x => x.number).join(", ")
            : t("dom.pay.allocDone", "Toegewezen"));
          await renderPayments();
        } catch (err) { toast(err.message, "error"); }
      });
    }
    content.querySelectorAll("[data-pay-alloc]").forEach(b => b.addEventListener("click", () => openAllocate(b.dataset.payAlloc)));

    // ── Toewijzingen bekijken + terugdraaien (compensatie met reden) ──
    async function openDetail(paymentId) {
      let payment;
      try { payment = (await api("GET", `/payments/${paymentId}`)).payment; } catch (err) { toast(err.message, "error"); return; }
      const active = (payment.allocations || []).filter(a => !a.reversedAt);
      const reversed = (payment.allocations || []).filter(a => a.reversedAt);
      drawerBody().innerHTML = `
        <h3>${esc(t("dom.pay.detail", "Toewijzingen"))} · ${money(payment.amount)}</h3>
        <div class="adm-form-section">
          ${active.map(a => `<div class="adm-form-row" style="align-items:center;gap:8px">
            <span style="flex:1">${esc(a.invoiceNumber)} · ${money(a.amount)} <small>${fmtDate(a.at)}</small></span>
            <button class="adm-btn adm-btn-sm" data-rev="${esc(a.id)}">${esc(t("dom.pay.reverse", "Terugdraaien"))}</button></div>`).join("")
          || `<p class="adm-form-hint">${esc(t("dom.pay.noneActive", "Geen actieve toewijzingen."))}</p>`}
          ${reversed.length ? `<p class="adm-form-hint">${esc(t("dom.pay.reversedList", "Teruggedraaid:"))} ${reversed.map(a => `${esc(a.invoiceNumber)} (${esc(a.reason || "")})`).join(", ")}</p>` : ""}
        </div>
        <div class="adm-form-actions"><button class="adm-btn" id="payDetClose">${esc(t("dom.close", "Sluiten"))}</button></div>`;
      A.openDrawer();
      document.getElementById("payDetClose")?.addEventListener("click", () => A.closeDrawer());
      drawerBody().querySelectorAll("[data-rev]").forEach(b => b.addEventListener("click", async () => {
        // Compensatie vereist een reden (h41: rollback met historiek, nooit stil).
        const reason = window.prompt(t("dom.pay.reverseReason", "Reden voor het terugdraaien (verplicht):"));
        if (!reason) return;
        try {
          const res = await api("POST", `/payments/${paymentId}/allocations/${b.dataset.rev}/reverse`, { reason });
          toast(res.invoiceReopened
            ? t("dom.pay.reopened", "Teruggedraaid · factuur heropend: ") + res.invoiceReopened.number
            : t("dom.pay.reversedOk", "Toewijzing teruggedraaid"));
          A.closeDrawer();
          await renderPayments();
        } catch (err) { toast(err.message, "error"); }
      }));
    }
    content.querySelectorAll("[data-pay-detail]").forEach(b => b.addEventListener("click", () => openDetail(b.dataset.payDetail)));
  }

  // ── Registratie in de gedeelde registry ─────────────────────
  Object.assign(A.views, {
    catalog: renderCatalog,
    employee_records: renderEmployeeRecords,
    "progress-claims": renderProgressClaims,
    portfolio: renderPortfolio,
    webhooks: renderWebhooks,
    lists: renderLists,
    payments: renderPayments,
  });

  // Decorator op het bestaande werkbonnenscherm: eerst de legacy-renderer,
  // daarna het reviewpaneel erbovenop. De legacy-code blijft onaangeroerd.
  const legacyWorkorders = A.views.workorders;
  if (typeof legacyWorkorders === "function") {
    A.views.workorders = async function () {
      const result = await legacyWorkorders.apply(this, arguments);
      try { await injectWorkorderReview(); } catch (_) { /* review is een verrijking, nooit een blokkade */ }
      return result;
    };
  }
}());
