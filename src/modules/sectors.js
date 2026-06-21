"use strict";
/**
 * Sectorprofielen (multi-markt). Eén horizontale codebasis; een sector bepaalt enkel
 * terminologie + welke modules standaard zinvol zijn. Gebruikt in de onboarding-wizard
 * om de klant zich te laten herkennen en passende suggesties te geven. Zie
 * docs/SECTORPROFIELEN.md. Het wijzigt NIET automatisch entitlements/plan — dat blijft
 * bij de superadmin/bundel; we bewaren de sector + tonen suggesties.
 */
const SECTORS = [
  { key: "bouw",        label: "Bouw & installatie",         venueLabel: "Werf",          jobLabel: "Werkbon",        suggested: ["offertes", "invoices", "stock", "vehicles", "expenses", "leaves"] },
  { key: "schoonmaak",  label: "Schoonmaak",                 venueLabel: "Klantlocatie",  jobLabel: "Poetsbeurt",     suggested: ["invoices", "leaves", "expenses"] },
  { key: "groen",       label: "Groen / tuinonderhoud",      venueLabel: "Tuin/terrein",  jobLabel: "Onderhoudsbeurt",suggested: ["offertes", "invoices", "vehicles", "stock", "leaves"] },
  { key: "hvac",        label: "HVAC / technische dienst",   venueLabel: "Installatie",   jobLabel: "Interventie",    suggested: ["offertes", "invoices", "stock", "vehicles", "expenses"] },
  { key: "beveiliging", label: "Beveiliging / bewaking",     venueLabel: "Site/post",     jobLabel: "Shift/ronde",    suggested: ["leaves", "expenses"] },
  { key: "facility",    label: "Facility / multiservice",    venueLabel: "Gebouw/site",   jobLabel: "Taak/ticket",    suggested: ["offertes", "invoices", "stock", "leaves", "expenses"] },
  { key: "events",      label: "Events / verhuur & opbouw",  venueLabel: "Eventlocatie",  jobLabel: "Opbouw/afbraak", suggested: ["offertes", "invoices", "stock", "vehicles"] },
  { key: "zorg",        label: "Mobiele zorg / thuisdiensten", venueLabel: "Cliëntadres", jobLabel: "Bezoek",     suggested: ["leaves", "expenses"] },
  { key: "transport",   label: "Transport / levering",       venueLabel: "Stop/adres",    jobLabel: "Rit/levering",   suggested: ["vehicles", "expenses", "leaves"] },
  { key: "service",     label: "Herstellingen & service",    venueLabel: "Klantlocatie",  jobLabel: "Interventie",    suggested: ["offertes", "invoices", "stock", "vehicles"] },
  { key: "andere",      label: "Andere",                     venueLabel: "Locatie",       jobLabel: "Opdracht",       suggested: [] },
];

const TEAM_SIZES = ["1-5", "6-10", "11-25", "26-50", "50+"];

function sectorByKey(key) { return SECTORS.find(s => s.key === key) || null; }
function isValidSector(key) { return SECTORS.some(s => s.key === key); }
function publicSectors() { return SECTORS.map(s => ({ key: s.key, label: s.label })); }

module.exports = { SECTORS, TEAM_SIZES, sectorByKey, isValidSector, publicSectors };
