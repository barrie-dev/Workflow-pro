"use strict";

// ── Startup/health-routes (CTO3-10 increment 2) ──────────────────────────────
// De spec schrijft voor: extraheer EERST startup/health, zonder gedragswijziging.
// Deze router levert byte-identieke responses aan de vorige inline-afhandeling.
//
// Belangrijk: dit is het pad NA de bootgate. Zolang de staat nog niet 'ready' is,
// onderschept de bootgate in server.js /api/health, /api/live en /api/ready al
// eerder (liveness 200, readiness 503). Die gate blijft bewust in server.js ·
// hij moet vóór elke router draaien.
//
// Muteerbare bootstate (bootState, migratieversie) en laat-geïnitialiseerde
// modules komen via GETTERS binnen: ctx wordt bij het opstarten gebouwd, dus een
// waarde meegeven zou een momentopname bevriezen.

module.exports = (ctx) => {
  const live = (req, res) => {
    ctx.sendJson(res, 200, {
      ok: true, app: "Monargo One Fullstack", status: ctx.getBootState(),
      appEnv: ctx.config.appEnv, version: ctx.config.appVersion,
      commitSha: ctx.config.commitSha, deploymentId: ctx.config.deploymentId,
      uptime: Math.floor(process.uptime()),
    });
  };

  const health = (req, res) => {
    const storeStatus = ctx.store.storageStatus ? ctx.store.storageStatus() : { ok: true };
    ctx.sendJson(res, 200, {
      ok: true,
      app: "Monargo One Fullstack",
      status: ctx.getBootState(),
      deploymentId: ctx.config.deploymentId,
      appEnv: ctx.config.appEnv,
      version: ctx.config.appVersion,
      releaseChannel: ctx.config.releaseChannel,
      commitSha: ctx.config.commitSha,
      storageAdapter: ctx.config.storageAdapter,
      // Unit-of-work-adapter (E1 · ADR-003): op PostgreSQL de echte
      // database-transactie (P0-01), anders de lokale store-variant.
      txAdapter: ctx.getTxAdapter(),
      objectStorageAdapter: ctx.getObjectStorage().name,
      identitySource: ctx.getSourceModes().identity,   // P0-01-migratiestand
      financeSource: ctx.getSourceModes().finance,
      companySource: ctx.getSourceModes().company,
      storeReady: storeStatus?.ok !== false,
      modules: ctx.getModuleCount(),
      uptime: Math.floor(process.uptime()),
      time: new Date().toISOString(),
    });
  };

  // CTO3-02 · READINESS. Alleen bereikt wanneer de bootgate al open is. Een
  // runtime-storagefout maakt de instantie alsnog NIET-ready (503) zodat een
  // orchestrator ze uit rotatie haalt. Readiness bepaalt of businessverkeer
  // wordt toegelaten; de respons is machineleesbaar en SHA-gekoppeld.
  const ready = (req, res) => {
    const c = ctx.config;
    const storeStatus = ctx.store.storageStatus ? ctx.store.storageStatus() : { ok: true };
    const isReady = ctx.isBootReady() && storeStatus?.ok !== false;
    ctx.sendJson(res, isReady ? 200 : 503, {
      ok: isReady,
      status: ctx.getBootState(),
      commitSha: c.commitSha,
      deploymentId: c.deploymentId,
      checks: {
        state: ctx.isBootReady(),        // staat geladen + bootflush geslaagd
        storage: storeStatus?.ok !== false,
        storageAdapter: c.storageAdapter,
        objectStorageAdapter: ctx.getObjectStorage().name,
        txAdapter: ctx.getTxAdapter(),
        databaseSslMode: c.database.sslMode,
        // Openstaande schrijfacties: een orchestrator kan hierop wachten vóór
        // hij een replica uit rotatie haalt.
        pendingWrites: ctx.store.isDirty(),
        // CTO3-05 · veilige config-samenvatting (NOOIT secrets): bronstatus per
        // domein, TLS/single-writer-modus, release-kanaal en migratieversie.
        releaseChannel: c.releaseChannel,
        singleWriter: !!c.singleWriter,
        databaseCaCertPresent: !!(c.database && c.database.caCert),
        migrationVersion: ctx.getBootMigrationVersion(),
        sources: {
          crm: c.crm.readSource,
          identity: c.identity.readSource,
          finance: c.finance.readSource,
          company: c.company.readSource,
          forms: c.forms.source,
        },
      },
      store: storeStatus,
    });
  };

  // method "*": deze drie antwoordden vóór de extractie op ELKE methode (er
  // stond geen req.method-check in server.js). Dat blijft exact zo · een
  // orchestrator die HEAD of POST probeert krijgt dezelfde respons als voorheen.
  return [
    { method: "*", path: "/api/live", handler: live },
    { method: "*", path: "/api/health", handler: health },
    { method: "*", path: "/api/ready", handler: ready },
  ];
};
