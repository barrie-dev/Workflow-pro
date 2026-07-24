/* ============================================================
   IA-04 · Work Inbox-model (IA handover §7/§8)

   Contract: "Unified approvals/tasks/exceptions with SLA, due date,
   assignee and resolution."
   Acceptatie: "Counts reconcile; action resolves source record; no
   duplicate item."

   D-05 is het besluit dat dit bestand bestaat: Work Inbox, Messages en
   Notifications zijn DRIE capabilities, geen drie tabbladen van één
   lijst. Een melding is geen werk. Een bericht is geen werk. Alleen
   iets dat op JOU wacht en dat JIJ kunt afsluiten is werk.

   Drie werksoorten:
     approval   iemand wacht op jouw ja of nee
     task       jij moet iets doen
     exception  er is iets misgelopen dat aandacht vraagt

   Twee eigenschappen die de handover expliciet eist en die vandaag
   ontbreken: tellingen die kloppen met wat je ziet, en geen dubbels
   wanneer twee bronnen naar hetzelfde record wijzen.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpShell = root.wfpShell || {}; root.wfpShell.workInbox = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  // Wat WEL werk is. Alles daarbuiten hoort in Notifications of Messages.
  const WORK_KINDS = ["approval", "task", "exception"];
  // Stromen die naast de Work Inbox staan · nooit erin (D-05).
  const OTHER_STREAMS = ["notification", "message"];

  const PRIORITY_RANK = { critical: 3, high: 2, normal: 1, low: 0 };
  const OPEN_STATES = ["open", "in_progress"];

  const DAY_MS = 86400000;

  function num(v) { return Number.isFinite(Number(v)) ? Number(v) : 0; }
  function ts(v) { const d = v ? new Date(v) : null; return d && !isNaN(d.getTime()) ? d.getTime() : null; }

  /**
   * Normaliseer één ruw item naar het canonieke model.
   * Een item zonder bron is onbruikbaar: je kunt er niet naartoe en het
   * kan niet ontdubbeld worden. Zulke items worden geweigerd (null).
   */
  function normalize(raw) {
    if (!raw || !raw.sourceType || !raw.sourceId) return null;
    const kind = WORK_KINDS.includes(raw.kind) ? raw.kind
      : OTHER_STREAMS.includes(raw.kind) ? raw.kind : null;
    if (!kind) return null;
    return {
      // De identiteit is de BRON, niet een toevallige rij-id. Twee melders
      // van hetzelfde feit leveren dus hetzelfde item.
      id: `${raw.sourceType}:${raw.sourceId}:${raw.actionType || kind}`,
      kind,
      sourceType: String(raw.sourceType),
      sourceId: String(raw.sourceId),
      actionType: raw.actionType || null,
      routeId: raw.routeId || null,
      route: raw.route || null,
      priority: PRIORITY_RANK[raw.priority] !== undefined ? raw.priority : "normal",
      titleKey: raw.titleKey || null,
      context: raw.context || "",
      dueAt: raw.dueAt || null,
      slaAt: raw.slaAt || null,
      assigneeId: raw.assigneeId || null,
      state: OPEN_STATES.includes(raw.state) || raw.state === "resolved" ? raw.state : "open",
      resolution: raw.resolution || null,
      createdAt: raw.createdAt || null,
    };
  }

  /**
   * Ontdubbel op bron. Wanneer twee bronnen hetzelfde feit melden - een
   * Mona-signal en een achterstallige-werkbon-scan bijvoorbeeld - wint het
   * item met de hoogste prioriteit, en anders het eerste.
   */
  function dedupe(items) {
    const perBron = new Map();
    for (const i of items) {
      const bestaand = perBron.get(i.id);
      if (!bestaand) { perBron.set(i.id, i); continue; }
      if ((PRIORITY_RANK[i.priority] || 0) > (PRIORITY_RANK[bestaand.priority] || 0)) perBron.set(i.id, i);
    }
    return [...perBron.values()];
  }

  /**
   * Splits de binnenkomende stroom in de drie capabilities (D-05).
   * Meldingen en berichten verlaten de Work Inbox hier definitief.
   */
  function partition(rawItems) {
    const genormaliseerd = (rawItems || []).map(normalize).filter(Boolean);
    const werk = dedupe(genormaliseerd.filter(i => WORK_KINDS.includes(i.kind)));
    return {
      work: sorted(werk),
      notifications: genormaliseerd.filter(i => i.kind === "notification"),
      messages: genormaliseerd.filter(i => i.kind === "message"),
    };
  }

  function sorted(items) {
    return items.slice().sort((a, b) =>
      (PRIORITY_RANK[b.priority] || 0) - (PRIORITY_RANK[a.priority] || 0)
      || (ts(a.dueAt) || Infinity) - (ts(b.dueAt) || Infinity)
      || a.id.localeCompare(b.id));
  }

  /**
   * Tellingen die KLOPPEN met wat er getoond wordt.
   *
   * Dit is de acceptatie-eis "counts reconcile". De klassieke fout is een
   * badge tellen over de volledige verzameling en daarna afkappen voor de
   * lijst · dan zegt de badge 120 en toont het scherm er 80. Daarom telt
   * deze functie ALTIJD over precies de items die ze meekrijgt, en draagt
   * de uitvoer expliciet hoeveel er is afgekapt.
   */
  function counts(items, o = {}) {
    const zichtbaar = o.limit ? items.slice(0, o.limit) : items;
    const uit = { total: zichtbaar.length, byKind: {}, byPriority: {}, overdue: 0, unassigned: 0 };
    const nu = ts(o.now) || 0;
    for (const i of zichtbaar) {
      uit.byKind[i.kind] = (uit.byKind[i.kind] || 0) + 1;
      uit.byPriority[i.priority] = (uit.byPriority[i.priority] || 0) + 1;
      const due = ts(i.dueAt);
      if (nu && due && due < nu && i.state !== "resolved") uit.overdue += 1;
      if (!i.assigneeId) uit.unassigned += 1;
    }
    uit.truncated = items.length - zichtbaar.length;
    return uit;
  }

  /**
   * De actie moet naar het BRONRECORD leiden, niet naar een lijst waar je
   * het zelf mag terugzoeken (acceptatie: "action resolves source record").
   */
  function resolveTarget(item) {
    if (!item) return null;
    if (item.route) return item.route;
    return null;
  }

  /** SLA-status. Zonder slaAt is er geen belofte en dus geen overschrijding. */
  function slaState(item, now) {
    const nu = ts(now);
    const sla = ts(item && item.slaAt);
    if (!nu || !sla) return { state: "none", hoursLeft: null };
    const uren = Math.round((sla - nu) / 3600000);
    if (item.state === "resolved") return { state: "met", hoursLeft: uren };
    if (uren < 0) return { state: "breached", hoursLeft: uren };
    if (uren <= 24) return { state: "at_risk", hoursLeft: uren };
    return { state: "on_track", hoursLeft: uren };
  }

  /**
   * Telemetrie bij afsluiten (§11 · work_inbox.resolve).
   * Draagt soort, bron, leeftijd in dagen en uitkomst · geen inhoud.
   */
  function resolveTelemetry(item, o = {}) {
    const gemaakt = ts(item && item.createdAt);
    const nu = ts(o.now);
    return {
      event: "work_inbox.resolve",
      item_type: (item && item.kind) || null,
      source_type: (item && item.sourceType) || null,
      age: gemaakt && nu ? Math.max(0, Math.round((nu - gemaakt) / DAY_MS)) : null,
      outcome: o.outcome || null,
    };
  }

  return {
    WORK_KINDS, OTHER_STREAMS, PRIORITY_RANK,
    normalize, dedupe, partition, counts, resolveTarget, slaState, resolveTelemetry, sorted,
  };
});
