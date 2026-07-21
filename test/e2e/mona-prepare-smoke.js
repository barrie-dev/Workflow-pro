// Route-smoke h48 · Mona Prepare: proactief VOORBEREID werk. Bewijst end-to-end
// dat de assistent kant-en-klare, vooraf-ingevulde plannen levert op echte
// endpoints, rechten-gescoped, en dat één stap écht uitvoerbaar is.
const BASE = "http://localhost:" + (process.env.PORT || "4299");
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
const today = new Date();
const past = new Date(today.getTime() - 10 * 86400000).toISOString().slice(0, 10);

(async () => {
  const tok = (await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" })).data.token;
  const me = await j("GET", "/api/me", null, tok);
  const tid = me.data.user.tenantId;

  // Add-on aanzetten zodat voorbereide stappen ook UITVOERBAAR zijn (niet enkel getoond).
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  await j("PATCH", `/api/admin/tenants/${tid}/modules`, { moduleOverrides: { add: ["ai_actions"], remove: [] } }, superTok);

  // Data die aandacht vraagt: een aanvaarde offerte + een vervallen factuur.
  const cust = await j("POST", `/api/tenants/${tid}/customers`, { name: "Voorbereid BV", email: "v@x.be", vatNumber: "BE0403170701" }, tok);
  const custId = cust.data.customer.id;
  const quote = await j("POST", `/api/tenants/${tid}/offertes`, { customerId: custId, clientName: "Voorbereid BV", lines: [{ description: "Werk", qty: 1, unitPrice: 2000, vatRate: 21 }] }, tok);
  const quoteId = quote.data.quote.id;
  // Offerte laten aanvaarden (interne statuszet).
  await j("PATCH", `/api/tenants/${tid}/offertes/${quoteId}`, { status: "aanvaard" }, tok);
  // Een vervallen factuur.
  const inv = await j("POST", `/api/tenants/${tid}/facturen`, { customerName: "Voorbereid BV", dueDate: past, lines: [{ description: "Oud werk", qty: 1, unitPrice: 500, vatRate: 21 }] }, tok);
  check("setup: klant, aanvaarde offerte, vervallen factuur", quote.status === 201 && inv.status === 201, `${quote.status}/${inv.status}`);

  // ── Kern: proactief voorbereid werk ──────────────────────────────────────
  const prep = await j("GET", `/api/tenants/${tid}/mona/prepared`, null, tok);
  check("prepared: endpoint levert plannen", prep.status === 200 && Array.isArray(prep.data.plans) && prep.data.plans.length >= 1, prep.data.plans && prep.data.plans.length);
  const convert = (prep.data.plans || []).find(p => p.kind === "convert_quote");
  const reminders = (prep.data.plans || []).find(p => p.kind === "send_reminders");
  check("prepared: aanvaarde offerte klaar om te factureren", !!convert && convert.steps[0].endpoint.path === `offertes/${quoteId}/convert`, convert && convert.steps[0].endpoint.path);
  check("prepared: vervallen factuur → herinnering klaar", !!reminders && reminders.steps[0].endpoint.path === "notifications/reminders", !!reminders);
  check("prepared: met add-on zijn stappen direct uitvoerbaar", convert && convert.steps[0].needsAddon === false, convert && convert.steps[0].needsAddon);

  // ── Eén voorbereide stap ECHT uitvoeren (via het endpoint dat de stap draagt) ──
  const step = convert.steps[0];
  const exec = await j(step.endpoint.method, `/api/tenants/${tid}/${step.endpoint.path}`, step.params, tok);
  check("uitvoeren: voorbereide offerte-conversie werkt", exec.status === 200 || exec.status === 201, exec.status);
  check("uitvoeren: er is een factuur ontstaan", !!(exec.data.invoice && exec.data.invoice.number), exec.data.invoice && exec.data.invoice.number);
  // Na conversie is de leakage weg → het convert-plan verdwijnt uit de voorbereiding.
  const prep2 = await j("GET", `/api/tenants/${tid}/mona/prepared`, null, tok);
  check("prepared: conversie-plan verdwenen na uitvoering", !(prep2.data.plans || []).some(p => p.kind === "convert_quote"), (prep2.data.plans || []).map(p => p.kind).join(","));

  // ── Project op verzoek voorbereiden (dossier + kickoff) ───────────────────
  const proj = await j("POST", `/api/tenants/${tid}/mona/prepare-project`, { customerId: custId, type: "renovatie" }, tok);
  check("prepare-project: plan met project + kickoff", proj.status === 200 && proj.data.plan.steps.length === 2, proj.data.plan && proj.data.plan.steps.length);
  const projStep = proj.data.plan.steps.find(s => s.action === "create_project");
  check("prepare-project: klant + naam vooraf ingevuld", projStep && projStep.params.customerId === custId && /Voorbereid BV/.test(projStep.params.name), projStep && projStep.params.name);
  // De projectstap echt uitvoeren.
  const projExec = await j(projStep.endpoint.method, `/api/tenants/${tid}/${projStep.endpoint.path}`, projStep.params, tok);
  check("prepare-project: projectstap uitvoerbaar", projExec.status === 201 && !!projExec.data.project, projExec.status);

  // ── Proactieve dagelijkse digest → in-app melding (idempotent) ────────────
  // Nog een vervallen factuur zodat er zeker actionable werk overblijft.
  await j("POST", `/api/tenants/${tid}/facturen`, { customerName: "Voorbereid BV", dueDate: past, lines: [{ description: "Nog ouder werk", qty: 1, unitPrice: 250, vatRate: 21 }] }, tok);
  const dg = await j("POST", `/api/tenants/${tid}/mona/digest`, {}, tok);
  check("digest: samenvatting met actionable werk", dg.status === 200 && dg.data.digest.actionable >= 1, dg.data.digest && dg.data.digest.actionable);
  check("digest: melding aangemaakt", dg.data.notified === true, dg.data.notified);
  // Tweede keer dezelfde dag → geen dubbele melding (idempotent).
  const dg2 = await j("POST", `/api/tenants/${tid}/mona/digest`, {}, tok);
  check("digest: idempotent per dag (geen dubbele melding)", dg2.data.notified === false, dg2.data.notified);
  // De melding staat in de notificatielijst.
  const notifs = await j("GET", `/api/tenants/${tid}/notifications`, null, tok);
  const monaNote = (notifs.data.notifications || notifs.data.rows || []).find(n => n.type === "mona" || /voorbereid/i.test(n.title || ""));
  check("digest: melding zichtbaar in notificaties", !!monaNote, monaNote && monaNote.title);

  // ── Mona-chat (mock-modus) surface't proactief het voorbereide werk ───────
  const chat = await j("POST", `/api/tenants/${tid}/boden`, { messages: [{ role: "user", content: "wat kan je voor me klaarzetten?" }] }, tok);
  check("chat: mock-modus meldt voorbereid werk", chat.status === 200 && /voorbereid|klaargezet/i.test(chat.data.reply || ""), (chat.data.reply || "").slice(0, 60));

  // ── Rechten: een medewerker krijgt geen facturatie-voorbereiding ──────────
  // (login als bestaande medewerker uit de seed indien aanwezig; anders overslaan)
  const empLogin = await j("POST", "/api/auth/login", { email: "werknemer@demobouw.be", password: "Demo2026!" });
  if (empLogin.data.token) {
    const empPrep = await j("GET", `/api/tenants/${tid}/mona/prepared`, null, empLogin.data.token);
    const leaks = (empPrep.data.plans || []).some(p => p.steps.some(s => ["convert_quote", "create_invoice", "send_reminders"].includes(s.action)));
    check("rechten: medewerker krijgt geen facturatie-stappen", !leaks, leaks);
  } else {
    console.log("OK  · rechten-check overgeslagen (geen werknemer-seed)");
  }

  console.log(failures ? `\n${failures} controle(s) faalden` : "\nMona Prepare-smoke groen");
  exitSoft(failures ? 1 : 0);
})().catch(e => { console.error("SMOKE CRASH", e); exitSoft(1); });
