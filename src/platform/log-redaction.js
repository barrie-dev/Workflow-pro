"use strict";

// ── Logredactie + veilige logvelden (CTO3-12) ────────────────────────────────
// Applicatielogs dragen requestId, een TENANT-HASH, deploymentId en een
// foutcode · nooit gevoelige payloads. Deze module is de enige plek waar
// bepaald wordt wat er NIET in een log of alertmail mag belanden.
//
// Grondregels (spec punt 5 + 'geen klantdata in logs of alertmails'):
//  - secrets/tokens/wachtwoorden, rijksregisternummers, bankrekeningen en
//    kaartnummers worden ALTIJD gemaskeerd, ook diep genest en in arrays;
//  - de tenant is herleidbaar voor correlatie maar niet leesbaar: we loggen een
//    stabiele hash, geen tenant-id of klantnaam;
//  - onbekende, vrije tekst wordt gescand op patronen (een IBAN in een
//    foutboodschap is even gevoelig als in een veld).
//
// Cloudblind (architectuurtest): leest geen omgevingsvariabelen, doet geen
// netwerkaanroepen en kent geen SQL · pure functies op doorgegeven waarden.

const crypto = require("crypto");

const REDACTED = "[REDACTED]";

// Sleutelnamen die per definitie geheim zijn.
const SECRET_KEY = /password|passwordhash|secret|token|apikey|api_key|privatekey|private_key|authorization|cookie|mfasecret|mfa_secret|signingkey|accesskey|access_key|credential/i;
// Sleutelnamen met persoonsgegevens die niet in logs horen.
const SENSITIVE_KEY = /rijksregister|nationalnumber|national_number|\bssn\b|\bbsn\b|\binsz\b|\bniss\b|iban|bankaccount|accountnumber|rekeningnummer|cardnumber|card_number|payout_account/i;

// Waarde-patronen · ook in vrije tekst (foutboodschappen, stack traces).
const VALUE_PATTERNS = [
  // Bearer/JWT-achtige tokens
  [/\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, "Bearer " + REDACTED],
  [/\beyJ[A-Za-z0-9._-]{20,}/g, REDACTED],                    // JWT
  // Providersleutels
  [/\bsk_(live|test)_[A-Za-z0-9]{8,}/g, REDACTED],
  [/\bwhsec_[A-Za-z0-9]{8,}/g, REDACTED],
  [/\bxox[baprs]-[A-Za-z0-9-]{8,}/g, REDACTED],
  // IBAN (BE + generiek Europees)
  [/\b[A-Z]{2}\d{2}[ ]?(?:[A-Za-z0-9]{4}[ ]?){2,7}[A-Za-z0-9]{1,4}\b/g, REDACTED],
  // Belgisch rijksregisternummer (11 cijfers, met of zonder scheiding)
  [/\b\d{2}[.\- ]?\d{2}[.\- ]?\d{2}[-. ]?\d{3}[.\- ]?\d{2}\b/g, REDACTED],
  // Kaartnummers: ofwel in groepjes van vier, ofwel een lange kale reeks.
  // Bewust NIET elke 13-cijferige reeks · een epoch-timestamp in milliseconden
  // is 13 cijfers en die willen we juist wél kunnen loggen.
  [/\b(?:\d{4}[ -]){3}\d{1,7}\b/g, REDACTED],
  [/\b\d{15,19}\b/g, REDACTED],
  // PEM-sleutels
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
];

/** Maskeer gevoelige patronen in vrije tekst. */
function redactText(text) {
  let out = String(text == null ? "" : text);
  for (const [re, replacement] of VALUE_PATTERNS) out = out.replace(re, replacement);
  return out;
}

/**
 * Redigeer een willekeurige waarde voor logging: gevoelige SLEUTELS worden
 * volledig gemaskeerd, en alle overige tekst wordt op gevoelige PATRONEN
 * gescand. Recursief door objecten en arrays; cyclische structuren zijn veilig.
 */
function redactForLog(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === "string") return redactText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactText(value.message), code: value.code || null };
  }
  if (Array.isArray(value)) return value.map(v => redactForLog(v, seen));
  if (typeof value === "object") {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k) || SENSITIVE_KEY.test(k)) { out[k] = REDACTED; continue; }
      out[k] = redactForLog(v, seen);
    }
    return out;
  }
  return REDACTED; // functies, symbolen: nooit loggen
}

/**
 * Stabiele, niet-omkeerbare tenant-hash voor correlatie in logs. Dezelfde tenant
 * geeft altijd dezelfde hash, maar de hash verraadt de tenant niet.
 */
function hashTenantId(tenantId) {
  const t = String(tenantId == null ? "" : tenantId).trim();
  if (!t) return null;
  return "t#" + crypto.createHash("sha256").update(t).digest("hex").slice(0, 12);
}

/**
 * De canonieke logvelden (spec punt 5). Alles wat hier niet in staat, hoort niet
 * standaard in een applicatielog. Extra context loopt ALTIJD door redactForLog.
 */
function safeLogFields({ requestId = null, tenantId = null, deploymentId = null, commitSha = null, code = null, level = "info", message = "", context = null } = {}) {
  const out = {
    level,
    requestId: requestId || null,
    tenant: hashTenantId(tenantId),      // hash, nooit het echte id
    deploymentId: deploymentId || null,
    commitSha: commitSha || null,
    code: code || null,
    message: redactText(message),
  };
  if (context != null) out.context = redactForLog(context);
  return out;
}

/** Eén regel JSON, klaar voor een logcollector. Nooit onbewerkte payloads. */
function formatLogLine(fields) {
  return JSON.stringify(safeLogFields(fields));
}

module.exports = {
  REDACTED, SECRET_KEY, SENSITIVE_KEY, VALUE_PATTERNS,
  redactText, redactForLog, hashTenantId, safeLogFields, formatLogLine,
};
