"use strict";
// AiProvider-contract (handover 4.5 · F-07): intern message-/toolmodel, mapping
// in de adapter, modelnamen uit configuratie, geen sleutels in fouten.
const { test } = require("node:test");
const assert = require("node:assert");

const { normalizeRequest, normalizeCompletion, isAiProvider } = require("../src/ports/ai-provider");
const { OpenAiCompatibleProvider, toProviderMessages, toProviderTools, fromProviderResponse } = require("../src/infrastructure/ai/openai-adapter");
const { MockAiProvider } = require("../src/infrastructure/ai/mock-provider");

const TOOL = { name: "get_invoices", description: "Haal facturen op", parameters: { type: "object", properties: { status: { type: "string" } } } };

/** fetch-dubbel die het verzoek registreert en een instelbaar antwoord geeft. */
function fakeFetch(response, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return { ok, status, json: async () => response };
  };
  fn.calls = calls;
  return fn;
}

// ── Poort ───────────────────────────────────────────────────────────────────
test("ai-poort: normaliseert berichten en weigert een leeg gesprek", () => {
  const req = normalizeRequest({ messages: [{ role: "user", content: "hallo" }, { role: "gek", content: "x" }] });
  assert.equal(req.messages.length, 2);
  assert.equal(req.messages[1].role, "user", "onbekende rol valt terug op user");
  assert.equal(req.maxTokens, 1024, "standaard uit de poort, niet uit een business rule");
  assert.throws(() => normalizeRequest({ messages: [] }), e => e.code === "NO_MESSAGES");
  assert.throws(() => normalizeRequest({}), e => e.code === "NO_MESSAGES");
});

test("ai-poort: uniforme completion ongeacht de aanbieder", () => {
  const c = normalizeCompletion({ content: "ok", finishReason: "onzin", toolCalls: [{ id: "1", name: "t", arguments: { a: 1 } }] });
  assert.equal(c.finishReason, "stop", "onbekende reden valt veilig terug");
  assert.equal(c.toolCalls[0].arguments.a, 1);
  assert.equal(normalizeCompletion({}).content, "");
});

// ── Gedeeld adaptercontract ─────────────────────────────────────────────────
function aiProviderContract(name, makeProvider) {
  test(`${name}: implementeert de poort`, async () => {
    assert.ok(isAiProvider(makeProvider()));
  });

  test(`${name}: complete geeft de uniforme vorm terug`, async () => {
    const c = await makeProvider().complete({ messages: [{ role: "user", content: "Hoeveel openstaande facturen?" }] });
    assert.equal(typeof c.content, "string");
    assert.ok(Array.isArray(c.toolCalls));
    assert.ok(["stop", "length", "tool_calls", "content_filter", "error"].includes(c.finishReason));
  });

  test(`${name}: health lekt geen sleutel`, async () => {
    const h = await makeProvider().health();
    assert.equal(typeof h.provider, "string");
    assert.equal(typeof h.configured, "boolean");
    assert.ok(!/sk-|api[_-]?key|geheim/i.test(JSON.stringify(h)), "geen sleutel in de gezondheidsinfo");
  });

  test(`${name}: leeg gesprek wordt geweigerd vóór er een call vertrekt`, async () => {
    await assert.rejects(() => makeProvider().complete({ messages: [] }), e => e.code === "NO_MESSAGES");
  });
}

aiProviderContract("mock", () => new MockAiProvider());
aiProviderContract("openai", () => new OpenAiCompatibleProvider({
  flavor: "openai", apiKey: "sk-echt-lijkende-sleutel", model: "gpt-4o-mini",
  fetchImpl: fakeFetch({ choices: [{ message: { content: "antwoord" }, finish_reason: "stop" }], model: "gpt-4o-mini" }),
}));
aiProviderContract("azure-openai", () => new OpenAiCompatibleProvider({
  flavor: "azure", apiKey: "azure-sleutel", model: "mona-deployment",
  endpoint: "https://voorbeeld.openai.azure.com", apiVersion: "2024-10-21",
  fetchImpl: fakeFetch({ choices: [{ message: { content: "antwoord" }, finish_reason: "stop" }], model: "gpt-4o" }),
}));

// ── Adapterspecifieke mapping ───────────────────────────────────────────────
test("openai-adapter: interne berichten en tools worden correct gemapt", () => {
  const msgs = toProviderMessages([
    { role: "user", content: "hallo" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "get_invoices", arguments: { status: "open" } }] },
    { role: "tool", content: "[]", toolCallId: "c1", name: "get_invoices" },
  ]);
  assert.equal(msgs[1].tool_calls[0].type, "function");
  assert.equal(msgs[1].tool_calls[0].function.arguments, '{"status":"open"}', "argumenten als JSON-string");
  assert.equal(msgs[2].tool_call_id, "c1");
  const tools = toProviderTools([TOOL]);
  assert.equal(tools[0].type, "function");
  assert.equal(tools[0].function.name, "get_invoices");
});

test("openai-adapter: antwoord met tool-calls wordt uniform teruggegeven", () => {
  const c = fromProviderResponse({
    model: "gpt-4o-mini",
    choices: [{ message: { content: null, tool_calls: [{ id: "c1", function: { name: "get_invoices", arguments: '{"status":"open"}' } }] }, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  });
  assert.equal(c.finishReason, "tool_calls");
  assert.deepEqual(c.toolCalls[0].arguments, { status: "open" });
  assert.equal(c.usage.promptTokens, 100);
  // Onleesbare argumenten laten de call niet crashen.
  const stuk = fromProviderResponse({ choices: [{ message: { tool_calls: [{ id: "c2", function: { name: "x", arguments: "{kapot" } }] } }] });
  assert.deepEqual(stuk.toolCalls[0].arguments, {});
});

test("openai-adapter: endpoint en auth verschillen per flavor", async () => {
  const openaiFetch = fakeFetch({ choices: [{ message: { content: "a" } }] });
  await new OpenAiCompatibleProvider({ flavor: "openai", apiKey: "sk-test", model: "gpt-4o-mini", fetchImpl: openaiFetch })
    .complete({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(openaiFetch.calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.match(openaiFetch.calls[0].init.headers.authorization, /^Bearer /);
  assert.equal(openaiFetch.calls[0].body.model, "gpt-4o-mini", "model in de payload");

  const azureFetch = fakeFetch({ choices: [{ message: { content: "a" } }] });
  await new OpenAiCompatibleProvider({
    flavor: "azure", apiKey: "az-test", model: "mona-deploy",
    endpoint: "https://voorbeeld.openai.azure.com/", apiVersion: "2024-10-21", fetchImpl: azureFetch,
  }).complete({ messages: [{ role: "user", content: "hi" }] });
  assert.match(azureFetch.calls[0].url, /\/openai\/deployments\/mona-deploy\/chat\/completions\?api-version=2024-10-21$/);
  assert.equal(azureFetch.calls[0].init.headers["api-key"], "az-test");
  assert.equal(azureFetch.calls[0].init.headers.authorization, undefined, "azure gebruikt api-key, geen Bearer");
  assert.equal(azureFetch.calls[0].body.model, undefined, "azure haalt het model uit de deployment-URL");
});

test("openai-adapter: azure vereist een endpoint", () => {
  assert.throws(() => new OpenAiCompatibleProvider({ flavor: "azure", apiKey: "x", model: "y" }), e => e.code === "ENDPOINT_MISSING");
});

test("openai-adapter: zonder geldige sleutel of model geen call", async () => {
  const f = fakeFetch({});
  const geenSleutel = new OpenAiCompatibleProvider({ flavor: "openai", apiKey: "DUMMY_replace_me", model: "gpt-4o-mini", fetchImpl: f });
  await assert.rejects(() => geenSleutel.complete({ messages: [{ role: "user", content: "hi" }] }), e => e.code === "AI_NOT_CONFIGURED" && e.status === 503);
  const geenModel = new OpenAiCompatibleProvider({ flavor: "openai", apiKey: "sk-test", fetchImpl: f });
  await assert.rejects(() => geenModel.complete({ messages: [{ role: "user", content: "hi" }] }), e => e.code === "MODEL_MISSING");
  assert.equal(f.calls.length, 0, "er vertrekt geen enkel verzoek");
});

test("openai-adapter: API-fout lekt de sleutel niet", async () => {
  const f = fakeFetch({ error: { message: "Invalid request" } }, { ok: false, status: 400 });
  const p = new OpenAiCompatibleProvider({ flavor: "openai", apiKey: "sk-zeer-geheime-sleutel", model: "gpt-4o-mini", fetchImpl: f });
  await assert.rejects(
    () => p.complete({ messages: [{ role: "user", content: "hi" }] }),
    e => e.status === 400 && !/sk-zeer-geheime-sleutel/.test(e.message));
});

test("mock-provider: deterministisch en met eigen antwoord instelbaar", async () => {
  const p = new MockAiProvider();
  const a = await p.complete({ messages: [{ role: "user", content: "Hoeveel facturen?" }] });
  assert.match(a.content, /testmodus/);
  assert.match(a.content, /Hoeveel facturen\?/);
  assert.equal(p.calls.length, 1, "aanroepen zijn inspecteerbaar in tests");

  const eigen = new MockAiProvider({ responder: () => ({ content: "", toolCalls: [{ id: "1", name: "get_invoices", arguments: { status: "open" } }], finishReason: "tool_calls" }) });
  const b = await eigen.runTools({ messages: [{ role: "user", content: "x" }], tools: [TOOL] });
  assert.equal(b.toolCalls[0].name, "get_invoices");
  assert.equal(b.finishReason, "tool_calls");
});
