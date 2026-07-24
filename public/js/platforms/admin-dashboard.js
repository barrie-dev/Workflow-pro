/* ── Dashboard · admin-werkruimte ───────────────────────────────────────────
 * Letterlijk uit public/js/platforms/admin.js gehaald (regels 1351-1919):
 * de orkestrator met filter (overzicht / mijn dashboard / organisatie), het
 * widget-dashboard voor persoon en organisatie, en het standaard-cockpit met
 * KPI's, live werkbord, planning, donut, activiteit en actiecentrum.
 *
 * De code hieronder is ONGEWIJZIGD overgenomen · alleen de omhulling is nieuw.
 * Gedeelde helpers worden niet gekopieerd maar uit window.wfpAdmin gelezen,
 * zodat er geen tweede waarheid ontstaat.
 */
(function () {
  "use strict";
  const A = window.wfpAdmin;
  if (!A) return;

  // Uit de gedeelde context · deze staan al op window.wfpAdmin.
  const esc = A.esc;
  const api = A.api;
  const viewEnabled = A.viewEnabled;
  const switchView = A.switchView;
  const openEmployeeDrawer = emp => A.drawers.employee(emp);
  const openCustomerDrawer = customer => A.drawers.customer(customer);

  // i18n-adapter · leest dezelfde bron (window.wfpI18n) als admin.js, dus dit
  // is geen tweede vertaalwaarheid. Zelfde patroon als admin-domains.js.
  function tA(key, fallback) { return window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback; }

  // NOG NIET geexposeerd op window.wfpAdmin. Laat gebonden opgehaald zodat dit
  // bestand meteen werkt zodra admin.js ze toevoegt · kopieren zou hun logica
  // verdubbelen. Let op: A.drawers.workorder is hier NIET bruikbaar, die neemt
  // alleen een prefill en verliest de meegegeven werkbon en lijst.
  const uName = rec => A.uName(rec);
  const uiConfirm = (message, options) => A.uiConfirm(message, options);
  const navFlyoutGo = (parentView, item) => A.navFlyoutGo(parentView, item);
  const openLeaveReviewModal = (leaveId, decision, leave, onDone) => A.openLeaveReviewModal(leaveId, decision, leave, onDone);
  const openWorkorderDrawer = (workorder, preloadedWOs, prefill) => A.openWorkorderDrawer(workorder, preloadedWOs, prefill);

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

  A.views = A.views || {};
  A.views.dashboard = renderDashboard;
}());
