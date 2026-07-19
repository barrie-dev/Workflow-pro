"use strict";
/**
 * AiProvider-PORT (handover 4.5 · F-07).
 *
 * Mona en de estimator praten met een INTERN message- en toolmodel. De vertaling
 * naar het formaat van een concrete aanbieder zit in de adapter, niet in de
 * business rules. Zo wisselt de aanbieder zonder dat er één domeinregel wijzigt.
 *
 * Contract (handover 4.5):
 *   complete(request)   → AiCompletion
 *   runTools(request)   → AiToolResult
 *   health()            → ProviderHealth
 *
 * Regels uit de handover:
 *  - Modelnamen staan in CONFIGURATIE, nooit in business rules.
 *  - Consent, logging, confidence en action approval zijn provideronafhankelijk
 *    en blijven in de Mona-laag; een adapter beslist daar nooit over.
 *  - De poort is cloudblind: geen SDK, geen endpoint, geen sleutels hier.
 */

const ROLES = ["system", "user", "assistant", "tool"];
const FINISH_REASONS = ["stop", "length", "tool_calls", "content_filter", "error"];

function clean(v) { return String(v == null ? "" : v).trim(); }

/**
 * Interne berichtvorm. Bewust minimaal en aanbieder-neutraal: elke adapter kan
 * dit naar zijn eigen payload mappen zonder informatieverlies.
 */
function normalizeMessage(m) {
  const role = ROLES.includes(m && m.role) ? m.role : "user";
  const content = typeof (m && m.content) === "string" ? m.content : "";
  const msg = { role, content };
  if (role === "tool") {
    msg.toolCallId = clean(m.toolCallId);
    msg.name = clean(m.name);
  }
  if (Array.isArray(m && m.toolCalls) && m.toolCalls.length) {
    msg.toolCalls = m.toolCalls.map(tc => ({
      id: clean(tc.id),
      name: clean(tc.name),
      arguments: tc.arguments && typeof tc.arguments === "object" ? tc.arguments : {},
    }));
  }
  return msg;
}

/** Interne toolbeschrijving (JSON-schema-achtig, aanbieder-neutraal). */
function normalizeTool(t) {
  const name = clean(t && t.name);
  if (!name) return null;
  return {
    name,
    description: clean(t.description),
    parameters: t.parameters && typeof t.parameters === "object" ? t.parameters : { type: "object", properties: {} },
  };
}

/**
 * Valideer een verzoek vóór het naar een adapter gaat. Faalt luid bij een leeg
 * gesprek: een lege prompt levert anders stilzwijgend onzin op.
 */
function normalizeRequest(request) {
  const src = request && typeof request === "object" ? request : {};
  const messages = (Array.isArray(src.messages) ? src.messages : []).map(normalizeMessage).filter(m => m.content || m.toolCalls);
  if (!messages.length) {
    const e = new Error("Een AI-verzoek heeft minstens één bericht nodig");
    e.status = 400; e.code = "NO_MESSAGES"; throw e;
  }
  const tools = (Array.isArray(src.tools) ? src.tools : []).map(normalizeTool).filter(Boolean);
  return {
    messages,
    tools,
    // Het model komt uit configuratie; een aanroeper mag overschrijven, maar
    // de business rules kennen geen modelnamen (handover 4.5).
    model: clean(src.model) || null,
    maxTokens: Number.isFinite(Number(src.maxTokens)) ? Number(src.maxTokens) : 1024,
    temperature: Number.isFinite(Number(src.temperature)) ? Number(src.temperature) : 0.2,
    // Correlatie voor telemetrie en audit · provideronafhankelijk.
    correlationId: clean(src.correlationId) || null,
    tenantId: clean(src.tenantId) || null,
  };
}

/**
 * Uniforme antwoordvorm. Elke adapter geeft DIT terug, ongeacht hoe zijn eigen
 * payload eruitziet, zodat Mona nooit aanbieder-specifieke velden leest.
 */
function normalizeCompletion({ content = "", toolCalls = [], finishReason = "stop", model = null, usage = null, raw = undefined } = {}) {
  return {
    content: typeof content === "string" ? content : "",
    toolCalls: (Array.isArray(toolCalls) ? toolCalls : []).map(tc => ({
      id: clean(tc.id), name: clean(tc.name),
      arguments: tc.arguments && typeof tc.arguments === "object" ? tc.arguments : {},
    })),
    finishReason: FINISH_REASONS.includes(finishReason) ? finishReason : "stop",
    model: clean(model) || null,
    usage: usage && typeof usage === "object"
      ? { promptTokens: Number(usage.promptTokens) || 0, completionTokens: Number(usage.completionTokens) || 0 }
      : null,
    // `raw` blijft beschikbaar voor diagnostiek maar hoort NOOIT in domeinlogica.
    raw,
  };
}

const REQUIRED_METHODS = ["complete", "runTools", "health"];
function isAiProvider(candidate) {
  return !!candidate && REQUIRED_METHODS.every(m => typeof candidate[m] === "function");
}

module.exports = {
  ROLES, FINISH_REASONS, REQUIRED_METHODS,
  normalizeMessage, normalizeTool, normalizeRequest, normalizeCompletion, isAiProvider,
};
