"use strict";
/**
 * Gedeelde frontend-kern. Vóór dit dupliceerde elke platform-shell zijn eigen
 * token()/tenantId()/esc() + fetch-met-401-afhandeling. Die staan nu één keer hier;
 * de shells houden hun eigen api()-signatuur als dunne wrapper rond wfpCore.request.
 *
 * - wfpCore.token()        → bearer-token uit localStorage
 * - wfpCore.tenantId()     → tenant-id uit het token-payload
 * - wfpCore.esc(v)         → HTML-escape (incl. ' — strikt veiliger)
 * - wfpCore.request(p,opt) → fetch met auth-header, 401→login, JSON terug, gooit bij !ok
 */
(function () {
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  function token() { return localStorage.getItem("wfp_token") || ""; }
  function tenantId() {
    try { return JSON.parse(atob(token().split(".")[0])).tenantId || ""; }
    catch (_) { return ""; }
  }
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, c => ESC[c]); }

  // Veilige tagged-template: escapet ELKE interpolatie automatisch. Markeer bewust
  // vertrouwde HTML met wfpCore.raw(x) om escaping over te slaan.
  //   el.innerHTML = wfpCore.html`<td>${user.name}</td>`;  // user.name wordt geëscaped
  function raw(s) { return { __raw: String(s == null ? "" : s) }; }
  function html(strings, ...values) {
    return strings.reduce((acc, str, i) => {
      if (i === 0) return str;
      const v = values[i - 1];
      const piece = v && v.__raw !== undefined ? v.__raw : esc(Array.isArray(v) ? v.join("") : v);
      return acc + piece + str;
    }, "");
  }

  // Gedeelde fetch-engine. `fullPath` is het volledige /api-pad. opts: {method, body, headers}.
  // body wordt verwacht als reeds-geserialiseerde string (zoals de shells het doorgeven).
  function request(fullPath, opts) {
    const o = opts || {};
    return fetch(fullPath, {
      method: o.method || "GET",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token(), ...(o.headers || {}) },
      body: o.body !== undefined ? o.body : undefined,
    }).then(async r => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Sessie verlopen → terug naar login (behalve op /auth/-paden zelf).
        if (r.status === 401 && !/\/api\/auth\//.test(fullPath)) {
          localStorage.removeItem("wfp_token");
          window.showToast && window.showToast("Je sessie is verlopen — log opnieuw in.", "warning");
          setTimeout(() => location.reload(), 1200);
        }
        throw Object.assign(new Error(data.error || ("API fout " + r.status)), { status: r.status, data });
      }
      return data;
    });
  }

  // Platform-aankondiging / onderhoudsbanner — getoond bovenaan elke shell.
  // Best-effort: faalt stil als het endpoint niet bereikbaar is.
  function showAnnouncementBanner() {
    fetch("/api/announcement").then(r => r.json()).then(d => {
      const a = d && d.announcement;
      const el = document.getElementById("wfp-announcement");
      if (!a || !a.active || !a.message) { if (el) el.remove(); return; }
      const colors = { info: "#2563eb", warning: "#d97706", maintenance: "#dc2626" };
      const bar = el || document.createElement("div");
      bar.id = "wfp-announcement";
      bar.setAttribute("role", "status");
      bar.style.cssText = `position:fixed;top:0;left:0;right:0;z-index:9999;background:${colors[a.level] || colors.info};color:#fff;padding:8px 16px;text-align:center;font-size:13.5px;font-weight:600;box-shadow:0 1px 4px rgba(0,0,0,.15)`;
      bar.textContent = (a.level === "maintenance" ? "🛠 " : a.level === "warning" ? "⚠ " : "ℹ ") + a.message;
      if (!el) document.body.prepend(bar);
      document.body.style.paddingTop = bar.offsetHeight + "px";
    }).catch(() => {});
  }

  window.wfpCore = { token, tenantId, esc, html, raw, request, showAnnouncementBanner };
})();
