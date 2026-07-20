"use strict";
/**
 * Dimona · onmiddellijke aangifte van tewerkstelling (RSZ, socialsecurity.be).
 *
 * Elke Belgische werkgever MOET elke in- en uitdiensttreding aangeven vóór de
 * eerste werkdag (Dimona IN) respectievelijk de eerste werkdag na uitdienst
 * (Dimona OUT). De personeelsfiche (h16) draagt de dienstperiode al
 * (activeFrom/activeTo) · deze module maakt daar de wettelijke aangifte van.
 *
 * Kanaal: de officiële "Web Service REST Dimona" op de SocSec API Gateway
 * (OAuth 2.0, enkel voor gecertificeerde aangevers). Zolang die certificatie
 * er niet is draait alles in mock-modus · zelfde guarded patroon als CIAW:
 * de aangifte wordt gebouwd en gevalideerd alsof hij live gaat, en het
 * resultaat wordt volwaardig geregistreerd op de fiche.
 *
 * Bewust NIET hier: DmfA (kwartaalloonaangifte) · dat is loonmotor-terrein en
 * expliciet anti-roadmap; dat blijft bij het sociaal secretariaat.
 */

const { postJson } = require("../lib/http-client");
const { normalizeInsz, validInsz } = require("./ciaw");

const TYPES = ["in", "out"];
// Officiële gateway-host; exacte paden worden bij certificatie bevestigd.
const GATEWAY_HOST = "services.socialsecurity.be";

function isRealKey(k) {
  const s = String(k || "");
  return !!s && !/DUMMY|replace[_-]?me|changeme|xxxx/i.test(s);
}

/** Productie-gereedheid · zonder live credentials → mock (zoals CIAW). */
function dimonaReadiness(input = {}, requireLive = false) {
  const dimona = input.dimona || input;
  const provider = String(dimona.provider || "mock").trim().toLowerCase();
  const providerLive = provider && provider !== "mock";
  const credsLive = isRealKey(dimona.clientId) && isRealKey(dimona.clientSecret);

  if (!requireLive && (!providerLive || !credsLive)) {
    return { ok: true, live: false, provider: "mock", reason: "mock-modus (geen live Dimona-certificatie)" };
  }
  if (!providerLive) return { ok: false, live: false, provider, errorCode: "dimona_provider_not_configured", message: "Dimona-kanaal niet ingesteld" };
  if (!credsLive) return { ok: false, live: false, provider, errorCode: "dimona_credentials_missing", message: "Dimona OAuth-credentials ontbreken" };
  return { ok: true, live: true, provider };
}

/** INSZ van de medewerker: fiche eerst, dan het gekoppelde gebruikersaccount. */
function inszFor(employee, linkedUser) {
  return normalizeInsz(
    (employee && (employee.insz || employee.nationalId)) ||
    (linkedUser && (linkedUser.insz || linkedUser.nationalNumber || linkedUser.nationalId)) || ""
  );
}

/**
 * Bouw een Dimona-aangifte uit de personeelsfiche. Puur + testbaar.
 * @returns {{valid:boolean, errors:string[], declaration:object|null}}
 */
function buildDimonaDeclaration({ tenant, employee, linkedUser = null, type, date }) {
  const errors = [];
  const kind = String(type || "").toLowerCase();
  if (!TYPES.includes(kind)) errors.push("Type moet 'in' of 'out' zijn");

  const employerId = String((tenant && tenant.compliance && tenant.compliance.rszEmployerId) || "").trim();
  if (!employerId) errors.push("RSZ-werkgeversnummer ontbreekt op de organisatie (Instellingen → Compliance)");

  if (employee && employee.external) errors.push("Externe medewerkers (onderaannemers) vallen onder de Dimona van hun eigen werkgever");

  const insz = inszFor(employee, linkedUser);
  if (!validInsz(insz)) errors.push("Geldig INSZ/rijksregisternummer ontbreekt op de personeelsfiche");

  const effective = String(date || (kind === "in" ? employee && employee.activeFrom : employee && employee.activeTo) || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) {
    errors.push(kind === "out"
      ? "Einddatum ontbreekt (zet de uitdienstdatum op de fiche of geef een datum mee)"
      : "Startdatum ontbreekt (zet de indienstdatum op de fiche of geef een datum mee)");
  }

  if (errors.length) return { valid: false, errors, declaration: null };
  // Vorm volgt de REST-WS-structuur (employer/worker/dimonaIn|dimonaOut).
  const declaration = {
    employer: { nssoRegistrationNumber: employerId },
    worker: { ssin: insz, name: employee.name || "" },
    ...(kind === "in"
      ? { dimonaIn: { startDate: effective, workerType: employee.dimonaWorkerType || "OTH" } }
      : { dimonaOut: { endDate: effective } }),
    employeeRecordId: employee.id,
  };
  return { valid: true, errors: [], declaration };
}

/**
 * Verstuur één aangifte · mock-fallback zonder live certificatie.
 * @returns {Promise<{ok:boolean, live:boolean, status:string, reference:string, type:string, date:string, error?:string, declaration?:object}>}
 */
async function submitDimona({ config = {}, tenant, employee, linkedUser, type, date }, options = {}) {
  const built = buildDimonaDeclaration({ tenant, employee, linkedUser, type, date });
  const kind = String(type || "").toLowerCase();
  const effective = built.valid
    ? (built.declaration.dimonaIn ? built.declaration.dimonaIn.startDate : built.declaration.dimonaOut.endDate)
    : String(date || "");
  if (!built.valid) {
    return { ok: false, live: false, status: "rejected", reference: "", type: kind, date: effective, error: built.errors.join("; ") };
  }
  const readiness = dimonaReadiness(config, !!options.requireLive);
  if (!readiness.ok) {
    return { ok: false, live: false, status: "failed", reference: "", type: kind, date: effective, error: readiness.message };
  }
  if (!readiness.live) {
    return {
      ok: true, live: false, status: "accepted", type: kind, date: effective,
      reference: `DIMONA-MOCK-${Date.now().toString(36).toUpperCase()}`,
      periodId: `P-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      declaration: built.declaration,
    };
  }
  // Live: OAuth 2.0 client-credentials op de SocSec-gateway (na certificatie).
  try {
    const dimona = config.dimona || {};
    const token = await postJson(GATEWAY_HOST, "/REST/oauth/v3/token",
      { "Content-Type": "application/x-www-form-urlencoded" },
      `grant_type=client_credentials&client_id=${encodeURIComponent(dimona.clientId)}&client_secret=${encodeURIComponent(dimona.clientSecret)}`);
    const json = await postJson(GATEWAY_HOST, "/REST/dimona/v2/declarations",
      { Authorization: `Bearer ${token.access_token}` }, built.declaration);
    return { ok: true, live: true, status: json.status || "submitted", reference: json.dimonaPeriodId || json.reference || json.id || "", periodId: json.dimonaPeriodId || null, type: kind, date: effective };
  } catch (err) {
    return { ok: false, live: true, status: "failed", reference: "", type: kind, date: effective, error: err.message };
  }
}

/**
 * Aangifteregister + hiaten: elke actieve, interne medewerker hoort een
 * geldige Dimona-IN te hebben; uit dienst hoort een OUT. Puur + testbaar.
 */
function dimonaRegister(store, tenantId, today = new Date().toISOString().slice(0, 10)) {
  const rows = [];
  const gaps = [];
  for (const emp of store.list("employees", tenantId) || []) {
    if (emp.external || emp.status === "archived") continue;
    const dimona = emp.dimona || null;
    const active = (!emp.activeFrom || emp.activeFrom <= today) && (!emp.activeTo || emp.activeTo >= today) && emp.status !== "left";
    rows.push({
      employeeId: emp.id, name: emp.name, activeFrom: emp.activeFrom || null, activeTo: emp.activeTo || null,
      status: dimona ? dimona.status : "none", type: dimona ? dimona.type : null,
      reference: dimona ? dimona.reference : null, at: dimona ? dimona.at : null, error: (dimona && dimona.error) || null,
    });
    if (active && (!dimona || dimona.type !== "in" || dimona.status === "failed" || dimona.status === "rejected")) {
      gaps.push({ employeeId: emp.id, name: emp.name, reason: !dimona ? "geen Dimona-aangifte" : (dimona.type !== "in" ? "laatste aangifte is geen IN" : "aangifte faalde") });
    }
    if (!active && emp.activeTo && emp.activeTo < today && dimona && dimona.type !== "out") {
      gaps.push({ employeeId: emp.id, name: emp.name, reason: "uit dienst zonder Dimona-OUT" });
    }
  }
  return { rows, gaps };
}

module.exports = { dimonaReadiness, buildDimonaDeclaration, submitDimona, dimonaRegister, inszFor, TYPES };
