"use strict";
// Mona Prepare (h48 · van detecteren naar voorbereiden). Focus: de
// voorbereidingsengine zet signalen om in kant-en-klare, rechten-gescopete
// plannen op echte endpoints, ZONDER zelf uit te voeren. Voorbereiden is gratis
// (geen add-on nodig); uitvoeren blijft achter bevestiging + ai_actions.
const { test } = require("node:test");
const assert = require("node:assert");

const { buildPreparedWork, prepareProject } = require("../src/platform/mona-prepare");
const { runTool } = require("../src/modules/boden");
const { seedDefaults } = require("../src/modules/bundles");

const TODAY = new Date();
const past = new Date(TODAY.getTime() - 10 * 86400000).toISOString().slice(0, 10);

function mkStore() {
  const data = {
    bundles: [], tenants: [{ id: "t1", name: "Demo NV", plan: "business" }],
    customers: [{ id: "c1", tenantId: "t1", name: "Klant A", email: "a@x.be" }],
    workorders: [
      // Afgewerkt + factureerbaar + nog niet gefactureerd → leakage.
      { id: "w1", tenantId: "t1", number: "WB-1", title: "Dakwerk", status: "voltooid", clientName: "Klant A", customerId: "c1", fixedPrice: 1000 },
    ],
    quotes: [
      // Aanvaard, niet omgezet → leakage.
      { id: "q1", tenantId: "t1", number: "OFF-2026-001", customerName: "Klant A", customerId: "c1", status: "aanvaard", total: 2000, acceptedAt: "2026-07-10" },
    ],
    invoices: [
      // Vervallen → overdue.
      { id: "i1", tenantId: "t1", number: "F-1", customerName: "Klant A", total: 500, status: "open", dueDate: past },
    ],
    leaves: [], expenses: [], shifts: [], stock: [], vehicles: [], users: [], projects: [], appointments: [],
  };
  return {
    data,
    list: (c, tid) => (data[c] || []).filter(r => !tid || r.tenantId === tid),
    insert: (c, r) => { (data[c] = data[c] || []).push(r); return r; },
    update: (c, id, p) => { data[c] = data[c].map(x => x.id === id ? { ...x, ...p } : x); return data[c].find(x => x.id === id); },
    get: (c, id) => (data[c] || []).find(x => x.id === id),
    updateTenant: (id, p) => { data.tenants = data.tenants.map(t => t.id === id ? { ...t, ...p } : t); return data.tenants.find(t => t.id === id); },
    audit() {},
  };
}

const TENANT = { id: "t1", name: "Demo NV", plan: "business" };
const TENANT_AI = { id: "t1", name: "Demo NV", plan: "business", moduleOverrides: { add: ["ai_actions"], remove: [] } };
const ADMIN = { id: "u_admin", role: "tenant_admin", name: "Admin", permissions: ["*"] };
const EMPLOYEE = { id: "u_jan", role: "employee", name: "Jan", permissions: ["own:workorders"] };

test("prepare: aanvaarde offerte → kant-en-klaar 'omzetten naar factuur'-plan", () => {
  const store = mkStore(); seedDefaults(store);
  const { plans } = buildPreparedWork(store, TENANT_AI, ADMIN, TODAY);
  const p = plans.find(x => x.kind === "convert_quote");
  assert.ok(p, "convert_quote-plan aanwezig");
  const step = p.steps[0];
  assert.equal(step.action, "convert_quote");
  assert.equal(step.endpoint.path, "offertes/q1/convert", "endpoint met id ingevuld");
  assert.equal(step.params.target, "invoice");
  assert.equal(step.needsAddon, false, "met add-on direct uitvoerbaar");
});

test("prepare: afgewerkte werkbon → factuur met ingevulde klant + regel", () => {
  const store = mkStore(); seedDefaults(store);
  const { plans } = buildPreparedWork(store, TENANT_AI, ADMIN, TODAY);
  const p = plans.find(x => x.kind === "invoice_from_workorder");
  assert.ok(p, "invoice_from_workorder-plan aanwezig");
  const step = p.steps[0];
  assert.equal(step.action, "create_invoice");
  assert.equal(step.params.customerName, "Klant A", "klant vooraf ingevuld");
  assert.equal(step.params.lines[0].unitPrice, 1000, "bedrag uit de werkbon");
  assert.match(step.params.notes, /werkbon WB-1/i);
});

test("prepare: vervallen facturen gebundeld in één herinneringsplan", () => {
  const store = mkStore(); seedDefaults(store);
  store.data.invoices.push({ id: "i2", tenantId: "t1", number: "F-2", total: 300, status: "open", dueDate: past });
  const { plans } = buildPreparedWork(store, TENANT_AI, ADMIN, TODAY);
  const p = plans.find(x => x.kind === "send_reminders");
  assert.ok(p, "send_reminders-plan aanwezig");
  assert.equal(p.priority, 3, "kritiek → hoogste prioriteit");
  assert.match(p.why, /€800/, "totaal openstaand bedrag benoemd");
  assert.equal(p.steps[0].endpoint.path, "notifications/reminders");
});

test("prepare: voorbereiden is GRATIS · zonder add-on plannen zichtbaar maar stap markeert add-on nodig", () => {
  const store = mkStore(); seedDefaults(store);
  const { plans, counts } = buildPreparedWork(store, TENANT, ADMIN, TODAY);   // GEEN ai_actions
  assert.ok(plans.length >= 3, "plannen worden gewoon voorbereid");
  const convert = plans.find(x => x.kind === "convert_quote");
  assert.equal(convert.steps[0].needsAddon, true, "uitvoeren vereist de add-on");
  assert.equal(convert.addonRequired, true);
  assert.ok(counts.addonRequired >= 1);
});

test("prepare: rechten-gescoped · employee zonder facturatierecht krijgt geen factureer-stappen", () => {
  const store = mkStore(); seedDefaults(store);
  const { plans } = buildPreparedWork(store, TENANT_AI, EMPLOYEE, TODAY);
  // Employee ziet geen facturatie-signalen (mona-signals poort) → geen
  // convert/invoice/reminder-plannen met echte acties.
  for (const p of plans) {
    for (const s of p.steps) {
      assert.notEqual(s.action, "create_invoice", "geen factuuractie voor employee");
      assert.notEqual(s.action, "convert_quote", "geen conversie-actie voor employee");
      assert.notEqual(s.action, "send_reminders", "geen herinneringsactie voor employee");
    }
  }
});

test("prepare_project: volledig projectplan met ingevulde velden (dossier + kickoff)", () => {
  const store = mkStore(); seedDefaults(store);
  const plan = prepareProject(store, TENANT_AI, ADMIN, { customerId: "c1", type: "renovatie" }, TODAY);
  assert.equal(plan.kind, "prepare_project");
  const project = plan.steps.find(s => s.action === "create_project");
  const kickoff = plan.steps.find(s => s.action === "create_appointment");
  assert.ok(project && kickoff, "twee stappen: project + kickoff");
  assert.equal(project.params.customerId, "c1");
  assert.equal(project.params.name, "Project Klant A", "projectnaam afgeleid van de klant");
  assert.equal(project.params.type, "renovatie");
  assert.equal(kickoff.params.customerEmail, "a@x.be", "kickoff met klant-e-mail ingevuld");
});

test("prepare_project: onbekende klant faalt netjes", () => {
  const store = mkStore(); seedDefaults(store);
  assert.throws(() => prepareProject(store, TENANT_AI, ADMIN, { customerId: "nope" }), e => e.code === "CUSTOMER_NOT_FOUND");
});

// ── Mona-tools (via runTool) ────────────────────────────────────────────────
test("mona-tool prepare_work: vat de voorbereide plannen samen (rechten-gescoped)", () => {
  const store = mkStore(); seedDefaults(store);
  const r = runTool(store, TENANT_AI, ADMIN, "prepare_work", {}, []);
  assert.ok(Array.isArray(r.plannen) && r.plannen.length >= 3);
  assert.ok(r.plannen.every(p => p.titel && Array.isArray(p.stappen)));
});

test("mona-tool prepare_project: zet de stappen als voorstellen klaar (bevestiging vereist)", () => {
  const store = mkStore(); seedDefaults(store);
  const proposals = [];
  const r = runTool(store, TENANT_AI, ADMIN, "prepare_project", { customerId: "c1" }, proposals);
  assert.ok(!r.error, "plan opgesteld");
  assert.ok(proposals.length >= 1, "voorstellen klaar voor bevestiging");
  assert.ok(proposals.some(p => p.path === "projects"), "project-voorstel met endpoint");
  // Employee zonder projectrecht → geweigerd.
  const deny = runTool(store, TENANT_AI, EMPLOYEE, "prepare_project", { customerId: "c1" }, []);
  assert.ok(deny.error && /toegang/i.test(deny.error));
});

test("propose_action: convert_quote lost :id op uit params (pathTemplate)", () => {
  const store = mkStore(); seedDefaults(store);
  const proposals = [];
  const r = runTool(store, TENANT_AI, ADMIN, "propose_action", { action: "convert_quote", params: { id: "q1", target: "invoice" } }, proposals);
  assert.ok(r.ok, "voorstel ok");
  assert.equal(proposals[0].path, "offertes/q1/convert", ":id ingevuld");
  // Zonder id → nette fout.
  const bad = runTool(store, TENANT_AI, ADMIN, "propose_action", { action: "convert_quote", params: { target: "invoice" } }, []);
  assert.ok(bad.error && /id/i.test(bad.error));
});

test("propose_action: create_invoice vereist de add-on én volledig facturatierecht", () => {
  const store = mkStore(); seedDefaults(store);
  // Zonder add-on → geen uitvoer.
  const noAddon = runTool(store, TENANT, ADMIN, "propose_action", { action: "create_invoice", params: { customerName: "X", lines: [] } }, []);
  assert.ok(noAddon.error && /actions_addon_uit/.test(noAddon.error));
  // Met add-on maar employee zonder facturatierecht → geweigerd.
  const emp = runTool(store, TENANT_AI, EMPLOYEE, "propose_action", { action: "create_invoice", params: {} }, []);
  assert.ok(emp.error && /toegang/i.test(emp.error));
});
