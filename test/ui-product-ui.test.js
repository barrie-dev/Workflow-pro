const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const admin = fs.readFileSync(path.join(root, "public", "js", "platforms", "admin.js"), "utf8");
const workspaces = fs.readFileSync(path.join(root, "public", "js", "platforms", "admin-product-workspaces.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "css", "admin-product-ui.css"), "utf8");

test("de admin laadt de herkenbare productlaag als laatste visuele bron", () => {
  assert.match(html, /<link rel="stylesheet" href="\/css\/admin-product-ui\.css">/);
  assert.match(css, /Monargo One product UI 2026/);
  assert.match(css, /--product-navy:#111c2e/);
  assert.match(css, /#platform-admin \.adm-sidebar \{[\s\S]*background:var\(--product-navy\)/);
  assert.match(css, /font-size:14px/);
});

test("de productidentiteit gebruikt het echte merksymbool", () => {
  assert.match(admin, /<img src="\/brand\/one-symbol\.svg" alt="">/);
  assert.match(admin, /<span>One<\/span><small>by Monargo<\/small>/);
  assert.doesNotMatch(admin, /adm-brand-icon"><span aria-hidden="true">M<\/span>/);
});

test("sectorbegrippen vallen terug op leesbare producttaal", () => {
  assert.match(admin, /function termA\(key, fallback\)/);
  assert.match(admin, /termA\("jobSingular", tA\("emp\.wo\.default","Werkbon"\)\)/);
  assert.doesNotMatch(admin, /\(window\.wfpTerms && window\.wfpTerms\.t\("jobSingular"\)\) \|\|/);
});

test("dashboard en domeinen combineren datadichtheid met herkenbare hiërarchie", () => {
  assert.match(css, /#platform-admin \.adm-guided-entry \{ display:none; \}/);
  assert.match(css, /#platform-admin \.pws-hero,[\s\S]*background:#fff;/);
  assert.match(css, /#platform-admin \.adm-command-strip \{[\s\S]*grid-template-columns:220px minmax\(0,1fr\)/);
  assert.match(css, /#platform-admin \.adm-kpi \{[\s\S]*border-top:3px solid/);
  assert.doesNotMatch(admin, /id="admQuickAi"/);
  assert.doesNotMatch(admin, /class="adm-ai-card"/);
  assert.match(workspaces, /title: l\("Projecten", "Projets", "Projects"\)/);
  assert.match(workspaces, /title: l\("Voorraad", "Stock", "Inventory"\)/);
  assert.doesNotMatch(workspaces, /Projecten die de volledige uitvoering verbinden/);
});

test("onboarding respecteert verborgen stappen en acties", () => {
  assert.match(css, /\.adm-onboarding-actions \[hidden\],[\s\S]*display:none !important;/);
  assert.match(css, /\.adm-onboarding-dialog \{[\s\S]*border-radius:16px/);
});
