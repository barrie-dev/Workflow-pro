/* ============================================================
   IA-runtime · Contextadapter

   De draaiende app en de IA-registry spreken vandaag NIET dezelfde taal,
   en dat is de echte reden dat de nieuwe navigatie niet vanzelf aansloot.

     De app zegt      · permissions: ["customers", "planning", "billing"]
                        entitlements: ["dashboard", "employees", "facturen"]
     De registry zegt · permissions: ["customers.view", "planning.view"]
                        entitlements: ["customers", "planning", "invoices"]

   De handover wil uiteindelijk één vocabulaire: "use the same policy
   identifiers in route guards, APIs, search, exports, reports and Mona
   context" (§10). Tot de API die identifiers levert, vertaalt dit bestand.

   Waarom een aparte, pure module en niet drie regels in de bootstrap:
   deze vertaling IS de openstaande schuld. Ze hoort zichtbaar te zijn, met
   een test eronder, zodat je precies kunt zien wat er nog uit de pas loopt
   en wanneer je hem kunt weggooien. Verstopt in een bootstrap zou ze
   stilletjes permanent worden.

   Fail-closed: wat hier niet in staat, levert geen recht op.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpNav = root.wfpNav || {}; root.wfpNav.contextAdapter = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  /**
   * Van een app-recht naar de registry-rechten die het ontsluit.
   * Eén app-recht kan meerdere registry-rechten geven · "billing" dekt in
   * de huidige app zowel facturen als betalingen.
   */
  const PERMISSION_MAP = {
    customers: ["customers.view"],
    venues: ["customers.view"],
    employees: ["employees.view"],
    planning: ["planning.view"],
    workorders: ["workorders.view", "workorders.review"],
    clockings: ["clockings.view"],
    leaves: ["leaves.view"],
    expenses: ["expenses.view"],
    incidents: ["incidents.view"],
    billing: ["billing.view"],
    projects: ["projects.view"],
    construction: ["progress_claims.view"],
    contracts: ["contracts.view", "quotes.view"],
    procurement: ["procurement.view"],
    inventory: ["stock.view"],
    stock: ["stock.view"],
    catalog: ["catalog.view"],
    price_rules: ["catalog.view"],
    vehicles: ["vehicles.view"],
    service_assets: ["service_assets.view"],
    progress_claims: ["progress_claims.view"],
    integrations: ["integrations.view"],
    settings: ["settings.view"],
    audit: ["reports.view"],
    reports: ["reports.view"],
  };

  /**
   * Van een vrijgegeven app-view naar de registry-module die eraan hangt.
   * De app noemt modules naar het SCHERM, de registry naar het DOMEIN ·
   * vandaar dat meerdere views op dezelfde module uitkomen.
   */
  const ENTITLEMENT_MAP = {
    customers: "customers", venues: "customers", inbox: "customers",
    offertes: "quotes", contracts: "quotes", catalog: "quotes",
    projects: "projects", worksites: "projects", portfolio: "projects",
    planning: "planning", appointments: "planning",
    workorders: "workorders", workos: "workorders",
    employees: "employees", employee_records: "employees",
    clocking: "employees", leaves: "employees", expenses: "employees", incidents: "employees",
    facturen: "invoices", billing: "invoices", payments: "invoices", purchasing: "invoices",
    stock: "inventory", inventory: "inventory", vehicles: "inventory", assets: "inventory",
    reports: "reports", lists: "reports",
    integrations: "automation", templates: "automation", webhooks: "automation",
    "progress-claims": "progress_claims", ciaw: "construction", posted_workers: "construction",
  };

  /** Vertaal app-rechten naar registry-rechten. */
  function permissions(appPermissions) {
    if (!Array.isArray(appPermissions)) return [];
    if (appPermissions.includes("*")) return ["*"];
    const uit = new Set();
    for (const p of appPermissions) for (const r of PERMISSION_MAP[p] || []) uit.add(r);
    return [...uit].sort();
  }

  /** Vertaal vrijgegeven app-views naar registry-modules. */
  function entitlements(appViews, allRegistryEntitlements) {
    if (appViews === "*") return (allRegistryEntitlements || []).slice();
    if (!Array.isArray(appViews)) return [];
    const uit = new Set();
    for (const v of appViews) { const m = ENTITLEMENT_MAP[v]; if (m) uit.add(m); }
    return [...uit].sort();
  }

  /** Van app-rol naar portaal. Onbekend valt terug op het smalste portaal. */
  function portal(role) {
    return role === "super_admin" ? "super-admin"
      : role === "manager" ? "manager"
        : role === "reseller" ? "reseller"
          : role === "tenant_admin" ? "tenant-admin"
            : "employee";
  }

  /**
   * Wat vertaalt deze adapter NIET? Handig bij het opruimen: zodra deze
   * lijsten leeg zijn, spreekt de API de taal van de registry en mag dit
   * bestand weg.
   */
  function unmapped(appPermissions, appViews) {
    return {
      permissions: (appPermissions || []).filter(p => p !== "*" && !PERMISSION_MAP[p]).sort(),
      entitlements: appViews === "*" ? [] : (appViews || []).filter(v => !ENTITLEMENT_MAP[v]).sort(),
    };
  }

  return { PERMISSION_MAP, ENTITLEMENT_MAP, permissions, entitlements, portal, unmapped };
});
