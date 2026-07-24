/* ============================================================
   Sessieherstel bij paginaladen (IA handover §6 · "Refresh safety")

   Het probleem dat dit oplost is ouder dan de IA-migratie en groter dan
   navigatie: de app bewaarde het token wél, maar herstelde de sessie NIET
   bij het laden van de pagina. Elke F5, elke gedeelde link en elke
   herstart van de browser bracht je terug op het inlogscherm, ook al was
   je nog gewoon ingelogd.

   Dat maakt de belofte uit de handover - "refreshing a record tab returns
   the same record" - onmogelijk: je landt niet op je record maar op een
   loginformulier, en na inloggen op het dashboard.

   Wat hier gebeurt:
     · is er een token en nog geen sessie, dan vragen we /api/me;
     · klopt het token, dan tonen we het juiste portaal en verdwijnt de
       login · de URL blijft staan, zodat de IA-router zijn werk kan doen;
     · klopt het niet, dan ruimen we het token op en blijft de login staan.
       Een verlopen token stil laten staan geeft bij elke volgende actie
       een onverklaarbare 401.

   Bewust NIET hier: tokens uit de URL (support-sessie, SSO). Die hebben
   hun eigen bootstrap in main.js met hun eigen auditvereisten; die twee
   paden door elkaar halen is vragen om een sessie die van de verkeerde
   identiteit is.
   ============================================================ */
(function () {
  "use strict";

  const TOKEN_KEY = "wfp_token";

  /** Draagt de URL al een eigen aanmeldpad? Dan bemoeien we ons er niet mee. */
  function urlCarriesOwnAuth() {
    const h = location.hash || "";
    const q = location.search || "";
    return h.includes("sso_token") || q.includes("support_token")
      || q.includes("activate") || q.includes("reset");
  }

  function restore() {
    if (window._wfpCurrentUser) return;           // al ingelogd
    if (urlCarriesOwnAuth()) return;              // main.js doet dit pad
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;

    fetch("/api/me", { headers: { Authorization: "Bearer " + token } })
      .then(r => r.json())
      .then(me => {
        if (!me || !me.ok || !me.user) throw new Error("sessie ongeldig");
        window._wfpCurrentUser = me.user;
        const login = document.getElementById("loginPage");
        if (login) login.classList.add("hidden");
        // Zelfde schakelaar als main.js gebruikt · de CSS hangt eraan.
        document.body.classList.remove("guest");
        document.body.classList.add("authenticated");
        const router = window.WorkFlowProPlatformRouter;
        if (router) router.showPlatform(me.user.role);
        else setTimeout(() => window.WorkFlowProPlatformRouter
          && window.WorkFlowProPlatformRouter.showPlatform(me.user.role), 200);
      })
      .catch(() => {
        // Verlopen of ingetrokken: opruimen. Stil laten staan geeft bij de
        // volgende actie een 401 waar de gebruiker niets van begrijpt.
        localStorage.removeItem(TOKEN_KEY);
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", restore);
  else restore();
})();
