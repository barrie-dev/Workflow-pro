"use strict";
/**
 * De volledige broncode van het tenant-adminportaal.
 *
 * Sinds elf schermen naar eigen bestanden zijn verhuisd, is admin.js niet meer
 * "de admin". Tests die iets beweren over wat het PORTAAL doet - de snelle
 * acties, de planningweergave, de berichtenwerkruimte - moeten dus over alle
 * bestanden samen kijken, niet alleen over admin.js.
 *
 * Dat is geen versoepeling. De bewering blijft precies even sterk: "het
 * adminportaal doet X". Alleen de vindplaats van de code is veranderd, en
 * daar hoort een test niet op vast te zitten.
 *
 * Voor tests die WEL specifiek over admin.js gaan - het regelbudget van de
 * ratchet bijvoorbeeld - blijft gewoon readFileSync op dat ene bestand het
 * juiste gereedschap.
 */
const fs = require("fs");
const path = require("path");

const PLATFORMS = path.join(__dirname, "..", "..", "public", "js", "platforms");

/** De uitgesplitste schermmodules, in de volgorde van index.html. */
const SCHERM_MODULES = [
  "admin-dashboard.js",
  "admin-actiecentrum.js",
  "admin-klantvragen.js",
  "admin-planning.js",
  "admin-werkbonnen.js",
  "admin-verlof.js",
  "admin-medewerkers.js",
  "admin-berichten.js",
  "admin-werkongevallen.js",
  "admin-onkosten.js",
  "admin-afspraken.js",
];

/** admin.js plus elke uitgesplitste schermmodule, aan elkaar geplakt. */
function adminSource() {
  const delen = ["admin.js", ...SCHERM_MODULES]
    .map(f => path.join(PLATFORMS, f))
    .filter(p => fs.existsSync(p))
    .map(p => fs.readFileSync(p, "utf8"));
  return delen.join("\n");
}

module.exports = { adminSource, SCHERM_MODULES, PLATFORMS };
