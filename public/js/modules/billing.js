(function () {
  let deps = {};

  function configure(nextDeps) {
    deps = nextDeps || {};
  }

  function renderPricingQuote(quote) {
    if (!quote.planLabel) {
      deps.el("pricingQuote").innerHTML = "";
      return;
    }
    deps.el("pricingQuote").innerHTML = `
      <article class="quote-card">
        <div>
          <p class="eyebrow">Pricing package</p>
          <h3>${quote.planLabel}</h3>
          <small>${quote.seats} billable seats - ${quote.includedSeats} inbegrepen - ${quote.extraSeats} extra</small>
        </div>
        <div class="quote-price">
          <strong>${quote.enterpriseCustom ? "Maatwerk" : `EUR ${Number(quote.annualTotal || 0).toFixed(2)}`}</strong>
          <small>${quote.enterpriseCustom ? "Jaarcontract op offerte" : `incl. ${Math.round((quote.vatRate || 0) * 100)}% btw`}</small>
        </div>
      </article>
      <div class="quote-features">
        ${(quote.features || []).map(feature => `<span>${feature}</span>`).join("")}
      </div>
    `;
  }

  function render() {
    const billing = deps.state.billing || {};
    const quote = deps.state.billingQuote || {};
    const invoices = billing.invoices || [];
    const failedPayments = billing.failedPayments || [];
    const openFailedPayments = failedPayments.filter(row => row.status === "open");
    const missingPeppol = invoices.filter(invoice => invoice.peppolStatus && !["sent", "accepted", "mock-sent"].includes(invoice.peppolStatus));
    const readyForCharge = billing.paymentMethodTokenized && billing.autoCharge && !openFailedPayments.length;
    const readyForCompliance = billing.dpaAccepted && !(billing.gdprRequests || []).some(row => row.status !== "completed");
    const billingAction = !billing.paymentMethodTokenized
      ? { title: "Betaalmethode ontbreekt", detail: "Maak eerst een Stripe SetupIntent en bewaar alleen het token.", tone: "warning" }
      : openFailedPayments.length
        ? { title: `${openFailedPayments.length} mislukte betaling opvolgen`, detail: "Gebruik dunning, retry of markeer opgelost.", tone: "critical" }
        : missingPeppol.length
          ? { title: `${missingPeppol.length} Peppol status nakijken`, detail: "Factuurstatus moet traceerbaar zijn voor Belgische KMO's.", tone: "warning" }
          : !billing.dpaAccepted
            ? { title: "DPA nog accepteren", detail: "Leg DPA-acceptatie vast voor pilot of productie.", tone: "warning" }
            : { title: "Billing klaar voor pilot", detail: "Betaalmethode, compliance en factuurflow zijn operationeel.", tone: "success" };
    const cards = [
      ["Status", billing.billingStatus || "trial"],
      ["Plan", quote.planLabel || billing.plan || "business"],
      ["Seats", quote.seats ?? "-"],
      ["Betaalmethode", billing.paymentMethodTokenized ? "Tokenized" : "Ontbreekt"],
      ["Auto-charge", billing.autoCharge ? "Actief" : "Niet actief"],
      ["Facturen", billing.invoices?.length || 0],
      ["Peppol", billing.peppolProvider || "mock"],
      ["DPA", billing.dpaAccepted ? "Geaccepteerd" : "Open"],
      ["Jaarprijs", quote.enterpriseCustom ? "Maatwerk" : `EUR ${Number(quote.annualTotal || 0).toFixed(2)}`]
    ];
    deps.el("billingCards").innerHTML = cards.map(([label, value]) => `
      <article class="metric">
        <span class="metric-label">${label}</span>
        <strong>${value}</strong>
        <small>Tenant ${billing.tenantId || deps.tenantId}</small>
      </article>
    `).join("");

    renderPricingQuote(quote);

    deps.el("billingFocus").innerHTML = `
      <section class="billing-focus-grid">
        <article class="billing-focus-card primary">
          <p class="eyebrow">Billing readiness</p>
          <h2>${deps.escapeHtml(billingAction.title)}</h2>
          <p>${deps.escapeHtml(billingAction.detail)}</p>
          <span class="status-badge ${billingAction.tone}">${readyForCharge && readyForCompliance ? "Go" : "Actie nodig"}</span>
        </article>
        <article class="billing-focus-card">
          <span>Betaling</span>
          <strong>${readyForCharge ? "Klaar" : "Open"}</strong>
          <small>${billing.paymentMethodTokenized ? "Token opgeslagen" : "Geen token"}</small>
        </article>
        <article class="billing-focus-card">
          <span>Peppol</span>
          <strong>${missingPeppol.length}</strong>
          <small>facturen met aandacht</small>
        </article>
        <article class="billing-focus-card">
          <span>Compliance</span>
          <strong>${readyForCompliance ? "Klaar" : "Open"}</strong>
          <small>${billing.dpaAccepted ? "DPA ok" : "DPA ontbreekt"}</small>
        </article>
      </section>
    `;

    deps.renderList("invoiceRows", invoices, invoice => `
      <div class="data-row">
        <strong>${invoice.id} - EUR ${Number(invoice.net || 0).toFixed(2)}</strong>
        <small>${invoice.status} - Peppol: ${invoice.peppolStatus} - pogingen ${invoice.peppolAttempts || 0} - vervalt ${invoice.dueDate}</small>
        ${invoice.peppolError ? `<small>Peppol fout: ${invoice.peppolError}</small>` : ""}
        <div class="row-actions">
          <button class="small-action" data-peppol="${invoice.id}" type="button">Peppol versturen</button>
          <button class="small-action" data-payment-failed="${invoice.id}" type="button">Payment failed</button>
        </div>
      </div>
    `, "Nog geen facturen.");

    deps.renderList("contractRows", billing.contractEvents || [], event => `
      <div class="data-row">
        <strong>${event.label}</strong>
        <small>${event.from} naar ${event.to} - ${event.at} - ${event.by}</small>
        ${event.reason ? `<small>${event.reason}</small>` : ""}
      </div>
    `, "Nog geen contract events.");

    const complianceRows = [
      ...(billing.dpaAccepted ? [{ kind: "dpa", title: "DPA geaccepteerd", detail: billing.dpaAcceptedAt }] : [{ kind: "dpa", title: "DPA nog open", detail: "Nog niet geaccepteerd" }]),
      ...(billing.gdprRequests || []).map(request => ({
        kind: "gdpr",
        id: request.id,
        title: `GDPR ${request.type}`,
        detail: `${request.subjectEmail} - ${request.status}${request.processedAt ? ` - verwerkt ${request.processedAt}` : ""}`,
        status: request.status,
        result: request.result
      })),
      ...(billing.failedPayments || []).map(payment => ({
        kind: "payment",
        id: payment.id,
        title: "Failed payment",
        detail: `${payment.reason} - ${payment.status} - stage ${payment.dunningStage || 1}`,
        status: payment.status,
        nextActionAt: payment.nextActionAt,
        events: payment.events || []
      }))
    ];
    deps.renderList("complianceRows", complianceRows, row => `
      <div class="data-row">
        <strong>${row.title}</strong>
        <small>${row.detail}</small>
        ${row.result?.export?.counts ? `<small>Export: ${Object.entries(row.result.export.counts).map(([key, value]) => `${key} ${value}`).join(", ")}</small>` : ""}
        ${row.result?.anonymizedUsers !== undefined ? `<small>Geanonimiseerd: ${row.result.anonymizedUsers} gebruiker(s)</small>` : ""}
        ${row.nextActionAt ? `<small>Volgende actie: ${row.nextActionAt}</small>` : ""}
        ${row.kind === "gdpr" && row.status !== "completed" ? `<div class="row-actions"><button class="small-action" data-gdpr-process="${row.id}" type="button">Verwerk verzoek</button></div>` : ""}
        ${row.kind === "payment" && row.status === "open" ? `<div class="row-actions">
          <button class="small-action" data-dunning-action="reminder" data-dunning-id="${row.id}" type="button">Reminder</button>
          <button class="small-action" data-dunning-action="retry" data-dunning-id="${row.id}" type="button">Retry</button>
          <button class="small-action" data-dunning-action="resolve" data-dunning-id="${row.id}" type="button">Opgelost</button>
        </div>` : ""}
      </div>
    `, "Nog geen compliance events.");

    deps.renderList("peppolEventRows", billing.peppolEvents || [], event => `
      <div class="data-row">
        <strong>${event.invoiceId} - ${event.status}</strong>
        <small>${event.at} - ${event.provider} - ${event.message || event.providerReference || ""}</small>
      </div>
    `, "Nog geen Peppol events.");

    deps.renderList("stripeEventRows", billing.stripeEvents || [], event => `
      <div class="data-row">
        <strong>${event.type} - ${event.status}</strong>
        <small>${event.at} - ${event.action} - ${event.id}</small>
      </div>
    `, "Nog geen Stripe events.");

    document.querySelectorAll("[data-peppol]").forEach(button => {
      button.addEventListener("click", () => sendPeppolInvoice(button.dataset.peppol));
    });
    document.querySelectorAll("[data-payment-failed]").forEach(button => {
      button.addEventListener("click", () => markPaymentFailed(button.dataset.paymentFailed));
    });
    document.querySelectorAll("[data-gdpr-process]").forEach(button => {
      button.addEventListener("click", () => processGdprRequest(button.dataset.gdprProcess));
    });
    document.querySelectorAll("[data-dunning-id]").forEach(button => {
      button.addEventListener("click", () => advanceDunning(button.dataset.dunningId, button.dataset.dunningAction));
    });
  }

  async function refresh() {
    if (!deps.token()) {
      deps.setBillingNotice("Login met de demo admin om billing te beheren.", false);
      return;
    }
    const [summary, quote] = await Promise.all([
      deps.api(`/api/tenants/${deps.tenantId}/billing/summary`),
      deps.api(`/api/tenants/${deps.tenantId}/billing/quote`)
    ]);
    deps.state.billing = summary.billing;
    deps.state.billingQuote = quote.quote;
    render();
    deps.setBillingNotice("Billing data is bijgewerkt.");
  }

  async function createSetupIntent() {
    if (!deps.token()) {
      deps.setBillingNotice("Login eerst met de demo admin.", false);
      return;
    }
    const result = await deps.api(`/api/tenants/${deps.tenantId}/billing/setup-intent`, { method: "POST", body: "{}" });
    deps.setBillingNotice(`SetupIntent klaar: ${result.setupIntent.status}`);
  }

  async function submit(form, endpoint, successMessage) {
    if (!deps.token()) {
      deps.setBillingNotice("Login eerst met de demo admin.", false);
      return;
    }
    try {
      await deps.api(endpoint, { method: "POST", body: JSON.stringify(deps.formData(form)) });
      form.reset();
      deps.setBillingNotice(successMessage);
      await refresh();
    } catch (error) {
      deps.setBillingNotice(error.message, false);
    }
  }

  async function transitionContract(form) {
    if (!deps.token()) {
      deps.setBillingNotice("Login eerst met de demo admin.", false);
      return;
    }
    try {
      const result = await deps.api(`/api/tenants/${deps.tenantId}/billing/contract-state`, {
        method: "POST",
        body: JSON.stringify(deps.formData(form))
      });
      deps.setBillingNotice(`Contractstatus: ${result.result.event.from} naar ${result.result.event.to}`);
      await refresh();
      await deps.refreshPortal();
    } catch (error) {
      deps.setBillingNotice(error.message, false);
    }
  }

  async function sendPeppolInvoice(invoiceId) {
    try {
      const result = await deps.api(`/api/tenants/${deps.tenantId}/billing/peppol/${invoiceId}`, { method: "POST", body: "{}" });
      deps.setBillingNotice(result.result.event.ok ? "Peppol status bijgewerkt." : `Peppol fout: ${result.result.event.message}`, result.result.event.ok);
      await refresh();
    } catch (error) {
      deps.setBillingNotice(error.message, false);
    }
  }

  async function markPaymentFailed(invoiceId) {
    try {
      await deps.api(`/api/tenants/${deps.tenantId}/billing/payment-failed`, {
        method: "POST",
        body: JSON.stringify({ invoiceId, reason: "Stripe test failure" })
      });
      deps.setBillingNotice("Failed payment geregistreerd.");
      await refresh();
    } catch (error) {
      deps.setBillingNotice(error.message, false);
    }
  }

  async function processGdprRequest(requestId) {
    try {
      await deps.api(`/api/tenants/${deps.tenantId}/compliance/gdpr-requests/${requestId}/process`, { method: "POST", body: "{}" });
      deps.setBillingNotice("GDPR verzoek verwerkt.");
      await refresh();
      await deps.refreshAdmin();
    } catch (error) {
      deps.setBillingNotice(error.message, false);
    }
  }

  async function advanceDunning(paymentId, action) {
    try {
      await deps.api(`/api/tenants/${deps.tenantId}/billing/failed-payments/${paymentId}/dunning`, {
        method: "POST",
        body: JSON.stringify({ action, note: `Actie via billing scherm: ${action}` })
      });
      deps.setBillingNotice(`Dunning actie verwerkt: ${action}`);
      await refresh();
      await deps.refreshPortal();
    } catch (error) {
      deps.setBillingNotice(error.message, false);
    }
  }

  window.WorkFlowProBilling = {
    configure,
    render,
    refresh,
    createSetupIntent,
    submit,
    transitionContract,
    sendPeppolInvoice,
    markPaymentFailed,
    processGdprRequest,
    advanceDunning
  };
}());
