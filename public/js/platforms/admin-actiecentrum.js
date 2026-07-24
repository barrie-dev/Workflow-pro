/* ── Actiecentrum · uitgeknipt uit public/js/platforms/admin.js ────────────
 * Zelfstandige view-renderer die zich registreert als window.wfpAdmin.views.actions.
 * De code is LETTERLIJK dezelfde als in admin.js (regels 1110-1235); alleen de
 * omhulling veranderde. Wat niet meeverhuisde komt uit de gedeelde context A.
 */
(function () {
  "use strict";
  const A = window.wfpAdmin;
  if (!A) return;

  // Gedeelde context lezen, nooit herdefinieren: dit zijn dezelfde functies
  // die het scherm in admin.js gebruikte.
  const esc = A.esc;
  const api = A.api;
  const viewEnabled = A.viewEnabled;
  const switchView = A.switchView;
  // tA (i18n), uName (medewerkersnaam) en tLeaveType (verloftype) staan nog
  // NIET op window.wfpAdmin. Ze worden hier bewust niet gekopieerd · een tweede
  // kopie is een tweede waarheid. Bij het knippen moet admin.js ze exporteren.
  const tA = A.tA;
  const uName = A.uName;
  const tLeaveType = A.tLeaveType;

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

  A.views = A.views || {};
  A.views.actions = renderActionCenter;
}());
