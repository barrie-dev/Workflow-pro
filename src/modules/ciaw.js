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

const { postJson } = require("../lib/http-client");

// Belgisch rijksregisternummer / INSZ: 11 cijfers (opmaak wordt gladgestreken).
function normalizeInsz(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}
// Echte validatie van het Belgische rijksregisternummer: 11 cijfers met een
// mod-97 controlegetal op de laatste 2. Voor geboorten vanaf 2000 wordt "2"
// vooraan het 9-cijferige basisgetal geplaatst vóór de mod-berekening.
function validInsz(value) {
  const d = normalizeInsz(value);
  if (d.length !== 11) return false;
  const base = d.slice(0, 9);
  const check = Number(d.slice(9, 11));
  const expect = mod => { const r = 97 - (mod % 97); return r === 0 ? 97 : r; };
  return check === expect(Number(base)) || check === expect(Number("2" + base));
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
    const json = await postJson(
      String(ciaw.baseHost || "api.checkinatwork.be"),
      "/v1/declarations",
      { Authorization: `Bearer ${ciaw.apiKey}` },
      built.declaration
    );
    return { ok: true, live: true, provider: readiness.provider, status: json.status || "sent", reference: json.reference || json.id || "" };
  } catch (err) {
    return { ok: false, live: true, provider: readiness.provider, status: "failed", reference: "", error: err.message };
  }
}

/**
 * Aanwezigheidsregister voor een werfcontrole: wie is er NU ingeklokt, met hun
 * CIAW-aangiftestatus en INSZ-geldigheid. Puur + testbaar. Toont enkel lopende
 * registraties (nog niet uitgeklokt) — het bewijs dat een inspecteur op de werf wil.
 */
function buildPresenceRegister({ clocks = [], users = [], venues = [], now = new Date() }) {
  const userById = new Map(users.map(u => [u.id, u]));
  const venueById = new Map(venues.map(v => [v.id, v.name || v.id]));
  const rows = clocks
    .filter(c => !c.clockOut)
    .map(c => {
      const u = userById.get(c.userId) || {};
      const insz = normalizeInsz(u.insz || u.nationalNumber || u.nationalId);
      const ciaw = c.ciaw || {};
      return {
        userId: c.userId,
        name: u.name || c.userId,
        insz: insz || null,
        inszValid: validInsz(insz),
        venueId: c.venueId || null,
        venue: c.venueId ? (venueById.get(c.venueId) || c.venueId) : "—",
        since: c.date && c.clockIn ? `${c.date}T${c.clockIn}` : (c.date || null),
        ciawStatus: ciaw.status || "none",
        ciawReference: ciaw.reference || "",
      };
    })
    .sort((a, b) => String(a.venue).localeCompare(String(b.venue)) || String(a.name).localeCompare(String(b.name)));
  return {
    at: now.toISOString(),
    present: rows.length,
    confirmed: rows.filter(r => r.ciawStatus === "confirmed" || r.ciawStatus === "sent").length,
    issues: rows.filter(r => r.ciawStatus !== "confirmed" && r.ciawStatus !== "sent").length,
    rows,
  };
}

module.exports = { normalizeInsz, validInsz, ciawReadiness, buildCheckinDeclaration, submitCheckin, buildPresenceRegister };
