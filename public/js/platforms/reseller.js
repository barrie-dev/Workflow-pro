// Reseller-portaal: een platform-partner beheert zijn EIGEN klanten en ziet zijn
// commissie (% van het abonnement). Enkel commerciële data, geen operationele
// klantgegevens (GDPR). Zie [[project-support-access]] en docs/SECTORPROFIELEN.md.
(function () {
  "use strict";
  const token = () => window.wfpCore.token();
  const esc = s => window.wfpCore.esc(s);
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
<div style="min-height:100vh;background:#f1f5f9;font-family:Inter,system-ui,sans-serif">
  <header style="background:linear-gradient(135deg,#0f172a,#1e3a5f);color:#fff;padding:16px 24px;display:flex;align-items:center;justify-content:space-between">
    <div style="display:flex;align-items:center;gap:12px">
      <span style="background:#38bdf8;color:#0f172a;width:36px;height:36px;border-radius:10px;display:grid;place-items:center;font-weight:800">WP</span>
      <div><div style="font-weight:700">WorkFlow Pro · Reseller</div><div id="rspName" style="font-size:12px;color:#94a3b8">Partnerportaal</div></div>
    </div>
    <button id="rspLogout" style="background:rgba(255,255,255,.1);color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer">Uitloggen</button>
  </header>
  <main style="max-width:1040px;margin:0 auto;padding:24px 20px" id="rspMain"><div style="color:#94a3b8;padding:40px;text-align:center">Laden…</div></main>
</div>`;
    document.getElementById("rspLogout").addEventListener("click", () => {
      localStorage.removeItem("wfp_token");
      window.WorkFlowProPlatformRouter && window.WorkFlowProPlatformRouter.showLogin();
    });
    render();
  }

  async function render() {
    const main = document.getElementById("rspMain");
    let d;
    try { d = await api("GET", "/api/reseller/clients"); }
    catch (e) { main.innerHTML = `<div style="background:#fff;border-radius:12px;padding:20px;color:#dc2626">${esc(e.message)}</div>`; return; }
    const nm = document.getElementById("rspName"); if (nm && d.reseller) nm.textContent = `${d.reseller.name} · standaard ${d.reseller.defaultCommissionPct || 0}% commissie`;
    const card = (label, value, sub) => `<div style="background:#fff;border-radius:14px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.06)"><div style="font-size:12px;color:#64748b">${label}</div><div style="font-size:24px;font-weight:800;color:#0f172a">${value}</div><div style="font-size:11px;color:#94a3b8">${sub || ""}</div></div>`;
    main.innerHTML = `
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px">
  ${card("Mijn klanten", d.clientCount || 0, "actieve + trial")}
  ${card("Abonnement (MRR)", eur(d.totalMrr), "som van actieve klanten")}
  ${card("Commissie / maand", eur(d.totalCommission), "jouw verdienste")}
</div>

<div style="background:#fff;border-radius:14px;padding:18px 20px;margin-bottom:18px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
  <div style="font-weight:700;margin-bottom:12px">Nieuwe klant aanmaken</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:680px">
    <input id="ncName" placeholder="Bedrijfsnaam klant" style="padding:9px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">
    <select id="ncPlan" style="padding:9px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px"><option value="starter">Starter</option><option value="business" selected>Business</option><option value="enterprise">Enterprise</option></select>
    <input id="ncEmail" type="email" placeholder="Login-e-mail beheerder klant" style="padding:9px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">
    <input id="ncAdminName" placeholder="Naam beheerder" style="padding:9px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">
    <div style="grid-column:1/3;font-size:12px;color:#64748b">De beheerder van de klant ontvangt een activatiemail om zelf een wachtwoord in te stellen.</div>
    <div style="grid-column:1/3;display:flex;gap:8px;align-items:center">
      <button id="ncCreate" style="background:#0ea5e9;color:#fff;border:none;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:600;cursor:pointer">Klant aanmaken</button>
      <span id="ncMsg" style="font-size:12.5px;color:#dc2626"></span>
    </div>
  </div>
</div>

<div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)">
  <div style="padding:14px 20px;font-weight:700;border-bottom:1px solid #f1f5f9">Mijn klanten &amp; commissie</div>
  <div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="text-align:left;color:#64748b;font-size:12px"><th style="padding:10px 20px">Klant</th><th style="padding:10px">Plan</th><th style="padding:10px">Status</th><th style="padding:10px">MRR</th><th style="padding:10px">Commissie %</th><th style="padding:10px 20px">Commissie/mnd</th></tr></thead>
    <tbody>${(d.rows || []).map(r => `<tr style="border-top:1px solid #f8fafc">
      <td style="padding:10px 20px;font-weight:600;color:#0f172a">${esc(r.name)}</td>
      <td style="padding:10px;text-transform:capitalize">${esc(r.plan)}</td>
      <td style="padding:10px">${r.status === "active" ? "🟢 actief" : "🟡 " + esc(r.status)}</td>
      <td style="padding:10px">${eur(r.mrr)}</td>
      <td style="padding:10px">${r.commissionPct}%</td>
      <td style="padding:10px 20px;font-weight:700;color:#15803d">${eur(r.commission)}</td>
    </tr>`).join("") || `<tr><td colspan="6" style="padding:30px;text-align:center;color:#94a3b8">Nog geen klanten — maak je eerste klant aan hierboven.</td></tr>`}</tbody>
  </table></div>
</div>`;

    document.getElementById("ncCreate").addEventListener("click", async () => {
      const name = document.getElementById("ncName").value.trim();
      const plan = document.getElementById("ncPlan").value;
      const adminEmail = document.getElementById("ncEmail").value.trim();
      const adminName = document.getElementById("ncAdminName").value.trim();
      const msg = document.getElementById("ncMsg"); msg.textContent = "";
      if (!name || !adminEmail) { msg.textContent = "Klantnaam en login-e-mail zijn verplicht."; return; }
      try {
        const r = await api("POST", "/api/reseller/clients", { name, plan, adminEmail, adminName });
        if (r && r.activationLink && window.showToast) window.showToast("Klant aangemaakt. Activatielink (dev): " + r.activationLink, "success");
        render();
      } catch (e) { msg.textContent = e.message; }
    });
  }

  window.wfp_resellerInit = buildShell;
}());
