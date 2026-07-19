"use strict";
/**
 * Kies de objectopslag-adapter (handover 4.2 · F-08).
 *
 *   OBJECT_STORAGE_ADAPTER=local       → filesystem/volume (draait overal)
 *   OBJECT_STORAGE_ADAPTER=azure-blob  → later, zelfde contract
 *   OBJECT_STORAGE_ADAPTER=s3          → later, zelfde contract
 *
 * De keuze zit HIER, in de infrastructuurlaag. Applicatie- en domeincode kennen
 * alleen de poort, dus een adapterwissel is een configuratiewijziging en geen
 * codewijziging. Een onbekende adapternaam faalt hard bij het opstarten: stil
 * terugvallen op lokale schijf zou in productie data op een verkeerde plek
 * zetten.
 */

const path = require("path");
const { config } = require("../lib/config");
const { LocalObjectStorage } = require("./local/object-storage");

function createObjectStorage(overrides = {}) {
  const settings = { ...config.objectStorage, ...overrides };
  const kind = String(settings.adapter || "local").toLowerCase();

  if (kind === "local") {
    return new LocalObjectStorage({
      basePath: settings.path || path.join(config.root, "data", "files"),
      signingKey: settings.signingKey,
      urlTtlSeconds: settings.urlTtlSeconds,
    });
  }

  const e = new Error(
    `Onbekende objectopslag-adapter '${kind}'. Beschikbaar: local. ` +
    "azure-blob en s3 implementeren hetzelfde contract en worden hier aangesloten zodra ze bestaan.");
  e.status = 500; e.code = "UNKNOWN_OBJECT_STORAGE_ADAPTER";
  throw e;
}

module.exports = { createObjectStorage };
