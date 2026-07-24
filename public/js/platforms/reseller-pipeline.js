// ── Resellerportaal · pagina "Pipeline & deals" (h23.8 · CTO3-09) ────────────
// Zelfstandige paginamodule bovenop het BESTAANDE portaal
// (public/js/platforms/reseller.js). Dat portaal houdt zijn shell, zijn state
// en zijn api-helper privé; deze pagina registreert zichzelf in een gedeeld
// paginaregister en volgt verder exact hetzelfde patroon: bearer-token uit
// wfpCore, 401 terug naar de login, en een fout die in het scherm landt in
// plaats van in de console.
//
// Grenzen die deze pagina afdwingt (h23 + IA-handover):
//  - de UI stuurt NOOIT een organisatie-id mee. De server leidt de reseller af
//    uit de sessie (23.6 · ISO-03). Een filter op een vreemde organisatie
//    bestaat hier dus niet, ook niet als "handig".
//  - een dealclaim geeft geen recht op klantdata (23.8). De klantverwijzing van
//    een geconverteerde deal (klant-, tenant- en abonnementsreferentie) toont
//    alleen bij een ACTIEVE gedelegeerde toegang (23.12). Alles wat geen
//    bevestigde actieve grant is · geweigerd, verlopen, ingetrokken of
//    onbereikbaar · valt dicht en laat enkel de commerciële metadata staan.
//  - 403 en 404 krijgen dezelfde generieke melding, zonder id en zonder de
//    reden "bestaat niet" (23.15 · anti-probing). De server antwoordt al
//    byte-identiek; de UI mag dat verschil niet alsnog verklappen.
//  - beoordelen, attributie zetten, accepteren en converteren zijn
//    Monargo-acties (reseller.deals.approve). Die knoppen bestaan hier niet:
//    bedragen tonen is niet hetzelfde als bedragen mogen wijzigen.
(function () {
  "use strict";

  // De gedeelde kern levert token/escape. Zonder kern is er geen sessie en
  // schrijft deze module niets · net als een werkruimte zonder wfpAdmin.
  const core = window.wfpCore;
  if (!core) return;

  // Paginaregister van het portaal. Idempotent aanmaken zodat de laadvolgorde
  // van de pagina's geen rol speelt en niemand elkaars registratie wegveegt.
  const pages = window.wfpResellerPages = window.wfpResellerPages || {};

  const esc = value => core.esc(value == null ? "" : String(value));
  const tR = (key, fallback) => (window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback);
  const locale = () => ({ nl: "nl-BE", fr: "fr-BE", en: "en-GB" }[window.wfpI18n && window.wfpI18n.lang] || "nl-BE");

  // Pagina-eigen state. Dit is NIET de portaalstate (clients/ledger/requests):
  // die blijft van reseller.js · twee waarheden over dezelfde data is precies
  // hoe een portaal uit elkaar loopt.
  const page = {
    host: null, boundHost: null, loading: false,
    deals: null, selected: null, denied: false, formOpen: false, busy: false,
    // Mag deze gebruiker registreren? null = onbekend (de server heeft er niets
    // over gezegd), false = de server heeft het geweigerd. Zie mayRegister().
    register: null,
    // Per tenantreferentie: is er een bevestigde ACTIEVE gedelegeerde toegang?
    // Ontbreekt de sleutel, dan is er nog niets bevestigd en blijft alles dicht.
    access: {},
    message: "", messageTone: "error",
  };

  // ── Formattering ───────────────────────────────────────────────────────────
  const LEEG = "-";

  function money(value, currency) {
    if (value == null || value === "") return LEEG;
    const number = Number(value);
    if (!Number.isFinite(number)) return LEEG;
    const code = /^[A-Za-z]{3}$/.test(String(currency || "")) ? String(currency).toUpperCase() : "EUR";
    return new Intl.NumberFormat(locale(), { style: "currency", currency: code }).format(number);
  }

  function date(value) {
    if (!value) return LEEG;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return LEEG;
    return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", year: "numeric" }).format(parsed);
  }

  // Statuslabels van de deal-machine (23.14). Concept deelt de bestaande
  // portaalsleutel; de rest is eigen aan deze pagina.
  function statusLabel(value) {
    const labels = {
      draft: tR("rsp.statusDraft", "Concept"),
      submitted: tR("rsp.dealStatusSubmitted", "Ingediend"),
      under_review: tR("rsp.dealStatusReview", "In beoordeling"),
      accepted: tR("rsp.dealStatusAccepted", "Aanvaard"),
      rejected: tR("rsp.dealStatusRejected", "Afgewezen"),
      converted: tR("rsp.dealStatusConverted", "Omgezet naar klant"),
      expired: tR("rsp.dealStatusExpired", "Vervallen"),
    };
    const key = String(value || "draft");
    return `<span class="rsp-status rsp-status-${esc(key.replace(/_/g, "-"))}">${esc(labels[key] || key)}</span>`;
  }

  function evidenceLabel(type) {
    return {
      email: tR("rsp.evidenceEmail", "E-mail"),
      meeting: tR("rsp.evidenceMeeting", "Afspraak"),
      referral: tR("rsp.evidenceReferral", "Doorverwijzing"),
      document: tR("rsp.evidenceDocument", "Document"),
    }[String(type || "").toLowerCase()] || LEEG;
  }

  // ── Netwerk en foutafhandeling ─────────────────────────────────────────────
  // Zelfde patroon als het portaal: bearer-token uit de gedeelde kern, JSON
  // heen en terug, 401 ruimt de sessie op en gaat naar de login.
  //
  // Het verschil zit in de weigering: 403 en 404 worden EEN fout met een vaste,
  // generieke tekst. De serverboodschap, de foutcode en het gevraagde id komen
  // nooit in het scherm · anders vertelt de UI alsnog of een record bestaat.
  function denied() {
    const error = new Error(tR("rsp.noAccessText", "Je hebt geen toegang tot dit onderdeel. Vraag je partnerbeheerder om toegang."));
    error.denied = true;
    return error;
  }

  async function api(method, path, body) {
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + core.token() },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      localStorage.removeItem("wfp_token");
      if (window.WorkFlowProPlatformRouter) window.WorkFlowProPlatformRouter.showLogin();
      throw new Error(tR("rsp.sessionExpired", "Sessie verlopen"));
    }
    if (response.status === 403 || response.status === 404) throw denied();
    if (!response.ok) throw new Error(data.error || `${tR("rsp.error", "Fout")} ${response.status}`);
    return data;
  }

  // ── Rechten ────────────────────────────────────────────────────────────────
  // De lijstroute stuurt vandaag geen rechtenlijst mee. De UI vult dat NIET in
  // met een eigen rechtentabel (dat zou een tweede waarheid zijn naast
  // reseller-authz): stuurt de server een rechtenlijst mee, dan volgt de UI die;
  // stuurt hij niets, dan blijft het onbekend en toetst de server bij de actie
  // zelf. Een weigering is definitief voor deze sessie: de actie verdwijnt.
  function readRights(payload) {
    const list = payload && (payload.rights || payload.permissions);
    if (!Array.isArray(list)) return;
    page.register = list.indexOf("reseller.deals.create") !== -1;
  }

  function mayRegister() { return page.register !== false; }

  // ── Data laden ─────────────────────────────────────────────────────────────
  // Let op de URL: geen enkele queryparameter over de eigen organisatie. De
  // server leidt de reseller af uit de sessie en weigert een expliciet vreemde
  // organisatie hard · de UI hoort daar niets aan toe te voegen.
  async function load(force) {
    if (!force && page.deals) return;
    const data = await api("GET", "/api/reseller/deals");
    page.deals = Array.isArray(data.deals) ? data.deals : [];
    readRights(data);
  }

  // Is dit een grant die NU geldt? Zelfde vorm als de serverbeslissing
  // (status active + binnen het venster). Fail-closed: alles wat niet
  // aantoonbaar actief is, telt als geen toegang.
  function grantActive(grant, now) {
    const moment = now == null ? Date.now() : now;
    if (!grant || grant.status !== "active") return false;
    if (grant.startDate && !(Date.parse(grant.startDate) <= moment)) return false;
    if (grant.endDate && !(Date.parse(grant.endDate) > moment)) return false;
    return true;
  }

  // Klantinhoud achter een actieve delegatie (23.12). Wordt alleen gevraagd
  // voor een deal die echt geconverteerd is; een weigering of een fout laat de
  // pagina gewoon dicht staan, zonder melding en zonder id.
  async function loadAccess(tenantRef) {
    if (!tenantRef || page.access[tenantRef] !== undefined) return;
    page.access[tenantRef] = false;
    try {
      const data = await api("GET", "/api/reseller/delegated-access?tenantId=" + encodeURIComponent(tenantRef));
      page.access[tenantRef] = (data.grants || []).some(grant => grantActive(grant));
    } catch (_) {
      page.access[tenantRef] = false;
    }
  }

  function customerUnlocked(deal) {
    const ref = deal && deal.conversion && deal.conversion.tenantId;
    return Boolean(ref) && page.access[ref] === true;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  function meta() {
    return {
      eyebrow: tR("rsp.partnerWorkspace", "Partnerwerkruimte"),
      title: tR("rsp.pipeline", "Pipeline & deals"),
      text: tR("rsp.pipelineIntro", "Volg je eigen dealclaims van registratie tot beoordeling. Uitsluitend commerciële gegevens van jouw organisatie."),
    };
  }

  function pageHead(action) {
    const m = meta();
    return `
      <header class="rsp-page-head">
        <div>
          <span class="rsp-page-eyebrow">${esc(m.eyebrow)}</span>
          <h1>${esc(m.title)}</h1>
          <p>${esc(m.text)}</p>
        </div>
        ${action || ""}
      </header>`;
  }

  function metric(label, value, note, tone) {
    return `<article class="rsp-kpi ${tone ? `rsp-kpi-${tone}` : ""}">
      <span class="rsp-kpi-label">${esc(label)}</span>
      <strong class="rsp-kpi-value">${esc(value)}</strong>
      <small class="rsp-kpi-sub">${esc(note || "")}</small>
    </article>`;
  }

  const OPEN_STATUSES = ["draft", "submitted", "under_review", "accepted"];

  // Verwachte waarde per valuta · optellen over valuta's heen zou een verzonnen
  // getal zijn.
  function expectedValue(rows) {
    const perCurrency = {};
    for (const row of rows) {
      const value = Number(row.estimatedValue);
      if (!Number.isFinite(value) || value === 0) continue;
      const code = row.currency || "EUR";
      perCurrency[code] = (perCurrency[code] || 0) + value;
    }
    const codes = Object.keys(perCurrency);
    if (!codes.length) return LEEG;
    return codes.map(code => money(perCurrency[code], code)).join(" · ");
  }

  function denialCard() {
    return `
      ${pageHead("")}
      <section class="rsp-card rsp-denied">
        <div class="rsp-card-body">
          <strong>${esc(tR("rsp.noAccessTitle", "Geen toegang"))}</strong>
          <p>${esc(tR("rsp.noAccessText", "Je hebt geen toegang tot dit onderdeel. Vraag je partnerbeheerder om toegang."))}</p>
        </div>
      </section>`;
  }

  function dealRow(row) {
    const open = OPEN_STATUSES.indexOf(row.status) !== -1;
    return `<tr data-rsp-deal="${esc(row.id)}" class="${page.selected === row.id ? "rsp-row-active" : ""}">
      <td>
        <button type="button" class="rsp-link-btn rsp-client">${esc(row.prospectCompany || LEEG)}</button>
        <small>${esc(row.prospectCountry || LEEG)}</small>
      </td>
      <td>${statusLabel(row.status)}${row.inConflict ? `<small class="rsp-flag">${esc(tR("rsp.dealConflict", "Dubbele claim in beoordeling"))}</small>` : ""}</td>
      <td>${esc(date(row.registeredAt))}</td>
      <td>${esc(open ? date(row.expiryAt) : LEEG)}</td>
      <td>${esc(money(row.estimatedValue, row.currency))}</td>
      <td>${esc(row.attributionPercent == null ? LEEG : `${row.attributionPercent}%`)}</td>
      <td class="rsp-row-actions">${row.status === "draft" && mayRegister()
        ? `<button type="button" class="rsp-link-btn" data-rsp-submit-deal="${esc(row.id)}">${esc(tR("rsp.dealSubmit", "Indienen"))}</button>`
        : ""}</td>
    </tr>`;
  }

  function listCard() {
    const rows = page.deals || [];
    const body = rows.length
      ? rows.map(dealRow).join("")
      : `<tr><td colspan="7" class="rsp-empty">${esc(tR("rsp.noDeals", "Nog geen deals geregistreerd."))}</td></tr>`;
    return `
      <section class="rsp-card">
        <div class="rsp-card-head">
          <div>
            <span>${esc(tR("rsp.dealClaims", "Dealclaims"))}</span>
            <small>${esc(tR("rsp.commercialOnly", "Uitsluitend commerciële gegevens"))}</small>
          </div>
          <span class="rsp-count">${esc(String(rows.length))}</span>
        </div>
        <div class="rsp-table-wrap">
          <table class="rsp-table">
            <thead><tr>
              <th>${esc(tR("rsp.dealProspect", "Prospect"))}</th>
              <th>${esc(tR("adm.status", "Status"))}</th>
              <th>${esc(tR("rsp.dealRegistered", "Geregistreerd"))}</th>
              <th>${esc(tR("rsp.dealExpiry", "Claim vervalt"))}</th>
              <th>${esc(tR("rsp.dealValue", "Waarde"))}</th>
              <th>${esc(tR("rsp.dealAttribution", "Attributie"))}</th>
              <th></th>
            </tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
        <div class="rsp-card-foot">
          <small>${esc(tR("rsp.dealReadOnlyNote", "Bedragen en attributie zijn ter informatie · beoordelen en toekennen gebeurt bij Monargo."))}</small>
        </div>
      </section>`;
  }

  // Detailpaneel · commerciële metadata. De klantverwijzing van een omgezette
  // deal staat er alleen bij een bevestigde actieve gedelegeerde toegang.
  function detailCard() {
    const deal = (page.deals || []).find(row => row.id === page.selected);
    if (!deal) {
      return `<section class="rsp-card"><div class="rsp-card-body"><div class="rsp-empty-state">
        <strong>${esc(tR("rsp.dealPickTitle", "Kies een deal"))}</strong>
        <span>${esc(tR("rsp.dealPickText", "Selecteer een rij om de commerciële details te zien."))}</span>
      </div></div></section>`;
    }
    const evidence = deal.sourceEvidence || {};
    const rows = [
      [tR("rsp.companyName", "Bedrijfsnaam"), deal.prospectCompany || LEEG],
      [tR("rsp.country", "Land"), deal.prospectCountry || LEEG],
      [tR("rsp.vat", "Ondernemings-/BTW-nummer"), deal.enterpriseOrVatNumber || LEEG],
      [tR("rsp.dealValue", "Waarde"), money(deal.estimatedValue, deal.currency)],
      [tR("rsp.dealRegistered", "Geregistreerd"), date(deal.registeredAt)],
      [tR("rsp.dealExpiry", "Claim vervalt"), date(deal.expiryAt)],
      [tR("rsp.dealEvidence", "Bewijs"), `${evidenceLabel(evidence.type)} · ${evidence.reference || LEEG}`],
      [tR("rsp.dealAttribution", "Attributie"), deal.attributionPercent == null ? LEEG : `${deal.attributionPercent}%`],
    ];
    if (deal.status === "rejected") {
      rows.push([tR("rsp.dealRejection", "Reden van afwijzing"), deal.rejectionReason || LEEG]);
    }
    const unlocked = customerUnlocked(deal);
    const conversion = deal.conversion || {};
    const customerBlock = deal.status !== "converted"
      ? ""
      : unlocked
        ? `<div class="rsp-detail-block">
             <strong>${esc(tR("rsp.customerAccess", "Klantomgeving toegankelijk"))}</strong>
             <dl class="rsp-detail-list">
               <div><dt>${esc(tR("rsp.client", "Klant"))}</dt><dd>${esc(conversion.customerId || LEEG)}</dd></div>
               <div><dt>${esc(tR("rsp.dealTenant", "Klantomgeving"))}</dt><dd>${esc(conversion.tenantId || LEEG)}</dd></div>
               <div><dt>${esc(tR("rsp.dealSubscription", "Abonnement"))}</dt><dd>${esc(conversion.subscriptionId || LEEG)}</dd></div>
             </dl>
           </div>`
        : `<div class="rsp-detail-block rsp-locked">
             <strong>${esc(tR("rsp.customerLocked", "Klantinhoud is afgeschermd"))}</strong>
             <p>${esc(tR("rsp.customerLockedText", "Een dealclaim geeft geen toegang tot de klantomgeving. Dat vraagt een actieve gedelegeerde toegang met toestemming van de klant."))}</p>
           </div>`;
    return `
      <section class="rsp-card">
        <div class="rsp-card-head">
          <div><span>${esc(tR("rsp.dealDetail", "Dealdetail"))}</span><small>${esc(tR("rsp.commercialOnly", "Uitsluitend commerciële gegevens"))}</small></div>
          ${statusLabel(deal.status)}
        </div>
        <div class="rsp-card-body">
          <dl class="rsp-detail-list">
            ${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}
          </dl>
          ${customerBlock}
        </div>
      </section>`;
  }

  function formCard() {
    if (!page.formOpen || !mayRegister()) return "";
    return `
      <section class="rsp-card">
        <div class="rsp-card-head"><div><span>${esc(tR("rsp.newDeal", "Deal registreren"))}</span><small>${esc(tR("rsp.newDealText", "Leg je claim vast met gestructureerd bewijs."))}</small></div></div>
        <form class="rsp-card-body rsp-form" id="rspPipelineForm">
          <label><span>${esc(tR("rsp.companyName", "Bedrijfsnaam"))}</span><input name="prospectCompany" required autocomplete="organization" placeholder="${esc(tR("rsp.clientCompanyPh", "Bedrijfsnaam klant"))}"></label>
          <label><span>${esc(tR("rsp.country", "Land"))}</span><input name="country" required value="BE" placeholder="${esc(tR("rsp.countryPh", "BE"))}"></label>
          <label><span>${esc(tR("rsp.vat", "Ondernemings-/BTW-nummer"))}</span><input name="enterpriseOrVatNumber" placeholder="${esc(tR("rsp.vatPh", "BE0123456789"))}"></label>
          <label><span>${esc(tR("rsp.dealValue", "Waarde"))}</span><input name="estimatedValue" type="number" min="0" step="0.01" placeholder="0"></label>
          <label><span>${esc(tR("rsp.currency", "Valuta"))}</span><select name="currency"><option value="EUR" selected>EUR</option><option value="USD">USD</option><option value="GBP">GBP</option></select></label>
          <label><span>${esc(tR("rsp.evidenceType", "Soort bewijs"))}</span><select name="evidenceType">
            <option value="email">${esc(evidenceLabel("email"))}</option>
            <option value="meeting">${esc(evidenceLabel("meeting"))}</option>
            <option value="referral">${esc(evidenceLabel("referral"))}</option>
            <option value="document">${esc(evidenceLabel("document"))}</option>
          </select></label>
          <label class="rsp-span2"><span>${esc(tR("rsp.evidenceReference", "Referentie van het bewijs"))}</span><input name="evidenceReference" required placeholder="${esc(tR("rsp.evidenceReferencePh", "Mail-id, verslag of documentreferentie"))}"></label>
          <div class="rsp-span2 rsp-form-note"><span aria-hidden="true">i</span><p>${esc(tR("rsp.dealClaimNote", "Een claim geldt beperkt in de tijd en geeft geen toegang tot klantgegevens. Monargo beoordeelt de claim."))}</p></div>
          <div class="rsp-span2 rsp-form-actions">
            <button class="rsp-btn rsp-btn-primary" type="submit">${esc(tR("rsp.dealRegisterBtn", "Claim registreren"))}</button>
            <span id="rspPipelineMessage" class="rsp-msg" role="status">${esc(page.message)}</span>
          </div>
        </form>
      </section>`;
  }

  function render() {
    if (page.denied) return denialCard();
    const rows = page.deals || [];
    const open = rows.filter(row => OPEN_STATUSES.indexOf(row.status) !== -1);
    const action = mayRegister()
      ? `<button type="button" class="rsp-btn rsp-btn-primary" id="rspPipelineNew">${esc(tR("rsp.newDeal", "Deal registreren"))}</button>`
      : "";
    return `
      ${pageHead(action)}
      <section class="rsp-kpis rsp-kpis-three">
        ${metric(tR("rsp.dealTotal", "Geregistreerde deals"), String(rows.length), tR("rsp.dealTotalNote", "eigen claims"), "blue")}
        ${metric(tR("rsp.dealOpen", "Lopende claims"), String(open.length), tR("rsp.dealOpenNote", "nog in de trechter"), "violet")}
        ${metric(tR("rsp.dealValueTotal", "Verwachte waarde"), expectedValue(open), tR("rsp.dealValueNote", "opgave bij registratie"), "green")}
      </section>
      ${page.message && !page.formOpen ? `<div class="rsp-msg rsp-msg-${esc(page.messageTone)}" role="status">${esc(page.message)}</div>` : ""}
      ${formCard()}
      <div class="rsp-dashboard-grid">
        ${listCard()}
        ${detailCard()}
      </div>`;
  }

  // ── Interactie ─────────────────────────────────────────────────────────────
  function paint() {
    if (!page.host) return;
    page.host.innerHTML = render();
    bind(page.host);
  }

  async function select(dealId) {
    page.selected = dealId;
    const deal = (page.deals || []).find(row => row.id === dealId);
    paint();
    // Klantinhoud pas na een bevestigde actieve delegatie · daarom eerst
    // schilderen (vergrendeld) en dan pas navragen.
    if (deal && deal.status === "converted" && deal.conversion && deal.conversion.tenantId) {
      await loadAccess(deal.conversion.tenantId);
      if (page.selected === dealId) paint();
    }
  }

  async function submitDraft(dealId) {
    if (page.busy) return;
    const deal = (page.deals || []).find(row => row.id === dealId);
    if (!deal) return;
    page.busy = true;
    try {
      await api("POST", `/api/reseller/deals/${encodeURIComponent(dealId)}/transition`, {
        to: "submitted",
        expectedVersion: deal.version == null ? null : deal.version,
      });
      page.message = tR("rsp.dealSubmittedToast", "Claim ingediend.");
      page.messageTone = "success";
      await load(true);
    } catch (error) {
      // Een weigering zegt niets over het record · generieke tekst, geen id.
      if (error.denied) page.register = false;
      page.message = error.message;
      page.messageTone = "error";
    } finally {
      page.busy = false;
      paint();
    }
  }

  async function registerDeal(form) {
    const fields = Object.fromEntries(new FormData(form).entries());
    const payload = {
      prospectCompany: fields.prospectCompany,
      country: fields.country,
      enterpriseOrVatNumber: fields.enterpriseOrVatNumber || null,
      sourceEvidence: { type: fields.evidenceType, reference: fields.evidenceReference },
    };
    if (fields.estimatedValue !== "" && fields.estimatedValue != null) {
      payload.estimatedValue = Number(fields.estimatedValue);
      payload.currency = fields.currency || "EUR";
    }
    page.busy = true;
    try {
      await api("POST", "/api/reseller/deals", payload);
      page.formOpen = false;
      page.message = tR("rsp.dealCreated", "Claim geregistreerd.");
      page.messageTone = "success";
      if (window.showToast) window.showToast(page.message, "success");
      await load(true);
    } catch (error) {
      // 403: de server houdt het recht bij, dus verbergen we de actie voortaan.
      if (error.denied) { page.register = false; page.formOpen = false; }
      page.message = error.message;
      page.messageTone = "error";
    } finally {
      page.busy = false;
      paint();
    }
  }

  function bind(host) {
    const newButton = document.getElementById("rspPipelineNew");
    if (newButton) {
      newButton.addEventListener("click", () => {
        page.formOpen = !page.formOpen;
        page.message = "";
        paint();
      });
    }
    const retry = document.getElementById("rspPipelineRetry");
    if (retry) {
      retry.addEventListener("click", () => {
        page.deals = null;
        page.denied = false;
        mount(page.host);
      });
    }
    const form = document.getElementById("rspPipelineForm");
    if (form) {
      form.addEventListener("submit", event => {
        event.preventDefault();
        if (page.busy) return;
        registerDeal(form);
      });
    }
    // Rijen en rij-acties lopen via een gedelegeerde luisteraar op de pagina
    // zelf · eenmaal per container. Bij elke herschildering opnieuw binden zou
    // de luisteraars stapelen; vasthouden aan een container die het portaal
    // intussen vervangen heeft (taalwissel herbouwt de shell) zou de pagina
    // dood maken. Vandaar de vergelijking op de container zelf.
    if (host && page.boundHost !== host) {
      page.boundHost = host;
      host.addEventListener("click", event => {
        const target = event.target;
        if (!target || typeof target.closest !== "function") return;
        const submit = target.closest("[data-rsp-submit-deal]");
        if (submit) {
          event.preventDefault();
          submitDraft(submit.dataset.rspSubmitDeal || submit.getAttribute("data-rsp-submit-deal"));
          return;
        }
        const row = target.closest("[data-rsp-deal]");
        if (row) select(row.dataset.rspDeal || row.getAttribute("data-rsp-deal"));
      });
    }
  }

  // Zelfstandig monteren in een container · zelfde volgorde als het portaal:
  // laadstaat tonen, data halen, schilderen, bedraden, fout in het scherm.
  async function mount(host) {
    if (!host || page.loading) return;
    page.host = host;
    page.loading = true;
    host.setAttribute("aria-busy", "true");
    host.innerHTML = `<div class="rsp-loading"><span class="adm-spinner"></span>${esc(tR("adm.loading", "Laden..."))}</div>`;
    try {
      await load(false);
      page.denied = false;
      paint();
    } catch (error) {
      if (error.denied) {
        // Geen retry-knop op een weigering: opnieuw proberen verandert niets en
        // nodigt uit tot rammelen aan de deur.
        page.denied = true;
        page.deals = null;
        paint();
      } else {
        host.innerHTML = `<section class="rsp-error">
          <strong>${esc(tR("rsp.couldNotLoad", "De partnerwerkruimte kon niet laden."))}</strong>
          <p>${esc(error.message)}</p>
          <button type="button" class="rsp-btn" id="rspPipelineRetry">${esc(tR("rsp.retry", "Opnieuw proberen"))}</button>
        </section>`;
        bind(host);
      }
    } finally {
      page.loading = false;
      host.removeAttribute("aria-busy");
    }
  }

  pages.pipeline = {
    id: "pipeline",
    label: () => tR("rsp.pipeline", "Pipeline & deals"),
    meta,
    load,
    render,
    bind,
    mount,
  };
}());
