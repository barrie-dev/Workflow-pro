const crypto = require("crypto");
const { config } = require("./config");
const { hashPassword, assertStrongPassword } = require("./security");
const { runMigrations, migrationStatus } = require("./migrations");
const { createDataAdapter, dbPath } = require("./data-adapters");

const BUSINESS_ADMIN_PERMISSIONS = [
  "tenants",
  "employees",
  "venues",
  "customers",
  "planning",
  "workorders",
  "clockings",
  "expenses",
  "billing",
  "settings",
  "audit",
  "messages",
  "alerts",
  "integrations",
  "stock",
  "vehicles",
  "leaves",
  "incidents",
  "projects",
  "construction",
  "service_assets",
  "contracts",
  "procurement",
  "inventory",
  "catalog",
  "price_rules",
  "progress_claims"
];

// Manager: team planning + goedkeuringen, geen billing/settings
const MANAGER_PERMISSIONS = [
  "employees",
  "venues",
  "planning",
  "workorders",
  "clockings",
  "expenses",
  "messages",
  "alerts",
  "leaves",
  "vehicles"
];

// Employee: enkel eigen data
const EMPLOYEE_PERMISSIONS = [
  "own:planning",
  "own:clockings",
  "own:expenses",
  "own:leaves",
  "own:workorders",
  "own:messages"
];

const REQUIRED_COLLECTIONS = [
  "tenants",
  "users",
  "roles",
  "venues",
  "customers",
  "shifts",
  "appointments",
  "incidents",
  "inquiries",
  "outbox",
  "companies",
  "numberSequences",
  "projects",
  "worksites",
  "changeOrders",
  "assets",
  "maintenancePlans",
  "contracts",
  "suppliers",
  "purchaseOrders",
  "stockMovements",
  "stockReservations",
  "articles",
  "priceRules",
  "webhookEndpoints",
  "progressClaims",
  "employees",
  "gridViews",
  "exportJobs",
  "payments",
  "webhookDeliveries",
  "mailLog",
  "formTemplates",
  "formInstances",
  "tasks",
  "communications",
  "customFields",
  "automationFlows",
  "automationRuns",
  "workorders",
  "clocks",
  "expenses",
  "stock",
  "stockMutations",
  "vehicles",
  "mileageLogs",
  "leaves",
  "messages",
  "notifications",
  "integrations",
  "platformConfig",
  "quotes",
  "invoices",
  "paymentMethods",
  "files",
  "secrets",
  "auditLogs",
  "errorEvents",
  "apiKeys",
  "supportTickets",
  "salesLeads",
  "partners",
  "resellers",
  "bundles",
  "postedWorkers",
  "templates",
  "migrationHistory"
];

const initialAdminPassword = process.env.WORKFLOWPRO_INITIAL_ADMIN_PASSWORD
  || crypto.randomBytes(24).toString("base64url");
const initialAdminEmail = process.env.WORKFLOWPRO_INITIAL_ADMIN_EMAIL || "";
const initialAdminName = process.env.WORKFLOWPRO_INITIAL_ADMIN_NAME || "Initial Super Admin";

function withAccountDefaults(user) {
  return {
    mfaEnabled: false,
    mfaEnforced: false,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    ...user
  };
}

function emptySeed() {
  return {
    schemaVersion: 1,
    tenants: [],
    users: [],
    roles: [],
    venues: [],
    customers: [],
    shifts: [],
    workorders: [],
    clocks: [],
    expenses: [],
    stock: [],
    stockMutations: [],
    vehicles: [],
    mileageLogs: [],
    leaves: [],
    messages: [],
    notifications: [],
    integrations: [],
    invoices: [],
    paymentMethods: [],
    files: [],
    secrets: [],
    auditLogs: [],
    errorEvents: [],
    apiKeys: [],
    supportTickets: [],
    salesLeads: [],
    partners: [],
    resellers: [],
    postedWorkers: [],
    templates: [],
    migrationHistory: []
  };
}

function demoSeed() {
  return {
    ...emptySeed(),
    tenants: [
      {
        id: "t_demo",
        name: "Demo Bouwgroep NV",
        plan: "business",
        status: "trial",
        billingEmail: "finance@demobouw.be",
        invoiceProfile: {},
        onboarding: {},
        billingOps: { invoiceHistory: [] },
        supportAccess: { enabled: false }
      }
    ],
    users: [
      {
        id: "u_super",
        tenantId: null,
        name: "Super Admin",
        email: "super@workflowpro.be",
        passwordHash: hashPassword(initialAdminPassword),
        role: "super_admin",
        permissions: ["*"],
        mfaEnabled: false,
        mfaEnforced: false,
        active: true,
        protected: true
      },
      {
        id: "u_admin",
        tenantId: "t_demo",
        name: "Tenant Admin",
        email: "admin@demobouw.be",
        passwordHash: hashPassword(initialAdminPassword),
        role: "tenant_admin",
        permissions: BUSINESS_ADMIN_PERMISSIONS,
        mfaEnabled: false,
        mfaEnforced: false,
        active: true
      },
      {
        id: "u_manager",
        tenantId: "t_demo",
        name: "Thomas De Smedt",
        email: "manager@demobouw.be",
        passwordHash: hashPassword(initialAdminPassword),
        role: "manager",
        permissions: MANAGER_PERMISSIONS,
        function: "Ploegbaas",
        phone: "0477 12 34 56",
        mfaEnabled: false,
        mfaEnforced: false,
        active: true
      },
      {
        id: "u_emp1",
        tenantId: "t_demo",
        name: "Jan Janssen",
        email: "jan@demobouw.be",
        passwordHash: hashPassword(initialAdminPassword),
        role: "employee",
        permissions: EMPLOYEE_PERMISSIONS,
        function: "Installateur",
        phone: "0476 22 33 44",
        mfaEnabled: false,
        mfaEnforced: false,
        active: true
      },
      {
        id: "u_emp2",
        tenantId: "t_demo",
        name: "Sara Peeters",
        email: "sara@demobouw.be",
        passwordHash: hashPassword(initialAdminPassword),
        role: "employee",
        permissions: EMPLOYEE_PERMISSIONS,
        function: "Elektricien",
        phone: "0476 55 66 77",
        mfaEnabled: false,
        mfaEnforced: false,
        active: true
      }
    ],
    roles: [
      {
        id: "role_admin",
        tenantId: "t_demo",
        name: "Admin",
        permissions: ["*"],
        locked: true
      }
    ],
    venues: [],
    customers: [],
    shifts: [],
    workorders: [],
    clocks: [],
    expenses: [],
    stock: [],
    stockMutations: [],
    vehicles: [],
    mileageLogs: [],
    leaves: [],
  };
}

function seed() {
  return config.isProduction && !config.allowDemoData ? emptySeed() : demoSeed();
}

class Store {
  /**
   * @param {object} adapter
   * @param {{defer?:boolean}} opts `defer` stelt het laden uit tot initAsync().
   *   Nodig voor netwerk-adapters (PostgreSQL): die kunnen niet synchroon in
   *   een constructor laden. De store-INSTANTIE bestaat wel meteen, zodat
   *   repositories er al naar kunnen verwijzen; alleen de data komt later.
   */
  constructor(adapter = createDataAdapter(), { defer = false } = {}) {
    this.adapter = adapter;
    this.initialized = false;
    if (defer) {
      this.data = seed();          // tijdelijke lege staat tot initAsync()
      return;
    }
    this.data = this.load();
    this.finishInit();
  }

  /** Migratie, bootstrap-admin en platform-god · na het laden van de data. */
  finishInit() {
    this.migrate();
    this.bootstrapInitialAdmin();
    this.ensurePlatformGod();
    this.initialized = true;
  }

  /**
   * Laad asynchroon (netwerk-adapter) en rond de init af. De server roept dit
   * aan vóór hij gaat luisteren, zodat er nooit een verzoek op lege data valt.
   */
  async initAsync() {
    if (this.initialized) return this;
    this.data = typeof this.adapter.loadAsync === "function"
      ? this.enrichDemoData(await this.adapter.loadAsync(seed))
      : this.load();
    this.finishInit();
    return this;
  }

  /**
   * Persisteer openstaande wijzigingen. Synchrone adapters (JSON) schrijven al
   * in save(); netwerk-adapters bufferen en schrijven hier. De HTTP-laag wacht
   * dit af vóór ze op een muterend verzoek antwoordt, zodat een 2xx betekent
   * dat de data echt bewaard is.
   */
  async flush() {
    if (typeof this.adapter.flush !== "function") return { written: false };
    return this.adapter.flush();
  }

  /** True zolang er niet-weggeschreven wijzigingen zijn. */
  isDirty() {
    return typeof this.adapter.isDirty === "function" ? this.adapter.isDirty() : false;
  }

  // Garandeer dat er altijd één beschermde super_admin is (de "god" van de SaaS):
  // onaantastbaar, kan niet gedeactiveerd/gedegradeerd/verwijderd worden.
  ensurePlatformGod() {
    const supers = (this.data.users || []).filter(u => u.role === "super_admin");
    if (supers.length === 0 || supers.some(u => u.protected === true)) return;
    const god = supers.find(u => u.bootstrapAdmin) || supers.find(u => u.id === "u_super") || supers[0];
    god.protected = true;
    this.save();
    this.audit({ actor: "system", tenantId: null, action: "platform_god_marked", area: "auth", detail: god.email });
  }

  load() {
    return this.enrichDemoData(this.adapter.load(seed));
  }

  /** Vult een verse dataset aan met demo-data (nooit in productie). */
  enrichDemoData(data) {
    if (!config.isProduction && Array.isArray(data.tenants) && data.tenants.length === 0) {
      const ds = demoSeed();
      data.tenants = ds.tenants;
      // Voeg demo-gebruikers toe als ze nog niet bestaan
      const existingIds = new Set((data.users || []).map(u => u.id));
      ds.users.forEach(u => { if (!existingIds.has(u.id)) data.users.push(u); });
      this.adapter.save(data);
    }
    return data;
  }

  migrate() {
    // Lazy require: platform/companies gebruikt platform/events; geen cykel
    // met de store zelf, maar zo blijft de module-load-volgorde eenvoudig.
    const { companyFromTenant } = require("../platform/companies");
    const changed = runMigrations(this.data, {
      businessAdminPermissions: BUSINESS_ADMIN_PERMISSIONS,
      requiredCollections: REQUIRED_COLLECTIONS,
      companyFromTenant
    });
    if (changed) this.save();
  }

  bootstrapInitialAdmin() {
    if (!config.isProduction || !initialAdminEmail || !process.env.WORKFLOWPRO_INITIAL_ADMIN_PASSWORD) return;
    if ((this.data.users || []).some(user => user.role === "super_admin")) return;
    assertStrongPassword(process.env.WORKFLOWPRO_INITIAL_ADMIN_PASSWORD);
    this.data.users.push(withAccountDefaults({
      id: `user_bootstrap_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      tenantId: null,
      name: initialAdminName,
      email: String(initialAdminEmail).toLowerCase(),
      passwordHash: hashPassword(process.env.WORKFLOWPRO_INITIAL_ADMIN_PASSWORD),
      role: "super_admin",
      permissions: ["*"],
      active: true,
      bootstrapAdmin: true,
      protected: true,
      createdAt: new Date().toISOString()
    }));
    this.audit({
      actor: "system",
      tenantId: null,
      action: "bootstrap_admin_created",
      area: "auth",
      detail: initialAdminEmail
    });
  }

  migrationStatus() {
    return migrationStatus(this.data);
  }

  save() {
    this.adapter.save(this.data);
  }

  storageStatus() {
    return this.adapter.status();
  }

  /**
   * Auditregel wegschrijven (handover F-10).
   *
   * Append-only: hier wordt NOOIT afgekapt. Voorheen deed dit `slice(-500)` op
   * één gedeelde lijst, waardoor auditregels stil verdwenen én één drukke
   * tenant de trail van een andere kon wegduwen. Opruimen gebeurt nu via een
   * expliciete retentie-actie (pruneAudit) die per tenant werkt, rapporteert
   * wat ze verwijderde, en securityregels langer bewaart.
   */
  audit(entry) {
    // Lazy require: audit-log zit in de platformlaag en mag niet bij het laden
    // van de store al ingeladen worden (cyclus met events.js).
    const { appendAudit } = require("../platform/audit-log");
    return appendAudit(this, entry);
  }

  errorEvent(entry) {
    this.data.errorEvents.push({
      id: `error_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      ...entry
    });
    this.data.errorEvents = this.data.errorEvents.slice(-300);
    this.save();
  }

  getUserByEmail(email) {
    return this.data.users.find(u => u.email.toLowerCase() === String(email || "").toLowerCase());
  }

  getUserById(id) {
    return this.data.users.find(u => u.id === id);
  }

  tenantScoped(tenantId) {
    return {
      tenant: this.data.tenants.find(t => t.id === tenantId),
      users: this.data.users.filter(u => u.tenantId === tenantId),
      roles: this.data.roles.filter(r => r.tenantId === tenantId),
      venues: this.data.venues.filter(v => v.tenantId === tenantId),
      customers: this.data.customers.filter(c => c.tenantId === tenantId),
      shifts: this.data.shifts.filter(s => s.tenantId === tenantId),
      workorders: this.data.workorders.filter(w => w.tenantId === tenantId),
      clocks: this.data.clocks.filter(c => c.tenantId === tenantId),
      expenses: this.data.expenses.filter(e => e.tenantId === tenantId),
      stock: this.data.stock.filter(s => s.tenantId === tenantId),
      stockMutations: this.data.stockMutations.filter(m => m.tenantId === tenantId),
      vehicles: this.data.vehicles.filter(v => v.tenantId === tenantId),
      mileageLogs: (this.data.mileageLogs || []).filter(m => m.tenantId === tenantId),
      leaves: this.data.leaves.filter(l => l.tenantId === tenantId),
      messages: this.data.messages.filter(m => m.tenantId === tenantId),
      notifications: this.data.notifications.filter(n => n.tenantId === tenantId),
      integrations: this.data.integrations.filter(i => i.tenantId === tenantId),
      invoices: this.data.invoices.filter(i => i.tenantId === tenantId),
      apiKeys: this.data.apiKeys.filter(k => k.tenantId === tenantId),
      supportTickets: this.data.supportTickets.filter(t => t.tenantId === tenantId),
      salesLeads: this.data.salesLeads.filter(l => l.tenantId === tenantId),
      partners: this.data.partners.filter(p => p.tenantId === tenantId)
    };
  }

  list(collection, tenantId = null) {
    const rows = this.data[collection] || [];
    if (!tenantId) return rows;
    return rows.filter(row => row.tenantId === tenantId);
  }

  get(collection, id) {
    return (this.data[collection] || []).find(row => row.id === id);
  }

  updateTenant(tenantId, patch) {
    this.data.tenants = this.data.tenants.map(t => (t.id === tenantId ? { ...t, ...patch } : t));
    this.save();
    return this.data.tenants.find(t => t.id === tenantId);
  }

  insert(collection, row) {
    this.data[collection].push(row);
    this.save();
    return row;
  }

  update(collection, id, patch) {
    this.data[collection] = (this.data[collection] || []).map(row => (row.id === id ? { ...row, ...patch } : row));
    this.save();
    return this.get(collection, id);
  }

  remove(collection, id) {
    const before = (this.data[collection] || []).length;
    this.data[collection] = (this.data[collection] || []).filter(row => row.id !== id);
    this.save();
    return before !== this.data[collection].length;
  }
}

module.exports = { Store, BUSINESS_ADMIN_PERMISSIONS, MANAGER_PERMISSIONS, EMPLOYEE_PERMISSIONS, REQUIRED_COLLECTIONS };
