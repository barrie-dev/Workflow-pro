// Route-smoke · P0-01 migratie-orchestrator + per-domein reconcile-endpoints.
// Sluit het dekkingsgat: de admin-endpoints (migration/identity/finance/company
// status+reconcile) waren enkel via unit + live-pg getest, niet op server-wiring
// + auth. Deze smoke draait op de JSON-adapter (geen pg), dus bewijst de WIRING,
// de superadmin-gating en de responsstructuur · de GROENE reconciliatie zelf is
// gedekt door de live-pg-tests (identity/finance/company).
const BASE = "http://localhost:" + (process.env.PORT || "4299");
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

(async () => {
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  const adminTok = (await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" })).data.token;
  check("setup: superadmin + tenant-admin ingelogd", !!superTok && !!adminTok);

  // ── Cross-domein migratiestatus (orchestrator) ───────────────────────────
  const st = await j("GET", "/api/admin/migration/status", null, superTok);
  check("status: endpoint bereikbaar (200)", st.status === 200 && st.data.migration, st.status);
  const order = (st.data.migration || {}).order || [];
  check("status: dependency-volgorde identity → company → finance", JSON.stringify(order) === JSON.stringify(["identity", "company", "finance"]), order.join(","));
  check("status: CRM informatief meegenomen", !!(st.data.migration && st.data.migration.info && st.data.migration.info.crm), JSON.stringify(st.data.migration && st.data.migration.info));

  // ── Cross-domein reconcile · structuur (JSON-adapter: geen pg → ok:false) ──
  const rec = await j("POST", "/api/admin/migration/reconcile", {}, superTok);
  check("reconcile: goed-gevormd antwoord (200 of 409)", (rec.status === 200 || rec.status === 409) && rec.data.reconcile, rec.status);
  const domains = (rec.data.reconcile || {}).domains || {};
  check("reconcile: alle drie de domeinen gerapporteerd", ["identity", "company", "finance"].every(k => k in domains), Object.keys(domains).join(","));
  check("reconcile: op JSON-adapter degradeert het netjes (geen pg)", rec.data.reconcile && rec.data.reconcile.ok === false, rec.data.reconcile && rec.data.reconcile.ok);

  // ── Per-domein status-endpoints bereikbaar ────────────────────────────────
  for (const dom of ["identity", "finance", "company"]) {
    const s = await j("GET", `/api/admin/${dom}/status`, null, superTok);
    check(`status: /admin/${dom}/status bereikbaar`, s.status === 200 && !!s.data[dom], s.status);
  }

  // ── Auth-gating: een tenant-admin is GEEN superadmin ──────────────────────
  const deniedStatus = await j("GET", "/api/admin/migration/status", null, adminTok);
  check("auth: tenant-admin geweigerd op migratiestatus", deniedStatus.status === 403, deniedStatus.status);
  const deniedRec = await j("POST", "/api/admin/migration/reconcile", {}, adminTok);
  check("auth: tenant-admin geweigerd op reconcile", deniedRec.status === 403, deniedRec.status);
  const noAuth = await j("GET", "/api/admin/migration/status", null, null);
  check("auth: zonder token 401", noAuth.status === 401, noAuth.status);

  console.log(failures ? `\n${failures} controle(s) faalden` : "\nMigratie-orchestrator-smoke groen");
  exitSoft(failures ? 1 : 0);
})().catch(e => { console.error("SMOKE CRASH", e); exitSoft(1); });
