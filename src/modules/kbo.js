"use strict";
/**
 * KBO-/BTW-opzoeking.
 *
 * Bron van waarheid voor de échte opzoeking is VIES (VAT Information Exchange
 * System) van de Europese Commissie — gratis en officieel, en geeft voor
 * Belgische nummers de bij de KBO geregistreerde naam + adres terug. Er is geen
 * API-sleutel nodig.
 *
 * Strategie (lookupKboResolve):
 *   1. Fixtures  → demo-ondernemingen + offline/tests, zonder netwerk.
 *   2. VIES      → echte naam + adres.
 *   3. Fallback  → afgeleid ondernemingsnummer, leeg adres (nooit een throw).
 *
 * lookupKbo (sync) blijft de zuivere mock voor code/tests die geen netwerk mogen
 * raken; lookupKboResolve (async) is wat de endpoints gebruiken.
 */

const { httpsRequest } = require("../lib/http-client");

// Enkel het duidelijk-fictieve demonummer blijft als offline/test-fixture. Echte
// ondernemingsnummers mogen NIET hier staan, anders schaduwt de mock de live
// VIES-opzoeking en krijg je verouderde/foute gegevens i.p.v. de echte KBO-data.
const KBO_FIXTURES = {
  "BE0123456789": {
    name: "Demo Bouwgroep NV",
    companyNumber: "0123456789",
    street: "Kerkstraat 12",
    postalCode: "9000",
    city: "Gent",
    country: "Belgie"
  }
};

function normalizeVat(vat) {
  const clean = String(vat || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!clean) return "";
  return clean.startsWith("BE") ? clean : `BE${clean}`;
}

function lookupKbo(vat) {
  const normalized = normalizeVat(vat);
  const hit = KBO_FIXTURES[normalized];
  if (hit) return { vat: normalized, source: "mock-kbo", ...hit };
  const companyNumber = normalized.replace(/^BE/, "");
  return {
    vat: normalized,
    source: "mock-kbo-fallback",
    name: `KBO onderneming ${companyNumber}`,
    companyNumber,
    street: "",
    postalCode: "",
    city: "",
    country: "Belgie"
  };
}

// VIES geeft het adres als één string ("STRAAT NR\nPOSTCODE GEMEENTE"); splits dit
// naar losse velden. Best-effort — bij een onverwacht formaat blijven velden leeg.
function parseViesAddress(address) {
  const lines = String(address || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  let street = "", zip = "", city = "";
  if (lines.length) {
    street = lines[0];
    const last = lines[lines.length - 1];
    const m = last.match(/(\d{4})\s+(.+)/);
    if (m) { zip = m[1]; city = m[2]; }
    else if (lines.length > 1) { city = last; }
  }
  return { street, zip, city };
}

// Echte opzoeking via VIES. Gooit niet naar buiten toe door de caller; geeft
// null bij ongeldig/niet-gevonden/onbereikbaar zodat er teruggevallen kan worden.
async function viesLookup(normalizedVat, { transport, timeoutMs = 8000 } = {}) {
  const ms = normalizedVat.slice(0, 2);
  const number = normalizedVat.slice(2);
  if (!/^[A-Z]{2}$/.test(ms) || !number) return null;
  const res = await httpsRequest({
    hostname: "ec.europa.eu",
    path: `/taxation_customs/vies/rest-api/ms/${ms}/vat/${number}`,
    method: "GET",
    headers: { Accept: "application/json" },
    timeoutMs,
    transport
  });
  const j = res && res.json;
  if (!j) return null;
  const valid = j.valid != null ? j.valid : j.isValid;
  if (!valid) return null;
  const name = String(j.name || "").trim();
  if (!name || name === "---") return null;
  const { street, zip, city } = parseViesAddress(j.address);
  return { vat: normalizedVat, source: "vies", name, companyNumber: number, street, zip, city, country: "Belgie" };
}

// Async resolver die de endpoints gebruiken: fixtures → VIES → mock-fallback.
// Geeft altijd een bruikbaar object terug (geen throw), zodat registratie/autofill
// blijven werken ook als VIES traag of offline is.
async function lookupKboResolve(vat, opts = {}) {
  const normalized = normalizeVat(vat);
  if (!normalized) return lookupKbo(vat);
  const fixture = KBO_FIXTURES[normalized];
  if (fixture) return { vat: normalized, source: "mock-kbo", zip: fixture.postalCode, ...fixture };
  try {
    const live = await viesLookup(normalized, opts);
    if (live) return live;
  } catch (_) { /* netwerk/timeout → val terug op de mock-afleiding */ }
  return lookupKbo(normalized);
}

module.exports = { lookupKbo, lookupKboResolve, viesLookup, parseViesAddress, normalizeVat };
