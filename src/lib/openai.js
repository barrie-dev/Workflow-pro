"use strict";
/**
 * Dunne client voor de OpenAI Chat Completions API (raw HTTPS, geen SDK-dependency -
 * past bij de zero-dep huisstijl van deze app, net als payments/peppol).
 *
 * De super-admin zet de echte key + model in de Integraties-console
 * (platform-config → openai). Zonder echte key draait Mona in mock-modus
 * (zie modules/boden.js) en wordt deze client niet aangeroepen.
 */

const PLACEHOLDER = /DUMMY|replace[_-]?me|changeme|xxxx/i;

/** Is er een échte (niet-dummy) OpenAI-key geconfigureerd? */
function hasRealKey(cfg) {
  const k = cfg && cfg.apiKey;
  return !!k && !PLACEHOLDER.test(String(k));
}

const API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

/**
 * Eén call naar de Chat Completions API. Gooit een Error met .status bij API-fouten.
 * @param {{apiKey:string, model?:string}} cfg
 * @param {{messages:Array, tools?:Array, max_tokens?:number}} body
 *   messages: OpenAI-formaat ([{role:'system'|'user'|'assistant'|'tool', ...}])
 *   tools:    [{type:'function', function:{name, description, parameters}}]
 */
async function createChat(cfg, body) {
  const payload = {
    model: cfg.model || DEFAULT_MODEL,
    // max_completion_tokens is de forward-compatibele parameter: werkt voor gpt-4o(-mini)
    // én voor nieuwere modellen (o-serie / gpt-5) waar max_tokens een 400 geeft.
    max_completion_tokens: body.max_tokens || 1536,
    messages: body.messages,
  };
  if (body.tools && body.tools.length) { payload.tools = body.tools; payload.tool_choice = "auto"; }

  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + cfg.apiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const err = new Error("Kon de AI-dienst niet bereiken: " + e.message);
    err.status = 502;
    throw err;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `AI-dienst gaf ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.apiType = data && data.error && data.error.type;
    throw err;
  }
  return data; // { choices:[{ message:{role,content,tool_calls}, finish_reason }], usage, ... }
}

module.exports = { hasRealKey, createChat, DEFAULT_MODEL };
