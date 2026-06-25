"use strict";
/**
 * CIAW / Checkin@Work — verplichte aanwezigheidsregistratie op Belgische werven
 * (RSZ/ONSS). Werkt als guarded integratie naar het analoge patroon van Peppol:
 * zonder geconfigureerde provider valt alles terug op een mock zodat de flow
 * lokaal werkt; met echte credentials zou de aangifte naar de RSZ-webservice gaan.
 *
 * Een aangifte koppelt: werkgever (RSZ-nr) + werknemer (INSZ/rijksregisternr) +
 * werf (locatie/werf-id) + tijdstip + type (IN/OUT). We bewaren de status per
 * klokregistratie zodat een controle op de werf bewijs heeft van de aangifte.
 */

const https = require("https");

// Belgisch rijksregisternummer / INSZ: 11 cijfers (opmaak wordt gladgestreken).
function normalizeInsz(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}
function validInsz(value) {
  const d = normalizeInsz(value);
  return d.length === 11;
}

function isRealKey(k) {
  const s = String(k || "");
  return !!s && !/DUMMY|replace[_-]?me|changeme|xxxx/i.test(s);
}

/**
 * Productie-gereedheid van de CIAW-koppeling.
 * Zonder live provider (of buiten productie) → mock-modus.
 */
function ciawReadiness(input = {}, requireLive = false) {
  const ciaw = input.ciaw || input;
  const provider = String(ciaw.provider || "mock").trim().toLowerCase();
  const providerLive = provider && provider !== "mock";
  const employerLive = isRealKey(ciaw.employerId);
  const keyLive = isRealKey(ciaw.apiKey);

  if (!requireLive && (!providerLive || !keyLive || !employerLive)) {
    return { ok: true, live: false, provider: "mock", reason: "mock-modus (geen live CIAW-provider)" };
  }
  if (!providerLive) return { ok: false, live: false, provider, errorCode: "ciaw_provider_not_configured", message: "CIAW-provider niet ingesteld" };
  if (!employerLive) return { ok: false, live: false, provider, errorCode: "ciaw_employer_missing", message: "RSZ-werkgeversnummer ontbreekt" };
  if (!keyLive) return { ok: false, live: false, provider, errorCode: "ciaw_key_missing", message: "CIAW API-sleutel ontbreekt" };
  return { ok: true, live: true, provider };
}

/**
 * Bouw een Checkin@Work-aangifte uit een klokregistratie. Puur + testbaar.
 * @returns {{valid:boolean, errors:string[], declaration:object}}
 */
function buildCheckinDeclaration({ tenant, clock, user, venue, action }) {
  const errors = [];
  const employerId = String((tenant && tenant.compliance && tenant.compliance.rszEmployerId) || "").trim();
  if (!employerId) errors.push("RSZ-werkgeversnummer ontbreekt op de tenant (compliance.rszEmployerId)");

  // De medewerker-fiche bewaart het rijksregisternummer als `nationalId`.
  const insz = normalizeInsz(user && (user.insz || user.nationalNumber || user.nationalId));
  if (!validInsz(insz)) errors.push("Geldig INSZ/rijksregisternummer van de werknemer ontbreekt");

  const act = action === "out" || action === "checkout" ? "OUT" : "IN";
  const location = venue
    ? { venueId: venue.id, name: venue.name || "", worksId: venue.worksId || venue.ciawWorksId || null, address: venue.address || "" }
    : null;
  if (!location) errors.push("Geen werf/locatie gekoppeld aan de registratie");

  const declaration = {
    employerId,
    worker: { insz, name: user ? user.name : "" },
    location,
    action: act,
    occurredAt: (clock && (clock.clockIn || clock.clockOut)) ? `${clock.date}T${(act === "OUT" ? clock.clockOut : clock.clockIn) || "00:00"}:00` : new Date().toISOString(),
    clockId: clock ? clock.id : null,
  };
  return { valid: errors.length === 0, errors, declaration };
}

function httpsPostJson(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method: "POST", headers }, res => {
      let data = "";
      res.on("data", c => (data += c));
      res.on("end", () => {
        let json = {};
        try { json = JSON.parse(data || "{}"); } catch (_) { json = {}; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(new Error(json.error?.message || json.message || `CIAW-provider ${res.statusCode}`));
      });
    });
    req.on("error", reject);
    req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

/**
 * Verstuur één aangifte. Mock-fallback wanneer geen live provider.
 * @returns {Promise<{ok:boolean, live:boolean, provider:string, status:string, reference:string, error?:string}>}
 */
async function submitCheckin({ config = {}, tenant, clock, user, venue, action }, options = {}) {
  const built = buildCheckinDeclaration({ tenant, clock, user, venue, action });
  if (!built.valid) {
    return { ok: false, live: false, provider: "mock", status: "rejected", reference: "", error: built.errors.join("; ") };
  }
  const readiness = ciawReadiness(config, !!options.requireLive);
  if (!readiness.ok) {
    return { ok: false, live: false, provider: readiness.provider, status: "failed", reference: "", error: readiness.message };
  }
  if (!readiness.live) {
    return { ok: true, live: false, provider: "mock", status: "confirmed", reference: `MOCK-CIAW-${Date.now()}`, declaration: built.declaration };
  }
  // Echte provider (endpoint provider-afhankelijk; voorbeeld-vorm).
  try {
    const ciaw = config.ciaw || {};
    const json = await httpsPostJson(
      String(ciaw.baseHost || "api.checkinatwork.be"),
      "/v1/declarations",
      { "Content-Type": "application/json", Authorization: `Bearer ${ciaw.apiKey}` },
      built.declaration
    );
    return { ok: true, live: true, provider: readiness.provider, status: json.status || "sent", reference: json.reference || json.id || "" };
  } catch (err) {
    return { ok: false, live: true, provider: readiness.provider, status: "failed", reference: "", error: err.message };
  }
}

module.exports = { normalizeInsz, validInsz, ciawReadiness, buildCheckinDeclaration, submitCheckin };
