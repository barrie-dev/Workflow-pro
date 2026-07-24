"use strict";
// CTO3-10 · gedeelde preambule voor tenant-routes.
//
// Deze reeks controles staat in server.js ÉÉN keer boven 238 acties. Wie een
// actie naar een router tilt, moet de beveiliging meetillen · en dat is
// precies waar het bij zo'n verhuizing misgaat.
//
// Deze tests leggen niet alleen vast DAT elke controle draait, maar ook in
// welke VOLGORDE. De volgorde is geen stijlkwestie: tenantlidmaatschap wordt
// gecontroleerd vóór de tenant-lookup, zodat een vreemde tenant niet te
// ontdekken is aan het verschil tussen 403 en 404.
const { test } = require("node:test");
const assert = require("node:assert");
const { resolveTenantRequest, tenantActionPath, tenantRoute } = require("../src/http/tenant-request");

function harnas(overschrijf = {}) {
  const volgorde = [];
  const antwoorden = [];
  const ctx = {
    store: { data: { tenants: [{ id: "t_1", name: "Demo" }] } },
    sendJson: (res, status, body) => antwoorden.push({ status, body }),
    actor: () => { volgorde.push("actor"); return { id: "u_1", email: "a@b.c", role: "tenant_admin" }; },
    assertAdminMfa: () => volgorde.push("mfa"),
    assertTenant: () => volgorde.push("tenant-lidmaatschap"),
    assertApiKeyWriteAllowed: () => volgorde.push("api-key"),
    assertModuleEnabled: () => volgorde.push("entitlement"),
    assertNotReadOnly: () => volgorde.push("read-only"),
    assertTrialActive: () => volgorde.push("proef"),
    idempotency: {
      idempotencyKeyFrom: () => null,
      cacheKeyFor: () => "ck",
      findReplay: () => null,
    },
    ...overschrijf,
  };
  return { ctx, volgorde, antwoorden };
}

const URL_ = (p = "/api/tenants/t_1/me/planning") => new URL(p, "http://x");

test("TP 1· de volledige preambule draait, in de vastgelegde volgorde", () => {
  const { ctx, volgorde } = harnas();
  const uit = resolveTenantRequest({ method: "GET", headers: {} }, {}, URL_(), ctx);
  assert.equal(uit.ok, true);
  assert.deepEqual(volgorde, [
    "actor", "mfa", "tenant-lidmaatschap", "api-key", "entitlement", "read-only", "proef",
  ], "een ontbrekende of verplaatste controle verzwakt ELKE route die deze helper gebruikt");
});

test("TP 2· LIDMAATSCHAP wordt gecontroleerd VÓÓR de tenant-lookup", () => {
  // Andersom zou een vreemde tenant te ontdekken zijn: bestaat hij niet dan
  // 404, bestaat hij wel dan 403. Dat verschil is een bestaans-oracle.
  const { ctx, volgorde } = harnas({
    assertTenant: () => { volgorde.push("tenant-lidmaatschap"); throw Object.assign(new Error("Forbidden"), { status: 403 }); },
  });
  assert.throws(() => resolveTenantRequest({ method: "GET", headers: {} }, {}, URL_("/api/tenants/t_onbekend/me"), ctx));
  assert.equal(volgorde.includes("tenant-lidmaatschap"), true);
  // De lookup is nooit gebeurd · er is dus niets uit te lezen over het bestaan.
  assert.equal(volgorde.includes("api-key"), false);
});

test("TP 3· zonder sessie: 401 en niets daarna", () => {
  const { ctx, volgorde, antwoorden } = harnas({ actor: () => { volgorde.push("actor"); return null; } });
  const uit = resolveTenantRequest({ method: "GET", headers: {} }, {}, URL_(), ctx);
  assert.equal(uit.ok, false);
  assert.equal(antwoorden[0].status, 401);
  assert.deepEqual(volgorde, ["actor"], "er draait niets na een mislukte authenticatie");
});

test("TP 4· onbestaande tenant geeft 404 en stopt", () => {
  const { ctx, antwoorden, volgorde } = harnas({ store: { data: { tenants: [] } } });
  const uit = resolveTenantRequest({ method: "GET", headers: {} }, {}, URL_(), ctx);
  assert.equal(uit.ok, false);
  assert.equal(antwoorden[0].status, 404);
  assert.equal(volgorde.includes("entitlement"), false, "geen verdere checks na een 404");
});

test("TP 5· IDEMPOTENTIE: een herhaalde mutatie krijgt de eerdere response", () => {
  const { ctx, antwoorden } = harnas({
    idempotency: {
      idempotencyKeyFrom: () => "key-1",
      cacheKeyFor: () => "ck-1",
      findReplay: () => ({ status: 201, body: JSON.stringify({ ok: true, id: "x_1" }) }),
    },
  });
  const res = {};
  const uit = resolveTenantRequest({ method: "POST", headers: {} }, res, URL_(), ctx);
  assert.equal(uit.ok, false, "de handler mag NIET nog eens draaien");
  assert.equal(antwoorden[0].status, 201);
  assert.deepEqual(antwoorden[0].body, { ok: true, id: "x_1" });
  assert.equal(res.wfpV1, null,
    "de v1-hook moet uit · anders worden centen bij een replay dubbel geconverteerd");
});

test("TP 6· een NIEUWE mutatie met sleutel wordt gewapend voor opslag", () => {
  const { ctx } = harnas({
    idempotency: { idempotencyKeyFrom: () => "key-2", cacheKeyFor: () => "ck-2", findReplay: () => null },
  });
  const res = {};
  const uit = resolveTenantRequest({ method: "POST", headers: {} }, res, URL_(), ctx);
  assert.equal(uit.ok, true);
  assert.equal(res.wfpIdem.cacheKey, "ck-2");
});

test("TP 7· idempotentie geldt voor élke muterende methode, niet voor GET", () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    const { ctx } = harnas({
      idempotency: { idempotencyKeyFrom: () => "k", cacheKeyFor: () => "ck", findReplay: () => null },
    });
    const res = {};
    resolveTenantRequest({ method, headers: {} }, res, URL_(), ctx);
    assert.ok(res.wfpIdem, `${method} wordt niet beschermd`);
  }
  const { ctx } = harnas({
    idempotency: { idempotencyKeyFrom: () => "k", cacheKeyFor: () => "ck", findReplay: () => null },
  });
  const res = {};
  resolveTenantRequest({ method: "GET", headers: {} }, res, URL_(), ctx);
  assert.equal(res.wfpIdem, undefined, "een GET hoeft niet beschermd te worden");
});

test("TP 8· de actie komt uit het PAD, niet uit iets dat de client kan sturen", () => {
  const { ctx } = harnas();
  const uit = resolveTenantRequest({ method: "GET", headers: {} }, {}, URL_("/api/tenants/t_1/me/clock"), ctx);
  assert.equal(uit.action, "me/clock");
  assert.equal(uit.tenantId, "t_1");
});

test("TP 9· het routepad matcht de actie EXACT, geen buren", () => {
  const p = tenantActionPath("me/clock");
  assert.ok(p.test("/api/tenants/t_1/me/clock"));
  assert.equal(p.test("/api/tenants/t_1/me/clock/in"), false, "een langere actie hoort niet mee te vallen");
  assert.equal(p.test("/api/tenants/t_1/me/clockx"), false);
  assert.equal(p.test("/api/tenants/t_1/xme/clock"), false);
});

test("TP 10· regex-tekens in een actienaam worden ge-escaped", () => {
  const p = tenantActionPath("a.b");
  assert.ok(p.test("/api/tenants/t_1/a.b"));
  assert.equal(p.test("/api/tenants/t_1/axb"), false, "de punt mag geen jokerteken worden");
});

test("TP 11· tenantRoute draait de handler ALLEEN na een geslaagde preambule", async () => {
  const { ctx } = harnas({ actor: () => null });
  let gedraaid = false;
  const route = tenantRoute("me", "GET", async () => { gedraaid = true; });
  await route.handler({ method: "GET", headers: {} }, {}, { url: URL_("/api/tenants/t_1/me"), ctx });
  assert.equal(gedraaid, false, "een handler die draait zonder sessie is een gat");
});

test("TP 12· tenantRoute geeft de opgeloste context door aan de handler", async () => {
  const { ctx } = harnas();
  let ontvangen = null;
  const route = tenantRoute("me", "GET", async (req, res, arg) => { ontvangen = arg; });
  await route.handler({ method: "GET", headers: {} }, {}, { url: URL_("/api/tenants/t_1/me"), ctx });
  assert.equal(ontvangen.tenantId, "t_1");
  assert.equal(ontvangen.user.id, "u_1");
  assert.equal(ontvangen.tenant.name, "Demo");
  assert.equal(ontvangen.action, "me");
});

test("TP 13· de preambule in server.js en die hier lopen niet uit elkaar", () => {
  // Zolang server.js zijn eigen kopie heeft (strangler), moeten ze dezelfde
  // controles in dezelfde volgorde doen. Deze test faalt zodra iemand er één
  // aanpast zonder de andere · dat is precies het risico van een halve migratie.
  const fs = require("fs"), path = require("path");
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  const blok = server.slice(server.indexOf("const tenantMatch = url.pathname.match"));
  const stappen = ["assertAdminMfa(user)", "assertTenant(user, tenantId)", "assertApiKeyWriteAllowed(user, req)",
    "assertModuleEnabled(store, user, tenant, action)", "assertNotReadOnly(user, action, req.method)",
    "assertTrialActive(user, tenant, action, req.method)"];
  let vorige = -1;
  for (const s of stappen) {
    const i = blok.indexOf(s);
    assert.ok(i > -1, `server.js mist ${s}`);
    assert.ok(i > vorige, `${s} staat in server.js op een andere plek in de volgorde`);
    vorige = i;
  }
});
