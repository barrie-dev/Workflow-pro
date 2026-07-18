"use strict";
/**
 * Vorderingsstaten, prijsherziening en verlet (master-spec h32/PRG · R7).
 *
 * Periodiek factureren op basis van CUMULATIEVE voortgang per lijn, met
 * contractuele correcties: prijsherziening, retentie (borg), voorschot-
 * verrekening en verletdagen.
 *
 * Afhankelijkheden uit h52.1 zijn vervuld vóór dit gebouwd werd: onveranderlijke
 * offerteversies (E05), meerwerk/change orders (E12), projectscope (E04) en
 * bronallocatie op facturen (E08).
 *
 * Business rules (h32):
 *  - Huidige vordering = cumulatief nieuw MIN cumulatief vorige.
 *  - De vorige goedgekeurde stand wordt BEVROREN; een volgende vordering start
 *    daarvandaan (acceptatie).
 *  - Cumulatief mag de contracthoeveelheid niet overschrijden zonder een
 *    goedgekeurde wijziging (change order).
 *  - Meerdere actieve offertes mogen gecombineerd worden mits zelfde project.
 *  - Prijsherziening is APART zichtbaar en formuleerbaar (reproduceerbaar).
 *  - Retentie en voorschotten worden afzonderlijk berekend.
 *  - Een factuur neemt alleen de GOEDGEKEURDE huidige periode over.
 *  - Betwiste lijnen schuiven door zonder historiek te verliezen.
 *
 * Cloudblind (ADR-001): geen SDK, geen SQL, geen omgevingsvariabelen.
 */

const { newUlid } = require("./events");
const { round2 } = require("../modules/be-locale");

const CLAIM_STATUSES = [
  "draft", "internally_checked", "sent", "in_discussion",
  "approved", "partially_approved", "rejected", "invoiced", "closed",
];
const CLAIM_TRANSITIONS = {
  draft: ["internally_checked", "rejected"],
  internally_checked: ["sent", "draft", "rejected"],
  sent: ["in_discussion", "approved", "partially_approved", "rejected"],
  in_discussion: ["approved", "partially_approved", "rejected"],
  partially_approved: ["invoiced", "in_discussion", "approved"],
  approved: ["invoiced", "closed"],
  rejected: ["draft", "closed"],
  invoiced: ["closed"],
  closed: [],
};
// Vanaf deze statussen ligt de stand vast (bevroren) voor de volgende vordering.
const APPROVED_STATUSES = ["approved", "partially_approved", "invoiced", "closed"];

function clean(v) { return String(v == null ? "" : v).trim(); }
function num(v, dflt = 0) { const n = Number(v); return Number.isFinite(n) ? n : dflt; }
function isoDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : null; }
function canTransition(from, to) { return (CLAIM_TRANSITIONS[from] || []).includes(to); }

// ── Prijsherziening ─────────────────────────────────────────────────────────
/**
 * Belgische herzieningsformule: p = P × (a·s/S + b·i/I + c), met a+b+c = 1.
 *  a = aandeel lonen  · s/S = huidige/basis loonindex
 *  b = aandeel materialen · i/I = huidige/basis materiaalindex
 *  c = niet-herzienbaar vast deel
 * De factor, de gebruikte indexen én de formule in tekst worden bewaard, zodat
 * de berekening reproduceerbaar en controleerbaar is (acceptatie h32/h35).
 */
function computePriceRevision(revision, baseAmount) {
  const r = revision || {};
  if (r.enabled !== true) return { enabled: false, factor: 1, amount: 0, formulaText: null };
  const a = num(r.a, 0), b = num(r.b, 0), c = num(r.c, 0);
  const sum = round2(a + b + c);
  if (sum !== 1) {
    const e = new Error(`De herzieningsformule moet optellen tot 1 (a+b+c = ${sum})`); e.status = 400; e.code = "FORMULA_SUM"; throw e;
  }
  const S = num(r.baseLaborIndex, 0), s = num(r.currentLaborIndex, 0);
  const I = num(r.baseMaterialIndex, 0), i = num(r.currentMaterialIndex, 0);
  if (a > 0 && (S <= 0 || s <= 0)) { const e = new Error("Loonindexen zijn vereist wanneer a > 0"); e.status = 400; e.code = "INDEX_REQUIRED"; throw e; }
  if (b > 0 && (I <= 0 || i <= 0)) { const e = new Error("Materiaalindexen zijn vereist wanneer b > 0"); e.status = 400; e.code = "INDEX_REQUIRED"; throw e; }

  const laborTerm = a > 0 ? a * (s / S) : 0;
  const materialTerm = b > 0 ? b * (i / I) : 0;
  const factor = round2(laborTerm + materialTerm + c);
  const base = round2(num(baseAmount, 0));
  // Herziening = het VERSCHIL met het basisbedrag, apart zichtbaar (h32).
  const amount = round2(base * factor - base);
  return {
    enabled: true,
    a, b, c,
    baseLaborIndex: S, currentLaborIndex: s,
    baseMaterialIndex: I, currentMaterialIndex: i,
    factor,
    amount,
    baseAmount: base,
    formulaText: `p = P × (${a}·${s}/${S} + ${b}·${i}/${I} + ${c}) = ${base} × ${factor} → herziening ${amount}`,
    sourceIndexName: clean(r.sourceIndexName) || null,
    indexDate: isoDate(r.indexDate) || null,
  };
}

// ── Lijnen ──────────────────────────────────────────────────────────────────
/**
 * Normaliseer een vorderingslijn. `previousQty` is de BEVROREN stand uit de
 * vorige goedgekeurde vordering; `cumulativeQty` is de nieuwe cumulatieve stand.
 * Huidige hoeveelheid volgt daaruit (business rule h32).
 */
function normalizeLine(raw, previous = null) {
  const contractQty = round2(Math.max(0, num(raw.contractQty, 0)));
  const unitPrice = round2(num(raw.contractUnitPrice ?? raw.unitPrice, 0));
  const previousQty = round2(Math.max(0, num(previous ? previous.cumulativeQty : raw.previousQty, 0)));
  // Cumulatief kan expliciet (hoeveelheid) of via een percentage van de
  // contracthoeveelheid. Een expliciete hoeveelheid heeft VOORRANG: een
  // genormaliseerde lijn draagt zelf een afgeleide cumulativePct, en die mag
  // bij een terugstuur nooit een nieuw ingevulde hoeveelheid overschrijven.
  let cumulativeQty;
  if (raw.cumulativeQty != null) cumulativeQty = round2(Math.max(0, num(raw.cumulativeQty)));
  else if (raw.cumulativePct != null) cumulativeQty = round2(contractQty * Math.max(0, Math.min(100, num(raw.cumulativePct))) / 100);
  else cumulativeQty = previousQty;

  const currentQty = round2(cumulativeQty - previousQty);
  return {
    id: clean(raw.id) || `pcl_${newUlid()}`,
    sourceType: ["quote", "change_order"].includes(raw.sourceType) ? raw.sourceType : "quote",
    sourceId: clean(raw.sourceId) || null,
    sourceLineId: clean(raw.sourceLineId) || null,
    description: clean(raw.description),
    unit: clean(raw.unit) || "post",
    contractQty,
    contractUnitPrice: unitPrice,
    contractAmount: round2(contractQty * unitPrice),
    vatRate: [0, 6, 12, 21].includes(Number(raw.vatRate)) ? Number(raw.vatRate) : 21,
    previousQty,
    currentQty,
    cumulativeQty,
    previousAmount: round2(previousQty * unitPrice),
    currentAmount: round2(currentQty * unitPrice),
    cumulativeAmount: round2(cumulativeQty * unitPrice),
    cumulativePct: contractQty > 0 ? round2(cumulativeQty / contractQty * 100) : 0,
    // Betwiste lijnen schuiven door zonder historiek te verliezen (h32).
    disputed: raw.disputed === true,
    disputedNote: clean(raw.disputedNote),
  };
}

/**
 * Bepaal wat de aanroeper bedoelde toen hij een lijn terugstuurde. Een client
 * haalt genormaliseerde lijnen op (met zowel cumulativeQty als de afgeleide
 * cumulativePct) en wijzigt er één van. Door te vergelijken met de opgeslagen
 * lijn weten we welke van de twee de intentie draagt, zodat de andere (nu
 * verouderde) waarde de voortgang niet stilzwijgend terugdraait.
 */
function resolveProgressInput(raw, current) {
  const changed = (a, b) => round2(num(a)) !== round2(num(b));
  if (current) {
    if (raw.cumulativePct != null && changed(raw.cumulativePct, current.cumulativePct)) return { cumulativePct: num(raw.cumulativePct) };
    if (raw.cumulativeQty != null && changed(raw.cumulativeQty, current.cumulativeQty)) return { cumulativeQty: num(raw.cumulativeQty) };
    return { cumulativeQty: num(current.cumulativeQty) };   // niets gewijzigd
  }
  if (raw.cumulativeQty != null) return { cumulativeQty: num(raw.cumulativeQty) };
  if (raw.cumulativePct != null) return { cumulativePct: num(raw.cumulativePct) };
  return {};
}

/**
 * Bewaakt de business rule: cumulatief mag de contracthoeveelheid niet
 * overschrijden zonder goedgekeurde wijziging. `allowOverrun` staat het toe
 * wanneer de aanroeper een goedgekeurde change order aanwijst.
 */
function assertNoOverrun(lines, allowOverrun = false) {
  if (allowOverrun) return;
  const over = lines.filter(l => l.contractQty > 0 && l.cumulativeQty > l.contractQty + 0.001);
  if (over.length) {
    const e = new Error(`Cumulatieve hoeveelheid overschrijdt het contract op: ${over.map(l => l.description || l.id).join(", ")}. Registreer eerst een goedgekeurde wijziging.`);
    e.status = 409; e.code = "CONTRACT_QTY_EXCEEDED";
    e.lines = over.map(l => ({ id: l.id, description: l.description, contractQty: l.contractQty, cumulativeQty: l.cumulativeQty }));
    throw e;
  }
}

// ── Totalen ─────────────────────────────────────────────────────────────────
/**
 * Totalen van een vordering. Retentie en voorschotverrekening worden
 * AFZONDERLIJK berekend en apart getoond (h32), net als de prijsherziening.
 * Enkel niet-betwiste lijnen tellen mee in het te betalen bedrag; betwiste
 * lijnen blijven zichtbaar en schuiven door naar de volgende vordering.
 */
function computeClaimTotals(claim) {
  const lines = claim.lines || [];
  const accepted = lines.filter(l => !l.disputed);
  const currentAmount = round2(accepted.reduce((s, l) => s + l.currentAmount, 0));
  const disputedAmount = round2(lines.filter(l => l.disputed).reduce((s, l) => s + l.currentAmount, 0));
  const cumulativeAmount = round2(lines.reduce((s, l) => s + l.cumulativeAmount, 0));
  const contractAmount = round2(lines.reduce((s, l) => s + l.contractAmount, 0));

  const revision = computePriceRevision(claim.priceRevision, currentAmount);
  const revisedAmount = round2(currentAmount + revision.amount);

  const retentionPct = Math.max(0, Math.min(100, num(claim.retentionPct, 0)));
  const retentionAmount = round2(revisedAmount * retentionPct / 100);

  // Voorschotverrekening: percentage van de huidige staat of een vast bedrag.
  const advanceAmount = claim.advanceSettlementAmount != null
    ? round2(Math.max(0, num(claim.advanceSettlementAmount)))
    : round2(revisedAmount * Math.max(0, Math.min(100, num(claim.advanceSettlementPct, 0))) / 100);

  const netPayable = round2(revisedAmount - retentionAmount - advanceAmount);
  return {
    contractAmount,
    previousAmount: round2(lines.reduce((s, l) => s + l.previousAmount, 0)),
    currentAmount,
    disputedAmount,
    cumulativeAmount,
    cumulativePct: contractAmount > 0 ? round2(cumulativeAmount / contractAmount * 100) : 0,
    priceRevision: revision,
    revisedAmount,
    retentionPct, retentionAmount,
    advanceAmount,
    netPayable,
  };
}

// ── Repository ──────────────────────────────────────────────────────────────
/** Doorlopend vorderingsnummer per project: VS-<projectnr>-001. */
function nextClaimNumber(store, tenantId, projectId, projectNumber) {
  const existing = (store.list("progressClaims", tenantId) || []).filter(c => c.projectId === projectId);
  const seq = existing.length + 1;
  return { number: `VS-${projectNumber || "PRJ"}-${String(seq).padStart(3, "0")}`, sequence: seq };
}

function makeProgressClaimRepository(store) {
  const col = "progressClaims";
  return {
    list(tenantId, { projectId, status } = {}) {
      return (store.list(col, tenantId) || [])
        .filter(c => (!projectId || c.projectId === projectId) && (!status || c.status === status))
        .sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
    },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(c => c.id === id) || null; },

    /** De laatst goedgekeurde vordering van een project · levert de bevroren stand. */
    lastApproved(tenantId, projectId) {
      return this.list(tenantId, { projectId })
        .filter(c => APPROVED_STATUSES.includes(c.status))
        .sort((a, b) => Number(b.sequence || 0) - Number(a.sequence || 0))[0] || null;
    },

    /**
     * Bouw de bronlijnen voor een project uit de aanvaarde offerte(s) en de
     * goedgekeurde change orders. Meerdere offertes mogen gecombineerd worden
     * mits zelfde projectcontext (h32).
     */
    buildSourceLines(tenantId, projectId, { quoteIds = null } = {}) {
      const quotes = (store.list("quotes", tenantId) || [])
        .filter(q => q.projectId === projectId && (!quoteIds || quoteIds.includes(q.id)));
      const changeOrders = (store.list("changeOrders", tenantId) || [])
        .filter(co => co.projectId === projectId && co.status === "approved");
      const lines = [];
      for (const q of quotes) {
        for (const [idx, l] of (q.lines || []).entries()) {
          lines.push({
            sourceType: "quote", sourceId: q.id, sourceLineId: l.id || `${q.id}#${idx}`,
            description: l.description, unit: l.unit || "post",
            contractQty: num(l.qty, 0), contractUnitPrice: num(l.unitPrice, 0), vatRate: l.vatRate,
          });
        }
      }
      for (const co of changeOrders) {
        for (const [idx, l] of (co.lines || []).entries()) {
          lines.push({
            sourceType: "change_order", sourceId: co.id, sourceLineId: l.id || `${co.id}#${idx}`,
            description: `${l.description} (meerwerk ${co.number || co.id})`, unit: l.unit || "post",
            contractQty: num(l.qty, 0), contractUnitPrice: num(l.unitPrice, 0), vatRate: l.vatRate,
          });
        }
      }
      return lines;
    },

    /**
     * Nieuwe vordering. Start altijd vanaf de LAATST GOEDGEKEURDE stand
     * (acceptatie h32): die stand is bevroren en wordt per lijn overgenomen als
     * previousQty. Betwiste lijnen van de vorige vordering schuiven mee door.
     */
    insert(tenantId, payload, actor) {
      const projectId = clean(payload && payload.projectId);
      if (!projectId) { const e = new Error("Project is verplicht"); e.status = 400; throw e; }
      const project = (store.list("projects", tenantId) || []).find(p => p.id === projectId);
      if (!project) { const e = new Error("Project niet gevonden"); e.status = 404; throw e; }
      // Geen tweede open vordering naast een lopende (h32: periodiek, sequentieel).
      const open = this.list(tenantId, { projectId }).find(c => !APPROVED_STATUSES.includes(c.status) && c.status !== "rejected");
      if (open) { const e = new Error(`Er loopt al een vordering (${open.number}) · rond die eerst af`); e.status = 409; e.code = "CLAIM_IN_PROGRESS"; throw e; }

      const previous = this.lastApproved(tenantId, projectId);
      const sourceLines = Array.isArray(payload.lines) && payload.lines.length
        ? payload.lines
        : this.buildSourceLines(tenantId, projectId, { quoteIds: payload.quoteIds || null });
      if (!sourceLines.length) { const e = new Error("Geen bronlijnen gevonden · koppel eerst een offerte of meerwerk aan het project"); e.status = 400; e.code = "NO_SOURCE_LINES"; throw e; }

      const prevByKey = new Map((previous ? previous.lines : []).map(l => [`${l.sourceType}:${l.sourceLineId}`, l]));
      const lines = sourceLines.map(raw => {
        const prev = prevByKey.get(`${raw.sourceType}:${raw.sourceLineId || raw.id}`) || null;
        return normalizeLine({ ...raw, disputed: prev ? prev.disputed : false, disputedNote: prev ? prev.disputedNote : "" }, prev);
      });

      const { number, sequence } = nextClaimNumber(store, tenantId, projectId, project.number);
      const now = new Date().toISOString();
      return store.insert(col, {
        id: `pc_${newUlid()}`, tenantId, projectId, number, sequence,
        periodStart: isoDate(payload.periodStart), periodEnd: isoDate(payload.periodEnd),
        quoteIds: payload.quoteIds || null,
        previousClaimId: previous ? previous.id : null,
        lines,
        priceRevision: payload.priceRevision || { enabled: false },
        retentionPct: Math.max(0, Math.min(100, num(payload.retentionPct, 0))),
        advanceSettlementPct: Math.max(0, Math.min(100, num(payload.advanceSettlementPct, 0))),
        advanceSettlementAmount: payload.advanceSettlementAmount != null ? round2(num(payload.advanceSettlementAmount)) : null,
        weatherDelayDays: Math.max(0, num(payload.weatherDelayDays, 0)),   // verletstaat
        weatherDelayNote: clean(payload.weatherDelayNote),
        status: "draft", invoiceId: null,
        version: 1, createdAt: now, createdBy: actor || null, updatedAt: now, updatedBy: actor || null,
      });
    },

    /** Voortgang, herziening, retentie en verlet bijwerken (enkel vóór goedkeuring). */
    update(tenantId, id, patch, actor, expectedVersion) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Vorderingsstaat niet gevonden"); e.status = 404; throw e; }
      if (APPROVED_STATUSES.includes(existing.status)) {
        const e = new Error("Een goedgekeurde vorderingsstaat is bevroren"); e.status = 409; e.code = "CLAIM_FROZEN"; throw e;
      }
      if (expectedVersion != null && Number(existing.version || 1) !== Number(expectedVersion)) {
        const e = new Error("De vorderingsstaat is intussen gewijzigd."); e.status = 409; e.code = "VERSION_CONFLICT"; e.currentVersion = existing.version; throw e;
      }
      const next = { version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null };

      if (Array.isArray(patch.lines)) {
        // Bestaande lijnen bijwerken op id; previousQty blijft de bevroren stand.
        const byId = new Map(existing.lines.map(l => [l.id, l]));
        const lines = patch.lines.map(raw => {
          const current = byId.get(clean(raw.id));
          const merged = { ...(current || {}), ...raw };
          // previousQty nooit uit de payload overnemen: die is bevroren.
          merged.previousQty = current ? current.previousQty : num(raw.previousQty, 0);
          // Exact één voortgangsbron doorgeven (qty óf pct), nooit allebei.
          delete merged.cumulativeQty; delete merged.cumulativePct;
          Object.assign(merged, resolveProgressInput(raw, current));
          return normalizeLine(merged, null);
        });
        assertNoOverrun(lines, patch.allowOverrun === true);
        next.lines = lines;
      }
      if (patch.priceRevision !== undefined) {
        // Valideer de formule meteen zodat een fout niet pas bij factuur opduikt.
        computePriceRevision(patch.priceRevision, 0);
        next.priceRevision = patch.priceRevision;
      }
      if (patch.retentionPct !== undefined) next.retentionPct = Math.max(0, Math.min(100, num(patch.retentionPct)));
      if (patch.advanceSettlementPct !== undefined) next.advanceSettlementPct = Math.max(0, Math.min(100, num(patch.advanceSettlementPct)));
      if (patch.advanceSettlementAmount !== undefined) next.advanceSettlementAmount = patch.advanceSettlementAmount == null ? null : round2(num(patch.advanceSettlementAmount));
      if (patch.weatherDelayDays !== undefined) next.weatherDelayDays = Math.max(0, num(patch.weatherDelayDays));
      if (patch.weatherDelayNote !== undefined) next.weatherDelayNote = clean(patch.weatherDelayNote);
      if (patch.periodStart !== undefined) next.periodStart = isoDate(patch.periodStart);
      if (patch.periodEnd !== undefined) next.periodEnd = isoDate(patch.periodEnd);
      return store.update(col, id, next);
    },

    transition(tenantId, id, to, actor, { note } = {}) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Vorderingsstaat niet gevonden"); e.status = 404; throw e; }
      if (existing.status === to) return existing;
      if (!canTransition(existing.status, to)) {
        const e = new Error(`Ongeldige statusovergang: ${existing.status} → ${to}`); e.status = 409; e.code = "INVALID_TRANSITION"; throw e;
      }
      // Bij (gedeeltelijke) goedkeuring wordt de stand bevroren.
      const patch = { status: to, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null };
      if (APPROVED_STATUSES.includes(to)) { patch.approvedAt = new Date().toISOString(); patch.approvedBy = actor || null; }
      if (note !== undefined) patch.statusNote = clean(note);
      return store.update(col, id, patch);
    },

    /**
     * Factuurpayload: alleen de GOEDGEKEURDE huidige periode (h32). Betwiste
     * lijnen vallen weg (die schuiven door), prijsherziening, retentie en
     * voorschot komen als aparte, transparante regels.
     */
    invoicePayload(tenantId, id) {
      const claim = this.findById(tenantId, id);
      if (!claim) { const e = new Error("Vorderingsstaat niet gevonden"); e.status = 404; throw e; }
      if (!APPROVED_STATUSES.includes(claim.status)) {
        const e = new Error("Alleen een goedgekeurde vorderingsstaat kan gefactureerd worden"); e.status = 409; e.code = "NOT_APPROVED"; throw e;
      }
      if (claim.invoiceId) { const e = new Error("Deze vorderingsstaat is al gefactureerd"); e.status = 409; e.code = "ALREADY_INVOICED"; throw e; }
      const totals = computeClaimTotals(claim);
      const lines = claim.lines
        .filter(l => !l.disputed && l.currentAmount !== 0)
        .map(l => ({
          description: `${l.description} · vordering ${claim.number} (${l.cumulativePct}% cumulatief)`,
          qty: l.currentQty, unitPrice: l.contractUnitPrice, vatRate: l.vatRate,
          sourceType: "progress_claim", sourceId: claim.id,
        }));
      if (totals.priceRevision.enabled && totals.priceRevision.amount !== 0) {
        lines.push({ description: `Prijsherziening · ${totals.priceRevision.formulaText}`, qty: 1, unitPrice: totals.priceRevision.amount, vatRate: 21, sourceType: "progress_claim", sourceId: claim.id });
      }
      if (totals.retentionAmount > 0) {
        lines.push({ description: `Retentie ${totals.retentionPct}% (ingehouden)`, qty: 1, unitPrice: round2(-totals.retentionAmount), vatRate: 21, sourceType: "progress_claim", sourceId: claim.id });
      }
      if (totals.advanceAmount > 0) {
        lines.push({ description: "Verrekening voorschot", qty: 1, unitPrice: round2(-totals.advanceAmount), vatRate: 21, sourceType: "progress_claim", sourceId: claim.id });
      }
      return { claim, totals, lines };
    },

    markInvoiced(tenantId, id, invoiceId, actor) {
      const claim = this.findById(tenantId, id);
      if (!claim) { const e = new Error("Vorderingsstaat niet gevonden"); e.status = 404; throw e; }
      return store.update(col, id, {
        invoiceId, status: "invoiced", invoicedAt: new Date().toISOString(),
        version: Number(claim.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null,
      });
    },

    remove(tenantId, id) {
      const claim = this.findById(tenantId, id);
      if (!claim) { const e = new Error("Vorderingsstaat niet gevonden"); e.status = 404; throw e; }
      if (APPROVED_STATUSES.includes(claim.status)) { const e = new Error("Een goedgekeurde vorderingsstaat kan niet verwijderd worden"); e.status = 409; e.code = "CLAIM_FROZEN"; throw e; }
      store.remove(col, id);
      return { ok: true };
    },
  };
}

module.exports = {
  CLAIM_STATUSES, CLAIM_TRANSITIONS, APPROVED_STATUSES, canTransition,
  computePriceRevision, normalizeLine, assertNoOverrun, computeClaimTotals,
  makeProgressClaimRepository,
};
