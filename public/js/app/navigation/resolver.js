/* ============================================================
   IA-01 · Navigatieresolver (Information Architecture handover §5)

   Zet de registry om in de menuboom die DEZE gebruiker mag zien.
   De uitkomst is DETERMINISTISCH voor dezelfde gebruiker, tenant,
   juridische entiteit, entitlements en feature flags.

   Grondregels uit §5:
     - een onbekend recht of entitlement faalt DICHT (verbergen,
       nooit "bij twijfel tonen");
     - lege primaire groepen verdwijnen NA het filteren;
     - ids zijn de identifiers voor analytics en tests, labels niet;
     - de sortering ligt vast op `order`, met de id als tie-break
       zodat de volgorde nooit van objectvolgorde afhangt.

   Sectorprofielen wijzigen alleen zichtbaarheid (D-10), nooit de
   structuur · er is geen productfork per sector.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpNav = root.wfpNav || {}; root.wfpNav.resolver = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const asSet = (v) => new Set(Array.isArray(v) ? v : (v instanceof Set ? [...v] : []));

  /**
   * Mag deze gebruiker dit item zien? Fail-closed op elk onderdeel.
   * Een item zonder eisen is zichtbaar; een item met eisen alleen wanneer
   * ALLE eisen aantoonbaar vervuld zijn.
   */
  function allowed(entry, ctx) {
    const rights = ctx.permissions;
    const ents = ctx.entitlements;
    const flags = ctx.featureFlags;

    // Rechten: elk vereist recht moet aanwezig zijn. Wildcard "*" mag alles.
    const need = Array.isArray(entry.permissions) ? entry.permissions : (entry.permissions ? [entry.permissions] : []);
    if (need.length && !rights.has("*")) {
      for (const p of need) if (!rights.has(p)) return false;
    }
    // Entitlement: de module moet in het pakket zitten.
    if (entry.entitlement && !ents.has(entry.entitlement)) return false;
    // Feature flag: alleen zichtbaar wanneer expliciet aan.
    if (entry.featureFlag && !flags.has(entry.featureFlag)) return false;
    // Sectorprofiel: beperkt de lijst enkel wanneer het item er een noemt.
    if (Array.isArray(entry.sectorProfiles) && entry.sectorProfiles.length) {
      if (!ctx.sectorProfile || !entry.sectorProfiles.includes(ctx.sectorProfile)) return false;
    }
    return true;
  }

  function inPortal(entry, portal) {
    const ports = Array.isArray(entry.portal) ? entry.portal : (entry.portal ? [entry.portal] : []);
    return ports.includes(portal);
  }

  // Vaste sortering: order, dan id. Nooit afhankelijk van de arrayvolgorde.
  function sorted(list) {
    return list.slice().sort((a, b) => (a.order - b.order) || String(a.id).localeCompare(String(b.id)));
  }

  /**
   * Los de navigatie op voor een gebruiker.
   * @param {Array}  entries  registry (ENTRIES)
   * @param {object} ctx      { portal, permissions, entitlements, featureFlags,
   *                            sectorProfile, mobile }
   * @returns {Array} boom van maximaal twee niveaus, zichtbaar en gesorteerd
   */
  function resolve(entries, ctx = {}) {
    const c = {
      portal: ctx.portal || null,
      permissions: asSet(ctx.permissions),
      entitlements: asSet(ctx.entitlements),
      featureFlags: asSet(ctx.featureFlags),
      sectorProfile: ctx.sectorProfile || null,
      mobile: ctx.mobile === true,
    };
    if (!c.portal) return [];   // zonder portaal geen menu · fail-closed

    const out = [];
    for (const entry of entries || []) {
      if (!inPortal(entry, c.portal)) continue;
      if (!allowed(entry, c)) continue;
      // Op mobiel valt alles weg wat expliciet verborgen is (§5 mobilePriority).
      if (c.mobile && entry.mobilePriority === "hidden") continue;

      const children = sorted((entry.children || [])
        // Een child erft het portaal van zijn ouder en wordt zelfstandig op
        // rechten/entitlement/flag getoetst.
        .filter(ch => allowed(ch, c)));

      // Lege primaire groep: een domein zonder eigen pad EN zonder zichtbare
      // kinderen verdwijnt volledig (§5 "empty primary groups are removed").
      if (!children.length && !entry.path) continue;

      out.push({
        id: entry.id,
        path: entry.path,
        recordPath: entry.recordPath || null,
        labelKey: entry.labelKey,
        icon: entry.icon || null,
        mobilePriority: entry.mobilePriority || "more",
        order: entry.order,
        badgeSource: entry.badgeSource || null,
        createActions: entry.createActions || [],
        children: children.map(ch => ({
          id: ch.id, path: ch.path, labelKey: ch.labelKey, order: ch.order,
          badgeSource: ch.badgeSource || null,
        })),
      });
    }
    return sorted(out);
  }

  /** Platte lijst van alle zichtbare paden · voedt sitemap en command palette. */
  function flatten(tree) {
    const rows = [];
    for (const d of tree || []) {
      rows.push({ id: d.id, path: d.path, labelKey: d.labelKey, parentId: null });
      for (const ch of d.children || []) rows.push({ id: ch.id, path: ch.path, labelKey: ch.labelKey, parentId: d.id });
    }
    return rows;
  }

  /** Breadcrumb-pad naar een id toe (maximaal twee niveaus). */
  function breadcrumb(tree, id) {
    for (const d of tree || []) {
      if (d.id === id) return [d];
      for (const ch of d.children || []) if (ch.id === id) return [d, ch];
    }
    return [];
  }

  return { resolve, flatten, breadcrumb, allowed, sorted };
});
