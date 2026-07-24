/* ============================================================
   IA-22 · Migratietelemetrie en uitfasering (IA handover §7/§8)

   Contract: "Track old/new route use, parity and rollback; retire old
   shell safely."
   Acceptatie: "No old route retirement before 95% migrated usage and
   green parity suite."

   Dit is de enige workstream die iets UITZET, en dus de enige waar een
   fout niet zichtbaar is als een bug maar als "waarom kan ik er niet
   meer bij".

   De regel uit de handover is hard en getalsmatig: geen oude route
   uitzetten voordat 95% van het gebruik gemigreerd is EN de
   pariteitssuite groen staat. Deze module rekent dat uit in plaats van
   het aan een gevoel over te laten, en weigert bij twijfel.

   Twijfel betekent hier ook: te weinig meetgegevens. Een route die deze
   week drie keer gebruikt is en waarvan er twee via de nieuwe weg gingen,
   staat op 67% van een steekproef die niets bewijst.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpRouting = root.wfpRouting || {}; root.wfpRouting.migrationTelemetry = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  // De drempels uit de handover. Ze staan hier één keer, zodat niemand ze
  // per route kan versoepelen.
  const RETIREMENT = {
    minMigratedShare: 0.95,   // 95% van het gebruik loopt via de nieuwe route
    minObservations: 100,     // onder dit aantal is een percentage geen bewijs
    minObservationDays: 14,   // en één drukke dag ook niet
  };

  /**
   * Telemetrie van een redirect vanaf een oude data-view (§11).
   * Draagt de oude en de nieuwe bestemming · geen inhoud, geen record-id.
   */
  function redirectEvent(oldView, targetRoute) {
    return { event: "legacy.redirect", old_view: oldView || null, target_route: targetRoute || null };
  }

  /**
   * Bereken de migratiegraad van één route.
   *
   * @param {object} usage { legacy, modern, firstSeenAt, lastSeenAt }
   * @returns {{ total, migratedShare, observationDays, sufficient }}
   */
  function migrationStatus(usage, now) {
    const legacy = Number(usage && usage.legacy) || 0;
    const modern = Number(usage && usage.modern) || 0;
    const totaal = legacy + modern;
    const start = usage && usage.firstSeenAt ? new Date(usage.firstSeenAt).getTime() : null;
    const nu = new Date(now).getTime();
    const dagen = start && nu ? Math.floor((nu - start) / 86400000) : 0;
    return {
      total: totaal,
      migratedShare: totaal ? modern / totaal : 0,
      observationDays: dagen,
      sufficient: totaal >= RETIREMENT.minObservations && dagen >= RETIREMENT.minObservationDays,
    };
  }

  /**
   * Mag deze oude route uitgezet worden?
   *
   * Fail-closed op elk van de drie voorwaarden, en de reden wordt altijd
   * benoemd · "nee" zonder reden nodigt uit tot forceren.
   */
  function retirementDecision(usage, { parityGreen, now } = {}) {
    const st = migrationStatus(usage, now);
    if (!parityGreen) return { ok: false, code: "PARITY_SUITE_NOT_GREEN", status: st };
    if (!st.sufficient) {
      return {
        ok: false,
        code: st.total < RETIREMENT.minObservations ? "INSUFFICIENT_DATA" : "OBSERVATION_WINDOW_TOO_SHORT",
        status: st,
      };
    }
    if (st.migratedShare < RETIREMENT.minMigratedShare) return { ok: false, code: "USAGE_NOT_MIGRATED", status: st };
    return { ok: true, code: null, status: st };
  }

  /**
   * Beslis over een hele set routes tegelijk. Uitfaseren gebeurt per
   * route, niet per golf: één achterblijver mag de rest niet tegenhouden,
   * en de rest mag die achterblijver niet meesleuren.
   */
  function retirementPlan(usageByRoute, opts = {}) {
    const klaar = [], wacht = [];
    for (const [routeId, usage] of Object.entries(usageByRoute || {})) {
      const d = retirementDecision(usage, opts);
      (d.ok ? klaar : wacht).push({ routeId, ...d });
    }
    klaar.sort((a, b) => a.routeId.localeCompare(b.routeId));
    wacht.sort((a, b) => b.status.migratedShare - a.status.migratedShare || a.routeId.localeCompare(b.routeId));
    return { retire: klaar, keep: wacht };
  }

  /**
   * De terugvaloptie moet BESTAAN en aantoonbaar zijn voor je iets uitzet.
   * Een uitfasering zonder werkende terugweg is geen migratie maar een
   * sprong.
   */
  function checkRollback(plan) {
    const overtredingen = [];
    if (!plan || !plan.flag) overtredingen.push({ field: "flag", reason: "NO_ROLLBACK_SWITCH" });
    if (!plan || !plan.verifiedAt) overtredingen.push({ field: "verifiedAt", reason: "ROLLBACK_NEVER_TESTED" });
    if (plan && plan.flag && plan.currentValue === undefined) {
      overtredingen.push({ field: "currentValue", reason: "SWITCH_STATE_UNKNOWN" });
    }
    return { ok: overtredingen.length === 0, violations: overtredingen };
  }

  return { RETIREMENT, redirectEvent, migrationStatus, retirementDecision, retirementPlan, checkRollback };
});
