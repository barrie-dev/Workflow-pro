(function () {
  "use strict";

  // Toont het juiste platform op basis van rol na login
  const PLATFORMS = {
    super_admin: "platform-superadmin",
    tenant_admin: "platform-admin",
    manager:      "platform-manager",
    employee:     "platform-employee"
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

  window.WorkFlowProPlatformRouter = { showPlatform, showLogin };
}());
