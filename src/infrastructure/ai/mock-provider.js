"use strict";
/**
 * Mock-AiProvider (handover 4.5).
 *
 * Laat Mona en de estimator volledig draaien ZONDER sleutel of netwerk: lokaal,
 * in CI en in demo-omgevingen. Deterministisch, zodat tests reproduceerbaar
 * blijven. Dit is bewust een volwaardige adapter en geen if-tak in de
 * businesscode: zo blijft er precies één pad door de poort.
 */

const { normalizeRequest, normalizeCompletion } = require("../../ports/ai-provider");

class MockAiProvider {
  /**
   * @param {object} opts
   * @param {(req) => object} [opts.responder] eigen antwoord voor gerichte tests
   */
  constructor({ responder = null, model = "mock-model" } = {}) {
    this.name = "mock";
    this.model = model;
    this.responder = responder;
    this.calls = [];
  }

  isConfigured() { return true; }

  async complete(request) {
    const req = normalizeRequest(request);
    this.calls.push(req);
    if (this.responder) return normalizeCompletion(this.responder(req));

    const laatste = [...req.messages].reverse().find(m => m.role === "user");
    const vraag = (laatste && laatste.content) || "";
    return normalizeCompletion({
      content: `[testmodus] Ik heb je vraag ontvangen: "${vraag.slice(0, 120)}". `
        + "Er is geen AI-sleutel geconfigureerd, dus dit is een vast antwoord.",
      finishReason: "stop",
      model: req.model || this.model,
      usage: { promptTokens: req.messages.length * 10, completionTokens: 20 },
    });
  }

  async runTools(request) {
    const completion = await this.complete(request);
    return { toolCalls: completion.toolCalls, content: completion.content, finishReason: completion.finishReason, model: completion.model };
  }

  async health() {
    return { provider: this.name, configured: true, model: this.model, endpoint: null, mock: true };
  }
}

module.exports = { MockAiProvider };
