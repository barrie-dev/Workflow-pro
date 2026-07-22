/* ── Formulieren · beheer van de canonieke Forms-capability (Forms-handover) ──
 * Zelfstandige view-renderer die zich registreert in window.wfpAdmin.views onder
 * "formulieren". Beheert de canonieke formulierdefinities: standaardcatalogus
 * zaaien (h25), normatieve dictionary-structuur zetten (h6-h24), publiceren
 * (immutable versies), activatiestatus en de activatie-check (8 lagen, h2).
 * Praat met form-definitions/* · vereist PostgreSQL (503 wordt netjes getoond).
 */
(function () {
  "use strict";
  const A = window.wfpAdmin;
  if (!A) return;
  const esc = A.esc || (s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  const val = v => (typeof v === "function" ? v() : v);

  async function apiCall(path, options) {
    const tid = val(A.tenantId);
    const tok = val(A.token) || localStorage.getItem("wfp_token") || "";
    const res = await fetch(`/api/tenants/${tid}${path}`, {
      ...(options || {}),
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok, ...((options || {}).headers || {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "Actie mislukt"), { status: res.status, code: data.code, data });
    return data;
  }

  const STATUS_OPTS = ["available", "enabled", "conditional", "scheduled", "paused", "deprecated", "archived"];
  const STATUS_TONE = { system_required: "chip-info", enabled: "chip-ok", available: "chip-muted", conditional: "chip-warn", scheduled: "chip-warn", paused: "chip-warn", deprecated: "chip-err", archived: "chip-muted" };
  const CLS_LABEL = { public: "Publiek", internal: "Intern", confidential: "Vertrouwelijk", personal: "Persoonsgegevens", special_category: "Bijzondere categorie", financial: "Financieel", security_sensitive: "Security" };

  function defRow(f) {
    const statusSel = f.status === "system_required"
      ? `<span class="frm-chip chip-info">system_required</span>`
      : `<select class="frm-status" data-id="${esc(f.id)}" aria-label="Status voor ${esc(f.name)}">
           ${STATUS_OPTS.map(s => `<option value="${s}"${s === f.status ? " selected" : ""}>${s}</option>`).join("")}
         </select>`;
    const pub = f.current_version
      ? `<span class="frm-chip chip-ok">v${esc(f.current_version)}</span>`
      : `<span class="frm-chip chip-muted">concept</span>`;
    const chapter = f.attributes && f.attributes.dictionary_chapter;
    return `<tr data-id="${esc(f.id)}">
      <td><strong>${esc(f.key)}</strong><br><span class="frm-sub">${esc(f.name)}</span></td>
      <td>${esc(f.form_type)}</td>
      <td>${statusSel}</td>
      <td>${pub}</td>
      <td><span class="frm-chip ${STATUS_TONE[f.status] || "chip-muted"}" title="classificatie">${esc(CLS_LABEL[f.data_classification] || f.data_classification)}</span></td>
      <td class="frm-actions">
        ${chapter ? `<button class="btn-sm frm-dict" data-id="${esc(f.id)}" title="Normatieve h${esc(chapter)}-structuur op de concept-versie zetten">Dictionary h${esc(chapter)}</button>` : ""}
        <button class="btn-sm frm-publish" data-id="${esc(f.id)}">Publiceer</button>
        <button class="btn-sm frm-check" data-id="${esc(f.id)}">Activatie-check</button>
      </td>
    </tr>`;
  }

  async function render() {
    const content = document.getElementById("admContent") || document.querySelector(".adm-content");
    if (!content) return;
    content.innerHTML = `<div class="frm-wrap">
      <div class="frm-head">
        <div>
          <h2 data-i18n="forms.title">Formulieren</h2>
          <p class="frm-sub" data-i18n="forms.intro">Eén platformbrede formulierencatalogus: definities, versies, activatie en rechten. Publiceren maakt een versie onveranderlijk; wijzigen maakt een nieuwe versie.</p>
        </div>
        <button class="btn frm-seed" data-i18n="forms.seed">Standaardcatalogus zaaien</button>
      </div>
      <div class="frm-msg" role="status"></div>
      <div class="frm-tablewrap"><table class="frm-table">
        <thead><tr><th data-i18n="forms.col.form">Formulier</th><th>Type</th><th data-i18n="forms.col.status">Status</th><th data-i18n="forms.col.version">Versie</th><th data-i18n="forms.col.class">Classificatie</th><th data-i18n="forms.col.actions">Acties</th></tr></thead>
        <tbody><tr><td colspan="6" data-i18n="common.loading">Laden…</td></tr></tbody>
      </table></div>
      <style>
        .frm-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:12px}
        .frm-sub{font-size:12px;color:var(--gray-500)}
        .frm-tablewrap{overflow-x:auto}
        .frm-table{width:100%;border-collapse:collapse;font-size:13px}
        .frm-table th,.frm-table td{padding:8px 10px;border-bottom:1px solid var(--gray-200);text-align:left;vertical-align:top}
        .frm-chip{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;background:var(--gray-100)}
        .chip-ok{background:#e6f4ea;color:#137333}.chip-warn{background:#fef7e0;color:#b06000}
        .chip-err{background:#fce8e6;color:#c5221f}.chip-info{background:#e8f0fe;color:#1a73e8}.chip-muted{background:var(--gray-100);color:var(--gray-600)}
        .frm-actions{white-space:nowrap}.frm-actions .btn-sm{margin-right:6px}
        .frm-msg{min-height:20px;font-size:13px;margin-bottom:8px}
        .frm-msg.ok{color:#137333}.frm-msg.err{color:#c5221f}
        .frm-status{font-size:12px;padding:2px 4px}
      </style>
    </div>`;
    if (window.wfpI18n && window.wfpI18n.apply) window.wfpI18n.apply(content);

    const msg = content.querySelector(".frm-msg");
    const tbody = content.querySelector("tbody");
    const say = (cls, text) => { msg.className = "frm-msg " + cls; msg.textContent = text; };

    async function load() {
      try {
        const d = await apiCall("/form-definitions");
        tbody.innerHTML = (d.forms || []).length
          ? d.forms.map(defRow).join("")
          : `<tr><td colspan="6">Nog geen definities. Zaai de standaardcatalogus (35 formulieren, h25).</td></tr>`;
        wire();
      } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6">${esc(e.code === "FORMS_REQUIRES_PG"
          ? "De canonieke Forms-capability vereist PostgreSQL. In deze omgeving (JSON-opslag) is het beheer alleen-lezen."
          : e.message || "Laden mislukt")}</td></tr>`;
      }
    }

    function wire() {
      tbody.querySelectorAll(".frm-dict").forEach(b => b.addEventListener("click", async () => {
        b.disabled = true;
        try { const r = await apiCall(`/form-definitions/${encodeURIComponent(b.dataset.id)}/structure/dictionary`, { method: "POST" });
          say("ok", `Dictionary-structuur gezet (${r.result.fields ?? "?"} velden). Publiceer om ze vast te leggen.`); }
        catch (e) { say("err", e.message); }
        b.disabled = false;
      }));
      tbody.querySelectorAll(".frm-publish").forEach(b => b.addEventListener("click", async () => {
        b.disabled = true;
        try { const r = await apiCall(`/form-definitions/${encodeURIComponent(b.dataset.id)}/publish`, { method: "POST" });
          say("ok", `Versie ${r.version.versionNumber ?? ""} gepubliceerd (onveranderlijk).`); load(); }
        catch (e) { say("err", e.message); b.disabled = false; }
      }));
      tbody.querySelectorAll(".frm-check").forEach(b => b.addEventListener("click", async () => {
        try { const r = await apiCall(`/form-definitions/${encodeURIComponent(b.dataset.id)}/activation`);
          const a = r.activation;
          say(a.active ? "ok" : "err", a.active ? "Actief voor jou in deze context." : `Niet actief · geblokkeerd door laag "${a.blockedBy}": ${a.reason}`); }
        catch (e) { say("err", e.message); }
      }));
      tbody.querySelectorAll(".frm-status").forEach(sel => sel.addEventListener("change", async () => {
        try { await apiCall(`/form-definitions/${encodeURIComponent(sel.dataset.id)}/status`, { method: "PATCH", body: JSON.stringify({ status: sel.value }) });
          say("ok", `Status → ${sel.value}.`); }
        catch (e) { say("err", e.message); load(); }
      }));
    }

    content.querySelector(".frm-seed").addEventListener("click", async (ev) => {
      ev.target.disabled = true;
      try { const r = await apiCall("/form-definitions/seed", { method: "POST" });
        say("ok", `Catalogus gezaaid: ${r.result.created.length} nieuw, ${r.result.skipped.length} bestonden al.`); load(); }
      catch (e) { say("err", e.message); }
      ev.target.disabled = false;
    });

    load();
  }

  A.views = A.views || {};
  A.views.formulieren = render;
  if (A.VIEW_LABELS) A.VIEW_LABELS.formulieren = "Formulieren";
}());
