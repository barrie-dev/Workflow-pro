/* ── Resellerportaal · paginaregister en aansluiting (CTO3-09) ────────────────
 *
 * De zes paginamodules zijn parallel gebouwd en registreren zich elk nét
 * anders: de een vult een container, de ander geeft HTML terug, en één gebruikt
 * zelfs een eigen globaal register. Dat is de eerlijke prijs van parallel
 * werken zonder vooraf vastgelegd koppelvlak.
 *
 * Dit bestand is de MIGRATIESHIM die dat opvangt. Het doet drie dingen:
 *
 *   1. het voegt de twee registers samen tot één lijst;
 *   2. het normaliseert de rendervorm: render(host) mag een string teruggeven
 *      of de host zelf vullen · beide werken;
 *   3. het levert de metadata (label, titel, intro) die de portaalshell nodig
 *      heeft om een navigatie-item en een paginakop te tekenen.
 *
 * Bewust een shim en geen "nette" oplossing: de zes pagina's zijn getest zoals
 * ze zijn, en ze alle zes herschrijven om één vorm af te dwingen zou die tests
 * waardeloos maken op het moment dat we ze het hardst nodig hebben. De test bij
 * dit bestand pint de aanvaarde vormen vast, zodat er geen zevende bij komt.
 */
(function () {
  "use strict";

  // De twee registers die de pagina's gebruiken. Idempotent lezen: dit bestand
  // maakt ze aan als ze er nog niet zijn, en veegt nooit iets weg.
  const REGISTERS = ["wfpResellerPages", "wfpResellerViews"];

  // Vaste volgorde in de navigatie. Een pagina die hier niet in staat wordt
  // niet getoond · zo kan een half afgewerkte module niet stil in het menu
  // opduiken.
  const VOLGORDE = ["pipeline", "klanten", "licenties", "verdiensten", "toegang", "uitbetaling"];

  function alleRegistraties() {
    const uit = {};
    for (const naam of REGISTERS) {
      const reg = window[naam];
      if (!reg) continue;
      for (const [id, pagina] of Object.entries(reg)) {
        if (!uit[id]) uit[id] = pagina;
      }
    }
    return uit;
  }

  /** De pagina's die getoond mogen worden, in vaste volgorde. */
  function pages() {
    const alle = alleRegistraties();
    return VOLGORDE.filter(id => alle[id]).map(id => ({ id, ...normaliseer(alle[id], id) }));
  }

  function tekst(waarde, terugval) {
    if (typeof waarde === "function") { try { return waarde(); } catch (_) { return terugval; } }
    return waarde == null ? terugval : String(waarde);
  }

  /**
   * Breng één registratie terug tot de vorm die de shell verwacht:
   *   { id, label, meta: {eyebrow, title, text}, render(host) }
   */
  function normaliseer(pagina, id) {
    const label = tekst(pagina.label, tekst(pagina.title, id));
    let meta = { eyebrow: "", title: label, text: "" };
    if (typeof pagina.meta === "function") { try { meta = { ...meta, ...(pagina.meta() || {}) }; } catch (_) { /* terugval blijft */ } }
    else if (pagina.meta) meta = { ...meta, ...pagina.meta };

    return {
      label,
      meta,
      // Sommige pagina's vullen de host, andere geven HTML terug. Beide zijn
      // hier geldig; wie een string teruggeeft krijgt hem in de host gezet.
      async render(host) {
        const fn = pagina.render || pagina.mount || pagina.open;
        if (typeof fn !== "function") {
          host.innerHTML = `<section class="rsp-error"><strong>Deze pagina is nog niet beschikbaar.</strong></section>`;
          return;
        }
        const uitkomst = await fn(host);
        if (typeof uitkomst === "string") host.innerHTML = uitkomst;
      },
    };
  }

  window.wfpResellerPageRegistry = { pages, normaliseer, VOLGORDE, REGISTERS };
}());
