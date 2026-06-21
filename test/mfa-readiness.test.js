"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { Store } = require("../src/lib/store");
const { productionReadiness } = require("../src/modules/production");
const { mfaRisk } = require("../src/modules/admin");

class MemAdapter {
  constructor(data) { this.data = data; }
  load() { return JSON.parse(JSON.stringify(this.data)); }
  save(data) { this.data = JSON.parse(JSON.stringify(data)); }
  status() { return { adapter: "memory", mode: "test" }; }
}

function readinessStore(users) {
  return new Store(new MemAdapter({
    schemaVersion: 6,
    tenants: [{ id: "t1", name: "Klant BV", status: "active", plan: "business" }],
    users,
    roles: [], venues: [], customers: [], shifts: [], workorders: [], clocks: [], expenses: [],
    stock: [], stockMutations: [], vehicles: [], mileageLogs: [], leaves: [], messages: [],
    notifications: [], integrations: [], platformConfig: [], quotes: [], invoices: [],
    paymentMethods: [], files: [], secrets: [], auditLogs: [], errorEvents: [], apiKeys: [],
    supportTickets: [], salesLeads: [], partners: [], bundles: [], migrationHistory: []
  }));
}

test("mfa readiness: flags zonder secret tellen niet als productie-klaar", () => {
  const users = [
    { id: "u1", tenantId: "t1", role: "tenant_admin", active: true, email: "admin@t1.be", mfaEnabled: true, mfaEnforced: true },
    { id: "u2", tenantId: "t1", role: "tenant_admin", active: true, email: "ready@t1.be", mfaEnabled: true, mfaEnforced: true, mfaSecret: "encrypted" }
  ];
  const risk = mfaRisk(users, "t1");
  assert.equal(risk.ok, false);
  assert.equal(risk.readyAdmins, 1);
  assert.equal(risk.missingSecret, 1);
  assert.equal(risk.rows.find(row => row.id === "u1").ready, false);
});

test("production readiness: admin MFA vereist opgeslagen secret", () => {
  const store = readinessStore([
    { id: "u1", tenantId: "t1", role: "tenant_admin", active: true, email: "admin@klant.be", mfaEnabled: true, mfaEnforced: true }
  ]);
  const mfa = productionReadiness(store).checks.find(row => row.key === "mfa");
  assert.equal(mfa.ok, false);
  assert.match(mfa.detail, /secret/i);
});
