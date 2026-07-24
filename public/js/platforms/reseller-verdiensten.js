/**
 * Resellerportaal · pagina "Verdiensten & commissie" (CTO3-09 · h23.11).
 *
 * Zelfstandige paginamodule naast public/js/platforms/reseller.js. Ze volgt
 * datzelfde patroon (module-eigen state, dunne api()-wrapper rond fetch,
 * foutafhandeling in de rendermethode) maar bouwt de portalshell NIET opnieuw:
 * de shell, de navigatie en window.wfp_resellerInit blijven van reseller.js.
 * Deze module registreert alleen zichzelf in window.wfpResellerPages.
 *
 * Wat hier hard in de code zit, en waarom:
 *  - de server leidt de partnerorganisatie af uit de sessie · deze pagina
 *    stuurt daarom nooit een organisatie-id mee, ook niet als queryparameter.
 *    De backend beantwoordt een expliciete vreemde organisatie met een harde
 *    weigering; een UI die er zelf een meestuurt maakt die regel zinloos;
 *  - klantinhoud (de onderliggende factuur- of betalingsreferentie uit de
 *    administratie van de klant) verschijnt UITSLUITEND zolang er een actieve
 *    gedelegeerde toegang is. Zonder grant blijft het bij commerciële
 *    metadata: klant, periode, grondslag en bedrag;
 *  - een weigering toont een vaste, generieke melding. Geen record-id, geen
 *    "bestaat niet", geen serverbericht · dat zou een bestaans-oracle zijn.
 *    Daarom leest deze module de foutbody van een mislukt antwoord niet eens;
 *  - bedragen tonen is geen bedragen wijzigen: de pagina is read-only. api()
 *    kent geen methode, er is geen schrijfroute en er wordt geen actieknop
 *    verzonnen die de server niet meestuurt.
 */
(function () {
  "use strict";

  // De gedeelde frontend-kern (token/esc). Ontbreekt hij, dan haakt de pagina
  // stil af · ze maakt nooit zelf een context of portalstate aan.
  const C = window.wfpCore;
  if (!C) return;

  const token = () => C.token();
  const esc = value => C.esc(value == null ? "" : String(value));
  const tR = (key, fallback) => (window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback);
  const locale = () => ({ nl: "nl-BE", fr: "fr-BE", en: "en-GB" }[window.wfpI18n?.lang] || "nl-BE");

  // Chattigheidsgrens voor de delegatie-opzoeking: bij meer klanten in het
  // grootboek dan dit blijft ALLES metadata-only. De veilige kant op falen is
  // hier het punt · nooit klantinhoud tonen omdat een controle is overgeslagen.
  const MAX_TENANT_LOOKUPS = 10;

  const PAGE_ID = "verdiensten";

  const state = {
    balance: null, events: null, payouts: null, statements: null, agreements: null,
    // Per blok apart: het ene endpoint kan geweigerd worden en het andere niet.
    denied: { ledger: false, statements: false, agreements: false },
    grants: {},      // tenantId → true zolang er NU een actieve delegatie is
    loaded: false, loading: false, failed: false
  };

  // ── Opmaak ────────────────────────────────────────────────────────────────
  // Bewust dezelfde helpers als de portalshell: die wonen daar in een closure
  // en zijn niet te lenen. Komt er een gedeelde resellerkern, dan verhuizen
  // deze drie mee (zie het rapport bij CTO3-09).

  function money(value, currency) {
    const code = /^[A-Za-z]{3}$/.test(String(currency || "")) ? String(currency).toUpperCase() : "EUR";
    return new Intl.NumberFormat(locale(), { style: "currency", currency: code }).format(Number(value) || 0);
  }

  function date(value) {
    if (!value) return tR("rsp.notAvailable", "Niet beschikbaar");
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return tR("rsp.notAvailable", "Niet beschikbaar");
    return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", year: "numeric" }).format(parsed);
  }

  function status(value) {
    const labels = {
      active: tR("rsp.statusActive", "Actief"),
      draft: tR("rsp.statusDraft", "Concept"),
      review: tR("rsp.statusReview", "In nazicht"),
      approved: tR("rsp.statusApproved", "Goedgekeurd"),
      invoiced: tR("rsp.statusInvoiced", "Gefactureerd"),
      paid: tR("rsp.statusPaid", "Uitbetaald"),
      disputed: tR("rsp.statusDisputed", "Betwist"),
      closed: tR("rsp.statusClosed", "Afgesloten"),
      expired: tR("rsp.statusExpired", "Verlopen"),
      cancelled: tR("rsp.statusCancelled", "Geannuleerd"),
      pending_approval: tR("rsp.statusPending", "In goedkeuring"),
      accrual: tR("rsp.statusAccrual", "Opbouw"),
      correction: tR("rsp.statusCorrection", "Correctie"),
      clawback: tR("rsp.statusClawback", "Terugboeking")
    };
    const key = String(value || "draft");
    return `<span class="rsp-status rsp-status-${esc(key.replace(/_/g, "-"))}">${esc(labels[key] || key)}</span>`;
  }

  function model(agreement) {
    const labels = {
      percentage: tR("rsp.modelPercentage", "Percentage"),
      fixed: tR("rsp.modelFixed", "Vast bedrag"),
      recurring: tR("rsp.modelRecurring", "Terugkerend")
    };
    return labels[String(agreement.model || "")] || String(agreement.model || "-");
  }

  function rate(agreement) {
    if (agreement.model === "fixed") return money(agreement.fixed_amount, null);
    return agreement.percentage == null ? "-" : `${agreement.percentage}%`;
  }

  function trigger(value) {
    const labels = {
      payment_received: tR("rsp.triggerPayment", "Bij ontvangen betaling"),
      invoice_issued: tR("rsp.triggerInvoice", "Bij uitgereikte factuur")
    };
    return labels[String(value || "")] || String(value || "-");
  }

  // ── Netwerk ───────────────────────────────────────────────────────────────
  // Alleen lezen: api() heeft geen methode-argument, dus er kan hier per
  // constructie geen schrijfactie ontstaan. De foutbody wordt NIET gelezen ·
  // wat de server erover zegt hoort nooit in het scherm terecht te komen.

  async function api(path) {
    const response = await fetch(path, {
      method: "GET",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() }
    });
    if (response.status === 401) {
      localStorage.removeItem("wfp_token");
      window.WorkFlowProPlatformRouter?.showLogin();
      const expired = new Error(tR("rsp.sessionExpired", "Sessie verlopen"));
      expired.status = 401;
      throw expired;
    }
    if (!response.ok) {
      const failure = new Error(response.status === 403
        ? tR("rsp.noAccess", "Geen toegang tot dit onderdeel.")
        : tR("rsp.couldNotLoad", "De partnerwerkruimte kon niet laden."));
      failure.status = response.status;
      throw failure;
    }
    return response.json().catch(() => ({}));
  }

  /** Eén blok laden · 403 markeert alleen dit blok, andere fouten breken de pagina. */
  async function section(key, path, apply) {
    try {
      apply(await api(path));
      state.denied[key] = false;
    } catch (error) {
      if (error && error.status === 403) { state.denied[key] = true; return; }
      throw error;
    }
  }

  /**
   * Spiegel van reseller-authz.delegationDecision, zonder scope: status actief
   * én binnen het venster. De server blijft de autoriteit · deze controle
   * bepaalt alleen of het scherm klantinhoud toont.
   */
  function grantActive(grant, nowMs) {
    if (!grant || grant.status !== "active") return false;
    const from = grant.startDate || grant.startAt || null;
    const until = grant.endDate || grant.endAt || null;
    if (from && !(Date.parse(from) <= nowMs)) return false;
    if (until && !(Date.parse(until) > nowMs)) return false;
    return true;
  }

  /** Per klant in het grootboek: is er nu een actieve gedelegeerde toegang? */
  async function loadGrants() {
    state.grants = {};
    const tenants = [...new Set((state.events || []).map(row => row.clientTenantId).filter(Boolean))];
    if (!tenants.length || tenants.length > MAX_TENANT_LOOKUPS) return;
    const now = Date.now();
    await Promise.all(tenants.map(async tenantId => {
      try {
        const data = await api(`/api/reseller/delegated-access?tenantId=${encodeURIComponent(tenantId)}`);
        state.grants[tenantId] = (data.grants || []).some(grant => grantActive(grant, now));
      } catch (_) {
        // Geweigerd of onbereikbaar = geen toegang. Stil, want de reden zelf
        // is al informatie over de klant.
        state.grants[tenantId] = false;
      }
    }));
  }

  async function load(force) {
    if (!force && state.loaded) return;
    state.denied = { ledger: false, statements: false, agreements: false };
    await Promise.all([
      section("ledger", "/api/reseller/commission", data => {
        state.balance = data.balance || {};
        state.events = data.events || [];
        state.payouts = data.payouts || [];
      }),
      section("statements", "/api/reseller/commission-statements", data => {
        state.statements = data.statements || [];
      }),
      section("agreements", "/api/reseller/commission-agreements", data => {
        state.agreements = data.agreements || [];
      })
    ]);
    if (!state.denied.ledger) await loadGrants();
    state.loaded = true;
  }

  function invalidate() {
    state.balance = null; state.events = null; state.payouts = null;
    state.statements = null; state.agreements = null;
    state.grants = {}; state.loaded = false; state.failed = false;
    state.denied = { ledger: false, statements: false, agreements: false };
  }

  // ── Bouwstenen ────────────────────────────────────────────────────────────

  function pageHead() {
    return `
      <header class="rsp-page-head">
        <div>
          <span class="rsp-page-eyebrow">${esc(tR("rsp.finance", "Financieel"))}</span>
          <h1>${esc(tR("rsp.earnings", "Verdiensten en commissie"))}</h1>
          <p>${esc(tR("rsp.earningsIntro", "Je opgebouwde commissie, je periodestaten en de contractversies waarop ze berekend zijn."))}</p>
        </div>
      </header>`;
  }

  function metric(label, value, note, tone) {
    return `<article class="rsp-kpi ${tone ? `rsp-kpi-${tone}` : ""}">
      <span class="rsp-kpi-label">${esc(label)}</span>
      <strong class="rsp-kpi-value">${esc(value)}</strong>
      <small class="rsp-kpi-sub">${esc(note || "")}</small>
    </article>`;
  }

  /** Vaste, generieke weigering · geen id, geen reden, geen serverbericht. */
  function accessNotice() {
    return `<div class="rsp-empty-state">
      <strong>${esc(tR("rsp.noAccess", "Geen toegang tot dit onderdeel."))}</strong>
      <span>${esc(tR("rsp.noAccessText", "Je profiel heeft geen recht op deze gegevens. Vraag je partnerbeheerder om het recht toe te kennen."))}</span>
    </div>`;
  }

  function card(title, subtitle, count, body) {
    return `
      <section class="rsp-card">
        <div class="rsp-card-head">
          <div><span>${esc(title)}</span><small>${esc(subtitle)}</small></div>
          ${count == null ? "" : `<span class="rsp-count">${esc(String(count))}</span>`}
        </div>
        ${body}
      </section>`;
  }

  function table(headers, rows, empty) {
    return `
      <div class="rsp-table-wrap">
        <table class="rsp-table">
          <thead><tr>${headers.map(head => `<th>${esc(head)}</th>`).join("")}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${headers.length}" class="rsp-empty">${esc(empty)}</td></tr>`}</tbody>
        </table>
      </div>`;
  }

  // ── Blokken ───────────────────────────────────────────────────────────────

  function kpis() {
    if (state.denied.ledger) return "";
    const balance = state.balance || {};
    return `
      <section class="rsp-kpis">
        ${metric(tR("rsp.accrued", "Opgebouwd"), money(balance.accrued, "EUR"), tR("rsp.netAfterCorrections", "netto na correcties"), "violet")}
        ${metric(tR("rsp.payableBalance", "Beschikbaar saldo"), money(balance.payable, "EUR"), tR("rsp.readyForPayout", "beschikbaar voor uitbetaling"), "green")}
        ${metric(tR("rsp.paidTotal", "Uitbetaald"), money(balance.paid, "EUR"), tR("rsp.historicalTotal", "historisch totaal"), "")}
        ${metric(tR("rsp.clawedBack", "Teruggeboekt"), money(balance.clawedBack, "EUR"), tR("rsp.clawedBackText", "clawbacks in het grootboek"), "amber")}
      </section>`;
  }

  function statementsCard() {
    const title = tR("rsp.statements", "Commissiestaten");
    const text = tR("rsp.statementsText", "Per periode, herleidbaar tot de bewegingen in het grootboek");
    if (state.denied.statements) return card(title, text, null, `<div class="rsp-card-body">${accessNotice()}</div>`);
    const rows = [...(state.statements || [])]
      .sort((a, b) => String(b.period || "").localeCompare(String(a.period || "")))
      .map(row => `<tr>
        <td><strong>${esc(row.period)}</strong></td>
        <td>${status(row.status)}</td>
        <td>${esc(String(row.eventCount == null ? "-" : row.eventCount))}</td>
        <td>${money(row.opening, row.currency)}</td>
        <td>${money(row.subtotal, row.currency)}</td>
        <td>${money(row.tax, row.currency)}</td>
        <td><strong>${money(row.total, row.currency)}</strong></td>
        <td>${esc(date(row.paidAt || row.invoicedAt || row.approvedAt || row.generatedAt))}</td>
      </tr>`).join("");
    return card(title, text, (state.statements || []).length, table([
      tR("rsp.period", "Periode"), tR("adm.status", "Status"), tR("rsp.lines", "Regels"),
      tR("rsp.opening", "Openstaand"), tR("rsp.subtotal", "Subtotaal"), tR("rsp.tax", "Btw"),
      tR("rsp.total", "Totaal"), tR("rsp.date", "Datum")
    ], rows, tR("rsp.noStatements", "Nog geen commissiestaten opgesteld.")));
  }

  /**
   * De bronverwijzing is klantinhoud: ze wijst naar een factuur of betaling in
   * de administratie van de klant. Zonder actieve gedelegeerde toegang toont
   * het scherm alleen het soort bron · de referentie zelf blijft weg.
   */
  function sourceCell(event) {
    const ref = event.sourceRef || null;
    if (!ref) return "-";
    const kinds = {
      payment: tR("rsp.sourcePayment", "Betaling"),
      invoice: tR("rsp.sourceInvoice", "Factuur"),
      subscription: tR("rsp.sourceSubscription", "Abonnement")
    };
    const kind = esc(kinds[String(ref.kind || "")] || ref.kind || "-");
    if (!state.grants[event.clientTenantId]) {
      return `${kind}<small>${esc(tR("rsp.metadataOnly", "enkel metadata"))}</small>`;
    }
    return `${kind}<small>${esc(ref.id)}</small>`;
  }

  function ledgerCard() {
    const title = tR("rsp.ledger", "Grootboek");
    const text = tR("rsp.ledgerText", "Opbouw, correcties en terugboekingen");
    if (state.denied.ledger) return card(title, text, null, `<div class="rsp-card-body">${accessNotice()}</div>`);
    const rows = [...(state.events || [])].reverse().map(event => `<tr>
      <td>${esc(date(event.createdAt))}</td>
      <td>${esc(event.period || "-")}</td>
      <td>${status(event.type)}</td>
      <td class="rsp-client">${esc(event.clientName || event.clientTenantId || "-")}</td>
      <td>${event.basisAmount == null ? "-" : money(event.basisAmount, "EUR")}</td>
      <td>${event.ratePct == null ? "-" : esc(`${event.ratePct}%`)}</td>
      <td>${sourceCell(event)}</td>
      <td><strong class="${Number(event.amount) < 0 ? "rsp-negative" : "rsp-positive"}">${money(event.amount, "EUR")}</strong></td>
    </tr>`).join("");
    return card(title, text, (state.events || []).length, table([
      tR("rsp.date", "Datum"), tR("rsp.period", "Periode"), tR("rsp.type", "Type"),
      tR("rsp.client", "Klant"), tR("rsp.basis", "Grondslag"), tR("rsp.commissionPct", "Commissie"),
      tR("rsp.source", "Bron"), tR("rsp.amount", "Bedrag")
    ], rows, tR("rsp.noLedgerEvents", "Nog geen commissiebewegingen.")));
  }

  function agreementsCard() {
    const title = tR("rsp.agreements", "Commissiecontracten");
    const text = tR("rsp.agreementsText", "Elke wijziging is een nieuwe versie · de oude blijft staan");
    if (state.denied.agreements) return card(title, text, null, `<div class="rsp-card-body">${accessNotice()}</div>`);
    const rows = [...(state.agreements || [])]
      .sort((a, b) => String(a.agreement_id || "").localeCompare(String(b.agreement_id || ""))
        || (Number(b.version) || 0) - (Number(a.version) || 0))
      .map(row => `<tr>
        <td><strong>${esc(row.agreement_id || "-")}</strong></td>
        <td>${esc(`v${row.version == null ? "-" : row.version}`)}</td>
        <td>${status(row.status)}</td>
        <td>${esc(model(row))}</td>
        <td>${esc(rate(row))}</td>
        <td>${esc(trigger(row.earning_trigger))}</td>
        <td>${esc(date(row.start_date))}</td>
        <td>${esc(row.end_date ? date(row.end_date) : tR("rsp.openEnded", "Doorlopend"))}</td>
      </tr>`).join("");
    return card(title, text, (state.agreements || []).length, table([
      tR("rsp.agreement", "Contract"), tR("rsp.version", "Versie"), tR("adm.status", "Status"),
      tR("rsp.model", "Model"), tR("rsp.commissionPct", "Commissie"), tR("rsp.earningTrigger", "Verdienmoment"),
      tR("rsp.validFrom", "Geldig vanaf"), tR("rsp.validUntil", "Geldig tot")
    ], rows, tR("rsp.noAgreements", "Nog geen contractversies beschikbaar.")));
  }

  function payoutsCard() {
    const title = tR("rsp.payouts", "Uitbetalingen");
    const text = tR("rsp.payoutsText", "Historiek en betaalreferenties");
    if (state.denied.ledger) return "";
    const body = (state.payouts || []).map(payout => `<article>
      <div><strong>${money(payout.amount, "EUR")}</strong><span>${esc(payout.period || date(payout.createdAt))}</span></div>
      <div>${status(payout.status)}<small>${esc(payout.paymentRef || tR("rsp.noPaymentRef", "Nog geen betaalreferentie"))}</small></div>
    </article>`).join("");
    return card(title, text, (state.payouts || []).length,
      `<div class="rsp-card-body rsp-payout-list">${body || `<div class="rsp-empty-state">
        <strong>${esc(tR("rsp.noPayouts", "Nog geen uitbetalingen"))}</strong>
        <span>${esc(tR("rsp.noPayoutsText", "Nieuwe uitbetalingen verschijnen hier automatisch."))}</span>
      </div>`}</div>`);
  }

  function footNote() {
    return `
      <div class="rsp-form-note">
        <span aria-hidden="true">i</span>
        <p>${esc(tR("rsp.earningsNote", "Deze pagina is enkel om te lezen. Berekeningen en uitbetalingen worden centraal beheerd. Onderliggende klantdocumenten verschijnen alleen zolang de klant je een actieve gedelegeerde toegang geeft."))}</p>
      </div>`;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  /** Pure HTML uit de huidige state · geen DOM, geen netwerk. */
  function pageHtml() {
    if (state.failed) {
      return `<section class="rsp-error">
        <strong>${esc(tR("rsp.couldNotLoad", "De partnerwerkruimte kon niet laden."))}</strong>
        <button type="button" class="rsp-btn" data-rsp-verdiensten-retry>${esc(tR("rsp.retry", "Opnieuw proberen"))}</button>
      </section>`;
    }
    if (!state.loaded) {
      return `<div class="rsp-loading"><span class="adm-spinner"></span>${esc(tR("adm.loading", "Laden..."))}</div>`;
    }
    // Alles geweigerd = één nette melding in plaats van drie lege kaders.
    if (state.denied.ledger && state.denied.statements && state.denied.agreements) {
      return `${pageHead()}<section class="rsp-card"><div class="rsp-card-body">${accessNotice()}</div></section>`;
    }
    return `${pageHead()}${kpis()}${statementsCard()}${ledgerCard()}${agreementsCard()}${payoutsCard()}${footNote()}`;
  }

  function bind(host) {
    if (!host || !host.querySelector) return;
    const retry = host.querySelector("[data-rsp-verdiensten-retry]");
    if (retry) retry.addEventListener("click", () => { invalidate(); render(host); });
  }

  /** Vult een container · de portalshell geeft #rspMain door. */
  async function render(container) {
    const host = container || document.getElementById("rspMain");
    if (!host || state.loading) return;
    state.loading = true;
    state.failed = false;
    host.setAttribute("aria-busy", "true");
    host.innerHTML = pageHtml();
    try {
      await load(false);
    } catch (_) {
      // Geen enkel serverbericht in het scherm · alleen onze eigen tekst.
      state.failed = true;
    } finally {
      state.loading = false;
      host.removeAttribute("aria-busy");
    }
    host.innerHTML = pageHtml();
    bind(host);
  }

  // ── Registratie ───────────────────────────────────────────────────────────
  // De portalshell (reseller.js) houdt zijn eigen state; deze pagina hangt
  // zichzelf alleen in het paginaregister. Idempotent: een bestaand register
  // wordt gelezen, nooit vervangen.
  const pages = window.wfpResellerPages = window.wfpResellerPages || {};
  pages[PAGE_ID] = {
    id: PAGE_ID,
    label: () => tR("rsp.earnings", "Verdiensten en commissie"),
    icoon: "€",
    // Het recht dat de server op alle drie de endpoints afdwingt. De pagina
    // gebruikt het niet om zelf te beslissen · dat doet de server, wij tonen
    // wat er terugkomt.
    permission: "reseller.commissions.view",
    render,     // vult een container
    html: pageHtml, // pure HTML uit de huidige state
    grantActive,    // pure spiegel van de delegatiebeslissing
    load, invalidate
  };
}());
