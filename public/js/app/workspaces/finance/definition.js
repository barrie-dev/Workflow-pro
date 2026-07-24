/* ============================================================
   IA-13 · Financieel domein (IA handover §7/§8)

   Contract: "Invoices, payments, purchase, Peppol and conditional
   progress claims."
   Acceptatie: "Invoice/Peppol full-chain preserved; usage billing hidden
   from tenant."

   Het scherpste besluit hier is D-09, en het is subtiel genoeg om
   expliciet op te schrijven.

   Peppol heeft TWEE gezichten:

     · OPERATIONEEL · "is mijn factuur aangekomen bij de klant?" Dat is
       gewoon werk van de klant zelf, hoort in het financiële domein en
       is zichtbaar voor wie facturen mag zien.

     · COMMERCIEEL · wat kost een verzending ons bij de provider, welke
       marge zit erop, hoeveel verbruikt deze tenant. Dat is PLATFORM-
       informatie. Een klant die zijn eigen kostprijs per document ziet,
       ziet ook onze inkoop en dus onze marge.

   Diezelfde scheiding geldt voor Mona (D-08): functionele beschikbaarheid
   mag de tenant zien, credits en verbruik nooit · dat is uitsluitend
   Super Admin.

   Deze module maakt die grens toetsbaar in plaats van hoopvol.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpWorkspaces = root.wfpWorkspaces || {}; root.wfpWorkspaces.finance = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const DEFINITION = {
    id: "finance.invoices",
    recordBase: "/app/finance/invoices",
    idParam: "invoiceId",
    defaultTab: "overview",
    tabs: [
      { id: "overview", labelKey: "invoice.tab.overview", permission: "invoices.view" },
      { id: "lines", labelKey: "invoice.tab.lines", permission: "invoices.view" },
      { id: "payments", labelKey: "invoice.tab.payments", permission: "payments.view", countSource: "invoice.payments" },
      { id: "delivery", labelKey: "invoice.tab.delivery", permission: "invoices.view", countSource: "invoice.delivery" },
      { id: "reminders", labelKey: "invoice.tab.reminders", permission: "invoices.view", countSource: "invoice.reminders" },
      { id: "files", labelKey: "invoice.tab.files", permission: "invoices.view", countSource: "invoice.files" },
      { id: "activity", labelKey: "invoice.tab.activity", permission: "invoices.view" },
    ],
  };

  /**
   * Peppol-velden, gesplitst naar wie ze mag zien.
   *
   * operational · de tenant mag dit zien: is het verstuurd, aangekomen,
   *               afgewezen, en waarom.
   * platform    · uitsluitend Super Admin: providerkosten, marge, tarief,
   *               verbruik.
   */
  const PEPPOL_FIELDS = {
    operational: ["peppolStatus", "peppolSentAt", "peppolDeliveredAt", "peppolAttempts", "peppolErrorCode", "peppolErrorMessage", "peppolDocumentId", "peppolReceiverId"],
    platform: ["peppolProviderCost", "peppolUnitPrice", "peppolMargin", "peppolBillableUnits", "peppolProviderInvoiceRef", "peppolTariffPlan"],
  };

  /** Mona-velden. D-08: credits en verbruik zijn Super Admin ONLY. */
  const MONA_FIELDS = {
    operational: ["monaAvailable", "monaEnabled"],
    platform: ["monaCredits", "monaCreditsUsed", "monaCreditLimit", "monaBudget", "monaProviderSpend", "monaTokensUsed"],
  };

  const PLATFORM_ONLY_FIELDS = [...PEPPOL_FIELDS.platform, ...MONA_FIELDS.platform];

  function isSuperAdmin(ctx) {
    return !!(ctx && (ctx.portal === "super-admin" || ctx.role === "super_admin"));
  }

  /**
   * Projecteer een record naar wat deze gebruiker mag zien.
   *
   * Een tenantgebruiker krijgt de platformvelden NIET · ze worden
   * weggelaten, niet genuld. Een genuld kostenveld vertelt nog steeds dat
   * er een kostprijs bestaat en hoe hij heet.
   */
  function projectForViewer(record, ctx) {
    if (isSuperAdmin(ctx)) return { ...(record || {}) };
    const verboden = new Set(PLATFORM_ONLY_FIELDS);
    const uit = {};
    for (const [k, v] of Object.entries(record || {})) if (!verboden.has(k)) uit[k] = v;
    return uit;
  }

  /**
   * Mag dit veld getoond worden aan deze kijker? Wordt gebruikt door de
   * veldrenderer, zodat een nieuw platformveld niet per ongeluk in een
   * tenantscherm belandt.
   */
  function fieldVisible(fieldName, ctx) {
    if (PLATFORM_ONLY_FIELDS.includes(fieldName)) return isSuperAdmin(ctx);
    return true;
  }

  /**
   * De operationele Peppol-status voor het bezorgingstabblad. Dit is wat
   * de klant WEL mag weten: waar staat mijn document, en als het misging,
   * waarom en wat kan ik eraan doen.
   */
  function deliveryStatus(record, ctx) {
    const zichtbaar = projectForViewer(record, ctx);
    const status = zichtbaar.peppolStatus || "not_sent";
    return {
      status,
      sentAt: zichtbaar.peppolSentAt || null,
      deliveredAt: zichtbaar.peppolDeliveredAt || null,
      attempts: zichtbaar.peppolAttempts || 0,
      errorCode: zichtbaar.peppolErrorCode || null,
      // Een fout zonder handelingsperspectief is een doodlopende melding.
      actionKey: status === "failed" ? "peppol.action.fix_and_resend"
        : status === "rejected" ? "peppol.action.contact_customer" : null,
    };
  }

  /**
   * Vorderingsstaten zijn CONDITIONEEL: alleen zichtbaar wanneer de
   * bouwmodule vrijgegeven is. Niet elke klant werkt met vorderingsstaten,
   * en een leeg menu-item is een vraag die niemand hoefde te stellen.
   */
  function progressClaimsVisible(ctx) {
    const e = (ctx && ctx.entitlements) || [];
    return e.includes("progress_claims") && e.includes("construction");
  }

  return {
    DEFINITION, PEPPOL_FIELDS, MONA_FIELDS, PLATFORM_ONLY_FIELDS,
    isSuperAdmin, projectForViewer, fieldVisible, deliveryStatus, progressClaimsVisible,
  };
});
