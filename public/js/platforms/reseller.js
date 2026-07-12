// Reseller-portaal: een platform-partner beheert zijn EIGEN klanten en ziet zijn
// commissie (% van het abonnement). Enkel commerciële data, geen operationele
// klantgegevens (GDPR). Zie [[project-support-access]] en docs/SECTORPROFIELEN.md.
(function () {
  "use strict";
  const token = () => window.wfpCore.token();
  const esc = s => window.wfpCore.esc(s);
  const tR = (key, fallback) => window.wfpI18n ? window.wfpI18n.t(key, fallback) : fallback;
  function eur(n) { try { return new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" }).format(Number(n) || 0); } catch (_) { return "€" + (Number(n) || 0).toFixed(2); } }
  async function api(method, path, body) {
    const r = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
      body: body ? JSON.stringify(body) : undefined
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { localStorage.removeItem("wfp_token"); window.WorkFlowProPlatformRouter && window.WorkFlowProPlatformRouter.showLogin(); throw new Error(d.error || "Sessie verlopen"); }
    if (!r.ok) throw new Error(d.error || ("Fout " + r.status));
    return d;
  }

  function buildShell() {
    const el = document.getElementById("platform-reseller");
    if (!el) return;
    el.innerHTML = `
<div style="min-height:100vh;background:var(--bg);font-family:var(--font-sans)">
  <header style="background:rgba(255,255,255,.85);backdrop-filter:saturate(180%) blur(20px);color:var(--ink);border-bottom:1px solid var(--line);padding:16px 24px;display:flex;align-items:center;justify-content:space-between">
    <div style="display:flex;align-items:center;gap:12px">
      <span style="background:var(--wf-blue);color:#fff;width:36px;height:36px;border-radius:11px;display:grid;place-items:center;font-weight:600;box-shadow:0 4px 12px rgba(0,113,227,.30)">M</span>
      <div><div style="font-weight:600;letter-spacing:-.2px">Monargo One · Reseller</div><div id="rspName" style="font-size:12px;color:var(--muted)">${tR("rsp.partnerPortal","Partnerportaal")}</div></div>
    </div>
    <div style="display:flex;align-items:center;gap:8px">
      <button id="rspLangToggle" title="NL / FR / EN" style="background:var(--surface);color:var(--ink);border:1px solid var(--line-strong);border-radius:10px;padding:9px 12px;font-size:12px;font-weight:600;cursor:pointer">NL</button>
      <button id="rspLogout" style="background:var(--surface);color:var(--ink);border:1px solid var(--line-strong);border-radius:10px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer">${tR("rsp.logout","Uitloggen")}</button>
    </div>
  </header>
  <main style="max-width:1040px;margin:0 auto;padding:24px 20px" id="rspMain"><div style="color:var(--gray-400);padding:40px;text-align:center">${tR("adm.loading","Laden…")}</div></main>
</div>`;
    document.getElementById("rspLogout").addEventListener("click", () => {
      localStorage.removeItem("wfp_token");
      window.WorkFlowProPlatformRouter && window.WorkFlowProPlatformRouter.showLogin();
    });
    // NL/FR/EN taalwissel: knop toont de taal waarnaar je overschakelt.
    if (window.wfpI18n) {
      const paintLang = () => {
        const b = document.getElementById("rspLangToggle");
        if (b) b.textContent = window.wfpI18n.nextLang(window.wfpI18n.lang).toUpperCase();
      };
      paintLang();
      document.getElementById("rspLangToggle")?.addEventListener("click", () => window.wfpI18n.cycleLang());
      document.removeEventListener("wfp:langchange", _rspLangHandler);
      _rspLangHandler = () => buildShell();
      document.addEventListener("wfp:langchange", _rspLangHandler);
    }
    render();
  }
  let _rspLangHandler = null;

  async function render() {
    const main = document.getElementById("rspMain");
    let d;
    try { d = await api("GET", "/api/reseller/clients"); }
    catch (e) { main.innerHTML = `<div style="background:#fff;border-radius:12px;padding:20px;color:var(--wf-red)">${esc(e.message)}</div>`; return; }
    const nm = document.getElementById("rspName"); if (nm && d.reseller) nm.textContent = tR("rsp.defaultCommission","{name} · standaard {pct}% commissie").replace("{name}", d.reseller.name).replace("{pct}", d.reseller.defaultCommissionPct || 0);
    const card = (label, value, sub) => `<div style="background:var(--surface);border-radius:14px;padding:16px;border:1px solid var(--line)"><div style="font-size:12px;color:var(--muted)">${label}</div><div style="font-size:24px;font-weight:600;color:var(--ink);letter-spacing:-.5px">${value}</div><div style="font-size:11px;color:var(--gray-400)">${sub || ""}</div></div>`;
    main.innerHTML = `
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px">
  ${card(tR("rsp.myClients","Mijn klanten"), d.clientCount || 0, tR("rsp.activeTrial","actieve + trial"))}
  ${card(tR("rsp.subMrr","Abonnement (MRR)"), eur(d.totalMrr), tR("rsp.sumActive","som van actieve klanten"))}
  ${card(tR("rsp.commissionMonth","Commissie / maand"), eur(d.totalCommission), tR("rsp.yourEarnings","jouw verdienste"))}
</div>

<div style="background:#fff;border-radius:14px;padding:18px 20px;margin-bottom:18px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
  <div style="font-weight:600;margin-bottom:12px">${tR("rsp.createClient","Nieuwe klant aanmaken")}</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:680px">
    <input id="ncName" placeholder="${tR("rsp.clientCompanyPh","Bedrijfsnaam klant")}">
    <select id="ncPlan"><option value="starter">Starter</option><option value="business" selected>Business</option><option value="enterprise">Enterprise</option></select>
    <input id="ncEmail" type="email" placeholder="${tR("rsp.adminEmailPh","Login-e-mail beheerder klant")}">
    <input id="ncAdminName" placeholder="${tR("rsp.adminNamePh","Naam beheerder")}">
    <div style="grid-column:1/3;font-size:12px;color:var(--gray-500)">${tR("rsp.activationNote","De beheerder van de klant ontvangt een activatiemail om zelf een wachtwoord in te stellen.")}</div>
    <div style="grid-column:1/3;display:flex;gap:8px;align-items:center">
      <button id="ncCreate" style="background:var(--wf-blue);color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer">${tR("rsp.createClientBtn","Klant aanmaken")}</button>
      <span id="ncMsg" style="font-size:12.5px;color:var(--wf-red)"></span>
    </div>
  </div>
</div>

<div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)">
  <div style="padding:14px 20px;font-weight:600;border-bottom:1px solid var(--gray-100)">${tR("rsp.clientsCommission","Mijn klanten &amp; commissie")}</div>
  <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="text-align:left;color:var(--gray-500);font-size:12px"><th style="padding:10px 20px">${tR("adm.thCustomer","Klant")}</th><th style="padding:10px">${tR("rsp.plan","Plan")}</th><th style="padding:10px">${tR("adm.status","Status")}</th><th style="padding:10px">MRR</th><th style="padding:10px">${tR("rsp.commissionPct","Commissie %")}</th><th style="padding:10px 20px">${tR("rsp.commissionMo","Commissie/mnd")}</th></tr></thead>
    <tbody>${(d.rows || []).map(r => `<tr style="border-top:1px solid var(--gray-50)">
      <td style="padding:10px 20px;font-weight:600;color:var(--gray-900)">${esc(r.name)}</td>
      <td style="padding:10px;text-transform:capitalize">${esc(r.plan)}</td>
      <td style="padding:10px">${r.status === "active" ? `<span class="adm-dot" style="background:var(--wf-green)"></span> ${tR("adm.active","actief").toLowerCase()}` : '<span class="adm-dot" style="background:var(--wf-yellow)"></span> ' + esc(r.status)}</td>
      <td style="padding:10px">${eur(r.mrr)}</td>
      <td style="padding:10px">${r.commissionPct}%</td>
      <td style="padding:10px 20px;font-weight:600;color:var(--wf-green)">${eur(r.commission)}</td>
    </tr>`).join("") || `<tr><td colspan="6" style="padding:30px;text-align:center;color:var(--gray-400)">${tR("rsp.noClients","Nog geen klanten · maak je eerste klant aan hierboven.")}</td></tr>`}</tbody>
  </table></div>
</div>`;

    document.getElementById("ncCreate").addEventListener("click", async () => {
      const name = document.getElementById("ncName").value.trim();
      const plan = document.getElementById("ncPlan").value;
      const adminEmail = document.getElementById("ncEmail").value.trim();
      const adminName = document.getElementById("ncAdminName").value.trim();
      const msg = document.getElementById("ncMsg"); msg.textContent = "";
      if (!name || !adminEmail) { msg.textContent = tR("rsp.reqFields","Klantnaam en login-e-mail zijn verplicht."); return; }
      try {
        const r = await api("POST", "/api/reseller/clients", { name, plan, adminEmail, adminName });
        if (r && r.activationLink && window.showToast) window.showToast(tR("rsp.clientCreated","Klant aangemaakt. Activatielink (dev): ") + r.activationLink, "success");
        render();
      } catch (e) { msg.textContent = e.message; }
    });
  }

  window.wfp_resellerInit = buildShell;
}());
