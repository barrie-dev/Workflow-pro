const { hashPassword } = require("./security");
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
  "leaves"
];

const REQUIRED_COLLECTIONS = [
  "tenants",
  "users",
  "roles",
  "venues",
  "customers",
  "shifts",
  "workorders",
  "clocks",
  "expenses",
  "stock",
  "vehicles",
  "leaves",
  "messages",
  "notifications",
  "integrations",
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
  "migrationHistory"
];

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

function seed() {
  return {
    schemaVersion: 1,
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
        passwordHash: hashPassword("admin123"),
        role: "super_admin",
        permissions: ["*"],
        mfaEnabled: false,
        mfaEnforced: false,
        active: true
      },
      {
        id: "u_admin",
        tenantId: "t_demo",
        name: "Tenant Admin",
        email: "admin@demobouw.be",
        passwordHash: hashPassword("admin123"),
        role: "tenant_admin",
        permissions: BUSINESS_ADMIN_PERMISSIONS,
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
    vehicles: [],
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
    migrationHistory: []
  };
}

class Store {
  constructor(adapter = createDataAdapter()) {
    this.adapter = adapter;
    this.data = this.load();
    this.migrate();
  }

  load() {
    return this.adapter.load(seed);
  }

  migrate() {
    const changed = runMigrations(this.data, {
      businessAdminPermissions: BUSINESS_ADMIN_PERMISSIONS,
      requiredCollections: REQUIRED_COLLECTIONS
    });
    if (changed) this.save();
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

  audit(entry) {
    this.data.auditLogs.push({
      id: `audit_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      ...entry
    });
    this.data.auditLogs = this.data.auditLogs.slice(-500);
    this.save();
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
      vehicles: this.data.vehicles.filter(v => v.tenantId === tenantId),
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

module.exports = { Store, BUSINESS_ADMIN_PERMISSIONS, REQUIRED_COLLECTIONS };
