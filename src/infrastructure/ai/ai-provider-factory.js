"use strict";
/**
 * Kies de AI-adapter (handover 4.5 · F-07).
 *
 *   AI_PROVIDER=openai  → publieke OpenAI API
 *   AI_PROVIDER=azure   → Azure OpenAI (endpoint + deployment)
 *   AI_PROVIDER=mock    → geen netwerk, deterministisch (dev/CI/demo)
 *
 * De sleutel en het model komen bij voorkeur uit de platform-config (die de
 * super-admin in de Integraties-console beheert) en anders uit de omgeving.
 * Zonder geldige sleutel valt de factory terug op de mock-adapter, zodat de app
 * altijd werkt in plaats van te crashen · maar dat is een expliciete adapter,
 * geen verborgen if-tak in de businesscode.
 */

const { config } = require("../../lib/config");
const { OpenAiCompatibleProvider } = require("./openai-adapter");
const { MockAiProvider } = require("./mock-provider");

const PLACEHOLDER = /DUMMY|replace[_-]?me|changeme|xxxx/i;

function clean(v) { return String(v == null ? "" : v).trim(); }
function hasRealKey(key) { return !!clean(key) && !PLACEHOLDER.test(clean(key)); }

/**
 * @param {object} platformAi  opgeslagen AI-config (platform-config → openai)
 * @param {object} overrides   expliciete waarden (tests)
 */
function createAiProvider(platformAi = {}, overrides = {}) {
  const settings = {
    provider: clean(overrides.provider || platformAi.provider || config.ai.provider),
    apiKey: clean(overrides.apiKey || platformAi.apiKey || config.ai.apiKey),
    model: clean(overrides.model || platformAi.model || config.ai.model),
    endpoint: clean(overrides.endpoint || platformAi.endpoint || config.ai.endpoint),
    apiVersion: clean(overrides.apiVersion || platformAi.apiVersion || config.ai.apiVersion),
  };

  if (settings.provider === "mock" || !hasRealKey(settings.apiKey)) {
    return new MockAiProvider({ model: settings.model || "mock-model" });
  }
  if (settings.provider === "azure") {
    return new OpenAiCompatibleProvider({
      flavor: "azure", apiKey: settings.apiKey, model: settings.model,
      endpoint: settings.endpoint, apiVersion: settings.apiVersion,
    });
  }
  return new OpenAiCompatibleProvider({ flavor: "openai", apiKey: settings.apiKey, model: settings.model });
}

module.exports = { createAiProvider, hasRealKey };
