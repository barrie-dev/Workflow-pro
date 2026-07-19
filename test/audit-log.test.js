"use strict";
// Append-only auditlog met eigen retentie (handover F-10) en persistent
// verzendlog (F-09).
const { test } = require("node:test");
const assert = require("node:assert");

const {
  appendAudit, listAudit, pruneAudit, exportAudit, auditStats, isSecurityAction, DEFAULT_POLICY,
} = require("../src/platform/audit-log");

function fakeStore(data = {}) {
  const d = { auditLogs: [], mailLog: [], ...data };
  return {
    data: d,
    saves: 0,
    list(col, tid) { const r = d[col] || []; return tid == null ? r : r.filter(x => x.tenantId === tid); },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },
    save() { this.saves++; },
  };
}

/** Auditregel op een bepaald moment in het verleden. */
function seedAudit(store, { tenantId, action = "customer_updated", daysAgo = 0, area = "crm" }) {
  const row = appendAudit(store, { tenantId, action, area, actor: "admin@x.be", detail: "test" });
  row.at = new Date(Date.now() - daysAgo * 86400000).toISOString();
  return row;
}

test("audit: schrijven is append-only en kapt nooit af", () => {
  const store = fakeStore();
  // De oude implementatie deed slice(-500): regel 501 wiste regel 1.
  for (let i = 0; i < 600; i++) appendAudit(store, { tenantId: "t1", action: "customer_updated", detail: `nr ${i}` });
  assert.equal(store.data.auditLogs.length, 600, "geen enkele regel stilzwijgend verdwenen");
  assert.match(store.data.auditLogs[0].detail, /nr 0/, "de oudste regel staat er nog");
});

test("audit: één drukke tenant duwt de trail van een andere niet weg", () => {
  const store = fakeStore();
  seedAudit(store, { tenantId: "t2", action: "login" });
  for (let i = 0; i < 1000; i++) appendAudit(store, { tenantId: "t1", action: "customer_updated" });
  const t2 = listAudit(store, "t2");
  assert.equal(t2.total, 1, "de trail van de rustige tenant is intact");
  // Ook na retentie met een lage cap blijft t2 volledig.
  pruneAudit(store, { policy: { maxPerTenant: 10 } });
  assert.equal(listAudit(store, "t2").total, 1);
  assert.equal(listAudit(store, "t1").total, 10, "de cap geldt PER tenant");
});

test("audit: securityacties worden herkend en langer bewaard", () => {
  assert.ok(isSecurityAction("login_failed"));
  assert.ok(isSecurityAction("permission_denied"));
  assert.ok(isSecurityAction("impersonation_started"));
  assert.ok(isSecurityAction("api_key_created"));
  assert.ok(!isSecurityAction("customer_updated"));

  const store = fakeStore();
  // Beide 500 dagen oud: gewone retentie is 400 dagen, security 1095.
  seedAudit(store, { tenantId: "t1", action: "customer_updated", daysAgo: 500 });
  seedAudit(store, { tenantId: "t1", action: "permission_denied", daysAgo: 500 });
  const res = pruneAudit(store);
  assert.equal(res.removed, 1);
  const over = listAudit(store, "t1");
  assert.equal(over.total, 1);
  assert.equal(over.rows[0].action, "permission_denied", "securitybewijs blijft");
});

test("audit: de cap telt alleen gewone regels, nooit securityregels", () => {
  // Regressie: de cap-teller telde securityregels mee, waardoor een piek aan
  // securityevents de gewone audittrail kon wegvagen. Of dat gebeurde hing af
  // van de sorteervolgorde bij gelijke tijdstempels · vandaar expliciete tijden.
  const store = fakeStore();
  for (let i = 0; i < 20; i++) seedAudit(store, { tenantId: "t1", action: "customer_updated", daysAgo: 20 - i });
  // Securityregels NIEUWER dan de gewone: zij komen dus als eerste in de sortering.
  for (let i = 0; i < 5; i++) seedAudit(store, { tenantId: "t1", action: "login_failed", daysAgo: 0 });

  pruneAudit(store, { policy: { maxPerTenant: 3 } });
  const over = listAudit(store, "t1");
  assert.equal(over.rows.filter(r => r.security).length, 5, "alle securityregels bewaard");
  assert.equal(over.rows.filter(r => !r.security).length, 3, "precies de cap aan gewone regels, ondanks 5 securityregels ervoor");
});

test("audit: opruimen rapporteert wat het deed en kan droog draaien", () => {
  const store = fakeStore();
  seedAudit(store, { tenantId: "t1", action: "customer_updated", daysAgo: 500 });
  seedAudit(store, { tenantId: "t1", action: "customer_updated", daysAgo: 1 });
  seedAudit(store, { tenantId: "t2", action: "customer_updated", daysAgo: 500 });

  const droog = pruneAudit(store, { dryRun: true });
  assert.equal(droog.removed, 2);
  assert.equal(droog.dryRun, true);
  assert.equal(store.data.auditLogs.length, 3, "dry-run wijzigt niets");
  assert.equal(droog.perTenant.length, 2, "per tenant gerapporteerd");
  assert.ok(droog.perTenant.every(t => t.removedByAge === 1));

  const echt = pruneAudit(store);
  assert.equal(echt.removed, 2);
  assert.equal(store.data.auditLogs.length, 1);
});

test("audit: gevoelige waarden worden uit het detailveld geredigeerd", () => {
  const store = fakeStore();
  const row = appendAudit(store, { tenantId: "t1", action: "api_key_created", detail: "sleutel sk-abcdefghijklmnopqrstuvwx aangemaakt" });
  assert.match(row.detail, /\[REDACTED\]/);
  assert.ok(!/sk-abcdefghijklmnopqrstuvwx/.test(JSON.stringify(store.data.auditLogs)));
});

test("audit: filteren, pagineren en exporteren", () => {
  const store = fakeStore();
  appendAudit(store, { tenantId: "t1", action: "customer_created", area: "crm", actor: "jan@x.be" });
  appendAudit(store, { tenantId: "t1", action: "invoice_sent", area: "billing", actor: "fin@x.be" });
  appendAudit(store, { tenantId: "t1", action: "login_failed", area: "auth", actor: "jan@x.be" });
  appendAudit(store, { tenantId: "t2", action: "customer_created", area: "crm", actor: "piet@x.be" });

  assert.equal(listAudit(store, "t1").total, 3, "andere tenant valt buiten de lijst");
  assert.equal(listAudit(store, "t1", { area: "billing" }).total, 1);
  assert.equal(listAudit(store, "t1", { actor: "JAN" }).total, 2, "actor-filter is hoofdletterongevoelig");
  assert.equal(listAudit(store, "t1", { securityOnly: true }).total, 1);
  assert.equal(listAudit(store, "t1", { action: "customer" }).total, 1);

  const p1 = listAudit(store, "t1", { limit: 2 });
  assert.equal(p1.rows.length, 2);
  assert.equal(p1.nextCursor, 2);
  assert.equal(listAudit(store, "t1", { limit: 2, cursor: p1.nextCursor }).nextCursor, null);

  const exp = exportAudit(store, "t1", { area: "crm" });
  assert.equal(exp.count, 1);
  assert.equal(exp.rows[0].action, "customer_created");
  assert.ok(exp.generatedAt);
});

test("audit: statistieken voor ops", () => {
  const store = fakeStore();
  assert.deepEqual(auditStats(store, "t1"), { total: 0, security: 0, oldest: null, newest: null });
  seedAudit(store, { tenantId: "t1", action: "customer_updated", daysAgo: 10 });
  seedAudit(store, { tenantId: "t1", action: "login_failed", daysAgo: 1 });
  const st = auditStats(store, "t1");
  assert.equal(st.total, 2);
  assert.equal(st.security, 1);
  assert.ok(st.oldest < st.newest);
});

test("audit: standaardbeleid bewaart ruim boven een boekjaar", () => {
  assert.ok(DEFAULT_POLICY.retentionDays >= 366, "een volledig boekjaar plus marge");
  assert.ok(DEFAULT_POLICY.securityRetentionDays > DEFAULT_POLICY.retentionDays);
});

// ── F-09 · persistent verzendlog ────────────────────────────────────────────
test("mail-log: sink maakt het log persistent en overleeft een 'herstart'", () => {
  const { setMailSink, recentMail } = require("../src/lib/mailer");
  const store = fakeStore();
  const sink = {
    record(entry) {
      store.data.mailLog.push({ id: `mail_${store.data.mailLog.length}`, ...entry });
      if (store.data.mailLog.length > 500) store.data.mailLog = store.data.mailLog.slice(-500);
      store.save();
    },
    recent(limit) { return store.data.mailLog.slice(-limit).reverse(); },
  };
  try {
    setMailSink(sink);
    sink.record({ to: "a@x.be", subject: "Factuur", provider: "log", at: "2026-07-18T10:00:00Z", ok: true });
    sink.record({ to: "b@x.be", subject: "Offerte", provider: "log", at: "2026-07-18T11:00:00Z", ok: true });

    const recent = recentMail(10);
    assert.equal(recent.length, 2);
    assert.equal(recent[0].subject, "Offerte", "nieuwste eerst");
    // De data leeft in de store, niet in het proces · dus een herstart of een
    // tweede replica ziet hetzelfde.
    assert.equal(store.data.mailLog.length, 2);
    assert.ok(store.saves > 0, "weggeschreven via de store");
  } finally {
    setMailSink(null);
  }
});

test("mail-log: een falende sink breekt de verzending niet", () => {
  const { setMailSink, recentMail } = require("../src/lib/mailer");
  try {
    setMailSink({ record() { throw new Error("opslag stuk"); }, recent() { throw new Error("stuk"); } });
    // recentMail valt terug op het geheugen in plaats van te klappen.
    assert.doesNotThrow(() => recentMail(5));
  } finally {
    setMailSink(null);
  }
});
