/* ── Profielen & rechten · samenstelbare custom rollen (#75, frontend) ────────
 * Zelfstandige view-renderer die zich registreert in window.wfpAdmin.views onder
 * "profielen". De organisatie stelt hier zelf een profiel samen uit de granulaire
 * rechtencatalogus (rechten-gedreven, "één portaal"): kies rechten + scope,
 * geef het een naam, en wijs het toe aan medewerkers. Praat met de bestaande
 * API (GET permission-catalog, GET/POST/DELETE roles). Puur additief: raakt de
 * grote admin-shell niet aan, behalve één nav-item + dit script.
 */
(function () {
  "use strict";
  const A = window.wfpAdmin;
  if (!A) return;
  const esc = A.esc || (s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));

  // A.token en A.tenantId zijn getters (functies) in de admin-shell; los ze op.
  const val = v => (typeof v === "function" ? v() : v);
  async function apiCall(path, options) {
    const tid = val(A.tenantId);
    const tok = val(A.token) || localStorage.getItem("wfp_token") || "";
    const res = await fetch(`/api/tenants/${tid}${path}`, {
      ...(options || {}),
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok, ...((options || {}).headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Actie mislukt"), { status: res.status, data });
    return data;
  }

  const SCOPE_OPTS = [
    ["all", "Volledig"],
    ["team", "Team"],
    ["own", "Eigen"],
    ["read", "Alleen lezen"],
  ];

  function permRow(p, group) {
    const scopeSel = group === "operationeel"
      ? `<select class="prof-scope" data-key="${esc(p.key)}" aria-label="Scope voor ${esc(p.label)}">
           ${SCOPE_OPTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
         </select>`
      : `<span class="prof-scope-fixed">${group === "financieel" ? "gevoelig" : "volledig"}</span>`;
    return `<label class="prof-perm">
      <input type="checkbox" class="prof-check" value="${esc(p.key)}" data-group="${esc(group)}">
      <span class="prof-perm-label">${esc(p.label)}</span>
      ${scopeSel}
    </label>`;
  }

  function collectPermissions(root) {
    const out = [];
    root.querySelectorAll(".prof-check:checked").forEach(cb => {
      const key = cb.value;
      if (cb.dataset.group !== "operationeel") { out.push(key); return; }
      const sel = root.querySelector(`.prof-scope[data-key="${CSS.escape(key)}"]`);
      const scope = sel ? sel.value : "all";
      out.push(scope === "all" ? key : `${scope}:${key}`);
    });
    return out;
  }

  function roleCard(r) {
    const perms = (r.permissions || []).map(p => `<code class="prof-tag">${esc(p)}</code>`).join(" ");
    return `<div class="prof-card" data-role="${esc(r.id)}">
      <div class="prof-card-head">
        <div>
          <strong>${esc(r.name)}</strong>
          <span class="prof-count">${(r.permissions || []).length} rechten · ${r.assignedCount || 0} toegewezen</span>
        </div>
        <button class="prof-del" data-role="${esc(r.id)}" data-name="${esc(r.name)}" title="Profiel verwijderen">Verwijderen</button>
      </div>
      ${r.description ? `<p class="prof-desc">${esc(r.description)}</p>` : ""}
      <div class="prof-tags">${perms}</div>
    </div>`;
  }

  function styles() {
    if (document.getElementById("prof-styles")) return "";
    return `<style id="prof-styles">
      .prof-wrap{display:grid;gap:20px;grid-template-columns:1fr;max-width:960px}
      @media(min-width:900px){.prof-wrap{grid-template-columns:1fr 1fr}}
      .prof-panel{background:var(--wf-surface,#fff);border:1px solid var(--wf-border,#e5e9f0);border-radius:14px;padding:18px}
      .prof-panel h3{margin:0 0 4px;font:600 15px/1.3 system-ui,sans-serif}
      .prof-panel .prof-sub{color:var(--wf-muted,#64748b);font-size:13px;margin:0 0 14px}
      .prof-card{border:1px solid var(--wf-border,#e5e9f0);border-radius:12px;padding:12px 14px;margin-bottom:10px;background:var(--wf-surface,#fff)}
      .prof-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
      .prof-count{display:block;color:var(--wf-muted,#64748b);font-size:12px;margin-top:2px}
      .prof-desc{margin:8px 0 6px;font-size:13px;color:var(--wf-text,#0b1320)}
      .prof-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
      .prof-tag{background:var(--wf-chip,#eef2f8);border-radius:6px;padding:1px 6px;font-size:11px;color:#334155}
      .prof-del{background:none;border:1px solid var(--wf-border,#e5e9f0);border-radius:8px;padding:4px 10px;font-size:12px;color:var(--wf-red,#c0392b);cursor:pointer}
      .prof-del:hover{background:#fdecea}
      .prof-group{margin:12px 0 4px;font:600 12px/1 system-ui;letter-spacing:.04em;text-transform:uppercase;color:var(--wf-muted,#64748b)}
      .prof-perm{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px}
      .prof-perm-label{flex:1}
      .prof-scope{font-size:12px;border:1px solid var(--wf-border,#e5e9f0);border-radius:6px;padding:2px 4px}
      .prof-scope-fixed{font-size:11px;color:var(--wf-muted,#94a3b8)}
      .prof-field{display:block;margin:8px 0}
      .prof-field label{display:block;font-size:12px;color:var(--wf-muted,#64748b);margin-bottom:3px}
      .prof-field input,.prof-field textarea{width:100%;box-sizing:border-box;border:1px solid var(--wf-border,#e5e9f0);border-radius:8px;padding:8px 10px;font:inherit}
      .prof-save{margin-top:14px;background:var(--wf-primary,#0071E3);color:#fff;border:0;border-radius:9px;padding:9px 16px;font:600 14px system-ui;cursor:pointer}
      .prof-save:disabled{opacity:.55;cursor:default}
      .prof-msg{margin-top:10px;font-size:13px}
      .prof-msg.err{color:var(--wf-red,#c0392b)}
      .prof-msg.ok{color:var(--wf-green,#1a8f5a)}
      .prof-empty{color:var(--wf-muted,#94a3b8);font-size:13px;padding:8px 0}
    </style>`;
  }

  async function render() {
    const content = A.content();
    if (!content) return;
    content.innerHTML = `<div class="adm-loading">Laden…</div>`;
    let catalog, rolesData;
    try {
      catalog = (await apiCall("/permission-catalog")).catalog;
      rolesData = await apiCall("/roles");
    } catch (e) {
      content.innerHTML = `<div class="prof-msg err">Kon profielen niet laden: ${esc(e.message)}</div>`;
      return;
    }

    const groups = [
      ["operationeel", "Operationele rechten", catalog.operational || []],
      ["beheer", "Beheer", (catalog.admin || []).filter(a => a.group === "beheer")],
      ["financieel", "Financieel", (catalog.admin || []).filter(a => a.group === "financieel")],
    ];
    const permHtml = groups.filter(g => g[2].length).map(([key, label, list]) =>
      `<div class="prof-group">${esc(label)}</div>${list.map(p => permRow(p, key)).join("")}`
    ).join("");

    const customList = (rolesData.custom || []);
    content.innerHTML = `${styles()}
      <div class="prof-wrap">
        <div class="prof-panel" id="profList">
          <h3>Profielen van je organisatie</h3>
          <p class="prof-sub">Zelf samengestelde rollen uit granulaire rechten. Ingebouwd: ${(rolesData.builtin || []).map(b => esc(b.name)).join(", ")}.</p>
          ${customList.length ? customList.map(roleCard).join("") : `<div class="prof-empty">Nog geen eigen profielen. Stel er rechts een samen.</div>`}
        </div>
        <div class="prof-panel">
          <h3>Nieuw profiel samenstellen</h3>
          <p class="prof-sub">Kies rechten (en scope) en geef het profiel een naam. Platform- en abonnementsrechten zijn bewust niet toekenbaar.</p>
          <form id="profForm">
            <div class="prof-field"><label>Naam</label><input name="name" required maxlength="60" placeholder="bv. Werfleider met margezicht"></div>
            <div class="prof-field"><label>Omschrijving (optioneel)</label><input name="description" maxlength="160" placeholder="Waarvoor dient dit profiel?"></div>
            <div id="profPerms">${permHtml}</div>
            <button type="submit" class="prof-save">Profiel aanmaken</button>
            <div class="prof-msg" id="profMsg"></div>
          </form>
        </div>
      </div>`;

    const form = content.querySelector("#profForm");
    const msg = content.querySelector("#profMsg");
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      msg.className = "prof-msg"; msg.textContent = "";
      const name = form.name.value.trim();
      const permissions = collectPermissions(content.querySelector("#profPerms"));
      if (!permissions.length) { msg.className = "prof-msg err"; msg.textContent = "Kies minstens één recht."; return; }
      const btn = form.querySelector(".prof-save");
      btn.disabled = true;
      try {
        await apiCall("/roles", { method: "POST", body: JSON.stringify({ name, description: form.description.value.trim(), permissions }) });
        msg.className = "prof-msg ok"; msg.textContent = `Profiel "${name}" aangemaakt.`;
        render(); // herlaad de lijst + reset het formulier
      } catch (e) {
        btn.disabled = false;
        msg.className = "prof-msg err"; msg.textContent = e.message || "Aanmaken mislukt.";
      }
    });

    content.querySelectorAll(".prof-del").forEach(b => b.addEventListener("click", async () => {
      if (!window.confirm(`Profiel "${b.dataset.name}" verwijderen?`)) return;
      try { await apiCall(`/roles/${encodeURIComponent(b.dataset.role)}`, { method: "DELETE" }); render(); }
      catch (e) { window.alert(e.message || "Verwijderen mislukt."); }
    }));
  }

  A.views = A.views || {};
  A.views.profielen = render;
  if (A.VIEW_LABELS) A.VIEW_LABELS.profielen = "Profielen & rechten";
}());
