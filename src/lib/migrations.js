function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function ensureCollection(data, collection) {
  if (!Array.isArray(data[collection])) data[collection] = [];
}

function migrationEntry(version, name) {
  return {
    version,
    name,
    appliedAt: new Date().toISOString()
  };
}

const migrations = [
  {
    version: 2,
    name: "account-security-defaults",
    apply(data, context) {
      data.users = (data.users || []).map(user => ({
        mfaEnabled: false,
        mfaEnforced: false,
        lastLoginAt: null,
        failedLoginCount: 0,
        lockedUntil: null,
        ...user
      }));
      data.tenants = (data.tenants || []).map(tenant => ({
        invoiceProfile: {},
        onboarding: {},
        billingOps: { invoiceHistory: [] },
        supportAccess: { enabled: false },
        ...tenant
      }));
      return context;
    }
  },
  {
    version: 3,
    name: "tenant-admin-production-permissions",
    apply(data, context) {
      data.users = (data.users || []).map(user => {
        if (user.role !== "tenant_admin") return user;
        return {
          ...user,
          permissions: unique([...(user.permissions || []), ...context.businessAdminPermissions])
        };
      });
      return context;
    }
  },
  {
    version: 4,
    name: "pilot-and-production-collections",
    apply(data) {
      [
        "paymentMethods",
        "files",
        "secrets",
        "notifications",
        "errorEvents",
        "apiKeys",
        "supportTickets"
      ].forEach(collection => ensureCollection(data, collection));
    }
  },
  {
    version: 5,
    name: "commercial-launch-collections",
    apply(data) {
      ["salesLeads", "partners"].forEach(collection => ensureCollection(data, collection));
    }
  },
  {
    version: 6,
    name: "support-escalation-notification-shape",
    apply(data) {
      ensureCollection(data, "notifications");
      ensureCollection(data, "supportTickets");
      data.notifications = data.notifications.map(row => ({
        sourceRef: null,
        readAt: null,
        ...row
      }));
      data.supportTickets = data.supportTickets.map(row => ({
        comments: [],
        status: "open",
        priority: "normal",
        category: "question",
        ...row
      }));
    }
  },
  {
    // Werkongevallen-module: bestaande tenant-admins krijgen het nieuwe
    // "incidents"-recht (zelfde union-aanpak als versie 3).
    version: 7,
    name: "tenant-admin-incidents-permission",
    apply(data, context) {
      data.users = (data.users || []).map(user => {
        if (user.role !== "tenant_admin") return user;
        return {
          ...user,
          permissions: unique([...(user.permissions || []), ...context.businessAdminPermissions])
        };
      });
      return context;
    }
  },
  {
    // Company-laag (master-spec E01/R0-b): elke tenant krijgt een
    // default-company, gevuld vanuit het bestaande invoiceProfile.
    version: 8,
    name: "default-company-per-tenant",
    apply(data, context) {
      ensureCollection(data, "companies");
      ensureCollection(data, "numberSequences");
      for (const tenant of data.tenants || []) {
        if (data.companies.some(c => c.tenantId === tenant.id && c.isDefault)) continue;
        data.companies.push(context.companyFromTenant(tenant));
      }
      return context;
    }
  },
  {
    // Project-aggregate (master-spec E04/R1-a): bestaande tenant-admins krijgen
    // het nieuwe "projects"-recht (zelfde union-aanpak als versie 3/7).
    version: 9,
    name: "tenant-admin-projects-permission",
    apply(data, context) {
      data.users = (data.users || []).map(user => {
        if (user.role !== "tenant_admin") return user;
        return { ...user, permissions: unique([...(user.permissions || []), ...context.businessAdminPermissions]) };
      });
      return context;
    }
  },
  {
    // Construction Core-pack (master-spec E12/R2): bestaande tenant-admins
    // krijgen het "construction"-recht (werkt pas als de module aanstaat).
    version: 10,
    name: "tenant-admin-construction-permission",
    apply(data, context) {
      data.users = (data.users || []).map(user => {
        if (user.role !== "tenant_admin") return user;
        return { ...user, permissions: unique([...(user.permissions || []), ...context.businessAdminPermissions]) };
      });
      return context;
    }
  },
  {
    // Service & Assets-pack (master-spec E16/R3): idem voor "service_assets".
    version: 11,
    name: "tenant-admin-service-assets-permission",
    apply(data, context) {
      data.users = (data.users || []).map(user => {
        if (user.role !== "tenant_admin") return user;
        return { ...user, permissions: unique([...(user.permissions || []), ...context.businessAdminPermissions]) };
      });
      return context;
    }
  }
];

function runMigrations(data, context) {
  ensureCollection(data, "migrationHistory");
  let changed = false;
  for (const migration of migrations) {
    if ((data.schemaVersion || 1) >= migration.version) continue;
    migration.apply(data, context);
    data.schemaVersion = migration.version;
    data.migrationHistory.push(migrationEntry(migration.version, migration.name));
    changed = true;
  }
  for (const collection of context.requiredCollections) {
    const before = Array.isArray(data[collection]);
    ensureCollection(data, collection);
    if (!before) changed = true;
  }
  return changed;
}

function migrationStatus(data) {
  return {
    currentVersion: data.schemaVersion || 1,
    latestVersion: migrations[migrations.length - 1].version,
    pending: migrations
      .filter(migration => (data.schemaVersion || 1) < migration.version)
      .map(migration => ({ version: migration.version, name: migration.name })),
    history: (data.migrationHistory || []).slice(-10).reverse()
  };
}

module.exports = { runMigrations, migrationStatus };
