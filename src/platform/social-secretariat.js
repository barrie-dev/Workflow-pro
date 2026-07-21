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
// (looncode) van het secretariaat komt uit de tenantconfiguratie (codeMap of
// de provider-defaults); dit zijn de basiswaarden zodat een export meteen
// bruikbaar is. Bij de onboarding bevestigt de klant de codes met zijn
// secretariaat.
const PRESTATION_CODES = {
  work:      { code: "1", label: "Gewerkte uren", unit: "hours" },
  overtime:  { code: "10", label: "Overuren", unit: "hours" },
  weekend:   { code: "11", label: "Weekendwerk", unit: "hours" },
  night:     { code: "12", label: "Nachtwerk (toeslag)", unit: "hours" },
  vakantie:  { code: "2", label: "Vakantie", unit: "days" },
  ziekte:    { code: "3", label: "Ziekte", unit: "days" },
  feestdag:  { code: "4", label: "Feestdag", unit: "days" },
  onbetaald: { code: "5", label: "Onbetaald verlof", unit: "days" },
  overmacht: { code: "6", label: "Overmacht", unit: "days" },
  educatie:  { code: "7", label: "Educatief verlof", unit: "days" },
  adv:       { code: "8", label: "ADV/inhaalrust", unit: "days" },
  klein_verlet: { code: "9", label: "Klein verlet", unit: "days" },
};
// Verloftype (leaves.type) → interne prestatiecode-sleutel. Onbekende types
// vallen terug op "onbetaald" mét een waarschuwing (niet stil verzwegen).
const LEAVE_TO_CODE = {
  vakantie: "vakantie", ziekte: "ziekte", feestdag: "feestdag",
  onbetaald: "onbetaald", overmacht: "overmacht", educatie: "educatie",
  adv: "adv", recup: "adv", inhaalrust: "adv",
  klein_verlet: "klein_verlet", "klein verlet": "klein_verlet", kortverzuim: "klein_verlet",
};

// Sociale secretariaten in België. De providerkeuze bepaalt de default-looncodes
// en de bestandslabeling; de klant kan elke code overschrijven (codeMap).
const PROVIDERS = {
  generic:  { label: "Algemeen (generiek bestand)" },
  acerta:   { label: "Acerta" },
  sdworx:   { label: "SD Worx" },
  securex:  { label: "Securex" },
  partena:  { label: "Partena Professional" },
  liantis:  { label: "Liantis" },
  groups:   { label: "Group S" },
  ucm:      { label: "UCM" },
};
const KNOWN_PROVIDERS = Object.keys(PROVIDERS);

const DEFAULT_DAILY_NORM = 8;   // uren/dag als er geen werkrooster is

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
  const nw = c.nightWindow || {};
  const nightFrom = /^\d{2}:\d{2}$/.test(clean(nw.from)) ? clean(nw.from) : null;
  const nightTo = /^\d{2}:\d{2}$/.test(clean(nw.to)) ? clean(nw.to) : null;
  return {
    provider,
    affiliateNumber: clean(c.affiliateNumber),          // aansluitingsnummer bij het secretariaat
    codeMap: (c.codeMap && typeof c.codeMap === "object") ? c.codeMap : {},
    dailyNormHours: Number(c.dailyNormHours) > 0 ? Number(c.dailyNormHours) : DEFAULT_DAILY_NORM,
    // Nachtwerk enkel meten als een venster geconfigureerd is (bv. 22:00-06:00);
    // anders geen aannames.
    nightWindow: (nightFrom && nightTo) ? { from: nightFrom, to: nightTo } : null,
  };
}

function toMin(hhmm) { const m = /^(\d{2}):(\d{2})$/.exec(clean(hhmm)); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }

/**
 * Minuten van een prikking [in,out] die in het nachtvenster vallen. Prikkingen
 * zijn per dag; een venster als 22:00-06:00 overspant middernacht, dus we tellen
 * de overlap met [nachtstart, 24:00) én [00:00, nachteinde).
 */
function nightMinutes(clockIn, clockOut, window) {
  if (!window) return 0;
  const s = toMin(clockIn), e = toMin(clockOut);
  if (s == null || e == null || e <= s) return 0;
  const ns = toMin(window.from), ne = toMin(window.to);
  if (ns == null || ne == null) return 0;
  const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  if (ns > ne) {   // overspant middernacht
    return overlap(s, e, ns, 1440) + overlap(s, e, 0, ne);
  }
  return overlap(s, e, ns, ne);
}

/** Dagnorm (uren) voor een werknemer: uit het werkrooster indien aanwezig, anders config. */
function dailyNormFor(emp, cfgNorm) {
  const days = (emp && emp.workSchedule && emp.workSchedule.days) || null;
  if (days && typeof days === "object") {
    const vals = Object.values(days).map(d => {
      const s = toMin(d && d.start), e = toMin(d && d.end);
      return (s != null && e != null && e > s) ? (e - s) / 60 : 0;
    }).filter(h => h > 0);
    if (vals.length) return round2(vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  return cfgNorm;
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

    // Per werkdag: gewerkte minuten, nachtminuten en (indien afwezig) verloftype.
    const norm = dailyNormFor(emp, cfg.dailyNormHours);
    const byDate = new Map();
    let openClock = false;
    for (const c of clocks) {
      if (c.userId !== emp.id) continue;
      const d = isoDate(c.date);
      if (!d || d < f || d > t) continue;
      if (!c.clockOut) { openClock = true; continue; }   // niet uitgeklokt → uren onvolledig
      const entry = byDate.get(d) || { workMin: 0, nightMin: 0, leave: null };
      entry.workMin += Number(c.durationMinutes || 0);
      entry.nightMin += nightMinutes(c.clockIn, c.clockOut, cfg.nightWindow);
      byDate.set(d, entry);
    }
    if (openClock) empWarnings.push("Nog niet-afgesloten prikkingen in de periode · de gewerkte uren zijn mogelijk onvolledig");

    for (const l of leaves) {
      if (l.userId !== emp.id) continue;
      const start = isoDate(l.startDate), end = isoDate(l.endDate || l.startDate);
      if (!start || !end) continue;
      const overlapFrom = start > f ? start : f;
      const overlapTo = end < t ? end : t;
      const type = String(l.type || "vakantie").toLowerCase();
      if (!LEAVE_TO_CODE[type]) empWarnings.push(`Onbekend verloftype '${type}' · geëxporteerd als onbetaald verlof · controleer de code`);
      for (const d of workingDaysBetween(overlapFrom, overlapTo)) {
        const entry = byDate.get(d) || { workMin: 0, nightMin: 0, leave: null };
        if (!entry.leave) entry.leave = type;
        byDate.set(d, entry);
      }
    }

    // Prestatielijnen per dag. Gewerkte uren winnen van afwezigheid; het weekend
    // krijgt een eigen code; op weekdagen splitsen we normaal/overuren op de
    // dagnorm; nachturen komen als aparte toeslaglijn (additief).
    const lines = [];
    let workedHours = 0, workedDays = 0, leaveDays = 0, overtimeHours = 0, weekendHours = 0, nightHours = 0;
    const addLine = (d, key, quantity, unit) => {
      const code = resolveCode(cfg.codeMap, key);
      lines.push({ date: d, code: code.code, key, label: code.label, quantity: round2(quantity), unit });
    };
    for (const d of [...byDate.keys()].sort()) {
      const entry = byDate.get(d);
      const hours = round2(entry.workMin / 60);
      if (hours > 0) {
        workedHours += hours; workedDays += 1;
        if (isWeekend(d)) {
          addLine(d, "weekend", hours, "hours"); weekendHours += hours;
        } else if (hours > norm) {
          addLine(d, "work", norm, "hours");
          addLine(d, "overtime", hours - norm, "hours"); overtimeHours += (hours - norm);
        } else {
          addLine(d, "work", hours, "hours");
        }
        const nh = round2(entry.nightMin / 60);
        if (nh > 0) { addLine(d, "night", nh, "hours"); nightHours += nh; }
        if (entry.leave) empWarnings.push(`Op ${d} staan zowel prestaties als afwezigheid (${entry.leave}) · controleer`);
      } else if (entry.leave) {
        const key = LEAVE_TO_CODE[entry.leave] || "onbetaald";
        addLine(d, key, 1, "days"); leaveDays += 1;
      }
    }
    workedHours = round2(workedHours);
    totalWorkedHours = round2(totalWorkedHours + workedHours);
    totalLeaveDays += leaveDays;

    employeesOut.push({
      employeeId: emp.id, name: emp.name || emp.email || emp.id,
      insz: insz || null, inszValid: validInsz(insz),
      workedHours, workedDays, leaveDays,
      overtimeHours: round2(overtimeHours), weekendHours: round2(weekendHours), nightHours: round2(nightHours),
      dailyNorm: norm,
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
    providerLabel: (PROVIDERS[cfg.provider] || PROVIDERS.generic).label,
    affiliateNumber: cfg.affiliateNumber || null,
    generatedAt: new Date().toISOString(),
    employees: employeesOut,
    totals: {
      employees: employeesOut.length,
      workedHours: totalWorkedHours,
      overtimeHours: round2(employeesOut.reduce((s, e) => s + e.overtimeHours, 0)),
      weekendHours: round2(employeesOut.reduce((s, e) => s + e.weekendHours, 0)),
      nightHours: round2(employeesOut.reduce((s, e) => s + e.nightHours, 0)),
      leaveDays: totalLeaveDays,
      exportable: employeesOut.filter(e => e.inszValid && e.lines.length).length,
    },
    warnings,
  };
}

/**
 * Maandelijkse samenvatting voor een proactieve melding ("prestatiestaat van
 * <maand> klaar om door te sturen"). Neemt de VORIGE volledige maand.
 * @returns {{ month, from, to, employees, workedHours, leaveDays, exportable, hasData }}
 */
function buildPayrollDigest(store, tenant, now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth();      // 0-based
  const prev = new Date(Date.UTC(y, m - 1, 1));
  const from = prev.toISOString().slice(0, 10);
  const to = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const data = buildPayrollExport(store, tenant, { from, to });
  return {
    month: from.slice(0, 7), from, to,
    employees: data.totals.employees,
    workedHours: data.totals.workedHours,
    leaveDays: data.totals.leaveDays,
    exportable: data.totals.exportable,
    provider: data.provider, providerLabel: data.providerLabel,
    hasData: data.totals.workedHours > 0 || data.totals.leaveDays > 0,
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
  const label = (PROVIDERS[cfg.provider] || PROVIDERS.generic).label;
  return {
    provider: cfg.provider,
    providerLabel: label,
    affiliateNumber: cfg.affiliateNumber || null,
    rszEmployerId: rsz || null,
    dailyNormHours: cfg.dailyNormHours,
    nightWindow: cfg.nightWindow,
    hasCustomCodes: Object.keys(cfg.codeMap).length > 0,
    ready: missing.length === 0,
    missing,
    note: "Export is een overdracht aan het sociaal secretariaat · Monargo doet zelf geen RSZ-aangifte.",
    codeNote: cfg.provider === "generic"
      ? "Bevestig de looncodes met je sociaal secretariaat."
      : `Bevestig de looncodes met ${label} bij de onboarding; je kan ze per prestatie overschrijven.`,
  };
}

/** Lijst van providers voor een keuzemenu. */
function providerList() {
  return KNOWN_PROVIDERS.map(key => ({ key, label: PROVIDERS[key].label }));
}

module.exports = {
  buildPayrollExport, buildPayrollDigest, toCsv, payrollReadiness, readConfig, providerList,
  PRESTATION_CODES, PROVIDERS, KNOWN_PROVIDERS, workingDaysBetween, nightMinutes,
};
