// Reseller-portaal: een platform-partner meldt klanten aan en ziet zijn
// commissie (% van het abonnement). Enkel commerciële data, geen operationele
// klantgegevens (GDPR). Zie [[project-support-access]] en docs/SECTORPROFIELEN.md.
//
// Een partner maakt NOOIT zelf een klantomgeving aan: hij dient een
// tenantaanvraag in (23.9). Monargo beoordeelt, bevestigt bij de klant en
// provisioneert daarna pas · koppelen en provisionen zijn platformacties (23.4).
//
// TODO (volgende slice): de overige 23.13-paginas (deals, licentie-aanvragen,
// prijsuitzonderingen, gedelegeerde toegang, commissiestaten, disputen en
// payoutwijzigingen) bestaan al als API maar nog niet als portaalpagina.
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
<style>
#platform-reseller{min-height:100vh;background:var(--bg);font-family:var(--font-sans)}
#platform-reseller *{box-sizing:border-box}
.rsp-shell{min-height:100vh;background:radial-gradient(circle at 92% 0,rgba(0,113,227,.08),transparent 32%),var(--bg)}
.rsp-topbar{position:sticky;top:0;z-index:20;background:rgba(255,255,255,.86);backdrop-filter:saturate(180%) blur(20px);color:var(--ink);border-bottom:1px solid var(--line);padding:14px 24px;display:flex;align-items:center;justify-content:space-between}
.rsp-brand,.rsp-actions{display:flex;align-items:center;gap:12px}
.rsp-mark{background:linear-gradient(135deg,#0b7bf1,#005fc7);color:#fff;width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-weight:700;box-shadow:0 7px 18px rgba(0,113,227,.28)}
.rsp-brand-name{font-weight:650;letter-spacing:-.25px}.rsp-brand-sub{font-size:12px;color:var(--muted)}
.rsp-btn{background:var(--surface);color:var(--ink);border:1px solid var(--line-strong);border-radius:10px;padding:9px 13px;font-size:12.5px;font-weight:600;cursor:pointer;transition:transform .14s,box-shadow .14s,background .14s}
.rsp-btn:hover{background:#fff;box-shadow:0 5px 16px rgba(15,31,50,.08);transform:translateY(-1px)}
.rsp-btn-primary{background:var(--wf-blue);color:#fff;border-color:var(--wf-blue);padding:10px 17px}.rsp-btn-primary:hover{background:var(--blue-hover);color:#fff}
.rsp-main{max-width:1120px;margin:0 auto;padding:28px 22px 44px}
.rsp-hero{display:flex;align-items:center;gap:24px;padding:25px 27px;margin-bottom:18px;border-radius:20px;color:#fff;background:linear-gradient(125deg,#0a1829 0%,#102a4c 64%,#0b75db 145%);box-shadow:0 18px 45px rgba(9,28,51,.16);overflow:hidden;position:relative}
.rsp-hero:after{content:"";position:absolute;width:210px;height:210px;border-radius:50%;right:-60px;top:-105px;background:rgba(61,159,255,.18)}
.rsp-hero-copy{position:relative;z-index:1;flex:1}.rsp-eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,.56);font-weight:700;margin-bottom:6px}.rsp-hero h1{font-size:25px;line-height:1.15;letter-spacing:-.6px;margin:0 0 6px}.rsp-hero p{font-size:13px;line-height:1.55;color:rgba(255,255,255,.67);margin:0;max-width:600px}
.rsp-flow{position:relative;z-index:1;display:grid;grid-template-columns:repeat(3,auto);align-items:center;gap:7px;font-size:11px;font-weight:650;color:rgba(255,255,255,.72)}.rsp-flow span{padding:7px 9px;border-radius:8px;background:rgba(255,255,255,.09);white-space:nowrap}.rsp-flow b{color:#59b5ff}
.rsp-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px}.rsp-kpi{background:rgba(255,255,255,.9);border-radius:16px;padding:18px;border:1px solid var(--line);box-shadow:0 8px 24px rgba(15,31,50,.045);transition:transform .16s,box-shadow .16s}.rsp-kpi:hover{transform:translateY(-2px);box-shadow:0 12px 30px rgba(15,31,50,.08)}.rsp-kpi-label{font-size:12px;color:var(--muted)}.rsp-kpi-value{font-size:25px;font-weight:650;color:var(--ink);letter-spacing:-.6px;margin:3px 0}.rsp-kpi-sub{font-size:11px;color:var(--gray-400)}
.rsp-card{background:rgba(255,255,255,.94);border-radius:16px;margin-bottom:18px;border:1px solid var(--line);box-shadow:0 8px 26px rgba(15,31,50,.045);overflow:hidden}.rsp-card-body{padding:20px}.rsp-card-head{padding:15px 20px;font-weight:650;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:9px}.rsp-step{width:24px;height:24px;border-radius:8px;background:var(--wf-blue-l);color:var(--wf-blue);display:grid;place-items:center;font-size:11px;font-weight:750}
.rsp-form{display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:760px}.rsp-form input,.rsp-form select{width:100%;padding:11px 12px;border:1px solid var(--line-strong);border-radius:10px;background:#fff;color:var(--ink);font:inherit;font-size:13px}.rsp-form input:focus,.rsp-form select:focus{outline:none;border-color:var(--wf-blue);box-shadow:var(--ring)}.rsp-span2{grid-column:1/3}.rsp-hint{font-size:12px;line-height:1.45;color:var(--gray-500)}.rsp-submit{display:flex;align-items:center;gap:10px}.rsp-msg{font-size:12.5px;color:var(--wf-red)}
.rsp-table-wrap{overflow-x:auto}.rsp-table{width:100%;border-collapse:collapse;font-size:13px}.rsp-table th{text-align:left;color:var(--gray-500);font-size:11px;text-transform:uppercase;letter-spacing:.45px;padding:11px 15px;background:var(--surface-subtle);white-space:nowrap}.rsp-table td{padding:12px 15px;border-top:1px solid var(--gray-50);white-space:nowrap}.rsp-table tbody tr:hover{background:var(--gray-50)}.rsp-client{font-weight:650;color:var(--gray-900)}.rsp-empty{padding:34px!important;text-align:center;color:var(--gray-400)}
@media(max-width:760px){.rsp-topbar{padding:12px 14px}.rsp-brand-name{font-size:13px}.rsp-actions{gap:6px}.rsp-btn{padding:8px 10px}.rsp-main{padding:18px 14px 34px}.rsp-hero{align-items:flex-start;flex-direction:column;padding:22px}.rsp-flow{width:100%;grid-template-columns:1fr auto 1fr auto 1fr}.rsp-flow span{text-align:center;padding:7px 5px}.rsp-kpis{grid-template-columns:1fr}.rsp-form{grid-template-columns:1fr}.rsp-span2{grid-column:1}.rsp-submit{align-items:flex-start;flex-direction:column}}
@media(max-width:430px){.rsp-brand-sub{display:none}.rsp-logout-label{display:none}.rsp-hero h1{font-size:22px}.rsp-flow{font-size:10px}.rsp-kpi{padding:15px}}

/* Monargo Workspace · reseller */
.rsp-shell{background:#f6f6f9}.rsp-topbar{height:58px;padding:0 22px;background:#fff;border-color:#e7e7ed;backdrop-filter:none}.rsp-mark{width:34px;height:34px;border-radius:9px;background:#5b5ce2;box-shadow:none}.rsp-brand-name{font-size:13px}.rsp-brand-sub{font-size:9.5px}.rsp-btn{padding:7px 10px;border-radius:8px;font-size:10.5px;box-shadow:none}.rsp-btn:hover{transform:none;box-shadow:none}.rsp-main{max-width:1320px;padding:22px 24px 40px}.rsp-hero{min-height:112px;padding:19px 21px;margin-bottom:10px;color:#303247;background:#fff;border:1px solid #e1e2e8;border-radius:12px;box-shadow:none}.rsp-hero:after{display:none}.rsp-eyebrow{color:#595bcd;font-size:8.5px}.rsp-hero h1{font-size:23px}.rsp-hero p{color:#8b8d9e;font-size:10.5px}.rsp-flow{color:#616376}.rsp-flow span{color:#55576d;background:#f5f5f8}.rsp-flow b{color:#7779d9}.rsp-kpis{gap:9px;margin-bottom:10px}.rsp-kpi{min-height:91px;position:relative;padding:14px 15px;border-color:#e1e2e8;border-radius:11px;box-shadow:none;overflow:hidden}.rsp-kpi:before{content:"";width:20px;height:3px;position:absolute;top:0;left:15px;background:#5b5ce2;border-radius:0 0 3px 3px}.rsp-kpi:nth-child(2):before{background:#a35bc4}.rsp-kpi:nth-child(3):before{background:#00a86b}.rsp-kpi:hover{transform:none;box-shadow:none}.rsp-kpi-label{font-size:8.5px}.rsp-kpi-value{font-size:22px}.rsp-kpi-sub{font-size:8px}.rsp-card{margin-bottom:10px;background:#fff;border-color:#e1e2e8;border-radius:12px;box-shadow:none}.rsp-card-head{min-height:51px;padding:11px 15px;font-size:11.5px}.rsp-card-body{padding:15px}.rsp-step{width:22px;height:22px;border-radius:6px;font-size:9px}.rsp-form{gap:9px}.rsp-form input,.rsp-form select{padding:9px 10px;border-radius:8px;font-size:11px}.rsp-table{font-size:11px}.rsp-table th{padding:9px 12px;font-size:8.5px}.rsp-table td{padding:10px 12px}.rsp-hint{font-size:9px}
@media(max-width:760px){.rsp-main{padding:16px 13px 34px}.rsp-topbar{padding:0 13px}.rsp-hero{padding:17px}.rsp-hero h1{font-size:21px}}
</style>
<div class="rsp-shell">
  <header class="rsp-topbar">
    <div class="rsp-brand">
      <span class="rsp-mark">M</span>
      <div><div class="rsp-brand-name">Monargo One · Reseller</div><div id="rspName" class="rsp-brand-sub">${tR("rsp.partnerPortal","Partnerportaal")}</div></div>
    </div>
    <div class="rsp-actions">
      <button id="rspLangToggle" class="rsp-btn" title="NL / FR / EN">NL</button>
      <button id="rspLogout" class="rsp-btn"><span class="rsp-logout-label">${tR("rsp.logout","Uitloggen")}</span><span aria-hidden="true">↗</span></button>
    </div>
  </header>
  <main class="rsp-main" id="rspMain"><div style="color:var(--gray-400);padding:40px;text-align:center">${tR("adm.loading","Laden…")}</div></main>
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

  // Statuslabel van een tenantaanvraag (machine 23.14) · drietalig.
  const trqLabel = s => tR("rsp.trq." + String(s || ""), String(s || "-"));

  async function render() {
    const main = document.getElementById("rspMain");
    let d;
    try { d = await api("GET", "/api/reseller/clients"); }
    catch (e) { main.innerHTML = `<div style="background:#fff;border-radius:12px;padding:20px;color:var(--wf-red)">${esc(e.message)}</div>`; return; }
    // Eigen tenantaanvragen · faalt deze call, dan blijft de rest bruikbaar.
    let requests = [];
    try { requests = (await api("GET", "/api/reseller/tenant-requests")).requests || []; } catch (_) { requests = []; }
    const nm = document.getElementById("rspName"); if (nm && d.reseller) nm.textContent = tR("rsp.defaultCommission","{name} · standaard {pct}% commissie").replace("{name}", d.reseller.name).replace("{pct}", d.reseller.defaultCommissionPct || 0);
    const card = (label, value, sub) => `<div class="rsp-kpi"><div class="rsp-kpi-label">${label}</div><div class="rsp-kpi-value">${value}</div><div class="rsp-kpi-sub">${sub || ""}</div></div>`;
    main.innerHTML = `
<section class="rsp-hero">
  <div class="rsp-hero-copy">
    <div class="rsp-eyebrow">${tR("rsp.eyebrow","Partner workspace")}</div>
    <h1>${tR("rsp.partnerPortal","Partnerportaal")}</h1>
    <p>${tR("rsp.heroLead","Meld klanten aan, volg de beoordeling door Monargo en houd zicht op je maandelijkse commissie.")}</p>
  </div>
  <div class="rsp-flow" aria-label="${tR("rsp.flowLabel","Partnerflow")}"><span>${tR("rsp.flowRequest","Aanvraag")}</span><b>›</b><span>${tR("rsp.flowReview","Beoordeling")}</span><b>›</b><span>${tR("rsp.commissionMonth","Commissie / maand")}</span></div>
</section>
<div class="rsp-kpis">
  ${card(tR("rsp.myClients","Mijn klanten"), d.clientCount || 0, tR("rsp.activeTrial","actieve + trial"))}
  ${card(tR("rsp.subMrr","Abonnement (MRR)"), eur(d.totalMrr), tR("rsp.sumActive","som van actieve klanten"))}
  ${card(tR("rsp.commissionMonth","Commissie / maand"), eur(d.totalCommission), tR("rsp.yourEarnings","jouw verdienste"))}
</div>

<section class="rsp-card">
  <div class="rsp-card-head"><span class="rsp-step">1</span>${tR("rsp.requestClient","Klant aanmelden")}</div>
  <div class="rsp-card-body rsp-form">
    <input id="ncName" placeholder="${tR("rsp.clientCompanyPh","Bedrijfsnaam klant")}">
    <input id="ncVat" placeholder="${tR("rsp.vatPh","Ondernemingsnummer (optioneel)")}">
    <input id="ncContactName" placeholder="${tR("rsp.contactNamePh","Naam contactpersoon")}">
    <input id="ncEmail" type="email" placeholder="${tR("rsp.contactEmailPh","E-mail contactpersoon")}">
    <input id="ncStreet" placeholder="${tR("rsp.streetPh","Straat")}">
    <input id="ncNumber" placeholder="${tR("rsp.numberPh","Nummer")}">
    <input id="ncZip" placeholder="${tR("rsp.zipPh","Postcode")}">
    <input id="ncCity" placeholder="${tR("rsp.cityPh","Gemeente")}">
    <input id="ncCountry" placeholder="${tR("rsp.countryPh","Land (BE)")}" value="BE">
    <select id="ncLang"><option value="NL">NL</option><option value="FR">FR</option><option value="EN">EN</option></select>
    <select id="ncPlan"><option value="starter">Starter</option><option value="business" selected>Business</option><option value="enterprise">Enterprise</option></select>
    <select id="ncBilling">
      <option value="monargo_direct">${tR("rsp.billingDirect","Monargo factureert de klant")}</option>
      <option value="via_reseller">${tR("rsp.billingViaReseller","Monargo factureert via mij")}</option>
    </select>
    <div class="rsp-span2 rsp-hint">${tR("rsp.requestNote","Monargo beoordeelt elke aanvraag, bevestigt bij de klant en maakt daarna pas de omgeving aan. De status van je aanvraag zie je hieronder.")}</div>
    <div class="rsp-span2 rsp-submit">
      <button id="ncCreate" class="rsp-btn rsp-btn-primary">${tR("rsp.requestBtn","Aanvraag indienen")}</button>
      <span id="ncMsg" class="rsp-msg" role="status"></span>
    </div>
  </div>
</section>

<section class="rsp-card">
  <div class="rsp-card-head"><span class="rsp-step">2</span>${tR("rsp.myRequests","Mijn aanvragen")}</div>
  <div class="rsp-table-wrap"><table class="rsp-table">
    <thead><tr><th>${tR("adm.thCustomer","Klant")}</th><th>${tR("rsp.plan","Plan")}</th><th>${tR("adm.status","Status")}</th><th>${tR("rsp.thRequested","Aangevraagd op")}</th></tr></thead>
    <tbody>${requests.map(r => `<tr>
      <td class="rsp-client">${esc((r.endCustomer && r.endCustomer.legalName) || "-")}</td>
      <td style="text-transform:capitalize">${esc((r.package && r.package.plan) || "-")}</td>
      <td>${esc(trqLabel(r.status))}</td>
      <td>${esc(String(r.createdAt || "").slice(0, 10) || "-")}</td>
    </tr>`).join("") || `<tr><td colspan="4" class="rsp-empty">${tR("rsp.noRequests","Nog geen aanvragen · meld hierboven je eerste klant aan.")}</td></tr>`}</tbody>
  </table></div>
</section>

<section class="rsp-card">
  <div class="rsp-card-head"><span class="rsp-step">3</span>${tR("rsp.clientsCommission","Mijn klanten &amp; commissie")}</div>
  <div class="rsp-table-wrap"><table class="rsp-table">
    <thead><tr><th>${tR("adm.thCustomer","Klant")}</th><th>${tR("rsp.plan","Plan")}</th><th>${tR("adm.status","Status")}</th><th>MRR</th><th>${tR("rsp.commissionPct","Commissie %")}</th><th>${tR("rsp.commissionMo","Commissie/mnd")}</th></tr></thead>
    <tbody>${(d.rows || []).map(r => `<tr>
      <td class="rsp-client">${esc(r.name)}</td>
      <td style="text-transform:capitalize">${esc(r.plan)}</td>
      <td>${r.status === "active" ? `<span class="adm-dot" style="background:var(--wf-green)"></span> ${tR("adm.active","actief").toLowerCase()}` : '<span class="adm-dot" style="background:var(--wf-yellow)"></span> ' + esc(r.status)}</td>
      <td>${eur(r.mrr)}</td>
      <td>${r.commissionPct}%</td>
      <td style="font-weight:650;color:var(--wf-green)">${eur(r.commission)}</td>
    </tr>`).join("") || `<tr><td colspan="6" class="rsp-empty">${tR("rsp.noClients","Nog geen klanten · maak je eerste klant aan hierboven.")}</td></tr>`}</tbody>
  </table></div>
</section>`;

    document.getElementById("ncCreate").addEventListener("click", async () => {
      const val = id => document.getElementById(id).value.trim();
      const msg = document.getElementById("ncMsg"); msg.textContent = "";
      const legalName = val("ncName");
      const email = val("ncEmail");
      const address = {
        straat: val("ncStreet"), nummer: val("ncNumber"),
        postcode: val("ncZip"), gemeente: val("ncCity"), land: val("ncCountry"),
      };
      if (!legalName || !email || Object.values(address).some(v => !v)) {
        msg.textContent = tR("rsp.reqFieldsRequest","Bedrijfsnaam, contact-e-mail en het volledige adres zijn verplicht.");
        return;
      }
      const button = document.getElementById("ncCreate");
      try {
        button.disabled = true;
        button.textContent = tR("adm.loading","Laden…");
        // 23.9: aanvraag indienen (draft) en meteen ter beoordeling aanbieden.
        const r = await api("POST", "/api/reseller/clients", {
          endCustomer: {
            legalName, enterpriseVat: val("ncVat") || null, address,
            contact: { name: val("ncContactName") || null, email },
            language: document.getElementById("ncLang").value,
          },
          package: { plan: document.getElementById("ncPlan").value },
          billingOwnership: document.getElementById("ncBilling").value,
        });
        const requestId = r && r.tenantRequest && r.tenantRequest.id;
        if (requestId) {
          try { await api("POST", `/api/reseller/tenant-requests/${requestId}/transition`, { to: "submitted" }); }
          catch (_) { /* blijft als concept staan · zichtbaar in de lijst */ }
        }
        if (window.showToast) window.showToast(tR("rsp.requestSubmitted","Aanvraag ingediend · Monargo beoordeelt ze en bevestigt bij de klant."), "success");
        render();
      } catch (e) {
        msg.textContent = e.message;
        if (button) { button.disabled = false; button.textContent = tR("rsp.requestBtn","Aanvraag indienen"); }
      }
    });
  }

  window.wfp_resellerInit = buildShell;
}());
