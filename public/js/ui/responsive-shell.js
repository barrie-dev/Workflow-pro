/*
 * Monargo One responsive shell
 *
 * Houdt de mobiele navigatie van Admin, Manager, Reseller en Superadmin gelijk,
 * ongeacht welke platformmodule de inhoud rendert. De bestaande rolcode
 * blijft eigenaar van de navigatie en rechten. Deze laag beheert uitsluitend
 * toegankelijk gedrag zoals scrim, focus, Escape en resize.
 */
(function () {
  "use strict";

  const SHELLS = [
    {
      platform: "#platform-admin",
      sidebar: "#admSidebar",
      toggle: "#admMenuToggle",
      navItem: ".adm-nav-item[data-view]"
    },
    {
      platform: "#platform-manager",
      sidebar: "#mgrSidebar",
      toggle: "#mgrMenuToggle",
      navItem: ".mgr-nav-item[data-view]"
    },
    {
      platform: "#platform-superadmin",
      sidebar: "#saSidebar",
      toggle: "#saMenuToggle",
      navItem: ".sa-nav-item[data-view]"
    },
    {
      platform: "#platform-reseller",
      sidebar: "#rspSidebar",
      toggle: "#rspMenuBtn",
      navItem: ".rsp-nav-item[data-rsp-view], .rsp-sidebar-close"
    }
  ];

  const mobileQuery = window.matchMedia("(max-width: 820px)");

  function elements(config) {
    const platform = document.querySelector(config.platform);
    return {
      platform,
      sidebar: platform && platform.querySelector(config.sidebar),
      toggle: platform && platform.querySelector(config.toggle)
    };
  }

  function ensureScrim(config) {
    const { platform, sidebar, toggle } = elements(config);
    if (!platform || !sidebar || !toggle) return null;

    toggle.setAttribute("aria-controls", sidebar.id);
    toggle.setAttribute("aria-label", "Navigatie openen");

    let scrim = platform.querySelector(".mn-nav-scrim");
    if (!scrim) {
      scrim = document.createElement("button");
      scrim.type = "button";
      scrim.className = "mn-nav-scrim";
      scrim.setAttribute("aria-label", "Navigatie sluiten");
      scrim.addEventListener("click", () => close(config, { restoreFocus: true }));
      platform.appendChild(scrim);
    }
    return scrim;
  }

  function sync(config) {
    const { platform, sidebar, toggle } = elements(config);
    if (!platform || !sidebar || !toggle) return;
    ensureScrim(config);

    const open = mobileQuery.matches && sidebar.classList.contains("open");
    platform.classList.toggle("mn-nav-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Navigatie sluiten" : "Navigatie openen");
    document.documentElement.classList.toggle(
      "mn-navigation-locked",
      SHELLS.some(item => {
        const current = elements(item);
        return current.platform && !current.platform.classList.contains("hidden")
          && current.sidebar && current.sidebar.classList.contains("open")
          && mobileQuery.matches;
      })
    );
  }

  function close(config, options = {}) {
    const { sidebar, toggle } = elements(config);
    if (!sidebar || !toggle) return;
    sidebar.classList.remove("open");
    sync(config);
    if (options.restoreFocus) toggle.focus({ preventScroll: true });
  }

  function closeAll() {
    SHELLS.forEach(config => close(config));
  }

  document.addEventListener("click", event => {
    for (const config of SHELLS) {
      const { platform, sidebar, toggle } = elements(config);
      if (!platform || !sidebar || !toggle || !platform.contains(event.target)) continue;

      if (event.target.closest(config.toggle)) {
        requestAnimationFrame(() => sync(config));
        return;
      }

      if (event.target.closest(config.navItem) && mobileQuery.matches) {
        close(config);
        return;
      }
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    const active = SHELLS.find(config => {
      const { platform, sidebar } = elements(config);
      return platform && !platform.classList.contains("hidden")
        && sidebar && sidebar.classList.contains("open");
    });
    if (active) close(active, { restoreFocus: true });
  });

  const refresh = () => {
    if (!mobileQuery.matches) closeAll();
    SHELLS.forEach(config => {
      ensureScrim(config);
      sync(config);
    });
  };

  if (typeof mobileQuery.addEventListener === "function") {
    mobileQuery.addEventListener("change", refresh);
  } else {
    mobileQuery.addListener(refresh);
  }

  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.type === "childList" || mutation.attributeName === "class")) {
      refresh();
    }
  });

  window.addEventListener("DOMContentLoaded", () => {
    refresh();
    document.querySelectorAll(".wfp-platform").forEach(platform => {
      observer.observe(platform, { childList: true, subtree: false, attributes: true, attributeFilter: ["class"] });
    });
  });
}());
