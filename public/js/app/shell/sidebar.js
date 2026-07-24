/* ============================================================
   IA-03 · Sidebar (IA handover §7 · AppShell)

   Rendert de zijbalk UITSLUITEND uit de opgeloste navigatieboom
   (IA-01). Geen hardcoded menu-items meer in rolbestanden (D-02).

   Maximaal twee niveaus (D-01). Labels lopen via i18n; de
   registry-id is de identifier voor tests en analytics, nooit het
   label. Alle tekst wordt ge-escaped · een tenantnaam of
   vertaalstring mag nooit HTML kunnen injecteren.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpShell = root.wfpShell || {}; root.wfpShell.sidebar = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /** Standaardvertaler: valt terug op de sleutel wanneer i18n ontbreekt. */
  function defaultT(key) { return key; }

  /**
   * Is dit item de actieve bestemming? Een domein is óók actief wanneer een
   * van zijn kinderen actief is · zo blijft de groep open staan.
   */
  function isActive(entry, activeId) {
    if (!activeId) return false;
    if (entry.id === activeId) return true;
    return (entry.children || []).some(c => c.id === activeId);
  }

  /**
   * Render de zijbalk.
   * @param {Array}  tree      uitkomst van resolver.resolve()
   * @param {object} opts      { activeId, t, badges }
   * @returns {string} HTML
   */
  function renderSidebar(tree, opts = {}) {
    const t = typeof opts.t === "function" ? opts.t : defaultT;
    const badges = opts.badges || {};
    const items = (tree || []).map(d => {
      const actief = isActive(d, opts.activeId);
      const badge = badges[d.badgeSource];
      const kinderen = (d.children || []).map(c => {
        const cBadge = badges[c.badgeSource];
        return `<a class="nav-sub${c.id === opts.activeId ? " is-active" : ""}" `
          + `data-nav-id="${esc(c.id)}" href="${esc(c.path)}">`
          + `<span class="nav-label">${esc(t(c.labelKey))}</span>`
          + (cBadge ? `<span class="nav-badge">${esc(cBadge)}</span>` : "")
          + `</a>`;
      }).join("");

      return `<div class="nav-group${actief ? " is-open" : ""}" data-nav-group="${esc(d.id)}">`
        + `<a class="nav-item${actief ? " is-active" : ""}" data-nav-id="${esc(d.id)}" `
        + `href="${esc(d.path)}"${d.icon ? ` data-icon="${esc(d.icon)}"` : ""}>`
        + `<span class="nav-label">${esc(t(d.labelKey))}</span>`
        + (badge ? `<span class="nav-badge">${esc(badge)}</span>` : "")
        + `</a>`
        + (kinderen ? `<div class="nav-children">${kinderen}</div>` : "")
        + `</div>`;
    }).join("");

    return `<nav class="app-sidebar" aria-label="${esc(t("nav.aria.main"))}">${items}</nav>`;
  }

  /**
   * Mobiele onderbalk: alleen de primaire domeinen, maximaal vijf tabs
   * (IA-18 · "five-tab navigation"). De rest verhuist naar 'Meer'.
   */
  function mobileTabs(tree, max = 5) {
    const primair = (tree || []).filter(d => d.mobilePriority === "primary");
    const tabs = primair.slice(0, max);
    const meer = (tree || []).filter(d => !tabs.includes(d));
    return { tabs, more: meer };
  }

  return { renderSidebar, mobileTabs, isActive, esc };
});
