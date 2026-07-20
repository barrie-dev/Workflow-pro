"use strict";
/**
 * Dimona-registratie en -bewaking · BEWUST GEEN AANGIFTEKANAAL.
 *
 * Productbeslissing (2026-07-20): Monargo geeft NIETS aan bij de RSZ. De
 * Dimona-aangifte zelf gebeurt door het sociaal secretariaat (of wie de
 * klant daarvoor aanduidt). Wat het platform wél doet:
 *
 *  1. REGISTREREN · op de personeelsfiche vastleggen dat de aangifte extern
 *     gebeurd is (type IN/OUT, datum, referentienummer van het secretariaat).
 *  2. BEWAKEN · hiaten signaleren: een actieve medewerker zonder
 *     geregistreerde Dimona-IN of iemand uit dienst zonder OUT verschijnt in
 *     het register en op het compliance-dashboard, zodat de doorgifte aan het
 *     secretariaat nooit vergeten wordt.
 *
 * Er is dus geen provider, geen OAuth en geen mock-verzending · alleen
 * administratie en een waakhond.
 */

const TYPES = ["in", "out"];

function fail(status, code, message) {
  const e = new Error(message);
  e.status = status; e.code = code;
  throw e;
}

/**
 * Valideer en normaliseer een extern gedane Dimona-registratie.
 * @returns {{type:string, date:string, reference:string, note:string}}
 */
function normalizeDimonaRecord({ type, date, reference, note } = {}, employee = null) {
  const kind = String(type || "").toLowerCase();
  if (!TYPES.includes(kind)) fail(400, "INVALID_TYPE", "Type moet 'in' of 'out' zijn");
  if (employee && employee.external) fail(400, "EXTERNAL_EMPLOYEE", "Externe medewerkers (onderaannemers) vallen onder de Dimona van hun eigen werkgever");
  const effective = String(date || (employee ? (kind === "in" ? employee.activeFrom : employee.activeTo) : "") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective)) {
    fail(400, "DATE_REQUIRED", kind === "out"
      ? "Einddatum ontbreekt (zet de uitdienstdatum op de fiche of geef een datum mee)"
      : "Startdatum ontbreekt (zet de indienstdatum op de fiche of geef een datum mee)");
  }
  return {
    type: kind,
    date: effective,
    reference: String(reference || "").trim().slice(0, 60),
    note: String(note || "").trim().slice(0, 200),
  };
}

/**
 * Register + hiaten: elke actieve, interne medewerker hoort een geregistreerde
 * Dimona-IN te hebben; wie uit dienst is een OUT. Puur + testbaar.
 */
function dimonaRegister(store, tenantId, today = new Date().toISOString().slice(0, 10)) {
  const rows = [];
  const gaps = [];
  for (const emp of store.list("employees", tenantId) || []) {
    if (emp.external || emp.status === "archived") continue;
    const dimona = emp.dimona || null;
    const started = !emp.activeFrom || emp.activeFrom <= today;
    // In dienst OF start nog: de Dimona-IN moet er VOOR de eerste werkdag
    // zijn, dus ook een toekomstige starter zonder registratie is een hiaat.
    const inService = (!emp.activeTo || emp.activeTo >= today) && emp.status !== "left";
    rows.push({
      employeeId: emp.id, name: emp.name, activeFrom: emp.activeFrom || null, activeTo: emp.activeTo || null,
      registered: !!dimona, type: dimona ? dimona.type : null,
      reference: dimona ? dimona.reference : null, date: dimona ? dimona.date : null, at: dimona ? dimona.at : null,
    });
    if (inService && (!dimona || dimona.type !== "in")) {
      gaps.push({ employeeId: emp.id, name: emp.name, reason: !dimona
        ? (started
          ? "geen Dimona geregistreerd · geef door aan het sociaal secretariaat"
          : `start op ${emp.activeFrom} · Dimona moet VOOR de eerste werkdag bij het sociaal secretariaat zijn`)
        : "laatste registratie is geen IN" });
    }
    if (!inService && emp.activeTo && emp.activeTo < today && dimona && dimona.type !== "out") {
      gaps.push({ employeeId: emp.id, name: emp.name, reason: "uit dienst zonder geregistreerde Dimona-OUT" });
    }
  }
  return { rows, gaps };
}

module.exports = { normalizeDimonaRecord, dimonaRegister, TYPES };
