#!/usr/bin/env node
"use strict";
/**
 * Loadtest + performancebaseline (CTO Fase C · h50.1, aangescherpt door de
 * productbeslissing 2026-07-21: zwaarste gevallen HARD onder 1 seconde,
 * streefdoel alles onder 200 ms).
 *
 *   node scripts/loadtest.js                 → verse server (JSON-adapter) + grote dataset
 *   node scripts/loadtest.js --postgres      → idem op de pg-adapter (DATABASE_URL vereist)
 *   node scripts/loadtest.js --small         → kleinere dataset (snelle sanity-run)
 *
 * Werkwijze: eigen server spawnen met RATE_LIMIT_DISABLED (bestaande
 * testfaciliteit · nooit in productie), een realistische zware tenant seeden
 * via de echte API (dus inclusief alle validatie), en daarna per scenario
 * P50/P95/P99 meten · sequentieel én met 10 gelijktijdige gebruikers.
 * Exitcode 1 zodra één scenario het harde budget breekt.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const PORT = process.env.LOADTEST_PORT || "4451";
const BASE = `http://localhost:${PORT}`;
const POSTGRES = process.argv.includes("--postgres");
const SMALL = process.argv.includes("--small");

const TARGET_MS = 200;      // streefdoel (alles)
const HARD_MS = 1000;       // hard budget (zwaarste gevallen)

// Datasetomvang · "zwaarste realistische tenant".
const N = SMALL
  ? { customers: 150, articles: 50, employees: 10, projects: 15, invoices: 120, workorders: 150, shifts: 120, payments: 40 }
  : { customers: 1500, articles: 300, employees: 40, projects: 100, invoices: 1200, workorders: 1500, shifts: 1200, payments: 400 };

function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      http.get(`${BASE}/api/health`, res => {
        if (res.statusCode === 200) return resolve();
        res.resume();
        Date.now() < deadline ? setTimeout(poll, 400) : reject(new Error("health bleef niet-200"));
      }).on("error", () => (Date.now() < deadline ? setTimeout(poll, 400) : reject(new Error("server kwam niet op"))));
    };
    poll();
  });
}

async function j(method, pathName, body, token) {
  const r = await fetch(BASE + pathName, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (r.status >= 400) {
    const e = new Error(`${method} ${pathName} → ${r.status}: ${data.error || ""}`);
    e.status = r.status;
    throw e;
  }
  return data;
}

/** Parallel in batches · snel seeden zonder de event-loop te verzuipen. */
async function inBatches(count, batchSize, fn) {
  const results = [];
  for (let start = 0; start < count; start += batchSize) {
    const batch = [];
    for (let i = start; i < Math.min(start + batchSize, count); i++) batch.push(fn(i));
    results.push(...await Promise.all(batch));
  }
  return results;
}

function percentiles(samples) {
  const s = [...samples].sort((a, b) => a - b);
  const at = q => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: s[s.length - 1], avg: s.reduce((a, b) => a + b, 0) / s.length };
}

async function measure(name, fn, { sequential = 40, concurrency = 10, rounds = 5 } = {}) {
  // Warmup buiten de meting.
  await fn(); await fn();
  const seq = [];
  for (let i = 0; i < sequential; i++) {
    const t0 = performance.now();
    await fn(i);
    seq.push(performance.now() - t0);
  }
  const conc = [];
  for (let r = 0; r < rounds; r++) {
    const timed = await Promise.all(Array.from({ length: concurrency }, async (_, i) => {
      const t0 = performance.now();
      await fn(r * concurrency + i);
      return performance.now() - t0;
    }));
    conc.push(...timed);
  }
  return { name, seq: percentiles(seq), conc: percentiles(conc) };
}

async function main() {
  const t0 = Date.now();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mona-load-"));
  const env = {
    ...process.env,
    PORT, NODE_ENV: "development",
    RATE_LIMIT_DISABLED: "true",
    WORKFLOWPRO_INITIAL_ADMIN_PASSWORD: "Demo2026!",   // alleen in dit harnas
    ...(POSTGRES
      ? { STORAGE_ADAPTER: "postgres" }               // DATABASE_URL van de aanroeper
      : { STORAGE_ADAPTER: "json", WORKFLOWPRO_DATA_FILE: path.join(dataDir, "data.json") }),
  };
  if (POSTGRES && !/^postgres/.test(String(process.env.DATABASE_URL || ""))) {
    console.error("--postgres vereist DATABASE_URL (wijs naar een LEGE loadtest-database, nooit productie)");
    process.exit(2);
  }
  console.log(`Adapter   : ${POSTGRES ? "postgres" : "json"} · dataset ${SMALL ? "klein" : "groot"}`);
  const server = spawn(process.execPath, [path.join(ROOT, "src", "server.js")], { env, stdio: "ignore" });
  try {
    await waitForHealth();
    const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
    const tok = login.token;
    const tid = (await j("GET", "/api/me", null, tok)).user.tenantId;
    const T = p => `/api/tenants/${tid}${p}`;

    // ── Seed ────────────────────────────────────────────────────────────────
    console.log("Seeden…");
    const customers = await inBatches(N.customers, 25, i =>
      j("POST", T("/customers"), { name: `Loadklant ${i} BV`, email: `load${i}@klant.be`, city: ["Gent", "Antwerpen", "Brugge", "Leuven"][i % 4] }, tok).then(r => r.customer));
    const employees = await inBatches(N.employees, 10, i =>
      j("POST", T("/employees"), { name: `Kracht ${i}`, email: `kracht${i}@demobouw.be`, password: "Demo2026!x", role: "employee" }, tok).then(r => r.employee || r.user));
    await inBatches(N.articles, 25, i =>
      j("POST", T("/articles"), { name: `Artikel ${i}`, type: "materiaal", unit: "stuk", costPrice: 5 + (i % 40), salesPrice: 9 + (i % 60) }, tok).catch(() => null));
    const projects = await inBatches(N.projects, 10, i =>
      j("POST", T("/projects"), { name: `Project ${i}`, customerId: customers[i % customers.length].id, budgetAmount: 25000 + i * 100 }, tok).then(r => r.project).catch(() => null));
    const invoices = await inBatches(N.invoices, 25, i =>
      j("POST", T("/facturen"), {
        customerId: customers[i % customers.length].id,
        customerName: customers[i % customers.length].name,
        projectId: projects.length && projects[i % projects.length] ? projects[i % projects.length].id : undefined,
        lines: [
          { description: `Werk ${i}`, qty: 1 + (i % 3), unitPrice: 120 + (i % 200), vatRate: 21 },
          { description: `Materiaal ${i}`, qty: 2, unitPrice: 35 + (i % 50), vatRate: 21 },
        ],
      }, tok).then(r => r.invoice));
    await inBatches(N.workorders, 25, i =>
      j("POST", T("/workorders"), { title: `Werkbon ${i}`, date: `2026-0${1 + (i % 6)}-${String(1 + (i % 27)).padStart(2, "0")}`, description: `Interventie ${i}`, customerId: customers[i % customers.length].id }, tok).catch(() => null));
    await inBatches(N.shifts, 25, i =>
      j("POST", T("/planning"), {
        userId: employees[i % employees.length].id,
        date: `2026-0${1 + (i % 6)}-${String(1 + (i % 27)).padStart(2, "0")}`,
        start: `${String(6 + (i % 3)).padStart(2, "0")}:00`, end: `${String(15 + (i % 3)).padStart(2, "0")}:00`,
      }, tok).catch(() => null));
    const payments = await inBatches(N.payments, 20, i =>
      j("POST", T("/payments"), { amount: 150 + (i % 900), method: "bank", customerId: customers[i % customers.length].id }, tok).then(r => r.payment).catch(() => null));
    // Deel van de betalingen toewijzen zodat facturen-saldi echt rekenen.
    await inBatches(Math.floor(N.payments / 2), 20, i => {
      const p = payments[i]; const inv = invoices[i % invoices.length];
      if (!p || !inv) return Promise.resolve(null);
      return j("POST", T(`/payments/${p.id}/allocate`), { allocations: [{ invoiceId: inv.id, amount: Math.min(p.amount, 50) }] }, tok).catch(() => null);
    });
    console.log(`Seed klaar in ${Math.round((Date.now() - t0) / 1000)}s · ${N.customers} klanten, ${N.invoices} facturen, ${N.workorders} werkbonnen, ${N.shifts} shifts, ${N.payments} betalingen`);

    // ── Scenario's · de zwaarste lees- en schrijfpaden ──────────────────────
    const projForFinance = projects.find(Boolean);
    let writeSeq = 0;
    const scenarios = [
      ["GET klantenlijst", () => j("GET", T("/customers"), null, tok)],
      ["GET facturenlijst (h45-saldi)", () => j("GET", T("/facturen"), null, tok)],
      ["GET werkbonnenlijst", () => j("GET", T("/workorders"), null, tok)],
      ["GET planning/unified", () => j("GET", T("/planning/unified"), null, tok)],
      ["GET betalingenlijst", () => j("GET", T("/payments"), null, tok)],
      ["grid customers query (filter+zoek)", () => j("POST", T("/grid/customers/query"), { limit: 50, search: "Loadklant 12", filters: [{ field: "city", op: "eq", value: "Gent" }] }, tok)],
      ["grid invoices query (sort)", () => j("POST", T("/grid/invoices/query"), { limit: 50, sort: { field: "total", dir: "desc" } }, tok)],
      ["/v1 customers (centen+filter)", () => j("GET", `/v1/customers?limit=100&filter=name:contains:Loadklant`, null, tok)],
      ["GET insights (dashboard)", () => j("GET", T("/insights"), null, tok)],
      ["GET compliance-overzicht", () => j("GET", T("/compliance/overview"), null, tok)],
      ["GET dimona-register", () => j("GET", T("/dimona/declarations"), null, tok)],
      ["GET zoeken (globaal)", () => j("GET", T("/search?q=Loadklant"), null, tok)],
      ...(projForFinance ? [["GET projectfinance (aggregatie)", () => j("GET", T(`/projects/${projForFinance.id}/finance`), null, tok)]] : []),
      ["POST klant (write+flush)", () => j("POST", T("/customers"), { name: `Writeklant ${writeSeq++}`, email: `w${writeSeq}-${Date.now()}@x.be` }, tok)],
      ["POST factuur (write+flush)", () => j("POST", T("/facturen"), { customerName: "Writeklant", lines: [{ description: "W", qty: 1, unitPrice: 100, vatRate: 21 }] }, tok)],
    ];

    console.log("\nMeten (40 sequentieel + 5×10 gelijktijdig per scenario)…\n");
    const results = [];
    for (const [name, fn] of scenarios) results.push(await measure(name, fn));

    // ── Rapport ─────────────────────────────────────────────────────────────
    const fmt = v => `${Math.round(v)}ms`;
    const verdict = r => {
      const worst = Math.max(r.seq.p95, r.conc.p95);
      if (worst > HARD_MS) return "✖ BOVEN HARD BUDGET";
      if (worst > TARGET_MS) return "△ boven streefdoel";
      return "✔";
    };
    console.log("Scenario".padEnd(38) + "seq P50/P95".padEnd(16) + "conc P50/P95".padEnd(17) + "max".padEnd(8) + "oordeel");
    console.log("─".repeat(95));
    let hardBreaches = 0, softBreaches = 0;
    for (const r of results) {
      const v = verdict(r);
      if (v.startsWith("✖")) hardBreaches++;
      else if (v.startsWith("△")) softBreaches++;
      console.log(
        r.name.padEnd(38)
        + `${fmt(r.seq.p50)}/${fmt(r.seq.p95)}`.padEnd(16)
        + `${fmt(r.conc.p50)}/${fmt(r.conc.p95)}`.padEnd(17)
        + fmt(Math.max(r.seq.max, r.conc.max)).padEnd(8)
        + v);
    }
    console.log("─".repeat(95));
    console.log(`Budget: streefdoel P95 < ${TARGET_MS}ms · hard < ${HARD_MS}ms | ${results.length - hardBreaches - softBreaches} groen, ${softBreaches} boven streefdoel, ${hardBreaches} boven hard budget`);
    process.exitCode = hardBreaches ? 1 : 0;
  } finally {
    server.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(err => { console.error("LOADTEST FOUT:", err.message); process.exit(1); });
