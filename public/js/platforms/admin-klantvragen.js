/* ── Klantvragen (inbox · e-mail-intake) · uitgesplitste werkruimte ──────────
 * Letterlijke extractie uit public/js/platforms/admin.js (regels 3061-3291).
 * Er is bewust NIETS herschreven: alleen de omhulling is nieuw. Wat het scherm
 * niet zelf meebrengt komt uit de gedeelde context window.wfpAdmin, zodat er
 * geen tweede waarheid ontstaat.
 */
(function () {
  "use strict";

  const A = window.wfpAdmin;
  if (!A) return;

  // Gedeelde context · alles wat in admin.js bleef staan, komt hiervandaan.
  const api = A.api;
  const esc = A.esc;
  const tA = A.tA;
  const uiConfirm = A.uiConfirm;
  const openDrawer = A.openDrawer;
  const closeDrawer = A.closeDrawer;
  const switchView = A.switchView;
  // Laat binden: de offerte-drawer staat in het drawerregister van de kern.
  const openOfferteDrawer = quote => A.drawers.offerte(quote);

  // ── Klantvragen (Inbox · e-mail-intake) ────────────────────────────────────
  let _inqFilter = "nieuw";

  function tInqStatus(s) {
    const map = { nieuw: "adm.inq.stNew", in_behandeling: "adm.inq.stBusy", beantwoord: "adm.inq.stAnswered", gesloten: "adm.inq.stClosed" };
    return map[s] ? tA(map[s], s) : (s || "-");
  }

  async function renderInbox() {
    const content = document.getElementById("admContent");
    let rows = [], intake = null;
    try {
      const [inqData, cfgData] = await Promise.all([
        api("GET", "/inquiries"),
        api("GET", "/inquiries/intake-config").catch(() => null),
      ]);
      rows = inqData.inquiries || [];
      intake = cfgData && cfgData.intake;
    }
    catch (e) { content.innerHTML = `<div style="padding:20px;color:var(--wf-red)">${tA("adm.error","Fout")}: ${e.message}</div>`; return; }

    const newCount = rows.filter(q => q.status === "nieuw").length;
    const inboxBadge = document.getElementById("admInboxBadge");
    if (inboxBadge) { inboxBadge.textContent = newCount; inboxBadge.style.display = newCount ? "" : "none"; }

    const filtered = _inqFilter === "nieuw" ? rows.filter(q => q.status === "nieuw")
      : _inqFilter === "open" ? rows.filter(q => ["nieuw", "in_behandeling"].includes(q.status))
      : rows;
    const stCss = { nieuw: "adm-status-nieuw", in_behandeling: "adm-status-pending", beantwoord: "adm-status-goedgekeurd", gesloten: "adm-status-voltooid" };

    content.innerHTML = `
${intake ? `<div class="adm-card" style="margin-bottom:14px">
  <div class="adm-card-body" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:14px 20px;">
    <div style="flex:1;min-width:260px;">
      <div style="font-size:12px;color:var(--gray-500);margin-bottom:4px;">${tA("adm.inq.intakeLabel","Jouw intake-adres · stuur (of stuur door) klantmails naar dit adres")}</div>
      <code id="admIntakeAddr" style="font-size:14px;font-weight:600;">${esc(intake.address || "-")}</code>
      ${intake.live ? "" : `<span class="adm-status adm-status-pending" style="margin-left:8px;">${tA("adm.inq.testMode","testmodus")}</span>`}
    </div>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admIntakeCopy">${tA("adm.inq.copyBtn","Kopieer adres")}</button>
  </div>
</div>` : ""}
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">${tA("nav.inbox","Klantvragen")} <span style="background:var(--wf-blue-l);color:var(--wf-blue);border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${filtered.length}</span></h3>
    <div style="display:flex;gap:8px;align-items:center;">
      <select id="admInqFilter">
        <option value="nieuw" ${_inqFilter==="nieuw"?"selected":""}>${tA("adm.inq.stNew","Nieuw")}</option>
        <option value="open" ${_inqFilter==="open"?"selected":""}>${tA("adm.inq.fOpen","Open")}</option>
        <option value="alle" ${_inqFilter==="alle"?"selected":""}>${tA("mgr.all","Alle")}</option>
      </select>
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="admNewInq">+ ${tA("adm.inq.singular","Klantvraag")}</button>
    </div>
  </div>
  ${filtered.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-text">${tA("adm.inq.empty","Geen klantvragen")}</div><div style="font-size:12px;color:var(--gray-400);margin-top:6px;max-width:420px;margin-left:auto;margin-right:auto;">${tA("adm.inq.emptyHint","Mails naar je intake-adres verschijnen hier automatisch, gekoppeld aan de klant. Telefonische vragen voeg je toe met + Klantvraag.")}</div></div>`
    : `<div class="adm-card-body adm-table-wrap">
    <table class="adm-table">
      <thead><tr><th>${tA("adm.inq.thReceived","Ontvangen")}</th><th>${tA("adm.inq.thFrom","Van")}</th><th>${tA("adm.inq.thSubject","Onderwerp")}</th><th>${tA("adm.thCustomer","Klant")}</th><th>${tA("adm.status","Status")}</th></tr></thead>
      <tbody>
        ${filtered.map(q => `
        <tr class="adm-row-link adm-inq-row" data-id="${esc(q.id)}" style="${q.status === "nieuw" ? "font-weight:600;" : ""}">
          <td style="white-space:nowrap;">${q.receivedAt ? new Date(q.receivedAt).toLocaleString("nl-BE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-"}</td>
          <td>${esc(q.fromName || q.fromEmail || "-")}${q.fromName && q.fromEmail && q.fromEmail !== "-" ? `<div style="font-size:11px;color:var(--gray-400);font-weight:400;">${esc(q.fromEmail)}</div>` : ""}</td>
          <td>${esc(q.subject || "-")}${q.source === "handmatig" ? ` <span style="font-size:11px;color:var(--gray-400);font-weight:400;">· ${tA("adm.inq.manualTag","handmatig")}</span>` : ""}</td>
          <td>${q.customerName ? esc(q.customerName) : `<span style="color:var(--gray-400);font-weight:400;">${tA("adm.inq.noCustomer","niet gekoppeld")}</span>`}</td>
          <td><span class="adm-status ${stCss[q.status]||"adm-status-nieuw"}">${esc(tInqStatus(q.status))}</span></td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`}
</div>`;

    document.getElementById("admInqFilter")?.addEventListener("change", e => { _inqFilter = e.target.value; renderInbox(); });
    document.getElementById("admNewInq")?.addEventListener("click", () => openInquiryDrawer(null));
    document.getElementById("admIntakeCopy")?.addEventListener("click", () => {
      const addr = document.getElementById("admIntakeAddr")?.textContent || "";
      navigator.clipboard?.writeText(addr).then(() => window.showToast && window.showToast(tA("adm.inq.copiedToast","Intake-adres gekopieerd"), "success"));
    });
    content.querySelectorAll(".adm-inq-row").forEach(row => row.addEventListener("click", () => {
      openInquiryDrawer(rows.find(x => x.id === row.dataset.id));
    }));
  }

  async function openInquiryDrawer(inq) {
    const custData = await api("GET", "/customers").catch(() => ({ customers: [] }));
    const customers = custData.customers || [];
    const isEdit = !!inq;
    document.getElementById("admDrawerTitle").textContent = isEdit ? (inq.subject || tA("adm.inq.singular","Klantvraag")) : tA("adm.inq.newTitle","Klantvraag toevoegen");

    if (!isEdit) {
      // Handmatige invoer (telefoon/balie).
      document.getElementById("admDrawerBody").innerHTML = `
<form id="inqForm">
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${tA("adm.inq.fromName","Naam klant")}</label>
      <input name="fromName" value=""></div>
    <div class="adm-form-group"><label>${tA("adm.inq.fromEmail","E-mail klant")}</label>
      <input name="fromEmail" type="email" value=""></div>
  </div>
  <div class="adm-form-group"><label>${tA("adm.inq.thSubject","Onderwerp")} *</label>
    <input name="subject" required></div>
  <div class="adm-form-group"><label>${tA("adm.inq.textLabel","Vraag / omschrijving")}</label>
    <textarea name="text" rows="5" style="width:100%"></textarea></div>
  <div id="inqFormErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="inqCancel">${tA("adm.cancel","Annuleren")}</button>
    <button type="submit" class="adm-btn adm-btn-primary">${tA("adm.createBtn","Aanmaken")}</button>
  </div>
</form>`;
      openDrawer();
      document.getElementById("inqCancel").addEventListener("click", closeDrawer);
      document.getElementById("inqForm").addEventListener("submit", async e => {
        e.preventDefault();
        const errEl = document.getElementById("inqFormErr");
        const body = Object.fromEntries(new FormData(e.target).entries());
        try {
          await api("POST", "/inquiries", body);
          closeDrawer(); renderInbox();
          window.showToast && window.showToast(tA("adm.inq.createdToast","Klantvraag toegevoegd"), "success");
        } catch (err) { if (errEl) { errEl.textContent = err.message; errEl.style.display = ""; } }
      });
      return;
    }

    // Detailweergave met status- en klantkoppeling.
    document.getElementById("admDrawerBody").innerHTML = `
<div style="font-size:12px;color:var(--gray-500);margin-bottom:10px;">
  ${tA("adm.inq.thFrom","Van")}: <strong style="color:var(--ink,#0B1320)">${esc(inq.fromName || "-")}</strong>${inq.fromEmail && inq.fromEmail !== "-" ? ` · ${esc(inq.fromEmail)}` : ""}<br>
  ${tA("adm.inq.thReceived","Ontvangen")}: ${inq.receivedAt ? new Date(inq.receivedAt).toLocaleString("nl-BE") : "-"} · ${inq.source === "handmatig" ? tA("adm.inq.manualTag","handmatig") : tA("adm.inq.viaMail","via e-mail")}
</div>
<div style="background:var(--gray-50);border:1px solid var(--gray-100);border-radius:10px;padding:12px;font-size:13px;white-space:pre-wrap;max-height:300px;overflow:auto;margin-bottom:14px;">${esc(inq.text || "-")}</div>
${((window._wfpEnt && window._wfpEnt.modules) || []).includes("ai_estimate") ? `<div id="inqAiZone" style="margin-bottom:14px;">
  <button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" id="inqAiBtn">${tA("adm.est.btn","AI-offerte-concept maken")}</button>
  <span style="font-size:11px;color:var(--gray-400);margin-left:8px;">${tA("adm.est.hint","AI stelt regels voor · jij controleert en verstuurt")}</span>
</div>` : ""}
<form id="inqForm">
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${tA("adm.thCustomer","Klant")}</label>
      <select name="customerId" style="width:100%">
        <option value="">${tA("adm.inq.noCustomer","niet gekoppeld")}</option>
        ${customers.map(c => `<option value="${esc(c.id)}" ${inq.customerId === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
      </select>
    </div>
    <div class="adm-form-group"><label>${tA("adm.status","Status")}</label>
      <select name="status">
        <option value="nieuw" ${inq.status === "nieuw" ? "selected" : ""}>${tA("adm.inq.stNew","Nieuw")}</option>
        <option value="in_behandeling" ${inq.status === "in_behandeling" ? "selected" : ""}>${tA("adm.inq.stBusy","In behandeling")}</option>
        <option value="beantwoord" ${inq.status === "beantwoord" ? "selected" : ""}>${tA("adm.inq.stAnswered","Beantwoord")}</option>
        <option value="gesloten" ${inq.status === "gesloten" ? "selected" : ""}>${tA("adm.inq.stClosed","Gesloten")}</option>
      </select>
    </div>
  </div>
  ${inq.fromEmail && inq.fromEmail !== "-" ? `<div style="font-size:12px;color:var(--gray-500);margin-bottom:10px;">${tA("adm.inq.replyHint","Beantwoorden doe je vanuit je eigen mailbox")}: <a href="mailto:${esc(inq.fromEmail)}?subject=${encodeURIComponent("Re: " + (inq.subject || ""))}">${esc(inq.fromEmail)}</a></div>` : ""}
  <div id="inqFormErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions" style="justify-content:space-between;">
    <button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="inqDelete">${tA("adm.delete","Verwijderen")}</button>
    <div style="display:flex;gap:8px;">
      <button type="button" class="adm-btn adm-btn-secondary" id="inqCancel">${tA("adm.cancel","Annuleren")}</button>
      <button type="submit" class="adm-btn adm-btn-primary">${tA("adm.save","Opslaan")}</button>
    </div>
  </div>
</form>`;
    openDrawer();
    document.getElementById("inqCancel").addEventListener("click", closeDrawer);
    // AI-estimatie: eerst de raming + aannames tonen, pas na bevestiging een
    // concept-offerte aanmaken (menselijke eindcontrole).
    document.getElementById("inqAiBtn")?.addEventListener("click", async () => {
      const zone = document.getElementById("inqAiZone");
      const btn = document.getElementById("inqAiBtn");
      btn.disabled = true; btn.textContent = tA("adm.est.busy","AI rekent…");
      let est;
      try { est = await api("POST", "/estimate", { inquiryId: inq.id }); }
      catch (err) {
        btn.disabled = false; btn.textContent = tA("adm.est.btn","AI-offerte-concept maken");
        window.showToast && window.showToast(err.message, "error");
        return;
      }
      const e = est.estimate;
      const subtotal = e.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
      const confLabel = { laag: tA("adm.est.confLow","lage zekerheid"), middel: tA("adm.est.confMid","gemiddelde zekerheid"), hoog: tA("adm.est.confHigh","hoge zekerheid") }[e.confidence] || e.confidence;
      zone.innerHTML = `
<div style="border:1px solid var(--wf-blue-l);border-radius:10px;padding:12px;background:var(--wf-blue-l);">
  <div style="font-weight:600;font-size:13px;margin-bottom:8px;">${tA("adm.est.previewTitle","AI-raming")} · ${esc(confLabel)}${e.mock ? ` · <span style="font-weight:400;">${tA("adm.inq.testMode","testmodus")}</span>` : ""}</div>
  ${e.lines.map(l => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;"><span>${esc(String(l.qty))} × ${esc(l.description)}</span><span style="white-space:nowrap;margin-left:10px;">€ ${(l.qty * l.unitPrice).toFixed(2)}</span></div>`).join("")}
  <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:600;border-top:1px solid rgba(0,0,0,.08);margin-top:6px;padding-top:6px;"><span>${tA("adm.est.subtotal","Totaal excl. btw")}</span><span>€ ${subtotal.toFixed(2)}</span></div>
  ${e.assumptions.length ? `<div style="font-size:11px;color:var(--gray-500);margin-top:8px;">${tA("adm.est.assumptions","Aannames")}:<br>${e.assumptions.map(a => `· ${esc(a)}`).join("<br>")}</div>` : ""}
  <div style="display:flex;gap:8px;margin-top:10px;">
    <button type="button" class="adm-btn adm-btn-primary adm-btn-sm" id="inqAiConfirm">${tA("adm.est.confirmBtn","Concept-offerte aanmaken")}</button>
    <button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" id="inqAiDismiss">${tA("adm.cancel","Annuleren")}</button>
  </div>
</div>`;
      document.getElementById("inqAiDismiss").addEventListener("click", () => {
        zone.innerHTML = `<button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" id="inqAiBtn2">${tA("adm.est.btn","AI-offerte-concept maken")}</button>`;
        document.getElementById("inqAiBtn2").addEventListener("click", () => openInquiryDrawer(inq));
      });
      document.getElementById("inqAiConfirm").addEventListener("click", async () => {
        const cBtn = document.getElementById("inqAiConfirm");
        cBtn.disabled = true; cBtn.textContent = tA("adm.est.creating","Aanmaken…");
        try {
          const created = await api("POST", "/offertes", {
            customerId: est.prefill.customerId || undefined,
            customerName: est.prefill.customerName || inq.fromName || inq.fromEmail || "-",
            lines: e.lines,
          });
          if (inq.status === "nieuw") api("PATCH", `/inquiries/${inq.id}`, { status: "in_behandeling" }).catch(() => {});
          closeDrawer();
          window.showToast && window.showToast(`${tA("adm.est.createdToast","AI-concept aangemaakt")} · ${created.quote ? created.quote.number : ""} · ${tA("adm.est.reviewToast","controleer regels en prijzen")}`, "success");
          switchView("offertes");
          if (created.quote) openOfferteDrawer(created.quote);
        } catch (err) {
          cBtn.disabled = false; cBtn.textContent = tA("adm.est.confirmBtn","Concept-offerte aanmaken");
          window.showToast && window.showToast(err.message, "error");
        }
      });
    });
    document.getElementById("inqDelete").addEventListener("click", async () => {
      if (!await uiConfirm(tA("adm.inq.deleteConfirm","Deze klantvraag verwijderen?"), { title: "Klantvraag verwijderen", danger: true, confirmLabel: tA("adm.delete","Verwijderen") })) return;
      try { await api("DELETE", `/inquiries/${inq.id}`); closeDrawer(); renderInbox(); }
      catch (err) { const el = document.getElementById("inqFormErr"); if (el) { el.textContent = err.message; el.style.display = ""; } }
    });
    document.getElementById("inqForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = document.getElementById("inqFormErr");
      const body = Object.fromEntries(new FormData(e.target).entries());
      try {
        await api("PATCH", `/inquiries/${inq.id}`, body);
        closeDrawer(); renderInbox();
        window.showToast && window.showToast(tA("adm.inq.savedToast","Klantvraag opgeslagen"), "success");
      } catch (err) { if (errEl) { errEl.textContent = err.message; errEl.style.display = ""; } }
    });
  }

  // Registreren in de gedeelde registers · aanvullen, nooit overschrijven.
  A.views = A.views || {};
  A.drawers = A.drawers || {};
  A.views.inbox = renderInbox;
  A.drawers.inquiry = openInquiryDrawer;
}());
