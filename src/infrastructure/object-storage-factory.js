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
const { S3CompatibleObjectStorage } = require("./s3/object-storage");

function createObjectStorage(overrides = {}) {
  const settings = { ...config.objectStorage, ...overrides };
  const kind = String(settings.adapter || "local").toLowerCase();

  // Productie-guardrail (CTO DEV-05): lokale opslag zet bestanden op de
  // containerdisk · op efemere hosts (Render, Container Apps) verdwijnen ze bij
  // elke herstart. In productie dus geblokkeerd, tenzij een expliciete
  // nood-override (met luide waarschuwing). Zo kan deze misconfiguratie geen
  // stil bestandsverlies meer veroorzaken.
  if (kind === "local" && config.isProduction && !overrides.allowLocal) {
    if (process.env.OBJECT_STORAGE_ALLOW_LOCAL === "true") {
      console.warn("[object-storage] WAARSCHUWING: lokale opslag in PRODUCTIE via OBJECT_STORAGE_ALLOW_LOCAL · bestanden staan op efemere containerdisk en gaan verloren bij herstart.");
    } else {
      const e = new Error(
        "Lokale objectopslag is niet toegestaan in productie (efemere disk = bestandsverlies). " +
        "Zet OBJECT_STORAGE_ADAPTER=s3 of azure-blob, of forceer met OBJECT_STORAGE_ALLOW_LOCAL=true.");
      e.status = 500; e.code = "OBJECT_STORAGE_LOCAL_IN_PROD";
      throw e;
    }
  }

  if (kind === "local") {
    return new LocalObjectStorage({
      basePath: settings.path || path.join(config.root, "data", "files"),
      signingKey: settings.signingKey,
      urlTtlSeconds: settings.urlTtlSeconds,
    });
  }

  // "s3" = het s3-compatibele PROTOCOL, niet één leverancier: hetzelfde
  // contract draait bij elke grote cloud en zelfgehost (MinIO). De aanbieder
  // wisselen is de endpoint-URL wisselen · precies de bedoeling van ADR-001.
  if (kind === "s3" || kind === "s3-compatible") {
    return new S3CompatibleObjectStorage({
      endpoint: settings.endpoint,
      bucket: settings.bucket,
      region: settings.region,
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
      forcePathStyle: settings.forcePathStyle,
      urlTtlSeconds: settings.urlTtlSeconds,
    });
  }

  // Azure Blob (productiekeuze van de eigenaar): zelfde poort, zelfde
  // gedrag, generieke envs hergebruikt (bucket=container, accessKeyId=account,
  // secretAccessKey=accountsleutel). Terug naar s3-compatibel of local is en
  // blijft één configuratiewijziging.
  if (kind === "azure-blob" || kind === "azure") {
    const { AzureBlobObjectStorage } = require("./azure/object-storage");
    return new AzureBlobObjectStorage({
      endpoint: settings.endpoint,
      container: settings.bucket,
      accountName: settings.accessKeyId,
      accountKey: settings.secretAccessKey,
      urlTtlSeconds: settings.urlTtlSeconds,
    });
  }

  const e = new Error(
    `Onbekende objectopslag-adapter '${kind}'. Beschikbaar: local, s3, azure-blob. ` +
    "Elke adapter implementeert exact hetzelfde poortcontract.");
  e.status = 500; e.code = "UNKNOWN_OBJECT_STORAGE_ADAPTER";
  throw e;
}

module.exports = { createObjectStorage };
