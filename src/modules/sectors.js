"use strict";
/**
 * Sectorprofielen (multi-markt). Eén horizontale codebasis; een sector bepaalt enkel
 * terminologie + welke modules standaard zinvol zijn. Gebruikt in de onboarding-wizard
 * om de klant zich te laten herkennen en passende suggesties te geven. Zie
 * docs/SECTORPROFIELEN.md. Het wijzigt NIET automatisch entitlements/plan — dat blijft
 * bij de superadmin/bundel; we bewaren de sector + tonen suggesties.
 */
const SECTORS = [
  { key: "bouw",        label: "Bouw & installatie",         venue: "Werf",         venuePlural: "Werven",          job: "Werkbon",        jobPlural: "Werkbonnen",       suggested: ["offertes", "invoices", "stock", "vehicles", "expenses", "leaves"] },
  { key: "schoonmaak",  label: "Schoonmaak",                 venue: "Klantlocatie", venuePlural: "Klantlocaties",   job: "Poetsbeurt",     jobPlural: "Poetsbeurten",     suggested: ["invoices", "leaves", "expenses"] },
  { key: "groen",       label: "Groen / tuinonderhoud",      venue: "Terrein",      venuePlural: "Terreinen",       job: "Onderhoudsbeurt",jobPlural: "Onderhoudsbeurten",suggested: ["offertes", "invoices", "vehicles", "stock", "leaves"] },
  { key: "hvac",        label: "HVAC / technische dienst",   venue: "Installatie",  venuePlural: "Installaties",    job: "Interventie",    jobPlural: "Interventies",     suggested: ["offertes", "invoices", "stock", "vehicles", "expenses"] },
  { key: "beveiliging", label: "Beveiliging / bewaking",     venue: "Post",         venuePlural: "Posten",          job: "Ronde",          jobPlural: "Rondes",           suggested: ["leaves", "expenses"] },
  { key: "facility",    label: "Facility / multiservice",    venue: "Gebouw",       venuePlural: "Gebouwen",        job: "Taak",           jobPlural: "Taken",            suggested: ["offertes", "invoices", "stock", "leaves", "expenses"] },
  { key: "events",      label: "Events / verhuur & opbouw",  venue: "Eventlocatie", venuePlural: "Eventlocaties",   job: "Opbouw",         jobPlural: "Opbouwen",         suggested: ["offertes", "invoices", "stock", "vehicles"] },
  { key: "zorg",        label: "Mobiele zorg / thuisdiensten", venue: "Cliëntadres", venuePlural: "Cliëntadressen", job: "Bezoek",         jobPlural: "Bezoeken",         suggested: ["leaves", "expenses"] },
  { key: "transport",   label: "Transport / levering",       venue: "Stop",         venuePlural: "Stops",           job: "Rit",            jobPlural: "Ritten",           suggested: ["vehicles", "expenses", "leaves"] },
  { key: "service",     label: "Herstellingen & service",    venue: "Klantlocatie", venuePlural: "Klantlocaties",   job: "Interventie",    jobPlural: "Interventies",     suggested: ["offertes", "invoices", "stock", "vehicles"] },
  { key: "andere",      label: "Andere",                     venue: "Locatie",      venuePlural: "Locaties",        job: "Werkbon",        jobPlural: "Werkbonnen",       suggested: [] },
];

const TEAM_SIZES = ["1-5", "6-10", "11-25", "26-50", "50+"];
const DEFAULT_TERMS = { venue: "Locatie", venuePlural: "Locaties", job: "Werkbon", jobPlural: "Werkbonnen" };

function sectorByKey(key) { return SECTORS.find(s => s.key === key) || null; }
function isValidSector(key) { return SECTORS.some(s => s.key === key); }
function publicSectors() { return SECTORS.map(s => ({ key: s.key, label: s.label })); }

// Sector-terminologie voor een tenant (val terug op neutrale standaard).
function terminologyFor(tenant) {
  const s = sectorByKey(tenant && tenant.sector);
  if (!s) return { ...DEFAULT_TERMS };
  return { venue: s.venue, venuePlural: s.venuePlural, job: s.job, jobPlural: s.jobPlural };
}

module.exports = { SECTORS, TEAM_SIZES, DEFAULT_TERMS, sectorByKey, isValidSector, publicSectors, terminologyFor };
