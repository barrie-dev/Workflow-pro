// Resellerportaal · pagina "Klanten en tenantaanvragen" (CTO3-09).
//
// Zelfstandige paginamodule bovenop het bestaande portaal
// (public/js/platforms/reseller.js). Ze volgt datzelfde patroon: window.wfpCore
// voor token en escaping, een eigen dunne api()-wrapper met 401-afhandeling,
// een module-state met een cache, en een render die zijn fout altijd in de
// pagina zelf toont met een herprobeerknop.
//
// De grenzen die deze pagina bewaakt (h23 · IA-handover):
//  - de server leidt de resellerorganisatie af uit de sessie · deze pagina
//    stuurt NOOIT een resellerId mee, in geen enkel pad en in geen enkele body;
//  - klantinhoud vereist een ACTIEVE gedelegeerde toegang · zonder grant toont
//    de pagina uitsluitend commerciële metadata en niets meer. De veilige stand
//    is dicht: zolang de toegang niet bevestigd is, staat er "afgeschermd";
//  - een weigering is altijd dezelfde generieke melding · nooit een record-id,
//    een servercode of "bestaat niet" (dat is een bestaans-oracle);
//  - bedragen zijn hier leesbaar, niet bewerkbaar. Het portaal krijgt geen
//    rechtenlijst mee in een response, dus verzint deze pagina ook geen
//    schrijfknoppen: ze doet uitsluitend GET-verzoeken.
(function () {
  "use strict";

  const C = window.wfpCore;
  if (!C) return; // zonder de gedeelde kern haakt de pagina stil af

  const PAGE_ID = "klanten";

  const token = () => C.token();
  const esc = value => C.esc(value == null ? "" : String(value));
  const tR = (key, fallback) => window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback;
  const locale = () => ({ nl: "nl-BE", fr: "fr-BE", en: "en-GB" }[window.wfpI18n?.lang] || "nl-BE");

  // Eén tekst voor elke weigering, ongeacht status, code of oorzaak.
  const weigering = () => tR("rsp.forbidden", "Geen toegang · deze gegevens zijn niet beschikbaar voor jouw account.");

  const state = {
    klanten: null,     // commerciële cijfers · /api/reseller/clients
    toegewezen: null,  // actieve koppelingen · /api/reseller/assigned-tenants
    aanvragen: null,   // tenantaanvragen · /api/reseller/tenant-requests
    // null = nog niet gemeten, true = server gaf de gegevens, false = geweigerd.
    rechten: { toegewezen: null, aanvragen: null },
    toegang: {},       // tenantId → { staat: "laden" | "actief" | "geen" | "geweigerd", tot, scope }
    open: null,        // tenantId van het opengeklapte detailpaneel
    laden: false,
    opnieuw: false     // er kwam een tekenverzoek binnen terwijl we al tekenden
  };
  let houder = null;   // het element waarin deze pagina tekent

  function eur(value) {
    return new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR" }).format(Number(value) || 0);
  }

  function datum(value) {
    if (!value) return tR("rsp.notAvailable", "Niet beschikbaar");
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return tR("rsp.notAvailable", "Niet beschikbaar");
    return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", year: "numeric" }).format(parsed);
  }

  // Statuslabels van de machines uit 23.14 (tenant, tenantaanvraag, delegatie).
  function statusLabel(value) {
    const labels = {
      active: tR("rsp.statusActive", "Actief"),
      trial: tR("rsp.statusTrial", "Proefperiode"),
      draft: tR("rsp.statusDraft", "Concept"),
      submitted: tR("rsp.statusSubmitted", "Ingediend"),
      customer_confirmation: tR("rsp.statusCustomerConfirmation", "Klantbevestiging"),
      review: tR("rsp.statusReview", "In beoordeling"),
      provisioning: tR("rsp.statusProvisioning", "Wordt aangemaakt"),
      rejected: tR("rsp.statusRejected", "Afgewezen"),
      canceled: tR("rsp.statusCancelled", "Geannuleerd"),
      requested: tR("rsp.statusRequested", "Aangevraagd"),
      tenant_approved: tR("rsp.statusTenantApproved", "Klant akkoord"),
      expired: tR("rsp.statusExpired", "Verlopen"),
      revoked: tR("rsp.statusRevoked", "Ingetrokken")
    };
    const key = String(value || "draft");
    // De bestaande stijlklassen kennen "cancelled"; het domein schrijft "canceled".
    const klasse = (key === "canceled" ? "cancelled" : key).replace(/_/g, "-");
    return `<span class="rsp-status rsp-status-${esc(klasse)}">${esc(labels[key] || key)}</span>`;
  }

  function relatieLabel(value) {
    return {
      commercial: tR("rsp.relCommercial", "Commercieel"),
      support: tR("rsp.relSupport", "Support"),
      delegated_admin: tR("rsp.relDelegatedAdmin", "Gedelegeerd beheer")
    }[String(value || "")] || "-";
  }

  function scopeLabel(scope) {
    const labels = {
      onboarding_view: tR("rsp.scopeOnboardingView", "Onboarding inzien"),
      onboarding_tasks: tR("rsp.scopeOnboardingTasks", "Onboardingtaken"),
      ticket_create: tR("rsp.scopeTicketCreate", "Vraag indienen"),
      ticket_view: tR("rsp.scopeTicketView", "Vragen inzien"),
      config_write: tR("rsp.scopeConfigWrite", "Configuratie beheren"),
      user_admin: tR("rsp.scopeUserAdmin", "Gebruikersbeheer"),
      data_export: tR("rsp.scopeDataExport", "Gegevensexport")
    };
    return (Array.isArray(scope) ? scope : [scope]).filter(Boolean).map(s => labels[s] || s).join(" · ");
  }

  // Dunne wrapper rond fetch · identiek aan reseller.js, met één toevoeging:
  // de status blijft op de fout staan zodat de pagina 403 apart kan afhandelen.
  // Bij 403 wordt het serverbericht bewust WEGGEGOOID: alles wat de server daar
  // meestuurt (code, id, reden) hoort niet in de UI thuis.
  async function api(method, path) {
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() }
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      localStorage.removeItem("wfp_token");
      window.WorkFlowProPlatformRouter?.showLogin();
      throw Object.assign(new Error(tR("rsp.sessionExpired", "Sessie verlopen")), { status: 401 });
    }
    if (response.status === 403) {
      throw Object.assign(new Error(weigering()), { status: 403 });
    }
    if (!response.ok) {
      throw Object.assign(new Error(data.error || `${tR("rsp.error", "Fout")} ${response.status}`), { status: response.status });
    }
    return data;
  }

  // Een geweigerd deel maakt de pagina niet stuk: dat blok toont dan de
  // generieke melding en de rest van de pagina blijft leesbaar.
  async function deel(path) {
    try { return { toegestaan: true, data: await api("GET", path) }; }
    catch (fout) {
      if (fout.status === 403) return { toegestaan: false, data: null };
      throw fout;
    }
  }

  async function laadData(force) {
    if (!force && state.klanten && state.toegewezen && state.aanvragen) return;
    // Geen enkel verzoek draagt een resellerId: de server leidt de organisatie
    // af uit de sessie (23.6 · een expliciete ?resellerId= is daar bovendien
    // een harde weigering, ook voor de eigen organisatie).
    const [klanten, toegewezen, aanvragen] = await Promise.all([
      api("GET", "/api/reseller/clients"),
      deel("/api/reseller/assigned-tenants"),
      deel("/api/reseller/tenant-requests")
    ]);
    state.klanten = klanten;
    state.toegewezen = toegewezen.toegestaan ? (toegewezen.data.tenants || []) : [];
    state.aanvragen = aanvragen.toegestaan ? (aanvragen.data.requests || []) : [];
    state.rechten.toegewezen = toegewezen.toegestaan;
    state.rechten.aanvragen = aanvragen.toegestaan;
  }

  // Klantrijen = de koppelingsadministratie (23.4) verrijkt met de commerciële
  // cijfers. Klanten zonder koppelingsrecord (legacy) blijven zichtbaar, maar
  // dragen geen relatie en geen detailpaneel: daar is niets om te tonen.
  function klantRijen() {
    const cijfers = new Map(((state.klanten && state.klanten.rows) || []).map(r => [r.tenantId, r]));
    const rijen = [];
    const gezien = new Set();
    for (const koppeling of state.toegewezen || []) {
      const tenantMeta = koppeling.tenant || {};
      const cijfer = cijfers.get(koppeling.tenantId) || {};
      rijen.push({
        tenantId: koppeling.tenantId,
        naam: tenantMeta.name || cijfer.name || tR("rsp.notAvailable", "Niet beschikbaar"),
        plan: tenantMeta.plan || cijfer.plan || "-",
        status: tenantMeta.status || cijfer.status || "",
        seats: tenantMeta.seats == null ? null : tenantMeta.seats,
        taal: tenantMeta.language || null,
        facturatie: tenantMeta.billingOwnership || null,
        verlenging: tenantMeta.renewal || null,
        relatie: koppeling.relationType,
        startAt: koppeling.startAt || null,
        endAt: koppeling.endAt || null,
        // Cijfers komen UITSLUITEND uit het commerciële overzicht. Kwam die
        // klant daar niet in voor, dan staat er een streepje · een verzonnen
        // € 0,00 leest als "deze klant brengt niets op".
        heeftCijfers: cijfers.has(koppeling.tenantId),
        mrr: cijfer.mrr, unpriced: cijfer.unpriced === true,
        commissionPct: cijfer.commissionPct, commission: cijfer.commission,
        gekoppeld: true
      });
      gezien.add(koppeling.tenantId);
    }
    for (const cijfer of ((state.klanten && state.klanten.rows) || [])) {
      if (gezien.has(cijfer.tenantId)) continue;
      rijen.push({
        tenantId: cijfer.tenantId, naam: cijfer.name, plan: cijfer.plan, status: cijfer.status,
        seats: null, taal: null, facturatie: null, verlenging: null,
        relatie: null, startAt: null, endAt: null, heeftCijfers: true,
        mrr: cijfer.mrr, unpriced: cijfer.unpriced === true,
        commissionPct: cijfer.commissionPct, commission: cijfer.commission,
        gekoppeld: false
      });
    }
    return rijen;
  }

  function bedrag(rij) {
    if (!rij.heeftCijfers) return "-";
    return rij.unpriced ? esc(tR("rsp.onRequest", "Op aanvraag")) : eur(rij.mrr);
  }

  function commissie(rij) {
    if (!rij.heeftCijfers) return "-";
    return `<strong>${eur(rij.commission)}</strong>`;
  }

  // De toegangsbadge staat standaard op "afgeschermd". Alleen een bevestigde,
  // actieve delegatie kantelt hem · onbekend blijft dicht.
  function toegangBadge(rij) {
    const gemeten = state.toegang[rij.tenantId];
    if (!gemeten || gemeten.staat === "laden") {
      return `<span class="rsp-status">${esc(tR("rsp.contentLocked", "Afgeschermd"))}</span>`;
    }
    if (gemeten.staat === "actief") {
      return `<span class="rsp-status rsp-status-active">${esc(tR("rsp.accessActive", "Actieve toegang"))}</span>`;
    }
    return `<span class="rsp-status">${esc(tR("rsp.contentLocked", "Afgeschermd"))}</span>`;
  }

  // Kopteksten · als functie, zodat een taalwissel ze opnieuw oplost in plaats
  // van de taal van het laadmoment vast te houden.
  function meta() {
    return {
      eyebrow: tR("rsp.customerManagement", "Klantenbeheer"),
      title: tR("rsp.clientsTenantsTitle", "Klanten en tenantaanvragen"),
      text: tR("rsp.clientsTenantsIntro", "Je eigen klanten met hun commerciële gegevens, en de stand van je tenantaanvragen.")
    };
  }

  function paginaKop() {
    const m = meta();
    return `
      <header class="rsp-page-head">
        <div>
          <span class="rsp-page-eyebrow">${esc(m.eyebrow)}</span>
          <h1>${esc(m.title)}</h1>
          <p>${esc(m.text)}</p>
        </div>
      </header>`;
  }

  function geweigerdBlok(titel) {
    return `
      <section class="rsp-card">
        <div class="rsp-card-head"><div><span>${esc(titel)}</span></div></div>
        <div class="rsp-card-body">
          <div class="rsp-empty-state">
            <strong>${esc(weigering())}</strong>
            <span>${esc(tR("rsp.forbiddenHint", "Vraag je partnerbeheerder om de juiste rechten."))}</span>
          </div>
        </div>
      </section>`;
  }

  function detailPaneel(rij, kolommen) {
    const gemeten = state.toegang[rij.tenantId];
    const toegangTekst = !gemeten || gemeten.staat === "laden"
      ? esc(tR("rsp.checkingAccess", "Toegang controleren..."))
      : gemeten.staat === "actief"
        ? `${esc(tR("rsp.accessActive", "Actieve toegang"))} · ${esc(scopeLabel(gemeten.scope))} · ${esc(tR("rsp.accessUntil", "tot"))} ${esc(datum(gemeten.tot))}`
        : gemeten.staat === "geweigerd"
          ? esc(weigering())
          : esc(tR("rsp.accessNone", "Geen actieve gedelegeerde toegang"));
    const regels = [
      [tR("rsp.plan", "Plan"), rij.plan || "-"],
      [tR("rsp.thSeats", "Gebruikers"), rij.seats == null ? "-" : String(rij.seats)],
      [tR("rsp.language", "Taal"), rij.taal || "-"],
      [tR("rsp.billing", "Facturatie"), rij.facturatie === "via_reseller"
        ? tR("rsp.billingViaReseller", "Monargo factureert via de partner")
        : rij.facturatie === "monargo_direct"
          ? tR("rsp.billingDirect", "Monargo factureert de klant")
          : "-"],
      [tR("rsp.renewal", "Verlenging"), rij.verlenging ? datum(rij.verlenging) : "-"],
      [tR("rsp.thRelation", "Relatie"), relatieLabel(rij.relatie)],
      [tR("rsp.linkPeriod", "Koppelingsperiode"), `${rij.startAt ? datum(rij.startAt) : "-"} · ${rij.endAt ? datum(rij.endAt) : tR("rsp.openEnded", "geen einddatum")}`]
    ];
    return `<tr class="rsp-detail-row"><td colspan="${kolommen}">
      <div class="rsp-card-body">
        <div class="rsp-form-note"><span aria-hidden="true">i</span><p>${esc(tR("rsp.contentLockedText", "Zonder actieve gedelegeerde toegang toont dit portaal uitsluitend commerciële gegevens van deze klant. Klantinhoud zoals dossiers, medewerkers en documenten blijft afgeschermd."))}</p></div>
        <dl class="rsp-detail-list">
          ${regels.map(([label, waarde]) => `<div><dt>${esc(label)}</dt><dd>${esc(waarde)}</dd></div>`).join("")}
          <div><dt>${esc(tR("rsp.thContent", "Klantinhoud"))}</dt><dd role="status">${toegangTekst}</dd></div>
        </dl>
      </div>
    </td></tr>`;
  }

  function klantenBlok() {
    const rijen = klantRijen();
    const toonKoppeling = state.rechten.toegewezen === true;
    const kolommen = toonKoppeling ? 8 : 6;
    const koppen = [
      tR("adm.thCustomer", "Klant"),
      tR("rsp.plan", "Plan"),
      tR("adm.status", "Status"),
      "MRR",
      tR("rsp.commissionPct", "Commissie"),
      tR("rsp.commissionMo", "Per maand")
    ].concat(toonKoppeling ? [tR("rsp.thRelation", "Relatie"), tR("rsp.thContent", "Klantinhoud")] : []);

    const body = rijen.length
      ? rijen.map(rij => {
        const open = state.open === rij.tenantId;
        const naam = rij.gekoppeld && toonKoppeling
          ? `<button type="button" class="rsp-link-btn" data-rspk-tenant="${esc(rij.tenantId)}" aria-expanded="${open ? "true" : "false"}">${esc(rij.naam)}</button>`
          : `<strong class="rsp-client">${esc(rij.naam)}</strong>`;
        const staart = toonKoppeling
          ? `<td>${esc(relatieLabel(rij.relatie))}</td><td>${toegangBadge(rij)}</td>`
          : "";
        return `<tr>
            <td>${naam}</td>
            <td><span class="rsp-plan">${esc(rij.plan || "-")}</span></td>
            <td>${statusLabel(rij.status)}</td>
            <td>${bedrag(rij)}</td>
            <td>${esc(rij.commissionPct == null ? "-" : `${rij.commissionPct}%`)}</td>
            <td>${commissie(rij)}</td>
            ${staart}
          </tr>${open ? detailPaneel(rij, kolommen) : ""}`;
      }).join("")
      : `<tr><td colspan="${kolommen}" class="rsp-empty">${esc(tR("rsp.noAssigned", "Nog geen klanten gekoppeld."))}</td></tr>`;

    const notitie = toonKoppeling
      ? tR("rsp.commercialOnly", "Uitsluitend commerciële gegevens")
      : tR("rsp.assignmentsHidden", "Uitsluitend commerciële gegevens · het koppelingsoverzicht is niet beschikbaar voor jouw account.");

    return `
      <section class="rsp-card">
        <div class="rsp-card-head">
          <div><span>${esc(tR("rsp.assignedClients", "Toegewezen klanten"))}</span><small>${esc(notitie)}</small></div>
          <span class="rsp-count">${esc(String(rijen.length))}</span>
        </div>
        <div class="rsp-table-wrap">
          <table class="rsp-table">
            <thead><tr>${koppen.map(k => `<th>${esc(k)}</th>`).join("")}</tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </section>`;
  }

  function aanvragenBlok() {
    if (state.rechten.aanvragen === false) return geweigerdBlok(tR("rsp.myRequests", "Mijn aanvragen"));
    const rijen = state.aanvragen || [];
    const body = rijen.length
      ? rijen.map(rij => `<tr>
          <td class="rsp-client">${esc((rij.endCustomer && rij.endCustomer.legalName) || "-")}</td>
          <td><span class="rsp-plan">${esc((rij.package && rij.package.plan) || "-")}</span></td>
          <td>${statusLabel(rij.status)}</td>
          <td>${esc(datum(rij.createdAt))}</td>
        </tr>`).join("")
      : `<tr><td colspan="4" class="rsp-empty">${esc(tR("rsp.noRequests", "Nog geen aanvragen ingediend."))}</td></tr>`;
    return `
      <section class="rsp-card">
        <div class="rsp-card-head">
          <div><span>${esc(tR("rsp.myRequests", "Mijn aanvragen"))}</span><small>${esc(tR("rsp.requestNote", "Je dient een aanvraag in. Monargo beoordeelt ze en bevestigt bij de klant voor de tenant wordt aangemaakt."))}</small></div>
          <span class="rsp-count">${esc(String(rijen.length))}</span>
        </div>
        <div class="rsp-table-wrap">
          <table class="rsp-table">
            <thead><tr><th>${esc(tR("adm.thCustomer", "Klant"))}</th><th>${esc(tR("rsp.plan", "Plan"))}</th><th>${esc(tR("adm.status", "Status"))}</th><th>${esc(tR("rsp.thRequested", "Aangevraagd"))}</th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </section>`;
  }

  function paginaHtml() {
    return `
      ${paginaKop()}
      ${klantenBlok()}
      ${aanvragenBlok()}
      <p class="rsp-hint">${esc(tR("rsp.requestViaMenu", "Een nieuwe klant aanbrengen doe je via 'Nieuwe klant' in het menu."))}</p>
      <p class="rsp-hint">${esc(tR("rsp.privacyText", "Je ziet geen operationele klant- of personeelsgegevens."))}</p>`;
  }

  // ── Gedelegeerde toegang ophalen · uitsluitend voor één tenant tegelijk ─────
  // De server bepaalt of dit mag; een weigering wordt de generieke melding.
  async function meetToegang(tenantId) {
    state.toegang[tenantId] = { staat: "laden" };
    try {
      const data = await api("GET", `/api/reseller/delegated-access?tenantId=${encodeURIComponent(tenantId)}`);
      const nu = Date.now();
      // Alleen een grant die NU echt loopt telt · de veilige kant is dicht.
      const actief = (data.grants || []).find(grant => grant
        && grant.status === "active"
        && !grant.revokedAt
        && (!grant.startAt || Date.parse(grant.startAt) <= nu)
        && (!grant.endAt || Date.parse(grant.endAt) > nu));
      state.toegang[tenantId] = actief
        ? { staat: "actief", tot: actief.endAt || null, scope: actief.scope || [] }
        : { staat: "geen" };
    } catch (fout) {
      state.toegang[tenantId] = { staat: fout.status === 403 ? "geweigerd" : "geen" };
    }
    teken();
  }

  function bind(el) {
    el.querySelectorAll("[data-rspk-tenant]").forEach(knop => {
      knop.addEventListener("click", () => {
        const tenantId = knop.getAttribute("data-rspk-tenant");
        if (state.open === tenantId) { state.open = null; teken(); return; }
        state.open = tenantId;
        teken();
        if (!state.toegang[tenantId]) meetToegang(tenantId);
      });
    });
    const opnieuw = el.querySelector("[data-rspk-retry]");
    if (opnieuw) {
      opnieuw.addEventListener("click", () => {
        state.klanten = null; state.toegewezen = null; state.aanvragen = null;
        teken();
      });
    }
  }

  function foutHtml(fout) {
    // Bij een weigering nooit het serverbericht, nooit een id, nooit een code.
    const bericht = fout && fout.status === 403 ? weigering() : (fout && fout.message) || "";
    return `<section class="rsp-error">
      <strong>${esc(tR("rsp.couldNotLoad", "De partnerwerkruimte kon niet laden."))}</strong>
      <p>${esc(bericht)}</p>
      <button type="button" class="rsp-btn" data-rspk-retry>${esc(tR("rsp.retry", "Opnieuw proberen"))}</button>
    </section>`;
  }

  async function teken() {
    const el = houder;
    if (!el) return;
    // Komt er een tekenverzoek binnen terwijl we al tekenen (de toegangsmeting
    // landt later dan de lijst), dan gaat dat verzoek niet verloren maar
    // volgt het meteen na deze ronde.
    if (state.laden) { state.opnieuw = true; return; }
    state.laden = true;
    el.setAttribute("aria-busy", "true");
    // Alleen de eerste keer (of na een herlaadverzoek) een laadscherm: bij het
    // open- en dichtklappen van een detail staat de data er al en zou een
    // spinner alleen maar knipperen.
    if (!state.klanten) {
      el.innerHTML = `<div class="rsp-loading"><span class="adm-spinner"></span>${esc(tR("adm.loading", "Laden..."))}</div>`;
    }
    try {
      await laadData(false);
      el.innerHTML = paginaHtml();
    } catch (fout) {
      el.innerHTML = foutHtml(fout);
    } finally {
      state.laden = false;
      el.removeAttribute("aria-busy");
      bind(el);
      if (state.opnieuw) { state.opnieuw = false; teken(); }
    }
  }

  /** Teken de pagina in een element of in het element met dat id. */
  function render(container) {
    const el = typeof container === "string"
      ? (typeof document !== "undefined" ? document.getElementById(container) : null)
      : container;
    if (!el) return Promise.resolve();
    houder = el;
    return teken();
  }

  // ── Registratie ───────────────────────────────────────────────────────────
  // Additief in het paginaregister van het portaal, idempotent aangemaakt: de
  // laadvolgorde van de pagina's speelt geen rol en niemand veegt een andere
  // registratie weg. Deze module LEEST window.wfpCore en definieert de gedeelde
  // kern noch de portaalstate van reseller.js opnieuw.
  const pages = window.wfpResellerPages = window.wfpResellerPages || {};
  pages[PAGE_ID] = {
    id: PAGE_ID,
    view: PAGE_ID,
    label: () => tR("rsp.clientsTenantsTitle", "Klanten en tenantaanvragen"),
    icoon: "◉",
    meta,
    render
  };
}());
