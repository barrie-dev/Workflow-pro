(function () {
  "use strict";

  // Toont het juiste platform op basis van rol na login
  const PLATFORMS = {
    super_admin: "platform-superadmin",
    tenant_admin: "platform-admin",
    manager:      "platform-manager",
    employee:     "platform-employee",
    reseller:     "platform-reseller"
  };

  function showPlatform(role) {
    // Verberg alle platforms
    document.querySelectorAll(".wfp-platform").forEach(el => el.classList.add("hidden"));
    // Verberg de legacy shell (niet-role-based secties)
    const legacyShell = document.getElementById("legacyShell");
    if (legacyShell) legacyShell.classList.add("hidden");

    const platformId = PLATFORMS[role] || "platform-employee";
    const platform = document.getElementById(platformId);
    if (platform) {
      platform.classList.remove("hidden");
      // Initialiseer het platform
      const initFn = window[`${platformId.replace("platform-", "wfp_")}Init`];
      if (typeof initFn === "function") initFn();
    }
  }

  function showLogin() {
    document.querySelectorAll(".wfp-platform").forEach(el => el.classList.add("hidden"));
    const legacyShell = document.getElementById("legacyShell");
    if (legacyShell) legacyShell.classList.remove("hidden");
  }

  // Verlaat een support-sessie: herstel het eigen agent-token, beëindig de
  // support-sessie bij de klant, en keer terug naar het eigen account.
  async function exitSupportSession() {
    const agentToken = sessionStorage.getItem("wfp_agent_token");
    const tenantId = sessionStorage.getItem("wfp_support_tenant");
    const banner = document.getElementById("wfpSupportBanner");
    if (banner) { banner.remove(); document.body.style.paddingTop = ""; }
    if (!agentToken) {
      // Geen bewaard agent-token → veilige terugval: uitloggen.
      localStorage.removeItem("wfp_token");
      showLogin();
      return;
    }
    localStorage.setItem("wfp_token", agentToken);
    sessionStorage.removeItem("wfp_agent_token");
    sessionStorage.removeItem("wfp_support_tenant");
    // Best-effort: beëindig de support-sessie bij de klant (met het agent-token).
    if (tenantId) {
      try {
        await fetch("/api/admin/support/end", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + agentToken },
          body: JSON.stringify({ tenantId })
        });
      } catch (_) {}
    }
    let role = "super_admin";
    try {
      const me = await fetch("/api/me", { headers: { Authorization: "Bearer " + agentToken } }).then(r => r.json());
      if (me && me.user && me.user.role) role = me.user.role;
    } catch (_) {}
    showPlatform(role);
  }

  window.WorkFlowProPlatformRouter = { showPlatform, showLogin, exitSupportSession };
}());
