"use strict";
/**
 * Mona · de AI-assistent van Monargo One (voorheen Boden; interne identifiers
 * zoals de /boden-route en bodenChat blijven voor compatibiliteit).
 *
 * Contract: master-spec hoofdstuk 48 (Mona Assist/Actions/Estimate/Signals/
 * Governance). Kernregel (beveiliging): Mona heeft GEEN directe DB-toegang en
 * krijgt nooit meer rechten dan de uitvoerende gebruiker. Tools draaien onder
 * de identiteit van de ingelogde gebruiker en passeren exact dezelfde poort:
 * rol-rechten (can/assertCan), pakket-entitlements (isModuleEnabled) én
 * own:-scoping. Mag de gebruiker iets niet zien, dan geeft de tool het niet
 * terug → Mona kan het niet vertellen.
 *
 * Acties (aanmaken/wijzigen) voert Mona NOOIT zelf uit. Ze geeft een
 * voorstel-kaart terug (preview); de gebruiker bevestigt en de UI roept het
 * bestaande, reeds-beveiligde endpoint aan. Elk voorstel wordt geauditeerd.
 *
 * Zonder echte OpenAI-key draait Mona in mock-modus (gratis, voor QA).
 */

const { can } = require("../lib/auth");
const { isModuleEnabled, resolveTenantModules } = require("./entitlements");
const { hasRealKey, createChat } = require("../lib/openai");
const { loadPlatformConfig } = require("./platform-config");
const { availableWidgets, renderWidgets } = require("./dashboards");
const { terminologyFor } = require("./sectors");

// ── Leesbare record-types → collectie, vereist recht, module-key, samenvatter ──
const READABLE = {
  customers:  { collection: "customers",  perm: "customers",  module: "customers",  label: "Klanten",
    sum: r => ({ id: r.id, naam: r.name, email: r.email, btw: r.vatNumber }) },
  workorders: { collection: "workorders", perm: "workorders", module: "workorders", label: "Werkbonnen", ownable: true,
    sum: r => ({ id: r.id, nummer: r.number, titel: r.title, status: r.status, klant: r.clientName, medewerker: r.userName, datum: r.date }) },
  invoices:   { collection: "invoices",   perm: "billing",    module: "invoices",   label: "Facturen",
    sum: r => ({ id: r.id, nummer: r.number, klant: r.customerName, bedrag: r.total, status: r.status, vervaldatum: r.dueDate }) },
  quotes:     { collection: "quotes",     perm: "billing",    module: "offertes",   label: "Offertes",
    sum: r => ({ id: r.id, nummer: r.number, klant: r.customerName, bedrag: r.total, status: r.status }) },
  expenses:   { collection: "expenses",   perm: "expenses",   module: "expenses",   label: "Onkosten", ownable: true,
    sum: r => ({ id: r.id, datum: r.date, bedrag: r.amount, categorie: r.category, status: r.status, medewerker: r.userName }) },
  leaves:     { collection: "leaves",     perm: "leaves",     module: "leaves",     label: "Verlof", ownable: true,
    sum: r => ({ id: r.id, van: r.startDate, tot: r.endDate, type: r.type, status: r.status, dagen: r.days, medewerker: r.userName }) },
  shifts:     { collection: "shifts",     perm: "planning",   module: "planning",   label: "Planning", ownable: true,
    sum: r => ({ id: r.id, datum: r.date, start: r.start, eind: r.end, medewerker: r.userName, locatie: r.venueName }) },
  stock:      { collection: "stock",      perm: "stock",      module: "stock",      label: "Stock",
    sum: r => ({ id: r.id, naam: r.name, aantal: r.quantity, minimum: r.minQuantity, eenheid: r.unit }) },
  vehicles:   { collection: "vehicles",   perm: "vehicles",   module: "vehicles",   label: "Wagenpark",
    sum: r => ({ id: r.id, naam: r.name, nummerplaat: r.plate, status: r.status, bestuurder: r.driverName }) },
  employees:  { collection: "users",      perm: "employees",  module: null,         label: "Medewerkers",
    sum: r => ({ id: r.id, naam: r.name, email: r.email, rol: r.role, functie: r.function, actief: r.active !== false }) },
};

// ── Bevestig-acties: server-allowlist; UI roept bij bevestiging het endpoint aan ──
// `full: true` → vereist het volledige recht (niet own:), want het endpoint is
// een beheer-endpoint (geen me/*). De server-endpoints blijven de finale bewaker.
const ACTIONS = {
  navigate:        { label: "Naar scherm gaan", needsConfirm: false },
  // Persoonlijke acties (me/*): elke medewerker mag deze voor zichzelf.
  clock_in:        { label: "Inklokken",         perm: "clockings", path: "me/clock/in",  method: "POST", fields: [], needsConfirm: false },
  clock_out:       { label: "Uitklokken",        perm: "clockings", path: "me/clock/out", method: "POST", fields: [], needsConfirm: false },
  create_leave:    { label: "Verlof aanvragen",  perm: "leaves",    path: "me/leaves",    method: "POST", fields: ["startDate", "endDate", "type", "reason"] },
  create_expense:  { label: "Onkost indienen",   perm: "expenses",  path: "me/expenses",  method: "POST", fields: ["amount", "category", "description", "date"] },
  // Beheer-acties: vereisen het volledige recht (admin/manager of toegekend).
  create_customer: { label: "Klant aanmaken",    perm: "customers", full: true, path: "customers",  method: "POST", fields: ["name", "email", "vatNumber", "phone"] },
  create_workorder:{ label: "Werkbon aanmaken",  perm: "workorders",full: true, path: "workorders", method: "POST", fields: ["title", "clientName", "date", "description"] },
  create_quote:    { label: "Offerte aanmaken",  perm: "billing",   full: true, path: "offertes",   method: "POST", fields: ["customerName", "lines", "notes"] },
  create_message:  { label: "Bericht plaatsen",  perm: "messages",  full: true, path: "messages",   method: "POST", fields: ["title", "body", "audience"] },
  create_venue:    { label: "Locatie aanmaken",  perm: "venues",    full: true, path: "venues",      method: "POST", fields: ["name", "address", "city"] },
};

const ACTIONS_ADDON = "ai_actions"; // betaalde add-on om écht te handelen

function hasFull(user, perm) {
  if (["tenant_admin", "manager"].includes(user.role)) return true;
  return (user.permissions || []).includes(perm);
}
function hasAny(user, perm) {
  return can(user, perm); // true bij perm óf own:perm
}

// ── Tool-uitvoering (onder user-identiteit, volledig rechten-gescoped) ──────────
function runTool(store, tenant, user, name, input, proposals) {
  if (name === "get_my_context") {
    const ent = resolveTenantModules(store, tenant);
    return {
      gebruiker: user.name || user.email,
      rol: user.role,
      organisatie: tenant.name,
      toegankelijke_modules: ent.views,
      toegankelijke_record_types: Object.keys(READABLE).filter(t => {
        const d = READABLE[t];
        return hasAny(user, d.perm) && (!d.module || isModuleEnabled(store, tenant, d.module));
      }),
    };
  }

  if (name === "query_records") {
    const type = String(input.type || "");
    const d = READABLE[type];
    if (!d) return { error: `Onbekend type '${type}'. Geldig: ${Object.keys(READABLE).join(", ")}` };
    if (!hasAny(user, d.perm)) return { error: `Geen toegang: je mag '${d.label}' niet bekijken.` };
    if (d.module && !isModuleEnabled(store, tenant, d.module)) return { error: `'${d.label}' zit niet in het pakket van deze organisatie.` };
    let rows = store.list(d.collection, tenant.id);
    // own:-scoping voor wie geen volledig recht heeft (bv. medewerker)
    if (d.ownable && !hasFull(user, d.perm)) rows = rows.filter(r => r.userId === user.id);
    if (type === "employees") rows = rows.filter(r => r.role !== "super_admin");
    if (input.status) rows = rows.filter(r => String(r.status || "").toLowerCase() === String(input.status).toLowerCase());
    if (input.query) {
      const q = String(input.query).toLowerCase();
      rows = rows.filter(r => JSON.stringify(d.sum(r)).toLowerCase().includes(q));
    }
    const limit = Math.min(Number(input.limit) || 15, 40);
    return { type, label: d.label, aantal: rows.length, resultaten: rows.slice(0, limit).map(d.sum) };
  }

  if (name === "search") {
    const q = String(input.query || "").toLowerCase();
    if (q.length < 2) return { resultaten: [] };
    const out = [];
    for (const [type, d] of Object.entries(READABLE)) {
      if (!hasAny(user, d.perm)) continue;
      if (d.module && !isModuleEnabled(store, tenant, d.module)) continue;
      let rows = store.list(d.collection, tenant.id);
      if (d.ownable && !hasFull(user, d.perm)) rows = rows.filter(r => r.userId === user.id);
      if (type === "employees") rows = rows.filter(r => r.role !== "super_admin");
      for (const r of rows) {
        if (JSON.stringify(d.sum(r)).toLowerCase().includes(q)) {
          out.push({ type: d.label, ...d.sum(r) });
          if (out.length >= 25) break;
        }
      }
      if (out.length >= 25) break;
    }
    return { aantal: out.length, resultaten: out };
  }

  if (name === "aggregate") {
    const type = String(input.type || "");
    const d = READABLE[type];
    if (!d) return { error: `Onbekend type '${type}'. Geldig: ${Object.keys(READABLE).join(", ")}` };
    if (!hasAny(user, d.perm)) return { error: `Geen toegang: je mag '${d.label}' niet bekijken.` };
    if (d.module && !isModuleEnabled(store, tenant, d.module)) return { error: `'${d.label}' zit niet in het pakket.` };
    let rows = store.list(d.collection, tenant.id);
    if (d.ownable && !hasFull(user, d.perm)) rows = rows.filter(r => r.userId === user.id);
    if (type === "employees") rows = rows.filter(r => r.role !== "super_admin");
    if (input.status) rows = rows.filter(r => String(r.status || "").toLowerCase() === String(input.status).toLowerCase());
    const summ = rows.map(d.sum);
    const fields = summ.length ? Object.keys(summ[0]) : [];
    const metric = ["count", "sum", "avg"].includes(input.metric) ? input.metric : "count";
    const field = input.field && fields.includes(input.field) ? input.field : null;
    const groupBy = input.groupBy && fields.includes(input.groupBy) ? input.groupBy : null;
    if ((metric === "sum" || metric === "avg") && !field) {
      return { error: `Voor metric '${metric}' is een numeriek 'field' nodig. Beschikbaar: ${fields.join(", ")}` };
    }
    const num = v => { const n = Number(String(v ?? "").replace(/[^0-9.,-]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", ".")); return isFinite(n) ? n : 0; };
    const calc = arr => {
      if (metric === "count") return arr.length;
      const s = arr.reduce((a, x) => a + num(x[field]), 0);
      return metric === "avg" ? (arr.length ? +(s / arr.length).toFixed(2) : 0) : +s.toFixed(2);
    };
    if (groupBy) {
      const groups = {};
      for (const x of summ) { const k = String(x[groupBy] ?? "-"); (groups[k] = groups[k] || []).push(x); }
      return { type, label: d.label, metric, field, groupBy, totaal_records: summ.length, groepen: Object.fromEntries(Object.entries(groups).map(([k, arr]) => [k, calc(arr)])) };
    }
    return { type, label: d.label, metric, field, aantal: summ.length, waarde: calc(summ) };
  }

  if (name === "get_kpis") {
    const keys = availableWidgets(store, tenant, user).map(w => w.key);
    const kpis = renderWidgets(store, tenant, user, keys).map(w => ({ label: w.label, waarde: w.value, detail: w.sub, groep: w.group }));
    return { aantal: kpis.length, kpis };
  }

  if (name === "propose_action") {
    const action = String(input.action || "");
    const a = ACTIONS[action];
    if (!a) return { error: `Onbekende actie '${action}'.` };
    // 'navigate' is gratis UX (geen kost, geen wijziging). Écht handelen (alles met
    // een endpoint) zit achter de betaalde add-on 'ai_actions'.
    if (a.path && !isModuleEnabled(store, tenant, ACTIONS_ADDON)) {
      return { error: "actions_addon_uit: Mona mag in dit pakket geen acties uitvoeren. Verwijs de gebruiker naar het juiste scherm of vermeld dat de AI-acties-add-on nodig is." };
    }
    if (a.perm && (a.full ? !hasFull(user, a.perm) : !hasAny(user, a.perm))) {
      return { error: `Geen toegang om '${a.label}' uit te voeren.` };
    }
    const params = (input.params && typeof input.params === "object") ? input.params : {};
    const proposal = {
      id: `prop_${proposals.length + 1}`,
      action,
      label: a.label,
      params,
      needsConfirm: a.needsConfirm !== false,
    };
    if (a.path) { proposal.method = a.method; proposal.path = a.path; }
    proposals.push(proposal);
    // Governance (master-spec h48): elk actievoorstel wordt geauditeerd met
    // actor en veldnamen (geen waarden · geen gevoelige data in de audittrail).
    if (a.path && store.audit) {
      store.audit({ actor: user.email, tenantId: tenant.id, action: "mona_action_proposed", area: "mona", detail: `${action} · velden: ${Object.keys(params).join(",") || "-"}` });
    }
    return { ok: true, melding: "Voorstel klaar. Vraag de gebruiker om te bevestigen · voer niets uit." };
  }

  return { error: `Onbekende tool '${name}'.` };
}

// ── Tool-schema's voor OpenAI (function calling) ───────────────────────────────
function fn(name, description, parameters) {
  return { type: "function", function: { name, description, parameters } };
}
function toolDefs() {
  return [
    fn("get_my_context", "Geef de rol, organisatie en welke modules/record-types deze gebruiker mag zien. Roep dit eerst aan als je niet zeker weet wat de gebruiker mag.", { type: "object", properties: {} }),
    fn("query_records", "Haal records op van één type, gescoped op de rechten van de gebruiker. Geeft enkel data terug die de gebruiker mag zien.", { type: "object", properties: {
      type: { type: "string", enum: Object.keys(READABLE), description: "Soort record" },
      status: { type: "string", description: "Optioneel statusfilter" },
      query: { type: "string", description: "Optioneel zoekwoord" },
      limit: { type: "number", description: "Max aantal (default 15, max 40)" },
    }, required: ["type"] }),
    fn("search", "Snel zoeken over alle voor de gebruiker toegankelijke record-types.", { type: "object", properties: { query: { type: "string" } }, required: ["query"] }),
    fn("aggregate", "Bereken een getal over één record-type (rechten-gescoped): aantal, som of gemiddelde, optioneel gegroepeerd. Gebruik dit voor 'hoeveel', 'totaal', 'gemiddeld' of 'per X'-vragen i.p.v. records op te sommen. Bv. totaal openstaand factuurbedrag (type=invoices, metric=sum, field=bedrag, status=open), of onkosten per categorie (type=expenses, metric=sum, field=bedrag, groupBy=categorie).", { type: "object", properties: {
      type: { type: "string", enum: Object.keys(READABLE) },
      metric: { type: "string", enum: ["count", "sum", "avg"], description: "count (standaard), sum of avg" },
      field: { type: "string", description: "Numeriek veld voor sum/avg (bv. bedrag, dagen, aantal)" },
      groupBy: { type: "string", description: "Veld om op te groeperen (bv. status, categorie, medewerker)" },
      status: { type: "string", description: "Optioneel statusfilter vóór de berekening" },
    }, required: ["type"] }),
    fn("get_kpis", "Geef de belangrijkste kerncijfers (KPI's) die deze gebruiker mag zien, kant-en-klaar berekend. Ideaal voor 'hoe staan we ervoor', 'geef me een overzicht' of vragen naar omzet, openstaande facturen, teamgrootte, open opdrachten enz.", { type: "object", properties: {} }),
    fn("propose_action", "Stel een actie voor die de gebruiker bevestigt en die daarna ECHT wordt uitgevoerd (de gebruiker klikt bevestigen → het beveiligde endpoint draait). Jij voert zelf niets uit. 'navigate' brengt de gebruiker naar een scherm (params.view) · altijd beschikbaar. De overige acties (clock_in, clock_out, create_leave, create_expense, create_customer, create_workorder, create_quote, create_message, create_venue) vereisen de AI-acties-add-on én het juiste recht; geef params mee volgens de velden van de actie.", { type: "object", properties: {
      action: { type: "string", enum: Object.keys(ACTIONS) },
      params: { type: "object", description: "Veldwaarden voor de actie" },
    }, required: ["action"] }),
  ];
}

function systemPrompt(store, tenant, user) {
  const ent = resolveTenantModules(store, tenant);
  const terms = terminologyFor(tenant);
  const today = new Date();
  const dateNL = today.toLocaleDateString("nl-BE", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return [
    "Je bent Mona, de behulpzame AI-assistent in Monargo One · een Belgische B2B SaaS voor KMO's (planning, werkbonnen, tijdregistratie, verlof, onkosten, offertes, facturen/Peppol, klanten, stock, wagenpark).",
    `Vandaag is ${dateNL} (${today.toISOString().slice(0, 10)}). Reken 'deze maand', 'deze week', 'vandaag' hier vanaf.`,
    `De gebruiker is ${user.name || user.email}, rol "${user.role}", organisatie "${tenant.name}".`,
    `Toegankelijke schermen: ${ent.views.join(", ")}.`,
    `Vakjargon van deze organisatie: een opdracht heet "${terms.job}" (mv. "${terms.jobPlural}"), een werklocatie heet "${terms.venue}". Gebruik deze woorden.`,
    isModuleEnabled(store, tenant, "ai_actions")
      ? "Je MAG acties uitvoeren namens de gebruiker via propose_action (de gebruiker bevestigt, daarna draait het echt). Wees behulpzaam en stel concreet de juiste actie voor met ingevulde velden."
      : "De AI-acties-add-on staat NIET aan: je kunt geen wijzigingen uitvoeren. Beantwoord vragen en verwijs de gebruiker naar het juiste scherm; vermeld zo nodig dat hiervoor de AI-acties-add-on nodig is. 'navigate' mag je wel gebruiken.",
    "",
    "WERKWIJZE (wees slim en proactief):",
    "- Voor 'hoeveel', 'totaal', 'gemiddeld', 'per X' of cijfervragen: gebruik 'aggregate' (count/sum/avg, eventueel groupBy) · som nooit zelf records op uit het hoofd.",
    "- Voor 'hoe staan we ervoor', overzichten of vragen naar omzet/openstaande facturen/teamgrootte: gebruik 'get_kpis'.",
    "- Voor specifieke records: 'query_records' of 'search'. Roep 'get_my_context' aan als je twijfelt over de rechten.",
    "- Combineer gerust meerdere tools en redeneer met de uitkomsten (bv. een cijfer + een korte duiding of suggestie).",
    "",
    "STRIKTE REGELS:",
    "1) Gebruik UITSLUITEND data die je via tools terugkrijgt. Verzin nooit gegevens. Geeft een tool 'geen toegang' of 'niet in pakket', leg dat dan kort uit aan de gebruiker.",
    "2) Toon nooit data van andere gebruikers of modules dan wat de tools teruggeven · de tools bewaken de rechten, jij mag die niet omzeilen.",
    "3) Je voert zelf NOOIT wijzigingen uit. Voor elke aanmaak/wijziging/navigatie gebruik je propose_action en zeg je duidelijk dat de gebruiker moet bevestigen. Beweer nooit dat je iets hebt uitgevoerd.",
    "4) Antwoord in het Nederlands, kort en concreet. Geef getallen helder weer (bv. bedragen met €). Verwijs naar het juiste scherm waar nuttig.",
    "5) Maak het onderscheid duidelijk tussen FEITEN (rechtstreeks uit tooldata · benoem de bron, bv. 'volgens je facturen'), AFLEIDINGEN (jouw berekening of interpretatie daarvan) en SUGGESTIES (jouw advies). Presenteer een afleiding of suggestie nooit als vaststaand feit.",
  ].join("\n");
}

// ── Hoofdfunctie ───────────────────────────────────────────────────────────────
async function bodenChat(store, tenant, user, history) {
  const cfg = loadPlatformConfig(store).openai || {};
  // Normaliseer geschiedenis → laatste 12 turns, enkel user/assistant met tekst.
  const msgs = (Array.isArray(history) ? history : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-12)
    .map(m => ({ role: m.role, content: m.content }));
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") {
    const e = new Error("Laatste bericht moet van de gebruiker zijn."); e.status = 400; throw e;
  }

  if (!hasRealKey(cfg)) return mockChat(store, tenant, user, msgs);

  const proposals = [];
  const tools = toolDefs();
  const convo = [{ role: "system", content: systemPrompt(store, tenant, user) }, ...msgs];

  for (let i = 0; i < 6; i++) {
    let resp;
    try {
      resp = await createChat(cfg, { messages: convo, tools, max_tokens: 1536 });
    } catch (e) {
      if (e.status === 401 || e.status === 403) { const err = new Error("De AI-sleutel lijkt ongeldig of heeft geen toegang. Controleer de OpenAI-instellingen (super-admin → Integraties)."); err.status = 502; throw err; }
      if (e.status === 429) { const err = new Error("De AI-dienst is even overbelast. Probeer het zo dadelijk opnieuw."); err.status = 502; throw err; }
      throw e;
    }
    const m = resp.choices && resp.choices[0] && resp.choices[0].message;
    if (!m) return { reply: "…", proposals, mock: false };
    convo.push(m); // assistant-turn (kan tool_calls bevatten)
    const calls = m.tool_calls || [];
    if (!calls.length) {
      return { reply: (m.content || "").trim() || "…", proposals, mock: false };
    }
    for (const call of calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch (_) {}
      let result;
      try { result = runTool(store, tenant, user, call.function.name, args, proposals); }
      catch (e) { result = { error: e.message }; }
      convo.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return { reply: "Sorry, dat lukt me even niet. Probeer je vraag anders te formuleren.", proposals, mock: false };
}

// ── Mock-modus (geen echte key) · gratis, voor QA. Toont dat rechten-scoping werkt ──
function mockChat(store, tenant, user, msgs) {
  const last = msgs[msgs.length - 1].content;
  const ctx = runTool(store, tenant, user, "get_my_context", {}, []);
  const found = runTool(store, tenant, user, "search", { query: last.slice(0, 40) }, []);
  let reply = `Mona draait in **demo-modus** (nog geen AI-sleutel ingesteld door de beheerder).\n\n`;
  reply += `Je bent ingelogd als ${ctx.gebruiker} (${ctx.rol}). Ik kan je helpen met: ${ctx.toegankelijke_record_types.join(", ") || "-"}.\n`;
  if (found.aantal) {
    reply += `\nIk vond ${found.aantal} resultaat(en) voor "${last.slice(0, 40)}":\n`;
    reply += found.resultaten.slice(0, 5).map(r => `• ${r.type}: ${r.naam || r.nummer || r.titel || r.id}`).join("\n");
  } else {
    reply += `\nZodra de beheerder de AI-sleutel instelt (super-admin → Integraties), beantwoord ik je vragen volledig · altijd binnen jouw rechten.`;
  }
  return { reply, proposals: [], mock: true };
}

module.exports = { bodenChat, runTool, ACTIONS, READABLE };
