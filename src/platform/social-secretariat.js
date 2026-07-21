"use strict";
/**
 * Sociaal-secretariaat-integratie · PRESTATIE-EXPORT, BEWUST GEEN AANGIFTE.
 *
 * Productbeslissing (2026-07-20, herbevestigd): Monargo geeft NIETS aan bij de
 * RSZ. De loonverwerking, de RSZ-aangifte, de bedrijfsvoorheffing en de
 * loonbrieven gebeuren door het SOCIAAL SECRETARIAAT (SD Worx, Securex, Acerta,
 * Partena, Liantis, Group S, UCM ...). Wat het platform wél doet:
 *
 *   De PRESTATIES van een periode aanleveren, zodat het secretariaat kan
 *   verlonen. Concreet: per medewerker de gewerkte uren (uit de prikklok) en
 *   de goedgekeurde afwezigheden (verlof, ziekte, feestdag ...), vertaald naar
 *   prestatiecodes, als een gestructureerd bestand dat het secretariaat inleest.
 *
 * Dit is een OVERDRACHT, geen aangifte. Er is geen RSZ-koppeling, geen
 * automatische verzending naar de overheid. Net zoals Dimona hier alleen
 * geregistreerd/bewaakt wordt en Publiato enkel een exportdossier is.
 *
 * PROVIDER-ONAFHANKELIJK: de basis is een generiek prestatiebestand (CSV/JSON)
 * dat elk secretariaat kan importeren. De prestatiecodes zijn configureerbaar
 * per secretariaat (elk hanteert eigen codes); we leveren zinvolle defaults.
 * Een echte API-koppeling met één secretariaat kan later een dunne adapter
 * worden achter dezelfde vorm · de kern (prestatie-aggregatie) blijft gelijk.
 */

const { normalizeInsz, validInsz } = require("../modules/ciaw");

// Interne, provider-neutrale prestatiecodes met eenheid. Het ECHTE codenummer
// van het secretariaat komt uit de tenantconfiguratie (codeMap); dit zijn de
// defaults zodat een export meteen bruikbaar is.
const PRESTATION_CODES = {
  work:      { code: "1", label: "Gewerkte uren", unit: "hours" },
  vakantie:  { code: "2", label: "Vakantie", unit: "days" },
  ziekte:    { code: "3", label: "Ziekte", unit: "days" },
  feestdag:  { code: "4", label: "Feestdag", unit: "days" },
  onbetaald: { code: "5", label: "Onbetaald verlof", unit: "days" },
  overmacht: { code: "6", label: "Overmacht", unit: "days" },
  educatie:  { code: "7", label: "Educatief verlof", unit: "days" },
};
const LEAVE_TO_CODE = {
  vakantie: "vakantie", ziekte: "ziekte", feestdag: "feestdag",
  onbetaald: "onbetaald", overmacht: "overmacht", educatie: "educatie",
};

const KNOWN_PROVIDERS = ["generic", "sdworx", "securex", "acerta", "partena", "liantis", "groups", "ucm"];

function clean(v) { return String(v == null ? "" : v).trim(); }
function isoDate(v) { const s = clean(v); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }
function isWeekend(dateStr) { const d = new Date(dateStr + "T00:00:00Z").getUTCDay(); return d === 0 || d === 6; }

/** Elke werkdag (weekend uitgesloten) in [from,to], inclusief. */
function workingDaysBetween(from, to) {
  const out = [];
  if (!isoDate(from) || !isoDate(to) || from > to) return out;
  let cur = from;
  for (let i = 0; i < 400 && cur <= to; i++) {
    if (!isWeekend(cur)) out.push(cur);
    const d = new Date(cur + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1);
    cur = d.toISOString().slice(0, 10);
  }
  return out;
}

/** De config van het sociaal secretariaat leeft bij de compliance-gegevens. */
function readConfig(tenant) {
  const c = (tenant && tenant.compliance && tenant.compliance.socialSecretariat) || {};
  const provider = KNOWN_PROVIDERS.includes(clean(c.provider).toLowerCase()) ? clean(c.provider).toLowerCase() : "generic";
  return {
    provider,
    affiliateNumber: clean(c.affiliateNumber),          // aansluitingsnummer bij het secretariaat
    codeMap: (c.codeMap && typeof c.codeMap === "object") ? c.codeMap : {},
  };
}

/** Prestatiecode voor een intern type, met de secretariaat-override erop. */
function resolveCode(codeMap, key) {
  const base = PRESTATION_CODES[key] || PRESTATION_CODES.work;
  const override = clean(codeMap[key]);
  return { code: override || base.code, label: base.label, unit: base.unit, key };
}

/** Werknemers van een tenant (geen super-admin, geen externe onderaannemers). */
function employeesOf(store, tenantId) {
  return store.list("users", tenantId).filter(u => u.role !== "super_admin" && !u.external);
}

/**
 * Bouw de prestatie-export voor een periode. Puur en testbaar: geen I/O, geen
 * verzending. Aggregeert per werkdag gewerkte uren (prikklok · durationMinutes,
 * dus mét de pauzeregels van de tenant) en goedgekeurde afwezigheden.
 *
 * @returns {{ period, employer, provider, affiliateNumber, employees:[], totals, warnings:[] }}
 */
function buildPayrollExport(store, tenant, { from, to } = {}) {
  const f = isoDate(from), t = isoDate(to);
  if (!f || !t) { const e = new Error("Geef een geldige periode (from/to als YYYY-MM-DD)"); e.status = 400; e.code = "INVALID_PERIOD"; throw e; }
  if (f > t) { const e = new Error("Startdatum ligt na einddatum"); e.status = 400; e.code = "INVALID_PERIOD"; throw e; }

  const cfg = readConfig(tenant);
  const rszEmployerId = clean(tenant.compliance && tenant.compliance.rszEmployerId);
  const clocks = store.list("clocks", tenant.id);
  const leaves = store.list("leaves", tenant.id).filter(l => l.status === "goedgekeurd");

  const employeesOut = [];
  const warnings = [];
  let totalWorkedHours = 0, totalLeaveDays = 0;

  for (const emp of employeesOf(store, tenant.id)) {
    const insz = normalizeInsz(emp.insz || emp.nationalNumber || emp.nationalId);
    const empWarnings = [];
    if (!validInsz(insz)) empWarnings.push("Geen geldig INSZ/rijksregisternummer op de fiche · het secretariaat kan deze werknemer niet verwerken");

    // Per werkdag: gewerkte minuten en (indien afwezig) het verloftype.
    const byDate = new Map();
    let openClock = false;
    for (const c of clocks) {
      if (c.userId !== emp.id) continue;
      const d = isoDate(c.date);
      if (!d || d < f || d > t) continue;
      if (!c.clockOut) { openClock = true; continue; }   // niet uitgeklokt → uren onvolledig
      const entry = byDate.get(d) || { workMin: 0, leave: null };
      entry.workMin += Number(c.durationMinutes || 0);
      byDate.set(d, entry);
    }
    if (openClock) empWarnings.push("Nog niet-afgesloten prikkingen in de periode · de gewerkte uren zijn mogelijk onvolledig");

    for (const l of leaves) {
      if (l.userId !== emp.id) continue;
      const start = isoDate(l.startDate), end = isoDate(l.endDate || l.startDate);
      if (!start || !end) continue;
      const overlapFrom = start > f ? start : f;
      const overlapTo = end < t ? end : t;
      for (const d of workingDaysBetween(overlapFrom, overlapTo)) {
        const entry = byDate.get(d) || { workMin: 0, leave: null };
        if (!entry.leave) entry.leave = String(l.type || "vakantie").toLowerCase();
        byDate.set(d, entry);
      }
    }

    // Prestatielijnen per dag: gewerkt (uren) wint van afwezigheid; een dag met
    // beide krijgt de uren én een waarschuwing (dubbele boeking).
    const lines = [];
    let workedHours = 0, workedDays = 0, leaveDays = 0;
    for (const d of [...byDate.keys()].sort()) {
      const entry = byDate.get(d);
      const hours = round2(entry.workMin / 60);
      if (hours > 0) {
        const code = resolveCode(cfg.codeMap, "work");
        lines.push({ date: d, code: code.code, key: "work", label: code.label, quantity: hours, unit: "hours" });
        workedHours += hours; workedDays += 1;
        if (entry.leave) empWarnings.push(`Op ${d} staan zowel prestaties als afwezigheid (${entry.leave}) · controleer`);
      } else if (entry.leave) {
        const key = LEAVE_TO_CODE[entry.leave] || "onbetaald";
        const code = resolveCode(cfg.codeMap, key);
        lines.push({ date: d, code: code.code, key, label: code.label, quantity: 1, unit: "days" });
        leaveDays += 1;
      }
    }
    workedHours = round2(workedHours);
    totalWorkedHours = round2(totalWorkedHours + workedHours);
    totalLeaveDays += leaveDays;

    employeesOut.push({
      employeeId: emp.id, name: emp.name || emp.email || emp.id,
      insz: insz || null, inszValid: validInsz(insz),
      workedHours, workedDays, leaveDays,
      lines, warnings: empWarnings,
    });
    if (empWarnings.length) warnings.push({ employeeId: emp.id, name: emp.name, issues: empWarnings });
  }

  if (!rszEmployerId) warnings.unshift({ employeeId: null, name: null, issues: ["RSZ-werkgeversnummer ontbreekt op de organisatie (compliance.rszEmployerId)"] });
  if (!cfg.affiliateNumber) warnings.unshift({ employeeId: null, name: null, issues: ["Aansluitingsnummer bij het sociaal secretariaat ontbreekt (Instellingen · Sociaal secretariaat)"] });

  return {
    period: { from: f, to: t },
    employer: { rszEmployerId: rszEmployerId || null, name: tenant.name || "" },
    provider: cfg.provider,
    affiliateNumber: cfg.affiliateNumber || null,
    generatedAt: new Date().toISOString(),
    employees: employeesOut,
    totals: {
      employees: employeesOut.length,
      workedHours: totalWorkedHours,
      leaveDays: totalLeaveDays,
      exportable: employeesOut.filter(e => e.inszValid && e.lines.length).length,
    },
    warnings,
  };
}

/**
 * Serialiseer naar een generiek prestatiebestand (CSV). Eén rij per
 * prestatielijn; kolommen die elk secretariaat kan mappen. Puntkomma als
 * scheidingsteken (BE/Excel-conventie); waarden worden veilig geciteerd.
 */
function toCsv(exportData, { separator = ";" } = {}) {
  // Citeer alleen op het ECHTE scheidingsteken, aanhalingstekens en
  // nieuwe regels · niet op de komma (die is bij ';'-CSV de decimaalkomma).
  const esc = v => {
    const s = String(v == null ? "" : v);
    return (s.includes(separator) || s.includes('"') || /[\r\n]/.test(s)) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const unitNL = u => (u === "hours" ? "uren" : u === "days" ? "dagen" : u);
  const header = ["rsz_werkgever", "aansluitingsnummer", "insz", "naam", "datum", "code", "omschrijving", "aantal", "eenheid"];
  const rows = [header.join(separator)];
  for (const emp of exportData.employees) {
    for (const line of emp.lines) {
      rows.push([
        exportData.employer.rszEmployerId || "", exportData.affiliateNumber || "",
        emp.insz || "", emp.name, line.date, line.code, line.label,
        String(line.quantity).replace(".", ","), unitNL(line.unit),
      ].map(esc).join(separator));
    }
  }
  return rows.join("\r\n") + "\r\n";
}

/**
 * Gereedheid van de koppeling: is er genoeg geconfigureerd om te exporteren?
 * Mock-vriendelijk · een generiek CSV-bestand kan altijd, maar we melden wat
 * nog ontbreekt voor een vlekkeloze verwerking door het secretariaat.
 */
function payrollReadiness(tenant) {
  const cfg = readConfig(tenant);
  const rsz = clean(tenant.compliance && tenant.compliance.rszEmployerId);
  const missing = [];
  if (!cfg.affiliateNumber) missing.push("aansluitingsnummer");
  if (!rsz) missing.push("rsz_werkgeversnummer");
  return {
    provider: cfg.provider,
    affiliateNumber: cfg.affiliateNumber || null,
    rszEmployerId: rsz || null,
    ready: missing.length === 0,
    missing,
    note: "Export is een overdracht aan het sociaal secretariaat · Monargo doet zelf geen RSZ-aangifte.",
  };
}

module.exports = {
  buildPayrollExport, toCsv, payrollReadiness, readConfig,
  PRESTATION_CODES, KNOWN_PROVIDERS, workingDaysBetween,
};
