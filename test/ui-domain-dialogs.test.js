"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const source = read("public/js/platforms/admin-domains.js");
const admin = read("public/js/platforms/admin.js");
const manager = read("public/js/platforms/manager.js");
const employee = read("public/js/platforms/employee.js");
const superadmin = read("public/js/platforms/superadmin.js");
const main = read("public/main.js");
const css = read("public/css/admin-automation-workspace.css");

test("domeinwerkruimtes gebruiken geen browserprompt of browserconfirm", () => {
  assert.doesNotMatch(source, /\b(?:window\.)?(?:prompt|confirm)\s*\(/);
  assert.match(source, /function askDialog\(options\)/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /event\.key === "Escape"/);
});

test("de volledige tenant-admin gebruikt dezelfde applicatiedialoog", () => {
  assert.doesNotMatch(admin, /\b(?:window\.)?(?:prompt|confirm)\s*\(/);
  assert.match(source, /A\.askDialog = askDialog/);
  assert.match(admin, /function uiConfirm\(message, options\)/);
  assert.match(admin, /function uiInput\(label, options\)/);
  assert.match(admin, /input: "password", minlength: 8/);
});

test("manager en medewerker gebruiken dezelfde bevestigingslaag", () => {
  assert.doesNotMatch(manager, /\b(?:window\.)?(?:prompt|confirm)\s*\(/);
  assert.doesNotMatch(employee, /\b(?:window\.)?(?:prompt|confirm)\s*\(/);
  assert.match(manager, /function confirmM\(message, title\)/);
  assert.match(employee, /function confirmE\(message, title\)/);
});

test("platformbeheer en legacy beheerschermen vermijden browserdialogen", () => {
  const browserDialog = /\b(?:window\.)?(?:prompt|confirm|alert)\s*\(/;
  assert.doesNotMatch(superadmin, browserDialog);
  assert.doesNotMatch(main, browserDialog);
  assert.match(superadmin, /const saDialog = options/);
  assert.match(main, /function appDialog\(options\)/);
  assert.match(superadmin, /Support-sessie gestart/);
  assert.match(main, /MFA-verificatie/);
});

test("vorderingsstaten kiezen een echt project in plaats van een technisch tekstveld", () => {
  assert.match(source, /options: opts\.map\(project => \(\{ value: project\.id/);
  assert.match(source, /label: `\$\{project\.number \|\| project\.id\} · \$\{project\.name\}`/);
  assert.match(source, /projectId: proj\.id/);
});

test("risicovolle domeinacties hebben een expliciete dialoog", () => {
  assert.match(source, /Signing secret roteren/);
  assert.match(source, /input: "secret"/);
  assert.match(source, /Webhookendpoint verwijderen/);
  assert.match(source, /Status in bulk wijzigen/);
  assert.match(source, /Controleer de impact/);
  assert.match(source, /Terugsturen voor correctie/);
  assert.match(source, /Toewijzing terugdraaien/);
});

test("verplichte redenen blijven gericht gevalideerd", () => {
  assert.match(source, /cfg\.required && !value/);
  assert.match(source, /dom\.wo\.rejectWhy[\s\S]{0,180}input: "textarea", required: true/);
  assert.match(source, /dom\.pay\.reverseReason[\s\S]{0,180}input: "textarea", required: true/);
});

test("dialoog is gecentreerd op desktop en als mobiele sheet beschikbaar", () => {
  assert.match(css, /\.dom-dialog-backdrop\{position:fixed;inset:0/);
  assert.match(css, /\.dom-dialog\{width:min\(560px,100%\)/);
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(css, /border-radius:18px 18px 0 0/);
});
