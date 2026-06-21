"use strict";
/**
 * Sector-terminologie op de client. De server stuurt per tenant de juiste woorden
 * mee in /me (terminology: {venue, venuePlural, job, jobPlural}). Zo ziet een
 * zorg-tenant "Bezoeken" i.p.v. "Werkbonnen", een bouw-tenant "Werven" i.p.v.
 * "Locaties". Eén codebasis; alleen de labels verschillen.
 *
 * Gebruik:
 *   wfpTerms.set(me.terminology);            // na /me
 *   wfpTerms.apply(document);                 // vervangt elk [data-term="..."]
 *   wfpTerms.t("jobPlural")                   // in JS-templates
 * Elementen markeer je met data-term="job|jobPlural|venue|venuePlural".
 */
(function () {
  const DEFAULTS = { venue: "Locatie", venuePlural: "Locaties", job: "Werkbon", jobPlural: "Werkbonnen" };
  let terms = { ...DEFAULTS };

  function set(t) {
    if (t && typeof t === "object") {
      terms = {
        venue: t.venue || DEFAULTS.venue,
        venuePlural: t.venuePlural || DEFAULTS.venuePlural,
        job: t.job || DEFAULTS.job,
        jobPlural: t.jobPlural || DEFAULTS.jobPlural,
      };
    }
    apply(document);
  }
  function t(key) { return terms[key] || DEFAULTS[key] || key; }
  function apply(root) {
    (root || document).querySelectorAll("[data-term]").forEach(el => {
      const key = el.getAttribute("data-term");
      if (terms[key]) el.textContent = terms[key];
    });
  }
  window.wfpTerms = { set, t, apply, get all() { return { ...terms }; } };
})();
