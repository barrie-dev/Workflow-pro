"use strict";
/**
 * SAML 2.0 Single Sign-On (add-on). Dunne, defensieve wrapper rond de
 * onderhouden, vetted library @node-saml/node-saml · we valideren XML-
 * signaturen NOOIT zelf (dat is precies waar signature-wrapping-aanvallen
 * vandaan komen). SP-initiated flow: app → IdP → ACS → sessie.
 *
 * Per-tenant configuratie leeft op `tenant.sso`:
 *   {
 *     enabled, entryPoint, idpCert, issuer?, identifierFormat?,
 *     signatureAlgorithm?, wantAuthnResponseSigned?, domains: [".."],
 *     jit: { enabled, defaultRole }, attrMap: { email, name }
 *   }
 */

const { SAML } = require("@node-saml/node-saml");
const { config } = require("../lib/config");

// Standaard attribuut-namen waarin IdP's e-mail/naam plaatsen.
const DEFAULT_EMAIL_ATTRS = [
  "email", "mail", "emailaddress", "user.email",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
  "urn:oid:0.9.2342.19200300.100.1.3"
];
const DEFAULT_NAME_ATTRS = [
  "displayName", "name", "cn", "givenName",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
  "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
  "urn:oid:2.16.840.1.113730.3.1.241", "urn:oid:2.5.4.3"
];
const VALID_JIT_ROLES = ["employee", "manager"];

// SP entityID + ACS-URL zijn per tenant uniek (multi-tenant op één app).
function spIssuer(tenant) {
  return (tenant.sso && tenant.sso.issuer) || `${config.appUrl}/api/auth/saml/${tenant.id}/metadata`;
}
function acsUrl(tenant) {
  return `${config.appUrl}/api/auth/saml/${tenant.id}/acs`;
}

// Is SSO functioneel geconfigureerd? (Entitlement-check gebeurt apart in server.js.)
function ssoConfigured(tenant) {
  const s = tenant && tenant.sso;
  return !!(s && s.enabled && s.entryPoint && s.idpCert);
}

// Domeinen waarvoor deze tenant SSO afdwingt (bv. ["acme.be"]).
function ssoDomains(tenant) {
  const s = (tenant && tenant.sso) || {};
  return (Array.isArray(s.domains) ? s.domains : [])
    .map(d => String(d || "").trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

// Bouw een SAML-instantie voor één tenant. Veilige defaults: assertions moeten
// ondertekend zijn, geen ongesigneerde acceptatie, kleine klok-skew.
function instanceFor(tenant) {
  const s = tenant.sso || {};
  return new SAML({
    entryPoint: s.entryPoint,
    idpCert: s.idpCert,
    issuer: spIssuer(tenant),
    callbackUrl: acsUrl(tenant),
    identifierFormat: s.identifierFormat || "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    signatureAlgorithm: s.signatureAlgorithm || "sha256",
    digestAlgorithm: "sha256",
    wantAssertionsSigned: s.wantAssertionsSigned !== false,
    wantAuthnResponseSigned: s.wantAuthnResponseSigned === true,
    acceptedClockSkewMs: 5000,
    audience: spIssuer(tenant),
    disableRequestedAuthnContext: true
  });
}

// → redirect-URL naar de IdP (HTTP-Redirect binding). relayState overleeft de
// round-trip (we gebruiken het niet voor geheimen, enkel voor terugkeer-context).
async function buildLoginUrl(tenant, relayState) {
  return instanceFor(tenant).getAuthorizeUrlAsync(relayState || "", null, {});
}

// Valideer de POST'te SAMLResponse en geef het IdP-profiel terug. Gooit bij een
// ongeldige/ongetekende/verlopen assertie · de library doet de XML-DSig-checks.
async function validateAcs(tenant, body) {
  const { profile } = await instanceFor(tenant).validatePostResponseAsync({
    SAMLResponse: body.SAMLResponse,
    RelayState: body.RelayState
  });
  return profile;
}

// Haal e-mail/naam uit het profiel volgens de attribuut-mapping (of defaults).
function extractIdentity(profile, tenant) {
  const map = (tenant.sso && tenant.sso.attrMap) || {};
  const attrs = profile || {};
  const lower = {};
  for (const k of Object.keys(attrs)) lower[k.toLowerCase()] = attrs[k];
  const pick = (configured, fallbacks) => {
    const keys = [configured, ...fallbacks].filter(Boolean);
    for (const k of keys) {
      const v = attrs[k] != null ? attrs[k] : lower[String(k).toLowerCase()];
      if (v != null && String(v).trim()) return String(Array.isArray(v) ? v[0] : v).trim();
    }
    return "";
  };
  let email = pick(map.email, DEFAULT_EMAIL_ATTRS);
  if (!email && profile && /@/.test(String(profile.nameID || ""))) email = String(profile.nameID).trim();
  const name = pick(map.name, DEFAULT_NAME_ATTRS);
  return { email: email.toLowerCase(), name };
}

// JIT-rol normaliseren (nooit auto-provisionen als admin/super_admin).
function jitRole(tenant) {
  const r = (tenant.sso && tenant.sso.jit && tenant.sso.jit.defaultRole) || "employee";
  return VALID_JIT_ROLES.includes(r) ? r : "employee";
}
function jitEnabled(tenant) {
  return !!(tenant.sso && tenant.sso.jit && tenant.sso.jit.enabled);
}

// SP-metadata XML (te uploaden bij de IdP).
function spMetadata(tenant) {
  return instanceFor(tenant).generateServiceProviderMetadata(null, null);
}

// Veld-set die veilig naar de client mag (NOOIT als gevoelig: idpCert is publiek,
// maar we tonen 'm samengevat). Geen geheimen in tenant.sso.
function publicSsoConfig(tenant) {
  const s = (tenant && tenant.sso) || {};
  return {
    enabled: !!s.enabled,
    entryPoint: s.entryPoint || "",
    idpCert: s.idpCert || "",
    issuer: spIssuer(tenant),
    domains: ssoDomains(tenant),
    jit: { enabled: jitEnabled(tenant), defaultRole: jitRole(tenant) },
    attrMap: { email: (s.attrMap && s.attrMap.email) || "", name: (s.attrMap && s.attrMap.name) || "" },
    acsUrl: acsUrl(tenant),
    metadataUrl: `${config.appUrl}/api/auth/saml/${tenant.id}/metadata`,
    configured: ssoConfigured(tenant)
  };
}

// Normaliseer een binnenkomende config-PATCH (vanuit de admin-UI) naar tenant.sso.
function sanitizeSsoInput(input, existing) {
  const cur = existing || {};
  const out = { ...cur };
  if (input.enabled !== undefined) out.enabled = !!input.enabled;
  if (input.entryPoint !== undefined) out.entryPoint = String(input.entryPoint || "").trim();
  if (input.idpCert !== undefined) out.idpCert = String(input.idpCert || "").trim();
  if (input.issuer !== undefined) out.issuer = String(input.issuer || "").trim() || undefined;
  if (input.identifierFormat !== undefined) out.identifierFormat = String(input.identifierFormat || "").trim() || undefined;
  if (Array.isArray(input.domains)) {
    out.domains = input.domains.map(d => String(d || "").trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  }
  if (input.jit !== undefined) {
    out.jit = {
      enabled: !!(input.jit && input.jit.enabled),
      defaultRole: VALID_JIT_ROLES.includes(input.jit && input.jit.defaultRole) ? input.jit.defaultRole : "employee"
    };
  }
  if (input.attrMap !== undefined) {
    out.attrMap = {
      email: String((input.attrMap && input.attrMap.email) || "").trim(),
      name: String((input.attrMap && input.attrMap.name) || "").trim()
    };
  }
  if (input.wantAssertionsSigned !== undefined) out.wantAssertionsSigned = !!input.wantAssertionsSigned;
  if (input.wantAuthnResponseSigned !== undefined) out.wantAuthnResponseSigned = !!input.wantAuthnResponseSigned;
  return out;
}

module.exports = {
  ssoConfigured, ssoDomains, buildLoginUrl, validateAcs, extractIdentity,
  jitRole, jitEnabled, spMetadata, publicSsoConfig, sanitizeSsoInput,
  spIssuer, acsUrl
};
