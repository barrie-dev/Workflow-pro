// h50/h51 performance-laag: P95-budget per endpointklasse (pilotdoelen h50.1:
// interactieve read < 800 ms, interactieve write < 1500 ms). Op localhost
// liggen de tijden ver onder de doelen; dit net vangt REGRESSIES (een lek dat
// elke lijst traag maakt) en bewaakt dat de meting zelf blijft bestaan.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
function p95(samples) {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)];
}
async function measure(n, fn) {
  const samples = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const r = await fn(i);
    samples.push(performance.now() - t0);
    if (r.status >= 400) throw new Error(`meting kreeg status ${r.status}`);
  }
  return { p95: Math.round(p95(samples)), avg: Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) };
}

(async () => {
  const READ_BUDGET_MS = 800;     // h50.1 pilotdoel interactieve read
  const WRITE_BUDGET_MS = 1500;   // h50.1 pilotdoel interactieve write
  // Steekproefgroottes BINNEN het rate-limit-budget (write 80/min, read
  // 180/min): 30+20 seed-writes + 20 gemeten writes = 70; 5×25 reads = 125.
  const N = 25;
  const N_WRITE = 20;

  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  // Dataset: 30 klanten + 20 facturen zodat lijsten en grid iets te doen hebben.
  for (let i = 0; i < 30; i++) await j("POST", `/api/tenants/${tid}/customers`, { name: `Perf Klant ${i}`, email: `perf${i}@x.be` }, tok);
  const klanten = (await j("GET", `/api/tenants/${tid}/customers`, null, tok)).data.customers;
  for (let i = 0; i < 20; i++) {
    await j("POST", `/api/tenants/${tid}/facturen`, { customerId: klanten[i % klanten.length].id, customerName: klanten[i % klanten.length].name, lines: [{ description: `Werk ${i}`, qty: 1 + (i % 3), unitPrice: 100 + i, vatRate: 21 }] }, tok);
  }
  // Warm-up buiten de meting.
  await j("GET", `/api/tenants/${tid}/customers`, null, tok);
  await j("GET", `/api/tenants/${tid}/facturen`, null, tok);

  const reads = [
    ["GET klantenlijst", () => j("GET", `/api/tenants/${tid}/customers`, null, tok)],
    ["GET facturenlijst (incl. h45-saldi)", () => j("GET", `/api/tenants/${tid}/facturen`, null, tok)],
    ["POST grid-query klanten (cursor+filter)", () => j("POST", `/api/tenants/${tid}/grid/customers/query`, { limit: 25, filters: [{ field: "name", op: "contains", value: "Perf" }] }, tok)],
    ["GET /v1-lijst (moderne laag erbovenop)", () => j("GET", "/v1/customers?limit=25&filter=name:contains:Perf", null, tok)],
    ["GET insights-dashboard (read-model)", () => j("GET", `/api/tenants/${tid}/insights`, null, tok)],
  ];
  for (const [naam, fn] of reads) {
    const m = await measure(N, fn);
    check(`${naam} · P95 ${m.p95}ms (gem ${m.avg}ms) < ${READ_BUDGET_MS}ms`, m.p95 < READ_BUDGET_MS, `${m.p95}ms`);
  }

  const write = await measure(N_WRITE, i => j("POST", `/api/tenants/${tid}/customers`, { name: `Perf Write ${i}`, email: `pw${i}@x.be` }, tok));
  check(`POST klant aanmaken · P95 ${write.p95}ms (gem ${write.avg}ms) < ${WRITE_BUDGET_MS}ms`, write.p95 < WRITE_BUDGET_MS, `${write.p95}ms`);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
