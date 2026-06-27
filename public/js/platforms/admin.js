/* ============================================================
   Monargo One – Tenant Admin Platform
   public/js/platforms/admin.js
   ============================================================ */
(function () {
  "use strict";

  // ── State ─────────────────────────────────────────────────
  let _currentView = "dashboard";
  let _state = {
    dashboard: null,
    employees: [],
    planning: [],
    leaves: [],
    expenses: [],
    workorders: [],
    messages: [],
    audit: []
  };

  // ── API helpers ────────────────────────────────────────────
  // Gedeelde kern (token/tenantId/esc/fetch+401) → public/js/core.js
  const token = () => window.wfpCore.token();
  const tenantId = () => window.wfpCore.tenantId();
  const esc = v => window.wfpCore.esc(v);

  function api(method, path, body) {
    // Voeg automatisch /tenants/:id toe voor alle tenant-scoped routes
    const tid = tenantId();
    const skipPrefix = !tid || path.startsWith("/tenants/") || path.startsWith("/auth/") || path.startsWith("/super/") || path.startsWith("/audit") || path.startsWith("/modules/");
    const fullPath = skipPrefix ? path : `/tenants/${tid}${path}`;
    return window.wfpCore.request("/api" + fullPath, { method, body: body ? JSON.stringify(body) : undefined });
  }

  // Verberg nav-items voor modules die niet in het pakket van de tenant zitten.
  function applyEntitlements() {
    fetch("/api/me", { headers: { Authorization: "Bearer " + token() } })
      .then(r => r.json())
      .then(d => {
        // Sector-terminologie toepassen (Werkbonnen → Bezoeken/Interventies/…).
        if (d && d.terminology && window.wfpTerms) window.wfpTerms.set(d.terminology);
        if (d && d.supportSession && d.supportSession.active) renderSupportBanner(d.supportSession);
        // Eerste keer inloggen zonder afgeronde onboarding → toon de wizard.
        if (d && d.onboarding && d.onboarding.completed === false && !d.supportSession) {
          setTimeout(() => { try { showOnboardingWizard(); } catch (_) {} }, 300);
        }
        const ent = d && d.entitlements;
        window._wfpEnt = ent || null; // stash voor submodule-gating in views
        if (!ent || ent.views === "*") return; // super_admin of geen data → alles tonen
        const allowed = new Set(ent.views || []);
        document.querySelectorAll(".adm-nav-item[data-view]").forEach(a => {
          if (!allowed.has(a.getAttribute("data-view"))) a.style.display = "none";
        });
        // Verberg sectie-labels waarvan alle items verborgen zijn.
        document.querySelectorAll(".adm-nav-label").forEach(lbl => {
          let n = lbl.nextElementSibling, visible = false;
          while (n && !n.classList.contains("adm-nav-label")) {
            if (n.classList.contains("adm-nav-item") && n.style.display !== "none") visible = true;
            n = n.nextElementSibling;
          }
          if (!visible) lbl.style.display = "none";
        });
      })
      .catch(() => {});
  }

  // ── Onboarding-wizard: sector, teamgrootte, facturatie/contact ──────────────
  // Verschijnt bij de eerste login tot de tenant-admin de gegevens invult.
  async function showOnboardingWizard() {
    if (document.getElementById("admObWizard")) return; // niet dubbel
    let data;
    try { data = await api("GET", "/onboarding"); } catch (_) { return; }
    if (!data || (data.tenant && data.tenant.onboarding && data.tenant.onboarding.completed)) return;
    const t = data.tenant || {};
    const ip = t.invoiceProfile || {}; const ct = t.contact || {};
    const sectors = data.sectors || []; const teamSizes = data.teamSizes || [];
    const ov = document.createElement("div");
    ov.id = "admObWizard";
    ov.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;";
    ov.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:560px;width:100%;max-height:92vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="padding:20px 22px;border-bottom:1px solid #f1f5f9">
          <h2 style="margin:0;font-size:18px;color:#0f172a">Welkom bij Monargo One 👋</h2>
          <p style="margin:6px 0 0;font-size:13px;color:#64748b">Vul je bedrijfsgegevens aan zodat we ${esc(t.name || "je organisatie")} correct kunnen instellen. Duurt een minuutje.</p>
        </div>
        <form id="admObForm" style="padding:20px 22px;display:flex;flex-direction:column;gap:14px">
          <div class="adm-form-group"><label>Sector</label>
            <select name="sector" required>
              <option value="">Kies je sector…</option>
              ${sectors.map(s => `<option value="${esc(s.key)}" ${t.sector===s.key?"selected":""}>${esc(s.label)}</option>`).join("")}
            </select></div>
          <div class="adm-form-group"><label>Teamgrootte</label>
            <select name="teamSize" required>
              <option value="">Aantal medewerkers…</option>
              ${teamSizes.map(s => `<option value="${esc(s)}" ${t.teamSize===s?"selected":""}>${esc(s)} medewerkers</option>`).join("")}
            </select></div>
          <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-top:4px">Facturatiegegevens ${ip.vat ? "(via KBO opgehaald)" : ""}</div>
          <div class="adm-form-row" style="display:flex;gap:10px">
            <div class="adm-form-group" style="flex:1"><label>BTW-nummer</label><input name="vat" value="${esc(ip.vat||"")}" placeholder="BE0123.456.789"></div>
            <div class="adm-form-group" style="flex:1"><label>Ondernemingsnr.</label><input name="companyNumber" value="${esc(ip.companyNumber||"")}" placeholder="0123.456.789"></div>
          </div>
          <div class="adm-form-group"><label>Straat + nummer</label><input name="street" value="${esc(ip.street||"")}" placeholder="Kerkstraat 12"></div>
          <div class="adm-form-row" style="display:flex;gap:10px">
            <div class="adm-form-group" style="width:120px"><label>Postcode</label><input name="zip" value="${esc(ip.zip||"")}" placeholder="9000"></div>
            <div class="adm-form-group" style="flex:1"><label>Gemeente</label><input name="city" value="${esc(ip.city||"")}" placeholder="Gent"></div>
          </div>
          <div class="adm-form-group"><label>Facturatie-e-mail</label><input name="billingEmail" type="email" value="${esc(t.billingEmail||"")}" placeholder="facturatie@bedrijf.be"></div>
          <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-top:4px">Contactpersoon</div>
          <div class="adm-form-row" style="display:flex;gap:10px">
            <div class="adm-form-group" style="flex:1"><label>Naam</label><input name="contactName" value="${esc(ct.contactName||"")}" placeholder="Voornaam Naam"></div>
            <div class="adm-form-group" style="flex:1"><label>Functie</label><input name="contactRole" value="${esc(ct.contactRole||"")}" placeholder="Zaakvoerder"></div>
          </div>
          <div class="adm-form-group"><label>Telefoon</label><input name="phone" value="${esc(ct.phone||"")}" placeholder="+32 ..."></div>
          <div id="admObErr" style="display:none;background:#fef2f2;color:#dc2626;border-radius:8px;padding:8px;font-size:12px"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px">
            <button type="button" class="adm-btn adm-btn-secondary" id="admObLater">Later invullen</button>
            <button type="submit" class="adm-btn adm-btn-primary">Opslaan &amp; starten</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(ov);
    document.getElementById("admObLater").addEventListener("click", () => ov.remove());
    document.getElementById("admObForm").addEventListener("submit", async e => {
      e.preventDefault();
      const f = e.target;
      const payload = {
        sector: f.elements.sector.value,
        teamSize: f.elements.teamSize.value,
        billingEmail: f.elements.billingEmail.value.trim(),
        invoiceProfile: {
          vat: f.elements.vat.value.trim(), companyNumber: f.elements.companyNumber.value.trim(),
          street: f.elements.street.value.trim(), zip: f.elements.zip.value.trim(), city: f.elements.city.value.trim(),
        },
        contact: {
          contactName: f.elements.contactName.value.trim(), contactRole: f.elements.contactRole.value.trim(),
          phone: f.elements.phone.value.trim(),
        },
      };
      try {
        await api("POST", "/onboarding", payload);
        ov.remove();
        window.showToast && window.showToast("Bedrijfsgegevens opgeslagen ✓ Welkom!", "success");
      } catch (err) {
        const eEl = document.getElementById("admObErr"); eEl.style.display = "block"; eEl.textContent = err.message;
      }
    });
  }

  // GDPR-transparantie: toon een vaste banner tijdens een support-sessie.
  function renderSupportBanner(s) {
    if (document.getElementById("wfpSupportBanner")) return;
    const scope = s.scope === "write" ? "lezen + schrijven" : "alleen-lezen";
    const b = document.createElement("div");
    b.id = "wfpSupportBanner";
    b.setAttribute("role", "status");
    b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#b91c1c;color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:6px 16px;display:flex;align-items:center;justify-content:center;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,.2)";
    b.innerHTML = `<span>🛟 Support-sessie actief — ${esc(s.agent || "supportmedewerker")} (${scope}). Deze sessie wordt geaudit.</span>`;
    const exit = document.createElement("button");
    exit.textContent = "Sessie verlaten";
    exit.style.cssText = "background:#fff;color:#b91c1c;border:none;border-radius:6px;font:600 12px system-ui,sans-serif;padding:5px 12px;cursor:pointer;flex-shrink:0";
    exit.onclick = () => window.WorkFlowProPlatformRouter && window.WorkFlowProPlatformRouter.exitSupportSession();
    b.appendChild(exit);
    document.body.appendChild(b);
    document.body.style.paddingTop = "38px";
  }

  // Is een submodule actief voor deze tenant? (super_admin/onbekend → ja)
  function subEnabled(moduleKey, subKey) {
    const e = window._wfpEnt;
    if (!e || e.views === "*") return true;
    return ((e.submodules || {})[moduleKey] || []).includes(subKey);
  }

  // Is een module-view actief voor deze tenant? (super_admin/onbekend → ja)
  function viewEnabled(view) {
    const e = window._wfpEnt;
    if (!e || e.views === "*") return true;
    return (e.views || []).includes(view);
  }

  // ── Shell ──────────────────────────────────────────────────
  function buildShell() {
    const el = document.getElementById("platform-admin");
    if (!el) return;

    el.innerHTML = `
<div class="adm-layout">
  <!-- Sidebar -->
  <aside class="adm-sidebar" id="admSidebar">
    <!-- Brand -->
    <div class="adm-brand">
      <div class="adm-brand-icon">
        <svg viewBox="0 0 24 24" fill="none"><path d="M13 3L4 14h7l-1 7 9-11h-7l1-7z" fill="currentColor"/></svg>
      </div>
      <div class="adm-brand-text">
        <div class="adm-brand-name">Monargo One</div>
        <div class="adm-brand-tenant" id="admCompanyName">Laden…</div>
      </div>
    </div>

    <nav class="adm-nav" aria-label="Hoofdnavigatie">
      <!-- Hoofdmenu -->
      <div class="adm-nav-label">Overzicht</div>
      <a class="adm-nav-item active" data-view="dashboard" href="#">
        <svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
        <span>Dashboard</span>
      </a>
      <a class="adm-nav-item" data-view="reports" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        <span>Rapportages</span>
      </a>

      <div class="adm-nav-label">Operaties</div>
      <a class="adm-nav-item" data-view="planning" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/></svg>
        <span>Planning</span>
      </a>
      <a class="adm-nav-item" data-view="workorders" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        <span data-term="jobPlural">Werkbonnen</span>
      </a>
      <a class="adm-nav-item" data-view="clocking" href="#">
        <svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>
        <span>Prikklok</span>
      </a>
      <a class="adm-nav-item" data-view="leaves" href="#">
        <svg viewBox="0 0 24 24"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>
        <span>Verlof</span>
        <span class="adm-nav-badge" id="admLeaveBadge" style="display:none">0</span>
      </a>
      <a class="adm-nav-item" data-view="expenses" href="#">
        <svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>
        <span>Onkosten</span>
        <span class="adm-nav-badge" id="admExpenseBadge" style="display:none">0</span>
      </a>
      <a class="adm-nav-item" data-view="messages" href="#">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
        <span>Berichten</span>
        <span class="adm-nav-badge" id="admMsgBadge" style="display:none">0</span>
      </a>

      <div class="adm-nav-label">Klanten & Financiën</div>
      <a class="adm-nav-item" data-view="customers" href="#">
        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
        <span>Klanten</span>
      </a>
      <a class="adm-nav-item" data-view="offertes" href="#">
        <svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13zM10.5 11.5l1.4 1.4 2.6-2.6.7.7-3.3 3.3-2.1-2.1z"/></svg>
        <span>Offertes</span>
        <span class="adm-nav-badge" id="admOfferteBadge" style="display:none;background:#F59E0B">0</span>
      </a>
      <a class="adm-nav-item" data-view="facturen" href="#">
        <svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
        <span>Facturen</span>
        <span class="adm-nav-badge adm-nav-badge-red" id="admFacturenBadge" style="display:none">0</span>
      </a>
      <a class="adm-nav-item" data-view="billing" href="#">
        <svg viewBox="0 0 24 24"><path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg>
        <span>Facturatie</span>
        <span class="adm-nav-badge" id="admInvoiceBadge" style="display:none">0</span>
      </a>

      <div class="adm-nav-label">Middelen</div>
      <a class="adm-nav-item" data-view="employees" href="#">
        <svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
        <span>Medewerkers</span>
      </a>
      <a class="adm-nav-item" data-view="vehicles" href="#">
        <svg viewBox="0 0 24 24"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>
        <span>Wagenpark</span>
      </a>
      <a class="adm-nav-item" data-view="stock" href="#">
        <svg viewBox="0 0 24 24"><path d="M20 6h-2.18c.07-.44.18-.88.18-1.36C18 2.1 15.9 0 13.36 0c-1.3 0-2.48.52-3.35 1.36L9 2.37 7.99 1.36C7.12.52 5.94 0 4.64 0 2.1 0 0 2.1 0 4.64c0 .48.11.92.18 1.36H2c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zM2 20V8h9v12H2zm11 0V8h9v12h-9z"/></svg>
        <span>Stock</span>
      </a>
      <a class="adm-nav-item" data-view="venues" href="#">
        <svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
        <span data-term="venuePlural">Locaties</span>
      </a>

      <div class="adm-nav-label">Compliance</div>
      <a class="adm-nav-item" data-view="ciaw" href="#">
        <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>
        <span>Checkin@Work</span>
      </a>
      <a class="adm-nav-item" data-view="posted_workers" href="#">
        <svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
        <span>A1 / Limosa</span>
      </a>

      <div class="adm-nav-label">Systeem</div>
      <a class="adm-nav-item" data-view="integrations" href="#">
        <svg viewBox="0 0 24 24"><path d="M22 7h-7V2H9v5H2v15h20V7zM11 4h2v3h-2V4zm9 16H4V9h16v11zM9 13h2v2H9v-2zm4 0h2v2h-2v-2z"/></svg>
        <span>Koppelingen</span>
      </a>
      <a class="adm-nav-item" data-view="templates" href="#">
        <svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
        <span>Documentsjablonen</span>
      </a>
      <a class="adm-nav-item" data-view="roadmap" href="#">
        <svg viewBox="0 0 24 24"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>
        <span>Roadmap</span>
      </a>
      <a class="adm-nav-item" data-view="audit" href="#">
        <svg viewBox="0 0 24 24"><path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/></svg>
        <span>Audittrail</span>
      </a>
      <a class="adm-nav-item" data-view="settings" href="#">
        <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
        <span>Instellingen</span>
      </a>
    </nav>

    <!-- Sidebar footer -->
    <div class="adm-sidebar-foot">
      <div class="adm-user-row" id="admUserChip">
        <div class="adm-user-av" id="admUserAvatar">A</div>
        <div class="adm-user-details">
          <div class="adm-user-name" id="admUserName">Admin</div>
          <div class="adm-user-role">Beheerder</div>
        </div>
      </div>
      <button class="adm-logout-btn" id="admLogoutBtn" title="Uitloggen">
        <svg viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
      </button>
    </div>
    <div style="padding:8px 16px 12px;font-size:10.5px;color:rgba(255,255,255,.4);text-align:center">Powered by <strong style="color:rgba(255,255,255,.65)">Monargo</strong></div>
  </aside>

  <!-- Main -->
  <main class="adm-main" id="admMain">
    <!-- Topbar -->
    <header class="adm-topbar">
      <button class="adm-menu-toggle" id="admMenuToggle">
        <svg viewBox="0 0 24 24"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>
      </button>
      <!-- Search -->
      <div class="adm-search-box">
        <svg class="adm-search-icon" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
        <input type="text" class="adm-search-input" id="admGlobalSearch" placeholder="Zoek klant, werkbon, factuur, medewerker…" autocomplete="off">
        <span class="adm-search-kbd">⌘K</span>
        <div class="adm-search-results" id="admSearchResults"></div>
      </div>
      <!-- Right actions -->
      <div class="adm-topbar-right">
        <button class="adm-btn adm-btn-primary" id="admPrimaryAction" style="display:none">
          <svg viewBox="0 0 24 24" style="width:14px;height:14px;fill:#fff;margin-right:4px;vertical-align:middle;"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
          Toevoegen
        </button>
        <!-- Bell -->
        <div class="adm-bell-wrap">
          <button class="adm-topbar-icon-btn" id="admBellBtn" title="Notificaties">
            <svg viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>
            <span class="adm-bell-badge" id="admBellDot" style="display:none">0</span>
          </button>
          <div class="adm-notif-panel" id="admNotifPanel">
            <div class="adm-notif-hd">
              <span class="adm-notif-hd-title">Notificaties</span>
              <button class="adm-notif-hd-clear" id="admNotifMarkAll">Alles gelezen</button>
            </div>
            <div class="adm-notif-list" id="admNotifList"><div class="adm-notif-empty">Laden…</div></div>
          </div>
        </div>
        <!-- User -->
        <div class="adm-topbar-user">
          <div class="adm-topbar-av" id="admTopbarAv">A</div>
          <div class="adm-topbar-user-info">
            <div class="adm-topbar-user-name" id="admTopbarName">Admin</div>
            <div class="adm-topbar-user-role">Beheerder</div>
          </div>
        </div>
      </div>
    </header>
    <!-- Page header -->
    <div class="adm-page-head" id="admPageHead">
      <h1 class="adm-page-title" id="admPageTitle">Dashboard</h1>
    </div>
    <div class="adm-content" id="admContent">
      <div class="adm-loading"><div class="adm-spinner"></div>Laden…</div>
    </div>
  </main>
</div>

<!-- Employee drawer -->
<div class="adm-overlay hidden" id="admOverlay"></div>
<aside class="adm-drawer hidden" id="admDrawer">
  <div class="adm-drawer-header">
    <h2 id="admDrawerTitle">Medewerker toevoegen</h2>
    <button class="adm-drawer-close" id="admDrawerClose">&times;</button>
  </div>
  <div class="adm-drawer-body" id="admDrawerBody"></div>
</aside>

`;

    // nav click
    el.querySelectorAll(".adm-nav-item[data-view]").forEach(a => {
      a.addEventListener("click", e => {
        e.preventDefault();
        switchView(a.dataset.view);
      });
    });

    // sidebar toggle
    document.getElementById("admMenuToggle").addEventListener("click", () => {
      document.getElementById("admSidebar").classList.toggle("open");
    });

    // logout
    document.getElementById("admLogoutBtn").addEventListener("click", () => {
      localStorage.removeItem("wfp_token");
      location.reload();
    });

    // drawer close
    document.getElementById("admDrawerClose").addEventListener("click", closeDrawer);
    document.getElementById("admOverlay").addEventListener("click", closeDrawer);

    // primary action btn
    document.getElementById("admPrimaryAction").addEventListener("click", () => {
      const d = window.wfpAdmin.drawers;
      const map = {
        employees: () => d.employee(null), messages: () => d.message(),
        customers: () => d.customer(null), offertes: () => d.offerte(null),
        facturen: () => d.factuur(null), venues: () => d.venue(null),
        vehicles: () => d.vehicle(null), stock: () => d.stock(null)
      };
      if (map[_currentView]) map[_currentView]();
    });

    // Lege-staat CTA's (gedelegeerd: overleeft elke re-render)
    document.getElementById("admContent").addEventListener("click", e => {
      const d = window.wfpAdmin.drawers;
      const ctas = {
        admEmptyNewCust:  () => d.customer(null),
        admEmptyNewVen:   () => d.venue(null),
        admEmptyNewVeh:   () => d.vehicle(null),
        admEmptyNewStock: () => d.stock(null),
        admEmptyNewQuote: () => d.offerte(null),
        admEmptyNewInv:   () => d.factuur(null),
      };
      const fn = ctas[e.target && e.target.id];
      if (fn) fn();
    });
  }

  // ── Navigation ─────────────────────────────────────────────
  const VIEW_LABELS = {
    dashboard: "Dashboard", employees: "Medewerkers", planning: "Planning",
    clocking: "Prikklok", leaves: "Verlof", expenses: "Onkosten",
    workorders: "Werkbonnen", messages: "Berichten", reports: "Rapportages",
    customers: "Klanten", offertes: "Offertes", facturen: "Facturen", venues: "Locaties", vehicles: "Voertuigen",
    stock: "Stock", billing: "Facturatie",
    ciaw: "Checkin@Work (CIAW)", posted_workers: "A1 / Limosa detachering",
    integrations: "Koppelingen", templates: "Documentsjablonen", roadmap: "Roadmap", audit: "Audittrail", settings: "Instellingen"
  };

  const VIEW_BTN_LABEL = {
    employees: "+ Medewerker", messages: "+ Bericht", customers: "+ Klant",
    offertes: "+ Offerte", facturen: "+ Factuur", venues: "+ Locatie", vehicles: "+ Voertuig", stock: "+ Artikel"
  };

  function switchView(view) {
    _currentView = view;
    document.querySelectorAll(".adm-nav-item").forEach(a => {
      const isActive = a.dataset.view === view;
      a.classList.toggle("active", isActive);
      if (isActive) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    // Sector-terminologie voor de paginatitel (Werkbonnen/Locaties → sectorwoord).
    const termTitle = window.wfpTerms && (view === "workorders" ? window.wfpTerms.t("jobPlural") : view === "venues" ? window.wfpTerms.t("venuePlural") : null);
    document.getElementById("admPageTitle").textContent = termTitle || VIEW_LABELS[view] || view;

    const btn = document.getElementById("admPrimaryAction");
    const hasBtn = VIEW_BTN_LABEL[view];
    btn.style.display = hasBtn ? "" : "none";
    if (hasBtn) btn.textContent = hasBtn;

    const content = document.getElementById("admContent");
    content.innerHTML = `<div class="adm-loading">Laden…</div>`;

    // View-renderers komen uit de gedeelde registry (window.wfpAdmin.views).
    // Kern-renderers + uitgesplitste module-renderers registreren zich daar.
    const reg = window.wfpAdmin.views;
    if (reg[view]) reg[view]();
  }

  // ── Dashboard — orkestrator met filter (standaard / mijn / organisatie) ────
  let _dashMode = "standaard"; // "standaard" | "personal" | "org"
  async function renderDashboard() {
    const content = document.getElementById("admContent");
    content.innerHTML = `<div class="adm-loading"><div class="adm-spinner"></div>Laden…</div>`;
    let b = {};
    try { b = await api("GET", "/me/dashboard/builder"); } catch (_) {}
    const hasOrg = !!(b.published && (b.published.widgets || []).length);
    const hasPersonal = !!(b.personal && (b.personal.widgets || []).length);
    if (_dashMode === "org" && !hasOrg) _dashMode = "standaard";
    const chip = (mode, label) => `<button class="adm-btn ${_dashMode === mode ? "adm-btn-primary" : "adm-btn-secondary"} adm-btn-sm" data-dashmode="${mode}">${label}</button>`;
    content.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
        ${chip("standaard", "Overzicht")}
        ${chip("personal", "Mijn dashboard")}
        ${hasOrg ? chip("org", "Organisatie") : ""}
        ${_dashMode === "personal" ? `<button class="adm-btn adm-btn-secondary adm-btn-sm" id="dashConfigToggle" style="margin-left:auto">⚙ Aanpassen</button>` : ""}
      </div>
      <div id="dashBody"></div>`;
    content.querySelectorAll("[data-dashmode]").forEach(btn => btn.addEventListener("click", () => { _dashMode = btn.dataset.dashmode; renderDashboard(); }));
    document.getElementById("dashConfigToggle")?.addEventListener("click", () => {
      const p = document.getElementById("dashConfigPanel"); if (p) p.style.display = p.style.display === "none" ? "" : "none";
    });
    if (_dashMode === "personal" || _dashMode === "org") return renderUserDashboard(_dashMode, b);
    return renderStandardDashboard();
  }

  // Persoonlijk/organisatie-dashboard (widgets + inline, inklapbare configuratie).
  async function renderUserDashboard(mode, b) {
    const body = document.getElementById("dashBody");
    const available = b.available || [];
    const personalKeys = (b.personal && b.personal.widgets) || [];
    const canPublish = !!b.canPublish;
    const kpiCard = w => `<div class="adm-kpi"><div class="adm-kpi-label">${esc(w.label)}</div><div class="adm-kpi-value">${esc(String(w.value))}</div><div class="adm-kpi-sub">${esc(w.sub || "")}</div></div>`;
    const grid = widgets => widgets.length
      ? `<div class="adm-kpis">${widgets.map(kpiCard).join("")}</div>`
      : `<div class="adm-empty"><div class="adm-empty-icon">📊</div><div class="adm-empty-text">${mode === "org" ? "Je organisatie heeft nog geen dashboard gepubliceerd." : "Nog geen widgets gekozen — klik ⚙ Aanpassen."}</div></div>`;
    const r = await api("GET", `/me/dashboard/render?mode=${mode}`).catch(() => ({ widgets: [] }));
    if (mode === "org") {
      body.innerHTML = `<div style="background:var(--wf-blue-l);border:1px solid #bfdbfe;border-radius:10px;padding:10px 14px;font-size:12.5px;color:#1e40af;margin-bottom:14px">🔒 Dit dashboard is door je organisatie ingesteld; je ziet enkel widgets waar je rechten op hebt.</div>${grid(r.widgets || [])}`;
      return;
    }
    const chosen = new Set(personalKeys);
    body.innerHTML = `
      ${grid(r.widgets || [])}
      <div class="adm-card" id="dashConfigPanel" style="margin-top:18px;display:none">
        <div class="adm-card-header"><h3 class="adm-card-title">Widgets samenstellen</h3></div>
        <div class="adm-card-body">
          <p style="font-size:12.5px;color:#64748b;margin:0 0 12px">Kies de blokken die je wil zien. Je ziet enkel widgets waar je rechten op hebt.</p>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px">
            ${available.map(w => `<label style="display:flex;align-items:center;gap:8px;font-size:13px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;cursor:pointer">
              <input type="checkbox" class="mb-w" value="${esc(w.key)}" ${chosen.has(w.key) ? "checked" : ""}>
              <span>${esc(w.label)}</span><span style="margin-left:auto;font-size:10px;color:#94a3b8">${esc(w.group)}</span>
            </label>`).join("") || `<div style="font-size:13px;color:#94a3b8">Geen widgets beschikbaar voor jouw rechten/pakket.</div>`}
          </div>
          <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
            <button class="adm-btn adm-btn-primary adm-btn-sm" id="mbSave">Opslaan</button>
            ${canPublish ? `<button class="adm-btn adm-btn-secondary adm-btn-sm" id="mbPublish">🏢 Publiceer voor organisatie</button>` : ""}
            <span id="mbMsg" style="font-size:12.5px;color:#16a34a;align-self:center"></span>
          </div>
        </div>
      </div>`;
    const picked = () => [...document.querySelectorAll(".mb-w:checked")].map(c => c.value);
    document.getElementById("mbSave")?.addEventListener("click", async () => {
      const msg = document.getElementById("mbMsg");
      try { await api("POST", "/me/dashboard/config", { widgets: picked() }); renderDashboard(); window.showToast && window.showToast("Mijn dashboard opgeslagen ✓", "success"); }
      catch (e) { msg.style.color = "#dc2626"; msg.textContent = e.message; }
    });
    document.getElementById("mbPublish")?.addEventListener("click", async () => {
      if (!confirm("Deze widgetselectie publiceren als vast organisatie-dashboard voor iedereen?")) return;
      const msg = document.getElementById("mbMsg");
      try { await api("POST", "/me/dashboard/publish", { widgets: picked() }); renderDashboard(); window.showToast && window.showToast("Gepubliceerd voor de organisatie ✓", "success"); }
      catch (e) { msg.style.color = "#dc2626"; msg.textContent = e.message; }
    });
  }

  // ── Standaard-overzicht (KPI's + lijsten) ──────────────────
  async function renderStandardDashboard() {
    const [dash, pending, factData, expData, gpData] = await Promise.all([
      api("GET", "/manager/dashboard"),
      api("GET", "/leaves?status=aangevraagd").catch(() => ({ leaves: [] })),
      api("GET", "/facturen").catch(() => ({ invoices: [] })),
      api("GET", "/expenses").catch(() => ({ expenses: [] })),
      api("GET", "/golden-path").catch(() => null)
    ]);

    const content = document.getElementById("dashBody") || document.getElementById("admContent");
    content.innerHTML = `
<div class="adm-kpis">
  <div class="adm-kpi adm-kpi-blue adm-kpi-link" data-goto="employees" title="Naar medewerkers">
    <div class="adm-kpi-icon"><svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg></div>
    <div class="adm-kpi-label">Team</div>
    <div class="adm-kpi-value">${dash.team ?? "—"}</div>
    <div class="adm-kpi-sub">Actieve medewerkers</div>
  </div>
  <div class="adm-kpi adm-kpi-green adm-kpi-link" data-goto="clocking" title="Naar prikklok">
    <div class="adm-kpi-icon"><svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg></div>
    <div class="adm-kpi-label">Ingeklokt</div>
    <div class="adm-kpi-value">${dash.clockedIn ?? "—"}</div>
    <div class="adm-kpi-sub">Van ${dash.team ?? "?"} medewerkers</div>
  </div>
  ${viewEnabled("leaves") ? `<div class="adm-kpi adm-kpi-amber adm-kpi-link" data-goto="leaves" title="Naar verlof">
    <div class="adm-kpi-icon"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg></div>
    <div class="adm-kpi-label">Verlof aanvragen</div>
    <div class="adm-kpi-value">${dash.pendingLeaves ?? "—"}</div>
    <div class="adm-kpi-sub">Wacht op goedkeuring</div>
  </div>` : ""}
  ${viewEnabled("expenses") ? `<div class="adm-kpi adm-kpi-red adm-kpi-link" data-goto="expenses" title="Naar onkosten">
    <div class="adm-kpi-icon"><svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg></div>
    <div class="adm-kpi-label">Onkosten</div>
    <div class="adm-kpi-value">${dash.pendingExpenses ?? "—"}</div>
    <div class="adm-kpi-sub">Te verwerken</div>
  </div>` : ""}
  ${viewEnabled("workorders") ? `<div class="adm-kpi adm-kpi-purple adm-kpi-link" data-goto="workorders" title="Naar werkbonnen">
    <div class="adm-kpi-icon"><svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg></div>
    <div class="adm-kpi-label">Werkbonnen</div>
    <div class="adm-kpi-value">${dash.openWorkorders ?? "—"}</div>
    <div class="adm-kpi-sub">Openstaand</div>
  </div>` : ""}
</div>

<div class="adm-grid-2">
  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">Team vandaag</h3>
    </div>
    <div class="adm-card-body adm-table-wrap">
      <table class="adm-table">
        <thead><tr><th>Medewerker</th><th>Status</th><th>Ingepland</th></tr></thead>
        <tbody>
          ${(dash.teamList || []).slice(0,8).map(u => `
          <tr class="adm-row-link adm-dash-team" data-id="${esc(u.id||"")}" title="Open medewerker">
            <td><span class="adm-avatar">${esc((u.name||"?")[0])}</span> ${esc(u.name||u.email)}</td>
            <td>${u.absent ? '<span class="adm-status adm-status-inactive">Afwezig</span>' : u.clockedIn ? '<span class="adm-status adm-status-active">Ingeklokt</span>' : '<span class="adm-status adm-status-pending">Niet geklokt</span>'}</td>
            <td>${u.planned ? "✓" : "—"}</td>
          </tr>`).join("") || '<tr><td colspan="3" class="adm-empty">Geen teamleden</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">Verlof aanvragen <span style="background:#fef3c7;color:#92400e;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;">${(pending.leaves||pending||[]).length}</span></h3>
      <a href="#" class="adm-btn adm-btn-secondary adm-btn-sm" id="admViewAllLeaves">Alles bekijken</a>
    </div>
    <div class="adm-card-body adm-table-wrap">
      <table class="adm-table">
        <thead><tr><th>Medewerker</th><th>Type</th><th>Periode</th><th>Actie</th></tr></thead>
        <tbody>
          ${((pending.leaves||pending)||[]).slice(0,5).map(l => `
          <tr>
            <td>${esc(l.userName||l.userId)}</td>
            <td>${esc(l.type||"—")}</td>
            <td style="white-space:nowrap">${esc(l.startDate)} – ${esc(l.endDate)}</td>
            <td style="white-space:nowrap">
              <button class="adm-btn adm-btn-success adm-btn-sm adm-dash-lv-ok" data-id="${esc(l.id)}">✓ Goed</button>
              <button class="adm-btn adm-btn-danger adm-btn-sm adm-dash-lv-rej" data-id="${esc(l.id)}">✗ Weiger</button>
            </td>
          </tr>`).join("") || '<tr><td colspan="4" class="adm-empty">Geen aanvragen</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>
</div>

${(() => {
  const invoices   = factData.invoices || [];
  const overdueInv = invoices.filter(i => i.status === "overdue");
  const openInv    = invoices.filter(i => i.status === "open");
  const expensesPending = (expData.expenses || []).filter(e => e.status === "pending" || !e.status);
  const items = [
    ...overdueInv.map(i => ({ icon:"🔴", text:`Factuur ${i.number} vervallen — ${new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(i.total)}`, view:"facturen", urgent:true })),
    ...expensesPending.slice(0,3).map(e => ({ icon:"🟡", text:`Onkostennota €${e.amount||0} van ${esc(e.userName||e.userId||"medewerker")} wacht op goedkeuring`, view:"expenses", urgent:false })),
    ...openInv.slice(0,2).map(i => ({ icon:"🔵", text:`Factuur ${i.number} openstaand — ${new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(i.total)}`, view:"facturen", urgent:false }))
  ];
  if (!items.length) return "";
  return `<div class="adm-card" style="margin-top:16px">
  <div class="adm-card-header"><h3 class="adm-card-title">Actie vereist <span style="background:#fef2f2;color:#dc2626;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:700;">${items.length}</span></h3></div>
  <div class="adm-card-body" style="padding:0">
    ${items.map(it => `
    <div class="adm-action-item" data-view="${it.view}" style="padding:10px 16px;border-bottom:1px solid #f8fafc;display:flex;align-items:center;gap:10px;cursor:pointer;transition:background .1s;">
      <span style="font-size:16px;">${it.icon}</span>
      <span style="font-size:13px;color:#374151;flex:1;">${it.text}</span>
      <svg viewBox="0 0 24 24" style="width:14px;fill:#94a3b8;flex-shrink:0"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
    </div>`).join("")}
  </div>
</div>`;
})()}`;

    document.getElementById("admViewAllLeaves")?.addEventListener("click", e => { e.preventDefault(); switchView("leaves"); });

    // KPI-kaarten → doorklikken naar de juiste view
    document.querySelectorAll(".adm-kpi-link").forEach(card => {
      card.addEventListener("click", () => switchView(card.dataset.goto));
    });
    // Teamrij → medewerker openen (bewerken)
    document.querySelectorAll(".adm-dash-team").forEach(row => {
      row.addEventListener("click", async () => {
        try {
          const d = await api("GET", "/employees?includeInactive=true");
          const emp = (d.employees || []).find(u => u.id === row.dataset.id);
          if (emp) openEmployeeDrawer(emp); else switchView("employees");
        } catch (_) { switchView("employees"); }
      });
    });
    document.querySelectorAll(".adm-action-item").forEach(el => {
      el.addEventListener("click", () => switchView(el.dataset.view));
      el.addEventListener("mouseenter", () => el.style.background = "#f8fafc");
      el.addEventListener("mouseleave", () => el.style.background = "");
    });

    // Golden path widget injection
    if (gpData?.readiness) {
      const gp = gpData.readiness;
      const pct = gp.percent || 0;
      const steps = gp.steps || [];
      const doneCount = steps.filter(s=>s.done).length;
      const gpEl = document.getElementById("admContent");
      if (gpEl) {
        const gpDiv = document.createElement("div");
        gpDiv.className = "adm-card";
        gpDiv.style.marginTop = "16px";
        gpDiv.innerHTML = `
<div class="adm-card-header" style="cursor:pointer;" id="admGpHeader">
  <h3 class="adm-card-title">🎯 Pilot voortgang <span style="font-size:12px;font-weight:400;color:#64748b;">${doneCount}/${steps.length} stappen</span></h3>
  <div style="display:flex;align-items:center;gap:12px;">
    <div style="font-size:18px;font-weight:700;color:${pct===100?"#10b981":pct>50?"#f59e0b":"#6366f1"};">${pct}%</div>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admGpDetails">Details</button>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admGpRoadmap">Roadmap →</button>
  </div>
</div>
<div style="height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden;margin:-8px 20px 0;">
  <div style="height:100%;width:${pct}%;background:${pct===100?"#10b981":pct>50?"#f59e0b":"#6366f1"};transition:width .6s;border-radius:4px;"></div>
</div>
<div class="hidden" id="admGpSteps" style="padding:12px 20px 4px;">
  ${steps.map(s=>`<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;">
    <span style="color:${s.done?"#10b981":"#94a3b8"};font-size:16px;">${s.done?"✅":"⭕"}</span>
    <span style="color:${s.done?"#374151":"#94a3b8"}">${esc(s.key||"")}</span>
  </div>`).join("")}
</div>`;
        gpEl.appendChild(gpDiv);
        document.getElementById("admGpRoadmap")?.addEventListener("click", e => { e.stopPropagation(); switchView("roadmap"); });
        document.getElementById("admGpDetails")?.addEventListener("click", e => { e.stopPropagation(); document.getElementById("admGpSteps")?.classList.toggle("hidden"); });
      }
    }

    const pendingLeaves = pending.leaves || pending || [];
    document.querySelectorAll(".adm-dash-lv-ok").forEach(btn => {
      btn.addEventListener("click", () => {
        const leave = pendingLeaves.find(l => l.id === btn.dataset.id);
        openLeaveReviewModal(btn.dataset.id, "goedgekeurd", leave, renderDashboard);
      });
    });
    document.querySelectorAll(".adm-dash-lv-rej").forEach(btn => {
      btn.addEventListener("click", () => {
        const leave = pendingLeaves.find(l => l.id === btn.dataset.id);
        openLeaveReviewModal(btn.dataset.id, "geweigerd", leave, renderDashboard);
      });
    });
  }

  // ── Employees ──────────────────────────────────────────────
  let _empShowInactive = false;
  let _grantable = []; // operationele rechten die deze tenant mag toekennen (uit entitlements)

  // Standaard aangevinkte rechten per rol (voor nieuwe medewerkers).
  const ROLE_DEFAULT_PERMS = {
    employee: ["planning", "clockings", "expenses", "leaves", "workorders", "messages"],
    manager: ["planning", "workorders", "clockings", "expenses", "leaves", "messages", "venues", "vehicles"],
  };

  async function renderEmployees() {
    const data = await api("GET", "/employees?includeInactive=true");
    // Beheerders horen niet in de medewerkerslijst (beheren eigen account via Instellingen).
    const employees = (data.employees || data || []).filter(u => !["tenant_admin", "super_admin"].includes(u.role));
    _state.employees = employees;
    _grantable = data.grantable || [];

    const activeCount   = employees.filter(u => u.active !== false).length;
    const inactiveCount = employees.filter(u => u.active === false).length;
    const visible = _empShowInactive ? employees : employees.filter(u => u.active !== false);

    const content = document.getElementById("admContent");
    content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">${activeCount} actief${inactiveCount ? ` · ${inactiveCount} inactief` : ""}</h3>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <input type="search" placeholder="Zoeken…" id="admEmpSearch" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;width:180px;">
      ${inactiveCount ? `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#64748b;cursor:pointer;">
        <input type="checkbox" id="admEmpShowInactive" ${_empShowInactive?"checked":""}> Toon inactief
      </label>` : ""}
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admEmpImport" title="CSV importeren">📥 CSV Import</button>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admEmpExport" title="Exporteer als CSV">📤 Export</button>
    </div>
  </div>
  <div class="adm-card-body adm-table-wrap" id="admEmpTable">
    ${renderEmployeeTable(visible)}
  </div>
</div>`;

    document.getElementById("admEmpSearch").addEventListener("input", e => {
      const q = e.target.value.toLowerCase();
      const base = _empShowInactive ? employees : employees.filter(u => u.active !== false);
      const filtered = base.filter(u => (u.name||"").toLowerCase().includes(q) || (u.email||"").toLowerCase().includes(q) || (u.function||"").toLowerCase().includes(q));
      document.getElementById("admEmpTable").innerHTML = renderEmployeeTable(filtered);
      bindEmpActions();
    });
    document.getElementById("admEmpShowInactive")?.addEventListener("change", e => {
      _empShowInactive = e.target.checked; renderEmployees();
    });
    bindEmpActions();

    // CSV Export
    document.getElementById("admEmpExport")?.addEventListener("click", () => {
      const rows = [["Naam","E-mail","Telefoon","Functie","Rol","Actief","IBAN","Adres"]];
      employees.forEach(u => rows.push([u.name||"",u.email||"",u.phone||"",u.function||"",u.role||"",u.active!==false?"ja":"nee",u.iban||"",u.address||""]));
      const csv = rows.map(r=>r.map(v=>`"${String(v||"").replace(/"/g,'""')}"`).join(";")).join("\n");
      const a = document.createElement("a"); a.href="data:text/csv;charset=utf-8,﻿"+encodeURIComponent(csv);
      a.download="medewerkers.csv"; a.click();
    });

    // CSV Import
    document.getElementById("admEmpImport")?.addEventListener("click", () => {
      const input = document.createElement("input"); input.type="file"; input.accept=".csv";
      input.onchange = async () => {
        const file = input.files[0]; if (!file) return;
        const text = await file.text();
        const lines = text.split("\n").map(l=>l.trim()).filter(Boolean);
        if (!lines.length) return;
        // Detect header row
        const headers = lines[0].split(";").map(h=>h.replace(/^"|"$/g,"").trim().toLowerCase());
        const iCol = k => headers.indexOf(k);
        const imported = [], errors = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(";").map(c=>c.replace(/^"|"$/g,"").trim());
          const email = cols[iCol("e-mail")||iCol("email")||1]||"";
          const name  = cols[iCol("naam")||iCol("name")||0]||"";
          if (!email || !email.includes("@")) { errors.push(`Rij ${i+1}: ongeldige e-mail`); continue; }
          const body = { name, email,
            phone:    iCol("telefoon")>=0?cols[iCol("telefoon")]:"",
            function: iCol("functie")>=0?cols[iCol("functie")]:"",
            role:     (iCol("rol")>=0&&cols[iCol("rol")])?cols[iCol("rol")]:"employee",
            iban:     iCol("iban")>=0?cols[iCol("iban")]:"",
            address:  iCol("adres")>=0?cols[iCol("adres")]:""
          };
          try {
            await api("POST", "/employees", { ...body, sendWelcome: false });
            imported.push(email);
          } catch(e) { errors.push(`${email}: ${e.message}`); }
        }
        const msg = `Import klaar: ${imported.length} aangemaakt${errors.length?`, ${errors.length} fouten`:""}.\n${errors.slice(0,5).join("\n")}`;
        window.showToast(msg, "info"); renderEmployees();
      };
      input.click();
    });
  }

  function renderEmployeeTable(employees) {
    if (!employees.length) return `<div class="adm-empty"><div class="adm-empty-icon">👥</div><div class="adm-empty-text">Geen medewerkers gevonden</div></div>`;
    return `<table class="adm-table">
      <thead><tr><th></th><th>Naam</th><th>E-mail</th><th>Functie</th><th>Rol</th><th>Status</th><th>Acties</th></tr></thead>
      <tbody>${employees.map(u => `
        <tr class="adm-row-link adm-emp-row" data-id="${esc(u.id)}" title="Open medewerker">
          <td><span class="adm-avatar" style="background:${u.active===false?"#f1f5f9":"#e0e7ff"};color:${u.active===false?"#94a3b8":"#4f46e5"}">${(u.name||u.email||"?")[0].toUpperCase()}</span></td>
          <td><div style="font-weight:600;color:${u.active===false?"#94a3b8":"#0f172a"}">${esc(u.name||"—")}</div><div style="font-size:11px;color:#94a3b8">${esc(u.phone||"")}</div></td>
          <td style="font-size:12px">${esc(u.email)}</td>
          <td style="font-size:12px;color:#64748b">${esc(u.function||u.jobTitle||"—")}</td>
          <td><span class="adm-status ${u.role==="manager"?"adm-status-pending":"adm-status-open"}">${u.role==="manager"?"Manager":u.role==="tenant_admin"?"Admin":"Medewerker"}</span></td>
          <td>${u.active!==false ? '<span class="adm-status adm-status-active">Actief</span>' : '<span class="adm-status adm-status-inactive">Inactief</span>'}</td>
          <td style="white-space:nowrap">
            <button class="adm-btn adm-btn-secondary adm-btn-sm adm-edit-emp" data-id="${esc(u.id)}">✏ Bewerken</button>
            <button class="adm-btn adm-btn-sm ${u.active!==false?"adm-btn-warning":"adm-btn-success"} adm-toggle-emp" data-id="${esc(u.id)}" data-active="${u.active!==false}">${u.active!==false?"⏸ Deactiveer":"▶ Activeer"}</button>
          </td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  }

  function bindEmpActions() {
    document.querySelectorAll(".adm-emp-row").forEach(row => {
      row.addEventListener("click", e => {
        if (e.target.closest("button")) return;
        const emp = _state.employees.find(u => u.id === row.dataset.id);
        if (emp) openEmployeeDrawer(emp);
      });
    });
    document.querySelectorAll(".adm-edit-emp").forEach(btn => {
      btn.addEventListener("click", () => {
        const emp = _state.employees.find(u => u.id === btn.dataset.id);
        openEmployeeDrawer(emp);
      });
    });
    document.querySelectorAll(".adm-toggle-emp").forEach(btn => {
      btn.addEventListener("click", async () => {
        const isActive = btn.dataset.active === "true";
        const emp = _state.employees.find(u => u.id === btn.dataset.id);
        if (!confirm(`${isActive ? "Deactiveer" : "Activeer"} ${emp?.name || emp?.email}?`)) return;
        btn.disabled = true;
        try {
          await api("PATCH", `/employees/${btn.dataset.id}`, { active: !isActive });
          renderEmployees();
        } catch(e) { window.showToast(e.message, "error"); btn.disabled = false; }
      });
    });
  }

  function openEmployeeDrawer(emp) {
    const title = document.getElementById("admDrawerTitle");
    const body = document.getElementById("admDrawerBody");
    // Beheerders worden niet via dit scherm gedegradeerd: rol + rechten alleen-lezen.
    const isAdminUser = emp && (emp.role === "tenant_admin" || emp.role === "super_admin");
    title.textContent = emp ? "Medewerker bewerken" : "Medewerker toevoegen";
    body.innerHTML = `
<form id="admEmpForm">
  <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px;">Persoonsgegevens</div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Voornaam *</label><input name="firstName" value="${esc(emp?.firstName||(emp?.name?.split(" ")[0])||"")}" required placeholder="Jan"></div>
    <div class="adm-form-group"><label>Achternaam *</label><input name="lastName" value="${esc(emp?.lastName||(emp?.name?.split(" ").slice(1).join(" "))||"")}" required placeholder="Janssen"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>E-mail *</label><input name="email" type="email" value="${esc(emp?.email||"")}" ${emp?"readonly style='background:#f8fafc;color:#64748b'":""} required placeholder="jan@bedrijf.be"></div>
    <div class="adm-form-group"><label>Telefoon</label><input name="phone" value="${esc(emp?.phone||"")}" placeholder="+32 4xx xx xx xx"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Functie</label><input name="function" value="${esc(emp?.function||emp?.jobTitle||"")}" placeholder="Technieker, Chauffeur…"></div>
    <div class="adm-form-group"><label>Rol</label>
      ${isAdminUser
        ? `<input value="Beheerder" disabled style="background:#f8fafc;color:#64748b">`
        : `<select name="role">
        <option value="employee" ${(emp?.role||"employee")==="employee"?"selected":""}>Medewerker</option>
        <option value="manager" ${emp?.role==="manager"?"selected":""}>Manager</option>
      </select>`}
    </div>
  </div>

  <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 10px;">Adres & IBAN</div>
  <div class="adm-form-group"><label>Adres</label><input name="address" value="${esc(emp?.address||"")}" placeholder="Straat 1, 1000 Brussel"></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>IBAN</label><input name="iban" value="${esc(emp?.iban||"")}" placeholder="BE68 5390 0754 7034"></div>
    <div class="adm-form-group"><label>Rijksregisternr.</label><input name="nationalId" value="${esc(emp?.nationalId||"")}" placeholder="00.00.00-000.00"></div>
  </div>

  <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 10px;">Verlof</div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Vakantiedagen / jaar</label>
      <input name="leaveQuota" type="number" min="0" max="365" value="${esc(emp?.leaveQuota ?? 20)}" placeholder="20">
    </div>
    <div class="adm-form-group" style="align-self:flex-end;padding-bottom:4px;font-size:12px;color:#64748b;">
      Standaard: 20 dagen. Wijzig voor deeltijdse of contractuele afwijkingen.
    </div>
  </div>

  <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 6px;">Toegang &amp; rechten</div>
  ${isAdminUser ? `<div style="font-size:12px;color:#64748b;">Beheerders hebben volledige toegang. Rechten beheer je hier alleen voor medewerkers en managers.</div>` : `
  <div style="font-size:12px;color:#64748b;margin-bottom:8px;">Bepaal welke modules deze gebruiker mag gebruiken. Enkel modules uit jullie pakket worden getoond. In- en uitprikken (prikklok) kan iedereen altijd, ongeacht functie.</div>
  ${_grantable.length ? `<div id="admEmpPerms" style="display:grid;grid-template-columns:1fr 1fr;gap:6px 14px;">
    ${_grantable.map(p => {
      const on = emp
        ? (emp.permissions || []).some(x => x === p.key || x === `own:${p.key}`)
        : ROLE_DEFAULT_PERMS[emp?.role || "employee"].includes(p.key);
      return `<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#334155;cursor:pointer;">
        <input type="checkbox" class="adm-perm" data-key="${p.key}" ${on ? "checked" : ""}> ${esc(p.label)}
      </label>`;
    }).join("")}
  </div>` : `<div style="font-size:12px;color:#94a3b8;">Geen toewijsbare modules in het huidige pakket.</div>`}
  `}

  ${!emp ? `
  <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 10px;">Toegang</div>
  <div class="adm-form-group" style="font-size:12px;color:#64748b;background:#f8fafc;border-radius:8px;padding:10px 12px;">De medewerker ontvangt een activatiemail om binnen 7 dagen zelf een wachtwoord in te stellen. Je kiest hier dus geen wachtwoord.</div>` : ""}

  <div id="admEmpFormErr" style="display:none;background:#fef2f2;color:#dc2626;border-radius:8px;padding:8px;font-size:12px;margin-top:8px;"></div>
  <div class="adm-form-actions" style="margin-top:16px;">
    <button type="button" class="adm-btn adm-btn-secondary" id="admEmpCancel">Annuleren</button>
    ${emp ? `<button type="button" class="adm-btn adm-btn-warning adm-btn-sm" id="admEmpPwReset">🔑 Wachtwoord reset</button>` : ""}
    <button type="submit" class="adm-btn adm-btn-primary">${emp ? "Opslaan" : "Aanmaken"}</button>
  </div>
</form>
${emp ? `
<div style="margin-top:20px;padding-top:16px;border-top:1px solid #f1f5f9;">
  <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Accountbeheer</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <button class="adm-btn adm-btn-sm ${emp.active!==false?"adm-btn-warning":"adm-btn-success"}" id="admEmpToggle">${emp.active!==false?"⏸ Deactiveer account":"▶ Activeer account"}</button>
  </div>
</div>` : ""}`;

    document.getElementById("admEmpCancel").addEventListener("click", closeDrawer);

    // Bij nieuwe medewerker: rechten mee laten springen met de rol-keuze.
    if (!emp) {
      document.querySelector("#admEmpForm select[name=role]")?.addEventListener("change", ev => {
        const defs = ROLE_DEFAULT_PERMS[ev.target.value] || [];
        document.querySelectorAll("#admEmpForm .adm-perm").forEach(cb => { cb.checked = defs.includes(cb.dataset.key); });
      });
    }

    document.getElementById("admEmpPwReset")?.addEventListener("click", async () => {
      const newPw = prompt("Nieuw tijdelijk wachtwoord (min. 8 tekens):");
      if (!newPw) return;
      if (newPw.length < 8) { window.showToast("Wachtwoord moet minstens 8 tekens zijn.", "warning"); return; }
      try {
        await api("PATCH", `/employees/${emp.id}`, { newPassword: newPw });
        window.showToast(`Wachtwoord van ${emp.name||emp.email} is gewijzigd.`, "success");
      } catch(e) { window.showToast(e.message, "error"); }
    });

    document.getElementById("admEmpToggle")?.addEventListener("click", async () => {
      const isActive = emp.active !== false;
      if (!confirm(`${isActive?"Deactiveer":"Activeer"} account van ${emp.name||emp.email}?`)) return;
      try {
        await api("PATCH", `/employees/${emp.id}`, { active: !isActive });
        closeDrawer(); renderEmployees();
      } catch(e) { window.showToast(e.message, "error"); }
    });

    document.getElementById("admEmpForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = document.getElementById("admEmpFormErr");
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd);
      data.name = `${data.firstName} ${data.lastName}`.trim();
      delete data.firstName; delete data.lastName;
      if (data.leaveQuota !== undefined) data.leaveQuota = Number(data.leaveQuota) || 20;
      // Geselecteerde rechten meesturen (server saneert en scoped per rol).
      // Niet voor beheerders — die behouden hun volledige toegang.
      if (!isAdminUser) {
        data.permissions = [...document.querySelectorAll("#admEmpForm .adm-perm:checked")].map(cb => cb.dataset.key);
      }
      try {
        if (emp) {
          await api("PATCH", `/employees/${emp.id}`, data);
          closeDrawer();
          renderEmployees();
        } else {
          const result = await api("POST", "/employees", data);
          // Geen wachtwoord meer: de medewerker activeert via e-mail. In dev (geen
          // echte mailprovider) geeft de server de activatielink terug zodat het
          // testbaar blijft; in productie wordt die nooit getoond.
          if (result.activationLink) {
            document.getElementById("admEmpFormErr").style.cssText = "display:block;background:#d1fae5;color:#065f46;border-radius:8px;padding:8px;font-size:12px;margin-top:8px;word-break:break-all;";
            document.getElementById("admEmpFormErr").innerHTML = `✅ Medewerker aangemaakt. Activatielink (dev): <a href="${result.activationLink}">${result.activationLink}</a>`;
            e.target.querySelector("[type=submit]").textContent = "Sluiten";
            e.target.querySelector("[type=submit]").type = "button";
            e.target.querySelector("[type=submit]").addEventListener("click", () => { closeDrawer(); renderEmployees(); });
          } else {
            closeDrawer();
            renderEmployees();
          }
        }
      } catch(err) {
        errEl.textContent = err.message; errEl.style.display = "block";
      }
    });

    openDrawer();
  }

  // ── Planning ───────────────────────────────────────────────
  let _planningWeekOffset = 0; // weeks relative to current week

  async function renderPlanning() {
    const today = new Date().toISOString().slice(0, 10);
    const baseWeek = getWeekStart(new Date());
    baseWeek.setDate(baseWeek.getDate() + _planningWeekOffset * 7);
    const weekEnd = new Date(baseWeek); weekEnd.setDate(baseWeek.getDate() + 6);
    const from = baseWeek.toISOString().slice(0, 10);
    const to = weekEnd.toISOString().slice(0, 10);

    const [planData, leaveData] = await Promise.all([
      api("GET", `/manager/planning?from=${from}&to=${to}`),
      api("GET", `/leaves?from=${from}&to=${to}&status=goedgekeurd`).catch(() => ({ leaves: [] }))
    ]);
    const shifts = Array.isArray(planData) ? planData : (planData.shifts || []);
    // Build leave map: userId → Set of dates on leave
    const leaveMap = {};
    (leaveData.leaves || []).forEach(l => {
      if (!l.userId || !l.startDate || !l.endDate) return;
      for (let d = new Date(l.startDate); d.toISOString().slice(0,10) <= l.endDate; d.setDate(d.getDate()+1)) {
        const dk = d.toISOString().slice(0,10);
        if (!leaveMap[l.userId]) leaveMap[l.userId] = {};
        leaveMap[l.userId][dk] = l.type || "verlof";
      }
    });

    const days = [];
    for (let d = new Date(baseWeek); d <= weekEnd; d.setDate(d.getDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
    }

    const weekLabel = `${new Date(from).toLocaleDateString("nl-BE",{day:"numeric",month:"short"})} – ${new Date(to).toLocaleDateString("nl-BE",{day:"numeric",month:"short",year:"numeric"})}`;

    const content = document.getElementById("admContent");
    content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Planning</h3>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admPrevWeek" aria-label="Vorige week" title="Vorige week">‹</button>
      <span style="font-size:13px;font-weight:500;min-width:160px;text-align:center;">${weekLabel}</span>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admNextWeek" aria-label="Volgende week" title="Volgende week">›</button>
      ${_planningWeekOffset !== 0 ? `<button class="adm-btn adm-btn-secondary adm-btn-sm" id="admTodayWeek">Vandaag</button>` : ""}
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admCopyWeek" title="Kopieer alle shifts naar volgende week">⧉ Kopieer week</button>
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="admAddShift">+ Shift</button>
    </div>
  </div>
  <div class="adm-card-body adm-table-wrap">
    <table class="adm-table adm-plan-table">
      <thead><tr><th>Medewerker</th>${days.map(d => {
        const dayName = new Date(d).toLocaleDateString("nl-BE",{weekday:"short",day:"numeric",month:"numeric"});
        return `<th style="${d===today?"color:#0ea5e9;font-weight:700;background:#f0f9ff":""}">${dayName}</th>`;
      }).join("")}</tr></thead>
      <tbody>
        ${renderPlanningRows(shifts, days, leaveMap)}
      </tbody>
    </table>
  </div>
  <div style="padding:8px 16px;font-size:11px;color:#94a3b8;display:flex;gap:14px;border-top:1px solid #f8fafc;">
    <span>🟦 Shift</span><span style="color:#d97706">🟧 Verlof (afwezig)</span>
    <span style="margin-left:auto">${shifts.length} shifts · ${Object.keys(leaveMap).length} personen op verlof</span>
  </div>
</div>`;
    document.getElementById("admAddShift")?.addEventListener("click", () => openShiftDrawer(from, to, null, shifts));
    document.getElementById("admPrevWeek")?.addEventListener("click", () => { _planningWeekOffset--; renderPlanning(); });
    document.getElementById("admNextWeek")?.addEventListener("click", () => { _planningWeekOffset++; renderPlanning(); });
    document.getElementById("admTodayWeek")?.addEventListener("click", () => { _planningWeekOffset = 0; renderPlanning(); });
    document.getElementById("admCopyWeek")?.addEventListener("click", async () => {
      if (!shifts.length) { window.showToast && window.showToast("Geen shifts om te kopiëren", "info"); return; }
      const btn = document.getElementById("admCopyWeek");
      btn.disabled = true; btn.textContent = "Bezig…";
      try {
        const nextWeekBase = new Date(baseWeek); nextWeekBase.setDate(nextWeekBase.getDate() + 7);
        let copied = 0;
        for (const s of shifts) {
          const oldDate = new Date(s.date);
          const newDate = new Date(oldDate); newDate.setDate(oldDate.getDate() + 7);
          await api("POST", "/planning", { userId: s.userId, date: newDate.toISOString().slice(0,10), start: s.start, end: s.end, location: s.location||"", note: s.note||"" });
          copied++;
        }
        window.showToast && window.showToast(`${copied} shifts gekopieerd naar volgende week ✓`, "success");
        _planningWeekOffset++;
        renderPlanning();
      } catch(e) { window.showToast && window.showToast("Fout: "+e.message, "error"); btn.disabled = false; btn.textContent = "⧉ Kopieer week"; }
    });
    document.querySelectorAll(".adm-shift-pill").forEach(pill => {
      pill.addEventListener("click", () => {
        const shift = shifts.find(s => s.id === pill.dataset.id);
        if (shift) openShiftDrawer(from, to, shift, shifts);
      });
    });
  }

  // Persoonlijke kleuren per medewerker (cyclisch)
  const PLAN_COLORS = [
    ["#dbeafe","#1d4ed8"],["#dcfce7","#15803d"],["#fef3c7","#92400e"],
    ["#fce7f3","#9d174d"],["#f3e8ff","#6b21a8"],["#cffafe","#0e7490"],
    ["#fee2e2","#991b1b"],["#e0f2fe","#0369a1"]
  ];
  const _planColorMap = {};
  let _planColorIdx = 0;
  function planColor(userId) {
    if (!_planColorMap[userId]) {
      _planColorMap[userId] = PLAN_COLORS[_planColorIdx % PLAN_COLORS.length];
      _planColorIdx++;
    }
    return _planColorMap[userId];
  }

  function renderPlanningRows(shifts, days, leaveMap = {}) {
    const today = new Date().toISOString().slice(0,10);
    const byUser = {};
    shifts.forEach(s => {
      if (!byUser[s.userId]) byUser[s.userId] = { name: s.userName || s.userId, days: {} };
      if (!byUser[s.userId].days[s.date]) byUser[s.userId].days[s.date] = [];
      byUser[s.userId].days[s.date].push(s);
    });
    // Also add leave-only users to the grid
    Object.keys(leaveMap).forEach(uid => {
      if (!byUser[uid]) {
        const leaveUser = Object.values(leaveMap[uid] || {});
        byUser[uid] = { name: uid, days: {}, leaveOnly: true };
      }
    });
    if (!Object.keys(byUser).length) return `<tr><td colspan="${days.length+1}" class="adm-empty">Geen shifts deze week</td></tr>`;
    return Object.values(byUser).map(u => {
      const [bg, fg] = planColor(Object.keys(byUser).find(k => byUser[k] === u) || "x");
      const totalShifts = Object.values(u.days).reduce((s,d)=>s+d.length,0);
      return `<tr>
        <td style="font-weight:500;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${fg};margin-right:5px;vertical-align:middle;"></span>
          ${esc(u.name)}
          <span style="font-size:10px;color:#94a3b8;margin-left:4px;">${totalShifts}×</span>
        </td>
        ${days.map(d => {
          const dayShifts = u.days[d] || [];
          const isToday = d === today;
          const userId = Object.keys(byUser).find(k => byUser[k] === u) || "";
          const onLeave = leaveMap[userId]?.[d];
          let cellBg = isToday ? "#f0f9ff" : "";
          if (onLeave) cellBg = "#fffbeb";
          return `<td style="${cellBg?"background:"+cellBg+";":""}">
            ${onLeave && !dayShifts.length ? `<span style="background:#fef3c7;color:#92400e;border-radius:4px;padding:2px 6px;font-size:10px;font-weight:600;display:inline-block;">🟧 ${esc(onLeave)}</span>` : ""}
            ${dayShifts.map(s =>
              `<span class="adm-shift-pill" data-id="${s.id}" title="${esc(s.note||s.location||"")} — klik om te bewerken"
                style="background:${bg};color:${fg};border:1px solid ${fg}30;border-radius:5px;padding:2px 7px;font-size:11px;font-weight:600;cursor:pointer;display:inline-block;margin-bottom:2px;white-space:nowrap;">
                ${esc(s.start||"")}${s.end?`–${esc(s.end)}`:""}${s.location?` <span style="opacity:.7;font-weight:400">${esc(s.location.slice(0,8))}</span>`:""}
              </span>`
            ).join("<br>")||(!onLeave?`<span style="color:#e2e8f0;font-size:12px;">—</span>`:"")}
          </td>`;
        }).join("")}
      </tr>`;
    }).join("");
  }

  // ── Shift drawer (admin) ───────────────────────────────────
  function openShiftDrawer(weekFrom, weekTo, shift = null, allShifts = []) {
    const today = new Date().toISOString().slice(0, 10);
    api("GET", "/employees").then(data => {
      const employees = data.employees || [];
      const isEdit = !!shift;
      document.getElementById("admDrawerTitle").textContent = isEdit ? "Shift bewerken" : "Shift toevoegen";
      document.getElementById("admDrawerBody").innerHTML = `
<form id="admShiftForm">
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Medewerker *</label>
      <select name="userId" required>
        <option value="">— Kies medewerker —</option>
        ${employees.map(u => `<option value="${esc(u.id)}" ${shift?.userId===u.id?"selected":""}>${esc(u.name || u.email)}</option>`).join("")}
      </select>
    </div>
    <div class="adm-form-group"><label>Datum *</label>
      <input name="date" type="date" value="${shift?.date || weekFrom || today}" required>
    </div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Starttijd *</label>
      <input name="start" type="time" value="${shift?.start || "07:00"}" required>
    </div>
    <div class="adm-form-group"><label>Eindtijd *</label>
      <input name="end" type="time" value="${shift?.end || "17:00"}" required>
    </div>
  </div>
  <div class="adm-form-group"><label>Locatie / Werf</label>
    <input name="venueId" placeholder="Locatienaam (optioneel)" value="${esc(shift?.venueId||shift?.location||"")}">
  </div>
  <div class="adm-form-group"><label>Notitie</label>
    <input name="note" placeholder="Optionele notitie" value="${esc(shift?.note||"")}">
  </div>
  ${!isEdit ? `
  <div style="background:#f8fafc;border-radius:8px;padding:12px;margin-bottom:4px;">
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;cursor:pointer;">
      <input type="checkbox" id="shiftRecurring" style="width:16px;height:16px;"> Wekelijks herhalen
    </label>
    <div id="shiftRecurWrap" style="display:none;margin-top:10px;">
      <div class="adm-form-row">
        <div class="adm-form-group"><label>Aantal weken</label>
          <select id="shiftRecurWeeks" style="width:100%;padding:7px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
            <option value="2">2 weken</option>
            <option value="4" selected>4 weken</option>
            <option value="8">8 weken</option>
            <option value="12">12 weken</option>
          </select>
        </div>
        <div class="adm-form-group" style="align-self:flex-end;padding-bottom:4px;font-size:12px;color:#64748b;" id="shiftRecurInfo">
          Maakt 4 shifts aan
        </div>
      </div>
    </div>
  </div>` : ""}
  <div id="admShiftErr" style="display:none;color:#ef4444;font-size:12px;padding:4px 0;"></div>
  <div class="adm-form-actions" style="justify-content:space-between;">
    ${isEdit ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="admShiftDelete">🗑 Verwijderen</button>` : `<span></span>`}
    <div style="display:flex;gap:8px;">
      <button type="button" class="adm-btn adm-btn-secondary" id="admShiftCancel">Annuleren</button>
      <button type="submit" class="adm-btn adm-btn-primary">${isEdit ? "Opslaan" : "Aanmaken"}</button>
    </div>
  </div>
</form>`;
      openDrawer();
      document.getElementById("admShiftCancel").addEventListener("click", closeDrawer);

      // Recurring toggle
      document.getElementById("shiftRecurring")?.addEventListener("change", e => {
        const wrap = document.getElementById("shiftRecurWrap");
        if (wrap) wrap.style.display = e.target.checked ? "" : "none";
      });
      document.getElementById("shiftRecurWeeks")?.addEventListener("change", e => {
        const info = document.getElementById("shiftRecurInfo");
        if (info) info.textContent = `Maakt ${e.target.value} shifts aan`;
      });

      if (isEdit) {
        document.getElementById("admShiftDelete").addEventListener("click", async () => {
          if (!confirm(`Shift verwijderen voor ${shift.userName||shift.userId} op ${shift.date}?`)) return;
          try {
            await api("DELETE", `/planning/${shift.id}`);
            closeDrawer(); renderPlanning();
          } catch(err) { window.showToast(err.message, "error"); }
        });
      }

      document.getElementById("admShiftForm").addEventListener("submit", async e => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target).entries());
        const errEl = document.getElementById("admShiftErr");
        const submitBtn = e.target.querySelector("[type=submit]");
        errEl.style.display = "none";
        submitBtn.disabled = true; submitBtn.textContent = "Bezig…";
        try {
          if (isEdit) {
            await api("PATCH", `/planning/${shift.id}`, body);
          } else {
            const isRecurring = document.getElementById("shiftRecurring")?.checked;
            const weeks = isRecurring ? Number(document.getElementById("shiftRecurWeeks")?.value || 4) : 1;
            const baseDate = new Date(body.date);
            for (let w = 0; w < weeks; w++) {
              const d = new Date(baseDate); d.setDate(baseDate.getDate() + w*7);
              await api("POST", "/planning", { ...body, date: d.toISOString().slice(0,10) });
            }
            if (weeks > 1) window.showToast && window.showToast(`${weeks} shifts aangemaakt ✓`, "success");
          }
          closeDrawer(); renderPlanning();
        } catch (err) {
          errEl.textContent = err.message; errEl.style.display = "";
          submitBtn.disabled = false; submitBtn.textContent = isEdit ? "Opslaan" : "Aanmaken";
        }
      });
    }).catch(err => window.showToast(err.message, "error"));
  }

  // ── Clocking ───────────────────────────────────────────────
  let _clockDate = new Date().toISOString().slice(0, 10);

  async function renderClocking() {
    const content = document.getElementById("admContent");

    // Always reset to today if view freshly entered
    if (!content.querySelector("#admClockDate")) {
      content.innerHTML = `
<div class="adm-card" style="margin-bottom:14px">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Prikklok overzicht</h3>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="date" id="admClockDate" value="${_clockDate}" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admClockPrev">‹ Vorige</button>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admClockToday">Vandaag</button>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admClockNext">Volgende ›</button>
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="admClockAdd">+ Correctie</button>
    </div>
  </div>
</div>
<div class="adm-card">
  <div class="adm-card-body adm-table-wrap" id="admClockTable"><div class="adm-loading">Laden…</div></div>
</div>`;

      document.getElementById("admClockDate").addEventListener("change", e => {
        _clockDate = e.target.value;
        loadClockData();
      });
      document.getElementById("admClockPrev").addEventListener("click", () => {
        const d = new Date(_clockDate); d.setDate(d.getDate() - 1);
        _clockDate = d.toISOString().slice(0, 10);
        document.getElementById("admClockDate").value = _clockDate;
        loadClockData();
      });
      document.getElementById("admClockNext").addEventListener("click", () => {
        const d = new Date(_clockDate); d.setDate(d.getDate() + 1);
        _clockDate = d.toISOString().slice(0, 10);
        document.getElementById("admClockDate").value = _clockDate;
        loadClockData();
      });
      document.getElementById("admClockToday").addEventListener("click", () => {
        _clockDate = new Date().toISOString().slice(0, 10);
        document.getElementById("admClockDate").value = _clockDate;
        loadClockData();
      });
      document.getElementById("admClockAdd").addEventListener("click", openClockCorrectionDrawer);
    }

    loadClockData();
  }

  async function loadClockData() {
    const tableEl = document.getElementById("admClockTable");
    if (!tableEl) return;
    tableEl.innerHTML = `<div class="adm-loading">Laden…</div>`;
    try {
      const data = await api("GET", `/clocks?date=${_clockDate}`);
      const clocks = data.clocks || data || [];

      const totalHours = clocks.reduce((sum, c) => {
        if (!c.clockedOut) return sum;
        return sum + (new Date(c.clockedOut) - new Date(c.clockedIn)) / 3600000;
      }, 0);
      const ingeklokt = clocks.filter(c => c.status === "in" || !c.clockedOut).length;

      tableEl.innerHTML = `
<div style="display:flex;gap:12px;padding:12px 16px 0;flex-wrap:wrap;">
  <div style="background:#eff6ff;border-radius:8px;padding:8px 14px;text-align:center">
    <div style="font-size:18px;font-weight:700;color:#1d4ed8">${clocks.length}</div>
    <div style="font-size:11px;color:#64748b">Registraties</div>
  </div>
  <div style="background:${ingeklokt>0?"#d1fae5":"#f8fafc"};border-radius:8px;padding:8px 14px;text-align:center">
    <div style="font-size:18px;font-weight:700;color:${ingeklokt>0?"#065f46":"#94a3b8"}">${ingeklokt}</div>
    <div style="font-size:11px;color:#64748b">Nog ingeklokt</div>
  </div>
  <div style="background:#f0fdf4;border-radius:8px;padding:8px 14px;text-align:center">
    <div style="font-size:18px;font-weight:700;color:#15803d">${totalHours.toFixed(1)} u</div>
    <div style="font-size:11px;color:#64748b">Totaal uren</div>
  </div>
</div>
<table class="adm-table" style="margin-top:10px">
  <thead><tr><th>Medewerker</th><th>Inkloktijd</th><th>Uitkloktijd</th><th>Uren</th><th>Status</th><th>Actie</th></tr></thead>
  <tbody>
    ${clocks.map(c => {
      const hours = c.clockedOut ? ((new Date(c.clockedOut) - new Date(c.clockedIn)) / 3600000).toFixed(1) : "—";
      const noOut = !c.clockedOut;
      return `<tr class="${noOut ? "" : "adm-row-link clk-row"}" data-id="${esc(c.id)}" ${noOut ? "" : 'title="Open correctie"'}>
        <td style="font-weight:500">${esc(c.userName || c.userId)}</td>
        <td>${c.clockedIn ? new Date(c.clockedIn).toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit"}) : "—"}</td>
        <td>${c.clockedOut ? new Date(c.clockedOut).toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit"}) : '<span style="color:#f59e0b">Niet uitgeklokt</span>'}</td>
        <td>${hours}</td>
        <td>${c.status==="in"||noOut ? '<span class="adm-status adm-status-active">Ingeklokt</span>' : '<span class="adm-status adm-status-inactive">Uitgeklokt</span>'}</td>
        <td>${noOut ? `<button class="adm-btn adm-btn-warning adm-btn-sm clk-force-out" data-id="${esc(c.id)}" data-uid="${esc(c.userId)}">Klokt uit</button>` : `<button class="adm-btn adm-btn-secondary adm-btn-sm clk-edit" data-id="${esc(c.id)}">✏ Corrigeer</button>`}</td>
      </tr>`;
    }).join("") || '<tr><td colspan="6" class="adm-empty">Geen klokregistraties voor deze datum</td></tr>'}
  </tbody>
</table>`;

      // Wire force-out buttons
      document.querySelectorAll(".clk-force-out").forEach(btn => {
        btn.addEventListener("click", async () => {
          const now = new Date().toISOString();
          btn.disabled = true;
          try { await api("PATCH", `/clocks/${btn.dataset.id}`, { clockedOut: now, status: "out" }); loadClockData(); }
          catch(e) { window.showToast(e.message, "error"); btn.disabled = false; }
        });
      });
      // Wire edit buttons + rij-klik
      document.querySelectorAll(".clk-edit").forEach(btn => {
        btn.addEventListener("click", e => { e.stopPropagation(); openClockEditDrawer(btn.dataset.id, clocks); });
      });
      document.querySelectorAll(".clk-row").forEach(row => {
        row.addEventListener("click", e => {
          if (e.target.closest("button")) return;
          openClockEditDrawer(row.dataset.id, clocks);
        });
      });

    } catch(e) {
      tableEl.innerHTML = `<div class="adm-empty" style="color:#dc2626">Fout: ${e.message}</div>`;
    }
  }

  function openClockCorrectionDrawer() {
    // Load employees to pick from
    const empPromise = (_state.employees && _state.employees.length)
      ? Promise.resolve({ employees: _state.employees })
      : api("GET", "/employees");

    empPromise.then(data => {
      const employees = data.employees || [];
      document.getElementById("admDrawerTitle").textContent = "Klokregistratie toevoegen";
      document.getElementById("admDrawerBody").innerHTML = `
<form id="clkAddForm">
  <div class="adm-form-group"><label>Medewerker *</label>
    <select name="userId" required>
      <option value="">— Kies medewerker —</option>
      ${employees.map(u => `<option value="${esc(u.id)}">${esc(u.name||u.email)}</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Datum *</label>
      <input name="date" type="date" value="${_clockDate}" required>
    </div>
    <div class="adm-form-group"><label>Inkloktijd *</label>
      <input name="clockInTime" type="time" value="07:00" required>
    </div>
  </div>
  <div class="adm-form-group"><label>Uitkloktijd (leeg = nog ingeklokt)</label>
    <input name="clockOutTime" type="time">
  </div>
  <div class="adm-form-group"><label>Notitie</label>
    <input name="note" placeholder="Reden van correctie">
  </div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="clkAddCancel">Annuleren</button>
    <button type="submit" class="adm-btn adm-btn-primary">Opslaan</button>
  </div>
</form>`;
      openDrawer();
      document.getElementById("clkAddCancel").addEventListener("click", closeDrawer);
      document.getElementById("clkAddForm").addEventListener("submit", async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const date = fd.get("date");
        const clockInTime = fd.get("clockInTime");
        const clockOutTime = fd.get("clockOutTime");
        const userId = fd.get("userId");
        const emp = employees.find(u => u.id === userId);
        const body = {
          userId,
          userName: emp?.name || emp?.email || userId,
          clockedIn: `${date}T${clockInTime}:00.000Z`,
          clockedOut: clockOutTime ? `${date}T${clockOutTime}:00.000Z` : null,
          status: clockOutTime ? "out" : "in",
          note: fd.get("note") || "Handmatige correctie",
          manual: true
        };
        try {
          await api("POST", "/clocks/manual", body);
          closeDrawer(); loadClockData();
        } catch(err) { window.showToast(err.message, "error"); }
      });
    }).catch(e => window.showToast(e.message, "error"));
  }

  function openClockEditDrawer(clockId, clocks) {
    const clk = clocks.find(c => c.id === clockId);
    if (!clk) return;
    const inTime = clk.clockedIn ? new Date(clk.clockedIn).toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit",hour12:false}) : "";
    const outTime = clk.clockedOut ? new Date(clk.clockedOut).toLocaleTimeString("nl-BE",{hour:"2-digit",minute:"2-digit",hour12:false}) : "";
    document.getElementById("admDrawerTitle").textContent = `Klok corrigeren — ${esc(clk.userName||clk.userId)}`;
    document.getElementById("admDrawerBody").innerHTML = `
<form id="clkEditForm">
  <div class="adm-form-group"><label>Medewerker</label>
    <input value="${esc(clk.userName||clk.userId)}" disabled style="background:#f8fafc">
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Inkloktijd *</label>
      <input name="clockInTime" type="time" value="${inTime}" required>
    </div>
    <div class="adm-form-group"><label>Uitkloktijd</label>
      <input name="clockOutTime" type="time" value="${outTime}">
    </div>
  </div>
  <div class="adm-form-group"><label>Reden correctie</label>
    <input name="note" placeholder="Bijv. vergeten uitkloktijd" value="${esc(clk.note||"")}">
  </div>
  <div id="clkEditErr" style="display:none;color:#ef4444;font-size:12px;padding:6px 0;margin-bottom:4px;"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="clkEditCancel">Annuleren</button>
    <button type="submit" class="adm-btn adm-btn-primary">Opslaan</button>
  </div>
</form>`;
    openDrawer();
    document.getElementById("clkEditCancel").addEventListener("click", closeDrawer);
    document.getElementById("clkEditForm").addEventListener("submit", async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const date = _clockDate;
      const clockInTime  = fd.get("clockInTime");
      const clockOutTime = fd.get("clockOutTime");
      const errEl = document.getElementById("clkEditErr");
      errEl.style.display = "none";

      // Validation
      const nowStr = new Date().toISOString().slice(0,10);
      const inISO  = `${date}T${clockInTime}:00`;
      const outISO = clockOutTime ? `${date}T${clockOutTime}:00` : null;

      if (date > nowStr) {
        errEl.textContent = "Datum mag niet in de toekomst liggen."; errEl.style.display = ""; return;
      }
      if (date === nowStr) {
        const nowTime = new Date().toTimeString().slice(0,5);
        if (clockInTime > nowTime) {
          errEl.textContent = "Inkloktijd mag niet in de toekomst liggen."; errEl.style.display = ""; return;
        }
        if (outISO && clockOutTime > nowTime) {
          errEl.textContent = "Uitkloktijd mag niet in de toekomst liggen."; errEl.style.display = ""; return;
        }
      }
      if (outISO && outISO <= inISO) {
        errEl.textContent = "Uitkloktijd moet na inkloktijd liggen."; errEl.style.display = ""; return;
      }

      const body = {
        clockedIn:  `${date}T${clockInTime}:00.000Z`,
        clockedOut: outISO ? `${date}T${clockOutTime}:00.000Z` : null,
        status: clockOutTime ? "out" : "in",
        note: fd.get("note") || undefined
      };
      const submitBtn = e.target.querySelector("[type=submit]");
      submitBtn.disabled = true; submitBtn.textContent = "Opslaan…";
      try {
        await api("PATCH", `/clocks/${clockId}`, body);
        closeDrawer(); loadClockData();
      } catch(err) {
        errEl.textContent = err.message; errEl.style.display = "";
        submitBtn.disabled = false; submitBtn.textContent = "Opslaan";
      }
    });
  }

  // ── Leaves ─────────────────────────────────────────────────
  let _leaveTab = "aanvragen";
  let _leaveCalYear  = new Date().getFullYear();
  let _leaveCalMonth = new Date().getMonth() + 1;

  async function renderLeaves() {
    const content = document.getElementById("admContent");
    content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Verlof</h3>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <button class="adm-btn adm-btn-sm ${_leaveTab==="aanvragen"?"adm-btn-primary":"adm-btn-secondary"}" id="admLeaveTabReq">Aanvragen</button>
      <button class="adm-btn adm-btn-sm ${_leaveTab==="kalender"?"adm-btn-primary":"adm-btn-secondary"}" id="admLeaveTabCal">Kalender</button>
      <button class="adm-btn adm-btn-sm ${_leaveTab==="saldi"?"adm-btn-primary":"adm-btn-secondary"}" id="admLeaveTabBal">Saldi</button>
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="admLeaveNew" style="margin-left:8px;">+ Verlof aanmaken</button>
    </div>
  </div>
  <div class="adm-card-body" id="admLeaveBody" style="padding:0;"></div>
</div>`;

    document.getElementById("admLeaveTabReq").addEventListener("click", () => { _leaveTab = "aanvragen"; renderLeaveBody(); });
    document.getElementById("admLeaveTabCal").addEventListener("click", () => { _leaveTab = "kalender"; renderLeaveBody(); });
    document.getElementById("admLeaveTabBal").addEventListener("click", () => { _leaveTab = "saldi"; renderLeaveBody(); });
    document.getElementById("admLeaveNew").addEventListener("click", () => openCreateLeaveDrawer());
    renderLeaveBody();
  }

  async function openCreateLeaveDrawer(preselectedUserId = null) {
    let employees = [];
    try { const d = await api("GET", "/employees"); employees = d.employees || []; } catch(_){}
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById("admDrawerTitle").textContent = "Verlof aanmaken";
    document.getElementById("admDrawerBody").innerHTML = `
<form id="createLeaveForm">
  <div class="adm-form-group">
    <label>Medewerker *</label>
    <select name="userId" required>
      <option value="">— Kies medewerker —</option>
      ${employees.map(u => `<option value="${esc(u.id)}" ${preselectedUserId===u.id?"selected":""}>${esc(u.name||u.email)}</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-group">
    <label>Type verlof</label>
    <select name="type">
      <option value="vakantie">Vakantie</option>
      <option value="ziekte">Ziekte</option>
      <option value="adv">ADV</option>
      <option value="bijzonder">Bijzonder verlof</option>
      <option value="onbetaald">Onbetaald verlof</option>
    </select>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group">
      <label>Van *</label>
      <input name="startDate" type="date" value="${today}" required>
    </div>
    <div class="adm-form-group">
      <label>Tot *</label>
      <input name="endDate" type="date" value="${today}" required>
    </div>
  </div>
  <div class="adm-form-group">
    <label>Status</label>
    <select name="status">
      <option value="goedgekeurd">Goedgekeurd</option>
      <option value="aangevraagd">Aangevraagd</option>
    </select>
  </div>
  <div class="adm-form-group">
    <label>Reden / notitie</label>
    <textarea name="reason" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;" placeholder="Optionele opmerking"></textarea>
  </div>
  <div id="createLeaveErr" style="display:none;background:#fef2f2;color:#dc2626;border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="createLeaveCancel">Annuleren</button>
    <button type="submit" class="adm-btn adm-btn-primary">Aanmaken</button>
  </div>
</form>`;
    openDrawer();
    document.getElementById("createLeaveCancel").addEventListener("click", closeDrawer);
    document.getElementById("createLeaveForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = document.getElementById("createLeaveErr");
      const body = Object.fromEntries(new FormData(e.target).entries());
      // Calculate days
      if (body.startDate && body.endDate) {
        const days = Math.round((new Date(body.endDate) - new Date(body.startDate)) / 86400000) + 1;
        body.days = Math.max(1, days);
      }
      try {
        await api("POST", "/leaves", body);
        closeDrawer();
        _leaveTab = "aanvragen";
        renderLeaves();
        window.showToast && window.showToast("Verlof aangemaakt ✓", "success");
      } catch(err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = ""; }
      }
    });
  }

  async function renderLeaveBody() {
    // Update tab button styles
    ["aanvragen","kalender","saldi"].forEach(t => {
      const btn = document.getElementById(t==="aanvragen"?"admLeaveTabReq":t==="kalender"?"admLeaveTabCal":"admLeaveTabBal");
      if (btn) { btn.className = `adm-btn adm-btn-sm ${_leaveTab===t?"adm-btn-primary":"adm-btn-secondary"}`; }
    });

    const body = document.getElementById("admLeaveBody");
    if (!body) return;
    body.innerHTML = `<div style="padding:24px;text-align:center;color:#94a3b8;font-size:13px;">Laden…</div>`;

    if (_leaveTab === "aanvragen") {
      const data = await api("GET", "/leaves");
      const leaves = data.leaves || data || [];
      body.innerHTML = `
<div style="padding:12px 16px;border-bottom:1px solid #f1f5f9;display:flex;gap:8px;align-items:center;">
  <select id="admLeaveFilter" style="padding:6px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
    <option value="">Alle statussen</option>
    <option value="aangevraagd">Aangevraagd</option>
    <option value="goedgekeurd">Goedgekeurd</option>
    <option value="geweigerd">Geweigerd</option>
  </select>
</div>
<div class="adm-table-wrap" id="admLeaveTable">${renderLeaveTable(leaves)}</div>`;
      document.getElementById("admLeaveFilter").addEventListener("change", e => {
        const filtered = e.target.value ? leaves.filter(l => l.status === e.target.value) : leaves;
        document.getElementById("admLeaveTable").innerHTML = renderLeaveTable(filtered);
        bindLeaveActions(leaves);
      });
      bindLeaveActions(leaves);

    } else if (_leaveTab === "kalender") {
      await renderLeaveCalendar(body);

    } else {
      await renderLeaveBalance(body);
    }
  }

  async function renderLeaveCalendar(container) {
    const MONTHS_NL = ["","Januari","Februari","Maart","April","Mei","Juni","Juli","Augustus","September","Oktober","November","December"];
    const DAYS_NL   = ["Zo","Ma","Di","Wo","Do","Vr","Za"];

    let calData;
    try {
      calData = await api("GET", `/leaves/calendar?year=${_leaveCalYear}&month=${_leaveCalMonth}`);
    } catch(e) {
      container.innerHTML = `<div style="padding:24px;color:#ef4444;">${esc(e.message)}</div>`;
      return;
    }
    const { days = {}, leaves = [] } = calData;

    // Build userId→name map — fetch employees if not yet loaded
    if (!_state.employees?.length) {
      try { const d = await api("GET", "/employees?includeInactive=true"); _state.employees = d.employees || d || []; } catch(_) {}
    }
    const empMap = {};
    (_state.employees||[]).forEach(u => { empMap[u.id] = u.name || u.email; });
    leaves.forEach(l => { if (l.userId && l.userName && !empMap[l.userId]) empMap[l.userId] = l.userName; });

    const firstDow = new Date(_leaveCalYear, _leaveCalMonth - 1, 1).getDay(); // 0=Sun
    const lastDay  = new Date(_leaveCalYear, _leaveCalMonth, 0).getDate();

    // calendar grid
    let cells = "";
    let col = firstDow === 0 ? 6 : firstDow - 1; // shift: Mon=0
    for (let i = 0; i < col; i++) cells += `<div></div>`;
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${_leaveCalYear}-${String(_leaveCalMonth).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const userIds = days[dateStr] || [];
      const dow = new Date(_leaveCalYear, _leaveCalMonth - 1, d).getDay();
      const isWeekend = dow === 0 || dow === 6;
      const isToday = dateStr === new Date().toISOString().slice(0,10);
      cells += `<div style="min-height:52px;border-radius:8px;padding:4px 6px;background:${isToday?"#eff6ff":isWeekend?"#f8fafc":"#fff"};border:1px solid ${isToday?"#bfdbfe":"#e2e8f0"};">
        <div style="font-size:11px;font-weight:${isToday?"700":"500"};color:${isWeekend?"#94a3b8":isToday?"#2563eb":"#374151"};margin-bottom:2px;">${d}</div>
        ${userIds.slice(0,3).map(uid => `<div style="font-size:10px;background:#dbeafe;color:#1e40af;border-radius:4px;padding:1px 4px;margin-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(empMap[uid]||uid)}">${esc((empMap[uid]||uid).split(" ")[0])}</div>`).join("")}
        ${userIds.length > 3 ? `<div style="font-size:10px;color:#64748b;">+${userIds.length-3}</div>` : ""}
      </div>`;
    }

    container.innerHTML = `
<div style="padding:16px;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admCalPrev">‹</button>
    <span style="font-size:15px;font-weight:600;min-width:160px;text-align:center;">${MONTHS_NL[_leaveCalMonth]} ${_leaveCalYear}</span>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admCalNext">›</button>
    <span style="font-size:12px;color:#64748b;margin-left:8px;">${leaves.length} goedgekeurde verloven</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px;">
    ${["Ma","Di","Wo","Do","Vr","Za","Zo"].map(d=>`<div style="text-align:center;font-size:11px;font-weight:600;color:#64748b;padding:4px 0;">${d}</div>`).join("")}
  </div>
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">${cells}</div>
  ${leaves.length ? `
  <div style="margin-top:16px;padding-top:12px;border-top:1px solid #f1f5f9;">
    <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Verloven deze maand</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
    ${leaves.map(l=>`<div style="font-size:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:4px 8px;color:#166534;">
      <strong>${esc(empMap[l.userId]||l.userId)}</strong> · ${esc(l.type)} · ${l.startDate}→${l.endDate} (${l.days}d)
    </div>`).join("")}
    </div>
  </div>` : ""}
</div>`;

    document.getElementById("admCalPrev").addEventListener("click", () => {
      _leaveCalMonth--;
      if (_leaveCalMonth < 1) { _leaveCalMonth = 12; _leaveCalYear--; }
      renderLeaveCalendar(container);
    });
    document.getElementById("admCalNext").addEventListener("click", () => {
      _leaveCalMonth++;
      if (_leaveCalMonth > 12) { _leaveCalMonth = 1; _leaveCalYear++; }
      renderLeaveCalendar(container);
    });
  }

  async function renderLeaveBalance(container) {
    const year = new Date().getFullYear();
    let balData;
    try {
      balData = await api("GET", `/leaves/balance?year=${year}`);
    } catch(e) {
      container.innerHTML = `<div style="padding:24px;color:#ef4444;">${esc(e.message)}</div>`;
      return;
    }
    const balance = balData.balance || [];
    if (!balance.length) {
      container.innerHTML = `<div style="padding:24px;text-align:center;color:#94a3b8;">Geen medewerkers gevonden.</div>`;
      return;
    }

    container.innerHTML = `
<div style="padding:16px;">
  <div style="font-size:13px;color:#64748b;margin-bottom:12px;">Vakantiesaldo ${year} — op basis van goedgekeurde verlofaanvragen</div>
  <table class="adm-table">
    <thead><tr><th>Medewerker</th><th>Quota</th><th>Gebruikt</th><th>Resterend</th><th>Voortgang</th></tr></thead>
    <tbody>${balance.map(b => {
      const pct = b.quota ? Math.min(100, Math.round((b.used / b.quota) * 100)) : 0;
      const color = pct >= 90 ? "#ef4444" : pct >= 70 ? "#f59e0b" : "#10b981";
      return `<tr>
        <td><div style="font-weight:500;">${esc(b.name)}</div><div style="font-size:11px;color:#94a3b8;">${esc(b.email)}</div></td>
        <td>${b.quota}d</td>
        <td>${b.used}d</td>
        <td style="font-weight:600;color:${b.remaining<=2?"#ef4444":b.remaining<=5?"#f59e0b":"#10b981"};">${b.remaining}d</td>
        <td style="min-width:120px;">
          <div style="background:#f1f5f9;border-radius:20px;height:8px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${color};border-radius:20px;transition:width .3s;"></div>
          </div>
          <div style="font-size:10px;color:#94a3b8;margin-top:2px;">${pct}%</div>
        </td>
      </tr>`;
    }).join("")}</tbody>
  </table>
</div>`;
  }

  function renderLeaveTable(leaves) {
    if (!leaves.length) return `<div class="adm-empty"><div class="adm-empty-icon">📅</div><div class="adm-empty-text">Geen verlofaanvragen</div></div>`;
    return `<table class="adm-table">
      <thead><tr><th>Medewerker</th><th>Type</th><th>Van</th><th>Tot</th><th>Reden</th><th>Status</th><th>Opmerking</th><th>Acties</th></tr></thead>
      <tbody>${leaves.map(l => `
        <tr>
          <td>${esc(l.userName || l.userId)}</td>
          <td>${esc(l.type||"—")}</td>
          <td>${esc(l.startDate||"")}</td>
          <td>${esc(l.endDate||"")}</td>
          <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(l.reason||"")}">${esc(l.reason||"—")}</td>
          <td><span class="adm-status adm-status-${l.status}">${esc(l.status||"")}</span></td>
          <td style="font-size:12px;color:#64748b;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(l.reviewNote||"")}">${esc(l.reviewNote||"—")}</td>
          <td style="white-space:nowrap;">${l.status==="aangevraagd" ? `
            <button class="adm-btn adm-btn-success adm-btn-sm adm-leave-action" data-id="${esc(l.id)}" data-status="goedgekeurd">✓ Goed</button>
            <button class="adm-btn adm-btn-danger adm-btn-sm adm-leave-action" data-id="${esc(l.id)}" data-status="geweigerd">✗ Weiger</button>
          ` : "—"}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
  }

  function bindLeaveActions(leaves) {
    document.querySelectorAll(".adm-leave-action").forEach(btn => {
      btn.addEventListener("click", () => {
        const decision = btn.dataset.status || btn.dataset.decision;
        const leave    = leaves.find(l => l.id === btn.dataset.id);
        openLeaveReviewModal(btn.dataset.id, decision, leave, () => renderLeaves());
      });
    });
  }

  function openLeaveReviewModal(leaveId, decision, leave, onDone) {
    const isApprove = decision === "goedgekeurd";
    const label = isApprove ? "Verlof goedkeuren" : "Verlof weigeren";
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
<div style="background:#fff;border-radius:14px;width:420px;max-width:100%;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2);">
  <h3 style="font-size:15px;font-weight:700;margin:0 0 6px;">${label}</h3>
  <p style="font-size:13px;color:#64748b;margin:0 0 16px;">${esc(leave?.userName||leave?.userId||"")} · ${esc(leave?.type||"verlof")} · ${leave?.startDate||""}${leave?.endDate&&leave?.endDate!==leave?.startDate?" → "+leave?.endDate:""}</p>
  <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Opmerking ${isApprove?"(optioneel)":"(optioneel)"}</label>
  <textarea id="admLeaveNote" rows="3" placeholder="Voeg een opmerking toe…"
    style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea>
  <div id="admLeaveModalErr" style="display:none;color:#ef4444;font-size:12px;margin-top:6px;"></div>
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
    <button id="admLeaveModalCancel" class="adm-btn adm-btn-secondary adm-btn-sm">Annuleren</button>
    <button id="admLeaveModalConfirm" class="adm-btn ${isApprove?"adm-btn-success":"adm-btn-danger"} adm-btn-sm">${label}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
    document.getElementById("admLeaveModalCancel").addEventListener("click", close);
    document.getElementById("admLeaveModalConfirm").addEventListener("click", async () => {
      const reviewNote = document.getElementById("admLeaveNote").value.trim();
      const confirmBtn = document.getElementById("admLeaveModalConfirm");
      const errEl      = document.getElementById("admLeaveModalErr");
      confirmBtn.disabled = true; confirmBtn.textContent = "…";
      try {
        await api("PATCH", `/leaves/${leaveId}/review`, { decision, reviewNote: reviewNote || undefined });
        close();
        if (onDone) onDone();
      } catch(e) {
        errEl.textContent = e.message; errEl.style.display = "block";
        confirmBtn.disabled = false; confirmBtn.textContent = label;
      }
    });
  }

  // ── Expenses ───────────────────────────────────────────────
  async function renderExpenses() {
    const data = await api("GET", "/expenses");
    const expenses = data.expenses || data || [];

    const pending   = expenses.filter(e => ["pending","ingediend"].includes(e.status));
    const approved  = expenses.filter(e => ["goedgekeurd","approved"].includes(e.status));
    const rejected  = expenses.filter(e => e.status === "geweigerd");
    const totalPend = pending.reduce((s,e) => s+Number(e.amount||0), 0);
    const totalAppr = approved.reduce((s,e) => s+Number(e.amount||0), 0);
    const fmtE = n => new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(n);

    const content = document.getElementById("admContent");
    content.innerHTML = `
<div class="adm-kpis" style="margin-bottom:14px;">
  <div class="adm-kpi adm-kpi-amber">
    <div class="adm-kpi-label">In behandeling</div>
    <div class="adm-kpi-value">${pending.length}</div>
    <div class="adm-kpi-sub">${fmtE(totalPend)}</div>
  </div>
  <div class="adm-kpi adm-kpi-green">
    <div class="adm-kpi-label">Goedgekeurd</div>
    <div class="adm-kpi-value">${approved.length}</div>
    <div class="adm-kpi-sub">${fmtE(totalAppr)}</div>
  </div>
  <div class="adm-kpi adm-kpi-red">
    <div class="adm-kpi-label">Geweigerd</div>
    <div class="adm-kpi-value">${rejected.length}</div>
    <div class="adm-kpi-sub">declaraties</div>
  </div>
  <div class="adm-kpi adm-kpi-blue">
    <div class="adm-kpi-label">Totaal ingediend</div>
    <div class="adm-kpi-value">${expenses.length}</div>
    <div class="adm-kpi-sub">alle statussen</div>
  </div>
</div>
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Onkostennota's <span style="background:#e0f2fe;color:#0284c7;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${expenses.length}</span></h3>
    <select id="admExpFilter" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
      <option value="">Alle statussen</option>
      <option value="ingediend">In behandeling</option>
      <option value="goedgekeurd">Goedgekeurd</option>
      <option value="geweigerd">Geweigerd</option>
    </select>
  </div>
  <div class="adm-card-body adm-table-wrap" id="admExpTable"></div>
</div>`;

    function buildExpRows(rows) {
      if (!rows.length) return '<div class="adm-empty">Geen onkosten gevonden</div>';
      return `<table class="adm-table">
        <thead><tr><th>Medewerker</th><th>Datum</th><th>Categorie</th><th>Bedrag</th><th>Omschrijving</th><th>Status</th><th>Acties</th></tr></thead>
        <tbody>${rows.map(e => `<tr>
          <td>${esc(e.userName || e.userId)}</td>
          <td>${esc(e.date)}</td>
          <td>${esc(e.category||"—")}</td>
          <td style="font-weight:600;">€ ${Number(e.amount||0).toFixed(2)}</td>
          <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(e.description||"")}">${esc(e.description||"—")}</td>
          <td>
            <span class="adm-status adm-status-${e.status}">${esc(e.status)}</span>
            ${e.reviewNote ? `<div style="font-size:11px;color:#64748b;margin-top:2px;" title="${esc(e.reviewNote)}">💬 ${esc(e.reviewNote.slice(0,30))}${e.reviewNote.length>30?"…":""}</div>` : ""}
          </td>
          <td style="white-space:nowrap;">${["pending","ingediend"].includes(e.status) ? `
            <button class="adm-btn adm-btn-success adm-btn-sm adm-exp-review" data-id="${e.id}" data-dec="goedgekeurd" data-name="${esc(e.userName||e.userId)}" data-amount="${e.amount}" data-cat="${esc(e.category||"")}">✓ Goed</button>
            <button class="adm-btn adm-btn-danger  adm-btn-sm adm-exp-review" data-id="${e.id}" data-dec="geweigerd"  data-name="${esc(e.userName||e.userId)}" data-amount="${e.amount}" data-cat="${esc(e.category||"")}">✗ Weiger</button>
          ` : "—"}</td>
        </tr>`).join("")}</tbody>
      </table>`;
    }

    function wireExpBtns() {
      content.querySelectorAll(".adm-exp-review").forEach(btn => {
        btn.addEventListener("click", () => openExpenseReviewModal(btn.dataset, () => {
          const sel = document.getElementById("admExpFilter");
          const f = sel?.value || "";
          const rows = f ? expenses.filter(e => e.status === f || (f==="ingediend" && e.status==="pending")) : expenses;
          const tbl = document.getElementById("admExpTable"); if (tbl) { tbl.innerHTML = buildExpRows(rows); wireExpBtns(); }
        }));
      });
    }

    const tbl = document.getElementById("admExpTable");
    if (tbl) { tbl.innerHTML = buildExpRows(expenses); wireExpBtns(); }

    document.getElementById("admExpFilter")?.addEventListener("change", e => {
      const f = e.target.value;
      const rows = f ? expenses.filter(exp => exp.status === f || (f==="ingediend" && exp.status==="pending")) : expenses;
      const t = document.getElementById("admExpTable"); if (t) { t.innerHTML = buildExpRows(rows); wireExpBtns(); }
    });
  }

  function openExpenseReviewModal({ id, dec, name, amount, cat }, onDone) {
    const isApprove = dec === "goedgekeurd";
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:100%;max-width:400px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2);">
  <div style="font-size:15px;font-weight:700;margin-bottom:4px;">${isApprove ? "Onkost goedkeuren" : "Onkost weigeren"}</div>
  <div style="font-size:13px;color:#64748b;margin-bottom:16px;">${esc(name)} · ${esc(cat)} · <strong>€ ${Number(amount||0).toFixed(2)}</strong></div>
  <div style="margin-bottom:16px;">
    <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">Opmerking ${isApprove?"(optioneel)":"(verplicht bij weigering)"}</label>
    <textarea id="expReviewNote" rows="3" placeholder="${isApprove?"Goedgekeurd voor uitbetaling…":"Geef een reden op…"}"
      style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea>
  </div>
  <div id="expReviewErr" style="display:none;color:#ef4444;font-size:12px;margin-bottom:8px;"></div>
  <div style="display:flex;gap:8px;justify-content:flex-end;">
    <button id="expReviewCancel" class="adm-btn adm-btn-secondary adm-btn-sm">Annuleren</button>
    <button id="expReviewConfirm" class="adm-btn ${isApprove?"adm-btn-success":"adm-btn-danger"} adm-btn-sm">${isApprove?"✓ Goedkeuren":"✗ Weigeren"}</button>
  </div>
</div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    document.getElementById("expReviewCancel").addEventListener("click", close);
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
    document.getElementById("expReviewConfirm").addEventListener("click", async () => {
      const note = document.getElementById("expReviewNote").value.trim();
      const errEl = document.getElementById("expReviewErr");
      if (!isApprove && !note) { errEl.textContent = "Geef een reden op bij weigering."; errEl.style.display = ""; return; }
      const confirmBtn = document.getElementById("expReviewConfirm");
      confirmBtn.disabled = true; confirmBtn.textContent = "…";
      try {
        await api("PATCH", `/expenses/${id}`, { status: dec, reviewNote: note || undefined });
        close();
        window.showToast && window.showToast(isApprove ? "Onkost goedgekeurd ✓" : "Onkost geweigerd", isApprove ? "success" : "info");
        onDone();
      } catch(e) {
        errEl.textContent = e.message; errEl.style.display = "";
        confirmBtn.disabled = false; confirmBtn.textContent = isApprove ? "✓ Goedkeuren" : "✗ Weigeren";
      }
    });
  }

  // ── Workorders ─────────────────────────────────────────────
  let _woFilterStatus = "";
  let _woFilterUser   = "";
  let _woFilterSearch = "";

  async function renderWorkorders() {
    const content = document.getElementById("admContent");

    // load workorders + employees in parallel for the filter dropdown
    const [woData, empData] = await Promise.all([
      api("GET", "/workorders"),
      api("GET", "/employees").catch(() => ({ employees: [] }))
    ]);
    const allWorkorders = woData.workorders || woData || [];
    const employees     = empData.employees || [];

    // Status groups
    const DONE_STATUSES = new Set(["Voltooid","Afgewerkt","done"]);
    const statusGroupMatch = (w) => {
      if (!_woFilterStatus) return true;
      if (_woFilterStatus === "done") return DONE_STATUSES.has(w.status);
      return w.status === _woFilterStatus;
    };
    // apply filters client-side
    const workorders = allWorkorders.filter(w => {
      if (!statusGroupMatch(w)) return false;
      if (_woFilterUser   && w.userId !== _woFilterUser)   return false;
      if (_woFilterSearch) {
        const q = _woFilterSearch.toLowerCase();
        const hay = `${w.title||""} ${w.clientName||""} ${w.userName||""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const statusCounts = {};
    allWorkorders.forEach(w => { statusCounts[w.status] = (statusCounts[w.status]||0)+1; });
    const doneCount = ["Voltooid","Afgewerkt","done"].reduce((s,k) => s+(statusCounts[k]||0), 0);

    content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Werkbonnen
      <span style="background:#e0f2fe;color:#0284c7;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${workorders.length}/${allWorkorders.length}</span>
    </h3>
    <button class="adm-btn adm-btn-primary adm-btn-sm" id="admNewWO">+ Werkbon</button>
  </div>

  <!-- Filter bar -->
  <div style="display:flex;gap:10px;flex-wrap:wrap;padding:0 20px 14px;border-bottom:1px solid #f1f5f9;">
    <input id="admWoSearch" type="search" placeholder="Zoek op titel / klant…" value="${esc(_woFilterSearch)}"
      style="flex:1;min-width:160px;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;font-size:13px;">
    <select id="admWoStatusFilter" style="border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;font-size:13px;min-width:140px;">
      <option value="">Alle statussen</option>
      <option value="open"        ${_woFilterStatus==="open"?"selected":""}>Open (${statusCounts.open||0})</option>
      <option value="in_progress" ${_woFilterStatus==="in_progress"?"selected":""}>In uitvoering (${statusCounts.in_progress||0})</option>
      <option value="done"        ${_woFilterStatus==="done"?"selected":""}>Voltooid (${doneCount})</option>
      <option value="geannuleerd" ${_woFilterStatus==="geannuleerd"?"selected":""}>Geannuleerd (${statusCounts.geannuleerd||0})</option>
    </select>
    <select id="admWoUserFilter" style="border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;font-size:13px;min-width:160px;">
      <option value="">Alle medewerkers</option>
      ${employees.map(u => `<option value="${esc(u.id)}" ${_woFilterUser===u.id?"selected":""}>${esc(u.name||u.email)}</option>`).join("")}
    </select>
    ${(_woFilterStatus||_woFilterUser||_woFilterSearch) ? `<button class="adm-btn adm-btn-secondary adm-btn-sm" id="admWoClearFilter" style="white-space:nowrap;">✕ Wis filters</button>` : ""}
  </div>

  <div class="adm-card-body adm-table-wrap">
    <table class="adm-table">
      <thead><tr><th>#</th><th>Titel</th><th>Medewerker</th><th>Klant</th><th>Status</th><th>Prioriteit</th><th>Datum</th><th>Acties</th></tr></thead>
      <tbody>
        ${workorders.map(w => `
        <tr class="adm-row-link adm-wo-row" data-id="${w.id}" title="Open werkbon">
          <td style="font-family:monospace;font-size:12px;">${w.number || w.id.slice(-4)}</td>
          <td>${esc(w.title || "—")}</td>
          <td>${esc(w.userName || w.userId || "—")}</td>
          <td>${esc(w.clientName || "—")}</td>
          <td><span class="adm-status adm-status-${(w.status||"").toLowerCase().replace(/\s/g,"-")}">${esc(w.status||"—")}</span></td>
          <td><span style="font-size:12px;">${w.priority==="hoog"?"🔴":w.priority==="laag"?"🟢":"🟡"} ${esc(w.priority||"normaal")}</span></td>
          <td>${w.scheduledDate || w.createdAt?.slice(0,10) || "—"}</td>
          <td><button class="adm-btn adm-btn-secondary adm-btn-sm adm-wo-edit" data-id="${w.id}">✏</button></td>
        </tr>`).join("") || `<tr><td colspan="8" class="adm-empty">${_woFilterStatus||_woFilterUser||_woFilterSearch ? "Geen resultaten voor deze filters" : `Nog geen werkbonnen.<br><button class="adm-btn adm-btn-primary adm-btn-sm" id="admEmptyNewWO" style="margin-top:10px">+ Eerste werkbon aanmaken</button>`}</td></tr>`}
      </tbody>
    </table>
  </div>
</div>`;

    // Filter events (re-render on change, state persists)
    document.getElementById("admWoSearch")?.addEventListener("input", e => {
      _woFilterSearch = e.target.value.trim(); renderWorkorders();
    });
    document.getElementById("admWoStatusFilter")?.addEventListener("change", e => {
      _woFilterStatus = e.target.value; renderWorkorders();
    });
    document.getElementById("admWoUserFilter")?.addEventListener("change", e => {
      _woFilterUser = e.target.value; renderWorkorders();
    });
    document.getElementById("admWoClearFilter")?.addEventListener("click", () => {
      _woFilterStatus = ""; _woFilterUser = ""; _woFilterSearch = ""; renderWorkorders();
    });

    document.getElementById("admNewWO")?.addEventListener("click", () => openWorkorderDrawer(null, allWorkorders));
    document.getElementById("admEmptyNewWO")?.addEventListener("click", () => openWorkorderDrawer(null, allWorkorders));
    document.querySelectorAll(".adm-wo-edit").forEach(btn => {
      btn.addEventListener("click", e => { e.stopPropagation(); openWorkorderDrawer(allWorkorders.find(w => w.id === btn.dataset.id), allWorkorders); });
    });
    document.querySelectorAll(".adm-wo-row").forEach(row => {
      row.addEventListener("click", () => openWorkorderDrawer(allWorkorders.find(w => w.id === row.dataset.id), allWorkorders));
    });
  }

  // ── Werkbon drawer ─────────────────────────────────────────
  function openWorkorderDrawer(workorder, _preloadedWOs) {
    Promise.all([
      api("GET", "/employees"),
      api("GET", "/customers").catch(() => ({ customers: [] }))
    ]).then(([empData, custData]) => {
      const employees = empData.employees || [];
      const customers = custData.customers || [];
      document.getElementById("admDrawerTitle").textContent = workorder ? "Werkbon bewerken" : "Nieuwe werkbon";
      document.getElementById("admDrawerBody").innerHTML = `
<form id="woForm">
  <div class="adm-form-group"><label>Titel *</label>
    <input name="title" value="${esc(workorder?.title || "")}" required placeholder="Omschrijving van de opdracht">
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Medewerker</label>
      <select name="userId">
        <option value="">— Niet toegewezen —</option>
        ${employees.map(u => `<option value="${esc(u.id)}" ${workorder?.userId === u.id ? "selected" : ""}>${esc(u.name || u.email)}</option>`).join("")}
      </select>
    </div>
    <div class="adm-form-group"><label>Klant</label>
      <select name="customerId" id="woCustSel">
        <option value="">— Kies klant of typ vrij —</option>
        ${customers.map(c => `<option value="${c.id}" ${workorder?.customerId===c.id?"selected":""}>${esc(c.name)}</option>`).join("")}
      </select>
    </div>
  </div>
  <div class="adm-form-group" id="woClientNameWrap">
    <label>Klantnaam</label>
    <input name="clientName" id="woClientName" value="${esc(workorder?.clientName || "")}" placeholder="Of typ een klantnaam vrij">
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Gepland op</label>
      <input name="scheduledDate" type="date" value="${esc(workorder?.scheduledDate || "")}">
    </div>
    <div class="adm-form-group"><label>Prioriteit</label>
      <select name="priority">
        <option value="normaal" ${!workorder || workorder?.priority === "normaal" ? "selected" : ""}>Normaal</option>
        <option value="hoog" ${workorder?.priority === "hoog" ? "selected" : ""}>Hoog</option>
        <option value="laag" ${workorder?.priority === "laag" ? "selected" : ""}>Laag</option>
      </select>
    </div>
  </div>
  <div class="adm-form-group"><label>Status</label>
    <select name="status">
      <option value="open" ${!workorder || workorder?.status === "open" ? "selected" : ""}>Open</option>
      <option value="in_progress" ${workorder?.status === "in_progress" ? "selected" : ""}>In uitvoering</option>
      <option value="Voltooid" ${workorder?.status === "Voltooid" ? "selected" : ""}>Voltooid</option>
      <option value="Afgewerkt" ${workorder?.status === "Afgewerkt" ? "selected" : ""}>Afgewerkt</option>
      <option value="geannuleerd" ${workorder?.status === "geannuleerd" ? "selected" : ""}>Geannuleerd</option>
    </select>
  </div>
  <div class="adm-form-group"><label>Omschrijving</label>
    <textarea name="description" rows="3" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">${esc(workorder?.description || "")}</textarea>
  </div>
  <div class="adm-form-group"><label>Notities</label>
    <textarea name="notes" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">${esc(workorder?.notes || "")}</textarea>
  </div>
  <div style="background:#f8fafc;border-radius:8px;padding:12px;margin-bottom:8px;">
    <div style="font-weight:600;font-size:12px;color:#334155;margin-bottom:8px;">Facturatie</div>
    ${workorder?.clockedHours ? `<div style="font-size:12px;color:#0369a1;margin-bottom:8px;">⏱ ${workorder.clockedHours} u geklokt op deze werkbon${workorder?.billableHours==null?" — wordt overgenomen als factureerbare uren bij afronden":""}.</div>` : ""}
    <div class="adm-form-row">
      <div class="adm-form-group"><label>Factureerbare uren</label>
        <input name="billableHours" type="number" step="0.25" min="0" value="${workorder?.billableHours ?? ""}" placeholder="${workorder?.clockedHours ? workorder.clockedHours+" geklokt" : "bv. 8"}">
      </div>
      <div class="adm-form-group"><label>Uurtarief (€)</label>
        <input name="hourlyRate" type="number" step="1" min="0" value="${workorder?.hourlyRate ?? ""}" placeholder="standaardtarief">
      </div>
    </div>
    <div class="adm-form-group"><label>Vaste prijs (€) — overschrijft uren×tarief</label>
      <input name="fixedPrice" type="number" step="0.01" min="0" value="${workorder?.fixedPrice ?? ""}" placeholder="leeg = op uren factureren">
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
      <input type="checkbox" name="billable" ${workorder?.billable === false ? "" : "checked"} style="width:16px;height:16px;"> Factureerbaar
    </label>
  </div>
  ${workorder?.invoiceId ? `<div style="background:#d1fae5;border-radius:8px;padding:8px 12px;font-size:12px;color:#065f46;margin-bottom:8px;">🧾 Factuur aangemaakt</div>` : ""}
  <div id="woFormErr" style="display:none;background:#fef2f2;color:#dc2626;border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions" style="flex-wrap:wrap;gap:8px;">
    <button type="button" class="adm-btn adm-btn-secondary" id="woCancel">Annuleren</button>
    ${workorder ? `<button type="button" class="adm-btn adm-btn-danger" id="woDelete">🗑</button>` : ""}
    ${workorder ? `<button type="button" class="adm-btn adm-btn-secondary" id="woReport" title="Werkbon-rapport afdrukken">📄 Rapport</button>` : ""}
    ${workorder && ["Voltooid","Afgewerkt"].includes(workorder.status) && !workorder.invoiceId
      ? `<button type="button" class="adm-btn adm-btn-secondary" id="woMakeInvoice" style="color:#4f46e5;border-color:#c7d2fe;">🧾 Factuur aanmaken</button>`
      : ""}
    <button type="submit" class="adm-btn adm-btn-primary">${workorder ? "Opslaan" : "Aanmaken"}</button>
  </div>
</form>`;
      openDrawer();

      // Customer dropdown auto-fill
      document.getElementById("woCustSel")?.addEventListener("change", e => {
        const cust = customers.find(c => c.id === e.target.value);
        const nameInp = document.getElementById("woClientName");
        if (cust && nameInp) nameInp.value = cust.name;
      });

      document.getElementById("woCancel").addEventListener("click", closeDrawer);
      document.getElementById("woMakeInvoice")?.addEventListener("click", () => {
        closeDrawer();
        // Factuurregel afleiden uit de werkbon: vaste prijs, of geklokte/ingevoerde uren × tarief.
        const hrs = Number(workorder.billableHours || workorder.clockedHours || 0);
        const rate = Number(workorder.hourlyRate || 0);
        const line = workorder.fixedPrice != null
          ? { description: workorder.title, qty: 1, unitPrice: Number(workorder.fixedPrice), vatRate: 21 }
          : { description: `${workorder.title}${hrs ? ` (${hrs} u)` : ""}`, qty: hrs || 1, unitPrice: rate, vatRate: 21 };
        openFactuurDrawer(null, {
          prefillCustomerName: workorder.clientName || "",
          prefillLines: [line],
          prefillNotes: `Werkbon #${workorder.number || workorder.id.slice(-4)}`,
          workorderId: workorder.id
        });
      });
      document.getElementById("woReport")?.addEventListener("click", async () => {
        try { const r = await api("GET", `/documents/workorder/${workorder.id}/render`); const w = window.open("", "_blank"); w.document.write(r.html); w.document.close(); }
        catch (e) { window.showToast && window.showToast(e.message, "error"); }
      });
      document.getElementById("woDelete")?.addEventListener("click", async () => {
        if (!confirm(`Werkbon "${workorder.title}" verwijderen?`)) return;
        try {
          await api("DELETE", `/workorders/${workorder.id}`);
          closeDrawer(); renderWorkorders();
        } catch(err) {
          const errEl = document.getElementById("woFormErr");
          if (errEl) { errEl.textContent = err.message; errEl.style.display = "block"; }
        }
      });
      document.getElementById("woForm").addEventListener("submit", async e => {
        e.preventDefault();
        const errEl = document.getElementById("woFormErr");
        const body = Object.fromEntries(new FormData(e.target).entries());
        // Facturatie-velden naar de juiste types: checkbox → bool, bedragen → number/null.
        body.billable = e.target.querySelector('[name="billable"]').checked;
        ["billableHours", "hourlyRate", "fixedPrice"].forEach(k => {
          body[k] = body[k] === "" || body[k] == null ? null : Number(body[k]);
        });
        try {
          if (workorder) await api("PATCH", `/workorders/${workorder.id}`, body);
          else await api("POST", "/workorders", body);
          closeDrawer();
          renderWorkorders();
        } catch (err) {
          if (errEl) { errEl.textContent = err.message; errEl.style.display = "block"; }
          else window.showToast(err.message, "error");
        }
      });
    }).catch(err => window.showToast(err.message, "error"));
  }

  // ── Messages ───────────────────────────────────────────────
  let _msgVenueFilter = "";
  async function renderMessages() {
    const [data, vdata] = await Promise.all([
      api("GET", _msgVenueFilter ? `/messages?venueId=${encodeURIComponent(_msgVenueFilter)}` : "/messages"),
      api("GET", "/venues").catch(() => ({ venues: [] }))
    ]);
    const messages = data.messages || data || [];
    const venues = vdata.venues || vdata.rows || [];
    const venueName = id => (venues.find(v => v.id === id) || {}).name || (id ? "Werf" : "—");

    const toLabel = m => {
      if (m.recipientId) return `👤 Persoonlijk`;
      if (m.toRole === "all") return "📢 Alle medewerkers";
      if (m.toRole === "employee") return "👷 Medewerkers";
      if (m.toRole === "manager") return "👔 Managers";
      return "📢 Iedereen";
    };

    const content = document.getElementById("admContent");
    content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    <h3 class="adm-card-title">Berichten <span style="background:#e0f2fe;color:#0284c7;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${messages.length}</span></h3>
    <label style="font-size:12px;color:#475569;display:flex;align-items:center;gap:6px">Werf-chat:
      <select id="admMsgVenueFilter" class="adm-input" style="max-width:200px">
        <option value="">Alle berichten</option>
        ${venues.map(v => `<option value="${esc(v.id)}" ${_msgVenueFilter === v.id ? "selected" : ""}>${esc(v.name || v.id)}</option>`).join("")}
      </select>
    </label>
  </div>
  <div class="adm-card-body adm-table-wrap">
    <table class="adm-table">
      <thead><tr><th>Van</th><th>Aan</th><th>Werf</th><th>Onderwerp</th><th>Bericht</th><th>Datum</th><th>Acties</th></tr></thead>
      <tbody>
        ${messages.length ? messages.map(m => `
        <tr>
          <td>${esc(m.senderName||m.senderId||"Systeem")}</td>
          <td><span style="font-size:11px;background:#f1f5f9;border-radius:4px;padding:2px 6px;">${toLabel(m)}</span></td>
          <td>${m.venueId ? `<span style="font-size:11px;background:#fef3c7;color:#92400e;border-radius:4px;padding:2px 6px;">🏗 ${esc(venueName(m.venueId))}</span>` : '<span style="color:#cbd5e1">—</span>'}</td>
          <td style="font-weight:500;">${esc(m.subject||"—")}</td>
          <td style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#64748b;font-size:12px;" title="${esc(m.body||m.message||"")}">${esc(m.body||m.message||"—")}</td>
          <td style="white-space:nowrap;font-size:12px;color:#94a3b8;">${m.createdAt?.slice(0,16)||""}</td>
          <td>
            <button class="adm-btn adm-btn-secondary adm-btn-sm adm-msg-view" data-id="${esc(m.id)}" title="Bekijk bericht">👁</button>
            <button class="adm-btn adm-btn-danger adm-btn-sm adm-msg-del" data-id="${esc(m.id)}" title="Verwijder" style="margin-left:4px;">🗑</button>
          </td>
        </tr>`).join("") : `<tr><td colspan="7" class="adm-empty">${_msgVenueFilter ? "Nog geen berichten in deze werf-chat" : "Geen berichten"}</td></tr>`}
      </tbody>
    </table>
  </div>
</div>`;

    document.getElementById("admMsgVenueFilter")?.addEventListener("change", e => { _msgVenueFilter = e.target.value; renderMessages(); });

    content.querySelectorAll(".adm-msg-view").forEach(btn => {
      btn.addEventListener("click", () => {
        const msg = messages.find(m => m.id === btn.dataset.id);
        if (!msg) return;
        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;";
        overlay.innerHTML = `
<div style="background:#fff;border-radius:16px;width:100%;max-width:480px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2);">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
    <div>
      <div style="font-size:16px;font-weight:700;color:#0f172a;">${esc(msg.subject||"Bericht")}</div>
      <div style="font-size:12px;color:#64748b;margin-top:4px;">Van: <strong>${esc(msg.senderName||msg.senderId||"?")}</strong> · ${toLabel(msg)} · ${msg.createdAt?.slice(0,16)||""}</div>
    </div>
    <button id="msgViewClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8;padding:0;line-height:1;">×</button>
  </div>
  <div style="background:#f8fafc;border-radius:10px;padding:14px;font-size:14px;line-height:1.6;color:#374151;white-space:pre-wrap;">${esc(msg.body||msg.message||"")}</div>
  <div style="margin-top:16px;display:flex;justify-content:flex-end;">
    <button id="msgViewOk" class="adm-btn adm-btn-primary adm-btn-sm">Sluiten</button>
  </div>
</div>`;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        document.getElementById("msgViewClose").addEventListener("click", close);
        document.getElementById("msgViewOk").addEventListener("click", close);
        overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
      });
    });

    content.querySelectorAll(".adm-msg-del").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Bericht verwijderen?")) return;
        btn.disabled = true; btn.textContent = "…";
        try {
          await api("DELETE", `/messages/${btn.dataset.id}`);
          renderMessages();
        } catch(e) { window.showToast(e.message, "error"); btn.disabled = false; btn.textContent = "🗑"; }
      });
    });
  }

  function openMessageDrawer() {
    const employeesReady = _state.employees && _state.employees.length > 0
      ? Promise.resolve({ employees: _state.employees })
      : api("GET", "/employees");

    Promise.all([employeesReady, api("GET", "/venues").catch(() => ({ venues: [] }))]).then(([data, vdata]) => {
      const employees = data.employees || [];
      _state.employees = employees;
      const venues = vdata.venues || vdata.rows || [];
      const title = document.getElementById("admDrawerTitle");
      const body = document.getElementById("admDrawerBody");
      title.textContent = "Nieuw bericht";
      body.innerHTML = `
<form id="admMsgForm">
  <div class="adm-form-group"><label>Sturen naar</label>
    <select name="toMode" id="admMsgToMode" style="margin-bottom:8px;">
      <option value="all">📢 Alle medewerkers</option>
      <option value="role_employee">👷 Alleen medewerkers (rol: employee)</option>
      <option value="role_manager">👔 Alleen managers</option>
      <option value="person">👤 Specifieke persoon</option>
    </select>
    <select name="recipientId" id="admMsgRecipient" style="display:none;">
      <option value="">— Kies persoon —</option>
      ${employees.map(u => `<option value="${esc(u.id)}">${esc(u.name || u.email)} (${esc(u.role||"")})</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-group"><label>Werf (optioneel — voor werf-chat)</label>
    <select name="venueId" id="admMsgVenue">
      <option value="">— Algemeen (geen werf) —</option>
      ${venues.map(v => `<option value="${esc(v.id)}">${esc(v.name || v.id)}</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-group"><label>Onderwerp</label><input name="subject" required placeholder="Onderwerp van het bericht"></div>
  <div class="adm-form-group"><label>Bericht *</label><textarea name="body" rows="5" required placeholder="Schrijf hier je bericht…" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;resize:vertical;box-sizing:border-box;"></textarea></div>
  <div id="admMsgErr" style="display:none;color:#ef4444;font-size:12px;padding-bottom:4px;"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="admMsgCancel">Annuleren</button>
    <button type="submit" class="adm-btn adm-btn-primary">Verzenden</button>
  </div>
</form>`;
      openDrawer();
      document.getElementById("admMsgCancel").addEventListener("click", closeDrawer);

      // Show/hide person picker based on toMode
      document.getElementById("admMsgToMode").addEventListener("change", e => {
        document.getElementById("admMsgRecipient").style.display = e.target.value === "person" ? "" : "none";
      });

      document.getElementById("admMsgForm").addEventListener("submit", async e => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const toMode = fd.get("toMode");
        const errEl = document.getElementById("admMsgErr");
        errEl.style.display = "none";

        const body = {
          subject: fd.get("subject"),
          body: fd.get("body"),
          venueId: fd.get("venueId") || null
        };

        if (toMode === "person") {
          const rid = fd.get("recipientId");
          if (!rid) { errEl.textContent = "Kies een ontvanger."; errEl.style.display = ""; return; }
          body.recipientId = rid;
        } else if (toMode === "role_employee") {
          body.toRole = "employee";
          body.toName = "Alle medewerkers";
        } else if (toMode === "role_manager") {
          body.toRole = "manager";
          body.toName = "Alle managers";
        }
        // toMode === "all" → no recipientId/toRole → server broadcasts

        const submitBtn = e.target.querySelector("[type=submit]");
        submitBtn.disabled = true; submitBtn.textContent = "Verzenden…";
        try {
          await api("POST", "/messages", body);
          closeDrawer();
          window.showToast && window.showToast("Bericht verzonden ✓", "success");
          renderMessages();
        } catch (err) {
          errEl.textContent = err.message; errEl.style.display = "";
          submitBtn.disabled = false; submitBtn.textContent = "Verzenden";
        }
      });
    }).catch(err => window.showToast(err.message, "error"));
  }

  // ── Reports ────────────────────────────────────────────────
  async function renderReports() {
    const content = document.getElementById("admContent");

    // Periode-kiezer
    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);
    const firstOfMonth = thisMonth + "-01";
    const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

    content.innerHTML = `
<div class="adm-card" style="margin-bottom:16px;">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Rapportages</h3>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <input type="date" id="repFrom" value="${firstOfMonth}" style="padding:6px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
      <span style="font-size:13px;color:#94a3b8;">t/m</span>
      <input type="date" id="repTo" value="${lastOfMonth}" style="padding:6px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="repLoad">Laden</button>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repBeslissers" title="Printbaar beslissersrapport genereren">📊 Beslissersrapport</button>
    </div>
  </div>
</div>

<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px;" id="repKpis">
  <div class="adm-kpi adm-kpi-blue"><div class="adm-kpi-label">Totaal uren</div><div class="adm-kpi-value" id="repKpiHours">—</div><div class="adm-kpi-sub">Geregistreerd</div></div>
  <div class="adm-kpi adm-kpi-green"><div class="adm-kpi-label">Goedgekeurde onkosten</div><div class="adm-kpi-value" id="repKpiExpenses">—</div><div class="adm-kpi-sub">Totaal bedrag</div></div>
  <div class="adm-kpi adm-kpi-amber"><div class="adm-kpi-label">Verlofdagen</div><div class="adm-kpi-value" id="repKpiLeaves">—</div><div class="adm-kpi-sub">Goedgekeurd</div></div>
  <div class="adm-kpi adm-kpi-purple"><div class="adm-kpi-label">Werkbonnen voltooid</div><div class="adm-kpi-value" id="repKpiWO">—</div><div class="adm-kpi-sub">In periode</div></div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
  <!-- Uren per medewerker -->
  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">Uren per medewerker</h3>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repExportClocks">CSV export</button>
    </div>
    <div class="adm-card-body adm-table-wrap" id="repClocksTable">
      <div class="adm-loading">Klik op Laden…</div>
    </div>
  </div>

  <!-- Onkosten overzicht -->
  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">Onkosten overzicht</h3>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repExportExpenses">CSV export</button>
    </div>
    <div class="adm-card-body adm-table-wrap" id="repExpensesTable">
      <div class="adm-loading">Klik op Laden…</div>
    </div>
  </div>

  <!-- Verlof overzicht -->
  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">Verlof overzicht</h3>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repExportLeaves">CSV export</button>
    </div>
    <div class="adm-card-body adm-table-wrap" id="repLeavesTable">
      <div class="adm-loading">Klik op Laden…</div>
    </div>
  </div>

  <!-- Werkbonnen status -->
  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">Werkbonnen status</h3>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repExportWO">CSV export</button>
    </div>
    <div class="adm-card-body adm-table-wrap" id="repWOTable">
      <div class="adm-loading">Klik op Laden…</div>
    </div>
  </div>
</div>

<!-- Loonlijst -->
<div class="adm-card" style="margin-top:16px;">
  <div class="adm-card-header">
    <h3 class="adm-card-title">🧾 Loonlijst overzicht</h3>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repExportPayroll">📥 Export CSV</button>
  </div>
  <div class="adm-card-body adm-table-wrap" id="repPayrollTable">
    <div class="adm-loading">Klik op Laden…</div>
  </div>
</div>`;

    // Cache data voor CSV export
    let _repData = { clocks: [], expenses: [], leaves: [], workorders: [] };

    async function loadReportData() {
      const from = document.getElementById("repFrom").value;
      const to   = document.getElementById("repTo").value;
      if (!from || !to) return;

      try {
        const [clocksRes, expensesRes, leavesRes, woRes] = await Promise.all([
          api("GET", `/clocks?from=${from}&to=${to}`),
          api("GET", `/expenses`),
          api("GET", `/leaves?from=${from}&to=${to}`),
          api("GET", `/workorders`)
        ]);

        const clocks    = clocksRes.clocks || [];
        const expenses  = (expensesRes.expenses || []).filter(e => e.date >= from && e.date <= to);
        const leaves    = leavesRes.leaves || [];
        const workorders = (woRes.workorders || []).filter(w =>
          (w.scheduledDate || w.createdAt?.slice(0,10) || "") >= from &&
          (w.scheduledDate || w.createdAt?.slice(0,10) || "") <= to
        );
        _repData = { clocks, expenses, leaves, workorders };

        // ── KPIs ─────────────────────────────────────────────
        const totalHours = clocks.reduce((sum, c) => {
          if (!c.clockedOut) return sum;
          return sum + (new Date(c.clockedOut) - new Date(c.clockedIn)) / 3600000;
        }, 0);
        const approvedExpenses = expenses.filter(e => ["goedgekeurd","approved"].includes(e.status));
        const totalExp = approvedExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
        const approvedLeaves = leaves.filter(l => l.status === "goedgekeurd");
        const leaveDays = approvedLeaves.reduce((s, l) => {
          if (!l.startDate || !l.endDate) return s;
          const diff = (new Date(l.endDate) - new Date(l.startDate)) / 86400000 + 1;
          return s + diff;
        }, 0);
        const completedWO = workorders.filter(w => ["Voltooid","Afgewerkt"].includes(w.status)).length;

        document.getElementById("repKpiHours").textContent = totalHours.toFixed(1) + " u";
        document.getElementById("repKpiExpenses").textContent = "€" + totalExp.toFixed(0);
        document.getElementById("repKpiLeaves").textContent = leaveDays + " d";
        document.getElementById("repKpiWO").textContent = completedWO;

        // ── Uren per medewerker ───────────────────────────────
        const hoursByUser = {};
        clocks.forEach(c => {
          if (!hoursByUser[c.userId]) hoursByUser[c.userId] = { name: c.userName || c.userId, hours: 0, days: new Set() };
          if (c.clockedOut) {
            hoursByUser[c.userId].hours += (new Date(c.clockedOut) - new Date(c.clockedIn)) / 3600000;
            hoursByUser[c.userId].days.add(c.clockedIn?.slice(0,10));
          }
        });
        const hourRows = Object.values(hoursByUser).sort((a,b) => b.hours - a.hours);
        const maxHours = hourRows[0]?.hours || 1;
        const BAR_COLORS = ["#6366f1","#0ea5e9","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#84cc16"];
        document.getElementById("repClocksTable").innerHTML = hourRows.length
          ? `<div style="padding:8px 0;">${hourRows.map((r,i) => `
            <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f8fafc;">
              <div style="width:110px;font-size:12px;font-weight:500;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(r.name)}">${esc(r.name)}</div>
              <div style="flex:1;background:#f1f5f9;border-radius:4px;height:18px;overflow:hidden;">
                <div style="width:${(r.hours/maxHours*100).toFixed(1)}%;background:${BAR_COLORS[i%BAR_COLORS.length]};height:100%;border-radius:4px;transition:width .4s;"></div>
              </div>
              <div style="width:52px;font-size:12px;font-weight:600;color:#0f172a;text-align:right;">${r.hours.toFixed(1)} u</div>
              <div style="width:40px;font-size:11px;color:#94a3b8;text-align:right;">${r.days.size}d</div>
            </div>`).join("")}
            </div>
            <div style="font-size:11px;color:#94a3b8;margin-top:6px;text-align:right">Totaal: ${totalHours.toFixed(1)} u · ${hourRows.length} medewerkers</div>`
          : '<div class="adm-empty">Geen kloktijden in deze periode</div>';

        // ── Onkosten ──────────────────────────────────────────
        document.getElementById("repExpensesTable").innerHTML = expenses.length
          ? `<table class="adm-table"><thead><tr><th>Medewerker</th><th>Datum</th><th>Categorie</th><th>Bedrag</th><th>Status</th></tr></thead><tbody>
             ${expenses.map(e => `<tr><td>${esc(e.userName||e.userId)}</td><td>${esc(e.date)}</td><td>${esc(e.category||"—")}</td><td>€${Number(e.amount||0).toFixed(2)}</td><td><span class="adm-status adm-status-${esc(e.status)}">${esc(e.status)}</span></td></tr>`).join("")}
             </tbody></table>`
          : '<div class="adm-empty">Geen onkosten in deze periode</div>';

        // ── Verlof ────────────────────────────────────────────
        document.getElementById("repLeavesTable").innerHTML = leaves.length
          ? `<table class="adm-table"><thead><tr><th>Medewerker</th><th>Type</th><th>Van</th><th>Tot</th><th>Status</th></tr></thead><tbody>
             ${leaves.map(l => `<tr><td>${esc(l.userName||l.userId)}</td><td>${esc(l.type||"—")}</td><td>${esc(l.startDate)}</td><td>${esc(l.endDate)}</td><td><span class="adm-status adm-status-${esc(l.status)}">${esc(l.status)}</span></td></tr>`).join("")}
             </tbody></table>`
          : '<div class="adm-empty">Geen verlof in deze periode</div>';

        // ── Werkbonnen ────────────────────────────────────────
        const woByStatus = {};
        workorders.forEach(w => { woByStatus[w.status||"Onbekend"] = (woByStatus[w.status||"Onbekend"]||0)+1; });
        const woStatusColors = { open:"#3b82f6", in_progress:"#f59e0b", Voltooid:"#10b981", Afgewerkt:"#10b981", geannuleerd:"#ef4444" };
        const woTotal = workorders.length;
        document.getElementById("repWOTable").innerHTML = workorders.length
          ? `<div style="padding:8px 0;">
              <div style="display:flex;height:20px;border-radius:6px;overflow:hidden;margin-bottom:14px;">
                ${Object.entries(woByStatus).map(([s,n]) => `<div style="flex:${n};background:${woStatusColors[s]||"#94a3b8"};transition:flex .4s;" title="${s}: ${n}"></div>`).join("")}
              </div>
              ${Object.entries(woByStatus).map(([s,n]) => `
              <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #f8fafc;">
                <div style="width:10px;height:10px;border-radius:50%;background:${woStatusColors[s]||"#94a3b8"};flex-shrink:0;"></div>
                <div style="font-size:13px;color:#374151;flex:1;">${s}</div>
                <div style="font-size:13px;font-weight:700;color:#0f172a;">${n}</div>
                <div style="font-size:11px;color:#94a3b8;width:36px;text-align:right;">${(n/woTotal*100).toFixed(0)}%</div>
              </div>`).join("")}
              <div style="font-size:11px;color:#94a3b8;margin-top:6px;text-align:right">Totaal: ${woTotal} werkbonnen</div>
            </div>`
          : '<div class="adm-empty">Geen werkbonnen in deze periode</div>';

        // ── Loonlijst ─────────────────────────────────────────
        const payrollByUser = {};
        clocks.forEach(c => {
          if (!payrollByUser[c.userId]) payrollByUser[c.userId] = { name: c.userName||c.userId, email: c.userEmail||"", hours: 0, days: new Set(), expAmt: 0, leaveDays: 0 };
          if (c.clockedOut) {
            payrollByUser[c.userId].hours += (new Date(c.clockedOut)-new Date(c.clockedIn))/3600000;
            payrollByUser[c.userId].days.add(c.clockedIn?.slice(0,10));
          }
        });
        expenses.filter(e => ["goedgekeurd","approved"].includes(e.status)).forEach(e => {
          if (!payrollByUser[e.userId]) payrollByUser[e.userId] = { name: e.userName||e.userId, email: "", hours: 0, days: new Set(), expAmt: 0, leaveDays: 0 };
          payrollByUser[e.userId].expAmt += Number(e.amount||0);
        });
        leaves.filter(l => l.status === "goedgekeurd").forEach(l => {
          if (!payrollByUser[l.userId]) payrollByUser[l.userId] = { name: l.userName||l.userId, email: "", hours: 0, days: new Set(), expAmt: 0, leaveDays: 0 };
          const ld = l.startDate && l.endDate ? Math.round((new Date(l.endDate)-new Date(l.startDate))/86400000)+1 : Number(l.days||0);
          payrollByUser[l.userId].leaveDays += ld;
        });
        const payrollRows = Object.values(payrollByUser).sort((a,b)=>a.name.localeCompare(b.name));
        _repData.payroll = payrollRows;
        const payrollTbl = document.getElementById("repPayrollTable");
        if (payrollTbl) {
          if (!payrollRows.length) {
            payrollTbl.innerHTML = '<div class="adm-empty">Geen data voor loonlijst in deze periode</div>';
          } else {
            const totH = payrollRows.reduce((s,r)=>s+r.hours,0);
            const totE = payrollRows.reduce((s,r)=>s+r.expAmt,0);
            const totL = payrollRows.reduce((s,r)=>s+r.leaveDays,0);
            payrollTbl.innerHTML = `
<table class="adm-table">
  <thead>
    <tr style="background:#f8fafc;">
      <th>Medewerker</th>
      <th style="text-align:right">Gewerkte dagen</th>
      <th style="text-align:right">Gewerkte uren</th>
      <th style="text-align:right">Gem. uur/dag</th>
      <th style="text-align:right">Verlof (d)</th>
      <th style="text-align:right">Onkosten (€)</th>
    </tr>
  </thead>
  <tbody>
    ${payrollRows.map(r => `<tr>
      <td><strong>${esc(r.name)}</strong></td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${r.days.size}</td>
      <td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${r.hours.toFixed(2)}</td>
      <td style="text-align:right;color:#64748b;">${r.days.size ? (r.hours/r.days.size).toFixed(2) : "—"}</td>
      <td style="text-align:right;">${r.leaveDays||"—"}</td>
      <td style="text-align:right;font-weight:600;">€${r.expAmt.toFixed(2)}</td>
    </tr>`).join("")}
  </tbody>
  <tfoot>
    <tr style="background:#f1f5f9;font-weight:700;border-top:2px solid #e2e8f0;">
      <td>Totaal (${payrollRows.length} medewerkers)</td>
      <td style="text-align:right;">—</td>
      <td style="text-align:right;">${totH.toFixed(2)} u</td>
      <td style="text-align:right;">—</td>
      <td style="text-align:right;">${totL} d</td>
      <td style="text-align:right;">€${totE.toFixed(2)}</td>
    </tr>
  </tfoot>
</table>`;
          }
        }

      } catch (err) {
        document.getElementById("repClocksTable").innerHTML = `<div class="adm-empty" style="color:#ef4444;">Fout: ${err.message}</div>`;
      }
    }

    function csvDownload(filename, rows, headers) {
      const lines = [headers.join(";"), ...rows.map(r => r.map(v => `"${String(v||"").replace(/"/g,'""')}"`).join(";"))];
      const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
    }

    document.getElementById("repLoad").addEventListener("click", loadReportData);
    document.getElementById("repExportClocks").addEventListener("click", () => {
      const rows = (_repData.clocks||[]).map(c => {
        const h = c.clockedOut ? ((new Date(c.clockedOut)-new Date(c.clockedIn))/3600000).toFixed(2) : "";
        return [c.userName||c.userId, c.clockedIn?.slice(0,10), c.clockedIn?.slice(11,16)||"", c.clockedOut?.slice(11,16)||"", h];
      });
      csvDownload("uren-export.csv", rows, ["Medewerker","Datum","Inkloktijd","Uitkloktijd","Uren"]);
    });
    document.getElementById("repExportExpenses").addEventListener("click", () => {
      const rows = (_repData.expenses||[]).map(e => [e.userName||e.userId, e.date, e.category||"", e.description||"", e.amount||0, e.status]);
      csvDownload("onkosten-export.csv", rows, ["Medewerker","Datum","Categorie","Omschrijving","Bedrag","Status"]);
    });
    document.getElementById("repExportLeaves").addEventListener("click", () => {
      const rows = (_repData.leaves||[]).map(l => [l.userName||l.userId, l.type||"", l.startDate, l.endDate, l.reason||"", l.status]);
      csvDownload("verlof-export.csv", rows, ["Medewerker","Type","Van","Tot","Reden","Status"]);
    });
    document.getElementById("repExportWO").addEventListener("click", () => {
      const rows = (_repData.workorders||[]).map(w => [w.number||w.id.slice(-4), w.title||"", w.userName||w.userId||"", w.status||"", w.scheduledDate||w.createdAt?.slice(0,10)||""]);
      csvDownload("werkbonnen-export.csv", rows, ["#","Titel","Medewerker","Status","Datum"]);
    });
    document.getElementById("repExportPayroll").addEventListener("click", () => {
      const from = document.getElementById("repFrom").value;
      const to   = document.getElementById("repTo").value;
      const rows = (_repData.payroll||[]).map(r => [r.name, r.days.size, r.hours.toFixed(2), r.days.size?(r.hours/r.days.size).toFixed(2):"0", r.leaveDays, r.expAmt.toFixed(2)]);
      csvDownload(`loonlijst-${from}-${to}.csv`, rows, ["Medewerker","Gewerkte dagen","Gewerkte uren","Gem uur/dag","Verlof (d)","Onkosten (EUR)"]);
    });

    // Beslissersrapport
    document.getElementById("repBeslissers")?.addEventListener("click", async () => {
      const from = document.getElementById("repFrom").value;
      const to   = document.getElementById("repTo").value;
      let tenant = {};
      try { const t = await api("GET", "/settings"); tenant = t.tenant || {}; } catch(_){}
      // Log for pilot KPI tracking
      api("POST", "/reports/log", { type: "beslissersrapport" }).catch(()=>{});
      printBeslissersrapport(_repData, tenant, from, to);
    });

    // Direct laden
    loadReportData();
  }

  function printBeslissersrapport(data, tenant, from, to) {
    const fE = n => new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(Number(n||0));
    const clocks = data.clocks||[], expenses=data.expenses||[], leaves=data.leaves||[], workorders=data.workorders||[], payroll=data.payroll||[];
    const totalH = clocks.reduce((s,c)=>s+(c.clockedOut?(new Date(c.clockedOut)-new Date(c.clockedIn))/3600000:0),0);
    const approvedExp = expenses.filter(e=>["goedgekeurd","approved"].includes(e.status));
    const totalExp = approvedExp.reduce((s,e)=>s+Number(e.amount||0),0);
    const doneWO = workorders.filter(w=>["Voltooid","Afgewerkt","done"].includes(w.status)).length;
    const completionRate = workorders.length ? Math.round(doneWO/workorders.length*100) : 0;
    const approvedLeaves = leaves.filter(l=>l.status==="goedgekeurd").length;
    const win = window.open("","_blank");
    win.document.write(`<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><title>Beslissersrapport</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1e293b;background:#fff;padding:32px 40px}
.page{max-width:800px;margin:0 auto}.header{border-bottom:3px solid #4f46e5;padding-bottom:16px;margin-bottom:28px;display:flex;justify-content:space-between;align-items:flex-end}
.title{font-size:24px;font-weight:700;color:#4f46e5}.subtitle{font-size:13px;color:#64748b;margin-top:4px}.period{font-size:13px;color:#64748b}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:28px}
.kpi{background:#f8fafc;border-radius:10px;padding:16px;text-align:center;border:1px solid #e2e8f0}
.kpi-val{font-size:26px;font-weight:700;color:#0f172a;margin-bottom:4px}.kpi-lbl{font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px}
.section-title{font-size:15px;font-weight:700;color:#0f172a;margin:20px 0 10px;padding-bottom:6px;border-bottom:1px solid #e2e8f0}
table{width:100%;border-collapse:collapse;margin-bottom:20px}
th{background:#f1f5f9;padding:7px 10px;text-align:left;font-size:11px;font-weight:700;color:#374151;border-bottom:2px solid #e2e8f0}
td{padding:7px 10px;border-bottom:1px solid #f1f5f9;font-size:12px}
.green{color:#10b981;font-weight:600}.amber{color:#f59e0b;font-weight:600}.red{color:#ef4444;font-weight:600}
.recommendation{background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;margin-top:24px}
.rec-title{font-size:15px;font-weight:700;color:#1d4ed8;margin-bottom:8px}
.footer{margin-top:32px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px}
@media print{body{padding:0}@page{margin:15mm}}
</style></head><body><div class="page">
<div class="header">
  <div><div class="title">Beslissersrapport</div><div class="subtitle">${esc(tenant.name||"Monargo One")} · ${esc(tenant.vatNumber||"")}</div></div>
  <div class="period">Periode: ${from} t/m ${to}<br>Gegenereerd: ${new Date().toLocaleDateString("nl-BE")}</div>
</div>
<div class="kpis">
  <div class="kpi"><div class="kpi-val">${totalH.toFixed(0)}</div><div class="kpi-lbl">Uren geregistreerd</div></div>
  <div class="kpi"><div class="kpi-val">${workorders.length}</div><div class="kpi-lbl">Werkbonnen totaal</div></div>
  <div class="kpi"><div class="kpi-val ${completionRate>=80?"green":completionRate>=50?"amber":"red"}">${completionRate}%</div><div class="kpi-lbl">Afwerkingsrate</div></div>
  <div class="kpi"><div class="kpi-val">${fE(totalExp)}</div><div class="kpi-lbl">Onkosten goedgekeurd</div></div>
</div>
<div class="section-title">Personeelsinzet</div>
<table><thead><tr><th>Medewerker</th><th>Gewerkte dagen</th><th>Totaal uren</th><th>Gem. uur/dag</th><th>Verlof (d)</th><th>Onkosten</th></tr></thead>
<tbody>${payroll.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.days.size}</td><td class="${r.hours>0?"green":"red"}">${r.hours.toFixed(1)} u</td><td>${r.days.size?(r.hours/r.days.size).toFixed(1):"—"}</td><td>${r.leaveDays||0}</td><td>${fE(r.expAmt)}</td></tr>`).join("")||"<tr><td colspan='6'>Geen data</td></tr>"}</tbody>
<tfoot><tr style="font-weight:700;background:#f8fafc"><td>Totaal</td><td>—</td><td>${totalH.toFixed(1)} u</td><td>—</td><td>${payroll.reduce((s,r)=>s+r.leaveDays,0)}</td><td>${fE(totalExp)}</td></tr></tfoot>
</table>
<div class="section-title">Werkbonnenstatus</div>
<table><thead><tr><th>Status</th><th>Aantal</th><th>%</th></tr></thead>
<tbody>${Object.entries(workorders.reduce((a,w)=>{a[w.status||"?"]=(a[w.status||"?"]||0)+1;return a},{})).map(([s,n])=>`<tr><td>${esc(s)}</td><td>${n}</td><td>${workorders.length?(n/workorders.length*100).toFixed(0):0}%</td></tr>`).join("")||"<tr><td colspan='3'>Geen werkbonnen</td></tr>"}</tbody>
</table>
<div class="recommendation">
  <div class="rec-title">🎯 Pilotevaluatie</div>
  <p style="font-size:13px;color:#1e40af;line-height:1.6;">
    In de periode ${from} t/m ${to} werden <strong>${workorders.length} werkbonnen</strong> aangemaakt met een afwerkingsrate van <strong>${completionRate}%</strong>.
    Het team presteerde <strong>${totalH.toFixed(0)} uur</strong> op ${payroll.length} medewerkers.
    ${completionRate >= 70 ? `De pilot toont <strong>positieve resultaten</strong>: hoge afwerkingsrate en actief gebruik van het systeem.` :
      `Er is ruimte voor verbetering in de afwerkingsrate. Overweeg begeleiding bij de workflow.`}
    De goedgekeurde onkosten bedragen ${fE(totalExp)}.
  </p>
</div>
<div class="footer">${esc(tenant.name||"")} · Gegenereerd met Monargo One · ${new Date().toLocaleString("nl-BE")}</div>
</div><script>window.onload=()=>{window.print()}</script></body></html>`);
    win.document.close();
  }

  // ── Audit trail ────────────────────────────────────────────
  async function renderAudit() {
    const content = document.getElementById("admContent");
    const todayStr = new Date().toISOString().slice(0,10);
    const weekAgoStr = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
    content.innerHTML = `
<div class="adm-card" style="margin-bottom:16px;">
  <div class="adm-card-header" style="flex-wrap:wrap;gap:8px;">
    <h3 class="adm-card-title">Audittrail</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <input placeholder="Actor (e-mail)" id="auditActor" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;width:160px;">
      <select id="auditArea" style="padding:6px 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
        <option value="">Alle gebieden</option>
        <option value="auth">Auth</option>
        <option value="employees">Medewerkers</option>
        <option value="leaves">Verlof</option>
        <option value="expenses">Onkosten</option>
        <option value="workorders">Werkbonnen</option>
        <option value="planning">Planning</option>
        <option value="clocking">Prikklok</option>
        <option value="messages">Berichten</option>
        <option value="vehicles">Voertuigen</option>
        <option value="stock">Stock</option>
        <option value="settings">Instellingen</option>
      </select>
      <input type="date" id="auditFrom" value="${weekAgoStr}" style="padding:6px 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
      <span style="font-size:12px;color:#94a3b8;">t/m</span>
      <input type="date" id="auditTo" value="${todayStr}" style="padding:6px 8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
      <input type="number" placeholder="Max" id="auditLimit" value="200" min="10" max="1000" style="padding:6px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;width:70px;">
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="auditLoad">↻ Laden</button>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="auditExport">⬇ CSV</button>
    </div>
  </div>
</div>
<div id="auditSummary" style="display:none;background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#0369a1;"></div>
<div class="adm-card">
  <div class="adm-card-body adm-table-wrap" id="auditTable">
    <div class="adm-loading">Laden…</div>
  </div>
</div>`;

    let _auditRows = [];

    async function loadAudit() {
      const actor = document.getElementById("auditActor").value.trim();
      const area  = document.getElementById("auditArea").value;
      const from  = document.getElementById("auditFrom").value;
      const to    = document.getElementById("auditTo").value;
      const limit = document.getElementById("auditLimit").value || 200;
      const tableEl = document.getElementById("auditTable");
      const summaryEl = document.getElementById("auditSummary");
      tableEl.innerHTML = '<div class="adm-loading">Laden…</div>';
      summaryEl.style.display = "none";
      try {
        let qs = `?limit=${limit}&tenantId=${tenantId()}`;
        if (actor) qs += `&actor=${encodeURIComponent(actor)}`;
        if (area)  qs += `&area=${encodeURIComponent(area)}`;
        if (from)  qs += `&from=${encodeURIComponent(from)}`;
        if (to)    qs += `&to=${encodeURIComponent(to + "T23:59:59")}`;
        const data = await api("GET", `/audit${qs}`);
        _auditRows = data.rows || [];
        // Summary bar
        if (_auditRows.length) {
          const actors = new Set(_auditRows.map(r => r.actor)).size;
          const areas  = new Set(_auditRows.filter(r=>r.area).map(r => r.area)).size;
          const fails  = _auditRows.filter(r => r.action?.includes("fail") || r.action?.includes("lock") || r.action?.includes("denied")).length;
          summaryEl.innerHTML = `📊 <strong>${_auditRows.length}</strong> events &nbsp;·&nbsp; <strong>${actors}</strong> actoren &nbsp;·&nbsp; <strong>${areas}</strong> gebieden${fails ? ` &nbsp;·&nbsp; <span style="color:#dc2626;font-weight:600;">⚠ ${fails} fouten/weigeringen</span>` : ""}`;
          summaryEl.style.display = "block";
        }
        renderAuditTable(_auditRows);
      } catch (err) {
        tableEl.innerHTML = `<div class="adm-empty" style="color:#ef4444;">Fout: ${err.message}</div>`;
      }
    }

    function renderAuditTable(rows) {
      if (!rows.length) {
        document.getElementById("auditTable").innerHTML = '<div class="adm-empty"><div class="adm-empty-icon">📋</div><div class="adm-empty-text">Geen audit-events gevonden</div></div>';
        return;
      }
      document.getElementById("auditTable").innerHTML = `
      <table class="adm-table">
        <thead><tr><th>Tijdstip</th><th>Actor</th><th>Actie</th><th>Gebied</th><th>Detail</th></tr></thead>
        <tbody>
          ${rows.map(r => `
          <tr>
            <td style="white-space:nowrap;font-size:12px;">${r.at ? new Date(r.at).toLocaleString("nl-BE",{dateStyle:"short",timeStyle:"short"}) : "—"}</td>
            <td style="font-size:12px;">${r.actor||"systeem"}</td>
            <td><span class="adm-status ${r.action?.includes("fail")||r.action?.includes("lock")||r.action?.includes("denied") ? "adm-status-inactive" : "adm-status-active"}">${r.action||"—"}</span></td>
            <td style="font-size:12px;">${r.area||"—"}</td>
            <td style="font-size:12px;color:#64748b;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.detail||""}">${r.detail||"—"}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;
    }

    document.getElementById("auditLoad").addEventListener("click", loadAudit);
    document.getElementById("auditExport").addEventListener("click", () => {
      const lines = ["Tijdstip;Actor;Actie;Gebied;Detail",
        ..._auditRows.map(r => [r.at||"",r.actor||"",r.action||"",r.area||"",r.detail||""].map(v=>`"${v}"`).join(";"))
      ];
      const blob = new Blob(["﻿"+lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "audit-export.csv"; a.click();
    });

    // Audit endpoint zit op /api/audit (niet tenant-scoped), speciale behandeling
    document.getElementById("auditLoad").click();
  }

  // ── Klanten ────────────────────────────────────────────────
  async function renderCustomers() {
    const content = document.getElementById("admContent");
    try {
      const data = await api("GET", "/customers");
      const rows = data.customers || data.rows || [];
      content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Klanten <span style="background:#e0e7ff;color:#4f46e5;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${rows.length}</span></h3>
    <input id="custSearch" placeholder="Zoek naam, e-mail…" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;min-width:200px;">
  </div>
  ${rows.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-icon">🏢</div><div class="adm-empty-text">Nog geen klanten</div><button class="adm-btn adm-btn-primary adm-btn-sm" id="admEmptyNewCust" style="margin-top:12px">+ Eerste klant aanmaken</button></div>`
    : `<div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>Naam</th><th>Contactpersoon</th><th>E-mail</th><th>Telefoon</th><th>BTW-nr</th><th>Acties</th></tr></thead>
        <tbody id="custTbody">${buildCustRows(rows)}</tbody>
      </table></div>`}
</div>`;
      function wireCustButtons() {
        document.querySelectorAll(".cust-view").forEach(b => b.addEventListener("click", () => renderCustomerDetail(b.dataset.id)));
        document.querySelectorAll(".cust-edit").forEach(b => b.addEventListener("click", () => openCustomerDrawer(rows.find(x => x.id === b.dataset.id))));
        document.querySelectorAll(".cust-detail-row").forEach(row => row.addEventListener("click", e => {
          if (e.target.closest("button") || e.target.closest("a")) return;
          renderCustomerDetail(row.dataset.id);
        }));
      }
      document.getElementById("custSearch")?.addEventListener("input", e => {
        const q = e.target.value.toLowerCase();
        const tb = document.getElementById("custTbody");
        if (tb) tb.innerHTML = buildCustRows(rows.filter(r => `${r.name} ${r.contactName||""} ${r.email||""} ${r.phone||""}`.toLowerCase().includes(q)));
        wireCustButtons();
      });
      wireCustButtons();
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:#dc2626">Fout: ${e.message}</div>`; }
  }
  function buildCustRows(rows) {
    return rows.map(c => `<tr style="cursor:pointer;" class="cust-detail-row" data-id="${c.id}">
      <td><strong>${esc(c.name)}</strong></td>
      <td>${esc(c.contactName||"—")}</td>
      <td><a href="mailto:${esc(c.email||"")}" style="color:#4f46e5">${esc(c.email||"—")}</a></td>
      <td>${esc(c.phone||"—")}</td>
      <td style="font-family:monospace;font-size:12px">${esc(c.vatNumber||"—")}</td>
      <td style="white-space:nowrap">
        <button class="adm-btn adm-btn-primary adm-btn-sm cust-view" data-id="${c.id}">🔍 Detail</button>
        <button class="adm-btn adm-btn-secondary adm-btn-sm cust-edit" data-id="${c.id}">✏</button>
      </td>
    </tr>`).join("");
  }

  async function renderCustomerDetail(customerId) {
    const content = document.getElementById("admContent");
    content.innerHTML = `<div class="adm-loading">Laden…</div>`;
    try {
      const [custData, woData, invData] = await Promise.all([
        api("GET", "/customers"),
        api("GET", "/workorders").catch(() => ({ workorders: [] })),
        api("GET", "/facturen").catch(() => ({ invoices: [] }))
      ]);
      const customer  = (custData.customers || []).find(c => c.id === customerId);
      if (!customer) { content.innerHTML = `<div class="adm-empty">Klant niet gevonden</div>`; return; }

      const custWOs   = (woData.workorders || []).filter(w => w.customerId === customerId || w.clientName === customer.name);
      const custInvs  = (invData.invoices || []).filter(i => i.customerId === customerId || i.customerName === customer.name);
      const fmtEurCD  = n => new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(Number(n||0));
      const openInvAmt = custInvs.filter(i => ["open","overdue"].includes(i.status)).reduce((s,i) => s+Number(i.total||0),0);
      const paidInvAmt = custInvs.filter(i => i.status === "paid").reduce((s,i) => s+Number(i.total||0),0);

      let _custTab = "werkbonnen";

      function renderTabs() {
        content.querySelector("#custDetailTabs")?.querySelectorAll(".cdt-tab").forEach(t => {
          t.style.fontWeight = t.dataset.tab === _custTab ? "700" : "400";
          t.style.borderBottom = t.dataset.tab === _custTab ? "2px solid #6366f1" : "2px solid transparent";
        });
        const body = content.querySelector("#custDetailBody");
        if (!body) return;
        if (_custTab === "werkbonnen") {
          body.innerHTML = custWOs.length ? `<table class="adm-table">
            <thead><tr><th>#</th><th>Titel</th><th>Medewerker</th><th>Status</th><th>Datum</th><th>Acties</th></tr></thead>
            <tbody>${custWOs.map(w => `<tr>
              <td style="font-family:monospace">${w.number||w.id.slice(-4)}</td>
              <td>${esc(w.title||"—")}</td>
              <td>${esc(w.userName||w.userId||"—")}</td>
              <td><span class="adm-status adm-status-${(w.status||"").toLowerCase().replace(/\s/g,"-")}">${esc(w.status||"—")}</span></td>
              <td>${w.scheduledDate||w.createdAt?.slice(0,10)||"—"}</td>
              <td><button class="adm-btn adm-btn-secondary adm-btn-sm wo-from-cust" data-id="${w.id}">✏ Bewerk</button></td>
            </tr>`).join("")}</tbody>
          </table>` : `<div class="adm-empty"><div class="adm-empty-icon">📋</div><div class="adm-empty-text">Geen werkbonnen voor deze klant</div></div>`;
          body.querySelectorAll(".wo-from-cust").forEach(btn => {
            btn.addEventListener("click", () => openWorkorderDrawer(custWOs.find(w => w.id === btn.dataset.id)));
          });
        } else {
          body.innerHTML = custInvs.length ? `<table class="adm-table">
            <thead><tr><th>Nr.</th><th>Datum</th><th>Vervaldatum</th><th>Bedrag</th><th>Status</th><th>Acties</th></tr></thead>
            <tbody>${custInvs.map(inv => {
              const st = INV_STATUS[inv.status]||{label:inv.status,css:"adm-status-pending"};
              return `<tr>
                <td style="font-family:monospace;font-weight:600">${esc(inv.number||"—")}</td>
                <td>${inv.invoiceDate?new Date(inv.invoiceDate).toLocaleDateString("nl-BE"):"—"}</td>
                <td>${inv.dueDate?new Date(inv.dueDate).toLocaleDateString("nl-BE"):"—"}</td>
                <td style="font-weight:600">${fmtEurCD(inv.total)}</td>
                <td><span class="adm-status ${st.css}">${st.label}</span></td>
                <td style="display:flex;gap:4px;">
                  <button class="adm-btn adm-btn-secondary adm-btn-sm inv-from-cust" data-id="${inv.id}">✏</button>
                  ${["open","overdue"].includes(inv.status)?`<button class="adm-btn adm-btn-success adm-btn-sm inv-paid-cust" data-id="${inv.id}">✓ Betaald</button>`:""}
                </td>
              </tr>`;
            }).join("")}</tbody>
          </table>` : `<div class="adm-empty"><div class="adm-empty-icon">🧾</div><div class="adm-empty-text">Geen facturen voor deze klant</div></div>`;
          body.querySelectorAll(".inv-from-cust").forEach(btn => {
            btn.addEventListener("click", () => openFactuurDrawer(custInvs.find(i => i.id === btn.dataset.id)));
          });
          body.querySelectorAll(".inv-paid-cust").forEach(btn => {
            btn.addEventListener("click", async () => {
              if (!confirm("Factuur als betaald markeren?")) return;
              await api("PATCH", `/facturen/${btn.dataset.id}`, { status: "paid" });
              renderCustomerDetail(customerId);
            });
          });
        }
      }

      content.innerHTML = `
<!-- Back header -->
<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
  <button class="adm-btn adm-btn-secondary adm-btn-sm" id="custDetailBack">← Terug</button>
  <h2 style="font-size:18px;font-weight:700;color:#0f172a;margin:0;">${esc(customer.name)}</h2>
  <button class="adm-btn adm-btn-secondary adm-btn-sm" id="custDetailEdit">✏ Bewerk</button>
</div>

<!-- KPIs -->
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
  <div class="adm-kpi adm-kpi-purple"><div class="adm-kpi-label">Werkbonnen</div><div class="adm-kpi-value">${custWOs.length}</div><div class="adm-kpi-sub">${custWOs.filter(w=>!["Voltooid","Afgewerkt","done"].includes(w.status)).length} open</div></div>
  <div class="adm-kpi adm-kpi-blue"><div class="adm-kpi-label">Facturen</div><div class="adm-kpi-value">${custInvs.length}</div><div class="adm-kpi-sub">${custInvs.filter(i=>["open","overdue"].includes(i.status)).length} openstaand</div></div>
  <div class="adm-kpi adm-kpi-green"><div class="adm-kpi-label">Betaald</div><div class="adm-kpi-value" style="font-size:17px">${fmtEurCD(paidInvAmt)}</div></div>
  <div class="adm-kpi ${openInvAmt>0?"adm-kpi-amber":"adm-kpi-blue"}"><div class="adm-kpi-label">Openstaand</div><div class="adm-kpi-value" style="font-size:17px">${fmtEurCD(openInvAmt)}</div></div>
</div>

<div class="adm-grid-2">
  <!-- Info card -->
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">Contactgegevens</h3></div>
    <div class="adm-card-body" style="display:flex;flex-direction:column;gap:8px;">
      ${customer.contactName?`<div style="font-size:13px;"><span style="color:#94a3b8;min-width:110px;display:inline-block">Contactpersoon</span>${esc(customer.contactName)}</div>`:""}
      ${customer.email?`<div style="font-size:13px;"><span style="color:#94a3b8;min-width:110px;display:inline-block">E-mail</span><a href="mailto:${esc(customer.email)}" style="color:#4f46e5">${esc(customer.email)}</a></div>`:""}
      ${customer.phone?`<div style="font-size:13px;"><span style="color:#94a3b8;min-width:110px;display:inline-block">Telefoon</span>${esc(customer.phone)}</div>`:""}
      ${customer.vatNumber?`<div style="font-size:13px;"><span style="color:#94a3b8;min-width:110px;display:inline-block">BTW-nummer</span><span style="font-family:monospace">${esc(customer.vatNumber)}</span></div>`:""}
      ${customer.address?`<div style="font-size:13px;"><span style="color:#94a3b8;min-width:110px;display:inline-block">Adres</span>${esc(customer.address)}</div>`:""}
      ${customer.notes?`<div style="font-size:13px;margin-top:4px;"><span style="color:#94a3b8;display:block;margin-bottom:2px;">Notities</span><span style="color:#64748b">${esc(customer.notes)}</span></div>`:""}
      <div style="margin-top:8px;display:flex;gap:8px;">
        <button class="adm-btn adm-btn-primary adm-btn-sm" id="custNewWO">+ Werkbon</button>
        <button class="adm-btn adm-btn-secondary adm-btn-sm" id="custNewInv">🧾 Factuur</button>
      </div>
    </div>
  </div>

  <!-- Tabs card -->
  <div class="adm-card">
    <div class="adm-card-header" style="flex-direction:column;gap:0;padding-bottom:0;" id="custDetailTabs">
      <div style="display:flex;gap:0;border-bottom:1px solid #f1f5f9;width:100%;">
        <button class="cdt-tab" data-tab="werkbonnen" style="background:none;border:none;cursor:pointer;padding:10px 16px;font-size:13px;color:#374151;border-bottom:2px solid #6366f1;font-weight:700;">Werkbonnen (${custWOs.length})</button>
        <button class="cdt-tab" data-tab="facturen" style="background:none;border:none;cursor:pointer;padding:10px 16px;font-size:13px;color:#374151;border-bottom:2px solid transparent;">Facturen (${custInvs.length})</button>
      </div>
    </div>
    <div class="adm-card-body adm-table-wrap" id="custDetailBody"></div>
  </div>
</div>`;

      // Wire events
      content.querySelector("#custDetailBack")?.addEventListener("click", () => renderCustomers());
      content.querySelector("#custDetailEdit")?.addEventListener("click", () => {
        openCustomerDrawer(customer);
        document.getElementById("custForm")?.addEventListener("submit", () => {
          setTimeout(() => renderCustomerDetail(customerId), 300);
        }, { once: true });
      });
      content.querySelector("#custNewWO")?.addEventListener("click", () => {
        openWorkorderDrawer(null);
        // Pre-fill clientName after drawer renders
        setTimeout(() => {
          const inp = document.querySelector("#admDrawerBody [name=clientName]");
          if (inp) inp.value = customer.name;
        }, 100);
      });
      content.querySelector("#custNewInv")?.addEventListener("click", () => {
        openFactuurDrawer(null, {
          prefillCustomerName: customer.name,
          prefillCustomerVat: customer.vatNumber || "",
          prefillCustomerAddress: customer.address || ""
        });
      });
      content.querySelectorAll(".cdt-tab").forEach(t => {
        t.addEventListener("click", () => { _custTab = t.dataset.tab; renderTabs(); });
      });
      renderTabs();
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:#dc2626">Fout: ${e.message}</div>`; }
  }
  function openCustomerDrawer(customer) {
    document.getElementById("admDrawerTitle").textContent = customer ? "Klant bewerken" : "Nieuwe klant";
    document.getElementById("admDrawerBody").innerHTML = `
<form id="custForm">
  <div class="adm-form-group"><label>Naam *</label><input name="name" value="${esc(customer?.name||"")}" required placeholder="Bedrijfsnaam BV"></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Contactpersoon</label><input name="contactName" value="${esc(customer?.contactName||"")}" placeholder="Jan Janssen"></div>
    <div class="adm-form-group">
      <label>BTW-nummer
        <button type="button" id="kboLookupBtn" style="background:none;border:none;cursor:pointer;font-size:11px;color:#4f46e5;font-weight:600;margin-left:6px;padding:1px 6px;border:1px solid #c7d2fe;border-radius:4px;">🔍 KBO opzoeken</button>
      </label>
      <input name="vatNumber" id="custVatInput" value="${esc(customer?.vatNumber||"")}" placeholder="BE0000.000.000">
      <div id="kboResult" style="display:none;margin-top:6px;background:#f0fdf4;border-radius:6px;padding:8px;font-size:12px;color:#166534;"></div>
    </div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>E-mail</label><input name="email" type="email" value="${esc(customer?.email||"")}"></div>
    <div class="adm-form-group"><label>Telefoon</label><input name="phone" value="${esc(customer?.phone||"")}"></div>
  </div>
  <div class="adm-form-group"><label>Adres</label><input name="address" value="${esc(customer?.address||"")}"></div>
  <div class="adm-form-group"><label>Notities</label><textarea name="notes" rows="3" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px">${esc(customer?.notes||"")}</textarea></div>
  <div id="custFormErr" style="display:none;background:#fef2f2;color:#dc2626;border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="custCancel">Annuleren</button>
    ${customer ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="custDelete">🗑 Verwijderen</button>` : ""}
    <button type="submit" class="adm-btn adm-btn-primary">${customer ? "Opslaan" : "Aanmaken"}</button>
  </div>
</form>`;
    openDrawer();
    document.getElementById("custCancel").addEventListener("click", closeDrawer);

    // KBO opzoeken
    document.getElementById("kboLookupBtn")?.addEventListener("click", async () => {
      const btn = document.getElementById("kboLookupBtn");
      const vatInput = document.getElementById("custVatInput");
      const nameInput = document.querySelector("#custForm [name=name]");
      const resultEl = document.getElementById("kboResult");
      const query = (vatInput?.value?.trim()) || (nameInput?.value?.trim());
      if (!query) { window.showToast&&window.showToast("Vul BTW-nummer of naam in","info"); return; }
      btn.textContent = "Laden…"; btn.disabled = true;
      try {
        const d = await api("POST", "/kbo/lookup", { vat: query, name: query });
        const c = d.company || {};
        if (resultEl) {
          resultEl.style.display = "";
          resultEl.innerHTML = `<strong>${esc(c.name||"Onbekend")}</strong><br>${esc(c.vatNumber||"")} · ${esc(c.address||"")}
            <button type="button" id="kboApplyBtn" style="background:none;border:none;cursor:pointer;color:#4f46e5;font-size:11px;font-weight:600;margin-left:8px;">↗ Toepassen</button>`;
          document.getElementById("kboApplyBtn")?.addEventListener("click", () => {
            if (nameInput && c.name) nameInput.value = c.name;
            if (vatInput && c.vatNumber) vatInput.value = c.vatNumber;
            const addrInput = document.querySelector("#custForm [name=address]");
            if (addrInput && c.address) addrInput.value = c.address;
            const emailInput = document.querySelector("#custForm [name=email]");
            if (emailInput && c.email) emailInput.value = c.email;
            if (resultEl) { resultEl.style.display="none"; }
          });
        }
      } catch(e) { window.showToast&&window.showToast("KBO fout: "+e.message,"error"); }
      finally { btn.textContent="🔍 KBO opzoeken"; btn.disabled=false; }
    });

    document.getElementById("custDelete")?.addEventListener("click", async () => {
      if (!confirm(`Klant "${customer.name}" verwijderen?`)) return;
      try {
        await api("DELETE", `/customers/${customer.id}`);
        closeDrawer(); renderCustomers();
      } catch(err) {
        const e = document.getElementById("custFormErr");
        if (e) { e.textContent = err.message; e.style.display = "block"; }
      }
    });
    document.getElementById("custForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = document.getElementById("custFormErr");
      const body = Object.fromEntries(new FormData(e.target).entries());
      try {
        if (customer) await api("PATCH", `/customers/${customer.id}`, body);
        else await api("POST", "/customers", body);
        closeDrawer(); renderCustomers();
      } catch(err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = "block"; }
        else window.showToast(err.message, "error");
      }
    });
  }

  // ── Locaties ────────────────────────────────────────────────
  async function renderVenues() {
    const content = document.getElementById("admContent");
    try {
      const data = await api("GET", "/venues");
      const rows = data.venues || data.rows || [];
      content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Locaties / Werven <span style="background:#e0e7ff;color:#4f46e5;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${rows.length}</span></h3>
    <input id="venSearch" placeholder="Zoek locatie…" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;min-width:180px;">
  </div>
  ${rows.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-icon">📍</div><div class="adm-empty-text">Nog geen locaties</div><button class="adm-btn adm-btn-primary adm-btn-sm" id="admEmptyNewVen" style="margin-top:12px">+ Eerste locatie aanmaken</button></div>`
    : `<div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>Naam</th><th>Adres</th><th>Contactpersoon</th><th>Telefoon</th><th>Actief</th><th>Acties</th></tr></thead>
        <tbody id="venTbody">${buildVenRows(rows)}</tbody>
      </table></div>`}
</div>`;
      const wireVenRows = () => {
        document.querySelectorAll(".ven-row").forEach(row => row.addEventListener("click", e => {
          if (e.target.closest("button")) return;
          openVenueDrawer(rows.find(x => x.id === row.dataset.id));
        }));
        document.querySelectorAll(".ven-edit").forEach(b => b.addEventListener("click", () => openVenueDrawer(rows.find(x => x.id === b.dataset.id))));
      };
      document.getElementById("venSearch")?.addEventListener("input", e => {
        const q = e.target.value.toLowerCase();
        const tb = document.getElementById("venTbody");
        if (tb) tb.innerHTML = buildVenRows(rows.filter(r => `${r.name} ${r.address||""}`.toLowerCase().includes(q)));
        wireVenRows();
      });
      wireVenRows();
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:#dc2626">Fout: ${e.message}</div>`; }
  }
  function buildVenRows(rows) {
    return rows.map(v => `<tr class="adm-row-link ven-row" data-id="${v.id}" title="Open locatie">
      <td><strong>${esc(v.name)}</strong></td>
      <td>${esc(v.address||"—")}</td>
      <td>${esc(v.contactName||"—")}</td>
      <td>${esc(v.phone||"—")}</td>
      <td>${v.active !== false ? '<span class="adm-status adm-status-active">Actief</span>' : '<span class="adm-status adm-status-inactive">Inactief</span>'}</td>
      <td><button class="adm-btn adm-btn-secondary adm-btn-sm ven-edit" data-id="${v.id}">✏ Bewerk</button></td>
    </tr>`).join("");
  }
  function openVenueDrawer(venue) {
    document.getElementById("admDrawerTitle").textContent = venue ? "Locatie bewerken" : "Nieuwe locatie";
    document.getElementById("admDrawerBody").innerHTML = `
<form id="venForm">
  <div class="adm-form-group"><label>Naam *</label><input name="name" value="${esc(venue?.name||"")}" required placeholder="Werf Brussel Noord"></div>
  <div class="adm-form-group"><label>Adres</label><input name="address" value="${esc(venue?.address||"")}" placeholder="Straat 1, 1000 Brussel"></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Contactpersoon</label><input name="contactName" value="${esc(venue?.contactName||"")}"></div>
    <div class="adm-form-group"><label>Telefoon</label><input name="phone" value="${esc(venue?.phone||"")}"></div>
  </div>
  <div class="adm-form-group"><label>Notities</label><textarea name="notes" rows="3" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px">${esc(venue?.notes||"")}</textarea></div>
  <div class="adm-form-group"><label><input type="checkbox" name="active" value="true" ${venue?.active !== false ? "checked" : ""}> Actieve locatie</label></div>
  <div id="venFormErr" style="display:none;background:#fef2f2;color:#dc2626;border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="venCancel">Annuleren</button>
    ${venue ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="venDelete">🗑 Verwijderen</button>` : ""}
    <button type="submit" class="adm-btn adm-btn-primary">${venue ? "Opslaan" : "Aanmaken"}</button>
  </div>
</form>`;
    openDrawer();
    document.getElementById("venCancel").addEventListener("click", closeDrawer);
    document.getElementById("venDelete")?.addEventListener("click", async () => {
      if (!confirm(`Locatie "${venue.name}" verwijderen?`)) return;
      try {
        await api("DELETE", `/venues/${venue.id}`);
        closeDrawer(); renderVenues();
      } catch(err) {
        const e = document.getElementById("venFormErr");
        if (e) { e.textContent = err.message; e.style.display = "block"; }
      }
    });
    document.getElementById("venForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = document.getElementById("venFormErr");
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      body.active = fd.has("active");
      try {
        if (venue) await api("PATCH", `/venues/${venue.id}`, body);
        else await api("POST", "/venues", body);
        closeDrawer(); renderVenues();
      } catch(err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = "block"; }
        else window.showToast(err.message, "error");
      }
    });
  }

  // ── Voertuigen ─────────────────────────────────────────────
  async function renderVehicles() {
    const content = document.getElementById("admContent");
    try {
      const data = await api("GET", "/vehicles");
      const vehicles = data.vehicles || [];
      const alerts = data.alerts || [];
      content.innerHTML = `
${alerts.length ? `<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:12px 16px;margin-bottom:14px;font-size:13px;color:#92400e">
  ⚠️ <strong>${alerts.length} alert${alerts.length>1?"s":""}</strong>: ${alerts.map(a=>esc(a.message||a.type)).join(", ")}
</div>` : ""}
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Voertuigen <span style="background:#e0e7ff;color:#4f46e5;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${vehicles.length}</span></h3>
  </div>
  ${vehicles.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-icon">🚗</div><div class="adm-empty-text">Nog geen voertuigen</div><button class="adm-btn adm-btn-primary adm-btn-sm" id="admEmptyNewVeh" style="margin-top:12px">+ Eerste voertuig aanmaken</button></div>`
    : `<div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>Naam / Kenteken</th><th>Merk / Model</th><th>Chauffeur</th><th>KM-stand</th><th>Status</th><th>Volgende service</th><th>Acties</th></tr></thead>
        <tbody>${vehicles.map(v => `<tr class="adm-row-link veh-row" data-id="${v.id}" title="Open voertuig">
          <td><strong>${esc(v.name||v.plate||"—")}</strong><br><span style="font-size:11px;color:#94a3b8;font-family:monospace">${esc(v.plate||"")}</span></td>
          <td>${esc(v.brand||"")} ${esc(v.model||"")}</td>
          <td>${esc(v.driverName||v.driverId||"—")}</td>
          <td>${v.mileage ? Number(v.mileage).toLocaleString("nl-BE") + " km" : "—"}</td>
          <td><span class="adm-status adm-status-${v.status||"active"}">${esc(v.status||"actief")}</span></td>
          <td>${v.nextService ? new Date(v.nextService).toLocaleDateString("nl-BE") : "—"}</td>
          <td>
            <button class="adm-btn adm-btn-secondary adm-btn-sm veh-edit" data-id="${v.id}">✏</button>
            <button class="adm-btn adm-btn-secondary adm-btn-sm veh-km" data-id="${v.id}">KM log</button>
          </td>
        </tr>`).join("")}</tbody>
      </table></div>`}
</div>`;
      document.querySelectorAll(".veh-row").forEach(row => row.addEventListener("click", e => {
        if (e.target.closest("button")) return;
        openVehicleDrawer(vehicles.find(x => x.id === row.dataset.id));
      }));
      document.querySelectorAll(".veh-edit").forEach(b => b.addEventListener("click", () => openVehicleDrawer(vehicles.find(x => x.id === b.dataset.id))));
      document.querySelectorAll(".veh-km").forEach(b => b.addEventListener("click", () => openMileageDrawer(b.dataset.id)));
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:#dc2626">Fout: ${e.message}</div>`; }
  }
  function openVehicleDrawer(vehicle) {
    document.getElementById("admDrawerTitle").textContent = vehicle ? "Voertuig bewerken" : "Nieuw voertuig";
    document.getElementById("admDrawerBody").innerHTML = `
<form id="vehForm">
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Naam / Code *</label><input name="name" value="${esc(vehicle?.name||"")}" required placeholder="Bestelwagen 1"></div>
    <div class="adm-form-group"><label>Kenteken</label><input name="plate" value="${esc(vehicle?.plate||"")}" placeholder="1-ABC-234" style="text-transform:uppercase"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Merk</label><input name="brand" value="${esc(vehicle?.brand||"")}" placeholder="Ford"></div>
    <div class="adm-form-group"><label>Model</label><input name="model" value="${esc(vehicle?.model||"")}" placeholder="Transit"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Bouwjaar</label><input name="year" type="number" value="${esc(vehicle?.year||"")}" placeholder="2022"></div>
    <div class="adm-form-group"><label>Huidige KM-stand</label><input name="mileage" type="number" value="${esc(vehicle?.mileage||"")}" placeholder="50000"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Status</label>
      <select name="status">
        <option value="active" ${vehicle?.status==="active"?"selected":""}>Actief</option>
        <option value="maintenance" ${vehicle?.status==="maintenance"?"selected":""}>In onderhoud</option>
        <option value="inactive" ${vehicle?.status==="inactive"?"selected":""}>Inactief</option>
      </select>
    </div>
    <div class="adm-form-group"><label>Volgende service (datum)</label><input name="nextService" type="date" value="${esc(vehicle?.nextService||"")}"></div>
  </div>
  <div class="adm-form-actions" style="justify-content:space-between;">
    ${vehicle ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="vehDelete">🗑 Verwijderen</button>` : `<span></span>`}
    <div style="display:flex;gap:8px;">
      <button type="button" class="adm-btn adm-btn-secondary" id="vehCancel">Annuleren</button>
      <button type="submit" class="adm-btn adm-btn-primary">${vehicle ? "Opslaan" : "Aanmaken"}</button>
    </div>
  </div>
</form>`;
    openDrawer();
    document.getElementById("vehCancel").addEventListener("click", closeDrawer);
    if (vehicle) {
      document.getElementById("vehDelete").addEventListener("click", async () => {
        if (!confirm(`Voertuig "${vehicle.name||vehicle.plate}" permanent verwijderen?`)) return;
        try { await api("DELETE", `/vehicles/${vehicle.id}`); closeDrawer(); renderVehicles(); }
        catch(err) { window.showToast(err.message, "error"); }
      });
    }
    document.getElementById("vehForm").addEventListener("submit", async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      if (body.year) body.year = Number(body.year);
      if (body.mileage) body.mileage = Number(body.mileage);
      try {
        if (vehicle) await api("PATCH", `/vehicles/${vehicle.id}`, body);
        else await api("POST", "/vehicles", body);
        closeDrawer(); renderVehicles();
      } catch(err) { window.showToast(err.message, "error"); }
    });
  }
  function openMileageDrawer(vehicleId) {
    document.getElementById("admDrawerTitle").textContent = "KM-registratie";
    document.getElementById("admDrawerBody").innerHTML = `
<form id="kmForm">
  <div class="adm-form-group"><label>Datum *</label><input name="date" type="date" value="${new Date().toISOString().slice(0,10)}" required></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>KM bij vertrek</label><input name="startKm" type="number" placeholder="50000" required></div>
    <div class="adm-form-group"><label>KM bij aankomst</label><input name="endKm" type="number" placeholder="50250"></div>
  </div>
  <div class="adm-form-group"><label>Doel / Notitie</label><input name="note" placeholder="Werf Brussel — materiaal levering"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="kmCancel">Annuleren</button>
    <button type="submit" class="adm-btn adm-btn-primary">Opslaan</button>
  </div>
</form>`;
    openDrawer();
    document.getElementById("kmCancel").addEventListener("click", closeDrawer);
    document.getElementById("kmForm").addEventListener("submit", async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      if (body.startKm) body.startKm = Number(body.startKm);
      if (body.endKm) body.endKm = Number(body.endKm);
      try {
        await api("POST", `/vehicles/${vehicleId}/mileage`, body);
        closeDrawer(); renderVehicles();
      } catch(err) { window.showToast(err.message, "error"); }
    });
  }

  // ── Stock ──────────────────────────────────────────────────
  async function renderStock() {
    const content = document.getElementById("admContent");
    try {
      const data = await api("GET", "/stock");
      const items = data.items || data.stock || [];
      const alerts = data.alerts || [];
      const totalValue = items.reduce((s, i) => s + (Number(i.quantity||0) * Number(i.unitPrice||0)), 0);
      content.innerHTML = `
<div class="adm-kpis" style="margin-bottom:16px">
  <div class="adm-kpi adm-kpi-blue"><div class="adm-kpi-label">Artikelen</div><div class="adm-kpi-value">${items.length}</div></div>
  <div class="adm-kpi adm-kpi-${alerts.length>0?"red":"green"}"><div class="adm-kpi-label">Lage voorraad alerts</div><div class="adm-kpi-value">${alerts.length}</div></div>
  <div class="adm-kpi adm-kpi-purple"><div class="adm-kpi-label">Totale stockwaarde</div><div class="adm-kpi-value" style="font-size:18px">${new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(totalValue)}</div></div>
</div>
${alerts.length ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px 16px;margin-bottom:14px;font-size:13px;color:#7f1d1d">
  ⚠️ Lage voorraad: ${alerts.map(a=>esc(a.name||a.itemId)).join(", ")}
</div>` : ""}
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Stockbeheer</h3>
    <input id="stSearch" placeholder="Zoek artikel…" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;min-width:160px;">
  </div>
  ${items.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-icon">📦</div><div class="adm-empty-text">Nog geen stockartikelen</div><button class="adm-btn adm-btn-primary adm-btn-sm" id="admEmptyNewStock" style="margin-top:12px">+ Eerste artikel aanmaken</button></div>`
    : `<div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>Artikel</th><th>SKU</th><th>Categorie</th><th>Hoeveelheid</th><th>Eenheid</th><th>Min. stock</th><th>Prijs/stuk</th><th>Acties</th></tr></thead>
        <tbody id="stTbody">${buildStockRows(items)}</tbody>
      </table></div>`}
</div>`;
      document.getElementById("stSearch")?.addEventListener("input", e => {
        const q = e.target.value.toLowerCase();
        const tb = document.getElementById("stTbody");
        if (tb) tb.innerHTML = buildStockRows(items.filter(i => `${i.name} ${i.sku||""} ${i.category||""}`.toLowerCase().includes(q)));
        wireStockBtns(items);
      });
      wireStockBtns(items);
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:#dc2626">Fout: ${e.message}</div>`; }
  }
  function buildStockRows(rows) {
    return rows.map(i => {
      const low = i.minQuantity && Number(i.quantity||0) <= Number(i.minQuantity||0);
      return `<tr class="adm-row-link st-row" data-id="${i.id}" title="Open artikel" style="${low?"background:#fef2f2":""}">
        <td><strong>${esc(i.name)}</strong>${low?` <span style="background:#fee2e2;color:#dc2626;border-radius:4px;padding:1px 5px;font-size:10px">LAAG</span>`:""}</td>
        <td style="font-family:monospace;font-size:12px">${esc(i.sku||"—")}</td>
        <td>${esc(i.category||"—")}</td>
        <td style="font-weight:700;color:${low?"#dc2626":"#0f172a"}">${esc(i.quantity??0)}</td>
        <td>${esc(i.unit||"st")}</td>
        <td>${esc(i.minQuantity||"—")}</td>
        <td>${i.unitPrice ? new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(i.unitPrice) : "—"}</td>
        <td>
          <button class="adm-btn adm-btn-secondary adm-btn-sm st-edit" data-id="${i.id}">✏</button>
          <button class="adm-btn adm-btn-secondary adm-btn-sm st-mut" data-id="${i.id}">± Mutatie</button>
        </td>
      </tr>`;
    }).join("");
  }
  function wireStockBtns(items) {
    document.querySelectorAll(".st-row").forEach(row => row.addEventListener("click", e => {
      if (e.target.closest("button")) return;
      openStockDrawer(items.find(x => x.id === row.dataset.id));
    }));
    document.querySelectorAll(".st-edit").forEach(b => b.addEventListener("click", () => openStockDrawer(items.find(x => x.id === b.dataset.id))));
    document.querySelectorAll(".st-mut").forEach(b => b.addEventListener("click", () => openMutationDrawer(b.dataset.id)));
  }
  function openStockDrawer(item) {
    document.getElementById("admDrawerTitle").textContent = item ? "Artikel bewerken" : "Nieuw artikel";
    document.getElementById("admDrawerBody").innerHTML = `
<form id="stForm">
  <div class="adm-form-group"><label>Naam *</label><input name="name" value="${esc(item?.name||"")}" required placeholder="Kabel 3x2.5mm²"></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>SKU / Code</label><input name="sku" value="${esc(item?.sku||"")}" placeholder="KAB-325"></div>
    <div class="adm-form-group"><label>Categorie</label><input name="category" value="${esc(item?.category||"")}" placeholder="Kabels"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Hoeveelheid</label><input name="quantity" type="number" step="0.01" value="${esc(item?.quantity??0)}"></div>
    <div class="adm-form-group"><label>Eenheid</label><input name="unit" value="${esc(item?.unit||"st")}" placeholder="st / m / kg"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Minimale voorraad</label><input name="minQuantity" type="number" value="${esc(item?.minQuantity||"")}"></div>
    <div class="adm-form-group"><label>Prijs per eenheid (€)</label><input name="unitPrice" type="number" step="0.01" value="${esc(item?.unitPrice||"")}"></div>
  </div>
  <div class="adm-form-actions" style="justify-content:space-between;">
    ${item ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="stDelete">🗑 Verwijderen</button>` : `<span></span>`}
    <div style="display:flex;gap:8px;">
      <button type="button" class="adm-btn adm-btn-secondary" id="stCancel">Annuleren</button>
      <button type="submit" class="adm-btn adm-btn-primary">${item ? "Opslaan" : "Aanmaken"}</button>
    </div>
  </div>
</form>`;
    openDrawer();
    document.getElementById("stCancel").addEventListener("click", closeDrawer);
    if (item) {
      document.getElementById("stDelete").addEventListener("click", async () => {
        if (!confirm(`Artikel "${item.name}" permanent verwijderen? Alle stockhistorie gaat verloren.`)) return;
        try { await api("DELETE", `/stock/${item.id}`); closeDrawer(); renderStock(); }
        catch(err) { window.showToast(err.message, "error"); }
      });
    }
    document.getElementById("stForm").addEventListener("submit", async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      if (body.quantity !== undefined) body.quantity = Number(body.quantity);
      if (body.minQuantity) body.minQuantity = Number(body.minQuantity);
      if (body.unitPrice) body.unitPrice = Number(body.unitPrice);
      try {
        if (item) await api("PATCH", `/stock/${item.id}`, body);
        else await api("POST", "/stock", body);
        closeDrawer(); renderStock();
      } catch(err) { window.showToast(err.message, "error"); }
    });
  }
  function openMutationDrawer(itemId) {
    document.getElementById("admDrawerTitle").textContent = "Stockmutatie";
    document.getElementById("admDrawerBody").innerHTML = `
<form id="mutForm">
  <p style="font-size:13px;color:#64748b;margin-bottom:12px">Pas de voorraad aan met een positieve (aanvulling) of negatieve (gebruik) waarde.</p>
  <div class="adm-form-group"><label>Hoeveelheid (+ aanvulling / − gebruik) *</label><input name="delta" type="number" step="0.01" required placeholder="bv. -5 of +20"></div>
  <div class="adm-form-group"><label>Reden</label><input name="reason" placeholder="Gebruikt op werf Brussel"></div>
  <div class="adm-form-group"><label>Datum</label><input name="date" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="mutCancel">Annuleren</button>
    <button type="submit" class="adm-btn adm-btn-primary">Verwerken</button>
  </div>
</form>`;
    openDrawer();
    document.getElementById("mutCancel").addEventListener("click", closeDrawer);
    document.getElementById("mutForm").addEventListener("submit", async e => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target).entries());
      body.delta = Number(body.delta);
      try {
        await api("POST", `/stock/${itemId}/mutations`, body);
        closeDrawer(); renderStock();
      } catch(err) { window.showToast(err.message, "error"); }
    });
  }

  // ── Factuur PDF afdrukken ──────────────────────────────────
  function printInvoicePDF(inv, tenant = {}) {
    const fE = n => new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(Number(n||0));
    const fD = iso => iso ? new Date(iso).toLocaleDateString("nl-BE",{day:"2-digit",month:"2-digit",year:"numeric"}) : "—";
    const stLabel = { open:"Openstaand", paid:"Betaald", overdue:"Vervallen", draft:"Concept", sent:"Verstuurd" };
    const stColor = { open:"#f59e0b", paid:"#10b981", overdue:"#ef4444", draft:"#94a3b8", sent:"#3b82f6" };
    const lines = inv.lines || [];
    const win = window.open("", "_blank");
    win.document.write(`<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8">
<title>Factuur ${esc(inv.number||"")}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1e293b;background:#fff;padding:32px 40px}
  .page{max-width:750px;margin:0 auto}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}
  .brand{font-size:22px;font-weight:700;color:#4f46e5}
  .brand-sub{font-size:12px;color:#64748b;margin-top:2px}
  .invoice-meta{text-align:right}
  .invoice-nr{font-size:20px;font-weight:700;color:#0f172a}
  .invoice-status{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;margin-top:4px;background:${stColor[inv.status]||"#94a3b8"}20;color:${stColor[inv.status]||"#94a3b8"}}
  .parties{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:28px}
  .party-label{font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
  .party-name{font-size:14px;font-weight:600;color:#0f172a;margin-bottom:3px}
  .party-detail{font-size:12px;color:#64748b;line-height:1.5}
  .dates{display:flex;gap:24px;background:#f8fafc;border-radius:8px;padding:12px 16px;margin-bottom:24px}
  .date-item{flex:1}
  .date-label{font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}
  .date-val{font-size:13px;font-weight:600}
  table{width:100%;border-collapse:collapse;margin-bottom:20px}
  thead th{background:#f1f5f9;padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.4px;border-bottom:2px solid #e2e8f0}
  tbody td{padding:9px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top}
  tbody tr:last-child td{border-bottom:none}
  .desc{color:#0f172a;font-weight:500}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .totals{margin-left:auto;width:260px}
  .totals-row{display:flex;justify-content:space-between;padding:5px 0;font-size:13px}
  .totals-row.total{font-weight:700;font-size:15px;border-top:2px solid #0f172a;padding-top:8px;margin-top:4px}
  .notes{background:#f8fafc;border-radius:8px;padding:12px 16px;margin-top:16px;font-size:12px;color:#64748b}
  .footer{margin-top:36px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px}
  @media print{body{padding:0}@page{margin:15mm}}
</style></head><body>
<div class="page">
  <div class="header">
    <div>
      <div class="brand">${esc(tenant.name||"Monargo One")}</div>
      <div class="brand-sub">${esc(tenant.vatNumber||"")}</div>
      <div class="brand-sub">${esc(tenant.address||"")}</div>
      ${tenant.contactEmail?`<div class="brand-sub">${esc(tenant.contactEmail)}</div>`:""}
    </div>
    <div class="invoice-meta">
      <div class="invoice-nr">FACTUUR ${esc(inv.number||"")}</div>
      <div class="invoice-status">${stLabel[inv.status]||inv.status||""}</div>
    </div>
  </div>

  <div class="parties">
    <div>
      <div class="party-label">Factuuradres</div>
      <div class="party-name">${esc(inv.customerName||"—")}</div>
      ${inv.customerVatNumber?`<div class="party-detail">BTW: ${esc(inv.customerVatNumber)}</div>`:""}
      ${inv.customerAddress?`<div class="party-detail">${esc(inv.customerAddress)}</div>`:""}
    </div>
    <div>
      <div class="party-label">Factuurgegevens</div>
      <div class="party-detail">Datum: ${fD(inv.invoiceDate)}</div>
      <div class="party-detail">Vervaldatum: ${fD(inv.dueDate)}</div>
      ${inv.paidAt?`<div class="party-detail" style="color:#10b981;font-weight:600">Betaald op: ${fD(inv.paidAt)}</div>`:""}
    </div>
  </div>

  <table>
    <thead>
      <tr><th>Omschrijving</th><th class="num">Qty</th><th class="num">Prijs</th><th class="num">BTW%</th><th class="num">Subtotaal</th><th class="num">BTW</th><th class="num">Totaal</th></tr>
    </thead>
    <tbody>
      ${lines.map(l=>`<tr>
        <td class="desc">${esc(l.description||"")}</td>
        <td class="num">${Number(l.qty||1)}</td>
        <td class="num">${fE(l.unitPrice)}</td>
        <td class="num">${l.vatRate??21}%</td>
        <td class="num">${fE(l.lineSubtotal)}</td>
        <td class="num">${fE(l.lineVat)}</td>
        <td class="num" style="font-weight:600">${fE(l.lineTotal)}</td>
      </tr>`).join("")}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-row"><span>Subtotaal</span><span>${fE(inv.subtotal)}</span></div>
    <div class="totals-row"><span>BTW</span><span>${fE(inv.vatAmount)}</span></div>
    <div class="totals-row total"><span>TOTAAL</span><span>${fE(inv.total)}</span></div>
  </div>

  ${inv.notes?`<div class="notes"><strong>Opmerkingen:</strong> ${esc(inv.notes)}</div>`:""}

  <div class="footer">
    ${esc(tenant.name||"")} · ${esc(tenant.vatNumber||"")} · ${esc(tenant.contactEmail||"")}
    <br>Gelieve te betalen voor ${fD(inv.dueDate)} op rekening van ${esc(tenant.name||"")}.
  </div>
</div>
<script>window.onload=()=>{window.print()}</script>
</body></html>`);
    win.document.close();
  }

  // ── Facturen (klantfacturen) ───────────────────────────────
  const fmtEurInv = n => new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(Number(n||0));
  const INV_STATUS = {
    open:    { label:"Open",     css:"adm-status-open" },
    paid:    { label:"Betaald",  css:"adm-status-goedgekeurd" },
    overdue: { label:"Vervallen",css:"adm-status-inactive" },
    draft:   { label:"Concept",  css:"adm-status-pending" },
    sent:    { label:"Verstuurd",css:"adm-status-pending" }
  };

  // ── Offertes ───────────────────────────────────────────────
  const QUOTE_STATUS = {
    concept:   { label:"Concept",   css:"adm-status-pending" },
    verzonden: { label:"Verzonden", css:"adm-status-open" },
    aanvaard:  { label:"Aanvaard",  css:"adm-status-goedgekeurd" },
    geweigerd: { label:"Geweigerd", css:"adm-status-geweigerd" },
    verlopen:  { label:"Verlopen",  css:"adm-status-inactive" }
  };

  async function renderOffertes() {
    const content = document.getElementById("admContent");
    try {
      const data = await api("GET", "/offertes");
      const rows = data.quotes || [];

      const openCount = rows.filter(r => r.status === "verzonden").length;
      const badge = document.getElementById("admOfferteBadge");
      if (badge) { badge.textContent = openCount; badge.style.display = openCount ? "" : "none"; }

      const acceptedVal = rows.filter(r => r.status === "aanvaard").reduce((s,q)=>s+Number(q.total||0),0);
      const openVal     = rows.filter(r => r.status === "verzonden").reduce((s,q)=>s+Number(q.total||0),0);
      const filterSel = content.querySelector?.("#qStatusFilter")?.value || "";
      const filtered = filterSel ? rows.filter(r => r.status === filterSel) : rows;

      content.innerHTML = `
<div class="adm-kpis" style="margin-bottom:16px">
  <div class="adm-kpi adm-kpi-amber"><div class="adm-kpi-label">Openstaand</div><div class="adm-kpi-value" style="font-size:18px">${fmtEurInv(openVal)}</div><div class="adm-kpi-sub">${openCount} verzonden</div></div>
  <div class="adm-kpi adm-kpi-green"><div class="adm-kpi-label">Aanvaard</div><div class="adm-kpi-value" style="font-size:18px">${fmtEurInv(acceptedVal)}</div><div class="adm-kpi-sub">${rows.filter(r=>r.status==="aanvaard").length} offertes</div></div>
  <div class="adm-kpi adm-kpi-blue"><div class="adm-kpi-label">Conversie</div><div class="adm-kpi-value">${rows.length?Math.round(rows.filter(r=>r.status==="aanvaard").length/rows.length*100):0}%</div><div class="adm-kpi-sub">aanvaard / totaal</div></div>
  <div class="adm-kpi adm-kpi-purple"><div class="adm-kpi-label">Totaal offertes</div><div class="adm-kpi-value">${rows.length}</div><div class="adm-kpi-sub">alle statussen</div></div>
</div>
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Offertes <span style="background:#fef3c7;color:#92400e;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${filtered.length}</span></h3>
    <select id="qStatusFilter" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
      <option value="">Alle statussen</option>
      ${["concept","verzonden","aanvaard","geweigerd","verlopen"].map(s=>`<option value="${s}" ${filterSel===s?"selected":""}>${QUOTE_STATUS[s].label}</option>`).join("")}
    </select>
  </div>
  ${filtered.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-icon">📋</div><div class="adm-empty-text">Nog geen offertes</div><button class="adm-btn adm-btn-primary adm-btn-sm" id="admEmptyNewQuote" style="margin-top:12px">+ Eerste offerte aanmaken</button></div>`
    : `<div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>Nr.</th><th>Datum</th><th>Klant</th><th>Geldig tot</th><th>Bedrag</th><th>Status</th><th>Acties</th></tr></thead>
        <tbody>${filtered.slice().sort((a,b)=>(b.quoteDate||"").localeCompare(a.quoteDate||"")).map(q => {
          const st = QUOTE_STATUS[q.status] || { label:q.status, css:"adm-status-pending" };
          const canConvert = q.status === "aanvaard";
          return `<tr class="adm-row-link q-row" data-id="${q.id}" title="Open offerte">
            <td style="font-family:monospace;font-weight:600">${esc(q.number||"")}</td>
            <td>${q.quoteDate?new Date(q.quoteDate).toLocaleDateString("nl-BE"):"—"}</td>
            <td><strong>${esc(q.customerName||"—")}</strong></td>
            <td style="${q.status==="verlopen"?"color:#ef4444;font-weight:600":""}">${q.validUntil?new Date(q.validUntil).toLocaleDateString("nl-BE"):"—"}</td>
            <td style="font-weight:600">${fmtEurInv(q.total)}</td>
            <td><span class="adm-status ${st.css}">${st.label}</span>${q.invoiceId?`<div style="font-size:10px;color:#94a3b8">→ gefactureerd</div>`:""}</td>
            <td style="white-space:nowrap;display:flex;gap:5px;flex-wrap:wrap;">
              <button class="adm-btn adm-btn-secondary adm-btn-sm q-edit" data-id="${q.id}" title="Bewerk">✏</button>
              <button class="adm-btn adm-btn-secondary adm-btn-sm q-pdf" data-id="${q.id}" title="PDF / Afdrukken">📄</button>
              ${["concept","verzonden"].includes(q.status)?`<button class="adm-btn adm-btn-secondary adm-btn-sm q-send" data-id="${q.id}" title="Versturen + link">📤</button>`:""}
              ${canConvert && !q.invoiceId?`<button class="adm-btn adm-btn-success adm-btn-sm q-toinv" data-id="${q.id}" title="Naar factuur">→ Factuur</button>`:""}
              ${canConvert && !q.workorderId?`<button class="adm-btn adm-btn-secondary adm-btn-sm q-towo" data-id="${q.id}" title="Naar werkbon">→ Werkbon</button>`:""}
            </td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>`}
</div>`;

      document.getElementById("qStatusFilter")?.addEventListener("change", () => renderOffertes());
      content.querySelectorAll(".q-row").forEach(row => row.addEventListener("click", e => {
        if (e.target.closest("button")) return;
        openOfferteDrawer(rows.find(q => q.id === row.dataset.id));
      }));
      content.querySelectorAll(".q-edit").forEach(b => b.addEventListener("click", () => openOfferteDrawer(rows.find(q => q.id === b.dataset.id))));
      content.querySelectorAll(".q-pdf").forEach(b => b.addEventListener("click", async () => {
        try { const r = await api("GET", `/documents/quote/${b.dataset.id}/render`); const w = window.open("", "_blank"); w.document.write(r.html); w.document.close(); }
        catch (e) { window.showToast && window.showToast(e.message, "error"); }
      }));
      content.querySelectorAll(".q-send").forEach(b => b.addEventListener("click", async () => {
        try {
          const d = await api("POST", `/offertes/${b.dataset.id}/send`, {});
          const url = d.acceptUrl || "";
          try { await navigator.clipboard.writeText(url); } catch(_){}
          window.showToast && window.showToast("Offerte verzonden ✓ — accepteer-link gekopieerd", "success");
          renderOffertes();
        } catch(e){ window.showToast && window.showToast("Fout: "+e.message, "error"); }
      }));
      content.querySelectorAll(".q-toinv").forEach(b => b.addEventListener("click", async () => {
        if(!confirm("Offerte omzetten naar factuur?")) return;
        try { const d = await api("POST", `/offertes/${b.dataset.id}/convert`, { target:"invoice" }); window.showToast && window.showToast("Factuur "+(d.invoice?.number||"")+" aangemaakt ✓","success"); renderOffertes(); }
        catch(e){ window.showToast && window.showToast("Fout: "+e.message,"error"); }
      }));
      content.querySelectorAll(".q-towo").forEach(b => b.addEventListener("click", async () => {
        if(!confirm("Offerte omzetten naar werkbon?")) return;
        try { const d = await api("POST", `/offertes/${b.dataset.id}/convert`, { target:"workorder" }); window.showToast && window.showToast("Werkbon "+(d.workorder?.number||"")+" aangemaakt ✓","success"); renderOffertes(); }
        catch(e){ window.showToast && window.showToast("Fout: "+e.message,"error"); }
      }));
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:#dc2626">Fout: ${e.message}</div>`; }
  }

  async function openOfferteDrawer(quote) {
    let customers = [];
    try { const d = await api("GET", "/customers"); customers = d.customers || []; } catch(_){}
    const today = new Date().toISOString().slice(0,10);
    const valid30 = new Date(Date.now()+30*86400000).toISOString().slice(0,10);
    const lines0 = quote?.lines || [{ description:"", qty:1, unitPrice:0, vatRate:21 }];
    const isEdit = !!quote;
    document.getElementById("admDrawerTitle").textContent = isEdit ? `Offerte ${quote.number}` : "Nieuwe offerte";

    const lineRow = (l) => `<div class="q-line-row" style="display:grid;grid-template-columns:1fr 60px 90px 60px 24px;gap:6px;align-items:center;margin-bottom:8px;">
        <input placeholder="Omschrijving" value="${esc(l.description||"")}" class="q-line-desc" style="padding:6px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;" ${isEdit?"disabled":""}>
        <input type="number" min="1" value="${l.qty||1}" class="q-line-qty" style="padding:6px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;text-align:right;" ${isEdit?"disabled":""}>
        <input type="number" min="0" step="0.01" value="${Number(l.unitPrice||0).toFixed(2)}" class="q-line-price" style="padding:6px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;text-align:right;" ${isEdit?"disabled":""}>
        <select class="q-line-vat" style="padding:6px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;" ${isEdit?"disabled":""}>
          ${[0,6,12,21].map(v=>`<option value="${v}" ${(l.vatRate==v||(v==21&&l.vatRate==null))?"selected":""}>${v}%</option>`).join("")}
        </select>
        <button type="button" class="q-line-del" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:16px;padding:0;" ${isEdit?"disabled":""}>&times;</button>
      </div>`;

    document.getElementById("admDrawerBody").innerHTML = `
<form id="qForm">
  <div class="adm-form-group"><label>Klant *</label>
    <select name="customerId" id="qCustSel" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;" ${isEdit?"disabled":""}>
      <option value="">— Handmatig invullen —</option>
      ${customers.map(c=>`<option value="${c.id}" ${quote?.customerId===c.id?"selected":""}>${esc(c.name)}</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-group"><label>Klantnaam *</label>
    <input name="customerName" value="${esc(quote?.customerName||"")}" placeholder="Bedrijfsnaam NV" required ${isEdit?"disabled":""}>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>BTW-nummer</label><input name="customerVatNumber" value="${esc(quote?.customerVatNumber||"")}" placeholder="BE0000.000.000" ${isEdit?"disabled":""}></div>
    <div class="adm-form-group"><label>Adres</label><input name="customerAddress" value="${esc(quote?.customerAddress||"")}" placeholder="Straat, gemeente" ${isEdit?"disabled":""}></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Offertedatum</label><input type="date" name="quoteDate" value="${quote?.quoteDate||today}" ${isEdit?"disabled":""}></div>
    <div class="adm-form-group"><label>Geldig tot</label><input type="date" name="validUntil" value="${quote?.validUntil||valid30}" ${isEdit?"disabled":""}></div>
  </div>
  <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px;">Offerteregels</div>
  <div id="qLines">${lines0.map(lineRow).join("")}</div>
  ${!isEdit?`<button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" id="qAddLine" style="margin-bottom:16px;">+ Regel toevoegen</button>`:""}
  <div style="background:#f8fafc;border-radius:10px;padding:12px;margin-bottom:16px;">
    <div style="display:flex;justify-content:space-between;font-size:13px;color:#64748b;margin-bottom:4px;"><span>Subtotaal</span><span id="qSubtotal">€0,00</span></div>
    <div style="display:flex;justify-content:space-between;font-size:13px;color:#64748b;margin-bottom:4px;"><span>BTW</span><span id="qVat">€0,00</span></div>
    <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;border-top:1px solid #e2e8f0;padding-top:8px;margin-top:4px;"><span>Totaal</span><span id="qTotal">€0,00</span></div>
  </div>
  <div class="adm-form-group"><label>Opmerkingen</label>
    <textarea name="notes" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px" ${isEdit?"disabled":""}>${esc(quote?.notes||"")}</textarea>
  </div>
  <div id="qFormErr" style="display:none;background:#fef2f2;color:#dc2626;border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions" style="flex-wrap:wrap;gap:8px;">
    <button type="button" class="adm-btn adm-btn-secondary" id="qCancel">Sluiten</button>
    ${isEdit && !["aanvaard"].includes(quote.status)?`<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="qDelete">🗑 Verwijderen</button>`:""}
    ${!isEdit?`<button type="submit" class="adm-btn adm-btn-primary">Aanmaken</button>`:""}
  </div>
</form>`;

    function recalc() {
      let sub=0, vat=0;
      document.querySelectorAll(".q-line-row").forEach(r=>{
        const q=Number(r.querySelector(".q-line-qty").value||0), p=Number(r.querySelector(".q-line-price").value||0), v=Number(r.querySelector(".q-line-vat").value||21);
        sub+=q*p; vat+=q*p*v/100;
      });
      document.getElementById("qSubtotal").textContent=fmtEurInv(sub);
      document.getElementById("qVat").textContent=fmtEurInv(vat);
      document.getElementById("qTotal").textContent=fmtEurInv(sub+vat);
    }
    function bind() {
      document.querySelectorAll(".q-line-qty,.q-line-price,.q-line-vat").forEach(el=>el.addEventListener("input",recalc));
      document.querySelectorAll(".q-line-del").forEach(b=>b.addEventListener("click",()=>{ if(document.querySelectorAll(".q-line-row").length<=1)return; b.closest(".q-line-row").remove(); recalc(); }));
    }
    bind(); recalc();
    document.getElementById("qCustSel")?.addEventListener("change", e => {
      const c = customers.find(x=>x.id===e.target.value);
      if(c){ document.querySelector("[name=customerName]").value=c.name||""; document.querySelector("[name=customerVatNumber]").value=c.vatNumber||""; document.querySelector("[name=customerAddress]").value=c.address||""; }
    });
    document.getElementById("qAddLine")?.addEventListener("click", () => {
      const div=document.createElement("div"); div.innerHTML=lineRow({description:"",qty:1,unitPrice:0,vatRate:21});
      document.getElementById("qLines").appendChild(div.firstElementChild); bind(); recalc();
    });
    openDrawer();
    document.getElementById("qCancel").addEventListener("click", closeDrawer);
    document.getElementById("qDelete")?.addEventListener("click", async () => {
      if(!confirm(`Offerte ${quote.number} verwijderen?`)) return;
      try { await api("DELETE", `/offertes/${quote.id}`); closeDrawer(); renderOffertes(); }
      catch(err){ const e=document.getElementById("qFormErr"); if(e){e.textContent=err.message;e.style.display="";} }
    });
    document.getElementById("qForm")?.addEventListener("submit", async e => {
      e.preventDefault();
      const errEl=document.getElementById("qFormErr");
      const body=Object.fromEntries(new FormData(e.target).entries());
      body.lines=Array.from(document.querySelectorAll(".q-line-row")).map(r=>({
        description:r.querySelector(".q-line-desc").value,
        qty:Number(r.querySelector(".q-line-qty").value||1),
        unitPrice:Number(r.querySelector(".q-line-price").value||0),
        vatRate:Number(r.querySelector(".q-line-vat").value||21)
      }));
      try { await api("POST", "/offertes", body); closeDrawer(); renderOffertes(); window.showToast && window.showToast("Offerte aangemaakt ✓","success"); }
      catch(err){ if(errEl){errEl.textContent=err.message;errEl.style.display="";} }
    });
  }

  async function renderFacturen() {
    const content = document.getElementById("admContent");
    try {
      const data = await api("GET", "/facturen");
      const rows = data.invoices || [];

      // Update badge (open/overdue)
      const openCount = rows.filter(r => ["open","overdue"].includes(r.status)).length;
      const badge = document.getElementById("admFacturenBadge");
      if (badge) { badge.textContent = openCount; badge.style.display = openCount ? "" : "none"; }

      // KPIs
      const totalRevenue   = rows.filter(r => r.status === "paid").reduce((s,i) => s + Number(i.total||0), 0);
      const openAmount     = rows.filter(r => r.status === "open").reduce((s,i) => s + Number(i.total||0), 0);
      const overdueAmount  = rows.filter(r => r.status === "overdue").reduce((s,i) => s + Number(i.total||0), 0);

      // Status filter
      const STATUS_OPTS = ["","open","paid","overdue","draft"];
      const filterSel = content.querySelector?.("#invStatusFilter")?.value || "";

      const filtered = filterSel ? rows.filter(r => r.status === filterSel) : rows;

      content.innerHTML = `
<div class="adm-kpis" style="margin-bottom:16px">
  <div class="adm-kpi adm-kpi-green">
    <div class="adm-kpi-label">Betaald</div>
    <div class="adm-kpi-value" style="font-size:18px">${fmtEurInv(totalRevenue)}</div>
    <div class="adm-kpi-sub">${rows.filter(r=>r.status==="paid").length} facturen</div>
  </div>
  <div class="adm-kpi adm-kpi-blue">
    <div class="adm-kpi-label">Openstaand</div>
    <div class="adm-kpi-value" style="font-size:18px">${fmtEurInv(openAmount)}</div>
    <div class="adm-kpi-sub">${rows.filter(r=>r.status==="open").length} facturen</div>
  </div>
  <div class="adm-kpi ${overdueAmount>0?"adm-kpi-red":"adm-kpi-amber"}">
    <div class="adm-kpi-label">Vervallen</div>
    <div class="adm-kpi-value" style="font-size:18px">${fmtEurInv(overdueAmount)}</div>
    <div class="adm-kpi-sub">${rows.filter(r=>r.status==="overdue").length} facturen</div>
  </div>
  <div class="adm-kpi adm-kpi-purple">
    <div class="adm-kpi-label">Totaal facturen</div>
    <div class="adm-kpi-value">${rows.length}</div>
    <div class="adm-kpi-sub">Alle statussen</div>
  </div>
</div>

<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">Facturen <span style="background:#e0e7ff;color:#4f46e5;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${filtered.length}</span></h3>
    <div style="display:flex;gap:8px;align-items:center;">
      <select id="invStatusFilter" style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
        <option value="">Alle statussen</option>
        <option value="open" ${filterSel==="open"?"selected":""}>Open</option>
        <option value="paid" ${filterSel==="paid"?"selected":""}>Betaald</option>
        <option value="overdue" ${filterSel==="overdue"?"selected":""}>Vervallen</option>
        <option value="draft" ${filterSel==="draft"?"selected":""}>Concept</option>
      </select>
    </div>
  </div>
  ${filtered.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-icon">🧾</div><div class="adm-empty-text">Nog geen facturen</div><button class="adm-btn adm-btn-primary adm-btn-sm" id="admEmptyNewInv" style="margin-top:12px">+ Eerste factuur aanmaken</button></div>`
    : `<div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>Nr.</th><th>Datum</th><th>Klant</th><th>Vervaldatum</th><th>Bedrag</th><th>Status</th><th>Acties</th></tr></thead>
        <tbody>${filtered.slice().sort((a,b) => (b.invoiceDate||"").localeCompare(a.invoiceDate||"")).map(inv => {
          const st = INV_STATUS[inv.status] || { label: inv.status, css: "adm-status-pending" };
          return `<tr class="adm-row-link inv-row" data-id="${inv.id}" title="Open factuur">
            <td style="font-family:monospace;font-weight:600">${esc(inv.number||inv.id.slice(-6))}</td>
            <td>${inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString("nl-BE") : "—"}</td>
            <td><strong>${esc(inv.customerName||"—")}</strong>${inv.customerVatNumber?`<div style="font-size:11px;color:#94a3b8">${esc(inv.customerVatNumber)}</div>`:""}</td>
            <td style="${inv.status==="overdue"?"color:#ef4444;font-weight:600":""}">${inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("nl-BE") : "—"}</td>
            <td style="font-weight:600">${fmtEurInv(inv.total)}</td>
            <td><span class="adm-status ${st.css}">${st.label}</span></td>
            <td style="white-space:nowrap;display:flex;gap:6px;">
              <button class="adm-btn adm-btn-secondary adm-btn-sm inv-edit" data-id="${inv.id}">✏</button>
              <button class="adm-btn adm-btn-secondary adm-btn-sm inv-pdf" data-id="${inv.id}" title="PDF / Afdrukken">📄</button>
              ${inv.peppolStatus === "delivered" || inv.peppolStatus === "sent"
                ? `<span class="adm-status adm-status-active" title="Peppol: ${esc(inv.peppolReference||"")}">📧 Peppol ✓</span>`
                : (subEnabled("invoices","peppol") ? `<button class="adm-btn adm-btn-secondary adm-btn-sm inv-peppol" data-id="${inv.id}" title="Verstuur via Peppol e-facturatie">📧 Peppol</button>` : "")}
              <button class="adm-btn adm-btn-secondary adm-btn-sm inv-ubl" data-id="${inv.id}" title="UBL-XML downloaden">⬇ UBL</button>
              ${["open","overdue"].includes(inv.status) && subEnabled("invoices","online-payment") ? `<button class="adm-btn adm-btn-secondary adm-btn-sm inv-paylink" data-id="${inv.id}" title="Betaallink genereren">💳 Link</button>` : ""}
              ${["open","overdue"].includes(inv.status) ? `<button class="adm-btn adm-btn-success adm-btn-sm inv-paid" data-id="${inv.id}" title="Markeer als betaald">✓ Betaald</button>` : ""}
            </td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>`}
</div>`;

      document.getElementById("invStatusFilter")?.addEventListener("change", () => renderFacturen());
      // Rij-klik → factuur openen (knoppen in de rij behouden hun eigen actie)
      document.querySelectorAll(".inv-row").forEach(row => {
        row.addEventListener("click", e => {
          if (e.target.closest("button")) return;
          openFactuurDrawer(rows.find(i => i.id === row.dataset.id));
        });
      });
      document.querySelectorAll(".inv-edit").forEach(btn => {
        btn.addEventListener("click", () => openFactuurDrawer(rows.find(i => i.id === btn.dataset.id)));
      });
      document.querySelectorAll(".inv-pdf").forEach(btn => {
        btn.addEventListener("click", async () => {
          const inv = rows.find(i => i.id === btn.dataset.id);
          if (!inv) return;
          // Druk af volgens het (standaard) documentsjabloon van de klant.
          try {
            const r = await api("GET", `/documents/invoice/${inv.id}/render`);
            const w = window.open("", "_blank"); w.document.write(r.html); w.document.close();
          } catch (_) {
            let tenant = {};
            try { const t = await api("GET", "/settings"); tenant = t.tenant || {}; } catch (_) {}
            printInvoicePDF(inv, tenant); // fallback op de ingebouwde opmaak
          }
        });
      });
      document.querySelectorAll(".inv-peppol").forEach(btn => {
        btn.addEventListener("click", async () => {
          btn.disabled = true; const old = btn.textContent; btn.textContent = "Versturen…";
          try {
            const d = await api("POST", `/facturen/${btn.dataset.id}/peppol`, {});
            const via = d.provider === "mock" ? "mock-transport" : d.provider;
            window.showToast && window.showToast(`Verstuurd via Peppol (${via}) — status: ${d.status} · ref ${d.reference}`, "success");
            renderFacturen();
          } catch(e) {
            const extra = (e.errors && e.errors.length) ? "\n\n• " + e.errors.join("\n• ") : "";
            window.showToast && window.showToast("Peppol: " + e.message, "error");
            if (extra) window.showToast("Peppol-validatie:" + extra, "warning");
            btn.disabled = false; btn.textContent = old;
          }
        });
      });
      document.querySelectorAll(".inv-ubl").forEach(btn => {
        btn.addEventListener("click", async () => {
          try {
            const tok = window.wfpCore.token();
            const r = await fetch(`/api/tenants/${tenantId()}/facturen/${btn.dataset.id}/ubl`, { headers: { Authorization: "Bearer " + tok } });
            if (!r.ok) throw new Error("HTTP " + r.status);
            const xml = await r.text();
            const inv = rows.find(i => i.id === btn.dataset.id);
            const blob = new Blob([xml], { type: "application/xml" });
            const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = (inv?.number || btn.dataset.id) + ".xml"; a.click();
          } catch(e) { window.showToast && window.showToast("UBL-download fout: "+e.message, "error"); }
        });
      });
      document.querySelectorAll(".inv-paylink").forEach(btn => {
        btn.addEventListener("click", async () => {
          btn.disabled = true; const old = btn.textContent; btn.textContent = "…";
          try {
            const d = await api("POST", `/facturen/${btn.dataset.id}/payment-link`, {});
            let copied = false;
            try { await navigator.clipboard.writeText(d.url); copied = true; } catch(_){}
            const via = d.provider === "stripe" ? "Stripe" : "demo";
            window.showToast && window.showToast(`Betaallink (${via}) ${copied?"gekopieerd ✓":"aangemaakt"}: ${d.url}`, "success");
          } catch(e) { window.showToast && window.showToast("Fout: "+e.message, "error"); }
          btn.disabled = false; btn.textContent = old;
        });
      });
      document.querySelectorAll(".inv-paid").forEach(btn => {
        btn.addEventListener("click", async () => {
          if (!confirm(`Factuur als betaald markeren?`)) return;
          await api("PATCH", `/facturen/${btn.dataset.id}`, { status: "paid" });
          renderFacturen();
        });
      });
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:#dc2626">Fout: ${e.message}</div>`; }
  }

  async function openFactuurDrawer(invoice, prefill = {}) {
    // Load customers for dropdown
    let customers = [];
    try { const d = await api("GET", "/customers"); customers = d.customers || []; } catch(_){}

    document.getElementById("admDrawerTitle").textContent = invoice ? `Factuur ${invoice.number}` : "Nieuwe factuur";
    const today = new Date().toISOString().slice(0, 10);
    const due30 = new Date(Date.now() + 30*86400000).toISOString().slice(0, 10);

    const existingLines = invoice?.lines || prefill.prefillLines || [{ description: "", qty: 1, unitPrice: 0, vatRate: 21 }];

    document.getElementById("admDrawerBody").innerHTML = `
<form id="invForm">
  <div class="adm-form-group">
    <label>Klant *</label>
    <select name="customerId" id="invCustSel" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
      <option value="">— Handmatig invullen —</option>
      ${customers.map(c => `<option value="${c.id}" ${invoice?.customerId===c.id?"selected":""}>${esc(c.name)}</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-group" id="invCustNameWrap">
    <label>Klantnaam *</label>
    <input name="customerName" id="invCustName" value="${esc(invoice?.customerName||prefill.prefillCustomerName||"")}" placeholder="Bedrijfsnaam NV" required>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group">
      <label>BTW-nummer klant</label>
      <input name="customerVatNumber" value="${esc(invoice?.customerVatNumber||prefill.prefillCustomerVat||"")}" placeholder="BE0000.000.000">
    </div>
    <div class="adm-form-group">
      <label>Adres klant</label>
      <input name="customerAddress" value="${esc(invoice?.customerAddress||prefill.prefillCustomerAddress||"")}" placeholder="Straat, gemeente">
    </div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group">
      <label>Factuurdatum</label>
      <input type="date" name="invoiceDate" value="${invoice?.invoiceDate||today}">
    </div>
    <div class="adm-form-group">
      <label>Vervaldatum</label>
      <input type="date" name="dueDate" value="${invoice?.dueDate||due30}">
    </div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group">
      <label>BTW-regime</label>
      <select name="vatRegime" id="invVatRegime" ${invoice?"disabled":""}>
        <option value="binnen" ${(invoice?.vatRegime&&invoice.vatRegime!=="binnen")?"":"selected"}>Binnenland (btw per regel)</option>
        <option value="intracom" ${invoice?.vatRegime==="intracom"?"selected":""}>Intracommunautair — btw verlegd (0%)</option>
        <option value="medecontractant" ${invoice?.vatRegime==="medecontractant"?"selected":""}>Medecontractant (bouw, KB nr. 1 art. 20) — btw verlegd (0%)</option>
      </select>
    </div>
    <div class="adm-form-group" style="align-self:flex-end;padding-bottom:7px;font-size:11.5px;color:#64748b;">Bij 'btw verlegd' wordt 0% btw toegepast met de wettelijke vermelding op de factuur.</div>
  </div>
  ${invoice?.structuredComm ? `<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12.5px;">
    <span style="color:#64748b;">Gestructureerde mededeling:</span> <strong style="font-family:monospace;font-size:13px;">${esc(invoice.structuredComm)}</strong>
    ${invoice.vatNote ? `<div style="color:#92400e;margin-top:4px;">⚖ ${esc(invoice.vatNote)}</div>` : ""}
  </div>` : ""}

  <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin:14px 0 8px;">Factuurregels</div>
  <div id="invLines">
    ${existingLines.map((l, i) => renderInvLine(l, i)).join("")}
  </div>
  <button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" id="invAddLine" style="margin-bottom:16px;">+ Regel toevoegen</button>

  <div style="background:#f8fafc;border-radius:10px;padding:12px;margin-bottom:16px;" id="invTotals">
    <div style="display:flex;justify-content:space-between;font-size:13px;color:#64748b;margin-bottom:4px;">
      <span>Subtotaal</span><span id="invSubtotal">€0,00</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:13px;color:#64748b;margin-bottom:4px;">
      <span>BTW</span><span id="invVat">€0,00</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;color:#0f172a;border-top:1px solid #e2e8f0;padding-top:8px;margin-top:4px;">
      <span>Totaal</span><span id="invTotal">€0,00</span>
    </div>
  </div>

  <div class="adm-form-group">
    <label>Opmerkingen</label>
    <textarea name="notes" rows="2" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">${esc(invoice?.notes||prefill.prefillNotes||"")}</textarea>
  </div>
  ${prefill.workorderId ? `<input type="hidden" name="workorderId" value="${esc(prefill.workorderId)}">` : ""}
  <div id="invFormErr" style="display:none;background:#fef2f2;color:#dc2626;border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="invCancel">Annuleren</button>
    ${invoice && invoice.status !== "paid" ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="invDelete">🗑 Verwijderen</button>` : ""}
    ${!invoice ? `<button type="submit" class="adm-btn adm-btn-primary">Aanmaken</button>` : ""}
  </div>
</form>`;

    function renderInvLine(l, i) {
      return `<div class="inv-line-row" style="display:grid;grid-template-columns:1fr 60px 90px 60px 24px;gap:6px;align-items:center;margin-bottom:8px;" data-idx="${i}">
        <input placeholder="Omschrijving" value="${esc(l.description||"")}" class="inv-line-desc" style="padding:6px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;">
        <input type="number" min="1" placeholder="Qty" value="${l.qty||1}" class="inv-line-qty" style="padding:6px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;text-align:right;">
        <input type="number" min="0" step="0.01" placeholder="Prijs" value="${Number(l.unitPrice||0).toFixed(2)}" class="inv-line-price" style="padding:6px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;text-align:right;">
        <select class="inv-line-vat" style="padding:6px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;">
          <option value="0" ${l.vatRate==0?"selected":""}>0%</option>
          <option value="6" ${l.vatRate==6?"selected":""}>6%</option>
          <option value="12" ${l.vatRate==12?"selected":""}>12%</option>
          <option value="21" ${(l.vatRate==21||l.vatRate==null||l.vatRate==undefined)?"selected":""}>21%</option>
        </select>
        <button type="button" class="inv-line-del" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:16px;padding:0;" title="Verwijder">&times;</button>
      </div>`;
    }

    function recalc() {
      const reverseCharge = (document.getElementById("invVatRegime")?.value || "binnen") !== "binnen";
      const lines = document.querySelectorAll(".inv-line-row");
      let subtotal = 0, vatAmt = 0;
      lines.forEach(row => {
        const qty = Number(row.querySelector(".inv-line-qty").value||0);
        const price = Number(row.querySelector(".inv-line-price").value||0);
        const vat = Number(row.querySelector(".inv-line-vat").value||21);
        const ls = qty * price;
        subtotal += ls;
        vatAmt += reverseCharge ? 0 : ls * vat / 100;
      });
      document.getElementById("invSubtotal").textContent = fmtEurInv(subtotal);
      document.getElementById("invVat").textContent = fmtEurInv(vatAmt);
      document.getElementById("invTotal").textContent = fmtEurInv(subtotal + vatAmt);
    }
    document.getElementById("invVatRegime")?.addEventListener("change", recalc);

    function bindLineEvents() {
      document.querySelectorAll(".inv-line-qty,.inv-line-price,.inv-line-vat").forEach(el => {
        el.addEventListener("input", recalc);
      });
      document.querySelectorAll(".inv-line-del").forEach(btn => {
        btn.addEventListener("click", () => {
          if (document.querySelectorAll(".inv-line-row").length <= 1) return;
          btn.closest(".inv-line-row").remove();
          recalc();
        });
      });
    }
    bindLineEvents();
    recalc();

    // Customer select auto-fill
    document.getElementById("invCustSel")?.addEventListener("change", e => {
      const cust = customers.find(c => c.id === e.target.value);
      if (cust) {
        document.querySelector("[name=customerName]").value = cust.name || "";
        document.querySelector("[name=customerVatNumber]").value = cust.vatNumber || "";
        document.querySelector("[name=customerAddress]").value = cust.address || "";
      }
    });

    document.getElementById("invAddLine")?.addEventListener("click", () => {
      const lines = document.getElementById("invLines");
      const idx = lines.querySelectorAll(".inv-line-row").length;
      const div = document.createElement("div");
      div.innerHTML = renderInvLine({ description: "", qty: 1, unitPrice: 0, vatRate: 21 }, idx);
      lines.appendChild(div.firstElementChild);
      bindLineEvents(); recalc();
    });

    openDrawer();
    document.getElementById("invCancel").addEventListener("click", closeDrawer);

    document.getElementById("invDelete")?.addEventListener("click", async () => {
      if (!confirm(`Factuur ${invoice.number} verwijderen?`)) return;
      try {
        await api("DELETE", `/facturen/${invoice.id}`);
        closeDrawer(); renderFacturen();
      } catch(err) {
        const e = document.getElementById("invFormErr");
        if (e) { e.textContent = err.message; e.style.display = ""; }
      }
    });

    document.getElementById("invForm")?.addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = document.getElementById("invFormErr");
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      // Collect lines
      const lineRows = document.querySelectorAll(".inv-line-row");
      body.lines = Array.from(lineRows).map(row => ({
        description: row.querySelector(".inv-line-desc").value,
        qty: Number(row.querySelector(".inv-line-qty").value||1),
        unitPrice: Number(row.querySelector(".inv-line-price").value||0),
        vatRate: Number(row.querySelector(".inv-line-vat").value||21)
      }));
      try {
        await api("POST", "/facturen", body);
        closeDrawer(); renderFacturen();
        window.showToast && window.showToast("Factuur aangemaakt ✓", "success");
      } catch(err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = ""; }
      }
    });
  }

  // ── Roadmap ────────────────────────────────────────────────
  async function renderRoadmap() {
    const content = document.getElementById("admContent");
    content.innerHTML = `<div class="adm-loading">Roadmap laden…</div>`;
    try {
      const d = await api("GET", "/roadmap");
      const rm = d.roadmap || {};
      const phases = rm.phases || [];
      const phaseIcons = { foundation:"🏗️", core_operations:"⚙️", billing_compliance:"💳", pilot_launch:"🚀", commercial_launch:"🌐" };

      content.innerHTML = `
<div style="margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
  <div>
    <div style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:4px;">Roadmap — ${esc(rm.tenant?.name||"")}</div>
    <div style="font-size:13px;color:#64748b;">Gegenereerd op ${new Date(rm.generatedAt||Date.now()).toLocaleString("nl-BE")} · ${rm.summary?.go||0}/${rm.summary?.total||0} fasen gereed · ${rm.summary?.openActions||0} open acties</div>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="rmRefresh">🔄 Vernieuwen</button>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="rmBackfill" title="Herstel datakwaliteit: werkbon-nummers, notificatie-userId, verlof-dagen">🔧 Data repareren</button>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="rmDemoData" title="Vult alle schermen met realistische voorbeelddata (klanten, offertes, facturen, planning, klok…)">🎲 Demodata laden</button>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="rmDemoClear" title="Verwijdert alle geladen demodata weer">🧹 Demodata wissen</button>
  </div>
</div>

${phases.map(p => {
  const isGo = p.go;
  const icon = phaseIcons[p.key]||"📍";
  const isCurrent = p.key === rm.currentPhase;
  return `
<div style="margin-bottom:16px;border-radius:12px;border:2px solid ${isGo?"#d1fae5":isCurrent?"#fef3c7":"#f1f5f9"};overflow:hidden;">
  <div style="background:${isGo?"#d1fae5":isCurrent?"#fef3c7":"#f1f5f9"};padding:14px 18px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:20px;">${icon}</span>
    <div style="flex:1;">
      <div style="font-size:15px;font-weight:700;color:#0f172a;">${esc(p.label)}${isCurrent?` <span style="background:#f59e0b;color:#fff;border-radius:4px;font-size:10px;padding:1px 6px;font-weight:700;vertical-align:middle;margin-left:6px;">HUIDIGE FASE</span>`:""}</div>
      <div style="font-size:12px;color:#64748b;margin-top:2px;">${esc(p.detail||"")}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:22px;font-weight:700;color:${isGo?"#10b981":isCurrent?"#f59e0b":"#94a3b8"};">${p.score}%</div>
      <div style="font-size:11px;font-weight:600;color:${isGo?"#10b981":"#ef4444"};">${isGo?"✅ GO":"🔴 NO GO"}</div>
    </div>
  </div>
  <!-- Progress bar -->
  <div style="height:6px;background:#e2e8f0;">
    <div style="height:100%;width:${p.score}%;background:${isGo?"#10b981":isCurrent?"#f59e0b":"#6366f1"};transition:width .5s;"></div>
  </div>
  <!-- Open actions -->
  ${p.actions?.length ? `
  <div style="padding:12px 18px;">
    <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">${p.actions.length} OPEN ${p.actions.length===1?"ACTIE":"ACTIES"}</div>
    ${p.actions.map(a=>`
    <div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid #f8fafc;">
      <span style="background:${a.priority==="P0"?"#fee2e2":"#fef3c7"};color:${a.priority==="P0"?"#dc2626":"#92400e"};border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700;flex-shrink:0;height:fit-content;">${esc(a.priority||"P1")}</span>
      <div>
        <div style="font-size:13px;font-weight:600;color:#0f172a;">${esc(a.label||"")}</div>
        <div style="font-size:12px;color:#64748b;">${esc(a.action||"")}</div>
      </div>
    </div>`).join("")}
  </div>` : `<div style="padding:10px 18px;font-size:13px;color:#10b981;font-weight:600;">✓ Alle checks geslaagd</div>`}
</div>`;
}).join("")}`;
      document.getElementById("rmRefresh")?.addEventListener("click", () => renderRoadmap());
      document.getElementById("rmBackfill")?.addEventListener("click", async () => {
        const btn = document.getElementById("rmBackfill");
        btn.disabled = true; btn.textContent = "Bezig…";
        try {
          const r = await api("POST", "/admin/backfill");
          const res = r.results || {};
          window.showToast && window.showToast(
            `Data gerepareerd: ${res.workorderNumbers||0} werkbonnen genummerd, ${res.notificationUserIds||0} notificaties gelinkt, ${res.leaveDays||0} verloven bijgewerkt`,
            "success"
          );
          btn.disabled = false; btn.textContent = "🔧 Data repareren";
        } catch(e) { window.showToast && window.showToast("Fout: "+e.message,"error"); btn.disabled=false; btn.textContent="🔧 Data repareren"; }
      });
      document.getElementById("rmDemoData")?.addEventListener("click", async () => {
        if (!confirm("Dit vult álle schermen met realistische voorbeelddata: klanten, offertes, facturen, werkbonnen, planning, klokregistraties, verlof, onkosten, stock en voertuigen.\n\nJe kunt het achteraf weer wissen met 'Demodata wissen'. Doorgaan?")) return;
        const btn = document.getElementById("rmDemoData");
        btn.disabled = true; btn.textContent = "Laden…";
        try {
          const r = await api("POST", "/demo/seed");
          const total = Object.values(r.counts||{}).reduce((a,b)=>a+b,0);
          window.showToast && window.showToast(`Demodata geladen ✓ (${total} records over ${Object.keys(r.counts||{}).length} modules)`, "success");
          switchView("dashboard");
        } catch(e) { window.showToast && window.showToast("Fout: "+e.message, "error"); }
        btn.disabled = false; btn.textContent = "🎲 Demodata laden";
      });
      document.getElementById("rmDemoClear")?.addEventListener("click", async () => {
        if (!confirm("Alle geladen demodata verwijderen? Eigen ingevoerde data blijft staan.")) return;
        const btn = document.getElementById("rmDemoClear");
        btn.disabled = true; btn.textContent = "Wissen…";
        try {
          const r = await api("POST", "/demo/clear");
          window.showToast && window.showToast(`Demodata gewist ✓ (${r.removed} records)`, "success");
          renderRoadmap();
        } catch(e) { window.showToast && window.showToast("Fout: "+e.message, "error"); }
        btn.disabled = false; btn.textContent = "🧹 Demodata wissen";
      });
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:#dc2626">Fout: ${e.message}</div>`; }
  }

  // ── Facturatie ─────────────────────────────────────────────
  async function renderBilling() {
    const content = document.getElementById("admContent");
    content.innerHTML = `<div class="adm-loading"><div class="adm-spinner"></div>Laden…</div>`;
    try {
      const [sumData, plansData] = await Promise.all([
        api("GET", "/billing/summary"),
        api("GET", "/billing/plans").catch(() => ({ plans: [] })),
      ]);
      const billing = sumData.billing || {};
      const plans = plansData.plans || [];
      const invoices = (billing.invoiceHistory || []);
      const badge = document.getElementById("admInvoiceBadge");
      const openInvoices = invoices.filter(i => i.status === "open" || i.status === "overdue");
      if (badge) { badge.textContent = openInvoices.length; badge.style.display = openInvoices.length ? "" : "none"; }
      const fmtEur = n => new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(Number(n||0));
      const statusCss = { open:"adm-status-open", paid:"adm-status-goedgekeurd", overdue:"adm-status-inactive", draft:"adm-status-pending" };
      const currentPlan = String(billing.plan||"").toLowerCase();
      const hasPayment = !!billing.paymentMethod;

      content.innerHTML = `
<div class="adm-kpis" style="margin-bottom:16px">
  <div class="adm-kpi adm-kpi-green"><div class="adm-kpi-label">Huidig abonnement</div><div class="adm-kpi-value" style="font-size:18px;text-transform:capitalize">${esc(billing.plan||"—")}</div><div class="adm-kpi-sub">${esc(billing.status||"")}</div></div>
  <div class="adm-kpi adm-kpi-blue"><div class="adm-kpi-label">Maandprijs</div><div class="adm-kpi-value" style="font-size:20px">${fmtEur(billing.monthlyAmount||0)}</div><div class="adm-kpi-sub">excl. BTW</div></div>
  <div class="adm-kpi adm-kpi-purple"><div class="adm-kpi-label">Facturen</div><div class="adm-kpi-value">${invoices.length}</div><div class="adm-kpi-sub">${openInvoices.length} openstaand</div></div>
  <div class="adm-kpi ${hasPayment?"adm-kpi-green":"adm-kpi-amber"}"><div class="adm-kpi-label">Betaalmethode</div><div class="adm-kpi-value" style="font-size:15px">${hasPayment?esc(billing.paymentMethod):"Niet ingesteld"}</div></div>
</div>

${billing.status === "trial" ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
  <span style="font-size:20px">⏳</span>
  <div>
    <div style="font-size:14px;font-weight:600;color:#92400e">Gratis proefperiode actief</div>
    <div style="font-size:12px;color:#a16207;margin-top:2px">Kies hieronder je bundel en voeg een betaalmethode toe voor een naadloze overgang.</div>
  </div>
</div>` : ""}

<!-- Bundel kiezen -->
<div class="adm-card">
  <div class="adm-card-header"><h3 class="adm-card-title">Kies je bundel</h3></div>
  <div class="adm-card-body">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
      ${plans.map(p => {
        const isCurrent = p.key === currentPlan;
        return `<div style="border:2px solid ${isCurrent?"#2563EB":"#E2E8F0"};border-radius:12px;padding:16px;position:relative;display:flex;flex-direction:column;gap:8px;">
          ${isCurrent?`<span style="position:absolute;top:-10px;left:14px;background:#2563EB;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:999px;">HUIDIG</span>`:""}
          <div style="font-size:16px;font-weight:700;color:#0F172A;">${esc(p.label)}</div>
          <div style="font-size:22px;font-weight:800;color:#0F172A;">${p.custom?"Op maat":fmtEur(p.baseMonthly)+"<span style='font-size:12px;font-weight:500;color:#94A3B8'>/mnd</span>"}</div>
          <div style="font-size:11.5px;color:#94A3B8;">${p.custom?"Jaarcontract & SLA":`incl. ${p.includedSeats} gebruikers · +${fmtEur(Math.round(p.seatAnnual/12))}/extra`}</div>
          <ul style="list-style:none;padding:0;margin:6px 0;display:flex;flex-direction:column;gap:4px;flex:1;">
            ${(p.features||[]).map(f=>`<li style="font-size:12px;color:#374151;">✓ ${esc(f)}</li>`).join("")}
          </ul>
          ${isCurrent
            ? `<button class="adm-btn adm-btn-secondary adm-btn-sm" disabled style="opacity:.6;cursor:default;">Huidig plan</button>`
            : p.custom
              ? `<button class="adm-btn adm-btn-secondary adm-btn-sm bill-contact">Contacteer ons</button>`
              : `<button class="adm-btn adm-btn-primary adm-btn-sm bill-select" data-plan="${p.key}">Kies ${esc(p.label)}</button>`}
        </div>`;
      }).join("")}
    </div>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="billPortal">⚙️ Abonnement &amp; betaalmethode beheren</button>
      <span style="font-size:12px;color:#94A3B8;">Veilig betalen — je betaalgegevens worden door onze betaalpartner (Stripe) verwerkt. Upgraden, downgraden, betaalmethode en opzeggen regel je in het beheerportaal.</span>
    </div>
  </div>
</div>

<!-- Add-ons (optionele betaalde extra's) -->
<div class="adm-card" id="billAddonsCard" style="margin-top:16px;display:none;">
  <div class="adm-card-header"><h3 class="adm-card-title">Add-ons</h3></div>
  <div class="adm-card-body" id="billAddons"></div>
</div>

<!-- Factuurgeschiedenis -->
<div class="adm-card" style="margin-top:16px;">
  <div class="adm-card-header"><h3 class="adm-card-title">Factuurgeschiedenis</h3></div>
  ${invoices.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-icon">🧾</div><div class="adm-empty-text">Nog geen facturen</div></div>`
    : `<div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>Factuur #</th><th>Datum</th><th>Vervaldatum</th><th>Omschrijving</th><th>Bedrag</th><th>Status</th></tr></thead>
        <tbody>${invoices.map(i => `<tr>
          <td style="font-family:monospace;font-weight:600">${esc(i.number||i.id.slice(-6))}</td>
          <td>${i.date ? new Date(i.date).toLocaleDateString("nl-BE") : "—"}</td>
          <td>${i.dueDate ? new Date(i.dueDate).toLocaleDateString("nl-BE") : "—"}</td>
          <td>${esc(i.description||i.title||"Abonnement Monargo One")}</td>
          <td style="font-weight:600">${fmtEur(i.amount)}</td>
          <td><span class="adm-status ${statusCss[i.status]||"adm-status-pending"}">${esc(i.status||"—")}</span></td>
        </tr>`).join("")}</tbody>
      </table></div>`}
</div>`;

      // Bundel kiezen → echte Stripe Checkout (mode=subscription). Zonder live
      // Stripe-sleutel geeft de server een mock-URL terug en is het plan meteen actief.
      content.querySelectorAll(".bill-select").forEach(btn => {
        btn.addEventListener("click", async () => {
          const plan = btn.dataset.plan;
          if (!confirm(`Overschakelen naar het ${plan}-abonnement? Je wordt naar de beveiligde betaalpagina geleid.`)) return;
          btn.disabled = true; btn.textContent = "Bezig…";
          try {
            const r = await api("POST", "/billing/checkout", { plan });
            if (r.provider === "stripe" && r.url) { window.location.href = r.url; return; }
            window.showToast && window.showToast(`Abonnement geactiveerd (${plan}) ✓`, "success");
            renderBilling();
          } catch(e) { window.showToast && window.showToast(e.message, "error"); btn.disabled = false; btn.textContent = "Kies"; }
        });
      });
      content.querySelectorAll(".bill-contact").forEach(btn => {
        btn.addEventListener("click", () => window.showToast && window.showToast("Voor Enterprise maken we een offerte op maat. Neem contact op via je accountmanager of support.", "info"));
      });
      // Self-service beheer via Stripe Billing Portal (upgrade/downgrade/opzeggen/betaalmethode).
      document.getElementById("billPortal")?.addEventListener("click", async () => {
        try {
          const r = await api("POST", "/billing/portal", {});
          if (r.provider === "stripe" && r.url) { window.location.href = r.url; return; }
          window.showToast && window.showToast("Het beheerportaal is beschikbaar zodra betalingen live staan (Stripe-sleutel geconfigureerd).", "info");
        } catch(e) { window.showToast && window.showToast(e.message, "error"); }
      });

      // Add-ons: optionele betaalde extra's. Toon prijs + of de organisatie ze al heeft
      // (entitlements uit /me). Aanvragen loopt via support/beheerder (geen self-grant).
      (async function loadAddons() {
        let addons = [];
        try { addons = ((await (await fetch("/api/plans")).json()).addons || []).filter(a => a.monthly != null); } catch (_) { return; }
        if (!addons.length) return;
        const active = new Set((window._wfpEnt && window._wfpEnt.modules) || []);
        const card = document.getElementById("billAddonsCard");
        const body = document.getElementById("billAddons");
        if (!card || !body) return;
        card.style.display = "";
        body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;">
          ${addons.map(a => {
            const has = active.has(a.key);
            return `<div style="border:1.5px solid ${has ? "#16a34a" : "#E2E8F0"};border-radius:12px;padding:14px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                <strong style="font-size:14px;color:#0F172A;">${esc(a.label)}</strong>
                ${has ? `<span style="font-size:10px;font-weight:700;background:#dcfce7;color:#15803d;border-radius:999px;padding:2px 8px;">ACTIEF</span>` : ""}
              </div>
              <div style="font-size:20px;font-weight:800;color:#0F172A;margin:6px 0;">€${a.monthly}<span style="font-size:12px;font-weight:500;color:#94A3B8;">/mnd</span></div>
              <div style="font-size:12px;color:#64748B;min-height:32px;">${esc(a.description)}</div>
              ${has
                ? `<button class="adm-btn adm-btn-secondary adm-btn-sm" disabled style="opacity:.6;width:100%;margin-top:8px;">Inbegrepen</button>`
                : `<button class="adm-btn adm-btn-primary adm-btn-sm addon-request" data-addon="${esc(a.label)}" style="width:100%;margin-top:8px;">Aanvragen</button>`}
            </div>`;
          }).join("")}
        </div>
        <div style="font-size:11.5px;color:#94A3B8;margin-top:10px;">Add-ons worden door je accountbeheerder of support geactiveerd. Neem contact op om een add-on toe te voegen.</div>`;
        body.querySelectorAll(".addon-request").forEach(btn => btn.addEventListener("click", () =>
          window.showToast && window.showToast(`Bedankt! Vraag '${btn.dataset.addon}' aan via je accountmanager of support — wij activeren het voor je organisatie.`, "info")));
      })();
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:#dc2626">Fout: ${e.message}</div>`; }
  }

  // ── Settings ───────────────────────────────────────────────
  // ── Integraties (Exact Online, Robaws, …) ─────────────────────
  async function renderIntegraties() {
    const content = document.getElementById("admContent");
    content.innerHTML = `<div class="adm-loading">Laden…</div>`;
    let data = { rows: [], providers: [] };
    try { data = await api("GET", "/integrations"); }
    catch (e) { content.innerHTML = `<div class="adm-card"><div class="adm-card-body">${esc(e.message)}</div></div>`; return; }
    const providers = data.providers || [];
    const byProvider = Object.fromEntries((data.rows || []).map(r => [r.provider, r]));
    const fmtDT = s => s ? new Date(s).toLocaleString("nl-BE") : "—";

    const providerCard = p => {
  const conn = byProvider[p.key];
  const ss = (conn && conn.syncSummary) || {};
  return `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">${esc(p.label)} <span style="font-weight:400;font-size:12px;color:#94a3b8">· ${esc(p.category)}</span></h3>
    <span class="adm-status adm-status-${conn ? (conn.status === "connected" ? "active" : "inactive") : "pending"}">${conn ? esc(conn.status) : "niet verbonden"}</span>
  </div>
  <div class="adm-card-body">
    <p style="font-size:13px;color:#64748b;margin-bottom:12px">${esc(p.description)}${p.docs ? ` · <a href="${esc(p.docs)}" target="_blank" rel="noopener">documentatie</a>` : ""}</p>
    ${conn ? `
      <div style="font-size:13px;color:#475569;margin-bottom:10px">
        Laatste sync: ${fmtDT(conn.lastSyncAt)}${ss.lastStatus ? ` · ${esc(ss.lastStatus)}` : ""}<br>
        ${ss.total || 0} sync(s), ${ss.failed || 0} mislukt${conn.hasSecret ? "" : " · ⚠️ geen sleutel ingesteld"}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="adm-btn adm-btn-primary adm-btn-sm" data-sync="${esc(conn.id)}">↻ Nu synchroniseren</button>
        ${p.key === "robaws" ? `<button class="adm-btn adm-btn-secondary adm-btn-sm" data-syncdocs="${esc(conn.id)}">📁 Werf-documenten synchroniseren</button>` : ""}
        <button class="adm-btn adm-btn-secondary adm-btn-sm" data-reconnect="${esc(p.key)}">Sleutel bijwerken</button>
      </div>
    ` : `
      <form data-connect="${esc(p.key)}">
        ${p.fields.map(f => `<div class="adm-form-group"><label>${esc(f.label)}${f.secret ? "" : ""}</label><input name="${esc(f.key)}" type="${f.secret ? "password" : "text"}" placeholder="${esc(f.placeholder || "")}" value="${esc(f.default || "")}" ${f.secret ? 'autocomplete="off"' : ""}></div>`).join("")}
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary adm-btn-sm">Verbinden</button></div>
      </form>
    `}
  </div>
</div>`;
    };
    const categories = [...new Set(providers.map(p => p.category))];
    content.innerHTML = `
<div style="font-size:13px;color:#64748b;margin-bottom:14px">Koppel je boekhouding en werfsoftware. Sleutels worden versleuteld bewaard; zonder geldige sleutel draait een sync in testmodus.</div>
<div class="adm-card" style="margin-bottom:16px;background:#f0f9ff;border:1px solid #bae6fd"><div class="adm-card-body" style="font-size:13px;color:#075985">ℹ️ <strong>Compliance-aangiftes</strong> (Checkin@Work / CIAW en Limosa) verlopen <strong>automatisch</strong> bij in-/uitklokken — die beheer je niet hier maar onder <strong>Compliance → Checkin@Work</strong> en <strong>A1 / Limosa</strong>.</div></div>
${categories.map(cat => `
  <div class="adm-nav-label" style="margin:18px 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#64748b">${esc(cat)}</div>
  <div class="adm-grid-2">${providers.filter(p => p.category === cat).map(providerCard).join("")}</div>
`).join("")}`;

    content.querySelectorAll("form[data-connect]").forEach(form => {
      form.addEventListener("submit", async e => {
        e.preventDefault();
        const provider = form.dataset.connect;
        const meta = providers.find(p => p.key === provider) || { fields: [] };
        const fd = Object.fromEntries(new FormData(form).entries());
        const body = { provider, apiKey: fd.apiKey || "", baseUrl: fd.baseUrl || "", config: {} };
        (meta.fields || []).forEach(f => { if (!f.secret && f.key !== "apiKey" && f.key !== "baseUrl" && fd[f.key]) body.config[f.key] = fd[f.key]; });
        try { await api("POST", "/integrations/connect", body); window.showToast && window.showToast(`${meta.label || provider} verbonden ✓`, "success"); renderIntegraties(); }
        catch (err) { window.showToast && window.showToast(err.message, "error"); }
      });
    });
    content.querySelectorAll("[data-sync]").forEach(btn => btn.addEventListener("click", async () => {
      btn.disabled = true; btn.textContent = "Bezig…";
      try {
        const r = await api("POST", `/integrations/${btn.dataset.sync}/sync`, {});
        const ok = r.result && r.result.log && r.result.log.status === "success";
        window.showToast && window.showToast(ok ? "Synchronisatie voltooid ✓" : "Sync mislukt — controleer sleutel/mapping", ok ? "success" : "error");
        renderIntegraties();
      } catch (e) { window.showToast && window.showToast(e.message, "error"); btn.disabled = false; btn.textContent = "↻ Nu synchroniseren"; }
    }));
    content.querySelectorAll("[data-syncdocs]").forEach(btn => btn.addEventListener("click", async () => {
      btn.disabled = true; const orig = btn.textContent; btn.textContent = "Bezig…";
      try {
        const r = await api("POST", `/integrations/${btn.dataset.syncdocs}/sync-documents`, {});
        const t = r.result && r.result.manifest && r.result.manifest.totals;
        window.showToast && window.showToast(t ? `Werf-documenten gesynchroniseerd ✓ (${t.projects} projecten, ${t.documents} docs)` : "Document-sync voltooid ✓", "success");
        renderIntegraties();
      } catch (e) { window.showToast && window.showToast(e.message, "error"); btn.disabled = false; btn.textContent = orig; }
    }));
    content.querySelectorAll("[data-reconnect]").forEach(btn => btn.addEventListener("click", async () => {
      const p = providers.find(x => x.key === btn.dataset.reconnect) || {};
      const key = window.prompt(`Nieuwe ${p.label || "API"}-sleutel/token:`);
      if (key == null || !key.trim()) return;
      try { await api("POST", "/integrations/connect", { provider: p.key, apiKey: key.trim() }); window.showToast && window.showToast("Sleutel bijgewerkt ✓", "success"); renderIntegraties(); }
      catch (e) { window.showToast && window.showToast(e.message, "error"); }
    }));
  }

  async function renderSettings() {
    const content = document.getElementById("admContent");
    content.innerHTML = `<div class="adm-loading">Laden…</div>`;
    let tenant = {};
    try {
      const res = await api("GET", "/settings");
      tenant = res.tenant || {};
    } catch (_) {}

    content.innerHTML = `
<div class="adm-grid-2">
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">Bedrijfsgegevens</h3></div>
    <div class="adm-card-body">
      <form id="admOrgForm">
        <div class="adm-form-group"><label>Bedrijfsnaam</label>
          <input name="name" value="${esc(tenant.name || "")}" placeholder="Naam organisatie">
        </div>
        <div class="adm-form-group"><label>BTW-nummer</label>
          <input name="vatNumber" value="${esc(tenant.vatNumber || "")}" placeholder="BE0000.000.000">
        </div>
        <div class="adm-form-group"><label>Adres</label>
          <input name="address" value="${esc(tenant.address || "")}" placeholder="Straat + nr, gemeente">
        </div>
        <div class="adm-form-row">
          <div class="adm-form-group"><label>Contact e-mail</label>
            <input name="contactEmail" type="email" value="${esc(tenant.contactEmail || "")}" placeholder="info@bedrijf.be">
          </div>
          <div class="adm-form-group"><label>Telefoon</label>
            <input name="phone" value="${esc(tenant.phone || "")}" placeholder="+32 ...">
          </div>
        </div>
        <div class="adm-form-group"><label>Standaard-uurtarief (€)</label>
          <input name="defaultHourlyRate" type="number" step="1" min="0" value="${tenant.defaultHourlyRate ?? ""}" placeholder="bv. 55 — gebruikt voor werkbonnen zonder eigen tarief">
        </div>
        <div id="admOrgMsg" style="display:none;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;"></div>
        <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;margin:4px 0 8px;cursor:pointer;">
          <input type="checkbox" id="admEmailNotif" ${tenant.notificationPrefs?.emailEnabled === false ? "" : "checked"}>
          E-mailnotificaties versturen (belangrijke meldingen naar betrokkenen)
        </label>
        <div style="display:flex;align-items:center;gap:10px;margin:0 0 12px;flex-wrap:wrap;">
          <button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" id="admPushToggle">🔔 Pushmeldingen op dit toestel</button>
          <span id="admPushStatus" style="font-size:12px;color:#94a3b8;"></span>
        </div>
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">Opslaan</button></div>
      </form>
    </div>
  </div>
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">Abonnement &amp; plan</h3></div>
    <div class="adm-card-body">
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:#64748b;">Huidig plan</span>
          <strong style="text-transform:capitalize;">${esc(tenant.plan || "—")}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:#64748b;">Status</span>
          <span class="adm-status adm-status-${tenant.status === "active" ? "active" : tenant.status === "trial" ? "pending" : "inactive"}">${esc(tenant.status || "—")}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:#64748b;">Facturatie e-mail</span>
          <span>${esc(tenant.billingEmail || "—")}</span>
        </div>
        <hr style="border:none;border-top:1px solid #f1f5f9;margin:4px 0;">
        <button class="adm-btn adm-btn-secondary" id="admSettingsToBilling" style="width:100%;">Factuurgeschiedenis bekijken</button>
      </div>
    </div>
  </div>
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">Beveiliging — MFA</h3></div>
    <div class="adm-card-body">
      <div id="admMfaStatus" style="margin-bottom:12px;font-size:13px;color:#64748b;">Status laden…</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="adm-btn adm-btn-primary" id="admMfaSetup">🔐 MFA instellen</button>
        <button class="adm-btn adm-btn-secondary" id="admMfaEnforce">🛡️ MFA verplichten voor beheerders</button>
        <button class="adm-btn adm-btn-secondary" id="admMfaDisable" style="display:none;">MFA uitschakelen</button>
      </div>
      <div style="font-size:11.5px;color:#94A3B8;margin-top:8px;">MFA verplichten schakelt 2FA in voor álle beheerders. Bij de volgende login is een authenticator-code vereist. Bewaar de getoonde codes goed.</div>
      <div id="admMfaWizard" style="display:none;margin-top:16px;background:#f8fafc;border-radius:10px;padding:16px;"></div>
    </div>
  </div>
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">Data & Backup</h3></div>
    <div class="adm-card-body">
      <p style="font-size:13px;color:#64748b;margin-bottom:12px;">Maak een volledige backup van alle tenantdata en download als JSON-bestand.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="adm-btn adm-btn-secondary" id="admBackupCreate">📦 Backup aanmaken</button>
        <button class="adm-btn adm-btn-secondary" id="admBackupList">📋 Bestaande backups</button>
      </div>
      <div id="admBackupResult" style="margin-top:12px;"></div>
    </div>
  </div>
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">Wachtwoord wijzigen</h3></div>
    <div class="adm-card-body">
      <form id="admPwForm">
        <div class="adm-form-group"><label>Huidig wachtwoord</label>
          <input name="currentPassword" type="password" required autocomplete="current-password">
        </div>
        <div class="adm-form-group"><label>Nieuw wachtwoord</label>
          <input name="newPassword" type="password" required autocomplete="new-password" minlength="8">
        </div>
        <div id="admPwMsg" style="display:none;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;"></div>
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">Wijzigen</button></div>
      </form>
    </div>
  </div>
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">Support-toegang (GDPR)</h3></div>
    <div class="adm-card-body">
      <p style="font-size:13px;color:#64748b;margin-bottom:12px;">
        Geef je toestemming dan kan een supportmedewerker tijdelijk inloggen en je sessie overnemen om je te helpen.
        De toegang is tijdgebonden, wordt volledig geaudit, en je ziet een banner zolang een sessie actief is.
        Je kunt de toestemming op elk moment intrekken — een lopende sessie stopt dan meteen.
      </p>
      <div id="admSupportStatus" style="font-size:13px;margin-bottom:12px;"></div>
      <div class="adm-form-group" id="admSupportReasonWrap">
        <label>Reden / context (optioneel)</label>
        <input id="admSupportReason" placeholder="bv. hulp bij facturatie-instelling">
        <label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:13px;color:#475569;cursor:pointer;">
          <input type="checkbox" id="admSupportAutoRenew" checked>
          Automatisch verlengen — blijft jaarlijks staan, je krijgt jaarlijks een mededeling per e-mail
        </label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="adm-btn adm-btn-primary" id="admSupportAllow">✅ Support-toegang toestaan</button>
        <button class="adm-btn adm-btn-secondary" id="admSupportRevoke" style="display:none;">⛔ Toestemming intrekken</button>
      </div>
      <div id="admSupportMsg" style="display:none;padding:8px 12px;border-radius:8px;font-size:13px;margin-top:10px;"></div>
    </div>
  </div>
  <div class="adm-card" id="admSsoCard" style="display:none;grid-column:1/-1;">
    <div class="adm-card-header"><h3 class="adm-card-title">Single Sign-On (SAML) <span style="font-size:11px;background:#eef2ff;color:#4338ca;border-radius:999px;padding:2px 8px;vertical-align:middle;">Add-on</span></h3></div>
    <div class="adm-card-body" id="admSsoBody"><div class="adm-loading">Laden…</div></div>
  </div>
</div>`;

    // ── Support-toegang (GDPR consent) ──
    function renderSupportConsent(sa) {
      const allowed = sa && sa.allowed === true;
      const statusEl = document.getElementById("admSupportStatus");
      const allowBtn = document.getElementById("admSupportAllow");
      const revokeBtn = document.getElementById("admSupportRevoke");
      const reasonWrap = document.getElementById("admSupportReasonWrap");
      if (!statusEl) return;
      if (allowed) {
        const renew = sa.autoRenew !== false;
        const review = sa.reviewDueAt ? new Date(sa.reviewDueAt).toLocaleDateString("nl-BE") : null;
        statusEl.innerHTML = `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#d1fae5;color:#065f46;font-weight:600;">Toegestaan</span>`
          + (sa.allowedBy ? ` <span style="color:#64748b;">door ${esc(sa.allowedBy)}${sa.allowedAt ? " · " + new Date(sa.allowedAt).toLocaleString("nl-BE") : ""}</span>` : "")
          + `<div style="color:#64748b;margin-top:6px;">${renew ? "🔁 Verlengt jaarlijks automatisch" : "Geen automatische verlenging"}${renew && review ? ` · volgende mededeling ${review}` : ""}</div>`;
        allowBtn.style.display = "none";
        revokeBtn.style.display = "";
        reasonWrap.style.display = "none";
      } else {
        statusEl.innerHTML = `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#f1f5f9;color:#475569;font-weight:600;">Niet toegestaan</span> <span style="color:#64748b;">support kan niet inloggen</span>`;
        allowBtn.style.display = "";
        revokeBtn.style.display = "none";
        reasonWrap.style.display = "";
      }
    }
    function admSupportMsg(text, ok) {
      const m = document.getElementById("admSupportMsg");
      if (!m) return;
      m.style.cssText = `display:block;padding:8px 12px;border-radius:8px;font-size:13px;margin-top:10px;background:${ok ? "#d1fae5" : "#fee2e2"};color:${ok ? "#065f46" : "#dc2626"};`;
      m.textContent = text;
    }
    document.getElementById("admSupportAllow")?.addEventListener("click", async () => {
      const reason = document.getElementById("admSupportReason")?.value || "";
      const autoRenew = document.getElementById("admSupportAutoRenew")?.checked !== false;
      try {
        const r = await api("POST", "/support-access", { allowed: true, reason, autoRenew });
        renderSupportConsent(r.tenant?.supportAccess || { allowed: true });
        admSupportMsg("Support-toegang toegestaan ✓", true);
      } catch (e) { admSupportMsg(e.message, false); }
    });
    document.getElementById("admSupportRevoke")?.addEventListener("click", async () => {
      try {
        const r = await api("POST", "/support-access/end", {});
        renderSupportConsent(r.tenant?.supportAccess || { allowed: false });
        admSupportMsg("Toestemming ingetrokken. Een lopende sessie is gestopt.", true);
      } catch (e) { admSupportMsg(e.message, false); }
    });
    renderSupportConsent(tenant.supportAccess || { allowed: false });

    // ── SSO (SAML) add-on: enkel tonen als de tenant het entitlement heeft ──
    // We proberen de config te laden; bij 403 (geen add-on) blijft de kaart verborgen.
    (async function loadSsoCard() {
      let sso;
      try { const r = await api("GET", "/sso/config"); sso = r.sso; }
      catch (_) { return; } // niet geëntitleerd → kaart blijft verborgen
      const card = document.getElementById("admSsoCard");
      const body = document.getElementById("admSsoBody");
      if (!card || !body) return;
      card.style.display = "";
      function paint(cfg) {
        body.innerHTML = `
          <p style="font-size:13px;color:#64748b;margin-bottom:12px;">
            Laat je medewerkers inloggen via jullie identiteitsprovider (Azure AD, Okta, Google Workspace…).
            Configureer hieronder de IdP-gegevens en geef onderstaande SP-URL's in bij je IdP.
          </p>
          <div style="background:#f8fafc;border-radius:8px;padding:10px 12px;font-size:12px;margin-bottom:14px;word-break:break-all;">
            <div><strong>ACS / Reply URL:</strong> ${esc(cfg.acsUrl)}</div>
            <div><strong>Entity ID / Issuer:</strong> ${esc(cfg.issuer)}</div>
            <div><strong>SP-metadata:</strong> <a href="${esc(cfg.metadataUrl)}" target="_blank" rel="noopener">${esc(cfg.metadataUrl)}</a></div>
          </div>
          <form id="admSsoForm">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:12px;cursor:pointer;">
              <input type="checkbox" name="enabled" ${cfg.enabled ? "checked" : ""}> SSO inschakelen voor deze organisatie
            </label>
            <div class="adm-form-group"><label>IdP login-URL (SSO endpoint)</label>
              <input name="entryPoint" value="${esc(cfg.entryPoint || "")}" placeholder="https://login.microsoftonline.com/.../saml2"></div>
            <div class="adm-form-group"><label>IdP X.509-certificaat (PEM)</label>
              <textarea name="idpCert" rows="4" placeholder="-----BEGIN CERTIFICATE-----" style="font-family:monospace;font-size:11px;">${esc(cfg.idpCert || "")}</textarea></div>
            <div class="adm-form-group"><label>E-maildomeinen (komma-gescheiden)</label>
              <input name="domains" value="${esc((cfg.domains || []).join(", "))}" placeholder="bedrijf.be, bedrijf.com"></div>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin:8px 0;cursor:pointer;">
              <input type="checkbox" name="jitEnabled" ${cfg.jit && cfg.jit.enabled ? "checked" : ""}> Just-in-time provisioning (account automatisch aanmaken bij eerste SSO-login)
            </label>
            <div class="adm-form-group"><label>Standaardrol bij JIT</label>
              <select name="jitRole">
                <option value="employee" ${cfg.jit && cfg.jit.defaultRole === "employee" ? "selected" : ""}>Medewerker</option>
                <option value="manager" ${cfg.jit && cfg.jit.defaultRole === "manager" ? "selected" : ""}>Manager</option>
              </select></div>
            <div id="admSsoMsg" style="display:none;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;"></div>
            <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">SSO-instellingen opslaan</button></div>
          </form>`;
        document.getElementById("admSsoForm").addEventListener("submit", async e => {
          e.preventDefault();
          const f = e.target;
          const msg = document.getElementById("admSsoMsg");
          const payload = {
            enabled: f.elements.enabled.checked,
            entryPoint: f.elements.entryPoint.value.trim(),
            idpCert: f.elements.idpCert.value.trim(),
            domains: f.elements.domains.value.split(",").map(s => s.trim()).filter(Boolean),
            jit: { enabled: f.elements.jitEnabled.checked, defaultRole: f.elements.jitRole.value }
          };
          try {
            const r = await api("PUT", "/sso/config", payload);
            msg.style.cssText = "display:block;background:#d1fae5;color:#065f46;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;";
            msg.textContent = "SSO-instellingen opgeslagen ✓";
            paint(r.sso);
          } catch (err) {
            msg.style.cssText = "display:block;background:#fee2e2;color:#dc2626;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;";
            msg.textContent = err.message;
          }
        });
      }
      paint(sso);
    })();

    // Save company settings
    document.getElementById("admOrgForm").addEventListener("submit", async e => {
      e.preventDefault();
      const msgEl = document.getElementById("admOrgMsg");
      const body = Object.fromEntries(new FormData(e.target).entries());
      // Voorkom dat de push-toggle-knop als formulierveld wordt meegestuurd.
      delete body.admPushToggle;
      body.notificationPrefs = { emailEnabled: document.getElementById("admEmailNotif")?.checked !== false };
      try {
        await api("PATCH", "/settings", body);
        msgEl.style.cssText = "display:block;background:#d1fae5;color:#065f46;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;";
        msgEl.textContent = "Instellingen opgeslagen ✓";
        setTimeout(() => { msgEl.style.display = "none"; }, 3000);
      } catch (err) {
        msgEl.style.cssText = "display:block;background:#fee2e2;color:#dc2626;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;";
        msgEl.textContent = err.message;
      }
    });

    (async () => {
      const btn = document.getElementById("admPushToggle");
      const status = document.getElementById("admPushStatus");
      if (!btn || !status) return;
      if (!window.wfpPush) {
        btn.disabled = true;
        status.textContent = "Push niet beschikbaar";
        return;
      }
      async function paint() {
        const s = await window.wfpPush.status();
        if (!s.supported) {
          btn.disabled = true;
          status.textContent = "Browser ondersteunt geen push";
          return;
        }
        btn.textContent = s.subscribed ? "Pushmeldingen uitschakelen" : "Pushmeldingen inschakelen";
        status.textContent = s.subscribed ? "Actief op dit toestel" : (s.permission === "denied" ? "Geblokkeerd in browser" : "Niet actief");
      }
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        status.textContent = "Bezig...";
        try {
          const s = await window.wfpPush.status();
          if (s.subscribed) await window.wfpPush.disable();
          else await window.wfpPush.enable();
          await paint();
        } catch (err) {
          status.textContent = err.message || "Push kon niet worden aangepast";
        } finally {
          btn.disabled = false;
        }
      });
      await paint();
    })();

    // Change password
    document.getElementById("admSettingsToBilling")?.addEventListener("click", () => switchView("billing"));

    document.getElementById("admPwForm").addEventListener("submit", async e => {
      e.preventDefault();
      const msgEl = document.getElementById("admPwMsg");
      const { currentPassword, newPassword } = Object.fromEntries(new FormData(e.target).entries());
      try {
        await api("POST", "/auth/change-password", { currentPassword, newPassword });
        msgEl.style.cssText = "display:block;background:#d1fae5;color:#065f46;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;";
        msgEl.textContent = "Wachtwoord gewijzigd ✓";
        e.target.reset();
        setTimeout(() => { msgEl.style.display = "none"; }, 3000);
      } catch (err) {
        msgEl.style.cssText = "display:block;background:#fee2e2;color:#dc2626;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;";
        msgEl.textContent = err.message;
      }
    });

    // Load MFA status
    (async () => {
      try {
        const meData = await api("GET", "/me");
        const u = meData.user || {};
        const statusEl = document.getElementById("admMfaStatus");
        const disableBtn = document.getElementById("admMfaDisable");
        const setupBtn = document.getElementById("admMfaSetup");
        if (u.mfaEnabled) {
          if (statusEl) statusEl.innerHTML = `<span style="color:#10b981;font-weight:600;">✅ MFA actief</span> — uw account is beveiligd met 2FA.`;
          if (disableBtn) disableBtn.style.display = "";
          if (setupBtn) setupBtn.textContent = "🔄 MFA opnieuw instellen";
        } else {
          if (statusEl) statusEl.innerHTML = `<span style="color:#f59e0b;font-weight:600;">⚠️ MFA niet actief</span> — wij raden sterk aan om MFA in te schakelen.`;
        }
      } catch(_){}
    })();

    document.getElementById("admMfaSetup")?.addEventListener("click", async () => {
      const wizard = document.getElementById("admMfaWizard");
      if (!wizard) return;
      wizard.style.display = "block";
      wizard.innerHTML = `<div style="font-size:13px;color:#64748b;">Setup laden…</div>`;
      try {
        const data = await api("POST", "/me/mfa/setup");
        const setup = data.setup || {};
        wizard.innerHTML = `
<div style="font-size:14px;font-weight:600;margin-bottom:12px;">MFA instellen — stap 1 van 2</div>
<p style="font-size:13px;color:#64748b;margin-bottom:10px;">Voeg dit account toe in Google Authenticator, Authy of een andere TOTP-app via <strong>handmatige invoer</strong>:</p>
<div style="margin-bottom:14px;">
  <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.4px;">Geheime sleutel</div>
  <div style="font-family:monospace;background:#f1f5f9;padding:10px 12px;border-radius:8px;font-size:15px;margin-top:4px;word-break:break-all;letter-spacing:1px;text-align:center;">${esc(setup.secret||"")}</div>
  <div style="font-size:11px;color:#94a3b8;margin-top:6px;">Type: tijdgebaseerd (TOTP) · 6 cijfers · 30s. Accountnaam: je e-mailadres.</div>
</div>
<div style="font-size:14px;font-weight:600;margin-bottom:8px;">Stap 2: bevestig met code</div>
<div style="display:flex;gap:8px;">
  <input id="admMfaCode" type="text" inputmode="numeric" maxlength="6" placeholder="6-cijferige code"
    style="flex:1;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:16px;letter-spacing:4px;text-align:center;">
  <button class="adm-btn adm-btn-primary" id="admMfaVerify">Bevestigen</button>
</div>
<div id="admMfaErr" style="display:none;color:#ef4444;font-size:12px;margin-top:6px;"></div>`;
        document.getElementById("admMfaVerify")?.addEventListener("click", async () => {
          const code = document.getElementById("admMfaCode")?.value?.trim();
          const errEl = document.getElementById("admMfaErr");
          if (!code || code.length !== 6) { if(errEl){errEl.textContent="Vul een 6-cijferige code in.";errEl.style.display="";} return; }
          try {
            await api("POST", "/me/mfa/verify", { token: code });
            wizard.innerHTML = `<div style="color:#10b981;font-weight:600;font-size:14px;">✅ MFA is nu actief! Uw account is beveiligd met 2FA.</div>`;
            const statusEl = document.getElementById("admMfaStatus");
            if (statusEl) statusEl.innerHTML = `<span style="color:#10b981;font-weight:600;">✅ MFA actief</span>`;
            const disableBtn = document.getElementById("admMfaDisable");
            if (disableBtn) disableBtn.style.display = "";
          } catch(err) {
            if(errEl){errEl.textContent="Ongeldige code. Probeer opnieuw.";errEl.style.display="";}
          }
        });
      } catch(e) { wizard.innerHTML = `<div style="color:#dc2626;font-size:13px;">Fout: ${e.message}</div>`; }
    });

    // MFA verplichten voor alle beheerders
    document.getElementById("admMfaEnforce")?.addEventListener("click", async () => {
      if (!confirm("MFA verplicht maken voor álle beheerders van deze organisatie?\n\nBij de volgende login is een authenticator-code vereist. Bewaar de getoonde secrets en recovery codes zorgvuldig — ze worden maar één keer getoond.")) return;
      const wizard = document.getElementById("admMfaWizard");
      if (!wizard) return;
      wizard.style.display = "block";
      wizard.innerHTML = `<div style="font-size:13px;color:#64748b;">MFA inschakelen…</div>`;
      try {
        const d = await api("POST", "/admin/mfa/enforce");
        const enrolled = d.enrolled || [];
        if (!enrolled.length) {
          wizard.innerHTML = `<div style="color:#10b981;font-weight:600;font-size:14px;">✅ Alle beheerders hebben al MFA actief.</div>`;
          return;
        }
        wizard.innerHTML = `
<div style="font-size:14px;font-weight:700;margin-bottom:4px;color:#0F172A;">🛡️ MFA verplicht — ${enrolled.length} beheerder(s) ingeschreven</div>
<div style="font-size:12px;color:#92400e;background:#FEF3C7;border:1px solid #FDE68A;border-radius:8px;padding:10px 12px;margin:10px 0;">
  ⚠️ Bewaar onderstaande gegevens nu. Ze worden niet opnieuw getoond. Voeg de sleutel toe aan een authenticator-app (Google Authenticator, Authy…).
</div>
${enrolled.map(e => `
  <div style="border:1px solid #E2E8F0;border-radius:10px;padding:12px;margin-bottom:10px;">
    <div style="font-weight:600;font-size:13px;color:#0F172A;margin-bottom:6px;">${esc(e.name||e.email)} <span style="color:#94A3B8;font-weight:400;">· ${esc(e.email)}</span></div>
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <div style="flex:1;min-width:180px;">
        <div style="font-size:11px;color:#94A3B8;text-transform:uppercase;letter-spacing:.4px;">Geheime sleutel</div>
        <div style="font-family:monospace;background:#F1F5F9;padding:6px 10px;border-radius:6px;font-size:12px;word-break:break-all;margin:3px 0 8px;">${esc(e.secret||"")}</div>
        <div style="font-size:11px;color:#94A3B8;text-transform:uppercase;letter-spacing:.4px;">Recovery codes</div>
        <div style="font-family:monospace;font-size:11.5px;color:#374151;line-height:1.7;">${(e.recoveryCodes||[]).map(c=>esc(c)).join(" &nbsp; ")}</div>
      </div>
    </div>
  </div>`).join("")}
<button class="adm-btn adm-btn-primary adm-btn-sm" id="admMfaEnforceDone" style="margin-top:4px;">Ik heb alles opgeslagen</button>`;
        document.getElementById("admMfaEnforceDone")?.addEventListener("click", () => {
          wizard.style.display = "none";
          const statusEl = document.getElementById("admMfaStatus");
          if (statusEl) statusEl.innerHTML = `<span style="color:#10b981;font-weight:600;">✅ MFA verplicht voor beheerders</span>`;
          window.showToast && window.showToast("MFA verplicht ingesteld voor beheerders ✓", "success");
        });
      } catch(e) { wizard.innerHTML = `<div style="color:#dc2626;font-size:13px;">Fout: ${e.message}</div>`; }
    });

    // Backup
    document.getElementById("admBackupCreate")?.addEventListener("click", async () => {
      const resultEl = document.getElementById("admBackupResult");
      if(resultEl) resultEl.innerHTML = `<div style="font-size:13px;color:#64748b;">Backup aanmaken…</div>`;
      try {
        const d = await api("POST", "/admin/backups");
        const backup = d.backup || {};
        if (resultEl) resultEl.innerHTML = `
<div style="background:#d1fae5;border-radius:8px;padding:10px 14px;font-size:13px;color:#065f46;">
  ✅ Backup aangemaakt: <strong>${esc(backup.id||"")}</strong><br>
  <span style="font-size:11px;">${new Date(backup.createdAt||Date.now()).toLocaleString("nl-BE")}</span>
  <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admBackupDownload" style="margin-top:8px;display:block;" data-id="${esc(backup.id||"")}">📥 Download JSON</button>
</div>`;
        document.getElementById("admBackupDownload")?.addEventListener("click", async () => {
          try {
            const pv = await api("GET", `/admin/backups/${backup.id}/preview`);
            const blob = new Blob([JSON.stringify(pv, null, 2)], { type: "application/json" });
            const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
            a.download = `backup-${backup.id}.json`; a.click();
          } catch(e2) { window.showToast("Download fout: "+e2.message, "error"); }
        });
      } catch(e) { if(resultEl) resultEl.innerHTML = `<div style="color:#dc2626;font-size:13px;">Fout: ${e.message}</div>`; }
    });

    document.getElementById("admBackupList")?.addEventListener("click", async () => {
      const resultEl = document.getElementById("admBackupResult");
      try {
        const d = await api("GET", "/admin/backups");
        const rows = d.rows || [];
        if(resultEl) resultEl.innerHTML = rows.length ? `
<div style="margin-top:8px;">
  ${rows.map(b=>`<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:12px;">
    <span style="font-family:monospace;color:#6366f1;">${esc(b.id||"")}</span>
    <span style="color:#64748b;">${b.createdAt?new Date(b.createdAt).toLocaleString("nl-BE"):""}</span>
    <span style="color:#64748b;">${b.tenantCount||0} tenants</span>
  </div>`).join("")}
</div>` : `<div style="font-size:13px;color:#94a3b8;margin-top:8px;">Geen backups gevonden</div>`;
      } catch(e) { if(resultEl) resultEl.innerHTML = `<div style="color:#dc2626;font-size:13px;">Fout: ${e.message}</div>`; }
    });
  }

  // ── Helpers ────────────────────────────────────────────────
  function openDrawer() {
    document.getElementById("admDrawer").classList.remove("hidden");
    document.getElementById("admOverlay").classList.remove("hidden");
  }

  function closeDrawer() {
    document.getElementById("admDrawer").classList.add("hidden");
    document.getElementById("admOverlay").classList.add("hidden");
  }

  function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d;
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString("nl-BE", { weekday: "short", day: "numeric", month: "short" });
  }

  // ── Init ───────────────────────────────────────────────────
  function init() {
    buildShell();
    applyEntitlements();
    window.WfpBoden && window.WfpBoden.mount({ navigate: switchView });

    // Sync user name + topbar from current user
    try {
      const user = window._wfpCurrentUser || {};
      const name = user.name || user.email || "Admin";
      const initial = name[0].toUpperCase();
      const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
      set("admUserName", name);
      set("admUserAvatar", initial);
      set("admTopbarName", name);
      set("admTopbarAv", initial);
    } catch (_) {}

    // Laad bedrijfsnaam (tenant) in de sidebar-brand
    api("GET", "/settings").then(res => {
      const t = res.tenant || {};
      const cn = document.getElementById("admCompanyName");
      if (cn) cn.textContent = t.name || "Monargo One";
    }).catch(() => {
      const cn = document.getElementById("admCompanyName");
      if (cn) cn.textContent = "Monargo One";
    });

    // ── Globale zoek ─────────────────────────────────────────
    (function wireSearch(){
      const input = document.getElementById("admGlobalSearch");
      const box   = document.getElementById("admSearchResults");
      if (!input || !box) return;
      let timer = null, lastQ = "";
      const close = () => { box.classList.remove("open"); box.innerHTML = ""; };
      const render = (results, q) => {
        // Toon geen resultaten voor modules die niet in het pakket zitten.
        results = (results || []).filter(r => !r.view || viewEnabled(r.view));
        if (!results.length) { box.innerHTML = `<div class="adm-search-empty">Geen resultaten voor "${esc(q)}"</div>`; box.classList.add("open"); return; }
        box.innerHTML = results.map(r => `
          <div class="adm-search-item" data-view="${esc(r.view)}">
            <span class="adm-search-type">${esc(r.type)}</span>
            <div style="min-width:0;flex:1;">
              <div class="adm-search-label" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(r.label)}</div>
              ${r.sub ? `<div class="adm-search-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(r.sub)}</div>` : ""}
            </div>
          </div>`).join("");
        box.classList.add("open");
        box.querySelectorAll(".adm-search-item").forEach(el => {
          el.addEventListener("click", () => { close(); input.value = ""; switchView(el.dataset.view); });
        });
      };
      input.addEventListener("input", () => {
        const q = input.value.trim();
        if (timer) clearTimeout(timer);
        if (q.length < 2) { close(); return; }
        timer = setTimeout(async () => {
          lastQ = q;
          try {
            const d = await api("GET", `/search?q=${encodeURIComponent(q)}`);
            if (input.value.trim() === lastQ) render(d.results || [], q);
          } catch(_) { close(); }
        }, 220);
      });
      input.addEventListener("keydown", e => { if (e.key === "Escape") { close(); input.blur(); } });
      document.addEventListener("click", e => { if (!e.target.closest(".adm-search-box")) close(); });
    })();

    // ── Notification bell ────────────────────────────────────
    const bellBtn   = document.getElementById("admBellBtn");
    const bellDot   = document.getElementById("admBellDot");
    const notifPanel = document.getElementById("admNotifPanel");
    const notifList  = document.getElementById("admNotifList");
    let _notifCache  = [];

    function fmtNotifTime(iso) {
      if (!iso) return "";
      const d = new Date(iso), now = new Date();
      const diff = Math.floor((now - d) / 60000);
      if (diff < 1) return "Zonet";
      if (diff < 60) return `${diff}m geleden`;
      if (diff < 1440) return `${Math.floor(diff/60)}u geleden`;
      return d.toLocaleDateString("nl-BE");
    }

    function renderNotifList() {
      if (!_notifCache.length) {
        notifList.innerHTML = `<div class="adm-notif-empty">🔔 Geen notificaties</div>`;
        return;
      }
      notifList.innerHTML = _notifCache.slice(0, 20).map(n => {
        const isRead = n.status === "read";
        return `<div class="adm-notif-item ${isRead ? "" : "unread"}" data-nid="${esc(n.id)}">
          <div class="adm-notif-dot ${isRead ? "read" : ""}"></div>
          <div class="adm-notif-body">
            <div>${esc(n.title || n.message || "Notificatie")}</div>
            ${n.body ? `<div style="color:#64748b;margin-top:2px;font-size:11.5px">${esc(n.body)}</div>` : ""}
            <div class="adm-notif-time">${fmtNotifTime(n.createdAt)}</div>
          </div>
        </div>`;
      }).join("");

      notifList.querySelectorAll(".adm-notif-item").forEach(item => {
        item.addEventListener("click", async () => {
          const nid = item.dataset.nid;
          if (!item.classList.contains("unread")) return;
          item.classList.remove("unread"); item.querySelector(".adm-notif-dot").classList.add("read");
          try { await api("POST", `/notifications/${nid}/read`, {}); } catch(_){}
          const n = _notifCache.find(x => x.id === nid);
          if (n) n.status = "read";
          updateBellDot();
        });
      });
    }

    function updateBellDot() {
      const unread = _notifCache.filter(n => n.status !== "read").length;
      if (bellDot) bellDot.style.display = unread > 0 ? "" : "none";
    }

    async function loadNotifications() {
      // Sla over wanneer deze shell niet actief is (geen stale polls na rol-wissel).
      if (document.getElementById("platform-admin")?.classList.contains("hidden")) return;
      try {
        const d = await api("GET", "/notifications");
        _notifCache = d.rows || [];
        updateBellDot();
        if (notifPanel.classList.contains("open")) renderNotifList();
      } catch(_){}
    }

    bellBtn?.addEventListener("click", async e => {
      e.stopPropagation();
      const isOpen = notifPanel.classList.toggle("open");
      if (isOpen) {
        notifList.innerHTML = `<div class="adm-notif-empty">Laden…</div>`;
        await loadNotifications();
        renderNotifList();
      }
    });

    document.addEventListener("click", e => {
      if (!document.getElementById("admBellBtn")?.contains(e.target) && !notifPanel?.contains(e.target)) {
        notifPanel?.classList.remove("open");
      }
    });

    document.getElementById("admNotifMarkAll")?.addEventListener("click", async () => {
      const unread = _notifCache.filter(n => n.status !== "read");
      await Promise.all(unread.map(n => api("POST", `/notifications/${n.id}/read`, {}).catch(() => {})));
      _notifCache.forEach(n => n.status = "read");
      updateBellDot();
      renderNotifList();
    });

    // Load on startup and poll every 30 seconds
    loadNotifications();
    setInterval(loadNotifications, 30000);

    switchView("dashboard");
  }

  // ── Documentsjablonen (configureerbaar) ────────────────────
  let _tplMeta = null;          // {types, fields, columns}
  let _tplEditing = null;       // huidig concept in de editor (null = lijst)
  async function renderTemplates() {
    const c = document.getElementById("admContent");
    if (_tplEditing) return renderTemplateEditor();
    let data;
    try { data = await api("GET", "/templates"); }
    catch (e) { c.innerHTML = `<div class="adm-card"><div class="adm-card-body" style="color:#dc2626">${esc(e.message)}</div></div>`; return; }
    _tplMeta = { types: data.types || {}, fields: data.fields || {}, columns: data.columns || {} };
    const tpls = data.templates || [];
    const typeKeys = Object.keys(_tplMeta.types);
    c.innerHTML = `
<div class="adm-card" style="padding:14px 16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
  <div style="font-size:13px;color:#475569">Maak je eigen sjablonen voor facturen, offertes en werkbon-rapporten — met je logo, kleuren en de velden die jij wil. Het systeem drukt elk document af volgens het gekozen sjabloon.</div>
  <select id="tplNew" class="adm-input" style="max-width:230px"><option value="">+ Nieuw sjabloon…</option>${typeKeys.map(t => `<option value="${t}">+ ${esc(_tplMeta.types[t].label)}</option>`).join("")}</select>
</div>
${typeKeys.map(tk => {
  const list = tpls.filter(t => t.type === tk);
  return `<div class="adm-card" style="margin-bottom:14px"><div class="adm-card-header"><h3 class="adm-card-title">${esc(_tplMeta.types[tk].label)}</h3></div>
    <div class="adm-card-body" style="padding:0">
    ${list.length ? `<table class="adm-table"><tbody>${list.map(t => `<tr>
      <td style="font-weight:600">${esc(t.name)} ${t.isDefault ? '<span class="adm-status adm-status-active" style="margin-left:6px">standaard</span>' : ""}</td>
      <td style="text-align:right;white-space:nowrap">
        ${t.isDefault ? "" : `<button class="adm-btn adm-btn-secondary adm-btn-sm tpl-default" data-id="${esc(t.id)}">Maak standaard</button>`}
        <button class="adm-btn adm-btn-secondary adm-btn-sm tpl-edit" data-id="${esc(t.id)}">Bewerken</button>
        <button class="adm-btn adm-btn-secondary adm-btn-sm tpl-prev" data-id="${esc(t.id)}">Voorbeeld</button>
        <button class="adm-btn adm-btn-danger adm-btn-sm tpl-del" data-id="${esc(t.id)}">🗑</button>
      </td></tr>`).join("")}</tbody></table>`
    : `<div style="padding:16px;color:#94a3b8;font-size:13px">Nog geen sjabloon — er wordt een nette standaard gebruikt tot je er één maakt.</div>`}
    </div></div>`;
}).join("")}`;
    document.getElementById("tplNew").addEventListener("change", e => { if (e.target.value) { _tplEditing = { type: e.target.value, ...defaultTplDraft(e.target.value) }; renderTemplates(); } });
    c.querySelectorAll(".tpl-edit").forEach(b => b.addEventListener("click", () => { _tplEditing = tpls.find(t => t.id === b.dataset.id); renderTemplates(); }));
    c.querySelectorAll(".tpl-del").forEach(b => b.addEventListener("click", async () => { if (!confirm("Sjabloon verwijderen?")) return; try { await api("DELETE", `/templates/${b.dataset.id}`); renderTemplates(); } catch (e) { window.showToast && window.showToast(e.message, "error"); } }));
    c.querySelectorAll(".tpl-default").forEach(b => b.addEventListener("click", async () => { try { await api("POST", `/templates/${b.dataset.id}/default`, {}); renderTemplates(); } catch (e) { window.showToast && window.showToast(e.message, "error"); } }));
    c.querySelectorAll(".tpl-prev").forEach(b => b.addEventListener("click", async () => {
      try { const r = await api("GET", `/templates/${b.dataset.id}/preview`); const w = window.open("", "_blank"); w.document.write(r.html); w.document.close(); }
      catch (e) { window.showToast && window.showToast(e.message, "error"); }
    }));
  }

  function defaultTplDraft(type) {
    return { name: `Mijn ${(_tplMeta.types[type] || {}).label || type}`, accentColor: "#1e6be6", logo: null, headerText: "", introText: "", footerText: "{{bedrijf.naam}} · {{bedrijf.btw}} · {{bedrijf.email}}", paymentTerms: type === "invoice" ? "Gelieve te betalen voor de vervaldatum op {{bedrijf.iban}}." : "", columns: (_tplMeta.types[type] || {}).defaultColumns || ["description", "qty", "unitPrice", "vatRate", "lineTotal"], showVat: true, language: "nl" };
  }

  function renderTemplateEditor() {
    const c = document.getElementById("admContent");
    const d = _tplEditing;
    const isFinancial = (_tplMeta.types[d.type] || {}).kind !== "report";
    const fieldList = _tplMeta.fields[d.type] || [];
    const colDefs = _tplMeta.columns || {};
    const fieldPicker = id => `<select class="adm-input tpl-insert" data-target="${id}" style="max-width:170px;margin-top:4px"><option value="">+ veld invoegen…</option>${fieldList.map(f => `<option value="{{${f}}}">${esc(f)}</option>`).join("")}</select>`;
    c.innerHTML = `
<div class="adm-card" style="margin-bottom:14px"><div class="adm-card-header">
  <h3 class="adm-card-title">${d.id ? "Sjabloon bewerken" : "Nieuw sjabloon"} — ${esc((_tplMeta.types[d.type] || {}).label || d.type)}</h3>
  <button class="adm-btn adm-btn-secondary adm-btn-sm" id="tplBack">← Terug</button>
</div></div>
<div class="adm-grid-2" style="align-items:start">
  <div class="adm-card"><div class="adm-card-body">
    <div class="adm-form-group"><label>Naam</label><input class="adm-input" id="t_name" value="${esc(d.name || "")}"></div>
    <div class="adm-form-row">
      <div class="adm-form-group"><label>Accentkleur</label><input type="color" class="adm-input" id="t_accent" value="${esc(d.accentColor || "#1e6be6")}" style="height:40px;padding:4px"></div>
      <div class="adm-form-group"><label>Taal</label><select class="adm-input" id="t_lang"><option value="nl" ${d.language === "nl" ? "selected" : ""}>Nederlands</option><option value="fr" ${d.language === "fr" ? "selected" : ""}>Frans</option></select></div>
    </div>
    <div class="adm-form-group"><label>Logo (optioneel)</label><input type="file" id="t_logo" accept="image/*" class="adm-input" style="padding:6px">${d.logo ? '<div style="font-size:12px;color:#16a34a;margin-top:4px">✓ logo ingesteld <a href="#" id="t_logo_clear">verwijderen</a></div>' : ""}</div>
    <div class="adm-form-group"><label>Eigen koptekst (leeg = bedrijfsblok)</label><textarea class="adm-input" id="t_header" rows="2" placeholder="Bv. {{bedrijf.naam}} — uw partner">${esc(d.headerText || "")}</textarea>${fieldPicker("t_header")}</div>
    <div class="adm-form-group"><label>Inleidingstekst</label><textarea class="adm-input" id="t_intro" rows="2">${esc(d.introText || "")}</textarea>${fieldPicker("t_intro")}</div>
    ${isFinancial ? `<div class="adm-form-group"><label>Kolommen</label><div style="display:flex;flex-wrap:wrap;gap:10px">${Object.keys(colDefs).map(k => `<label style="font-weight:400;font-size:12.5px;display:inline-flex;gap:5px;align-items:center"><input type="checkbox" class="t_col" value="${k}" ${(d.columns || []).includes(k) ? "checked" : ""}>${esc(colDefs[k])}</label>`).join("")}</div></div>
    <label style="font-weight:400;font-size:12.5px;display:inline-flex;gap:6px;align-items:center;margin-bottom:12px"><input type="checkbox" id="t_vat" ${d.showVat !== false ? "checked" : ""}> Btw-totaal tonen</label>
    <div class="adm-form-group"><label>Betaalvoorwaarden</label><textarea class="adm-input" id="t_terms" rows="2">${esc(d.paymentTerms || "")}</textarea>${fieldPicker("t_terms")}</div>` : ""}
    <div class="adm-form-group"><label>Voettekst</label><textarea class="adm-input" id="t_footer" rows="2">${esc(d.footerText || "")}</textarea>${fieldPicker("t_footer")}</div>
    <label style="font-weight:400;font-size:12.5px;display:inline-flex;gap:6px;align-items:center;margin-bottom:12px"><input type="checkbox" id="t_default" ${d.isDefault ? "checked" : ""}> Als standaard gebruiken voor dit type</label>
    <div class="adm-form-actions"><span id="t_msg" style="font-size:12px;color:#dc2626;flex:1;text-align:left"></span><button class="adm-btn adm-btn-primary" id="t_save">Opslaan</button></div>
  </div></div>
  <div class="adm-card" style="position:sticky;top:16px"><div class="adm-card-header"><h3 class="adm-card-title">Live voorbeeld</h3></div>
    <iframe id="t_prev" style="width:100%;height:560px;border:none;border-radius:0 0 16px 16px;background:#fff"></iframe>
  </div>
</div>`;
    document.getElementById("tplBack").addEventListener("click", () => { _tplEditing = null; renderTemplates(); });
    const draft = () => ({
      type: d.type, name: val("t_name"), accentColor: val("t_accent"), language: val("t_lang"),
      logo: d.logo || null,
      headerText: val("t_header"), introText: val("t_intro"), footerText: val("t_footer"),
      paymentTerms: isFinancial ? val("t_terms") : "",
      columns: isFinancial ? [...c.querySelectorAll(".t_col:checked")].map(x => x.value) : [],
      showVat: isFinancial ? document.getElementById("t_vat").checked : true,
      isDefault: document.getElementById("t_default").checked,
    });
    function val(id) { const el = document.getElementById(id); return el ? el.value : ""; }
    let _to;
    const refresh = async () => { try { const r = await api("POST", "/templates/preview", draft()); document.getElementById("t_prev").srcdoc = r.html; } catch (_) {} };
    const debounced = () => { clearTimeout(_to); _to = setTimeout(refresh, 350); };
    c.querySelectorAll("input,select,textarea").forEach(el => el.addEventListener("input", debounced));
    c.querySelectorAll(".tpl-insert").forEach(sel => sel.addEventListener("change", () => {
      if (!sel.value) return; const ta = document.getElementById(sel.dataset.target);
      const s = ta.selectionStart || ta.value.length; ta.value = ta.value.slice(0, s) + sel.value + ta.value.slice(ta.selectionEnd || s);
      sel.value = ""; ta.focus(); debounced();
    }));
    const logoInp = document.getElementById("t_logo");
    if (logoInp) logoInp.addEventListener("change", async () => {
      const file = logoInp.files && logoInp.files[0]; if (!file) return;
      if (file.size > 500 * 1024) { document.getElementById("t_msg").textContent = "Logo te groot (max 500KB)"; return; }
      d.logo = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(file); });
      refresh();
    });
    const lc = document.getElementById("t_logo_clear");
    if (lc) lc.addEventListener("click", e => { e.preventDefault(); d.logo = null; renderTemplateEditor(); });
    document.getElementById("t_save").addEventListener("click", async () => {
      const msg = document.getElementById("t_msg"); msg.textContent = "";
      try {
        if (d.id) await api("PUT", `/templates/${d.id}`, draft());
        else await api("POST", "/templates", draft());
        _tplEditing = null; renderTemplates(); window.showToast && window.showToast("Sjabloon opgeslagen ✓", "success");
      } catch (e) { msg.textContent = e.message; }
    });
    refresh();
  }

  // ── Compliance: Checkin@Work (CIAW) ────────────────────────
  async function renderCiaw() {
    const c = document.getElementById("admContent");
    let data = {}, presence = { rows: [], present: 0, issues: 0 };
    try {
      [data, presence] = await Promise.all([
        api("GET", "/ciaw/declarations"),
        api("GET", "/ciaw/presence").catch(() => ({ rows: [], present: 0, issues: 0 })),
      ]);
    }
    catch (e) { c.innerHTML = `<div class="adm-card" style="padding:16px;color:#dc2626">${esc(e.message)}</div>`; return; }
    const rows = data.declarations || [];
    const statusBadge = s => {
      const map = { confirmed: ["#dcfce7", "#15803d", "bevestigd"], sent: ["#dbeafe", "#1d4ed8", "verzonden"], failed: ["#fee2e2", "#b91c1c", "mislukt"], rejected: ["#fee2e2", "#b91c1c", "geweigerd"] };
      const [bg, fg, label] = map[s] || ["#f1f5f9", "#475569", s || "—"];
      return `<span style="background:${bg};color:${fg};padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600">${esc(label)}</span>`;
    };
    const geoBadge = d => d.geoVerified ? `<span title="binnen geofence" style="color:#15803d">📍 ✓${d.geoDistanceM != null ? ` ${d.geoDistanceM}m` : ""}</span>` : (d.geoDistanceM != null ? `<span title="buiten geofence" style="color:#d97706">📍 ${d.geoDistanceM}m</span>` : `<span style="color:#94a3b8">—</span>`);
    const rsz = data.rszEmployerId || "";
    c.innerHTML = `
<div class="adm-card" style="padding:14px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
  <div style="font-size:13px;color:#475569">Aanwezigheidsaangiftes (RSZ/ONSS) gebeuren <strong>automatisch</strong> bij in- en uitklokken. Hieronder de recente aangiftes met locatieverificatie.</div>
  <button class="adm-btn-secondary" id="ciawRefresh" style="white-space:nowrap">↻ Vernieuwen</button>
</div>
<div class="adm-card" style="padding:14px 16px;margin-bottom:14px">
  <div style="font-weight:700;font-size:13px;margin-bottom:6px">RSZ-werkgeversnummer</div>
  <div style="font-size:12.5px;color:#64748b;margin-bottom:8px">Vereist voor geldige Checkin@Work-aangiftes. Het rijksregisternummer van elke medewerker stel je in op de medewerkersfiche.${rsz ? "" : ` <strong style="color:#b91c1c">Nog niet ingesteld — aangiftes worden geweigerd.</strong>`}</div>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <input id="ciawRsz" class="adm-input" value="${esc(rsz)}" placeholder="bv. 12345678" style="max-width:220px">
    <button class="adm-btn-primary" id="ciawRszSave">Opslaan</button>
    <span id="ciawRszMsg" style="font-size:12px;color:#16a34a"></span>
  </div>
</div>
<div class="adm-card" style="margin-bottom:14px">
  <div class="adm-card-header" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    <div style="font-weight:700;font-size:13px">Aanwezigheidsregister (werfcontrole) <span style="font-weight:400;color:#64748b">— ${presence.present} aanwezig${presence.issues ? `, <span style="color:#b91c1c">${presence.issues} zonder bevestigde aangifte</span>` : ""}</span></div>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="ciawPresenceCsv">⬇ Export voor controle (CSV)</button>
  </div>
  <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Werf</th><th>Medewerker</th><th>INSZ</th><th>Sinds</th><th>CIAW</th></tr></thead><tbody>
    ${(presence.rows || []).map(r => `<tr>
      <td>${esc(r.venue)}</td>
      <td>${esc(r.name)}</td>
      <td style="font-family:monospace;font-size:12px">${r.insz ? esc(r.insz) : '<span style="color:#b91c1c">ontbreekt</span>'}${r.insz && !r.inszValid ? ' <span title="ongeldig controlegetal" style="color:#b91c1c">⚠</span>' : ""}</td>
      <td style="font-size:12px;color:#64748b">${esc((r.since || "").replace("T", " "))}</td>
      <td>${statusBadge(r.ciawStatus === "none" ? "—" : r.ciawStatus)}</td>
    </tr>`).join("") || `<tr><td colspan="5" style="padding:18px;text-align:center;color:#94a3b8">Niemand momenteel ingeklokt.</td></tr>`}
  </tbody></table></div>
</div>
<div class="adm-card" style="overflow:auto">
  <table class="adm-table"><thead><tr><th>Datum</th><th>Type</th><th>Locatie (geo)</th><th>Status</th><th>Referentie</th><th>Modus</th><th></th></tr></thead><tbody>
    ${rows.map(d => {
      const failed = d.status === "failed" || d.status === "rejected";
      return `<tr>
      <td>${esc(d.date || (d.at || "").slice(0, 10))}</td>
      <td>${d.action === "OUT" ? "Uitklokken" : "Inklokken"}</td>
      <td>${geoBadge(d)}</td>
      <td>${statusBadge(d.status)}</td>
      <td style="font-family:monospace;font-size:12px">${esc(d.reference || "—")}${d.error ? `<div style="color:#b91c1c;font-size:11px">${esc(d.error)}</div>` : ""}</td>
      <td>${d.live ? "live" : "<span style='color:#64748b'>mock</span>"}</td>
      <td>${failed ? `<button class="adm-btn adm-btn-secondary adm-btn-sm ciaw-retry" data-clock="${esc(d.clockId)}" data-action="${d.action === "OUT" ? "out" : "in"}" style="padding:3px 9px;font-size:12px">↻ Opnieuw</button>` : ""}</td>
    </tr>`;}).join("") || `<tr><td colspan="7" style="padding:24px;text-align:center;color:#94a3b8">Nog geen aangiftes. Ze verschijnen zodra medewerkers in-/uitklokken.</td></tr>`}
  </tbody></table>
</div>`;
    document.getElementById("ciawRefresh").addEventListener("click", renderCiaw);
    document.getElementById("ciawPresenceCsv").addEventListener("click", async () => {
      try {
        const r = await fetch(`/api/tenants/${tenantId()}/ciaw/presence?format=csv`, { headers: { Authorization: "Bearer " + token() } });
        if (!r.ok) throw new Error("Export mislukt");
        const blob = await r.blob(); const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = "aanwezigheidsregister.csv";
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
      } catch (e) { window.showToast && window.showToast(e.message, "error"); }
    });
    document.getElementById("ciawRszSave").addEventListener("click", async () => {
      const msg = document.getElementById("ciawRszMsg"); msg.textContent = "";
      try { await api("POST", "/compliance/rsz", { rszEmployerId: document.getElementById("ciawRsz").value }); msg.style.color = "#16a34a"; msg.textContent = "Opgeslagen ✓"; }
      catch (e) { msg.style.color = "#dc2626"; msg.textContent = e.message; }
    });
    c.querySelectorAll(".ciaw-retry").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "Bezig…";
      try {
        const r = await api("POST", "/ciaw/checkin", { clockId: b.dataset.clock, action: b.dataset.action });
        window.showToast && window.showToast(r.ok ? "Aangifte opnieuw ingediend ✓" : ("Nog steeds geweigerd: " + (r.error || "")), r.ok ? "success" : "error");
        renderCiaw();
      } catch (e) { window.showToast && window.showToast(e.message, "error"); b.disabled = false; b.textContent = "↻ Opnieuw"; }
    }));
  }

  // ── Compliance: A1 / Limosa detachering ────────────────────
  async function renderPostedWorkers() {
    const c = document.getElementById("admContent");
    let data = {};
    try { data = await api("GET", "/posted_workers"); }
    catch (e) { c.innerHTML = `<div class="adm-card" style="padding:16px;color:#dc2626">${esc(e.message)}</div>`; return; }
    const rows = data.rows || [];
    const a1Badge = s => {
      const map = { valid: ["#dcfce7", "#15803d", "geldig"], expiring: ["#fef9c3", "#a16207", "verloopt < 30d"], expired: ["#fee2e2", "#b91c1c", "verlopen"], missing: ["#f1f5f9", "#475569", "geen A1"], unknown: ["#f1f5f9", "#475569", "onbekend"] };
      const [bg, fg, label] = map[s] || map.unknown;
      return `<span style="background:${bg};color:${fg};padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600">${esc(label)}</span>`;
    };
    c.innerHTML = `
<div class="adm-card" style="padding:14px 16px;margin-bottom:14px">
  <div style="font-size:13px;color:#475569;margin-bottom:6px">Detacheringsdossiers van (onder)aannemers en buitenlandse werknemers. Bewaak de geldigheid van A1-attesten en dien Limosa-meldingen in.</div>
  <div style="font-size:12px;margin-bottom:6px">Limosa-provider: ${data.limosaMode === "live" ? '<span style="color:#15803d;font-weight:600">● actief (live)</span>' : '<span style="color:#a16207;font-weight:600">● testmodus (mock)</span> — meldingen worden gesimuleerd tot de provider live staat'}</div>
  <div style="display:flex;gap:14px;font-size:12px;color:#64748b">
    <span>${data.total || 0} dossiers</span>
    ${data.expired ? `<span style="color:#b91c1c">⛔ ${data.expired} verlopen</span>` : ""}
    ${data.expiring ? `<span style="color:#a16207">⚠️ ${data.expiring} verloopt binnenkort</span>` : ""}
    ${data.missing ? `<span style="color:#64748b">${data.missing} zonder A1</span>` : ""}
  </div>
</div>
<div class="adm-card" style="padding:14px 16px;margin-bottom:14px">
  <div style="font-weight:700;font-size:13px;margin-bottom:10px">Nieuw detacheringsdossier</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end">
    <label style="font-size:12px;font-weight:600;color:#334155">Werknemer<input id="pwName" class="adm-input" placeholder="Naam"></label>
    <label style="font-size:12px;font-weight:600;color:#334155">Onderaannemer<input id="pwSub" class="adm-input" placeholder="Bedrijf (optioneel)"></label>
    <label style="font-size:12px;font-weight:600;color:#334155">Land<input id="pwCountry" class="adm-input" placeholder="bv. PL" maxlength="2" style="text-transform:uppercase"></label>
    <label style="font-size:12px;font-weight:600;color:#334155">A1-referentie<input id="pwRef" class="adm-input" placeholder="A1-nr"></label>
    <label style="font-size:12px;font-weight:600;color:#334155">Geldig van<input id="pwFrom" type="date" class="adm-input"></label>
    <label style="font-size:12px;font-weight:600;color:#334155">Geldig tot<input id="pwTo" type="date" class="adm-input"></label>
    <label style="font-size:12px;font-weight:600;color:#334155">A1-attest (PDF/foto)<input id="pwFile" type="file" accept="application/pdf,image/*" class="adm-input" style="padding:6px"></label>
    <button class="adm-btn-primary" id="pwAdd">Toevoegen</button>
  </div>
  <div id="pwMsg" style="font-size:12px;margin-top:8px"></div>
</div>
<div class="adm-card" style="overflow:auto">
  <table class="adm-table"><thead><tr><th>Werknemer</th><th>Onderaannemer</th><th>Land</th><th>A1</th><th>Geldigheid</th><th>Limosa</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr data-id="${esc(r.id)}">
      <td>${esc(r.workerName)}</td>
      <td>${esc(r.subcontractor || "—")}</td>
      <td>${esc(r.country || "—")}</td>
      <td>${a1Badge(r.a1Status)}${r.documentRef ? `<div style="font-size:11px;color:#64748b;font-family:monospace">${esc(r.documentRef)}</div>` : ""}${r.hasFile ? ` <a class="pw-file" data-id="${esc(r.id)}" href="#" style="font-size:11px">📎 attest</a>` : ""}</td>
      <td style="font-size:12px;color:#475569">${esc(r.validFrom || "?")} → ${esc(r.validTo || "?")}</td>
      <td>${r.limosa && r.limosa.reference ? `<span style="font-size:12px;color:#15803d">✓ ${esc(r.limosa.reference)}</span>` : `<button class="adm-btn-secondary pw-limosa" data-id="${esc(r.id)}" style="padding:4px 10px;font-size:12px">Indienen</button>`}</td>
      <td><button class="pw-del" data-id="${esc(r.id)}" title="Verwijderen" style="border:none;background:none;cursor:pointer;color:#b91c1c;font-size:16px">🗑</button></td>
    </tr>`).join("") || `<tr><td colspan="7" style="padding:24px;text-align:center;color:#94a3b8">Nog geen detacheringsdossiers.</td></tr>`}
  </tbody></table>
</div>`;
    document.getElementById("pwAdd").addEventListener("click", async () => {
      const payload = {
        workerName: document.getElementById("pwName").value.trim(),
        subcontractor: document.getElementById("pwSub").value.trim(),
        country: document.getElementById("pwCountry").value.trim(),
        documentRef: document.getElementById("pwRef").value.trim(),
        validFrom: document.getElementById("pwFrom").value || null,
        validTo: document.getElementById("pwTo").value || null,
      };
      const msg = document.getElementById("pwMsg"); msg.textContent = "";
      // Optioneel A1-attest als base64 data-URL meesturen.
      const fileInp = document.getElementById("pwFile");
      const file = fileInp && fileInp.files && fileInp.files[0];
      if (file) {
        if (file.size > 5 * 1024 * 1024) { msg.style.color = "#dc2626"; msg.textContent = "A1-bestand is te groot (max 5MB)"; return; }
        payload.documentFile = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
        payload.documentFileName = file.name;
      }
      try { await api("POST", "/posted_workers", payload); renderPostedWorkers(); window.showToast && window.showToast("Dossier toegevoegd ✓", "success"); }
      catch (e) { msg.style.color = "#dc2626"; msg.textContent = e.message; }
    });
    c.querySelectorAll(".pw-file").forEach(a => a.addEventListener("click", async e => {
      e.preventDefault();
      try {
        const r = await fetch(`/api/tenants/${tenantId()}/posted_workers/${a.dataset.id}/file`, { headers: { Authorization: "Bearer " + token() } });
        if (!r.ok) throw new Error("Bestand niet gevonden");
        const blob = await r.blob(); const u = URL.createObjectURL(blob);
        window.open(u, "_blank"); setTimeout(() => URL.revokeObjectURL(u), 60000);
      } catch (err) { window.showToast && window.showToast(err.message, "error"); }
    }));
    c.querySelectorAll(".pw-limosa").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "Bezig…";
      try { await api("POST", `/posted_workers/${b.dataset.id}/limosa`, {}); renderPostedWorkers(); window.showToast && window.showToast("Limosa-melding ingediend ✓", "success"); }
      catch (e) { window.showToast && window.showToast(e.message, "error"); b.disabled = false; b.textContent = "Indienen"; }
    }));
    c.querySelectorAll(".pw-del").forEach(b => b.addEventListener("click", async () => {
      if (!confirm("Dit detacheringsdossier verwijderen?")) return;
      try { await api("DELETE", `/posted_workers/${b.dataset.id}`); renderPostedWorkers(); }
      catch (e) { window.showToast && window.showToast(e.message, "error"); }
    }));
  }

  // ── Gedeelde context voor uitgesplitste view-modules ─────────
  // De kern (dit bestand) exposeert helpers + state op window.wfpAdmin.
  // View-modules (admin-operations.js, admin-finance.js, …) lezen hieruit
  // en registreren hun renderers in A.views / drawers in A.drawers.
  // _currentView wordt hertoegewezen → via getter; _state is een stabiele
  // (nooit herbonden) referentie en mag direct gedeeld worden.
  const A = (window.wfpAdmin = window.wfpAdmin || {});
  A.api = api;
  A.esc = esc;
  A.token = token;
  A.tenantId = tenantId;
  A.state = _state;
  A.openDrawer = openDrawer;
  A.closeDrawer = closeDrawer;
  A.subEnabled = subEnabled;
  A.viewEnabled = viewEnabled;
  A.switchView = switchView;
  A.VIEW_LABELS = VIEW_LABELS;
  A.VIEW_BTN_LABEL = VIEW_BTN_LABEL;
  A.renderSupportBanner = renderSupportBanner;
  A.getWeekStart = getWeekStart;
  A.formatDate = formatDate;
  A.printInvoicePDF = printInvoicePDF;
  A.printBeslissersrapport = printBeslissersrapport;
  A.content = () => document.getElementById("admContent");
  A.currentView = () => _currentView;
  A.views = A.views || {};
  A.drawers = A.drawers || {};

  // Kern-renderers registreren (worden gaandeweg naar modules verplaatst).
  Object.assign(A.views, {
    dashboard: renderDashboard, employees: renderEmployees, planning: renderPlanning,
    clocking: renderClocking, leaves: renderLeaves, expenses: renderExpenses,
    workorders: renderWorkorders, messages: renderMessages,
    reports: renderReports, customers: renderCustomers, venues: renderVenues,
    offertes: renderOffertes, facturen: renderFacturen, vehicles: renderVehicles,
    stock: renderStock, billing: renderBilling, integrations: renderIntegraties,
    templates: renderTemplates,
    ciaw: renderCiaw, posted_workers: renderPostedWorkers,
    roadmap: renderRoadmap, audit: renderAudit, settings: renderSettings
  });
  Object.assign(A.drawers, {
    employee: openEmployeeDrawer, message: openMessageDrawer, customer: openCustomerDrawer,
    offerte: openOfferteDrawer, factuur: openFactuurDrawer, venue: openVenueDrawer,
    vehicle: openVehicleDrawer, stock: openStockDrawer
  });

  window.wfp_adminInit = init;
}());
