const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const admin = fs.readFileSync(path.join(root, "public", "js", "platforms", "admin.js"), "utf8");
const workspaces = fs.readFileSync(path.join(root, "public", "js", "platforms", "admin-product-workspaces.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "css", "admin-product-ui.css"), "utf8");

test("de admin laadt de rustige productlaag als laatste visuele bron", () => {
  assert.match(html, /<link rel="stylesheet" href="\/css\/admin-product-ui\.css">/);
  assert.match(css, /Monargo One product UI 2026/);
  assert.match(css, /--product-sidebar:#fbfcfd/);
  assert.match(css, /#platform-admin \.adm-sidebar \{[\s\S]*background:var\(--product-sidebar\)/);
});

test("de productidentiteit gebruikt het echte merksymbool", () => {
  assert.match(admin, /<img src="\/brand\/one-symbol\.svg" alt="">/);
  assert.match(admin, /<span>One<\/span><small>by Monargo<\/small>/);
  assert.doesNotMatch(admin, /adm-brand-icon"><span aria-hidden="true">M<\/span>/);
});

test("dashboard en domeinen zijn data-first in plaats van marketingkaarten", () => {
  assert.match(css, /#platform-admin \.adm-guided-entry \{ display:none; \}/);
  assert.match(css, /#platform-admin \.pws-hero,[\s\S]*background:#fff;/);
  assert.match(css, /#platform-admin \.adm-command-strip \.adm-quick-actions \{ grid-template-columns:repeat\(3/);
  assert.doesNotMatch(admin, /id="admQuickAi"/);
  assert.doesNotMatch(admin, /class="adm-ai-card"/);
  assert.match(workspaces, /title: l\("Projecten", "Projets", "Projects"\)/);
  assert.match(workspaces, /title: l\("Voorraad", "Stock", "Inventory"\)/);
  assert.doesNotMatch(workspaces, /Projecten die de volledige uitvoering verbinden/);
});

test("onboarding respecteert verborgen stappen en acties", () => {
  assert.match(css, /\.adm-onboarding-actions \[hidden\],[\s\S]*display:none !important;/);
  assert.match(css, /\.adm-onboarding-dialog \{[\s\S]*border-radius:12px/);
});
