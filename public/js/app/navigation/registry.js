/* ============================================================
   IA-01 · Navigatieregistry (Information Architecture handover §5)

   EEN registry genereert sidebar, breadcrumbs, command palette,
   sitemap en tests (besluit D-02). Rolbestanden mogen geen eigen
   hardcoded navigatie meer bijhouden.

   Harde regels uit de handover:
     D-01  maximaal TWEE niveaus · recordtabs zijn contextueel,
           geen derde menulaag;
     D-02  geen nieuwe hardcoded navigatie in rolbestanden;
     D-10  geen productfork per sector · sectorProfiles wijzigt
           alleen zichtbaarheid/terminologie, nooit de structuur.

   Labels zijn NOOIT identifiers: analytics en tests gebruiken de
   id, de UI toont labelKey via i18n (NL/FR/EN zonder hermontage).
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpNav = root.wfpNav || {}; root.wfpNav.registry = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const PORTALS = ["tenant-admin", "manager", "employee", "reseller", "super-admin", "customer"];
  const MOBILE_PRIORITIES = ["primary", "more", "hidden"];

  // Elk veld uit het contract in §5. Ontbrekende optionele velden krijgen een
  // veilige default; ontbrekende VERPLICHTE velden zijn een schemafout.
  const REQUIRED_FIELDS = ["id", "portal", "path", "labelKey", "order"];

  /**
   * De registry. Eerste niveau = domein, tweede niveau = children.
   * Een derde niveau bestaat niet: dieper werk gebeurt in recordtabs binnen
   * een workspace (D-01), niet in het menu.
   */
  const ENTRIES = [
    {
      id: "customers", portal: ["tenant-admin", "manager"], parentId: null,
      path: "/app/customers", recordPath: "/app/customers/:customerId/overview",
      labelKey: "nav.customers", icon: "customers",
      permissions: ["customers.view"], entitlement: "customers",
      mobilePriority: "primary", order: 20,
      createActions: ["customer.create"],
      badgeSource: "work_inbox.customer_requests",
      children: [
        { id: "customers.contacts", path: "/app/customers/contacts", labelKey: "nav.customers.contacts", permissions: ["customers.view"], order: 10 },
        { id: "customers.locations", path: "/app/customers/locations", labelKey: "nav.customers.locations", permissions: ["customers.view"], order: 20 },
        { id: "customers.requests", path: "/app/customers/requests", labelKey: "nav.customers.requests", permissions: ["customers.view"], order: 30 },
      ],
    },
    {
      id: "sales", portal: ["tenant-admin", "manager"], parentId: null,
      path: "/app/sales", recordPath: "/app/sales/quotes/:quoteId/overview",
      labelKey: "nav.sales", icon: "sales",
      permissions: ["quotes.view"], entitlement: "quotes",
      mobilePriority: "more", order: 30,
      createActions: ["quote.create"],
      children: [
        { id: "sales.pipeline", path: "/app/sales/pipeline", labelKey: "nav.sales.pipeline", permissions: ["quotes.view"], order: 10 },
        { id: "sales.quotes", path: "/app/sales/quotes", labelKey: "nav.sales.quotes", permissions: ["quotes.view"], order: 20 },
        { id: "sales.contracts", path: "/app/sales/contracts", labelKey: "nav.sales.contracts", permissions: ["contracts.view"], order: 30 },
        { id: "sales.catalogue", path: "/app/sales/catalogue", labelKey: "nav.sales.catalogue", permissions: ["catalog.view"], order: 40 },
      ],
    },
    {
      id: "projects", portal: ["tenant-admin", "manager"], parentId: null,
      path: "/app/projects", recordPath: "/app/projects/:projectId/overview",
      labelKey: "nav.projects", icon: "projects",
      permissions: ["projects.view"], entitlement: "projects",
      mobilePriority: "primary", order: 40,
      createActions: ["project.create"],
      children: [
        { id: "projects.active", path: "/app/projects/active", labelKey: "nav.projects.active", permissions: ["projects.view"], order: 10 },
        { id: "projects.worksites", path: "/app/projects/worksites", labelKey: "nav.projects.worksites", permissions: ["projects.view"], entitlement: "construction", order: 20 },
      ],
    },
    {
      id: "planning", portal: ["tenant-admin", "manager"], parentId: null,
      path: "/app/planning", labelKey: "nav.planning", icon: "planning",
      permissions: ["planning.view"], entitlement: "planning",
      mobilePriority: "primary", order: 50,
      createActions: ["appointment.create", "shift.create"],
      children: [
        { id: "planning.calendar", path: "/app/planning/calendar", labelKey: "nav.planning.calendar", permissions: ["planning.view"], order: 10 },
        { id: "planning.unassigned", path: "/app/planning/unassigned", labelKey: "nav.planning.unassigned", permissions: ["planning.view"], order: 20 },
      ],
    },
    {
      id: "work-orders", portal: ["tenant-admin", "manager", "employee"], parentId: null,
      path: "/app/work-orders", recordPath: "/app/work-orders/:workOrderId/execution",
      labelKey: "nav.workOrders", icon: "workorders",
      permissions: ["workorders.view"], entitlement: "workorders",
      mobilePriority: "primary", order: 60,
      createActions: ["workorder.create"],
      badgeSource: "work_inbox.workorder_approvals",
      children: [
        { id: "work-orders.open", path: "/app/work-orders/open", labelKey: "nav.workOrders.open", permissions: ["workorders.view"], order: 10 },
        { id: "work-orders.review", path: "/app/work-orders/review", labelKey: "nav.workOrders.review", permissions: ["workorders.review"], order: 20 },
      ],
    },
    {
      id: "team", portal: ["tenant-admin", "manager"], parentId: null,
      path: "/app/team", recordPath: "/app/team/:employeeId/overview",
      labelKey: "nav.team", icon: "team",
      permissions: ["employees.view"], entitlement: "employees",
      mobilePriority: "more", order: 70,
      children: [
        { id: "team.people", path: "/app/team/people", labelKey: "nav.team.people", permissions: ["employees.view"], order: 10 },
        { id: "team.time", path: "/app/team/time", labelKey: "nav.team.time", permissions: ["clockings.view"], order: 20 },
        { id: "team.leave", path: "/app/team/leave", labelKey: "nav.team.leave", permissions: ["leaves.view"], order: 30 },
        { id: "team.expenses", path: "/app/team/expenses", labelKey: "nav.team.expenses", permissions: ["expenses.view"], order: 40 },
        { id: "team.safety", path: "/app/team/safety", labelKey: "nav.team.safety", permissions: ["incidents.view"], order: 50 },
      ],
    },
    {
      id: "finance", portal: ["tenant-admin"], parentId: null,
      path: "/app/finance", recordPath: "/app/finance/invoices/:invoiceId/overview",
      labelKey: "nav.finance", icon: "finance",
      permissions: ["billing.view"], entitlement: "invoices",
      mobilePriority: "more", order: 80,
      createActions: ["invoice.create"],
      children: [
        { id: "finance.invoices", path: "/app/finance/invoices", labelKey: "nav.finance.invoices", permissions: ["billing.view"], order: 10 },
        { id: "finance.payments", path: "/app/finance/payments", labelKey: "nav.finance.payments", permissions: ["billing.view"], order: 20 },
        { id: "finance.purchase", path: "/app/finance/purchase", labelKey: "nav.finance.purchase", permissions: ["procurement.view"], order: 30 },
        // Operationele Peppol-levering is TENANT-finance; provider-tarieven en
        // usage-billing horen bij Super Admin (D-09) en staan hier bewust niet.
        { id: "finance.peppol", path: "/app/finance/peppol", labelKey: "nav.finance.peppol", permissions: ["billing.view"], order: 40 },
        { id: "finance.progress-claims", path: "/app/finance/progress-claims", labelKey: "nav.finance.progressClaims", permissions: ["progress_claims.view"], entitlement: "progress_claims", order: 50 },
      ],
    },
    {
      id: "resources", portal: ["tenant-admin", "manager"], parentId: null,
      path: "/app/resources", labelKey: "nav.resources", icon: "resources",
      permissions: ["stock.view"], entitlement: "inventory",
      mobilePriority: "more", order: 90,
      children: [
        { id: "resources.stock", path: "/app/resources/stock", labelKey: "nav.resources.stock", permissions: ["stock.view"], order: 10 },
        { id: "resources.fleet", path: "/app/resources/fleet", labelKey: "nav.resources.fleet", permissions: ["vehicles.view"], order: 20 },
        { id: "resources.assets", path: "/app/resources/assets", labelKey: "nav.resources.assets", permissions: ["service_assets.view"], order: 30 },
      ],
    },
    {
      id: "insights", portal: ["tenant-admin", "manager"], parentId: null,
      path: "/app/insights", labelKey: "nav.insights", icon: "insights",
      permissions: ["reports.view"], entitlement: "reports",
      mobilePriority: "hidden", order: 100,
      children: [
        { id: "insights.reports", path: "/app/insights/reports", labelKey: "nav.insights.reports", permissions: ["reports.view"], order: 10 },
        { id: "insights.capacity", path: "/app/insights/capacity", labelKey: "nav.insights.capacity", permissions: ["reports.view"], order: 20 },
      ],
    },
    {
      id: "automation", portal: ["tenant-admin"], parentId: null,
      path: "/app/automation", labelKey: "nav.automation", icon: "automation",
      permissions: ["settings.view"], entitlement: "automation",
      mobilePriority: "hidden", order: 110,
      children: [
        { id: "automation.forms", path: "/app/automation/forms", labelKey: "nav.automation.forms", permissions: ["settings.view"], order: 10 },
        { id: "automation.workflows", path: "/app/automation/workflows", labelKey: "nav.automation.workflows", permissions: ["settings.view"], order: 20 },
        { id: "automation.integrations", path: "/app/automation/integrations", labelKey: "nav.automation.integrations", permissions: ["integrations.view"], order: 30 },
        { id: "automation.fields", path: "/app/automation/fields", labelKey: "nav.automation.fields", permissions: ["settings.view"], order: 40 },
      ],
    },
  ];

  /**
   * Valideer de registry tegen het contract uit §5. Geeft een lijst fouten;
   * leeg = geldig. Wordt door de schema-test gebruikt EN kan in dev draaien.
   */
  function validate(entries) {
    const errors = [];
    const seen = new Set();
    const checkOne = (e, depth, parent) => {
      if (depth > 2) { errors.push(`${e && e.id}: dieper dan twee niveaus (D-01)`); return; }
      for (const f of REQUIRED_FIELDS) {
        // children erven portal van hun ouder · dat veld is daar niet verplicht.
        if (f === "portal" && depth === 2) continue;
        if (e[f] === undefined || e[f] === null || e[f] === "") errors.push(`${e.id || "(zonder id)"}: veld '${f}' ontbreekt`);
      }
      if (seen.has(e.id)) errors.push(`${e.id}: id is niet uniek`);
      seen.add(e.id);
      if (typeof e.path === "string" && !e.path.startsWith("/app/")) errors.push(`${e.id}: path moet onder /app/ liggen`);
      if (e.labelKey && !/^nav\./.test(e.labelKey)) errors.push(`${e.id}: labelKey hoort met 'nav.' te beginnen`);
      if (depth === 1) {
        const ports = Array.isArray(e.portal) ? e.portal : [e.portal];
        for (const p of ports) if (!PORTALS.includes(p)) errors.push(`${e.id}: onbekend portaal '${p}'`);
        if (e.mobilePriority && !MOBILE_PRIORITIES.includes(e.mobilePriority)) errors.push(`${e.id}: onbekende mobilePriority '${e.mobilePriority}'`);
        if (e.parentId != null) errors.push(`${e.id}: een domein op niveau 1 heeft parentId null`);
      }
      if (depth === 2 && parent && !e.id.startsWith(parent.id + ".")) {
        errors.push(`${e.id}: child-id hoort te beginnen met '${parent.id}.'`);
      }
      for (const c of e.children || []) {
        if ((c.children || []).length) errors.push(`${c.id}: derde menuniveau bestaat niet (D-01)`);
        checkOne(c, depth + 1, e);
      }
    };
    for (const e of entries) checkOne(e, 1, null);
    return errors;
  }

  return { ENTRIES, PORTALS, MOBILE_PRIORITIES, REQUIRED_FIELDS, validate };
});
