"use strict";
/**
 * Geverifieerde online ondertekening van offertes (h19-verdieping).
 *
 * De eindklant van de tenant tekent de offerte via de publieke link, maar
 * "iedereen met de link" is geen identiteit. Daarom:
 *
 *  1. VERIFICATIE · een zescijferige code gaat naar het e-mailadres dat AL in
 *     het dossier staat (klantrecord), nooit naar een adres dat de bezoeker
 *     zelf intikt. Wie de code kan overtikken, bewijst controle over die
 *     mailbox. Code: 10 minuten geldig, maximaal 5 pogingen, éénmalig,
 *     gehasht opgeslagen, hersturen ten vroegste na 60 seconden.
 *  2. ONDERTEKENING · naam (verplicht) + optioneel een getekende handtekening
 *     (canvas-dataURL, begrensd), gebonden aan de versie en de documenthash
 *     van de onveranderlijke offerteversie.
 *  3. DOSSIER · het aanvaardingsrecord draagt wie/wat/wanneer/hoe (methode
 *     e-mail-OTP, geverifieerd adres, IP, user-agent, hash) en is als
 *     ondertekeningsbewijs opvraagbaar.
 *
 * Dit is een sterke "gewone" elektronische handtekening (eIDAS SES) met
 * bewijskracht uit het dossier. Een gekwalificeerde handtekening (itsme/eID)
 * kan later als add-on via een provider · zelfde koppelpunt.
 *
 * Zonder gekend e-mailadres valt de flow terug op link-aanvaarding; het
 * record zegt dan eerlijk verified:false · nooit stilzwijgend "geverifieerd".
 */

const crypto = require("crypto");

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const MAX_SIGNATURE_BYTES = 200 * 1024;   // getekende handtekening (dataURL)

function fail(status, code, message, extra) {
  const e = new Error(message);
  e.status = status; e.code = code;
  if (extra) Object.assign(e, extra);
  throw e;
}

function hashOtp(code, quoteId) {
  return crypto.createHash("sha256").update(`${quoteId}:${String(code)}`).digest("hex");
}

function maskEmail(email) {
  const [user, domain] = String(email || "").split("@");
  if (!user || !domain) return "";
  const visible = user.slice(0, 2);
  return `${visible}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

/** Het gekende e-mailadres uit het dossier · nooit input van de bezoeker. */
function signerEmailFor(store, tenant, quote) {
  if (quote.customerId) {
    const customer = store.get("customers", quote.customerId);
    if (customer && customer.tenantId === tenant.id && customer.email) return String(customer.email);
  }
  return quote.customerEmail ? String(quote.customerEmail) : null;
}

function isExpired(quote, today = new Date().toISOString().slice(0, 10)) {
  return quote.status === "verzonden" && !!quote.validUntil && quote.validUntil < today;
}

function assertSignable(quote) {
  if (["aanvaard", "geweigerd"].includes(quote.status)) fail(409, "QUOTE_PROCESSED", "Offerte is al verwerkt");
  if (isExpired(quote)) fail(409, "QUOTE_EXPIRED", "Deze offerte is verlopen · vraag een nieuwe versie aan");
}

/**
 * Start de verificatie: genereer een code voor het gekende adres.
 * Retourneert { code, email, masked } · de AANROEPER verstuurt de mail
 * (deze module blijft mailer-vrij en dus puur testbaar).
 */
function requestOtp(store, tenant, quote, { now = Date.now() } = {}) {
  assertSignable(quote);
  const email = signerEmailFor(store, tenant, quote);
  if (!email) fail(409, "NO_EMAIL_ON_FILE", "Geen gekend e-mailadres voor deze klant · geverifieerd tekenen kan niet");
  const existing = quote.signing || {};
  if (existing.requestedAt && now - new Date(existing.requestedAt).getTime() < OTP_RESEND_COOLDOWN_MS) {
    fail(429, "OTP_COOLDOWN", "Er is net een code verstuurd · probeer over een minuut opnieuw",
      { retryAfterSeconds: Math.ceil((OTP_RESEND_COOLDOWN_MS - (now - new Date(existing.requestedAt).getTime())) / 1000) });
  }
  const code = String(crypto.randomInt(100000, 1000000));
  store.update("quotes", quote.id, {
    signing: {
      otpHash: hashOtp(code, quote.id),
      expiresAt: new Date(now + OTP_TTL_MS).toISOString(),
      attempts: 0,
      sentTo: email,
      requestedAt: new Date(now).toISOString(),
    },
    updatedAt: new Date(now).toISOString(),
  });
  return { code, email, masked: maskEmail(email) };
}

/**
 * Controleer de code en bouw het aanvaardingsrecord. Muteert de offerte NIET
 * naar aanvaard · dat doet de route (zelfde pad als de bestaande flow), dit
 * levert het geverifieerde record.
 */
function verifySignature(store, tenant, quote, { code, name, signatureDataUrl, ip, userAgent, now = Date.now() } = {}) {
  assertSignable(quote);
  const signing = quote.signing;
  if (!signing || !signing.otpHash) fail(400, "OTP_REQUIRED", "Vraag eerst een verificatiecode aan");
  if (new Date(signing.expiresAt).getTime() < now) fail(410, "OTP_EXPIRED", "De code is verlopen · vraag een nieuwe aan");
  if (signing.attempts >= OTP_MAX_ATTEMPTS) fail(429, "OTP_LOCKED", "Te veel foute pogingen · vraag een nieuwe code aan");

  const given = hashOtp(String(code || "").trim(), quote.id);
  const expected = signing.otpHash;
  const match = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!match) {
    store.update("quotes", quote.id, { signing: { ...signing, attempts: (signing.attempts || 0) + 1 } });
    const left = OTP_MAX_ATTEMPTS - ((signing.attempts || 0) + 1);
    fail(400, "OTP_INVALID", left > 0 ? `Onjuiste code · nog ${left} poging(en)` : "Onjuiste code · vraag een nieuwe aan", { attemptsLeft: Math.max(0, left) });
  }

  const signedName = String(name || "").trim().slice(0, 120);
  if (!signedName) fail(400, "NAME_REQUIRED", "Naam van de ondertekenaar is verplicht");
  let signature = null;
  if (signatureDataUrl) {
    const s = String(signatureDataUrl);
    if (!/^data:image\/(png|jpeg);base64,/.test(s)) fail(400, "SIGNATURE_INVALID", "Handtekening moet een png/jpeg-dataURL zijn");
    if (Buffer.byteLength(s) > MAX_SIGNATURE_BYTES) fail(400, "SIGNATURE_TOO_LARGE", "Handtekening is te groot");
    signature = s;
  }

  return {
    name: signedName,
    at: new Date(now).toISOString(),
    version: quote.version || 1,
    documentHash: quote.documentHash || null,
    verified: true,
    method: "email-otp",
    verifiedEmail: signing.sentTo,
    signature,
    ip: ip || null,
    userAgent: String(userAgent || "").slice(0, 200),
  };
}

/** Opvraagbaar ondertekeningsbewijs · alles wat het dossier draagt, niets meer. */
function acceptanceReceipt(quote, tenant) {
  if (quote.status !== "aanvaard" || !quote.acceptance) fail(404, "NOT_SIGNED", "Deze offerte is (nog) niet ondertekend");
  const a = quote.acceptance;
  return {
    document: {
      number: quote.number,
      version: a.version,
      documentHash: a.documentHash,
      total: quote.total,
      company: tenant.name || "",
    },
    signer: {
      name: a.name,
      verified: a.verified === true,
      method: a.method || "link",
      verifiedEmail: a.verifiedEmail ? maskEmail(a.verifiedEmail) : null,
      hasDrawnSignature: !!a.signature,
    },
    signedAt: a.at,
    evidence: { ip: a.ip || null, userAgent: a.userAgent || null },
    note: a.verified === true
      ? "Ondertekend na e-mailverificatie (code naar het gekende klantadres)."
      : "Aanvaard via de beveiligde link, zonder e-mailverificatie.",
  };
}

module.exports = {
  requestOtp, verifySignature, acceptanceReceipt,
  signerEmailFor, maskEmail, isExpired, assertSignable, hashOtp,
  OTP_TTL_MS, OTP_RESEND_COOLDOWN_MS, OTP_MAX_ATTEMPTS,
};
