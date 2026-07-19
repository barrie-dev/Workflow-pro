"use strict";
/**
 * OpenAI-compatibele AiProvider-adapter (handover 4.5 · F-07).
 *
 * Dekt zowel de publieke OpenAI Chat Completions API als Azure OpenAI: die
 * verschillen enkel in endpoint-opbouw en auth-header, niet in payloadvorm.
 * Alle mapping tussen het INTERNE message-/toolmodel en het aanbiederformaat
 * zit hier, zodat Mona en de estimator er niets van merken.
 *
 * Voorbeelden:
 *   flavor "openai" → https://api.openai.com/v1/chat/completions, Bearer-key
 *   flavor "azure"  → {endpoint}/openai/deployments/{deployment}/chat/completions
 *                     ?api-version=..., header api-key
 *
 * Modelnamen komen uit configuratie (handover 4.5): deze adapter verzint er
 * nooit één en zet er geen business rule op.
 */

const { normalizeRequest, normalizeCompletion } = require("../../ports/ai-provider");

const PLACEHOLDER = /DUMMY|replace[_-]?me|changeme|xxxx/i;
const DEFAULT_TIMEOUT_MS = 30000;

function clean(v) { return String(v == null ? "" : v).trim(); }

/** Interne berichten → OpenAI-compatibel formaat. */
function toProviderMessages(messages) {
  return messages.map(m => {
    const out = { role: m.role, content: m.content };
    if (m.role === "tool") { out.tool_call_id = m.toolCallId; out.name = m.name; }
    if (m.toolCalls && m.toolCalls.length) {
      out.tool_calls = m.toolCalls.map(tc => ({
        id: tc.id, type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments || {}) },
      }));
    }
    return out;
  });
}

/** Interne tools → OpenAI function-tools. */
function toProviderTools(tools) {
  return tools.map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

/** Aanbiederantwoord → uniforme completion. Onleesbare argumenten worden
 *  expliciet als leeg object teruggegeven in plaats van de call te laten crashen. */
function fromProviderResponse(data) {
  const choice = (data && data.choices && data.choices[0]) || {};
  const msg = choice.message || {};
  const toolCalls = (msg.tool_calls || []).map(tc => {
    let args = {};
    try { args = JSON.parse((tc.function && tc.function.arguments) || "{}"); } catch (_) { args = {}; }
    return { id: tc.id, name: (tc.function && tc.function.name) || "", arguments: args };
  });
  return normalizeCompletion({
    content: msg.content || "",
    toolCalls,
    finishReason: toolCalls.length ? "tool_calls" : (choice.finish_reason || "stop"),
    model: data && data.model,
    usage: data && data.usage
      ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens }
      : null,
  });
}

class OpenAiCompatibleProvider {
  /**
   * @param {object} cfg
   * @param {"openai"|"azure"} cfg.flavor
   * @param {string} cfg.apiKey
   * @param {string} [cfg.model]        model (openai) of deployment (azure)
   * @param {string} [cfg.endpoint]     vereist voor azure
   * @param {string} [cfg.apiVersion]   vereist voor azure
   * @param {Function} [cfg.fetchImpl]  injecteerbaar voor tests
   */
  constructor({ flavor = "openai", apiKey = "", model = "", endpoint = "", apiVersion = "", timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = null } = {}) {
    this.name = flavor === "azure" ? "azure-openai" : "openai";
    this.flavor = flavor === "azure" ? "azure" : "openai";
    this.apiKey = clean(apiKey);
    this.model = clean(model);
    this.endpoint = clean(endpoint).replace(/\/+$/, "");
    this.apiVersion = clean(apiVersion) || "2024-10-21";
    this.timeoutMs = Number(timeoutMs) || DEFAULT_TIMEOUT_MS;
    this.fetchImpl = fetchImpl || ((...a) => fetch(...a));
    if (this.flavor === "azure" && !this.endpoint) {
      const e = new Error("Azure OpenAI vereist een endpoint"); e.status = 500; e.code = "ENDPOINT_MISSING"; throw e;
    }
  }

  /** Is er een échte (niet-placeholder) sleutel geconfigureerd? */
  isConfigured() {
    return !!this.apiKey && !PLACEHOLDER.test(this.apiKey);
  }

  requestUrl(model) {
    if (this.flavor === "azure") {
      return `${this.endpoint}/openai/deployments/${encodeURIComponent(model)}/chat/completions?api-version=${encodeURIComponent(this.apiVersion)}`;
    }
    return "https://api.openai.com/v1/chat/completions";
  }

  requestHeaders() {
    return this.flavor === "azure"
      ? { "content-type": "application/json", "api-key": this.apiKey }
      : { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` };
  }

  async complete(request) {
    const req = normalizeRequest(request);
    const model = req.model || this.model;
    if (!model) { const e = new Error("Geen model geconfigureerd voor de AI-aanbieder"); e.status = 500; e.code = "MODEL_MISSING"; throw e; }
    if (!this.isConfigured()) { const e = new Error("Geen geldige AI-sleutel geconfigureerd"); e.status = 503; e.code = "AI_NOT_CONFIGURED"; throw e; }

    const payload = {
      // Azure haalt het model uit de deployment in de URL; meesturen mag maar
      // is overbodig en kan bij sommige versies een fout geven.
      ...(this.flavor === "azure" ? {} : { model }),
      // Forward-compatibel: werkt voor gpt-4o(-mini) én nieuwere modellen.
      max_completion_tokens: req.maxTokens,
      messages: toProviderMessages(req.messages),
    };
    if (req.tools.length) { payload.tools = toProviderTools(req.tools); payload.tool_choice = "auto"; }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.fetchImpl(this.requestUrl(model), {
        method: "POST", headers: this.requestHeaders(), body: JSON.stringify(payload), signal: controller.signal,
      });
    } catch (e) {
      const err = new Error(`Kon de AI-dienst niet bereiken: ${e.message}`);
      err.status = 502; err.code = e.name === "AbortError" ? "AI_TIMEOUT" : "AI_UNREACHABLE";
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // De sleutel mag NOOIT in een foutmelding belanden (handover 4.3).
      const msg = (data && data.error && data.error.message) || `AI-dienst gaf ${res.status}`;
      const err = new Error(msg); err.status = res.status; err.code = "AI_ERROR";
      throw err;
    }
    return fromProviderResponse(data);
  }

  /**
   * Eén ronde met tools. De uitvoering van de tools zelf blijft bij de
   * aanroeper (Mona): consent, confidence en goedkeuring zijn
   * provideronafhankelijk en horen niet in een adapter (handover 4.5).
   */
  async runTools(request) {
    const completion = await this.complete(request);
    return { toolCalls: completion.toolCalls, content: completion.content, finishReason: completion.finishReason, model: completion.model };
  }

  async health() {
    return {
      provider: this.name,
      configured: this.isConfigured(),
      model: this.model || null,
      endpoint: this.flavor === "azure" ? this.endpoint : "https://api.openai.com",
      // Bewust geen sleutel of fragment daarvan.
    };
  }
}

module.exports = { OpenAiCompatibleProvider, toProviderMessages, toProviderTools, fromProviderResponse };
