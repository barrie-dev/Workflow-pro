"use strict";
// SecretProvider (handover 4.3) en TelemetryProvider (4.7): geen secretwaarden
// in logs/audit/fouten, PII gefilterd vóór export, correlatievelden overal mee.
const { test } = require("node:test");
const assert = require("node:assert");

const {
  isSecretName, isPlaceholderSecret, maskSecret, redactSecrets, versionOf, isSecretProvider,
} = require("../src/ports/secret-provider");
const { EnvironmentSecretProvider } = require("../src/infrastructure/secrets/environment-secret-provider");
const {
  sanitizeAttributes, normalizeLogEvent, normalizeSecurityEvent, isTelemetryProvider,
} = require("../src/ports/telemetry");
const { ConsoleTelemetry, NoopTelemetry } = require("../src/infrastructure/telemetry/console-telemetry");

/** console-dubbel dat de uitgeschreven JSON-regels verzamelt. */
function fakeOut() {
  const lines = [];
  return { lines, log: l => lines.push(JSON.parse(l)), error: l => lines.push(JSON.parse(l)) };
}

// ── Secrets ─────────────────────────────────────────────────────────────────
test("secrets: herkent secret-namen en placeholders", () => {
  for (const n of ["JWT_SECRET", "STRIPE_SECRET_KEY", "apiKey", "authorization", "SERVICE_ROLE_KEY", "signingKey"]) {
    assert.ok(isSecretName(n), `${n} moet als secret gelden`);
  }
  for (const n of ["APP_URL", "PORT", "tenantId", "name"]) assert.ok(!isSecretName(n));
  assert.ok(isPlaceholderSecret("dev_only_replace_this_secret"));
  assert.ok(isPlaceholderSecret("change_me"));
  assert.ok(isPlaceholderSecret(""));
  assert.ok(!isPlaceholderSecret("s3cr3t-echte-waarde-1234"));
});

test("secrets: maskeren toont genoeg om te herkennen, te weinig om te gebruiken", () => {
  assert.equal(maskSecret("sk-abcdefghijklmnop"), "…mnop");
  assert.equal(maskSecret("abc"), "…", "korte waarde wordt volledig verborgen");
  assert.equal(maskSecret(""), "");
});

test("secrets: redactie haalt sleutels uit vrije tekst", () => {
  assert.match(redactSecrets("fout met sk-abcdefghijklmnopqrstuvwx"), /\[REDACTED\]/);
  assert.ok(!/sk-abcdefghijklmnopqrstuvwx/.test(redactSecrets("fout met sk-abcdefghijklmnopqrstuvwx")));
  assert.match(redactSecrets("signing whsec_abcdefghijklmnopqrst"), /\[REDACTED\]/);
  assert.match(redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwx"), /\[REDACTED\]/);
  assert.match(redactSecrets("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijk"), /\[REDACTED\]/);
  // Ook een concreet bekende waarde, ongeacht vorm.
  assert.equal(redactSecrets("wachtwoord is Hunter2Hunter2", ["Hunter2Hunter2"]), "wachtwoord is [REDACTED]");
  // Korte waarden worden niet geredigeerd · anders sneuvelt normale tekst.
  assert.equal(redactSecrets("de code is ab", ["ab"]), "de code is ab");
});

test("secrets: environment-provider leest, cachet en roteert zonder rebuild", () => {
  const env = { JWT_SECRET: "eerste-sterke-waarde-1234567890" };
  const p = new EnvironmentSecretProvider({ env });
  assert.ok(isSecretProvider(p));
  assert.equal(p.get("JWT_SECRET"), "eerste-sterke-waarde-1234567890");

  // Waarde wijzigt in de omgeving; de cache serveert nog de oude.
  env.JWT_SECRET = "tweede-sterke-waarde-0987654321";
  assert.equal(p.get("JWT_SECRET"), "eerste-sterke-waarde-1234567890", "cache actief");
  // Rotatie: invalidate volstaat, geen image rebuild.
  p.invalidate("JWT_SECRET");
  assert.equal(p.get("JWT_SECRET"), "tweede-sterke-waarde-0987654321");

  assert.equal(p.get("BESTAAT_NIET"), null);
  assert.throws(() => p.get(""), e => e.code === "SECRET_NAME_REQUIRED");
});

test("secrets: verplicht secret met placeholder faalt luid, zonder de waarde te tonen", () => {
  const p = new EnvironmentSecretProvider({ env: { JWT_SECRET: "dev_only_replace_this_secret" } });
  assert.doesNotThrow(() => p.get("JWT_SECRET"), "zonder required mag het");
  try {
    p.get("JWT_SECRET", { required: true });
    assert.fail("had moeten falen");
  } catch (e) {
    assert.equal(e.code, "SECRET_MISSING");
    assert.match(e.message, /JWT_SECRET/, "de naam mag in de fout");
    assert.ok(!/dev_only_replace_this_secret/.test(e.message), "de waarde nooit");
  }
});

test("secrets: versie en overzicht lekken geen waarden", () => {
  const p = new EnvironmentSecretProvider({ env: { JWT_SECRET: "sterke-waarde-abcdefgh", STRIPE_SECRET_KEY: "" } });
  const v = p.getVersion("JWT_SECRET");
  assert.equal(v.present, true);
  assert.equal(v.hint, "…efgh");
  assert.equal(v.version, versionOf("sterke-waarde-abcdefgh"));
  assert.ok(!JSON.stringify(v).includes("sterke-waarde-abcdefgh"));

  const overzicht = p.describe(["JWT_SECRET", "STRIPE_SECRET_KEY"]);
  assert.equal(overzicht[1].present, false);
  assert.ok(!JSON.stringify(overzicht).includes("sterke-waarde-abcdefgh"));
});

// ── Telemetrie ──────────────────────────────────────────────────────────────
test("telemetrie: PII en secrets worden vóór export gefilterd", () => {
  const attrs = sanitizeAttributes({
    tenantId: "t1", customerId: "c1", count: 5, ok: true,
    email: "jan@voorbeeld.be", phone: "0470123456", name: "Jan Peeters",
    apiKey: "sk-geheim", authorization: "Bearer xyz",
    nested: { iban: "BE68539007547034", status: "open" },
    vrijeTekst: "sleutel sk-abcdefghijklmnopqrstuvwx staat hier",
  });
  // Identificatoren blijven: zonder die is telemetrie waardeloos.
  assert.equal(attrs.tenantId, "t1");
  assert.equal(attrs.customerId, "c1");
  assert.equal(attrs.count, 5);
  // PII wordt vervangen, niet weggelaten · je ziet dát er iets stond.
  assert.equal(attrs.email, "[PII]");
  assert.equal(attrs.phone, "[PII]");
  assert.equal(attrs.name, "[PII]");
  assert.equal(attrs.nested.iban, "[PII]");
  assert.equal(attrs.nested.status, "open");
  // Secrets eruit, ook midden in vrije tekst.
  assert.equal(attrs.apiKey, "[REDACTED]");
  assert.equal(attrs.authorization, "[REDACTED]");
  assert.match(attrs.vrijeTekst, /\[REDACTED\]/);
  assert.ok(!JSON.stringify(attrs).includes("jan@voorbeeld.be"));
  assert.ok(!JSON.stringify(attrs).includes("sk-abcdefghijklmnopqrstuvwx"));
});

test("telemetrie: leeg PII-veld blijft null in plaats van [PII]", () => {
  const attrs = sanitizeAttributes({ email: "", phone: null });
  assert.equal(attrs.email, null, "niets ingevuld is ook informatie");
  assert.equal(attrs.phone, null);
});

test("telemetrie: correlatievelden volgen elke gebeurtenis", () => {
  const e = normalizeLogEvent({
    level: "warn", message: "iets", correlationId: "corr_1", requestId: "req_1",
    tenantId: "t1", actorId: "u1", attributes: { a: 1 },
  });
  assert.deepEqual(
    { c: e.correlationId, r: e.requestId, t: e.tenantId, a: e.actorId },
    { c: "corr_1", r: "req_1", t: "t1", a: "u1" });
  assert.equal(normalizeLogEvent({ level: "onzin", message: "x" }).level, "info", "onbekend niveau valt veilig terug");
  const s = normalizeSecurityEvent({ kind: "cross_tenant_denied", outcome: "denied", tenantId: "t1" });
  assert.equal(s.kind, "cross_tenant_denied");
  assert.equal(s.level, "warn", "securityevents zijn standaard opvallend");
});

test("telemetrie: console-adapter schrijft gestructureerde regels", () => {
  const out = fakeOut();
  const t = new ConsoleTelemetry({ out, minLevel: "info", environment: "test" });
  assert.ok(isTelemetryProvider(t));
  t.log({ level: "info", message: "klant aangemaakt", tenantId: "t1", attributes: { email: "a@b.be" } });
  assert.equal(out.lines.length, 1);
  assert.equal(out.lines[0].type, "log");
  assert.equal(out.lines[0].severity, "INFO");
  assert.equal(out.lines[0].service, "monargo-one");
  assert.equal(out.lines[0].attributes.email, "[PII]");
  // Onder het minimumniveau wordt niets geschreven.
  t.log({ level: "debug", message: "detail" });
  assert.equal(out.lines.length, 1);
});

test("telemetrie: securityevents gaan altijd door, ongeacht het logniveau", () => {
  const out = fakeOut();
  const t = new ConsoleTelemetry({ out, minLevel: "error" });
  t.log({ level: "warn", message: "wordt onderdrukt" });
  assert.equal(out.lines.length, 0);
  t.security({ kind: "cross_tenant_denied", outcome: "denied", tenantId: "t1", correlationId: "corr_9" });
  assert.equal(out.lines.length, 1, "een geweigerde cross-tenant toegang mag nooit wegvallen");
  assert.equal(out.lines[0].type, "security");
  assert.equal(out.lines[0].correlationId, "corr_9");
});

test("telemetrie: metrics worden geaggregeerd, niet per meting gelogd", () => {
  const out = fakeOut();
  const t = new ConsoleTelemetry({ out });
  t.metric("request.duration_ms", 100, { route: "customers" });
  t.metric("request.duration_ms", 300, { route: "customers" });
  t.metric("request.duration_ms", 50, { route: "invoices" });
  t.metric("request.duration_ms", "onzin", { route: "customers" });
  assert.equal(out.lines.length, 0, "metingen vervuilen de logs niet");
  const rows = t.flushMetrics();
  const klanten = rows.find(r => r.attributes.route === "customers");
  assert.equal(klanten.count, 2, "ongeldige waarde telt niet mee");
  assert.equal(klanten.avg, 200);
  assert.equal(klanten.min, 100);
  assert.equal(klanten.max, 300);
  assert.equal(t.flushMetrics().length, 0, "flush reset de teller");
});

test("telemetrie: span meet duur en slokt een fout nooit op", async () => {
  const out = fakeOut();
  const t = new ConsoleTelemetry({ out, minLevel: "debug" });
  const res = await t.span("customer.create", async () => "klaar", { tenantId: "t1", correlationId: "corr_1" });
  assert.equal(res, "klaar");
  assert.ok(t.flushMetrics().some(m => m.name === "customer.create.duration_ms"));

  await assert.rejects(
    () => t.span("customer.create", async () => { const e = new Error("kapot"); e.code = "BOEM"; throw e; }, { tenantId: "t1" }),
    /kapot/, "de fout bereikt de aanroeper");
  const fout = out.lines.find(l => l.severity === "ERROR");
  assert.match(fout.message, /mislukt/);
  assert.equal(fout.attributes.outcome, "error");
  assert.equal(fout.attributes.errorCode, "BOEM");
});

test("telemetrie: noop-provider doet niets maar voert het werk wel uit", async () => {
  const t = new NoopTelemetry();
  assert.ok(isTelemetryProvider(t));
  assert.equal(await t.span("x", async () => 42), 42);
});
