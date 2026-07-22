"use strict";

// ── Domeincommand-router (Forms handover h1/h4 · F4 Domain forms) ────────────
// "Een domeinformulier schrijft via een gevalideerd command naar het canonieke
// domeinobject" - nooit als vrije JSON-tweede-waarheid. Deze router bindt een
// domain_object (customer, project, workorder, ...) aan een command-handler en
// bepaalt WANNEER er gedispatcht wordt (h4-brontabel):
//   domain    → bij submit (de inzending ÍS de mutatie)
//   workflow  → pas bij goedkeuring ("form instance tot goedkeuring, daarna
//               domeinobject")
//   evidence/survey → nooit (de instance is de bron van waarheid)
//
// De repository roept dispatch() BINNEN de submit-/approve-transactie aan (zelfde
// pg-client), zodat een falend command de statusovergang mee terugdraait:
// transactioneel, zoals de F4-DoD eist.

/** Op welk lifecycle-moment schrijft dit formuliertype naar het domein? */
function dispatchMomentFor(formType) {
  if (formType === "domain") return "submit";
  if (formType === "workflow") return "approve";
  return null; // evidence/survey: de instance is het bewijs
}

/**
 * Map de instance-antwoorden naar canonieke domeinvelden. De definitie draagt de
 * mapping in attributes.domain_mapping = { antwoordKey: domeinVeld }; zonder
 * mapping gaan de antwoorden 1-op-1 mee (velden heten dan al canoniek).
 */
function mapAnswersToDomain(definition, answers) {
  const mapping = (definition && definition.attributes && definition.attributes.domain_mapping) || null;
  const src = answers || {};
  if (!mapping) return { ...src };
  const out = {};
  for (const [key, val] of Object.entries(src)) {
    out[mapping[key] || key] = val;
  }
  return out;
}

/**
 * Router: registreer per domain_object een handler
 *   async handler({ client, tenantId, definition, instance, payload, actor })
 * De handler draait binnen de lopende transactie (client) en retourneert een
 * resultaat (bv. { domainId }) dat in de form_events-log wordt vastgelegd.
 */
function makeDomainCommandRouter() {
  const handlers = new Map();
  return {
    register(domainObject, handler) {
      if (typeof handler !== "function") throw new Error("handler moet een functie zijn");
      handlers.set(domainObject, handler);
      return this;
    },
    has(domainObject) { return handlers.has(domainObject); },
    /** Dispatch één command; gooit door zodat de transactie terugdraait bij falen. */
    async dispatch({ client, tenantId, definition, instance, answers, actor }) {
      const handler = handlers.get(definition && definition.domain_object);
      if (!handler) return null; // geen handler geregistreerd → geen domeinschrijf
      const payload = mapAnswersToDomain(definition, answers);
      const result = await handler({ client, tenantId, definition, instance, payload, actor });
      return result || { ok: true };
    },
  };
}

module.exports = { makeDomainCommandRouter, mapAnswersToDomain, dispatchMomentFor };
