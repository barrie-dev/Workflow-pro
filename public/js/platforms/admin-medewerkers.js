/* ── Medewerkers · uitgesplitst schermmodule (strangler-extractie) ───────────
 * Letterlijk uit public/js/platforms/admin.js geknipt (regels 1921-2226 van de
 * monoliet): de medewerkerslijst met zoek/CSV-import/CSV-export, de tabel, de
 * rij-acties en de medewerker-drawer met rol en rechtenmatrix.
 *
 * De code is NIET herschreven, niet opgeruimd en niet "verbeterd" · alleen de
 * omhulling is nieuw. Deze werkruimte LEEST de gedeelde context
 * window.wfpAdmin en registreert zichzelf in A.views.employees en
 * A.drawers.employee. Een extractie die onderweg gedrag wijzigt is niet te
 * reviewen.
 */
(function () {
  "use strict";

  const A = window.wfpAdmin;
  if (!A) return;

  // Alles wat NIET meeverhuisde komt uit de gedeelde context · nooit kopieren,
  // anders ontstaan er twee waarheden.
  const api = A.api;
  const esc = A.esc;
  const openDrawer = A.openDrawer;
  const closeDrawer = A.closeDrawer;
  // _state is in admin.js een stabiele (nooit herbonden) referentie · de schrijf
  // naar _state.employees hieronder vult dus dezelfde cache als de shell.
  const _state = A.state;

  // NOG NIET geexposeerd op window.wfpAdmin (tA, uiConfirm en uiInput staan wel
  // in admin.js maar worden daar niet op A gezet). Laat gebonden opgehaald, zodat
  // dit bestand meteen werkt zodra admin.js ze toevoegt · kopieren zou hun logica
  // verdubbelen. Zie het risico-punt in het extractierapport.
  const tA = (key, fallback) => A.tA(key, fallback);
  const uiConfirm = (message, options) => A.uiConfirm(message, options);
  const uiInput = (label, options) => A.uiInput(label, options);

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

  A.views = A.views || {};
  A.views.employees = renderEmployees;
  A.drawers = A.drawers || {};
  // Verhuisde mee uit de drawer-registry van admin.js (was regel 9139) · het
  // dashboard opent de medewerker-drawer via A.drawers.employee.
  A.drawers.employee = openEmployeeDrawer;
}());
