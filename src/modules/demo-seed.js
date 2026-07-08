"use strict";
/**
 * Rijke demo-dataset zodat élk scherm leeft: klanten, offertes, facturen,
 * werkbonnen, planning, klok, verlof, onkosten, stock, voertuigen, berichten.
 *
 * - Alle rijen krijgen demoSeed:true zodat clearDemoData() ze weer verwijdert.
 * - Idempotent: opnieuw seeden ruimt eerst de vorige seed-rijen op.
 * - Datums zijn relatief aan vandaag zodat de demo altijd actueel oogt.
 */
const crypto = require("crypto");
const { createNotification } = require("./notifications");

const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const iso = (n, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(h, m, 0, 0); return d.toISOString(); };
const id = p => `${p}_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;

function lines(items) {
  const ls = items.map(([description, qty, unitPrice, vatRate = 21]) => {
    const lineSubtotal = qty * unitPrice, lineVat = lineSubtotal * vatRate / 100;
    return { description, qty, unitPrice, vatRate, lineSubtotal, lineVat, lineTotal: lineSubtotal + lineVat };
  });
  const subtotal = ls.reduce((a, l) => a + l.lineSubtotal, 0);
  const vatAmount = ls.reduce((a, l) => a + l.lineVat, 0);
  return { lines: ls, subtotal, vatAmount, total: subtotal + vatAmount };
}

const SEED_COLLECTIONS = ["customers", "quotes", "invoices", "workorders", "shifts", "clocks", "leaves", "expenses", "stock", "vehicles", "venues", "messages", "notifications"];

function clearDemoData(store, tenantId) {
  let removed = 0;
  for (const col of SEED_COLLECTIONS) {
    for (const row of store.list(col, tenantId).filter(r => r.demoSeed || String(r.sourceRef || "").startsWith("demo:seed:"))) {
      store.remove(col, row.id); removed++;
    }
  }
  return removed;
}

function seedDemoData(store, tenant, actor) {
  const tenantId = tenant.id;
  const cleared = clearDemoData(store, tenantId);
  const t = { tenantId, demoSeed: true, createdAt: new Date().toISOString() };
  const counts = {};
  const ins = (col, row) => { store.insert(col, { ...t, ...row }); counts[col] = (counts[col] || 0) + 1; return row; };

  // Medewerkers (bestaande, geen nieuwe aanmaken)
  const emps = store.list("users", tenantId).filter(u => u.role === "employee" && u.active !== false).slice(0, 3);
  const E = i => emps[i % Math.max(emps.length, 1)] || { id: "u_emp1", name: "Jan Janssen" };

  // Locaties
  const venue1 = ins("venues", { id: id("venue"), name: "Werf Gent Zuid", code: "GZ", address: "Voskenslaan 120, 9000 Gent", active: true });
  const venue2 = ins("venues", { id: id("venue"), name: "Renovatie Antwerpen", code: "RA", address: "Mechelsesteenweg 88, 2018 Antwerpen", active: true });

  // Klanten
  const customers = [
    { name: "Bouwbedrijf Verstraete NV", contactName: "Karel Verstraete", email: "karel@verstraete.be", phone: "+32 9 222 11 33", vatNumber: "BE0466.789.123", address: "Industrielaan 4, 9000 Gent" },
    { name: "Immo Delvaux BV", contactName: "Sofie Delvaux", email: "sofie@delvaux.be", phone: "+32 3 444 22 11", vatNumber: "BE0533.221.987", address: "Frankrijklei 22, 2000 Antwerpen" },
    { name: "Retailgroep Mertens", contactName: "Tom Mertens", email: "tom@mertens.be", phone: "+32 2 511 78 90", vatNumber: "BE0455.667.788", address: "Nieuwstraat 101, 1000 Brussel" },
    { name: "Hotel Botanique", contactName: "Els Janssens", email: "els@botanique.be", phone: "+32 16 23 45 67", vatNumber: "BE0699.882.443", address: "Bondgenotenlaan 5, 3000 Leuven" },
    { name: "Sportcomplex De Meander", contactName: "Dirk Peeters", email: "dirk@meander.be", phone: "+32 11 87 65 43", vatNumber: "BE0777.345.678", address: "Sportlaan 1, 3500 Hasselt" },
  ].map(c => ins("customers", { id: id("cust"), ...c, notes: "" }));

  // Offertes · alle statussen
  const mkQuote = (n, cust, st, items, extra = {}) => ins("quotes", {
    id: id("quote"), number: `OFF-2026-${String(n).padStart(3, "0")}`,
    customerId: cust.id, customerName: cust.name, customerVatNumber: cust.vatNumber, customerAddress: cust.address,
    status: st, quoteDate: day(extra.d || -10), validUntil: day((extra.d || -10) + 30),
    ...lines(items), notes: extra.notes || "", publicToken: crypto.randomBytes(16).toString("hex"),
    sentAt: ["verzonden", "aanvaard", "geweigerd"].includes(st) ? iso(extra.d || -9, 10) : null,
    acceptedAt: st === "aanvaard" ? iso((extra.d || -9) + 2, 14) : null,
    rejectedAt: st === "geweigerd" ? iso((extra.d || -9) + 3, 9) : null,
    invoiceId: null, workorderId: null, createdBy: actor.email, updatedAt: new Date().toISOString(),
  });
  mkQuote(901, customers[0], "aanvaard", [["Renovatie sanitair blok A", 1, 8400], ["Leidingwerk en kranen", 1, 2150]], { d: -18 });
  mkQuote(902, customers[1], "verzonden", [["Dakisolatie 240 m²", 240, 38, 6]], { d: -6 });
  mkQuote(903, customers[2], "concept", [["Winkelinrichting fase 2", 1, 12500]], { d: -2 });
  mkQuote(904, customers[3], "geweigerd", [["Schilderwerken gangen", 1, 4300]], { d: -25, notes: "Prijs te hoog volgens klant" });
  mkQuote(905, customers[4], "verzonden", [["Vervanging verlichting sporthal", 36, 95]], { d: -4 });

  // Facturen · betaald / open / vervallen / Peppol
  const mkInv = (n, cust, st, items, extra = {}) => ins("invoices", {
    id: id("inv"), number: `2026-${String(n).padStart(3, "0")}`,
    customerId: cust.id, customerName: cust.name, customerVatNumber: cust.vatNumber, customerAddress: cust.address,
    status: st, invoiceDate: day(extra.d || -20), dueDate: day((extra.d || -20) + 30),
    ...lines(items), notes: extra.notes || "",
    paidAt: st === "paid" ? iso((extra.d || -20) + 12, 11) : null,
    peppolStatus: extra.peppol || null, peppolProvider: extra.peppol ? "mock" : null,
    peppolSentAt: extra.peppol ? iso((extra.d || -20) + 1, 9) : null,
    peppolReference: extra.peppol ? `PEPPOL-${crypto.randomBytes(4).toString("hex").toUpperCase()}` : null,
    createdBy: actor.email, updatedAt: new Date().toISOString(),
  });
  mkInv(901, customers[0], "paid", [["Renovatie sanitair blok A · voorschot", 1, 4200]], { d: -45, peppol: "delivered" });
  mkInv(902, customers[1], "paid", [["Dakwerken · eindafrekening", 1, 9120, 6]], { d: -38 });
  mkInv(903, customers[2], "open", [["Onderhoudscontract Q2", 1, 1850]], { d: -12, peppol: "delivered" });
  mkInv(904, customers[3], "open", [["Schilderwerken receptie", 1, 3675]], { d: -8 });
  mkInv(905, customers[4], "open", [["Herstelling sportvloer", 1, 2980]], { d: -55, notes: "2e herinnering verstuurd" }); // vervallen (dueDate < vandaag)

  // Werkbonnen · week rond vandaag, alle statussen
  const wos = [
    ["Sanitair blok A · afwerking", customers[0], "Voltooid", "hoog", -3, 0, "Alles geplaatst en getest. Klant tekende af."],
    ["Dakisolatie plaatsen · zone 1", customers[1], "Voltooid", "normaal", -2, 0, "Zone 1 klaar, zone 2 volgt."],
    ["Winkelrek montage", customers[2], "in_progress", "normaal", 0, 1, null],
    ["Lekkage opsporen kelder", customers[3], "in_progress", "hoog", 0, 0, null],
    ["Verlichting sporthal · opmeting", customers[4], "open", "normaal", 1, 2, null],
    ["Kraan vervangen keuken", customers[0], "open", "laag", 2, 1, null],
    ["Oplevering dakwerken", customers[1], "open", "hoog", 3, 0, null],
  ];
  wos.forEach(([title, cust, status, priority, d, ei, note], i) => {
    const e = E(ei);
    ins("workorders", {
      id: id("wo"), number: `WO-2026-9${String(i + 1).padStart(2, "0")}`,
      title, clientName: cust.name, customerId: cust.id, userId: e.id, userName: e.name,
      status, priority, scheduledDate: day(d),
      description: `${title} bij ${cust.name}.`,
      ...(status === "Voltooid" ? { completedAt: iso(d, 16), completionNote: note } : {}),
      ...(status === "in_progress" ? { startedAt: iso(d, 8) } : {}),
      createdBy: actor.email,
    });
  });

  // Planning · deze + volgende week (werkdagen), 3 medewerkers
  for (let d = -7; d <= 11; d++) {
    const dt = new Date(); dt.setDate(dt.getDate() + d);
    const dow = dt.getDay(); if (dow === 0 || dow === 6) continue;
    emps.forEach((e, i) => {
      if ((d + i) % 4 === 3) return; // gaatjes voor realisme
      ins("shifts", {
        id: id("shift"), userId: e.id, userName: e.name, date: day(d),
        start: i === 1 ? "07:30" : "07:00", end: i === 2 ? "15:30" : "16:00",
        location: (d + i) % 2 ? venue2.name : venue1.name, venueId: (d + i) % 2 ? venue2.id : venue1.id,
        project: (d + i) % 2 ? "Renovatie Antwerpen" : "Werf Gent Zuid",
      });
    });
  }

  // Klokregistraties · afgelopen 10 werkdagen
  for (let d = -14; d <= 0; d++) {
    const dt = new Date(); dt.setDate(dt.getDate() + d);
    const dow = dt.getDay(); if (dow === 0 || dow === 6) continue;
    emps.forEach((e, i) => {
      if ((d + i) % 5 === 4) return;
      const out = d === 0 && i === 0 ? null : iso(d, 15 + (i % 2), 30); // 1 iemand nu nog ingeklokt
      ins("clocks", { id: id("clock"), userId: e.id, userName: e.name, clockedIn: iso(d, 7, i * 10), clockedOut: out, status: out ? "out" : "in" });
    });
  }

  // Verlof
  if (emps[0]) ins("leaves", { id: id("leave"), userId: emps[0].id, userName: emps[0].name, type: "vakantie", startDate: day(14), endDate: day(18), days: 5, status: "goedgekeurd", reviewedBy: actor.email, reviewedAt: iso(-3, 10), reason: "Zomervakantie" });
  if (emps[1]) ins("leaves", { id: id("leave"), userId: emps[1].id, userName: emps[1].name, type: "adv", startDate: day(7), endDate: day(7), days: 1, status: "aangevraagd", reason: "Familiedag" });

  // Onkosten
  const expenses = [
    [0, -6, "materiaal", 86.4, "Siliconen + bevestigingsmateriaal Gamma", "ingediend"],
    [1, -4, "vervoer", 23.5, "Parking klant Antwerpen", "ingediend"],
    [0, -15, "materiaal", 312.9, "PVC-buizen en hulpstukken", "goedgekeurd"],
    [2, -11, "maaltijd", 14.2, "Lunch tijdens verplaatsing", "goedgekeurd"],
    [1, -20, "vervoer", 95, "Tankbeurt firmawagen", "geweigerd"],
  ];
  expenses.forEach(([ei, d, category, amount, description, status]) => {
    const e = E(ei);
    ins("expenses", { id: id("exp"), userId: e.id, userName: e.name, date: day(d), category, amount, description, status,
      ...(status !== "ingediend" ? { reviewedBy: actor.email, reviewedAt: iso(d + 2, 9), reviewNote: status === "geweigerd" ? "Privé-tankbeurt, niet vergoedbaar" : "" } : {}) });
  });

  // Stock (1 lage voorraad voor alert)
  [["PVC-buis 50mm", "PVC-50", "Sanitair", 84, "m", 20, 3.2],
   ["Siliconenkit wit", "SIL-W", "Afwerking", 6, "st", 12, 4.85],
   ["Isolatieplaat 10cm", "ISO-10", "Isolatie", 142, "m²", 40, 11.5],
   ["LED-paneel 60x60", "LED-66", "Elektriciteit", 28, "st", 10, 34],
   ["Werkhandschoenen", "HND-M", "PBM", 45, "paar", 15, 2.6],
  ].forEach(([name, sku, category, quantity, unit, minQuantity, unitPrice]) =>
    ins("stock", { id: id("stk"), name, sku, category, quantity, unit, minQuantity, unitPrice }));

  // Voertuigen
  [["Bestelwagen 1", "1-ABC-123", "Ford", "Transit", 0, 84200],
   ["Bestelwagen 2", "2-DEF-456", "Renault", "Trafic", 1, 51800],
  ].forEach(([name, plate, brand, model, ei, mileage]) => {
    const e = E(ei);
    ins("vehicles", { id: id("veh"), name, plate, brand, model, driverId: e.id, driverName: e.name, mileage, active: true });
  });

  // Berichten
  ins("messages", { id: id("msg"), senderName: actor.name || "Beheer", senderId: actor.id, toRole: "all", subject: "Werfvergadering vrijdag", body: "Vrijdag om 16u korte werfvergadering in Gent Zuid. Aanwezigheid gewenst.", readBy: [] });
  ins("messages", { id: id("msg"), senderName: actor.name || "Beheer", senderId: actor.id, toRole: "employee", subject: "Nieuwe PBM beschikbaar", body: "Nieuwe veiligheidshandschoenen liggen klaar in het magazijn.", readBy: [] });

  // Notificaties (via module zodat schema klopt)
  createNotification(store, tenant, { type: "payment", audience: "admins", title: "Factuur betaald", body: "2026-902 (€9.667,20) is betaald.", sourceRef: "demo:seed:1" }, actor);
  createNotification(store, tenant, { type: "leave", audience: "admins", title: "Verlofaanvraag", body: `${E(1).name} vroeg 1 dag ADV aan.`, sourceRef: "demo:seed:2" }, actor);
  counts.notifications = (counts.notifications || 0) + 2;

  store.audit({ actor: actor.email, tenantId, action: "demo_seeded", area: "demo", detail: JSON.stringify(counts) });
  return { cleared, counts };
}

module.exports = { seedDemoData, clearDemoData };
