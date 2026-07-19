"use strict";
/**
 * SecretProvider-PORT (handover 4.3).
 *
 * Secrets komen uit een provider, niet uit verspreide env-lezingen. Zo
 * kan rotatie zonder image rebuild (handover 4.3) en is er één plek waar
 * bepaald wordt of een waarde bruikbaar is.
 *
 * Contract:
 *   get(name)         → SecretValue
 *   getVersion(name)  → SecretVersion
 *   invalidate(name?) → void   (leegt de cache, voor rotatie)
 *
 * Niet-onderhandelbare regel: GEEN secretwaarden in logs, auditdetail of
 * foutmeldingen. Deze module levert daarom `maskSecret` en `redactSecrets`, die
 * overal gebruikt worden waar tekst naar buiten kan lekken.
 */

const crypto = require("crypto");

// Namen die als secret gelden. Een waarde onder zo'n naam wordt nooit getoond.
const SECRET_NAME_PATTERN = /(secret|token|password|passwd|api[_-]?key|apikey|private[_-]?key|credential|authorization|signing|service[_-]?role)/i;
// Patronen die er in vrije tekst uitzien als een sleutel.
const SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,          // OpenAI-stijl
  /\bwhsec_[A-Za-z0-9_-]{16,}\b/g,       // webhook signing
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,  // JWT
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi,
];
const PLACEHOLDER = /^(dev_only|change_?me|replace_?me|dummy|xxx+)/i;

function clean(v) { return String(v == null ? "" : v).trim(); }

/** Is dit een secret-achtige naam? */
function isSecretName(name) { return SECRET_NAME_PATTERN.test(clean(name)); }

/** Is dit een placeholder in plaats van een echte waarde? */
function isPlaceholderSecret(value) {
  const v = clean(value);
  return !v || PLACEHOLDER.test(v);
}

/**
 * Maak een waarde toonbaar: alleen de laatste tekens blijven staan, genoeg om
 * te herkennen wélke sleutel het is, te weinig om hem te gebruiken.
 */
function maskSecret(value, visible = 4) {
  const v = clean(value);
  if (!v) return "";
  if (v.length <= visible) return "…";
  return `…${v.slice(-visible)}`;
}

/**
 * Haal secretwaarden uit vrije tekst (logregels, foutmeldingen, auditdetail).
 * Dit is de laatste verdedigingslijn: liever een onleesbare log dan een
 * gelekte sleutel.
 */
function redactSecrets(text, extraValues = []) {
  let out = String(text == null ? "" : text);
  // Eerst de concreet bekende waarden · die kunnen elke vorm hebben.
  for (const value of extraValues) {
    const v = clean(value);
    if (v.length >= 8) out = out.split(v).join("[REDACTED]");
  }
  for (const pattern of SECRET_VALUE_PATTERNS) out = out.replace(pattern, "[REDACTED]");
  return out;
}

/** Versie-aanduiding van een waarde · voor rotatiedetectie zonder de waarde. */
function versionOf(value) {
  const v = clean(value);
  if (!v) return null;
  return crypto.createHash("sha256").update(v).digest("hex").slice(0, 12);
}

const REQUIRED_METHODS = ["get", "getVersion", "invalidate"];
function isSecretProvider(candidate) {
  return !!candidate && REQUIRED_METHODS.every(m => typeof candidate[m] === "function");
}

module.exports = {
  SECRET_NAME_PATTERN, REQUIRED_METHODS,
  isSecretName, isPlaceholderSecret, maskSecret, redactSecrets, versionOf, isSecretProvider,
};
