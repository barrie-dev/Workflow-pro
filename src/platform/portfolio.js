"use strict";
/**
 * Projectplanning, fasen en capaciteitsforecast (master-spec h38/PPL · P1).
 *
 * Middellange en lange termijn inzicht: portfolio, baseline versus actuele
 * planning, en capaciteitstekorten per periode en rol. Bewust GEEN zware
 * CPM-engine in deze fase (h9: "Board, lijst, timeline, milestones en
 * resourcecapaciteit. Geen zware CPM-engine in eerste fase").
 *
 * Acceptatiecriteria (h38):
 *  - Het portfolio toont projecten en GEWOGEN offertes AFZONDERLIJK, zodat
 *    verwachte omzet nooit stilzwijgend met vastgelegde omzet wordt opgeteld.
 *  - Baseline en actuele planning zijn vergelijkbaar (drift per fase).
 *  - Capaciteitstekorten zijn zichtbaar per periode én per rol.
 *  - Conversie van offerte naar project behoudt de forecasthistoriek.
 *  - Een fasewijziging kan de financiële forecast actualiseren.
 *
 * Cloudblind (ADR-001): geen SDK, geen SQL, geen omgevingsvariabelen.
 */

const { newUlid } = require("./events");
const { round2 } = require("../modules/be-locale");

// Winkans per offertestatus · basis voor de gewogen pipeline.
const DEFAULT_WIN_PROBABILITY = {
  concept: 0.2,
  verzonden: 0.5,
  onderhandeling: 0.7,
  aanvaard: 1,
  geweigerd: 0,
  vervallen: 0,
};
const OPEN_QUOTE_STATUSES = ["concept", "verzonden", "onderhandeling"];

function clean(v) { return String(v == null ? "" : v).trim(); }
function num(v, dflt = 0) { const n = Number(v); return Number.isFinite(n) ? n : dflt; }
function isoDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : null; }
function daysBetween(a, b) {
  if (!a || !b) return null;
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

// ── Baseline versus actueel ─────────────────────────────────────────────────
/**
 * Leg de huidige fasedata vast als baseline. Dit is een MOMENTOPNAME: latere
 * verschuivingen veranderen de baseline nooit, anders valt er niets te
 * vergelijken (acceptatie h38).
 */
function captureBaseline(project, actor = null) {
  const at = new Date().toISOString();
  const phases = (project.phases || []).map(p => ({
    ...p,
    baseline: { startDate: p.startDate, endDate: p.endDate, capturedAt: at, capturedBy: actor },
  }));
  return { phases, baselineAt: at, baselineBy: actor };
}

/**
 * Vergelijk de actuele fasering met de baseline. `driftDays` is positief bij
 * uitloop en negatief bij vervroeging; fasen zonder baseline worden expliciet
 * als "nieuw sinds de baseline" gemeld in plaats van stil te verdwijnen.
 */
function comparePhases(project) {
  const rows = (project.phases || []).map(p => {
    const base = p.baseline || null;
    return {
      phaseId: p.id,
      title: p.title,
      status: p.status,
      baselineStart: base ? base.startDate : null,
      baselineEnd: base ? base.endDate : null,
      actualStart: p.startDate,
      actualEnd: p.endDate,
      startDriftDays: base ? daysBetween(base.startDate, p.startDate) : null,
      endDriftDays: base ? daysBetween(base.endDate, p.endDate) : null,
      newSinceBaseline: !base,
    };
  });
  const drifts = rows.map(r => r.endDriftDays).filter(d => Number.isFinite(d));
  return {
    hasBaseline: !!project.baselineAt,
    baselineAt: project.baselineAt || null,
    phases: rows,
    // De uitloop van het project = de grootste uitloop op een eindfase.
    maxEndDriftDays: drifts.length ? Math.max(...drifts) : null,
    delayedPhases: rows.filter(r => Number.isFinite(r.endDriftDays) && r.endDriftDays > 0).length,
  };
}

// ── Forecasthistoriek ───────────────────────────────────────────────────────
/**
 * Voeg een forecastregel toe. Bij conversie van offerte naar project blijft de
 * herkomst zo bewaard (acceptatie h38), en een fasewijziging kan de forecast
 * actualiseren zonder de vorige stand te wissen.
 */
function appendForecast(project, { amount, probability = 1, source, sourceId = null, reason, at = null, actor = null }) {
  const entry = {
    id: `fc_${newUlid()}`,
    at: at || new Date().toISOString(),
    amount: round2(num(amount, 0)),
    probability: Math.max(0, Math.min(1, num(probability, 1))),
    weighted: round2(num(amount, 0) * Math.max(0, Math.min(1, num(probability, 1)))),
    source: clean(source) || "manual",
    sourceId,
    reason: clean(reason),
    actor,
  };
  return { forecastHistory: [...(project.forecastHistory || []), entry], forecastAmount: entry.amount, forecastWeighted: entry.weighted };
}

/** De actuele forecast = de laatste regel in de historiek. */
function currentForecast(project) {
  const history = project.forecastHistory || [];
  return history.length ? history[history.length - 1] : null;
}

// ── Portfolio ───────────────────────────────────────────────────────────────
function winProbability(quote) {
  if (quote.winProbability != null) return Math.max(0, Math.min(1, num(quote.winProbability)));
  const status = clean(quote.status).toLowerCase();
  return DEFAULT_WIN_PROBABILITY[status] != null ? DEFAULT_WIN_PROBABILITY[status] : 0.3;
}

/**
 * Portfolio-overzicht. Projecten (vastgelegd werk) en gewogen offertes
 * (pipeline) staan APART, met eigen totalen · ze worden nooit tot één getal
 * samengevoegd (acceptatie h38).
 */
function buildPortfolio(store, tenant, { now = new Date() } = {}) {
  const today = now.toISOString().slice(0, 10);
  const projects = (store.list("projects", tenant.id) || [])
    .filter(p => !["cancelled", "archived"].includes(p.status))
    .map(p => {
      const cmp = comparePhases(p);
      const fc = currentForecast(p);
      return {
        projectId: p.id, number: p.number, name: p.name, status: p.status,
        customerId: p.customerId || null,
        startDate: p.startDate || null, endDate: p.endDate || null,
        budgetAmount: round2(num(p.budgetAmount, 0)),
        forecastAmount: fc ? fc.amount : round2(num(p.budgetAmount, 0)),
        phases: (p.phases || []).length,
        milestones: (p.phases || []).filter(ph => ph.milestone === true).length,
        hasBaseline: cmp.hasBaseline,
        maxEndDriftDays: cmp.maxEndDriftDays,
        delayedPhases: cmp.delayedPhases,
        overdue: !!(p.endDate && p.endDate < today && p.status !== "done"),
      };
    })
    .sort((a, b) => String(a.startDate || "9999").localeCompare(String(b.startDate || "9999")));

  const quotes = (store.list("quotes", tenant.id) || [])
    .filter(q => OPEN_QUOTE_STATUSES.includes(clean(q.status).toLowerCase()))
    .map(q => {
      const p = winProbability(q);
      const total = round2(num(q.total, 0));
      return {
        quoteId: q.id, number: q.number, customerId: q.customerId || null,
        clientName: q.clientName || "", status: q.status,
        amount: total, probability: p, weightedAmount: round2(total * p),
        expectedDate: q.validUntil || q.date || null,
        projectId: q.projectId || null,
      };
    })
    .sort((a, b) => b.weightedAmount - a.weightedAmount);

  return {
    generatedAt: now.toISOString(),
    projects,
    weightedQuotes: quotes,
    totals: {
      // Bewust twee gescheiden totalen (acceptatie h38).
      projectBudget: round2(projects.reduce((s, p) => s + p.budgetAmount, 0)),
      projectForecast: round2(projects.reduce((s, p) => s + p.forecastAmount, 0)),
      pipelineGross: round2(quotes.reduce((s, q) => s + q.amount, 0)),
      pipelineWeighted: round2(quotes.reduce((s, q) => s + q.weightedAmount, 0)),
      projectCount: projects.length,
      quoteCount: quotes.length,
      delayedProjects: projects.filter(p => p.delayedPhases > 0).length,
    },
  };
}

// ── Capaciteitsforecast ─────────────────────────────────────────────────────
function minutesOf(t) { const m = /^(\d{1,2}):(\d{2})$/.exec(clean(t)); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; }

/** Contractuele uren per week uit het werkrooster van een medewerker. */
function weeklyHours(employee) {
  const days = (employee && employee.workSchedule && employee.workSchedule.days) || {};
  let minutes = 0;
  for (const key of Object.keys(days)) {
    const s = minutesOf(days[key].start), e = minutesOf(days[key].end);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) minutes += e - s;
  }
  return round2(minutes / 60);
}

/** Periodesleutel + einddatum voor een bucket (maand of week). */
function periodsBetween(from, to, bucket) {
  const periods = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return periods;
  let cursor = new Date(start);
  while (cursor <= end) {
    if (bucket === "week") {
      const key = cursor.toISOString().slice(0, 10);
      const next = new Date(cursor.getTime() + 7 * 86400000);
      periods.push({ key: `W${key}`, start: key, end: new Date(next.getTime() - 86400000).toISOString().slice(0, 10), weeks: 1 });
      cursor = next;
    } else {
      const y = cursor.getUTCFullYear(), m = cursor.getUTCMonth();
      const first = new Date(Date.UTC(y, m, 1));
      const last = new Date(Date.UTC(y, m + 1, 0));
      const days = last.getUTCDate();
      periods.push({
        key: `${y}-${String(m + 1).padStart(2, "0")}`,
        start: first.toISOString().slice(0, 10),
        end: last.toISOString().slice(0, 10),
        weeks: round2(days / 7),
      });
      cursor = new Date(Date.UTC(y, m + 1, 1));
    }
    if (periods.length > 60) break;   // guard tegen absurde horizonnen
  }
  return periods;
}

/**
 * Capaciteitsforecast: beschikbare uren (uit werkroosters) versus geplande
 * uren (uit de planning), per periode ÉN per rol (acceptatie h38). Een tekort
 * is positief; overcapaciteit is negatief.
 *
 * De rol komt van de personeelsfiche (jobTitle); medewerkers zonder fiche
 * worden apart geteld onder "onbekend", zodat een gat in de stamdata zichtbaar
 * is in plaats van de cijfers stil te vertekenen.
 */
function buildCapacityForecast(store, tenant, { from, to, bucket = "month", now = new Date() } = {}) {
  const start = isoDate(from) || now.toISOString().slice(0, 10);
  const end = isoDate(to) || new Date(now.getTime() + 90 * 86400000).toISOString().slice(0, 10);
  const periods = periodsBetween(start, end, bucket === "week" ? "week" : "month");

  const employees = (store.list("employees", tenant.id) || []);
  const byUserId = new Map(employees.filter(e => e.userId).map(e => [String(e.userId), e]));
  const shifts = (store.list("shifts", tenant.id) || []);

  const rows = periods.map(period => {
    // Aanbod: contractuele uren van medewerkers die in deze periode in dienst zijn.
    const supplyByRole = {};
    for (const e of employees) {
      if (e.status !== "active") continue;
      if (e.activeFrom && e.activeFrom > period.end) continue;
      if (e.activeTo && e.activeTo < period.start) continue;
      const role = clean(e.jobTitle) || "onbekend";
      supplyByRole[role] = round2((supplyByRole[role] || 0) + weeklyHours(e) * period.weeks);
    }
    // Vraag: geplande uren uit de planning, toegewezen aan de rol van de medewerker.
    const demandByRole = {};
    for (const s of shifts) {
      if (!s.date || s.date < period.start || s.date > period.end) continue;
      const st = minutesOf(s.start), en = minutesOf(s.end);
      if (!Number.isFinite(st) || !Number.isFinite(en) || en <= st) continue;
      const hours = round2((en - st) / 60);
      for (const rid of [s.userId, ...(Array.isArray(s.assigneeIds) ? s.assigneeIds : [])].filter(Boolean)) {
        const emp = byUserId.get(String(rid));
        const role = emp ? (clean(emp.jobTitle) || "onbekend") : "onbekend";
        demandByRole[role] = round2((demandByRole[role] || 0) + hours);
      }
    }
    const roles = [...new Set([...Object.keys(supplyByRole), ...Object.keys(demandByRole)])].sort();
    const perRole = roles.map(role => {
      const available = round2(supplyByRole[role] || 0);
      const planned = round2(demandByRole[role] || 0);
      return {
        role, availableHours: available, plannedHours: planned,
        shortfallHours: round2(Math.max(0, planned - available)),
        slackHours: round2(Math.max(0, available - planned)),
        utilizationPct: available > 0 ? round2(planned / available * 100) : (planned > 0 ? null : 0),
      };
    });
    return {
      period: period.key, start: period.start, end: period.end,
      roles: perRole,
      availableHours: round2(perRole.reduce((s, r) => s + r.availableHours, 0)),
      plannedHours: round2(perRole.reduce((s, r) => s + r.plannedHours, 0)),
      shortfallHours: round2(perRole.reduce((s, r) => s + r.shortfallHours, 0)),
    };
  });

  return {
    generatedAt: now.toISOString(),
    from: start, to: end, bucket: bucket === "week" ? "week" : "month",
    periods: rows,
    // Alleen echte tekorten, zodat de planner meteen ziet waar het knelt.
    shortfalls: rows.flatMap(p => p.roles.filter(r => r.shortfallHours > 0).map(r => ({ period: p.period, ...r }))),
    totals: {
      availableHours: round2(rows.reduce((s, p) => s + p.availableHours, 0)),
      plannedHours: round2(rows.reduce((s, p) => s + p.plannedHours, 0)),
      shortfallHours: round2(rows.reduce((s, p) => s + p.shortfallHours, 0)),
    },
  };
}

module.exports = {
  DEFAULT_WIN_PROBABILITY, OPEN_QUOTE_STATUSES,
  captureBaseline, comparePhases, appendForecast, currentForecast,
  winProbability, buildPortfolio,
  weeklyHours, periodsBetween, buildCapacityForecast,
};
