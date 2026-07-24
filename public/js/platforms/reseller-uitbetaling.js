// Resellerportaal · pagina "Uitbetaling" (h23.11/23.15 · CTO3-09).
//
// Zelfstandige paginamodule bovenop het BESTAANDE portaal
// (public/js/platforms/reseller.js). Ze volgt datzelfde patroon in plaats van
// een eigen mechaniek te bedenken:
//   * state in een module-lokaal object (nooit een nieuwe globale portaalstate);
//   * fetch via een dunne api()-wrapper met bearer-token en 401 naar de login;
//   * renderen als HTML-string in de bestaande rsp-*-klassen;
//   * teksten via window.wfpI18n met een NL-fallback.
//
// Aanhaken vanuit reseller.js kost drie regels (bewust hier gedocumenteerd,
// zodat de host de enige plek blijft die de navigatie kent):
//   <button ... data-rsp-view="payout">Uitbetaling</button>
//   renderers.payout = () => "";                      // shell rendert leeg
//   window.wfpResellerPages.uitbetaling.render(main); // pagina vult #rspMain
//
// Harde regels die deze pagina afdwingt:
//   1. de UI stuurt NOOIT een resellerId mee. De server leidt de organisatie af
//      uit de sessie (reseller-portal.js: body.resellerId || reseller.id) en
//      requestPayoutChange weigert een vreemde id hard. Meesturen zou die
//      weigering afhankelijk maken van invoer uit de browser;
//   2. geen klantinhoud. Deze pagina bevraagt uitsluitend /api/me en het eigen
//      commissiegrootboek. Klantinhoud vereist een ACTIEVE gedelegeerde toegang
//      (23.12) en die vraagt deze pagina bewust niet aan · ook de klantnamen in
//      de grootboekregels blijven hier buiten beeld;
//   3. elke weigering wordt een vaste, generieke melding. Geen record-id, geen
//      foutcode, geen "bestaat niet": dat zou een bestaans-oracle zijn. 403 en
//      404 geven daarom letterlijk dezelfde tekst;
//   4. bedragen tonen is niet hetzelfde als bedragen mogen wijzigen. Het
//      formulier verschijnt alleen als de rechten die de server meestuurt het
//      toelaten · de UI verzint geen knoppen.
(function () {
  "use strict";

  const PAGE_ID = "uitbetaling";

  const token = () => window.wfpCore.token();
  const esc = value => window.wfpCore.esc(value == null ? "" : String(value));
  const tR = (key, fallback) => (window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback);
  const locale = () => ({ nl: "nl-BE", fr: "fr-BE", en: "en-GB" }[window.wfpI18n && window.wfpI18n.lang] || "nl-BE");

  // Paginastate. Bewust LOKAAL: de portaalstate van reseller.js blijft van
  // reseller.js. Deze module leest hem niet en definieert hem niet opnieuw.
  const page = {
    user: null,          // /api/me · de rechten komen van de server
    ledger: null,        // /api/reseller/commission (eigen grootboek)
    ledgerDenied: false, // grootboek geweigerd · dan tonen we geen bedragen
    changes: [],         // wijzigingen die in DEZE sessie zijn ingediend
    notice: null,        // { tone: "ok" | "denied" | "error", text }
    loading: false
  };

  // ── Opmaak ────────────────────────────────────────────────────────────────
  function eur(value) {
    return new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR" }).format(Number(value) || 0);
  }

  function date(value) {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "-";
    return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", year: "numeric" }).format(parsed);
  }

  // Statuslabels: dezelfde set als reseller.js, aangevuld met de payout- en
  // wijzigingsstatussen uit commission-ledger.js en reseller-commission-agreement.js.
  function statusPill(value) {
    const labels = {
      draft: tR("rsp.statusDraft", "Concept"),
      pending: tR("rsp.statusPending", "In goedkeuring"),
      pending_approval: tR("rsp.statusPending", "In goedkeuring"),
      approved: tR("rsp.statusApproved", "Goedgekeurd"),
      rejected: tR("rsp.payoutStatusRejected", "Afgewezen"),
      paid: tR("rsp.statusPaid", "Uitbetaald"),
      failed: tR("rsp.payoutStatusFailed", "Mislukt"),
      disputed: tR("rsp.statusDisputed", "Betwist"),
      cancelled: tR("rsp.statusCancelled", "Geannuleerd")
    };
    const key = String(value || "draft");
    return `<span class="rsp-status rsp-status-${esc(key.replace(/_/g, "-"))}">${esc(labels[key] || key)}</span>`;
  }

  // Een rekeningnummer komt nooit voluit in beeld. log-redaction.js behandelt
  // payout_account als gevoelig; de UI doet dat ook, ook voor de eigen IBAN.
  function maskIban(value) {
    const flat = String(value == null ? "" : value).replace(/\s+/g, "").toUpperCase();
    if (!flat) return "-";
    if (flat.length <= 8) return flat.slice(0, 2) + "••••";
    return flat.slice(0, 4) + " •••• " + flat.slice(-4);
  }

  // ── Netwerk ───────────────────────────────────────────────────────────────
  // Zelfde vorm als api() in reseller.js, met één verschil: status en code
  // blijven op de fout staan en de SERVERTEKST wordt nooit doorgegeven aan de
  // UI. Die tekst kan een id of een reden bevatten; messageFor() maakt er een
  // nette, generieke melding van.
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
    }
    if (!response.ok) {
      const error = new Error("uitbetaling: " + method + " " + path);
      error.status = response.status;
      error.code = (data && data.code) || null;
      throw error;
    }
    return data;
  }

  // ── Rechten · spiegel van de server, geen eigen beleid ────────────────────
  // De server beslist; dit bepaalt alleen of we het formulier TONEN. Het is een
  // letterlijke spiegel van drie serverregels voor één recht:
  //   * reseller-authz.js SENSITIVE_DENY · sales en partner manager mogen dit
  //     nooit, ook niet met een expliciet recht of "*";
  //   * reseller-authz.js BUILTIN_GRANTS · finance (partner en Monargo) heeft het;
  //   * server.js LEGACY_RESELLER_GRANTS · de klassieke enkelvoudige
  //     resellerlogin (systeemrol "reseller" zonder sub-rol) werkt als eigenaar
  //     en krijgt reseller.payout.manage op de eigen organisatie.
  // Wijzigt één van die drie, dan moet dit mee. Weigert de server alsnog, dan
  // toont submitChange() gewoon de generieke melding: de server blijft baas.
  const PAYOUT_PERMISSION = "reseller.payout.manage";
  const PAYOUT_DENY_ROLES = ["reseller_sales", "monargo_partner_manager"];
  const PAYOUT_ROLES = ["reseller_finance", "monargo_partner_finance"];
  const SCOPES = ["own", "assigned", "all"];

  function permissionKey(raw) {
    const value = String(raw == null ? "" : raw);
    const last = value.lastIndexOf(":");
    if (last > 0 && SCOPES.indexOf(value.slice(last + 1)) !== -1) return value.slice(0, last);
    const first = value.indexOf(":");
    if (first > 0 && SCOPES.indexOf(value.slice(0, first)) !== -1) return value.slice(first + 1);
    return value;
  }

  function channelRole(user) { return (user && (user.resellerRole || user.role)) || null; }

  function mayManagePayout(user) {
    if (!user) return false;
    const role = channelRole(user);
    if (PAYOUT_DENY_ROLES.indexOf(role) !== -1) return false;
    if (PAYOUT_ROLES.indexOf(role) !== -1) return true;
    const grants = Array.isArray(user.permissions) ? user.permissions : [];
    if (grants.some(grant => grant === "*" || permissionKey(grant) === PAYOUT_PERMISSION)) return true;
    return !user.resellerRole && user.role === "reseller";
  }

  // MFA is verplicht voor elke payoutactie (vier-ogenrecht · 23.15). Kunnen we
  // het niet bevestigen, dan tonen we een waarschuwing maar blokkeren we het
  // formulier niet: de server is de enige die MFA echt kan vaststellen.
  function mfaConfirmed(user) {
    return !!(user && (user.mfaEnabled === true || user.mfaVerified === true));
  }

  // ── Foutvertaling · nooit een identifier, nooit een reden ─────────────────
  function deniedText() {
    return tR("rsp.payoutDenied", "Je hebt geen toegang tot deze actie. Klopt dat niet, neem dan contact op met Monargo.");
  }

  function messageFor(error) {
    const status = error && error.status;
    const code = (error && error.code) || null;
    // 403 en 404 lopen bewust samen. Een apart "niet gevonden" zou verklappen
    // of een record bestaat, en dat is precies de oracle die 23.15 verbiedt.
    if (status === 403 || status === 404) {
      if (code === "MFA_REQUIRED") {
        return tR("rsp.payoutMfaRequired", "Sterke authenticatie (MFA) is vereist voor uitbetalingsgegevens. Zet MFA aan op je profiel en probeer opnieuw.");
      }
      return deniedText();
    }
    if (status === 400) {
      if (code === "REASON_REQUIRED") return tR("rsp.payoutReasonRequired", "Vul een reden in. Elke wijziging van uitbetalingsgegevens wordt met reden vastgelegd.");
      if (code === "PAYOUT_CHANGE_EMPTY") return tR("rsp.payoutNothingToChange", "Vul een nieuw rekeningnummer of een andere valuta in.");
      if (code === "PAYOUT_ACCOUNT_INVALID") return tR("rsp.payoutIbanInvalid", "Dit is geen geldig rekeningnummer (IBAN). Controleer het en probeer opnieuw.");
      return tR("rsp.payoutInvalid", "De aanvraag kon niet worden verwerkt. Controleer de ingevulde gegevens.");
    }
    if (status === 401) return tR("rsp.sessionExpired", "Sessie verlopen");
    if (status === 409) return tR("rsp.payoutConflict", "Deze aanvraag is intussen al behandeld. Ververs de pagina.");
    return tR("rsp.payoutFailed", "Er ging iets mis bij het verwerken. Probeer het later opnieuw.");
  }

  // ── Body-opbouw · de organisatie komt uit de sessie, nooit uit de UI ───────
  function payloadFor(fields) {
    const source = fields || {};
    const trim = value => String(value == null ? "" : value).trim();
    const body = { reason: trim(source.reason) };
    const account = trim(source.payout_account).replace(/\s+/g, "").toUpperCase();
    const currency = trim(source.payout_currency).toUpperCase();
    if (account) body.payout_account = account;
    if (currency) body.payout_currency = currency;
    return body;
  }

  // Zelfde vorm als de servercontrole · scheelt een roundtrip, vervangt hem niet.
  const IBAN_PATTERN = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/;
  function localRefusal(body) {
    if (!body.reason) return { status: 400, code: "REASON_REQUIRED" };
    if (!body.payout_account && !body.payout_currency) return { status: 400, code: "PAYOUT_CHANGE_EMPTY" };
    if (body.payout_account && !IBAN_PATTERN.test(body.payout_account)) return { status: 400, code: "PAYOUT_ACCOUNT_INVALID" };
    return null;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function metric(label, value, note, tone) {
    return `<article class="rsp-kpi ${tone ? `rsp-kpi-${tone}` : ""}">
      <span class="rsp-kpi-label">${esc(label)}</span>
      <strong class="rsp-kpi-value">${esc(value)}</strong>
      <small class="rsp-kpi-sub">${esc(note || "")}</small>
    </article>`;
  }

  // Zelfde rekenregel als reseller.js: open uitbetalingen houden hun bedrag
  // gereserveerd, dus beschikbaar = uitbetaalbaar saldo min die reservering.
  function amountsOf(ledger) {
    const source = ledger || {};
    const reserved = (source.payouts || [])
      .filter(payout => ["draft", "pending_approval", "approved", "failed"].indexOf(payout.status) !== -1)
      .reduce((sum, payout) => sum + (Number(payout.amount) || 0), 0);
    const payable = Number(source.balance && source.balance.payable) || 0;
    return { available: Math.max(0, payable - reserved), reserved, paid: Number(source.balance && source.balance.paid) || 0 };
  }

  function headHtml() {
    return `
      <header class="rsp-page-head">
        <div>
          <span class="rsp-page-eyebrow">${esc(tR("rsp.finance", "Financieel"))}</span>
          <h1>${esc(tR("rsp.payout", "Uitbetaling"))}</h1>
          <p>${esc(tR("rsp.payoutIntro", "Volg je uitbetalingen en vraag een wijziging van je uitbetalingsgegevens aan. Monargo keurt zo'n wijziging altijd met vier ogen goed."))}</p>
        </div>
      </header>`;
  }

  function noticeHtml(notice) {
    if (!notice || !notice.text) return "";
    const ok = notice.tone === "ok";
    return `
      <section class="rsp-card" data-rsp-notice="${esc(notice.tone || "info")}">
        <div class="rsp-card-body">
          <div class="${ok ? "rsp-success-note" : "rsp-form-note"}" role="status">
            <span aria-hidden="true">${ok ? "✓" : "i"}</span>
            <p>${esc(notice.text)}</p>
          </div>
        </div>
      </section>`;
  }

  function amountsHtml(model) {
    if (model.ledgerDenied || !model.ledger) {
      return `
        <section class="rsp-card">
          <div class="rsp-card-head"><div><span>${esc(tR("rsp.payoutBalances", "Saldo's"))}</span></div></div>
          <div class="rsp-card-body"><div class="rsp-empty-state"><strong>${esc(deniedText())}</strong></div></div>
        </section>`;
    }
    const amounts = amountsOf(model.ledger);
    return `
      <section class="rsp-kpis rsp-kpis-three">
        ${metric(tR("rsp.payableBalance", "Beschikbaar saldo"), eur(amounts.available), tR("rsp.readyForPayout", "beschikbaar voor uitbetaling"), "green")}
        ${metric(tR("rsp.reservedBalance", "Gereserveerd"), eur(amounts.reserved), tR("rsp.inOpenPayouts", "in openstaande uitbetalingen"), "amber")}
        ${metric(tR("rsp.paidTotal", "Uitbetaald"), eur(amounts.paid), tR("rsp.historicalTotal", "historisch totaal"), "blue")}
      </section>`;
  }

  // Uitbetalingshistoriek · uitsluitend eigen bedragen en betaalreferenties.
  // Geen record-id in beeld en geen klantregels: een uitbetaling heeft die niet
  // nodig, en klantinhoud hoort hier sowieso niet.
  function historyHtml(model) {
    if (model.ledgerDenied || !model.ledger) return "";
    const payouts = (model.ledger.payouts || []);
    const rows = payouts.map(payout => `<tr>
      <td>${esc(payout.period || date(payout.createdAt))}</td>
      <td>${statusPill(payout.status)}</td>
      <td><strong>${eur(payout.amount)}</strong></td>
      <td>${esc(payout.paymentRef || tR("rsp.noPaymentRef", "Nog geen betaalreferentie"))}</td>
      <td>${esc(date(payout.paidAt))}</td>
    </tr>`).join("");
    return `
      <section class="rsp-card">
        <div class="rsp-card-head">
          <div><span>${esc(tR("rsp.payouts", "Uitbetalingen"))}</span><small>${esc(tR("rsp.payoutsText", "Historiek en betaalreferenties"))}</small></div>
          <span class="rsp-count">${esc(String(payouts.length))}</span>
        </div>
        <div class="rsp-table-wrap">
          <table class="rsp-table">
            <thead><tr>
              <th>${esc(tR("rsp.period", "Periode"))}</th>
              <th>${esc(tR("adm.status", "Status"))}</th>
              <th>${esc(tR("rsp.amount", "Bedrag"))}</th>
              <th>${esc(tR("rsp.payoutReference", "Betaalreferentie"))}</th>
              <th>${esc(tR("rsp.payoutPaidAt", "Betaald op"))}</th>
            </tr></thead>
            <tbody>${rows || `<tr><td colspan="5" class="rsp-empty">${esc(tR("rsp.noPayouts", "Nog geen uitbetalingen"))}</td></tr>`}</tbody>
          </table>
        </div>
      </section>`;
  }

  // De laatst bekende opgeslagen waarden. Het portaal heeft geen leesroute voor
  // payoutgegevens (die staat alleen aan Monargo-zijde achter
  // reseller.payout.manage), dus we tonen enkel wat de bevestiging van een
  // eigen wijziging teruggaf. Onbekend blijft "-", nooit een gok.
  function currentHtml(model) {
    const latest = (model.changes || [])[0];
    const before = (latest && latest.before) || {};
    return `
      <section class="rsp-card">
        <div class="rsp-card-head">
          <div><span>${esc(tR("rsp.payoutCurrent", "Huidige uitbetalingsgegevens"))}</span><small>${esc(tR("rsp.payoutCurrentText", "Zoals bekend uit je laatste wijzigingsaanvraag"))}</small></div>
        </div>
        <div class="rsp-card-body">
          <p><strong>${esc(tR("rsp.payoutAccount", "Rekeningnummer"))}:</strong> ${esc(maskIban(before.payout_account))}</p>
          <p><strong>${esc(tR("rsp.payoutCurrency", "Valuta"))}:</strong> ${esc(before.payout_currency || "-")}</p>
          <div class="rsp-form-note">
            <span aria-hidden="true">i</span>
            <p>${esc(tR("rsp.payoutNotStored", "Het partnerportaal leest je opgeslagen rekeningnummer niet uit. Je ziet het alleen terug in de bevestiging van een wijziging die je zelf indient."))}</p>
          </div>
        </div>
      </section>`;
  }

  function formHtml(model) {
    const mayManage = mayManagePayout(model.user);
    if (!mayManage) {
      // Geen recht = geen knop. Dit gaat over de eigen rechten van de
      // ingelogde gebruiker, niet over het bestaan van een record.
      return `
        <section class="rsp-card">
          <div class="rsp-card-head"><div><span>${esc(tR("rsp.payoutChange", "Uitbetalingsgegevens wijzigen"))}</span></div></div>
          <div class="rsp-card-body">
            <div class="rsp-form-note">
              <span aria-hidden="true">i</span>
              <p>${esc(tR("rsp.payoutNoRight", "Je profiel mag uitbetalingsgegevens bekijken maar niet wijzigen. Vraag dit aan de finance-verantwoordelijke van je partneraccount."))}</p>
            </div>
          </div>
        </section>`;
    }
    const mfaWarning = mfaConfirmed(model.user) ? "" : `
      <div class="rsp-span2 rsp-form-note">
        <span aria-hidden="true">!</span>
        <p>${esc(tR("rsp.payoutMfaRequired", "Sterke authenticatie (MFA) is vereist voor uitbetalingsgegevens. Zet MFA aan op je profiel en probeer opnieuw."))}</p>
      </div>`;
    return `
      <section class="rsp-card">
        <div class="rsp-card-head">
          <div><span>${esc(tR("rsp.payoutChange", "Uitbetalingsgegevens wijzigen"))}</span><small>${esc(tR("rsp.payoutChangeText", "Aanvraag met reden · Monargo keurt goed met vier ogen"))}</small></div>
        </div>
        <form class="rsp-card-body rsp-form" id="rspPayoutForm" novalidate>
          <label>
            <span>${esc(tR("rsp.payoutNewAccount", "Nieuw rekeningnummer (IBAN)"))}</span>
            <input name="payout_account" autocomplete="off" spellcheck="false" placeholder="${esc(tR("rsp.payoutAccountPh", "BE68 5390 0754 7034"))}">
          </label>
          <label>
            <span>${esc(tR("rsp.payoutCurrency", "Valuta"))}</span>
            <select name="payout_currency">
              <option value="" selected>${esc(tR("rsp.payoutUnchanged", "Ongewijzigd"))}</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
              <option value="CHF">CHF</option>
            </select>
          </label>
          <label class="rsp-span2">
            <span>${esc(tR("rsp.payoutReason", "Reden"))}</span>
            <input name="reason" required placeholder="${esc(tR("rsp.payoutReasonPh", "Waarom wijzigen deze gegevens?"))}">
          </label>
          ${mfaWarning}
          <div class="rsp-span2 rsp-form-note">
            <span aria-hidden="true">i</span>
            <p>${esc(tR("rsp.payoutFourEyes", "De wijziging gaat niet meteen in. Ze wordt vastgelegd met reden en aanvrager, en een andere persoon bij Monargo keurt ze goed of af."))}</p>
          </div>
          <div class="rsp-span2 rsp-form-actions">
            <button class="rsp-btn rsp-btn-primary" type="submit">${esc(tR("rsp.payoutSubmit", "Wijziging aanvragen"))}</button>
            <span id="rspPayoutMessage" class="rsp-msg" role="status"></span>
          </div>
        </form>
      </section>`;
  }

  // Ingediende wijzigingen van DEZE sessie. Het portaal heeft geen leesroute
  // voor de wijzigingshistoriek, dus we doen ook niet alsof: de kop zegt het.
  function changesHtml(model) {
    const changes = model.changes || [];
    const rows = changes.map(change => `<tr>
      <td>${esc(date(change.requestedAt))}</td>
      <td>${esc(maskIban((change.after || {}).payout_account))}</td>
      <td>${esc((change.after || {}).payout_currency || "-")}</td>
      <td>${statusPill(change.status)}</td>
      <td>${esc(change.reason || "-")}</td>
    </tr>`).join("");
    return `
      <section class="rsp-card">
        <div class="rsp-card-head">
          <div><span>${esc(tR("rsp.payoutRequests", "Ingediende wijzigingen"))}</span><small>${esc(tR("rsp.payoutRequestsText", "Wat je in deze sessie hebt ingediend"))}</small></div>
          <span class="rsp-count">${esc(String(changes.length))}</span>
        </div>
        <div class="rsp-table-wrap">
          <table class="rsp-table">
            <thead><tr>
              <th>${esc(tR("rsp.payoutRequestedAt", "Aangevraagd"))}</th>
              <th>${esc(tR("rsp.payoutNewAccountShort", "Nieuw rekeningnummer"))}</th>
              <th>${esc(tR("rsp.payoutCurrency", "Valuta"))}</th>
              <th>${esc(tR("adm.status", "Status"))}</th>
              <th>${esc(tR("rsp.payoutReason", "Reden"))}</th>
            </tr></thead>
            <tbody>${rows || `<tr><td colspan="5" class="rsp-empty">${esc(tR("rsp.payoutNoRequests", "Nog geen wijziging ingediend in deze sessie."))}</td></tr>`}</tbody>
          </table>
        </div>
      </section>`;
  }

  function privacyHtml() {
    return `
      <section class="rsp-card">
        <div class="rsp-card-body">
          <div class="rsp-form-note">
            <span aria-hidden="true">i</span>
            <p>${esc(tR("rsp.payoutScopeNote", "Deze pagina toont uitsluitend de commerciële gegevens van je eigen partnerorganisatie. Klantinhoud vereist een actieve gedelegeerde toegang en wordt hier nooit getoond."))}</p>
          </div>
        </div>
      </section>`;
  }

  // Pure rendering: een model in, HTML uit. Zonder argument rendert ze de
  // huidige paginastate. Zo is elk scherm testbaar zonder DOM en zonder netwerk.
  function pageHtml(model) {
    const m = { user: null, ledger: null, ledgerDenied: false, changes: [], notice: null, ...(model || page) };
    return [
      headHtml(),
      noticeHtml(m.notice),
      amountsHtml(m),
      currentHtml(m),
      formHtml(m),
      historyHtml(m),
      changesHtml(m),
      privacyHtml()
    ].join("");
  }

  function errorHtml(text) {
    return `<section class="rsp-error">
      <strong>${esc(tR("rsp.couldNotLoad", "De partnerwerkruimte kon niet laden."))}</strong>
      <p>${esc(text)}</p>
      <button type="button" class="rsp-btn" id="rspPayoutRetry">${esc(tR("rsp.retry", "Opnieuw proberen"))}</button>
    </section>`;
  }

  // ── Gedrag ────────────────────────────────────────────────────────────────
  async function load(force) {
    if (!force && page.user && (page.ledger || page.ledgerDenied)) return;
    const me = await api("GET", "/api/me");
    page.user = (me && me.user) || null;
    try {
      page.ledger = await api("GET", "/api/reseller/commission");
      page.ledgerDenied = false;
    } catch (error) {
      // Weigert de server het grootboek, dan tonen we geen bedragen en geen
      // reden. De pagina blijft bruikbaar voor de rest.
      page.ledger = null;
      page.ledgerDenied = true;
    }
  }

  async function submitChange(event, form, host) {
    event.preventDefault();
    const message = form.querySelector("#rspPayoutMessage");
    const submit = form.querySelector('button[type="submit"]');
    const fields = {};
    new FormData(form).forEach((value, key) => { fields[key] = value; });
    const body = payloadFor(fields);
    const refusal = localRefusal(body);
    if (refusal) {
      if (message) message.textContent = messageFor(refusal);
      return;
    }
    if (message) message.textContent = "";
    if (submit) {
      submit.disabled = true;
      submit.textContent = tR("rsp.payoutSubmitting", "Aanvraag wordt ingediend...");
    }
    try {
      const result = await api("POST", "/api/reseller/payout-changes", body);
      if (result && result.change) page.changes = [result.change, ...page.changes];
      page.notice = {
        tone: "ok",
        text: tR("rsp.payoutRequested", "Wijziging aangevraagd. Ze wordt pas actief nadat iemand anders bij Monargo ze goedkeurt.")
      };
      await render(host, true);
    } catch (error) {
      if (message) message.textContent = messageFor(error);
      if (submit) {
        submit.disabled = false;
        submit.textContent = tR("rsp.payoutSubmit", "Wijziging aanvragen");
      }
    }
  }

  function bind(host) {
    const form = host.querySelector("#rspPayoutForm");
    if (form) form.addEventListener("submit", event => submitChange(event, form, host));
    const retry = host.querySelector("#rspPayoutRetry");
    if (retry) retry.addEventListener("click", () => {
      page.user = null;
      page.ledger = null;
      page.ledgerDenied = false;
      render(host, true);
    });
  }

  async function render(container, force) {
    const host = container || document.getElementById("rspMain");
    if (!host || page.loading) return;
    page.loading = true;
    host.setAttribute("aria-busy", "true");
    host.innerHTML = `<div class="rsp-loading"><span class="adm-spinner"></span>${esc(tR("adm.loading", "Laden..."))}</div>`;
    try {
      await load(force === true);
      host.innerHTML = pageHtml();
      bind(host);
    } catch (error) {
      host.innerHTML = errorHtml(messageFor(error));
      bind(host);
    } finally {
      page.loading = false;
      host.removeAttribute("aria-busy");
    }
  }

  // ── Registratie ───────────────────────────────────────────────────────────
  // Het paginaregister wordt idempotent aangemaakt (zelfde afspraak als admin.js
  // met zijn gedeelde context): wie er als eerste is maakt het, de rest leest
  // het. Deze module maakt of overschrijft GEEN portaalstate van reseller.js.
  const pages = window.wfpResellerPages = window.wfpResellerPages || {};
  pages[PAGE_ID] = {
    id: PAGE_ID,
    label: () => tR("rsp.payout", "Uitbetaling"),
    render,             // vult een container · de host geeft #rspMain door
    mount: render,      // alias · de zusterpagina's noemen het mount(host)
    html: pageHtml,     // pure HTML uit een model
    messageFor,         // pure foutvertaling · 403 en 404 zijn generiek
    payloadFor,         // pure body-opbouw · zonder organisatie-id
    mayManagePayout,    // spiegel van de serverrechten
    maskIban,
    state: page
  };
}());
