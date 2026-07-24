/* ============================================================
   IA-11 · Werkbonwerkruimte (IA handover §7/§8)

   Contract: "Execution tabs, offline flow, proof, materials and billing
   readiness."
   Acceptatie: "Existing full-chain E2E preserved; idempotent offline
   replay."

   De werkbon is het enige scherm dat structureel OFFLINE gebruikt wordt.
   Een monteur in een kelder of op een werf zonder bereik moet gewoon
   verder kunnen, en zijn werk moet later precies één keer landen.

   Dat "precies één keer" is de hele moeilijkheid. De telefoon weet niet
   of een verzending is aangekomen: het antwoord kan verloren gaan terwijl
   de server het wel verwerkte. Wie dan opnieuw verstuurt zonder
   idempotentie, boekt twee keer drie uur en twee keer twintig meter kabel.

   De oplossing hier: elke mutatie krijgt op het TOESTEL een stabiele
   sleutel, afgeleid van de werkbon, het soort mutatie en de lokale
   volgnummering. Opnieuw versturen levert dezelfde sleutel op, en de
   server herkent hem.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpWorkspaces = root.wfpWorkspaces || {}; root.wfpWorkspaces.workOrder = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const DEFINITION = {
    id: "work-orders",
    recordBase: "/app/work-orders",
    idParam: "workOrderId",
    defaultTab: "overview",
    tabs: [
      { id: "overview", labelKey: "workorder.tab.overview", permission: "workorders.view" },
      { id: "tasks", labelKey: "workorder.tab.tasks", permission: "workorders.view", countSource: "workorder.tasks" },
      { id: "time", labelKey: "workorder.tab.time", permission: "workorders.view", countSource: "workorder.time" },
      { id: "materials", labelKey: "workorder.tab.materials", permission: "workorders.view", countSource: "workorder.materials" },
      { id: "proof", labelKey: "workorder.tab.proof", permission: "workorders.view", countSource: "workorder.proof" },
      { id: "forms", labelKey: "workorder.tab.forms", permission: "workorders.view", countSource: "workorder.forms" },
      // Facturatiegereedheid is een financieel oordeel · eigen recht.
      { id: "billing", labelKey: "workorder.tab.billing", permission: "invoices.view", entitlement: "invoices" },
      { id: "activity", labelKey: "workorder.tab.activity", permission: "workorders.view" },
    ],
  };

  // Mutaties die offline mogen ontstaan. Alles daarbuiten vereist verbinding ·
  // een status naar "gefactureerd" duwen vanaf een telefoon zonder bereik is
  // geen offline-scenario maar een ongeluk.
  const OFFLINE_MUTATIONS = ["time.add", "material.add", "task.complete", "proof.add", "form.submit", "note.add"];

  /**
   * Bouw de idempotentiesleutel van een offline mutatie.
   *
   * De sleutel wordt op het TOESTEL bepaald en verandert nooit meer. Zo
   * levert opnieuw versturen exact dezelfde sleutel op, en herkent de
   * server het als hetzelfde feit in plaats van een tweede.
   */
  function mutationKey(mutation) {
    if (!mutation || !mutation.workOrderId || !mutation.type) return null;
    if (!OFFLINE_MUTATIONS.includes(mutation.type)) return null;
    if (!mutation.deviceId || mutation.seq === undefined || mutation.seq === null) return null;
    return `wo:${mutation.workOrderId}:${mutation.type}:${mutation.deviceId}:${mutation.seq}`;
  }

  /**
   * Zet de offline wachtrij klaar voor verzending.
   *
   * Twee dingen gebeuren hier:
   *  · mutaties zonder geldige sleutel worden GEWEIGERD, niet stil verstuurd;
   *  · dubbele sleutels vallen weg · dat is dezelfde mutatie die twee keer
   *    in de wachtrij belandde na een mislukte verzending.
   */
  function prepareQueue(mutations) {
    const gezien = new Set();
    const klaar = [], geweigerd = [];
    for (const m of mutations || []) {
      const sleutel = mutationKey(m);
      if (!sleutel) { geweigerd.push({ mutation: m, reason: m && !OFFLINE_MUTATIONS.includes(m.type) ? "NOT_OFFLINE_CAPABLE" : "INCOMPLETE_MUTATION" }); continue; }
      if (gezien.has(sleutel)) continue;
      gezien.add(sleutel);
      klaar.push({ ...m, idempotencyKey: sleutel });
    }
    // Vaste volgorde: de server ziet de mutaties in de volgorde waarin ze
    // ontstonden, ook als de wachtrij door elkaar geraakt is.
    klaar.sort((a, b) => a.seq - b.seq || a.type.localeCompare(b.type));
    return { ready: klaar, rejected: geweigerd };
  }

  /**
   * Verwerk het antwoord van een replay. Een mutatie die de server als
   * DUPLICAAT herkent is een succes, geen fout · dat is precies het geval
   * waarvoor idempotentie bestaat.
   */
  function applyReplayResult(queue, results) {
    const perSleutel = new Map((results || []).map(r => [r.idempotencyKey, r]));
    const bevestigd = [], opnieuw = [], mislukt = [];
    for (const m of queue || []) {
      const r = perSleutel.get(m.idempotencyKey);
      if (!r) { opnieuw.push(m); continue; }
      if (r.status === "applied" || r.status === "duplicate") bevestigd.push(m);
      else if (r.retryable) opnieuw.push(m);
      else mislukt.push({ ...m, error: r.code || "REJECTED" });
    }
    return { confirmed: bevestigd, retry: opnieuw, failed: mislukt };
  }

  /**
   * Is deze werkbon klaar om te factureren? De UI TOONT dit oordeel, ze
   * velt het niet: de blokkades komen van de server (D-06). Wat hier
   * gebeurt is de blokkades leesbaar maken en de knop uit zetten.
   */
  function billingReadiness(record) {
    const blokkades = (record && record.billingBlockers) || [];
    return {
      ready: blokkades.length === 0 && !!(record && record.readyToBill),
      blockers: blokkades.map(b => ({ code: b.code, messageKey: b.messageKey || `blocker.${String(b.code).toLowerCase()}` })),
    };
  }

  return {
    DEFINITION, OFFLINE_MUTATIONS,
    mutationKey, prepareQueue, applyReplayResult, billingReadiness,
  };
});
