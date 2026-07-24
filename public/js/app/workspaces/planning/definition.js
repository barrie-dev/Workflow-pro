/* ============================================================
   IA-10 · Planningwerkruimte (IA handover §7/§8)

   Contract: "Appointments, shifts, availability, conflicts and
   unassigned demand."
   Acceptatie: "Server validation; route-backed filters; mobile
   read/write parity."

   Drie regels.

   1. DE SERVER VALIDEERT. De planning kent conflicten die de browser
      niet kan zien: verlof dat net is goedgekeurd, een collega die op
      een andere werf staat, een certificaat dat gisteren verliep. Deze
      module DETECTEERT conflicten voor snelle feedback, maar ze
      BESLIST niets · opslaan gaat altijd langs de server, en die kan
      weigeren met redenen die de browser niet kende.

   2. FILTERS ZITTEN IN DE URL. Een planner die zijn week filtert op
      een ploeg en een werf, moet die weergave kunnen doorsturen. Staat
      de filter alleen in het geheugen, dan krijgt de collega een lege
      agenda te zien en begint het gesprek met "welke week bedoel je".

   3. MOBIEL LEEST EN SCHRIJFT. Een monteur op de baan mag niet in een
      alleen-lezen versie belanden. Wat je op desktop mag, mag je op
      mobiel · alleen de vorm verschilt (D-12).
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpWorkspaces = root.wfpWorkspaces || {}; root.wfpWorkspaces.planning = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const DEFINITION = {
    id: "planning",
    recordBase: "/app/planning/appointments",
    idParam: "appointmentId",
    defaultTab: "overview",
    tabs: [
      { id: "overview", labelKey: "planning.tab.overview", permission: "planning.view" },
      { id: "assignees", labelKey: "planning.tab.assignees", permission: "planning.view", countSource: "appointment.assignees" },
      { id: "materials", labelKey: "planning.tab.materials", permission: "inventory.view", entitlement: "inventory" },
      { id: "activity", labelKey: "planning.tab.activity", permission: "planning.view" },
    ],
  };

  // De filters die de planningweergave kent. Vaste volgorde in de URL, zodat
  // dezelfde weergave altijd dezelfde link oplevert (zelfde regel als IA-02).
  const FILTER_KEYS = ["view", "from", "to", "crew", "employee", "worksite", "project", "status", "unassigned"];
  const VIEWS = ["day", "week", "month", "list", "map"];

  /**
   * Serialiseer de planningtoestand naar een deelbare URL.
   * Lege waarden verdwijnen · geen ?crew=&status=
   */
  function buildFilterQuery(filters = {}) {
    const paren = FILTER_KEYS
      .filter(k => filters[k] !== undefined && filters[k] !== null && filters[k] !== "" && filters[k] !== false)
      .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(filters[k])}`);
    return paren.length ? `?${paren.join("&")}` : "";
  }

  /** Lees de planningtoestand terug uit de URL. Onbekende sleutels vervallen. */
  function parseFilterQuery(query = {}) {
    const uit = {};
    for (const k of FILTER_KEYS) {
      if (query[k] === undefined || query[k] === "") continue;
      uit[k] = k === "unassigned" ? query[k] === "true" || query[k] === true : query[k];
    }
    if (uit.view && !VIEWS.includes(uit.view)) delete uit.view;
    return uit;
  }

  /**
   * Detecteer conflicten voor SNELLE FEEDBACK. Dit is nadrukkelijk geen
   * autorisatie en geen eindoordeel: de server ziet meer.
   *
   * @returns {Array} [{ code, employeeId, with }]
   */
  function detectConflicts(kandidaat, context = {}) {
    const conflicten = [];
    const start = new Date(kandidaat.start).getTime();
    const eind = new Date(kandidaat.end).getTime();
    if (!(start < eind)) return [{ code: "INVALID_RANGE" }];

    for (const id of kandidaat.assigneeIds || []) {
      for (const b of (context.bookings || [])) {
        if (b.id === kandidaat.id) continue;
        if (!(b.assigneeIds || []).includes(id)) continue;
        const bs = new Date(b.start).getTime(), be = new Date(b.end).getTime();
        if (start < be && bs < eind) conflicten.push({ code: "DOUBLE_BOOKED", employeeId: id, with: b.id });
      }
      for (const l of (context.leaves || [])) {
        if (l.employeeId !== id) continue;
        const ls = new Date(l.from).getTime(), le = new Date(l.to).getTime();
        if (start <= le && ls <= eind) conflicten.push({ code: "ON_LEAVE", employeeId: id, with: l.id });
      }
      const a = (context.availability || {})[id];
      if (a && a.availableFrom && start < new Date(a.availableFrom).getTime()) {
        conflicten.push({ code: "NOT_AVAILABLE", employeeId: id });
      }
    }
    return conflicten;
  }

  /**
   * Mag dit opgeslagen worden?
   *
   * Deze functie geeft NOOIT groen licht namens de server. Ze geeft aan of
   * de browser al iets ziet dat sowieso fout is, en of de gebruiker een
   * bevestiging moet krijgen. Het echte oordeel komt van de API · vandaar
   * `serverMustValidate`, dat altijd waar is.
   */
  function submitDecision(kandidaat, context = {}) {
    const conflicten = detectConflicts(kandidaat, context);
    const hard = conflicten.filter(c => c.code === "INVALID_RANGE");
    return {
      blocked: hard.length > 0,
      conflicts: conflicten,
      // Overboeking en verlof mogen bewust overruled worden · met bevestiging.
      requiresConfirmation: hard.length === 0 && conflicten.length > 0,
      serverMustValidate: true,
    };
  }

  /**
   * Wat mag deze gebruiker op MOBIEL? Precies hetzelfde als op desktop.
   * Deze functie bestaat om die pariteit toetsbaar te maken: geeft ze ooit
   * een kleinere verzameling terug voor mobiel, dan faalt de test.
   */
  function capabilities(ctx = {}) {
    const p = ctx.permissions || [];
    const heeft = k => p.includes("*") || p.includes(k);
    return {
      view: heeft("planning.view"),
      create: heeft("planning.create"),
      reschedule: heeft("planning.update"),
      assign: heeft("planning.assign") || heeft("planning.update"),
      cancel: heeft("planning.delete"),
    };
  }

  return {
    DEFINITION, FILTER_KEYS, VIEWS,
    buildFilterQuery, parseFilterQuery, detectConflicts, submitDecision, capabilities,
  };
});
