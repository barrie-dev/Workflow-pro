"use strict";
// End-to-end SAML SSO: speelt de IdP (ondertekent een echte assertie met de
// test-fixture-sleutel) en doorloopt de volledige flow tegen een gespawnde
// server — add-on-gating → config → resolve → login-redirect → ACS met geldige
// handtekening → JIT-provisioning + sessie. Bewijst dat de crypto-bedrading via
// @node-saml/node-saml werkt; de unit-tests dekken de pure logica + weigeringen.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SignedXml } = require("xml-crypto");

const PORT = Number(process.env.SSO_E2E_PORT || 4402);
const BASE = `http://127.0.0.1:${PORT}`;
const APP_URL = BASE;
const KEY = fs.readFileSync(path.join(__dirname, "fixtures", "saml-idp-test-key.pem"), "utf8");
const CERT = fs.readFileSync(path.join(__dirname, "fixtures", "saml-idp-test-cert.pem"), "utf8");
const ACS = `${APP_URL}/api/auth/saml/t_demo/acs`;
const ISSUER = `${APP_URL}/api/auth/saml/t_demo/metadata`;
let server, dir;

function signedSamlResponse(email, name) {
  const now = new Date();
  const after = new Date(now.getTime() + 5 * 60000).toISOString();
  const before = new Date(now.getTime() - 60000).toISOString();
  const aid = "_a" + Math.random().toString(16).slice(2);
  const rid = "_r" + Math.random().toString(16).slice(2);
  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${aid}" Version="2.0" IssueInstant="${now.toISOString()}">`
    + `<saml:Issuer>https://idp.example/metadata</saml:Issuer>`
    + `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</saml:NameID>`
    + `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData Recipient="${ACS}" NotOnOrAfter="${after}"/></saml:SubjectConfirmation></saml:Subject>`
    + `<saml:Conditions NotBefore="${before}" NotOnOrAfter="${after}"><saml:AudienceRestriction><saml:Audience>${ISSUER}</saml:Audience></saml:AudienceRestriction></saml:Conditions>`
    + `<saml:AuthnStatement AuthnInstant="${now.toISOString()}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`
    + `<saml:AttributeStatement><saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"><saml:AttributeValue>${email}</saml:AttributeValue></saml:Attribute>`
    + `<saml:Attribute Name="displayName"><saml:AttributeValue>${name}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`;
  const sig = new SignedXml({ privateKey: KEY, publicCert: CERT });
  sig.signatureAlgorithm = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
  sig.canonicalizationAlgorithm = "http://www.w3.org/2001/10/xml-exc-c14n#";
  sig.addReference({ xpath: "//*[local-name(.)='Assertion']",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"],
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256" });
  sig.computeSignature(assertion, { location: { reference: "//*[local-name(.)='Issuer']", action: "after" } });
  const resp = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${rid}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${ACS}">`
    + `<saml:Issuer>https://idp.example/metadata</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>`
    + sig.getSignedXml() + `</samlp:Response>`;
  return Buffer.from(resp, "utf8").toString("base64");
}

const H = t => ({ "Content-Type": "application/json", Authorization: `Bearer ${t}` });
const postAcs = b64 => fetch(ACS, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "SAMLResponse=" + encodeURIComponent(b64), redirect: "manual" });

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "wfp-sso-e2e-"));
  server = spawn(process.execPath, ["src/server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT), STORAGE_ADAPTER: "json",
      WORKFLOWPRO_DATA_FILE: path.join(dir, "data.json"),
      WORKFLOWPRO_INITIAL_ADMIN_PASSWORD: "Demo2026!", REQUIRE_ADMIN_MFA: "false",
      NODE_ENV: "test", RELEASE_CHANNEL: "pilot", RATE_LIMIT_DISABLED: "true", APP_URL },
    stdio: "pipe" });
  let boot = ""; server.stderr.on("data", d => boot += d); server.stdout.on("data", d => boot += d);
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    // CTO3-01 maakte /api/health een LIVENESS-check: die geeft 200 zodra het
    // proces leeft, dus ook midden in de seed. Wie daarop wacht, logt in vóór
    // de demo-gebruikers bestaan en krijgt een 401 · onder volle testbelasting
    // duurt de seed net lang genoeg om dat af en toe te raken. Wacht daarom op
    // READINESS, net als smoke.test.js.
    try { if ((await fetch(`${BASE}/api/ready`)).ok) return; } catch (_) {}
    if (server.exitCode !== null) throw new Error("server stopte:\n" + boot);
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error("server kwam niet op:\n" + boot);
});

after(async () => {
  // Wacht op het echte exit vóór de tempmap weggaat: een gekillde server kan
  // nog een gebufferde JSON-flush schrijven en dan faalt rmSync met ENOTEMPTY
  // (race, vooral op Linux/CI). Cleanup is bovendien best-effort · tmp.
  if (server && server.exitCode === null) {
    await new Promise(resolve => {
      server.once("exit", resolve);
      server.kill();
      setTimeout(() => { try { server.kill("SIGKILL"); } catch (_) {} }, 3000).unref();
    });
  }
  if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* tmp · OS ruimt op */ } }
});

test("sso e2e: ondertekende assertie → JIT-provisioning, sessie en idempotente herlogin", async () => {
  const god = await (await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "super@workflowpro.be", password: "Demo2026!" }) })).json();
  const admin = await (await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@demobouw.be", password: "Demo2026!" }) })).json();
  // Faalt de login, dan zegt elke volgende assertie alleen "401 == 200" en zoek
  // je in de verkeerde hoek. Noem het probleem waar het ontstaat.
  assert.ok(god.token && admin.token, `inloggen mislukt: ${JSON.stringify({ god, admin })}`);

  // Add-on aanzetten + configureren
  assert.equal((await fetch(`${BASE}/api/tenants/t_demo/sso/config`, { headers: H(admin.token) })).status, 403, "zonder add-on → 403");
  assert.equal((await fetch(`${BASE}/api/admin/tenants/t_demo/modules`, { method: "PATCH", headers: H(god.token), body: JSON.stringify({ moduleOverrides: { add: ["sso"], remove: [] } }) })).status, 200);
  const saved = await (await fetch(`${BASE}/api/tenants/t_demo/sso/config`, { method: "PUT", headers: H(admin.token), body: JSON.stringify({ enabled: true, entryPoint: "https://idp.example/sso", idpCert: CERT, domains: ["demobouw.be"], jit: { enabled: true, defaultRole: "employee" } }) })).json();
  assert.ok(saved.sso.enabled && saved.sso.configured, "SSO geconfigureerd");

  // Resolve + login-redirect
  const res = await (await fetch(`${BASE}/api/auth/sso/resolve?email=wie@demobouw.be`)).json();
  assert.deepEqual([res.sso, res.tenantId], [true, "t_demo"]);
  const lr = await fetch(`${BASE}/api/auth/saml/t_demo/login`, { redirect: "manual" });
  assert.equal(lr.status, 302);
  assert.match(lr.headers.get("location") || "", /^https:\/\/idp\.example\/sso\?SAMLRequest=/);

  // ACS met geldige handtekening → JIT + sessie
  const acs = await postAcs(signedSamlResponse("nieuwe.medewerker@demobouw.be", "Nieuwe Medewerker"));
  assert.equal(acs.status, 302);
  const m = (acs.headers.get("location") || "").match(/#sso_token=([^&]+)/);
  assert.ok(m, "redirect bevat #sso_token");
  const me = await (await fetch(`${BASE}/api/me`, { headers: H(decodeURIComponent(m[1])) })).json();
  assert.equal(me.user.email, "nieuwe.medewerker@demobouw.be");
  assert.equal(me.user.tenantId, "t_demo");
  assert.equal(me.user.role, "employee");

  // Tweede login = geen dubbele gebruiker
  const list = e => (e.rows || e.employees || e || []);
  const countBefore = list(await (await fetch(`${BASE}/api/tenants/t_demo/employees`, { headers: H(admin.token) })).json()).length;
  const acs2 = await postAcs(signedSamlResponse("nieuwe.medewerker@demobouw.be", "Nieuwe Medewerker"));
  assert.equal(acs2.status, 302);
  const countAfter = list(await (await fetch(`${BASE}/api/tenants/t_demo/employees`, { headers: H(admin.token) })).json()).length;
  assert.equal(countAfter, countBefore, "herlogin maakt geen dubbele gebruiker");

  // Rommel-assertie blijft geweigerd (geen sessie)
  const bad = await postAcs(Buffer.from("<garbage/>").toString("base64"));
  assert.equal(bad.status, 302);
  assert.match(bad.headers.get("location") || "", /sso_error=/);
});
