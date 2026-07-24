/* ── Berichten · schermmodule uit admin.js ───────────────────────
 * Een-op-een extractie van de view "messages" uit public/js/platforms/admin.js
 * (regels 4454-4749). De code hieronder is LETTERLIJK overgenomen · alleen de
 * omhulling verandert. Geen gedragswijziging, geen opruiming, geen hernoeming.
 *
 * Meeverhuisd omdat het UITSLUITEND van dit scherm is: de filterstand
 * (_msgVenueFilter/_msgSearch), messageRecipientLabel, messageInitials,
 * messageTime, messagePreview, renderMessages en openMessageDrawer.
 *
 * Wat gedeeld is met andere schermen blijft in de kern en wordt hier uit
 * window.wfpAdmin gelezen: api, esc, state, openDrawer, closeDrawer en
 * uiConfirm. LET OP: uiConfirm staat nog NIET op window.wfpAdmin; admin.js
 * moet A.uiConfirm exposeren voor de verwijderknop werkt. Bewust geen lokale
 * kopie · dupliceren is hoe twee waarheden ontstaan.
 *
 * Het origineel gebruikte in dit scherm GEEN i18n-sleutels (geen enkele tA()
 * tussen regel 4454 en 4749); alle teksten stonden letterlijk in het Nederlands.
 * Dat blijft zo · er sleutels van maken zou gedrag wijzigen.
 */
(function () {
  "use strict";
  const A = window.wfpAdmin;
  if (!A) return;

  // Gedeeld via de kern.
  const api = A.api;
  const esc = A.esc;
  const _state = A.state;
  const openDrawer = A.openDrawer;
  const closeDrawer = A.closeDrawer;

  // Nog NIET gedeeld via de kern · zie het rapport (risico).
  const uiConfirm = A.uiConfirm;

  let _msgVenueFilter = "";
  let _msgSearch = "";

  const messageRecipientLabel = (message, employees) => {
    if (message.recipientId) {
      const employee = employees.find(row => row.id === message.recipientId);
      return employee ? (employee.name || employee.email || "Persoonlijk") : "Persoonlijk";
    }
    if (message.toRole === "employee") return "Alle medewerkers";
    if (message.toRole === "manager") return "Alle managers";
    if (message.toRole === "tenant_admin") return "Beheerders";
    return "Iedereen";
  };
  const messageInitials = value => String(value || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  const messageTime = value => value ? new Date(value).toLocaleString("nl-BE", { dateStyle: "medium", timeStyle: "short" }) : "";
  const messagePreview = value => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > 150 ? `${text.slice(0, 147)}…` : text;
  };

  async function renderMessages() {
    const content = document.getElementById("admContent");
    try {
      const [data, venueData, employeeData] = await Promise.all([
        api("GET", "/messages"),
        api("GET", "/venues").catch(() => ({ venues: [] })),
        api("GET", "/employees").catch(() => ({ employees: [] }))
      ]);
      const messages = data.messages || [];
      const venues = venueData.venues || venueData.rows || [];
      const employees = employeeData.employees || [];
      if (employees.length) _state.employees = employees;

      const venueName = id => (venues.find(venue => venue.id === id) || {}).name || "Onbekende werf";
      const generalCount = messages.filter(message => !message.venueId).length;
      const venueThreads = venues.map(venue => {
        const threadMessages = messages.filter(message => message.venueId === venue.id);
        return {
          ...venue,
          count: threadMessages.length,
          lastAt: threadMessages[0]?.createdAt || ""
        };
      }).filter(thread => thread.count > 0 || thread.active !== false)
        .sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || "") || String(a.name || "").localeCompare(String(b.name || "")));

      const selectedMessages = messages.filter(message => {
        if (_msgVenueFilter === "general") return !message.venueId;
        if (_msgVenueFilter) return message.venueId === _msgVenueFilter;
        return true;
      }).filter(message => {
        if (!_msgSearch) return true;
        const haystack = `${message.subject || ""} ${message.body || ""} ${message.senderName || ""} ${messageRecipientLabel(message, employees)}`.toLowerCase();
        return haystack.includes(_msgSearch.toLowerCase());
      });
      const selectedTitle = _msgVenueFilter === "general"
        ? "Algemene berichten"
        : _msgVenueFilter
          ? venueName(_msgVenueFilter)
          : "Alle berichten";
      const selectedSubtitle = _msgVenueFilter
        ? "Gesprekken en afspraken binnen deze werfcontext."
        : "Alle interne communicatie, van algemeen tot werfgebonden.";

      content.innerHTML = `
<div class="message-workspace">
  <aside class="message-threads">
    <div class="message-threads-head">
      <div><span>Communicatie</span><h3>Gesprekken</h3></div>
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="msgQuickCompose">Nieuw</button>
    </div>
    <button class="message-thread ${!_msgVenueFilter ? "active" : ""}" data-thread="">
      <span class="message-thread-icon">✦</span>
      <span><strong>Alle berichten</strong><small>Volledig overzicht</small></span>
      <b>${messages.length}</b>
    </button>
    <button class="message-thread ${_msgVenueFilter === "general" ? "active" : ""}" data-thread="general">
      <span class="message-thread-icon">M</span>
      <span><strong>Algemeen</strong><small>Zonder werfkoppeling</small></span>
      <b>${generalCount}</b>
    </button>
    <div class="message-thread-label">Werven</div>
    <div class="message-thread-list">
      ${venueThreads.length ? venueThreads.map(thread => `<button class="message-thread ${_msgVenueFilter === thread.id ? "active" : ""}" data-thread="${thread.id}">
        <span class="message-thread-icon">${messageInitials(thread.name)}</span>
        <span><strong>${esc(thread.name || "Werf")}</strong><small>${thread.lastAt ? `Laatste · ${messageTime(thread.lastAt)}` : "Nog geen berichten"}</small></span>
        <b>${thread.count}</b>
      </button>`).join("") : `<div class="message-thread-empty">Nog geen werven beschikbaar.</div>`}
    </div>
  </aside>

  <section class="message-stream-panel">
    <div class="message-stream-head">
      <div><span>${_msgVenueFilter ? "Gesprek" : "Inbox"}</span><h3>${esc(selectedTitle)}</h3><p>${selectedSubtitle}</p></div>
      <div class="message-stream-tools">
        <input id="msgSearch" class="adm-input" value="${esc(_msgSearch)}" placeholder="Zoek in berichten…">
        <button class="adm-btn adm-btn-primary" id="msgCompose">Nieuw bericht</button>
      </div>
    </div>

    <div class="message-stream" id="messageStream">
      ${selectedMessages.length ? selectedMessages.map(message => {
        const bodyText = message.body || message.message || "";
        const venue = message.venueId ? venueName(message.venueId) : "";
        return `<article class="message-card" data-id="${message.id}">
          <button class="message-card-main msg-toggle" data-id="${message.id}" aria-expanded="false">
            <span class="message-avatar">${messageInitials(message.senderName || message.senderId)}</span>
            <span class="message-card-copy">
              <span class="message-card-meta"><strong>${esc(message.senderName || message.senderId || "Systeem")}</strong><small>${messageTime(message.createdAt)}</small></span>
              <span class="message-card-title">${esc(message.subject || "Bericht")}</span>
              <span class="message-card-preview">${esc(messagePreview(bodyText) || "Geen inhoud")}</span>
              <span class="message-card-tags"><em>${esc(messageRecipientLabel(message, employees))}</em>${venue ? `<em class="message-venue-tag">${esc(venue)}</em>` : ""}</span>
            </span>
            <span class="message-chevron">⌄</span>
          </button>
          <div class="message-card-detail" hidden>
            <div class="message-card-body">${esc(bodyText || "Geen inhoud")}</div>
            <div class="message-card-actions">
              <span>Verzonden door ${esc(message.senderName || message.senderId || "Systeem")}</span>
              <button class="adm-btn adm-btn-danger adm-btn-sm adm-msg-del" data-id="${message.id}">Verwijderen</button>
            </div>
          </div>
        </article>`;
      }).join("") : `<div class="message-empty"><div class="message-empty-icon">✦</div><h4>${_msgSearch ? "Geen zoekresultaten" : "Nog geen berichten"}</h4><p>${_msgSearch ? "Pas uw zoekterm aan of kies een ander gesprek." : "Start de communicatie met een duidelijk bericht aan uw team."}</p><button class="adm-btn adm-btn-primary" id="msgEmptyCompose">Nieuw bericht</button></div>`}
    </div>
  </section>
</div>`;

      content.querySelectorAll(".message-thread").forEach(button => button.addEventListener("click", () => {
        _msgVenueFilter = button.dataset.thread || "";
        _msgSearch = "";
        renderMessages();
      }));
      document.getElementById("msgSearch")?.addEventListener("input", event => {
        _msgSearch = event.target.value;
        clearTimeout(window._msgSearchTimer);
        window._msgSearchTimer = setTimeout(renderMessages, 180);
      });
      const compose = () => openMessageDrawer({ venueId: _msgVenueFilter && _msgVenueFilter !== "general" ? _msgVenueFilter : "" });
      document.getElementById("msgQuickCompose")?.addEventListener("click", compose);
      document.getElementById("msgCompose")?.addEventListener("click", compose);
      document.getElementById("msgEmptyCompose")?.addEventListener("click", compose);

      content.querySelectorAll(".msg-toggle").forEach(button => button.addEventListener("click", () => {
        const card = button.closest(".message-card");
        const detail = card?.querySelector(".message-card-detail");
        const expanded = button.getAttribute("aria-expanded") === "true";
        button.setAttribute("aria-expanded", String(!expanded));
        if (detail) detail.hidden = expanded;
        card?.classList.toggle("expanded", !expanded);
      }));

      content.querySelectorAll(".adm-msg-del").forEach(button => button.addEventListener("click", async () => {
        if (!await uiConfirm("Bericht permanent verwijderen?", { title: "Bericht verwijderen", danger: true, confirmLabel: "Permanent verwijderen" })) return;
        button.disabled = true;
        try {
          await api("DELETE", `/messages/${button.dataset.id}`);
          window.showToast("Bericht verwijderd.", "success");
          renderMessages();
        } catch (error) {
          button.disabled = false;
          window.showToast(error.message, "error");
        }
      }));
    } catch (error) {
      content.innerHTML = `<div style="padding:24px;color:var(--wf-red)">${esc(error.message)}</div>`;
    }
  }

  function openMessageDrawer(prefill = {}) {
    const employeesReady = _state.employees && _state.employees.length > 0
      ? Promise.resolve({ employees: _state.employees })
      : api("GET", "/employees").catch(() => ({ employees: [] }));

    Promise.all([employeesReady, api("GET", "/venues").catch(() => ({ venues: [] }))]).then(([employeeData, venueData]) => {
      const employees = employeeData.employees || [];
      const venues = venueData.venues || venueData.rows || [];
      _state.employees = employees;
      document.getElementById("admDrawerTitle").textContent = "Nieuw bericht";
      document.getElementById("admDrawerBody").innerHTML = `
<form id="admMsgForm" class="message-compose-form">
  <div class="message-compose-intro">
    <span>Teamcommunicatie</span>
    <h3>Schrijf een helder bericht</h3>
    <p>Kies wie het bericht ontvangt en voeg indien nodig de werfcontext toe. Het bericht verschijnt meteen in de juiste gespreksstroom.</p>
  </div>

  <div class="adm-form-section">Ontvangers en context</div>
  <div class="message-compose-grid">
    <div class="adm-form-group">
      <label>Sturen naar *</label>
      <select name="toMode" id="admMsgToMode">
        <option value="all">Iedereen</option>
        <option value="role_employee">Alle medewerkers</option>
        <option value="role_manager">Alle managers</option>
        <option value="person">Specifieke persoon</option>
      </select>
    </div>
    <div class="adm-form-group" id="admMsgRecipientGroup" hidden>
      <label>Persoon *</label>
      <select name="recipientId" id="admMsgRecipient">
        <option value="">Kies een persoon</option>
        ${employees.filter(employee => employee.active !== false).map(employee => `<option value="${employee.id}">${esc(employee.name || employee.email)} · ${esc(employee.role || "")}</option>`).join("")}
      </select>
    </div>
    <div class="adm-form-group">
      <label>Werfcontext</label>
      <select name="venueId" id="admMsgVenue">
        <option value="">Algemeen · geen werf</option>
        ${venues.map(venue => `<option value="${venue.id}" ${prefill.venueId === venue.id ? "selected" : ""}>${esc(venue.name || "Werf")}</option>`).join("")}
      </select>
      <div class="adm-form-hint">Maakt het bericht zichtbaar in het gesprek van deze werf.</div>
    </div>
  </div>

  <div class="adm-form-section">Bericht</div>
  <div class="adm-form-group"><label>Onderwerp *</label><input name="subject" required maxlength="160" placeholder="Een korte, herkenbare titel"></div>
  <div class="adm-form-group"><label>Bericht *</label><textarea name="body" rows="9" required placeholder="Schrijf de afspraak, vraag of update zo concreet mogelijk…"></textarea><div class="message-compose-counter"><span id="msgCharCount">0</span> tekens</div></div>
  <div id="admMsgErr" class="message-compose-error" hidden></div>

  <div class="message-compose-preview" id="msgComposePreview">
    <span>Voorbeeld</span>
    <strong>Nog geen onderwerp</strong>
    <p>Uw bericht verschijnt hier terwijl u schrijft.</p>
  </div>

  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="admMsgCancel">Annuleren</button>
    <button type="submit" class="adm-btn adm-btn-primary" id="admMsgSubmit">Bericht verzenden</button>
  </div>
</form>`;
      openDrawer();

      const form = document.getElementById("admMsgForm");
      const mode = document.getElementById("admMsgToMode");
      const recipientGroup = document.getElementById("admMsgRecipientGroup");
      const recipient = document.getElementById("admMsgRecipient");
      const subject = form.querySelector('[name="subject"]');
      const messageBody = form.querySelector('[name="body"]');
      const preview = document.getElementById("msgComposePreview");

      const updateRecipient = () => {
        const personal = mode.value === "person";
        recipientGroup.hidden = !personal;
        recipient.required = personal;
      };
      const updatePreview = () => {
        document.getElementById("msgCharCount").textContent = String(messageBody.value.length);
        preview.querySelector("strong").textContent = subject.value.trim() || "Nog geen onderwerp";
        preview.querySelector("p").textContent = messagePreview(messageBody.value) || "Uw bericht verschijnt hier terwijl u schrijft.";
      };
      mode.addEventListener("change", updateRecipient);
      subject.addEventListener("input", updatePreview);
      messageBody.addEventListener("input", updatePreview);
      updateRecipient();
      updatePreview();

      document.getElementById("admMsgCancel")?.addEventListener("click", closeDrawer);
      form.addEventListener("submit", async event => {
        event.preventDefault();
        const fd = new FormData(form);
        const toMode = fd.get("toMode");
        const error = document.getElementById("admMsgErr");
        const payload = {
          subject: String(fd.get("subject") || "").trim(),
          body: String(fd.get("body") || "").trim(),
          venueId: fd.get("venueId") || null
        };
        if (toMode === "person") payload.recipientId = fd.get("recipientId");
        if (toMode === "role_employee") payload.toRole = "employee";
        if (toMode === "role_manager") payload.toRole = "manager";

        if (toMode === "person" && !payload.recipientId) {
          error.hidden = false;
          error.textContent = "Kies een ontvanger.";
          return;
        }
        const submit = document.getElementById("admMsgSubmit");
        submit.disabled = true;
        submit.textContent = "Verzenden…";
        try {
          await api("POST", "/messages", payload);
          closeDrawer();
          _msgVenueFilter = payload.venueId || "";
          _msgSearch = "";
          window.showToast("Bericht verzonden.", "success");
          renderMessages();
        } catch (sendError) {
          error.hidden = false;
          error.textContent = sendError.message;
          submit.disabled = false;
          submit.textContent = "Bericht verzenden";
        }
      });
    }).catch(error => window.showToast(error.message, "error"));
  }

  A.views = A.views || {};
  A.views.messages = renderMessages;
  A.drawers = A.drawers || {};
  A.drawers.message = openMessageDrawer;
}());
