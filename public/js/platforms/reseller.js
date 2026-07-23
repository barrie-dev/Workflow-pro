// Resellerportaal: commerciële werkruimte voor de eigen klanten, onboarding
// en commissies. Operationele tenantgegevens blijven bewust afgeschermd.
(function () {
  "use strict";
  // Monargo Workspace · reseller

  const token = () => window.wfpCore.token();
  const esc = value => window.wfpCore.esc(value == null ? "" : String(value));
  const tR = (key, fallback) => window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback;
  const locale = () => ({ nl: "nl-BE", fr: "fr-BE", en: "en-GB" }[window.wfpI18n?.lang] || "nl-BE");
  const state = { view: "dashboard", clients: null, ledger: null, loading: false };
  let _rspLangHandler = null;

  function eur(value) {
    return new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR" }).format(Number(value) || 0);
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
      trial: tR("rsp.statusTrial", "Proefperiode"),
      draft: tR("rsp.statusDraft", "Concept"),
      pending_approval: tR("rsp.statusPending", "In goedkeuring"),
      approved: tR("rsp.statusApproved", "Goedgekeurd"),
      paid: tR("rsp.statusPaid", "Uitbetaald"),
      disputed: tR("rsp.statusDisputed", "Betwist"),
      cancelled: tR("rsp.statusCancelled", "Geannuleerd"),
      accrual: tR("rsp.statusAccrual", "Opbouw"),
      correction: tR("rsp.statusCorrection", "Correctie"),
      clawback: tR("rsp.statusClawback", "Terugboeking")
    };
    const key = String(value || "draft");
    return `<span class="rsp-status rsp-status-${esc(key.replace(/_/g, "-"))}">${esc(labels[key] || key)}</span>`;
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
      window.WorkFlowProPlatformRouter?.showLogin();
      throw new Error(data.error || tR("rsp.sessionExpired", "Sessie verlopen"));
    }
    if (!response.ok) throw new Error(data.error || `${tR("rsp.error", "Fout")} ${response.status}`);
    return data;
  }

  function viewMeta(view) {
    return {
      dashboard: {
        eyebrow: tR("rsp.partnerWorkspace", "Partnerwerkruimte"),
        title: tR("rsp.dashboard", "Overzicht"),
        text: tR("rsp.dashboardIntro", "Volg klanten, activaties en commissies vanuit één rustige werkruimte.")
      },
      clients: {
        eyebrow: tR("rsp.customerManagement", "Klantenbeheer"),
        title: tR("rsp.myClients", "Mijn klanten"),
        text: tR("rsp.clientsIntro", "Bekijk uitsluitend de commerciële gegevens van klanten die aan jouw partneraccount zijn gekoppeld.")
      },
      commission: {
        eyebrow: tR("rsp.finance", "Financieel"),
        title: tR("rsp.commission", "Commissies"),
        text: tR("rsp.commissionIntro", "Volg opgebouwde commissie, uitbetalingen en correcties vanuit het grootboek.")
      },
      onboarding: {
        eyebrow: tR("rsp.onboarding", "Onboarding"),
        title: tR("rsp.createClient", "Nieuwe klant"),
        text: tR("rsp.onboardingIntro", "Maak een tenant en beheerder aan. De beheerder stelt daarna zelf veilig een wachtwoord in.")
      }
    }[view] || {};
  }

  function buildShell() {
    const root = document.getElementById("platform-reseller");
    if (!root) return;
    root.innerHTML = `
      <div class="rsp-layout">
        <aside class="rsp-sidebar" id="rspSidebar" aria-label="${esc(tR("rsp.partnerNavigation", "Partnernavigatie"))}">
          <div class="rsp-sidebar-brand">
            <span class="rsp-mark"><img src="/brand/one-symbol.svg" alt=""></span>
            <div>
              <strong>One <small>by Monargo</small></strong>
              <span>${esc(tR("rsp.reseller", "Reseller"))}</span>
            </div>
            <button type="button" class="rsp-sidebar-close" id="rspSidebarClose" aria-label="${esc(tR("rsp.closeMenu", "Menu sluiten"))}">×</button>
          </div>
          <nav class="rsp-nav">
            <span class="rsp-nav-label">${esc(tR("rsp.workspace", "Werkruimte"))}</span>
            <button type="button" class="rsp-nav-item active" data-rsp-view="dashboard"><span aria-hidden="true">▦</span>${esc(tR("rsp.dashboard", "Overzicht"))}</button>
            <button type="button" class="rsp-nav-item" data-rsp-view="clients"><span aria-hidden="true">◉</span>${esc(tR("rsp.myClients", "Mijn klanten"))}</button>
            <button type="button" class="rsp-nav-item" data-rsp-view="commission"><span aria-hidden="true">€</span>${esc(tR("rsp.commission", "Commissies"))}</button>
            <span class="rsp-nav-label">${esc(tR("rsp.grow", "Groei"))}</span>
            <button type="button" class="rsp-nav-item" data-rsp-view="onboarding"><span aria-hidden="true">＋</span>${esc(tR("rsp.createClient", "Nieuwe klant"))}</button>
          </nav>
          <div class="rsp-sidebar-foot">
            <span>${esc(tR("rsp.privacyTitle", "Privacy beschermd"))}</span>
            <small>${esc(tR("rsp.privacyText", "Je ziet geen operationele klant- of personeelsgegevens."))}</small>
          </div>
        </aside>
        <div class="rsp-mainarea">
          <header class="rsp-topbar">
            <div class="rsp-topbar-start">
              <button type="button" class="rsp-menu-toggle" id="rspMenuBtn" aria-label="${esc(tR("rsp.openMenu", "Menu openen"))}" aria-controls="rspSidebar" aria-expanded="false">☰</button>
              <div>
                <strong id="rspTopTitle">${esc(tR("rsp.dashboard", "Overzicht"))}</strong>
                <span id="rspName">${esc(tR("rsp.partnerPortal", "Partnerportaal"))}</span>
              </div>
            </div>
            <div class="rsp-actions">
              <button id="rspLangToggle" class="rsp-btn" type="button" title="NL / FR / EN">NL</button>
              <button id="rspTopCreate" class="rsp-btn rsp-btn-primary" type="button">${esc(tR("rsp.createClient", "Nieuwe klant"))}</button>
              <button id="rspLogout" class="rsp-btn rsp-btn-icon" type="button" aria-label="${esc(tR("rsp.logout", "Uitloggen"))}">↗</button>
            </div>
          </header>
          <main class="rsp-main" id="rspMain" tabindex="-1"></main>
        </div>
      </div>`;

    document.getElementById("rspLogout")?.addEventListener("click", () => {
      localStorage.removeItem("wfp_token");
      window.WorkFlowProPlatformRouter?.showLogin();
    });
    document.getElementById("rspMenuBtn")?.addEventListener("click", () => {
      document.getElementById("rspSidebar")?.classList.toggle("open");
    });
    document.getElementById("rspSidebarClose")?.addEventListener("click", () => {
      document.getElementById("rspSidebar")?.classList.remove("open");
      document.getElementById("rspMenuBtn")?.focus({ preventScroll: true });
    });
    document.getElementById("rspTopCreate")?.addEventListener("click", () => switchView("onboarding"));
    root.querySelectorAll("[data-rsp-view]").forEach(button => {
      button.addEventListener("click", () => switchView(button.dataset.rspView));
    });

    if (window.wfpI18n) {
      const paintLang = () => {
        const button = document.getElementById("rspLangToggle");
        if (button) button.textContent = window.wfpI18n.nextLang(window.wfpI18n.lang).toUpperCase();
      };
      paintLang();
      document.getElementById("rspLangToggle")?.addEventListener("click", () => window.wfpI18n.cycleLang());
      document.removeEventListener("wfp:langchange", _rspLangHandler);
      _rspLangHandler = () => buildShell();
      document.addEventListener("wfp:langchange", _rspLangHandler);
    }
    renderCurrent();
  }

  function switchView(view) {
    state.view = view;
    document.querySelectorAll("[data-rsp-view]").forEach(button => {
      const active = button.dataset.rspView === view;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    const meta = viewMeta(view);
    const title = document.getElementById("rspTopTitle");
    if (title) title.textContent = meta.title || "";
    renderCurrent();
  }

  async function loadData(force) {
    if (!force && state.clients && state.ledger) return;
    const [clients, ledger] = await Promise.all([
      api("GET", "/api/reseller/clients"),
      api("GET", "/api/reseller/commission").catch(() => ({ events: [], payouts: [], balance: { payable: 0, paid: 0, reserved: 0 } }))
    ]);
    state.clients = clients;
    state.ledger = ledger;
    const name = document.getElementById("rspName");
    if (name && clients.reseller) {
      name.textContent = tR("rsp.defaultCommission", "{name} · standaard {pct}% commissie")
        .replace("{name}", clients.reseller.name)
        .replace("{pct}", clients.reseller.defaultCommissionPct || 0);
    }
  }

  function pageHead(action) {
    const meta = viewMeta(state.view);
    return `
      <header class="rsp-page-head">
        <div>
          <span class="rsp-page-eyebrow">${esc(meta.eyebrow)}</span>
          <h1>${esc(meta.title)}</h1>
          <p>${esc(meta.text)}</p>
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

  function ledgerAmounts() {
    const ledger = state.ledger || {};
    const reserved = (ledger.payouts || [])
      .filter(payout => ["draft", "pending_approval", "approved"].includes(payout.status))
      .reduce((sum, payout) => sum + (Number(payout.amount) || 0), 0);
    return {
      available: Math.max(0, (Number(ledger.balance?.payable) || 0) - reserved),
      reserved,
      paid: Number(ledger.balance?.paid) || 0
    };
  }

  function clientRows(rows, limit) {
    const list = typeof limit === "number" ? rows.slice(0, limit) : rows;
    return list.map(row => `<tr>
      <td><strong class="rsp-client">${esc(row.name)}</strong><small>${esc(row.tenantId)}</small></td>
      <td><span class="rsp-plan">${esc(row.plan)}</span></td>
      <td>${status(row.status)}</td>
      <td>${row.unpriced ? esc(tR("rsp.onRequest", "Op aanvraag")) : eur(row.mrr)}</td>
      <td>${esc(`${row.commissionPct}%`)}</td>
      <td><strong>${eur(row.commission)}</strong></td>
    </tr>`).join("");
  }

  function renderDashboard() {
    const data = state.clients;
    const ledger = state.ledger || {};
    const amounts = ledgerAmounts();
    const rows = data.rows || [];
    const attention = rows.filter(row => row.status !== "active");
    const payouts = ledger.payouts || [];
    return `
      ${pageHead(`<button type="button" class="rsp-btn rsp-btn-primary" data-rsp-action="onboarding">${esc(tR("rsp.createClient", "Nieuwe klant"))}</button>`)}
      <section class="rsp-kpis">
        ${metric(tR("rsp.myClients", "Mijn klanten"), data.clientCount || 0, tR("rsp.activeTrial", "actief en proefperiode"), "blue")}
        ${metric(tR("rsp.subMrr", "Abonnement per maand"), eur(data.totalMrr), data.unpricedCount ? tR("rsp.unpriced", "{count} op aanvraag").replace("{count}", data.unpricedCount) : tR("rsp.allPriced", "alle klanten geprijsd"), "violet")}
        ${metric(tR("rsp.commissionMonth", "Commissie per maand"), eur(data.totalCommission), tR("rsp.yourEarnings", "verwachte opbrengst"), "green")}
        ${metric(tR("rsp.payableBalance", "Beschikbaar saldo"), eur(amounts.available), tR("rsp.fromLedger", "volgens het grootboek"), "amber")}
      </section>
      <div class="rsp-dashboard-grid">
        <section class="rsp-card">
          <div class="rsp-card-head">
            <div><span>${esc(tR("rsp.customerSnapshot", "Klantenoverzicht"))}</span><small>${esc(tR("rsp.customerSnapshotText", "Recente commerciële status"))}</small></div>
            <button type="button" class="rsp-link-btn" data-rsp-action="clients">${esc(tR("rsp.viewAll", "Alles bekijken"))}</button>
          </div>
          <div class="rsp-table-wrap">
            <table class="rsp-table">
              <thead><tr><th>${esc(tR("adm.thCustomer", "Klant"))}</th><th>${esc(tR("rsp.plan", "Plan"))}</th><th>${esc(tR("adm.status", "Status"))}</th><th>MRR</th><th>${esc(tR("rsp.commissionPct", "Commissie"))}</th><th>${esc(tR("rsp.commissionMo", "Per maand"))}</th></tr></thead>
              <tbody>${clientRows(rows, 5) || `<tr><td colspan="6" class="rsp-empty">${esc(tR("rsp.noClientsShort", "Nog geen klanten gekoppeld."))}</td></tr>`}</tbody>
            </table>
          </div>
        </section>
        <aside class="rsp-side-stack">
          <section class="rsp-card rsp-attention-card">
            <div class="rsp-card-head"><div><span>${esc(tR("rsp.attention", "Aandacht"))}</span><small>${esc(tR("rsp.attentionText", "Onboarding en activatie"))}</small></div></div>
            <div class="rsp-card-body">
              ${attention.length ? attention.slice(0, 4).map(row => `<button type="button" class="rsp-attention-row" data-rsp-action="clients"><span>${esc(row.name)}</span>${status(row.status)}</button>`).join("") : `<div class="rsp-success-note"><span aria-hidden="true">✓</span><div><strong>${esc(tR("rsp.allActive", "Alles loopt goed"))}</strong><small>${esc(tR("rsp.noActivationIssues", "Geen activaties vragen aandacht."))}</small></div></div>`}
            </div>
          </section>
          <section class="rsp-card">
            <div class="rsp-card-head"><div><span>${esc(tR("rsp.latestPayout", "Laatste uitbetaling"))}</span><small>${esc(tR("rsp.payoutHistory", "Status vanuit het grootboek"))}</small></div></div>
            <div class="rsp-card-body">
              ${payouts[0] ? `<div class="rsp-payout-highlight"><strong>${eur(payouts[0].amount)}</strong>${status(payouts[0].status)}<span>${esc(date(payouts[0].paidAt || payouts[0].createdAt))}</span></div>` : `<div class="rsp-empty-state"><strong>${esc(tR("rsp.noPayouts", "Nog geen uitbetalingen"))}</strong><span>${esc(tR("rsp.noPayoutsText", "Nieuwe uitbetalingen verschijnen hier automatisch."))}</span></div>`}
            </div>
          </section>
        </aside>
      </div>`;
  }

  function renderClients() {
    const rows = state.clients.rows || [];
    return `
      ${pageHead(`<button type="button" class="rsp-btn rsp-btn-primary" data-rsp-action="onboarding">${esc(tR("rsp.createClient", "Nieuwe klant"))}</button>`)}
      <section class="rsp-card">
        <div class="rsp-card-head">
          <div><span>${esc(tR("rsp.clientsCommission", "Klanten en commissie"))}</span><small>${esc(tR("rsp.commercialOnly", "Uitsluitend commerciële gegevens"))}</small></div>
          <span class="rsp-count">${esc(String(rows.length))}</span>
        </div>
        <div class="rsp-table-wrap">
          <table class="rsp-table">
            <thead><tr><th>${esc(tR("adm.thCustomer", "Klant"))}</th><th>${esc(tR("rsp.plan", "Plan"))}</th><th>${esc(tR("adm.status", "Status"))}</th><th>MRR</th><th>${esc(tR("rsp.commissionPct", "Commissie"))}</th><th>${esc(tR("rsp.commissionMo", "Per maand"))}</th></tr></thead>
            <tbody>${clientRows(rows) || `<tr><td colspan="6" class="rsp-empty">${esc(tR("rsp.noClients", "Nog geen klanten. Maak je eerste klant aan."))}</td></tr>`}</tbody>
          </table>
        </div>
      </section>`;
  }

  function renderCommission() {
    const ledger = state.ledger || {};
    const amounts = ledgerAmounts();
    const events = [...(ledger.events || [])].reverse();
    const payouts = ledger.payouts || [];
    return `
      ${pageHead("")}
      <section class="rsp-kpis rsp-kpis-three">
        ${metric(tR("rsp.payableBalance", "Beschikbaar saldo"), eur(amounts.available), tR("rsp.readyForPayout", "beschikbaar voor uitbetaling"), "green")}
        ${metric(tR("rsp.reservedBalance", "Gereserveerd"), eur(amounts.reserved), tR("rsp.inOpenPayouts", "in openstaande uitbetalingen"), "amber")}
        ${metric(tR("rsp.paidTotal", "Uitbetaald"), eur(amounts.paid), tR("rsp.historicalTotal", "historisch totaal"), "blue")}
      </section>
      <div class="rsp-ledger-grid">
        <section class="rsp-card">
          <div class="rsp-card-head"><div><span>${esc(tR("rsp.ledger", "Grootboek"))}</span><small>${esc(tR("rsp.ledgerText", "Opbouw, correcties en terugboekingen"))}</small></div></div>
          <div class="rsp-table-wrap">
            <table class="rsp-table">
              <thead><tr><th>${esc(tR("rsp.date", "Datum"))}</th><th>${esc(tR("rsp.period", "Periode"))}</th><th>${esc(tR("rsp.type", "Type"))}</th><th>${esc(tR("rsp.client", "Klant"))}</th><th>${esc(tR("rsp.amount", "Bedrag"))}</th></tr></thead>
              <tbody>${events.map(event => `<tr><td>${esc(date(event.createdAt))}</td><td>${esc(event.period || "")}</td><td>${status(event.type)}</td><td>${esc(event.clientName || event.clientTenantId || "")}</td><td><strong class="${Number(event.amount) < 0 ? "rsp-negative" : "rsp-positive"}">${eur(event.amount)}</strong></td></tr>`).join("") || `<tr><td colspan="5" class="rsp-empty">${esc(tR("rsp.noLedgerEvents", "Nog geen commissiebewegingen."))}</td></tr>`}</tbody>
            </table>
          </div>
        </section>
        <section class="rsp-card">
          <div class="rsp-card-head"><div><span>${esc(tR("rsp.payouts", "Uitbetalingen"))}</span><small>${esc(tR("rsp.payoutsText", "Historiek en betaalreferenties"))}</small></div></div>
          <div class="rsp-card-body rsp-payout-list">
            ${payouts.map(payout => `<article><div><strong>${eur(payout.amount)}</strong><span>${esc(payout.period || date(payout.createdAt))}</span></div><div>${status(payout.status)}<small>${esc(payout.paymentRef || tR("rsp.noPaymentRef", "Nog geen betaalreferentie"))}</small></div></article>`).join("") || `<div class="rsp-empty-state"><strong>${esc(tR("rsp.noPayouts", "Nog geen uitbetalingen"))}</strong><span>${esc(tR("rsp.noPayoutsText", "Nieuwe uitbetalingen verschijnen hier automatisch."))}</span></div>`}
          </div>
        </section>
      </div>`;
  }

  function renderOnboarding() {
    return `
      ${pageHead("")}
      <div class="rsp-onboarding-layout">
        <section class="rsp-card">
          <div class="rsp-card-head"><div><span>${esc(tR("rsp.clientDetails", "Klantgegevens"))}</span><small>${esc(tR("rsp.clientDetailsText", "Tenant, plan en eerste beheerder"))}</small></div><span class="rsp-step">1</span></div>
          <form class="rsp-card-body rsp-form" id="rspClientForm">
            <label><span>${esc(tR("rsp.companyName", "Bedrijfsnaam"))}</span><input name="name" autocomplete="organization" required placeholder="${esc(tR("rsp.clientCompanyPh", "Bedrijfsnaam klant"))}"></label>
            <label><span>${esc(tR("rsp.plan", "Plan"))}</span><select name="plan"><option value="starter">Starter</option><option value="business" selected>Business</option><option value="enterprise">Enterprise</option></select></label>
            <label><span>${esc(tR("rsp.adminEmail", "E-mail beheerder"))}</span><input name="adminEmail" type="email" autocomplete="email" required placeholder="${esc(tR("rsp.adminEmailPh", "Login-e-mail beheerder klant"))}"></label>
            <label><span>${esc(tR("rsp.adminName", "Naam beheerder"))}</span><input name="adminName" autocomplete="name" placeholder="${esc(tR("rsp.adminNamePh", "Naam beheerder"))}"></label>
            <div class="rsp-span2 rsp-form-note"><span aria-hidden="true">i</span><p>${esc(tR("rsp.activationNote", "De beheerder ontvangt een activatiemail en stelt zelf een wachtwoord in."))}</p></div>
            <div class="rsp-span2 rsp-form-actions"><button class="rsp-btn rsp-btn-primary" type="submit">${esc(tR("rsp.createClientBtn", "Klant aanmaken"))}</button><span id="rspClientMessage" class="rsp-msg" role="status"></span></div>
          </form>
        </section>
        <aside class="rsp-onboarding-aside">
          <section class="rsp-card"><div class="rsp-card-body"><span class="rsp-aside-index">1</span><strong>${esc(tR("rsp.stepTenant", "Tenant wordt aangemaakt"))}</strong><p>${esc(tR("rsp.stepTenantText", "Het gekozen pakket en jouw commissie worden centraal gekoppeld."))}</p></div></section>
          <section class="rsp-card"><div class="rsp-card-body"><span class="rsp-aside-index">2</span><strong>${esc(tR("rsp.stepActivation", "Beheerder activeert"))}</strong><p>${esc(tR("rsp.stepActivationText", "De klant kiest zelf een veilig wachtwoord via de activatiemail."))}</p></div></section>
          <section class="rsp-card"><div class="rsp-card-body"><span class="rsp-aside-index">3</span><strong>${esc(tR("rsp.stepFollowup", "Jij volgt commercieel op"))}</strong><p>${esc(tR("rsp.stepFollowupText", "Status, MRR en commissie verschijnen in jouw klantenoverzicht."))}</p></div></section>
        </aside>
      </div>`;
  }

  function bindView() {
    document.querySelectorAll("[data-rsp-action]").forEach(button => {
      button.addEventListener("click", () => switchView(button.dataset.rspAction));
    });
    const form = document.getElementById("rspClientForm");
    form?.addEventListener("submit", async event => {
      event.preventDefault();
      const message = document.getElementById("rspClientMessage");
      const submit = form.querySelector('button[type="submit"]');
      const payload = Object.fromEntries(new FormData(form).entries());
      message.textContent = "";
      submit.disabled = true;
      submit.textContent = tR("rsp.creating", "Klant wordt aangemaakt...");
      try {
        const result = await api("POST", "/api/reseller/clients", payload);
        state.clients = null;
        state.ledger = null;
        if (window.showToast) {
          window.showToast(result.activationLink ? tR("rsp.clientCreatedActivation", "Klant aangemaakt. De activatielink is beschikbaar in de ontwikkelomgeving.") : tR("rsp.clientCreatedShort", "Klant aangemaakt."), "success");
        }
        await loadData(true);
        switchView("clients");
      } catch (error) {
        message.textContent = error.message;
        submit.disabled = false;
        submit.textContent = tR("rsp.createClientBtn", "Klant aanmaken");
      }
    });
  }

  async function renderCurrent() {
    const main = document.getElementById("rspMain");
    if (!main || state.loading) return;
    state.loading = true;
    main.setAttribute("aria-busy", "true");
    main.innerHTML = `<div class="rsp-loading"><span class="adm-spinner"></span>${esc(tR("adm.loading", "Laden..."))}</div>`;
    try {
      await loadData(false);
      const renderers = {
        dashboard: renderDashboard,
        clients: renderClients,
        commission: renderCommission,
        onboarding: renderOnboarding
      };
      main.innerHTML = renderers[state.view]();
      bindView();
      main.focus({ preventScroll: true });
    } catch (error) {
      main.innerHTML = `<section class="rsp-error"><strong>${esc(tR("rsp.couldNotLoad", "De partnerwerkruimte kon niet laden."))}</strong><p>${esc(error.message)}</p><button type="button" class="rsp-btn" id="rspRetry">${esc(tR("rsp.retry", "Opnieuw proberen"))}</button></section>`;
      document.getElementById("rspRetry")?.addEventListener("click", () => {
        state.clients = null;
        state.ledger = null;
        renderCurrent();
      });
    } finally {
      state.loading = false;
      main.removeAttribute("aria-busy");
    }
  }

  window.wfp_resellerInit = buildShell;
}());
