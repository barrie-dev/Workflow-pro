/* ============================================================
   IA-16 · Automation-domein (IA handover §7/§8)

   Contract: "Forms, workflows, tenant integrations, API/webhooks and
   custom fields."
   Acceptatie: "Provider-global settings excluded; connector health and
   mappings tenant-scoped."

   Dit domein heeft een grens die makkelijk vervaagt, want beide kanten
   heten "integratie-instellingen".

     TENANT       · mijn koppeling met Robaws staat aan, deze velden zijn
                    op elkaar afgebeeld, de laatste synchronisatie faalde
                    om 4u12 met deze fout, mijn API-sleutel.
     PLATFORM     · welke Peppol-provider gebruiken we, wat is de globale
                    endpoint, welk contract hebben we, welke sleutel geldt
                    voor ALLE tenants.

   Als een tenant de tweede categorie kan zien of wijzigen, kan hij de
   koppeling van andere tenants beïnvloeden · en ziet hij bovendien onze
   leverancierskeuze en tarieven. Deze module houdt die twee uit elkaar.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpWorkspaces = root.wfpWorkspaces || {}; root.wfpWorkspaces.automation = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const DEFINITION = {
    id: "automation.integrations",
    recordBase: "/app/automation/integrations",
    idParam: "integrationId",
    defaultTab: "overview",
    tabs: [
      { id: "overview", labelKey: "integration.tab.overview", permission: "integrations.view" },
      { id: "mapping", labelKey: "integration.tab.mapping", permission: "integrations.manage" },
      { id: "health", labelKey: "integration.tab.health", permission: "integrations.view", countSource: "integration.errors" },
      { id: "runs", labelKey: "integration.tab.runs", permission: "integrations.view", countSource: "integration.runs" },
      { id: "credentials", labelKey: "integration.tab.credentials", permission: "integrations.manage" },
      { id: "activity", labelKey: "integration.tab.activity", permission: "integrations.view" },
    ],
  };

  /**
   * Instellingen die PLATFORMBREED zijn. Een tenant mag ze niet zien en
   * al helemaal niet wijzigen · ze gelden voor iedereen.
   */
  const PROVIDER_GLOBAL_SETTINGS = [
    "providerName", "providerEndpoint", "providerApiKey", "providerContractRef",
    "providerTariff", "providerUnitCost", "providerAccountId", "globalRateLimit",
    "providerCertificate", "platformWebhookSecret",
  ];

  /** Instellingen die per tenant leven en die de tenant zelf beheert. */
  const TENANT_SCOPED_SETTINGS = [
    "enabled", "fieldMapping", "syncSchedule", "syncDirection", "lastSyncAt",
    "lastSyncStatus", "errorCount", "tenantApiKeyId", "webhookUrl", "filters",
  ];

  function isSuperAdmin(ctx) {
    return !!(ctx && (ctx.portal === "super-admin" || ctx.role === "super_admin"));
  }

  /**
   * Projecteer een integratieconfiguratie naar wat deze kijker mag zien.
   * Platformvelden worden weggelaten, niet genuld: een leeg
   * providerEndpoint verraadt nog steeds dat er een provider tussen zit
   * en hoe het veld heet.
   */
  function projectSettings(config, ctx) {
    if (isSuperAdmin(ctx)) return { ...(config || {}) };
    const verboden = new Set(PROVIDER_GLOBAL_SETTINGS);
    const uit = {};
    for (const [k, v] of Object.entries(config || {})) if (!verboden.has(k)) uit[k] = v;
    return uit;
  }

  /**
   * Mag deze gebruiker dit veld wijzigen?
   * Een platformveld wijzigen raakt ALLE tenants · daarom is dit een
   * harde weigering met een eigen code, geen generieke 403.
   */
  function canEditSetting(field, ctx) {
    if (PROVIDER_GLOBAL_SETTINGS.includes(field)) {
      return isSuperAdmin(ctx)
        ? { ok: true, code: null }
        : { ok: false, code: "PLATFORM_SCOPED_SETTING" };
    }
    if (!TENANT_SCOPED_SETTINGS.includes(field)) return { ok: false, code: "UNKNOWN_SETTING" };
    const p = (ctx && ctx.permissions) || [];
    return p.includes("*") || p.includes("integrations.manage")
      ? { ok: true, code: null }
      : { ok: false, code: "NO_MANAGE_RIGHT" };
  }

  /**
   * De gezondheidsweergave van een koppeling · TENANT-GESCOPED.
   *
   * De tenant ziet zijn eigen synchronisaties en zijn eigen fouten. Hij
   * ziet nooit hoeveel andere tenants dezelfde connector gebruiken of hoe
   * die het doen: dat is bedrijfsinformatie van het platform.
   */
  function health(config, ctx) {
    const zichtbaar = projectSettings(config, ctx);
    const fouten = zichtbaar.errorCount || 0;
    const status = !zichtbaar.enabled ? "disabled"
      : zichtbaar.lastSyncStatus === "error" ? "failing"
        : fouten > 0 ? "degraded"
          : zichtbaar.lastSyncAt ? "healthy" : "never_run";
    return {
      status,
      lastSyncAt: zichtbaar.lastSyncAt || null,
      errorCount: fouten,
      // Een fout zonder eerstvolgende stap laat de klant bellen.
      actionKey: status === "failing" ? "integration.action.check_credentials"
        : status === "degraded" ? "integration.action.review_errors" : null,
    };
  }

  /**
   * Een veldafbeelding is tenant-eigen en moet volledig zijn: elk verplicht
   * doelveld heeft een bron. Een halve afbeelding levert stille datafouten
   * op die pas bij de klant van de klant opduiken.
   */
  function checkMapping(mapping, requiredTargets) {
    const gemapt = new Set(Object.keys(mapping || {}));
    const ontbreekt = (requiredTargets || []).filter(t => !gemapt.has(t) || !mapping[t]);
    // Twee doelvelden uit dezelfde bron is meestal een kopieerfout.
    const perBron = {};
    for (const [doel, bron] of Object.entries(mapping || {})) {
      if (!bron) continue;
      (perBron[bron] = perBron[bron] || []).push(doel);
    }
    const dubbel = Object.entries(perBron).filter(([, doelen]) => doelen.length > 1)
      .map(([bron, doelen]) => ({ source: bron, targets: doelen.sort() }));
    return { ok: ontbreekt.length === 0, missing: ontbreekt, duplicates: dubbel };
  }

  return {
    DEFINITION, PROVIDER_GLOBAL_SETTINGS, TENANT_SCOPED_SETTINGS,
    isSuperAdmin, projectSettings, canEditSetting, health, checkMapping,
  };
});
