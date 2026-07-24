/* ============================================================
   IA-07 · StatusActions (IA handover §7)

   Contract: "Renders server-provided allowed transitions, blockers and
   confirmations."

   D-06 is hier de hele wet: DE BACKEND BEZIT DE STATUSOVERGANGEN. De UI
   rendert wat de server toestaat en verzint niets bij.

   Dat klinkt vanzelfsprekend en is het niet. De klassieke fout is een
   knoppenlijst in de frontend met een eigen if-status-dan-knop-regel.
   Zodra de backend een regel toevoegt - een offerte mag niet meer
   verstuurd worden zonder geldige btw-plicht bijvoorbeeld - loopt die
   lijst achter, en toont de UI een knop die op de API afketst. De
   gebruiker krijgt dan een foutmelding waar hij een uitleg verdient.

   Daarom: geen enkele overgang wordt hier gedefinieerd. Krijgt de UI
   niets, dan toont ze niets.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpShared = root.wfpShared || {}; root.wfpShared.statusActions = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  /**
   * Bouw het knoppenmodel uit het serverantwoord.
   *
   * @param {object} record { status, allowedTransitions:[...], blockers:[...] }
   *   allowedTransitions: [{ action, toStatus, labelKey, requiresConfirmation,
   *                          confirmationKey, destructive }]
   *   blockers:           [{ action, code, messageKey }]
   * @returns {{ status, actions:[...], blocked:[...] }}
   */
  function actionsFor(record) {
    const toegestaan = (record && record.allowedTransitions) || [];
    const blokkades = (record && record.blockers) || [];
    const perActie = new Map();
    for (const b of blokkades) perActie.set(b.action, b);

    const acties = toegestaan.map(t => {
      const blok = perActie.get(t.action) || null;
      return {
        action: t.action,
        toStatus: t.toStatus || null,
        labelKey: t.labelKey || `action.${t.action}`,
        // Een geblokkeerde overgang wordt GETOOND maar staat uit, met de
        // reden erbij. Wegmoffelen laat de gebruiker zoeken naar een knop
        // die er hoort te zijn.
        enabled: !blok,
        blockerCode: blok ? blok.code : null,
        blockerMessageKey: blok ? blok.messageKey : null,
        requiresConfirmation: !!t.requiresConfirmation,
        confirmationKey: t.confirmationKey || (t.destructive ? "confirm.destructive" : null),
        destructive: !!t.destructive,
      };
    });

    // Blokkades zonder bijbehorende overgang zijn losse waarschuwingen:
    // "deze factuur kan niet naar Peppol want het KBO-nummer ontbreekt".
    const losseBlokkades = blokkades
      .filter(b => !toegestaan.some(t => t.action === b.action))
      .map(b => ({ action: b.action, code: b.code, messageKey: b.messageKey }));

    return {
      status: (record && record.status) || null,
      actions: acties,
      blocked: losseBlokkades,
    };
  }

  /**
   * De primaire actie is de eerste UITVOERBARE, niet-destructieve overgang.
   * Zonder uitvoerbare overgang is er geen primaire actie · dan toont het
   * record alleen zijn status.
   */
  function primaryAction(model) {
    return (model.actions || []).find(a => a.enabled && !a.destructive) || null;
  }

  function secondaryActions(model) {
    const primair = primaryAction(model);
    return (model.actions || []).filter(a => a !== primair);
  }

  /**
   * Mag deze actie zonder meer uitgevoerd worden, of eerst bevestigen?
   * Een uitgeschakelde actie mag NOOIT uitgevoerd worden, ook niet wanneer
   * de UI hem per ongeluk klikbaar rendert.
   */
  function guardExecute(model, actionId) {
    const a = (model.actions || []).find(x => x.action === actionId);
    if (!a) return { ok: false, code: "UNKNOWN_TRANSITION" };
    if (!a.enabled) return { ok: false, code: a.blockerCode || "TRANSITION_BLOCKED" };
    if (a.requiresConfirmation) return { ok: true, confirm: a.confirmationKey };
    return { ok: true, confirm: null };
  }

  return { actionsFor, primaryAction, secondaryActions, guardExecute };
});
