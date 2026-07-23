"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const manager = read("public/js/platforms/manager.js");
const employee = read("public/js/platforms/employee.js");
const superadmin = read("public/js/platforms/superadmin.js");
const admin = read("public/js/platforms/admin.js");
const css = read("public/css/monargo-design-system.css");

function values(source, expression) {
  return [...source.matchAll(expression)].map(match => match[1]);
}

test("elke Manager-module in de navigatie heeft een renderer", () => {
  const views = new Set(values(manager, /class="mgr-nav-item[^"]*" data-view="([^"]+)"/g));
  assert.deepEqual([...views].sort(), [
    "clocking", "dashboard", "expenses", "leaves", "messages",
    "planning", "reports", "team", "vehicles", "workorders"
  ]);
  for (const view of views) assert.match(manager, new RegExp(`\\b${view}: render[A-Z]`), `${view} mist een renderer`);
});

test("elke Medewerker-module in de navigatie heeft een renderer", () => {
  const views = new Set(values(employee, /class="emp-tab[^"]*" data-view="([^"]+)"/g));
  assert.deepEqual([...views].sort(), [
    "clock", "expenses", "leaves", "messages", "more",
    "planning", "timesheet", "today", "workorders"
  ]);
  for (const view of views) assert.match(employee, new RegExp(`\\b${view}: render[A-Z]`), `${view} mist een renderer`);
});

test("elke Superadmin-module in de navigatie staat in de viewregistry", () => {
  const views = new Set(values(superadmin, /class="sa-nav-item[^"]*" data-view="([^"]+)"/g));
  assert.deepEqual([...views].sort(), [
    "audit", "billing", "communication", "dashboard", "integrations",
    "modules", "ops", "resellers", "security", "settings", "staff",
    "support", "system", "tenants"
  ]);
  const registry = superadmin.match(/const VIEWS = \{([^}]+)\}/)?.[1] || "";
  for (const view of views) assert.match(registry, new RegExp(`\\b${view}\\b`), `${view} mist in VIEWS`);
});

test("Admin groepeert alle productdomeinen zonder een navigatie-item te verliezen", () => {
  const grouped = admin.match(/const ADMIN_NAV_GROUPS = \[([\s\S]*?)\n  \];/)?.[1] || "";
  for (const view of [
    "dashboard", "actions", "operations", "planning", "workorders", "projects",
    "worksites", "vehicles", "stock", "appointments", "assets", "customers",
    "venues", "offertes", "contracts", "catalog", "purchasing", "inventory",
    "facturen", "payments", "employees", "employee_records", "clocking",
    "leaves", "expenses", "incidents", "ciaw", "posted_workers",
    "progress-claims", "reports", "portfolio", "lists", "dossiers", "workos",
    "templates", "formulieren", "integrations", "webhooks", "profielen",
    "audit", "billing", "roadmap", "settings"
  ]) assert.ok(grouped.includes(`"${view}"`), `${view} ontbreekt in de nieuwe groepen`);
});

test("kleine Medewerkerschermen klappen oude inline grids en meldingen veilig in", () => {
  assert.match(css, /#platform-employee \[style\*="grid-template-columns:1fr 1fr"\]/);
  assert.match(css, /#platform-employee #empNotifPanel/);
  assert.match(css, /@media \(max-width: 380px\)/);
  assert.doesNotMatch(employee, /style="width:100%;10px/);
});
