"use strict";
// Vendor-boundary-handhaving (infra-handover h3.4, E0 · ADR-001).
// Deze tests falen wanneer verboden imports of cloudvariabelen buiten de
// toegestane mappen opduiken · CI is de poort, niet de code review.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) {
      if (["node_modules", ".git"].includes(f.name)) continue;
      walk(p, out);
    } else if (f.name.endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

const rel = p => path.relative(ROOT, p).replace(/\\/g, "/");
const srcFiles = walk(path.join(ROOT, "src"));

// Legacy-adapters waar Supabase-verwijzingen (tijdelijk) zijn toegestaan (ADR-001 §4).
const SUPABASE_ALLOWED = new Set([
  "src/lib/data-adapters.js",
  "src/lib/supabase-rest-bridge.js",
  "src/lib/config.js",            // leest SUPABASE_URL voor de legacy-adapter
  "src/modules/live-services.js", // readiness-check op de legacy-configuratie
  "src/modules/production.js",    // go-live-checklist van de huidige (legacy) stack
]);

test("architectuur: geen cloud-SDK-imports (Azure/AWS/GCP/Supabase-SDK)", () => {
  const offenders = [];
  for (const f of srcFiles) {
    const s = fs.readFileSync(f, "utf8");
    if (/require\(["'](@azure\/|aws-sdk|@aws-sdk\/|@google-cloud\/|@supabase\/)/.test(s)) offenders.push(rel(f));
  }
  assert.deepEqual(offenders, [], `Vendor-SDK buiten infrastructure/: ${offenders.join(", ")}`);
});

test("architectuur: Supabase-verwijzingen alleen in de legacy-adapters", () => {
  const offenders = [];
  for (const f of srcFiles) {
    if (SUPABASE_ALLOWED.has(rel(f))) continue;
    const s = fs.readFileSync(f, "utf8");
    if (/supabase/i.test(s)) offenders.push(rel(f));
  }
  assert.deepEqual(offenders, [], `Supabase buiten legacy-adapters: ${offenders.join(", ")}`);
});

test("architectuur: src/platform is cloudblind (geen process.env, geen vendor, geen SQL)", () => {
  const platformFiles = srcFiles.filter(f => rel(f).startsWith("src/platform/"));
  assert.ok(platformFiles.length >= 3, "platform-laag bestaat");
  const offenders = [];
  for (const f of platformFiles) {
    const s = fs.readFileSync(f, "utf8");
    if (/process\.env/.test(s)) offenders.push(`${rel(f)} (process.env)`);
    if (/require\(["'](https?|node-fetch|axios)/.test(s)) offenders.push(`${rel(f)} (netwerk)`);
    if (/\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET)\b/.test(s)) offenders.push(`${rel(f)} (SQL)`);
    if (/require\(["']\.\.\/lib\/config/.test(s)) offenders.push(`${rel(f)} (config-import)`);
  }
  assert.deepEqual(offenders, [], offenders.join(", "));
});

test("architectuur: toekomstige domeinlagen zijn cloudblind zodra ze bestaan", () => {
  // h3.2: domain/application/ports mogen geen env, SDK's of HTTP kennen.
  for (const layer of ["domain", "application", "ports"]) {
    const dir = path.join(ROOT, "src", layer);
    if (!fs.existsSync(dir)) continue;
    const offenders = [];
    for (const f of walk(dir)) {
      const s = fs.readFileSync(f, "utf8");
      if (/process\.env/.test(s)) offenders.push(`${rel(f)} (process.env)`);
      if (/require\(["'](@azure\/|aws-sdk|@aws-sdk\/|@google-cloud\/|@supabase\/|https?)/.test(s)) offenders.push(`${rel(f)} (vendor/netwerk)`);
    }
    assert.deepEqual(offenders, [], offenders.join(", "));
  }
});

test("architectuur: RENDER_GIT_COMMIT alleen in de configuratielaag (S1-05)", () => {
  const offenders = [];
  for (const f of srcFiles) {
    if (rel(f) === "src/lib/config.js") continue;
    if (/RENDER_GIT_COMMIT/.test(fs.readFileSync(f, "utf8"))) offenders.push(rel(f));
  }
  assert.deepEqual(offenders, [], `Render-koppeling buiten config: ${offenders.join(", ")}`);
});

test("architectuur: generieke APP_COMMIT_SHA heeft voorrang op RENDER_GIT_COMMIT", () => {
  const cfg = fs.readFileSync(path.join(ROOT, "src/lib/config.js"), "utf8");
  const idxGeneric = cfg.indexOf("APP_COMMIT_SHA");
  const idxRender = cfg.indexOf("RENDER_GIT_COMMIT");
  assert.ok(idxGeneric > -1, "APP_COMMIT_SHA bestaat in config");
  assert.ok(idxRender === -1 || idxGeneric < idxRender, "generieke variabele komt eerst");
});

// ── CTO3-10 · server.js gecontroleerd modulariseren ──────────────────────────
// server.js moet KRIMPEN naar een bootstrap- en registratielaag (einddoel
// < 2.500 regels). Onderstaande budgetten zijn een RATCHET: ze mogen alleen
// DALEN. Wie een nieuwe /api-route rechtstreeks in server.js zet of het bestand
// laat groeien, krijgt hier een rode test. Het budget verhogen is nooit de
// oplossing · dan hoort de route in een router onder src/http/routes.
const SERVER_FILE = path.join(ROOT, "src", "server.js");
const MAX_SERVER_LINES = 10240;   // gemeten bij increment 1
const MAX_INLINE_ROUTES = 569;    // route-definities rechtstreeks in server.js
const FINAL_TARGET_LINES = 2500;  // einddoel uit CTO3-10

function countInlineRoutes(src) {
  // Tel op letterlijke fragmenten (geen fragiele escaping): exacte
  // pathname-vergelijkingen, pathname-regexmatches en de tenant-action-dispatch.
  const needles = [
    'url.pathname === "/api/',
    "url.pathname.match(",
    'action === "',
    "action.match(",
  ];
  const count = (hay, needle) => hay.split(needle).length - 1;
  return needles.reduce((n, s) => n + count(src, s), 0);
}

test("CTO3-10 1· server.js groeit niet meer (regelbudget daalt alleen)", () => {
  const lines = fs.readFileSync(SERVER_FILE, "utf8").split("\n").length;
  assert.ok(lines <= MAX_SERVER_LINES,
    `server.js heeft ${lines} regels, budget ${MAX_SERVER_LINES}. Extraheer naar src/http/routes en verlaag het budget · verhogen is geen optie.`);
});

test("CTO3-10 2· geen NIEUWE routehandlers rechtstreeks in server.js", () => {
  const n = countInlineRoutes(fs.readFileSync(SERVER_FILE, "utf8"));
  assert.ok(n <= MAX_INLINE_ROUTES,
    `${n} inline route-definities in server.js, budget ${MAX_INLINE_ROUTES}. Nieuwe routes horen in een router onder src/http/routes.`);
});

test("CTO3-10 3· het routercontract bestaat en server.js roept het aan", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "src/http/routes/index.js")), "src/http/routes/index.js ontbreekt");
  const R = require("../src/http/routes");
  assert.equal(typeof R.registerRoutes, "function");
  assert.equal(typeof R.dispatch, "function");
  const src = fs.readFileSync(SERVER_FILE, "utf8");
  assert.match(src, /registerRoutes\(/, "server.js registreert de routers");
  assert.match(src, /httpRouter\.dispatch\(/, "server.js dispatcht vóór de eigen afhandeling");
});

test("CTO3-10 4· routers raken store.data niet rechtstreeks aan", () => {
  const dir = path.join(ROOT, "src", "http", "routes");
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith(".js") && x !== "index.js")) {
    const s = fs.readFileSync(path.join(dir, f), "utf8");
    if (/store\.data/.test(s)) offenders.push(`${f} (store.data)`);
    if (/require\(["']\.\.\/\.\.\/lib\/store["']\)/.test(s)) offenders.push(`${f} (store-import)`);
  }
  assert.deepEqual(offenders, [], `router → policy → service → repository: ${offenders.join(", ")}`);
});

test("CTO3-10 5· elke geregistreerde route heeft methode, pad en handler", () => {
  const R = require("../src/http/routes");
  const routes = R.registerRoutes({ store: {}, sendJson() {}, publicStatus() { return {}; }, config: {} });
  assert.ok(routes.length >= 1, "minstens één geëxtraheerde route");
  for (const r of routes) {
    assert.ok(Array.isArray(r.methods) && r.methods.length >= 1);
    assert.ok(typeof r.path === "string" || r.path instanceof RegExp);
    assert.equal(typeof r.handler, "function");
  }
});

test("CTO3-10 6· dispatch laat niet-matchende requests ongemoeid (404/405-pariteit)", async () => {
  const R = require("../src/http/routes");
  const routes = R.registerRoutes({ store: {}, sendJson() {}, publicStatus() { return {}; }, config: {} });
  assert.equal(await R.dispatch(routes, { method: "GET" }, {}, new URL("http://x/api/bestaat-niet")), false);
  // Bekend pad, verkeerde methode → bewust NIET afgehandeld, zodat server.js
  // exact hetzelfde 404/405-gedrag houdt als vóór de extractie.
  assert.equal(await R.dispatch(routes, { method: "DELETE" }, {}, new URL("http://x/api/status")), false);
});

test("CTO3-10 7· het einddoel blijft staan tot het budget het raakt", () => {
  assert.equal(FINAL_TARGET_LINES, 2500);
  assert.ok(MAX_SERVER_LINES >= FINAL_TARGET_LINES, "blijf extraheren tot het budget het einddoel raakt");
});
