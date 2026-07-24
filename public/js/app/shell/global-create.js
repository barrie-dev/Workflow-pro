/* ============================================================
   IA-06 · Global Create (IA handover §7/§8)

   Contract: "Contextual object creation; full page for complex records."
   Acceptatie: "Only permitted/enabled actions; complex create opens
   full route."

   Twee besluiten sturen dit bestand:

   D-04 · Complexe objecten krijgen een VOLLEDIGE pagina. Een drawer is
          alleen toegestaan voor preview of een quick create van hooguit
          vijf velden. Een offerte in een zijpaneel proppen is precies
          de fout die de huidige UI maakt.
   D-07 · Rechtenpariteit. Wat hier niet mag verschijnen, mag ook op de
          API niet lukken. Deze lijst is een SPIEGEL van de rechten, geen
          tweede waarheid.

   De launcher is contextbewust: staat de gebruiker in een projectdossier,
   dan draagt "nieuwe werkbon" dat project al mee.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpShell = root.wfpShell || {}; root.wfpShell.globalCreate = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  // Boven dit aantal velden is een drawer verboden (D-04).
  const QUICK_CREATE_MAX_FIELDS = 5;

  /**
   * De aanmaakacties van het platform. Eén registratie per object.
   *
   *   id             stabiel · gebruikt in telemetrie en tests
   *   labelKey       i18n-sleutel, nooit een letterlijk label
   *   permission     het recht dat de API ook afdwingt
   *   entitlement    de module die vrijgegeven moet zijn
   *   route          waar de volledige aanmaak leeft
   *   quickFields    velden voor een snelle aanmaak · leeg = altijd volledig
   *   contextParams  contextvelden die meereizen wanneer ze bekend zijn
   *   order          vaste volgorde in de launcher
   */
  const ACTIONS = [
    { id: "create.customer", labelKey: "create.customer", permission: "customers.create", entitlement: "customers", route: "/app/customers/new", quickFields: ["name", "email", "phone"], contextParams: [], order: 10 },
    { id: "create.customer_request", labelKey: "create.customer_request", permission: "customer_requests.create", entitlement: "customers", route: "/app/customers/requests/new", quickFields: ["customerId", "subject", "priority"], contextParams: ["customerId"], order: 20 },
    { id: "create.quote", labelKey: "create.quote", permission: "quotes.create", entitlement: "quotes", route: "/app/sales/quotes/new", quickFields: [], contextParams: ["customerId", "projectId"], order: 30 },
    { id: "create.project", labelKey: "create.project", permission: "projects.create", entitlement: "projects", route: "/app/projects/new", quickFields: [], contextParams: ["customerId"], order: 40 },
    { id: "create.appointment", labelKey: "create.appointment", permission: "planning.create", entitlement: "planning", route: "/app/planning/appointments/new", quickFields: ["customerId", "start", "employeeId"], contextParams: ["customerId", "projectId"], order: 50 },
    { id: "create.work_order", labelKey: "create.work_order", permission: "workorders.create", entitlement: "workorders", route: "/app/work-orders/new", quickFields: [], contextParams: ["customerId", "projectId"], order: 60 },
    { id: "create.employee", labelKey: "create.employee", permission: "employees.create", entitlement: "employees", route: "/app/team/employees/new", quickFields: [], contextParams: [], order: 70 },
    { id: "create.leave_request", labelKey: "create.leave_request", permission: "leave.request", entitlement: "employees", route: "/app/team/leave/new", quickFields: ["type", "from", "to", "note"], contextParams: ["employeeId"], order: 80 },
    { id: "create.invoice", labelKey: "create.invoice", permission: "invoices.create", entitlement: "invoices", route: "/app/finance/invoices/new", quickFields: [], contextParams: ["customerId", "projectId"], order: 90 },
    { id: "create.expense", labelKey: "create.expense", permission: "expenses.create", entitlement: "invoices", route: "/app/finance/expenses/new", quickFields: ["date", "amount", "category", "note"], contextParams: ["projectId"], order: 100 },
    { id: "create.article", labelKey: "create.article", permission: "inventory.create", entitlement: "inventory", route: "/app/resources/catalog/new", quickFields: ["code", "name", "unit", "price"], contextParams: [], order: 110 },
    { id: "create.incident", labelKey: "create.incident", permission: "incidents.create", entitlement: "employees", route: "/app/team/incidents/new", quickFields: [], contextParams: ["employeeId", "projectId"], order: 120 },
  ];

  function heeftRecht(permissions, nodig) {
    const p = permissions || [];
    return p.includes("*") || p.includes(nodig);
  }

  /**
   * Bepaal de aanmaakmodus. Een object met meer dan vijf snelvelden - of
   * zonder snelvelden - hoort op een volledige pagina (D-04). Deze functie
   * is de enige plek die dat besluit neemt.
   */
  function modeFor(action) {
    const n = (action.quickFields || []).length;
    return n > 0 && n <= QUICK_CREATE_MAX_FIELDS ? "quick" : "full";
  }

  /**
   * Welke acties mag deze gebruiker hier starten?
   *
   * @param {object} ctx {
   *   permissions, entitlements, portal,
   *   route,   de huidige route (IA-02) · levert de context mee
   *   params,  { customerId, projectId, employeeId, ... }
   * }
   * @returns {Array} acties met route, modus en meegereisde context
   */
  function createActions(ctx = {}) {
    const params = ctx.params || (ctx.route && ctx.route.params) || {};
    return ACTIONS
      .filter(a => heeftRecht(ctx.permissions, a.permission))
      .filter(a => (ctx.entitlements || []).includes(a.entitlement))
      .slice()
      .sort((x, y) => x.order - y.order || x.id.localeCompare(y.id))
      .map(a => {
        const context = {};
        for (const p of a.contextParams) if (params[p]) context[p] = params[p];
        return {
          id: a.id, labelKey: a.labelKey, permission: a.permission,
          entitlement: a.entitlement, mode: modeFor(a), route: a.route,
          quickFields: (a.quickFields || []).slice(), context,
        };
      });
  }

  /**
   * Bouw de doel-URL van een actie, inclusief de meegereisde context.
   * Sleutels staan altijd in dezelfde volgorde, zodat de URL deelbaar is
   * en tests niet op sorteervolgorde struikelen (zelfde regel als IA-02).
   */
  function targetUrl(action) {
    const sleutels = Object.keys(action.context || {}).sort();
    if (!sleutels.length) return action.route;
    const qs = sleutels.map(k => `${encodeURIComponent(k)}=${encodeURIComponent(action.context[k])}`).join("&");
    return `${action.route}${action.route.includes("?") ? "&" : "?"}${qs}`;
  }

  /**
   * De acties die de launcher bovenaan toont voor de huidige route.
   * Contextuele acties eerst: in een projectdossier is "nieuwe werkbon"
   * relevanter dan "nieuwe medewerker".
   */
  function suggested(actions, max = 4) {
    const metContext = actions.filter(a => Object.keys(a.context).length > 0);
    const rest = actions.filter(a => !metContext.includes(a));
    return [...metContext, ...rest].slice(0, max);
  }

  return { ACTIONS, createActions, targetUrl, suggested, modeFor, QUICK_CREATE_MAX_FIELDS };
});
