// Resellerportaal · pagina "Gedelegeerde toegang" (h23.12 · CTO3-09).
//
// Drie regels bepalen alles op deze pagina:
//
//  1. Een reseller ziet UITSLUITEND zijn eigen organisatie. De server leidt die
//     af uit de sessie · deze pagina stuurt nooit een organisatie-id mee. De
//     backend weigert een expliciete vreemde organisatie hard (ISO-03), dus een
//     UI die er toch een meestuurt maakt het probleem alleen onzichtbaar.
//  2. Klantinhoud vereist een ACTIEVE gedelegeerde toegang. Zonder zo'n
//     toestemming toont de pagina de commerciële metadata en niets meer. Er
//     bestaat vandaag ook geen route die klantinhoud ontsluit (zie de TODO bij
//     assertContentAccess in src/modules/reseller-tenants.js) · deze pagina doet
//     dus geen enkele poging om die te tonen.
//  3. Een weigering is generiek. Nooit een record-id, nooit "bestaat niet":
//     dat maakt van een foutmelding een bestaans-oracle waarmee je ids kunt
//     aftasten. De server doet dat aan zijn kant al (generieke 403, 404 bij
//     vreemde records) · de UI mag het niet alsnog verklappen.
//
// De pagina is bewust zelfstandig. reseller.js houdt zijn state, api() en
// foutafhandeling in een eigen closure, dus die zijn hier niet te lenen. Het
// PATROON is wel hetzelfde (één state-object, één api(), één foutpad), zodat
// beide bestanden er hetzelfde uitzien en later samen te voegen zijn.
(function () {
  "use strict";

  const VIEW = "delegated-access";

  // ── Gedeelde helpers · zelfde patroon als reseller.js ──────────────────────
  const token = () => window.wfpCore.token();
  const esc = value => window.wfpCore.esc(value == null ? "" : String(value));
  const tR = (key, fallback) => (window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback);
  const locale = () => ({ nl: "nl-BE", fr: "fr-BE", en: "en-GB" }[window.wfpI18n && window.wfpI18n.lang] || "nl-BE");

  // Scopes van een delegatie (DELEGATED_SCOPES in src/modules/reseller-tenants.js).
  // De server publiceert deze lijst nergens, dus staat ze hier. Wijkt ze af, dan
  // weigert de server de aanvraag met een veldfout · de gebruiker ziet die.
  const SCOPES = [
    { key: "onboarding_view", cat: "support" },
    { key: "onboarding_tasks", cat: "support" },
    { key: "ticket_view", cat: "support" },
    { key: "ticket_create", cat: "support" },
    { key: "config_write", cat: "admin" },
    { key: "user_admin", cat: "admin" },
    { key: "data_export", cat: "admin" }
  ];

  // Eigen paginastate. Dit is NIET de state van reseller.js · die blijft van
  // reseller.js. Hier staat alleen wat deze pagina zelf ophaalt.
  const state = {
    tenants: null,      // toegewezen klanten (actieve koppeling + commerciële metadata)
    commercie: null,    // rijen uit /api/reseller/clients · bedragen, uitsluitend om te tonen
    tenantId: null,     // de gekozen klant
    grants: null,       // delegatierecords van de gekozen klant
    rechten: { aanvragen: null, intrekken: null }, // null = de server heeft niets gezegd
    intrekken: null,    // id van het record waarvoor de intrek-bevestiging openstaat
    melding: null,      // { soort, tekst } onder het formulier
    geweigerd: false,   // de server weigerde deze pagina · generieke melding
    laden: false
  };

  let _container = null;

  // ── Opmaak ────────────────────────────────────────────────────────────────

  function eur(value) {
    return new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR" }).format(Number(value) || 0);
  }

  function date(value) {
    if (!value) return tR("rsp.notAvailable", "Niet beschikbaar");
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return tR("rsp.notAvailable", "Niet beschikbaar");
    return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", year: "numeric" }).format(parsed);
  }

  /**
   * Statuspil van een delegatie. De statussen komen van de server
   * (requested → tenant_approved → active → expired/revoked); de kleurklasse
   * hergebruikt de bestaande rsp-status-varianten zodat er geen CSS bij hoeft.
   */
  function statusPil(value) {
    const key = String(value || "requested");
    const labels = {
      requested: tR("rsp.dlg.stRequested", "Aangevraagd"),
      tenant_approved: tR("rsp.dlg.stApproved", "Goedgekeurd door klant"),
      active: tR("rsp.dlg.stActive", "Actief"),
      expired: tR("rsp.dlg.stExpired", "Verlopen"),
      revoked: tR("rsp.dlg.stRevoked", "Ingetrokken")
    };
    const kleur = {
      requested: "pending-approval",
      tenant_approved: "approved",
      active: "active",
      expired: "cancelled",
      revoked: "cancelled"
    }[key] || "pending-approval";
    return `<span class="rsp-status rsp-status-${esc(kleur)}">${esc(labels[key] || key)}</span>`;
  }

  function scopeLabel(key) {
    return tR("rsp.dlg.scope." + key, {
      onboarding_view: "Onboarding inzien",
      onboarding_tasks: "Onboardingtaken uitvoeren",
      ticket_view: "Supportvragen inzien",
      ticket_create: "Supportvraag aanmaken",
      config_write: "Configuratie aanpassen",
      user_admin: "Gebruikersbeheer",
      data_export: "Gegevens exporteren"
    }[key] || key);
  }

  // ── Netwerk en foutafhandeling ────────────────────────────────────────────

  /**
   * Alles wat op een record-id lijkt uit een servertekst halen. De backend is
   * netjes generiek, maar een toekomstige melding hoeft dat niet te zijn · deze
   * zeef staat er zodat een id nooit per ongeluk het scherm haalt.
   */
  function zonderId(tekst) {
    return String(tekst == null ? "" : tekst)
      .replace(/\b[a-z][a-z0-9]{1,7}_[A-Za-z0-9-]{6,}\b/g, "")
      .replace(/\b[0-9a-f]{16,}\b/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  /**
   * Eén generieke weigering voor 403 én 404. Bewust dezelfde tekst: de backend
   * antwoordt met 404 op records van een andere organisatie juist om ids
   * onvindbaar te maken. Een UI die "niet gevonden" zegt en elders "geen
   * toegang", geeft dat verschil alsnog weg.
   */
  function generiekeWeigering() {
    return tR("rsp.dlg.denied", "Je hebt hier geen toegang toe. Neem contact op met Monargo als je denkt dat dit niet klopt.");
  }

  function foutTekst(status, data) {
    if (status === 401) return tR("rsp.sessionExpired", "Sessie verlopen");
    // MFA_REQUIRED gaat over de gebruiker, niet over een record: de server
    // gooit hem voor elke record-lookup. Deze melding verraadt dus niets over
    // het bestaan van iets · en zonder die uitleg blijft de gebruiker steken.
    if (status === 403 && data && data.code === "MFA_REQUIRED") {
      return tR("rsp.dlg.mfa", "Sterke authenticatie (MFA) is verplicht voor gedelegeerde toegang. Zet MFA aan in je profiel en probeer opnieuw.");
    }
    if (status === 403 || status === 404) return generiekeWeigering();
    if (status === 409) return tR("rsp.dlg.conflict", "De status is intussen gewijzigd. Vernieuw de pagina.");
    if (status === 400) {
      const server = zonderId(data && data.error);
      return server || tR("rsp.dlg.invalid", "De aanvraag is niet volledig ingevuld.");
    }
    return `${tR("rsp.error", "Fout")} ${status}`;
  }

  function fout(status, data) {
    const error = new Error(foutTekst(status, data));
    error.status = status;
    error.code = (data && data.code) || null;
    // Veldfouten komen van de validatie en bevatten geen ids · toch door de zeef.
    error.fieldErrors = (data && data.fieldErrors) || null;
    return error;
  }

  async function api(method, path, body) {
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      localStorage.removeItem("wfp_token");
      if (window.WorkFlowProPlatformRouter) window.WorkFlowProPlatformRouter.showLogin();
      throw fout(401, data);
    }
    if (!response.ok) throw fout(response.status, data);
    return data;
  }

  /**
   * Rechten komen van de server, nooit uit de UI. Deze endpoints sturen vandaag
   * geen rechtenblok mee; dan blijft de stand "onbekend" en laat de pagina de
   * server beslissen. Zegt de server één keer nee (403), dan verdwijnt de actie
   * en komt ze in deze sessie niet terug. De UI verzint dus nooit een recht,
   * ze onthoudt hooguit een weigering.
   */
  function leesRechten(payload) {
    const blok = payload && (payload.rights || payload.can);
    if (!blok) return;
    if (typeof blok.request === "boolean") state.rechten.aanvragen = blok.request;
    if (typeof blok.revoke === "boolean") state.rechten.intrekken = blok.revoke;
  }

  // ── Data laden ────────────────────────────────────────────────────────────

  async function laadBasis(force) {
    if (!force && state.tenants && state.commercie) return;
    // Geen organisatie-id in de query: de server leest de organisatie uit de
    // sessie. Een expliciete parameter zou hier hoe dan ook geweigerd worden.
    const [toegewezen, klanten] = await Promise.all([
      api("GET", "/api/reseller/assigned-tenants"),
      api("GET", "/api/reseller/clients").catch(() => ({ rows: [] }))
    ]);
    leesRechten(toegewezen);
    state.tenants = (toegewezen.tenants || []).filter(rij => rij && rij.tenantId);
    state.commercie = klanten.rows || [];
    if (!state.tenantId && state.tenants.length) state.tenantId = state.tenants[0].tenantId;
    if (state.tenantId && !state.tenants.some(rij => rij.tenantId === state.tenantId)) {
      state.tenantId = state.tenants.length ? state.tenants[0].tenantId : null;
    }
  }

  async function laadGrants(tenantId) {
    if (!tenantId) { state.grants = []; return; }
    const data = await api("GET", "/api/reseller/delegated-access?tenantId=" + encodeURIComponent(tenantId));
    leesRechten(data);
    state.grants = data.grants || [];
  }

  // ── Afgeleiden ────────────────────────────────────────────────────────────

  function gekozenTenant() {
    return (state.tenants || []).find(rij => rij.tenantId === state.tenantId) || null;
  }

  function commercieVan(tenantId) {
    return (state.commercie || []).find(rij => rij.tenantId === tenantId) || null;
  }

  /**
   * Is er NU een toestemming die klantinhoud ontsluit? Uitsluitend op basis van
   * wat de server stuurt (status + venster). De echte poort blijft de server:
   * dit is een leesbare weergave, geen toegangsbeslissing.
   */
  function actieveGrant() {
    const nu = Date.now();
    return (state.grants || []).find(g => {
      if (!g || g.status !== "active") return false;
      const start = g.startAt || g.startDate;
      const eind = g.endAt || g.endDate;
      if (start && !(Date.parse(start) <= nu)) return false;
      if (eind && !(Date.parse(eind) > nu)) return false;
      return true;
    }) || null;
  }

  function terminaal(grant) {
    return grant && (grant.status === "revoked" || grant.status === "expired");
  }

  // ── Weergave ──────────────────────────────────────────────────────────────

  function titel() {
    return tR("rsp.dlg.title", "Gedelegeerde toegang");
  }

  function pageHead() {
    return `
      <header class="rsp-page-head">
        <div>
          <span class="rsp-page-eyebrow">${esc(tR("rsp.dlg.eyebrow", "Klanttoegang"))}</span>
          <h1>${esc(titel())}</h1>
          <p>${esc(tR("rsp.dlg.intro", "Vraag tijdelijke toegang tot een klantomgeving aan, volg de status en doe er zelf weer afstand van. Zonder actieve toestemming zie je uitsluitend commerciële gegevens."))}</p>
        </div>
      </header>`;
  }

  function laadHtml() {
    return `<div class="rsp-loading"><span class="adm-spinner"></span>${esc(tR("adm.loading", "Laden..."))}</div>`;
  }

  /** Generieke weigering · geen id, geen reden, geen bestaans-oracle. */
  function weigeringHtml() {
    return `
      ${pageHead()}
      <section class="rsp-card">
        <div class="rsp-card-body">
          <div class="rsp-empty-state">
            <strong>${esc(generiekeWeigering())}</strong>
            <span>${esc(tR("rsp.dlg.deniedHint", "Gedelegeerde toegang loopt via een aanvraag die de klant zelf goedkeurt."))}</span>
          </div>
        </div>
      </section>`;
  }

  function tenantKiezerHtml() {
    const opties = (state.tenants || []).map(rij => {
      const naam = (rij.tenant && rij.tenant.name) || rij.tenantId;
      const gekozen = rij.tenantId === state.tenantId ? " selected" : "";
      return `<option value="${esc(rij.tenantId)}"${gekozen}>${esc(naam)}</option>`;
    }).join("");
    return `
      <section class="rsp-card">
        <div class="rsp-card-head">
          <div><span>${esc(tR("rsp.dlg.pickClient", "Klant kiezen"))}</span><small>${esc(tR("rsp.dlg.pickClientText", "Alleen klanten met een actieve koppeling aan jouw partneraccount."))}</small></div>
          <span class="rsp-count">${esc(String((state.tenants || []).length))}</span>
        </div>
        <div class="rsp-card-body rsp-form">
          <label><span>${esc(tR("rsp.client", "Klant"))}</span><select id="rsdTenant">${opties}</select></label>
        </div>
      </section>`;
  }

  /**
   * Commerciële metadata · bewust read-only. Bedragen tonen betekent niet dat
   * je ze mag wijzigen: prijzen en commissie veranderen loopt via een
   * licentie- of prijsaanvraag die Monargo beoordeelt, niet via dit scherm.
   */
  function metadataHtml() {
    const rij = gekozenTenant();
    if (!rij) return "";
    const t = rij.tenant || {};
    const geld = commercieVan(rij.tenantId);
    const regels = [
      [tR("rsp.plan", "Plan"), t.plan || "-"],
      [tR("adm.status", "Status"), t.status || "-"],
      [tR("rsp.dlg.seats", "Gebruikersplaatsen"), t.seats == null ? "-" : String(t.seats)],
      [tR("rsp.language", "Taal"), t.language || "-"],
      [tR("rsp.billing", "Facturatie"), t.billingOwnership || "-"],
      [tR("rsp.dlg.renewal", "Verlenging"), t.renewal ? date(t.renewal) : "-"],
      [tR("rsp.dlg.linkedSince", "Gekoppeld sinds"), rij.startAt ? date(rij.startAt) : "-"],
      ["MRR", geld ? (geld.unpriced ? tR("rsp.onRequest", "Op aanvraag") : eur(geld.mrr)) : "-"],
      [tR("rsp.commissionMo", "Per maand"), geld ? eur(geld.commission) : "-"]
    ];
    return `
      <section class="rsp-card">
        <div class="rsp-card-head">
          <div><span>${esc(tR("rsp.dlg.commercial", "Commerciële gegevens"))}</span><small>${esc(tR("rsp.commercialOnly", "Uitsluitend commerciële gegevens"))}</small></div>
        </div>
        <div class="rsp-table-wrap">
          <table class="rsp-table">
            <tbody>${regels.map(([label, waarde]) => `<tr><td>${esc(label)}</td><td><strong>${esc(waarde)}</strong></td></tr>`).join("")}</tbody>
          </table>
        </div>
      </section>`;
  }

  /** De toegangsstand in mensentaal · en wat er zonder toestemming NIET gebeurt. */
  function toegangHtml() {
    const grant = actieveGrant();
    if (!grant) {
      return `
        <section class="rsp-card">
          <div class="rsp-card-body">
            <div class="rsp-empty-state">
              <strong>${esc(tR("rsp.dlg.noAccess", "Geen actieve toegang tot deze klantomgeving"))}</strong>
              <span>${esc(tR("rsp.dlg.noAccessText", "Je ziet de commerciële gegevens hierboven en niets meer. Klantgegevens worden pas zichtbaar zodra de klant een aanvraag goedkeurt."))}</span>
            </div>
          </div>
        </section>`;
    }
    const scopes = (grant.scope || []).map(s => esc(scopeLabel(s))).join(" · ");
    const eind = grant.endAt || grant.endDate;
    return `
      <section class="rsp-card">
        <div class="rsp-card-head">
          <div><span>${esc(tR("rsp.dlg.activeAccess", "Toegang actief"))}</span><small>${esc(tR("rsp.dlg.activeUntil", "Loopt tot {date}").replace("{date}", date(eind)))}</small></div>
          ${statusPil(grant.status)}
        </div>
        <div class="rsp-card-body">
          <p>${scopes || esc(tR("rsp.dlg.noScope", "Geen bevoegdheden vastgelegd"))}</p>
          <p><small>${esc(tR("rsp.dlg.auditNote", "Elke handeling onder deze toegang wordt op jouw naam geregistreerd bij de klant."))}</small></p>
        </div>
      </section>`;
  }

  function grantRijen() {
    const rijen = state.grants || [];
    if (!rijen.length) {
      return `<tr><td colspan="6" class="rsp-empty">${esc(tR("rsp.dlg.noGrants", "Nog geen aanvragen voor deze klant."))}</td></tr>`;
    }
    return rijen.map(grant => {
      const start = grant.startAt || grant.startDate;
      const eind = grant.endAt || grant.endDate;
      const magIntrekken = !terminaal(grant) && state.rechten.intrekken !== false;
      const actie = magIntrekken
        ? `<button type="button" class="rsp-btn rsd-revoke" data-id="${esc(grant.id)}">${esc(tR("rsp.dlg.revoke", "Toegang intrekken"))}</button>`
        : "-";
      return `<tr>
        <td>${statusPil(grant.status)}</td>
        <td>${(grant.scope || []).map(s => esc(scopeLabel(s))).join("<br>") || "-"}</td>
        <td>${esc(date(start))}</td>
        <td>${esc(date(eind))}</td>
        <td>${esc(grant.reason || "-")}</td>
        <td>${actie}</td>
      </tr>`;
    }).join("");
  }

  function grantsHtml() {
    return `
      <section class="rsp-card">
        <div class="rsp-card-head">
          <div><span>${esc(tR("rsp.dlg.history", "Aanvragen en toestemmingen"))}</span><small>${esc(tR("rsp.dlg.historyText", "De klant keurt goed · jij kunt altijd zelf afstand doen."))}</small></div>
          <span class="rsp-count">${esc(String((state.grants || []).length))}</span>
        </div>
        <div class="rsp-table-wrap">
          <table class="rsp-table">
            <thead><tr>
              <th>${esc(tR("adm.status", "Status"))}</th>
              <th>${esc(tR("rsp.dlg.scopes", "Bevoegdheden"))}</th>
              <th>${esc(tR("rsp.dlg.from", "Van"))}</th>
              <th>${esc(tR("rsp.dlg.until", "Tot"))}</th>
              <th>${esc(tR("rsp.dlg.reason", "Reden"))}</th>
              <th>${esc(tR("adm.actions", "Acties"))}</th>
            </tr></thead>
            <tbody>${grantRijen()}</tbody>
          </table>
        </div>
        ${state.intrekken ? intrekBevestigingHtml() : ""}
      </section>`;
  }

  /** Intrekken vraagt een reden · zonder reden weigert de server terecht. */
  function intrekBevestigingHtml() {
    const rij = gekozenTenant();
    const naam = (rij && rij.tenant && rij.tenant.name) || tR("rsp.client", "Klant");
    return `
      <div class="rsp-card-body rsp-form">
        <div class="rsp-span2 rsp-form-note"><span aria-hidden="true">i</span><p>${esc(tR("rsp.dlg.revokeIntro", "Je doet afstand van je eigen toegang tot {name}. Dit werkt meteen en is niet terug te draaien.").replace("{name}", naam))}</p></div>
        <label class="rsp-span2"><span>${esc(tR("rsp.dlg.reason", "Reden"))}</span><input id="rsdRevokeReason" placeholder="${esc(tR("rsp.dlg.reasonPh", "Waarom trek je de toegang in?"))}"></label>
        <div class="rsp-span2 rsp-form-actions">
          <button type="button" class="rsp-btn rsp-btn-primary" id="rsdRevokeConfirm">${esc(tR("rsp.dlg.revokeConfirm", "Toegang intrekken"))}</button>
          <button type="button" class="rsp-btn" id="rsdRevokeCancel">${esc(tR("adm.cancel", "Annuleren"))}</button>
        </div>
      </div>`;
  }

  function scopeVeldenHtml(cat) {
    return SCOPES.filter(s => s.cat === cat).map(s =>
      `<label class="rsd-scope-line"><input type="checkbox" class="rsd-scope" data-id="${esc(s.key)}"> ${esc(scopeLabel(s.key))}</label>`
    ).join("");
  }

  function aanvraagHtml() {
    // De aanvraagactie verdwijnt zodra de server ze weigert (403). Ze verschijnt
    // niet op eigen initiatief van de UI: alleen klanten die de server als
    // toegewezen teruggaf komen hier terecht.
    if (!state.tenantId) return "";
    if (state.rechten.aanvragen === false) {
      return `
      <section class="rsp-card">
        <div class="rsp-card-body">
          <div class="rsp-empty-state">
            <strong>${esc(generiekeWeigering())}</strong>
            <span>${esc(tR("rsp.dlg.requestDeniedHint", "Toegang aanvragen kan niet vanuit dit account."))}</span>
          </div>
        </div>
      </section>`;
    }
    return `
      <section class="rsp-card">
        <div class="rsp-card-head">
          <div><span>${esc(tR("rsp.dlg.request", "Toegang aanvragen"))}</span><small>${esc(tR("rsp.dlg.requestText", "De klant keurt de aanvraag zelf goed. Jij kunt je eigen aanvraag niet goedkeuren."))}</small></div>
        </div>
        <form class="rsp-card-body rsp-form" id="rsdForm">
          <div class="rsp-span2"><strong>${esc(tR("rsp.dlg.catSupport", "Support"))}</strong>${scopeVeldenHtml("support")}</div>
          <div class="rsp-span2"><strong>${esc(tR("rsp.dlg.catAdmin", "Beheer"))}</strong>${scopeVeldenHtml("admin")}</div>
          <label><span>${esc(tR("rsp.dlg.from", "Van"))}</span><input id="rsdStart" type="date"></label>
          <label><span>${esc(tR("rsp.dlg.until", "Tot"))}</span><input id="rsdEnd" type="date" required></label>
          <label class="rsp-span2"><span>${esc(tR("rsp.dlg.reason", "Reden"))}</span><input id="rsdReason" required placeholder="${esc(tR("rsp.dlg.reasonRequestPh", "Waarvoor heb je toegang nodig?"))}"></label>
          <div class="rsp-span2 rsp-form-note"><span aria-hidden="true">i</span><p>${esc(tR("rsp.dlg.endRequired", "Een einddatum is verplicht: toestemming is altijd tijdelijk."))}</p></div>
          <div class="rsp-span2 rsp-form-actions">
            <button class="rsp-btn rsp-btn-primary" type="submit" id="rsdSubmit">${esc(tR("rsp.dlg.requestBtn", "Aanvraag indienen"))}</button>
            <span id="rsdMessage" class="rsp-msg" role="status">${state.melding ? esc(state.melding.tekst) : ""}</span>
          </div>
        </form>
      </section>`;
  }

  function leegHtml() {
    return `
      ${pageHead()}
      <section class="rsp-card">
        <div class="rsp-card-body">
          <div class="rsp-empty-state">
            <strong>${esc(tR("rsp.dlg.noClients", "Nog geen gekoppelde klanten"))}</strong>
            <span>${esc(tR("rsp.dlg.noClientsText", "Gedelegeerde toegang kan alleen voor klanten met een actieve koppeling aan jouw partneraccount."))}</span>
          </div>
        </div>
      </section>`;
  }

  function paginaHtml() {
    if (state.geweigerd) return weigeringHtml();
    if (!(state.tenants || []).length) return leegHtml();
    return `
      ${pageHead()}
      ${tenantKiezerHtml()}
      ${metadataHtml()}
      ${toegangHtml()}
      ${grantsHtml()}
      ${aanvraagHtml()}`;
  }

  function foutHtml(error) {
    return `
      ${pageHead()}
      <section class="rsp-error">
        <strong>${esc(tR("rsp.couldNotLoad", "De partnerwerkruimte kon niet laden."))}</strong>
        <p>${esc(error && error.message ? error.message : generiekeWeigering())}</p>
        <button type="button" class="rsp-btn" id="rsdRetry">${esc(tR("rsp.retry", "Opnieuw proberen"))}</button>
      </section>`;
  }

  // ── Interactie ────────────────────────────────────────────────────────────

  function toon(tekst) {
    const veld = document.getElementById("rsdMessage");
    state.melding = tekst ? { tekst } : null;
    if (veld) veld.textContent = tekst || "";
  }

  function gekozenScopes(container) {
    if (!container || !container.querySelectorAll) return [];
    return [...container.querySelectorAll(".rsd-scope")]
      .filter(vak => vak && vak.checked)
      .map(vak => (vak.dataset && vak.dataset.id) || vak.value)
      .filter(Boolean);
  }

  function waarde(id) {
    const el = document.getElementById(id);
    return el && el.value ? String(el.value).trim() : "";
  }

  async function dienIn(container) {
    const scopes = gekozenScopes(container);
    const reden = waarde("rsdReason");
    const eind = waarde("rsdEnd");
    if (!scopes.length) return toon(tR("rsp.dlg.pickScope", "Kies minstens één bevoegdheid."));
    if (!reden) return toon(tR("rsp.dlg.reasonRequired", "Geef een reden op."));
    if (!eind) return toon(tR("rsp.dlg.endRequired", "Een einddatum is verplicht: toestemming is altijd tijdelijk."));
    const knop = document.getElementById("rsdSubmit");
    if (knop) { knop.disabled = true; knop.textContent = tR("rsp.dlg.requesting", "Aanvraag wordt ingediend..."); }
    toon("");
    try {
      // Geen organisatie-id in de body: de server koppelt de aanvraag aan de
      // organisatie uit de sessie. Meesturen zou cross-organisatie-attributie
      // mogelijk maken zodra iemand de check aan de serverzijde versoepelt.
      await api("POST", "/api/reseller/delegated-access", {
        tenantId: state.tenantId,
        scope: scopes,
        reason: reden,
        startAt: waarde("rsdStart") || null,
        endAt: eind
      });
      if (window.showToast) window.showToast(tR("rsp.dlg.requested", "Aanvraag ingediend. De klant keurt ze goed."), "success");
      state.grants = null;
      await herlaad(container);
    } catch (error) {
      if (error.status === 403) state.rechten.aanvragen = false;
      toon(error.message);
      if (error.status === 403) await herlaad(container);
      const opnieuw = document.getElementById("rsdSubmit");
      if (opnieuw) { opnieuw.disabled = false; opnieuw.textContent = tR("rsp.dlg.requestBtn", "Aanvraag indienen"); }
    }
  }

  async function trekIn(container) {
    const grantId = state.intrekken;
    const reden = waarde("rsdRevokeReason");
    if (!grantId) return;
    if (!reden) return toon(tR("rsp.dlg.reasonRequired", "Geef een reden op."));
    try {
      await api("POST", "/api/reseller/delegated-access/" + encodeURIComponent(grantId) + "/revoke", { reason: reden });
      if (window.showToast) window.showToast(tR("rsp.dlg.revoked", "Toegang ingetrokken."), "success");
      state.intrekken = null;
      state.grants = null;
      await herlaad(container);
    } catch (error) {
      if (error.status === 403) state.rechten.intrekken = false;
      // Ook hier geen id en geen reden-van-bestaan · alleen de generieke tekst.
      if (window.showToast) window.showToast(error.message, "error");
      state.intrekken = null;
      await herlaad(container);
    }
  }

  function bind(container) {
    if (!container) return;
    const kiezer = document.getElementById("rsdTenant");
    if (kiezer) kiezer.addEventListener("change", event => {
      state.tenantId = event && event.target ? event.target.value : kiezer.value;
      state.grants = null;
      state.intrekken = null;
      state.melding = null;
      render(container);
    });

    const formulier = document.getElementById("rsdForm");
    if (formulier) formulier.addEventListener("submit", event => {
      if (event && event.preventDefault) event.preventDefault();
      return dienIn(container);
    });

    if (container.querySelectorAll) {
      [...container.querySelectorAll(".rsd-revoke")].forEach(knop => {
        knop.addEventListener("click", () => {
          state.intrekken = (knop.dataset && knop.dataset.id) || null;
          render(container);
        });
      });
    }

    const bevestig = document.getElementById("rsdRevokeConfirm");
    if (bevestig) bevestig.addEventListener("click", () => trekIn(container));
    const annuleer = document.getElementById("rsdRevokeCancel");
    if (annuleer) annuleer.addEventListener("click", () => {
      state.intrekken = null;
      render(container);
    });

    const opnieuw = document.getElementById("rsdRetry");
    if (opnieuw) opnieuw.addEventListener("click", () => {
      state.tenants = null;
      state.commercie = null;
      state.grants = null;
      state.geweigerd = false;
      render(container);
    });
  }

  async function herlaad(container) {
    state.tenants = null;
    state.commercie = null;
    await render(container);
  }

  // ── Renderen ──────────────────────────────────────────────────────────────

  async function render(container) {
    const doel = container || _container;
    if (!doel || state.laden) return;
    _container = doel;
    state.laden = true;
    doel.setAttribute && doel.setAttribute("aria-busy", "true");
    doel.innerHTML = laadHtml();
    try {
      await laadBasis(false);
      if (state.grants === null) await laadGrants(state.tenantId);
      state.geweigerd = false;
      doel.innerHTML = paginaHtml();
      bind(doel);
    } catch (error) {
      if (error && (error.status === 403 || error.status === 404)) {
        // Geweigerd is een normale uitkomst, geen storing: één generiek scherm
        // zonder id, zonder code, zonder "bestaat niet".
        state.geweigerd = true;
        doel.innerHTML = weigeringHtml();
      } else {
        doel.innerHTML = foutHtml(error);
        bind(doel);
      }
    } finally {
      state.laden = false;
      doel.removeAttribute && doel.removeAttribute("aria-busy");
    }
  }

  // ── Aanhaken op het bestaande portaal ─────────────────────────────────────
  // reseller.js kent geen paginaregistry: switchView kiest uit een vaste map.
  // Deze module wijzigt dat bestand niet · ze plaatst haar navigatie-item bij
  // nadat de shell is opgebouwd, en rendert in dezelfde #rspMain. Klikt de
  // gebruiker daarna op een item van reseller.js, dan neemt switchView het
  // gewoon weer over (die verwijdert de active-stand ook hier).

  function navItemHtml() {
    return `<button type="button" class="rsp-nav-item" data-rsp-view="${VIEW}"><span aria-hidden="true">◧</span>${esc(titel())}</button>`;
  }

  function markeerNav() {
    if (!document.querySelectorAll) return;
    document.querySelectorAll("[data-rsp-view]").forEach(knop => {
      const actief = knop.dataset && knop.dataset.rspView === VIEW;
      if (knop.classList) knop.classList.toggle("active", actief);
      if (actief) knop.setAttribute("aria-current", "page");
      else knop.removeAttribute && knop.removeAttribute("aria-current");
    });
  }

  function open() {
    const main = document.getElementById("rspMain");
    if (!main) return;
    markeerNav();
    const kop = document.getElementById("rspTopTitle");
    if (kop) kop.textContent = titel();
    return render(main);
  }

  function haakAan() {
    try {
      if (!document.querySelector) return false;
      const nav = document.querySelector("#platform-reseller .rsp-nav");
      if (!nav || !nav.insertAdjacentHTML) return false;
      if (nav.querySelector && nav.querySelector('[data-rsp-view="' + VIEW + '"]')) return true;
      nav.insertAdjacentHTML("beforeend", navItemHtml());
      const knop = nav.querySelector && nav.querySelector('[data-rsp-view="' + VIEW + '"]');
      if (knop && knop.addEventListener) knop.addEventListener("click", open);
      return true;
    } catch (_) {
      return false; // liever geen navigatie-item dan een kapot portaal
    }
  }

  /**
   * reseller.js bouwt de shell op via window.wfp_resellerInit (en opnieuw bij
   * een taalwissel). We wikkelen die functie in plaats van ze te vervangen: het
   * origineel blijft leidend, wij plaatsen er alleen ons item achteraan.
   */
  function wikkelInit() {
    const origineel = window.wfp_resellerInit;
    if (typeof origineel !== "function" || origineel.wfpToegangGewikkeld) return false;
    const gewikkeld = function () {
      const uitkomst = origineel.apply(this, arguments);
      haakAan();
      return uitkomst;
    };
    gewikkeld.wfpToegangGewikkeld = true;
    window.wfp_resellerInit = gewikkeld;
    return true;
  }

  // ── Registratie ───────────────────────────────────────────────────────────
  // Idempotent: een bestaande registry wordt gelezen, nooit overschreven.
  const registry = window.wfpResellerViews = window.wfpResellerViews || {};
  registry[VIEW] = { title: titel, render, open, install: haakAan, state };

  wikkelInit();
  haakAan();
  if (document.addEventListener) {
    document.addEventListener("wfp:langchange", () => setTimeout(haakAan, 0));
  }
}());
