"use strict";
/**
 * SPA-fallback voor de IA-routes (IA handover §6 · "Refresh safety").
 *
 * De nieuwe navigatie gebruikt echte URL's: /app/customers/c_42/overview.
 * Zonder fallback geeft een F5 op zo'n adres een 404, want er staat geen
 * bestand op die plek. De browser moet index.html krijgen, waarna de router
 * de URL leest en het juiste scherm opent.
 *
 * Waarom een aparte module en niet drie regels in server.js: de
 * CTO3-10-ratchet houdt server.js op zijn huidige regelaantal, en die regel
 * is er niet om ontweken te worden. De keuze hoort trouwens ook hier thuis ·
 * bij de code die weet wat een IA-route is.
 */

// Alles onder /app is de applicatieshell. Bewust ÉÉN prefix: hoe meer
// uitzonderingen, hoe groter de kans dat een echt 404-pad stilletjes
// index.html teruggeeft en de gebruiker een leeg scherm ziet in plaats van
// een eerlijke foutmelding.
const SPA_PREFIX = "/app";

/**
 * Welk bestand hoort bij dit pad?
 *
 * @param {string} pathname
 * @returns {string} pad relatief aan public/
 */
function spaFile(pathname) {
  const p = String(pathname || "/");
  if (p === "/") return "index.html";
  if (p === SPA_PREFIX || p.startsWith(SPA_PREFIX + "/")) {
    // Een verzoek naar een BESTAND onder /app (een script, een afbeelding)
    // blijft een bestandsverzoek · anders serveer je HTML met de MIME-type
    // van een script en breekt de pagina op een onnavolgbare manier.
    return /\.[a-z0-9]{2,5}$/i.test(p) ? p.replace(/^\/+/, "") : "index.html";
  }
  return p.replace(/^\/+/, "");
}

module.exports = { spaFile, SPA_PREFIX };
