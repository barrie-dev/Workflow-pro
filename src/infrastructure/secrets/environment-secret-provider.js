"use strict";
/**
 * EnvironmentSecretProvider (handover 4.3).
 *
 * Leest secrets uit de omgeving. Beschikbaar voor lokaal en CI, en bruikbaar in
 * elke container-omgeving die env-vars injecteert (Kubernetes secrets, Azure
 * Container Apps, Cloud Run, Fly, een .env op een VPS).
 *
 * Rotatie zonder image rebuild: de provider cachet met een TTL en `invalidate()`
 * leegt die. Een platform dat de env-var vervangt en het proces herstart, of een
 * beheerder die invalidate aanroept, ziet de nieuwe waarde zonder nieuwe build.
 *
 * Een Azure Key Vault-adapter (managed identity) implementeert later hetzelfde
 * contract; aanroepende code wijzigt daar niet voor.
 */

const { isPlaceholderSecret, maskSecret, versionOf } = require("../../ports/secret-provider");

const DEFAULT_TTL_MS = 5 * 60 * 1000;

function clean(v) { return String(v == null ? "" : v).trim(); }

class EnvironmentSecretProvider {
  /**
   * @param {object} opts
   * @param {object} [opts.env]         bron (default process.env)
   * @param {number} [opts.ttlMs]       cache-levensduur
   * @param {object} [opts.fallbacks]   standaardwaarden voor dev
   */
  constructor({ env = process.env, ttlMs = DEFAULT_TTL_MS, fallbacks = {} } = {}) {
    this.name = "environment";
    this.env = env;
    this.ttlMs = Number(ttlMs) || DEFAULT_TTL_MS;
    this.fallbacks = fallbacks;
    this.cache = new Map();
  }

  read(name) {
    const key = clean(name);
    if (!key) { const e = new Error("Secretnaam is verplicht"); e.status = 400; e.code = "SECRET_NAME_REQUIRED"; throw e; }
    const raw = this.env[key];
    return raw !== undefined && clean(raw) !== "" ? String(raw) : (this.fallbacks[key] !== undefined ? String(this.fallbacks[key]) : null);
  }

  /**
   * Haal een secret op. `required` maakt een ontbrekende of placeholder-waarde
   * een harde fout: dat is beter dan stilzwijgend met "dev_only_..." draaien in
   * een omgeving met echte klantdata.
   */
  get(name, { required = false } = {}) {
    const key = clean(name);
    const now = Date.now();
    const hit = this.cache.get(key);
    // De cache levert de waarde, maar mag de required-controle NIET overslaan:
    // wie een secret eerst optioneel leest en later verplicht opvraagt, zou
    // anders stilzwijgend een placeholder terugkrijgen.
    const value = hit && hit.expiresAt > now ? hit.value : this.read(key);

    if (required && isPlaceholderSecret(value)) {
      // De naam mag in de fout, de waarde nooit (handover 4.3).
      const e = new Error(`Secret '${key}' ontbreekt of is nog een placeholder`);
      e.status = 500; e.code = "SECRET_MISSING";
      throw e;
    }
    this.cache.set(key, { value, expiresAt: (hit && hit.expiresAt > now) ? hit.expiresAt : now + this.ttlMs });
    return value;
  }

  /**
   * Versie-aanduiding zonder de waarde prijs te geven. Wijzigt de hash, dan is
   * er geroteerd · handig voor een health-endpoint of een rotatie-audit.
   */
  getVersion(name) {
    const value = this.get(name);
    return { name: clean(name), version: versionOf(value), present: !isPlaceholderSecret(value), hint: maskSecret(value) };
  }

  /** Leeg de cache · voor rotatie zonder herstart. */
  invalidate(name = null) {
    if (name) this.cache.delete(clean(name));
    else this.cache.clear();
  }

  /**
   * Overzicht voor ops: welke secrets zijn gezet, zonder één waarde te tonen.
   */
  describe(names = []) {
    return names.map(n => {
      const v = this.get(n);
      return { name: clean(n), present: !isPlaceholderSecret(v), placeholder: !!v && isPlaceholderSecret(v), hint: maskSecret(v), version: versionOf(v) };
    });
  }

  status() {
    return { adapter: this.name, cached: this.cache.size, ttlMs: this.ttlMs };
  }
}

module.exports = { EnvironmentSecretProvider, DEFAULT_TTL_MS };
