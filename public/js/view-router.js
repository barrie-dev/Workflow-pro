(function () {
  let views = {};
  let el = function () { return null; };
  let refreshHandlers = {};

  function configure(options) {
    views = options?.views || views;
    el = options?.el || el;
    refreshHandlers = options?.refreshHandlers || refreshHandlers;
  }

  function setView(view) {
    const activeView = views[view] ? view : "demo";
    Object.entries(views).forEach(([key, config]) => {
      el(config.pageId)?.classList.toggle("hidden", key !== activeView);
      if (config.tabId) el(config.tabId)?.classList.toggle("active", key === activeView);
    });
    const refreshName = views[activeView]?.refresh;
    if (refreshName) refreshHandlers[refreshName]?.();
    // Dispatch event for domain-screens.js to bind forms
    document.dispatchEvent(new CustomEvent('wfp-view-changed', { detail: { view: activeView } }));
  }

  function bindNavigation() {
    Object.entries(views).forEach(([view, config]) => {
      if (!config.tabId) return;
      el(config.tabId)?.addEventListener("click", () => setView(view));
    });
  }

  window.WorkFlowProRouter = {
    configure,
    setView,
    bindNavigation
  };
}());
