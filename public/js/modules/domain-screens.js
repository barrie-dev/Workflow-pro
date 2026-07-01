/**
 * domain-screens.js
 * Frontend logica voor: Klanten, Medewerkers, Tijdregistratie, Onkosten, Facturen
 * Gebruikt WorkFlowProApi.listModuleRows / createModuleRow via de bestaande API-laag.
 */
(function () {
  const api = window.WorkFlowProApi;
  const dom = window.WorkFlowProDom;
  const state = window.WorkFlowProState;

  function tenantId() {
    // main.js hardcodes "t_demo" — follow same pattern for API calls
    return state?.tenantId || state?.tenant?.id || state?.currentTenant?.id || "t_demo";
  }

  function el(id) { return document.getElementById(id); }

  function escHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  }

  function badge(status) {
    const s = String(status || "").toLowerCase();
    if (["betaald","goedgekeurd","approved","paid","actief","active","voltooid"].includes(s))
      return `<span class="badge badge-green">${escHtml(status)}</span>`;
    if (["concept","draft","nieuw","open","pending"].includes(s))
      return `<span class="badge badge-gray">${escHtml(status)}</span>`;
    if (["verstuurd","sent","in behandeling","bezig"].includes(s))
      return `<span class="badge badge-blue">${escHtml(status)}</span>`;
    if (["achterstallig","overdue","te laat","afgewezen","rejected"].includes(s))
      return `<span class="badge badge-red">${escHtml(status)}</span>`;
    if (["wacht","waiting","review"].includes(s))
      return `<span class="badge badge-yellow">${escHtml(status)}</span>`;
    return `<span class="badge badge-gray">${escHtml(status)}</span>`;
  }

  function kpiCard(value, label, sub, colorVar) {
    return `<div class="metric" style="display:flex;align-items:flex-start;gap:0.75rem">
      <div style="min-width:0;flex:1">
        <div style="font-size:1.5rem;font-weight:700;color:${colorVar}">${escHtml(value)}</div>
        <div style="font-size:0.75rem;font-weight:600;color:var(--gray-700)">${escHtml(label)}</div>
        <div style="font-size:0.6875rem;color:var(--gray-400)">${escHtml(sub)}</div>
      </div>
    </div>`;
  }

  function rowItem(cols) {
    return `<div style="display:grid;grid-template-columns:${cols.map(c => c.w || '1fr').join(' ')};align-items:center;gap:0.75rem;padding:0.625rem 1.25rem;border-bottom:1px solid var(--gray-100);font-size:0.8125rem;cursor:pointer">
      ${cols.map(c => `<div style="${c.style||''}">${c.html || escHtml(c.text || '')}</div>`).join('')}
    </div>`;
  }

  function tableHeader(cols) {
    return `<div style="display:grid;grid-template-columns:${cols.map(c => c.w || '1fr').join(' ')};gap:0.75rem;padding:0.5rem 1.25rem;background:var(--gray-50);border-bottom:1px solid var(--gray-200)">
      ${cols.map(c => `<div style="font-size:0.6875rem;font-weight:600;color:var(--gray-500);text-transform:uppercase;letter-spacing:0.05em">${escHtml(c.label)}</div>`).join('')}
    </div>`;
  }

  function noData(msg) {
    return `<div style="padding:2rem;text-align:center;color:var(--gray-400);font-size:0.8125rem">${escHtml(msg || 'Geen data beschikbaar.')}</div>`;
  }

  function shortDate(v) {
    if (!v) return '—';
    try { return new Date(v).toLocaleDateString('nl-BE', {day:'2-digit',month:'2-digit',year:'numeric'}); } catch { return v; }
  }

  function euro(v) {
    const n = parseFloat(v);
    if (isNaN(n)) return '—';
    return '€ ' + n.toFixed(2).replace('.', ',');
  }

  function populateSelect(selectEl, rows, valueKey, labelFn) {
    if (!selectEl) return;
    const cur = selectEl.value;
    selectEl.innerHTML = '<option value="">— Kies —</option>';
    (rows || []).forEach(r => {
      const opt = document.createElement('option');
      opt.value = r[valueKey] || r.id || '';
      opt.textContent = labelFn(r);
      selectEl.appendChild(opt);
    });
    if (cur) selectEl.value = cur;
  }

  // ─────────────────────────────────────────────
  // KLANTEN
  // ─────────────────────────────────────────────
  async function refreshCustomers() {
    const tid = tenantId();
    const kpiEl = el('customerCards');
    const rowsEl = el('customerRows');
    const countEl = el('customerCount');

    if (kpiEl) kpiEl.innerHTML = '<div class="metric"><div style="color:var(--gray-400);font-size:0.8125rem">Laden...</div></div>';
    if (rowsEl) rowsEl.innerHTML = noData('Laden...');

    let rows = [];
    try {
      rows = await api.listModuleRows('customers', tid);
    } catch (e) {
      if (rowsEl) rowsEl.innerHTML = noData(e.message);
      return;
    }

    if (countEl) countEl.textContent = `${rows.length} klant${rows.length !== 1 ? 'en' : ''}`;

    if (kpiEl) {
      const active = rows.filter(r => r.status === 'active' || !r.status).length;
      kpiEl.innerHTML = [
        kpiCard(rows.length, 'Totaal klanten', 'in systeem', 'var(--wf-blue)'),
        kpiCard(active, 'Actief', 'met lopende projecten', 'var(--wf-green)'),
        kpiCard(rows.filter(r => r.sector === 'bouw').length, 'Bouwsector', 'klanten', 'var(--wf-orange)'),
        kpiCard(rows.filter(r => r.createdAt && new Date(r.createdAt) > new Date(Date.now() - 30*864e5)).length, 'Nieuw', 'laatste 30 dagen', 'var(--wf-purple)')
      ].join('');
    }

    if (!rowsEl) return;
    if (!rows.length) { rowsEl.innerHTML = noData('Nog geen klanten aangemaakt.'); return; }

    const cols = [
      {label:'Klant', w:'2fr'}, {label:'E-mail', w:'2fr'}, {label:'Telefoon', w:'1fr'},
      {label:'Sector', w:'1fr'}, {label:'Status', w:'0.8fr'}
    ];
    rowsEl.innerHTML = tableHeader(cols) + rows.map(r => rowItem([
      {w:'2fr', html:`<strong>${escHtml(r.name || '—')}</strong>`},
      {w:'2fr', text: r.email || '—'},
      {w:'1fr', text: r.phone || '—'},
      {w:'1fr', html: badge(r.sector || 'Overig')},
      {w:'0.8fr', html: badge(r.status || 'Actief')}
    ])).join('');
  }

  function bindCustomerForm() {
    const form = el('customerForm');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const result = el('customerFormResult');
      const data = Object.fromEntries(new FormData(form));
      try {
        await api.createModuleRow('customers', data, tenantId());
        form.reset();
        if (result) { result.style.display='block'; result.textContent = '✓ Klant aangemaakt.'; }
        await refreshCustomers();
      } catch (err) {
        if (result) { result.style.display='block'; result.textContent = '✗ ' + err.message; }
      }
    });
  }

  // ─────────────────────────────────────────────
  // MEDEWERKERS
  // ─────────────────────────────────────────────
  async function refreshEmployees() {
    const tid = tenantId();
    const kpiEl = el('employeeKpiCards');
    const rowsEl = el('employeeListRows');
    const countEl = el('employeeCount');

    let rows = [];
    try { rows = await api.listModuleRows('users', tid); } catch (e) {
      if (rowsEl) rowsEl.innerHTML = noData(e.message); return;
    }

    if (countEl) countEl.textContent = `${rows.length} medewerker${rows.length !== 1 ? 's' : ''}`;

    if (kpiEl) {
      const admins = rows.filter(r => r.role === 'tenant_admin').length;
      const planners = rows.filter(r => r.role === 'planner').length;
      const employees = rows.filter(r => !r.role || r.role === 'employee').length;
      kpiEl.innerHTML = [
        kpiCard(rows.length, 'Totaal', 'teamleden', 'var(--wf-blue)'),
        kpiCard(admins, 'Beheerders', 'met volledige toegang', 'var(--wf-purple)'),
        kpiCard(planners, 'Planners', 'werkvoorbereiders', 'var(--wf-orange)'),
        kpiCard(employees, 'Veldwerkers', 'operationeel team', 'var(--wf-green)')
      ].join('');
    }

    if (!rowsEl) return;
    if (!rows.length) { rowsEl.innerHTML = noData('Nog geen medewerkers aangemaakt.'); return; }

    const cols = [
      {label:'Naam', w:'2fr'}, {label:'E-mail', w:'2fr'}, {label:'Telefoon', w:'1fr'},
      {label:'Functie', w:'1fr'}, {label:'Rol', w:'1fr'}
    ];
    rowsEl.innerHTML = tableHeader(cols) + rows.map(r => rowItem([
      {w:'2fr', html:`<strong>${escHtml(r.name || r.email || '—')}</strong>`},
      {w:'2fr', text: r.email || '—'},
      {w:'1fr', text: r.phone || '—'},
      {w:'1fr', text: r.jobTitle || '—'},
      {w:'1fr', html: badge(r.role === 'tenant_admin' ? 'Beheerder' : r.role === 'planner' ? 'Planner' : 'Veldwerker')}
    ])).join('');

    // populate user selects everywhere
    [el('permissionUser'), el('clockUser'), el('clockInUser'), el('clockManualUser'),
     el('expenseUser'), el('invoiceCustomer')].forEach(sel => {
      if (!sel) return;
      if (sel.id === 'invoiceCustomer') return; // handled by customers
      populateSelect(sel, rows, 'id', r => r.name || r.email || r.id);
    });
  }

  function bindEmployeeForm() {
    const form = el('employeeAddForm');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const result = el('employeeAddResult');
      const data = Object.fromEntries(new FormData(form));
      try {
        await api.createModuleRow('users', data, tenantId());
        form.reset();
        if (result) { result.style.display='block'; result.textContent = '✓ Medewerker aangemaakt.'; }
        await refreshEmployees();
      } catch (err) {
        if (result) { result.style.display='block'; result.textContent = '✗ ' + err.message; }
      }
    });
  }

  // ─────────────────────────────────────────────
  // TIJDREGISTRATIE
  // ─────────────────────────────────────────────
  async function refreshClockings() {
    const tid = tenantId();
    const kpiEl = el('clockingKpiCards');
    const rowsEl = el('clockingRows');
    const countEl = el('clockingCount');

    let rows = [];
    try { rows = await api.listModuleRows('clockings', tid); } catch (e) {
      if (rowsEl) rowsEl.innerHTML = noData(e.message); return;
    }

    if (countEl) countEl.textContent = `${rows.length} registratie${rows.length !== 1 ? 's' : ''}`;

    if (kpiEl) {
      const today = rows.filter(r => r.date === new Date().toISOString().slice(0,10)).length;
      const open = rows.filter(r => r.startTime && !r.endTime).length;
      const totalMin = rows.reduce((s, r) => {
        if (!r.startTime || !r.endTime) return s;
        try {
          const [sh,sm] = r.startTime.split(':').map(Number);
          const [eh,em] = r.endTime.split(':').map(Number);
          return s + (eh*60+em) - (sh*60+sm);
        } catch { return s; }
      }, 0);
      const totalH = (totalMin/60).toFixed(1);
      kpiEl.innerHTML = [
        kpiCard(rows.length, 'Totaal registraties', 'in database', 'var(--wf-blue)'),
        kpiCard(today, 'Vandaag', 'geklokste registraties', 'var(--wf-green)'),
        kpiCard(open, 'Open clockings', 'nog niet uitgeklokd', 'var(--wf-orange)'),
        kpiCard(totalH + 'u', 'Totale uren', 'alle registraties', 'var(--wf-purple)')
      ].join('');
    }

    if (!rowsEl) return;
    if (!rows.length) { rowsEl.innerHTML = noData('Nog geen tijdregistraties gevonden.'); return; }

    const cols = [
      {label:'Medewerker', w:'2fr'}, {label:'Datum', w:'1fr'}, {label:'Werf / Project', w:'2fr'},
      {label:'Start', w:'0.8fr'}, {label:'Einde', w:'0.8fr'}, {label:'Uren', w:'0.8fr'}, {label:'Status', w:'1fr'}
    ];
    rowsEl.innerHTML = tableHeader(cols) + [...rows].reverse().map(r => {
      let uren = '—';
      if (r.startTime && r.endTime) {
        try {
          const [sh,sm] = r.startTime.split(':').map(Number);
          const [eh,em] = r.endTime.split(':').map(Number);
          const m = (eh*60+em) - (sh*60+sm);
          uren = `${Math.floor(m/60)}u${String(m%60).padStart(2,'0')}`;
        } catch {}
      }
      return rowItem([
        {w:'2fr', html:`<strong>${escHtml(r.userId || r.user || '—')}</strong>`},
        {w:'1fr', text: shortDate(r.date || r.startTime)},
        {w:'2fr', text: r.project || r.venueId || '—'},
        {w:'0.8fr', text: r.startTime ? r.startTime.slice(0,5) : '—'},
        {w:'0.8fr', html: r.endTime ? escHtml(r.endTime.slice(0,5)) : '<span style="color:var(--wf-orange)">Open</span>'},
        {w:'0.8fr', html: `<span style="font-weight:600">${escHtml(uren)}</span>`},
        {w:'1fr', html: badge(r.endTime ? 'Voltooid' : 'Open')}
      ]);
    }).join('');

    // populate user/venue selects for clocking forms
    const userRows = [];
    try { const ur = await api.listModuleRows('users', tid); userRows.push(...ur); } catch {}
    const venueRows = [];
    try { const vr = await api.listModuleRows('venues', tid); venueRows.push(...vr); } catch {}

    [el('clockInUser'), el('clockManualUser'), el('clockUser')].forEach(s => s && populateSelect(s, userRows, 'id', r => r.name || r.email));
    [el('clockInVenue'), el('clockManualVenue'), el('clockVenue')].forEach(s => s && populateSelect(s, venueRows, 'id', r => r.name || r.code || r.id));
  }

  function bindClockingForms() {
    // Clock in / out
    el('clockInBtn')?.addEventListener('click', async () => {
      const user = el('clockInUser')?.value;
      const venue = el('clockInVenue')?.value;
      if (!user) { alert('Kies eerst een medewerker.'); return; }
      try {
        await api.createModuleRow('clockings', {
          userId: user, venueId: venue || null,
          project: el('clockInForm')?.querySelector('[name=project]')?.value || '',
          startTime: new Date().toTimeString().slice(0,5),
          date: new Date().toISOString().slice(0,10)
        }, tenantId());
        const n = el('clockNotice'); if (n) { n.style.display='block'; n.textContent='✓ Ingeklokd om ' + new Date().toTimeString().slice(0,5); }
        await refreshClockings();
      } catch (e) { alert('Fout: ' + e.message); }
    });

    el('clockOutBtn')?.addEventListener('click', async () => {
      const user = el('clockInUser')?.value;
      if (!user) { alert('Kies eerst een medewerker.'); return; }
      try {
        // Find open clocking for this user and patch endTime
        const rows = await api.listModuleRows('clockings', tenantId());
        const open = rows.find(r => (r.userId === user || r.user === user) && !r.endTime);
        if (!open) { alert('Geen open clocking gevonden voor deze medewerker.'); return; }
        await api.updateModuleRow('clockings', open.id, { endTime: new Date().toTimeString().slice(0,5) }, tenantId());
        const n = el('clockNotice'); if (n) { n.style.display='block'; n.textContent='✓ Uitgeklokd om ' + new Date().toTimeString().slice(0,5); }
        await refreshClockings();
      } catch (e) { alert('Fout: ' + e.message); }
    });

    // Manual registration
    const manualForm = el('clockManualForm');
    if (manualForm && !manualForm.dataset.bound) {
      manualForm.dataset.bound = '1';
      manualForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const result = el('clockManualResult');
        const data = Object.fromEntries(new FormData(manualForm));
        try {
          await api.createModuleRow('clockings', data, tenantId());
          manualForm.reset();
          if (result) { result.style.display='block'; result.textContent='✓ Registratie opgeslagen.'; }
          await refreshClockings();
        } catch (err) {
          if (result) { result.style.display='block'; result.textContent='✗ ' + err.message; }
        }
      });
    }
  }

  // ─────────────────────────────────────────────
  // ONKOSTEN
  // ─────────────────────────────────────────────
  async function refreshExpenses() {
    const tid = tenantId();
    const kpiEl = el('expenseKpiCards');
    const rowsEl = el('expenseRows');
    const countEl = el('expenseCount');
    const pendingEl = el('expensePendingApprovals');

    let rows = [];
    try { rows = await api.listModuleRows('expenses', tid); } catch (e) {
      if (rowsEl) rowsEl.innerHTML = noData(e.message); return;
    }

    if (countEl) countEl.textContent = `${rows.length} onkost${rows.length !== 1 ? 'en' : ''}`;

    const totalAmount = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    const pending = rows.filter(r => !r.status || r.status === 'pending');
    const approved = rows.filter(r => r.status === 'approved' || r.status === 'goedgekeurd');

    if (kpiEl) {
      kpiEl.innerHTML = [
        kpiCard(euro(totalAmount), 'Totaal bedrag', 'alle ingediende onkosten', 'var(--wf-blue)'),
        kpiCard(pending.length, 'Wacht op goedkeuring', 'te behandelen', 'var(--wf-orange)'),
        kpiCard(approved.length, 'Goedgekeurd', 'verwerkt', 'var(--wf-green)'),
        kpiCard(euro(approved.reduce((s,r) => s+(parseFloat(r.amount)||0), 0)), 'Goedgekeurd bedrag', 'terug te betalen', 'var(--wf-purple)')
      ].join('');
    }

    if (!rowsEl) return;
    if (!rows.length) { rowsEl.innerHTML = noData('Nog geen onkosten ingediend.'); return; }

    const cols = [
      {label:'Medewerker', w:'1.5fr'}, {label:'Omschrijving', w:'2fr'}, {label:'Categorie', w:'1fr'},
      {label:'Datum', w:'1fr'}, {label:'Bedrag', w:'0.8fr'}, {label:'Status', w:'1fr'}
    ];
    rowsEl.innerHTML = tableHeader(cols) + [...rows].reverse().map(r => rowItem([
      {w:'1.5fr', html:`<strong>${escHtml(r.userId || r.user || '—')}</strong>`},
      {w:'2fr', text: r.title || r.description || '—'},
      {w:'1fr', html: `<span class="badge badge-gray">${escHtml(r.category || '—')}</span>`},
      {w:'1fr', text: shortDate(r.date)},
      {w:'0.8fr', html: `<span style="font-weight:600;color:var(--wf-green)">${escHtml(euro(r.amount))}</span>`},
      {w:'1fr', html: badge(r.status || 'Wacht')}
    ])).join('');

    if (pendingEl) {
      pendingEl.innerHTML = pending.length
        ? pending.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;border-bottom:1px solid var(--gray-100);font-size:0.8125rem">
            <div><strong>${escHtml(r.title||'—')}</strong><br><small style="color:var(--gray-400)">${escHtml(r.userId||'—')} · ${escHtml(euro(r.amount))}</small></div>
            <div style="display:flex;gap:0.5rem">
              <button onclick="WorkFlowProDomainScreens.approveExpense('${r.id}')" style="background:var(--wf-green);color:white;border-color:var(--wf-green);font-size:0.7rem;padding:0.25rem 0.625rem">✓</button>
              <button onclick="WorkFlowProDomainScreens.rejectExpense('${r.id}')" style="background:var(--wf-red);color:white;border-color:var(--wf-red);font-size:0.7rem;padding:0.25rem 0.625rem">✗</button>
            </div>
          </div>`).join('')
        : noData('Geen onkosten wachtend op goedkeuring.');
    }

    // load users/venues for form selects
    try { const ur = await api.listModuleRows('users', tid); populateSelect(el('expenseUser'), ur, 'id', r => r.name || r.email); } catch {}
    try { const vr = await api.listModuleRows('venues', tid); populateSelect(el('expenseVenue'), vr, 'id', r => r.name || r.code || r.id); } catch {}
  }

  async function approveExpense(id) {
    try { await api.updateModuleRow('expenses', id, {status:'approved'}, tenantId()); await refreshExpenses(); } catch (e) { alert(e.message); }
  }
  async function rejectExpense(id) {
    try { await api.updateModuleRow('expenses', id, {status:'rejected'}, tenantId()); await refreshExpenses(); } catch (e) { alert(e.message); }
  }

  function bindExpenseForms() {
    const form = el('expenseSubmitForm');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const result = el('expenseFormResult');
      const data = Object.fromEntries(new FormData(form));
      try {
        await api.createModuleRow('expenses', {...data, status:'pending'}, tenantId());
        form.reset();
        if (result) { result.style.display='block'; result.textContent='✓ Onkost ingediend.'; }
        await refreshExpenses();
      } catch (err) {
        if (result) { result.style.display='block'; result.textContent='✗ ' + err.message; }
      }
    });
  }

  // ─────────────────────────────────────────────
  // FACTUREN
  // ─────────────────────────────────────────────
  async function refreshInvoices() {
    const tid = tenantId();
    const kpiEl = el('invoiceKpiCards');
    const rowsEl = el('invoiceRows');
    const countEl = el('invoiceCount');

    let rows = [];
    try { rows = await api.listModuleRows('invoices', tid); } catch (e) {
      if (rowsEl) rowsEl.innerHTML = noData(e.message); return;
    }

    if (countEl) countEl.textContent = `${rows.length} factuur${rows.length !== 1 ? 'en' : ''}`;

    const totalAmount = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
    const paid = rows.filter(r => r.status === 'paid' || r.status === 'betaald');
    const overdue = rows.filter(r => r.status === 'overdue' || r.status === 'achterstallig');
    const draft = rows.filter(r => r.status === 'draft' || r.status === 'concept' || !r.status);

    if (kpiEl) {
      kpiEl.innerHTML = [
        kpiCard(euro(totalAmount), 'Totaal gefactureerd', 'alle facturen', 'var(--wf-blue)'),
        kpiCard(euro(paid.reduce((s,r) => s+(parseFloat(r.amount)||0), 0)), 'Betaald', 'ontvangen betalingen', 'var(--wf-green)'),
        kpiCard(overdue.length, 'Achterstallig', 'openstaand te lang', 'var(--wf-red)'),
        kpiCard(draft.length, 'Concepten', 'nog te versturen', 'var(--wf-orange)')
      ].join('');
    }

    if (!rowsEl) return;
    if (!rows.length) { rowsEl.innerHTML = noData('Nog geen facturen aangemaakt.'); return; }

    const cols = [
      {label:'Klant', w:'2fr'}, {label:'Omschrijving', w:'2fr'}, {label:'Datum', w:'1fr'},
      {label:'Vervaldatum', w:'1fr'}, {label:'Bedrag excl.', w:'1fr'}, {label:'Status', w:'1fr'}
    ];
    rowsEl.innerHTML = tableHeader(cols) + [...rows].reverse().map(r => rowItem([
      {w:'2fr', html:`<strong>${escHtml(r.customerId || r.customer || '—')}</strong>`},
      {w:'2fr', text: r.line || r.description || '—'},
      {w:'1fr', text: shortDate(r.createdAt || r.date)},
      {w:'1fr', text: shortDate(r.dueDate)},
      {w:'1fr', html: `<span style="font-weight:600;color:var(--wf-green)">${escHtml(euro(r.amount))}</span>`},
      {w:'1fr', html: badge(r.status || 'Concept')}
    ])).join('');

    // populate customer select
    try {
      const cr = await api.listModuleRows('customers', tid);
      populateSelect(el('invoiceCustomer'), cr, 'id', r => r.name || r.email || r.id);
    } catch {}
  }

  function bindInvoiceForms() {
    const form = el('invoiceCreateForm');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const result = el('invoiceCreateResult');
      const data = Object.fromEntries(new FormData(form));
      try {
        await api.createModuleRow('invoices', {...data, status:'draft'}, tenantId());
        form.reset();
        if (result) { result.style.display='block'; result.textContent='✓ Factuurconcept aangemaakt.'; }
        await refreshInvoices();
      } catch (err) {
        if (result) { result.style.display='block'; result.textContent='✗ ' + err.message; }
      }
    });

    // Peppol form
    const peppolForm = el('peppolSendForm');
    if (peppolForm && !peppolForm.dataset.bound) {
      peppolForm.dataset.bound = '1';
      peppolForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const result = el('peppolSendResult');
        const invoiceId = peppolForm.querySelector('[name=invoiceId]')?.value;
        try {
          await api.request(`/api/tenants/${tenantId()}/billing/peppol/${invoiceId}`, {method:'POST'});
          if (result) { result.style.display='block'; result.textContent='✓ Factuur via Peppol verstuurd.'; }
          await refreshInvoices();
        } catch (err) {
          if (result) { result.style.display='block'; result.textContent='✗ ' + err.message; }
        }
      });
    }
  }

  // ─────────────────────────────────────────────
  // INITIALISATIE — bind alles bij elke schermwissel
  // ─────────────────────────────────────────────
  window.refreshCustomers  = refreshCustomers;
  window.refreshEmployees  = refreshEmployees;
  window.refreshClockings  = refreshClockings;
  window.refreshExpenses   = refreshExpenses;
  window.refreshInvoices   = refreshInvoices;

  // Bind forms eenmalig als scherm actief wordt
  document.addEventListener('wfp-view-changed', (e) => {
    switch (e.detail?.view) {
      case 'customers':  bindCustomerForm();  break;
      case 'employees':  bindEmployeeForm();  break;
      case 'clockings':  bindClockingForms(); break;
      case 'expenses':   bindExpenseForms();  break;
      case 'invoices':   bindInvoiceForms();  break;
    }
  });

  window.WorkFlowProDomainScreens = {
    refreshCustomers, refreshEmployees, refreshClockings, refreshExpenses, refreshInvoices,
    approveExpense, rejectExpense
  };
}());
