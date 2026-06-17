"use strict";

const assert = require("assert");
const { Store } = require("../src/lib/store");
const { previewCustomerStart, applyCustomerStart } = require("../src/modules/customer-start-bootstrap");

class MemoryAdapter {
  constructor(data) {
    this.data = JSON.parse(JSON.stringify(data));
  }
  load() {
    return JSON.parse(JSON.stringify(this.data));
  }
  save(data) {
    this.data = JSON.parse(JSON.stringify(data));
  }
  status() {
    return { adapter: "memory", mode: "self-test" };
  }
}

function hasArg(name) {
  return process.argv.includes(name);
}

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function baseData() {
  return {
    schemaVersion: 6,
    tenants: [{ id: "t_demo", name: "Demo Bouwgroep NV", plan: "business", status: "trial", billingEmail: "finance@demo.be", invoiceProfile: { street: "Bouwstraat 12", city: "Antwerpen", vat: "BE0123456789" } }],
    users: [
      { id: "u_admin", tenantId: "t_demo", name: "Admin", email: "admin@demo.be", role: "tenant_admin", permissions: ["*"], active: true },
      { id: "u_emp1", tenantId: "t_demo", name: "Jan Janssen", email: "jan@demo.be", role: "employee", permissions: ["own:workorders"], active: true }
    ],
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
    bundles: [],
    platformConfig: [],
    migrationHistory: []
  };
}

function runSelfTest() {
  const store = new Store(new MemoryAdapter(baseData()));
  const dry = previewCustomerStart(store, "t_demo", { date: "2026-06-18", targetWorkorders: 3 });
  assert.equal(dry.readyBefore, false);
  assert.equal(dry.planned.filter(row => row.collection === "workorders").length, 3);

  const applied = applyCustomerStart(store, "t_demo", { date: "2026-06-18", targetWorkorders: 3 });
  assert.equal(applied.after.readyBefore, true);
  assert.equal(store.list("venues", "t_demo").length, 1);
  assert.equal(store.list("customers", "t_demo").length, 1);
  assert.equal(store.list("shifts", "t_demo").length, 1);
  assert.equal(store.list("workorders", "t_demo").length, 3);

  const repeat = applyCustomerStart(store, "t_demo", { date: "2026-06-18", targetWorkorders: 3 });
  assert.equal(repeat.created.length, 0, "bootstrap moet idempotent blijven");
  return { ok: true, created: applied.created.length, repeatedCreated: repeat.created.length };
}

function printPlan(payload) {
  console.log(`WorkFlow Pro customer-start bootstrap voor ${payload.tenant.name}`);
  console.log(`Datum: ${payload.date}`);
  console.log(`Target open werkbonnen: ${payload.targetWorkorders}`);
  console.log(`Status: ${payload.readyBefore ? "READY" : "OPEN"}`);
  console.log(`Bestaand: ${payload.existing.dayShifts} planning, ${payload.existing.openWorkorders} open werkbonnen, ${payload.existing.venues} werven`);

  if (payload.blockers.length) {
    console.log("\nBlokkers");
    payload.blockers.forEach(row => console.log(`- ${row}`));
  }

  if (payload.planned.length) {
    console.log("\nGeplande acties");
    payload.planned.forEach(row => console.log(`- ${row.label}: ${row.reason}`));
  }

  if (payload.created?.length) {
    console.log("\nAangemaakt");
    payload.created.forEach(row => console.log(`- ${row.collection}: ${row.label} (${row.id})`));
  }

  if (!payload.applied && payload.planned.length) {
    console.log("\nGebruik --apply om deze klantstart-objecten aan te maken.");
  }
}

const jsonMode = hasArg("--json");
if (hasArg("--self-test")) {
  const result = runSelfTest();
  if (jsonMode) console.log(JSON.stringify(result, null, 2));
  else console.log("Customer-start bootstrap self-test OK.");
  process.exit(0);
}

const tenantId = argValue("--tenant", "t_demo");
const date = argValue("--date", "");
const targetWorkorders = Number(argValue("--target-workorders", "1"));
const apply = hasArg("--apply");
const store = new Store();

try {
  const options = {
    date: date || undefined,
    targetWorkorders,
    actor: { email: "customer-start@workflowpro.be" }
  };
  const payload = apply
    ? applyCustomerStart(store, tenantId, options)
    : previewCustomerStart(store, tenantId, options);
  const ok = apply ? payload.after.readyBefore : payload.readyBefore;
  const output = { ok, apply, generatedAt: new Date().toISOString(), ...payload };

  if (jsonMode) {
    console.log(JSON.stringify(output, null, 2));
    process.exit(ok ? 0 : 1);
  }

  printPlan(output);
  process.exit(ok ? 0 : 1);
} catch (error) {
  const payload = { ok: false, error: error.message };
  if (jsonMode) console.log(JSON.stringify(payload, null, 2));
  else console.error(error.message);
  process.exit(1);
}
