#!/usr/bin/env node
"use strict";

// ── scripts/synthetic-checks.js (CTO3-12) ────────────────────────────────────
// EXTERNE synthetische checks: liveness, readiness, login en een veilige
// canaryflow, uitgevoerd van BUITEN de applicatie tegen een echte URL. Bewust
// géén in-process check · "monitoring die alleen dezelfde applicatie-instantie
// bevraagt" telt niet (spec CTO3-12).
//
// Draai dit vanaf een externe runner (cron/uptime-provider/GitHub schedule):
//   SYNTHETIC_TARGET=https://app.monargo.one \
//   SYNTHETIC_EMAIL=canary@... SYNTHETIC_PASSWORD=... \
//   node scripts/synthetic-checks.js [--json]
//
// Exit 1 zodra één check faalt · dat is het alertsignaal. De uitvoer bevat
// NOOIT secrets: alles loopt door de logredactie van CTO3-12.

const { redactForLog, hashTenantId } = require("../src/platform/log-redaction");

const TARGET = String(process.env.SYNTHETIC_TARGET || "").replace(/\/+$/, "");
const EMAIL = process.env.SYNTHETIC_EMAIL || "";
const PASSWORD = process.env.SYNTHETIC_PASSWORD || "";
const TIMEOUT_MS = Number(process.env.SYNTHETIC_TIMEOUT_MS) || 10000;
const jsonMode = process.argv.includes("--json");

async function call(method, path, { body = null, token = null } = {}) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(TARGET + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, data: { error: e.name === "AbortError" ? "timeout" : e.message }, ms: Date.now() - t0 };
  } finally { clearTimeout(timer); }
}

async function main() {
  if (!TARGET) {
    console.error("SYNTHETIC_TARGET ontbreekt · geef de externe URL van de omgeving mee.");
    process.exit(2);
  }
  const checks = [];
  const add = (name, ok, detail, ms) => checks.push({ name, ok: !!ok, detail, ms });

  // 1. LIVENESS · het proces leeft (mag 200 zijn tijdens het opstarten).
  const live = await call("GET", "/api/health");
  add("liveness", live.status === 200, `status=${live.status} sha=${live.data.commitSha || "?"}`, live.ms);

  // 2. READINESS · pas 200 als DB, migraties, writer-lock, state en bootflush OK zijn.
  const ready = await call("GET", "/api/ready");
  const rc = (ready.data && ready.data.checks) || {};
  add("readiness", ready.status === 200 && ready.data.ok === true,
    `status=${ready.status} state=${ready.data.status || "?"} storage=${rc.storageAdapter || "?"} object=${rc.objectStorageAdapter || "?"}`, ready.ms);

  // 3. Deploy-identiteit zichtbaar (CTO3-02/06): SHA + deploymentId.
  add("deploy_identity", !!(ready.data.commitSha && ready.data.deploymentId),
    `sha=${ready.data.commitSha || "?"} deployment=${ready.data.deploymentId || "?"}`, 0);

  // 4. LOGIN · een echte authenticatie tegen een canary-account (geen klantaccount).
  let token = null;
  if (EMAIL && PASSWORD) {
    const login = await call("POST", "/api/auth/login", { body: { email: EMAIL, password: PASSWORD } });
    token = login.data && login.data.token;
    add("login", login.status === 200 && !!token, `status=${login.status}`, login.ms);
  } else {
    add("login", false, "SYNTHETIC_EMAIL/SYNTHETIC_PASSWORD ontbreken · login niet gecontroleerd", 0);
  }

  // 5. CANARYFLOW · veilige lees-actie binnen de canarytenant (geen mutatie in
  //    productie vanuit monitoring; de schrijf-canary hoort bij de deploy-evidence).
  if (token) {
    const me = await call("GET", "/api/me", { token });
    const tenantId = me.data && me.data.user && me.data.user.tenantId;
    add("canary_read", me.status === 200 && !!tenantId, `status=${me.status} tenant=${hashTenantId(tenantId) || "?"}`, me.ms);
  } else {
    add("canary_read", false, "geen sessie · canaryflow niet gecontroleerd", 0);
  }

  const ok = checks.every(c => c.ok);
  const report = {
    at: new Date().toISOString(),
    target: TARGET,
    ok,
    checks: redactForLog(checks),
    slowestMs: Math.max(...checks.map(c => c.ms || 0)),
  };

  if (jsonMode) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`── Synthetische checks (CTO3-12) · ${TARGET} ──────────`);
    for (const c of report.checks) console.log(`  ${c.ok ? "✔" : "✖"} ${c.name} · ${c.detail} (${c.ms}ms)`);
    console.log(ok ? "RESULTAAT: OK" : "RESULTAAT: ALERT · minstens één check faalt");
  }
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error("FOUT:", redactForLog(e).message); process.exit(1); });
