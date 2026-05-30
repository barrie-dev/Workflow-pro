/**
 * workorder-detail.js
 * Werkbon detailpagina · foto upload · handtekening canvas · checklist
 * Gebruik: public/workorder-detail.js — importeer via <script src="/workorder-detail.js">
 *
 * Vereisten: window.token, window.tenantId, window.state
 * Opent een full-screen panel bovenop de bestaande UI
 */

(function () {
  "use strict";

  // ── helpers ───────────────────────────────────────────────────────────────────

  function esc(v) {
    return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function personName(userId) {
    return (window.state?.users || []).find(u => u.id === userId)?.name || userId || "–";
  }
  function venueName(venueId) {
    return (window.state?.venues || []).find(v => v.id === venueId)?.name || venueId || "–";
  }

  async function apiCall(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(window.token ? { Authorization: `Bearer ${window.token}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "API-fout");
    return data;
  }

  function statusTone(status) {
    if (["Voltooid", "Afgewerkt"].includes(status)) return "#11975d";
    if (["Bezig", "In uitvoering"].includes(status)) return "#1268d6";
    if (["Review"].includes(status)) return "#f28b18";
    return "#5f728c";
  }

  // ── styles ────────────────────────────────────────────────────────────────────

  const STYLES = `
<style id="wo-detail-styles">
.wo-panel-backdrop {
  position:fixed; inset:0; background:rgba(15,39,68,.42); z-index:200;
  display:flex; align-items:flex-start; justify-content:flex-end;
}
.wo-panel {
  background:#fff; width:min(680px,100vw); height:100vh;
  overflow-y:auto; display:flex; flex-direction:column;
  box-shadow:-8px 0 40px rgba(0,0,0,.18); font-family:Inter,"Segoe UI",Arial,sans-serif;
}
.wo-panel-head {
  position:sticky; top:0; background:#fff; border-bottom:1px solid #d9e3ef;
  padding:16px 20px; display:flex; align-items:center; gap:12px; z-index:10;
}
.wo-panel-head h2 { margin:0; font-size:18px; flex:1; }
.wo-panel-head .wo-status-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
.wo-panel-close { background:none; border:none; font-size:22px; cursor:pointer; color:#5f728c; line-height:1; padding:0; }

.wo-body { padding:20px; flex:1; }
.wo-section { margin-bottom:24px; }
.wo-section-title { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:#5f728c; margin-bottom:10px; }

.wo-meta-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.wo-meta-item span { font-size:11px; color:#5f728c; display:block; }
.wo-meta-item strong { font-size:14px; }

.wo-status-bar { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:18px; }
.wo-status-btn { padding:5px 12px; border-radius:20px; border:1px solid; font-size:12px; cursor:pointer; background:#fff; }
.wo-status-btn.active { color:#fff; }

/* Checklist */
.wo-checklist { display:grid; gap:8px; }
.wo-check-item { display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid #d9e3ef; border-radius:7px; cursor:pointer; transition:background .1s; }
.wo-check-item:hover { background:#f6f9fc; }
.wo-check-item.done { background:#f0fdf4; border-color:#a7f3d0; }
.wo-check-item input[type=checkbox] { width:18px; height:18px; cursor:pointer; flex-shrink:0; }
.wo-check-item label { flex:1; font-size:14px; cursor:pointer; }
.wo-check-item.done label { text-decoration:line-through; color:#5f728c; }
.wo-checklist-add { display:flex; gap:8px; margin-top:8px; }
.wo-checklist-add input { flex:1; border:1px solid #d9e3ef; border-radius:6px; padding:7px 10px; font-size:14px; }
.wo-checklist-add button { padding:7px 14px; border-radius:6px; background:#004a68; color:#fff; border:none; cursor:pointer; font-size:13px; }

/* Foto upload */
.wo-photos { display:grid; grid-template-columns:repeat(auto-fill,minmax(120px,1fr)); gap:10px; margin-bottom:12px; }
.wo-photo-thumb { aspect-ratio:1; border-radius:7px; overflow:hidden; border:1px solid #d9e3ef; position:relative; background:#f6f9fc; }
.wo-photo-thumb img { width:100%; height:100%; object-fit:cover; }
.wo-photo-thumb .wo-photo-remove { position:absolute; top:4px; right:4px; background:rgba(255,255,255,.9); border:none; border-radius:50%; width:22px; height:22px; cursor:pointer; font-size:14px; line-height:22px; text-align:center; }
.wo-photo-add { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; aspect-ratio:1; border:2px dashed #d9e3ef; border-radius:7px; cursor:pointer; color:#5f728c; font-size:12px; transition:border-color .15s; }
.wo-photo-add:hover { border-color:#1268d6; color:#1268d6; }
.wo-photo-add .wo-plus { font-size:28px; line-height:1; }
.wo-photo-input { display:none; }

/* Handtekening */
.wo-sig-wrap { position:relative; }
.wo-sig-canvas {
  border:1px solid #d9e3ef; border-radius:8px; display:block; width:100%;
  touch-action:none; cursor:crosshair; background:#fafafa;
}
.wo-sig-canvas.signed { background:#f0fdf4; cursor:default; }
.wo-sig-tools { display:flex; gap:8px; margin-top:8px; align-items:center; }
.wo-sig-tools button { padding:6px 14px; border-radius:6px; border:1px solid #d9e3ef; background:#fff; font-size:13px; cursor:pointer; }
.wo-sig-tools button:hover { background:#f6f9fc; }
.wo-sig-label { font-size:12px; color:#5f728c; flex:1; text-align:right; }
.wo-sig-name-row { display:flex; gap:8px; margin-top:8px; }
.wo-sig-name-row input { flex:1; border:1px solid #d9e3ef; border-radius:6px; padding:7px 10px; font-size:14px; }
.wo-sig-name-row button { padding:7px 16px; border-radius:6px; background:#11975d; color:#fff; border:none; cursor:pointer; font-size:13px; }
.wo-sig-done { background:#f0fdf4; border:1px solid #a7f3d0; border-radius:7px; padding:10px 14px; font-size:13px; color:#11975d; display:flex; align-items:center; gap:8px; }

/* Actie footer */
.wo-footer {
  position:sticky; bottom:0; background:#fff; border-top:1px solid #d9e3ef;
  padding:14px 20px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;
}
.wo-footer .wo-complete-btn { background:#11975d; color:#fff; border:none; border-radius:7px; padding:10px 22px; font-size:15px; font-weight:700; cursor:pointer; }
.wo-footer .wo-complete-btn:disabled { opacity:.5; cursor:not-allowed; }
.wo-footer .wo-invoice-btn { background:#004a68; color:#fff; border:none; border-radius:7px; padding:10px 22px; font-size:15px; font-weight:700; cursor:pointer; }
.wo-footer .wo-missing { font-size:12px; color:#e53535; flex:1; }
.wo-footer .wo-ok { font-size:12px; color:#11975d; flex:1; }
.wo-notice { background:#fff8e6; border:1px solid #fbbf24; border-radius:7px; padding:10px 14px; font-size:13px; color:#92400e; margin-bottom:12px; }
</style>`;

  // ── panel state ───────────────────────────────────────────────────────────────

  let sigCtx = null;
  let sigDrawing = false;
  let currentWorkorderId = null;

  // ── open / close ──────────────────────────────────────────────────────────────

  function openWorkorderDetail(workorderId) {
    closeWorkorderDetail();
    currentWorkorderId = workorderId;
    const workorder = (window.state?.workorders || []).find(w => w.id === workorderId);
    if (!workorder) return;
    renderPanel(workorder);
  }

  function closeWorkorderDetail() {
    const existing = document.getElementById("wo-panel-backdrop");
    if (existing) existing.remove();
    currentWorkorderId = null;
    sigCtx = null;
  }

  // ── render ────────────────────────────────────────────────────────────────────

  function renderPanel(workorder) {
    const checklist = workorder.checklist || [];
    const files = workorder.files || [];
    const isDone = ["Voltooid", "Afgewerkt"].includes(workorder.status);
    const missingItems = [];
    if (!checklist.every(i => i.done)) missingItems.push("checklist niet afgerond");
    if (!files.length && workorder.requiresPhoto) missingItems.push("foto ontbreekt");
    if (!workorder.signed && workorder.requiresSignature) missingItems.push("handtekening ontbreekt");

    const backdrop = document.createElement("div");
    backdrop.id = "wo-panel-backdrop";
    backdrop.className = "wo-panel-backdrop";

    backdrop.innerHTML = `
      ${STYLES}
      <div class="wo-panel" role="dialog" aria-modal="true" aria-label="Werkbon detail">
        <div class="wo-panel-head">
          <div class="wo-status-dot" style="background:${statusTone(workorder.status)}"></div>
          <h2>${esc(workorder.title || "Werkbon")}</h2>
          <button class="wo-panel-close" id="wo-panel-close" aria-label="Sluiten">×</button>
        </div>

        <div class="wo-body">
          ${isDone ? `<div class="wo-notice">✓ Werkbon afgerond op ${esc(workorder.completedAt?.slice(0,10) || "–")} door ${esc(workorder.completedBy || "–")}</div>` : ""}

          <!-- Status -->
          <div class="wo-section">
            <div class="wo-section-title">Status</div>
            <div class="wo-status-bar">
              ${["Nieuw","Bezig","Review","Voltooid"].map(s => `
                <button class="wo-status-btn ${workorder.status === s ? "active" : ""}"
                  style="${workorder.status === s ? `background:${statusTone(s)};border-color:${statusTone(s)}` : `color:${statusTone(s)};border-color:${statusTone(s)}`}"
                  data-status="${esc(s)}">${esc(s)}</button>
              `).join("")}
            </div>
          </div>

          <!-- Meta -->
          <div class="wo-section">
            <div class="wo-section-title">Details</div>
            <div class="wo-meta-grid">
              <div class="wo-meta-item"><span>Uitvoerder</span><strong>${esc(personName(workorder.userId))}</strong></div>
              <div class="wo-meta-item"><span>Werf</span><strong>${esc(venueName(workorder.venueId))}</strong></div>
              <div class="wo-meta-item"><span>Aangemaakt</span><strong>${esc(workorder.createdAt?.slice(0,10) || "–")}</strong></div>
              <div class="wo-meta-item"><span>Factureerbaar</span><strong>${workorder.billable === false ? "Nee" : "Ja"}</strong></div>
            </div>
            ${workorder.description ? `<p style="margin:10px 0 0;font-size:14px;color:#5f728c">${esc(workorder.description)}</p>` : ""}
          </div>

          <!-- Checklist -->
          <div class="wo-section">
            <div class="wo-section-title">Checklist (${checklist.filter(i=>i.done).length}/${checklist.length})</div>
            <div class="wo-checklist" id="wo-checklist">
              ${checklist.map((item, idx) => `
                <div class="wo-check-item ${item.done ? "done" : ""}" data-idx="${idx}">
                  <input type="checkbox" id="wc-${idx}" ${item.done ? "checked" : ""} ${isDone ? "disabled" : ""}>
                  <label for="wc-${idx}">${esc(item.label)}</label>
                </div>
              `).join("") || `<p style="color:#5f728c;font-size:14px">Geen checklistpunten.</p>`}
            </div>
            ${!isDone ? `
            <div class="wo-checklist-add">
              <input type="text" id="wo-new-check" placeholder="Nieuw checklistpunt toevoegen...">
              <button id="wo-add-check">+ Toevoegen</button>
            </div>` : ""}
          </div>

          <!-- Foto's -->
          <div class="wo-section">
            <div class="wo-section-title">Foto's en bewijsstukken (${files.length})</div>
            <div class="wo-photos" id="wo-photos">
              ${files.map((f, idx) => `
                <div class="wo-photo-thumb" data-idx="${idx}">
                  <img src="${esc(f.url || f.dataUrl || "")}" alt="${esc(f.name || "foto")}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22><rect fill=%22%23f6f9fc%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2255%22 text-anchor=%22middle%22 font-size=%2212%22 fill=%22%235f728c%22>${esc(f.name||"foto")}</text></svg>'">
                  ${!isDone ? `<button class="wo-photo-remove" data-idx="${idx}" title="Verwijderen">×</button>` : ""}
                </div>
              `).join("")}
              ${!isDone ? `
              <label class="wo-photo-add" for="wo-photo-input">
                <span class="wo-plus">+</span>
                <span>Foto toevoegen</span>
              </label>
              <input type="file" class="wo-photo-input" id="wo-photo-input" accept="image/jpeg,image/png,image/webp" multiple>` : ""}
            </div>
            <p style="font-size:12px;color:#5f728c;margin:0">Max 8 MB · JPEG, PNG of WebP</p>
          </div>

          <!-- Handtekening -->
          <div class="wo-section">
            <div class="wo-section-title">Handtekening klant / uitvoerder</div>
            ${workorder.signed ? `
              <div class="wo-sig-done">
                ✓ Ondertekend door <strong style="margin:0 4px">${esc(workorder.signerName || "–")}</strong>
                op ${esc(workorder.signedAt?.slice(0,10) || "–")}
              </div>
            ` : `
              <canvas class="wo-sig-canvas" id="wo-sig-canvas" width="600" height="160"></canvas>
              <div class="wo-sig-tools">
                <button id="wo-sig-clear">Wissen</button>
                <span class="wo-sig-label">Teken hierboven met muis of vinger</span>
              </div>
              <div class="wo-sig-name-row">
                <input type="text" id="wo-sig-name" placeholder="Naam van ondertekenaar (verplicht)">
                <button id="wo-sig-save">Handtekening opslaan</button>
              </div>
            `}
          </div>
        </div>

        <!-- Footer -->
        <div class="wo-footer">
          ${missingItems.length && !isDone
            ? `<span class="wo-missing">Ontbreekt: ${esc(missingItems.join(", "))}</span>`
            : `<span class="wo-ok">✓ Klaar voor afsluiting</span>`}
          ${!isDone
            ? `<button class="wo-complete-btn" id="wo-complete" ${missingItems.length ? "disabled title='" + esc("Los ontbrekende punten op") + "'" : ""}>Werkbon afronden</button>`
            : workorder.billableStatus === "ready_for_invoice"
              ? `<button class="wo-invoice-btn" id="wo-invoice">Doorsturen naar facturatie</button>`
              : ""}
        </div>
      </div>`;

    document.body.appendChild(backdrop);
    initSignatureCanvas(workorder);
    bindPanelEvents(backdrop, workorder);
  }

  // ── handtekening canvas ───────────────────────────────────────────────────────

  function initSignatureCanvas(workorder) {
    if (workorder.signed) return;
    const canvas = document.getElementById("wo-sig-canvas");
    if (!canvas) return;

    // Schaal voor retina
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = (rect.width || 600) * dpr;
    canvas.height = 160 * dpr;
    canvas.style.height = "160px";

    sigCtx = canvas.getContext("2d");
    sigCtx.scale(dpr, dpr);
    sigCtx.strokeStyle = "#0f2744";
    sigCtx.lineWidth = 2;
    sigCtx.lineCap = "round";
    sigCtx.lineJoin = "round";

    function getPos(e) {
      const r = canvas.getBoundingClientRect();
      const src = e.touches ? e.touches[0] : e;
      return { x: src.clientX - r.left, y: src.clientY - r.top };
    }

    canvas.addEventListener("pointerdown", e => {
      sigDrawing = true;
      const { x, y } = getPos(e);
      sigCtx.beginPath();
      sigCtx.moveTo(x, y);
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener("pointermove", e => {
      if (!sigDrawing) return;
      const { x, y } = getPos(e);
      sigCtx.lineTo(x, y);
      sigCtx.stroke();
    });

    canvas.addEventListener("pointerup", () => { sigDrawing = false; });
    canvas.addEventListener("pointercancel", () => { sigDrawing = false; });
  }

  // ── events ────────────────────────────────────────────────────────────────────

  function bindPanelEvents(backdrop, workorder) {
    const isDone = ["Voltooid", "Afgewerkt"].includes(workorder.status);

    // Sluiten
    document.getElementById("wo-panel-close")?.addEventListener("click", closeWorkorderDetail);
    backdrop.addEventListener("click", e => { if (e.target === backdrop) closeWorkorderDetail(); });

    // Status buttons
    backdrop.querySelectorAll("[data-status]").forEach(btn => {
      btn.addEventListener("click", async () => {
        try {
          await apiCall(`/api/modules/workorders/${workorder.id}?tenantId=${window.tenantId}`, {
            method: "PATCH", body: JSON.stringify({ status: btn.dataset.status, tenantId: window.tenantId })
          });
          await refreshWorkorder(workorder.id);
        } catch (err) { alert(err.message); }
      });
    });

    // Checklist toggle
    if (!isDone) {
      backdrop.querySelectorAll(".wo-check-item").forEach(item => {
        item.querySelector("input[type=checkbox]")?.addEventListener("change", async e => {
          const idx = Number(item.dataset.idx);
          const checklist = [...(workorder.checklist || [])];
          if (checklist[idx]) checklist[idx] = { ...checklist[idx], done: e.target.checked };
          try {
            await apiCall(`/api/modules/workorders/${workorder.id}?tenantId=${window.tenantId}`, {
              method: "PATCH", body: JSON.stringify({ checklist, tenantId: window.tenantId })
            });
            item.classList.toggle("done", e.target.checked);
          } catch (err) { e.target.checked = !e.target.checked; alert(err.message); }
        });
      });

      // Checklist toevoegen
      document.getElementById("wo-add-check")?.addEventListener("click", async () => {
        const input = document.getElementById("wo-new-check");
        const label = input?.value.trim();
        if (!label) return;
        const checklist = [...(workorder.checklist || []), {
          id: `item_${Date.now()}`, label, done: false
        }];
        try {
          await apiCall(`/api/modules/workorders/${workorder.id}?tenantId=${window.tenantId}`, {
            method: "PATCH", body: JSON.stringify({ checklist, tenantId: window.tenantId })
          });
          input.value = "";
          await refreshWorkorder(workorder.id);
        } catch (err) { alert(err.message); }
      });
    }

    // Foto upload
    document.getElementById("wo-photo-input")?.addEventListener("change", async e => {
      const files = [...(e.target.files || [])];
      for (const file of files) {
        if (file.size > 8 * 1024 * 1024) { alert(`${file.name} is te groot (max 8 MB).`); continue; }
        try {
          const reader = new FileReader();
          const dataUrl = await new Promise((res, rej) => { reader.onload = () => res(reader.result); reader.onerror = rej; reader.readAsDataURL(file); });
          await apiCall(`/api/tenants/${window.tenantId}/mobile/workorders/${workorder.id}/photo`, {
            method: "POST",
            body: JSON.stringify({ name: file.name, type: file.type, size: file.size, dataUrl })
          });
          await refreshWorkorder(workorder.id);
        } catch (err) { alert("Upload mislukt: " + err.message); }
      }
    });

    // Foto verwijderen
    backdrop.querySelectorAll(".wo-photo-remove").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        const idx = Number(btn.dataset.idx);
        const files = [...(workorder.files || [])];
        files.splice(idx, 1);
        try {
          await apiCall(`/api/modules/workorders/${workorder.id}?tenantId=${window.tenantId}`, {
            method: "PATCH", body: JSON.stringify({ files, tenantId: window.tenantId })
          });
          await refreshWorkorder(workorder.id);
        } catch (err) { alert(err.message); }
      });
    });

    // Handtekening wissen
    document.getElementById("wo-sig-clear")?.addEventListener("click", () => {
      if (sigCtx) {
        const c = document.getElementById("wo-sig-canvas");
        sigCtx.clearRect(0, 0, c.width, c.height);
      }
    });

    // Handtekening opslaan
    document.getElementById("wo-sig-save")?.addEventListener("click", async () => {
      const nameInput = document.getElementById("wo-sig-name");
      const signerName = nameInput?.value.trim();
      if (!signerName) { alert("Naam van ondertekenaar is verplicht."); nameInput?.focus(); return; }

      const canvas = document.getElementById("wo-sig-canvas");
      if (!canvas) return;

      // Controleer of er getekend is
      const imgData = sigCtx.getImageData(0, 0, canvas.width, canvas.height);
      const hasDrawing = imgData.data.some((v, i) => i % 4 === 3 && v > 0);
      if (!hasDrawing) { alert("Teken eerst een handtekening op het canvas."); return; }

      const signatureDataUrl = canvas.toDataURL("image/png");
      try {
        await apiCall(`/api/tenants/${window.tenantId}/mobile/workorders/${workorder.id}/signature`, {
          method: "POST",
          body: JSON.stringify({ signerName, signatureDataUrl })
        });
        await refreshWorkorder(workorder.id);
      } catch (err) { alert("Handtekening opslaan mislukt: " + err.message); }
    });

    // Werkbon afronden
    document.getElementById("wo-complete")?.addEventListener("click", async () => {
      if (!confirm("Werkbon afronden? Dit kan niet ongedaan worden gemaakt.")) return;
      try {
        await apiCall(`/api/tenants/${window.tenantId}/mobile/workorders/${workorder.id}/complete`, {
          method: "POST",
          body: JSON.stringify({ checklist: workorder.checklist, tenantId: window.tenantId })
        });
        await refreshWorkorder(workorder.id);
      } catch (err) { alert("Afronden mislukt: " + err.message); }
    });

    // Doorsturen naar facturatie
    document.getElementById("wo-invoice")?.addEventListener("click", async () => {
      try {
        await apiCall(`/api/modules/workorders/${workorder.id}?tenantId=${window.tenantId}`, {
          method: "PATCH", body: JSON.stringify({ billableStatus: "sent_to_invoice", tenantId: window.tenantId })
        });
        closeWorkorderDetail();
        if (window.showToast) window.showToast("Doorgestuurd naar facturatie.");
      } catch (err) { alert(err.message); }
    });
  }

  // ── refresh ───────────────────────────────────────────────────────────────────

  async function refreshWorkorder(workorderId) {
    try {
      const data = await apiCall(`/api/modules/workorders?tenantId=${window.tenantId}`);
      if (window.state) window.state.workorders = data.rows || [];
    } catch (e) { /* gebruik bestaande state */ }
    closeWorkorderDetail();
    openWorkorderDetail(workorderId);
    if (window.renderWorkorderExperience) window.renderWorkorderExperience();
  }

  // ── expose ────────────────────────────────────────────────────────────────────

  window.openWorkorderDetail = openWorkorderDetail;
  window.closeWorkorderDetail = closeWorkorderDetail;
})();
