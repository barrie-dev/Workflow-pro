// Route-smoke R7: vorderingsstaat · bronlijnen, voortgang, bevroren stand,
// contractbewaking, prijsherziening/retentie/voorschot, factuur-reconciliatie.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const me = await j("GET", "/api/me", null, tok);
  const tid = me.data.user.tenantId;

  // Entitlement-gating: vorderingsstaten is een Enterprise-pack. De demo-tenant
  // draait op Business, dus de module hoort geweigerd te worden.
  check("gated: niet in views op Business-plan", !(me.data.entitlements?.views || []).includes("progress-claims"));
  const gated = await j("GET", `/api/tenants/${tid}/progress_claims`, null, tok);
  check("gated: API weigert zonder pack → 403", gated.status === 403, gated.status);

  // Superadmin zet het pack à-la-carte aan voor deze tenant (module-override).
  const superTok0 = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  const ovr = await j("PATCH", `/api/admin/tenants/${tid}/modules`, { moduleOverrides: { add: ["ai_estimate", "progress_claims"], remove: [] } }, superTok0);
  check("superadmin schakelt pack in via override", ovr.status === 200, ovr.status);
  const me2 = await j("GET", "/api/me", null, tok);
  check("vorderingsstaten nu in views", (me2.data.entitlements?.views || []).includes("progress-claims"), (me2.data.entitlements?.views || []).includes("progress-claims"));

  // Klant + project + offerte
  const cust = await j("POST", `/api/tenants/${tid}/customers`, { name: "Bouwheer NV", email: "bh@x.be", address: "Werfstraat 1", vatNumber: "BE0222" }, tok);
  const custId = cust.data.customer.id;
  const proj = await j("POST", `/api/tenants/${tid}/projects`, { name: "Nieuwbouw kantoor", customerId: custId }, tok);
  const projId = proj.data.project.id;
  const quote = await j("POST", `/api/tenants/${tid}/offertes`, { customerId: custId, clientName: "Bouwheer NV", projectId: projId, lines: [
    { description: "Ruwbouw", qty: 100, unitPrice: 500, vatRate: 21 },
    { description: "Dakwerken", qty: 50, unitPrice: 200, vatRate: 21 },
  ] }, tok);
  check("offerte met projectkoppeling", quote.status === 201, quote.data.quote && quote.data.quote.number);

  // Vordering 1
  const c1 = await j("POST", `/api/tenants/${tid}/progress_claims`, { projectId: projId, periodStart: "2026-01-01", periodEnd: "2026-01-31" }, tok);
  check("vordering 1 aangemaakt met bronlijnen", c1.status === 201 && c1.data.claim.lines.length === 2 && /^VS-/.test(c1.data.claim.number), c1.data.claim && c1.data.claim.number);
  check("contractwaarde correct (100*500 + 50*200)", c1.data.totals.contractAmount === 60000, c1.data.totals?.contractAmount);
  const c1Id = c1.data.claim.id;

  // Voortgang 20% ruwbouw + herziening + retentie + voorschot
  const upd = await j("PATCH", `/api/tenants/${tid}/progress_claims/${c1Id}`, {
    expectedVersion: c1.data.claim.version,
    lines: c1.data.claim.lines.map(l => (l.description === "Ruwbouw" ? { ...l, cumulativeQty: 20 } : l)),
    priceRevision: { enabled: true, a: 0.4, b: 0.4, c: 0.2, baseLaborIndex: 100, currentLaborIndex: 110, baseMaterialIndex: 100, currentMaterialIndex: 105, sourceIndexName: "Agoria" },
    retentionPct: 5,
    advanceSettlementPct: 10,
  }, tok);
  check("huidige = cumulatief min vorige (20 × 500)", upd.data.totals.currentAmount === 10000, upd.data.totals?.currentAmount);
  check("prijsherziening apart zichtbaar (factor 1.06 → 600)", upd.data.totals.priceRevision.factor === 1.06 && upd.data.totals.priceRevision.amount === 600, JSON.stringify({ f: upd.data.totals.priceRevision?.factor, a: upd.data.totals.priceRevision?.amount }));
  check("formule reproduceerbaar in tekst", /p = P × \(0\.4·110\/100/.test(upd.data.totals.priceRevision.formulaText || ""), upd.data.totals.priceRevision?.formulaText);
  check("retentie en voorschot afzonderlijk", upd.data.totals.retentionAmount === 530 && upd.data.totals.advanceAmount === 1060, JSON.stringify({ r: upd.data.totals.retentionAmount, v: upd.data.totals.advanceAmount }));
  check("netto te betalen = 9010", upd.data.totals.netPayable === 9010, upd.data.totals?.netPayable);

  // Contractbewaking
  const over = await j("PATCH", `/api/tenants/${tid}/progress_claims/${c1Id}`, {
    lines: upd.data.claim.lines.map(l => (l.description === "Ruwbouw" ? { ...l, cumulativeQty: 150 } : l)),
  }, tok);
  check("cumulatief boven contract → 409", over.status === 409 && over.data.code === "CONTRACT_QTY_EXCEEDED", over.data.code);

  // Factuur vóór goedkeuring geweigerd
  const early = await j("POST", `/api/tenants/${tid}/progress_claims/${c1Id}/invoice`, {}, tok);
  check("factuur vóór goedkeuring → 409", early.status === 409 && early.data.code === "NOT_APPROVED", early.data.code);

  // Goedkeuren en factureren
  await j("POST", `/api/tenants/${tid}/progress_claims/${c1Id}/transition`, { status: "internally_checked" }, tok);
  await j("POST", `/api/tenants/${tid}/progress_claims/${c1Id}/transition`, { status: "sent" }, tok);
  const appr = await j("POST", `/api/tenants/${tid}/progress_claims/${c1Id}/transition`, { status: "approved", note: "Goedgekeurd door architect" }, tok);
  check("goedkeuren bevriest de staat", appr.status === 200 && appr.data.claim.status === "approved" && !!appr.data.claim.approvedAt);

  const frozen = await j("PATCH", `/api/tenants/${tid}/progress_claims/${c1Id}`, { retentionPct: 10 }, tok);
  check("goedgekeurde staat niet meer wijzigbaar → 409", frozen.status === 409 && frozen.data.code === "CLAIM_FROZEN", frozen.data.code);

  const inv = await j("POST", `/api/tenants/${tid}/progress_claims/${c1Id}/invoice`, {}, tok);
  check("factuur aangemaakt uit goedgekeurde vordering", inv.status === 201 && /^\d{4}-\d{3}$/.test(inv.data.invoice.number), inv.data.invoice && inv.data.invoice.number);
  const invSubtotal = Math.round((inv.data.invoice.subtotal || 0) * 100) / 100;
  check("factuur reconcilieert met netto te betalen", invSubtotal === inv.data.totals.netPayable, JSON.stringify({ f: invSubtotal, v: inv.data.totals.netPayable }));
  check("retentie als aparte negatieve lijn", (inv.data.invoice.lines || []).some(l => /Retentie 5%/.test(l.description) && l.unitPrice < 0));
  check("prijsherziening als aparte lijn met formule", (inv.data.invoice.lines || []).some(l => /Prijsherziening/.test(l.description)));
  check("bronallocatie progress_claim op factuurlijnen", (inv.data.invoice.lines || []).every(l => l.sourceType === "progress_claim"));

  const dubbel = await j("POST", `/api/tenants/${tid}/progress_claims/${c1Id}/invoice`, {}, tok);
  check("dubbel factureren geblokkeerd", dubbel.status === 409 && dubbel.data.code === "ALREADY_INVOICED", dubbel.data.code);

  // Vordering 2 start vanaf de bevroren stand
  const c2 = await j("POST", `/api/tenants/${tid}/progress_claims`, { projectId: projId, periodStart: "2026-02-01", periodEnd: "2026-02-28" }, tok);
  const ruwbouw2 = (c2.data.claim.lines || []).find(l => l.description === "Ruwbouw");
  check("vordering 2 start op de laatst goedgekeurde stand", c2.status === 201 && ruwbouw2.previousQty === 20 && ruwbouw2.currentQty === 0, JSON.stringify({ p: ruwbouw2 && ruwbouw2.previousQty, c: ruwbouw2 && ruwbouw2.currentQty }));
  check("vordering 2 verwijst naar vordering 1", c2.data.claim.previousClaimId === c1Id && c2.data.claim.sequence === 2, c2.data.claim.sequence);

  // Events
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  const ev = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=progress_claim.invoiced`, null, superTok);
  check("progress_claim.invoiced event", (ev.data.events || []).length >= 1, (ev.data.events || []).length);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
