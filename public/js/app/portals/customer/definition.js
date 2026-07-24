/* ============================================================
   IA-21 · Klantportaal (IA handover §7/§8)

   Contract: "Shared requests, quotes, projects/work, invoices, documents
   and messages."
   Acceptatie: "Versioned approvals; explicit record sharing; external
   auth and audit."

   Dit portaal is anders dan alle andere: de gebruiker staat BUITEN de
   organisatie. Drie regels volgen daaruit.

   1. EXPLICIET DELEN, niet impliciet afleiden.
      De verleiding is groot om te zeggen "toon alles met customerId =
      c_42". Dat is fout. Niet elke offerte die je voor een klant maakt
      wil je hem laten zien, niet elke interne notitie op zijn project,
      en zeker niet elke conceptfactuur. Delen is een HANDELING met een
      spoor, geen bijwerking van een veld.

   2. GOEDKEURING GELDT VOOR EEN VERSIE.
      Een klant keurt offerteversie 3 goed. Komt er een versie 4, dan
      geldt die goedkeuring NIET meer · ook niet "want het is dezelfde
      offerte". Anders kan een prijswijziging meeliften op een akkoord
      dat over een ander bedrag ging.

   3. EXTERNE TOEGANG WORDT GEAUDIT.
      Elke weergave en elke handeling van een externe gebruiker laat een
      spoor na, inclusief welk record en welke versie. Bij een geschil is
      dat het enige wat telt.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpPortals = root.wfpPortals || {}; root.wfpPortals.customer = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  // Wat een klant überhaupt gedeeld kan krijgen. Alles daarbuiten is intern
  // en kan dus ook niet per ongeluk gedeeld worden.
  const SHAREABLE_TYPES = ["customer_request", "quote_version", "project", "work_order", "invoice", "document", "message"];

  // Velden die NOOIT naar buiten gaan, ook niet op een gedeeld record.
  // Dit zijn interne oordelen en kosten · de klant ziet zijn prijs, niet
  // onze marge en niet wat de collega ervan vond.
  const NEVER_SHARED_FIELDS = [
    "costPrice", "costRate", "margin", "marginPct", "purchasePrice", "internalNotes",
    "assigneeCost", "employeeCostRate", "supplierPrice", "riskNote", "internalStatus",
  ];

  /**
   * Mag deze externe gebruiker dit record zien?
   *
   * Fail-closed op elke stap. De klant-id komt uit de sessie, nooit uit de
   * URL · anders kun je met een ander id andermans dossier proberen.
   */
  function canView(record, share, ctx = {}) {
    if (!record || !share) return { ok: false, code: "NOT_SHARED" };
    if (!SHAREABLE_TYPES.includes(record.type)) return { ok: false, code: "TYPE_NOT_SHAREABLE" };
    if (share.recordType !== record.type || share.recordId !== record.id) return { ok: false, code: "NOT_SHARED" };
    if (!share.active) return { ok: false, code: "SHARE_REVOKED" };
    if (share.customerId !== ctx.customerId) return { ok: false, code: "NOT_SHARED" };
    if (share.expiresAt && new Date(share.expiresAt).getTime() <= new Date(ctx.now || 0).getTime()) {
      return { ok: false, code: "SHARE_EXPIRED" };
    }
    // Een gedeelde offerteVERSIE geeft geen toegang tot een andere versie.
    if (record.type === "quote_version" && share.versionId && share.versionId !== record.id) {
      return { ok: false, code: "NOT_SHARED" };
    }
    return { ok: true, code: null };
  }

  /**
   * Projecteer een gedeeld record naar wat de klant mag zien.
   * Interne velden worden weggelaten, niet genuld · een leeg margeveld
   * verraadt nog steeds dat er marge op zit en hoe het heet.
   */
  function projectForCustomer(record) {
    const verboden = new Set(NEVER_SHARED_FIELDS);
    const uit = {};
    for (const [k, v] of Object.entries(record || {})) if (!verboden.has(k)) uit[k] = v;
    return uit;
  }

  /**
   * Geldt deze goedkeuring nog voor de huidige versie?
   *
   * Dit is de kern van "versioned approvals". Een goedkeuring draagt de
   * versie waarop ze sloeg; komt er een nieuwe versie, dan vervalt ze.
   */
  function approvalState(approval, currentVersionId) {
    if (!approval) return { state: "pending", validFor: null };
    if (!approval.versionId) return { state: "invalid", validFor: null, reason: "APPROVAL_WITHOUT_VERSION" };
    if (approval.versionId !== currentVersionId) {
      return { state: "superseded", validFor: approval.versionId, reason: "NEW_VERSION_NEEDS_NEW_APPROVAL" };
    }
    return { state: approval.decision === "rejected" ? "rejected" : "approved", validFor: approval.versionId };
  }

  /**
   * Mag de klant nu goedkeuren? Alleen de HUIDIGE versie, en alleen als
   * die met hem gedeeld is.
   */
  function canApprove(record, share, approval, ctx = {}) {
    const zicht = canView(record, share, ctx);
    if (!zicht.ok) return zicht;
    if (record.type !== "quote_version") return { ok: false, code: "NOT_APPROVABLE" };
    const st = approvalState(approval, record.id);
    if (st.state === "approved") return { ok: false, code: "ALREADY_APPROVED" };
    if (!(share.scopes || []).includes("approve")) return { ok: false, code: "APPROVAL_NOT_GRANTED" };
    return { ok: true, code: null };
  }

  /**
   * Auditregel voor externe toegang. Draagt WIE, WAT, WELKE VERSIE en
   * hoe die persoon binnenkwam · geen recordinhoud.
   *
   * De versie staat erbij omdat "de klant heeft de offerte gezien" bij een
   * geschil niets waard is zonder te weten welke.
   */
  function auditEntry(action, record, ctx = {}) {
    return {
      event: "customer_portal.access",
      action: action || null,
      recordType: (record && record.type) || null,
      recordId: (record && record.id) || null,
      versionId: (record && record.versionId) || (record && record.type === "quote_version" ? record.id : null),
      customerId: ctx.customerId || null,
      contactId: ctx.contactId || null,
      authMethod: ctx.authMethod || null,
      at: ctx.now || null,
    };
  }

  // Manieren waarop een externe gebruiker binnenkomt. Een wachtwoord van
  // een interne gebruiker hoort hier NIET bij: interne en externe identiteit
  // lopen niet door elkaar.
  const EXTERNAL_AUTH_METHODS = ["portal_account", "magic_link", "signed_share_token"];

  function checkExternalSession(session) {
    const overtredingen = [];
    if (!session || !session.customerId) overtredingen.push({ field: "customerId", reason: "MISSING_CUSTOMER" });
    if (!session || !EXTERNAL_AUTH_METHODS.includes(session.authMethod)) {
      overtredingen.push({ field: "authMethod", reason: "INVALID_EXTERNAL_AUTH" });
    }
    // Een externe sessie mag nooit een interne rol dragen.
    if (session && session.role && session.role !== "customer") {
      overtredingen.push({ field: "role", reason: "INTERNAL_ROLE_ON_EXTERNAL_SESSION" });
    }
    if (session && !session.expiresAt) overtredingen.push({ field: "expiresAt", reason: "SESSION_WITHOUT_EXPIRY" });
    return { ok: overtredingen.length === 0, violations: overtredingen };
  }

  return {
    SHAREABLE_TYPES, NEVER_SHARED_FIELDS, EXTERNAL_AUTH_METHODS,
    canView, projectForCustomer, approvalState, canApprove, auditEntry, checkExternalSession,
  };
});
