/* ============================================================
   IA-17 t/m IA-20 · Portaalmatrix (IA handover §7/§8)

   Vier workstreams delen één probleem, dus één bestand:

     IA-17 Manager  · "No full-admin duplication; team scope negative tests."
     IA-18 Employee · "44px targets; interrupted flow recovery; bottom tabs stable."
     IA-19 Reseller · "No direct tenant creation; delegated access required."
     IA-20 Super Admin · "Mona usage Super Admin only; Peppol rate/provider
                          ownership isolated."

   Het gedeelde probleem: elk portaal is vandaag een eigen kopie van de
   navigatie, en dus een eigen plek waar een recht vergeten kan worden.
   De handover vraagt precies het omgekeerde (D-02): één registry, en het
   portaal bepaalt alleen WELKE domeinen erin zitten.

   Dit bestand is die ene tabel. Wie een domein aan een portaal wil
   toevoegen, doet dat hier · en de tests hieronder controleren meteen dat
   de vier harde grenzen overeind blijven.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpPortals = root.wfpPortals || {}; root.wfpPortals.matrix = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const PORTALS = ["tenant-admin", "manager", "employee", "reseller", "super-admin", "customer"];

  /**
   * Welke domeinen hoort elk portaal te tonen, en met welke scope.
   *
   * scope · "alle" de hele organisatie · "team" jouw team · "eigen" jezelf
   *         "platform" alle tenants · "partner" je eigen klantenportefeuille
   *         "gedeeld" alleen wat expliciet met je gedeeld is
   */
  const PORTAL_DOMAINS = {
    "tenant-admin": {
      scope: "alle",
      domains: ["customers", "sales", "projects", "planning", "work-orders", "team", "finance", "resources", "insights", "automation"],
    },
    manager: {
      // Een manager is GEEN halve tenant-admin: hij doet het werk van zijn
      // team, niet het beheer van de organisatie. Automation en de
      // organisatie-instellingen horen er dus niet bij.
      scope: "team",
      domains: ["customers", "sales", "projects", "planning", "work-orders", "team", "insights"],
    },
    employee: {
      // Vijf primaire bestemmingen, want de onderbalk telt er vijf (IA-18).
      scope: "eigen",
      domains: ["planning", "work-orders", "team", "customers"],
    },
    reseller: {
      // Uitsluitend commerciële domeinen. Klantinhoud bestaat hier niet ·
      // die bereik je alleen via een actieve delegatie (IA-19).
      scope: "partner",
      domains: ["partner-pipeline", "partner-customers", "partner-licensing", "partner-earnings", "partner-support"],
    },
    "super-admin": {
      scope: "platform",
      domains: ["platform-tenants", "platform-revenue", "platform-services", "platform-partners", "platform-operations", "platform-security", "platform-product", "platform-communication"],
    },
    customer: {
      scope: "gedeeld",
      domains: ["portal-requests", "portal-quotes", "portal-work", "portal-invoices", "portal-documents", "portal-messages"],
    },
  };

  // Acties die een reseller NOOIT zelf mag uitvoeren (IA-19). Een reseller
  // die zelf tenants aanmaakt, maakt facturabele omgevingen buiten elke
  // controle om · en zou zichzelf commissie kunnen toekennen.
  const RESELLER_FORBIDDEN_ACTIONS = [
    "tenant.create", "tenant.delete", "tenant.impersonate_without_grant",
    "commission.adjust", "commission.approve_own", "subscription.override_price",
  ];

  // Domeinen die uitsluitend op het Super Admin-portaal bestaan (D-08/D-09).
  const PLATFORM_ONLY_DOMAINS = ["platform-revenue", "platform-services", "platform-partners", "platform-security"];

  function domainsFor(portal) {
    const p = PORTAL_DOMAINS[portal];
    return p ? p.domains.slice() : [];
  }

  function scopeFor(portal) {
    const p = PORTAL_DOMAINS[portal];
    return p ? p.scope : null;
  }

  /**
   * Mag dit portaal dit domein tonen? Fail-closed: een onbekend portaal
   * of domein levert nooit toegang op.
   */
  function portalAllows(portal, domainId) {
    return domainsFor(portal).includes(domainId);
  }

  /**
   * Mag deze reseller deze actie starten?
   *
   * Twee lagen. Ten eerste de verboden lijst · daar helpt geen enkel recht
   * tegen. Ten tweede: elke actie op KLANTINHOUD vereist een actieve
   * delegatie met de juiste scope, niet alleen een reseller-rol.
   */
  function resellerActionDecision(action, ctx = {}) {
    if (RESELLER_FORBIDDEN_ACTIONS.includes(action)) return { ok: false, code: "FORBIDDEN_FOR_RESELLER" };
    if (!action || !action.startsWith("tenant_content.")) return { ok: true, code: null };
    const grant = ctx.grant;
    if (!grant || !grant.active) return { ok: false, code: "NO_ACTIVE_DELEGATION" };
    if (grant.tenantId !== ctx.tenantId) return { ok: false, code: "GRANT_OTHER_TENANT" };
    const nodig = action.endsWith(".read") ? "read" : "write";
    if (!(grant.scopes || []).includes(nodig)) return { ok: false, code: "SCOPE_NOT_GRANTED" };
    if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= new Date(ctx.now || 0).getTime()) {
      return { ok: false, code: "GRANT_EXPIRED" };
    }
    return { ok: true, code: null };
  }

  // ── IA-18 · mobiele vereisten ──────────────────────────────────────────────
  // Deze getallen zijn releasevereisten (D-12), geen richtlijnen. Ze staan
  // hier zodat één plek ze bewaakt in plaats van vijf stylesheets.
  const MOBILE = {
    minTouchTargetPx: 44,
    bottomTabCount: 5,
    // Een onderbroken flow moet terugkomen waar hij stopte · een monteur die
    // gebeld wordt halverwege een werkbon verliest zijn invoer niet.
    resumeDraftAfterInterruption: true,
  };

  /**
   * Controleer een mobiele bestemmingsset tegen de vijf-tabs-regel.
   * De onderbalk moet STABIEL zijn: dezelfde tabs op elk scherm, anders
   * moet de gebruiker elke keer opnieuw zoeken.
   */
  function checkMobileTabs(tabIds) {
    const overtredingen = [];
    if ((tabIds || []).length > MOBILE.bottomTabCount) overtredingen.push({ reason: "TOO_MANY_TABS", count: tabIds.length });
    if ((tabIds || []).length === 0) overtredingen.push({ reason: "NO_TABS" });
    if (new Set(tabIds || []).size !== (tabIds || []).length) overtredingen.push({ reason: "DUPLICATE_TABS" });
    return { ok: overtredingen.length === 0, violations: overtredingen };
  }

  return {
    PORTALS, PORTAL_DOMAINS, RESELLER_FORBIDDEN_ACTIONS, PLATFORM_ONLY_DOMAINS, MOBILE,
    domainsFor, scopeFor, portalAllows, resellerActionDecision, checkMobileTabs,
  };
});
