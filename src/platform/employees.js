"use strict";
/**
 * Werknemers, teams, vaardigheden en capaciteit (master-spec h16/EMP · P0).
 *
 * Doel: operationele personeelsdata beheren ZONDER een HR- of loonpakket na te
 * bouwen. Het personeelsdossier blijft bewust beperkt (h9: "Personeelsdossier
 * beperkt houden").
 *
 * Business rules (h16):
 *  - Kosttarieven zijn DATUMGEBONDEN, zodat historische nacalculatie correct
 *    blijft: een werkbon rekent met het tarief dat gold op de UITVOERINGSDATUM,
 *    ook als het tarief later wijzigt (acceptatie h16 + h25).
 *  - Een gebruiker en een werknemer zijn APARTE entiteiten met een optionele
 *    één-op-éénkoppeling (userId).
 *  - Een medewerker kan meerdere vaardigheden en planningsgroepen hebben.
 *  - Externe medewerkers kunnen aan een leverancier gekoppeld worden.
 *  - Een uit dienst gezette medewerker behoudt historiek maar kan niet nieuw
 *    worden gepland (acceptatie).
 *  - Planning buiten het werkrooster geeft een waarschuwing of blokkering
 *    volgens beleid; availabilityOn levert de reden(en) terug zodat de
 *    aanroeper kan kiezen.
 *  - Persoonsgegevens worden afgeschermd volgens rol (policy.redactSensitive).
 *
 * Cloudblind (ADR-001): geen SDK, geen SQL, geen omgevingsvariabelen.
 */

const { newUlid } = require("./events");
const { round2 } = require("../modules/be-locale");
const { normalizeInsz, validInsz } = require("../modules/ciaw");

const EMP_STATUSES = ["candidate", "active", "temporarily_absent", "left", "archived"];
const EMP_TRANSITIONS = {
  candidate: ["active", "archived"],
  active: ["temporarily_absent", "left", "archived"],
  temporarily_absent: ["active", "left", "archived"],
  left: ["archived", "active"],          // herindiensttreding blijft mogelijk
  archived: [],
};
// Enkel vanuit deze statussen mag nieuw gepland worden (acceptatie h16).
const PLANNABLE_STATUSES = ["active"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function clean(v) { return String(v == null ? "" : v).trim(); }

// INSZ is optioneel, maar een ingevuld nummer moet de mod-97-controle halen ·
// een fout rijksregisternummer laat elke wettelijke aangifte (Dimona/CIAW) falen.
function normalizeEmployeeInsz(value) {
  const insz = normalizeInsz(value);
  if (!insz) return "";
  if (!validInsz(insz)) { const e = new Error("Ongeldig INSZ/rijksregisternummer"); e.status = 400; e.code = "INVALID_INSZ"; throw e; }
  return insz;
}
function num(v, dflt = 0) { const n = Number(v); return Number.isFinite(n) ? n : dflt; }
function isoDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : null; }
function isTime(v) { return /^\d{1,2}:\d{2}$/.test(clean(v)); }
function canTransition(from, to) { return (EMP_TRANSITIONS[from] || []).includes(to); }

// ── Werkrooster ─────────────────────────────────────────────────────────────
/** Weekpatroon: per weekdag een blok {start,end}; ontbrekende dag = vrij. */
function normalizeSchedule(input) {
  const src = input && typeof input === "object" ? input : {};
  const days = {};
  for (const d of WEEKDAYS) {
    const block = src[d];
    if (!block || !isTime(block.start) || !isTime(block.end)) continue;
    days[d] = { start: clean(block.start), end: clean(block.end) };
  }
  return { days, note: clean(src.note) };
}

function weekdayOf(dateStr) {
  // Vaste UTC-interpretatie: een rooster hangt aan de kalenderdag, niet aan de
  // lokale tijdzone van de server.
  return WEEKDAYS[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
}

// ── Datumgebonden tarieven ──────────────────────────────────────────────────
/**
 * Tariefversies, nieuwste eerst gesorteerd op validFrom. Elke versie draagt
 * kost- én verkooptarief; historische versies worden nooit gewijzigd.
 */
function normalizeRates(input) {
  return (Array.isArray(input) ? input : [])
    .map(r => {
      const validFrom = isoDate(r && r.validFrom);
      if (!validFrom) return null;
      return {
        id: clean(r.id) || `rate_${newUlid()}`,
        validFrom,
        costRate: round2(Math.max(0, num(r.costRate, 0))),
        salesRate: round2(Math.max(0, num(r.salesRate, 0))),
        hourCode: clean(r.hourCode) || "normaal",
        note: clean(r.note),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom));
}

/**
 * Het tarief dat geldig was op `date`. Dit is DE bron voor werkbonkosten:
 * een tariefwijziging midden in een project verandert nooit met terugwerkende
 * kracht wat een uitgevoerde werkbon kostte (h16-acceptatie, edge case
 * "kosttarief wijzigt midden project").
 */
function rateOn(employee, date) {
  const d = isoDate(date) || new Date().toISOString().slice(0, 10);
  const rates = Array.isArray(employee && employee.costRates) ? employee.costRates : [];
  const applicable = rates.filter(r => r.validFrom <= d).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
  if (!applicable) return { costRate: 0, salesRate: 0, hourCode: "normaal", validFrom: null, found: false };
  return { ...applicable, found: true };
}

// ── Vaardigheden en attesten ────────────────────────────────────────────────
function normalizeSkills(input) {
  return (Array.isArray(input) ? input : [])
    .map(s => {
      const key = clean(s && (s.key || s.label)).toLowerCase().replace(/\s+/g, "_");
      const label = clean(s && (s.label || s.key));
      if (!key || !label) return null;
      const level = ["basis", "gevorderd", "expert"].includes(s.level) ? s.level : "basis";
      return { key, label, level };
    })
    .filter(Boolean)
    .slice(0, 50);
}

/** Attesten met vervaldatum · voeden de automatisering "taak bij vervallend attest". */
function normalizeCertificates(input) {
  return (Array.isArray(input) ? input : [])
    .map(c => {
      const label = clean(c && (c.label || c.key));
      if (!label) return null;
      return {
        id: clean(c.id) || `cert_${newUlid()}`,
        key: clean(c.key || label).toLowerCase().replace(/\s+/g, "_"),
        label,
        issuedAt: isoDate(c.issuedAt),
        expiresAt: isoDate(c.expiresAt),
        documentRef: clean(c.documentRef) || null,
      };
    })
    .filter(Boolean)
    .slice(0, 50);
}

/** Attesten die verlopen zijn of binnen de horizon vervallen (h16-automatisering). */
function expiringCertificates(employee, { now = new Date(), horizonDays = 60 } = {}) {
  const today = now.toISOString().slice(0, 10);
  const limit = new Date(now.getTime() + horizonDays * 86400000).toISOString().slice(0, 10);
  return (employee.certificates || [])
    .filter(c => c.expiresAt && c.expiresAt <= limit)
    .map(c => ({ ...c, expired: c.expiresAt < today, daysLeft: Math.round((new Date(`${c.expiresAt}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000) }));
}

// ── Normalisatie ────────────────────────────────────────────────────────────
function normalizeEmployee(payload, existing = null) {
  const merged = { ...(existing || {}), ...(payload || {}) };
  const name = clean(merged.name);
  if (!name) { const e = new Error("Naam is verplicht"); e.status = 400; throw e; }
  const activeFrom = isoDate(merged.activeFrom);
  const activeTo = isoDate(merged.activeTo);
  if (activeFrom && activeTo && activeTo < activeFrom) {
    const e = new Error("Einddatum ligt vóór de startdatum"); e.status = 400; e.code = "INVALID_PERIOD"; throw e;
  }
  const external = merged.external === true || !!clean(merged.supplierId);
  if (external && !clean(merged.supplierId)) {
    const e = new Error("Een externe medewerker vereist een leverancier"); e.status = 400; e.code = "SUPPLIER_REQUIRED"; throw e;
  }
  return {
    name,
    employeeNumber: clean(merged.employeeNumber),
    email: clean(merged.email).toLowerCase(),
    phone: clean(merged.phone),
    // Gebruiker en werknemer zijn APARTE entiteiten (h16-business rule).
    userId: clean(merged.userId) || null,
    teamId: clean(merged.teamId) || null,
    planningGroups: (Array.isArray(merged.planningGroups) ? merged.planningGroups : []).map(clean).filter(Boolean).slice(0, 10),
    jobTitle: clean(merged.jobTitle || merged.function),
    // INSZ/rijksregisternummer · nodig voor de wettelijke aangiftes (Dimona,
    // CIAW). Optioneel op de fiche, maar als het er staat moet het geldig zijn.
    insz: normalizeEmployeeInsz(merged.insz),
    activeFrom, activeTo,
    workSchedule: normalizeSchedule(merged.workSchedule),
    costRates: normalizeRates(merged.costRates),
    skills: normalizeSkills(merged.skills),
    certificates: normalizeCertificates(merged.certificates),
    driverLicense: clean(merged.driverLicense),
    // Mobiele (Wappy) toegang staat LOS van kantoortoegang (h16-acceptatie).
    mobileAccess: merged.mobileAccess === true,
    external,
    supplierId: external ? clean(merged.supplierId) : null,
    emergencyContact: merged.emergencyContact && typeof merged.emergencyContact === "object"
      ? { name: clean(merged.emergencyContact.name), phone: clean(merged.emergencyContact.phone), relation: clean(merged.emergencyContact.relation) }
      : null,
    notes: clean(merged.notes),
  };
}

// ── Beschikbaarheid ─────────────────────────────────────────────────────────
/**
 * Kan deze medewerker op `date` gepland worden? Geeft ALTIJD redenen terug,
 * zodat de aanroeper kan waarschuwen of blokkeren volgens beleid (h16).
 * Controleert status, in-dienst-periode, werkrooster en goedgekeurde afwezigheid.
 */
function availabilityOn(employee, date, { leaves = [] } = {}) {
  const d = isoDate(date);
  const reasons = [];
  if (!d) return { available: false, reasons: [{ code: "INVALID_DATE", message: "Ongeldige datum" }] };

  if (!PLANNABLE_STATUSES.includes(employee.status)) {
    reasons.push({
      code: employee.status === "left" ? "OUT_OF_SERVICE" : "NOT_PLANNABLE",
      message: employee.status === "left"
        ? "Medewerker is uit dienst en kan niet nieuw gepland worden"
        : `Status '${employee.status}' laat plannen niet toe`,
    });
  }
  if (employee.activeFrom && d < employee.activeFrom) reasons.push({ code: "BEFORE_START", message: `Nog niet in dienst op ${d}` });
  if (employee.activeTo && d > employee.activeTo) reasons.push({ code: "AFTER_END", message: `Niet meer in dienst op ${d}` });

  const day = weekdayOf(d);
  const block = (employee.workSchedule && employee.workSchedule.days) ? employee.workSchedule.days[day] : null;
  if (!block) reasons.push({ code: "OFF_SCHEDULE", message: `Valt buiten het werkrooster (${day})` });

  const absence = (leaves || []).find(l =>
    String(l.employeeId || l.userId) === String(employee.id) || (employee.userId && String(l.userId) === String(employee.userId)));
  const covering = (leaves || []).filter(l =>
    ["approved", "goedgekeurd"].includes(String(l.status || "").toLowerCase())
    && (String(l.employeeId) === String(employee.id) || (employee.userId && String(l.userId) === String(employee.userId)))
    && (!l.startDate || l.startDate <= d) && (!l.endDate || l.endDate >= d));
  if (covering.length) reasons.push({ code: "ON_LEAVE", message: `Afwezig op ${d} (${covering[0].type || "verlof"})` });

  return {
    available: reasons.length === 0,
    reasons,
    schedule: block || null,
    // Blokkeren of enkel waarschuwen: buiten rooster is een waarschuwing,
    // uit dienst / afwezig is een harde blokkering.
    blocking: reasons.some(r => ["OUT_OF_SERVICE", "NOT_PLANNABLE", "ON_LEAVE", "BEFORE_START", "AFTER_END"].includes(r.code)),
    hasAbsenceRecord: !!absence,
  };
}

/** Medewerkers die een gevraagde vaardigheid bezitten (planner-hulp). */
function withSkill(employees, skillKey) {
  const key = clean(skillKey).toLowerCase().replace(/\s+/g, "_");
  return (employees || []).filter(e => (e.skills || []).some(s => s.key === key));
}

// ── Repository ──────────────────────────────────────────────────────────────
function makeEmployeeRepository(store) {
  const col = "employees";
  return {
    list(tenantId, { status, teamId, skill, includeArchived = false } = {}) {
      let rows = (store.list(col, tenantId) || []).slice();
      if (status) rows = rows.filter(e => e.status === status);
      else if (!includeArchived) rows = rows.filter(e => e.status !== "archived");
      if (teamId) rows = rows.filter(e => e.teamId === teamId);
      if (skill) rows = withSkill(rows, skill);
      return rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    },
    findById(tenantId, id) { return (store.list(col, tenantId) || []).find(e => e.id === id) || null; },
    /** Werknemer bij een gebruiker (optionele 1-1 koppeling). */
    findByUserId(tenantId, userId) {
      return (store.list(col, tenantId) || []).find(e => e.userId && String(e.userId) === String(userId)) || null;
    },
    insert(tenantId, payload, actor) {
      const normalized = normalizeEmployee(payload, null);
      if (normalized.userId && this.findByUserId(tenantId, normalized.userId)) {
        const e = new Error("Deze gebruiker is al aan een werknemer gekoppeld"); e.status = 409; e.code = "USER_ALREADY_LINKED"; throw e;
      }
      const now = new Date().toISOString();
      return store.insert(col, {
        id: `emp_${newUlid()}`, tenantId, ...normalized,
        status: EMP_STATUSES.includes(payload && payload.status) ? payload.status : "active",
        version: 1, createdAt: now, createdBy: actor || null, updatedAt: now, updatedBy: actor || null, archivedAt: null,
      });
    },
    update(tenantId, id, patch, actor, expectedVersion) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Werknemer niet gevonden"); e.status = 404; throw e; }
      if (existing.status === "archived") { const e = new Error("Een gearchiveerde werknemer kan niet gewijzigd worden"); e.status = 409; e.code = "ARCHIVED"; throw e; }
      if (expectedVersion != null && Number(existing.version || 1) !== Number(expectedVersion)) {
        const e = new Error("De werknemer is intussen gewijzigd."); e.status = 409; e.code = "VERSION_CONFLICT"; e.currentVersion = existing.version; throw e;
      }
      const normalized = normalizeEmployee(patch, existing);
      if (normalized.userId && normalized.userId !== existing.userId) {
        const other = this.findByUserId(tenantId, normalized.userId);
        if (other && other.id !== id) { const e = new Error("Deze gebruiker is al aan een werknemer gekoppeld"); e.status = 409; e.code = "USER_ALREADY_LINKED"; throw e; }
      }
      return store.update(col, id, { ...normalized, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null });
    },
    /**
     * Nieuwe tariefversie toevoegen. Bestaande versies blijven ONGEWIJZIGD,
     * zodat historische nacalculatie correct blijft (h16-business rule).
     */
    addRate(tenantId, id, rate, actor) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Werknemer niet gevonden"); e.status = 404; throw e; }
      const validFrom = isoDate(rate && rate.validFrom);
      if (!validFrom) { const e = new Error("Een tariefversie vereist een ingangsdatum (validFrom)"); e.status = 400; e.code = "VALID_FROM_REQUIRED"; throw e; }
      if ((existing.costRates || []).some(r => r.validFrom === validFrom)) {
        const e = new Error(`Er bestaat al een tariefversie vanaf ${validFrom}`); e.status = 409; e.code = "RATE_EXISTS"; throw e;
      }
      const costRates = normalizeRates([...(existing.costRates || []), { ...rate, validFrom }]);
      return store.update(col, id, { costRates, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null });
    },
    transition(tenantId, id, to, actor) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Werknemer niet gevonden"); e.status = 404; throw e; }
      if (existing.status === to) return existing;
      if (!canTransition(existing.status, to)) {
        const e = new Error(`Ongeldige statusovergang: ${existing.status} → ${to}`); e.status = 409; e.code = "INVALID_TRANSITION"; throw e;
      }
      const patch = { status: to, version: Number(existing.version || 1) + 1, updatedAt: new Date().toISOString(), updatedBy: actor || null };
      if (to === "archived") patch.archivedAt = new Date().toISOString();
      // Uit dienst: mobiele toegang vervalt automatisch (h16-automatisering
      // "deactivatie van toegang bij einddatum"). Historiek blijft intact.
      if (to === "left") { patch.mobileAccess = false; patch.activeTo = existing.activeTo || new Date().toISOString().slice(0, 10); }
      return store.update(col, id, patch);
    },
    /** Alle vervallende/vervallen attesten van een tenant (voor taken/signalen). */
    expiringCertificates(tenantId, opts = {}) {
      return this.list(tenantId)
        .map(e => ({ employeeId: e.id, name: e.name, certificates: expiringCertificates(e, opts) }))
        .filter(x => x.certificates.length);
    },
    remove(tenantId, id) {
      const existing = this.findById(tenantId, id);
      if (!existing) { const e = new Error("Werknemer niet gevonden"); e.status = 404; throw e; }
      // Historiek behouden: archiveren i.p.v. verwijderen (h16 + DoD).
      const e2 = new Error("Werknemers worden gearchiveerd, niet verwijderd · gebruik status 'archived'");
      e2.status = 409; e2.code = "ARCHIVE_INSTEAD"; throw e2;
    },
  };
}

module.exports = {
  EMP_STATUSES, EMP_TRANSITIONS, PLANNABLE_STATUSES, WEEKDAYS, canTransition,
  normalizeEmployee, normalizeSchedule, normalizeRates, normalizeSkills, normalizeCertificates,
  rateOn, availabilityOn, withSkill, expiringCertificates, weekdayOf,
  makeEmployeeRepository,
};
