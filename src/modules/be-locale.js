"use strict";
/**
 * Belgisch-marktspecifieke helpers: feestdagen, werkdagen (excl. weekend +
 * feestdagen), afronding op cent, en BTW-nummer-validatie (mod 97).
 */

// Cent-afronding voor bedragen op facturen/offertes (vermijdt float-artefacten).
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Paaszondag (Computus, Gregoriaans) · basis voor de variabele feestdagen.
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);   // 3=maart, 4=april
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function iso(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }

// De 10 Belgische wettelijke (federale) feestdagen voor een jaar → Set van YYYY-MM-DD.
function belgianHolidays(year) {
  const easter = easterSunday(year);
  return new Set([
    `${year}-01-01`,                 // Nieuwjaar
    iso(addDays(easter, 1)),         // Paasmaandag
    `${year}-05-01`,                 // Dag van de Arbeid
    iso(addDays(easter, 39)),        // O.L.H. Hemelvaart
    iso(addDays(easter, 50)),        // Pinkstermaandag
    `${year}-07-21`,                 // Nationale feestdag
    `${year}-08-15`,                 // O.L.V. Hemelvaart
    `${year}-11-01`,                 // Allerheiligen
    `${year}-11-11`,                 // Wapenstilstand
    `${year}-12-25`,                 // Kerstmis
  ]);
}

const _holidayCache = new Map();
function isBelgianHoliday(dateStr) {
  const year = Number(String(dateStr).slice(0, 4));
  if (!_holidayCache.has(year)) _holidayCache.set(year, belgianHolidays(year));
  return _holidayCache.get(year).has(String(dateStr).slice(0, 10));
}

/**
 * Aantal werkdagen tussen start en eind (inclusief), met uitsluiting van
 * weekends én Belgische feestdagen. Datums als "YYYY-MM-DD" of Date.
 */
function workingDaysBetween(start, end) {
  const s = new Date(start), e = new Date(end);
  if (isNaN(s) || isNaN(e) || e < s) return 0;
  let count = 0;
  const cur = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()));
  const last = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()));
  while (cur <= last) {
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6 && !isBelgianHoliday(iso(cur))) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/**
 * Valideer een Belgisch BTW-/ondernemingsnummer (mod 97). Niet-BE nummers
 * worden als 'onbekend' beschouwd (true) · intracommunautaire B2B kan een
 * buitenlands nummer hebben. Geeft false enkel bij een ongeldig BE-nummer.
 */
function isValidBelgianVat(vat) {
  const clean = String(vat || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!clean.startsWith("BE")) return true;        // buitenlands → niet hier valideren
  const digits = clean.slice(2);
  if (!/^\d{10}$/.test(digits)) return false;       // BE moet 10 cijfers hebben
  const base = Number(digits.slice(0, 8));
  const check = Number(digits.slice(8));
  return 97 - (base % 97) === check;
}

/**
 * Belgische gestructureerde mededeling (OGM/VCS): +++ddd/dddd/ddddd+++.
 * 12 cijfers = 10 basiscijfers + 2 controlecijfers (basis mod 97; 0 → 97).
 * `seed` mag een factuurnummer/-id zijn; de cijfers worden eruit gehaald.
 */
function structuredCommunication(seed) {
  const digits = String(seed == null ? "" : seed).replace(/\D/g, "") || "0";
  const base = Number(digits.slice(-10)) % 1e10;       // max 10 cijfers
  let check = base % 97;
  if (check === 0) check = 97;
  const full = String(base).padStart(10, "0") + String(check).padStart(2, "0");
  return `+++${full.slice(0, 3)}/${full.slice(3, 7)}/${full.slice(7, 12)}+++`;
}

// Geldige gestructureerde mededeling? (controle van het mod-97 controlegetal)
function isValidStructuredCommunication(comm) {
  const d = String(comm || "").replace(/\D/g, "");
  if (d.length !== 12) return false;
  const base = Number(d.slice(0, 10));
  const check = Number(d.slice(10));
  const expected = (base % 97) || 97;
  return expected === check;
}

module.exports = { round2, easterSunday, belgianHolidays, isBelgianHoliday, workingDaysBetween, isValidBelgianVat, structuredCommunication, isValidStructuredCommunication };
