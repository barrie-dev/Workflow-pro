"use strict";
/**
 * AI-offerte-estimatie (betaalde add-on "ai_estimate").
 *
 * Zet een klantvraag (vrije tekst of een klantvraag uit de Inbox) om in een
 * offerte-CONCEPT: regels met materiaal, werkuren en prijs, onderbouwd door de
 * eigen offertehistoriek en het standaard-uurtarief van de organisatie.
 *
 * Altijd met menselijke eindcontrole: de gebruiker ziet eerst de raming en de
 * aannames, bevestigt, en pas dan wordt een concept-offerte aangemaakt via het
 * bestaande (beveiligde) offertes-endpoint. Er wordt nooit automatisch verzonden.
 *
 * Provider: OpenAI via platform-config (zelfde infra als Boden); zonder echte
 * key draait de estimator in mock-modus (deterministische raming, gratis QA).
 */

const { hasRealKey, createChat } = require("../lib/openai");
const { loadPlatformConfig } = require("./platform-config");
const { round2 } = require("./be-locale");

const VAT_RATES = [0, 6, 12, 21];
const CONFIDENCES = ["laag", "middel", "hoog"];
const MAX_LINES = 20;

/** Grounding voor het model: uurtarief + compacte offertehistoriek. */
function buildEstimationContext(store, tenant) {
  const hourlyRate = Number(tenant.defaultHourlyRate || (tenant.billingOps && tenant.billingOps.defaultHourlyRate) || 0);
  const history = (store.list("quotes", tenant.id) || [])
    .slice()
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 8)
    .map(q => ({
      totaal: q.total,
      regels: (q.lines || []).slice(0, 6).map(l => ({
        omschrijving: l.description,
        aantal: l.qty,
        eenheidsprijs: l.unitPrice,
      })),
    }));
  return { hourlyRate, history };
}

/** Valideer en normaliseer een (model)raming naar veilige offerteregels. */
function normalizeEstimate(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const lines = (Array.isArray(src.lines) ? src.lines : [])
    .map(l => {
      const description = String((l && l.description) || "").trim();
      let qty = Number(l && l.qty);
      let unitPrice = Number(l && l.unitPrice);
      if (!description) return null;
      if (!Number.isFinite(qty) || qty <= 0) qty = 1;
      qty = Math.min(qty, 10000);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) unitPrice = 0;
      unitPrice = Math.min(unitPrice, 1000000);
      const vatRate = VAT_RATES.includes(Number(l && l.vatRate)) ? Number(l.vatRate) : 21;
      return { description, qty: round2(qty), unitPrice: round2(unitPrice), vatRate };
    })
    .filter(Boolean)
    .slice(0, MAX_LINES);
  if (!lines.length) {
    const e = new Error("De AI-raming bevatte geen bruikbare offerteregels. Probeer de vraag concreter te omschrijven.");
    e.status = 502;
    throw e;
  }
  const assumptions = (Array.isArray(src.assumptions) ? src.assumptions : [])
    .map(a => String(a || "").trim()).filter(Boolean).slice(0, 6);
  const confidence = CONFIDENCES.includes(src.confidence) ? src.confidence : "laag";
  return { lines, assumptions, confidence };
}

/** Haal JSON uit een modelantwoord (met of zonder markdown-fences). */
function parseModelJson(text) {
  const s = String(text || "");
  const cleaned = s.replace(/```(?:json)?/gi, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) {
    const e = new Error("De AI-dienst gaf geen geldig JSON-antwoord");
    e.status = 502;
    throw e;
  }
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    const e = new Error("De AI-dienst gaf geen geldig JSON-antwoord");
    e.status = 502;
    throw e;
  }
}

/** Deterministische raming voor mock-modus (geen echte OpenAI-key). */
function mockEstimate(question, context) {
  const rate = context.hourlyRate > 0 ? context.hourlyRate : 45;
  return {
    lines: [
      { description: "Werkuren (voorlopige inschatting)", qty: 8, unitPrice: round2(rate), vatRate: 21 },
      { description: "Materiaal (raming)", qty: 1, unitPrice: 250, vatRate: 21 },
      { description: "Verplaatsing en klein materiaal", qty: 1, unitPrice: 45, vatRate: 21 },
    ],
    assumptions: [
      "Testmodus (geen AI-key): indicatieve standaardraming, geen analyse van de vraag.",
      `Vraag: ${String(question || "").slice(0, 80)}`,
    ],
    confidence: "laag",
  };
}

const SYSTEM_PROMPT = `Je bent de calculatie-assistent van een Belgische KMO (bouw en veldwerk). Zet de klantvraag om in een offerte-CONCEPT.
Regels:
- Antwoord UITSLUITEND met geldige JSON, zonder markdown of uitleg errond.
- Formaat: {"lines":[{"description":string,"qty":number,"unitPrice":number,"vatRate":0|6|12|21}],"assumptions":[string],"confidence":"laag"|"middel"|"hoog"}
- Splits de raming in werkuren (qty = aantal uren, unitPrice = uurtarief), materiaal en eventuele vaste kosten (verplaatsing, afvoer).
- Gebruik het opgegeven uurtarief en het prijsniveau uit de offertehistoriek waar mogelijk.
- Prijzen in euro, exclusief btw. Wees realistisch voor de Belgische markt.
- Bij onbekende hoeveelheden: maak een redelijke aanname en zet die kort in assumptions (Nederlands, max 5).`;

/**
 * Klantvraag → raming { lines, assumptions, confidence, mock }.
 * Gooit een Error met .status bij AI-fouten; de route vertaalt dat naar de client.
 */
async function estimateFromQuestion(store, tenant, question) {
  const context = buildEstimationContext(store, tenant);
  const cfg = loadPlatformConfig(store).openai || {};
  if (!hasRealKey(cfg)) {
    return { ...normalizeEstimate(mockEstimate(question, context)), mock: true };
  }
  const userPrompt = [
    `Klantvraag:\n${String(question).slice(0, 4000)}`,
    "",
    "Context van de organisatie:",
    `- Standaard uurtarief: ${context.hourlyRate > 0 ? `€${context.hourlyRate}` : "niet ingesteld"}`,
    `- Recente offertes (compact): ${JSON.stringify(context.history).slice(0, 6000)}`,
  ].join("\n");
  const data = await createChat(cfg, {
    max_tokens: 1024,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return { ...normalizeEstimate(parseModelJson(content)), mock: false };
}

module.exports = {
  VAT_RATES,
  buildEstimationContext,
  normalizeEstimate,
  parseModelJson,
  mockEstimate,
  estimateFromQuestion,
};
