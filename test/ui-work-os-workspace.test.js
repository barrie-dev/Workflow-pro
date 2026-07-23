"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "public", "js", "platforms", "admin-work-os.js"), "utf8");
const admin = fs.readFileSync(path.join(root, "public", "js", "platforms", "admin.js"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "css", "admin-work-os.css"), "utf8");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const coordination = fs.readFileSync(path.join(root, "docs", "FRONTEND-UI-COORDINATION.md"), "utf8");

test("Work OS is een echte, pakket-onafhankelijke tenantwerkruimte", () => {
  assert.match(admin, /CORE_UI_VIEWS = new Set\(\["dashboard", "actions", "operations", "workos", "profielen", "dossiers"\]\)/);
  assert.match(admin, /data-view="workos"/);
  assert.match(admin, /workos: "Werkruimte"/);
  assert.match(source, /A\.views\.workos = renderWorkOs/);
  assert.match(html, /\/css\/admin-work-os\.css/);
  assert.match(html, /\/js\/platforms\/admin-work-os\.js/);
});

test("takenflow gebruikt context, versieconflict en toegestane statusovergangen", () => {
  for (const route of ["/tasks", "/tasks/${task.id}", "/tasks/${task.id}/transition"]) assert.ok(source.includes(route));
  assert.match(source, /const TASK_TRANSITIONS = \{/);
  assert.match(source, /context: readContext\(form, "taskContext", true\)/);
  assert.match(source, /relations: relationContext \? \[relationContext\] : \[\]/);
  assert.match(source, /payload\.expectedVersion = task\.version/);
  assert.match(source, /Open.*Bezig.*Geblokkeerd.*Afgerond/s);
});

test("formulierdesigner en invulling ondersteunen de volledige versievaste flow", () => {
  for (const marker of ["/forms/templates", "/forms/instances", "/submit`, {}", "/lock`, {}", "/photo`, {"]) assert.ok(source.includes(marker), marker);
  assert.match(source, /Korte tekst.*Getal.*Ja \/ nee.*Eén keuze.*Meerdere keuzes.*Datum.*Foto.*Ondertekening/s);
  assert.match(source, /kind: "workos-builder"/);
  assert.match(css, /width:min\(1280px,calc\(100vw - 48px\)\)/);
  assert.match(source, /templateVersion/);
  assert.match(source, /\["submitted", "locked"\]\.includes\(instance\.status\)/);
});

test("bestandenflow uploadt inhoud en vraagt downloads per versie aan", () => {
  assert.match(source, /25 \* 1024 \* 1024/);
  assert.match(source, /encoding: "base64", content: await fileAsBase64\(file\)/);
  assert.match(source, /\/docfiles\/\$\{file\.id\}\/download\?version=/);
  assert.match(source, /Elke download wordt per versie geregistreerd/);
  assert.match(source, /Oude versies worden nooit overschreven/);
});

test("communicatietijdlijn belooft geen aflevering die de backend niet uitvoert", () => {
  assert.match(source, /Contactmoment vastleggen/);
  assert.match(source, /dit scherm simuleert geen e-mail- of sms-verzending/);
  assert.match(source, /await api\("POST", "\/communications", payload\)/);
  assert.doesNotMatch(source, /window\.prompt/);
  assert.match(source, /attachments = \[\.\.\.form\.elements\.attachments\.selectedOptions\]/);
});

test("Work OS blijft ruim en leesbaar op desktop, laptop en mobiel", () => {
  assert.match(css, /max-width:1540px/);
  assert.match(css, /font-size:15px;line-height:1\.65/);
  assert.match(css, /\.workos-task-main>p[^}]*font-size:13px/);
  assert.match(css, /\.workos-task-footer[^}]*font-size:12px/);
  assert.match(css, /\.workos-status[^}]*font-size:12px/);
  assert.match(css, /\.workos-file-main small[^}]*font-size:12\.5px/);
  assert.match(css, /\.workos-timeline-card footer span[^}]*font-size:12px/);
  assert.match(css, /grid-auto-columns:minmax\(280px,34vw\)/);
  assert.match(css, /@media\(max-width:640px\)/);
  assert.match(css, /\.workos-hero-actions \.adm-btn[^}]*font-size:13px/);
  assert.match(css, /width:100vw;height:100dvh/);
  assert.match(css, /\.workos-task-board\{display:grid;grid-auto-flow:row/);
});

test("backendgrenzen voor opslag, delivery en rechten zijn overdraagbaar gedocumenteerd", () => {
  assert.match(coordination, /## Work OS-werkruimte — frontendintegratie 2026-07-19/);
  assert.match(coordination, /POST \/docfiles\/:id\/versions/);
  assert.match(coordination, /\/api\/storage\/upload/);
  assert.match(coordination, /deliveryStatus/);
  assert.match(coordination, /contextcatalogus of resolver/);
});
