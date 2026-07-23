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
  const timeA = window.wfpTime;

  // ── Medewerker-naam resolver ───────────────────────────────
  // De beheerder zit in hetzelfde bedrijf: toon ALTIJD een echte naam, nooit
  // een rauwe userId/UUID (dat las als "anoniem"). Lost op via de geladen
  // medewerkerslijst; valt terug op e-mail, daarna een net label.
  function empNameById(id) {
    if (!id) return "";
    const u = (_state.employees || []).find(e => e.id === id);
    return u ? (u.name || u.email || "") : "";
  }
  // Geef de tonen-naam voor een record met userId/userName (clocking, verlof,
  // onkost, werkbon, planning…). Toont nooit de rauwe id.
  function uName(rec) {
    if (!rec) return "Onbekende medewerker";
    return rec.userName || empNameById(rec.userId) || rec.userEmail || rec.email || "Onbekende medewerker";
  }

  function api(method, path, body) {
    // Voeg automatisch /tenants/:id toe voor alle tenant-scoped routes
    const tid = tenantId();
    const skipPrefix = !tid || path.startsWith("/tenants/") || path.startsWith("/auth/") || path.startsWith("/super/") || path.startsWith("/audit") || path.startsWith("/modules/");
    const fullPath = skipPrefix ? path : `/tenants/${tid}${path}`;
    return window.wfpCore.request("/api" + fullPath, { method, body: body ? JSON.stringify(body) : undefined });
  }

  // Dashboard, Actiecentrum en Werkruimte zijn shell-views: ze bundelen enkel
  // tenantdata waar de gebruiker al toegang toe heeft en hebben geen apart
  // backend-entitlement nodig.
  const CORE_UI_VIEWS = new Set(["dashboard", "actions", "operations", "workos", "profielen", "dossiers"]);

  // Verberg nav-items voor modules die niet in het pakket van de tenant zitten.
  function applyEntitlements() {
    fetch("/api/me", { headers: { Authorization: "Bearer " + token() } })
      .then(r => r.json())
      .then(d => {
        // Sector-terminologie toepassen (Werkbonnen → Bezoeken/Interventies/…).
        if (d && d.terminology && window.wfpTerms) window.wfpTerms.set(d.terminology);
        if (d && d.supportSession && d.supportSession.active) renderSupportBanner(d.supportSession);
        // Eerste keer inloggen zonder afgeronde onboarding → toon de wizard.
        // Na "Later invullen" komt hij niet meer over het scherm heen; dan blijft
        // enkel een rustige nudge-balk staan tot de gegevens compleet zijn.
        if (d && d.onboarding && d.onboarding.completed === false && !d.supportSession) {
          if (localStorage.getItem(obSnoozeKey())) {
            setTimeout(() => { try { renderObNudge(); } catch (_) {} }, 300);
          } else {
            setTimeout(() => { try { showOnboardingWizard(); } catch (_) {} }, 300);
          }
        }
        const ent = d && d.entitlements;
        window._wfpEnt = ent || null; // stash voor submodule-gating in views
        if (!ent || ent.views === "*") return; // super_admin of geen data → alles tonen
        const allowed = new Set(ent.views || []);
        document.querySelectorAll(".adm-nav-item[data-view]").forEach(a => {
          const view = a.getAttribute("data-view");
          if (!allowed.has(view) && !CORE_UI_VIEWS.has(view)) a.style.display = "none";
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

  // Snooze per tenant en per toestel: na "Later invullen" nooit meer automatisch
  // over het scherm heen; de nudge-balk blijft de weg naar de wizard.
  function obSnoozeKey() {
    return `wfp_ob_snooze_${(window._wfpCurrentUser && window._wfpCurrentUser.tenantId) || "t"}`;
  }

  function renderObNudge() {
    if (document.getElementById("admObNudge")) return;
    const content = document.getElementById("admContent");
    if (!content || !content.parentElement) return;
    const bar = document.createElement("div");
    const language = (window.wfpI18n && window.wfpI18n.lang) || "nl";
    const copy = ({
      nl: { text:"Je bedrijfsgegevens zijn nog niet volledig. Die zijn nodig voor correcte facturen.", action:"Nu afwerken", hide:"Verbergen" },
      fr: { text:"Les données de votre entreprise ne sont pas encore complètes. Elles sont nécessaires pour établir des factures correctes.", action:"Terminer", hide:"Masquer" },
      en: { text:"Your company details are not complete yet. They are required for correct invoices.", action:"Complete now", hide:"Hide" }
    })[language] || { text:"Je bedrijfsgegevens zijn nog niet volledig. Die zijn nodig voor correcte facturen.", action:"Nu afwerken", hide:"Verbergen" };
    bar.id = "admObNudge";
    bar.className = "adm-onboarding-nudge";
    bar.innerHTML = `<span>${esc(copy.text)}</span>
      <button id="admObNudgeOpen" class="adm-btn adm-btn-primary adm-btn-sm">${esc(copy.action)}</button>
      <button id="admObNudgeX" class="adm-btn adm-btn-ghost adm-btn-sm" title="${esc(copy.hide)}">×</button>`;
    content.parentElement.insertBefore(bar, content);
    bar.querySelector("#admObNudgeOpen").addEventListener("click", () => { bar.remove(); showOnboardingWizard(); });
    bar.querySelector("#admObNudgeX").addEventListener("click", () => bar.remove());
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
    ov.className = "adm-onboarding-overlay";
    ov.innerHTML = `
      <div class="adm-onboarding-dialog" role="dialog" aria-modal="true" aria-labelledby="admObTitle">
        <div class="adm-onboarding-head">
          <span class="adm-onboarding-mark"><img src="/brand/one-symbol.svg" alt=""></span>
          <div>
            <span class="adm-eyebrow">Werkruimte instellen</span>
            <h2 id="admObTitle">Rond je bedrijfsgegevens af</h2>
            <p>Controleer de basisgegevens voor je dagelijkse werking en documenten.</p>
          </div>
        </div>
        <div class="adm-onboarding-progress" aria-label="Onboarding voortgang">
          <button type="button" class="active" data-ob-go="1"><i>1</i><span>Organisatie<small>Jouw werkcontext</small></span></button>
          <button type="button" data-ob-go="2"><i>2</i><span>Facturatie<small>Correcte documenten</small></span></button>
          <button type="button" data-ob-go="3"><i>3</i><span>Contact<small>Wie mogen we helpen?</small></span></button>
        </div>
        <form id="admObForm" class="adm-onboarding-form">
          <section class="adm-onboarding-step active" data-ob-step="1">
            <div class="adm-onboarding-step-copy"><span>Stap 1 van 3</span><h3>Hoe ziet je organisatie eruit?</h3><p>We passen terminologie en de dagelijkse werkruimte hierop aan.</p></div>
            <div class="adm-onboarding-grid">
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
            </div>
            <div class="adm-onboarding-note"><span>✓</span><p><b>Je kunt dit later wijzigen.</b> Modules en gegevens worden niet automatisch verwijderd.</p></div>
          </section>
          <section class="adm-onboarding-step" data-ob-step="2" hidden>
            <div class="adm-onboarding-step-copy"><span>Stap 2 van 3</span><h3>Gegevens voor correcte facturen</h3><p>${ip.vat ? "De beschikbare KBO-gegevens zijn alvast ingevuld. Controleer ze even." : "Vul de basisgegevens in die op offertes en facturen horen."}</p></div>
            <div class="adm-form-row">
              <div class="adm-form-group"><label>BTW-nummer</label><input name="vat" value="${esc(ip.vat||"")}" placeholder="BE0123.456.789"></div>
              <div class="adm-form-group"><label>Ondernemingsnummer</label><input name="companyNumber" value="${esc(ip.companyNumber||"")}" placeholder="0123.456.789"></div>
            </div>
            <div class="adm-form-group"><label>Straat + nummer</label><input name="street" value="${esc(ip.street||"")}" placeholder="Kerkstraat 12"></div>
            <div class="adm-form-row adm-onboarding-address">
              <div class="adm-form-group"><label>Postcode</label><input name="zip" value="${esc(ip.zip||"")}" placeholder="9000"></div>
              <div class="adm-form-group"><label>Gemeente</label><input name="city" value="${esc(ip.city||"")}" placeholder="Gent"></div>
            </div>
            <div class="adm-form-group"><label>Facturatie-e-mail</label><input name="billingEmail" type="email" value="${esc(t.billingEmail||"")}" placeholder="facturatie@bedrijf.be"></div>
          </section>
          <section class="adm-onboarding-step" data-ob-step="3" hidden>
            <div class="adm-onboarding-step-copy"><span>Stap 3 van 3</span><h3>Wie is ons eerste aanspreekpunt?</h3><p>We gebruiken dit alleen voor onboarding, support en belangrijke accountmeldingen.</p></div>
            <div class="adm-form-row">
              <div class="adm-form-group"><label>Naam</label><input name="contactName" value="${esc(ct.contactName||"")}" placeholder="Voornaam Naam"></div>
              <div class="adm-form-group"><label>Functie</label><input name="contactRole" value="${esc(ct.contactRole||"")}" placeholder="Zaakvoerder"></div>
            </div>
            <div class="adm-form-group"><label>Telefoon</label><input name="phone" value="${esc(ct.phone||"")}" placeholder="+32 ..."></div>
            <div class="adm-onboarding-ready"><span>✓</span><div><b>Klaar om te starten</b><p>Hierna kies je zelf of je eerst een klant, een teamlid of je overzicht opent.</p></div></div>
          </section>
          <div id="admObErr" class="adm-onboarding-error" role="alert"></div>
          <div class="adm-onboarding-actions">
            <button type="button" class="adm-btn adm-btn-ghost" id="admObLater">Later</button>
            <span></span>
            <button type="button" class="adm-btn adm-btn-secondary" id="admObBack" hidden>Terug</button>
            <button type="button" class="adm-btn adm-btn-primary" id="admObNext">Volgende <span aria-hidden="true">→</span></button>
            <button type="submit" class="adm-btn adm-btn-primary" id="admObSubmit" hidden>Opslaan &amp; starten</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(ov);
    let obStep = 1;
    const setObStep = next => {
      obStep = Math.max(1, Math.min(3, Number(next) || 1));
      ov.querySelectorAll("[data-ob-step]").forEach(panel => {
        const active = Number(panel.dataset.obStep) === obStep;
        panel.hidden = !active; panel.classList.toggle("active", active);
      });
      ov.querySelectorAll("[data-ob-go]").forEach(button => {
        const index = Number(button.dataset.obGo);
        button.classList.toggle("active", index === obStep);
        button.classList.toggle("done", index < obStep);
      });
      document.getElementById("admObBack").hidden = obStep === 1;
      document.getElementById("admObNext").hidden = obStep === 3;
      document.getElementById("admObSubmit").hidden = obStep !== 3;
    };
    const validateObStep = () => {
      const panel = ov.querySelector(`[data-ob-step="${obStep}"]`);
      const invalid = [...panel.querySelectorAll("input,select")].find(field => !field.checkValidity());
      if (invalid) { invalid.reportValidity(); invalid.focus(); return false; }
      return true;
    };
    ov.querySelectorAll("[data-ob-go]").forEach(button => button.addEventListener("click", () => {
      const next = Number(button.dataset.obGo);
      if (next > obStep && !validateObStep()) return;
      setObStep(next);
    }));
    document.getElementById("admObNext").addEventListener("click", () => { if (validateObStep()) setObStep(obStep + 1); });
    document.getElementById("admObBack").addEventListener("click", () => setObStep(obStep - 1));
    document.getElementById("admObLater").addEventListener("click", () => {
      try { localStorage.setItem(obSnoozeKey(), new Date().toISOString()); } catch (_) {}
      ov.remove();
      renderObNudge();
    });
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
        ov.querySelector(".adm-onboarding-dialog").innerHTML = `
          <div class="adm-onboarding-launch">
            <span class="adm-onboarding-launch-icon">✓</span>
            <span class="adm-eyebrow">Je werkruimte staat klaar</span>
            <h2>Waar wil je beginnen?</h2>
            <p>Start met wat voor ${esc(t.name || "je organisatie")} vandaag het meest logisch is.</p>
            <div class="adm-onboarding-launch-grid">
              <button type="button" id="admObLaunchCustomer"><i>+</i><span><b>Eerste klant toevoegen</b><small>Start daarna meteen een offerte of werkbon</small></span><em>→</em></button>
              <button type="button" id="admObLaunchTeam"><i>+</i><span><b>Team instellen</b><small>Voeg medewerkers toe en plan hun werk</small></span><em>→</em></button>
            </div>
            <button type="button" class="adm-btn adm-btn-ghost" id="admObLaunchOverview">Eerst naar mijn overzicht</button>
          </div>`;
        try { localStorage.removeItem(obSnoozeKey()); } catch (_) {}
        document.getElementById("admObNudge")?.remove();
        document.getElementById("admObLaunchCustomer")?.addEventListener("click", () => { ov.remove(); openCustomerDrawer(null); });
        document.getElementById("admObLaunchTeam")?.addEventListener("click", () => { ov.remove(); switchView("employees"); });
        document.getElementById("admObLaunchOverview")?.addEventListener("click", () => { ov.remove(); switchView("dashboard"); });
        window.showToast && window.showToast("Bedrijfsgegevens opgeslagen", "success");
      } catch (err) {
        const eEl = document.getElementById("admObErr"); eEl.classList.add("visible"); eEl.textContent = err.message;
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
    b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:var(--wf-red);color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:6px 16px;display:flex;align-items:center;justify-content:center;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,.2)";
    b.innerHTML = `<span>Support-sessie actief · ${esc(s.agent || "supportmedewerker")} (${scope}). Deze sessie wordt geaudit.</span>`;
    const exit = document.createElement("button");
    exit.textContent = "Sessie verlaten";
    exit.style.cssText = "background:#fff;color:var(--wf-red);border:none;border-radius:6px;font:600 12px system-ui,sans-serif;padding:5px 12px;cursor:pointer;flex-shrink:0";
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
    if (CORE_UI_VIEWS.has(view)) return true;
    const e = window._wfpEnt;
    if (!e || e.views === "*") return true;
    return (e.views || []).includes(view);
  }

  // i18n-helper voor de admin-shell (t()-gebaseerde, dynamisch opgebouwde inhoud).
  function tA(key, fallback) { return window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback; }
  function uiDialog(options) {
    const dialog = window.wfpAdmin && window.wfpAdmin.askDialog;
    return typeof dialog === "function" ? dialog(options) : Promise.resolve(null);
  }
  function uiConfirm(message, options) {
    const cfg = options || {};
    return uiDialog({
      eyebrow: cfg.eyebrow || tA("adm.dialog.action", "Actie controleren"),
      title: cfg.title || tA("adm.dialog.confirmTitle", "Bevestig deze actie"),
      message, confirmLabel: cfg.confirmLabel || tA("adm.dialog.confirm", "Bevestigen"),
      danger: Boolean(cfg.danger),
    });
  }
  function uiInput(label, options) {
    const cfg = options || {};
    return uiDialog({
      eyebrow: cfg.eyebrow || tA("adm.dialog.input", "Aanvullende invoer"),
      title: cfg.title || label, message: cfg.message || "", label,
      input: cfg.input || "text", value: cfg.value || "", placeholder: cfg.placeholder || "",
      required: cfg.required !== false, requiredMessage: cfg.requiredMessage, minlength: cfg.minlength,
      confirmLabel: cfg.confirmLabel || tA("adm.dialog.continue", "Doorgaan"), danger: Boolean(cfg.danger),
    });
  }

  // Werkbon-status/prioriteit vertalen (server levert NL/canonieke waarden).
  function tWoStatus(s) {
    if (!s) return "-";
    const k = String(s).toLowerCase().replace(/\s+/g, "_");
    const map = {
      open: "dash.woseg.open", nieuw: "dash.woseg.open",
      in_progress: "dash.woseg.inprog", "in_uitvoering": "dash.woseg.inprog", bezig: "dash.woseg.inprog",
      done: "dash.woseg.done", voltooid: "dash.woseg.done", afgerond: "dash.woseg.done", klaar: "dash.woseg.done",
      geannuleerd: "dash.woseg.cancelled", cancelled: "dash.woseg.cancelled", annulatie: "dash.woseg.cancelled"
    };
    return map[k] ? tA(map[k], s) : s;
  }
  function tWoPrio(p) {
    const k = String(p || "normaal").toLowerCase();
    const map = { hoog: "adm.wo.prioHigh", normaal: "adm.wo.prioNormal", laag: "adm.wo.prioLow" };
    return map[k] ? tA(map[k], p || "normaal") : (p || "normaal");
  }
  // Verlof-type/status vertalen.
  function tLeaveType(tp) {
    const k = String(tp || "").toLowerCase();
    const known = ["vakantie","ziekte","adv","bijzonder","onbetaald","verlof"];
    return known.includes(k) ? tA("adm.ltype." + k, tp || "-") : (tp || "-");
  }
  function tLeaveStatus(s) {
    const k = String(s || "").toLowerCase();
    const map = { aangevraagd: "adm.lstatus.requested", goedgekeurd: "adm.lstatus.approved", geweigerd: "adm.lstatus.rejected" };
    return map[k] ? tA(map[k], s || "") : (s || "");
  }
  // Voertuigstatus vertalen.
  function tVehStatus(s) {
    const k = String(s || "active").toLowerCase();
    const map = { active: "adm.veh.stActive", actief: "adm.veh.stActive", maintenance: "adm.veh.stMaint", inactive: "adm.veh.stInactive", inactief: "adm.veh.stInactive" };
    return map[k] ? tA(map[k], s || "actief") : (s || "actief");
  }
  // Gelokaliseerde maand-/dagnamen voor de verlofkalender.
  function monthNames() {
    const lang = (window.wfpI18n && window.wfpI18n.lang) || "nl";
    const M = {
      nl: ["","Januari","Februari","Maart","April","Mei","Juni","Juli","Augustus","September","Oktober","November","December"],
      fr: ["","Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"],
      en: ["","January","February","March","April","May","June","July","August","September","October","November","December"]
    };
    return M[lang] || M.nl;
  }
  function weekdayShort() {
    const lang = (window.wfpI18n && window.wfpI18n.lang) || "nl";
    const D = {
      nl: ["Ma","Di","Wo","Do","Vr","Za","Zo"],
      fr: ["Lu","Ma","Me","Je","Ve","Sa","Di"],
      en: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
    };
    return D[lang] || D.nl;
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
      <div class="adm-brand-icon"><img src="/brand/one-symbol.svg" alt=""></div>
      <div class="adm-brand-text">
        <div class="adm-brand-name"><span>One</span><small>by Monargo</small></div>
        <div class="adm-brand-tenant" id="admCompanyName">Workspace laden…</div>
      </div>
      <button class="adm-sidebar-collapse" id="admSidebarCollapse" type="button" aria-label="Navigatie inklappen" title="Navigatie inklappen">
        <svg viewBox="0 0 24 24"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
    </div>

    <!-- h49 UX- en navigatiecontract: de 13 canonieke groepen. Rechten- en
         entitlement-bewust: applyEntitlements verbergt items én lege labels. -->
    <nav class="adm-nav" aria-label="Hoofdnavigatie">
      <div class="adm-nav-label" data-i18n="nav.sec.home">Home</div>
      <a class="adm-nav-item active" data-view="dashboard" href="#">
        <svg viewBox="0 0 24 24"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>
        <span data-i18n="nav.dashboard">Dashboard</span>
      </a>

      <div class="adm-nav-label" data-i18n="nav.sec.workinbox">Work Inbox</div>
      <a class="adm-nav-item" data-view="actions" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1S9.6 1.84 9.18 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-1.8 14-3.5-3.5 1.4-1.4 2.1 2.1 5.7-5.7 1.4 1.4-7.1 7.1z"/></svg>
        <span data-i18n="nav.actions">Actiecentrum</span>
        <span class="adm-nav-badge" id="admActionBadge" style="display:none">0</span>
      </a>
      <a class="adm-nav-item" data-view="inbox" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 12h-4c0 1.66-1.35 3-3 3s-3-1.34-3-3H5V5h14v10z"/></svg>
        <span data-i18n="nav.inbox">Klantvragen</span>
        <span class="adm-nav-badge" id="admInboxBadge" style="display:none">0</span>
      </a>
      <a class="adm-nav-item" data-view="messages" href="#">
        <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
        <span data-i18n="nav.messages">Berichten</span>
        <span class="adm-nav-badge" id="admMsgBadge" style="display:none">0</span>
      </a>

      <div class="adm-nav-label" data-i18n="nav.sec.crm">CRM</div>
      <a class="adm-nav-item" data-view="customers" href="#">
        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
        <span data-i18n="nav.customers">Klanten</span>
      </a>
      <a class="adm-nav-item" data-view="venues" href="#">
        <svg viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
        <span data-term="venuePlural">Locaties</span>
      </a>

      <div class="adm-nav-label" data-i18n="nav.sec.sales">Verkoop</div>
      <a class="adm-nav-item" data-view="offertes" href="#">
        <svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13zM10.5 11.5l1.4 1.4 2.6-2.6.7.7-3.3 3.3-2.1-2.1z"/></svg>
        <span data-i18n="nav.offertes">Offertes</span>
        <span class="adm-nav-badge" id="admOfferteBadge" style="display:none;background:var(--wf-yellow)">0</span>
      </a>
      <a class="adm-nav-item" data-view="contracts" href="#">
        <svg viewBox="0 0 24 24"><path d="M16 2H8C6.9 2 6 2.9 6 4v16c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 18H8V4h8v16zm-6-5h4v2h-4v-2zm0-4h4v2h-4v-2zm0-4h4v2h-4V7z"/></svg>
        <span data-i18n="nav.contracts">Contracten</span>
      </a>

      <div class="adm-nav-label" data-i18n="nav.sec.projects">Projecten</div>
      <a class="adm-nav-item" data-view="projects" href="#">
        <svg viewBox="0 0 24 24"><path d="M10 4H2v16h20V6H12l-2-2zm10 14H4V6h5.17l2 2H20v10zM7 11h10v2H7v-2zm0 4h7v2H7v-2z"/></svg>
        <span data-i18n="nav.projects">Projecten</span>
      </a>
      <a class="adm-nav-item" data-view="worksites" href="#">
        <svg viewBox="0 0 24 24"><path d="M13 3h-2v2H5v2h14V5h-6V3zm6 6H5c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-8c0-1.1-.9-2-2-2zm0 10H5v-6h14v6zm-9-5h4v4h-4v-4z"/></svg>
        <span data-i18n="nav.worksites">Werven</span>
      </a>
      <a class="adm-nav-item" data-view="portfolio" href="#">
        <svg viewBox="0 0 24 24"><path d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99l1.5 1.5z"/></svg>
        <span data-i18n="nav.portfolio">Portfolio & capaciteit</span>
      </a>

      <div class="adm-nav-label" data-i18n="nav.sec.planning">Planning</div>
      <a class="adm-nav-item" data-view="planning" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/></svg>
        <span data-i18n="nav.planning">Planning</span>
      </a>
      <a class="adm-nav-item" data-view="appointments" href="#">
        <svg viewBox="0 0 24 24"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>
        <span data-i18n="nav.appointments">Afspraken</span>
      </a>

      <div class="adm-nav-label" data-i18n="nav.sec.work">Werk</div>
      <a class="adm-nav-item" data-view="workorders" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        <span data-term="jobPlural">Werkbonnen</span>
      </a>
      <a class="adm-nav-item" data-view="workos" href="#">
        <svg viewBox="0 0 24 24"><path d="M4 3h6c.55 0 1 .45 1 1v6c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1V4c0-.55.45-1 1-1zm10 0h6c.55 0 1 .45 1 1v3c0 .55-.45 1-1 1h-6c-.55 0-1-.45-1-1V4c0-.55.45-1 1-1zM4 13h6c.55 0 1 .45 1 1v6c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1v-6c0-.55.45-1 1-1zm10-3h6c.55 0 1 .45 1 1v9c0 .55-.45 1-1 1h-6c-.55 0-1-.45-1-1v-9c0-.55.45-1 1-1z"/></svg>
        <span>Werkruimte</span>
      </a>
      <a class="adm-nav-item" data-view="clocking" href="#">
        <svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>
        <span data-i18n="nav.clocking">Prikklok</span>
      </a>
      <a class="adm-nav-item" data-view="leaves" href="#">
        <svg viewBox="0 0 24 24"><path d="M17 12h-5v5h5v-5zM16 1v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2h-1V1h-2zm3 18H5V8h14v11z"/></svg>
        <span data-i18n="nav.leaves">Verlof</span>
        <span class="adm-nav-badge" id="admLeaveBadge" style="display:none">0</span>
      </a>
      <a class="adm-nav-item" data-view="expenses" href="#">
        <svg viewBox="0 0 24 24"><path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/></svg>
        <span data-i18n="nav.expenses">Onkosten</span>
        <span class="adm-nav-badge" id="admExpenseBadge" style="display:none">0</span>
      </a>
      <a class="adm-nav-item" data-view="incidents" href="#">
        <svg viewBox="0 0 24 24"><path d="M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z"/></svg>
        <span data-i18n="nav.incidents">Werkongevallen</span>
      </a>

      <div class="adm-nav-label" data-i18n="nav.sec.construction">Bouw</div>
      <a class="adm-nav-item" data-view="ciaw" href="#">
        <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>
        <span data-i18n="nav.ciaw">Checkin@Work</span>
      </a>
      <a class="adm-nav-item" data-view="posted_workers" href="#">
        <svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
        <span data-i18n="nav.posted_workers">A1 / Limosa</span>
      </a>
      <a class="adm-nav-item" data-view="progress-claims" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM7 7h10v2H7V7zm5 10H7v-2h5v2zm5-4H7v-2h10v2z"/></svg>
        <span data-i18n="nav.progressClaims">Vorderingsstaten</span>
      </a>

      <div class="adm-nav-label" data-i18n="nav.sec.serviceassets">Service & Assets</div>
      <a class="adm-nav-item" data-view="assets" href="#">
        <svg viewBox="0 0 24 24"><path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.08-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.37-.31-.6-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98L14.5 2.42A.49.49 0 0014 2h-4a.49.49 0 00-.49.42L9.13 5.07c-.61.25-1.18.59-1.69.98l-2.49-1a.49.49 0 00-.6.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.05.32-.09.66-.09.98s.03.66.08.98l-2.11 1.65a.5.5 0 00-.12.64l2 3.46c.12.22.37.31.6.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.04.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.18-.58 1.69-.98l2.49 1c.23.08.48 0 .6-.22l2-3.46a.5.5 0 00-.12-.64l-2.02-1.65zM12 15.5A3.5 3.5 0 1112 8a3.5 3.5 0 010 7.5z"/></svg>
        <span data-i18n="nav.assets">Assets & onderhoud</span>
      </a>
      <a class="adm-nav-item" data-view="vehicles" href="#">
        <svg viewBox="0 0 24 24"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg>
        <span data-i18n="nav.vehicles">Wagenpark</span>
      </a>

      <div class="adm-nav-label" data-i18n="nav.sec.inventorypurchase">Voorraad & aankoop</div>
      <a class="adm-nav-item" data-view="stock" href="#">
        <svg viewBox="0 0 24 24"><path d="M20 6h-2.18c.07-.44.18-.88.18-1.36C18 2.1 15.9 0 13.36 0c-1.3 0-2.48.52-3.35 1.36L9 2.37 7.99 1.36C7.12.52 5.94 0 4.64 0 2.1 0 0 2.1 0 4.64c0 .48.11.92.18 1.36H2c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zM2 20V8h9v12H2zm11 0V8h9v12h-9z"/></svg>
        <span data-i18n="nav.stock">Stock</span>
      </a>
      <a class="adm-nav-item" data-view="inventory" href="#">
        <svg viewBox="0 0 24 24"><path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2a3 3 0 006 0h6a3 3 0 006 0h2v-5l-3-4zM6 18.5A1.5 1.5 0 116 15a1.5 1.5 0 010 3.5zM15 15H8.82A3 3 0 003 15V6h12v9zm3 3.5a1.5 1.5 0 110-3.5 1.5 1.5 0 010 3.5zM17 12V10h2l1.5 2H17z"/></svg>
        <span data-i18n="nav.inventory">Voorraadbeheer</span>
      </a>
      <a class="adm-nav-item" data-view="purchasing" href="#">
        <svg viewBox="0 0 24 24"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45A1.99 1.99 0 007 17h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03L20.88 5H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/></svg>
        <span data-i18n="nav.purchasing">Aankoop & leveranciers</span>
      </a>
      <a class="adm-nav-item" data-view="catalog" href="#">
        <svg viewBox="0 0 24 24"><path d="M21.9 8.89l-1.05-4.37c-.22-.9-1-1.52-1.91-1.52H5.05c-.9 0-1.69.63-1.9 1.52L2.1 8.89c-.24 1.02-.02 2.06.62 2.88.08.11.19.19.28.29V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-6.94c.09-.09.2-.18.28-.28.64-.82.87-1.87.62-2.89zM13 5.99h2l.55 2.28c.09.66-.4 1.28-1.05 1.28-.53 0-.97-.4-1.03-.92L13 5.99zm-6.5 3.56C6.44 9.87 6 9.55 6 9.02L6.55 6h2l-.48 2.63c-.06.53-.5.92-1.02.92h-.55zM18 19H6v-6.03c.08.01.15.03.23.03.87 0 1.66-.36 2.24-.95.6.6 1.4.95 2.28.95.87 0 1.66-.36 2.24-.95.6.6 1.4.95 2.28.95.08 0 .15-.02.23-.03V19z"/></svg>
        <span data-i18n="nav.catalog">Catalogus & prijzen</span>
      </a>

      <div class="adm-nav-label" data-i18n="nav.sec.financegrp">Financiën</div>
      <a class="adm-nav-item" data-view="facturen" href="#">
        <svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
        <span data-i18n="nav.facturen">Facturen</span>
        <span class="adm-nav-badge adm-nav-badge-red" id="admFacturenBadge" style="display:none">0</span>
      </a>
      <a class="adm-nav-item" data-view="payments" href="#">
        <svg viewBox="0 0 24 24"><path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
        <span data-i18n="nav.payments">Betalingen</span>
      </a>

      <div class="adm-nav-label" data-i18n="nav.sec.insights">Inzichten</div>
      <a class="adm-nav-item" data-view="reports" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
        <span data-i18n="nav.reports">Rapportages</span>
      </a>
      <a class="adm-nav-item" data-view="lists" href="#">
        <svg viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>
        <span data-i18n="nav.lists">Lijsten & export</span>
      </a>
      <a class="adm-nav-item" data-view="dossiers" href="#">
        <svg viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-1 8h-3v3h-2v-3h-3v-2h3V9h2v3h3v2z"/></svg>
        <span data-i18n="nav.dossiers">360°-dossiers</span>
      </a>

      <div class="adm-nav-label" data-i18n="nav.sec.system">Instellingen</div>
      <a class="adm-nav-item" data-view="employees" href="#">
        <svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
        <span data-i18n="nav.employees">Medewerkers</span>
      </a>
      <a class="adm-nav-item" data-view="profielen" href="#">
        <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>
        <span data-i18n="nav.profielen">Profielen &amp; rechten</span>
      </a>
      <a class="adm-nav-item" data-view="employee_records" href="#">
        <svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-2 14c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-8V3.5L18.5 8H15z"/></svg>
        <span data-i18n="nav.employeeRecords">Personeelsfiches</span>
      </a>
      <a class="adm-nav-item" data-view="templates" href="#">
        <svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
        <span data-i18n="nav.templates">Documentsjablonen</span>
      </a>
      <a class="adm-nav-item" data-view="formulieren" href="#">
        <svg viewBox="0 0 24 24"><path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>
        <span data-i18n="nav.formulieren">Formulieren</span>
      </a>
      <a class="adm-nav-item" data-view="integrations" href="#">
        <svg viewBox="0 0 24 24"><path d="M22 7h-7V2H9v5H2v15h20V7zM11 4h2v3h-2V4zm9 16H4V9h16v11zM9 13h2v2H9v-2zm4 0h2v2h-2v-2z"/></svg>
        <span data-i18n="nav.integrations">Koppelingen</span>
      </a>
      <a class="adm-nav-item" data-view="webhooks" href="#">
        <svg viewBox="0 0 24 24"><path d="M10 9a3 3 0 114.44 2.63l1.9 3.29a4.5 4.5 0 11-1.73 1l-1.9-3.28A3 3 0 0110 9zm-5.5 8.5a4.5 4.5 0 016.4-4.08l.9-1.56A3 3 0 1113.53 13l-.9 1.56a4.5 4.5 0 11-8.13 2.94z"/></svg>
        <span data-i18n="nav.webhooks">Webhooks</span>
      </a>
      <a class="adm-nav-item" data-view="audit" href="#">
        <svg viewBox="0 0 24 24"><path d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm2-7h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z"/></svg>
        <span data-i18n="nav.audit">Audittrail</span>
      </a>
      <a class="adm-nav-item" data-view="billing" href="#">
        <svg viewBox="0 0 24 24"><path d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"/></svg>
        <span data-i18n="nav.billing">Facturatie</span>
        <span class="adm-nav-badge" id="admInvoiceBadge" style="display:none">0</span>
      </a>
      <a class="adm-nav-item" data-view="roadmap" href="#">
        <svg viewBox="0 0 24 24"><path d="M21 3L3 10.53v.98l6.84 2.65L12.48 21h.98L21 3z"/></svg>
        <span data-i18n="nav.roadmap">Roadmap</span>
      </a>
      <a class="adm-nav-item" data-view="settings" href="#">
        <svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>
        <span data-i18n="nav.settings">Instellingen</span>
      </a>
    </nav>

    <!-- Sidebar footer -->
    <div class="adm-sidebar-foot">
      <div class="adm-user-row" id="admUserChip">
        <div class="adm-user-av" id="admUserAvatar">A</div>
        <div class="adm-user-details">
          <div class="adm-user-name" id="admUserName">Admin</div>
          <div class="adm-user-role" data-i18n="role.admin">Beheerder</div>
        </div>
      </div>
      <button class="adm-logout-btn" id="admLogoutBtn" title="Uitloggen">
        <svg viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>
      </button>
    </div>
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
        <input type="text" class="adm-search-input" id="admGlobalSearch" data-i18n-ph="nav.searchPh" placeholder="Zoek klant, werkbon, factuur of medewerker…" autocomplete="off">
        <span class="adm-search-kbd">⌘K</span>
        <div class="adm-search-results" id="admSearchResults"></div>
      </div>
      <!-- Right actions -->
      <div class="adm-topbar-right">
        <button class="adm-clockbtn" id="admLangToggle" title="Changer de langue / Taal wisselen" style="padding:0 12px;">FR</button>
        <!-- Persoonlijke prikklok (iedereen, ook beheerder, kan in-/uitklokken) -->
        <button class="adm-clockbtn" id="admClockBtn" title="Klok jezelf in of uit">
          <span class="adm-clockbtn-dot" id="admClockDot"></span>
          <svg class="adm-clockbtn-ico" viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67V7z"/></svg>
          <span id="admClockLbl">Inklokken</span>
        </button>
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
              <button class="adm-notif-hd-clear" id="admNotifOpenActions">Actiecentrum</button>
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
            <div class="adm-topbar-user-role" data-i18n="role.admin">Beheerder</div>
          </div>
        </div>
      </div>
    </header>
    <!-- Page header -->
    <div class="adm-page-head" id="admPageHead">
      <h1 class="adm-page-title" id="admPageTitle">Dashboard</h1>
    </div>
    <div class="adm-flow-nav" id="admFlowNav" aria-label="Commerciële en operationele flow"></div>
    <div class="adm-content" id="admContent">
      <div class="adm-loading"><div class="adm-spinner"></div>Laden…</div>
    </div>
  </main>
</div>

<!-- Platformbrede editorwerkruimte -->
<div class="adm-overlay hidden" id="admOverlay"></div>
<aside class="adm-drawer hidden" id="admDrawer" role="dialog" aria-modal="true" aria-labelledby="admDrawerTitle" tabindex="-1" data-editor-kind="record">
  <div class="adm-drawer-header">
    <div class="adm-editor-heading">
      <span class="adm-editor-context" id="admDrawerContext">Bewerkingsruimte</span>
      <h2 id="admDrawerTitle">Medewerker toevoegen</h2>
    </div>
    <button type="button" class="adm-drawer-close" id="admDrawerClose" aria-label="Bewerkingsruimte sluiten">&times;</button>
  </div>
  <div class="adm-drawer-body" id="admDrawerBody"></div>
</aside>

`;

    organizeAdminNavigation(el);

    // nav click + hover-submenu (flyout) per module
    el.querySelectorAll(".adm-nav-item[data-view]").forEach(a => {
      a.addEventListener("click", e => {
        e.preventDefault();
        switchView(a.dataset.view);
        document.getElementById("admSidebar")?.classList.remove("open");
        hideNavFlyout(true);
      });
      a.addEventListener("mouseenter", () => showNavFlyout(a, a.dataset.view));
      a.addEventListener("mouseleave", () => hideNavFlyout());
    });
    document.getElementById("admSidebar")?.addEventListener("scroll", () => hideNavFlyout(true), { passive: true });

    // sidebar toggle
    document.getElementById("admMenuToggle").addEventListener("click", () => {
      document.getElementById("admSidebar").classList.toggle("open");
    });

    // Compacte desktopnavigatie. De voorkeur blijft per browser bewaard.
    const layout = el.querySelector(".adm-layout");
    const collapseBtn = document.getElementById("admSidebarCollapse");
    const applySidebarState = collapsed => {
      layout.classList.toggle("nav-collapsed", collapsed);
      collapseBtn?.setAttribute("aria-expanded", String(!collapsed));
      collapseBtn?.setAttribute("title", collapsed ? "Navigatie uitklappen" : "Navigatie inklappen");
      localStorage.setItem("monargo_admin_nav_collapsed", collapsed ? "1" : "0");
      hideNavFlyout(true);
    };
    applySidebarState(localStorage.getItem("monargo_admin_nav_collapsed") === "1");
    collapseBtn?.addEventListener("click", () => applySidebarState(!layout.classList.contains("nav-collapsed")));

    // logout
    document.getElementById("admLogoutBtn").addEventListener("click", () => {
      localStorage.removeItem("wfp_token");
      location.reload();
    });

    // drawer close
    document.getElementById("admDrawerClose").addEventListener("click", closeDrawer);
    document.getElementById("admOverlay").addEventListener("click", closeDrawer);
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && !document.getElementById("admDrawer")?.classList.contains("hidden")) closeDrawer();
    });

    // primary action btn
    document.getElementById("admPrimaryAction").addEventListener("click", () => {
      const d = window.wfpAdmin.drawers;
      const map = {
        employees: () => d.employee(null), messages: () => d.message(),
        customers: () => d.customer(null), offertes: () => d.offerte(null),
        facturen: () => d.factuur(null), venues: () => d.venue(null),
        vehicles: () => d.vehicle(null), stock: () => d.stock(null),
        projects: () => d.project(), worksites: () => d.worksite(), contracts: () => d.contract(),
        purchasing: () => d.purchasing(), inventory: () => d.inventory(), assets: () => d.asset(),
        planning: () => d.shift(null), workorders: () => d.workorder(null),
        appointments: () => d.appointment(null),
        incidents: () => d.incident(null),
        inbox: () => d.inquiry(null)
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
    dashboard: "Dashboard", actions: "Actiecentrum", operations: "Overzicht", workos: "Werkruimte", employees: "Medewerkers", planning: "Planning",
    appointments: "Afspraken",
    clocking: "Prikklok", leaves: "Verlof", expenses: "Onkosten",
    workorders: "Werkbonnen", messages: "Berichten", reports: "Rapportages",
    customers: "Klanten", inbox: "Klantvragen", offertes: "Offertes", facturen: "Facturen", venues: "Locaties", vehicles: "Voertuigen",
    stock: "Stock", billing: "Facturatie", projects: "Projecten", worksites: "Werven", contracts: "Contracten",
    purchasing: "Aankoop & leveranciers", inventory: "Voorraadbeheer", assets: "Assets & onderhoud",
    incidents: "Werkongevallen",
    ciaw: "Checkin@Work (CIAW)", posted_workers: "A1 / Limosa detachering",
    integrations: "Koppelingen", templates: "Documentsjablonen", roadmap: "Roadmap", audit: "Audittrail", settings: "Instellingen",
    // Nieuwe domeinwerkruimtes (API-CONTRACTS-V2 · gerenderd door admin-domains.js)
    catalog: "Catalogus & prijzen", "progress-claims": "Vorderingsstaten",
    employee_records: "Personeelsfiches", portfolio: "Portfolio & capaciteit",
    webhooks: "Webhooks", lists: "Lijsten & export", payments: "Betalingen"
  };

  const VIEW_BTN_LABEL = {
    employees: "+ Medewerker", messages: "+ Bericht", customers: "+ Klant", appointments: "+ Afspraak",
    incidents: "+ Werkongeval", inbox: "+ Klantvraag",
    planning: "+ Inplannen", workorders: "+ Werkbon",
    offertes: "+ Offerte", facturen: "+ Factuur", venues: "+ Locatie", vehicles: "+ Voertuig", stock: "+ Artikel",
    projects: "+ Project", worksites: "+ Werf", contracts: "+ Contract", purchasing: "+ Bestelling", inventory: "+ Mutatie", assets: "+ Asset",
    payments: "+ Betaling"
  };

  const ADMIN_NAV_GROUPS = [
    { key:"nav.sec.home", fallback:"Home", views:["dashboard", "actions", "inbox", "messages"] },
    { key:"nav.sec.operations", fallback:"Operaties", views:["operations", "planning", "workorders", "projects", "worksites", "vehicles", "stock", "appointments", "assets"] },
    { key:"nav.sec.finance", fallback:"Klanten & Financiën", views:["customers", "venues", "offertes", "contracts", "catalog", "purchasing", "inventory", "facturen", "payments"] },
    { key:"nav.sec.team", fallback:"Team", views:["employees", "employee_records", "clocking", "leaves", "expenses"] },
    { key:"nav.sec.compliance", fallback:"Compliance", views:["incidents", "ciaw", "posted_workers", "progress-claims"] },
    { key:"nav.sec.insights", fallback:"Inzichten", views:["reports", "portfolio", "lists", "dossiers"] },
    { key:"nav.sec.system", fallback:"Instellingen", views:["workos", "templates", "formulieren", "integrations", "webhooks", "profielen", "audit", "billing", "roadmap", "settings"] }
  ];

  function operationsNavItem() {
    const item = document.createElement("a");
    item.className = "adm-nav-item";
    item.dataset.view = "operations";
    item.href = "#";
    item.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h6c.55 0 1 .45 1 1v6c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1V4c0-.55.45-1 1-1zm10 0h6c.55 0 1 .45 1 1v3c0 .55-.45 1-1 1h-6c-.55 0-1-.45-1-1V4c0-.55.45-1 1-1zM4 13h6c.55 0 1 .45 1 1v6c0 .55-.45 1-1 1H4c-.55 0-1-.45-1-1v-6c0-.55.45-1 1-1zm10-3h6c.55 0 1 .45 1 1v9c0 .55-.45 1-1 1h-6c-.55 0-1-.45-1-1v-9c0-.55.45-1 1-1z"/></svg><span data-i18n="nav.operationsOverview">Overzicht</span>`;
    return item;
  }

  function organizeAdminNavigation(platform) {
    const nav = platform.querySelector(".adm-nav");
    if (!nav) return;
    const items = new Map(
      [...nav.querySelectorAll(".adm-nav-item[data-view]")].map(item => [item.dataset.view, item])
    );
    items.set("operations", operationsNavItem());
    nav.replaceChildren();

    ADMIN_NAV_GROUPS.forEach(group => {
      const available = group.views.map(view => items.get(view)).filter(Boolean);
      if (!available.length) return;
      const label = document.createElement("div");
      label.className = "adm-nav-label";
      label.dataset.i18n = group.key;
      label.textContent = group.fallback;
      nav.appendChild(label);
      available.forEach(item => nav.appendChild(item));
    });
  }

  const FLOW_VIEWS = [
    { view:"customers", label:"Klant" },
    { view:"projects", label:"Project" },
    { view:"offertes", label:"Offerte", optional:true },
    { view:"planning", label:"Planning" },
    { view:"workorders", label:"Werkbon" },
    { view:"facturen", label:"Factuur" }
  ];

  function updateFlowNav(activeView) {
    const host = document.getElementById("admFlowNav");
    if (!host) return;
    const visibleSteps = FLOW_VIEWS.filter(step => viewEnabled(step.view));
    const inFlow = visibleSteps.some(step => step.view === activeView);
    host.classList.toggle("visible", inFlow);
    if (!inFlow) { host.innerHTML = ""; return; }
    const activeIndex = visibleSteps.findIndex(step => step.view === activeView);
    host.innerHTML = `<span class="adm-flow-label">Van aanvraag tot betaling</span><div class="adm-flow-steps">${visibleSteps.map((step, index) => `
      <button type="button" class="adm-flow-step ${index < activeIndex ? "done" : ""} ${index === activeIndex ? "active" : ""}" data-flow-view="${step.view}" aria-current="${index === activeIndex ? "step" : "false"}">
        <span class="adm-flow-index">${index < activeIndex ? "✓" : index + 1}</span>
        <span>${step.label}${step.optional ? `<small>optioneel</small>` : ""}</span>
      </button>${index < visibleSteps.length - 1 ? `<span class="adm-flow-line ${index < activeIndex ? "done" : ""}"></span>` : ""}`).join("")}</div>`;
    host.querySelectorAll("[data-flow-view]").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.flowView)));
  }

  // ── Hover-submenu per module (flyout naast de zijbalk) ─────
  // Geen lijstfilters hier (die staan al in de view zelf): het submenu is
  // voor de instellingen/configuratie en acties die bij de module horen.
  // Item-vormen: go {view, click knop-id, scroll element-id} of drawer
  // (nieuw-record-paneel). needsView gate't cross-module-links op entitlements.
  function navSubmenus() {
    return {
      workos: [
        { label: "+ Nieuwe taak", go: { view: "workos", click: "workOsNewTask" } },
        { label: "+ Formulier ontwerpen", go: { view: "workos", click: "workOsNewTemplate" } },
        { label: "+ Bestand uploaden", go: { view: "workos", click: "workOsUploadFile" } },
        { label: "+ Contactmoment", go: { view: "workos", click: "workOsNewCommunication" } }
      ],
      planning: [
        { label: "+ Nieuwe shift", go: { view: "planning", click: "admAddShift" } }
      ],
      appointments: [
        { label: "+ Afspraak", go: { view: "appointments", click: "admNewApt" } }
      ],
      incidents: [
        { label: "+ Werkongeval", go: { view: "incidents", click: "admNewInc" } }
      ],
      inbox: [
        { label: "+ Klantvraag", go: { view: "inbox", click: "admNewInq" } }
      ],
      clocking: [
        { label: "+ Manuele registratie", go: { view: "clocking", click: "admClockAdd" } },
        { label: "Instellingen", settingsSection: "clocking", needsView: "settings" }
      ],
      leaves: [
        { label: "+ Verlof aanmaken", go: { view: "leaves", click: "admLeaveNew" } }
      ],
      workorders: [
        { label: "+ Nieuwe werkbon", go: { view: "workorders", click: "admNewWO" } },
        { label: "Documentsjabloon", go: { view: "templates" }, needsView: "templates" }
      ],
      customers: [
        { label: "+ Nieuwe klant", go: { view: "customers" }, drawer: "customer" }
      ],
      offertes: [
        { label: "+ Nieuwe offerte", go: { view: "offertes" }, drawer: "offerte" },
        { label: "Documentsjabloon", go: { view: "templates" }, needsView: "templates" }
      ],
      facturen: [
        { label: "+ Nieuwe factuur", go: { view: "facturen" }, drawer: "factuur" },
        { label: "Betalingen", go: { view: "payments" }, needsView: "payments" },
        { label: "Instellingen", settingsSection: "facturen", needsView: "settings" },
        { label: "Documentsjabloon", go: { view: "templates" }, needsView: "templates" }
      ],
      payments: [
        { label: "+ Betaling registreren", go: { view: "payments", click: "payNew" } }
      ],
      employees: [
        { label: "+ Nieuwe medewerker", go: { view: "employees" }, drawer: "employee" },
        { label: "Instellingen", settingsSection: "employees", needsView: "settings" }
      ],
      messages: [
        { label: "+ Nieuw bericht", go: { view: "messages" }, drawer: "message" }
      ],
      vehicles: [
        { label: "+ Nieuw voertuig", go: { view: "vehicles" }, drawer: "vehicle" }
      ],
      projects: [
        { label: "+ Nieuw project", go: { view: "projects" }, drawer: "project" },
        { label: "Portfolio & capaciteit", go: { view: "portfolio" }, needsView: "portfolio" }
      ],
      worksites: [
        { label: "+ Nieuwe werf", go: { view: "worksites" }, drawer: "worksite" },
        { label: "+ Meerwerk of minderwerk", go: { view: "worksites" }, drawer: "changeorder" }
      ],
      contracts: [
        { label: "+ Nieuw contract", go: { view: "contracts" }, drawer: "contract" }
      ],
      purchasing: [
        { label: "+ Nieuwe bestelling", go: { view: "purchasing" }, drawer: "purchasing" }
      ],
      inventory: [
        { label: "+ Voorraadmutatie", go: { view: "inventory" }, drawer: "inventory" }
      ],
      integrations: [
        { label: "Connectoren", go: { view: "integrations" }, integrationMode: "connectors" },
        { label: "Automatisaties", go: { view: "integrations" }, integrationMode: "automations" },
        { label: "Eigen velden", go: { view: "integrations" }, integrationMode: "fields" }
      ],
      assets: [
        { label: "+ Nieuw asset", go: { view: "assets" }, drawer: "asset" }
      ],
      stock: [
        { label: "+ Nieuw artikel", go: { view: "stock" }, drawer: "stock" }
      ],
      venues: [
        { label: "+ Nieuwe locatie", go: { view: "venues" }, drawer: "venue" }
      ],
      // De centrale Instellingen bevat enkel overkoepelende zaken (bedrijf,
      // beveiliging, backup, abonnement). Module-gebonden instellingen wonen
      // onder de module zelf, dus hier geen module-links.
      settings: []
    };
  }

  let _flyHideTimer = null;
  function ensureNavFlyout() {
    let fly = document.getElementById("admNavFlyout");
    if (!fly) {
      fly = document.createElement("div");
      fly.id = "admNavFlyout";
      fly.className = "adm-nav-flyout";
      fly.addEventListener("mouseenter", () => clearTimeout(_flyHideTimer));
      fly.addEventListener("mouseleave", () => hideNavFlyout());
      document.getElementById("platform-admin").appendChild(fly);
    }
    return fly;
  }

  function hideNavFlyout(now) {
    clearTimeout(_flyHideTimer);
    const fly = document.getElementById("admNavFlyout");
    if (!fly) return;
    if (now) { fly.classList.remove("open"); return; }
    _flyHideTimer = setTimeout(() => fly.classList.remove("open"), 140);
  }

  function showNavFlyout(anchor, view) {
    // Alleen op toestellen met echte hover (pc); mobiel houdt de gewone nav.
    if (!window.matchMedia("(hover: hover)").matches) return;
    const items = (navSubmenus()[view] || []).filter(i => !i.needsView || viewEnabled(i.needsView));
    if (!items.length) { hideNavFlyout(); return; }
    const fly = ensureNavFlyout();
    const termTitle = window.wfpTerms && (view === "workorders" ? window.wfpTerms.t("jobPlural") : view === "venues" ? window.wfpTerms.t("venuePlural") : null);
    fly.innerHTML = `<div class="adm-nav-flyout-title">${esc(termTitle || VIEW_LABELS[view] || view)}</div>`
      + items.map((i, idx) => `<button type="button" class="adm-nav-flyout-item${i.drawer || (i.go && i.go.click) ? " act" : ""}" data-idx="${idx}">${esc(i.label)}</button>`).join("");
    fly.querySelectorAll(".adm-nav-flyout-item").forEach(btn => {
      btn.addEventListener("click", () => navFlyoutGo(view, items[Number(btn.dataset.idx)]));
    });
    fly.classList.add("open");
    const r = anchor.getBoundingClientRect();
    const top = Math.max(8, Math.min(r.top - 6, window.innerHeight - fly.offsetHeight - 8));
    fly.style.top = `${top}px`;
    fly.style.left = `${r.right + 8}px`;
    clearTimeout(_flyHideTimer);
  }

  function navFlyoutGo(parentView, item) {
    hideNavFlyout(true);
    if (item.integrationMode) {
      _integrationMode = item.integrationMode;
      switchView("integrations");
      return;
    }
    // Module-instelling: open de gefocuste sectie in de Instellingen-view.
    if (item.settingsSection) {
      _settingsSection = item.settingsSection;
      switchView("settings");
      return;
    }
    const g = item.go || {};
    switchView(g.view || parentView);
    // Views renderen async: kort pollen tot het doel er is, dan de actie doen.
    let tries = 0;
    const apply = () => {
      if (item.drawer) {
        const d = window.wfpAdmin && window.wfpAdmin.drawers;
        if (!d || !d[item.drawer]) return false;
        d[item.drawer](null);
        return true;
      }
      if (g.click) {
        const el = document.getElementById(g.click);
        if (!el) return false;
        el.click();
        return true;
      }
      if (g.set) {
        const el = document.getElementById(g.set.id);
        if (!el) return false;
        el.value = g.set.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      if (g.scroll) {
        const el = document.getElementById(g.scroll);
        if (!el) return false;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const card = el.closest(".adm-card");
        if (card) { card.style.outline = "2px solid var(--wf-blue)"; card.style.outlineOffset = "2px"; setTimeout(() => { card.style.outline = ""; }, 1800); }
        return true;
      }
      return true;
    };
    const timer = setInterval(() => { tries += 1; if (apply() || tries > 25) clearInterval(timer); }, 120);
  }

  function switchView(view) {
    _currentView = view;
    document.getElementById("admMain")?.setAttribute("data-view", view);
    document.querySelectorAll(".adm-nav-item").forEach(a => {
      const isActive = a.dataset.view === view;
      a.classList.toggle("active", isActive);
      if (isActive) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    // Sector-terminologie voor de paginatitel (Werkbonnen/Locaties → sectorwoord),
    // anders de vertaalde nav-naam.
    const termTitle = window.wfpTerms && (view === "workorders" ? window.wfpTerms.t("jobPlural") : view === "venues" ? window.wfpTerms.t("venuePlural") : null);
    document.getElementById("admPageTitle").textContent = termTitle || tA("nav." + view, VIEW_LABELS[view] || view);
    updateFlowNav(view);

    const btn = document.getElementById("admPrimaryAction");
    const hasBtn = VIEW_BTN_LABEL[view];
    btn.style.display = hasBtn ? "" : "none";
    if (hasBtn) btn.textContent = tA("adm.btn." + view, hasBtn);

    const content = document.getElementById("admContent");
    content.innerHTML = `<div class="adm-loading">Laden…</div>`;

    // View-renderers komen uit de gedeelde registry (window.wfpAdmin.views).
    // Kern-renderers + uitgesplitste module-renderers registreren zich daar.
    const reg = window.wfpAdmin.views;
    if (reg[view]) reg[view]();
  }

  // ── Actiecentrum · dagelijkse uitzonderingen uit bestaande modules ───────
  let _actionFilter = "all";

  function actionDateLabel(value) {
    if (!value) return "";
    const date = new Date(String(value).length === 10 ? `${value}T12:00:00` : value);
    if (Number.isNaN(date.getTime())) return "";
    const today = new Date();
    const todayIso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const iso = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (iso === todayIso) return tA("actions.today", "Vandaag");
    return new Intl.DateTimeFormat((window.wfpI18n && window.wfpI18n.lang) || "nl-BE", { day:"numeric", month:"short" }).format(date);
  }

  async function renderActionCenter() {
    const content = document.getElementById("admContent");
    content.innerHTML = `<div class="adm-loading"><div class="adm-spinner"></div>${tA("actions.loading", "Acties verzamelen…")}</div>`;
    const now = new Date();
    const todayIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const [notifData, leaveData, expenseData, invoiceData, workorderData] = await Promise.all([
      api("GET", "/notifications").catch(() => ({ rows: [] })),
      viewEnabled("leaves") ? api("GET", "/leaves?status=aangevraagd").catch(() => ({ leaves: [] })) : { leaves: [] },
      viewEnabled("expenses") ? api("GET", "/expenses").catch(() => ({ expenses: [] })) : { expenses: [] },
      viewEnabled("facturen") ? api("GET", "/facturen").catch(() => ({ invoices: [] })) : { invoices: [] },
      viewEnabled("workorders") ? api("GET", "/workorders").catch(() => ({ workorders: [] })) : { workorders: [] }
    ]);

    const notifications = notifData.rows || notifData.notifications || [];
    const leaves = leaveData.leaves || (Array.isArray(leaveData) ? leaveData : []);
    const expenses = expenseData.expenses || [];
    const invoices = invoiceData.invoices || [];
    const workorders = workorderData.workorders || [];
    const eur = new Intl.NumberFormat("nl-BE", { style:"currency", currency:"EUR", maximumFractionDigits:0 });
    const isUnread = n => n.status !== "read";
    const isHigh = n => ["critical", "urgent", "high", "hoog"].includes(String(n.priority || n.severity || "").toLowerCase());
    const pendingExpenses = expenses.filter(e => !e.status || ["pending", "ingediend"].includes(String(e.status).toLowerCase()));
    const pendingLeaves = leaves.filter(l => !l.status || ["pending", "aangevraagd", "requested"].includes(String(l.status).toLowerCase()));
    const overdueInvoices = invoices.filter(i => String(i.status).toLowerCase() === "overdue" || (String(i.status).toLowerCase() === "open" && i.dueDate && i.dueDate < todayIso));
    const activeWo = w => ["open", "in_progress", "nieuw", "bezig", "in uitvoering", "in_uitvoering"].includes(String(w.status || "open").toLowerCase());
    const lateWorkorders = workorders.filter(w => activeWo(w) && w.scheduledDate && w.scheduledDate < todayIso);

    let items = [
      ...overdueInvoices.map(i => ({
        id:`invoice-${i.id}`, priority:"critical", category:"finance", view:"facturen", source:"invoice", timestamp:i.dueDate || i.createdAt || "",
        eyebrow:tA("actions.finance", "Financieel"), title:tA("actions.invoiceOverdue", "Factuur {n} is vervallen").replace("{n}", i.number || ""),
        meta:`${i.customerName || tA("actions.customerUnknown", "Klant niet ingevuld")} · ${eur.format(Number(i.total || 0))}`, date:i.dueDate
      })),
      ...lateWorkorders.map(w => ({
        id:`workorder-${w.id}`, priority:"critical", category:"operations", view:"workorders", source:"workorder", timestamp:w.scheduledDate || w.createdAt || "",
        eyebrow:tA("actions.operations", "Operaties"), title:tA("actions.workorderLate", "{job} vraagt opvolging").replace("{job}", w.number || w.title || tA("actions.workorder", "Werkbon")),
        meta:w.clientName || w.customerName || w.description || tA("actions.noCustomer", "Nog geen klant gekoppeld"), date:w.scheduledDate
      })),
      ...pendingLeaves.map(l => ({
        id:`leave-${l.id}`, priority:"approval", category:"approvals", view:"leaves", source:"leave", timestamp:l.createdAt || l.startDate || "",
        eyebrow:tA("actions.approval", "Goedkeuring"), title:tA("actions.leaveRequest", "Verlofaanvraag van {name}").replace("{name}", uName(l)),
        meta:`${tLeaveType(l.type)} · ${l.startDate || ""}${l.endDate && l.endDate !== l.startDate ? ` – ${l.endDate}` : ""}`, date:l.startDate
      })),
      ...pendingExpenses.map(e => ({
        id:`expense-${e.id}`, priority:"approval", category:"approvals", view:"expenses", source:"expense", timestamp:e.createdAt || e.date || "",
        eyebrow:tA("actions.approval", "Goedkeuring"), title:tA("actions.expenseRequest", "Onkostennota van {name}").replace("{name}", uName(e)),
        meta:`${eur.format(Number(e.amount || 0))}${e.description ? ` · ${e.description}` : ""}`, date:e.date || e.createdAt
      })),
      ...notifications.filter(isUnread).map(n => ({
        id:`notification-${n.id}`, entityId:n.id, priority:isHigh(n) ? "critical" : "followup", category:"notifications", view:n.view && viewEnabled(n.view) && window.wfpAdmin?.views?.[n.view] ? n.view : null, source:"notification", timestamp:n.createdAt || "",
        eyebrow:isHigh(n) ? tA("actions.urgent", "Dringend") : tA("actions.notification", "Melding"), title:n.title || n.message || tA("actions.notification", "Melding"),
        meta:n.body || tA("actions.reviewNotification", "Bekijk de melding en bepaal de volgende stap."), date:n.createdAt, canComplete:true
      }))
    ];
    const rank = { critical:0, approval:1, followup:2 };
    items.sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9) || String(a.timestamp || "").localeCompare(String(b.timestamp || "")));

    const counts = {
      all:items.length,
      critical:items.filter(i => i.priority === "critical").length,
      approvals:items.filter(i => i.category === "approvals").length,
      finance:items.filter(i => i.category === "finance").length,
      operations:items.filter(i => i.category === "operations").length
    };
    const filters = [
      ["all", tA("actions.filterAll", "Alles")], ["critical", tA("actions.filterCritical", "Kritiek")],
      ["approvals", tA("actions.filterApprovals", "Goedkeuren")], ["finance", tA("actions.filterFinance", "Financieel")],
      ["operations", tA("actions.filterOperations", "Operaties")]
    ];
    const visibleItems = filter => items.filter(i => filter === "all" || (filter === "critical" ? i.priority === "critical" : i.category === filter));
    const itemMarkup = item => `<article class="adm-action-row priority-${item.priority}" data-action-id="${esc(item.id)}">
      <span class="adm-action-priority" aria-hidden="true"></span>
      <div class="adm-action-copy"><span>${esc(item.eyebrow)}</span><h4>${esc(item.title)}</h4><p>${esc(item.meta)}</p></div>
      <time>${esc(actionDateLabel(item.date))}</time>
      ${item.canComplete ? `<button type="button" class="adm-action-done" data-action-read="${esc(item.entityId)}">${tA("actions.done", "Klaar")}</button>` : ""}
      ${item.view ? `<button type="button" class="adm-action-open" data-action-view="${esc(item.view)}">${tA("actions.open", "Open")} <span aria-hidden="true">→</span></button>` : ""}
    </article>`;

    const paint = filter => {
      _actionFilter = filters.some(([key]) => key === filter) ? filter : "all";
      const visible = visibleItems(_actionFilter);
      const next = visible[0] || null;
      const dateLabel = new Intl.DateTimeFormat((window.wfpI18n && window.wfpI18n.lang) || "nl-BE", { weekday:"long", day:"numeric", month:"long" }).format(now);
      content.innerHTML = `<div class="adm-action-center">
        <section class="adm-action-hero">
          <div><span class="adm-eyebrow">${tA("actions.eyebrow", "Dagelijkse cockpit")} · ${esc(dateLabel)}</span><h2>${tA("actions.title", "Vandaag onder controle")}</h2><p>${tA("actions.subtitle", "Werk één prioriteit tegelijk af en ga rechtstreeks naar de juiste flow.")}</p></div>
          <button type="button" class="adm-btn adm-btn-secondary adm-action-refresh" id="admActionRefresh" aria-label="${tA("actions.refresh", "Vernieuwen")}"><span aria-hidden="true">↻</span> ${tA("actions.refresh", "Vernieuwen")}</button>
        </section>
        <section class="adm-action-stats" aria-label="${tA("actions.summary", "Actieoverzicht")}">
          ${filters.slice(0, 4).map(([key, label]) => `<button type="button" class="adm-action-stat ${_actionFilter === key ? "active" : ""}" data-action-filter="${key}"><span>${esc(label)}</span><strong>${counts[key]}</strong><small>${key === "all" ? tA("actions.statAll", "open acties") : key === "critical" ? tA("actions.statCritical", "eerst behandelen") : key === "approvals" ? tA("actions.statApprovals", "wachten op jou") : tA("actions.statFinance", "financiële opvolging")}</small></button>`).join("")}
        </section>
        <section class="adm-next-action ${next ? `priority-${next.priority}` : "is-clear"}">
          ${next ? `<div class="adm-next-icon"><span aria-hidden="true">${next.priority === "critical" ? "!" : next.priority === "approval" ? "✓" : "→"}</span></div><div><span class="adm-eyebrow">${tA("actions.next", "Volgende beste actie")}</span><h3>${esc(next.title)}</h3><p>${esc(next.meta)}</p></div>${next.view ? `<button type="button" class="adm-btn adm-btn-primary" data-action-view="${esc(next.view)}">${tA("actions.handle", "Nu behandelen")} <span aria-hidden="true">→</span></button>` : `<button type="button" class="adm-btn adm-btn-primary" data-action-read="${esc(next.entityId)}">${tA("actions.done", "Klaar")}</button>`}` : `<div class="adm-next-icon"><span aria-hidden="true">✓</span></div><div><span class="adm-eyebrow">${tA("actions.clearEyebrow", "Werkruimte in orde")}</span><h3>${tA("actions.clearTitle", "Geen open acties in deze selectie")}</h3><p>${tA("actions.clearText", "Je bent bijgewerkt. Nieuwe uitzonderingen verschijnen hier automatisch.")}</p></div>`}
        </section>
        <section class="adm-action-list-card">
          <div class="adm-action-list-head"><div><h3>${tA("actions.queueTitle", "Werkvoorraad")}</h3><p id="admActionQueueMeta">${visible.length} ${visible.length === 1 ? tA("actions.item", "actie") : tA("actions.items", "acties")}</p></div><div class="adm-action-filters">${filters.map(([key, label]) => `<button type="button" class="${_actionFilter === key ? "active" : ""}" data-action-filter="${key}">${esc(label)} <span>${counts[key]}</span></button>`).join("")}</div></div>
          <div class="adm-action-list">${visible.length ? visible.map(itemMarkup).join("") : `<div class="adm-action-empty"><span>✓</span><h4>${tA("actions.emptyTitle", "Alles afgewerkt")}</h4><p>${tA("actions.emptyText", "Er zijn geen acties voor deze filter.")}</p></div>`}</div>
        </section>
      </div>`;

      content.querySelectorAll("[data-action-filter]").forEach(btn => btn.addEventListener("click", () => paint(btn.dataset.actionFilter)));
      content.querySelectorAll("[data-action-view]").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.actionView)));
      content.querySelectorAll("[data-action-read]").forEach(btn => btn.addEventListener("click", async () => {
        btn.disabled = true;
        try { await api("POST", `/notifications/${btn.dataset.actionRead}/read`, {}); await renderActionCenter(); }
        catch (error) { btn.disabled = false; window.showToast && window.showToast(error.message, "error"); }
      }));
      document.getElementById("admActionRefresh")?.addEventListener("click", renderActionCenter);
    };
    paint(_actionFilter);
  }

  // ── Operaties · centraal overzicht over de echte uitvoeringsdomeinen ──────
  async function renderOperationsOverview() {
    const content = document.getElementById("admContent");
    content.innerHTML = `<div class="adm-loading"><div class="adm-spinner"></div>${tA("adm.operations.loading", "Operaties verzamelen…")}</div>`;

    const fetchDomain = async (view, path) => {
      if (!viewEnabled(view)) return {};
      try { return await api("GET", path); }
      catch (error) { return { _error: error.message }; }
    };
    const [planningData, workorderData, projectData, worksiteData, vehicleData, stockData] = await Promise.all([
      fetchDomain("planning", "/planning"),
      fetchDomain("workorders", "/workorders"),
      fetchDomain("projects", "/projects"),
      fetchDomain("worksites", "/worksites"),
      fetchDomain("vehicles", "/vehicles"),
      fetchDomain("stock", "/stock")
    ]);

    const rows = (payload, keys) => {
      for (const key of keys) if (Array.isArray(payload && payload[key])) return payload[key];
      return Array.isArray(payload) ? payload : [];
    };
    const planning = rows(planningData, ["shifts", "planning", "rows"]);
    const workorders = rows(workorderData, ["workorders", "rows"]);
    const projects = rows(projectData, ["projects", "rows"]);
    const worksites = rows(worksiteData, ["worksites", "rows"]);
    const vehicles = rows(vehicleData, ["vehicles", "rows"]);
    const stock = rows(stockData, ["stock", "items", "rows"]);
    const today = new Date();
    const todayIso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const plannedToday = planning.filter(item => String(item.date || item.startDate || item.start || "").slice(0, 10) === todayIso);
    const activeWorkorders = workorders.filter(item => !["done", "completed", "afgerond", "afgewerkt", "geannuleerd", "cancelled"].includes(String(item.status || "").toLowerCase()));
    const activeProjects = projects.filter(item => !["done", "completed", "afgerond", "geannuleerd", "cancelled"].includes(String(item.status || "").toLowerCase()));
    const serviceVehicles = vehicles.filter(item => ["maintenance", "service", "onderhoud"].includes(String(item.status || "").toLowerCase()) || item.serviceDue);
    const lowStock = stock.filter(item => Number(item.available ?? item.quantity ?? item.stock ?? 0) <= Number(item.minimum ?? item.minStock ?? 0));
    const domainErrors = [planningData, workorderData, projectData, worksiteData, vehicleData, stockData].filter(item => item && item._error).length;

    const moduleCard = ({ view, icon, title, value, meta, attention }) => {
      if (!viewEnabled(view)) return "";
      return `<button type="button" class="adm-operation-module ${attention ? "needs-attention" : ""}" data-operation-view="${view}">
        <span class="adm-operation-icon" aria-hidden="true">${icon}</span>
        <span class="adm-operation-copy"><small>${esc(title)}</small><strong>${esc(String(value))}</strong><span>${esc(meta)}</span></span>
        <span class="adm-operation-open" aria-hidden="true">→</span>
      </button>`;
    };

    const upcoming = [...plannedToday]
      .sort((a, b) => String(a.startTime || a.start || "").localeCompare(String(b.startTime || b.start || "")))
      .slice(0, 5);
    const workToFollow = activeWorkorders.slice(0, 5);

    content.innerHTML = `<div class="adm-operations-overview">
      <section class="adm-operations-hero">
        <div>
          <span class="adm-eyebrow">${tA("adm.operations.eyebrow", "Dagelijkse uitvoering")}</span>
          <h2>${tA("adm.operations.title", "Operaties in één werkruimte")}</h2>
          <p>${tA("adm.operations.subtitle", "Plan mensen en middelen, volg de uitvoering en ga rechtstreeks naar de juiste operationele module.")}</p>
        </div>
        <div class="adm-operations-hero-actions">
          <button type="button" class="adm-btn adm-btn-secondary" data-operation-view="planning">${tA("adm.operations.openPlanning", "Open planning")}</button>
          <button type="button" class="adm-btn adm-btn-primary" id="admOperationNewWorkorder">${tA("adm.operations.newWorkorder", "Nieuwe werkbon")}</button>
        </div>
      </section>

      ${domainErrors ? `<div class="adm-operations-notice" role="status"><span>!</span><p>${tA("adm.operations.partial", "Niet alle operationele gegevens konden worden geladen. De beschikbare modules blijven bruikbaar.")}</p></div>` : ""}

      <section class="adm-operation-modules" aria-label="${tA("nav.sec.operations", "Operaties")}">
        ${moduleCard({ view:"planning", icon:"◫", title:tA("nav.planning", "Planning"), value:plannedToday.length, meta:tA("adm.operations.plannedToday", "vandaag ingepland") })}
        ${moduleCard({ view:"workorders", icon:"✓", title:(window.wfpTerms && window.wfpTerms.t("jobPlural")) || tA("nav.workorders", "Werkbonnen"), value:activeWorkorders.length, meta:tA("adm.operations.openWorkorders", "open voor uitvoering"), attention:activeWorkorders.some(item => item.scheduledDate && item.scheduledDate < todayIso) })}
        ${moduleCard({ view:"projects", icon:"P", title:tA("nav.projects", "Projecten"), value:activeProjects.length, meta:tA("adm.operations.activeProjects", "actieve projecten") })}
        ${moduleCard({ view:"worksites", icon:"⌖", title:tA("nav.worksites", "Werven"), value:worksites.length, meta:tA("adm.operations.worksites", "beschikbare werven") })}
        ${moduleCard({ view:"vehicles", icon:"V", title:tA("nav.vehicles", "Wagenpark"), value:vehicles.length, meta:serviceVehicles.length ? tA("adm.operations.vehicleAttention", "{n} vraagt aandacht").replace("{n}", serviceVehicles.length) : tA("adm.operations.vehiclesReady", "beschikbaar voor planning"), attention:serviceVehicles.length })}
        ${moduleCard({ view:"stock", icon:"S", title:tA("nav.stock", "Voorraad"), value:stock.length, meta:lowStock.length ? tA("adm.operations.stockAttention", "{n} onder minimum").replace("{n}", lowStock.length) : tA("adm.operations.stockReady", "artikelen op niveau"), attention:lowStock.length })}
      </section>

      <section class="adm-operations-detail-grid">
        <article class="adm-card adm-operation-list-card">
          <div class="adm-card-header">
            <div><span class="adm-eyebrow">${tA("adm.operations.today", "Vandaag")}</span><h3 class="adm-card-title">${tA("adm.operations.nextPlanning", "Volgende planning")}</h3></div>
            <button type="button" class="adm-btn adm-btn-ghost adm-btn-sm" data-operation-view="planning">${tA("adm.operations.viewAll", "Alles bekijken")}</button>
          </div>
          <div class="adm-operation-list">
            ${upcoming.length ? upcoming.map(item => `<button type="button" data-operation-view="planning">
              <time>${esc(item.startTime || String(item.start || "").slice(11, 16) || "Vandaag")}</time>
              <span><strong>${esc(item.title || item.description || tA("adm.operations.planningItem", "Geplande opdracht"))}</strong><small>${esc(item.userName || empNameById(item.userId) || item.customerName || item.venueName || "")}</small></span>
              <span aria-hidden="true">→</span>
            </button>`).join("") : `<div class="adm-operation-empty"><span>◫</span><h4>${tA("adm.operations.noPlanning", "Nog niets ingepland vandaag")}</h4><p>${tA("adm.operations.noPlanningText", "Open de planning om medewerkers of opdrachten in te plannen.")}</p><button type="button" class="adm-btn adm-btn-secondary" data-operation-view="planning">${tA("adm.operations.planNow", "Nu inplannen")}</button></div>`}
          </div>
        </article>

        <article class="adm-card adm-operation-list-card">
          <div class="adm-card-header">
            <div><span class="adm-eyebrow">${tA("adm.operations.execution", "Uitvoering")}</span><h3 class="adm-card-title">${tA("adm.operations.workFollowup", "Werkbonnen om op te volgen")}</h3></div>
            <button type="button" class="adm-btn adm-btn-ghost adm-btn-sm" data-operation-view="workorders">${tA("adm.operations.viewAll", "Alles bekijken")}</button>
          </div>
          <div class="adm-operation-list">
            ${workToFollow.length ? workToFollow.map(item => `<button type="button" data-operation-view="workorders">
              <span class="adm-operation-status ${String(item.status || "").toLowerCase().includes("progress") ? "active" : ""}"></span>
              <span><strong>${esc(item.number || item.title || tA("adm.operations.workorder", "Werkbon"))}</strong><small>${esc(item.customerName || item.clientName || item.venueName || item.description || "")}</small></span>
              <span aria-hidden="true">→</span>
            </button>`).join("") : `<div class="adm-operation-empty"><span>✓</span><h4>${tA("adm.operations.noWorkorders", "Geen open werkbonnen")}</h4><p>${tA("adm.operations.noWorkordersText", "Nieuwe of lopende werkbonnen verschijnen hier automatisch.")}</p><button type="button" class="adm-btn adm-btn-secondary" id="admOperationEmptyWorkorder">${tA("adm.operations.newWorkorder", "Nieuwe werkbon")}</button></div>`}
          </div>
        </article>
      </section>
    </div>`;

    content.querySelectorAll("[data-operation-view]").forEach(button => {
      button.addEventListener("click", () => switchView(button.dataset.operationView));
    });
    const openWorkorder = () => window.wfpAdmin.drawers.workorder(null);
    document.getElementById("admOperationNewWorkorder")?.addEventListener("click", openWorkorder);
    document.getElementById("admOperationEmptyWorkorder")?.addEventListener("click", openWorkorder);
  }

  // ── Dashboard · orkestrator met filter (standaard / mijn / organisatie) ────
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
    const language = (window.wfpI18n && window.wfpI18n.lang) || "nl";
    const copy = ({
      nl:{ locale:"nl-BE", greetings:["Goedemorgen","Goedemiddag","Goedenavond"], eyebrow:"Vandaag", title:"Operationeel overzicht", state:"Live werkruimte", stateSub:"Planning, uitvoering en omzet verbonden", quick:"Snel aanmaken", quickSub:"Open een nieuwe workflow", planning:"Nieuwe planning", workorder:"Nieuwe werkbon", customer:"Nieuwe klant", planningSub:"Plan een medewerker in", workorderSub:"Maak en plan meteen", customerSub:"Start het klanttraject" },
      fr:{ locale:"fr-BE", greetings:["Bonjour","Bon après-midi","Bonsoir"], eyebrow:"Aujourd’hui", title:"Vue opérationnelle", state:"Espace en direct", stateSub:"Planning, exécution et chiffre d’affaires reliés", quick:"Créer rapidement", quickSub:"Démarrez un nouveau flux", planning:"Nouveau planning", workorder:"Nouveau bon de travail", customer:"Nouveau client", planningSub:"Planifiez un collaborateur", workorderSub:"Créez et planifiez", customerSub:"Démarrez le parcours client" },
      en:{ locale:"en-BE", greetings:["Good morning","Good afternoon","Good evening"], eyebrow:"Today", title:"Operational overview", state:"Live workspace", stateSub:"Planning, delivery and revenue connected", quick:"Quick create", quickSub:"Start a new workflow", planning:"New planning", workorder:"New work order", customer:"New customer", planningSub:"Schedule a team member", workorderSub:"Create and schedule", customerSub:"Start the customer flow" }
    })[language] || null;
    const c = copy || ({ locale:"nl-BE", greetings:["Goedemorgen","Goedemiddag","Goedenavond"], eyebrow:"Vandaag", title:"Operationeel overzicht", state:"Live werkruimte", stateSub:"Planning, uitvoering en omzet verbonden", quick:"Snel aanmaken", quickSub:"Open een nieuwe workflow", planning:"Nieuwe planning", workorder:"Nieuwe werkbon", customer:"Nieuwe klant", planningSub:"Plan een medewerker in", workorderSub:"Maak en plan meteen", customerSub:"Start het klanttraject" });
    const hour = new Date().getHours();
    const greeting = hour < 12 ? c.greetings[0] : hour < 18 ? c.greetings[1] : c.greetings[2];
    const person = (document.getElementById("admTopbarName")?.textContent || "").trim().split(" ")[0];
    const dateLabel = new Intl.DateTimeFormat(c.locale, { weekday:"long", day:"numeric", month:"long" }).format(new Date());
    content.innerHTML = `
      <section class="adm-workspace-head" aria-label="Dagstart">
        <div>
          <span class="adm-eyebrow">${esc(c.eyebrow)} · ${esc(dateLabel)}</span>
          <h2>${esc(c.title)}</h2>
          <p>${greeting}${person && person !== "Admin" ? `, ${esc(person)}` : ""}.</p>
        </div>
        <div class="adm-workspace-state"><span><i></i> ${esc(c.state)}</span><small>${esc(c.stateSub)}</small></div>
      </section>
      <section class="adm-guided-entry" aria-label="Klantflow">
        <span class="adm-guided-icon">M</span>
        <div>
          <span class="adm-eyebrow">Monargo Flow</span>
          <h3>Start een volledig klanttraject</h3>
          <p>Maak een klant aan en ga logisch verder naar offerte, planning, werkbon en factuur.</p>
          <div class="adm-guided-steps"><span>Klant</span><span>Offerte</span><span>Planning</span><span>Werkbon</span><span>Factuur</span></div>
        </div>
        <button type="button" class="adm-btn adm-btn-primary adm-guided-start" id="admStartFlow">Start klantflow <span aria-hidden="true">→</span></button>
      </section>
      <section class="adm-command-strip" aria-label="Snelle acties">
        <div class="adm-command-intro"><span class="adm-command-spark">+</span><span><strong>${esc(c.quick)}</strong><small>${esc(c.quickSub)}</small></span></div>
        <div class="adm-quick-actions">
          <button type="button" class="adm-quick-action" data-quick-view="planning" data-quick-click="admAddShift"><span class="adm-quick-icon">+</span><span><strong>${esc(c.planning)}</strong><small>${esc(c.planningSub)}</small></span><b aria-hidden="true">→</b></button>
          <button type="button" class="adm-quick-action" data-quick-view="workorders" data-quick-click="admNewWO"><span class="adm-quick-icon">+</span><span><strong>${esc(c.workorder)}</strong><small>${esc(c.workorderSub)}</small></span><b aria-hidden="true">→</b></button>
          <button type="button" class="adm-quick-action" data-quick-view="customers" data-quick-drawer="customer"><span class="adm-quick-icon">+</span><span><strong>${esc(c.customer)}</strong><small>${esc(c.customerSub)}</small></span><b aria-hidden="true">→</b></button>
        </div>
      </section>
      <div class="adm-dashboard-toolbar">
        <div class="adm-segmented" role="tablist" aria-label="Dashboardweergave">
        ${chip("standaard", tA("dash.mode.overview","Overzicht"))}
        ${chip("personal", tA("dash.mode.personal","Mijn dashboard"))}
        ${hasOrg ? chip("org", tA("dash.mode.org","Organisatie")) : ""}
        </div>
        ${_dashMode === "personal" ? `<button class="adm-btn adm-btn-secondary adm-btn-sm" id="dashConfigToggle" style="margin-left:auto">${tA("dash.mode.customize","Aanpassen")}</button>` : ""}
      </div>
      <div id="dashBody"></div>`;
    content.querySelectorAll("[data-quick-view]").forEach(btn => btn.addEventListener("click", () => {
      navFlyoutGo(btn.dataset.quickView, {
        go:{ view:btn.dataset.quickView, click:btn.dataset.quickClick || undefined },
        drawer:btn.dataset.quickDrawer || undefined
      });
    }));
    document.getElementById("admStartFlow")?.addEventListener("click", () => openCustomerDrawer(null));
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
      : `<div class="adm-empty"><div class="adm-empty-text">${mode === "org" ? "Je organisatie heeft nog geen dashboard gepubliceerd." : "Nog geen widgets gekozen · klik Aanpassen."}</div></div>`;
    const r = await api("GET", `/me/dashboard/render?mode=${mode}`).catch(() => ({ widgets: [] }));
    if (mode === "org") {
      body.innerHTML = `<div style="background:var(--wf-blue-l);border:1px solid var(--wf-blue-l);border-radius:10px;padding:10px 14px;font-size:12.5px;color:var(--wf-blue);margin-bottom:14px">Dit dashboard is door je organisatie ingesteld; je ziet enkel widgets waar je rechten op hebt.</div>${grid(r.widgets || [])}`;
      return;
    }
    const chosen = new Set(personalKeys);
    body.innerHTML = `
      ${grid(r.widgets || [])}
      <div class="adm-card" id="dashConfigPanel" style="margin-top:18px;display:none">
        <div class="adm-card-header"><h3 class="adm-card-title">Widgets samenstellen</h3></div>
        <div class="adm-card-body">
          <p style="font-size:12.5px;color:var(--gray-500);margin:0 0 12px">Kies de blokken die je wil zien. Je ziet enkel widgets waar je rechten op hebt.</p>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px">
            ${available.map(w => `<label style="display:flex;align-items:center;gap:8px;font-size:13px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;cursor:pointer">
              <input type="checkbox" class="mb-w" value="${esc(w.key)}" ${chosen.has(w.key) ? "checked" : ""}>
              <span>${esc(w.label)}</span><span style="margin-left:auto;font-size:10px;color:var(--gray-400)">${esc(w.group)}</span>
            </label>`).join("") || `<div style="font-size:13px;color:var(--gray-400)">Geen widgets beschikbaar voor jouw rechten/pakket.</div>`}
          </div>
          <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
            <button class="adm-btn adm-btn-primary adm-btn-sm" id="mbSave">Opslaan</button>
            ${canPublish ? `<button class="adm-btn adm-btn-secondary adm-btn-sm" id="mbPublish">Publiceer voor organisatie</button>` : ""}
            <span id="mbMsg" style="font-size:12.5px;color:var(--wf-green);align-self:center"></span>
          </div>
        </div>
      </div>`;
    const picked = () => [...document.querySelectorAll(".mb-w:checked")].map(c => c.value);
    document.getElementById("mbSave")?.addEventListener("click", async () => {
      const msg = document.getElementById("mbMsg");
      try { await api("POST", "/me/dashboard/config", { widgets: picked() }); renderDashboard(); window.showToast && window.showToast("Mijn dashboard opgeslagen", "success"); }
      catch (e) { msg.style.color = "var(--wf-red)"; msg.textContent = e.message; }
    });
    document.getElementById("mbPublish")?.addEventListener("click", async () => {
      if (!await uiConfirm("Deze widgetselectie publiceren als vast organisatie-dashboard voor iedereen?", { title: "Organisatiedashboard publiceren", confirmLabel: "Publiceren" })) return;
      const msg = document.getElementById("mbMsg");
      try { await api("POST", "/me/dashboard/publish", { widgets: picked() }); renderDashboard(); window.showToast && window.showToast("Gepubliceerd voor de organisatie", "success"); }
      catch (e) { msg.style.color = "var(--wf-red)"; msg.textContent = e.message; }
    });
  }

  // ── Standaard-overzicht (cockpit: KPI's met sparklines + widgets) ──
  function admSpark(points, color) {
    let pts = (points || []).map(Number);
    if (pts.length < 2) pts = [0, 0];
    const max = Math.max(...pts), min = Math.min(...pts);
    const range = (max - min) || 1;
    const W = 100, H = 28, P = 2;
    const step = (W - P * 2) / (pts.length - 1);
    const xy = pts.map((v, i) => `${(P + i * step).toFixed(1)},${(H - P - ((v - min) / range) * (H - P * 2)).toFixed(1)}`);
    const gid = `sg${Math.random().toString(16).slice(2, 8)}`;
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".20"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><polygon points="${P},${H - P} ${xy.join(" ")} ${W - P},${H - P}" fill="url(#${gid})"/><polyline points="${xy.join(" ")}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function admDonut(segs) {
    const total = segs.reduce((s, x) => s + x.count, 0);
    if (!total) return `<svg viewBox="0 0 42 42" aria-hidden="true"><circle r="15.915" cx="21" cy="21" fill="none" stroke="var(--gray-100)" stroke-width="4.5"/></svg>`;
    let offset = 25, out = "";
    segs.filter(s => s.count > 0).forEach(s => {
      const val = (s.count / total) * 100;
      out += `<circle r="15.915" cx="21" cy="21" fill="none" stroke="${s.color}" stroke-width="4.5" stroke-dasharray="${val.toFixed(3)} ${(100 - val).toFixed(3)}" stroke-dashoffset="${offset.toFixed(3)}"/>`;
      offset -= val;
    });
    return `<svg viewBox="0 0 42 42" aria-hidden="true">${out}</svg>`;
  }

  function admTimeAgo(ts) {
    if (!ts) return "";
    const diff = Date.now() - new Date(ts).getTime();
    if (!isFinite(diff) || diff < 0) return "";
    const min = Math.floor(diff / 60000);
    if (min < 1) return "zojuist";
    if (min < 60) return `${min} min geleden`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} u geleden`;
    const d = Math.floor(h / 24);
    if (d === 1) return "gisteren";
    if (d < 7) return `${d} dagen geleden`;
    return String(ts).slice(0, 10);
  }

  // Opent de Mona-widget, optioneel met een voorgestelde vraag.
  function admAskBoden(question) {
    const fab = document.getElementById("bodenFab");
    if (!fab) return;
    const panel = document.getElementById("bodenPanel");
    if (!panel || !panel.classList.contains("open")) fab.click();
    if (question) {
      const input = document.getElementById("bodenInput");
      if (input) { input.value = question; document.getElementById("bodenSend")?.click(); }
    }
  }

  async function renderStandardDashboard() {
    const todayIso = new Date().toISOString().slice(0, 10);
    const dow = (new Date().getDay() + 6) % 7; // maandag = 0
    const lastDays = n => Array.from({ length: n }, (_, i) => new Date(Date.now() - (n - 1 - i) * 864e5).toISOString().slice(0, 10));
    const weekStartIso = lastDays(dow + 1)[0];
    const dashLanguage = (window.wfpI18n && window.wfpI18n.lang) || "nl";
    const boardCopy = ({
      nl:{ locale:"nl-BE", eyebrow:"Live werkbord", title:"Operationele flow", today:"Vandaag", week:"Deze week", newWork:"Nieuwe opdracht", active:"Actief", item:"item", items:"items", task:"Opdracht", customer:"Klant", status:"Status", owner:"Verantwoordelijke", planning:"Planning", noActive:"Geen actieve items in deze periode.", notPlanned:"Niet gepland", noCustomer:"Geen klant", finance:"Financieel", invoice:"Factuur", scheduled:"Gepland", inProgress:"In uitvoering", toInvoice:"Te factureren", overdue:"Vervallen", paid:"Betaald", open:"Open", collapse:"Werkbord inklappen", expand:"Werkbord uitklappen", openWorkOrders:"Open werkbonnen" },
      fr:{ locale:"fr-BE", eyebrow:"Tableau en direct", title:"Flux opérationnel", today:"Aujourd’hui", week:"Cette semaine", newWork:"Nouvelle mission", active:"Actif", item:"élément", items:"éléments", task:"Mission", customer:"Client", status:"Statut", owner:"Responsable", planning:"Planning", noActive:"Aucun élément actif pour cette période.", notPlanned:"Non planifié", noCustomer:"Aucun client", finance:"Finance", invoice:"Facture", scheduled:"Planifié", inProgress:"En cours", toInvoice:"À facturer", overdue:"En retard", paid:"Payé", open:"Ouvert", collapse:"Réduire le tableau", expand:"Développer le tableau", openWorkOrders:"Bons de travail ouverts" },
      en:{ locale:"en-BE", eyebrow:"Live workboard", title:"Operational flow", today:"Today", week:"This week", newWork:"New work item", active:"Active", item:"item", items:"items", task:"Work item", customer:"Customer", status:"Status", owner:"Owner", planning:"Schedule", noActive:"No active items in this period.", notPlanned:"Not scheduled", noCustomer:"No customer", finance:"Finance", invoice:"Invoice", scheduled:"Scheduled", inProgress:"In progress", toInvoice:"Ready to invoice", overdue:"Overdue", paid:"Paid", open:"Open", collapse:"Collapse workboard", expand:"Expand workboard", openWorkOrders:"Open work orders" }
    })[dashLanguage] || null;
    const bc = boardCopy || { locale:"nl-BE", eyebrow:"Live werkbord", title:"Operationele flow", today:"Vandaag", week:"Deze week", newWork:"Nieuwe opdracht", active:"Actief", item:"item", items:"items", task:"Opdracht", customer:"Klant", status:"Status", owner:"Verantwoordelijke", planning:"Planning", noActive:"Geen actieve items in deze periode.", notPlanned:"Niet gepland", noCustomer:"Geen klant", finance:"Financieel", invoice:"Factuur", scheduled:"Gepland", inProgress:"In uitvoering", toInvoice:"Te factureren", overdue:"Vervallen", paid:"Betaald", open:"Open", collapse:"Werkbord inklappen", expand:"Werkbord uitklappen", openWorkOrders:"Open werkbonnen" };

    const [dash, pending, factData, expData, gpData, woData, planData, clockData] = await Promise.all([
      api("GET", "/manager/dashboard"),
      api("GET", "/leaves?status=aangevraagd").catch(() => ({ leaves: [] })),
      api("GET", "/facturen").catch(() => ({ invoices: [] })),
      api("GET", "/expenses").catch(() => ({ expenses: [] })),
      api("GET", "/golden-path").catch(() => null),
      viewEnabled("workorders") ? api("GET", "/workorders").catch(() => ({ workorders: [] })) : { workorders: [] },
      viewEnabled("planning") ? api("GET", `/manager/planning?from=${todayIso}&to=${todayIso}`).catch(() => ({ shifts: [] })) : { shifts: [] },
      viewEnabled("clocking") ? api("GET", `/clocks?from=${weekStartIso}&to=${todayIso}`).catch(() => ({ clocks: [] })) : { clocks: [] }
    ]);

    const eur0 = new Intl.NumberFormat(bc.locale, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
    const invoices = factData.invoices || [];
    const workorders = woData.workorders || [];
    const todayShifts = (planData.shifts || []).slice().sort((a, b) => (a.start || "").localeCompare(b.start || ""));
    const weekClocks = clockData.clocks || [];
    const d14 = lastDays(14);

    // KPI · omzet deze maand (gefactureerd, excl. concepten)
    const ym = todayIso.slice(0, 7);
    const prevM = new Date(); prevM.setDate(1); prevM.setMonth(prevM.getMonth() - 1);
    const prevYm = prevM.toISOString().slice(0, 7);
    const billed = invoices.filter(i => i.status && i.status !== "draft");
    const mtdInv = billed.filter(i => (i.invoiceDate || "").startsWith(ym));
    const mtdTotal = mtdInv.reduce((s, i) => s + Number(i.total || 0), 0);
    const prevTotal = billed.filter(i => (i.invoiceDate || "").startsWith(prevYm)).reduce((s, i) => s + Number(i.total || 0), 0);
    const trendPct = prevTotal > 0 ? Math.round(((mtdTotal - prevTotal) / prevTotal) * 100) : null;
    let cum = 0;
    const omzetSerie = Array.from({ length: Number(todayIso.slice(8, 10)) }, (_, d) =>
      (cum += mtdInv.filter(i => Number((i.invoiceDate || "").slice(8, 10)) === d + 1).reduce((s, i) => s + Number(i.total || 0), 0)));

    // KPI · openstaande facturen
    const openInv = invoices.filter(i => i.status === "open" || i.status === "overdue");
    const overdueCount = invoices.filter(i => i.status === "overdue").length;
    const openTotal = openInv.reduce((s, i) => s + Number(i.total || 0), 0);
    const openSerie = d14.map(d => openInv.filter(i => (i.invoiceDate || "") === d).reduce((s, i) => s + Number(i.total || 0), 0));

    // KPI · open werkbonnen (+ te laat)
    const activeWos = workorders.filter(w => w.status === "open" || w.status === "in_progress");
    const lateWos = activeWos.filter(w => w.scheduledDate && w.scheduledDate < todayIso);
    const woSerie = d14.map(d => workorders.filter(w => (w.createdAt || "").slice(0, 10) === d).length);

    // KPI · uren deze week
    const weekMin = weekClocks.reduce((s, c) => s + Number(c.durationMinutes || 0), 0);
    const weekUren = (Math.round(weekMin / 6) / 10).toLocaleString(bc.locale);
    const urenSerie = lastDays(dow + 1).map(d => weekClocks.filter(c => c.date === d).reduce((s, c) => s + Number(c.durationMinutes || 0), 0));
    const clockedUsers = new Set(weekClocks.map(c => c.userId)).size;

    const kpiCards = [];
    if (viewEnabled("facturen")) {
      kpiCards.push(`
  <div class="adm-kpi adm-kpi-link" data-goto="facturen" title="Naar facturen">
    <div class="adm-kpi-label">${tA("dash.revenueMonth","Omzet deze maand")}</div>
    <div class="adm-kpi-value">${eur0.format(mtdTotal)}</div>
    <div class="adm-kpi-sub">${trendPct === null ? tA("dash.noRevenuePrev","Geen omzet vorige maand") : `<span class="adm-trend ${trendPct >= 0 ? "up" : "down"}">${trendPct >= 0 ? "▲" : "▼"} ${Math.abs(trendPct)}%</span> ${tA("dash.vsPrevMonth","t.o.v. vorige maand")}`}</div>
    <div class="adm-kpi-spark">${admSpark(omzetSerie, "var(--wf-blue)")}</div>
  </div>`);
      kpiCards.push(`
  <div class="adm-kpi adm-kpi-link" data-goto="facturen" title="Naar facturen">
    <div class="adm-kpi-label">${tA("dash.openInvoices","Openstaande facturen")}</div>
    <div class="adm-kpi-value">${eur0.format(openTotal)}</div>
    <div class="adm-kpi-sub">${openInv.length} ${tA("dash.invoices","facturen")}${overdueCount ? ` · <span class="adm-trend down">${overdueCount} ${tA("dash.overdue","vervallen")}</span>` : ""}</div>
    <div class="adm-kpi-spark">${admSpark(openSerie, "var(--wf-yellow)")}</div>
  </div>`);
    }
    if (viewEnabled("workorders")) kpiCards.push(`
  <div class="adm-kpi adm-kpi-link" data-goto="workorders" title="Naar werkbonnen">
    <div class="adm-kpi-label">${dashLanguage === "nl" && window.wfpTerms && window.wfpTerms.t("jobPlural") ? window.wfpTerms.t("jobPlural") : tA("dash.openWo", bc.openWorkOrders)}</div>
    <div class="adm-kpi-value">${activeWos.length}</div>
    <div class="adm-kpi-sub">${lateWos.length ? `<span class="adm-trend down">${lateWos.length} ${tA("dash.late","te laat")}</span>` : tA("dash.onSchedule","Alles op schema")}</div>
    <div class="adm-kpi-spark">${admSpark(woSerie, "var(--wf-blue)")}</div>
  </div>`);
    if (viewEnabled("clocking")) kpiCards.push(`
  <div class="adm-kpi adm-kpi-link" data-goto="clocking" title="Naar prikklok">
    <div class="adm-kpi-label">${tA("dash.hoursWeek","Uren deze week")}</div>
    <div class="adm-kpi-value">${weekUren} ${tA("emp.unit.h","u")}</div>
    <div class="adm-kpi-sub">${clockedUsers === 1 ? tA("dash.oneClocked","1 medewerker klokte") : tA("dash.nClocked","{n} medewerkers klokten").replace("{n}", clockedUsers)} · ${dash.clockedIn ?? 0} ${tA("dash.clockedNow","nu ingeklokt")}</div>
    <div class="adm-kpi-spark">${admSpark(urenSerie, "var(--wf-green)")}</div>
  </div>`);
    if (kpiCards.length < 4) kpiCards.unshift(`
  <div class="adm-kpi adm-kpi-link" data-goto="employees" title="Naar medewerkers">
    <div class="adm-kpi-label">${tA("dash.team","Team")}</div>
    <div class="adm-kpi-value">${dash.team ?? "-"}</div>
    <div class="adm-kpi-sub">${dash.clockedIn ?? 0} ${tA("dash.clockedNow","nu ingeklokt")}</div>
  </div>`);

    // Werkbonnen per status (donut)
    const stat = k => workorders.filter(w => w.status === k).length;
    const woSegs = [
      { label: tA("dash.woseg.open","Open"), count: stat("open"), color: "var(--wf-blue)" },
      { label: tA("dash.woseg.inprog","In uitvoering"), count: stat("in_progress"), color: "var(--wf-yellow)" },
      { label: tA("dash.woseg.done","Afgerond"), count: stat("Voltooid") + stat("Afgewerkt"), color: "var(--wf-green)" },
      { label: tA("dash.woseg.cancelled","Geannuleerd"), count: stat("geannuleerd"), color: "var(--wf-red)" }
    ];
    const woOther = workorders.length - woSegs.reduce((s, x) => s + x.count, 0);
    if (woOther > 0) woSegs.push({ label: tA("dash.woseg.other","Overig"), count: woOther, color: "var(--gray-400)" });

    // Planning vandaag
    const nameById = {};
    (dash.teamList || []).forEach(u => { nameById[u.id] = u.name || u.email || tA("dash.employee","Medewerker"); });
    const planRows = todayShifts.slice(0, 8).map(s => `
      <div class="adm-tl-row">
        <span class="adm-tl-time">${esc(s.start || "")} – ${esc(s.end || "")}</span>
        <span style="font-weight:500;color:var(--ink);white-space:nowrap">${esc(nameById[s.userId] || tA("dash.employee","Medewerker"))}</span>
        ${s.note ? `<span style="color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.note)}</span>` : ""}
      </div>`).join("");

    // Recente activiteit (samengesteld uit facturen, werkbonnen, verlof, onkosten)
    const invLabel = { paid: tA("dash.invst.paid","betaald"), open: tA("dash.invst.open","openstaand"), overdue: tA("dash.invst.overdue","vervallen"), draft: tA("dash.invst.draft","concept") };
    const woLabel = { open: tA("dash.woseg.open","open").toLowerCase(), in_progress: tA("dash.woseg.inprog","in uitvoering").toLowerCase(), Voltooid: tA("dash.woseg.done","voltooid").toLowerCase(), Afgewerkt: tA("dash.woseg.done","afgewerkt").toLowerCase(), geannuleerd: tA("dash.woseg.cancelled","geannuleerd").toLowerCase() };
    const empLc = tA("dash.employee","medewerker").toLowerCase();
    const acts = [
      ...invoices.map(i => ({ t: i.createdAt || "", color: i.status === "paid" ? "var(--wf-green)" : i.status === "overdue" ? "var(--wf-red)" : "var(--wf-blue)", text: `${tA("dash.act.invoice","Factuur")} ${i.number || ""} · ${invLabel[i.status] || i.status || ""} · ${eur0.format(Number(i.total || 0))}`, view: "facturen" })),
      ...workorders.map(w => ({ t: w.createdAt || "", color: "var(--wf-yellow)", text: `${tA("dash.act.workorder","Werkbon")} ${w.number || w.title || ""} · ${woLabel[w.status] || w.status || ""}`, view: "workorders" })),
      ...((pending.leaves || pending) || []).map(l => ({ t: l.createdAt || "", color: "var(--wf-blue)", text: `${tA("dash.act.leaveFrom","Verlofaanvraag van")} ${uName(l) || empLc}`, view: "leaves" })),
      ...(expData.expenses || []).filter(e => e.status === "pending" || !e.status).map(e => ({ t: e.createdAt || "", color: "var(--wf-red)", text: tA("dash.act.expenseFrom","Onkostennota {a} van {n}").replace("{a}", eur0.format(Number(e.amount || 0))).replace("{n}", uName(e) || empLc), view: "expenses" }))
    ].filter(a => a.t).sort((a, b) => b.t.localeCompare(a.t)).slice(0, 7);

    const planCard = viewEnabled("planning") ? `
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">${tA("dash.planToday","Planning vandaag")}</h3><a href="#" class="adm-btn adm-btn-secondary adm-btn-sm" id="admDashPlanning">${tA("dash.toPlanning","Naar planning")}</a></div>
    <div class="adm-card-body">
      ${planRows || `<div class="adm-empty" style="padding:28px 16px"><div class="adm-empty-text">${tA("dash.nothingPlanned","Nog niets ingepland voor vandaag.")}</div></div>`}
    </div>
  </div>` : "";
    const donutCard = viewEnabled("workorders") ? `
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">${tA("dash.woByStatus","Werkbonnen per status")}</h3></div>
    <div class="adm-card-body" style="display:flex;align-items:center;gap:22px;flex-wrap:wrap">
      <div class="adm-donut-wrap">${admDonut(woSegs)}<div class="adm-donut-center"><div><div class="adm-donut-num">${workorders.length}</div><div class="adm-donut-cap">${tA("dash.total","totaal")}</div></div></div></div>
      <div class="adm-legend">
        ${woSegs.filter(s => s.count > 0).map(s => `<div class="adm-legend-row"><span class="adm-legend-dot" style="background:${s.color}"></span>${esc(s.label)}<span class="adm-legend-n">${s.count}</span></div>`).join("") || `<div style="font-size:12.5px;color:var(--muted)">${tA("dash.noWo","Nog geen werkbonnen.")}</div>`}
      </div>
    </div>
  </div>` : "";
    const actCard = `
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">${tA("dash.recentActivity","Recente activiteit")}</h3></div>
    <div class="adm-card-body">
      ${acts.map(a => `<div class="adm-act-row adm-act-link" data-view="${a.view}"><span class="adm-legend-dot" style="background:${a.color}"></span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.text)}</span><span class="adm-act-time">${esc(admTimeAgo(a.t))}</span></div>`).join("") || `<div class="adm-empty" style="padding:28px 16px"><div class="adm-empty-text">${tA("dash.noActivity","Nog geen activiteit.")}</div></div>`}
    </div>
  </div>`;
    const cockpitRows = `
${planCard || donutCard ? `<div class="adm-grid-2" style="margin-bottom:18px">${planCard}${donutCard}</div>` : ""}
<div style="margin-bottom:18px">${actCard}</div>`;

    // Live werkbord op basis van echte operationele data. De tijdsfilter werkt
    // lokaal zodat een beheerder zonder extra wachttijd tussen vandaag en week
    // kan schakelen.
    const boardStatus = status => ({
      open: bc.scheduled, in_progress: bc.inProgress, Voltooid: bc.toInvoice,
      Afgewerkt: bc.toInvoice, overdue: bc.overdue, paid: bc.paid
    }[status] || status || bc.open);
    const boardClass = status => String(status || "open").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const weekEndIso = new Date(Date.now() + (6 - dow) * 864e5).toISOString().slice(0, 10);
    const workBoardRows = workorders
      .filter(w => !["geannuleerd", "cancelled"].includes(w.status))
      .map(w => {
        const date = w.scheduledDate || String(w.createdAt || "").slice(0, 10);
        const owner = nameById[w.userId] || uName(w) || tA("dash.employee", "Medewerker");
        const title = w.title || w.description || w.number || tA("dash.act.workorder", "Werkbon");
        return { id:w.id, view:"workorders", date, title, code:w.number || String(w.id || "").slice(-8), customer:w.clientName || w.customerName || bc.noCustomer, status:boardStatus(w.status), rawStatus:w.status, owner };
      });
    const invoiceBoardRows = invoices
      .filter(i => ["open", "overdue"].includes(i.status))
      .map(i => ({ id:i.id, view:"facturen", date:i.dueDate || i.invoiceDate || "", title:`${bc.invoice} ${i.number || ""}`.trim(), code:eur0.format(Number(i.total || 0)), customer:i.customerName || bc.noCustomer, status:boardStatus(i.status), rawStatus:i.status, owner:bc.finance }));
    const boardRows = [...workBoardRows, ...invoiceBoardRows]
      .sort((a, b) => String(a.date || "9999").localeCompare(String(b.date || "9999")))
      .slice(0, 12);
    const boardMarkup = `
<section class="adm-operations-board" aria-label="${esc(bc.title)}">
  <div class="adm-board-head">
    <div><span class="adm-eyebrow">${esc(bc.eyebrow)}</span><h3>${esc(bc.title)}</h3></div>
    <div class="adm-board-tools">
      <button type="button" class="adm-board-filter active" data-board-period="today">${esc(bc.today)}</button>
      <button type="button" class="adm-board-filter" data-board-period="week">${esc(bc.week)}</button>
      <button type="button" class="adm-board-add" id="admBoardNew">+ ${esc(bc.newWork)}</button>
    </div>
  </div>
  <div class="adm-board-group"><div><i></i><b>${esc(bc.active)}</b><span id="admBoardCount">${boardRows.filter(r => r.date === todayIso).length} ${esc(boardRows.filter(r => r.date === todayIso).length === 1 ? bc.item : bc.items)}</span></div><button type="button" id="admBoardCollapse" aria-label="${esc(bc.collapse)}">⌃</button></div>
  <div id="admBoardBody">
    <div class="adm-board-table">
      <div class="adm-board-row adm-board-labels"><span>${esc(bc.task)}</span><span>${esc(bc.customer)}</span><span>${esc(bc.status)}</span><span>${esc(bc.owner)}</span><span>${esc(bc.planning)}</span><span></span></div>
      ${boardRows.map(r => {
        const inWeek = r.date >= weekStartIso && r.date <= weekEndIso;
        const initials = r.owner.split(/\s+/).filter(Boolean).slice(0,2).map(part => part[0]).join("").toUpperCase();
        const planning = r.date ? (r.date === todayIso ? bc.today : new Date(`${r.date}T12:00:00`).toLocaleDateString(bc.locale, { weekday:"short", day:"numeric", month:"short" })) : bc.notPlanned;
        return `<button type="button" class="adm-board-row adm-board-item" data-board-view="${r.view}" data-board-id="${esc(r.id || "")}" data-board-today="${r.date === todayIso ? "1" : "0"}" data-board-week="${inWeek ? "1" : "0"}">
          <span class="adm-board-task"><b>${esc(r.title)}</b><small>${esc(r.code || "")}</small></span>
          <span>${esc(r.customer)}</span>
          <span><em class="adm-board-status ${boardClass(r.rawStatus)}">${esc(r.status)}</em></span>
          <span class="adm-board-owner"><i>${esc(initials || "M")}</i><small>${esc(r.owner)}</small></span>
          <span>${esc(planning)}</span><span aria-hidden="true">→</span>
        </button>`;
      }).join("")}
      <div class="adm-board-empty" id="admBoardEmpty" style="display:none">${esc(bc.noActive)}</div>
    </div>
  </div>
</section>`;

    const content = document.getElementById("dashBody") || document.getElementById("admContent");
    content.innerHTML = `
<div class="adm-kpis adm-kpis-cockpit">
${kpiCards.join("")}
</div>

${boardMarkup}

${cockpitRows}

<div class="adm-grid-2">
  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">${tA("dash.teamToday","Team vandaag")}</h3>
    </div>
    <div class="adm-card-body adm-table-wrap">
      <table class="adm-table">
        <thead><tr><th>${tA("dash.thEmployee","Medewerker")}</th><th>${tA("dash.thStatus","Status")}</th><th>${tA("dash.thPlanned","Ingepland")}</th></tr></thead>
        <tbody>
          ${(dash.teamList || []).slice(0,8).map(u => `
          <tr class="adm-row-link adm-dash-team" data-id="${esc(u.id||"")}" title="Open medewerker">
            <td><span class="adm-avatar">${esc((u.name||"?")[0])}</span> ${esc(u.name||u.email)}</td>
            <td>${u.absent ? `<span class="adm-status adm-status-inactive">${tA("dash.stAbsent","Afwezig")}</span>` : u.clockedIn ? `<span class="adm-status adm-status-active">${tA("dash.stClockedIn","Ingeklokt")}</span>` : `<span class="adm-status adm-status-pending">${tA("dash.stNotClocked","Niet geklokt")}</span>`}</td>
            <td>${u.planned ? "✓" : "-"}</td>
          </tr>`).join("") || `<tr><td colspan="3" class="adm-empty">${tA("dash.noTeam","Geen teamleden")}</td></tr>`}
        </tbody>
      </table>
    </div>
  </div>

  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">${tA("dash.leaveRequests","Verlof aanvragen")} <span style="background:var(--wf-yellow-l);color:var(--wf-yellow);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;">${(pending.leaves||pending||[]).length}</span></h3>
      <a href="#" class="adm-btn adm-btn-secondary adm-btn-sm" id="admViewAllLeaves">${tA("dash.viewAll","Alles bekijken")}</a>
    </div>
    <div class="adm-card-body adm-table-wrap">
      <table class="adm-table">
        <thead><tr><th>${tA("dash.thEmployee","Medewerker")}</th><th>${tA("dash.thType","Type")}</th><th>${tA("dash.thPeriod","Periode")}</th><th>${tA("dash.thAction","Actie")}</th></tr></thead>
        <tbody>
          ${((pending.leaves||pending)||[]).slice(0,5).map(l => `
          <tr>
            <td>${esc(uName(l))}</td>
            <td>${esc(l.type||"-")}</td>
            <td style="white-space:nowrap">${esc(l.startDate)} – ${esc(l.endDate)}</td>
            <td style="white-space:nowrap">
              <button class="adm-btn adm-btn-success adm-btn-sm adm-dash-lv-ok" data-id="${esc(l.id)}">${tA("dash.approve","Goed")}</button>
              <button class="adm-btn adm-btn-danger adm-btn-sm adm-dash-lv-rej" data-id="${esc(l.id)}">${tA("dash.reject","Weigeren")}</button>
            </td>
          </tr>`).join("") || `<tr><td colspan="4" class="adm-empty">${tA("dash.noRequests","Geen aanvragen")}</td></tr>`}
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
  const eurA = n => new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(n);
  const empA = tA("dash.employee","medewerker").toLowerCase();
  const items = [
    ...overdueInv.map(i => ({ icon:"<span class=\"adm-dot\" style=\"background:var(--wf-red)\"></span>", text:tA("dash.invoiceOverdue","Factuur {n} vervallen · {a}").replace("{n}", i.number).replace("{a}", eurA(i.total)), view:"facturen", urgent:true })),
    ...expensesPending.slice(0,3).map(e => ({ icon:"<span class=\"adm-dot\" style=\"background:var(--wf-yellow)\"></span>", text:tA("dash.expenseWaiting","Onkostennota {a} van {n} wacht op goedkeuring").replace("{a}", `€${e.amount||0}`).replace("{n}", esc(uName(e)||empA)), view:"expenses", urgent:false })),
    ...openInv.slice(0,2).map(i => ({ icon:"<span class=\"adm-dot\" style=\"background:var(--wf-blue)\"></span>", text:tA("dash.invoiceOpen","Factuur {n} openstaand · {a}").replace("{n}", i.number).replace("{a}", eurA(i.total)), view:"facturen", urgent:false }))
  ];
  if (!items.length) return "";
  return `<div class="adm-card" style="margin-top:16px">
  <div class="adm-card-header"><h3 class="adm-card-title">${tA("dash.actionRequired","Actie vereist")} <span style="background:var(--wf-red-l);color:var(--wf-red);border-radius:999px;padding:2px 8px;font-size:11px;font-weight:700;">${items.length}</span></h3><button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" id="admViewActionCenter">${tA("actions.openCenter", "Open actiecentrum")}</button></div>
  <div class="adm-card-body" style="padding:0">
    ${items.map(it => `
    <div class="adm-action-item" data-view="${it.view}" style="padding:10px 16px;border-bottom:1px solid var(--gray-50);display:flex;align-items:center;gap:10px;cursor:pointer;transition:background .1s;">
      <span style="font-size:16px;">${it.icon}</span>
      <span style="font-size:13px;color:var(--gray-700);flex:1;">${it.text}</span>
      <svg viewBox="0 0 24 24" style="width:14px;fill:var(--gray-400);flex-shrink:0"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
    </div>`).join("")}
  </div>
</div>`;
})()}`;

    document.getElementById("admViewAllLeaves")?.addEventListener("click", e => { e.preventDefault(); switchView("leaves"); });
    document.getElementById("admViewActionCenter")?.addEventListener("click", () => switchView("actions"));

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
      el.addEventListener("mouseenter", () => el.style.background = "var(--gray-50)");
      el.addEventListener("mouseleave", () => el.style.background = "");
    });

    const filterBoard = period => {
      let visible = 0;
      document.querySelectorAll(".adm-board-item").forEach(row => {
        const show = row.dataset[period === "today" ? "boardToday" : "boardWeek"] === "1";
        row.style.display = show ? "" : "none";
        if (show) visible += 1;
      });
      document.querySelectorAll(".adm-board-filter").forEach(btn => btn.classList.toggle("active", btn.dataset.boardPeriod === period));
      const count = document.getElementById("admBoardCount"); if (count) count.textContent = `${visible} ${visible === 1 ? bc.item : bc.items}`;
      const empty = document.getElementById("admBoardEmpty"); if (empty) empty.style.display = visible ? "none" : "block";
    };
    document.querySelectorAll(".adm-board-filter").forEach(btn => btn.addEventListener("click", () => filterBoard(btn.dataset.boardPeriod)));
    document.getElementById("admBoardCollapse")?.addEventListener("click", event => {
      const body = document.getElementById("admBoardBody");
      const collapsed = body?.classList.toggle("hidden");
      event.currentTarget.textContent = collapsed ? "⌄" : "⌃";
      event.currentTarget.setAttribute("aria-label", collapsed ? bc.expand : bc.collapse);
    });
    document.getElementById("admBoardNew")?.addEventListener("click", () => openWorkorderDrawer(null, workorders, { planAfterSave:true }));
    document.querySelectorAll(".adm-board-item").forEach(row => row.addEventListener("click", () => {
      if (row.dataset.boardView === "workorders") {
        const item = workorders.find(w => w.id === row.dataset.boardId);
        if (item) return openWorkorderDrawer(item, workorders);
      }
      switchView(row.dataset.boardView);
    }));
    filterBoard("today");

    // Cockpit-widgets: planning en activiteit
    document.getElementById("admDashPlanning")?.addEventListener("click", e => { e.preventDefault(); switchView("planning"); });
    document.querySelectorAll(".adm-act-link").forEach(el => el.addEventListener("click", () => switchView(el.dataset.view)));

    // Golden path widget injection
    if (gpData?.readiness) {
      const gp = gpData.readiness;
      const pct = gp.percent || 0;
      const steps = gp.steps || [];
      const doneCount = steps.filter(s=>s.done).length;
      const gpEl = document.getElementById("admContent");
      if (gpEl) {
        const gpDiv = document.createElement("div");
        gpDiv.className = "adm-readiness-card";
        gpDiv.style.marginTop = "16px";
        gpDiv.innerHTML = `
<div class="adm-readiness-head" id="admGpHeader">
  <span class="adm-readiness-icon">${pct === 100 ? "✓" : "M"}</span>
  <div><span class="adm-eyebrow">Werkruimte gereedheid</span><h3>${doneCount} van ${steps.length} kernstappen actief</h3><p>Open alleen wanneer je de configuratie of pilotstatus wilt controleren.</p></div>
  <div class="adm-readiness-actions">
    <span class="adm-readiness-score">${pct}%</span>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admGpDetails">Bekijk status</button>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admGpRoadmap">Roadmap</button>
  </div>
</div>
<div class="hidden adm-readiness-steps" id="admGpSteps">
  ${steps.map(s=>`<div class="${s.done ? "done" : ""}">
    <span>${s.done?"✓":"·"}</span><b>${esc(s.key||"")}</b>
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
    <h3 class="adm-card-title">${tA("adm.emp.activeCount","{a} actief").replace("{a}", activeCount)}${inactiveCount ? ` · ${tA("adm.emp.inactiveCount","{i} inactief").replace("{i}", inactiveCount)}` : ""}</h3>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <input type="search" placeholder="${tA("adm.search","Zoeken…")}" id="admEmpSearch" style="width:180px">
      ${inactiveCount ? `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--gray-500);cursor:pointer;">
        <input type="checkbox" id="admEmpShowInactive" ${_empShowInactive?"checked":""}> ${tA("adm.showInactive","Toon inactief")}
      </label>` : ""}
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admEmpImport" title="CSV importeren">${tA("adm.csvImport","CSV Import")}</button>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admEmpExport" title="Exporteer als CSV">${tA("adm.export","Export")}</button>
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
    if (!employees.length) return `<div class="adm-empty"><div class="adm-empty-text">${tA("adm.emp.none","Geen medewerkers gevonden")}</div></div>`;
    return `<table class="adm-table">
      <thead><tr><th></th><th>${tA("adm.name","Naam")}</th><th>${tA("adm.email","E-mail")}</th><th>${tA("adm.function","Functie")}</th><th>${tA("adm.role","Rol")}</th><th>${tA("adm.status","Status")}</th><th>${tA("adm.actions","Acties")}</th></tr></thead>
      <tbody>${employees.map(u => `
        <tr class="adm-row-link adm-emp-row" data-id="${esc(u.id)}" title="Open medewerker">
          <td><span class="adm-avatar" style="background:${u.active===false?"var(--gray-100)":"var(--wf-purple-l)"};color:${u.active===false?"var(--gray-400)":"var(--wf-purple)"}">${(u.name||u.email||"?")[0].toUpperCase()}</span></td>
          <td><div style="font-weight:600;color:${u.active===false?"var(--gray-400)":"var(--gray-900)"}">${esc(u.name||"-")}</div><div style="font-size:11px;color:var(--gray-400)">${esc(u.phone||"")}</div></td>
          <td style="font-size:12px">${esc(u.email)}</td>
          <td style="font-size:12px;color:var(--gray-500)">${esc(u.function||u.jobTitle||"-")}</td>
          <td><span class="adm-status ${u.role==="manager"?"adm-status-pending":"adm-status-open"}">${u.role==="manager"?tA("role.manager","Manager"):u.role==="tenant_admin"?tA("role.admin","Admin"):tA("dash.employee","Medewerker")}</span></td>
          <td>${u.active!==false ? `<span class="adm-status adm-status-active">${tA("adm.active","Actief")}</span>` : `<span class="adm-status adm-status-inactive">${tA("adm.inactive","Inactief")}</span>`}</td>
          <td style="white-space:nowrap">
            <button class="adm-btn adm-btn-secondary adm-btn-sm adm-edit-emp" data-id="${esc(u.id)}">${tA("adm.edit","Bewerken")}</button>
            <button class="adm-btn adm-btn-sm ${u.active!==false?"adm-btn-warning":"adm-btn-success"} adm-toggle-emp" data-id="${esc(u.id)}" data-active="${u.active!==false}">${u.active!==false?"⏸ "+tA("adm.emp.deactivate","Deactiveer"):"▶ "+tA("adm.emp.activate","Activeer")}</button>
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
        if (!await uiConfirm(`${isActive ? "Deactiveer" : "Activeer"} ${emp?.name || emp?.email}?`, { title: "Medewerkertoegang wijzigen", danger: isActive })) return;
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
  <div class="adm-form-section">Persoonsgegevens</div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Voornaam *</label><input name="firstName" value="${esc(emp?.firstName||(emp?.name?.split(" ")[0])||"")}" required placeholder="Jan"></div>
    <div class="adm-form-group"><label>Achternaam *</label><input name="lastName" value="${esc(emp?.lastName||(emp?.name?.split(" ").slice(1).join(" "))||"")}" required placeholder="Janssen"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>E-mail *</label><input name="email" type="email" value="${esc(emp?.email||"")}" ${emp?"readonly style='background:var(--gray-50);color:var(--gray-500)'":""} required placeholder="jan@bedrijf.be"></div>
    <div class="adm-form-group"><label>Telefoon</label><input name="phone" value="${esc(emp?.phone||"")}" placeholder="+32 4xx xx xx xx"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Functie</label><input name="function" value="${esc(emp?.function||emp?.jobTitle||"")}" placeholder="Technieker, Chauffeur…"></div>
    <div class="adm-form-group"><label>Rol</label>
      ${isAdminUser
        ? `<input value="Beheerder" disabled style="background:var(--gray-50);color:var(--gray-500)">`
        : `<select name="role">
        <option value="employee" ${(emp?.role||"employee")==="employee"?"selected":""}>Medewerker</option>
        <option value="manager" ${emp?.role==="manager"?"selected":""}>Manager</option>
      </select>`}
    </div>
  </div>

  <div class="adm-form-section">Adres & IBAN</div>
  <div class="adm-form-group"><label>Adres</label><input name="address" value="${esc(emp?.address||"")}" placeholder="Straat 1, 1000 Brussel"></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>IBAN</label><input name="iban" value="${esc(emp?.iban||"")}" placeholder="BE68 5390 0754 7034"></div>
    <div class="adm-form-group"><label>Rijksregisternr.</label><input name="nationalId" value="${esc(emp?.nationalId||"")}" placeholder="00.00.00-000.00"></div>
  </div>

  <div class="adm-form-section">Verlof</div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Vakantiedagen / jaar</label>
      <input name="leaveQuota" type="number" min="0" max="365" value="${esc(emp?.leaveQuota ?? 20)}" placeholder="20">
    </div>
    <div class="adm-form-group" style="align-self:flex-end;padding-bottom:4px;font-size:12px;color:var(--gray-500);">
      Standaard: 20 dagen. Wijzig voor deeltijdse of contractuele afwijkingen.
    </div>
  </div>

  <div class="adm-form-section">Toegang &amp; rechten</div>
  ${isAdminUser ? `<div style="font-size:12px;color:var(--gray-500);">Beheerders hebben volledige toegang. Rechten beheer je hier alleen voor medewerkers en managers.</div>` : `
  <div style="font-size:12px;color:var(--gray-500);margin-bottom:8px;">Bepaal per onderdeel wat deze gebruiker mag: <strong>Geen</strong> (niet zichtbaar), <strong>Lezen</strong> (bekijken, niets wijzigen) of <strong>Schrijven</strong> (volledig gebruiken). Zo maak je profielen op maat · bv. een finance-medewerker met enkel Facturatie. In- en uitprikken (prikklok) kan iedereen altijd.</div>
  ${_grantable.length ? `<div id="admEmpPerms" style="display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;">
    ${_grantable.map(p => {
      const perms = emp ? (emp.permissions || []) : null;
      const level = perms
        ? (perms.includes(p.key) || perms.includes(`own:${p.key}`) ? "write"
          : perms.includes(`read:${p.key}`) ? "read" : "none")
        : (ROLE_DEFAULT_PERMS[emp?.role || "employee"].includes(p.key) ? "write" : "none");
      return `<label style="display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:8px;font-size:13px;color:var(--gray-700);">
        <span>${esc(p.label)}</span>
        <select class="adm-perm" data-key="${p.key}" style="width:120px;min-height:32px;padding:4px 28px 4px 10px;font-size:12.5px;">
          <option value="none" ${level === "none" ? "selected" : ""}>Geen</option>
          <option value="read" ${level === "read" ? "selected" : ""}>Lezen</option>
          <option value="write" ${level === "write" ? "selected" : ""}>Schrijven</option>
        </select>
      </label>`;
    }).join("")}
  </div>` : `<div style="font-size:12px;color:var(--gray-400);">Geen toewijsbare modules in het huidige pakket.</div>`}
  `}

  ${!emp ? `
  <div class="adm-form-section">Toegang</div>
  <div class="adm-form-group" style="font-size:12px;color:var(--gray-500);background:var(--gray-50);border-radius:8px;padding:10px 12px;">De medewerker ontvangt een activatiemail om binnen 7 dagen zelf een wachtwoord in te stellen. Je kiest hier dus geen wachtwoord.</div>` : ""}

  <div id="admEmpFormErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:8px;font-size:12px;margin-top:8px;"></div>
  <div class="adm-form-actions" style="margin-top:16px;">
    <button type="button" class="adm-btn adm-btn-secondary" id="admEmpCancel">Annuleren</button>
    ${emp ? `<button type="button" class="adm-btn adm-btn-warning adm-btn-sm" id="admEmpPwReset">Wachtwoord reset</button>` : ""}
    <button type="submit" class="adm-btn adm-btn-primary">${emp ? "Opslaan" : "Aanmaken"}</button>
  </div>
</form>
${emp ? `
<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--gray-100);">
  <div class="adm-form-section">Accountbeheer</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <button class="adm-btn adm-btn-sm ${emp.active!==false?"adm-btn-warning":"adm-btn-success"}" id="admEmpToggle">${emp.active!==false?"⏸ Deactiveer account":"▶ Activeer account"}</button>
  </div>
</div>` : ""}`;

    document.getElementById("admEmpCancel").addEventListener("click", closeDrawer);

    // Bij nieuwe medewerker: rechten mee laten springen met de rol-keuze.
    if (!emp) {
      document.querySelector("#admEmpForm select[name=role]")?.addEventListener("change", ev => {
        const defs = ROLE_DEFAULT_PERMS[ev.target.value] || [];
        document.querySelectorAll("#admEmpForm .adm-perm").forEach(sel => { sel.value = defs.includes(sel.dataset.key) ? "write" : "none"; });
      });
    }

    document.getElementById("admEmpPwReset")?.addEventListener("click", async () => {
      const newPw = await uiInput("Nieuw tijdelijk wachtwoord", { title: "Wachtwoord resetten", message: "Gebruik minimaal 8 tekens. Deel het tijdelijke wachtwoord via een veilig kanaal.", input: "password", minlength: 8, placeholder: "Minimaal 8 tekens", confirmLabel: "Wachtwoord wijzigen", danger: true });
      if (!newPw) return;
      if (newPw.length < 8) { window.showToast("Wachtwoord moet minstens 8 tekens zijn.", "warning"); return; }
      try {
        await api("PATCH", `/employees/${emp.id}`, { newPassword: newPw });
        window.showToast(`Wachtwoord van ${emp.name||emp.email} is gewijzigd.`, "success");
      } catch(e) { window.showToast(e.message, "error"); }
    });

    document.getElementById("admEmpToggle")?.addEventListener("click", async () => {
      const isActive = emp.active !== false;
      if (!await uiConfirm(`${isActive?"Deactiveer":"Activeer"} account van ${emp.name||emp.email}?`, { title: "Accounttoegang wijzigen", danger: isActive })) return;
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
      // Geselecteerde rechten met niveau meesturen: "X" = schrijven, "read:X" =
      // alleen-lezen, weggelaten = geen. Server saneert en scoped per rol.
      // Niet voor beheerders · die behouden hun volledige toegang.
      if (!isAdminUser) {
        data.permissions = [...document.querySelectorAll("#admEmpForm .adm-perm")]
          .filter(sel => sel.value !== "none")
          .map(sel => (sel.value === "read" ? `read:${sel.dataset.key}` : sel.dataset.key));
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
            document.getElementById("admEmpFormErr").style.cssText = "display:block;background:var(--wf-green-l);color:var(--wf-green);border-radius:8px;padding:8px;font-size:12px;margin-top:8px;word-break:break-all;";
            document.getElementById("admEmpFormErr").innerHTML = `Medewerker aangemaakt. Activatielink (dev): <a href="${result.activationLink}">${result.activationLink}</a>`;
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
  let _planningMode = "week"; // week | day | capacity
  let _planningEmployee = "";
  let _planningLocation = "";

  async function renderPlanning() {
    const today = new Date().toISOString().slice(0, 10);
    const baseWeek = getWeekStart(new Date());
    baseWeek.setDate(baseWeek.getDate() + _planningWeekOffset * 7);
    const weekEnd = new Date(baseWeek); weekEnd.setDate(baseWeek.getDate() + 6);
    const from = baseWeek.toISOString().slice(0, 10);
    const to = weekEnd.toISOString().slice(0, 10);

    const [planData, leaveData, employeeData, workorderData, venueData] = await Promise.all([
      api("GET", `/manager/planning?from=${from}&to=${to}`),
      api("GET", `/leaves?from=${from}&to=${to}&status=goedgekeurd`).catch(() => ({ leaves: [] })),
      api("GET", "/employees").catch(() => ({ employees: [] })),
      viewEnabled("workorders") ? api("GET", "/workorders").catch(() => ({ workorders: [] })) : { workorders: [] },
      viewEnabled("venues") ? api("GET", "/venues").catch(() => ({ venues: [] })) : { venues: [] }
    ]);
    const rawShifts = Array.isArray(planData) ? planData : (planData.shifts || []);
    const venues = venueData.venues || venueData.rows || [];
    const venueById = Object.fromEntries(venues.map(venue => [venue.id, venue]));
    const allShifts = rawShifts.map(shift => {
      const venue = venueById[shift.venueId];
      const legacyLocation = shift.venueId && !venue ? shift.venueId : "";
      return {
        ...shift,
        venueName: venue?.name || shift.venueName || null,
        locationLabel: shift.location || venue?.name || shift.venueName || legacyLocation || ""
      };
    });
    const employees = (employeeData.employees || employeeData || [])
      .filter(user => !["tenant_admin", "super_admin"].includes(user.role) && user.active !== false);
    const workorders = workorderData.workorders || workorderData || [];
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

    const weekDays = [];
    for (let d = new Date(baseWeek); d <= weekEnd; d.setDate(d.getDate() + 1)) {
      weekDays.push(d.toISOString().slice(0, 10));
    }
    const days = _planningMode === "day" ? [today >= from && today <= to ? today : from] : weekDays;

    const locations = [...new Set(allShifts.map(shift => shift.locationLabel).filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b)));
    const shifts = allShifts.filter(shift =>
      (!_planningEmployee || shift.userId === _planningEmployee) &&
      (!_planningLocation || shift.locationLabel === _planningLocation)
    );
    const visibleEmployees = employees.filter(user => !_planningEmployee || user.id === _planningEmployee);

    const toMinutes = value => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
      return match ? Number(match[1]) * 60 + Number(match[2]) : null;
    };
    const plannedMinutes = shifts.reduce((sum, shift) => {
      const start = toMinutes(shift.start), end = toMinutes(shift.end);
      return sum + (start != null && end != null ? Math.max(0, end - start) : 0);
    }, 0);
    const groups = {};
    shifts.forEach(shift => { const key = `${shift.userId}::${shift.date}`; (groups[key] ||= []).push(shift); });
    let conflictCount = 0;
    Object.values(groups).forEach(rows => {
      const sorted = rows.map(row => ({ start:toMinutes(row.start), end:toMinutes(row.end) })).filter(row => row.start != null && row.end != null).sort((a,b) => a.start - b.start);
      for (let index = 1; index < sorted.length; index += 1) if (sorted[index].start < sorted[index - 1].end) conflictCount += 1;
    });
    const leavePeople = Object.keys(leaveMap).length;
    const capacityHours = _planningMode === "day" ? 8 : 40;
    const capacityBase = Math.max(1, visibleEmployees.length || new Set(shifts.map(s => s.userId)).size) * capacityHours * 60;
    const capacityPct = Math.round(plannedMinutes / capacityBase * 100);
    const openWorkorders = workorders.filter(order => !["Voltooid", "Afgewerkt", "geannuleerd", "cancelled"].includes(order.status));
    const unscheduled = openWorkorders.filter(order => !order.scheduledDate || !order.userId).slice(0, 5);

    const weekLabel = `${new Date(from).toLocaleDateString("nl-BE",{day:"numeric",month:"short"})} – ${new Date(to).toLocaleDateString("nl-BE",{day:"numeric",month:"short",year:"numeric"})}`;

    const content = document.getElementById("admContent");
    content.innerHTML = `
<div class="adm-planning-page">
  <section class="adm-planning-title">
    <div><span class="adm-eyebrow">Resource planning</span><h2>Teamplanning</h2><p>Zie capaciteit, beschikbaarheid en opdrachten in één rustig werkvlak.</p></div>
    <button class="adm-btn adm-btn-primary" id="admAddShift">+ Nieuwe planning</button>
  </section>
  <section class="adm-planning-toolbar">
    <div class="adm-week-navigation">
      <button type="button" id="admPrevWeek" aria-label="Vorige week">‹</button>
      <button type="button" id="admNextWeek" aria-label="Volgende week">›</button>
      <button type="button" class="adm-today-button" id="admTodayWeek">Vandaag</button>
      <strong>${weekLabel}</strong>
    </div>
    <div class="adm-planning-controls">
      <select id="admPlanningEmployee" aria-label="Filter medewerker"><option value="">Alle medewerkers</option>${employees.map(user => `<option value="${esc(user.id)}" ${_planningEmployee === user.id ? "selected" : ""}>${esc(user.name || user.email)}</option>`).join("")}</select>
      <select id="admPlanningLocation" aria-label="Filter locatie"><option value="">Alle locaties</option>${locations.map(location => `<option value="${esc(location)}" ${_planningLocation === location ? "selected" : ""}>${esc(location)}</option>`).join("")}</select>
      <div class="adm-view-switch" role="group" aria-label="Planningweergave">
        <button type="button" data-planning-mode="week" class="${_planningMode === "week" ? "active" : ""}">Week</button>
        <button type="button" data-planning-mode="day" class="${_planningMode === "day" ? "active" : ""}">Dag</button>
        <button type="button" data-planning-mode="capacity" class="${_planningMode === "capacity" ? "active" : ""}">Capaciteit</button>
      </div>
    </div>
  </section>
  <section class="adm-planning-metrics">
    <span><small>Geplande uren</small><b>${(plannedMinutes / 60).toLocaleString("nl-BE", { maximumFractionDigits:1 })} u</b></span>
    <span><small>Actieve shifts</small><b>${shifts.length}</b></span>
    <span><small>Op verlof</small><b>${leavePeople}</b></span>
    <span><small>Conflicten</small><b class="${conflictCount ? "metric-red" : "metric-green"}">${conflictCount}</b></span>
    <div><span>Weekcapaciteit</span><i><b style="width:${Math.min(100, capacityPct)}%"></b></i><strong>${capacityPct}%</strong></div>
  </section>
  ${_planningMode === "capacity" ? renderPlanningCapacity(shifts, visibleEmployees, leaveMap, from) : `
  <div class="adm-planning-workspace">
    <section class="adm-modern-planner" style="--day-count:${days.length};--planner-min:${190 + days.length * 160}px">
      <div class="adm-modern-planner-head"><span>Medewerker</span>${days.map(d => {
        const date = new Date(`${d}T12:00:00`);
        return `<div class="${d === today ? "today" : ""}"><b>${esc(date.toLocaleDateString("nl-BE", { weekday:"short", day:"numeric", month:"short" }).replace(".", ""))}</b>${d === today ? "<i></i>" : ""}</div>`;
      }).join("")}</div>
      ${renderPlanningRows(shifts, days, leaveMap, visibleEmployees)}
    </section>
    <aside class="adm-planning-side">
      <section class="adm-planning-side-card"><div class="adm-side-card-head"><span class="adm-eyebrow">Nog te plannen</span><b>${unscheduled.length}</b></div>
        ${unscheduled.map(order => `<button type="button" class="adm-unscheduled-work" data-id="${esc(order.id)}"><i class="${order.priority === "urgent" ? "urgent" : ""}"></i><span><b>${esc(order.title || order.number || "Werkbon")}</b><small>${esc(order.clientName || order.customerName || "Nog geen klant")} · ${esc(order.status || "open")}</small></span><em>→</em></button>`).join("") || `<p class="adm-side-empty">Alle open opdrachten zijn toegewezen.</p>`}
      </section>
      <section class="adm-planning-insight ${conflictCount ? "warning" : "ok"}"><span>${conflictCount ? "!" : "✓"}</span><div><b>${conflictCount ? `${conflictCount} planningsconflict${conflictCount === 1 ? "" : "en"}` : "Planning is conflictvrij"}</b><p>${conflictCount ? "Controleer overlappende shifts voor je de week publiceert." : "Geen overlappende shifts in deze selectie."}</p></div></section>
      <button type="button" class="adm-copy-week" id="admCopyWeek">⧉ Kopieer deze week</button>
    </aside>
  </div>`}
</div>`;
    document.getElementById("admAddShift")?.addEventListener("click", () => openShiftDrawer(from, to, null, shifts));
    document.getElementById("admPrevWeek")?.addEventListener("click", () => { _planningWeekOffset--; renderPlanning(); });
    document.getElementById("admNextWeek")?.addEventListener("click", () => { _planningWeekOffset++; renderPlanning(); });
    document.getElementById("admTodayWeek")?.addEventListener("click", () => { _planningWeekOffset = 0; renderPlanning(); });
    document.getElementById("admPlanningEmployee")?.addEventListener("change", event => { _planningEmployee = event.target.value; renderPlanning(); });
    document.getElementById("admPlanningLocation")?.addEventListener("change", event => { _planningLocation = event.target.value; renderPlanning(); });
    document.querySelectorAll("[data-planning-mode]").forEach(button => button.addEventListener("click", () => { _planningMode = button.dataset.planningMode; renderPlanning(); }));
    document.getElementById("admCopyWeek")?.addEventListener("click", async () => {
      if (!shifts.length) { window.showToast && window.showToast(tA("adm.plan.copyNone","Geen shifts om te kopiëren"), "info"); return; }
      const btn = document.getElementById("admCopyWeek");
      btn.disabled = true; btn.textContent = tA("adm.busy","Bezig…");
      try {
        const nextWeekBase = new Date(baseWeek); nextWeekBase.setDate(nextWeekBase.getDate() + 7);
        let copied = 0;
        for (const s of shifts) {
          const oldDate = new Date(s.date);
          const newDate = new Date(oldDate); newDate.setDate(oldDate.getDate() + 7);
          await api("POST", "/planning", {
            userId: s.userId,
            date: newDate.toISOString().slice(0,10),
            start: s.start,
            end: s.end,
            venueId: s.venueId || null,
            note: s.note || "",
            workorderId: s.workorderId || null
          });
          copied++;
        }
        window.showToast && window.showToast(tA("adm.plan.copied","{n} shifts gekopieerd naar volgende week").replace("{n}", copied), "success");
        _planningWeekOffset++;
        renderPlanning();
      } catch(e) { window.showToast && window.showToast(e.message, "error"); btn.disabled = false; btn.textContent = tA("adm.plan.copyWeek","⧉ Kopieer week"); }
    });
    document.querySelectorAll(".adm-shift-pill").forEach(pill => {
      pill.setAttribute("draggable", "true");
      pill.addEventListener("dragstart", event => {
        pill.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", pill.dataset.id);
      });
      pill.addEventListener("dragend", () => pill.classList.remove("is-dragging"));
      pill.addEventListener("click", () => {
        const shift = shifts.find(s => s.id === pill.dataset.id);
        if (shift) openShiftDrawer(from, to, shift, shifts);
      });
    });
    document.querySelectorAll(".adm-planner-cell").forEach(cell => {
      cell.addEventListener("dragover", event => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        cell.classList.add("is-drop-target");
      });
      cell.addEventListener("dragleave", event => {
        if (!cell.contains(event.relatedTarget)) cell.classList.remove("is-drop-target");
      });
      cell.addEventListener("drop", async event => {
        event.preventDefault();
        cell.classList.remove("is-drop-target");
        const shiftId = event.dataTransfer.getData("text/plain");
        const shift = shifts.find(row => row.id === shiftId);
        const userId = cell.dataset.user;
        const date = cell.dataset.date;
        if (!shift || !userId || !date || (shift.userId === userId && shift.date === date)) return;
        cell.classList.add("is-saving");
        try {
          await api("PATCH", `/planning/${shift.id}`, { userId, date });
          window.showToast && window.showToast(`Planning verplaatst naar ${new Date(`${date}T12:00:00`).toLocaleDateString("nl-BE", { weekday:"short", day:"numeric", month:"short" })}.`, "success");
          renderPlanning();
        } catch (error) {
          cell.classList.remove("is-saving");
          window.showToast && window.showToast(error.message, "error");
        }
      });
    });
    document.querySelectorAll(".adm-empty-slot").forEach(slot => slot.addEventListener("click", () => openShiftDrawer(from, to, null, shifts, { userId:slot.dataset.user, date:slot.dataset.date })));
    document.querySelectorAll(".adm-unscheduled-work").forEach(button => button.addEventListener("click", () => {
      const order = workorders.find(row => row.id === button.dataset.id);
      if (order) openWorkorderDrawer(order, workorders);
    }));
  }

  function renderPlanningCapacity(shifts, employees, leaveMap, referenceDate) {
    const rows = employees.length ? employees : [...new Map(shifts.map(shift => [shift.userId, { id:shift.userId, name:uName(shift) }])).values()];
    if (!rows.length) return `<div class="adm-planning-empty">Voeg medewerkers en shifts toe om capaciteit te berekenen.</div>`;
    return `<section class="adm-capacity-board">${rows.map((user, index) => {
      const userShifts = shifts.filter(shift => shift.userId === user.id);
      const minutes = userShifts.reduce((sum, shift) => {
        const [sh, sm] = String(shift.start || "0:0").split(":").map(Number), [eh, em] = String(shift.end || "0:0").split(":").map(Number);
        return sum + Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
      }, 0);
      const pct = Math.round(minutes / (40 * 60) * 100);
      const initials = String(user.name || user.email || "M").split(/\s+/).slice(0,2).map(value => value[0]).join("").toUpperCase();
      const onLeave = Object.keys(leaveMap[user.id] || {}).length;
      return `<article><i class="capacity-avatar color-${index % 5}">${esc(initials)}</i><span class="capacity-person"><b>${esc(user.name || user.email || "Medewerker")}</b><small>${user.function || user.role || "Team"}</small></span><span class="person-capacity"><span><b>${(minutes / 60).toLocaleString("nl-BE", { maximumFractionDigits:1 })} u</b><small>van 40 u</small></span><i><b style="width:${Math.min(100,pct)}%"></b></i></span><em class="${pct >= 95 ? "nearly-full" : "available"}">${onLeave ? `${onLeave}d verlof` : pct >= 95 ? "Bijna vol" : "Beschikbaar"}</em><button type="button" class="adm-empty-slot" data-user="${esc(user.id)}" data-date="${esc(referenceDate)}">+ Inplannen</button></article>`;
    }).join("")}</section>`;
  }

  // Persoonlijke kleuren per medewerker (cyclisch)
  const PLAN_COLORS = [
    ["var(--wf-blue-l)","var(--wf-blue)"],["var(--wf-green-l)","var(--wf-green)"],["var(--wf-yellow-l)","var(--wf-yellow)"],
    ["var(--wf-purple-l)","var(--wf-purple)"],["var(--wf-purple-l)","var(--wf-purple)"],["var(--wf-blue-l)","var(--wf-blue-d)"],
    ["var(--wf-red-l)","var(--wf-red)"],["var(--wf-blue-l)","var(--wf-blue)"]
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

  function renderPlanningRows(shifts, days, leaveMap = {}, employees = []) {
    const today = new Date().toISOString().slice(0,10);
    const byUser = {};
    shifts.forEach(s => {
      if (!byUser[s.userId]) byUser[s.userId] = { name: uName(s), days: {} };
      if (!byUser[s.userId].days[s.date]) byUser[s.userId].days[s.date] = [];
      byUser[s.userId].days[s.date].push(s);
    });
    employees.forEach(user => {
      if (!byUser[user.id]) byUser[user.id] = { id:user.id, name:user.name || user.email, role:user.function || user.role || "Team", days:{} };
      else { byUser[user.id].id = user.id; byUser[user.id].role = user.function || user.role || "Team"; }
    });
    // Also add leave-only users to the grid
    Object.keys(leaveMap).forEach(uid => {
      if (!byUser[uid]) {
        const leaveUser = Object.values(leaveMap[uid] || {});
        byUser[uid] = { id:uid, name: uid, role:"Verlof", days: {}, leaveOnly: true };
      }
    });
    if (!Object.keys(byUser).length) return `<div class="adm-planning-empty">Nog geen medewerkers of shifts in deze selectie.</div>`;
    return Object.entries(byUser).map(([userId, u], rowIndex) => {
      const [bg, fg] = planColor(userId || "x");
      const totalShifts = Object.values(u.days).reduce((s,d)=>s+d.length,0);
      const initials = String(u.name || "M").split(/\s+/).slice(0,2).map(value => value[0]).join("").toUpperCase();
      return `<div class="adm-modern-planner-row">
        <div class="adm-planner-person"><i class="color-${rowIndex % 5}">${esc(initials)}</i><span><b>${esc(u.name)}</b><small>${esc(u.role || `${totalShifts} shifts`)} · ${totalShifts} shift${totalShifts === 1 ? "" : "s"}</small></span></div>
        ${days.map(d => {
          const dayShifts = u.days[d] || [];
          const isToday = d === today;
          const onLeave = leaveMap[userId]?.[d];
          return `<div class="adm-planner-cell ${isToday ? "today" : ""} ${onLeave ? "on-leave" : ""}" data-user="${esc(userId)}" data-date="${esc(d)}">
            ${onLeave && !dayShifts.length ? `<span class="adm-leave-slot"><i></i>${esc(onLeave)}</span>` : ""}
            ${dayShifts.map(s =>
              `<button type="button" class="adm-shift-pill" data-id="${esc(s.id)}" title="${esc(s.note||s.locationLabel||"")} · klik om te bewerken" style="--shift-bg:${bg};--shift-color:${fg}"><span><b>${esc(s.note || s.project || s.locationLabel || "Geplande opdracht")}</b><em>${esc(s.status || "Shift")}</em></span><small>${esc(s.locationLabel || "Locatie nog te bepalen")}</small><time>${esc(s.start||"")}${s.end?` – ${esc(s.end)}`:""}</time></button>`
            ).join("")||(!onLeave?`<button type="button" class="adm-empty-slot" data-user="${esc(userId)}" data-date="${esc(d)}">+ Inplannen</button>`:"")}
          </div>`;
        }).join("")}
      </div>`;
    }).join("");
  }

  // ── Shift drawer (admin) ───────────────────────────────────
  function openShiftDrawer(weekFrom, weekTo, shift = null, allShifts = [], prefill = {}) {
    const today = new Date().toISOString().slice(0, 10);
    Promise.all([
      api("GET", "/employees"),
      api("GET", "/venues").catch(() => ({ venues: [] }))
    ]).then(([data, venueData]) => {
      const employees = data.employees || [];
      const venues = venueData.venues || venueData.rows || [];
      const selectedVenueId = shift?.venueId || prefill.venueId || "";
      const selectedVenue = venues.find(venue => venue.id === selectedVenueId);
      const legacyLocation = selectedVenue ? "" : (shift?.venueId || "");
      const isEdit = !!shift;
      const drawer = document.getElementById("admDrawer");
      drawer.dataset.editorKind = "planning";
      document.getElementById("admDrawerContext").textContent = isEdit ? "Operaties · Planningdetail" : "Operaties · Nieuwe planning";
      document.getElementById("admDrawerTitle").textContent = isEdit ? (shift.note || shift.project || "Planning bewerken") : "Nieuwe planning";
      document.getElementById("admDrawerBody").innerHTML = `
<form id="admShiftForm" class="adm-planning-detail">
  <input type="hidden" name="workorderId" value="${esc(shift?.workorderId || prefill.workorderId || "")}">
  <div class="adm-planning-detail-status">
    <span class="mn-status ${isEdit ? "mn-status-info" : "mn-status-warning"}">${isEdit ? esc(shift.status || "Gepland") : "Nieuwe planning"}</span>
    <span>${isEdit ? `Laatst gekend op ${esc(shift.date || "")}` : "Vul de opdracht en uitvoering in"}</span>
  </div>
  <div class="adm-planning-detail-grid">
  <div class="adm-planning-detail-main">
  <section class="adm-planning-detail-section">
    <div class="adm-planning-detail-heading"><span>01</span><div><h3>Opdracht en uitvoering</h3><p>Wie voert de opdracht uit, waar en wanneer?</p></div></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Medewerker *</label>
      <select name="userId" required>
        <option value="">- Kies medewerker -</option>
        ${employees.map(u => `<option value="${esc(u.id)}" ${(shift?.userId||prefill.userId)===u.id?"selected":""}>${esc(u.name || u.email)}</option>`).join("")}
      </select>
    </div>
    <div class="adm-form-group"><label>Datum *</label>
      <input name="date" type="date" value="${shift?.date || prefill.date || weekFrom || today}" required>
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
  <div class="adm-form-group"><label>Werf / locatie</label>
    <select name="venueId" id="shiftVenue">
      <option value="">Geen vaste werf</option>
      ${venues.map(venue => `<option value="${venue.id}" ${selectedVenueId === venue.id ? "selected" : ""}>${esc(venue.name || venue.address || "Locatie")}</option>`).join("")}
    </select>
    <div class="adm-form-hint">Bewaar de echte werfkoppeling voor werkbon, planning en rapportage.</div>
    ${legacyLocation ? `<div class="planning-legacy-location">Oude vrije locatie: <strong>${esc(legacyLocation)}</strong>. Kies een bestaande werf om dit record te normaliseren.</div>` : ""}
  </div>
  <div class="adm-form-group"><label>Notitie</label>
    <textarea name="note" rows="4" placeholder="Werkafspraken, instructies of aandachtspunten">${esc(shift?.note||prefill.note||"")}</textarea>
  </div>
  </section>
  ${isEdit ? `<section class="adm-planning-detail-section">
    <div class="adm-planning-detail-heading"><span>02</span><div><h3>Gekoppelde informatie</h3><p>Alles wat nodig is voor een vlotte uitvoering.</p></div></div>
    <div class="adm-planning-links">
      <button type="button"><span>▣</span><b>Werkbon</b><small>${shift.workorderId ? "Gekoppeld aan deze planning" : "Nog geen werkbon gekoppeld"}</small></button>
      <button type="button"><span>⌁</span><b>Documenten</b><small>Voeg plannen, foto's of bijlagen toe</small></button>
      <button type="button"><span>◇</span><b>Materiaal</b><small>Registreer benodigd materiaal</small></button>
      <button type="button"><span>✎</span><b>Interne notities</b><small>Deel context met het team</small></button>
    </div>
  </section>` : ""}
  </div>
  <aside class="adm-planning-detail-aside">
    <section><span class="adm-eyebrow">Samenvatting</span>
      <dl>
        <div><dt>Datum</dt><dd>${esc(shift?.date || prefill.date || weekFrom || today)}</dd></div>
        <div><dt>Tijd</dt><dd>${esc(shift?.start || "07:00")} tot ${esc(shift?.end || "17:00")}</dd></div>
        <div><dt>Locatie</dt><dd>${esc(selectedVenue?.name || "Nog te bepalen")}</dd></div>
        <div><dt>Werkbon</dt><dd>${shift?.workorderId ? "Gekoppeld" : "Niet gekoppeld"}</dd></div>
      </dl>
    </section>
    <section class="adm-planning-attention"><span>i</span><div><b>Controle vóór opslaan</b><p>Monargo controleert beschikbaarheid, verlof en overlappende planning via de backend.</p></div></section>
    ${isEdit ? `<section><span class="adm-eyebrow">Activiteit</span><div class="adm-planning-activity"><i></i><div><b>Planning beschikbaar</b><p>Klik op opslaan om wijzigingen vast te leggen.</p></div></div></section>` : ""}
  </aside>
  </div>
  ${!isEdit ? `
  <div style="background:var(--gray-50);border-radius:8px;padding:12px;margin-bottom:4px;">
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;cursor:pointer;">
      <input type="checkbox" id="shiftRecurring" style="width:16px;height:16px;"> Wekelijks herhalen
    </label>
    <div id="shiftRecurWrap" style="display:none;margin-top:10px;">
      <div class="adm-form-row">
        <div class="adm-form-group"><label>Aantal weken</label>
          <select id="shiftRecurWeeks" style="width:100%;padding:7px">
            <option value="2">2 weken</option>
            <option value="4" selected>4 weken</option>
            <option value="8">8 weken</option>
            <option value="12">12 weken</option>
          </select>
        </div>
        <div class="adm-form-group" style="align-self:flex-end;padding-bottom:4px;font-size:12px;color:var(--gray-500);" id="shiftRecurInfo">
          Maakt 4 shifts aan
        </div>
      </div>
    </div>
  </div>` : ""}
  <div id="admShiftErr" style="display:none;color:var(--wf-red);font-size:12px;padding:4px 0;"></div>
  <div class="adm-form-actions" style="justify-content:space-between;">
    ${isEdit ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="admShiftDelete">Verwijderen</button>` : `<span></span>`}
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
          if (!await uiConfirm(`Shift verwijderen voor ${uName(shift)} op ${shift.date}?`, { title: "Shift verwijderen", danger: true, confirmLabel: "Verwijderen" })) return;
          try {
            await api("DELETE", `/planning/${shift.id}`);
            closeDrawer(); renderPlanning();
          } catch(err) { window.showToast(err.message, "error"); }
        });
      }

      document.getElementById("admShiftForm").addEventListener("submit", async e => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(e.target).entries());
        body.venueId = body.venueId || null;
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
            if (weeks > 1) window.showToast && window.showToast(`${weeks} shifts aangemaakt`, "success");
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

  // ── Afspraken (klantafspraken + automatische reminder-mail) ─────────────
  let _aptFilter = "komend"; // komend | alle | geannuleerd

  function tAptStatus(s) {
    const map = { gepland: "adm.apt.stPlanned", bevestigd: "adm.apt.stConfirmed", uitgevoerd: "adm.apt.stDone", geannuleerd: "adm.apt.stCancelled" };
    return map[s] ? tA(map[s], s) : (s || "-");
  }

  async function renderAppointments() {
    const content = document.getElementById("admContent");
    let rows = [];
    try { const d = await api("GET", "/appointments"); rows = d.appointments || []; }
    catch (e) { content.innerHTML = `<div style="padding:20px;color:var(--wf-red)">${tA("adm.error","Fout")}: ${e.message}</div>`; return; }

    const today = new Date().toISOString().slice(0, 10);
    const filtered = _aptFilter === "komend" ? rows.filter(a => a.date >= today && a.status !== "geannuleerd")
      : _aptFilter === "geannuleerd" ? rows.filter(a => a.status === "geannuleerd")
      : rows;
    const statusCss = { gepland: "adm-status-pending", bevestigd: "adm-status-goedgekeurd", uitgevoerd: "adm-status-active", geannuleerd: "adm-status-inactive" };
    const reminderCell = a => {
      if (a.reminderSentAt) return `<span style="color:var(--wf-green);font-weight:600;">✓ ${tA("adm.apt.remSent","verstuurd")} ${new Date(a.reminderSentAt).toLocaleDateString("nl-BE")}</span>`;
      if (!a.customerEmail) return `<span style="color:var(--gray-400);">${tA("adm.apt.remNoEmail","geen e-mail")}</span>`;
      if (!a.reminderDays) return `<span style="color:var(--gray-400);">${tA("adm.apt.remOff","uit")}</span>`;
      return `${a.reminderDays}${tA("adm.leave.daysAbbr","d")} ${tA("adm.apt.remBefore","vooraf")}`;
    };

    content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">${tA("nav.appointments","Afspraken")} <span style="background:var(--wf-blue-l);color:var(--wf-blue);border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${filtered.length}</span></h3>
    <div style="display:flex;gap:8px;align-items:center;">
      <select id="admAptFilter">
        <option value="komend" ${_aptFilter==="komend"?"selected":""}>${tA("adm.apt.fUpcoming","Komende")}</option>
        <option value="alle" ${_aptFilter==="alle"?"selected":""}>${tA("mgr.all","Alle")}</option>
        <option value="geannuleerd" ${_aptFilter==="geannuleerd"?"selected":""}>${tA("adm.apt.stCancelled","Geannuleerd")}</option>
      </select>
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="admNewApt">+ ${tA("adm.apt.singular","Afspraak")}</button>
    </div>
  </div>
  ${filtered.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-text">${tA("adm.apt.empty","Geen afspraken")}</div><button class="adm-btn adm-btn-primary adm-btn-sm" id="admEmptyNewApt" style="margin-top:12px">+ ${tA("adm.apt.emptyBtn","Eerste afspraak aanmaken")}</button></div>`
    : `<div class="adm-card-body adm-table-wrap">
    <table class="adm-table">
      <thead><tr><th>${tA("adm.date","Datum")}</th><th>${tA("adm.apt.thTime","Tijd")}</th><th>${tA("adm.thCustomer","Klant")}</th><th>${(window.wfpTerms && window.wfpTerms.t("jobSingular")) || tA("emp.wo.default","Werkbon")}</th><th>${tA("adm.apt.thReminder","Reminder")}</th><th>${tA("adm.status","Status")}</th><th>${tA("adm.actions","Acties")}</th></tr></thead>
      <tbody>
        ${filtered.map(a => `
        <tr class="adm-row-link adm-apt-row" data-id="${esc(a.id)}">
          <td style="font-weight:600;${a.date === today ? "color:var(--wf-blue);" : ""}">${new Date(`${a.date}T12:00:00`).toLocaleDateString("nl-BE",{weekday:"short",day:"numeric",month:"short",year:"numeric"})}</td>
          <td>${esc(a.start || "")}${a.end ? ` – ${esc(a.end)}` : ""}</td>
          <td><strong>${esc(a.customerName || "-")}</strong>${a.customerEmail ? `<div style="font-size:11px;color:var(--gray-400)">${esc(a.customerEmail)}</div>` : ""}</td>
          <td>${a.workorderNumber ? esc(a.workorderNumber) : (a.workorderId ? esc(String(a.workorderId).slice(-4)) : "-")}</td>
          <td style="font-size:12px;">${reminderCell(a)}</td>
          <td><span class="adm-status ${statusCss[a.status]||"adm-status-pending"}">${esc(tAptStatus(a.status))}</span></td>
          <td style="white-space:nowrap;"><button class="adm-btn adm-btn-secondary adm-btn-sm adm-apt-edit" data-id="${esc(a.id)}">${tA("adm.edit","Bewerken")}</button></td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`}
</div>`;

    document.getElementById("admAptFilter")?.addEventListener("change", e => { _aptFilter = e.target.value; renderAppointments(); });
    document.getElementById("admNewApt")?.addEventListener("click", () => openAppointmentDrawer(null));
    document.getElementById("admEmptyNewApt")?.addEventListener("click", () => openAppointmentDrawer(null));
    content.querySelectorAll(".adm-apt-edit").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); openAppointmentDrawer(rows.find(x => x.id === b.dataset.id)); }));
    content.querySelectorAll(".adm-apt-row").forEach(row => row.addEventListener("click", e => {
      if (e.target.closest("button")) return;
      openAppointmentDrawer(rows.find(x => x.id === row.dataset.id));
    }));
  }

  async function openAppointmentDrawer(apt) {
    const [custData, woData] = await Promise.all([
      api("GET", "/customers").catch(() => ({ customers: [] })),
      api("GET", "/workorders").catch(() => ({ workorders: [] })),
    ]);
    const customers = custData.customers || [];
    const openWos = (woData.workorders || []).filter(w => !["Voltooid", "Afgewerkt", "done", "geannuleerd"].includes(w.status));
    const today = new Date().toISOString().slice(0, 10);
    const isEdit = !!apt;
    document.getElementById("admDrawerTitle").textContent = isEdit ? tA("adm.apt.editTitle","Afspraak bewerken") : tA("adm.apt.newTitle","Nieuwe afspraak");
    document.getElementById("admDrawerBody").innerHTML = `
<form id="aptForm">
  <div class="adm-form-group"><label>${tA("adm.thCustomer","Klant")}</label>
    <select name="customerId" id="aptCustSel" style="width:100%">
      <option value="">${tA("adm.quote.manualFill","- Handmatig invullen -")}</option>
      ${customers.map(c => `<option value="${esc(c.id)}" ${apt?.customerId === c.id ? "selected" : ""} data-name="${esc(c.name||"")}" data-email="${esc(c.email||"")}">${esc(c.name)}</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${tA("adm.quote.customerName","Klantnaam")} *</label>
      <input name="customerName" id="aptCustName" value="${esc(apt?.customerName || "")}" required></div>
    <div class="adm-form-group"><label>${tA("adm.apt.custEmail","E-mail klant (voor reminder)")}</label>
      <input name="customerEmail" id="aptCustEmail" type="email" value="${esc(apt?.customerEmail || "")}"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${tA("adm.date","Datum")} *</label>
      <input name="date" type="date" value="${esc(apt?.date || today)}" required></div>
    <div class="adm-form-group"><label>${tA("mgr.startTime","Starttijd")} *</label>
      <input name="start" type="time" value="${esc(apt?.start || "08:00")}" required></div>
    <div class="adm-form-group"><label>${tA("mgr.endTime","Eindtijd")}</label>
      <input name="end" type="time" value="${esc(apt?.end || "")}"></div>
  </div>
  <div class="adm-form-group"><label>${(window.wfpTerms && window.wfpTerms.t("jobSingular")) || tA("emp.wo.default","Werkbon")} (${tA("adm.apt.optional","optioneel")})</label>
    <select name="workorderId" style="width:100%">
      <option value="">${tA("mgr.noWo","Geen werkbon")}</option>
      ${openWos.map(w => `<option value="${esc(w.id)}" ${apt?.workorderId === w.id ? "selected" : ""}>${esc(w.number ? w.number + " · " : "")}${esc(w.title || "")}</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${tA("adm.apt.reminderLabel","Reminder naar klant")}</label>
      <select name="reminderDays">
        <option value="0" ${apt?.reminderDays === 0 ? "selected" : ""}>${tA("adm.apt.remNone","Geen reminder")}</option>
        <option value="1" ${(apt?.reminderDays ?? 1) === 1 ? "selected" : ""}>${tA("adm.apt.rem1","1 dag vooraf")}</option>
        <option value="2" ${apt?.reminderDays === 2 ? "selected" : ""}>${tA("adm.apt.rem2","2 dagen vooraf")}</option>
        <option value="3" ${apt?.reminderDays === 3 ? "selected" : ""}>${tA("adm.apt.rem3","3 dagen vooraf")}</option>
        <option value="7" ${apt?.reminderDays === 7 ? "selected" : ""}>${tA("adm.apt.rem7","1 week vooraf")}</option>
      </select>
    </div>
    ${isEdit ? `<div class="adm-form-group"><label>${tA("adm.status","Status")}</label>
      <select name="status">
        <option value="gepland" ${apt.status === "gepland" ? "selected" : ""}>${tA("adm.apt.stPlanned","Gepland")}</option>
        <option value="bevestigd" ${apt.status === "bevestigd" ? "selected" : ""}>${tA("adm.apt.stConfirmed","Bevestigd")}</option>
        <option value="uitgevoerd" ${apt.status === "uitgevoerd" ? "selected" : ""}>${tA("adm.apt.stDone","Uitgevoerd")}</option>
        <option value="geannuleerd" ${apt.status === "geannuleerd" ? "selected" : ""}>${tA("adm.apt.stCancelled","Geannuleerd")}</option>
      </select>
    </div>` : ""}
  </div>
  <div class="adm-form-group"><label>${tA("adm.apt.noteLabel","Notitie (komt mee in de reminder)")}</label>
    <textarea name="note" rows="2" style="width:100%">${esc(apt?.note || "")}</textarea>
  </div>
  ${isEdit && apt.reminderSentAt ? `<div style="font-size:12px;color:var(--wf-green);margin-bottom:8px;">✓ ${tA("adm.apt.remSentOn","Reminder verstuurd op")} ${new Date(apt.reminderSentAt).toLocaleString("nl-BE")}. ${tA("adm.apt.remResetHint","Wijzig je datum, tijd of reminder-instelling, dan wordt opnieuw een reminder gepland.")}</div>` : ""}
  <div id="aptFormErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions" style="${isEdit ? "justify-content:space-between;" : ""}">
    ${isEdit ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="aptDelete">${tA("adm.delete","Verwijderen")}</button>` : ""}
    <div style="display:flex;gap:8px;">
      <button type="button" class="adm-btn adm-btn-secondary" id="aptCancel">${tA("adm.cancel","Annuleren")}</button>
      <button type="submit" class="adm-btn adm-btn-primary">${isEdit ? tA("adm.save","Opslaan") : tA("adm.createBtn","Aanmaken")}</button>
    </div>
  </div>
</form>`;
    openDrawer();
    document.getElementById("aptCancel").addEventListener("click", closeDrawer);
    document.getElementById("aptCustSel")?.addEventListener("change", e => {
      const opt = e.target.selectedOptions[0];
      if (!opt || !opt.value) return;
      document.getElementById("aptCustName").value = opt.dataset.name || "";
      document.getElementById("aptCustEmail").value = opt.dataset.email || "";
    });
    document.getElementById("aptDelete")?.addEventListener("click", async () => {
      if (!await uiConfirm(tA("adm.apt.deleteConfirm","Afspraak van {d} verwijderen?").replace("{d}", apt.date), { title: "Afspraak verwijderen", danger: true, confirmLabel: tA("adm.delete","Verwijderen") })) return;
      try { await api("DELETE", `/appointments/${apt.id}`); closeDrawer(); renderAppointments(); }
      catch (err) { const el = document.getElementById("aptFormErr"); if (el) { el.textContent = err.message; el.style.display = ""; } }
    });
    document.getElementById("aptForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = document.getElementById("aptFormErr");
      const body = Object.fromEntries(new FormData(e.target).entries());
      body.reminderDays = Number(body.reminderDays || 0);
      if (!body.workorderId) delete body.workorderId;
      try {
        if (isEdit) await api("PATCH", `/appointments/${apt.id}`, body);
        else await api("POST", "/appointments", body);
        closeDrawer(); renderAppointments();
        window.showToast && window.showToast(isEdit ? tA("adm.apt.savedToast","Afspraak opgeslagen") : tA("adm.apt.createdToast","Afspraak aangemaakt"), "success");
      } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = ""; }
      }
    });
  }

  // ── Werkongevallen (register + aangifte-opvolging verzekeraar) ────────────
  let _incFilter = "alle";

  function tIncSeverity(s) {
    const map = { licht: "adm.inc.sevLight", werkverlet: "adm.inc.sevLostTime", ernstig: "adm.inc.sevSerious", dodelijk: "adm.inc.sevFatal" };
    return map[s] ? tA(map[s], s) : (s || "-");
  }
  function tIncStatus(s) {
    const map = { open: "adm.inc.stOpen", gemeld: "adm.inc.stReported", gesloten: "adm.inc.stClosed" };
    return map[s] ? tA(map[s], s) : (s || "-");
  }
  // Aangifte-deadline verzekeraar: 8 kalenderdagen na de dag van het ongeval.
  function incDeadline(i, today) {
    const d = new Date(`${i.date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 8);
    const deadline = d.toISOString().slice(0, 10);
    const daysLeft = Math.round((new Date(`${deadline}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
    return { deadline, daysLeft };
  }

  async function renderIncidents() {
    const content = document.getElementById("admContent");
    let rows = [];
    try { const d = await api("GET", "/incidents"); rows = d.incidents || []; }
    catch (e) { content.innerHTML = `<div style="padding:20px;color:var(--wf-red)">${tA("adm.error","Fout")}: ${e.message}</div>`; return; }

    const today = new Date().toISOString().slice(0, 10);
    const filtered = _incFilter === "open" ? rows.filter(i => i.status === "open")
      : _incFilter === "ernstig" ? rows.filter(i => ["ernstig", "dodelijk"].includes(i.severity))
      : rows;
    const sevCss = { licht: "adm-status-active", werkverlet: "adm-status-pending", ernstig: "adm-status-overdue", dodelijk: "adm-status-overdue" };
    const stCss = { open: "adm-status-open", gemeld: "adm-status-goedgekeurd", gesloten: "adm-status-voltooid" };
    const reportCell = i => {
      if (i.insurerReportedAt) return `<span style="color:var(--wf-green);font-weight:600;">✓ ${tA("adm.inc.reported","gemeld")} ${new Date(`${i.insurerReportedAt}T12:00:00`).toLocaleDateString("nl-BE")}</span>`;
      const { deadline, daysLeft } = incDeadline(i, today);
      const dl = new Date(`${deadline}T12:00:00`).toLocaleDateString("nl-BE");
      if (daysLeft < 0) return `<span style="color:var(--wf-red);font-weight:600;">${tA("adm.inc.overdue","Te laat")} · ${dl}</span>`;
      const urgent = daysLeft <= 2;
      return `<span style="${urgent ? "color:var(--wf-red);font-weight:600;" : ""}">${tA("adm.inc.dueBy","vóór")} ${dl} (${daysLeft}${tA("adm.leave.daysAbbr","d")})</span>`;
    };

    content.innerHTML = `
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">${tA("nav.incidents","Werkongevallen")} <span style="background:var(--wf-blue-l);color:var(--wf-blue);border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${filtered.length}</span></h3>
    <div style="display:flex;gap:8px;align-items:center;">
      <select id="admIncFilter">
        <option value="alle" ${_incFilter==="alle"?"selected":""}>${tA("mgr.all","Alle")}</option>
        <option value="open" ${_incFilter==="open"?"selected":""}>${tA("adm.inc.stOpen","Open")}</option>
        <option value="ernstig" ${_incFilter==="ernstig"?"selected":""}>${tA("adm.inc.sevSerious","Ernstig")}</option>
      </select>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admIncCsv">${tA("adm.inc.csvBtn","CSV verzekeraar")}</button>
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="admNewInc">+ ${tA("adm.inc.singular","Werkongeval")}</button>
    </div>
  </div>
  <div style="padding:8px 20px;font-size:12px;color:var(--gray-500);border-bottom:1px solid var(--gray-100);">${tA("adm.inc.deadlineHint","Aangifte bij de verzekeraar: binnen 8 kalenderdagen na het ongeval. Ernstig ongeval: omstandig verslag aan de inspectie binnen 10 dagen. Dodelijk ongeval: onmiddellijk melden.")}</div>
  ${filtered.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-text">${tA("adm.inc.empty","Geen werkongevallen geregistreerd")}</div><button class="adm-btn adm-btn-primary adm-btn-sm" id="admEmptyNewInc" style="margin-top:12px">+ ${tA("adm.inc.emptyBtn","Eerste werkongeval registreren")}</button></div>`
    : `<div class="adm-card-body adm-table-wrap">
    <table class="adm-table">
      <thead><tr><th>${tA("adm.date","Datum")}</th><th>${tA("adm.inc.thEmployee","Medewerker")}</th><th>${tA("adm.inc.thLocation","Locatie")}</th><th>${tA("adm.inc.thSeverity","Ernst")}</th><th>${tA("adm.inc.thReport","Aangifte verzekeraar")}</th><th>${tA("adm.status","Status")}</th><th>${tA("adm.actions","Acties")}</th></tr></thead>
      <tbody>
        ${filtered.map(i => `
        <tr class="adm-row-link adm-inc-row" data-id="${esc(i.id)}">
          <td style="font-weight:600;">${new Date(`${i.date}T12:00:00`).toLocaleDateString("nl-BE",{day:"numeric",month:"short",year:"numeric"})}${i.time ? `<div style="font-size:11px;color:var(--gray-400)">${esc(i.time)}</div>` : ""}</td>
          <td><strong>${esc(i.employeeName || "-")}</strong></td>
          <td>${esc(i.location || "-")}</td>
          <td><span class="adm-status ${sevCss[i.severity]||"adm-status-pending"}">${esc(tIncSeverity(i.severity))}</span></td>
          <td style="font-size:12px;">${reportCell(i)}</td>
          <td><span class="adm-status ${stCss[i.status]||"adm-status-open"}">${esc(tIncStatus(i.status))}</span></td>
          <td style="white-space:nowrap;"><button class="adm-btn adm-btn-secondary adm-btn-sm adm-inc-edit" data-id="${esc(i.id)}">${tA("adm.edit","Bewerken")}</button></td>
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`}
</div>`;

    document.getElementById("admIncFilter")?.addEventListener("change", e => { _incFilter = e.target.value; renderIncidents(); });
    document.getElementById("admNewInc")?.addEventListener("click", () => openIncidentDrawer(null));
    document.getElementById("admEmptyNewInc")?.addEventListener("click", () => openIncidentDrawer(null));
    document.getElementById("admIncCsv")?.addEventListener("click", async () => {
      try {
        const r = await fetch(`/api/tenants/${tenantId()}/incidents?format=csv`, { headers: { Authorization: "Bearer " + token() } });
        if (!r.ok) throw new Error(tA("adm.inc.exportErr","Export mislukt"));
        const blob = await r.blob(); const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = `werkongevallen-${today}.csv`;
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
      } catch (e) { window.showToast && window.showToast(e.message, "error"); }
    });
    content.querySelectorAll(".adm-inc-edit").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); openIncidentDrawer(rows.find(x => x.id === b.dataset.id)); }));
    content.querySelectorAll(".adm-inc-row").forEach(row => row.addEventListener("click", e => {
      if (e.target.closest("button")) return;
      openIncidentDrawer(rows.find(x => x.id === row.dataset.id));
    }));
  }

  async function openIncidentDrawer(inc) {
    const [empData, venData] = await Promise.all([
      api("GET", "/employees").catch(() => ({ employees: [] })),
      api("GET", "/venues").catch(() => ({ venues: [] })),
    ]);
    const employees = (empData.employees || []).filter(u => u.active !== false);
    const venues = venData.venues || [];
    const today = new Date().toISOString().slice(0, 10);
    const isEdit = !!inc;
    document.getElementById("admDrawerTitle").textContent = isEdit ? tA("adm.inc.editTitle","Werkongeval bewerken") : tA("adm.inc.newTitle","Werkongeval registreren");
    document.getElementById("admDrawerBody").innerHTML = `
<form id="incForm">
  <div class="adm-form-group"><label>${tA("adm.inc.thEmployee","Medewerker")}</label>
    <select name="employeeId" id="incEmpSel" style="width:100%">
      <option value="">${tA("adm.quote.manualFill","- Handmatig invullen -")}</option>
      ${employees.map(u => `<option value="${esc(u.id)}" ${inc?.employeeId === u.id ? "selected" : ""} data-name="${esc(u.name||"")}">${esc(u.name || u.email)}</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-group"><label>${tA("adm.inc.empName","Naam medewerker")} *</label>
    <input name="employeeName" id="incEmpName" value="${esc(inc?.employeeName || "")}" required></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${tA("adm.inc.dateLabel","Datum ongeval")} *</label>
      <input name="date" type="date" value="${esc(inc?.date || today)}" max="${today}" required></div>
    <div class="adm-form-group"><label>${tA("adm.apt.thTime","Tijd")}</label>
      <input name="time" type="time" value="${esc(inc?.time || "")}"></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${(window.wfpTerms && window.wfpTerms.t("venue")) || tA("adm.inc.thLocation","Locatie")}</label>
      <select name="venueId" id="incVenueSel" style="width:100%">
        <option value="">-</option>
        ${venues.map(v => `<option value="${esc(v.id)}" ${inc?.venueId === v.id ? "selected" : ""} data-name="${esc(v.name||"")}">${esc(v.name)}</option>`).join("")}
      </select>
    </div>
    <div class="adm-form-group"><label>${tA("adm.inc.locLabel","Locatie (vrije tekst)")}</label>
      <input name="location" id="incLocation" value="${esc(inc?.location || "")}"></div>
  </div>
  <div class="adm-form-group"><label>${tA("adm.inc.thSeverity","Ernst")} *</label>
    <select name="severity" id="incSeverity" required>
      <option value="licht" ${(inc?.severity ?? "licht") === "licht" ? "selected" : ""}>${tA("adm.inc.sevLight","Licht (EHBO, geen werkverlet)")}</option>
      <option value="werkverlet" ${inc?.severity === "werkverlet" ? "selected" : ""}>${tA("adm.inc.sevLostTime","Met werkverlet")}</option>
      <option value="ernstig" ${inc?.severity === "ernstig" ? "selected" : ""}>${tA("adm.inc.sevSerious","Ernstig")}</option>
      <option value="dodelijk" ${inc?.severity === "dodelijk" ? "selected" : ""}>${tA("adm.inc.sevFatal","Dodelijk")}</option>
    </select>
  </div>
  <div id="incSevWarn" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:8px;font-size:12px;margin-bottom:10px;"></div>
  <div class="adm-form-group"><label>${tA("adm.inc.descLabel","Omschrijving van het ongeval")} *</label>
    <textarea name="description" rows="3" style="width:100%" required>${esc(inc?.description || "")}</textarea>
  </div>
  <div class="adm-form-group"><label>${tA("adm.inc.witLabel","Getuigen (namen)")}</label>
    <input name="witnesses" value="${esc(inc?.witnesses || "")}"></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${tA("adm.inc.reportedLabel","Aangifte verzekeraar op")}</label>
      <input name="insurerReportedAt" type="date" value="${esc(inc?.insurerReportedAt || "")}"></div>
    ${isEdit ? `<div class="adm-form-group"><label>${tA("adm.status","Status")}</label>
      <select name="status">
        <option value="open" ${inc.status === "open" ? "selected" : ""}>${tA("adm.inc.stOpen","Open")}</option>
        <option value="gemeld" ${inc.status === "gemeld" ? "selected" : ""}>${tA("adm.inc.stReported","Gemeld")}</option>
        <option value="gesloten" ${inc.status === "gesloten" ? "selected" : ""}>${tA("adm.inc.stClosed","Gesloten")}</option>
      </select>
    </div>` : ""}
  </div>
  <div id="incFormErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions" style="${isEdit ? "justify-content:space-between;" : ""}">
    ${isEdit ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="incDelete">${tA("adm.delete","Verwijderen")}</button>` : ""}
    <div style="display:flex;gap:8px;">
      <button type="button" class="adm-btn adm-btn-secondary" id="incCancel">${tA("adm.cancel","Annuleren")}</button>
      <button type="submit" class="adm-btn adm-btn-primary">${isEdit ? tA("adm.save","Opslaan") : tA("adm.createBtn","Aanmaken")}</button>
    </div>
  </div>
</form>`;
    openDrawer();
    document.getElementById("incCancel").addEventListener("click", closeDrawer);
    document.getElementById("incEmpSel")?.addEventListener("change", e => {
      const opt = e.target.selectedOptions[0];
      if (!opt || !opt.value) return;
      document.getElementById("incEmpName").value = opt.dataset.name || "";
    });
    document.getElementById("incVenueSel")?.addEventListener("change", e => {
      const opt = e.target.selectedOptions[0];
      const loc = document.getElementById("incLocation");
      if (opt && opt.value && !loc.value) loc.value = opt.dataset.name || "";
    });
    const sevWarn = () => {
      const v = document.getElementById("incSeverity").value;
      const el = document.getElementById("incSevWarn");
      if (v === "dodelijk") { el.textContent = tA("adm.inc.fatalWarn","Dodelijk ongeval: verwittig de inspectie (Toezicht Welzijn op het Werk) onmiddellijk en bezorg binnen 10 dagen een omstandig verslag."); el.style.display = ""; }
      else if (v === "ernstig") { el.textContent = tA("adm.inc.seriousWarn","Ernstig arbeidsongeval: bezorg de inspectie (Toezicht Welzijn op het Werk) binnen 10 dagen een omstandig verslag."); el.style.display = ""; }
      else el.style.display = "none";
    };
    document.getElementById("incSeverity").addEventListener("change", sevWarn);
    sevWarn();
    document.getElementById("incDelete")?.addEventListener("click", async () => {
      if (!await uiConfirm(tA("adm.inc.deleteConfirm","Werkongeval van {d} verwijderen?").replace("{d}", inc.date), { title: "Registratie verwijderen", danger: true, confirmLabel: tA("adm.delete","Verwijderen") })) return;
      try { await api("DELETE", `/incidents/${inc.id}`); closeDrawer(); renderIncidents(); }
      catch (err) { const el = document.getElementById("incFormErr"); if (el) { el.textContent = err.message; el.style.display = ""; } }
    });
    document.getElementById("incForm").addEventListener("submit", async e => {
      e.preventDefault();
      const errEl = document.getElementById("incFormErr");
      const body = Object.fromEntries(new FormData(e.target).entries());
      if (!body.employeeId) delete body.employeeId;
      if (!body.venueId) delete body.venueId;
      try {
        if (isEdit) await api("PATCH", `/incidents/${inc.id}`, body);
        else await api("POST", "/incidents", body);
        closeDrawer(); renderIncidents();
        window.showToast && window.showToast(isEdit ? tA("adm.inc.savedToast","Werkongeval opgeslagen") : tA("adm.inc.createdToast","Werkongeval geregistreerd"), "success");
      } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = ""; }
      }
    });
  }

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

  async function renderClocking() {
    const content = document.getElementById("admContent");

    // Always reset to today if view freshly entered
    if (!content.querySelector("#admClockDate")) {
      content.innerHTML = `
<div class="adm-card" style="margin-bottom:14px">
  <div class="adm-card-header">
    <h3 class="adm-card-title">${tA("adm.clk.title","Prikklok overzicht")}</h3>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="date" id="admClockDate" value="${_clockDate}">
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admClockPrev">‹</button>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admClockToday">${tA("adm.today","Vandaag")}</button>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admClockNext">›</button>
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="admClockAdd">+ ${tA("adm.clk.correction","Correctie")}</button>
    </div>
  </div>
</div>
<div class="adm-card">
  <div class="adm-card-body adm-table-wrap" id="admClockTable"><div class="adm-loading">${tA("emp.common.loading","Laden…")}</div></div>
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

      const totalHours = clocks.reduce((sum, c) => sum + timeA.clockHours(c), 0);
      const ingeklokt = clocks.filter(c => c.status === "in" || timeA.isActive(c)).length;

      tableEl.innerHTML = `
<div style="display:flex;gap:12px;padding:12px 16px 0;flex-wrap:wrap;">
  <div style="background:var(--wf-blue-l);border-radius:8px;padding:8px 14px;text-align:center">
    <div style="font-size:18px;font-weight:600;color:var(--wf-blue)">${clocks.length}</div>
    <div style="font-size:11px;color:var(--gray-500)">Registraties</div>
  </div>
  <div style="background:${ingeklokt>0?"var(--wf-green-l)":"var(--gray-50)"};border-radius:8px;padding:8px 14px;text-align:center">
    <div style="font-size:18px;font-weight:600;color:${ingeklokt>0?"var(--wf-green)":"var(--gray-400)"}">${ingeklokt}</div>
    <div style="font-size:11px;color:var(--gray-500)">Nog ingeklokt</div>
  </div>
  <div style="background:var(--wf-green-l);border-radius:8px;padding:8px 14px;text-align:center">
    <div style="font-size:18px;font-weight:600;color:var(--wf-green)">${totalHours.toFixed(1)} u</div>
    <div style="font-size:11px;color:var(--gray-500)">${tA("adm.clk.totalHours","Totaal uren")}</div>
  </div>
</div>
<table class="adm-table" style="margin-top:10px">
  <thead><tr><th>${tA("adm.thEmployee","Medewerker")}</th><th>${tA("adm.clk.thIn","Inkloktijd")}</th><th>${tA("adm.clk.thOut","Uitkloktijd")}</th><th>${tA("adm.clk.thHours","Uren")}</th><th>${tA("adm.status","Status")}</th><th>${tA("adm.actions","Actie")}</th></tr></thead>
  <tbody>
    ${clocks.map(c => {
      const noOut = timeA.isActive(c);
      const hours = noOut ? "-" : timeA.clockHours(c).toFixed(1);
      return `<tr class="${noOut ? "" : "adm-row-link clk-row"}" data-id="${esc(c.id)}" ${noOut ? "" : 'title="Open correctie"'}>
        <td style="font-weight:500">${esc(uName(c))}</td>
        <td>${timeA.clockTime(c, "in") || "-"}</td>
        <td>${timeA.clockTime(c, "out") || `<span style="color:var(--wf-yellow)">${tA("adm.clk.notOut","Niet uitgeklokt")}</span>`}</td>
        <td>${hours}</td>
        <td>${c.status==="in"||noOut ? `<span class="adm-status adm-status-active">${tA("dash.stClockedIn","Ingeklokt")}</span>` : `<span class="adm-status adm-status-inactive">${tA("adm.clk.clockedOut","Uitgeklokt")}</span>`}</td>
        <td>${noOut ? `<button class="adm-btn adm-btn-warning adm-btn-sm clk-force-out" data-id="${esc(c.id)}" data-uid="${esc(c.userId)}">${tA("adm.clk.forceOut","Klokt uit")}</button>` : `<button class="adm-btn adm-btn-secondary adm-btn-sm clk-edit" data-id="${esc(c.id)}">${tA("adm.clk.correct","Corrigeer")}</button>`}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="6" class="adm-empty">${tA("adm.clk.none","Geen klokregistraties voor deze datum")}</td></tr>`}
  </tbody>
</table>`;

      // Wire force-out buttons
      document.querySelectorAll(".clk-force-out").forEach(btn => {
        btn.addEventListener("click", async () => {
          btn.disabled = true;
          try { await api("PATCH", `/clocks/${btn.dataset.id}`, { clockOut: new Date().toTimeString().slice(0, 5), note: "Uitgeklokt door beheerder" }); loadClockData(); }
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
      tableEl.innerHTML = `<div class="adm-empty" style="color:var(--wf-red)">Fout: ${e.message}</div>`;
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
      <option value="">- Kies medewerker -</option>
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
        const body = {
          userId,
          date,
          clockIn: clockInTime,
          clockOut: clockOutTime || undefined,
          note: fd.get("note") || "Handmatige registratie"
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
    const inTime = timeA.clockTime(clk, "in");
    const outTime = timeA.clockTime(clk, "out");
    document.getElementById("admDrawerTitle").textContent = `Klok corrigeren · ${esc(uName(clk))}`;
    document.getElementById("admDrawerBody").innerHTML = `
<form id="clkEditForm">
  <div class="adm-form-group"><label>Medewerker</label>
    <input value="${esc(uName(clk))}" disabled style="background:var(--gray-50)">
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
  <div id="clkEditErr" style="display:none;color:var(--wf-red);font-size:12px;padding:6px 0;margin-bottom:4px;"></div>
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
        clockIn: clockInTime,
        clockOut: clockOutTime ? clockOutTime : null,
        note: fd.get("note") || ""
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
    <h3 class="adm-card-title">${tA("nav.leaves","Verlof")}</h3>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
      <button class="adm-btn adm-btn-sm ${_leaveTab==="aanvragen"?"adm-btn-primary":"adm-btn-secondary"}" id="admLeaveTabReq">${tA("adm.leave.tabRequests","Aanvragen")}</button>
      <button class="adm-btn adm-btn-sm ${_leaveTab==="kalender"?"adm-btn-primary":"adm-btn-secondary"}" id="admLeaveTabCal">${tA("adm.leave.tabCalendar","Kalender")}</button>
      <button class="adm-btn adm-btn-sm ${_leaveTab==="saldi"?"adm-btn-primary":"adm-btn-secondary"}" id="admLeaveTabBal">${tA("adm.leave.tabBalances","Saldi")}</button>
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="admLeaveNew" style="margin-left:8px;">${tA("adm.leave.new","+ Verlof aanmaken")}</button>
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
    document.getElementById("admDrawerTitle").textContent = tA("adm.leave.newTitle","Verlof aanmaken");
    document.getElementById("admDrawerBody").innerHTML = `
<form id="createLeaveForm">
  <div class="adm-form-group">
    <label>${tA("adm.leave.employee","Medewerker")} *</label>
    <select name="userId" required>
      <option value="">${tA("adm.leave.pickEmployee","- Kies medewerker -")}</option>
      ${employees.map(u => `<option value="${esc(u.id)}" ${preselectedUserId===u.id?"selected":""}>${esc(u.name||u.email)}</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-group">
    <label>${tA("adm.leave.typeLabel","Type verlof")}</label>
    <select name="type">
      <option value="vakantie">${tA("adm.ltype.vakantie","Vakantie")}</option>
      <option value="ziekte">${tA("adm.ltype.ziekte","Ziekte")}</option>
      <option value="adv">${tA("adm.ltype.adv","ADV")}</option>
      <option value="bijzonder">${tA("adm.ltype.bijzonder","Bijzonder verlof")}</option>
      <option value="onbetaald">${tA("adm.ltype.onbetaald","Onbetaald verlof")}</option>
    </select>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group">
      <label>${tA("adm.leave.from","Van")} *</label>
      <input name="startDate" type="date" value="${today}" required>
    </div>
    <div class="adm-form-group">
      <label>${tA("adm.leave.to","Tot")} *</label>
      <input name="endDate" type="date" value="${today}" required>
    </div>
  </div>
  <div class="adm-form-group">
    <label>${tA("adm.status","Status")}</label>
    <select name="status">
      <option value="goedgekeurd">${tA("adm.lstatus.approved","Goedgekeurd")}</option>
      <option value="aangevraagd">${tA("adm.lstatus.requested","Aangevraagd")}</option>
    </select>
  </div>
  <div class="adm-form-group">
    <label>${tA("adm.leave.reasonLabel","Reden / notitie")}</label>
    <textarea name="reason" rows="2" style="width:100%" placeholder="${tA("adm.leave.optNote","Optionele opmerking")}"></textarea>
  </div>
  <div id="createLeaveErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="createLeaveCancel">${tA("adm.cancel","Annuleren")}</button>
    <button type="submit" class="adm-btn adm-btn-primary">${tA("adm.leave.create","Aanmaken")}</button>
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
        window.showToast && window.showToast(tA("adm.leave.created","Verlof aangemaakt"), "success");
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
    body.innerHTML = `<div style="padding:24px;text-align:center;color:var(--gray-400);font-size:13px;">${tA("adm.loading","Laden…")}</div>`;

    if (_leaveTab === "aanvragen") {
      const data = await api("GET", "/leaves");
      const leaves = data.leaves || data || [];
      body.innerHTML = `
<div style="padding:12px 16px;border-bottom:1px solid var(--gray-100);display:flex;gap:8px;align-items:center;">
  <select id="admLeaveFilter">
    <option value="">${tA("adm.allStatuses","Alle statussen")}</option>
    <option value="aangevraagd">${tA("adm.lstatus.requested","Aangevraagd")}</option>
    <option value="goedgekeurd">${tA("adm.lstatus.approved","Goedgekeurd")}</option>
    <option value="geweigerd">${tA("adm.lstatus.rejected","Geweigerd")}</option>
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
    const MONTHS = monthNames();

    let calData;
    try {
      calData = await api("GET", `/leaves/calendar?year=${_leaveCalYear}&month=${_leaveCalMonth}`);
    } catch(e) {
      container.innerHTML = `<div style="padding:24px;color:var(--wf-red);">${esc(e.message)}</div>`;
      return;
    }
    const { days = {}, leaves = [] } = calData;

    // Build userId→name map · fetch employees if not yet loaded
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
      cells += `<div style="min-height:52px;border-radius:8px;padding:4px 6px;background:${isToday?"var(--wf-blue-l)":isWeekend?"var(--gray-50)":"#fff"};border:1px solid ${isToday?"var(--wf-blue-l)":"var(--gray-200)"};">
        <div style="font-size:11px;font-weight:${isToday?"700":"500"};color:${isWeekend?"var(--gray-400)":isToday?"var(--wf-blue)":"var(--gray-700)"};margin-bottom:2px;">${d}</div>
        ${userIds.slice(0,3).map(uid => { const nm = empMap[uid] || empNameById(uid) || tA("adm.unknown","Onbekend"); return `<div style="font-size:10px;background:var(--wf-blue-l);color:var(--wf-blue);border-radius:4px;padding:1px 4px;margin-bottom:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(nm)}">${esc(nm.split(" ")[0])}</div>`; }).join("")}
        ${userIds.length > 3 ? `<div style="font-size:10px;color:var(--gray-500);">+${userIds.length-3}</div>` : ""}
      </div>`;
    }

    container.innerHTML = `
<div style="padding:16px;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admCalPrev">‹</button>
    <span style="font-size:15px;font-weight:600;min-width:160px;text-align:center;">${MONTHS[_leaveCalMonth]} ${_leaveCalYear}</span>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admCalNext">›</button>
    <span style="font-size:12px;color:var(--gray-500);margin-left:8px;">${leaves.length} ${tA("adm.leave.approvedCount","goedgekeurde verloven")}</span>
  </div>
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px;">
    ${weekdayShort().map(d=>`<div style="text-align:center;font-size:11px;font-weight:600;color:var(--gray-500);padding:4px 0;">${d}</div>`).join("")}
  </div>
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">${cells}</div>
  ${leaves.length ? `
  <div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--gray-100);">
    <div class="adm-form-section">${tA("adm.leave.thisMonth","Verloven deze maand")}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
    ${leaves.map(l=>`<div style="font-size:12px;background:var(--wf-green-l);border:1px solid var(--wf-green-l);border-radius:6px;padding:4px 8px;color:var(--wf-green);">
      <strong>${esc(empMap[l.userId]||uName(l))}</strong> · ${esc(tLeaveType(l.type))} · ${l.startDate}→${l.endDate} (${l.days}${tA("adm.leave.daysAbbr","d")})
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
      container.innerHTML = `<div style="padding:24px;color:var(--wf-red);">${esc(e.message)}</div>`;
      return;
    }
    const balance = balData.balance || [];
    if (!balance.length) {
      container.innerHTML = `<div style="padding:24px;text-align:center;color:var(--gray-400);">${tA("adm.leave.noEmployees","Geen medewerkers gevonden.")}</div>`;
      return;
    }
    const dAbbr = tA("adm.leave.daysAbbr","d");

    container.innerHTML = `
<div style="padding:16px;">
  <div style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">${tA("adm.leave.balanceIntro","Vakantiesaldo {year} · op basis van goedgekeurde verlofaanvragen").replace("{year}", year)}</div>
  <table class="adm-table">
    <thead><tr><th>${tA("adm.thEmployee","Medewerker")}</th><th>${tA("adm.leave.thQuota","Quota")}</th><th>${tA("adm.leave.thUsed","Gebruikt")}</th><th>${tA("adm.leave.thRemaining","Resterend")}</th><th>${tA("adm.leave.thProgress","Voortgang")}</th></tr></thead>
    <tbody>${balance.map(b => {
      const pct = b.quota ? Math.min(100, Math.round((b.used / b.quota) * 100)) : 0;
      const color = pct >= 90 ? "var(--wf-red)" : pct >= 70 ? "var(--wf-yellow)" : "var(--wf-green)";
      return `<tr>
        <td><div style="font-weight:500;">${esc(b.name)}</div><div style="font-size:11px;color:var(--gray-400);">${esc(b.email)}</div></td>
        <td>${b.quota}${dAbbr}</td>
        <td>${b.used}${dAbbr}</td>
        <td style="font-weight:600;color:${b.remaining<=2?"var(--wf-red)":b.remaining<=5?"var(--wf-yellow)":"var(--wf-green)"};">${b.remaining}${dAbbr}</td>
        <td style="min-width:120px;">
          <div style="background:var(--gray-100);border-radius:20px;height:8px;overflow:hidden;">
            <div style="height:100%;width:${pct}%;background:${color};border-radius:20px;transition:width .3s;"></div>
          </div>
          <div style="font-size:10px;color:var(--gray-400);margin-top:2px;">${pct}%</div>
        </td>
      </tr>`;
    }).join("")}</tbody>
  </table>
</div>`;
  }

  function renderLeaveTable(leaves) {
    if (!leaves.length) return `<div class="adm-empty"><div class="adm-empty-text">${tA("adm.leave.noRequests","Geen verlofaanvragen")}</div></div>`;
    return `<table class="adm-table">
      <thead><tr><th>${tA("adm.thEmployee","Medewerker")}</th><th>${tA("adm.leave.thType","Type")}</th><th>${tA("adm.leave.from","Van")}</th><th>${tA("adm.leave.to","Tot")}</th><th>${tA("adm.leave.thReason","Reden")}</th><th>${tA("adm.status","Status")}</th><th>${tA("adm.leave.thNote","Opmerking")}</th><th>${tA("adm.actions","Acties")}</th></tr></thead>
      <tbody>${leaves.map(l => `
        <tr>
          <td>${esc(uName(l))}</td>
          <td>${esc(tLeaveType(l.type))}</td>
          <td>${esc(l.startDate||"")}</td>
          <td>${esc(l.endDate||"")}</td>
          <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(l.reason||"")}">${esc(l.reason||"-")}</td>
          <td><span class="adm-status adm-status-${l.status}">${esc(tLeaveStatus(l.status))}</span></td>
          <td style="font-size:12px;color:var(--gray-500);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(l.reviewNote||"")}">${esc(l.reviewNote||"-")}</td>
          <td style="white-space:nowrap;">${l.status==="aangevraagd" ? `
            <button class="adm-btn adm-btn-success adm-btn-sm adm-leave-action" data-id="${esc(l.id)}" data-status="goedgekeurd">${tA("adm.leave.approveShort","Goed")}</button>
            <button class="adm-btn adm-btn-danger adm-btn-sm adm-leave-action" data-id="${esc(l.id)}" data-status="geweigerd">${tA("adm.leave.reject","Weigeren")}</button>
          ` : "-"}</td>
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
    const label = isApprove ? tA("adm.leave.approveTitle","Verlof goedkeuren") : tA("adm.leave.rejectTitle","Verlof weigeren");
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;";
    overlay.innerHTML = `
<div style="background:#fff;border-radius:14px;width:420px;max-width:100%;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.2);">
  <h3 style="font-size:15px;font-weight:600;margin:0 0 6px;">${label}</h3>
  <p style="font-size:13px;color:var(--gray-500);margin:0 0 16px;">${esc(leave?.userName||leave?.userId||"")} · ${esc(tLeaveType(leave?.type||"verlof"))} · ${leave?.startDate||""}${leave?.endDate&&leave?.endDate!==leave?.startDate?" → "+leave?.endDate:""}</p>
  <label style="font-size:12px;font-weight:600;color:var(--gray-700);display:block;margin-bottom:4px;">${tA("adm.leave.noteOptional","Opmerking (optioneel)")}</label>
  <textarea id="admLeaveNote" rows="3" placeholder="${tA("adm.leave.notePh","Voeg een opmerking toe…")}"
    style="width:100%;resize:vertical;box-sizing:border-box"></textarea>
  <div id="admLeaveModalErr" style="display:none;color:var(--wf-red);font-size:12px;margin-top:6px;"></div>
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">
    <button id="admLeaveModalCancel" class="adm-btn adm-btn-secondary adm-btn-sm">${tA("adm.cancel","Annuleren")}</button>
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
    // Werkbonnen voor de koppel-kolom (doorrekenen aan klant via werkbon-factuur).
    const woData = await api("GET", "/workorders").catch(() => ({ workorders: [] }));
    const allWos = woData.workorders || [];
    const woById = Object.fromEntries(allWos.map(w => [w.id, w]));

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
    <div class="adm-kpi-label">${tA("adm.exp.fPending","In behandeling")}</div>
    <div class="adm-kpi-value">${pending.length}</div>
    <div class="adm-kpi-sub">${fmtE(totalPend)}</div>
  </div>
  <div class="adm-kpi adm-kpi-green">
    <div class="adm-kpi-label">${tA("emp.status.goedgekeurd","Goedgekeurd")}</div>
    <div class="adm-kpi-value">${approved.length}</div>
    <div class="adm-kpi-sub">${fmtE(totalAppr)}</div>
  </div>
  <div class="adm-kpi adm-kpi-red">
    <div class="adm-kpi-label">${tA("emp.status.geweigerd","Geweigerd")}</div>
    <div class="adm-kpi-value">${rejected.length}</div>
    <div class="adm-kpi-sub">${tA("adm.exp.claims","declaraties")}</div>
  </div>
  <div class="adm-kpi adm-kpi-blue">
    <div class="adm-kpi-label">${tA("adm.exp.totalSubmitted","Totaal ingediend")}</div>
    <div class="adm-kpi-value">${expenses.length}</div>
    <div class="adm-kpi-sub">${tA("adm.exp.allStatusesSub","alle statussen")}</div>
  </div>
</div>
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">${tA("adm.exp.title","Onkostennota's")} <span style="background:var(--wf-blue-l);color:var(--wf-blue);border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${expenses.length}</span></h3>
    <select id="admExpFilter">
      <option value="">${tA("adm.allStatuses","Alle statussen")}</option>
      <option value="ingediend">${tA("adm.exp.fPending","In behandeling")}</option>
      <option value="goedgekeurd">${tA("emp.status.goedgekeurd","Goedgekeurd")}</option>
      <option value="geweigerd">${tA("emp.status.geweigerd","Geweigerd")}</option>
    </select>
  </div>
  <div class="adm-card-body adm-table-wrap" id="admExpTable"></div>
</div>`;

    function buildExpRows(rows) {
      if (!rows.length) return `<div class="adm-empty">${tA("adm.exp.none","Geen onkosten gevonden")}</div>`;
      return `<table class="adm-table">
        <thead><tr><th>${tA("adm.thEmployee","Medewerker")}</th><th>${tA("adm.date","Datum")}</th><th>${tA("adm.thCategory","Categorie")}</th><th>${tA("adm.amount","Bedrag")}</th><th>${tA("adm.thDescription","Omschrijving")}</th><th>${tA("adm.thWorkorder","Werkbon")}</th><th>${tA("adm.status","Status")}</th><th>${tA("adm.actions","Acties")}</th></tr></thead>
        <tbody>${rows.map(e => {
          const wo = e.workorderId ? woById[e.workorderId] : null;
          const woCell = e.invoiceId
            ? `<span class="adm-status adm-status-paid" title="Doorgerekend op factuur">op factuur</span>`
            : wo
              ? `${esc(wo.number || wo.title || e.workorderId)}${e.billable === false ? ' <span style="font-size:10.5px;color:var(--gray-400);" title="Wordt niet doorgerekend aan de klant">niet doorrekenen</span>' : ""}`
              : "-";
          return `<tr>
          <td>${esc(uName(e))}</td>
          <td>${esc(e.date)}</td>
          <td>${esc(e.category||"-")}</td>
          <td style="font-weight:600;">€ ${Number(e.amount||0).toFixed(2)}</td>
          <td style="max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(e.description||"")}">${esc(e.description||"-")}</td>
          <td style="white-space:nowrap;font-size:12px;">${woCell}</td>
          <td>
            <span class="adm-status adm-status-${e.status}">${esc(e.status)}</span>
            ${e.reviewNote ? `<div style="font-size:11px;color:var(--gray-500);margin-top:2px;" title="${esc(e.reviewNote)}">${esc(e.reviewNote.slice(0,30))}${e.reviewNote.length>30?"…":""}</div>` : ""}
          </td>
          <td style="white-space:nowrap;">${["pending","ingediend"].includes(e.status) ? `
            <button class="adm-btn adm-btn-success adm-btn-sm adm-exp-review" data-id="${e.id}" data-dec="goedgekeurd" data-name="${esc(uName(e))}" data-amount="${e.amount}" data-cat="${esc(e.category||"")}">Goed</button>
            <button class="adm-btn adm-btn-danger  adm-btn-sm adm-exp-review" data-id="${e.id}" data-dec="geweigerd"  data-name="${esc(uName(e))}" data-amount="${e.amount}" data-cat="${esc(e.category||"")}">Weigeren</button>
          ` : ""}
          ${!e.invoiceId ? `<button class="adm-btn adm-btn-secondary adm-btn-sm adm-exp-link" data-id="${e.id}" style="margin-left:4px;">Werkbon</button>` : ""}</td>
        </tr>`;}).join("")}</tbody>
      </table>`;
    }

    // Werkbon koppelen/wijzigen + doorreken-vlag (billable) per onkost.
    function openExpenseLinkModal(expId, refresh) {
      const e = expenses.find(x => x.id === expId);
      if (!e) return;
      let modal = document.getElementById("admExpLinkModal");
      if (!modal) {
        modal = document.createElement("div");
        modal.id = "admExpLinkModal";
        modal.style.cssText = "position:fixed;inset:0;background:rgba(11,19,32,.42);z-index:600;display:flex;align-items:center;justify-content:center;padding:16px";
        document.body.appendChild(modal);
      }
      const openWos = allWos.filter(w => !w.invoiceId);
      modal.innerHTML = `
<div style="background:#fff;border-radius:14px;width:420px;max-width:100%;padding:24px;box-shadow:0 20px 60px rgba(11,19,32,.2)">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
    <h2 style="font-size:16px;font-weight:600;margin:0;color:var(--gray-900)">Onkost koppelen aan werkbon</h2>
    <button id="expLinkClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:var(--gray-400)">×</button>
  </div>
  <div style="font-size:13px;color:var(--gray-500);margin-bottom:14px;">€ ${Number(e.amount||0).toFixed(2)} · ${esc(e.description || e.category || "")}</div>
  <form id="expLinkForm" style="display:flex;flex-direction:column;gap:14px">
    <div>
      <label style="display:block;font-size:12px;font-weight:600;color:var(--gray-700);margin-bottom:4px">Werkbon</label>
      <select name="workorderId" style="width:100%;">
        <option value="">Geen (ontkoppelen)</option>
        ${openWos.map(w => `<option value="${esc(w.id)}" ${e.workorderId===w.id?"selected":""}>${esc(w.number ? w.number+" · " : "")}${esc(w.title||"Werkbon")}</option>`).join("")}
      </select>
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
      <input type="checkbox" name="billable" ${e.billable === false ? "" : "checked"}> Doorrekenen aan de klant op de werkbon-factuur
    </label>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button type="button" id="expLinkCancel" class="adm-btn adm-btn-secondary adm-btn-sm">Annuleren</button>
      <button type="submit" class="adm-btn adm-btn-primary adm-btn-sm">Opslaan</button>
    </div>
  </form>
</div>`;
      const close = () => modal.remove();
      document.getElementById("expLinkClose").addEventListener("click", close);
      document.getElementById("expLinkCancel").addEventListener("click", close);
      modal.addEventListener("click", ev => { if (ev.target === modal) close(); });
      document.getElementById("expLinkForm").addEventListener("submit", async ev => {
        ev.preventDefault();
        const fd = new FormData(ev.target);
        try {
          const patch = { workorderId: fd.get("workorderId") || null, billable: !!fd.get("billable") };
          await api("PATCH", `/expenses/${expId}`, patch);
          e.workorderId = patch.workorderId; e.billable = patch.billable;
          window.showToast && window.showToast(patch.workorderId ? "Onkost gekoppeld aan werkbon" : "Onkost ontkoppeld", "success");
          close(); refresh();
        } catch (err) { window.showToast && window.showToast(err.message, "error"); }
      });
    }

    function wireExpBtns() {
      const refreshTable = () => {
        const sel = document.getElementById("admExpFilter");
        const f = sel?.value || "";
        const rows = f ? expenses.filter(e => e.status === f || (f==="ingediend" && e.status==="pending")) : expenses;
        const tbl = document.getElementById("admExpTable"); if (tbl) { tbl.innerHTML = buildExpRows(rows); wireExpBtns(); }
      };
      content.querySelectorAll(".adm-exp-review").forEach(btn => {
        btn.addEventListener("click", () => openExpenseReviewModal(btn.dataset, refreshTable));
      });
      content.querySelectorAll(".adm-exp-link").forEach(btn => {
        btn.addEventListener("click", () => openExpenseLinkModal(btn.dataset.id, refreshTable));
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
  <div style="font-size:15px;font-weight:600;margin-bottom:4px;">${isApprove ? "Onkost goedkeuren" : "Onkost weigeren"}</div>
  <div style="font-size:13px;color:var(--gray-500);margin-bottom:16px;">${esc(name)} · ${esc(cat)} · <strong>€ ${Number(amount||0).toFixed(2)}</strong></div>
  <div style="margin-bottom:16px;">
    <label style="font-size:12px;font-weight:600;color:var(--gray-700);display:block;margin-bottom:4px;">Opmerking ${isApprove?"(optioneel)":"(verplicht bij weigering)"}</label>
    <textarea id="expReviewNote" rows="3" placeholder="${isApprove?"Goedgekeurd voor uitbetaling…":"Geef een reden op…"}"
      style="width:100%;resize:vertical;box-sizing:border-box"></textarea>
  </div>
  <div id="expReviewErr" style="display:none;color:var(--wf-red);font-size:12px;margin-bottom:8px;"></div>
  <div style="display:flex;gap:8px;justify-content:flex-end;">
    <button id="expReviewCancel" class="adm-btn adm-btn-secondary adm-btn-sm">Annuleren</button>
    <button id="expReviewConfirm" class="adm-btn ${isApprove?"adm-btn-success":"adm-btn-danger"} adm-btn-sm">${isApprove?"Goedkeuren":"Weigeren"}</button>
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
        window.showToast && window.showToast(isApprove ? "Onkost goedgekeurd" : "Onkost geweigerd", isApprove ? "success" : "info");
        onDone();
      } catch(e) {
        errEl.textContent = e.message; errEl.style.display = "";
        confirmBtn.disabled = false; confirmBtn.textContent = isApprove ? "Goedkeuren" : "Weigeren";
      }
    });
  }

  // ── Workorders ─────────────────────────────────────────────
  let _woFilterStatus = "";
  let _woFilterUser   = "";
  let _woFilterSearch = "";

  // Toont de "→ Factuur"-knop enkel als er iets factureerbaars is (uren of vast
  // bedrag) en de werkbon nog niet gefactureerd is. De server valideert het tarief.
  function woBillable(w) {
    if (w.invoiceId) return false;
    const fixed = w.billableAmount ?? w.fixedPrice;
    if (fixed != null && Number(fixed) > 0) return true;
    if (Number(w.billableHours ?? w.clockedHours ?? w.hours ?? 0) > 0) return true;
    return Array.isArray(w.materials) && w.materials.some(m => Number(m.qty) > 0 && Number(m.unitPrice) > 0);
  }

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
    <h3 class="adm-card-title">${(window.wfpTerms && window.wfpTerms.t("jobPlural")) || tA("nav.workorders","Werkbonnen")}
      <span style="background:var(--wf-blue-l);color:var(--wf-blue);border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${workorders.length}/${allWorkorders.length}</span>
    </h3>
    <button class="adm-btn adm-btn-primary adm-btn-sm" id="admNewWO">+ ${(window.wfpTerms && window.wfpTerms.t("jobSingular")) || tA("emp.wo.default","Werkbon")}</button>
  </div>

  <!-- Filter bar -->
  <div style="display:flex;gap:10px;flex-wrap:wrap;padding:0 20px 14px;border-bottom:1px solid var(--gray-100);">
    <input id="admWoSearch" type="search" placeholder="${tA("adm.wo.searchPh","Zoek op titel / klant…")}" value="${esc(_woFilterSearch)}"
      style="flex:1;min-width:160px;10px">
    <select id="admWoStatusFilter" style="min-width:140px">
      <option value="">${tA("adm.allStatuses","Alle statussen")}</option>
      <option value="open"        ${_woFilterStatus==="open"?"selected":""}>${tA("dash.woseg.open","Open")} (${statusCounts.open||0})</option>
      <option value="in_progress" ${_woFilterStatus==="in_progress"?"selected":""}>${tA("dash.woseg.inprog","In uitvoering")} (${statusCounts.in_progress||0})</option>
      <option value="done"        ${_woFilterStatus==="done"?"selected":""}>${tA("dash.woseg.done","Voltooid")} (${doneCount})</option>
      <option value="geannuleerd" ${_woFilterStatus==="geannuleerd"?"selected":""}>${tA("dash.woseg.cancelled","Geannuleerd")} (${statusCounts.geannuleerd||0})</option>
    </select>
    <select id="admWoUserFilter" style="min-width:160px">
      <option value="">${tA("adm.wo.allEmployees","Alle medewerkers")}</option>
      ${employees.map(u => `<option value="${esc(u.id)}" ${_woFilterUser===u.id?"selected":""}>${esc(u.name||u.email)}</option>`).join("")}
    </select>
    ${(_woFilterStatus||_woFilterUser||_woFilterSearch) ? `<button class="adm-btn adm-btn-secondary adm-btn-sm" id="admWoClearFilter" style="white-space:nowrap;">${tA("adm.wo.clearFilters","Wis filters")}</button>` : ""}
  </div>

  <div class="adm-card-body adm-table-wrap">
    <table class="adm-table">
      <thead><tr><th>#</th><th>${tA("adm.thTitle","Titel")}</th><th>${tA("adm.thEmployee","Medewerker")}</th><th>${tA("adm.thCustomer","Klant")}</th><th>${tA("adm.status","Status")}</th><th>${tA("adm.thPriority","Prioriteit")}</th><th>${tA("adm.date","Datum")}</th><th>${tA("adm.actions","Acties")}</th></tr></thead>
      <tbody>
        ${workorders.map(w => `
        <tr class="adm-row-link adm-wo-row" data-id="${w.id}" title="Open werkbon">
          <td style="font-family:monospace;font-size:12px;">${w.number || w.id.slice(-4)}</td>
          <td>${esc(w.title || "-")}</td>
          <td>${esc(uName(w) || "-")}</td>
          <td>${esc(w.clientName || "-")}</td>
          <td><span class="adm-status adm-status-${(w.status||"").toLowerCase().replace(/\s/g,"-")}">${esc(tWoStatus(w.status))}</span></td>
          <td><span style="font-size:12px;">${w.priority==="hoog"?'<span class="adm-dot" style="background:var(--wf-red)"></span>':w.priority==="laag"?'<span class="adm-dot" style="background:var(--wf-green)"></span>':'<span class="adm-dot" style="background:var(--wf-yellow)"></span>'} ${esc(tWoPrio(w.priority))}</span></td>
          <td>${w.scheduledDate || w.createdAt?.slice(0,10) || "-"}</td>
          <td style="white-space:nowrap;">
            ${w.invoiceId
              ? `<span style="font-size:11px;color:var(--wf-green);font-weight:600;">✓ ${tA("adm.wo.invoiced","gefactureerd")}</span>`
              : (woBillable(w) ? `<button class="adm-btn adm-btn-success adm-btn-sm adm-wo-invoice" data-id="${w.id}" title="Maak factuur van deze werkbon">→ ${tA("adm.wo.toInvoice","Factuur")}</button>` : "")}
            <button class="adm-btn adm-btn-secondary adm-btn-sm adm-wo-edit" data-id="${w.id}">${tA("adm.edit","Bewerken")}</button>
          </td>
        </tr>`).join("") || `<tr><td colspan="8" class="adm-empty">${_woFilterStatus||_woFilterUser||_woFilterSearch ? tA("adm.wo.noResults","Geen resultaten voor deze filters") : `${tA("adm.wo.emptyTitle","Nog geen werkbonnen.")}<br><button class="adm-btn adm-btn-primary adm-btn-sm" id="admEmptyNewWO" style="margin-top:10px">+ ${tA("adm.wo.emptyBtn","Eerste werkbon aanmaken")}</button>`}</td></tr>`}
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
    document.querySelectorAll(".adm-wo-invoice").forEach(btn => {
      btn.addEventListener("click", async e => {
        e.stopPropagation();
        if (!await uiConfirm("De geklokte of factureerbare uren, of het vaste bedrag, worden overgenomen in een nieuwe klantfactuur.", { title: "Factuur maken van deze werkbon", confirmLabel: "Factuur aanmaken" })) return;
        try {
          const d = await api("POST", `/workorders/${btn.dataset.id}/invoice`, {});
          window.showToast && window.showToast(`Factuur ${d.invoice?.number || ""} aangemaakt`, "success");
          switchView("facturen");
        } catch (err) {
          window.showToast && window.showToast(err.message || "Factureren mislukt", "error");
        }
      });
    });
    document.querySelectorAll(".adm-wo-row").forEach(row => {
      row.addEventListener("click", () => openWorkorderDrawer(allWorkorders.find(w => w.id === row.dataset.id), allWorkorders));
    });
  }

  // ── Werkbon drawer ─────────────────────────────────────────
  function openWorkorderDrawer(workorder, _preloadedWOs, prefill = {}) {
    Promise.all([
      api("GET", "/employees"),
      api("GET", "/customers").catch(() => ({ customers: [] })),
      api("GET", "/venues").catch(() => ({ venues: [] }))
    ]).then(([empData, custData, venueData]) => {
      const employees = empData.employees || [];
      const customers = custData.customers || [];
      const venues = venueData.venues || venueData.rows || [];
      const selectedVenueId = workorder?.venueId || prefill.venueId || "";
      const selectedVenue = venues.find(venue => venue.id === selectedVenueId);
      const initialLocation = workorder?.location || prefill.location || selectedVenue?.address || selectedVenue?.name || "";
      document.getElementById("admDrawerTitle").textContent = workorder ? "Werkbon bewerken" : "Nieuwe werkbon";
      document.getElementById("admDrawerBody").innerHTML = `
<form id="woForm">
  <div class="adm-form-group"><label>Titel *</label>
    <input name="title" value="${esc(workorder?.title || prefill.title || "")}" required placeholder="Omschrijving van de opdracht">
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Medewerker</label>
      <select name="userId">
        <option value="">- Niet toegewezen -</option>
        ${employees.map(u => `<option value="${esc(u.id)}" ${(workorder?.userId || prefill.userId) === u.id ? "selected" : ""}>${esc(u.name || u.email)}</option>`).join("")}
      </select>
    </div>
    <div class="adm-form-group"><label>Klant</label>
      <select name="customerId" id="woCustSel">
        <option value="">- Kies klant of typ vrij -</option>
        ${customers.map(c => `<option value="${c.id}" ${(workorder?.customerId||prefill.customerId)===c.id?"selected":""}>${esc(c.name)}</option>`).join("")}
      </select>
    </div>
  </div>
  <div class="adm-form-group" id="woClientNameWrap">
    <label>Klantnaam</label>
    <input name="clientName" id="woClientName" value="${esc(workorder?.clientName || prefill.clientName || "")}" placeholder="Of typ een klantnaam vrij">
  </div>
  <div class="adm-form-row wo-location-row">
    <div class="adm-form-group"><label>Werf / locatie</label>
      <select name="venueId" id="woVenueSel">
        <option value="">Geen vaste werf</option>
        ${venues.map(venue => `<option value="${venue.id}" ${selectedVenueId === venue.id ? "selected" : ""}>${esc(venue.name || venue.address || "Locatie")}</option>`).join("")}
      </select>
      <div class="adm-form-hint">Koppelt deze werkbon logisch aan planning, voorraad en werfcommunicatie.</div>
    </div>
    <div class="adm-form-group"><label>Uitvoeringsadres / verzamelpunt</label>
      <input name="location" id="woLocation" value="${esc(initialLocation)}" placeholder="Adres of praktische locatie">
    </div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>Gepland op</label>
      <input name="scheduledDate" type="date" value="${esc(workorder?.scheduledDate || prefill.scheduledDate || "")}">
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
    <textarea name="description" rows="3" style="width:100%">${esc(workorder?.description || "")}</textarea>
  </div>
  <div class="adm-form-group"><label>Notities</label>
    <textarea name="notes" rows="2" style="width:100%">${esc(workorder?.notes || "")}</textarea>
  </div>
  <div style="background:var(--gray-50);border-radius:8px;padding:12px;margin-bottom:8px;">
    <div style="font-weight:600;font-size:12px;color:var(--gray-700);margin-bottom:8px;">Facturatie</div>
    ${workorder?.clockedHours ? `<div style="font-size:12px;color:var(--wf-blue);margin-bottom:8px;">⏱ ${workorder.clockedHours} u geklokt op deze werkbon${workorder?.billableHours==null?" · wordt overgenomen als factureerbare uren bij afronden":""}.</div>` : ""}
    <div class="adm-form-row">
      <div class="adm-form-group"><label>Factureerbare uren</label>
        <input name="billableHours" type="number" step="0.25" min="0" value="${workorder?.billableHours ?? ""}" placeholder="${workorder?.clockedHours ? workorder.clockedHours+" geklokt" : "bv. 8"}">
      </div>
      <div class="adm-form-group"><label>Uurtarief (€)</label>
        <input name="hourlyRate" type="number" step="1" min="0" value="${workorder?.hourlyRate ?? ""}" placeholder="standaardtarief">
      </div>
    </div>
    <div class="adm-form-group"><label>Vaste prijs (€) · overschrijft uren×tarief</label>
      <input name="fixedPrice" type="number" step="0.01" min="0" value="${workorder?.fixedPrice ?? ""}" placeholder="leeg = op uren factureren">
    </div>
    <div class="adm-form-group" style="margin-top:4px;">
      <label style="display:flex;justify-content:space-between;align-items:center;">
        <span>Materiaal / extra factuurlijnen</span>
        <button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" id="woAddMat">+ Toevoegen</button>
      </label>
      <div id="woMaterials" style="display:flex;flex-direction:column;gap:6px;"></div>
      <div style="font-size:11px;color:var(--gray-400);margin-top:4px;">Verbruikt materiaal komt als aparte lijnen op de factuur, naast de uren.</div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
      <input type="checkbox" name="billable" ${workorder?.billable === false ? "" : "checked"} style="width:16px;height:16px;"> Factureerbaar
    </label>
  </div>
  ${workorder?.invoiceId ? `<div style="background:var(--wf-green-l);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--wf-green);margin-bottom:8px;">Factuur aangemaakt</div>` : ""}
  ${!workorder ? `<label class="adm-next-step-option"><input type="checkbox" id="woPlanAfterSave" ${prefill.planAfterSave ? "checked" : ""}><span><strong>Na het aanmaken meteen inplannen</strong><small>De medewerker, datum en opdracht worden overgenomen in de planning.</small></span></label>` : ""}
  <div id="woFormErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions" style="flex-wrap:wrap;gap:8px;">
    <button type="button" class="adm-btn adm-btn-secondary" id="woCancel">Annuleren</button>
    ${workorder ? `<button type="button" class="adm-btn adm-btn-danger" id="woDelete"><svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>` : ""}
    ${workorder ? `<button type="button" class="adm-btn adm-btn-secondary" id="woReport" title="Werkbon-rapport afdrukken">Rapport</button>` : ""}
    ${workorder && ["Voltooid","Afgewerkt"].includes(workorder.status) && !workorder.invoiceId
      ? `<button type="button" class="adm-btn adm-btn-secondary" id="woMakeInvoice" style="color:var(--wf-purple);border-color:var(--wf-purple-l);">Factuur aanmaken</button>`
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
      document.getElementById("woVenueSel")?.addEventListener("change", event => {
        const venue = venues.find(row => row.id === event.target.value);
        const location = document.getElementById("woLocation");
        if (venue && location && (!location.value.trim() || location.value === initialLocation)) {
          location.value = venue.address || venue.name || "";
        }
      });

      // Materiaal-editor: herbruikbare lijnen op de werkbon (stromen mee in de factuur).
      const mats = Array.isArray(workorder?.materials) ? workorder.materials.slice() : [];
      const matBox = document.getElementById("woMaterials");
      const collectMats = () => {
        if (!matBox) return;
        const rows = [...matBox.querySelectorAll(".wo-mat-row")];
        mats.length = 0;
        rows.forEach(r => mats.push({
          description: r.querySelector(".wo-mat-desc").value,
          qty: r.querySelector(".wo-mat-qty").value,
          unitPrice: r.querySelector(".wo-mat-price").value,
        }));
      };
      const renderMats = () => {
        if (!matBox) return;
        matBox.innerHTML = mats.map(m => `<div class="wo-mat-row" style="display:flex;gap:6px;align-items:center;">
          <input class="wo-mat-desc" placeholder="Omschrijving" value="${esc(m.description || "")}" style="flex:1;">
          <input class="wo-mat-qty" type="number" step="0.01" min="0" placeholder="aantal" value="${m.qty ?? ""}" style="width:64px;">
          <input class="wo-mat-price" type="number" step="0.01" min="0" placeholder="€/st" value="${m.unitPrice ?? ""}" style="width:74px;">
          <button type="button" class="adm-btn adm-btn-secondary adm-btn-sm wo-mat-del" title="Verwijderen">✕</button>
        </div>`).join("");
        matBox.querySelectorAll(".wo-mat-del").forEach((b, i) => b.addEventListener("click", () => { collectMats(); mats.splice(i, 1); renderMats(); }));
      };
      document.getElementById("woAddMat")?.addEventListener("click", () => { collectMats(); mats.push({ description: "", qty: 1, unitPrice: "" }); renderMats(); });
      renderMats();

      document.getElementById("woCancel").addEventListener("click", closeDrawer);
      document.getElementById("woMakeInvoice")?.addEventListener("click", async event => {
        const button = event.currentTarget;
        if (!await uiConfirm("Uren, materiaal en factureerbare onkosten worden overgenomen en de koppeling blijft behouden.", { title: "Factuur maken van deze werkbon", confirmLabel: "Factuur aanmaken" })) return;
        const originalLabel = button.textContent;
        button.disabled = true;
        button.textContent = "Factuur maken…";
        try {
          const created = await api("POST", `/workorders/${workorder.id}/invoice`, {});
          closeDrawer();
          switchView("facturen");
          window.showToast && window.showToast(`Factuur ${created.invoice?.number || ""} aangemaakt en gekoppeld`, "success");
          if (created.invoice) setTimeout(() => openFactuurDrawer(created.invoice), 180);
        } catch (err) {
          button.disabled = false;
          button.textContent = originalLabel;
          const errEl = document.getElementById("woFormErr");
          if (errEl) { errEl.textContent = err.message; errEl.style.display = "block"; }
          else window.showToast(err.message, "error");
        }
      });
      document.getElementById("woReport")?.addEventListener("click", async () => {
        try { const r = await api("GET", `/documents/workorder/${workorder.id}/render`); const w = window.open("", "_blank"); w.document.write(r.html); w.document.close(); }
        catch (e) { window.showToast && window.showToast(e.message, "error"); }
      });
      document.getElementById("woDelete")?.addEventListener("click", async () => {
        if (!await uiConfirm(`Werkbon "${workorder.title}" verwijderen?`, { title: "Werkbon verwijderen", danger: true, confirmLabel: "Verwijderen" })) return;
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
        // Materiaal-lijnen meenemen (enkel volledige rijen); stromen mee in de factuur.
        collectMats();
        body.materials = mats
          .filter(m => String(m.description || "").trim() && Number(m.qty) > 0 && Number(m.unitPrice) > 0)
          .map(m => ({ description: String(m.description).trim(), qty: Number(m.qty), unitPrice: Number(m.unitPrice) }));
        try {
          const saved = workorder
            ? await api("PATCH", `/workorders/${workorder.id}`, body)
            : await api("POST", "/workorders", body);
          const savedWorkorder = saved.workorder || saved.row || workorder || null;
          const planAfterSave = !workorder && document.getElementById("woPlanAfterSave")?.checked;
          closeDrawer();
          if (planAfterSave) {
            switchView("planning");
            let tries = 0;
            const openPlannedShift = () => {
              const d = window.wfpAdmin?.drawers;
              if (!d?.shift && tries++ < 25) return setTimeout(openPlannedShift, 120);
              d?.shift?.({
                userId: body.userId,
                date: body.scheduledDate,
                note: body.title,
                venueId: body.venueId || "",
                location: body.location || body.clientName,
                workorderId: savedWorkorder?.id || ""
              });
            };
            openPlannedShift();
          } else renderWorkorders();
        } catch (err) {
          if (errEl) { errEl.textContent = err.message; errEl.style.display = "block"; }
          else window.showToast(err.message, "error");
        }
      });
    }).catch(err => window.showToast(err.message, "error"));
  }


  // ── Messages ───────────────────────────────────────────────
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
    <h3 class="adm-card-title">${tA("nav.reports","Rapportages")}</h3>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <input type="date" id="repFrom" value="${firstOfMonth}">
      <span style="font-size:13px;color:var(--gray-400);">${tA("adm.rep.until","t/m")}</span>
      <input type="date" id="repTo" value="${lastOfMonth}">
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="repLoad">${tA("adm.rep.load","Laden")}</button>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repBeslissers" title="${tA("adm.rep.decisionTitle","Printbaar beslissersrapport genereren")}">${tA("adm.rep.decisionReport","Beslissersrapport")}</button>
    </div>
  </div>
</div>

<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px;" id="repKpis">
  <div class="adm-kpi adm-kpi-blue"><div class="adm-kpi-label">${tA("adm.rep.totalHours","Totaal uren")}</div><div class="adm-kpi-value" id="repKpiHours">-</div><div class="adm-kpi-sub">${tA("adm.rep.registered","Geregistreerd")}</div></div>
  <div class="adm-kpi adm-kpi-green"><div class="adm-kpi-label">${tA("adm.rep.approvedExp","Goedgekeurde onkosten")}</div><div class="adm-kpi-value" id="repKpiExpenses">-</div><div class="adm-kpi-sub">${tA("adm.rep.totalAmount","Totaal bedrag")}</div></div>
  <div class="adm-kpi adm-kpi-amber"><div class="adm-kpi-label">${tA("adm.rep.leaveDays","Verlofdagen")}</div><div class="adm-kpi-value" id="repKpiLeaves">-</div><div class="adm-kpi-sub">${tA("adm.lstatus.approved","Goedgekeurd")}</div></div>
  <div class="adm-kpi adm-kpi-purple"><div class="adm-kpi-label">${tA("adm.rep.woCompleted","Werkbonnen voltooid")}</div><div class="adm-kpi-value" id="repKpiWO">-</div><div class="adm-kpi-sub">${tA("adm.rep.inPeriod","In periode")}</div></div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
  <!-- Uren per medewerker -->
  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">${tA("adm.rep.hoursPerEmp","Uren per medewerker")}</h3>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repExportClocks">${tA("adm.rep.csvExport","CSV export")}</button>
    </div>
    <div class="adm-card-body adm-table-wrap" id="repClocksTable">
      <div class="adm-loading">${tA("adm.rep.clickLoad","Klik op Laden…")}</div>
    </div>
  </div>

  <!-- Onkosten overzicht -->
  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">${tA("adm.rep.expOverview","Onkosten overzicht")}</h3>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repExportExpenses">${tA("adm.rep.csvExport","CSV export")}</button>
    </div>
    <div class="adm-card-body adm-table-wrap" id="repExpensesTable">
      <div class="adm-loading">${tA("adm.rep.clickLoad","Klik op Laden…")}</div>
    </div>
  </div>

  <!-- Verlof overzicht -->
  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">${tA("adm.rep.leaveOverview","Verlof overzicht")}</h3>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repExportLeaves">${tA("adm.rep.csvExport","CSV export")}</button>
    </div>
    <div class="adm-card-body adm-table-wrap" id="repLeavesTable">
      <div class="adm-loading">${tA("adm.rep.clickLoad","Klik op Laden…")}</div>
    </div>
  </div>

  <!-- Werkbonnen status -->
  <div class="adm-card">
    <div class="adm-card-header">
      <h3 class="adm-card-title">${tA("adm.rep.woStatus","Werkbonnen status")}</h3>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repExportWO">${tA("adm.rep.csvExport","CSV export")}</button>
    </div>
    <div class="adm-card-body adm-table-wrap" id="repWOTable">
      <div class="adm-loading">${tA("adm.rep.clickLoad","Klik op Laden…")}</div>
    </div>
  </div>
</div>

<!-- Loonlijst -->
<div class="adm-card" style="margin-top:16px;">
  <div class="adm-card-header">
    <h3 class="adm-card-title">${tA("adm.rep.payrollOverview","Loonlijst overzicht")}</h3>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repExportPayroll">${tA("adm.rep.exportCsv","Export CSV")}</button>
  </div>
  <div class="adm-card-body adm-table-wrap" id="repPayrollTable">
    <div class="adm-loading">${tA("adm.rep.clickLoad","Klik op Laden…")}</div>
  </div>
</div>

<!-- Sociaal secretariaat · prestatie-export (geen RSZ-aangifte) -->
<div class="adm-card" style="margin-top:16px;">
  <div class="adm-card-header">
    <h3 class="adm-card-title">${tA("adm.rep.payrollExport","Sociaal secretariaat · prestatie-export")}</h3>
    <button class="adm-btn adm-btn-primary adm-btn-sm" id="repPayrollDownload">${tA("adm.rep.payrollDownload","Download prestatiestaat")}</button>
  </div>
  <div class="adm-card-body">
    <p style="margin:0 0 12px;color:var(--gray-600);font-size:13px">${tA("adm.rep.payrollNote","Levert de gewerkte uren en goedgekeurde afwezigheden van de gekozen periode aan je sociaal secretariaat. Monargo doet zelf geen RSZ-aangifte · dit is een overdracht.")}</p>
    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end">
      <label style="font-size:12.5px">${tA("adm.rep.payrollProvider","Sociaal secretariaat")}<br><select id="repPayrollProvider" class="adm-input" style="min-width:180px"></select></label>
      <label style="font-size:12.5px">${tA("adm.rep.payrollAffiliate","Aansluitingsnummer")}<br><input id="repPayrollAffiliate" class="adm-input" placeholder="bv. 12345" style="min-width:150px"></label>
      <label style="font-size:12.5px">${tA("adm.rep.payrollNorm","Dagnorm (u)")}<br><input id="repPayrollNorm" class="adm-input" type="number" step="0.5" placeholder="8" style="width:90px"></label>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repPayrollSave">${tA("adm.common.save","Opslaan")}</button>
      <span id="repPayrollStatus" style="font-size:12.5px;color:var(--gray-600)"></span>
    </div>
  </div>
</div>

<!-- Winstgevendheid per klant -->
<div class="adm-card" style="margin-top:16px;">
  <div class="adm-card-header">
    <h3 class="adm-card-title">${tA("adm.rep.custProfit","Winstgevendheid per klant")}</h3>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="repExportCust">${tA("adm.rep.exportCsv","Export CSV")}</button>
  </div>
  <div class="adm-card-body adm-table-wrap" id="repCustTable">
    <div class="adm-loading">${tA("adm.rep.clickLoad","Klik op Laden…")}</div>
  </div>
</div>`;

    // Cache data voor CSV export
    let _repData = { clocks: [], expenses: [], leaves: [], workorders: [] };

    async function loadReportData() {
      const from = document.getElementById("repFrom").value;
      const to   = document.getElementById("repTo").value;
      if (!from || !to) return;

      try {
        const [clocksRes, expensesRes, leavesRes, woRes, empRes, invRes] = await Promise.all([
          api("GET", `/clocks?from=${from}&to=${to}`),
          api("GET", `/expenses`),
          api("GET", `/leaves?from=${from}&to=${to}`),
          api("GET", `/workorders`),
          (_state.employees && _state.employees.length) ? Promise.resolve(null) : api("GET", "/employees").catch(() => null),
          api("GET", `/facturen`).catch(() => ({ invoices: [] }))
        ]);
        if (empRes && (empRes.employees || Array.isArray(empRes))) _state.employees = empRes.employees || empRes;

        const clocks    = clocksRes.clocks || [];
        const expenses  = (expensesRes.expenses || []).filter(e => e.date >= from && e.date <= to);
        const leaves    = leavesRes.leaves || [];
        const workorders = (woRes.workorders || []).filter(w =>
          (w.scheduledDate || w.createdAt?.slice(0,10) || "") >= from &&
          (w.scheduledDate || w.createdAt?.slice(0,10) || "") <= to
        );
        const invoices  = (invRes.invoices || []).filter(i => (i.invoiceDate || "") >= from && (i.invoiceDate || "") <= to);
        _repData = { clocks, expenses, leaves, workorders, invoices };

        // ── Winstgevendheid per klant ────────────────────────
        // Omzet uit facturen (excl. btw); uren via klok→werkbon→klant; kosten =
        // goedgekeurde onkosten op werkbonnen van die klant, gesplitst in
        // doorgerekend (op factuur) en eigen kost. Loonkost valt hier buiten.
        const allWos = woRes.workorders || [];
        const woById2 = Object.fromEntries(allWos.map(w => [w.id, w]));
        const custKey = (name, id) => id || (name || "").trim().toLowerCase() || "-";
        const custAgg = {};
        const bucket = (key, label) => (custAgg[key] = custAgg[key] || { klant: label || "Onbekend", omzet: 0, openstaand: 0, facturen: 0, werkbonnen: 0, uren: 0, kostDoorgerekend: 0, kostEigen: 0 });
        for (const inv of invoices) {
          const b = bucket(custKey(inv.customerName, inv.customerId), inv.customerName);
          b.facturen += 1;
          b.omzet += Number(inv.subtotal ?? inv.total ?? 0);
          if (!inv.paidAt && ["open", "overdue"].includes(inv.status)) b.openstaand += Number(inv.total || 0);
        }
        for (const w of workorders) {
          if (!w.clientName && !w.customerId) continue;
          bucket(custKey(w.clientName, w.customerId), w.clientName).werkbonnen += 1;
        }
        for (const c of clocks) {
          const w = c.workorderId ? woById2[c.workorderId] : null;
          if (!w || (!w.clientName && !w.customerId)) continue;
          bucket(custKey(w.clientName, w.customerId), w.clientName).uren += (c.durationMinutes || 0) / 60;
        }
        for (const e of (expensesRes.expenses || []).filter(x => x.date >= from && x.date <= to)) {
          if (!e.workorderId || !["goedgekeurd", "approved"].includes(e.status)) continue;
          const w = woById2[e.workorderId];
          if (!w || (!w.clientName && !w.customerId)) continue;
          const b = bucket(custKey(w.clientName, w.customerId), w.clientName);
          if (e.invoiceId) b.kostDoorgerekend += Number(e.amount || 0);
          else b.kostEigen += Number(e.amount || 0);
        }
        const custRows = Object.values(custAgg).sort((a, b) => b.omzet - a.omzet);
        _repData.custProfit = custRows;
        const fmtC = n => new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
        const custEl = document.getElementById("repCustTable");
        if (custEl) {
          custEl.innerHTML = custRows.length ? `<table class="adm-table">
            <thead><tr><th>${tA("adm.thCustomer","Klant")}</th><th>${tA("adm.rep.revenueExVat","Omzet (excl. btw)")}</th><th>${tA("adm.cust.outstandingCap","Openstaand")}</th><th>${tA("nav.facturen","Facturen")}</th><th>${(window.wfpTerms && window.wfpTerms.t("jobPlural")) || tA("nav.workorders","Werkbonnen")}</th><th>${tA("adm.rep.hoursClocked","Uren geklokt")}</th><th>${tA("adm.rep.costPassed","Onkosten doorgerekend")}</th><th>${tA("adm.rep.costOwn","Onkosten eigen kost")}</th></tr></thead>
            <tbody>${custRows.map(r => `<tr>
              <td style="font-weight:600">${esc(r.klant)}</td>
              <td style="font-weight:600">${fmtC(r.omzet)}</td>
              <td>${r.openstaand > 0 ? `<span style="color:var(--wf-yellow);font-weight:600">${fmtC(r.openstaand)}</span>` : "-"}</td>
              <td>${r.facturen}</td>
              <td>${r.werkbonnen}</td>
              <td>${r.uren ? r.uren.toFixed(1) : "-"}</td>
              <td>${r.kostDoorgerekend ? fmtC(r.kostDoorgerekend) : "-"}</td>
              <td>${r.kostEigen ? `<span style="color:var(--wf-red)">${fmtC(r.kostEigen)}</span>` : "-"}</td>
            </tr>`).join("")}</tbody>
          </table>
          <div style="font-size:11.5px;color:var(--gray-400);padding:10px 4px 2px;">${tA("adm.rep.profitNote","Omzet = gefactureerd in de periode (excl. btw). Eigen kost = goedgekeurde onkosten op werkbonnen van deze klant die (nog) niet doorgerekend zijn. Loonkost valt buiten dit overzicht.")}</div>`
          : `<div class="adm-empty"><div class="adm-empty-text">${tA("adm.rep.noCustData","Geen facturen of werkbonnen met klant in deze periode")}</div></div>`;
        }

        // ── KPIs ─────────────────────────────────────────────
        const totalHours = clocks.reduce((sum, c) => sum + timeA.clockHours(c), 0);
        const approvedExpenses = expenses.filter(e => ["goedgekeurd","approved"].includes(e.status));
        const totalExp = approvedExpenses.reduce((s, e) => s + Number(e.amount || 0), 0);
        const approvedLeaves = leaves.filter(l => l.status === "goedgekeurd");
        const leaveDays = approvedLeaves.reduce((s, l) => {
          if (!l.startDate || !l.endDate) return s;
          const diff = (new Date(l.endDate) - new Date(l.startDate)) / 86400000 + 1;
          return s + diff;
        }, 0);
        const completedWO = workorders.filter(w => ["Voltooid","Afgewerkt"].includes(w.status)).length;

        document.getElementById("repKpiHours").textContent = totalHours.toFixed(1) + " " + tA("adm.rep.hoursUnit","u");
        document.getElementById("repKpiExpenses").textContent = "€" + totalExp.toFixed(0);
        document.getElementById("repKpiLeaves").textContent = leaveDays + " " + tA("adm.leave.daysAbbr","d");
        document.getElementById("repKpiWO").textContent = completedWO;

        // ── Uren per medewerker ───────────────────────────────
        const hoursByUser = {};
        clocks.forEach(c => {
          if (!hoursByUser[c.userId]) hoursByUser[c.userId] = { name: uName(c), hours: 0, days: new Set() };
          if (!timeA.isActive(c)) {
            hoursByUser[c.userId].hours += timeA.clockHours(c);
            const workDate = timeA.clockDate(c);
            if (workDate) hoursByUser[c.userId].days.add(workDate);
          }
        });
        const hourRows = Object.values(hoursByUser).sort((a,b) => b.hours - a.hours);
        const maxHours = hourRows[0]?.hours || 1;
        const BAR_COLORS = ["var(--wf-purple)","var(--wf-blue)","var(--wf-green)","var(--wf-yellow)","var(--wf-red)","var(--wf-orange)","var(--wf-blue-d)","var(--gray-500)"];
        document.getElementById("repClocksTable").innerHTML = hourRows.length
          ? `<div style="padding:8px 0;">${hourRows.map((r,i) => `
            <div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--gray-50);">
              <div style="width:110px;font-size:12px;font-weight:500;color:var(--gray-700);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${esc(r.name)}">${esc(r.name)}</div>
              <div style="flex:1;background:var(--gray-100);border-radius:4px;height:18px;overflow:hidden;">
                <div style="width:${(r.hours/maxHours*100).toFixed(1)}%;background:${BAR_COLORS[i%BAR_COLORS.length]};height:100%;border-radius:4px;transition:width .4s;"></div>
              </div>
              <div style="width:52px;font-size:12px;font-weight:600;color:var(--gray-900);text-align:right;">${r.hours.toFixed(1)} ${tA("adm.rep.hoursUnit","u")}</div>
              <div style="width:40px;font-size:11px;color:var(--gray-400);text-align:right;">${r.days.size}${tA("adm.leave.daysAbbr","d")}</div>
            </div>`).join("")}
            </div>
            <div style="font-size:11px;color:var(--gray-400);margin-top:6px;text-align:right">${tA("adm.total","Totaal")}: ${totalHours.toFixed(1)} ${tA("adm.rep.hoursUnit","u")} · ${hourRows.length} ${tA("nav.employees","Medewerkers").toLowerCase()}</div>`
          : `<div class="adm-empty">${tA("adm.rep.noClocks","Geen kloktijden in deze periode")}</div>`;

        // ── Onkosten ──────────────────────────────────────────
        document.getElementById("repExpensesTable").innerHTML = expenses.length
          ? `<table class="adm-table"><thead><tr><th>${tA("adm.thEmployee","Medewerker")}</th><th>${tA("adm.date","Datum")}</th><th>${tA("adm.thCategory","Categorie")}</th><th>${tA("adm.amount","Bedrag")}</th><th>${tA("adm.status","Status")}</th></tr></thead><tbody>
             ${expenses.map(e => `<tr><td>${esc(uName(e))}</td><td>${esc(e.date)}</td><td>${esc(e.category||"-")}</td><td>€${Number(e.amount||0).toFixed(2)}</td><td><span class="adm-status adm-status-${esc(e.status)}">${esc(e.status)}</span></td></tr>`).join("")}
             </tbody></table>`
          : `<div class="adm-empty">${tA("adm.rep.noExp","Geen onkosten in deze periode")}</div>`;

        // ── Verlof ────────────────────────────────────────────
        document.getElementById("repLeavesTable").innerHTML = leaves.length
          ? `<table class="adm-table"><thead><tr><th>${tA("adm.thEmployee","Medewerker")}</th><th>${tA("adm.leave.thType","Type")}</th><th>${tA("adm.leave.from","Van")}</th><th>${tA("adm.leave.to","Tot")}</th><th>${tA("adm.status","Status")}</th></tr></thead><tbody>
             ${leaves.map(l => `<tr><td>${esc(uName(l))}</td><td>${esc(tLeaveType(l.type))}</td><td>${esc(l.startDate)}</td><td>${esc(l.endDate)}</td><td><span class="adm-status adm-status-${esc(l.status)}">${esc(tLeaveStatus(l.status))}</span></td></tr>`).join("")}
             </tbody></table>`
          : `<div class="adm-empty">${tA("adm.rep.noLeave","Geen verlof in deze periode")}</div>`;

        // ── Werkbonnen ────────────────────────────────────────
        const woByStatus = {};
        workorders.forEach(w => { woByStatus[w.status||"Onbekend"] = (woByStatus[w.status||"Onbekend"]||0)+1; });
        const woStatusColors = { open:"var(--wf-blue)", in_progress:"var(--wf-yellow)", Voltooid:"var(--wf-green)", Afgewerkt:"var(--wf-green)", geannuleerd:"var(--wf-red)" };
        const woTotal = workorders.length;
        document.getElementById("repWOTable").innerHTML = workorders.length
          ? `<div style="padding:8px 0;">
              <div style="display:flex;height:20px;border-radius:6px;overflow:hidden;margin-bottom:14px;">
                ${Object.entries(woByStatus).map(([s,n]) => `<div style="flex:${n};background:${woStatusColors[s]||"var(--gray-400)"};transition:flex .4s;" title="${s}: ${n}"></div>`).join("")}
              </div>
              ${Object.entries(woByStatus).map(([s,n]) => `
              <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--gray-50);">
                <div style="width:10px;height:10px;border-radius:50%;background:${woStatusColors[s]||"var(--gray-400)"};flex-shrink:0;"></div>
                <div style="font-size:13px;color:var(--gray-700);flex:1;">${esc(tWoStatus(s))}</div>
                <div style="font-size:13px;font-weight:600;color:var(--gray-900);">${n}</div>
                <div style="font-size:11px;color:var(--gray-400);width:36px;text-align:right;">${(n/woTotal*100).toFixed(0)}%</div>
              </div>`).join("")}
              <div style="font-size:11px;color:var(--gray-400);margin-top:6px;text-align:right">${tA("adm.total","Totaal")}: ${woTotal} ${((window.wfpTerms && window.wfpTerms.t("jobPlural")) || tA("nav.workorders","Werkbonnen")).toLowerCase()}</div>
            </div>`
          : `<div class="adm-empty">${tA("adm.rep.noWo","Geen werkbonnen in deze periode")}</div>`;

        // ── Loonlijst ─────────────────────────────────────────
        const payrollByUser = {};
        clocks.forEach(c => {
          if (!payrollByUser[c.userId]) payrollByUser[c.userId] = { name: uName(c), email: c.userEmail||"", hours: 0, days: new Set(), expAmt: 0, leaveDays: 0 };
          if (!timeA.isActive(c)) {
            payrollByUser[c.userId].hours += timeA.clockHours(c);
            const workDate = timeA.clockDate(c);
            if (workDate) payrollByUser[c.userId].days.add(workDate);
          }
        });
        expenses.filter(e => ["goedgekeurd","approved"].includes(e.status)).forEach(e => {
          if (!payrollByUser[e.userId]) payrollByUser[e.userId] = { name: uName(e), email: "", hours: 0, days: new Set(), expAmt: 0, leaveDays: 0 };
          payrollByUser[e.userId].expAmt += Number(e.amount||0);
        });
        leaves.filter(l => l.status === "goedgekeurd").forEach(l => {
          if (!payrollByUser[l.userId]) payrollByUser[l.userId] = { name: uName(l), email: "", hours: 0, days: new Set(), expAmt: 0, leaveDays: 0 };
          const ld = l.startDate && l.endDate ? Math.round((new Date(l.endDate)-new Date(l.startDate))/86400000)+1 : Number(l.days||0);
          payrollByUser[l.userId].leaveDays += ld;
        });
        const payrollRows = Object.values(payrollByUser).sort((a,b)=>a.name.localeCompare(b.name));
        _repData.payroll = payrollRows;
        const payrollTbl = document.getElementById("repPayrollTable");
        if (payrollTbl) {
          if (!payrollRows.length) {
            payrollTbl.innerHTML = `<div class="adm-empty">${tA("adm.rep.noPayroll","Geen data voor loonlijst in deze periode")}</div>`;
          } else {
            const totH = payrollRows.reduce((s,r)=>s+r.hours,0);
            const totE = payrollRows.reduce((s,r)=>s+r.expAmt,0);
            const totL = payrollRows.reduce((s,r)=>s+r.leaveDays,0);
            payrollTbl.innerHTML = `
<table class="adm-table">
  <thead>
    <tr style="background:var(--gray-50);">
      <th>${tA("adm.thEmployee","Medewerker")}</th>
      <th style="text-align:right">${tA("adm.rep.workedDays","Gewerkte dagen")}</th>
      <th style="text-align:right">${tA("adm.rep.workedHours","Gewerkte uren")}</th>
      <th style="text-align:right">${tA("adm.rep.avgHourDay","Gem. uur/dag")}</th>
      <th style="text-align:right">${tA("adm.rep.leaveD","Verlof (d)")}</th>
      <th style="text-align:right">${tA("adm.rep.expEur","Onkosten (€)")}</th>
    </tr>
  </thead>
  <tbody>
    ${payrollRows.map(r => `<tr>
      <td><strong>${esc(r.name)}</strong></td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;">${r.days.size}</td>
      <td style="text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${r.hours.toFixed(2)}</td>
      <td style="text-align:right;color:var(--gray-500);">${r.days.size ? (r.hours/r.days.size).toFixed(2) : "-"}</td>
      <td style="text-align:right;">${r.leaveDays||"-"}</td>
      <td style="text-align:right;font-weight:600;">€${r.expAmt.toFixed(2)}</td>
    </tr>`).join("")}
  </tbody>
  <tfoot>
    <tr style="background:var(--gray-100);font-weight:600;border-top:2px solid var(--gray-200);">
      <td>${tA("adm.total","Totaal")} (${payrollRows.length} ${tA("nav.employees","Medewerkers").toLowerCase()})</td>
      <td style="text-align:right;">-</td>
      <td style="text-align:right;">${totH.toFixed(2)} ${tA("adm.rep.hoursUnit","u")}</td>
      <td style="text-align:right;">-</td>
      <td style="text-align:right;">${totL} ${tA("adm.leave.daysAbbr","d")}</td>
      <td style="text-align:right;">€${totE.toFixed(2)}</td>
    </tr>
  </tfoot>
</table>`;
          }
        }

      } catch (err) {
        document.getElementById("repClocksTable").innerHTML = `<div class="adm-empty" style="color:var(--wf-red);">${tA("adm.error","Fout")}: ${err.message}</div>`;
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
        const h = timeA.isActive(c) ? "" : timeA.clockHours(c).toFixed(2);
        return [uName(c), timeA.clockDate(c), timeA.clockTime(c, "in"), timeA.clockTime(c, "out"), h];
      });
      csvDownload("uren-export.csv", rows, ["Medewerker","Datum","Inkloktijd","Uitkloktijd","Uren"]);
    });
    document.getElementById("repExportExpenses").addEventListener("click", () => {
      const rows = (_repData.expenses||[]).map(e => [uName(e), e.date, e.category||"", e.description||"", e.amount||0, e.status]);
      csvDownload("onkosten-export.csv", rows, ["Medewerker","Datum","Categorie","Omschrijving","Bedrag","Status"]);
    });
    document.getElementById("repExportLeaves").addEventListener("click", () => {
      const rows = (_repData.leaves||[]).map(l => [uName(l), l.type||"", l.startDate, l.endDate, l.reason||"", l.status]);
      csvDownload("verlof-export.csv", rows, ["Medewerker","Type","Van","Tot","Reden","Status"]);
    });
    document.getElementById("repExportWO").addEventListener("click", () => {
      const rows = (_repData.workorders||[]).map(w => [w.number||w.id.slice(-4), w.title||"", uName(w)||"", w.status||"", w.scheduledDate||w.createdAt?.slice(0,10)||""]);
      csvDownload("werkbonnen-export.csv", rows, ["#","Titel","Medewerker","Status","Datum"]);
    });
    document.getElementById("repExportPayroll").addEventListener("click", () => {
      const from = document.getElementById("repFrom").value;
      const to   = document.getElementById("repTo").value;
      const rows = (_repData.payroll||[]).map(r => [r.name, r.days.size, r.hours.toFixed(2), r.days.size?(r.hours/r.days.size).toFixed(2):"0", r.leaveDays, r.expAmt.toFixed(2)]);
      csvDownload(`loonlijst-${from}-${to}.csv`, rows, ["Medewerker","Gewerkte dagen","Gewerkte uren","Gem uur/dag","Verlof (d)","Onkosten (EUR)"]);
    });
    // ── Sociaal secretariaat · prestatie-export ──────────────────────────────
    (async function initPayrollExport() {
      const sel = document.getElementById("repPayrollProvider");
      const aff = document.getElementById("repPayrollAffiliate");
      const norm = document.getElementById("repPayrollNorm");
      const status = document.getElementById("repPayrollStatus");
      if (!sel) return;
      try {
        const cfg = await api("GET", "/payroll/config");
        (cfg.providers || []).forEach(p => { const o = document.createElement("option"); o.value = p.key; o.textContent = p.label; sel.appendChild(o); });
        const r = cfg.readiness || {};
        sel.value = r.provider || "generic";
        aff.value = r.affiliateNumber || "";
        norm.value = r.dailyNormHours || "";
        status.textContent = r.ready ? "Klaar om te exporteren" : ("Nog in te vullen: " + (r.missing || []).join(", "));
        status.style.color = r.ready ? "var(--wf-green)" : "var(--wf-orange, #c60)";
      } catch (e) { status.textContent = "Kon configuratie niet laden"; }

      document.getElementById("repPayrollSave").addEventListener("click", async () => {
        status.textContent = "Opslaan…";
        try {
          const r = await api("POST", "/payroll/config", { provider: sel.value, affiliateNumber: aff.value.trim(), dailyNormHours: Number(norm.value) || undefined });
          const rd = r.readiness || {};
          status.textContent = rd.ready ? "Opgeslagen · klaar" : ("Opgeslagen · nog: " + (rd.missing || []).join(", "));
          status.style.color = rd.ready ? "var(--wf-green)" : "var(--wf-orange, #c60)";
        } catch (e) { status.textContent = "Opslaan mislukt: " + (e.message || ""); status.style.color = "var(--wf-red)"; }
      });

      document.getElementById("repPayrollDownload").addEventListener("click", async () => {
        const from = document.getElementById("repFrom").value, to = document.getElementById("repTo").value;
        if (!from || !to) { status.textContent = "Kies eerst een periode (van/tot)"; return; }
        status.textContent = "Prestatiestaat ophalen…";
        try {
          const resp = await fetch(`/api/tenants/${tenantId()}/payroll/prestaties?from=${from}&to=${to}&format=csv`, { headers: { Authorization: "Bearer " + token() } });
          if (!resp.ok) throw new Error("Export mislukt (" + resp.status + ")");
          const blob = await resp.blob();
          const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `prestaties-${from}_${to}.csv`; a.click();
          URL.revokeObjectURL(a.href);
          status.textContent = "Prestatiestaat gedownload · door te sturen naar je secretariaat";
          status.style.color = "var(--wf-green)";
        } catch (e) { status.textContent = e.message; status.style.color = "var(--wf-red)"; }
      });
    })();

    document.getElementById("repExportCust").addEventListener("click", () => {
      const from = document.getElementById("repFrom").value;
      const to   = document.getElementById("repTo").value;
      const rows = (_repData.custProfit||[]).map(r => [r.klant, r.omzet.toFixed(2), r.openstaand.toFixed(2), r.facturen, r.werkbonnen, r.uren.toFixed(1), r.kostDoorgerekend.toFixed(2), r.kostEigen.toFixed(2)]);
      csvDownload(`winstgevendheid-klanten-${from}-${to}.csv`, rows, ["Klant","Omzet excl btw (EUR)","Openstaand (EUR)","Facturen","Werkbonnen","Uren","Onkosten doorgerekend (EUR)","Onkosten eigen kost (EUR)"]);
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
    const totalH = clocks.reduce((sum, clock) => sum + timeA.clockHours(clock), 0);
    const approvedExp = expenses.filter(e=>["goedgekeurd","approved"].includes(e.status));
    const totalExp = approvedExp.reduce((s,e)=>s+Number(e.amount||0),0);
    const doneWO = workorders.filter(w=>["Voltooid","Afgewerkt","done"].includes(w.status)).length;
    const completionRate = workorders.length ? Math.round(doneWO/workorders.length*100) : 0;
    const approvedLeaves = leaves.filter(l=>l.status==="goedgekeurd").length;
    const win = window.open("","_blank");
    win.document.write(`<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8"><title>Beslissersrapport</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1e293b;background:#fff;padding:32px 40px}
.page{max-width:800px;margin:0 auto}.header{border-bottom:3px solid #0071e3;padding-bottom:16px;margin-bottom:28px;display:flex;justify-content:space-between;align-items:flex-end}
.title{font-size:24px;font-weight:600;color:#0071e3}.subtitle{font-size:13px;color:#64748b;margin-top:4px}.period{font-size:13px;color:#64748b}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:28px}
.kpi{background:#f8fafc;border-radius:10px;padding:16px;text-align:center;border:1px solid #e2e8f0}
.kpi-val{font-size:26px;font-weight:700;color:#0f172a;margin-bottom:4px}.kpi-lbl{font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px}
.section-title{font-size:15px;font-weight:600;color:#0f172a;margin:20px 0 10px;padding-bottom:6px;border-bottom:1px solid #e2e8f0}
table{width:100%;border-collapse:collapse;margin-bottom:20px}
th{background:#f1f5f9;padding:7px 10px;text-align:left;font-size:11px;font-weight:700;color:#374151;border-bottom:2px solid #e2e8f0}
td{padding:7px 10px;border-bottom:1px solid #f1f5f9;font-size:12px}
.green{color:#10b981;font-weight:600}.amber{color:#f59e0b;font-weight:600}.red{color:#ef4444;font-weight:600}
.recommendation{background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;margin-top:24px}
.rec-title{font-size:15px;font-weight:600;color:#1d4ed8;margin-bottom:8px}
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
<tbody>${payroll.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.days.size}</td><td class="${r.hours>0?"green":"red"}">${r.hours.toFixed(1)} u</td><td>${r.days.size?(r.hours/r.days.size).toFixed(1):"-"}</td><td>${r.leaveDays||0}</td><td>${fE(r.expAmt)}</td></tr>`).join("")||"<tr><td colspan='6'>Geen data</td></tr>"}</tbody>
<tfoot><tr style="font-weight:600;background:#f8fafc"><td>Totaal</td><td>-</td><td>${totalH.toFixed(1)} u</td><td>-</td><td>${payroll.reduce((s,r)=>s+r.leaveDays,0)}</td><td>${fE(totalExp)}</td></tr></tfoot>
</table>
<div class="section-title">Werkbonnenstatus</div>
<table><thead><tr><th>Status</th><th>Aantal</th><th>%</th></tr></thead>
<tbody>${Object.entries(workorders.reduce((a,w)=>{a[w.status||"?"]=(a[w.status||"?"]||0)+1;return a},{})).map(([s,n])=>`<tr><td>${esc(s)}</td><td>${n}</td><td>${workorders.length?(n/workorders.length*100).toFixed(0):0}%</td></tr>`).join("")||"<tr><td colspan='3'>Geen werkbonnen</td></tr>"}</tbody>
</table>
<div class="recommendation">
  <div class="rec-title">Pilotevaluatie</div>
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
      <input placeholder="Actor (e-mail)" id="auditActor" style="width:160px">
      <select id="auditArea">
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
      <input type="date" id="auditFrom" value="${weekAgoStr}">
      <span style="font-size:12px;color:var(--gray-400);">t/m</span>
      <input type="date" id="auditTo" value="${todayStr}">
      <input type="number" placeholder="Max" id="auditLimit" value="200" min="10" max="1000" style="width:70px">
      <button class="adm-btn adm-btn-primary adm-btn-sm" id="auditLoad">↻ Laden</button>
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="auditExport">CSV</button>
    </div>
  </div>
</div>
<div id="auditSummary" style="display:none;background:var(--wf-blue-l);border:1px solid var(--wf-blue-l);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:var(--wf-blue);"></div>
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
          summaryEl.innerHTML = `<strong>${_auditRows.length}</strong> events &nbsp;·&nbsp; <strong>${actors}</strong> actoren &nbsp;·&nbsp; <strong>${areas}</strong> gebieden${fails ? ` &nbsp;·&nbsp; <span style="color:var(--wf-red);font-weight:600;">${fails} fouten/weigeringen</span>` : ""}`;
          summaryEl.style.display = "block";
        }
        renderAuditTable(_auditRows);
      } catch (err) {
        tableEl.innerHTML = `<div class="adm-empty" style="color:var(--wf-red);">Fout: ${err.message}</div>`;
      }
    }

    function renderAuditTable(rows) {
      if (!rows.length) {
        document.getElementById("auditTable").innerHTML = '<div class="adm-empty"><div class="adm-empty-text">Geen audit-events gevonden</div></div>';
        return;
      }
      document.getElementById("auditTable").innerHTML = `
      <table class="adm-table">
        <thead><tr><th>Tijdstip</th><th>Actor</th><th>Actie</th><th>Gebied</th><th>Detail</th></tr></thead>
        <tbody>
          ${rows.map(r => `
          <tr>
            <td style="white-space:nowrap;font-size:12px;">${r.at ? new Date(r.at).toLocaleString("nl-BE",{dateStyle:"short",timeStyle:"short"}) : "-"}</td>
            <td style="font-size:12px;">${r.actor||"systeem"}</td>
            <td><span class="adm-status ${r.action?.includes("fail")||r.action?.includes("lock")||r.action?.includes("denied") ? "adm-status-inactive" : "adm-status-active"}">${r.action||"-"}</span></td>
            <td style="font-size:12px;">${r.area||"-"}</td>
            <td style="font-size:12px;color:var(--gray-500);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${r.detail||""}">${r.detail||"-"}</td>
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
    <h3 class="adm-card-title">${tA("nav.customers","Klanten")} <span style="background:var(--wf-purple-l);color:var(--wf-purple);border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${rows.length}</span></h3>
    <input id="custSearch" placeholder="${tA("adm.cust.searchPh","Zoek naam, e-mail…")}" style="font-size:12px;min-width:200px">
  </div>
  ${rows.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-text">${tA("adm.cust.empty","Nog geen klanten")}</div><button class="adm-btn adm-btn-primary adm-btn-sm" id="admEmptyNewCust" style="margin-top:12px">+ ${tA("adm.cust.emptyBtn","Eerste klant aanmaken")}</button></div>`
    : `<div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>${tA("adm.cust.thName","Naam")}</th><th>${tA("adm.cust.thContact","Contactpersoon")}</th><th>${tA("adm.email","E-mail")}</th><th>${tA("adm.cust.thPhone","Telefoon")}</th><th>${tA("adm.cust.thVat","BTW-nr")}</th><th>${tA("adm.actions","Acties")}</th></tr></thead>
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
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:var(--wf-red)">${tA("adm.error","Fout")}: ${e.message}</div>`; }
  }
  function buildCustRows(rows) {
    return rows.map(c => `<tr style="cursor:pointer;" class="cust-detail-row" data-id="${c.id}">
      <td><strong>${esc(c.name)}</strong></td>
      <td>${esc(c.contactName||"-")}</td>
      <td><a href="mailto:${esc(c.email||"")}" style="color:var(--wf-purple)">${esc(c.email||"-")}</a></td>
      <td>${esc(c.phone||"-")}</td>
      <td style="font-family:monospace;font-size:12px">${esc(c.vatNumber||"-")}</td>
      <td style="white-space:nowrap">
        <button class="adm-btn adm-btn-primary adm-btn-sm cust-view" data-id="${c.id}">${tA("adm.cust.detail","Detail")}</button>
        <button class="adm-btn adm-btn-secondary adm-btn-sm cust-edit" data-id="${c.id}">${tA("adm.edit","Bewerken")}</button>
      </td>
    </tr>`).join("");
  }

  async function renderCustomerDetail(customerId) {
    const content = document.getElementById("admContent");
    content.innerHTML = `<div class="adm-loading">${tA("adm.loading","Laden…")}</div>`;
    try {
      const customFieldRuntime = window.wfpConfigFieldsWorkspace;
      const [custData, woData, invData, qData, customerFieldDefs] = await Promise.all([
        api("GET", "/customers"),
        api("GET", "/workorders").catch(() => ({ workorders: [] })),
        api("GET", "/facturen").catch(() => ({ invoices: [] })),
        api("GET", "/offertes").catch(() => ({ quotes: [] })),
        customFieldRuntime ? customFieldRuntime.published("customer").catch(() => []) : Promise.resolve([])
      ]);
      const customer  = (custData.customers || []).find(c => c.id === customerId);
      if (!customer) { content.innerHTML = `<div class="adm-empty">${tA("adm.cust.notFound","Klant niet gevonden")}</div>`; return; }

      const custWOs    = (woData.workorders || []).filter(w => w.customerId === customerId || w.clientName === customer.name);
      const custInvs   = (invData.invoices || []).filter(i => i.customerId === customerId || i.customerName === customer.name);
      const custQuotes = (qData.quotes || []).filter(q => q.customerId === customerId || q.customerName === customer.name);
      const fmtEurCD  = n => new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(Number(n||0));
      const openInvAmt = custInvs.filter(i => ["open","overdue"].includes(i.status)).reduce((s,i) => s+Number(i.total||0),0);
      const paidInvAmt = custInvs.filter(i => i.status === "paid").reduce((s,i) => s+Number(i.total||0),0);

      let _custTab = "werkbonnen";

      function renderTabs() {
        content.querySelector("#custDetailTabs")?.querySelectorAll(".cdt-tab").forEach(t => {
          t.style.fontWeight = t.dataset.tab === _custTab ? "700" : "400";
          t.style.borderBottom = t.dataset.tab === _custTab ? "2px solid var(--wf-purple)" : "2px solid transparent";
        });
        const body = content.querySelector("#custDetailBody");
        if (!body) return;
        if (_custTab === "offertes") {
          body.innerHTML = custQuotes.length ? `<table class="adm-table">
            <thead><tr><th>${tA("adm.thNr","Nr.")}</th><th>${tA("adm.date","Datum")}</th><th>${tA("adm.amount","Bedrag")}</th><th>${tA("adm.status","Status")}</th><th>${tA("adm.cust.thFollowup","Vervolg")}</th></tr></thead>
            <tbody>${custQuotes.map(q => {
              const st = quoteStat(q.status);
              const accepted = q.status === "aanvaard";
              return `<tr>
                <td style="font-family:monospace;font-weight:600">${esc(q.number || "-")}</td>
                <td>${q.createdAt ? new Date(q.createdAt).toLocaleDateString("nl-BE") : "-"}</td>
                <td style="font-weight:600">${fmtEurCD(q.total)}</td>
                <td><span class="adm-status ${st.css}">${st.label}</span></td>
                <td style="display:flex;gap:4px;white-space:nowrap;">
                  ${q.workorderId ? `<span style="font-size:11px;color:var(--gray-400)">→ ${tA("adm.cust.toWo","werkbon")}</span>`
                    : accepted ? `<button class="adm-btn adm-btn-secondary adm-btn-sm q-cust-towo" data-id="${q.id}">→ ${(window.wfpTerms && window.wfpTerms.t("jobSingular")) || tA("emp.wo.default","Werkbon")}</button>` : ""}
                  ${q.invoiceId ? `<span style="font-size:11px;color:var(--gray-400)">→ ${tA("adm.cust.invoiced","gefactureerd")}</span>`
                    : accepted ? `<button class="adm-btn adm-btn-success adm-btn-sm q-cust-toinv" data-id="${q.id}">→ ${tA("adm.wo.toInvoice","Factuur")}</button>` : ""}
                </td>
              </tr>`;
            }).join("")}</tbody>
          </table>` : `<div class="adm-empty"><div class="adm-empty-text">${tA("adm.cust.noQuotes","Geen offertes voor deze klant")}</div></div>`;
          const convert = async (id, target, label) => {
            if (!await uiConfirm(tA("adm.cust.convertConfirm","Offerte omzetten naar {t}?").replace("{t}", label), { title: "Offerte omzetten", confirmLabel: "Omzetten" })) return;
            try {
              const d = await api("POST", `/offertes/${id}/convert`, { target });
              window.showToast && window.showToast(`${label} ${(d.workorder?.number || d.invoice?.number || "")} ${tA("adm.created","aangemaakt")}`, "success");
              renderCustomerDetail(customerId);
            } catch (err) { window.showToast && window.showToast(err.message || tA("adm.cust.convertFail","Omzetten mislukt"), "error"); }
          };
          body.querySelectorAll(".q-cust-towo").forEach(b => b.addEventListener("click", () => convert(b.dataset.id, "workorder", (window.wfpTerms && window.wfpTerms.t("jobSingular")) || tA("adm.cust.toWo","werkbon"))));
          body.querySelectorAll(".q-cust-toinv").forEach(b => b.addEventListener("click", () => convert(b.dataset.id, "invoice", tA("adm.cust.invoiceLc","factuur"))));
          return;
        }
        if (_custTab === "werkbonnen") {
          body.innerHTML = custWOs.length ? `<table class="adm-table">
            <thead><tr><th>#</th><th>${tA("adm.thTitle","Titel")}</th><th>${tA("adm.thEmployee","Medewerker")}</th><th>${tA("adm.status","Status")}</th><th>${tA("adm.date","Datum")}</th><th>${tA("adm.actions","Acties")}</th></tr></thead>
            <tbody>${custWOs.map(w => `<tr>
              <td style="font-family:monospace">${w.number||w.id.slice(-4)}</td>
              <td>${esc(w.title||"-")}</td>
              <td>${esc(uName(w)||"-")}</td>
              <td><span class="adm-status adm-status-${(w.status||"").toLowerCase().replace(/\s/g,"-")}">${esc(tWoStatus(w.status))}</span></td>
              <td>${w.scheduledDate||w.createdAt?.slice(0,10)||"-"}</td>
              <td><button class="adm-btn adm-btn-secondary adm-btn-sm wo-from-cust" data-id="${w.id}">${tA("adm.editShort","Bewerk")}</button></td>
            </tr>`).join("")}</tbody>
          </table>` : `<div class="adm-empty"><div class="adm-empty-text">${tA("adm.cust.noWos","Geen werkbonnen voor deze klant")}</div></div>`;
          body.querySelectorAll(".wo-from-cust").forEach(btn => {
            btn.addEventListener("click", () => openWorkorderDrawer(custWOs.find(w => w.id === btn.dataset.id)));
          });
        } else {
          body.innerHTML = custInvs.length ? `<table class="adm-table">
            <thead><tr><th>${tA("adm.thNr","Nr.")}</th><th>${tA("adm.date","Datum")}</th><th>${tA("adm.inv.due","Vervaldatum")}</th><th>${tA("adm.amount","Bedrag")}</th><th>${tA("adm.status","Status")}</th><th>${tA("adm.actions","Acties")}</th></tr></thead>
            <tbody>${custInvs.map(inv => {
              const st = invStat(inv.status);
              return `<tr>
                <td style="font-family:monospace;font-weight:600">${esc(inv.number||"-")}</td>
                <td>${inv.invoiceDate?new Date(inv.invoiceDate).toLocaleDateString("nl-BE"):"-"}</td>
                <td>${inv.dueDate?new Date(inv.dueDate).toLocaleDateString("nl-BE"):"-"}</td>
                <td style="font-weight:600">${fmtEurCD(inv.total)}</td>
                <td><span class="adm-status ${st.css}">${st.label}</span></td>
                <td style="display:flex;gap:4px;">
                  <button class="adm-btn adm-btn-secondary adm-btn-sm inv-from-cust" data-id="${inv.id}">${tA("adm.edit","Bewerken")}</button>
                  ${["open","overdue"].includes(inv.status)?`<button class="adm-btn adm-btn-success adm-btn-sm inv-paid-cust" data-id="${inv.id}">${tA("adm.inv.st.paid","Betaald")}</button>`:""}
                </td>
              </tr>`;
            }).join("")}</tbody>
          </table>` : `<div class="adm-empty"><div class="adm-empty-text">${tA("adm.cust.noInvs","Geen facturen voor deze klant")}</div></div>`;
          body.querySelectorAll(".inv-from-cust").forEach(btn => {
            btn.addEventListener("click", () => openFactuurDrawer(custInvs.find(i => i.id === btn.dataset.id)));
          });
          body.querySelectorAll(".inv-paid-cust").forEach(btn => {
            btn.addEventListener("click", async () => {
              if (!await uiConfirm(tA("adm.inv.markPaidConfirm","Factuur als betaald markeren?"), { title: "Betaalstatus aanpassen", confirmLabel: "Als betaald markeren" })) return;
              await api("PATCH", `/facturen/${btn.dataset.id}`, { status: "paid" });
              renderCustomerDetail(customerId);
            });
          });
        }
      }

      content.innerHTML = `
<!-- Back header -->
<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">
  <button class="adm-btn adm-btn-secondary adm-btn-sm" id="custDetailBack">← ${tA("adm.back","Terug")}</button>
  <h2 style="font-size:18px;font-weight:600;color:var(--gray-900);margin:0;">${esc(customer.name)}</h2>
  <button class="adm-btn adm-btn-secondary adm-btn-sm" id="custDetailEdit">${tA("adm.editShort","Bewerk")}</button>
</div>

<!-- KPIs -->
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;">
  <div class="adm-kpi adm-kpi-purple"><div class="adm-kpi-label">${(window.wfpTerms && window.wfpTerms.t("jobPlural")) || tA("nav.workorders","Werkbonnen")}</div><div class="adm-kpi-value">${custWOs.length}</div><div class="adm-kpi-sub">${custWOs.filter(w=>!["Voltooid","Afgewerkt","done"].includes(w.status)).length} ${tA("dash.woseg.open","Open").toLowerCase()}</div></div>
  <div class="adm-kpi adm-kpi-blue"><div class="adm-kpi-label">${tA("nav.facturen","Facturen")}</div><div class="adm-kpi-value">${custInvs.length}</div><div class="adm-kpi-sub">${custInvs.filter(i=>["open","overdue"].includes(i.status)).length} ${tA("adm.cust.outstanding","openstaand")}</div></div>
  <div class="adm-kpi adm-kpi-green"><div class="adm-kpi-label">${tA("adm.inv.st.paid","Betaald")}</div><div class="adm-kpi-value" style="font-size:17px">${fmtEurCD(paidInvAmt)}</div></div>
  <div class="adm-kpi ${openInvAmt>0?"adm-kpi-amber":"adm-kpi-blue"}"><div class="adm-kpi-label">${tA("adm.cust.outstandingCap","Openstaand")}</div><div class="adm-kpi-value" style="font-size:17px">${fmtEurCD(openInvAmt)}</div></div>
</div>

<div class="adm-grid-2">
  <!-- Info card -->
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">${tA("adm.cust.contactInfo","Contactgegevens")}</h3></div>
    <div class="adm-card-body" style="display:flex;flex-direction:column;gap:8px;">
      ${customer.contactName?`<div style="font-size:13px;"><span style="color:var(--gray-400);min-width:110px;display:inline-block">${tA("adm.cust.thContact","Contactpersoon")}</span>${esc(customer.contactName)}</div>`:""}
      ${customer.email?`<div style="font-size:13px;"><span style="color:var(--gray-400);min-width:110px;display:inline-block">${tA("adm.email","E-mail")}</span><a href="mailto:${esc(customer.email)}" style="color:var(--wf-purple)">${esc(customer.email)}</a></div>`:""}
      ${customer.phone?`<div style="font-size:13px;"><span style="color:var(--gray-400);min-width:110px;display:inline-block">${tA("adm.cust.thPhone","Telefoon")}</span>${esc(customer.phone)}</div>`:""}
      ${customer.vatNumber?`<div style="font-size:13px;"><span style="color:var(--gray-400);min-width:110px;display:inline-block">${tA("adm.cust.vatNumber","BTW-nummer")}</span><span style="font-family:monospace">${esc(customer.vatNumber)}</span></div>`:""}
      ${customer.address?`<div style="font-size:13px;"><span style="color:var(--gray-400);min-width:110px;display:inline-block">${tA("adm.cust.address","Adres")}</span>${esc(customer.address)}</div>`:""}
      ${customer.notes?`<div style="font-size:13px;margin-top:4px;"><span style="color:var(--gray-400);display:block;margin-bottom:2px;">${tA("adm.cust.notes","Notities")}</span><span style="color:var(--gray-500)">${esc(customer.notes)}</span></div>`:""}
      ${customFieldRuntime ? customFieldRuntime.renderRuntimeValues(customerFieldDefs, customer.customFields || {}) : ""}
      <div style="margin-top:8px;display:flex;gap:8px;">
        <button class="adm-btn adm-btn-primary adm-btn-sm" id="custNewQuote">+ ${tA("adm.quote.singular","Offerte")}</button>
        <button class="adm-btn adm-btn-primary adm-btn-sm" id="custNewWO">+ ${(window.wfpTerms && window.wfpTerms.t("jobSingular")) || tA("emp.wo.default","Werkbon")}</button>
        <button class="adm-btn adm-btn-secondary adm-btn-sm" id="custNewInv">${tA("adm.cust.invoiceCap","Factuur")}</button>
      </div>
    </div>
  </div>

  <!-- Tabs card -->
  <div class="adm-card">
    <div class="adm-card-header" style="flex-direction:column;gap:0;padding-bottom:0;" id="custDetailTabs">
      <div style="display:flex;gap:0;border-bottom:1px solid var(--gray-100);width:100%;">
        <button class="cdt-tab" data-tab="offertes" style="background:none;border:none;cursor:pointer;padding:10px 16px;font-size:13px;color:var(--gray-700);border-bottom:2px solid transparent;">${tA("nav.offertes","Offertes")} (${custQuotes.length})</button>
        <button class="cdt-tab" data-tab="werkbonnen" style="background:none;border:none;cursor:pointer;padding:10px 16px;font-size:13px;color:var(--gray-700);border-bottom:2px solid var(--wf-purple);font-weight:600;">${(window.wfpTerms && window.wfpTerms.t("jobPlural")) || tA("nav.workorders","Werkbonnen")} (${custWOs.length})</button>
        <button class="cdt-tab" data-tab="facturen" style="background:none;border:none;cursor:pointer;padding:10px 16px;font-size:13px;color:var(--gray-700);border-bottom:2px solid transparent;">${tA("nav.facturen","Facturen")} (${custInvs.length})</button>
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
      content.querySelector("#custNewQuote")?.addEventListener("click", () => {
        openOfferteDrawer(null, {
          customerId: customer.id,
          customerName: customer.name,
          customerVatNumber: customer.vatNumber || "",
          customerAddress: customer.address || ""
        });
      });
      content.querySelector("#custNewWO")?.addEventListener("click", () => {
        openWorkorderDrawer(null, null, { customerId:customer.id, clientName:customer.name });
      });
      content.querySelector("#custNewInv")?.addEventListener("click", () => {
        openFactuurDrawer(null, {
          customerId: customer.id,
          prefillCustomerName: customer.name,
          prefillCustomerVat: customer.vatNumber || "",
          prefillCustomerAddress: customer.address || ""
        });
      });
      content.querySelectorAll(".cdt-tab").forEach(t => {
        t.addEventListener("click", () => { _custTab = t.dataset.tab; renderTabs(); });
      });
      renderTabs();
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:var(--wf-red)">${tA("adm.error","Fout")}: ${e.message}</div>`; }
  }
  async function openCustomerDrawer(customer) {
    const customFieldRuntime = window.wfpConfigFieldsWorkspace;
    let customerFieldDefs = [];
    let customFieldsUnavailable = false;
    if (customFieldRuntime) {
      document.getElementById("admDrawerTitle").textContent = customer ? tA("adm.cust.editTitle","Klant bewerken") : tA("adm.cust.newTitle","Nieuwe klant");
      document.getElementById("admDrawerBody").innerHTML = `<div class="adm-loading"><div class="adm-spinner"></div>${tA("adm.loading","Laden…")}</div>`;
      openDrawer();
      try { customerFieldDefs = await customFieldRuntime.published("customer"); }
      catch (_) { customFieldsUnavailable = true; }
    }
    document.getElementById("admDrawerTitle").textContent = customer ? tA("adm.cust.editTitle","Klant bewerken") : tA("adm.cust.newTitle","Nieuwe klant");
    document.getElementById("admDrawerBody").innerHTML = `
<form id="custForm">
  <div class="adm-form-group"><label>${tA("adm.cust.thName","Naam")} *</label><input name="name" value="${esc(customer?.name||"")}" required placeholder="${tA("adm.cust.namePh","Bedrijfsnaam BV")}"></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${tA("adm.cust.thContact","Contactpersoon")}</label><input name="contactName" value="${esc(customer?.contactName||"")}" placeholder="${tA("adm.cust.contactPh","Jan Janssen")}"></div>
    <div class="adm-form-group">
      <label>${tA("adm.cust.vatNumber","BTW-nummer")}
        <button type="button" id="kboLookupBtn" style="background:none;border:none;cursor:pointer;font-size:11px;color:var(--wf-purple);font-weight:600;margin-left:6px;padding:1px 6px;border:1px solid var(--wf-purple-l);border-radius:4px;">${tA("adm.cust.kboLookup","KBO opzoeken")}</button>
      </label>
      <input name="vatNumber" id="custVatInput" value="${esc(customer?.vatNumber||"")}" placeholder="BE0000.000.000">
      <div id="kboResult" style="display:none;margin-top:6px;background:var(--wf-green-l);border-radius:6px;padding:8px;font-size:12px;color:var(--wf-green);"></div>
    </div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${tA("adm.email","E-mail")}</label><input name="email" type="email" value="${esc(customer?.email||"")}"></div>
    <div class="adm-form-group"><label>${tA("adm.cust.thPhone","Telefoon")}</label><input name="phone" value="${esc(customer?.phone||"")}"></div>
  </div>
  <div class="adm-form-group"><label>${tA("adm.cust.address","Adres")}</label><input name="address" value="${esc(customer?.address||"")}"></div>
  <div class="adm-form-group"><label>${tA("adm.cust.notes","Notities")}</label><textarea name="notes" rows="3" style="width:100%">${esc(customer?.notes||"")}</textarea></div>
  ${customFieldRuntime ? customFieldRuntime.renderRuntimeFields(customerFieldDefs, customer?.customFields || {}) : ""}
  ${customFieldsUnavailable ? `<div class="cfw-runtime-load-error">${tA("adm.cust.customFieldsUnavailable","Eigen velden konden niet worden geladen. Bestaande waarden blijven behouden.")}</div>` : ""}
  <div id="custFormErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="custCancel">${tA("adm.cancel","Annuleren")}</button>
    ${customer ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="custDelete">${tA("adm.delete","Verwijderen")}</button>` : ""}
    <button type="submit" class="adm-btn adm-btn-primary">${customer ? tA("adm.save","Opslaan") : tA("adm.createBtn","Aanmaken")}</button>
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
      if (!query) { window.showToast&&window.showToast(tA("adm.cust.kboPrompt","Vul BTW-nummer of naam in"),"info"); return; }
      btn.textContent = tA("adm.loading","Laden…"); btn.disabled = true;
      try {
        const d = await api("POST", "/kbo/lookup", { vat: query, name: query });
        const c = d.company || {};
        if (resultEl) {
          resultEl.style.display = "";
          resultEl.innerHTML = `<strong>${esc(c.name||tA("adm.unknown","Onbekend"))}</strong><br>${esc(c.vatNumber||"")} · ${esc(c.address||"")}
            <button type="button" id="kboApplyBtn" style="background:none;border:none;cursor:pointer;color:var(--wf-purple);font-size:11px;font-weight:600;margin-left:8px;">↗ ${tA("adm.cust.kboApply","Toepassen")}</button>`;
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
      } catch(e) { window.showToast&&window.showToast(tA("adm.cust.kboError","KBO fout")+": "+e.message,"error"); }
      finally { btn.textContent=tA("adm.cust.kboLookup","KBO opzoeken"); btn.disabled=false; }
    });

    document.getElementById("custDelete")?.addEventListener("click", async () => {
      if (!await uiConfirm(tA("adm.cust.deleteConfirm",'Klant "{n}" verwijderen?').replace("{n}", customer.name), { title: "Klant verwijderen", danger: true, confirmLabel: tA("adm.delete","Verwijderen") })) return;
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
        if (customFieldRuntime && customerFieldDefs.length) {
          const values = customFieldRuntime.collectRuntimeValues(e.target, customerFieldDefs);
          const validation = await api("POST", "/config/fields/validate", { entity: "customer", values });
          if (!validation.result?.ok) {
            customFieldRuntime.showRuntimeErrors(e.target, validation.result?.errors || []);
            if (errEl) { errEl.textContent = tA("adm.cust.customFieldsInvalid","Controleer de gemarkeerde eigen velden."); errEl.style.display = "block"; }
            return;
          }
          const preserved = { ...(customer?.customFields || {}) };
          customerFieldDefs.forEach(field => { delete preserved[field.key]; });
          body.customFields = { ...preserved, ...(validation.result.values || {}) };
        } else if (customer?.customFields) {
          body.customFields = { ...customer.customFields };
        }
        if (customer) {
          if (customer.version != null) body.expectedVersion = customer.version;
          await api("PATCH", `/customers/${customer.id}`, body);
          closeDrawer(); renderCustomers();
        } else {
          const created = await api("POST", "/customers", body);
          closeDrawer();
          window.showToast && window.showToast("Klant aangemaakt. Voeg nu een offerte of werkbon toe.", "success");
          if (created.customer?.id) renderCustomerDetail(created.customer.id); else renderCustomers();
        }
      } catch(err) {
        if (customFieldRuntime && err.data?.fieldErrors) customFieldRuntime.showRuntimeErrors(e.target, err.data.fieldErrors);
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
    <h3 class="adm-card-title">${(window.wfpTerms && window.wfpTerms.t("venuePlural")) || tA("nav.venues","Locaties / Werven")} <span style="background:var(--wf-purple-l);color:var(--wf-purple);border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${rows.length}</span></h3>
    <input id="venSearch" placeholder="${tA("adm.ven.searchPh","Zoek locatie…")}" style="font-size:12px;min-width:180px">
  </div>
  ${rows.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-text">${tA("adm.ven.empty","Nog geen locaties")}</div><button class="adm-btn adm-btn-primary adm-btn-sm" id="admEmptyNewVen" style="margin-top:12px">+ ${tA("adm.ven.emptyBtn","Eerste locatie aanmaken")}</button></div>`
    : `<div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>${tA("adm.cust.thName","Naam")}</th><th>${tA("adm.cust.address","Adres")}</th><th>${tA("adm.cust.thContact","Contactpersoon")}</th><th>${tA("adm.cust.thPhone","Telefoon")}</th><th>${tA("adm.active","Actief")}</th><th>${tA("adm.actions","Acties")}</th></tr></thead>
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
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:var(--wf-red)">${tA("adm.error","Fout")}: ${e.message}</div>`; }
  }
  function buildVenRows(rows) {
    return rows.map(v => `<tr class="adm-row-link ven-row" data-id="${v.id}" title="${tA("adm.ven.open","Open locatie")}">
      <td><strong>${esc(v.name)}</strong></td>
      <td>${esc(v.address||"-")}</td>
      <td>${esc(v.contactName||"-")}</td>
      <td>${esc(v.phone||"-")}</td>
      <td>${v.active !== false ? `<span class="adm-status adm-status-active">${tA("adm.active","Actief")}</span>` : `<span class="adm-status adm-status-inactive">${tA("adm.inactive","Inactief")}</span>`}</td>
      <td><button class="adm-btn adm-btn-secondary adm-btn-sm ven-edit" data-id="${v.id}">${tA("adm.editShort","Bewerk")}</button></td>
    </tr>`).join("");
  }
  function openVenueDrawer(venue) {
    document.getElementById("admDrawerTitle").textContent = venue ? tA("adm.ven.editTitle","Locatie bewerken") : tA("adm.ven.newTitle","Nieuwe locatie");
    document.getElementById("admDrawerBody").innerHTML = `
<form id="venForm">
  <div class="adm-form-group"><label>${tA("adm.cust.thName","Naam")} *</label><input name="name" value="${esc(venue?.name||"")}" required placeholder="${tA("adm.ven.namePh","Werf Brussel Noord")}"></div>
  <div class="adm-form-group"><label>${tA("adm.cust.address","Adres")}</label><input name="address" value="${esc(venue?.address||"")}" placeholder="${tA("adm.ven.addrPh","Straat 1, 1000 Brussel")}"></div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${tA("adm.cust.thContact","Contactpersoon")}</label><input name="contactName" value="${esc(venue?.contactName||"")}"></div>
    <div class="adm-form-group"><label>${tA("adm.cust.thPhone","Telefoon")}</label><input name="phone" value="${esc(venue?.phone||"")}"></div>
  </div>
  <div class="adm-form-group"><label>${tA("adm.cust.notes","Notities")}</label><textarea name="notes" rows="3" style="width:100%">${esc(venue?.notes||"")}</textarea></div>
  <div class="adm-form-group"><label><input type="checkbox" name="active" value="true" ${venue?.active !== false ? "checked" : ""}> ${tA("adm.ven.activeVenue","Actieve locatie")}</label></div>
  <div id="venFormErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="venCancel">${tA("adm.cancel","Annuleren")}</button>
    ${venue ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="venDelete">${tA("adm.delete","Verwijderen")}</button>` : ""}
    <button type="submit" class="adm-btn adm-btn-primary">${venue ? tA("adm.save","Opslaan") : tA("adm.createBtn","Aanmaken")}</button>
  </div>
</form>`;
    openDrawer();
    document.getElementById("venCancel").addEventListener("click", closeDrawer);
    document.getElementById("venDelete")?.addEventListener("click", async () => {
      if (!await uiConfirm(tA("adm.ven.deleteConfirm",'Locatie "{n}" verwijderen?').replace("{n}", venue.name), { title: "Locatie verwijderen", danger: true, confirmLabel: tA("adm.delete","Verwijderen") })) return;
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
  let _vehicleContext = { vehicles: [], employees: [] };

  const vehicleStatusLabel = status => ({
    actief: "Actief",
    in_onderhoud: "In onderhoud",
    buiten_dienst: "Buiten dienst",
    verkocht: "Verkocht"
  })[status] || "Onbekend";
  const vehicleAlertLabel = status => ({
    vervallen: "Vervallen",
    dringend: "Dringend",
    binnenkort: "Binnenkort",
    ok: "In orde",
    onbekend: "Niet ingesteld"
  })[status] || "Niet ingesteld";
  const vehicleDate = value => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("nl-BE") : "Niet ingesteld";
  const vehicleDriverName = id => {
    const employee = (_vehicleContext.employees || []).find(row => row.id === id);
    return employee ? (employee.name || employee.email || "Medewerker") : (id ? empNameById(id) || "Onbekende medewerker" : "Niet toegewezen");
  };
  const vehicleNeedsAttention = vehicle => ["vervallen", "dringend"].some(level =>
    [vehicle.serviceStatus, vehicle.inspectionStatus, vehicle.insuranceStatus].includes(level)
  );

  async function renderVehicles() {
    const content = document.getElementById("admContent");
    try {
      const [data, employeeData] = await Promise.all([
        api("GET", "/vehicles"),
        api("GET", "/employees").catch(() => ({ employees: [] }))
      ]);
      const vehicles = data.vehicles || [];
      const summary = data.summary || {};
      const employees = employeeData.employees || [];
      _vehicleContext = { vehicles, employees };
      if (employees.length) _state.employees = employees;

      const attention = vehicles.filter(vehicleNeedsAttention);
      content.innerHTML = `
<div class="adm-kpis vehicle-kpis" style="margin-bottom:18px">
  <div class="adm-kpi adm-kpi-blue"><div class="adm-kpi-label">Voertuigen</div><div class="adm-kpi-value">${summary.total ?? vehicles.length}</div><div class="vehicle-kpi-note">volledig wagenpark</div></div>
  <div class="adm-kpi adm-kpi-green"><div class="adm-kpi-label">Actief</div><div class="adm-kpi-value">${summary.actief || 0}</div><div class="vehicle-kpi-note">inzetbaar</div></div>
  <div class="adm-kpi adm-kpi-purple"><div class="adm-kpi-label">In onderhoud</div><div class="adm-kpi-value">${summary.in_onderhoud || 0}</div><div class="vehicle-kpi-note">tijdelijk niet inzetbaar</div></div>
  <div class="adm-kpi adm-kpi-${attention.length ? "red" : "green"}"><div class="adm-kpi-label">Aandacht nodig</div><div class="adm-kpi-value">${attention.length}</div><div class="vehicle-kpi-note">service, keuring of verzekering</div></div>
</div>
${attention.length ? `<div class="vehicle-alert-banner"><strong>${attention.length} voertuig${attention.length === 1 ? "" : "en"} vraagt aandacht</strong><span>${attention.slice(0, 5).map(vehicle => esc(`${vehicle.brand || ""} ${vehicle.model || ""} · ${vehicle.plate}`.trim())).join(", ")}</span></div>` : ""}
<div class="adm-card vehicle-list-card">
  <div class="adm-card-header">
    <div><h3 class="adm-card-title">Wagenpark</h3><p class="vehicle-card-subtitle">Inzetbaarheid, kilometerstand en vervaldata in één overzicht.</p></div>
    <div class="vehicle-list-tools">
      <select id="vehStatusFilter" class="adm-input">
        <option value="">Alle statussen</option>
        <option value="actief">Actief</option>
        <option value="in_onderhoud">In onderhoud</option>
        <option value="buiten_dienst">Buiten dienst</option>
        <option value="verkocht">Verkocht</option>
        <option value="attention">Aandacht nodig</option>
      </select>
      <input id="vehSearch" class="adm-input" placeholder="Zoek voertuig, plaat of chauffeur…">
    </div>
  </div>
  ${vehicles.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-icon">▱</div><div class="adm-empty-title">Nog geen voertuigen</div><div class="adm-empty-text">Voeg het eerste voertuig toe om kilometerstanden, service en documenten te bewaken.</div><button class="adm-btn adm-btn-primary" id="admEmptyNewVeh" style="margin-top:16px">Eerste voertuig aanmaken</button></div>`
    : `<div class="adm-table-wrap"><table class="adm-table vehicle-table">
      <thead><tr><th>Voertuig</th><th>Chauffeur</th><th>KM-stand</th><th>Status</th><th>Service</th><th>Keuring</th><th>Acties</th></tr></thead>
      <tbody id="vehTbody">${buildVehicleRows(vehicles)}</tbody>
    </table></div>`}
</div>`;

      const applyFilters = () => {
        const query = (document.getElementById("vehSearch")?.value || "").toLowerCase().trim();
        const filter = document.getElementById("vehStatusFilter")?.value || "";
        const filtered = vehicles.filter(vehicle => {
          const haystack = `${vehicle.brand || ""} ${vehicle.model || ""} ${vehicle.plate || ""} ${vehicleDriverName(vehicle.driverId)}`.toLowerCase();
          if (query && !haystack.includes(query)) return false;
          if (filter === "attention" && !vehicleNeedsAttention(vehicle)) return false;
          if (filter && filter !== "attention" && vehicle.status !== filter) return false;
          return true;
        });
        const tbody = document.getElementById("vehTbody");
        if (tbody) tbody.innerHTML = filtered.length
          ? buildVehicleRows(filtered)
          : `<tr><td colspan="7"><div class="adm-empty" style="padding:32px">Geen voertuigen gevonden met deze filters.</div></td></tr>`;
        wireVehicleButtons(vehicles);
      };
      document.getElementById("vehSearch")?.addEventListener("input", applyFilters);
      document.getElementById("vehStatusFilter")?.addEventListener("change", applyFilters);
      wireVehicleButtons(vehicles);
    } catch (error) {
      content.innerHTML = `<div style="padding:24px;color:var(--wf-red)">${tA("adm.error","Fout")}: ${esc(error.message)}</div>`;
    }
  }

  function buildVehicleRows(vehicles) {
    return vehicles.map(vehicle => {
      const attention = vehicleNeedsAttention(vehicle);
      return `<tr class="adm-row-link veh-row" data-id="${vehicle.id}" data-attention="${attention ? "true" : "false"}" title="Open voertuig">
        <td><div class="vehicle-name">${esc(`${vehicle.brand || ""} ${vehicle.model || ""}`.trim() || vehicle.model || "Voertuig")}</div><div class="vehicle-meta">${esc(vehicle.plate || "Geen nummerplaat")}${vehicle.fuel ? ` · ${esc(vehicle.fuel)}` : ""}</div></td>
        <td>${esc(vehicleDriverName(vehicle.driverId))}</td>
        <td><strong>${Number(vehicle.mileage || 0).toLocaleString("nl-BE")}</strong> <span class="vehicle-unit">km</span></td>
        <td><span class="vehicle-status vehicle-status-${vehicle.status || "onbekend"}">${vehicleStatusLabel(vehicle.status)}</span></td>
        <td><span class="vehicle-alert vehicle-alert-${vehicle.serviceStatus || "onbekend"}">${vehicleAlertLabel(vehicle.serviceStatus)}</span><small>${vehicle.nextService ? vehicleDate(vehicle.nextService) : ""}</small></td>
        <td><span class="vehicle-alert vehicle-alert-${vehicle.inspectionStatus || "onbekend"}">${vehicleAlertLabel(vehicle.inspectionStatus)}</span><small>${vehicle.inspectionDate ? vehicleDate(vehicle.inspectionDate) : ""}</small></td>
        <td class="vehicle-row-actions"><button class="adm-btn adm-btn-secondary adm-btn-sm veh-open" data-id="${vehicle.id}">Open</button><button class="adm-btn adm-btn-primary adm-btn-sm veh-km" data-id="${vehicle.id}">KM-stand</button></td>
      </tr>`;
    }).join("");
  }

  function wireVehicleButtons(vehicles) {
    document.querySelectorAll(".veh-row").forEach(row => row.addEventListener("click", event => {
      if (event.target.closest("button")) return;
      openVehicleDetail(row.dataset.id);
    }));
    document.querySelectorAll(".veh-open").forEach(button => button.addEventListener("click", () => openVehicleDetail(button.dataset.id)));
    document.querySelectorAll(".veh-km").forEach(button => button.addEventListener("click", () => {
      openMileageDrawer(button.dataset.id, vehicles.find(vehicle => vehicle.id === button.dataset.id));
    }));
  }

  function vehicleEmployeeOptions(selectedId) {
    return `<option value="">Niet toegewezen</option>${(_vehicleContext.employees || []).filter(employee => employee.active !== false).map(employee =>
      `<option value="${employee.id}" ${selectedId === employee.id ? "selected" : ""}>${esc(employee.name || employee.email || "Medewerker")}</option>`
    ).join("")}`;
  }

  async function openVehicleDetail(vehicleId) {
    const body = document.getElementById("admDrawerBody");
    document.getElementById("admDrawerTitle").textContent = "Voertuig";
    body.innerHTML = `<div class="adm-loading"><span class="adm-spinner"></span> Voertuig laden…</div>`;
    openDrawer();
    try {
      const response = await api("GET", `/vehicles/${vehicleId}`);
      const vehicle = response.vehicle || response;
      const logs = vehicle.mileageLogs || [];
      body.innerHTML = `
<div id="vehDetail" class="vehicle-detail">
  <div class="vehicle-detail-hero">
    <div><div class="vehicle-eyebrow">${esc(vehicle.plate)}</div><h3>${esc(`${vehicle.brand || ""} ${vehicle.model || ""}`.trim())}</h3><p>${esc(vehicle.fuel || "Brandstof onbekend")}${vehicle.year ? ` · bouwjaar ${esc(vehicle.year)}` : ""} · ${esc(vehicleDriverName(vehicle.driverId))}</p></div>
    <div class="vehicle-detail-actions"><button class="adm-btn adm-btn-secondary" id="vehDetailEdit">Gegevens bewerken</button><button class="adm-btn adm-btn-secondary" id="vehDetailService">Service plannen</button><button class="adm-btn adm-btn-primary" id="vehDetailMileage">KM-stand registreren</button></div>
  </div>

  <div class="vehicle-detail-metrics">
    <div><span>Kilometerstand</span><strong>${Number(vehicle.mileage || 0).toLocaleString("nl-BE")} <small>km</small></strong></div>
    <div><span>Status</span><strong><span class="vehicle-status vehicle-status-${vehicle.status}">${vehicleStatusLabel(vehicle.status)}</span></strong></div>
    <div><span>Volgende service</span><strong class="vehicle-metric-date">${vehicleDate(vehicle.nextService)}</strong><small>${vehicleAlertLabel(vehicle.serviceStatus)}</small></div>
    <div><span>Technische keuring</span><strong class="vehicle-metric-date">${vehicleDate(vehicle.inspectionDate)}</strong><small>${vehicleAlertLabel(vehicle.inspectionStatus)}</small></div>
  </div>

  <div class="vehicle-detail-grid">
    <section class="vehicle-detail-card">
      <h4>Voertuiggegevens</h4>
      <dl class="vehicle-definition-list">
        <div><dt>VIN</dt><dd>${esc(vehicle.vin || "Niet ingesteld")}</dd></div>
        <div><dt>Chauffeur</dt><dd>${esc(vehicleDriverName(vehicle.driverId))}</dd></div>
        <div><dt>Verzekeraar</dt><dd>${esc(vehicle.insuranceCompany || "Niet ingesteld")}</dd></div>
        <div><dt>Verzekering vervalt</dt><dd>${vehicleDate(vehicle.insuranceExpiry)}</dd></div>
      </dl>
      ${vehicle.notes ? `<div class="vehicle-notes"><span>Notities</span><p>${esc(vehicle.notes)}</p></div>` : ""}
    </section>

    <section class="vehicle-detail-card">
      <div class="vehicle-section-head"><div><h4>Kilometerhistoriek</h4><p>Laatste ${Math.min(20, logs.length)} registraties</p></div></div>
      ${logs.length ? `<div class="vehicle-history">${logs.map(log => `<div class="vehicle-history-row">
        <div class="vehicle-history-icon">↗</div>
        <div><strong>${Number(log.mileage || 0).toLocaleString("nl-BE")} km</strong><p>${esc(log.note || "Kilometerstand geregistreerd")}</p><small>${log.loggedAt ? new Date(log.loggedAt).toLocaleString("nl-BE") : ""}${log.actor ? ` · ${esc(log.actor)}` : ""}</small></div>
        <span>+${Number(log.delta || 0).toLocaleString("nl-BE")} km</span>
      </div>`).join("")}</div>` : `<div class="adm-empty" style="padding:34px 18px">Nog geen kilometerstanden geregistreerd.</div>`}
    </section>
  </div>
</div>`;

      document.getElementById("vehDetailEdit")?.addEventListener("click", () => openVehicleDrawer(vehicle));
      document.getElementById("vehDetailService")?.addEventListener("click", () => openServiceDrawer(vehicle));
      document.getElementById("vehDetailMileage")?.addEventListener("click", () => openMileageDrawer(vehicle.id, vehicle));
    } catch (error) {
      body.innerHTML = `<div style="padding:24px;color:var(--wf-red)">${esc(error.message)}</div>`;
    }
  }

  function openVehicleDrawer(vehicle) {
    document.getElementById("admDrawerTitle").textContent = vehicle ? "Voertuiggegevens bewerken" : "Nieuw voertuig";
    document.getElementById("admDrawerBody").innerHTML = `
<form id="vehForm" class="vehicle-form">
  <div class="vehicle-form-intro"><span>${vehicle ? "Wagenparkbeheer" : "Nieuw voertuig"}</span><h3>${vehicle ? esc(`${vehicle.brand || ""} ${vehicle.model || ""}`.trim()) : "Voeg een inzetbaar voertuig toe"}</h3><p>Bewaar chauffeur, onderhoud, keuring en verzekering samen. Kilometerwijzigingen blijven apart traceerbaar.</p></div>

  <div class="adm-form-section">Identificatie</div>
  <div class="vehicle-form-grid">
    <div class="adm-form-group"><label>Model *</label><input name="model" value="${esc(vehicle?.model || "")}" required placeholder="Transit"></div>
    <div class="adm-form-group"><label>Merk</label><input name="brand" value="${esc(vehicle?.brand || "")}" placeholder="Ford"></div>
    <div class="adm-form-group"><label>Nummerplaat *</label><input name="plate" value="${esc(vehicle?.plate || "")}" ${vehicle ? "disabled" : "required"} placeholder="1-ABC-234" style="text-transform:uppercase"><div class="adm-form-hint">${vehicle ? "De nummerplaat kan in het huidige contract na aanmaak niet worden gewijzigd." : "Wordt automatisch in hoofdletters bewaard."}</div></div>
    <div class="adm-form-group"><label>Bouwjaar</label><input name="year" type="number" min="1900" max="2100" value="${esc(vehicle?.year || "")}" placeholder="2024"></div>
    <div class="adm-form-group"><label>Brandstof</label><select name="fuel">
      ${["diesel","benzine","elektrisch","hybride","cng","lpg"].map(fuel => `<option value="${fuel}" ${vehicle?.fuel === fuel ? "selected" : ""}>${fuel.charAt(0).toUpperCase() + fuel.slice(1)}</option>`).join("")}
    </select></div>
    <div class="adm-form-group"><label>VIN / chassisnummer</label><input name="vin" value="${esc(vehicle?.vin || "")}" placeholder="Voertuigidentificatienummer"></div>
    <div class="adm-form-group"><label>Vaste chauffeur</label><select name="driverId">${vehicleEmployeeOptions(vehicle?.driverId)}</select></div>
    <div class="adm-form-group"><label>Status</label><select name="status">
      <option value="actief" ${!vehicle || vehicle.status === "actief" ? "selected" : ""}>Actief</option>
      <option value="in_onderhoud" ${vehicle?.status === "in_onderhoud" ? "selected" : ""}>In onderhoud</option>
      <option value="buiten_dienst" ${vehicle?.status === "buiten_dienst" ? "selected" : ""}>Buiten dienst</option>
      <option value="verkocht" ${vehicle?.status === "verkocht" ? "selected" : ""}>Verkocht</option>
    </select></div>
    ${vehicle ? "" : `<div class="adm-form-group"><label>Beginstand</label><input name="mileage" type="number" min="0" value="0"><div class="adm-form-hint">Latere standen registreert u via de kilometerhistoriek.</div></div>`}
  </div>

  <div class="adm-form-section">Vervaldata en verzekering</div>
  <div class="vehicle-form-grid">
    <div class="adm-form-group"><label>Volgende service</label><input name="nextService" type="date" value="${esc(vehicle?.nextService || "")}"></div>
    <div class="adm-form-group"><label>Technische keuring</label><input name="inspectionDate" type="date" value="${esc(vehicle?.inspectionDate || "")}"></div>
    <div class="adm-form-group"><label>Verzekering vervalt</label><input name="insuranceExpiry" type="date" value="${esc(vehicle?.insuranceExpiry || "")}"></div>
    <div class="adm-form-group"><label>Verzekeraar</label><input name="insuranceCompany" value="${esc(vehicle?.insuranceCompany || "")}" placeholder="Naam verzekeringsmaatschappij"></div>
  </div>

  <div class="adm-form-section">Interne informatie</div>
  <div class="adm-form-group"><label>Notities</label><textarea name="notes" rows="4" placeholder="Praktische afspraken, uitrusting of onderhoudsinformatie">${esc(vehicle?.notes || "")}</textarea></div>

  <div class="adm-form-actions" style="justify-content:space-between">
    ${vehicle ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="vehDelete">Voertuig verwijderen</button>` : `<span></span>`}
    <div class="vehicle-action-group"><button type="button" class="adm-btn adm-btn-secondary" id="vehCancel">Annuleren</button><button type="submit" class="adm-btn adm-btn-primary">${vehicle ? "Wijzigingen opslaan" : "Voertuig aanmaken"}</button></div>
  </div>
</form>`;
    openDrawer();
    document.getElementById("vehCancel")?.addEventListener("click", closeDrawer);

    if (vehicle) {
      document.getElementById("vehDelete")?.addEventListener("click", async () => {
        if (!await uiConfirm(`Voertuig "${vehicle.plate}" permanent verwijderen?`, { title: "Voertuig verwijderen", danger: true, confirmLabel: "Permanent verwijderen" })) return;
        try {
          await api("DELETE", `/vehicles/${vehicle.id}`);
          closeDrawer();
          renderVehicles();
        } catch (error) {
          window.showToast(error.message, "error");
        }
      });
    }

    document.getElementById("vehForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const raw = Object.fromEntries(new FormData(event.target).entries());
      const payload = {
        model: raw.model,
        brand: raw.brand,
        year: raw.year === "" ? null : Number(raw.year),
        fuel: raw.fuel,
        vin: raw.vin,
        driverId: raw.driverId || null,
        status: raw.status,
        nextService: raw.nextService || null,
        inspectionDate: raw.inspectionDate || null,
        insuranceExpiry: raw.insuranceExpiry || null,
        insuranceCompany: raw.insuranceCompany,
        notes: raw.notes
      };
      if (!vehicle) {
        payload.plate = raw.plate;
        payload.mileage = raw.mileage === "" ? 0 : Number(raw.mileage);
      }
      try {
        const response = vehicle
          ? await api("PATCH", `/vehicles/${vehicle.id}`, payload)
          : await api("POST", "/vehicles", payload);
        window.showToast(vehicle ? "Voertuiggegevens opgeslagen." : "Voertuig aangemaakt.", "success");
        await renderVehicles();
        openVehicleDetail((response.vehicle || response).id);
      } catch (error) {
        window.showToast(error.message, "error");
      }
    });
  }

  async function openMileageDrawer(vehicleId, knownVehicle) {
    document.getElementById("admDrawerTitle").textContent = "Kilometerstand registreren";
    const body = document.getElementById("admDrawerBody");
    body.innerHTML = `<div class="adm-loading"><span class="adm-spinner"></span> Voertuig laden…</div>`;
    openDrawer();
    try {
      const response = knownVehicle?.mileageLogs ? { vehicle: knownVehicle } : await api("GET", `/vehicles/${vehicleId}`);
      const vehicle = response.vehicle || response;
      body.innerHTML = `
<form id="kmForm" class="vehicle-mileage-form">
  <div class="vehicle-mileage-summary"><span>${esc(vehicle.plate)}</span><h3>${esc(`${vehicle.brand || ""} ${vehicle.model || ""}`.trim())}</h3><p>Huidige stand <strong>${Number(vehicle.mileage || 0).toLocaleString("nl-BE")} km</strong></p></div>
  <div class="adm-form-section">Nieuwe registratie</div>
  <div class="adm-form-group"><label>Nieuwe kilometerstand *</label><input name="mileage" type="number" min="${Number(vehicle.mileage || 0)}" step="1" required placeholder="${Number(vehicle.mileage || 0) + 100}"><div class="adm-form-hint">De nieuwe stand kan niet lager zijn dan de huidige stand.</div></div>
  <div class="adm-form-group"><label>Notitie</label><input name="note" placeholder="Bijvoorbeeld onderhoud, tankbeurt of maandelijkse controle"></div>
  <div class="adm-form-actions"><button type="button" class="adm-btn adm-btn-secondary" id="kmCancel">Annuleren</button><button type="submit" class="adm-btn adm-btn-primary" id="kmSubmit">Stand registreren</button></div>
</form>`;
      document.getElementById("kmCancel")?.addEventListener("click", () => openVehicleDetail(vehicle.id));
      document.getElementById("kmForm")?.addEventListener("submit", async event => {
        event.preventDefault();
        const raw = Object.fromEntries(new FormData(event.target).entries());
        const submit = document.getElementById("kmSubmit");
        submit.disabled = true;
        try {
          await api("POST", `/vehicles/${vehicle.id}/mileage`, { mileage: Number(raw.mileage), note: raw.note });
          window.showToast("Kilometerstand geregistreerd.", "success");
          await renderVehicles();
          openVehicleDetail(vehicle.id);
        } catch (error) {
          submit.disabled = false;
          window.showToast(error.message, "error");
        }
      });
    } catch (error) {
      body.innerHTML = `<div style="padding:24px;color:var(--wf-red)">${esc(error.message)}</div>`;
    }
  }

  function openServiceDrawer(vehicle) {
    document.getElementById("admDrawerTitle").textContent = "Service plannen";
    document.getElementById("admDrawerBody").innerHTML = `
<form id="vehServiceForm" class="vehicle-service-form">
  <div class="vehicle-mileage-summary"><span>${esc(vehicle.plate)}</span><h3>${esc(`${vehicle.brand || ""} ${vehicle.model || ""}`.trim())}</h3><p>Huidige servicestatus <strong>${vehicleAlertLabel(vehicle.serviceStatus)}</strong></p></div>
  <div class="adm-form-section">Onderhoudsafspraak</div>
  <div class="adm-form-group"><label>Volgende servicedatum *</label><input name="nextService" type="date" value="${esc(vehicle.nextService || "")}" required></div>
  <label class="vehicle-check"><input name="inService" type="checkbox"><span><strong>Markeer als in onderhoud</strong><small>Vink aan om de status te wijzigen; laat uit om de huidige status te behouden.</small></span></label>
  <div class="adm-form-group"><label>Notitie</label><textarea name="notes" rows="4" placeholder="Garage, geplande werkzaamheden of referentie">${esc(vehicle.notes || "")}</textarea></div>
  <div class="adm-form-actions"><button type="button" class="adm-btn adm-btn-secondary" id="vehServiceCancel">Annuleren</button><button type="submit" class="adm-btn adm-btn-primary" id="vehServiceSubmit">Service opslaan</button></div>
</form>`;
    openDrawer();
    document.getElementById("vehServiceCancel")?.addEventListener("click", () => openVehicleDetail(vehicle.id));
    document.getElementById("vehServiceForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const raw = Object.fromEntries(new FormData(event.target).entries());
      const submit = document.getElementById("vehServiceSubmit");
      submit.disabled = true;
      try {
        await api("POST", `/vehicles/${vehicle.id}/service`, {
          nextService: raw.nextService,
          inService: raw.inService === "on",
          notes: raw.notes
        });
        window.showToast("Serviceplanning opgeslagen.", "success");
        await renderVehicles();
        openVehicleDetail(vehicle.id);
      } catch (error) {
        submit.disabled = false;
        window.showToast(error.message, "error");
      }
    });
  }



  // ── Stock ──────────────────────────────────────────────────
  let _stockContext = { items: [], workorders: [], venues: [] };

  const stockQty = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const stockNum = value => new Intl.NumberFormat("nl-BE", { maximumFractionDigits: 2 }).format(stockQty(value));
  const stockAlertLabel = level => ({
    leeg: "Leeg",
    kritiek: "Kritiek",
    laag: "Laag",
    ok: "Op peil",
    unknown: "Niet ingesteld"
  })[level] || "Niet ingesteld";
  const stockMutationLabel = type => ({
    aanvulling: "Aanvulling",
    gebruik: "Verbruik",
    correctie: "Correctie",
    reservatie: "Reservatie",
    transfer: "Transfer",
    vrijgave: "Vrijgave"
  })[type] || type || "Mutatie";
  const stockVenueName = id => {
    const venue = (_stockContext.venues || []).find(row => row.id === id);
    return venue ? (venue.name || venue.address || "Locatie") : "";
  };
  const stockWorkorderName = id => {
    const workorder = (_stockContext.workorders || []).find(row => row.id === id);
    return workorder ? (workorder.number || workorder.reference || workorder.title || "Werkbon") : "";
  };

  async function renderStock() {
    const content = document.getElementById("admContent");
    try {
      const [data, workorderData, venueData] = await Promise.all([
        api("GET", "/stock"),
        api("GET", "/workorders").catch(() => ({ workorders: [] })),
        api("GET", "/venues").catch(() => ({ venues: [] }))
      ]);
      const items = data.items || [];
      const summary = data.summary || {};
      const workorders = workorderData.workorders || workorderData.rows || [];
      const venues = venueData.venues || venueData.rows || [];
      _stockContext = { items, workorders, venues };

      const attentionCount = stockQty(summary.leeg) + stockQty(summary.kritiek) + stockQty(summary.laag);
      const reservedItems = items.filter(item => stockQty(item.reserved) > 0).length;
      const locationCount = new Set(items.map(item => item.venueId || item.location).filter(Boolean)).size;
      const attentionItems = items.filter(item => ["leeg", "kritiek", "laag"].includes(item.alert));

      content.innerHTML = `
<div class="adm-kpis stock-kpis" style="margin-bottom:18px">
  <div class="adm-kpi adm-kpi-blue">
    <div class="adm-kpi-label">Artikelen</div>
    <div class="adm-kpi-value">${stockNum(summary.total ?? items.length)}</div>
    <div class="stock-kpi-note">${stockNum(summary.ok || 0)} op peil</div>
  </div>
  <div class="adm-kpi adm-kpi-purple">
    <div class="adm-kpi-label">Artikelen gereserveerd</div>
    <div class="adm-kpi-value">${stockNum(reservedItems)}</div>
    <div class="stock-kpi-note">artikelen met gereserveerde voorraad</div>
  </div>
  <div class="adm-kpi adm-kpi-blue">
    <div class="adm-kpi-label">Voorraadlocaties</div>
    <div class="adm-kpi-value">${stockNum(locationCount)}</div>
    <div class="stock-kpi-note">werven en magazijnlocaties</div>
  </div>
  <div class="adm-kpi adm-kpi-${attentionCount ? "red" : "green"}">
    <div class="adm-kpi-label">Aandacht nodig</div>
    <div class="adm-kpi-value">${stockNum(attentionCount)}</div>
    <div class="stock-kpi-note">leeg, kritiek of laag</div>
  </div>
</div>
${attentionItems.length ? `<div class="stock-alert-banner">
  <strong>Voorraad vraagt aandacht</strong>
  <span>${attentionItems.slice(0, 5).map(item => esc(item.name)).join(", ")}${attentionItems.length > 5 ? ` en ${attentionItems.length - 5} meer` : ""}</span>
</div>` : ""}
<div class="adm-card stock-list-card">
  <div class="adm-card-header">
    <div>
      <h3 class="adm-card-title">${tA("nav.stock","Stockbeheer")}</h3>
      <p class="stock-card-subtitle">Fysieke voorraad, reservaties en beschikbaarheid in één overzicht.</p>
    </div>
    <div class="stock-list-tools">
      <select id="stAlertFilter" class="adm-input" aria-label="Filter op voorraadstatus">
        <option value="">Alle statussen</option>
        <option value="attention">Aandacht nodig</option>
        <option value="reserved">Met reservatie</option>
        <option value="ok">Op peil</option>
      </select>
      <input id="stSearch" class="adm-input" placeholder="${tA("adm.stock.searchPh","Zoek artikel…")}">
    </div>
  </div>
  ${items.length === 0
    ? `<div class="adm-empty">
        <div class="adm-empty-icon">▦</div>
        <div class="adm-empty-title">Nog geen voorraadartikelen</div>
        <div class="adm-empty-text">Voeg uw eerste artikel toe. Beginvoorraad wordt automatisch als eerste mutatie bewaard.</div>
        <button class="adm-btn adm-btn-primary" id="admEmptyNewStock" style="margin-top:16px">Eerste artikel aanmaken</button>
      </div>`
    : `<div class="adm-table-wrap"><table class="adm-table stock-table">
        <thead><tr>
          <th>Artikel</th><th>Locatie</th><th>Fysiek</th><th>Gereserveerd</th><th>Beschikbaar</th><th>Minimum</th><th>Status</th><th>Acties</th>
        </tr></thead>
        <tbody id="stTbody">${buildStockRows(items)}</tbody>
      </table></div>`}
</div>`;

      const applyStockFilters = () => {
        const query = (document.getElementById("stSearch")?.value || "").toLowerCase().trim();
        const filter = document.getElementById("stAlertFilter")?.value || "";
        const filtered = items.filter(item => {
          const haystack = `${item.name || ""} ${item.sku || ""} ${item.category || ""} ${item.location || ""} ${stockVenueName(item.venueId)}`.toLowerCase();
          if (query && !haystack.includes(query)) return false;
          if (filter === "attention" && !["leeg", "kritiek", "laag"].includes(item.alert)) return false;
          if (filter === "reserved" && stockQty(item.reserved) <= 0) return false;
          if (filter === "ok" && item.alert !== "ok") return false;
          return true;
        });
        const tbody = document.getElementById("stTbody");
        if (tbody) tbody.innerHTML = filtered.length
          ? buildStockRows(filtered)
          : `<tr><td colspan="8"><div class="adm-empty" style="padding:32px">Geen artikelen gevonden met deze filters.</div></td></tr>`;
        wireStockBtns(items);
      };
      document.getElementById("stSearch")?.addEventListener("input", applyStockFilters);
      document.getElementById("stAlertFilter")?.addEventListener("change", applyStockFilters);
      wireStockBtns(items);
    } catch (error) {
      content.innerHTML = `<div style="padding:24px;color:var(--wf-red)">${tA("adm.error","Fout")}: ${esc(error.message)}</div>`;
    }
  }

  function buildStockRows(rows) {
    return rows.map(item => {
      const alert = item.alert || "unknown";
      const needsAttention = ["leeg", "kritiek", "laag"].includes(alert);
      const unit = esc(item.unit || "stuks");
      const location = stockVenueName(item.venueId) || item.location || "Niet toegewezen";
      return `<tr class="adm-row-link st-row" data-id="${item.id}" data-alert="${alert}" title="Open artikel" style="${needsAttention ? "background:var(--wf-red-l)" : ""}">
        <td>
          <div class="stock-item-name">${esc(item.name)}</div>
          <div class="stock-item-meta">${esc(item.sku || "Geen SKU")}${item.category ? ` · ${esc(item.category)}` : ""}</div>
        </td>
        <td><span class="stock-location">${esc(location)}</span></td>
        <td><strong>${stockNum(item.qty)}</strong> <span class="stock-unit">${unit}</span></td>
        <td>${stockQty(item.reserved) ? `<strong>${stockNum(item.reserved)}</strong> <span class="stock-unit">${unit}</span>` : `<span class="stock-muted">—</span>`}</td>
        <td><strong class="${stockQty(item.available) <= 0 ? "stock-negative" : ""}">${stockNum(item.available)}</strong> <span class="stock-unit">${unit}</span></td>
        <td>${item.minQty == null ? `<span class="stock-muted">—</span>` : `${stockNum(item.minQty)} <span class="stock-unit">${unit}</span>`}</td>
        <td><span class="stock-status stock-status-${alert}">${stockAlertLabel(alert)}</span></td>
        <td class="stock-row-actions">
          <button class="adm-btn adm-btn-secondary adm-btn-sm st-open" data-id="${item.id}">Open</button>
          <button class="adm-btn adm-btn-primary adm-btn-sm st-mut" data-id="${item.id}">Mutatie</button>
        </td>
      </tr>`;
    }).join("");
  }

  function wireStockBtns(items) {
    document.querySelectorAll(".st-row").forEach(row => row.addEventListener("click", event => {
      if (event.target.closest("button")) return;
      openStockDetail(row.dataset.id);
    }));
    document.querySelectorAll(".st-open").forEach(button => button.addEventListener("click", () => openStockDetail(button.dataset.id)));
    document.querySelectorAll(".st-mut").forEach(button => button.addEventListener("click", () => {
      const item = items.find(row => row.id === button.dataset.id);
      openMutationDrawer(button.dataset.id, item);
    }));
  }

  function stockVenueOptions(selectedId) {
    return `<option value="">Geen werf gekoppeld</option>${(_stockContext.venues || []).map(venue =>
      `<option value="${venue.id}" ${selectedId === venue.id ? "selected" : ""}>${esc(venue.name || venue.address || "Locatie")}</option>`
    ).join("")}`;
  }

  function stockWorkorderOptions(selectedId) {
    const open = (_stockContext.workorders || []).filter(workorder =>
      !["Voltooid", "Gefactureerd", "Geannuleerd", "Cancelled"].includes(workorder.status)
    );
    return `<option value="">Geen werkbon gekoppeld</option>${open.map(workorder =>
      `<option value="${workorder.id}" ${selectedId === workorder.id ? "selected" : ""}>${esc(workorder.number || workorder.reference || workorder.title || "Werkbon")}${workorder.customerName ? ` · ${esc(workorder.customerName)}` : ""}</option>`
    ).join("")}`;
  }

  async function openStockDetail(itemId) {
    const body = document.getElementById("admDrawerBody");
    document.getElementById("admDrawerTitle").textContent = "Voorraadartikel";
    body.innerHTML = `<div class="adm-loading"><span class="adm-spinner"></span> Artikel laden…</div>`;
    openDrawer();
    try {
      const data = await api("GET", `/stock/${itemId}`);
      const item = data.item || data;
      const mutations = item.mutations || [];
      const unit = esc(item.unit || "stuks");
      const venue = stockVenueName(item.venueId) || item.location || "Niet toegewezen";

      body.innerHTML = `
<div id="stDetail" class="stock-detail">
  <div class="stock-detail-hero">
    <div>
      <div class="stock-eyebrow">${esc(item.sku || "Voorraadartikel")}</div>
      <h3>${esc(item.name)}</h3>
      <p>${esc(item.category || "Algemeen")} · ${esc(venue)}</p>
    </div>
    <div class="stock-detail-actions">
      <button class="adm-btn adm-btn-secondary" id="stDetailEdit">Gegevens bewerken</button>
      <button class="adm-btn adm-btn-primary" id="stDetailMutation">Voorraadmutatie</button>
    </div>
  </div>

  <div class="stock-detail-metrics">
    <div><span>Fysieke voorraad</span><strong>${stockNum(item.qty)} <small>${unit}</small></strong></div>
    <div><span>Gereserveerd</span><strong>${stockNum(item.reserved)} <small>${unit}</small></strong></div>
    <div><span>Beschikbaar</span><strong>${stockNum(item.available)} <small>${unit}</small></strong></div>
    <div><span>Status</span><strong><span class="stock-status stock-status-${item.alert || "unknown"}">${stockAlertLabel(item.alert)}</span></strong></div>
  </div>

  <div class="stock-detail-grid">
    <section class="stock-detail-card">
      <h4>Artikelgegevens</h4>
      <dl class="stock-definition-list">
        <div><dt>Minimum</dt><dd>${item.minQty == null ? "Niet ingesteld" : `${stockNum(item.minQty)} ${unit}`}</dd></div>
        <div><dt>Maximum</dt><dd>${item.maxQty == null ? "Niet ingesteld" : `${stockNum(item.maxQty)} ${unit}`}</dd></div>
        <div><dt>Leverancier</dt><dd>${esc(item.supplier || "Niet ingesteld")}</dd></div>
        <div><dt>Opslagplaats</dt><dd>${esc(item.location || venue)}</dd></div>
      </dl>
      ${item.notes ? `<div class="stock-notes"><span>Notities</span><p>${esc(item.notes)}</p></div>` : ""}
    </section>

    <section class="stock-detail-card stock-history-card">
      <div class="stock-section-head">
        <div><h4>Mutatiehistoriek</h4><p>De laatste ${Math.min(50, mutations.length)} wijzigingen</p></div>
      </div>
      ${mutations.length ? `<div class="stock-history">${mutations.map(mutation => {
        const linkedWorkorder = stockWorkorderName(mutation.workorderId);
        const activeReservation = mutation.type === "reservatie" && mutation.status === "actief";
        return `<div class="stock-history-row">
          <div class="stock-history-icon stock-history-${mutation.type || "mutatie"}">${mutation.delta > 0 ? "+" : "−"}</div>
          <div class="stock-history-main">
            <div><strong>${stockMutationLabel(mutation.type)}</strong><span>${mutation.delta > 0 ? "+" : ""}${stockNum(mutation.delta)} ${unit}</span></div>
            <p>${esc(mutation.reason || "Geen reden opgegeven")}${linkedWorkorder ? ` · ${esc(linkedWorkorder)}` : ""}</p>
            <small>${mutation.createdAt ? new Date(mutation.createdAt).toLocaleString("nl-BE") : ""}${mutation.actor ? ` · ${esc(mutation.actor)}` : ""}</small>
          </div>
          <div class="stock-history-after">
            <span>Na mutatie</span>
            <strong>${stockNum(mutation.qtyAfter)} ${unit}</strong>
            ${activeReservation ? `<button class="adm-btn adm-btn-secondary adm-btn-sm st-release" data-id="${mutation.id}">Vrijgeven</button>` : ""}
          </div>
        </div>`;
      }).join("")}</div>` : `<div class="adm-empty" style="padding:34px 18px">Nog geen mutaties voor dit artikel.</div>`}
    </section>
  </div>
</div>`;

      document.getElementById("stDetailEdit")?.addEventListener("click", () => openStockDrawer(item));
      document.getElementById("stDetailMutation")?.addEventListener("click", () => openMutationDrawer(item.id, item));
      document.querySelectorAll(".st-release").forEach(button => button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await api("POST", `/stock/mutations/${button.dataset.id}/release`, {});
          window.showToast("Reservatie is vrijgegeven.", "success");
          openStockDetail(item.id);
        } catch (error) {
          button.disabled = false;
          window.showToast(error.message, "error");
        }
      }));
    } catch (error) {
      body.innerHTML = `<div style="padding:24px;color:var(--wf-red)">${esc(error.message)}</div>`;
    }
  }

  function openStockDrawer(item) {
    document.getElementById("admDrawerTitle").textContent = item ? "Artikelgegevens bewerken" : "Nieuw voorraadartikel";
    document.getElementById("admDrawerBody").innerHTML = `
<form id="stForm" class="stock-form">
  <div class="stock-form-intro">
    <div>
      <span>${item ? "Artikelbeheer" : "Nieuw artikel"}</span>
      <h3>${item ? esc(item.name) : "Maak een artikel klaar voor dagelijks gebruik"}</h3>
      <p>${item ? "Pas stamgegevens en voorraadgrenzen aan. De hoeveelheid wijzigt u via een traceerbare mutatie." : "Leg artikel, locatie en voorraadgrenzen vast. De beginvoorraad wordt automatisch in de historiek bewaard."}</p>
    </div>
  </div>

  <div class="adm-form-section">Artikel</div>
  <div class="stock-form-grid">
    <div class="adm-form-group stock-field-wide"><label>Naam *</label><input name="name" value="${esc(item?.name || "")}" required placeholder="Kabel 3x2,5 mm²"></div>
    <div class="adm-form-group"><label>SKU / code</label><input name="sku" value="${esc(item?.sku || "")}" placeholder="KAB-325"></div>
    <div class="adm-form-group"><label>Categorie</label><input name="category" value="${esc(item?.category || "")}" placeholder="Kabels"></div>
    <div class="adm-form-group"><label>Eenheid</label><input name="unit" value="${esc(item?.unit || "stuks")}" placeholder="stuks, meter, kg"></div>
  </div>

  <div class="adm-form-section">Voorraad en locatie</div>
  <div class="stock-form-grid">
    ${item ? `<div class="stock-current-qty">
      <span>Huidige fysieke voorraad</span>
      <strong>${stockNum(item.qty)} ${esc(item.unit || "stuks")}</strong>
      <button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" id="stFormMutation">Voorraad aanpassen</button>
    </div>` : `<div class="adm-form-group"><label>Beginvoorraad</label><input name="qty" type="number" step="0.01" value="0"><div class="adm-form-hint">Wordt als eerste aanvulling bewaard.</div></div>`}
    <div class="adm-form-group"><label>Minimumvoorraad</label><input name="minQty" type="number" step="0.01" min="0" value="${esc(item?.minQty ?? "")}" placeholder="Waarschuwing vanaf"></div>
    <div class="adm-form-group"><label>Maximumvoorraad</label><input name="maxQty" type="number" step="0.01" min="0" value="${esc(item?.maxQty ?? "")}" placeholder="Optioneel"></div>
    <div class="adm-form-group"><label>Werf / locatie</label><select name="venueId">${stockVenueOptions(item?.venueId)}</select></div>
    <div class="adm-form-group"><label>Opslagplaats</label><input name="location" value="${esc(item?.location || "")}" placeholder="Magazijn A · rek 4"></div>
    <div class="adm-form-group"><label>Leverancier</label><input name="supplier" value="${esc(item?.supplier || "")}" placeholder="Naam leverancier"></div>
  </div>

  <div class="adm-form-section">Interne informatie</div>
  <div class="adm-form-group"><label>Notities</label><textarea name="notes" rows="4" placeholder="Bestelreferentie, praktische afspraken of productinformatie">${esc(item?.notes || "")}</textarea></div>

  <div class="adm-form-actions" style="justify-content:space-between">
    ${item ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="stDelete">Artikel verwijderen</button>` : `<span></span>`}
    <div class="stock-action-group">
      <button type="button" class="adm-btn adm-btn-secondary" id="stCancel">Annuleren</button>
      <button type="submit" class="adm-btn adm-btn-primary">${item ? "Wijzigingen opslaan" : "Artikel aanmaken"}</button>
    </div>
  </div>
</form>`;
    openDrawer();

    document.getElementById("stCancel")?.addEventListener("click", closeDrawer);
    document.getElementById("stFormMutation")?.addEventListener("click", () => openMutationDrawer(item.id, item));

    if (item) {
      document.getElementById("stDelete")?.addEventListener("click", async () => {
        if (!await uiConfirm(`Artikel "${item.name}" permanent verwijderen? Ook de mutatiehistoriek is daarna niet meer zichtbaar.`, { title: "Stockartikel verwijderen", danger: true, confirmLabel: "Permanent verwijderen" })) return;
        try {
          await api("DELETE", `/stock/${item.id}`);
          closeDrawer();
          renderStock();
        } catch (error) {
          window.showToast(error.message, "error");
        }
      });
    }

    document.getElementById("stForm")?.addEventListener("submit", async event => {
      event.preventDefault();
      const raw = Object.fromEntries(new FormData(event.target).entries());
      const body = {
        name: raw.name,
        sku: raw.sku,
        category: raw.category,
        unit: raw.unit,
        venueId: raw.venueId || null,
        location: raw.location,
        supplier: raw.supplier,
        notes: raw.notes,
        minQty: raw.minQty === "" ? null : Number(raw.minQty),
        maxQty: raw.maxQty === "" ? null : Number(raw.maxQty)
      };
      if (!item) body.qty = raw.qty === "" ? 0 : Number(raw.qty);

      try {
        const response = item
          ? await api("PATCH", `/stock/${item.id}`, body)
          : await api("POST", "/stock", body);
        window.showToast(item ? "Artikelgegevens opgeslagen." : "Voorraadartikel aangemaakt.", "success");
        await renderStock();
        openStockDetail((response.item || response).id);
      } catch (error) {
        window.showToast(error.message, "error");
      }
    });
  }

  async function openMutationDrawer(itemId, knownItem) {
    document.getElementById("admDrawerTitle").textContent = "Voorraadmutatie";
    const body = document.getElementById("admDrawerBody");
    body.innerHTML = `<div class="adm-loading"><span class="adm-spinner"></span> Voorraad laden…</div>`;
    openDrawer();

    try {
      const response = knownItem?.mutations ? { item: knownItem } : await api("GET", `/stock/${itemId}`);
      const item = response.item || response;
      const unit = esc(item.unit || "stuks");

      body.innerHTML = `
<form id="mutForm" class="stock-mutation-form">
  <div class="stock-mutation-summary">
    <div>
      <span>Artikel</span>
      <strong>${esc(item.name)}</strong>
      <small>${esc(item.sku || item.category || "Voorraadartikel")}</small>
    </div>
    <div><span>Fysiek</span><strong>${stockNum(item.qty)} ${unit}</strong></div>
    <div><span>Gereserveerd</span><strong>${stockNum(item.reserved)} ${unit}</strong></div>
    <div><span>Beschikbaar</span><strong>${stockNum(item.available)} ${unit}</strong></div>
  </div>

  <div class="adm-form-section">Wat wilt u registreren?</div>
  <div class="stock-mutation-grid">
    <div class="adm-form-group">
      <label>Type mutatie *</label>
      <select name="type" id="mutType" required>
        <option value="aanvulling">Aanvulling ontvangen</option>
        <option value="gebruik">Verbruik registreren</option>
        <option value="reservatie">Reserveren voor werkbon</option>
        <option value="correctie">Voorraad corrigeren</option>
      </select>
      <div class="adm-form-hint" id="mutTypeHint">De ontvangen hoeveelheid wordt bij de fysieke voorraad geteld.</div>
    </div>
    <div class="adm-form-group">
      <label id="mutQtyLabel">Ontvangen hoeveelheid *</label>
      <div class="stock-quantity-input">
        <input name="delta" id="mutDelta" type="number" min="0.01" step="0.01" required placeholder="0">
        <span>${unit}</span>
      </div>
      <div class="adm-form-hint" id="mutQtyHint">Vul een positieve hoeveelheid in.</div>
    </div>
    <div class="adm-form-group">
      <label>Werkbon</label>
      <select name="workorderId" id="mutWorkorder">${stockWorkorderOptions("")}</select>
      <div class="adm-form-hint" id="mutWorkorderHint">Optioneel bij een aanvulling of correctie.</div>
    </div>
    <div class="adm-form-group">
      <label>Werf / locatie</label>
      <select name="venueId">${stockVenueOptions(item.venueId)}</select>
    </div>
    <div class="adm-form-group stock-field-wide">
      <label>Reden of referentie</label>
      <input name="reason" placeholder="Bijvoorbeeld levering 2026-184 of gebruikt tijdens plaatsing">
    </div>
  </div>

  <div class="stock-mutation-impact" id="mutImpact">
    <span>Verwachte fysieke voorraad</span>
    <strong>${stockNum(item.qty)} ${unit}</strong>
  </div>

  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="mutCancel">Annuleren</button>
    <button type="submit" class="adm-btn adm-btn-primary" id="mutSubmit">Mutatie verwerken</button>
  </div>
</form>`;

      const typeInput = document.getElementById("mutType");
      const deltaInput = document.getElementById("mutDelta");
      const workorderInput = document.getElementById("mutWorkorder");
      const typeHint = document.getElementById("mutTypeHint");
      const qtyLabel = document.getElementById("mutQtyLabel");
      const qtyHint = document.getElementById("mutQtyHint");
      const workorderHint = document.getElementById("mutWorkorderHint");
      const impact = document.getElementById("mutImpact");

      const updateMutationForm = () => {
        const type = typeInput.value;
        const entered = Number(deltaInput.value || 0);
        const isCorrection = type === "correctie";
        const isOutbound = type === "gebruik";
        const isReservation = type === "reservatie";

        deltaInput.min = isCorrection ? "" : "0.01";
        qtyLabel.textContent = isCorrection ? "Correctie (+ of −) *" : isReservation ? "Te reserveren hoeveelheid *" : isOutbound ? "Verbruikte hoeveelheid *" : "Ontvangen hoeveelheid *";
        qtyHint.textContent = isCorrection ? "Gebruik een minteken om de fysieke voorraad te verlagen." : "Vul een positieve hoeveelheid in; Monargo verwerkt de richting automatisch.";
        typeHint.textContent = isReservation
          ? "De fysieke voorraad blijft gelijk; de beschikbare voorraad daalt."
          : isOutbound
            ? "De gebruikte hoeveelheid gaat van de fysieke voorraad af."
            : isCorrection
              ? "Gebruik dit alleen wanneer de getelde voorraad afwijkt."
              : "De ontvangen hoeveelheid wordt bij de fysieke voorraad geteld.";
        workorderInput.required = isReservation;
        workorderHint.textContent = isReservation ? "Een reservatie moet aan een werkbon gekoppeld zijn." : isOutbound ? "Koppel verbruik aan een werkbon voor volledige traceerbaarheid." : "Optioneel bij een aanvulling of correctie.";

        let physicalAfter = stockQty(item.qty);
        let availableAfter = stockQty(item.available);
        if (type === "aanvulling") {
          physicalAfter += Math.abs(entered);
          availableAfter += Math.abs(entered);
        } else if (isOutbound) {
          physicalAfter -= Math.abs(entered);
          availableAfter -= Math.abs(entered);
        } else if (isCorrection) {
          physicalAfter += entered;
          availableAfter += entered;
        } else if (isReservation) {
          availableAfter -= Math.abs(entered);
        }
        impact.innerHTML = `<span>${isReservation ? "Verwacht beschikbaar" : "Verwachte fysieke voorraad"}</span><strong class="${(isReservation ? availableAfter : physicalAfter) < 0 ? "stock-negative" : ""}">${stockNum(isReservation ? availableAfter : physicalAfter)} ${unit}</strong>`;
      };

      typeInput.addEventListener("change", updateMutationForm);
      deltaInput.addEventListener("input", updateMutationForm);
      updateMutationForm();

      document.getElementById("mutCancel")?.addEventListener("click", () => openStockDetail(item.id));
      document.getElementById("mutForm")?.addEventListener("submit", async event => {
        event.preventDefault();
        const raw = Object.fromEntries(new FormData(event.target).entries());
        const entered = Number(raw.delta);
        const delta = raw.type === "correctie"
          ? entered
          : raw.type === "aanvulling"
            ? Math.abs(entered)
            : -Math.abs(entered);
        const payload = {
          type: raw.type,
          delta,
          reason: raw.reason,
          workorderId: raw.workorderId || null,
          venueId: raw.venueId || null
        };

        const submit = document.getElementById("mutSubmit");
        submit.disabled = true;
        try {
          await api("POST", `/stock/${item.id}/mutations`, payload);
          window.showToast("Voorraadmutatie verwerkt.", "success");
          await renderStock();
          openStockDetail(item.id);
        } catch (error) {
          submit.disabled = false;
          window.showToast(error.message, "error");
        }
      });
    } catch (error) {
      body.innerHTML = `<div style="padding:24px;color:var(--wf-red)">${esc(error.message)}</div>`;
    }
  }

  

  // ── Factuur PDF afdrukken ──────────────────────────────────
  function printInvoicePDF(inv, tenant = {}) {
    const fE = n => new Intl.NumberFormat("nl-BE",{style:"currency",currency:"EUR"}).format(Number(n||0));
    const fD = iso => iso ? new Date(iso).toLocaleDateString("nl-BE",{day:"2-digit",month:"2-digit",year:"numeric"}) : "-";
    const stLabel = { open:"Openstaand", paid:"Betaald", overdue:"Vervallen", draft:"Concept", sent:"Verstuurd" };
    const stColor = { open:"var(--wf-yellow)", paid:"var(--wf-green)", overdue:"var(--wf-red)", draft:"var(--gray-400)", sent:"var(--wf-blue)" };
    const lines = inv.lines || [];
    const win = window.open("", "_blank");
    win.document.write(`<!DOCTYPE html><html lang="nl"><head><meta charset="UTF-8">
<title>Factuur ${esc(inv.number||"")}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1e293b;background:#fff;padding:32px 40px}
  .page{max-width:750px;margin:0 auto}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}
  .brand{font-size:22px;font-weight:600;color:#0071e3}
  .brand-sub{font-size:12px;color:#64748b;margin-top:2px}
  .invoice-meta{text-align:right}
  .invoice-nr{font-size:20px;font-weight:600;color:#0f172a}
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
  .totals-row.total{font-weight:600;font-size:15px;border-top:2px solid #0f172a;padding-top:8px;margin-top:4px}
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
      <div class="party-name">${esc(inv.customerName||"-")}</div>
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
    open:    { key:"adm.inv.st.open",    label:"Open",     css:"adm-status-open" },
    paid:    { key:"adm.inv.st.paid",    label:"Betaald",  css:"adm-status-goedgekeurd" },
    overdue: { key:"adm.inv.st.overdue", label:"Vervallen",css:"adm-status-inactive" },
    draft:   { key:"adm.inv.st.draft",   label:"Concept",  css:"adm-status-pending" },
    sent:    { key:"adm.inv.st.sent",    label:"Verstuurd",css:"adm-status-pending" }
  };
  // Vertaalde factuurstatus (label uit i18n, css uit de map).
  function invStat(s) {
    const base = INV_STATUS[s] || { label: s, css: "adm-status-pending" };
    return { label: base.key ? tA(base.key, base.label) : base.label, css: base.css };
  }

  // ── Offertes ───────────────────────────────────────────────
  const QUOTE_STATUS = {
    concept:   { key:"adm.quote.st.concept",   label:"Concept",   css:"adm-status-pending" },
    verzonden: { key:"adm.quote.st.verzonden", label:"Verzonden", css:"adm-status-open" },
    aanvaard:  { key:"adm.quote.st.aanvaard",  label:"Aanvaard",  css:"adm-status-goedgekeurd" },
    geweigerd: { key:"adm.quote.st.geweigerd", label:"Geweigerd", css:"adm-status-geweigerd" },
    verlopen:  { key:"adm.quote.st.verlopen",  label:"Verlopen",  css:"adm-status-inactive" }
  };
  function quoteStat(s) {
    const base = QUOTE_STATUS[s] || { label: s, css: "adm-status-pending" };
    return { label: base.key ? tA(base.key, base.label) : base.label, css: base.css };
  }

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
  <div class="adm-kpi adm-kpi-amber"><div class="adm-kpi-label">${tA("adm.cust.outstandingCap","Openstaand")}</div><div class="adm-kpi-value" style="font-size:18px">${fmtEurInv(openVal)}</div><div class="adm-kpi-sub">${openCount} ${tA("adm.quote.st.verzonden","Verzonden").toLowerCase()}</div></div>
  <div class="adm-kpi adm-kpi-green"><div class="adm-kpi-label">${tA("adm.quote.st.aanvaard","Aanvaard")}</div><div class="adm-kpi-value" style="font-size:18px">${fmtEurInv(acceptedVal)}</div><div class="adm-kpi-sub">${rows.filter(r=>r.status==="aanvaard").length} ${tA("nav.offertes","Offertes").toLowerCase()}</div></div>
  <div class="adm-kpi adm-kpi-blue"><div class="adm-kpi-label">${tA("adm.quote.conversion","Conversie")}</div><div class="adm-kpi-value">${rows.length?Math.round(rows.filter(r=>r.status==="aanvaard").length/rows.length*100):0}%</div><div class="adm-kpi-sub">${tA("adm.quote.convSub","aanvaard / totaal")}</div></div>
  <div class="adm-kpi adm-kpi-purple"><div class="adm-kpi-label">${tA("adm.quote.totalQuotes","Totaal offertes")}</div><div class="adm-kpi-value">${rows.length}</div><div class="adm-kpi-sub">${tA("adm.quote.allStatuses","alle statussen")}</div></div>
</div>
<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">${tA("nav.offertes","Offertes")} <span style="background:var(--wf-yellow-l);color:var(--wf-yellow);border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${filtered.length}</span></h3>
    <select id="qStatusFilter">
      <option value="">${tA("adm.allStatuses","Alle statussen")}</option>
      ${["concept","verzonden","aanvaard","geweigerd","verlopen"].map(s=>`<option value="${s}" ${filterSel===s?"selected":""}>${quoteStat(s).label}</option>`).join("")}
    </select>
  </div>
  ${filtered.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-text">${tA("adm.quote.empty","Nog geen offertes")}</div><button class="adm-btn adm-btn-primary adm-btn-sm" id="admEmptyNewQuote" style="margin-top:12px">+ ${tA("adm.quote.emptyBtn","Eerste offerte aanmaken")}</button></div>`
    : `<div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>${tA("adm.thNr","Nr.")}</th><th>${tA("adm.date","Datum")}</th><th>${tA("adm.thCustomer","Klant")}</th><th>${tA("adm.quote.validUntil","Geldig tot")}</th><th>${tA("adm.amount","Bedrag")}</th><th>${tA("adm.status","Status")}</th><th>${tA("adm.actions","Acties")}</th></tr></thead>
        <tbody>${filtered.slice().sort((a,b)=>(b.quoteDate||"").localeCompare(a.quoteDate||"")).map(q => {
          const st = quoteStat(q.status);
          const canConvert = q.status === "aanvaard";
          return `<tr class="adm-row-link q-row" data-id="${q.id}" title="${tA("adm.quote.open","Open offerte")}">
            <td style="font-family:monospace;font-weight:600">${esc(q.number||"")}</td>
            <td>${q.quoteDate?new Date(q.quoteDate).toLocaleDateString("nl-BE"):"-"}</td>
            <td><strong>${esc(q.customerName||"-")}</strong></td>
            <td style="${q.status==="verlopen"?"color:var(--wf-red);font-weight:600":""}">${q.validUntil?new Date(q.validUntil).toLocaleDateString("nl-BE"):"-"}</td>
            <td style="font-weight:600">${fmtEurInv(q.total)}</td>
            <td><span class="adm-status ${st.css}">${st.label}</span>${q.invoiceId?`<div style="font-size:10px;color:var(--gray-400)">→ ${tA("adm.cust.invoiced","gefactureerd")}</div>`:""}</td>
            <td style="white-space:nowrap;display:flex;gap:5px;flex-wrap:wrap;">
              <button class="adm-btn adm-btn-secondary adm-btn-sm q-edit" data-id="${q.id}" title="${tA("adm.editShort","Bewerk")}">${tA("adm.edit","Bewerken")}</button>
              <button class="adm-btn adm-btn-secondary adm-btn-sm q-pdf" data-id="${q.id}" title="${tA("adm.pdfPrint","PDF / Afdrukken")}"><svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg></button>
              ${["concept","verzonden"].includes(q.status)?`<button class="adm-btn adm-btn-secondary adm-btn-sm q-send" data-id="${q.id}" title="${tA("adm.quote.sendLink","Versturen + link")}"><svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>`:""}
              ${canConvert && !q.invoiceId?`<button class="adm-btn adm-btn-success adm-btn-sm q-toinv" data-id="${q.id}" title="${tA("adm.quote.toInvoice","Naar factuur")}">→ ${tA("adm.wo.toInvoice","Factuur")}</button>`:""}
              ${canConvert && !q.workorderId?`<button class="adm-btn adm-btn-secondary adm-btn-sm q-towo" data-id="${q.id}" title="${tA("adm.quote.toWo","Naar werkbon")}">→ ${(window.wfpTerms && window.wfpTerms.t("jobSingular")) || tA("emp.wo.default","Werkbon")}</button>`:""}
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
          window.showToast && window.showToast(tA("adm.quote.sentToast","Offerte verzonden ✓ · accepteer-link gekopieerd"), "success");
          renderOffertes();
        } catch(e){ window.showToast && window.showToast(tA("adm.error","Fout")+": "+e.message, "error"); }
      }));
      content.querySelectorAll(".q-toinv").forEach(b => b.addEventListener("click", async () => {
        if(!await uiConfirm(tA("adm.quote.toInvConfirm","Offerte omzetten naar factuur?"), { title: "Offerte omzetten", confirmLabel: "Factuur aanmaken" })) return;
        try { const d = await api("POST", `/offertes/${b.dataset.id}/convert`, { target:"invoice" }); window.showToast && window.showToast(tA("adm.wo.toInvoice","Factuur")+" "+(d.invoice?.number||"")+" "+tA("adm.created","aangemaakt"),"success"); switchView("facturen"); }
        catch(e){ window.showToast && window.showToast(tA("adm.error","Fout")+": "+e.message,"error"); }
      }));
      content.querySelectorAll(".q-towo").forEach(b => b.addEventListener("click", async () => {
        if(!await uiConfirm(tA("adm.quote.toWoConfirm","Offerte omzetten naar werkbon?"), { title: "Offerte omzetten", confirmLabel: "Werkbon aanmaken" })) return;
        try { const d = await api("POST", `/offertes/${b.dataset.id}/convert`, { target:"workorder" }); window.showToast && window.showToast(((window.wfpTerms && window.wfpTerms.t("jobSingular")) || tA("emp.wo.default","Werkbon"))+" "+(d.workorder?.number||"")+" "+tA("adm.created","aangemaakt"),"success"); switchView("workorders"); }
        catch(e){ window.showToast && window.showToast(tA("adm.error","Fout")+": "+e.message,"error"); }
      }));
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:var(--wf-red)">${tA("adm.error","Fout")}: ${e.message}</div>`; }
  }

  async function openOfferteDrawer(quote, prefill = {}) {
    let customers = [];
    try { const d = await api("GET", "/customers"); customers = d.customers || []; } catch(_){}
    const today = new Date().toISOString().slice(0,10);
    const valid30 = new Date(Date.now()+30*86400000).toISOString().slice(0,10);
    const lines0 = quote?.lines || [{ description:"", qty:1, unitPrice:0, vatRate:21 }];
    const isEdit = !!quote;
    document.getElementById("admDrawerTitle").textContent = isEdit ? `${tA("adm.quote.singular","Offerte")} ${quote.number}` : tA("adm.quote.newTitle","Nieuwe offerte");

    const lineRow = (l) => `<div class="q-line-row adm-document-line">
        <input placeholder="${tA("adm.quote.description","Omschrijving")}" value="${esc(l.description||"")}" class="q-line-desc" ${isEdit?"disabled":""}>
        <input type="number" min="1" value="${l.qty||1}" class="q-line-qty" style="text-align:right" ${isEdit?"disabled":""}>
        <input type="number" min="0" step="0.01" value="${Number(l.unitPrice||0).toFixed(2)}" class="q-line-price" style="text-align:right" ${isEdit?"disabled":""}>
        <select class="q-line-vat" style="font-size:12px" ${isEdit?"disabled":""}>
          ${[0,6,12,21].map(v=>`<option value="${v}" ${(l.vatRate==v||(v==21&&l.vatRate==null))?"selected":""}>${v}%</option>`).join("")}
        </select>
        <button type="button" class="q-line-del" style="background:none;border:none;cursor:pointer;color:var(--gray-400);font-size:16px;padding:0;" ${isEdit?"disabled":""}>&times;</button>
      </div>`;

    document.getElementById("admDrawerBody").innerHTML = `
<form id="qForm">
  <div class="adm-form-group"><label>${tA("adm.thCustomer","Klant")} *</label>
    <select name="customerId" id="qCustSel" style="width:100%" ${isEdit?"disabled":""}>
      <option value="">${tA("adm.quote.manualFill","- Handmatig invullen -")}</option>
      ${customers.map(c=>`<option value="${c.id}" ${(quote?.customerId || prefill.customerId)===c.id?"selected":""}>${esc(c.name)}</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-group"><label>${tA("adm.quote.customerName","Klantnaam")} *</label>
    <input name="customerName" value="${esc(quote?.customerName || prefill.customerName || "")}" placeholder="${tA("adm.quote.companyPh","Bedrijfsnaam NV")}" required ${isEdit?"disabled":""}>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${tA("adm.cust.vatNumber","BTW-nummer")}</label><input name="customerVatNumber" value="${esc(quote?.customerVatNumber || prefill.customerVatNumber || "")}" placeholder="BE0000.000.000" ${isEdit?"disabled":""}></div>
    <div class="adm-form-group"><label>${tA("adm.cust.address","Adres")}</label><input name="customerAddress" value="${esc(quote?.customerAddress || prefill.customerAddress || "")}" placeholder="${tA("adm.quote.addrPh","Straat, gemeente")}" ${isEdit?"disabled":""}></div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group"><label>${tA("adm.quote.quoteDate","Offertedatum")}</label><input type="date" name="quoteDate" value="${quote?.quoteDate||today}" ${isEdit?"disabled":""}></div>
    <div class="adm-form-group"><label>${tA("adm.quote.validUntil","Geldig tot")}</label><input type="date" name="validUntil" value="${quote?.validUntil||valid30}" ${isEdit?"disabled":""}></div>
  </div>
  <div class="adm-form-section">${tA("adm.quote.lines","Offerteregels")}</div>
  <div id="qLines">${lines0.map(lineRow).join("")}</div>
  ${!isEdit?`<button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" id="qAddLine" style="margin-bottom:16px;">+ ${tA("adm.quote.addLine","Regel toevoegen")}</button>`:""}
  <div style="background:var(--gray-50);border-radius:10px;padding:12px;margin-bottom:16px;">
    <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--gray-500);margin-bottom:4px;"><span>${tA("adm.subtotal","Subtotaal")}</span><span id="qSubtotal">€0,00</span></div>
    <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--gray-500);margin-bottom:4px;"><span>${tA("adm.vat","BTW")}</span><span id="qVat">€0,00</span></div>
    <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:600;border-top:1px solid var(--gray-200);padding-top:8px;margin-top:4px;"><span>${tA("adm.total","Totaal")}</span><span id="qTotal">€0,00</span></div>
  </div>
  <div class="adm-form-group"><label>${tA("adm.quote.notes","Opmerkingen")}</label>
    <textarea name="notes" rows="2" style="width:100%" ${isEdit?"disabled":""}>${esc(quote?.notes||"")}</textarea>
  </div>
  <div id="qFormErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions" style="flex-wrap:wrap;gap:8px;">
    <button type="button" class="adm-btn adm-btn-secondary" id="qCancel">${tA("adm.close","Sluiten")}</button>
    ${isEdit && !["aanvaard"].includes(quote.status)?`<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="qDelete">${tA("adm.delete","Verwijderen")}</button>`:""}
    ${!isEdit?`<button type="submit" class="adm-btn adm-btn-primary">${tA("adm.createBtn","Aanmaken")}</button>`:""}
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
      if(!await uiConfirm(tA("adm.quote.deleteConfirm","Offerte {n} verwijderen?").replace("{n}", quote.number), { title: "Offerte verwijderen", danger: true, confirmLabel: tA("adm.delete","Verwijderen") })) return;
      try { await api("DELETE", `/offertes/${quote.id}`); closeDrawer(); renderOffertes(); }
      catch(err){ const e=document.getElementById("qFormErr"); if(e){e.textContent=err.message;e.style.display="";} }
    });
    document.getElementById("qForm")?.addEventListener("submit", async e => {
      e.preventDefault();
      const errEl=document.getElementById("qFormErr");
      const submitButton=e.submitter;
      const submitLabel=submitButton?.textContent;
      if(submitButton){ submitButton.disabled=true; submitButton.textContent=tA("adm.busy","Bezig…"); }
      const body=Object.fromEntries(new FormData(e.target).entries());
      body.lines=Array.from(document.querySelectorAll(".q-line-row")).map(r=>({
        description:r.querySelector(".q-line-desc").value,
        qty:Number(r.querySelector(".q-line-qty").value||1),
        unitPrice:Number(r.querySelector(".q-line-price").value||0),
        vatRate:Number(r.querySelector(".q-line-vat").value||21)
      }));
      try { await api("POST", "/offertes", body); closeDrawer(); renderOffertes(); window.showToast && window.showToast(tA("adm.quote.createdToast","Offerte aangemaakt"),"success"); }
      catch(err){ if(errEl){errEl.textContent=err.message;errEl.style.display="";} if(submitButton){submitButton.disabled=false;submitButton.textContent=submitLabel;} }
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
    <div class="adm-kpi-label">${tA("adm.inv.st.paid","Betaald")}</div>
    <div class="adm-kpi-value" style="font-size:18px">${fmtEurInv(totalRevenue)}</div>
    <div class="adm-kpi-sub">${rows.filter(r=>r.status==="paid").length} ${tA("nav.facturen","Facturen").toLowerCase()}</div>
  </div>
  <div class="adm-kpi adm-kpi-blue">
    <div class="adm-kpi-label">${tA("adm.cust.outstandingCap","Openstaand")}</div>
    <div class="adm-kpi-value" style="font-size:18px">${fmtEurInv(openAmount)}</div>
    <div class="adm-kpi-sub">${rows.filter(r=>r.status==="open").length} ${tA("nav.facturen","Facturen").toLowerCase()}</div>
  </div>
  <div class="adm-kpi ${overdueAmount>0?"adm-kpi-red":"adm-kpi-amber"}">
    <div class="adm-kpi-label">${tA("adm.inv.st.overdue","Vervallen")}</div>
    <div class="adm-kpi-value" style="font-size:18px">${fmtEurInv(overdueAmount)}</div>
    <div class="adm-kpi-sub">${rows.filter(r=>r.status==="overdue").length} ${tA("nav.facturen","Facturen").toLowerCase()}</div>
  </div>
  <div class="adm-kpi adm-kpi-purple">
    <div class="adm-kpi-label">${tA("adm.inv.totalInvoices","Totaal facturen")}</div>
    <div class="adm-kpi-value">${rows.length}</div>
    <div class="adm-kpi-sub">${tA("adm.allStatuses","Alle statussen")}</div>
  </div>
</div>

<div class="adm-card">
  <div class="adm-card-header">
    <h3 class="adm-card-title">${tA("nav.facturen","Facturen")} <span style="background:var(--wf-purple-l);color:var(--wf-purple);border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;">${filtered.length}</span></h3>
    <div style="display:flex;gap:8px;align-items:center;">
      <select id="invStatusFilter">
        <option value="">${tA("adm.allStatuses","Alle statussen")}</option>
        <option value="open" ${filterSel==="open"?"selected":""}>${tA("adm.inv.st.open","Open")}</option>
        <option value="paid" ${filterSel==="paid"?"selected":""}>${tA("adm.inv.st.paid","Betaald")}</option>
        <option value="overdue" ${filterSel==="overdue"?"selected":""}>${tA("adm.inv.st.overdue","Vervallen")}</option>
        <option value="draft" ${filterSel==="draft"?"selected":""}>${tA("adm.inv.st.draft","Concept")}</option>
      </select>
    </div>
  </div>
  ${filtered.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-text">${tA("adm.inv.empty","Nog geen facturen")}</div><button class="adm-btn adm-btn-primary adm-btn-sm" id="admEmptyNewInv" style="margin-top:12px">+ ${tA("adm.inv.emptyBtn","Eerste factuur aanmaken")}</button></div>`
    : `<div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>${tA("adm.thNr","Nr.")}</th><th>${tA("adm.date","Datum")}</th><th>${tA("adm.thCustomer","Klant")}</th><th>${tA("adm.inv.due","Vervaldatum")}</th><th>${tA("adm.amount","Bedrag")}</th><th>${tA("adm.status","Status")}</th><th>${tA("adm.actions","Acties")}</th></tr></thead>
        <tbody>${filtered.slice().sort((a,b) => (b.invoiceDate||"").localeCompare(a.invoiceDate||"")).map(inv => {
          const st = invStat(inv.status);
          return `<tr class="adm-row-link inv-row" data-id="${inv.id}" title="${tA("adm.inv.open","Open factuur")}">
            <td style="font-family:monospace;font-weight:600">${esc(inv.number||inv.id.slice(-6))}</td>
            <td>${inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString("nl-BE") : "-"}</td>
            <td><strong>${esc(inv.customerName||"-")}</strong>${inv.customerVatNumber?`<div style="font-size:11px;color:var(--gray-400)">${esc(inv.customerVatNumber)}</div>`:""}</td>
            <td style="${inv.status==="overdue"?"color:var(--wf-red);font-weight:600":""}">${inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("nl-BE") : "-"}</td>
            <td style="font-weight:600">${fmtEurInv(inv.total)}</td>
            <td><span class="adm-status ${st.css}">${st.label}</span></td>
            <td style="white-space:nowrap;display:flex;gap:6px;">
              <button class="adm-btn adm-btn-secondary adm-btn-sm inv-edit" data-id="${inv.id}">${tA("adm.edit","Bewerken")}</button>
              <button class="adm-btn adm-btn-secondary adm-btn-sm inv-pdf" data-id="${inv.id}" title="${tA("adm.pdfPrint","PDF / Afdrukken")}"><svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:currentColor"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg></button>
              ${inv.peppolStatus === "delivered" || inv.peppolStatus === "sent"
                ? `<span class="adm-status adm-status-active" title="Peppol: ${esc(inv.peppolReference||"")}">Peppol ✓</span>`
                : (subEnabled("invoices","peppol") ? `<button class="adm-btn adm-btn-secondary adm-btn-sm inv-peppol" data-id="${inv.id}" title="${tA("adm.inv.peppolSend","Verstuur via Peppol e-facturatie")}">Peppol</button>` : "")}
              <button class="adm-btn adm-btn-secondary adm-btn-sm inv-ubl" data-id="${inv.id}" title="${tA("adm.inv.ublDownload","UBL-XML downloaden")}">UBL</button>
              ${["open","overdue"].includes(inv.status) && subEnabled("invoices","online-payment") ? `<button class="adm-btn adm-btn-secondary adm-btn-sm inv-paylink" data-id="${inv.id}" title="${tA("adm.inv.payLinkGen","Betaallink genereren")}">${tA("adm.inv.link","Link")}</button>` : ""}
              ${["open","overdue"].includes(inv.status) ? `<button class="adm-btn adm-btn-success adm-btn-sm inv-paid" data-id="${inv.id}" title="${tA("adm.inv.markPaid","Markeer als betaald")}">${tA("adm.inv.st.paid","Betaald")}</button>` : ""}
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
          btn.disabled = true; const old = btn.textContent; btn.textContent = tA("adm.inv.sending","Versturen…");
          try {
            const d = await api("POST", `/facturen/${btn.dataset.id}/peppol`, {});
            const via = d.provider === "mock" ? "mock-transport" : d.provider;
            window.showToast && window.showToast(tA("adm.inv.peppolSent","Verstuurd via Peppol ({via}) · status: {status} · ref {ref}").replace("{via}",via).replace("{status}",d.status).replace("{ref}",d.reference), "success");
            renderFacturen();
          } catch(e) {
            const extra = (e.errors && e.errors.length) ? "\n\n• " + e.errors.join("\n• ") : "";
            window.showToast && window.showToast("Peppol: " + e.message, "error");
            if (extra) window.showToast(tA("adm.inv.peppolValidation","Peppol-validatie:") + extra, "warning");
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
          } catch(e) { window.showToast && window.showToast(tA("adm.inv.ublError","UBL-download fout")+": "+e.message, "error"); }
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
            window.showToast && window.showToast(tA("adm.inv.payLink","Betaallink")+` (${via}) ${copied?tA("adm.inv.copied","gekopieerd"):tA("adm.created","aangemaakt")}: ${d.url}`, "success");
          } catch(e) { window.showToast && window.showToast(tA("adm.error","Fout")+": "+e.message, "error"); }
          btn.disabled = false; btn.textContent = old;
        });
      });
      document.querySelectorAll(".inv-paid").forEach(btn => {
        btn.addEventListener("click", async () => {
          if (!await uiConfirm(tA("adm.inv.markPaidConfirm","Factuur als betaald markeren?"), { title: "Betaalstatus aanpassen", confirmLabel: "Als betaald markeren" })) return;
          await api("PATCH", `/facturen/${btn.dataset.id}`, { status: "paid" });
          renderFacturen();
        });
      });
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:var(--wf-red)">${tA("adm.error","Fout")}: ${e.message}</div>`; }
  }

  async function openFactuurDrawer(invoice, prefill = {}) {
    // Load customers for dropdown
    let customers = [];
    try { const d = await api("GET", "/customers"); customers = d.customers || []; } catch(_){}

    document.getElementById("admDrawerTitle").textContent = invoice ? `${tA("adm.inv.singular","Factuur")} ${invoice.number}` : tA("adm.inv.newTitle","Nieuwe factuur");
    const today = new Date().toISOString().slice(0, 10);
    const due30 = new Date(Date.now() + 30*86400000).toISOString().slice(0, 10);

    const existingLines = invoice?.lines || prefill.prefillLines || [{ description: "", qty: 1, unitPrice: 0, vatRate: 21 }];

    document.getElementById("admDrawerBody").innerHTML = `
<form id="invForm">
  <div class="adm-form-group">
    <label>${tA("adm.thCustomer","Klant")} *</label>
    <select name="customerId" id="invCustSel" style="width:100%">
      <option value="">${tA("adm.quote.manualFill","- Handmatig invullen -")}</option>
      ${customers.map(c => `<option value="${c.id}" ${(invoice?.customerId || prefill.customerId)===c.id?"selected":""}>${esc(c.name)}</option>`).join("")}
    </select>
  </div>
  <div class="adm-form-group" id="invCustNameWrap">
    <label>${tA("adm.quote.customerName","Klantnaam")} *</label>
    <input name="customerName" id="invCustName" value="${esc(invoice?.customerName||prefill.prefillCustomerName||"")}" placeholder="${tA("adm.quote.companyPh","Bedrijfsnaam NV")}" required>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group">
      <label>${tA("adm.inv.custVat","BTW-nummer klant")}</label>
      <input name="customerVatNumber" value="${esc(invoice?.customerVatNumber||prefill.prefillCustomerVat||"")}" placeholder="BE0000.000.000">
    </div>
    <div class="adm-form-group">
      <label>${tA("adm.inv.custAddr","Adres klant")}</label>
      <input name="customerAddress" value="${esc(invoice?.customerAddress||prefill.prefillCustomerAddress||"")}" placeholder="${tA("adm.quote.addrPh","Straat, gemeente")}">
    </div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group">
      <label>${tA("adm.inv.invDate","Factuurdatum")}</label>
      <input type="date" name="invoiceDate" value="${invoice?.invoiceDate||today}">
    </div>
    <div class="adm-form-group">
      <label>${tA("adm.inv.due","Vervaldatum")}</label>
      <input type="date" name="dueDate" value="${invoice?.dueDate||due30}">
    </div>
  </div>
  <div class="adm-form-row">
    <div class="adm-form-group">
      <label>${tA("adm.inv.vatRegime","BTW-regime")}</label>
      <select name="vatRegime" id="invVatRegime" ${invoice?"disabled":""}>
        <option value="binnen" ${(invoice?.vatRegime&&invoice.vatRegime!=="binnen")?"":"selected"}>${tA("adm.inv.vatDomestic","Binnenland (btw per regel)")}</option>
        <option value="intracom" ${invoice?.vatRegime==="intracom"?"selected":""}>${tA("adm.inv.vatIntracom","Intracommunautair · btw verlegd (0%)")}</option>
        <option value="medecontractant" ${invoice?.vatRegime==="medecontractant"?"selected":""}>${tA("adm.inv.vatMedecon","Medecontractant (bouw, KB nr. 1 art. 20) · btw verlegd (0%)")}</option>
      </select>
    </div>
    <div class="adm-form-group" style="align-self:flex-end;padding-bottom:7px;font-size:11.5px;color:var(--gray-500);">${tA("adm.inv.vatHint","Bij 'btw verlegd' wordt 0% btw toegepast met de wettelijke vermelding op de factuur.")}</div>
  </div>
  ${invoice?.structuredComm ? `<div style="background:var(--wf-blue-l);border:1px solid var(--wf-blue-l);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:12.5px;">
    <span style="color:var(--gray-500);">${tA("adm.inv.structComm","Gestructureerde mededeling")}:</span> <strong style="font-family:monospace;font-size:13px;">${esc(invoice.structuredComm)}</strong>
    ${invoice.vatNote ? `<div style="color:var(--wf-yellow);margin-top:4px;"><${esc(invoice.vatNote)}</div>` : ""}
  </div>` : ""}

  <div class="adm-form-section">${tA("adm.inv.lines","Factuurregels")}</div>
  <div id="invLines">
    ${existingLines.map((l, i) => renderInvLine(l, i)).join("")}
  </div>
  <button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" id="invAddLine" style="margin-bottom:16px;">+ ${tA("adm.quote.addLine","Regel toevoegen")}</button>

  <div style="background:var(--gray-50);border-radius:10px;padding:12px;margin-bottom:16px;" id="invTotals">
    <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--gray-500);margin-bottom:4px;">
      <span>${tA("adm.subtotal","Subtotaal")}</span><span id="invSubtotal">€0,00</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--gray-500);margin-bottom:4px;">
      <span>${tA("adm.vat","BTW")}</span><span id="invVat">€0,00</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:600;color:var(--gray-900);border-top:1px solid var(--gray-200);padding-top:8px;margin-top:4px;">
      <span>${tA("adm.total","Totaal")}</span><span id="invTotal">€0,00</span>
    </div>
  </div>

  <div class="adm-form-group">
    <label>${tA("adm.quote.notes","Opmerkingen")}</label>
    <textarea name="notes" rows="2" style="width:100%">${esc(invoice?.notes||prefill.prefillNotes||"")}</textarea>
  </div>
  ${prefill.workorderId ? `<input type="hidden" name="workorderId" value="${esc(prefill.workorderId)}">` : ""}
  <div id="invFormErr" style="display:none;background:var(--wf-red-l);color:var(--wf-red);border-radius:8px;padding:8px;font-size:12px;margin-bottom:8px;"></div>
  <div class="adm-form-actions">
    <button type="button" class="adm-btn adm-btn-secondary" id="invCancel">${tA("adm.cancel","Annuleren")}</button>
    ${invoice && invoice.status !== "paid" ? `<button type="button" class="adm-btn adm-btn-danger adm-btn-sm" id="invDelete">${tA("adm.delete","Verwijderen")}</button>` : ""}
    ${!invoice ? `<button type="submit" class="adm-btn adm-btn-primary">${tA("adm.createBtn","Aanmaken")}</button>` : ""}
  </div>
</form>`;

    function renderInvLine(l, i) {
      return `<div class="inv-line-row adm-document-line" data-idx="${i}">
        <input placeholder="${tA("adm.quote.description","Omschrijving")}" value="${esc(l.description||"")}" class="inv-line-desc">
        <input type="number" min="1" placeholder="Qty" value="${l.qty||1}" class="inv-line-qty" style="text-align:right">
        <input type="number" min="0" step="0.01" placeholder="${tA("adm.inv.price","Prijs")}" value="${Number(l.unitPrice||0).toFixed(2)}" class="inv-line-price" style="text-align:right">
        <select class="inv-line-vat" style="font-size:12px">
          <option value="0" ${l.vatRate==0?"selected":""}>0%</option>
          <option value="6" ${l.vatRate==6?"selected":""}>6%</option>
          <option value="12" ${l.vatRate==12?"selected":""}>12%</option>
          <option value="21" ${(l.vatRate==21||l.vatRate==null||l.vatRate==undefined)?"selected":""}>21%</option>
        </select>
        <button type="button" class="inv-line-del" style="background:none;border:none;cursor:pointer;color:var(--gray-400);font-size:16px;padding:0;" title="${tA("adm.delete","Verwijderen")}">&times;</button>
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
      if (!await uiConfirm(tA("adm.inv.deleteConfirm","Factuur {n} verwijderen?").replace("{n}", invoice.number), { title: "Factuur verwijderen", danger: true, confirmLabel: tA("adm.delete","Verwijderen") })) return;
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
      const submitButton = e.submitter;
      const submitLabel = submitButton?.textContent;
      if (submitButton) { submitButton.disabled = true; submitButton.textContent = tA("adm.busy","Bezig…"); }
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
        window.showToast && window.showToast(tA("adm.inv.createdToast","Factuur aangemaakt"), "success");
      } catch(err) {
        if (errEl) { errEl.textContent = err.message; errEl.style.display = ""; }
        if (submitButton) { submitButton.disabled = false; submitButton.textContent = submitLabel; }
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
      const phaseIcons = { foundation:"", core_operations:"", billing_compliance:"", pilot_launch:"", commercial_launch:"" };

      content.innerHTML = `
<div style="margin-bottom:20px;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;">
  <div>
    <div style="font-size:18px;font-weight:600;color:var(--gray-900);margin-bottom:4px;">Roadmap · ${esc(rm.tenant?.name||"")}</div>
    <div style="font-size:13px;color:var(--gray-500);">Gegenereerd op ${new Date(rm.generatedAt||Date.now()).toLocaleString("nl-BE")} · ${rm.summary?.go||0}/${rm.summary?.total||0} fasen gereed · ${rm.summary?.openActions||0} open acties</div>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="rmRefresh">Vernieuwen</button>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="rmBackfill" title="Herstel datakwaliteit: werkbon-nummers, notificatie-userId, verlof-dagen">Data repareren</button>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="rmDemoData" title="Vult alle schermen met realistische voorbeelddata (klanten, offertes, facturen, planning, klok…)">Demodata laden</button>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="rmDemoClear" title="Verwijdert alle geladen demodata weer">Demodata wissen</button>
  </div>
</div>

${phases.map(p => {
  const isGo = p.go;
  const icon = phaseIcons[p.key]||"";
  const isCurrent = p.key === rm.currentPhase;
  return `
<div style="margin-bottom:16px;border-radius:12px;border:2px solid ${isGo?"var(--wf-green-l)":isCurrent?"var(--wf-yellow-l)":"var(--gray-100)"};overflow:hidden;">
  <div style="background:${isGo?"var(--wf-green-l)":isCurrent?"var(--wf-yellow-l)":"var(--gray-100)"};padding:14px 18px;display:flex;align-items:center;gap:12px;">
    <span style="font-size:20px;">${icon}</span>
    <div style="flex:1;">
      <div style="font-size:15px;font-weight:700;color:var(--gray-900);">${esc(p.label)}${isCurrent?` <span style="background:var(--wf-yellow);color:#fff;border-radius:4px;font-size:10px;padding:1px 6px;font-weight:700;vertical-align:middle;margin-left:6px;">HUIDIGE FASE</span>`:""}</div>
      <div style="font-size:12px;color:var(--gray-500);margin-top:2px;">${esc(p.detail||"")}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:22px;font-weight:600;color:${isGo?"var(--wf-green)":isCurrent?"var(--wf-yellow)":"var(--gray-400)"};">${p.score}%</div>
      <div style="font-size:11px;font-weight:600;color:${isGo?"var(--wf-green)":"var(--wf-red)"};">${isGo?"GO":"NO GO"}</div>
    </div>
  </div>
  <!-- Progress bar -->
  <div style="height:6px;background:var(--gray-200);">
    <div style="height:100%;width:${p.score}%;background:${isGo?"var(--wf-green)":isCurrent?"var(--wf-yellow)":"var(--wf-purple)"};transition:width .5s;"></div>
  </div>
  <!-- Open actions -->
  ${p.actions?.length ? `
  <div style="padding:12px 18px;">
    <div style="font-size:11px;font-weight:700;color:var(--gray-400);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">${p.actions.length} OPEN ${p.actions.length===1?"ACTIE":"ACTIES"}</div>
    ${p.actions.map(a=>`
    <div style="display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--gray-50);">
      <span style="background:${a.priority==="P0"?"var(--wf-red-l)":"var(--wf-yellow-l)"};color:${a.priority==="P0"?"var(--wf-red)":"var(--wf-yellow)"};border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700;flex-shrink:0;height:fit-content;">${esc(a.priority||"P1")}</span>
      <div>
        <div style="font-size:13px;font-weight:600;color:var(--gray-900);">${esc(a.label||"")}</div>
        <div style="font-size:12px;color:var(--gray-500);">${esc(a.action||"")}</div>
      </div>
    </div>`).join("")}
  </div>` : `<div style="padding:10px 18px;font-size:13px;color:var(--wf-green);font-weight:600;">Alle checks geslaagd</div>`}
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
          btn.disabled = false; btn.textContent = "Data repareren";
        } catch(e) { window.showToast && window.showToast("Fout: "+e.message,"error"); btn.disabled=false; btn.textContent="Data repareren"; }
      });
      document.getElementById("rmDemoData")?.addEventListener("click", async () => {
        if (!await uiConfirm("Dit vult alle schermen met realistische voorbeelddata: klanten, offertes, facturen, werkbonnen, planning, klokregistraties, verlof, onkosten, stock en voertuigen. Je kunt dit achteraf wissen via Demodata wissen.", { title: "Demodata laden", confirmLabel: "Demodata laden" })) return;
        const btn = document.getElementById("rmDemoData");
        btn.disabled = true; btn.textContent = "Laden…";
        try {
          const r = await api("POST", "/demo/seed");
          const total = Object.values(r.counts||{}).reduce((a,b)=>a+b,0);
          window.showToast && window.showToast(`Demodata geladen ✓ (${total} records over ${Object.keys(r.counts||{}).length} modules)`, "success");
          switchView("dashboard");
        } catch(e) { window.showToast && window.showToast("Fout: "+e.message, "error"); }
        btn.disabled = false; btn.textContent = "Demodata laden";
      });
      document.getElementById("rmDemoClear")?.addEventListener("click", async () => {
        if (!await uiConfirm("Alle geladen demodata verwijderen? Eigen ingevoerde data blijft staan.", { title: "Demodata wissen", danger: true, confirmLabel: "Demodata wissen" })) return;
        const btn = document.getElementById("rmDemoClear");
        btn.disabled = true; btn.textContent = "Wissen…";
        try {
          const r = await api("POST", "/demo/clear");
          window.showToast && window.showToast(`Demodata gewist ✓ (${r.removed} records)`, "success");
          renderRoadmap();
        } catch(e) { window.showToast && window.showToast("Fout: "+e.message, "error"); }
        btn.disabled = false; btn.textContent = "Demodata wissen";
      });
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:var(--wf-red)">${tA("adm.error","Fout")}: ${e.message}</div>`; }
  }

  // ── Facturatie ─────────────────────────────────────────────
  // Facturatieperiode voor de prijsweergave: "year" (jaarlijks, ~17% korting =
  // 2 maanden gratis) of "month" (maandelijks). Puur presentatie van baseAnnual.
  let _billPeriod = "year";

  async function renderBilling() {
    const content = document.getElementById("admContent");
    content.innerHTML = `<div class="adm-loading"><div class="adm-spinner"></div>${tA("adm.loading","Laden…")}</div>`;
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
      // Eerste keer (nog geen betalend abonnement) → plan starten = 14 dagen gratis trial (kaart vereist).
      const trialEligible = !["active","past_due","paid"].includes(String(billing.status||"").toLowerCase());
      // Maandbedrag: server-waarde, of val terug op de prijs van het huidige plan.
      const curPlanObj = plans.find(p => p.key === currentPlan) || null;
      const monthlyShown = billing.monthlyAmount || (curPlanObj && curPlanObj.baseMonthly) || 0;

      content.innerHTML = `
<div class="adm-kpis" style="margin-bottom:16px">
  <div class="adm-kpi adm-kpi-green"><div class="adm-kpi-label">${tA("adm.bill.currentSub","Huidig abonnement")}</div><div class="adm-kpi-value" style="font-size:18px;text-transform:capitalize">${esc(billing.plan||"-")}</div><div class="adm-kpi-sub">${esc(billing.status||"")}</div></div>
  <div class="adm-kpi adm-kpi-blue"><div class="adm-kpi-label">${tA("adm.bill.monthly","Maandprijs")}</div><div class="adm-kpi-value" style="font-size:20px">${fmtEur(monthlyShown)}</div><div class="adm-kpi-sub">${tA("adm.bill.exclVat","excl. BTW")}</div></div>
  <div class="adm-kpi adm-kpi-purple"><div class="adm-kpi-label">${tA("nav.facturen","Facturen")}</div><div class="adm-kpi-value">${invoices.length}</div><div class="adm-kpi-sub">${openInvoices.length} ${tA("adm.cust.outstanding","openstaand")}</div></div>
  <div class="adm-kpi ${hasPayment?"adm-kpi-green":"adm-kpi-amber"}"><div class="adm-kpi-label">${tA("adm.bill.paymentMethod","Betaalmethode")}</div><div class="adm-kpi-value" style="font-size:15px">${hasPayment?esc(billing.paymentMethod):tA("adm.bill.notSet","Niet ingesteld")}</div></div>
</div>

${billing.status === "trial" ? (() => {
  const daysLeft = billing.trialEndsAt ? Math.max(0, Math.ceil((new Date(billing.trialEndsAt) - Date.now()) / 86400000)) : null;
  const endStr = billing.trialEndsAt ? new Date(billing.trialEndsAt).toLocaleDateString("nl-BE") : null;
  return `<div style="background:var(--wf-yellow-l);border:1px solid var(--wf-yellow-l);border-radius:10px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
  <span style="font-size:20px"></span>
  <div>
    <div style="font-size:14px;font-weight:600;color:var(--wf-yellow)">${tA("adm.bill.trialTitle","Gratis proefperiode")}${daysLeft != null ? ` · ${tA("adm.bill.trialDaysLeft","nog {n} dagen").replace("{n}", daysLeft)}` : " " + tA("adm.bill.active","actief")}</div>
    <div style="font-size:12px;color:var(--wf-yellow);margin-top:2px">${hasPayment
      ? `${tA("adm.bill.cardOnFile","Je kaart staat geregistreerd.")} ${endStr ? tA("adm.bill.billFrom","Vanaf {d} wordt automatisch {a}/maand gefactureerd.").replace("{d}", endStr).replace("{a}", fmtEur(monthlyShown)) : tA("adm.bill.autoBillAfter","Na de proefperiode start de facturatie automatisch.")} ${tA("adm.bill.cancelAnytime","Opzeggen kan altijd in het beheerportaal.")}`
      : tA("adm.bill.pickBundleTrial","Kies hieronder je bundel. Je kaartgegevens zijn vereist om te starten · je wordt pas na 14 dagen gefactureerd en kan altijd opzeggen.")}</div>
  </div>
</div>`;
})() : ""}

<!-- Bundel kiezen -->
<div class="adm-card">
  <div class="adm-card-header"><h3 class="adm-card-title">${tA("adm.bill.pickBundle","Kies je bundel")}</h3>
    <div style="display:inline-flex;background:var(--gray-100);border-radius:980px;padding:3px;gap:2px;">
      <button class="adm-period-btn" data-per="year" style="border:none;cursor:pointer;font:600 12px inherit;padding:6px 14px;border-radius:980px;background:${_billPeriod==="year"?"var(--surface)":"transparent"};color:${_billPeriod==="year"?"var(--ink)":"var(--muted)"};box-shadow:${_billPeriod==="year"?"0 1px 2px rgba(0,0,0,.08)":"none"};">${tA("adm.bill.yearly","Jaarlijks")} <span style="color:var(--wf-green);font-weight:600;">−17%</span></button>
      <button class="adm-period-btn" data-per="month" style="border:none;cursor:pointer;font:600 12px inherit;padding:6px 14px;border-radius:980px;background:${_billPeriod==="month"?"var(--surface)":"transparent"};color:${_billPeriod==="month"?"var(--ink)":"var(--muted)"};box-shadow:${_billPeriod==="month"?"0 1px 2px rgba(0,0,0,.08)":"none"};">${tA("adm.bill.monthlyToggle","Maandelijks")}</button>
    </div>
  </div>
  <div class="adm-card-body">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;align-items:stretch;">
      ${plans.map(p => {
        const isCurrent = p.key === currentPlan;
        const accent = isCurrent ? "var(--wf-blue)" : (p.popular ? "var(--wf-blue)" : "var(--line)");
        const ring = (isCurrent || p.popular) ? "2px" : "1px";
        // Jaarlijks = baseAnnual/12 per maand (2 maanden gratis t.o.v. maandelijks);
        // maandelijks = baseAnnual/10 per maand. Puur weergave · checkout blijft gelijk.
        const annual = p.baseAnnual || 0;
        const perMonth = _billPeriod === "year" ? Math.round(annual / 12) : Math.round(annual / 10);
        const seatExtra = _billPeriod === "year" ? Math.round((p.seatAnnual || 0) / 12) : Math.round((p.seatAnnual || 0) / 10);
        const subStr = p.custom ? tA("adm.bill.yearContractSla","Jaarcontract &amp; SLA")
          : (_billPeriod === "year" ? `${fmtEur(annual)}/${tA("adm.bill.perYear","jaar")}` : tA("adm.bill.billedMonthly","maandelijks gefactureerd"))
            + ` · ${tA("adm.bill.inclUsers","incl. {n} gebruikers").replace("{n}", p.includedSeats)} · +${fmtEur(seatExtra)}/${tA("adm.bill.extra","extra")}`;
        return `<div style="border:${ring} solid ${accent};border-radius:16px;padding:20px 18px;position:relative;display:flex;flex-direction:column;gap:10px;background:var(--surface);">
          ${isCurrent
            ? `<span style="position:absolute;top:-10px;right:16px;background:var(--wf-blue);color:#fff;font-size:10px;font-weight:600;padding:3px 10px;border-radius:999px;">${tA("adm.bill.currentPlanBadge","Huidig plan")}</span>`
            : p.popular ? `<span style="position:absolute;top:-10px;right:16px;background:var(--wf-blue);color:#fff;font-size:10px;font-weight:600;padding:3px 10px;border-radius:999px;">${tA("adm.bill.mostChosen","Meest gekozen")}</span>` : ""}
          <div style="font-size:15px;font-weight:600;color:var(--ink);letter-spacing:-.2px;">${esc(p.label)}</div>
          <div style="display:flex;align-items:baseline;gap:4px;">
            <span style="font-size:26px;font-weight:600;color:var(--ink);letter-spacing:-1px;">${p.custom?tA("adm.bill.custom","Op maat"):fmtEur(perMonth)}</span>
            ${p.custom?"":`<span style="font-size:12px;color:var(--muted);">/${tA("adm.bill.perMonth","maand")}</span>`}
          </div>
          <div style="font-size:11.5px;color:var(--muted);min-height:16px;">${subStr}</div>
          <ul style="list-style:none;padding:0;margin:6px 0 2px;display:flex;flex-direction:column;gap:6px;flex:1;">
            ${(p.features||[]).slice(0,8).map(f=>`<li style="font-size:12.5px;color:var(--text);display:flex;gap:7px;align-items:flex-start;"><span style="color:var(--wf-blue);font-weight:600;line-height:1.2;">✓</span> ${esc(f)}</li>`).join("")}
          </ul>
          ${isCurrent
            ? `<button class="adm-btn adm-btn-secondary adm-btn-sm" disabled style="opacity:.55;cursor:default;">${tA("adm.bill.yourCurrentPlan","Je huidige plan")}</button>`
            : p.custom
              ? `<button class="adm-btn adm-btn-secondary adm-btn-sm bill-contact">${tA("adm.bill.contactUs","Contacteer ons")}</button>`
              : `<button class="adm-btn ${p.popular?"adm-btn-primary":"adm-btn-secondary"} adm-btn-sm bill-select" data-plan="${p.key}" data-label="${esc(p.label)}">${trialEligible?tA("adm.bill.startTrial","Start 14 dagen gratis"):tA("adm.bill.choosePlan","Kies {p}").replace("{p}", esc(p.label))}</button>`}
        </div>`;
      }).join("")}
    </div>
    ${trialEligible ? `<div style="margin-top:14px;background:var(--wf-blue-l);border-radius:12px;padding:12px 16px;font-size:12.5px;color:var(--wf-blue-d);display:flex;gap:9px;align-items:flex-start;">
      <span style="font-size:15px;"></span>
      <span>${tA("adm.bill.trialInfo","<strong>14 dagen gratis</strong> op elk plan. Je kaartgegevens zijn vereist om te starten (via onze beveiligde betaalpartner Stripe), maar je wordt <strong>pas na 14 dagen</strong> gefactureerd · en je kan altijd opzeggen vóór het einde van de proefperiode.")}</span>
    </div>` : ""}
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
      <button class="adm-btn adm-btn-secondary adm-btn-sm" id="billPortal">${tA("adm.bill.managePortal","Abonnement &amp; betaalmethode beheren")}</button>
      <span style="font-size:12px;color:var(--gray-400);">${tA("adm.bill.portalNote","Veilig betalen · je betaalgegevens worden door onze betaalpartner (Stripe) verwerkt. Upgraden, downgraden, betaalmethode en opzeggen regel je in het beheerportaal.")}</span>
    </div>
  </div>
</div>

<!-- Add-ons (optionele betaalde extra's) -->
<div class="adm-card" id="billAddonsCard" style="margin-top:16px;display:none;">
  <div class="adm-card-header"><h3 class="adm-card-title">${tA("adm.bill.addons","Add-ons")}</h3></div>
  <div class="adm-card-body" id="billAddons"></div>
</div>

<!-- Factuurgeschiedenis -->
<div class="adm-card" style="margin-top:16px;">
  <div class="adm-card-header"><h3 class="adm-card-title">${tA("adm.bill.invoiceHistory","Factuurgeschiedenis")}</h3></div>
  ${invoices.length === 0
    ? `<div class="adm-empty"><div class="adm-empty-text">${tA("adm.inv.empty","Nog geen facturen")}</div></div>`
    : `<div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>${tA("adm.bill.invoiceNr","Factuur #")}</th><th>${tA("adm.date","Datum")}</th><th>${tA("adm.inv.due","Vervaldatum")}</th><th>${tA("adm.bill.description","Omschrijving")}</th><th>${tA("adm.amount","Bedrag")}</th><th>${tA("adm.status","Status")}</th></tr></thead>
        <tbody>${invoices.map(i => `<tr>
          <td style="font-family:monospace;font-weight:600">${esc(i.number||i.id.slice(-6))}</td>
          <td>${i.date ? new Date(i.date).toLocaleDateString("nl-BE") : "-"}</td>
          <td>${i.dueDate ? new Date(i.dueDate).toLocaleDateString("nl-BE") : "-"}</td>
          <td>${esc(i.description||i.title||tA("adm.bill.subDesc","Abonnement Monargo One"))}</td>
          <td style="font-weight:600">${fmtEur(i.amount)}</td>
          <td><span class="adm-status ${statusCss[i.status]||"adm-status-pending"}">${esc(i.status||"-")}</span></td>
        </tr>`).join("")}</tbody>
      </table></div>`}
</div>`;

      // Bundel kiezen → echte Stripe Checkout (mode=subscription). Zonder live
      // Stripe-sleutel geeft de server een mock-URL terug en is het plan meteen actief.
      content.querySelectorAll(".bill-select").forEach(btn => {
        btn.addEventListener("click", async () => {
          const plan = btn.dataset.plan;
          const label = btn.dataset.label || plan;
          const msg = trialEligible
            ? tA("adm.bill.confirmTrial","Start je 14 dagen gratis proefperiode op {label}?\n\nJe geeft je kaartgegevens op via onze beveiligde betaalpagina (Stripe), maar je wordt pas na 14 dagen gefactureerd. Opzeggen kan altijd.").replace("{label}", label)
            : tA("adm.bill.confirmSwitch","Overschakelen naar het {label}-abonnement? Je wordt naar de beveiligde betaalpagina geleid.").replace("{label}", label);
          if (!await uiConfirm(msg, { title: "Pakketwijziging bevestigen", confirmLabel: "Wijziging uitvoeren" })) return;
          btn.disabled = true; btn.textContent = tA("adm.bill.busy","Bezig…");
          try {
            const r = await api("POST", "/billing/checkout", { plan });
            if (r.provider === "stripe" && r.url) { window.location.href = r.url; return; }
            window.showToast && window.showToast(r.trial ? tA("adm.bill.trialStarted","Proefperiode van 14 dagen gestart ({label})").replace("{label}", label) : tA("adm.bill.subActivated","Abonnement geactiveerd ({label})").replace("{label}", label), "success");
            renderBilling();
          } catch(e) { window.showToast && window.showToast(e.message, "error"); btn.disabled = false; btn.textContent = trialEligible ? tA("adm.bill.startTrial","Start 14 dagen gratis") : tA("adm.bill.choose","Kies"); }
        });
      });
      content.querySelectorAll(".bill-contact").forEach(btn => {
        btn.addEventListener("click", () => window.showToast && window.showToast(tA("adm.bill.enterpriseNote","Voor Enterprise maken we een offerte op maat. Neem contact op via je accountmanager of support."), "info"));
      });
      content.querySelectorAll(".adm-period-btn").forEach(btn => {
        btn.addEventListener("click", () => { _billPeriod = btn.dataset.per; renderBilling(); });
      });
      // Self-service beheer via Stripe Billing Portal (upgrade/downgrade/opzeggen/betaalmethode).
      document.getElementById("billPortal")?.addEventListener("click", async () => {
        try {
          const r = await api("POST", "/billing/portal", {});
          if (r.provider === "stripe" && r.url) { window.location.href = r.url; return; }
          window.showToast && window.showToast(tA("adm.bill.portalNotLive","Het beheerportaal is beschikbaar zodra betalingen live staan (Stripe-sleutel geconfigureerd)."), "info");
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
            return `<div style="border:1.5px solid ${has ? "var(--wf-green)" : "var(--gray-200)"};border-radius:12px;padding:14px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                <strong style="font-size:14px;color:var(--gray-900);">${esc(a.label)}</strong>
                ${has ? `<span style="font-size:10px;font-weight:700;background:var(--wf-green-l);color:var(--wf-green);border-radius:999px;padding:2px 8px;">ACTIEF</span>` : ""}
              </div>
              <div style="font-size:20px;font-weight:700;color:var(--gray-900);margin:6px 0;">€${a.monthly}<span style="font-size:12px;font-weight:500;color:var(--gray-400);">/${tA("adm.bill.mo","mnd")}</span></div>
              <div style="font-size:12px;color:var(--gray-500);min-height:32px;">${esc(a.description)}</div>
              ${has
                ? `<button class="adm-btn adm-btn-secondary adm-btn-sm" disabled style="opacity:.6;width:100%;margin-top:8px;">${tA("adm.bill.included","Inbegrepen")}</button>`
                : `<button class="adm-btn adm-btn-primary adm-btn-sm addon-request" data-addon="${esc(a.label)}" style="width:100%;margin-top:8px;">${tA("adm.bill.request","Aanvragen")}</button>`}
            </div>`;
          }).join("")}
        </div>
        <div style="font-size:11.5px;color:var(--gray-400);margin-top:10px;">${tA("adm.bill.addonNote","Add-ons worden door je accountbeheerder of support geactiveerd. Neem contact op om een add-on toe te voegen.")}</div>`;
        body.querySelectorAll(".addon-request").forEach(btn => btn.addEventListener("click", () =>
          window.showToast && window.showToast(tA("adm.bill.addonRequested","Bedankt! Vraag '{a}' aan via je accountmanager of support · wij activeren het voor je organisatie.").replace("{a}", btn.dataset.addon), "info")));
      })();
    } catch(e) { content.innerHTML = `<div style="padding:20px;color:var(--wf-red)">${tA("adm.error","Fout")}: ${e.message}</div>`; }
  }

  // ── Integraties (Exact Online, Robaws, …) ──────────────────
  let _integrationSelected = null;
  let _integrationMode = "connectors";

  async function renderIntegraties() {
    const content = document.getElementById("admContent");
    content.innerHTML = `<div class="adm-loading">Laden…</div>`;
    if (_integrationMode === "automations" && window.wfpAutomationWorkspace) {
      await window.wfpAutomationWorkspace.render({ onMode: mode => { _integrationMode = mode; renderIntegraties(); } });
      return;
    }
    if (_integrationMode === "fields" && window.wfpConfigFieldsWorkspace) {
      await window.wfpConfigFieldsWorkspace.render({ onMode: mode => { _integrationMode = mode; renderIntegraties(); } });
      return;
    }
    let data = { rows: [], providers: [] };
    try { data = await api("GET", "/integrations"); }
    catch (e) { content.innerHTML = `<div class="adm-card"><div class="adm-card-body">${esc(e.message)}</div></div>`; return; }
    const providers = data.providers || [];
    const byProvider = Object.fromEntries((data.rows || []).map(r => [r.provider, r]));
    const fmtDT = s => s ? new Date(s).toLocaleString("nl-BE") : "-";
    const connections = Object.values(byProvider);
    const connected = connections.filter(row => row.status === "connected").length;
    const syncIssues = connections.filter(row => row.syncSummary?.needsAttention).length;
    const mappingIssues = connections.filter(row => row.mappingSummary?.needsAttention).length;
    const missingSecrets = connections.filter(row => !row.hasSecret).length;
    if (!_integrationSelected || !providers.some(p => p.key === _integrationSelected)) {
      _integrationSelected = connections[0]?.provider || providers[0]?.key || null;
    }

    const providerMark = p => String(p.label || p.key || "IN").split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
    const statusLabel = conn => !conn ? "Niet verbonden" : conn.syncSummary?.needsAttention || conn.status === "error" ? "Actie nodig" : "Verbonden";
    const statusTone = conn => !conn ? "pending" : conn.syncSummary?.needsAttention || conn.status === "error" ? "inactive" : "active";
    const mappingLabel = conn => !conn ? "Na verbinding beschikbaar" : conn.mappingSummary?.needsAttention ? `${conn.mappingSummary.invalid || 0} mappingfouten` : `${conn.mappingSummary?.valid || 0} mappings klaar`;
    const selectedProvider = () => providers.find(p => p.key === _integrationSelected) || providers[0];

    const paint = () => {
      const activeProvider = selectedProvider();
      const activeConn = activeProvider ? byProvider[activeProvider.key] : null;
      const logs = (activeConn?.syncLogs || []).slice(0, 8);
      content.innerHTML = `
<div class="adm-integration-workspace">
  <nav class="adm-integration-mode" aria-label="Koppelingen en automatisaties">
    <button type="button" class="active" data-integration-mode="connectors">Connectoren</button>
    <button type="button" data-integration-mode="automations">Automatisaties</button>
    <button type="button" data-integration-mode="fields">Eigen velden</button>
  </nav>
  <section class="adm-workspace-head adm-integration-head">
    <div><span class="adm-eyebrow">Connected operations</span><h2>Koppelingen zonder giswerk</h2><p>Verbind systemen, controleer veldmapping en volg synchronisaties vanuit één rustige werkruimte.</p></div>
    ${activeProvider ? `<button type="button" class="adm-btn adm-btn-primary" data-configure="${esc(activeProvider.key)}">${activeConn ? "Configuratie beheren" : `${esc(activeProvider.label)} verbinden`}</button>` : ""}
  </section>

  <section class="adm-integration-health" aria-label="Gezondheid van koppelingen">
    <article><span>Verbonden</span><strong>${connected}<small> / ${providers.length}</small></strong><p>actieve koppelingen</p></article>
    <article class="${syncIssues ? "needs-attention" : ""}"><span>Syncstatus</span><strong>${syncIssues}</strong><p>${syncIssues === 1 ? "koppeling vraagt aandacht" : "koppelingen vragen aandacht"}</p></article>
    <article class="${mappingIssues ? "needs-attention" : ""}"><span>Veldmapping</span><strong>${mappingIssues}</strong><p>${mappingIssues ? "configuraties nakijken" : "alle mappings geldig"}</p></article>
    <article class="${missingSecrets ? "needs-attention" : ""}"><span>Credentials</span><strong>${missingSecrets}</strong><p>${missingSecrets ? "sleutels ontbreken" : "veilig opgeslagen"}</p></article>
  </section>

  <div class="adm-integration-layout">
    <section class="adm-integration-catalog" aria-label="Beschikbare koppelingen">
      <div class="adm-section-heading"><div><span>Connectoren</span><h3>Kies een systeem</h3></div><small>${providers.length} beschikbaar</small></div>
      <div class="adm-integration-list">
        ${providers.map(p => {
          const conn = byProvider[p.key];
          const ss = conn?.syncSummary || {};
          return `<button type="button" class="adm-integration-item ${p.key === _integrationSelected ? "active" : ""}" data-provider-select="${esc(p.key)}">
            <span class="adm-integration-mark">${esc(providerMark(p))}</span>
            <span class="adm-integration-item-copy"><b>${esc(p.label)}</b><small>${esc(p.category)} · ${conn ? `laatste sync ${fmtDT(ss.lastSyncAt || conn.lastSyncAt)}` : "nog te verbinden"}</small></span>
            <span class="adm-status adm-status-${statusTone(conn)}">${statusLabel(conn)}</span>
            <span class="adm-integration-chevron" aria-hidden="true">›</span>
          </button>`;
        }).join("") || `<div class="adm-empty"><div class="adm-empty-text">Geen connectoren beschikbaar.</div></div>`}
      </div>
      <div class="adm-integration-compliance"><span aria-hidden="true">i</span><p><strong>Compliance blijft automatisch.</strong> Checkin@Work en Limosa beheer je onder Compliance; die flows zijn geen handmatige connectoren.</p></div>
    </section>

    <section class="adm-integration-detail" aria-live="polite">
      ${activeProvider ? `
        <div class="adm-integration-detail-head">
          <div class="adm-integration-title"><span class="adm-integration-mark large">${esc(providerMark(activeProvider))}</span><div><span>${esc(activeProvider.category)}</span><h3>${esc(activeProvider.label)}</h3></div></div>
          <span class="adm-status adm-status-${statusTone(activeConn)}">${statusLabel(activeConn)}</span>
        </div>
        <p class="adm-integration-description">${esc(activeProvider.description)} ${activeProvider.docs ? `<a href="${esc(activeProvider.docs)}" target="_blank" rel="noopener">Open documentatie ↗</a>` : ""}</p>
        <div class="adm-integration-detail-grid">
          <article><span>Laatste synchronisatie</span><strong>${activeConn ? fmtDT(activeConn.syncSummary?.lastSyncAt || activeConn.lastSyncAt) : "Nog niet uitgevoerd"}</strong><small>${activeConn?.syncSummary?.lastMessage ? esc(activeConn.syncSummary.lastMessage) : "Start na een geldige configuratie"}</small></article>
          <article><span>Veldmapping</span><strong>${mappingLabel(activeConn)}</strong><small>${activeConn?.mappingSummary?.total || activeProvider.defaultMappings?.length || 0} regels geconfigureerd</small></article>
        </div>
        <div class="adm-integration-actions">
          <button type="button" class="adm-btn adm-btn-primary" data-configure="${esc(activeProvider.key)}">${activeConn ? "Configuratie beheren" : "Verbinden"}</button>
          ${activeConn ? `<button type="button" class="adm-btn adm-btn-secondary" data-sync="${esc(activeConn.id)}">Nu synchroniseren</button>` : ""}
          ${activeConn && activeProvider.key === "robaws" ? `<button type="button" class="adm-btn adm-btn-secondary" data-syncdocs="${esc(activeConn.id)}">Werfdocumenten syncen</button>` : ""}
        </div>
        <div class="adm-sync-log-head"><div><span>Activiteit</span><h4>Recente synchronisaties</h4></div>${activeConn ? `<small>${activeConn.syncSummary?.success || 0} geslaagd · ${activeConn.syncSummary?.unresolvedFailures || 0} open fouten</small>` : ""}</div>
        <div class="adm-sync-log">
          ${logs.length ? logs.map(log => `<article class="${log.status === "failed" && !log.resolved ? "failed" : ""}"><span class="adm-sync-dot"></span><div><strong>${log.status === "success" ? "Synchronisatie geslaagd" : log.resolved ? "Fout opgelost" : "Synchronisatie mislukt"}</strong><small>${fmtDT(log.at)}${log.errorCode ? ` · ${esc(log.errorCode)}` : ""}${log.message ? ` · ${esc(log.message)}` : ""}</small></div>${log.retryable ? `<button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" data-retry-sync="${esc(activeConn.id)}" data-sync-id="${esc(log.id)}">Opnieuw proberen</button>` : ""}</article>`).join("") : `<div class="adm-integration-empty-log"><span>↻</span><p>Nog geen synchronisaties. Na de eerste run verschijnt hier een traceerbare historiek.</p></div>`}
        </div>
      ` : `<div class="adm-empty"><div class="adm-empty-title">Geen integratie geselecteerd</div><div class="adm-empty-text">Kies een connector om de configuratie te bekijken.</div></div>`}
    </section>
  </div>
</div>`;

      content.querySelectorAll("[data-integration-mode]").forEach(btn => btn.addEventListener("click", () => { _integrationMode = btn.dataset.integrationMode; renderIntegraties(); }));
      content.querySelectorAll("[data-provider-select]").forEach(btn => btn.addEventListener("click", () => { _integrationSelected = btn.dataset.providerSelect; paint(); }));
      content.querySelectorAll("[data-configure]").forEach(btn => btn.addEventListener("click", () => {
        const provider = providers.find(p => p.key === btn.dataset.configure);
        if (provider) openIntegrationEditor(provider, byProvider[provider.key]);
      }));
      bindIntegrationActions();
    };

    function openIntegrationEditor(provider, conn) {
      document.getElementById("admDrawerTitle").textContent = conn ? `${provider.label} beheren` : `${provider.label} verbinden`;
      const mappingRows = conn?.config?.fieldMapping || provider.defaultMappings || [];
      const fieldValue = field => field.key === "baseUrl" ? (conn?.config?.baseUrl || field.default || "") : (conn?.config?.[field.key] || field.default || "");
      const mappingRow = row => `<div class="adm-integration-map-row">
        <input class="integration-map-local" value="${esc(row.local || "")}" placeholder="Monargo veld · bv. customers.name" aria-label="Monargo veld">
        <span aria-hidden="true">→</span>
        <input class="integration-map-remote" value="${esc(row.remote || "")}" placeholder="Extern veld · bv. account.name" aria-label="Extern veld">
        <select class="integration-map-direction" aria-label="Synchronisatierichting"><option value="push" ${row.direction === "push" ? "selected" : ""}>Naar extern</option><option value="pull" ${row.direction === "pull" ? "selected" : ""}>Naar Monargo</option><option value="both" ${!row.direction || row.direction === "both" ? "selected" : ""}>Beide richtingen</option></select>
        <button type="button" class="adm-integration-map-delete" aria-label="Mapping verwijderen">×</button>
      </div>`;
      document.getElementById("admDrawerBody").innerHTML = `<form id="integrationEditorForm" data-provider="${esc(provider.key)}">
        <section class="adm-editor-intro"><span class="adm-integration-mark large">${esc(providerMark(provider))}</span><div><h3>${esc(provider.label)}</h3><p>${esc(provider.description)}</p></div><span class="adm-status adm-status-${statusTone(conn)}">${statusLabel(conn)}</span></section>
        <div class="adm-form-section">Verbinding</div>
        <div class="adm-integration-fields">
          ${(provider.fields || []).map(field => `<div class="adm-form-group"><label>${esc(field.label)}</label><input name="${esc(field.key)}" type="${field.secret ? "password" : "text"}" value="${field.secret ? "" : esc(fieldValue(field))}" placeholder="${field.secret && conn?.hasSecret ? "Laat leeg om de huidige sleutel te behouden" : esc(field.placeholder || "")}" ${field.secret ? 'autocomplete="new-password"' : ""}></div>`).join("")}
          <div class="adm-form-group"><label>Omgeving</label><select name="environment"><option value="test" ${conn?.config?.environment !== "production" ? "selected" : ""}>Testomgeving</option><option value="production" ${conn?.config?.environment === "production" ? "selected" : ""}>Productie</option></select><div class="adm-form-hint">Productie gebruikt de echte providercredentials en hoort pas na een geslaagde test actief te worden.</div></div>
        </div>
        <div class="adm-form-section adm-mapping-section"><span>Veldmapping</span><button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" id="integrationAddMapping">+ Mapping toevoegen</button></div>
        <p class="adm-form-hint">Bepaal expliciet welke gegevens worden uitgewisseld. Ongeldige of lege regels blokkeren de synchronisatie.</p>
        <div id="integrationMappingRows" class="adm-integration-map-list">${mappingRows.map(mappingRow).join("")}</div>
        <div id="integrationFormError" class="adm-inline-error" hidden></div>
        <div class="adm-form-actions"><button type="button" class="adm-btn adm-btn-secondary" id="integrationCancel">Annuleren</button><button type="submit" class="adm-btn adm-btn-primary">${conn ? "Wijzigingen opslaan" : "Veilig verbinden"}</button></div>
      </form>`;
      openDrawer();
      const rows = document.getElementById("integrationMappingRows");
      const bindMappingDelete = () => rows?.querySelectorAll(".adm-integration-map-delete").forEach(btn => btn.onclick = () => btn.closest(".adm-integration-map-row")?.remove());
      bindMappingDelete();
      document.getElementById("integrationAddMapping")?.addEventListener("click", () => { rows.insertAdjacentHTML("beforeend", mappingRow({ direction:"both" })); bindMappingDelete(); });
      document.getElementById("integrationCancel")?.addEventListener("click", closeDrawer);
      document.getElementById("integrationEditorForm")?.addEventListener("submit", async e => {
        e.preventDefault();
        const error = document.getElementById("integrationFormError");
        const submit = e.submitter;
        const oldLabel = submit?.textContent;
        const fd = Object.fromEntries(new FormData(e.target).entries());
        const fieldMapping = [...rows.querySelectorAll(".adm-integration-map-row")].map(row => ({ local:row.querySelector(".integration-map-local").value.trim(), remote:row.querySelector(".integration-map-remote").value.trim(), direction:row.querySelector(".integration-map-direction").value }));
        if (!fieldMapping.length || fieldMapping.some(row => !row.local || !row.remote)) { error.hidden = false; error.textContent = "Vul voor elke mapping zowel het Monargo- als externe veld in."; return; }
        const body = { provider:provider.key, apiKey:fd.apiKey || "", baseUrl:fd.baseUrl || "", environment:fd.environment || "test", fieldMapping, config:{} };
        (provider.fields || []).forEach(field => { if (!field.secret && field.key !== "baseUrl" && fd[field.key]) body.config[field.key] = fd[field.key]; });
        if (submit) { submit.disabled = true; submit.textContent = "Veilig opslaan…"; }
        try { await api("POST", "/integrations/connect", body); closeDrawer(); window.showToast && window.showToast(`${provider.label} is bijgewerkt`, "success"); await renderIntegraties(); }
        catch (err) { error.hidden = false; error.textContent = err.message; if (submit) { submit.disabled = false; submit.textContent = oldLabel; } }
      });
    }

    function bindIntegrationActions() {
    content.querySelectorAll("[data-sync]").forEach(btn => btn.addEventListener("click", async () => {
      btn.disabled = true; btn.textContent = "Bezig…";
      try {
        const r = await api("POST", `/integrations/${btn.dataset.sync}/sync`, {});
        const ok = r.result && r.result.log && r.result.log.status === "success";
        window.showToast && window.showToast(ok ? "Synchronisatie voltooid" : "Sync mislukt · controleer sleutel/mapping", ok ? "success" : "error");
        renderIntegraties();
      } catch (e) { window.showToast && window.showToast(e.message, "error"); btn.disabled = false; btn.textContent = "↻ Nu synchroniseren"; }
    }));
    content.querySelectorAll("[data-syncdocs]").forEach(btn => btn.addEventListener("click", async () => {
      btn.disabled = true; const orig = btn.textContent; btn.textContent = "Bezig…";
      try {
        const r = await api("POST", `/integrations/${btn.dataset.syncdocs}/sync-documents`, {});
        const t = r.result && r.result.manifest && r.result.manifest.totals;
        window.showToast && window.showToast(t ? `Werf-documenten gesynchroniseerd ✓ (${t.projects} projecten, ${t.documents} docs)` : "Document-sync voltooid", "success");
        renderIntegraties();
      } catch (e) { window.showToast && window.showToast(e.message, "error"); btn.disabled = false; btn.textContent = orig; }
    }));
      content.querySelectorAll("[data-retry-sync]").forEach(btn => btn.addEventListener("click", async () => {
        const original = btn.textContent; btn.disabled = true; btn.textContent = "Opnieuw proberen…";
        try { await api("POST", `/integrations/${btn.dataset.retrySync}/retry`, { syncId:btn.dataset.syncId }); window.showToast && window.showToast("Synchronisatie opnieuw uitgevoerd", "success"); await renderIntegraties(); }
        catch (e) { window.showToast && window.showToast(e.message, "error"); btn.disabled = false; btn.textContent = original; }
      }));
    }

    paint();
  }

  // ── Settings ───────────────────────────────────────────────

  // Gefocuste module-instelling geopend vanuit de flyout (bv. "clocking").
  // null = de volledige Instellingen-pagina.
  let _settingsSection = null;

  // Instellingen die bij één module horen krijgen hun eigen, correct getitelde
  // kaart (niet weggestopt in "Bedrijfsgegevens"). Elke kaart is een op zichzelf
  // staand formulier met een eigen opslaan-knop; .wire() koppelt de handlers.
  function buildModuleSettingsCards(tenant) {
    const HOME_WIDGETS = [
      ["clock", "Prikklok & vandaag"], ["quickactions", "Snelacties"], ["urgent", "Urgente werkbonnen"],
      ["overview", "Mijn overzicht"], ["leavebalance", "Verlofsaldo"], ["notifications", "Ongelezen meldingen"]
    ];
    const homeTpl = tenant.employeeHomeTemplate || HOME_WIDGETS.map(w => w[0]);
    const savedMsg = (el, text, ok) => {
      if (!el) return;
      el.style.color = ok === false ? "var(--wf-red)" : "var(--wf-green)";
      el.textContent = text;
      if (ok !== false) setTimeout(() => { el.textContent = ""; }, 4000);
    };
    return {
      clocking: {
        title: "Prikklok",
        card: `
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">Prikklok</h3></div>
    <div class="adm-card-body">
      <label style="display:flex;flex-direction:row;align-items:center;gap:8px;font-size:13.5px;font-weight:500;color:var(--gray-700);cursor:pointer;">
        <input type="checkbox" id="admPaidBreaks" style="width:16px;height:16px;flex-shrink:0;" ${tenant.clockingPrefs?.paidBreaks ? "checked" : ""}>
        Pauzes tellen mee als betaalde werktijd
      </label>
      <p style="font-size:12px;color:var(--gray-400);margin:6px 0 0;padding-left:24px;">Staat dit uit, dan worden pauzes van de gewerkte tijd afgetrokken. Wijzigingen gelden voor registraties vanaf nu.</p>
      <div style="display:flex;gap:8px;margin-top:14px;align-items:center;flex-wrap:wrap;">
        <button type="button" class="adm-btn adm-btn-primary adm-btn-sm" id="admPaidBreaksSave">Opslaan</button>
        <span id="admPaidBreaksMsg" style="font-size:12.5px;"></span>
      </div>
    </div>
  </div>`,
        wire: () => {
          document.getElementById("admPaidBreaksSave")?.addEventListener("click", async () => {
            const msg = document.getElementById("admPaidBreaksMsg");
            try {
              await api("PATCH", "/settings", { clockingPrefs: { paidBreaks: document.getElementById("admPaidBreaks")?.checked === true } });
              savedMsg(msg, "Pauzebeleid opgeslagen");
            } catch (e) { savedMsg(msg, e.message, false); }
          });
        }
      },
      facturen: {
        title: "Betaalherinneringen",
        card: `
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">Betaalherinneringen</h3></div>
    <div class="adm-card-body">
      <label style="display:flex;flex-direction:row;align-items:center;gap:8px;font-size:13.5px;font-weight:500;color:var(--gray-700);cursor:pointer;margin-bottom:10px;">
        <input type="checkbox" id="admAutoReminders" style="width:16px;height:16px;flex-shrink:0;" ${tenant.autoReminders?.enabled ? "checked" : ""}>
        Stuur automatisch een herinnering bij vervallen facturen
      </label>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:var(--gray-600);padding-left:24px;">
        om de
        <input type="number" id="admRemInterval" min="1" max="90" step="1" value="${tenant.autoReminders?.intervalDays ?? 7}" style="width:64px;text-align:center;" aria-label="Interval in dagen">
        dagen, maximaal
        <input type="number" id="admRemMax" min="1" max="10" step="1" value="${tenant.autoReminders?.maxReminders ?? 3}" style="width:64px;text-align:center;" aria-label="Maximum aantal herinneringen">
        herinneringen per factuur
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;align-items:center;flex-wrap:wrap;">
        <button type="button" class="adm-btn adm-btn-primary adm-btn-sm" id="admRemSave">Opslaan</button>
        <span id="admRemMsg" style="font-size:12.5px;"></span>
      </div>
    </div>
  </div>`,
        wire: () => {
          document.getElementById("admRemSave")?.addEventListener("click", async () => {
            const msg = document.getElementById("admRemMsg");
            try {
              await api("PATCH", "/settings", { autoReminders: {
                enabled: document.getElementById("admAutoReminders")?.checked === true,
                intervalDays: Number(document.getElementById("admRemInterval")?.value) || 7,
                maxReminders: Number(document.getElementById("admRemMax")?.value) || 3
              } });
              savedMsg(msg, "Herinneringsbeleid opgeslagen");
            } catch (e) { savedMsg(msg, e.message, false); }
          });
        }
      },
      employees: {
        title: "Startpagina medewerkers",
        card: `
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">Startpagina medewerkers</h3></div>
    <div class="adm-card-body">
      <p style="font-size:12.5px;color:var(--gray-500);margin:0 0 12px;">Bepaal welke blokken medewerkers standaard op hun startpagina zien. Elke medewerker kan daarnaast een eigen selectie kiezen via "Aanpassen" in de app.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;">
        ${HOME_WIDGETS.map(([key, label]) => `<label style="display:flex;flex-direction:row;align-items:center;gap:8px;font-size:13px;font-weight:500;border:1px solid var(--line);border-radius:8px;padding:8px 10px;cursor:pointer;">
          <input type="checkbox" class="adm-ehw" value="${key}" style="width:16px;height:16px;flex-shrink:0;" ${homeTpl.includes(key) ? "checked" : ""}>
          <span>${label}</span>
        </label>`).join("")}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap;">
        <button type="button" class="adm-btn adm-btn-primary adm-btn-sm" id="admEhwSave">Template opslaan</button>
        <span id="admEhwMsg" style="font-size:12.5px;"></span>
      </div>
    </div>
  </div>`,
        wire: () => {
          document.getElementById("admEhwSave")?.addEventListener("click", async () => {
            const msg = document.getElementById("admEhwMsg");
            const picked = [...document.querySelectorAll(".adm-ehw:checked")].map(c => c.value);
            try {
              await api("PATCH", "/settings", { employeeHomeTemplate: picked });
              savedMsg(msg, "Template opgeslagen · geldt voor medewerkers zonder eigen selectie");
            } catch (e) { savedMsg(msg, e.message, false); }
          });
        }
      }
    };
  }

  async function renderSettings() {
    const content = document.getElementById("admContent");
    content.innerHTML = `<div class="adm-loading">${tA("adm.loading","Laden…")}</div>`;
    let tenant = {};
    try {
      const res = await api("GET", "/settings");
      tenant = res.tenant || {};
    } catch (_) {}

    const moduleCards = buildModuleSettingsCards(tenant);
    const section = _settingsSection;
    _settingsSection = null; // volgende gewone navigatie toont de volledige pagina

    // Gefocuste module-instelling (geopend vanuit de flyout): enkel die kaart.
    if (section && moduleCards[section]) {
      document.getElementById("admPageTitle").textContent = moduleCards[section].title;
      content.innerHTML = `
        <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admSettingsBack" style="margin-bottom:16px;">‹ ${tA("adm.set.allSettings","Alle instellingen")}</button>
        <div style="max-width:640px;">${moduleCards[section].card}</div>`;
      document.getElementById("admSettingsBack")?.addEventListener("click", () => {
        document.getElementById("admPageTitle").textContent = VIEW_LABELS.settings;
        renderSettings();
      });
      moduleCards[section].wire();
      return;
    }

    content.innerHTML = `
<div class="adm-grid-2">
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">${tA("adm.set.orgInfo","Bedrijfsgegevens")}</h3></div>
    <div class="adm-card-body">
      <form id="admOrgForm">
        <div class="adm-form-group"><label>${tA("adm.set.companyName","Bedrijfsnaam")}</label>
          <input name="name" value="${esc(tenant.name || "")}" placeholder="${tA("adm.set.orgNamePh","Naam organisatie")}">
        </div>
        <div class="adm-form-group"><label>${tA("adm.cust.vatNumber","BTW-nummer")}</label>
          <input name="vatNumber" value="${esc(tenant.vatNumber || "")}" placeholder="BE0000.000.000">
        </div>
        <div class="adm-form-group"><label>${tA("adm.cust.address","Adres")}</label>
          <input name="address" value="${esc(tenant.address || "")}" placeholder="${tA("adm.set.addressPh","Straat + nr, gemeente")}">
        </div>
        <div class="adm-form-row">
          <div class="adm-form-group"><label>${tA("adm.set.contactEmail","Contact e-mail")}</label>
            <input name="contactEmail" type="email" value="${esc(tenant.contactEmail || "")}" placeholder="info@bedrijf.be">
          </div>
          <div class="adm-form-group"><label>${tA("adm.cust.thPhone","Telefoon")}</label>
            <input name="phone" value="${esc(tenant.phone || "")}" placeholder="+32 ...">
          </div>
        </div>
        <div class="adm-form-group"><label>${tA("adm.set.hourlyRate","Standaard-uurtarief (€)")}</label>
          <input name="defaultHourlyRate" type="number" step="1" min="0" value="${tenant.defaultHourlyRate ?? ""}" placeholder="${tA("adm.set.hourlyRatePh","bv. 55 · gebruikt voor werkbonnen zonder eigen tarief")}">
        </div>
        <div id="admOrgMsg" style="display:none;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;"></div>
        <label style="display:flex;flex-direction:row;align-items:center;gap:8px;font-size:13px;font-weight:500;color:var(--gray-600);margin:4px 0 12px;cursor:pointer;">
          <input type="checkbox" id="admEmailNotif" style="width:16px;height:16px;flex-shrink:0;" ${tenant.notificationPrefs?.emailEnabled === false ? "" : "checked"}>
          ${tA("adm.set.emailNotif","E-mailnotificaties versturen (belangrijke meldingen naar betrokkenen)")}
        </label>
        <div style="display:flex;align-items:center;gap:10px;margin:0 0 12px;flex-wrap:wrap;">
          <button type="button" class="adm-btn adm-btn-secondary adm-btn-sm" id="admPushToggle">${tA("adm.set.pushOnDevice","Pushmeldingen op dit toestel")}</button>
          <span id="admPushStatus" style="font-size:12px;color:var(--gray-400);"></span>
        </div>
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">${tA("adm.save","Opslaan")}</button></div>
      </form>
    </div>
  </div>
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">${tA("adm.set.subPlan","Abonnement &amp; plan")}</h3></div>
    <div class="adm-card-body">
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:var(--gray-500);">${tA("adm.bill.currentPlanBadge","Huidig plan")}</span>
          <strong style="text-transform:capitalize;">${esc(tenant.plan || "-")}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:var(--gray-500);">${tA("adm.status","Status")}</span>
          <span class="adm-status adm-status-${tenant.status === "active" ? "active" : tenant.status === "trial" ? "pending" : "inactive"}">${esc(tenant.status || "-")}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:var(--gray-500);">${tA("adm.set.billingEmail","Facturatie e-mail")}</span>
          <span>${esc(tenant.billingEmail || "-")}</span>
        </div>
        <hr style="border:none;border-top:1px solid var(--gray-100);margin:4px 0;">
        <button class="adm-btn adm-btn-secondary" id="admSettingsToBilling" style="width:100%;">${tA("adm.set.viewInvoiceHistory","Factuurgeschiedenis bekijken")}</button>
      </div>
    </div>
  </div>
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">${tA("adm.set.securityMfa","Beveiliging · MFA")}</h3></div>
    <div class="adm-card-body">
      <div id="admMfaStatus" style="margin-bottom:12px;font-size:13px;color:var(--gray-500);">${tA("adm.set.statusLoading","Status laden…")}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="adm-btn adm-btn-primary" id="admMfaSetup">${tA("adm.set.mfaSetup","MFA instellen")}</button>
        <button class="adm-btn adm-btn-secondary" id="admMfaEnforce">${tA("adm.set.mfaEnforce","MFA verplichten voor beheerders")}</button>
        <button class="adm-btn adm-btn-secondary" id="admMfaDisable" style="display:none;">${tA("adm.set.mfaDisable","MFA uitschakelen")}</button>
      </div>
      <div style="font-size:11.5px;color:var(--gray-400);margin-top:8px;">${tA("adm.set.mfaNote","MFA verplichten schakelt 2FA in voor álle beheerders. Bij de volgende login is een authenticator-code vereist. Bewaar de getoonde codes goed.")}</div>
      <div id="admMfaWizard" style="display:none;margin-top:16px;background:var(--gray-50);border-radius:10px;padding:16px;"></div>
    </div>
  </div>
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">${tA("adm.set.dataBackup","Data &amp; Backup")}</h3></div>
    <div class="adm-card-body">
      <p style="font-size:13px;color:var(--muted);margin-bottom:14px;">${tA("adm.set.backupIntro","Er wordt elke dag automatisch een versleutelbare backup van je volledige tenantdata gemaakt. Hieronder bepaal je hoe lang die herstelmomenten bewaard worden.")}</p>

      <div id="admBackupPolicy" style="background:var(--gray-50);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:14px;">
        <div style="font-size:13px;color:var(--muted);">${tA("adm.set.policyLoading","Bewaarbeleid laden…")}</div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="adm-btn adm-btn-secondary" id="admBackupCreate">${tA("adm.set.backupNow","Nu een backup maken")}</button>
        <button class="adm-btn adm-btn-secondary" id="admBackupList">${tA("adm.set.backupExisting","Bestaande backups")}</button>
      </div>
      <div id="admBackupResult" style="margin-top:12px;"></div>
    </div>
  </div>
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">${tA("adm.set.changePassword","Wachtwoord wijzigen")}</h3></div>
    <div class="adm-card-body">
      <form id="admPwForm">
        <div class="adm-form-group"><label>${tA("adm.set.currentPw","Huidig wachtwoord")}</label>
          <input name="currentPassword" type="password" required autocomplete="current-password">
        </div>
        <div class="adm-form-group"><label>${tA("adm.set.newPw","Nieuw wachtwoord")}</label>
          <input name="newPassword" type="password" required autocomplete="new-password" minlength="8">
        </div>
        <div id="admPwMsg" style="display:none;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;"></div>
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">${tA("adm.set.change","Wijzigen")}</button></div>
      </form>
    </div>
  </div>
  <div class="adm-card">
    <div class="adm-card-header"><h3 class="adm-card-title">${tA("adm.set.supportAccess","Support-toegang (GDPR)")}</h3></div>
    <div class="adm-card-body">
      <p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">
        ${tA("adm.set.supportIntro","Geef je toestemming dan kan een supportmedewerker tijdelijk inloggen en je sessie overnemen om je te helpen. De toegang is tijdgebonden, wordt volledig geaudit, en je ziet een banner zolang een sessie actief is. Je kunt de toestemming op elk moment intrekken · een lopende sessie stopt dan meteen.")}
      </p>
      <div id="admSupportStatus" style="font-size:13px;margin-bottom:12px;"></div>
      <div class="adm-form-group" id="admSupportReasonWrap">
        <label>${tA("adm.set.reasonContext","Reden / context (optioneel)")}</label>
        <input id="admSupportReason" placeholder="${tA("adm.set.reasonPh","bv. hulp bij facturatie-instelling")}">
        <label style="display:flex;flex-direction:row;align-items:center;gap:8px;margin-top:10px;font-size:13px;font-weight:500;color:var(--gray-600);cursor:pointer;">
          <input type="checkbox" id="admSupportAutoRenew" style="width:16px;height:16px;flex-shrink:0;" checked>
          ${tA("adm.set.autoRenew","Automatisch verlengen · blijft jaarlijks staan, je krijgt jaarlijks een mededeling per e-mail")}
        </label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="adm-btn adm-btn-primary" id="admSupportAllow">${tA("adm.set.supportAllow","Support-toegang toestaan")}</button>
        <button class="adm-btn adm-btn-secondary" id="admSupportRevoke" style="display:none;">${tA("adm.set.supportRevoke","Toestemming intrekken")}</button>
      </div>
      <div id="admSupportMsg" style="display:none;padding:8px 12px;border-radius:8px;font-size:13px;margin-top:10px;"></div>
    </div>
  </div>
  <div class="adm-card" id="admSsoCard" style="display:none;grid-column:1/-1;">
    <div class="adm-card-header"><h3 class="adm-card-title">${tA("adm.set.sso","Single Sign-On (SAML)")} <span style="font-size:11px;background:var(--wf-purple-l);color:var(--wf-purple);border-radius:999px;padding:2px 8px;vertical-align:middle;">Add-on</span></h3></div>
    <div class="adm-card-body" id="admSsoBody"><div class="adm-loading">${tA("adm.loading","Laden…")}</div></div>
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
        statusEl.innerHTML = `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:var(--wf-green-l);color:var(--wf-green);font-weight:600;">${tA("adm.set.allowed","Toegestaan")}</span>`
          + (sa.allowedBy ? ` <span style="color:var(--gray-500);">${tA("adm.set.by","door")} ${esc(sa.allowedBy)}${sa.allowedAt ? " · " + new Date(sa.allowedAt).toLocaleString("nl-BE") : ""}</span>` : "")
          + `<div style="color:var(--gray-500);margin-top:6px;">${renew ? tA("adm.set.autoRenews","Verlengt jaarlijks automatisch") : tA("adm.set.noAutoRenew","Geen automatische verlenging")}${renew && review ? ` · ${tA("adm.set.nextNotice","volgende mededeling")} ${review}` : ""}</div>`;
        allowBtn.style.display = "none";
        revokeBtn.style.display = "";
        reasonWrap.style.display = "none";
      } else {
        statusEl.innerHTML = `<span style="display:inline-block;padding:3px 10px;border-radius:999px;background:var(--gray-100);color:var(--gray-600);font-weight:600;">${tA("adm.set.notAllowed","Niet toegestaan")}</span> <span style="color:var(--gray-500);">${tA("adm.set.supportCantLogin","support kan niet inloggen")}</span>`;
        allowBtn.style.display = "";
        revokeBtn.style.display = "none";
        reasonWrap.style.display = "";
      }
    }
    function admSupportMsg(text, ok) {
      const m = document.getElementById("admSupportMsg");
      if (!m) return;
      m.style.cssText = `display:block;padding:8px 12px;border-radius:8px;font-size:13px;margin-top:10px;background:${ok ? "var(--wf-green-l)" : "var(--wf-red-l)"};color:${ok ? "var(--wf-green)" : "var(--wf-red)"};`;
      m.textContent = text;
    }
    document.getElementById("admSupportAllow")?.addEventListener("click", async () => {
      const reason = document.getElementById("admSupportReason")?.value || "";
      const autoRenew = document.getElementById("admSupportAutoRenew")?.checked !== false;
      try {
        const r = await api("POST", "/support-access", { allowed: true, reason, autoRenew });
        renderSupportConsent(r.tenant?.supportAccess || { allowed: true });
        admSupportMsg(tA("adm.set.supportAllowedToast","Support-toegang toegestaan ✓"), true);
      } catch (e) { admSupportMsg(e.message, false); }
    });
    document.getElementById("admSupportRevoke")?.addEventListener("click", async () => {
      try {
        const r = await api("POST", "/support-access/end", {});
        renderSupportConsent(r.tenant?.supportAccess || { allowed: false });
        admSupportMsg(tA("adm.set.supportRevokedToast","Toestemming ingetrokken. Een lopende sessie is gestopt."), true);
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
          <p style="font-size:13px;color:var(--gray-500);margin-bottom:12px;">
            ${tA("adm.set.ssoIntro","Laat je medewerkers inloggen via jullie identiteitsprovider (Azure AD, Okta, Google Workspace…). Configureer hieronder de IdP-gegevens en geef onderstaande SP-URL's in bij je IdP.")}
          </p>
          <div style="background:var(--gray-50);border-radius:8px;padding:10px 12px;font-size:12px;margin-bottom:14px;word-break:break-all;">
            <div><strong>ACS / Reply URL:</strong> ${esc(cfg.acsUrl)}</div>
            <div><strong>Entity ID / Issuer:</strong> ${esc(cfg.issuer)}</div>
            <div><strong>${tA("adm.set.ssoSpMeta","SP-metadata")}:</strong> <a href="${esc(cfg.metadataUrl)}" target="_blank" rel="noopener">${esc(cfg.metadataUrl)}</a></div>
          </div>
          <form id="admSsoForm">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:12px;cursor:pointer;">
              <input type="checkbox" name="enabled" ${cfg.enabled ? "checked" : ""}> ${tA("adm.set.ssoEnable","SSO inschakelen voor deze organisatie")}
            </label>
            <div class="adm-form-group"><label>${tA("adm.set.ssoLoginUrl","IdP login-URL (SSO endpoint)")}</label>
              <input name="entryPoint" value="${esc(cfg.entryPoint || "")}" placeholder="https://login.microsoftonline.com/.../saml2"></div>
            <div class="adm-form-group"><label>${tA("adm.set.ssoCert","IdP X.509-certificaat (PEM)")}</label>
              <textarea name="idpCert" rows="4" placeholder="-----BEGIN CERTIFICATE-----" style="font-family:monospace;font-size:11px;">${esc(cfg.idpCert || "")}</textarea></div>
            <div class="adm-form-group"><label>${tA("adm.set.ssoDomains","E-maildomeinen (komma-gescheiden)")}</label>
              <input name="domains" value="${esc((cfg.domains || []).join(", "))}" placeholder="bedrijf.be, bedrijf.com"></div>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin:8px 0;cursor:pointer;">
              <input type="checkbox" name="jitEnabled" ${cfg.jit && cfg.jit.enabled ? "checked" : ""}> ${tA("adm.set.ssoJit","Just-in-time provisioning (account automatisch aanmaken bij eerste SSO-login)")}
            </label>
            <div class="adm-form-group"><label>${tA("adm.set.ssoJitRole","Standaardrol bij JIT")}</label>
              <select name="jitRole">
                <option value="employee" ${cfg.jit && cfg.jit.defaultRole === "employee" ? "selected" : ""}>${tA("role.employee","Medewerker")}</option>
                <option value="manager" ${cfg.jit && cfg.jit.defaultRole === "manager" ? "selected" : ""}>${tA("role.manager","Manager")}</option>
              </select></div>
            <div id="admSsoMsg" style="display:none;padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;"></div>
            <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">${tA("adm.set.ssoSave","SSO-instellingen opslaan")}</button></div>
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
            msg.style.cssText = "display:block;background:var(--wf-green-l);color:var(--wf-green);padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;";
            msg.textContent = tA("adm.set.ssoSavedToast","SSO-instellingen opgeslagen ✓");
            paint(r.sso);
          } catch (err) {
            msg.style.cssText = "display:block;background:var(--wf-red-l);color:var(--wf-red);padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;";
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
        msgEl.style.cssText = "display:block;background:var(--wf-green-l);color:var(--wf-green);padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;";
        msgEl.textContent = tA("adm.set.savedToast","Instellingen opgeslagen ✓");
        setTimeout(() => { msgEl.style.display = "none"; }, 3000);
      } catch (err) {
        msgEl.style.cssText = "display:block;background:var(--wf-red-l);color:var(--wf-red);padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;";
        msgEl.textContent = err.message;
      }
    });

    // Module-gebonden instellingen wonen NIET op de centrale Instellingen-pagina;
    // ze zijn bereikbaar via de flyout van hun eigen module (gefocuste sectie).

    (async () => {
      const btn = document.getElementById("admPushToggle");
      const status = document.getElementById("admPushStatus");
      if (!btn || !status) return;
      if (!window.wfpPush) {
        btn.disabled = true;
        status.textContent = tA("adm.set.pushUnavail","Push niet beschikbaar");
        return;
      }
      async function paint() {
        const s = await window.wfpPush.status();
        if (!s.supported) {
          btn.disabled = true;
          status.textContent = tA("adm.set.pushNoSupport","Browser ondersteunt geen push");
          return;
        }
        btn.textContent = s.subscribed ? tA("adm.set.pushDisable","Pushmeldingen uitschakelen") : tA("adm.set.pushEnable","Pushmeldingen inschakelen");
        status.textContent = s.subscribed ? tA("adm.set.pushActive","Actief op dit toestel") : (s.permission === "denied" ? tA("adm.set.pushBlocked","Geblokkeerd in browser") : tA("adm.set.pushInactive","Niet actief"));
      }
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        status.textContent = tA("adm.set.pushBusy","Bezig...");
        try {
          const s = await window.wfpPush.status();
          if (s.subscribed) await window.wfpPush.disable();
          else await window.wfpPush.enable();
          await paint();
        } catch (err) {
          status.textContent = err.message || tA("adm.set.pushFailed","Push kon niet worden aangepast");
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
        msgEl.style.cssText = "display:block;background:var(--wf-green-l);color:var(--wf-green);padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;";
        msgEl.textContent = tA("adm.set.pwChanged","Wachtwoord gewijzigd ✓");
        e.target.reset();
        setTimeout(() => { msgEl.style.display = "none"; }, 3000);
      } catch (err) {
        msgEl.style.cssText = "display:block;background:var(--wf-red-l);color:var(--wf-red);padding:8px 12px;border-radius:8px;font-size:13px;margin-bottom:8px;";
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
          if (statusEl) statusEl.innerHTML = `<span style="color:var(--wf-green);font-weight:600;">${tA("adm.set.mfaActive","MFA actief")}</span> · ${tA("adm.set.mfaActiveNote","uw account is beveiligd met 2FA.")}`;
          if (disableBtn) disableBtn.style.display = "";
          if (setupBtn) setupBtn.textContent = tA("adm.set.mfaResetup","MFA opnieuw instellen");
        } else {
          if (statusEl) statusEl.innerHTML = `<span style="color:var(--wf-yellow);font-weight:600;">${tA("adm.set.mfaInactive","MFA niet actief")}</span> · ${tA("adm.set.mfaInactiveNote","wij raden sterk aan om MFA in te schakelen.")}`;
        }
      } catch(_){}
    })();

    document.getElementById("admMfaSetup")?.addEventListener("click", async () => {
      const wizard = document.getElementById("admMfaWizard");
      if (!wizard) return;
      wizard.style.display = "block";
      wizard.innerHTML = `<div style="font-size:13px;color:var(--gray-500);">${tA("adm.set.mfaSetupLoading","Setup laden…")}</div>`;
      try {
        const data = await api("POST", "/me/mfa/setup");
        const setup = data.setup || {};
        wizard.innerHTML = `
<div style="font-size:14px;font-weight:600;margin-bottom:12px;">${tA("adm.set.mfaStep1","MFA instellen · stap 1 van 2")}</div>
<p style="font-size:13px;color:var(--gray-500);margin-bottom:10px;">${tA("adm.set.mfaAddApp","Voeg dit account toe in Google Authenticator, Authy of een andere TOTP-app via <strong>handmatige invoer</strong>:")}</p>
<div style="margin-bottom:14px;">
  <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.4px;">${tA("adm.set.mfaSecret","Geheime sleutel")}</div>
  <div style="font-family:monospace;background:var(--gray-100);padding:10px 12px;border-radius:8px;font-size:15px;margin-top:4px;word-break:break-all;letter-spacing:1px;text-align:center;">${esc(setup.secret||"")}</div>
  <div style="font-size:11px;color:var(--gray-400);margin-top:6px;">${tA("adm.set.mfaSecretNote","Type: tijdgebaseerd (TOTP) · 6 cijfers · 30s. Accountnaam: je e-mailadres.")}</div>
</div>
<div style="font-size:14px;font-weight:600;margin-bottom:8px;">${tA("adm.set.mfaStep2","Stap 2: bevestig met code")}</div>
<div style="display:flex;gap:8px;">
  <input id="admMfaCode" type="text" inputmode="numeric" maxlength="6" placeholder="${tA("adm.set.mfaCodePh","6-cijferige code")}"
    style="flex:1;12px;font-size:16px;letter-spacing:4px;text-align:center">
  <button class="adm-btn adm-btn-primary" id="admMfaVerify">${tA("adm.set.mfaConfirm","Bevestigen")}</button>
</div>
<div id="admMfaErr" style="display:none;color:var(--wf-red);font-size:12px;margin-top:6px;"></div>`;
        document.getElementById("admMfaVerify")?.addEventListener("click", async () => {
          const code = document.getElementById("admMfaCode")?.value?.trim();
          const errEl = document.getElementById("admMfaErr");
          if (!code || code.length !== 6) { if(errEl){errEl.textContent=tA("adm.set.mfaCodeReq","Vul een 6-cijferige code in.");errEl.style.display="";} return; }
          try {
            await api("POST", "/me/mfa/verify", { token: code });
            wizard.innerHTML = `<div style="color:var(--wf-green);font-weight:600;font-size:14px;">${tA("adm.set.mfaNowActive","MFA is nu actief! Uw account is beveiligd met 2FA.")}</div>`;
            const statusEl = document.getElementById("admMfaStatus");
            if (statusEl) statusEl.innerHTML = `<span style="color:var(--wf-green);font-weight:600;">${tA("adm.set.mfaActive","MFA actief")}</span>`;
            const disableBtn = document.getElementById("admMfaDisable");
            if (disableBtn) disableBtn.style.display = "";
          } catch(err) {
            if(errEl){errEl.textContent=tA("adm.set.mfaInvalidCode","Ongeldige code. Probeer opnieuw.");errEl.style.display="";}
          }
        });
      } catch(e) { wizard.innerHTML = `<div style="color:var(--wf-red);font-size:13px;">${tA("adm.error","Fout")}: ${e.message}</div>`; }
    });

    // MFA verplichten voor alle beheerders
    document.getElementById("admMfaEnforce")?.addEventListener("click", async () => {
      if (!await uiConfirm(tA("adm.set.mfaEnforceConfirm","MFA verplicht maken voor alle beheerders van deze organisatie? Bij de volgende login is een authenticator-code vereist. Bewaar de getoonde secrets en recovery codes zorgvuldig, want ze worden maar één keer getoond."), { title: "MFA verplicht maken", confirmLabel: "MFA verplicht maken" })) return;
      const wizard = document.getElementById("admMfaWizard");
      if (!wizard) return;
      wizard.style.display = "block";
      wizard.innerHTML = `<div style="font-size:13px;color:var(--gray-500);">${tA("adm.set.mfaEnabling","MFA inschakelen…")}</div>`;
      try {
        const d = await api("POST", "/admin/mfa/enforce");
        const enrolled = d.enrolled || [];
        if (!enrolled.length) {
          wizard.innerHTML = `<div style="color:var(--wf-green);font-weight:600;font-size:14px;">${tA("adm.set.mfaAllActive","Alle beheerders hebben al MFA actief.")}</div>`;
          return;
        }
        wizard.innerHTML = `
<div style="font-size:14px;font-weight:600;margin-bottom:4px;color:var(--gray-900);">${tA("adm.set.mfaEnforced","MFA verplicht · {n} beheerder(s) ingeschreven").replace("{n}", enrolled.length)}</div>
<div style="font-size:12px;color:var(--wf-yellow);background:var(--wf-yellow-l);border:1px solid var(--wf-yellow-l);border-radius:8px;padding:10px 12px;margin:10px 0;">
  ${tA("adm.set.mfaSaveNow","Bewaar onderstaande gegevens nu. Ze worden niet opnieuw getoond. Voeg de sleutel toe aan een authenticator-app (Google Authenticator, Authy…).")}
</div>
${enrolled.map(e => `
  <div style="border:1px solid var(--gray-200);border-radius:10px;padding:12px;margin-bottom:10px;">
    <div style="font-weight:600;font-size:13px;color:var(--gray-900);margin-bottom:6px;">${esc(e.name||e.email)} <span style="color:var(--gray-400);font-weight:400;">· ${esc(e.email)}</span></div>
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
      <div style="flex:1;min-width:180px;">
        <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.4px;">${tA("adm.set.mfaSecret","Geheime sleutel")}</div>
        <div style="font-family:monospace;background:var(--gray-100);padding:6px 10px;border-radius:6px;font-size:12px;word-break:break-all;margin:3px 0 8px;">${esc(e.secret||"")}</div>
        <div style="font-size:11px;color:var(--gray-400);text-transform:uppercase;letter-spacing:.4px;">${tA("adm.set.mfaRecovery","Recovery codes")}</div>
        <div style="font-family:monospace;font-size:11.5px;color:var(--gray-700);line-height:1.7;">${(e.recoveryCodes||[]).map(c=>esc(c)).join(" &nbsp; ")}</div>
      </div>
    </div>
  </div>`).join("")}
<button class="adm-btn adm-btn-primary adm-btn-sm" id="admMfaEnforceDone" style="margin-top:4px;">${tA("adm.set.mfaSavedAll","Ik heb alles opgeslagen")}</button>`;
        document.getElementById("admMfaEnforceDone")?.addEventListener("click", () => {
          wizard.style.display = "none";
          const statusEl = document.getElementById("admMfaStatus");
          if (statusEl) statusEl.innerHTML = `<span style="color:var(--wf-green);font-weight:600;">${tA("adm.set.mfaEnforcedAdmins","MFA verplicht voor beheerders")}</span>`;
          window.showToast && window.showToast(tA("adm.set.mfaEnforcedToast","MFA verplicht ingesteld voor beheerders"), "success");
        });
      } catch(e) { wizard.innerHTML = `<div style="color:var(--wf-red);font-size:13px;">${tA("adm.error","Fout")}: ${e.message}</div>`; }
    });

    // Bewaarbeleid (retention) laden + bewerken
    loadBackupPolicy();

    // Backup
    document.getElementById("admBackupCreate")?.addEventListener("click", async () => {
      const resultEl = document.getElementById("admBackupResult");
      if(resultEl) resultEl.innerHTML = `<div style="font-size:13px;color:var(--gray-500);">${tA("adm.set.backupCreating","Backup aanmaken…")}</div>`;
      try {
        const d = await api("POST", "/admin/backups");
        const backup = d.backup || {};
        if (resultEl) resultEl.innerHTML = `
<div style="background:var(--wf-green-l);border-radius:8px;padding:10px 14px;font-size:13px;color:var(--wf-green);">
  ${tA("adm.set.backupCreated","Backup aangemaakt")}: <strong>${esc(backup.id||"")}</strong><br>
  <span style="font-size:11px;">${new Date(backup.createdAt||Date.now()).toLocaleString("nl-BE")}</span>
  <button class="adm-btn adm-btn-secondary adm-btn-sm" id="admBackupDownload" style="margin-top:8px;display:block;" data-id="${esc(backup.id||"")}">${tA("adm.set.downloadJson","Download JSON")}</button>
</div>`;
        document.getElementById("admBackupDownload")?.addEventListener("click", async () => {
          try {
            const pv = await api("GET", `/admin/backups/${backup.id}/preview`);
            const blob = new Blob([JSON.stringify(pv, null, 2)], { type: "application/json" });
            const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
            a.download = `backup-${backup.id}.json`; a.click();
          } catch(e2) { window.showToast(tA("adm.set.downloadError","Download fout")+": "+e2.message, "error"); }
        });
      } catch(e) { if(resultEl) resultEl.innerHTML = `<div style="color:var(--wf-red);font-size:13px;">${tA("adm.error","Fout")}: ${e.message}</div>`; }
    });

    document.getElementById("admBackupList")?.addEventListener("click", async () => {
      const resultEl = document.getElementById("admBackupResult");
      try {
        const d = await api("GET", "/admin/backups");
        const rows = d.rows || [];
        if(resultEl) resultEl.innerHTML = rows.length ? `
<div style="margin-top:8px;">
  ${rows.map(b=>`<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--gray-100);font-size:12px;">
    <span style="font-family:monospace;color:var(--wf-purple);">${esc(b.id||"")}</span>
    <span style="color:var(--gray-500);">${b.createdAt?new Date(b.createdAt).toLocaleString("nl-BE"):""}</span>
    <span style="color:var(--gray-500);">${b.tenantCount||0} tenants</span>
  </div>`).join("")}
</div>` : `<div style="font-size:13px;color:var(--gray-400);margin-top:8px;">${tA("adm.set.noBackups","Geen backups gevonden")}</div>`;
      } catch(e) { if(resultEl) resultEl.innerHTML = `<div style="color:var(--wf-red);font-size:13px;">${tA("adm.error","Fout")}: ${e.message}</div>`; }
    });
  }

  // Backup-bewaarbeleid (retentie) · ALLEEN-LEZEN voor de tenant-beheerder.
  // Configuratie gebeurt centraal door Monargo (superadmin) per tenant.
  async function loadBackupPolicy() {
    const box = document.getElementById("admBackupPolicy");
    if (!box) return;
    let d;
    try { d = await api("GET", "/admin/backup-policy"); }
    catch (e) { box.innerHTML = `<div style="color:var(--wf-red);font-size:13px;">${tA("adm.set.policyLoadFail","Bewaarbeleid laden mislukt")}: ${esc(e.message)}</div>`; return; }
    const p = d.policy || {};
    const c = d.counts || { total:0, toKeep:0, toPrune:0 };
    const yrs = days => days < 365 ? `${days} ${tA("adm.set.days","dagen")}` : (days % 365 === 0 ? `${days/365} ${tA("adm.set.years","jaar")}` : `${Math.round(days/365*10)/10} ${tA("adm.set.years","jaar")}`);
    const item = (label, val) => `<div><div style="font-size:11px;color:var(--muted);margin-bottom:2px;">${label}</div><div style="font-size:14px;font-weight:600;color:var(--ink);">${val}</div></div>`;
    box.innerHTML = `
<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;flex-wrap:wrap;">
  <div style="font-size:14px;font-weight:600;color:var(--ink);">${tA("adm.set.retentionPolicy","Bewaarbeleid")}</div>
  <div style="font-size:12px;color:var(--muted);">${c.total} backup(s) · ${c.toKeep} ${tA("adm.set.kept","behouden")}${c.toPrune?` · <span style="color:var(--wf-yellow);">${c.toPrune} ${tA("adm.set.outOfTerm","buiten termijn")}</span>`:""}</div>
</div>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;">
  ${item(tA("adm.set.retentionTerm","Bewaartermijn"), yrs(p.retentionDays))}
  ${item(tA("adm.set.frequency","Frequentie"), p.frequency === "weekly" ? tA("adm.set.weekly","Wekelijks") : tA("adm.set.daily","Dagelijks"))}
  ${item(tA("adm.set.keepMin","Minimaal behouden"), p.keepMinimum)}
  ${item(tA("adm.set.legalHold","Legal hold"), p.legalHold ? `<span style="color:var(--wf-yellow);">${tA("adm.active","Actief")}</span>` : tA("adm.set.off","Uit"))}
</div>
<div style="margin-top:12px;font-size:11.5px;color:var(--gray-400);display:flex;align-items:center;gap:6px;">
  <span style="display:inline-flex;width:15px;height:15px;"></span>
  ${tA("adm.set.policyManaged","Dit beleid wordt centraal beheerd door Monargo. Wil je het aanpassen, neem contact op met support.")}
</div>
<details style="margin-top:14px;">
  <summary style="font-size:12px;color:var(--wf-blue);cursor:pointer;">${tA("adm.set.legalTermsInfo","Wettelijke bewaartermijnen (België) · info")}</summary>
  <div style="font-size:12px;color:var(--muted);margin-top:8px;line-height:1.6;">
    ${tA("adm.set.legalTermsBody","Deze backups zijn <strong>herstelmomenten (disaster recovery)</strong>, geen wettelijk archief. De wettelijke bewaarplicht rust op je live-data:")}
    <ul style="margin:6px 0 0;padding-left:18px;">
      ${(d.legalReference||[]).map(r=>`<li>${esc(r.label)}: <strong>${yrs(r.days)}</strong> <span style="color:var(--gray-400);">- ${esc(r.note)}</span></li>`).join("")}
    </ul>
    <div style="margin-top:8px;">${tA("adm.set.gdprNote","Conform GDPR art. 5(1)(e) (opslagbeperking) worden backups buiten de termijn automatisch en veilig opgeruimd; de {n} nieuwste blijven altijd bewaard.").replace("{n}", esc(p.keepMinimum))}</div>
  </div>
</details>`;
  }

  // ── Helpers ────────────────────────────────────────────────
  function openDrawer() {
    const drawer = document.getElementById("admDrawer");
    const body = document.getElementById("admDrawerBody");
    const isDocument = Boolean(body?.querySelector("#invForm, #qForm, #woForm"));
    const isPlanning = Boolean(body?.querySelector("#admShiftForm"));
    drawer.dataset.editorKind = isPlanning ? "planning" : isDocument ? "document" : "record";
    const context = document.getElementById("admDrawerContext");
    if (context && !isPlanning) context.textContent = isDocument ? "Documentwerkruimte" : "Bewerkingsruimte";
    drawer.classList.remove("hidden");
    document.getElementById("admOverlay").classList.remove("hidden");
    document.documentElement.classList.add("adm-editor-open");
    window.requestAnimationFrame(() => drawer.focus({ preventScroll:true }));
  }

  function closeDrawer() {
    const drawer = document.getElementById("admDrawer");
    drawer.classList.add("hidden");
    drawer.dataset.editorKind = "record";
    document.getElementById("admOverlay").classList.add("hidden");
    document.documentElement.classList.remove("adm-editor-open");
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

    // NL/FR/EN: vertaal de nav + herhaal bij taalwissel. De knop cycelt
    // NL → FR → EN en toont de taal waarnaar je overschakelt.
    if (window.wfpI18n) {
      const i18nRoot = document.getElementById("platform-admin");
      const paintLang = () => {
        const b = document.getElementById("admLangToggle");
        if (b) b.textContent = window.wfpI18n.nextLang(window.wfpI18n.lang).toUpperCase();
      };
      window.wfpI18n.apply(i18nRoot);
      paintLang();
      document.getElementById("admLangToggle")?.addEventListener("click", () => window.wfpI18n.cycleLang());
      document.addEventListener("wfp:langchange", () => {
        window.wfpI18n.apply(i18nRoot);
        paintLang();
        // t()-gebaseerde scherminhoud herrenderen (paginatitel + huidige view).
        document.getElementById("admPageTitle").textContent = (window.wfpTerms && (_currentView === "workorders" ? window.wfpTerms.t("jobPlural") : _currentView === "venues" ? window.wfpTerms.t("venuePlural") : null)) || VIEW_LABELS[_currentView] || _currentView;
        if (_currentView) switchView(_currentView);
      });
    }

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

    // ── Persoonlijke prikklok (topbar) · iedereen kan in-/uitklokken ──
    (function wireClock(){
      const btn = document.getElementById("admClockBtn");
      if (!btn) return;
      const lbl = document.getElementById("admClockLbl");
      let active = null, timer = null;
      function paint(){
        if (active){
          const h = (Date.now() - new Date(active.clockedIn).getTime()) / 3600000;
          btn.classList.add("on");
          lbl.textContent = `Uitklokken · ${h.toFixed(1)} u`;
        } else {
          btn.classList.remove("on");
          lbl.textContent = "Inklokken";
        }
      }
      async function refresh(){
        try { const d = await api("GET", "/me/clock"); active = d.active || null; }
        catch(_) { active = null; }
        paint();
        if (timer) clearInterval(timer);
        if (active) timer = setInterval(() => {
          if (document.getElementById("platform-admin")?.classList.contains("hidden")) { clearInterval(timer); return; }
          paint();
        }, 30000);
      }
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await api("POST", active ? "/me/clock/out" : "/me/clock/in", {});
          window.showToast && window.showToast(active ? "Uitgeklokt" : "Ingeklokt", "success");
          await refresh();
          if (_currentView === "clocking") renderClocking();
        } catch(e){ window.showToast && window.showToast(e.message, "error"); }
        finally { btn.disabled = false; }
      });
      refresh();
    })();

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
      document.addEventListener("keydown", e => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
          e.preventDefault();
          input.focus();
          input.select();
        }
      });
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
        notifList.innerHTML = `<div class="adm-notif-empty">Geen notificaties</div>`;
        return;
      }
      notifList.innerHTML = _notifCache.slice(0, 20).map(n => {
        const isRead = n.status === "read";
        return `<div class="adm-notif-item ${isRead ? "" : "unread"}" data-nid="${esc(n.id)}">
          <div class="adm-notif-dot ${isRead ? "read" : ""}"></div>
          <div class="adm-notif-body">
            <div>${esc(n.title || n.message || "Notificatie")}</div>
            ${n.body ? `<div style="color:var(--gray-500);margin-top:2px;font-size:11.5px">${esc(n.body)}</div>` : ""}
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
      if (bellDot) {
        bellDot.textContent = unread > 99 ? "99+" : String(unread);
        bellDot.style.display = unread > 0 ? "" : "none";
      }
      const actionBadge = document.getElementById("admActionBadge");
      if (actionBadge) {
        actionBadge.textContent = unread > 99 ? "99+" : String(unread);
        actionBadge.style.display = unread > 0 ? "" : "none";
      }
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

    document.getElementById("admNotifOpenActions")?.addEventListener("click", () => {
      notifPanel?.classList.remove("open");
      switchView("actions");
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
    catch (e) { c.innerHTML = `<div class="adm-card"><div class="adm-card-body" style="color:var(--wf-red)">${esc(e.message)}</div></div>`; return; }
    _tplMeta = { types: data.types || {}, fields: data.fields || {}, columns: data.columns || {} };
    const tpls = data.templates || [];
    const typeKeys = Object.keys(_tplMeta.types);
    c.innerHTML = `
<div class="adm-card template-intro-card">
  <div style="font-size:13px;color:var(--gray-600)">Maak je eigen sjablonen voor facturen, offertes en werkbon-rapporten · met je logo, kleuren en de velden die jij wil. Het systeem drukt elk document af volgens het gekozen sjabloon.</div>
  <select id="tplNew" class="adm-input" style="max-width:230px"><option value="">+ Nieuw sjabloon…</option>${typeKeys.map(t => `<option value="${t}">+ ${esc(_tplMeta.types[t].label)}</option>`).join("")}</select>
</div>
${typeKeys.map(tk => {
  const list = tpls.filter(t => t.type === tk);
  return `<div class="adm-card template-type-card"><div class="adm-card-header"><h3 class="adm-card-title">${esc(_tplMeta.types[tk].label)}</h3><span>${list.length} ontwerp${list.length === 1 ? "" : "en"}</span></div>
    <div class="adm-card-body" style="padding:0">
    ${list.length ? `<table class="adm-table"><tbody>${list.map(t => `<tr>
      <td style="font-weight:600">${esc(t.name)} ${t.isDefault ? '<span class="adm-status adm-status-active" style="margin-left:6px">standaard</span>' : ""}</td>
      <td style="text-align:right;white-space:nowrap">
        ${t.isDefault ? "" : `<button class="adm-btn adm-btn-secondary adm-btn-sm tpl-default" data-id="${esc(t.id)}">Maak standaard</button>`}
        <button class="adm-btn adm-btn-secondary adm-btn-sm tpl-edit" data-id="${esc(t.id)}">Bewerken</button>
        <button class="adm-btn adm-btn-secondary adm-btn-sm tpl-prev" data-id="${esc(t.id)}">Voorbeeld</button>
        <button class="adm-btn adm-btn-danger adm-btn-sm tpl-del" data-id="${esc(t.id)}"><svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
      </td></tr>`).join("")}</tbody></table>`
    : `<div style="padding:16px;color:var(--gray-400);font-size:13px">Nog geen sjabloon · er wordt een nette standaard gebruikt tot je er één maakt.</div>`}
    </div></div>`;
}).join("")}`;
    document.getElementById("tplNew").addEventListener("change", e => { if (e.target.value) { _tplEditing = { type: e.target.value, ...defaultTplDraft(e.target.value) }; renderTemplates(); } });
    c.querySelectorAll(".tpl-edit").forEach(b => b.addEventListener("click", () => { _tplEditing = tpls.find(t => t.id === b.dataset.id); renderTemplates(); }));
    c.querySelectorAll(".tpl-del").forEach(b => b.addEventListener("click", async () => { if (!await uiConfirm("Sjabloon verwijderen?", { title: "Documentsjabloon verwijderen", danger: true, confirmLabel: "Verwijderen" })) return; try { await api("DELETE", `/templates/${b.dataset.id}`); renderTemplates(); } catch (e) { window.showToast && window.showToast(e.message, "error"); } }));
    c.querySelectorAll(".tpl-default").forEach(b => b.addEventListener("click", async () => { try { await api("POST", `/templates/${b.dataset.id}/default`, {}); renderTemplates(); } catch (e) { window.showToast && window.showToast(e.message, "error"); } }));
    c.querySelectorAll(".tpl-prev").forEach(b => b.addEventListener("click", async () => {
      try { const r = await api("GET", `/templates/${b.dataset.id}/preview`); const w = window.open("", "_blank"); w.document.write(r.html); w.document.close(); }
      catch (e) { window.showToast && window.showToast(e.message, "error"); }
    }));
  }

  function defaultTplDraft(type) {
    return { name: `Mijn ${(_tplMeta.types[type] || {}).label || type}`, accentColor: "#0071E3", logo: null, headerText: "", introText: "", footerText: "{{bedrijf.naam}} · {{bedrijf.btw}} · {{bedrijf.email}}", paymentTerms: type === "invoice" ? "Gelieve te betalen voor de vervaldatum op {{bedrijf.iban}}." : "", columns: (_tplMeta.types[type] || {}).defaultColumns || ["description", "qty", "unitPrice", "vatRate", "lineTotal"], showVat: true, language: "nl" };
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
  <h3 class="adm-card-title">${d.id ? "Sjabloon bewerken" : "Nieuw sjabloon"} · ${esc((_tplMeta.types[d.type] || {}).label || d.type)}</h3>
  <button class="adm-btn adm-btn-secondary adm-btn-sm" id="tplBack">← Terug</button>
</div></div>
<div class="adm-grid-2 template-editor-grid">
  <div class="adm-card template-editor-form"><div class="adm-card-body">
    <div class="adm-form-group"><label>Naam</label><input class="adm-input" id="t_name" value="${esc(d.name || "")}"></div>
    <div class="adm-form-row">
      <div class="adm-form-group"><label>Accentkleur</label><div class="template-color-field"><input type="color" class="adm-input" id="t_accent" value="${esc(/^#[0-9a-fA-F]{6}$/.test(d.accentColor || "") ? d.accentColor : "#0071E3")}"><span>Monargo Blue · #0071E3</span></div></div>
      <div class="adm-form-group"><label>Taal</label><select class="adm-input" id="t_lang"><option value="nl" ${d.language === "nl" ? "selected" : ""}>Nederlands</option><option value="fr" ${d.language === "fr" ? "selected" : ""}>Frans</option></select></div>
    </div>
    <div class="adm-form-group"><label>Logo (optioneel)</label><input type="file" id="t_logo" accept="image/*" class="adm-input" style="padding:6px">${d.logo ? '<div style="font-size:12px;color:var(--wf-green);margin-top:4px">logo ingesteld <a href="#" id="t_logo_clear">verwijderen</a></div>' : ""}</div>
    <div class="adm-form-group"><label>Eigen koptekst (leeg = bedrijfsblok)</label><textarea class="adm-input" id="t_header" rows="2" placeholder="Bv. {{bedrijf.naam}} · uw partner">${esc(d.headerText || "")}</textarea>${fieldPicker("t_header")}</div>
    <div class="adm-form-group"><label>Inleidingstekst</label><textarea class="adm-input" id="t_intro" rows="2">${esc(d.introText || "")}</textarea>${fieldPicker("t_intro")}</div>
    ${isFinancial ? `<div class="adm-form-group"><label>Kolommen</label><div style="display:flex;flex-wrap:wrap;gap:10px">${Object.keys(colDefs).map(k => `<label style="font-weight:400;font-size:12.5px;display:inline-flex;gap:5px;align-items:center"><input type="checkbox" class="t_col" value="${k}" ${(d.columns || []).includes(k) ? "checked" : ""}>${esc(colDefs[k])}</label>`).join("")}</div></div>
    <label style="font-weight:400;font-size:12.5px;display:inline-flex;gap:6px;align-items:center;margin-bottom:12px"><input type="checkbox" id="t_vat" ${d.showVat !== false ? "checked" : ""}> Btw-totaal tonen</label>
    <div class="adm-form-group"><label>Betaalvoorwaarden</label><textarea class="adm-input" id="t_terms" rows="2">${esc(d.paymentTerms || "")}</textarea>${fieldPicker("t_terms")}</div>` : ""}
    <div class="adm-form-group"><label>Voettekst</label><textarea class="adm-input" id="t_footer" rows="2">${esc(d.footerText || "")}</textarea>${fieldPicker("t_footer")}</div>
    <label style="font-weight:400;font-size:12.5px;display:inline-flex;gap:6px;align-items:center;margin-bottom:12px"><input type="checkbox" id="t_default" ${d.isDefault ? "checked" : ""}> Als standaard gebruiken voor dit type</label>
    <div class="adm-form-actions"><span id="t_msg" style="font-size:12px;color:var(--wf-red);flex:1;text-align:left"></span><button class="adm-btn adm-btn-primary" id="t_save">Opslaan</button></div>
  </div></div>
  <div class="adm-card template-preview-card"><div class="adm-card-header"><div><h3 class="adm-card-title">Live voorbeeld</h3><p>Het document ververst automatisch terwijl u werkt.</p></div></div>
    <iframe id="t_prev" class="template-preview-frame" title="Live documentvoorbeeld"></iframe>
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
        _tplEditing = null; renderTemplates(); window.showToast && window.showToast("Sjabloon opgeslagen", "success");
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
    catch (e) { c.innerHTML = `<div class="adm-card" style="padding:16px;color:var(--wf-red)">${esc(e.message)}</div>`; return; }
    const rows = data.declarations || [];
    const statusBadge = s => {
      const map = { confirmed: ["var(--wf-green-l)", "var(--wf-green)", "bevestigd"], sent: ["var(--wf-blue-l)", "var(--wf-blue)", "verzonden"], failed: ["var(--wf-red-l)", "var(--wf-red)", "mislukt"], rejected: ["var(--wf-red-l)", "var(--wf-red)", "geweigerd"] };
      const [bg, fg, label] = map[s] || ["var(--gray-100)", "var(--gray-600)", s || "-"];
      return `<span style="background:${bg};color:${fg};padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600">${esc(label)}</span>`;
    };
    const geoBadge = d => d.geoVerified ? `<span title="binnen geofence" style="color:var(--wf-green)">✓${d.geoDistanceM != null ? ` ${d.geoDistanceM}m` : ""}</span>` : (d.geoDistanceM != null ? `<span title="buiten geofence" style="color:var(--wf-yellow)">${d.geoDistanceM}m</span>` : `<span style="color:var(--gray-400)">-</span>`);
    const rsz = data.rszEmployerId || "";
    c.innerHTML = `
<div class="adm-card" style="padding:14px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
  <div style="font-size:13px;color:var(--gray-600)">Aanwezigheidsaangiftes (RSZ/ONSS) gebeuren <strong>automatisch</strong> bij in- en uitklokken. Hieronder de recente aangiftes met locatieverificatie.</div>
  <button class="adm-btn-secondary" id="ciawRefresh" style="white-space:nowrap">↻ Vernieuwen</button>
</div>
<div class="adm-card" style="padding:14px 16px;margin-bottom:14px">
  <div style="font-weight:600;font-size:13px;margin-bottom:6px">RSZ-werkgeversnummer</div>
  <div style="font-size:12.5px;color:var(--gray-500);margin-bottom:8px">Vereist voor geldige Checkin@Work-aangiftes. Het rijksregisternummer van elke medewerker stel je in op de medewerkersfiche.${rsz ? "" : ` <strong style="color:var(--wf-red)">Nog niet ingesteld · aangiftes worden geweigerd.</strong>`}</div>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
    <input id="ciawRsz" class="adm-input" value="${esc(rsz)}" placeholder="bv. 12345678" style="max-width:220px">
    <button class="adm-btn-primary" id="ciawRszSave">Opslaan</button>
    <span id="ciawRszMsg" style="font-size:12px;color:var(--wf-green)"></span>
  </div>
</div>
<div class="adm-card" style="margin-bottom:14px">
  <div class="adm-card-header" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
    <div style="font-weight:600;font-size:13px">Aanwezigheidsregister (werfcontrole) <span style="font-weight:400;color:var(--gray-500)">- ${presence.present} aanwezig${presence.issues ? `, <span style="color:var(--wf-red)">${presence.issues} zonder bevestigde aangifte</span>` : ""}</span></div>
    <button class="adm-btn adm-btn-secondary adm-btn-sm" id="ciawPresenceCsv">Export voor controle (CSV)</button>
  </div>
  <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Werf</th><th>Medewerker</th><th>INSZ</th><th>Sinds</th><th>CIAW</th></tr></thead><tbody>
    ${(presence.rows || []).map(r => `<tr>
      <td>${esc(r.venue)}</td>
      <td>${esc(r.name)}</td>
      <td style="font-family:monospace;font-size:12px">${r.insz ? esc(r.insz) : '<span style="color:var(--wf-red)">ontbreekt</span>'}${r.insz && !r.inszValid ? ' <span title="ongeldig controlegetal" style="color:var(--wf-red)"></span>' : ""}</td>
      <td style="font-size:12px;color:var(--gray-500)">${esc((r.since || "").replace("T", " "))}</td>
      <td>${statusBadge(r.ciawStatus === "none" ? "-" : r.ciawStatus)}</td>
    </tr>`).join("") || `<tr><td colspan="5" style="padding:18px;text-align:center;color:var(--gray-400)">Niemand momenteel ingeklokt.</td></tr>`}
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
      <td style="font-family:monospace;font-size:12px">${esc(d.reference || "-")}${d.error ? `<div style="color:var(--wf-red);font-size:11px">${esc(d.error)}</div>` : ""}</td>
      <td>${d.live ? "live" : "<span style='color:var(--gray-500)'>mock</span>"}</td>
      <td>${failed ? `<button class="adm-btn adm-btn-secondary adm-btn-sm ciaw-retry" data-clock="${esc(d.clockId)}" data-action="${d.action === "OUT" ? "out" : "in"}" style="padding:3px 9px;font-size:12px">↻ Opnieuw</button>` : ""}</td>
    </tr>`;}).join("") || `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--gray-400)">Nog geen aangiftes. Ze verschijnen zodra medewerkers in-/uitklokken.</td></tr>`}
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
      try { await api("POST", "/compliance/rsz", { rszEmployerId: document.getElementById("ciawRsz").value }); msg.style.color = "var(--wf-green)"; msg.textContent = "Opgeslagen ✓"; }
      catch (e) { msg.style.color = "var(--wf-red)"; msg.textContent = e.message; }
    });
    c.querySelectorAll(".ciaw-retry").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true; b.textContent = "Bezig…";
      try {
        const r = await api("POST", "/ciaw/checkin", { clockId: b.dataset.clock, action: b.dataset.action });
        window.showToast && window.showToast(r.ok ? "Aangifte opnieuw ingediend" : ("Nog steeds geweigerd: " + (r.error || "")), r.ok ? "success" : "error");
        renderCiaw();
      } catch (e) { window.showToast && window.showToast(e.message, "error"); b.disabled = false; b.textContent = "↻ Opnieuw"; }
    }));
  }

  // ── Compliance: A1 / Limosa detachering ────────────────────
  async function renderPostedWorkers() {
    const c = document.getElementById("admContent");
    let data = {};
    try { data = await api("GET", "/posted_workers"); }
    catch (e) { c.innerHTML = `<div class="adm-card" style="padding:16px;color:var(--wf-red)">${esc(e.message)}</div>`; return; }
    const rows = data.rows || [];
    const a1Badge = s => {
      const map = { valid: ["var(--wf-green-l)", "var(--wf-green)", "geldig"], expiring: ["var(--wf-yellow-l)", "var(--wf-yellow)", "verloopt < 30d"], expired: ["var(--wf-red-l)", "var(--wf-red)", "verlopen"], missing: ["var(--gray-100)", "var(--gray-600)", "geen A1"], unknown: ["var(--gray-100)", "var(--gray-600)", "onbekend"] };
      const [bg, fg, label] = map[s] || map.unknown;
      return `<span style="background:${bg};color:${fg};padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600">${esc(label)}</span>`;
    };
    c.innerHTML = `
<div class="adm-card" style="padding:14px 16px;margin-bottom:14px">
  <div style="font-size:13px;color:var(--gray-600);margin-bottom:6px">Detacheringsdossiers van (onder)aannemers en buitenlandse werknemers. Bewaak de geldigheid van A1-attesten en dien Limosa-meldingen in.</div>
  <div style="font-size:12px;margin-bottom:6px">Limosa-provider: ${data.limosaMode === "live" ? '<span style="color:var(--wf-green);font-weight:600">● actief (live)</span>' : '<span style="color:var(--wf-yellow);font-weight:600">● testmodus (mock)</span> · meldingen worden gesimuleerd tot de provider live staat'}</div>
  <div style="display:flex;gap:14px;font-size:12px;color:var(--gray-500)">
    <span>${data.total || 0} dossiers</span>
    ${data.expired ? `<span style="color:var(--wf-red)">${data.expired} verlopen</span>` : ""}
    ${data.expiring ? `<span style="color:var(--wf-yellow)">${data.expiring} verloopt binnenkort</span>` : ""}
    ${data.missing ? `<span style="color:var(--gray-500)">${data.missing} zonder A1</span>` : ""}
  </div>
</div>
<div class="adm-card" style="padding:14px 16px;margin-bottom:14px">
  <div style="font-weight:600;font-size:13px;margin-bottom:10px">Nieuw detacheringsdossier</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:end">
    <label style="font-size:12px;font-weight:600;color:var(--gray-700)">Werknemer<input id="pwName" class="adm-input" placeholder="Naam"></label>
    <label style="font-size:12px;font-weight:600;color:var(--gray-700)">Onderaannemer<input id="pwSub" class="adm-input" placeholder="Bedrijf (optioneel)"></label>
    <label style="font-size:12px;font-weight:600;color:var(--gray-700)">Land<input id="pwCountry" class="adm-input" placeholder="bv. PL" maxlength="2" style="text-transform:uppercase"></label>
    <label style="font-size:12px;font-weight:600;color:var(--gray-700)">A1-referentie<input id="pwRef" class="adm-input" placeholder="A1-nr"></label>
    <label style="font-size:12px;font-weight:600;color:var(--gray-700)">Geldig van<input id="pwFrom" type="date" class="adm-input"></label>
    <label style="font-size:12px;font-weight:600;color:var(--gray-700)">Geldig tot<input id="pwTo" type="date" class="adm-input"></label>
    <label style="font-size:12px;font-weight:600;color:var(--gray-700)">A1-attest (PDF/foto)<input id="pwFile" type="file" accept="application/pdf,image/*" class="adm-input" style="padding:6px"></label>
    <button class="adm-btn-primary" id="pwAdd">Toevoegen</button>
  </div>
  <div id="pwMsg" style="font-size:12px;margin-top:8px"></div>
</div>
<div class="adm-card" style="overflow:auto">
  <table class="adm-table"><thead><tr><th>Werknemer</th><th>Onderaannemer</th><th>Land</th><th>A1</th><th>Geldigheid</th><th>Limosa</th><th></th></tr></thead><tbody>
    ${rows.map(r => `<tr data-id="${esc(r.id)}">
      <td>${esc(r.workerName)}</td>
      <td>${esc(r.subcontractor || "-")}</td>
      <td>${esc(r.country || "-")}</td>
      <td>${a1Badge(r.a1Status)}${r.documentRef ? `<div style="font-size:11px;color:var(--gray-500);font-family:monospace">${esc(r.documentRef)}</div>` : ""}${r.hasFile ? ` <a class="pw-file" data-id="${esc(r.id)}" href="#" style="font-size:11px">attest</a>` : ""}</td>
      <td style="font-size:12px;color:var(--gray-600)">${esc(r.validFrom || "?")} → ${esc(r.validTo || "?")}</td>
      <td>${r.limosa && r.limosa.reference ? `<span style="font-size:12px;color:var(--wf-green)">${esc(r.limosa.reference)}</span>` : `<button class="adm-btn-secondary pw-limosa" data-id="${esc(r.id)}" style="padding:4px 10px;font-size:12px">Indienen</button>`}</td>
      <td><button class="pw-del" data-id="${esc(r.id)}" title="Verwijderen" style="border:none;background:none;cursor:pointer;color:var(--wf-red);font-size:16px"><svg viewBox="0 0 24 24" style="width:15px;height:15px;fill:currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button></td>
    </tr>`).join("") || `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--gray-400)">Nog geen detacheringsdossiers.</td></tr>`}
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
        if (file.size > 5 * 1024 * 1024) { msg.style.color = "var(--wf-red)"; msg.textContent = "A1-bestand is te groot (max 5MB)"; return; }
        payload.documentFile = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(file); });
        payload.documentFileName = file.name;
      }
      try { await api("POST", "/posted_workers", payload); renderPostedWorkers(); window.showToast && window.showToast("Dossier toegevoegd", "success"); }
      catch (e) { msg.style.color = "var(--wf-red)"; msg.textContent = e.message; }
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
      try { await api("POST", `/posted_workers/${b.dataset.id}/limosa`, {}); renderPostedWorkers(); window.showToast && window.showToast("Limosa-melding ingediend", "success"); }
      catch (e) { window.showToast && window.showToast(e.message, "error"); b.disabled = false; b.textContent = "Indienen"; }
    }));
    c.querySelectorAll(".pw-del").forEach(b => b.addEventListener("click", async () => {
      if (!await uiConfirm("Dit detacheringsdossier verwijderen?", { title: "Detacheringsdossier verwijderen", danger: true, confirmLabel: "Verwijderen" })) return;
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
  A.showIntegrationMode = mode => { _integrationMode = ["automations", "fields"].includes(mode) ? mode : "connectors"; switchView("integrations"); };
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
    dashboard: renderDashboard, actions: renderActionCenter, operations: renderOperationsOverview, employees: renderEmployees, planning: renderPlanning,
    appointments: renderAppointments, incidents: renderIncidents, inbox: renderInbox,
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
    vehicle: openVehicleDrawer, stock: openStockDrawer,
    workorder: prefill => openWorkorderDrawer(null, null, prefill || {}),
    shift: prefill => {
      const today = new Date().toISOString().slice(0,10);
      openShiftDrawer(today, today, null, [], prefill || {});
    },
    appointment: openAppointmentDrawer,
    incident: openIncidentDrawer, inquiry: openInquiryDrawer
  });

  window.wfp_adminInit = init;
}());
