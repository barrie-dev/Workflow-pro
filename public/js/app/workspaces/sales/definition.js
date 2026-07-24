/* ============================================================
   IA-08 · Verkoopdomein en offertewerkruimte (IA handover §7/§8)

   Contract: "Pipeline, quotes, contracts, catalogue and pricing."
   Acceptatie: "Accepted quote version immutable; project creation
   traceable."

   Twee harde regels.

   1. EEN GEACCEPTEERDE OFFERTEVERSIE IS ONVERANDERLIJK.
      Wat de klant tekende, blijft staan. Wil je iets wijzigen, dan maak
      je een nieuwe versie of een meerwerk-order · je bewerkt de oude
      niet. Dat is geen administratieve netheid: bij een geschil is de
      getekende versie het bewijsstuk.

   2. PROJECTCREATIE IS TRACEERBAAR.
      Een project dat uit een offerte ontstaat, draagt de exacte
      offerteversie waaruit het voortkwam. Zonder dat spoor kun je later
      niet zeggen welke afspraken je aan het uitvoeren bent.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpWorkspaces = root.wfpWorkspaces || {}; root.wfpWorkspaces.sales = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const DEFINITION = {
    id: "sales.quotes",
    recordBase: "/app/sales/quotes",
    idParam: "quoteId",
    defaultTab: "overview",
    tabs: [
      { id: "overview", labelKey: "quote.tab.overview", permission: "quotes.view" },
      { id: "versions", labelKey: "quote.tab.versions", permission: "quotes.view", countSource: "quote.versions" },
      { id: "lines", labelKey: "quote.tab.lines", permission: "quotes.view" },
      { id: "change-orders", labelKey: "quote.tab.change_orders", permission: "quotes.view", countSource: "quote.change_orders" },
      { id: "signature", labelKey: "quote.tab.signature", permission: "quotes.view" },
      { id: "files", labelKey: "quote.tab.files", permission: "quotes.view", countSource: "quote.files" },
      { id: "activity", labelKey: "quote.tab.activity", permission: "quotes.view" },
    ],
  };

  // Een versie is definitief zodra ze de deur uit is of getekend is.
  // "draft" is de enige toestand waarin bewerken nog eerlijk is.
  const MUTABLE_VERSION_STATES = ["draft"];
  const SIGNED_STATES = ["accepted", "signed"];

  /**
   * Mag deze offerteversie nog gewijzigd worden?
   *
   * @returns {{ ok, code }} · code benoemt WAAROM niet, zodat de UI kan
   *   uitleggen wat de gebruiker wél kan doen (nieuwe versie, meerwerk).
   */
  function canEditVersion(version) {
    if (!version) return { ok: false, code: "UNKNOWN_VERSION" };
    if (SIGNED_STATES.includes(version.status)) return { ok: false, code: "ACCEPTED_VERSION_IMMUTABLE" };
    if (!MUTABLE_VERSION_STATES.includes(version.status)) return { ok: false, code: "SENT_VERSION_IMMUTABLE" };
    return { ok: true, code: null };
  }

  /**
   * Wat kan de gebruiker doen als hij niet mag bewerken? De UI hoort een
   * uitweg te tonen, geen doodlopende foutmelding.
   */
  function alternativesFor(version) {
    const uit = canEditVersion(version);
    if (uit.ok) return [];
    if (uit.code === "ACCEPTED_VERSION_IMMUTABLE") return ["quote.new_change_order", "quote.duplicate_as_new_version"];
    if (uit.code === "SENT_VERSION_IMMUTABLE") return ["quote.duplicate_as_new_version"];
    return [];
  }

  /**
   * Het spoor van offerte naar project. Een project dat uit een offerte
   * ontstaat, MOET de exacte versie dragen · niet alleen de offerte, want
   * een offerte kan vijf versies hebben met verschillende bedragen.
   *
   * @returns {{ ok, violations:[{field, reason}] }}
   */
  function checkProjectProvenance(project) {
    const overtredingen = [];
    if (!project || !project.origin) return { ok: false, violations: [{ field: "origin", reason: "MISSING_ORIGIN" }] };
    if (project.origin === "quote") {
      if (!project.sourceQuoteId) overtredingen.push({ field: "sourceQuoteId", reason: "MISSING_SOURCE" });
      // De VERSIE, niet alleen de offerte: bedragen verschillen per versie.
      if (!project.sourceQuoteVersionId) overtredingen.push({ field: "sourceQuoteVersionId", reason: "MISSING_SOURCE_VERSION" });
    }
    if (!["quote", "manual", "contract", "import"].includes(project.origin)) {
      overtredingen.push({ field: "origin", reason: "UNKNOWN_ORIGIN" });
    }
    return { ok: overtredingen.length === 0, violations: overtredingen };
  }

  /**
   * Bouw het herkomstlabel voor de projectkop: waar komt dit project
   * vandaan en waar kun je dat nakijken.
   */
  function provenanceLink(project) {
    if (!project || project.origin !== "quote" || !project.sourceQuoteId) return null;
    return {
      labelKey: "project.origin.quote",
      route: `/app/sales/quotes/${project.sourceQuoteId}/versions`,
      versionId: project.sourceQuoteVersionId || null,
    };
  }

  return {
    DEFINITION, MUTABLE_VERSION_STATES, SIGNED_STATES,
    canEditVersion, alternativesFor, checkProjectProvenance, provenanceLink,
  };
});
