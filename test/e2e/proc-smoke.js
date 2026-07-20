// Route-smoke voor R5: leverancier → inkooporder → ontvangst → voorraad + commitment in projectfinance.
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
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  // Enterprise-pack: op een verse (business-)seed eerst aanzetten via de
  // superadmin, zodat deze smoke de module zelf voorziet i.p.v. een gegroeide
  // dataset te veronderstellen.
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  await j("PATCH", `/api/admin/tenants/${tid}/modules`, { moduleOverrides: { add: ["procurement", "inventory"], remove: [] } }, superTok);

  const cust = await j("POST", `/api/tenants/${tid}/customers`, { name: "Proc Klant BV", email: "pk@x.be" }, tok);
  const prj = await j("POST", `/api/tenants/${tid}/projects`, { name: "Proc Project", customerId: cust.data.customer.id, budgetAmount: 20000 }, tok);
  const prjId = prj.data.project.id;

  // Leverancier (iban gevoelig)
  const sup = await j("POST", `/api/tenants/${tid}/suppliers`, { name: "Groothandel BV", vatNumber: "BE0222", iban: "BE68539007547034", email: "g@bv.be" }, tok);
  check("leverancier aangemaakt", sup.status === 201 && /^sup_/.test(sup.data.supplier.id));

  // Inkooporder gekoppeld aan project, ontvangstlocatie loc-magazijn
  const po = await j("POST", `/api/tenants/${tid}/purchase_orders`, {
    supplierId: sup.data.supplier.id, projectId: prjId, locationId: "loc-magazijn", type: "material",
    lines: [{ description: "Buizen 32mm", articleId: "art-buis32", orderedQty: 100, unitPrice: 12, vatRate: 21 }],
  }, tok);
  check("inkooporder (PO-nummer, subtotaal 1200, draft)", po.status === 201 && /^PO-\d{4}-\d{3}$/.test(po.data.purchaseOrder.number) && po.data.purchaseOrder.subtotal === 1200, po.data.purchaseOrder && po.data.purchaseOrder.number);
  const poId = po.data.purchaseOrder.id;
  const lineId = po.data.purchaseOrder.lines[0].id;

  // Verplichting zit in projectfinance-forecast
  const fin1 = await j("GET", `/api/tenants/${tid}/projects/${prjId}/finance`, null, tok);
  // PO is draft → nog geen commitment (open statuses = approved+). Approve keten.
  await j("POST", `/api/tenants/${tid}/purchase_orders/${poId}/transition`, { status: "approved" }, tok);
  await j("POST", `/api/tenants/${tid}/purchase_orders/${poId}/transition`, { status: "sent" }, tok);
  const conf = await j("POST", `/api/tenants/${tid}/purchase_orders/${poId}/transition`, { status: "confirmed" }, tok);
  check("PO bevestigd, commitment 1200", conf.data.purchaseOrder.commitment === 1200, conf.data.purchaseOrder.commitment);

  const fin2 = await j("GET", `/api/tenants/${tid}/projects/${prjId}/finance`, null, tok);
  check("projectfinance toont commitment + forecast", fin2.data.finance.commitment.total === 1200 && fin2.data.finance.forecastCost === 1200, JSON.stringify({ c: fin2.data.finance.commitment.total, f: fin2.data.finance.forecastCost }));

  // Deelontvangst 60 → voorraad 60, status partially_received, commitment daalt
  const r1 = await j("POST", `/api/tenants/${tid}/purchase_orders/${poId}/receive`, { receipts: [{ lineId, qty: 60 }] }, tok);
  check("deelontvangst → 60% + status partially_received", r1.status === 201 && r1.data.progress.pct === 60 && r1.data.purchaseOrder.status === "partially_received", r1.data.progress && r1.data.progress.pct);

  const lvl = await j("GET", `/api/tenants/${tid}/inventory/levels?articleId=art-buis32`, null, tok);
  const level = (lvl.data.levels || []).find(l => l.locationId === "loc-magazijn");
  check("voorraad geboekt: fysiek 60", level && level.physical === 60, level && level.physical);

  const fin3 = await j("GET", `/api/tenants/${tid}/projects/${prjId}/finance`, null, tok);
  check("commitment daalt naar 480 (40 open × 12)", fin3.data.finance.commitment.total === 480, fin3.data.finance.commitment.total);

  // Over-ontvangst → 409
  const over = await j("POST", `/api/tenants/${tid}/purchase_orders/${poId}/receive`, { receipts: [{ lineId, qty: 50 }] }, tok);
  check("over-ontvangst → 409 OVER_RECEIPT", over.status === 409 && over.data.code === "OVER_RECEIPT");

  // Reservatie: reserveer 20 van de 60, beschikbaar 40
  const resv = await j("POST", `/api/tenants/${tid}/inventory/reservations`, { articleId: "art-buis32", locationId: "loc-magazijn", qty: 20 }, tok);
  check("reservatie 20 → beschikbaar 40", resv.status === 201, resv.data.reservation && resv.data.reservation.qty);
  const lvl2 = await j("GET", `/api/tenants/${tid}/inventory/levels?articleId=art-buis32`, null, tok);
  const l2 = (lvl2.data.levels || []).find(l => l.locationId === "loc-magazijn");
  check("beschikbaar 40 na reservatie", l2 && l2.available === 40 && l2.reserved === 20, l2 && l2.available);

  // Transfer 10 naar loc-werf
  const tr = await j("POST", `/api/tenants/${tid}/inventory/transfer`, { articleId: "art-buis32", fromLocationId: "loc-magazijn", toLocationId: "loc-werf", qty: 10 }, tok);
  check("transfer → magazijn 50, werf 10", tr.status === 201);
  const lvl3 = await j("GET", `/api/tenants/${tid}/inventory/levels?articleId=art-buis32`, null, tok);
  const werf = (lvl3.data.levels || []).find(l => l.locationId === "loc-werf");
  check("werflocatie fysiek 10 na ontvangst-transfer", werf && werf.physical === 10, werf && werf.physical);

  // Events
  const superTok2 = superTok;
  const ev = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=purchase_order.received`, null, superTok);
  check("purchase_order.received event", (ev.data.events || []).length >= 1);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
