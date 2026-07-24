// ── Resellerportaal · Licenties en prijsuitzonderingen (h23.10) ─────────────
// Zelfstandige paginamodule bij public/js/platforms/reseller.js. Ze LEEST de
// portaalkern (window.wfpCore, window.wfpI18n) en maakt die nooit aan, en ze
// houdt haar eigen paginastaat · de staat van reseller.js blijft daar en wordt
// hier niet gekopieerd. Fetch, 401-afhandeling en de foutkaart volgen exact
// het patroon van reseller.js, zodat er geen tweede manier van werken ontstaat.
//
// Vier regels die deze pagina AFDWINGT, niet alleen toont:
//
//  1. de UI stuurt NOOIT een resellerId mee. De server leidt de organisatie af
//     uit de sessie (23.6). Een id in de query is ook als hij netjes geweigerd
//     wordt een cross-reseller oracle · dus hij vertrekt hier niet;
//  2. klantinhoud (de configuratie van de klantomgeving) vereist een ACTIEVE
//     gedelegeerde toegang (23.12). Zonder grant: commerciële metadata en
//     niets meer. Twijfel of een mislukte controle faalt DICHT;
//  3. een weigering is één vaste, generieke melding. Geen record-id, geen
//     "bestaat niet", geen servertekst · anders is de foutmelding zelf de
//     bestaanstest (ISO-07);
//  4. bedragen tonen is niet bedragen wijzigen. Schrijfknoppen verschijnen
//     alleen als de server het recht meestuurt. De UI verzint geen knoppen en
//     leidt geen rechten af uit "de lijst laadde, dus ik mag wel iets".
(function () {
  "use strict";
  // Monargo Workspace · reseller

  const core = window.wfpCore;
  if (!core) return; // laadvolgorde is geen aanname · zonder kern doet dit niets

  const token = () => core.token();
  const esc = value => core.esc(value == null ? "" : String(value));
  const tR = (key, fallback) => window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback;
  const locale = () => ({ nl: "nl-BE", fr: "fr-BE", en: "en-GB" }[window.wfpI18n?.lang] || "nl-BE");

  // Het recht uit 23.6 dat schrijven op dit scherm ontsluit. Lezen kan ook met
  // reseller.organization.view · een geslaagde GET bewijst dus niets over
  // schrijven en wordt hier ook niet als bewijs gebruikt.
  const WRITE_PERMISSION = "reseller.licenses.request";

  // Paginastaat · strikt lokaal, bewust géén globale reseller-state.
  const state = {
    requests: null, exceptions: null, tenants: null,
    permissions: null,   // uitsluitend wat de server meestuurt
    grants: {},          // tenantId → heeft er NU een actieve delegatie? (faalt dicht)
    kind: "all", open: null, busy: null,
    loading: false, denied: false, error: null,
  };

  let hostEl = null;

  // ── Formattering (zelfde vorm als reseller.js) ─────────────────────────────
  function eur(value) {
    return new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR" }).format(Number(value) || 0);
  }

  function pct(value) {
    if (value == null || !Number.isFinite(Number(value))) return "-";
    return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 2 }).format(Number(value))}%`;
  }

  function date(value) {
    if (!value) return tR("rsp.notAvailable", "Niet beschikbaar");
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return tR("rsp.notAvailable", "Niet beschikbaar");
    return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", year: "numeric" }).format(parsed);
  }

  // reseller.js exporteert zijn status()-helper niet; zolang dat zo is brengt
  // deze pagina de labels mee voor de statussen van de licentie-statusmachine
  // (23.14) die het portaal zelf niet kent. Zelfde CSS-klassen, dus één look.
  function status(value) {
    const labels = {
      draft: tR("rsp.statusDraft", "Concept"),
      submitted: tR("rsp.lic.stSubmitted", "Ingediend"),
      approved: tR("rsp.statusApproved", "Goedgekeurd"),
      scheduled: tR("rsp.lic.stScheduled", "Ingepland"),
      applied: tR("rsp.lic.stApplied", "Toegepast"),
      failed: tR("rsp.lic.stFailed", "Mislukt"),
      canceled: tR("rsp.statusCancelled", "Geannuleerd"),
      pending: tR("rsp.statusPending", "In goedkeuring"),
      rejected: tR("rsp.lic.stRejected", "Afgewezen"),
    };
    const key = String(value || "draft");
    return `<span class="rsp-status rsp-status-${esc(key.replace(/_/g, "-"))}">${esc(labels[key] || key)}</span>`;
  }

  function kindLabel(kind) {
    return {
      order: tR("rsp.lic.kindOrder", "Bestelling"),
      seat_change: tR("rsp.lic.kindSeats", "Seats wijzigen"),
      plan_change: tR("rsp.lic.kindPlan", "Plan wijzigen"),
      trial_extension: tR("rsp.lic.kindTrial", "Proefperiode verlengen"),
      cancellation: tR("rsp.lic.kindCancel", "Opzegging"),
    }[String(kind || "")] || String(kind || "-");
  }

  const geenToegang = () => tR("rsp.lic.denied",
    "Je hebt hier geen toegang toe. Vraag je organisatiebeheerder om de juiste rechten.");

  // ── Netwerk ───────────────────────────────────────────────────────────────
  async function api(method, path, body) {
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      localStorage.removeItem("wfp_token");
      window.WorkFlowProPlatformRouter?.showLogin();
      throw new Error(data.error || tR("rsp.sessionExpired", "Sessie verlopen"));
    }
    // 403 en 404 komen bewust op DEZELFDE generieke melding uit. De server
    // maakt ze al ononderscheidbaar (anti-probing); de UI mag dat niet ongedaan
    // maken door de servertekst, een code of een id alsnog te tonen.
    if (response.status === 403 || response.status === 404) {
      const denied = new Error(geenToegang());
      denied.denied = true;
      throw denied;
    }
    if (!response.ok) throw new Error(data.error || `${tR("rsp.error", "Fout")} ${response.status}`);
    return data;
  }

  async function load(force) {
    if (!force && state.requests && state.exceptions) return;
    // Geen resellerId in de query · de server leidt de organisatie af uit de
    // sessie. Ook de eigen id sturen we niet: dan bestaat het veld, en een veld
    // dat bestaat wordt ooit ingevuld met dat van iemand anders.
    const [requests, exceptions, tenants] = await Promise.all([
      api("GET", "/api/reseller/license-requests"),
      api("GET", "/api/reseller/price-exceptions"),
      // Klantnamen zijn commerciële metadata (23.4). Lukt dit niet, dan tonen
      // we de tenantverwijzing zonder naam · nooit de hele pagina weigeren.
      api("GET", "/api/reseller/assigned-tenants").catch(() => ({ tenants: [] })),
    ]);
    state.requests = requests.requests || [];
    state.exceptions = exceptions.exceptions || [];
    state.tenants = tenants.tenants || [];
    // Rechten komen van de server of bestaan niet.
    state.permissions = requests.permissions || requests.can || null;
  }

  /** Mag deze gebruiker schrijven? Alleen als de server het expliciet zegt. */
  function granted(permission) {
    const p = state.permissions;
    if (Array.isArray(p)) return p.indexOf(permission) !== -1;
    if (p && typeof p === "object") return p[permission] === true;
    return false;
  }

  // ── Gedelegeerde toegang (23.12) ──────────────────────────────────────────
  // Zelfde beslissing als reseller-authz.delegationDecision: alleen status
  // "active" binnen het venster telt. Verlopen, ingetrokken of nog niet
  // gestart is géén toegang.
  function isActiveGrant(grant) {
    if (!grant || grant.status !== "active") return false;
    const now = Date.now();
    const start = grant.startDate || grant.startAt || null;
    const end = grant.endDate || grant.endAt || null;
    if (start && !(Date.parse(start) <= now)) return false;
    if (end && !(Date.parse(end) > now)) return false;
    return true;
  }

  async function ensureGrant(tenantId) {
    if (!tenantId || state.grants[tenantId] !== undefined) return;
    try {
      const data = await api("GET", `/api/reseller/delegated-access?tenantId=${encodeURIComponent(tenantId)}`);
      state.grants[tenantId] = (data.grants || []).some(isActiveGrant);
    } catch (_) {
      // Faalt dicht: zonder aantoonbare grant is er geen klantinhoud.
      state.grants[tenantId] = false;
    }
  }

  // ── Projectie van de records ──────────────────────────────────────────────
  function tenantName(tenantId) {
    const row = (state.tenants || []).find(t => t && t.tenantId === tenantId);
    return (row && row.tenant && row.tenant.name) || null;
  }

  function clientCell(tenantId) {
    const naam = tenantName(tenantId);
    return `<strong class="rsp-client">${esc(naam || tR("rsp.notAvailable", "Niet beschikbaar"))}</strong>`
      + `<small>${esc(tenantId || "")}</small>`;
  }

  /** Maandbedrag uit de CENTRALE prijsvelden · null is "op aanvraag", niet 0. */
  function requestAmount(row) {
    const p = (row && row.payload) || {};
    if (row.kind === "order") {
      return p.pricing && p.pricing.monthly != null ? eur(p.pricing.monthly) : tR("rsp.onRequest", "Op aanvraag");
    }
    if (row.kind === "seat_change") {
      return p.proration && p.proration.monthlyDelta != null ? eur(p.proration.monthlyDelta) : tR("rsp.onRequest", "Op aanvraag");
    }
    if (row.kind === "plan_change") {
      return p.billingImpact && p.billingImpact.deltaMonthly != null ? eur(p.billingImpact.deltaMonthly) : tR("rsp.onRequest", "Op aanvraag");
    }
    return "-"; // een trialverlenging of opzegging draagt geen maandbedrag
  }

  /** Commerciële samenvatting per soort · dit mag altijd zichtbaar zijn. */
  function commercialLines(row) {
    const p = (row && row.payload) || {};
    const lijnen = [];
    const voeg = (label, waarde) => { if (waarde != null && waarde !== "") lijnen.push([label, waarde]); };
    if (row.kind === "order") {
      voeg(tR("rsp.plan", "Plan"), p.plan);
      voeg(tR("rsp.lic.seats", "Seats"), p.seats);
      voeg(tR("rsp.lic.term", "Looptijd"), p.term);
      voeg(tR("rsp.lic.effective", "Ingangsdatum"), date(p.effectiveDate));
    } else if (row.kind === "seat_change") {
      voeg(tR("rsp.lic.seatsNow", "Huidige seats"), p.currentSeats);
      voeg(tR("rsp.lic.seatsAsked", "Gevraagde seats"), p.requestedSeats);
      voeg(tR("rsp.lic.effective", "Ingangsdatum"), date(p.effectiveDate));
    } else if (row.kind === "plan_change") {
      voeg(tR("rsp.lic.planFrom", "Van plan"), p.fromPlan);
      voeg(tR("rsp.lic.planTo", "Naar plan"), p.toPlan);
      voeg(tR("rsp.lic.effective", "Ingangsdatum"), date(p.effectiveDate));
    } else if (row.kind === "trial_extension") {
      voeg(tR("rsp.lic.trialFrom", "Huidige einddatum"), date(p.originalEnd));
      voeg(tR("rsp.lic.trialTo", "Nieuwe einddatum"), date(p.newEnd));
    } else if (row.kind === "cancellation") {
      voeg(tR("rsp.lic.cancelScope", "Omvang"), p.scope);
      voeg(tR("rsp.lic.cancelDate", "Stopdatum"), date(p.date));
    }
    return lijnen;
  }

  /**
   * Klantinhoud: de CONFIGURATIE van de klantomgeving (modules, verlies of
   * winst van entitlements, retentie en data-export). Dat is geen commerciële
   * metadata · zonder actieve gedelegeerde toegang blijft dit dicht.
   */
  function contentLines(row) {
    const p = (row && row.payload) || {};
    const lijnen = [];
    if (row.kind === "order" && Array.isArray(p.modules) && p.modules.length) {
      lijnen.push([tR("rsp.lic.modules", "Modules"), p.modules.join(" · ")]);
    }
    if (row.kind === "plan_change" && p.entitlementDelta) {
      const weg = p.entitlementDelta.removed || [];
      const bij = p.entitlementDelta.added || [];
      if (weg.length) lijnen.push([tR("rsp.lic.modulesLost", "Modules die vervallen"), weg.join(" · ")]);
      if (bij.length) lijnen.push([tR("rsp.lic.modulesGained", "Modules die erbij komen"), bij.join(" · ")]);
    }
    if (row.kind === "cancellation" && p.retention) {
      lijnen.push([tR("rsp.lic.dataExport", "Data-export gevraagd"),
        p.retention.dataExportRequested ? tR("rsp.lic.yes", "Ja") : tR("rsp.lic.no", "Nee")]);
      lijnen.push([tR("rsp.lic.accessEnd", "Toegang tot"), date(p.retention.accessEndAt)]);
    }
    return lijnen;
  }

  // ── Weergave ──────────────────────────────────────────────────────────────
  function definitionList(lijnen) {
    return `<dl class="rsp-deflist">${lijnen.map(([label, waarde]) =>
      `<div><dt>${esc(label)}</dt><dd>${esc(waarde)}</dd></div>`).join("")}</dl>`;
  }

  function pageHead() {
    const acties = granted(WRITE_PERMISSION)
      ? "" // aanvragen indienen gebeurt per rij · geen knop die niets doet
      : `<span class="rsp-msg" role="status">${esc(tR("rsp.lic.readOnly", "Je hebt leestoegang tot dit overzicht."))}</span>`;
    return `
      <header class="rsp-page-head">
        <div>
          <span class="rsp-page-eyebrow">${esc(tR("rsp.lic.eyebrow", "Licentiebeheer"))}</span>
          <h1>${esc(tR("rsp.lic.title", "Licenties en prijsuitzonderingen"))}</h1>
          <p>${esc(tR("rsp.lic.intro", "Volg je licentieaanvragen en de gevraagde prijsuitzonderingen. Goedkeuren gebeurt bij Monargo."))}</p>
        </div>
        ${acties}
      </header>`;
  }

  function filterBar() {
    const soorten = ["all", "order", "seat_change", "plan_change", "trial_extension", "cancellation"];
    return `<label class="rsp-filter"><span>${esc(tR("rsp.type", "Type"))}</span>
      <select id="rslKind">${soorten.map(k =>
        `<option value="${esc(k)}"${k === state.kind ? " selected" : ""}>${esc(k === "all" ? tR("rsp.lic.allKinds", "Alle soorten") : kindLabel(k))}</option>`).join("")}
      </select></label>`;
  }

  function requestRow(row) {
    const open = state.open === row.id;
    // Indienen is de ENIGE overgang die de server aan de resellerkant toestaat
    // (draft → submitted). De knop verschijnt alleen als de server het recht
    // meestuurt · nooit "voor de zekerheid" alvast.
    const kanIndienen = granted(WRITE_PERMISSION) && row.status === "draft";
    const bezig = state.busy === row.id;
    return `<tr>
      <td>${clientCell(row.clientTenantId)}</td>
      <td>${esc(kindLabel(row.kind))}</td>
      <td>${status(row.status)}</td>
      <td>${esc(date(row.createdAt))}</td>
      <td><strong>${esc(requestAmount(row))}</strong></td>
      <td class="rsp-row-actions">
        <button type="button" class="rsp-link-btn" data-rsl-open="${esc(row.id)}" aria-expanded="${open ? "true" : "false"}">${esc(open ? tR("rsp.lic.hide", "Verbergen") : tR("rsp.lic.details", "Details"))}</button>
        ${kanIndienen ? `<button type="button" class="rsp-btn" data-rsl-submit="${esc(row.id)}"${bezig ? " disabled" : ""}>${esc(bezig ? tR("rsp.requesting", "Bezig...") : tR("rsp.lic.submit", "Indienen"))}</button>` : ""}
      </td>
    </tr>${open ? detailRow(row) : ""}`;
  }

  function detailRow(row) {
    const inhoud = contentLines(row);
    const heeftGrant = state.grants[row.clientTenantId] === true;
    // Zonder actieve delegatie: commerciële metadata en niets meer. De melding
    // vertelt wat er nodig is, niet wat er achter zit.
    const inhoudBlok = !inhoud.length ? "" : (heeftGrant
      ? `<div class="rsp-detail-block"><strong>${esc(tR("rsp.lic.configTitle", "Configuratie van de klantomgeving"))}</strong>${definitionList(inhoud)}</div>`
      : `<div class="rsp-form-note"><span aria-hidden="true">i</span><p>${esc(tR("rsp.lic.contentShielded",
          "Klantinhoud is afgeschermd. Configuratiedetails vragen een actieve gedelegeerde toegang met toestemming van de klant."))}</p></div>`);
    return `<tr class="rsp-detail-row"><td colspan="6">
      ${definitionList(commercialLines(row))}
      ${inhoudBlok}
    </td></tr>`;
  }

  function requestsCard() {
    const rijen = (state.requests || []).filter(r => state.kind === "all" || r.kind === state.kind);
    const body = rijen.length
      ? rijen.map(requestRow).join("")
      : `<tr><td colspan="6" class="rsp-empty">${esc(tR("rsp.lic.noRequests", "Nog geen licentieaanvragen."))}</td></tr>`;
    return `
      <section class="rsp-card">
        <div class="rsp-card-head">
          <div><span>${esc(tR("rsp.lic.requests", "Licentieaanvragen"))}</span><small>${esc(tR("rsp.lic.requestsText", "Bestellingen, seats, plan, proefperiode en opzegging"))}</small></div>
          ${filterBar()}
          <span class="rsp-count">${esc(String(rijen.length))}</span>
        </div>
        <div class="rsp-table-wrap">
          <table class="rsp-table">
            <thead><tr>
              <th>${esc(tR("adm.thCustomer", "Klant"))}</th>
              <th>${esc(tR("rsp.type", "Type"))}</th>
              <th>${esc(tR("adm.status", "Status"))}</th>
              <th>${esc(tR("rsp.thRequested", "Aangevraagd"))}</th>
              <th>${esc(tR("rsp.commissionMo", "Per maand"))}</th>
              <th>${esc(tR("rsp.lic.thActions", "Acties"))}</th>
            </tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </section>`;
  }

  function exceptionRow(ex) {
    const goedkeuringen = `${(ex.approvals || []).length}/${ex.requiredApprovals || 1}`;
    return `<tr>
      <td>${clientCell(ex.clientTenantId)}</td>
      <td>${esc(ex.listPrice == null ? tR("rsp.onRequest", "Op aanvraag") : eur(ex.listPrice))}</td>
      <td><strong>${esc(ex.requestedPrice == null ? "-" : eur(ex.requestedPrice))}</strong></td>
      <td>${esc(pct(ex.discountPct))}</td>
      <td>${esc(pct(ex.marginPct))}</td>
      <td>${status(ex.status)}</td>
      <td>${esc(date(ex.expiry))}</td>
      <td>${esc(goedkeuringen)}${ex.escalated ? `<small>${esc(tR("rsp.lic.secondApproval", "tweede goedkeuring vereist"))}</small>` : ""}</td>
    </tr>`;
  }

  function exceptionsCard() {
    const rijen = state.exceptions || [];
    const body = rijen.length
      ? rijen.map(exceptionRow).join("")
      : `<tr><td colspan="8" class="rsp-empty">${esc(tR("rsp.lic.noExceptions", "Nog geen prijsuitzonderingen aangevraagd."))}</td></tr>`;
    return `
      <section class="rsp-card">
        <div class="rsp-card-head">
          <div><span>${esc(tR("rsp.lic.exceptions", "Prijsuitzonderingen"))}</span><small>${esc(tR("rsp.lic.exceptionsText", "Aangevraagd door jou, goedgekeurd door Monargo"))}</small></div>
          <span class="rsp-count">${esc(String(rijen.length))}</span>
        </div>
        <div class="rsp-table-wrap">
          <table class="rsp-table">
            <thead><tr>
              <th>${esc(tR("adm.thCustomer", "Klant"))}</th>
              <th>${esc(tR("rsp.lic.listPrice", "Lijstprijs"))}</th>
              <th>${esc(tR("rsp.lic.askedPrice", "Gevraagde prijs"))}</th>
              <th>${esc(tR("rsp.lic.discount", "Korting"))}</th>
              <th>${esc(tR("rsp.lic.margin", "Marge"))}</th>
              <th>${esc(tR("adm.status", "Status"))}</th>
              <th>${esc(tR("rsp.lic.validUntil", "Geldig tot"))}</th>
              <th>${esc(tR("rsp.lic.approvals", "Goedkeuringen"))}</th>
            </tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
        <div class="rsp-card-body">
          <div class="rsp-form-note"><span aria-hidden="true">i</span><p>${esc(tR("rsp.lic.priceNote",
            "Prijzen komen uit de centrale prijslijst. Een uitzondering wordt bij Monargo beoordeeld en staat los van je commissie."))}</p></div>
        </div>
      </section>`;
  }

  function page() {
    return `${pageHead()}${requestsCard()}${exceptionsCard()}`;
  }

  function deniedCard() {
    // Eén vaste melding · geen id, geen code, geen "bestaat niet".
    return `<section class="rsp-card"><div class="rsp-card-body">
      <div class="rsp-empty-state">
        <strong>${esc(tR("rsp.lic.deniedTitle", "Geen toegang"))}</strong>
        <span>${esc(geenToegang())}</span>
      </div>
    </div></section>`;
  }

  function errorCard(bericht) {
    return `<section class="rsp-error">
      <strong>${esc(tR("rsp.couldNotLoad", "De partnerwerkruimte kon niet laden."))}</strong>
      <p>${esc(bericht)}</p>
      <button type="button" class="rsp-btn" id="rslRetry">${esc(tR("rsp.retry", "Opnieuw proberen"))}</button>
    </section>`;
  }

  // ── Bedrading ─────────────────────────────────────────────────────────────
  function repaint() {
    if (!hostEl) return;
    hostEl.innerHTML = page();
    bind();
  }

  function bind() {
    if (!hostEl) return;
    hostEl.querySelectorAll("[data-rsl-open]").forEach(button => {
      button.addEventListener("click", async () => {
        const id = button.dataset.rslOpen;
        const row = (state.requests || []).find(r => r.id === id);
        state.open = state.open === id ? null : id;
        if (state.open && row) await ensureGrant(row.clientTenantId);
        repaint();
      });
    });
    hostEl.querySelectorAll("[data-rsl-submit]").forEach(button => {
      button.addEventListener("click", async () => {
        const id = button.dataset.rslSubmit;
        state.busy = id;
        repaint();
        try {
          // Alleen de status verandert · payload en prijzen blijven van de server.
          await api("POST", `/api/reseller/license-requests/${encodeURIComponent(id)}/transition`, { to: "submitted" });
          state.busy = null;
          state.requests = null;
          state.exceptions = null;
          await load(true);
          repaint();
          if (window.showToast) window.showToast(tR("rsp.lic.submitted", "Aanvraag ingediend."), "success");
        } catch (error) {
          state.busy = null;
          repaint();
          if (window.showToast) window.showToast(error.message, "error");
        }
      });
    });
    const kind = hostEl.querySelector ? hostEl.querySelector("#rslKind") : null;
    if (kind) {
      kind.addEventListener("change", event => {
        state.kind = (event && event.target && event.target.value) || "all";
        state.open = null;
        repaint();
      });
    }
    const retry = hostEl.querySelector ? hostEl.querySelector("#rslRetry") : null;
    if (retry) {
      retry.addEventListener("click", () => {
        state.requests = null;
        state.exceptions = null;
        render(hostEl);
      });
    }
  }

  async function render(target) {
    const host = target || document.getElementById("rspMain");
    if (!host || state.loading) return host;
    hostEl = host;
    state.loading = true;
    host.setAttribute("aria-busy", "true");
    host.innerHTML = `<div class="rsp-loading"><span class="adm-spinner"></span>${esc(tR("adm.loading", "Laden..."))}</div>`;
    try {
      await load(false);
      state.denied = false;
      state.error = null;
      host.innerHTML = page();
    } catch (error) {
      state.denied = error.denied === true;
      state.error = error.message;
      host.innerHTML = state.denied ? deniedCard() : errorCard(error.message);
    } finally {
      state.loading = false;
      host.removeAttribute("aria-busy");
      bind();
    }
    return host;
  }

  // ── Registratie ───────────────────────────────────────────────────────────
  // Additief in het paginaregister van het portaal: het register wordt
  // idempotent aangemaakt en bestaande pagina's blijven staan. Deze module
  // definieert de portaalkern noch de staat van reseller.js opnieuw.
  const pages = window.wfpResellerPages = window.wfpResellerPages || {};
  pages.licenties = {
    view: "licenties",
    label: () => tR("rsp.lic.nav", "Licenties"),
    meta: () => ({
      eyebrow: tR("rsp.lic.eyebrow", "Licentiebeheer"),
      title: tR("rsp.lic.title", "Licenties en prijsuitzonderingen"),
      text: tR("rsp.lic.intro", "Volg je licentieaanvragen en de gevraagde prijsuitzonderingen. Goedkeuren gebeurt bij Monargo."),
    }),
    render,
  };
}());
