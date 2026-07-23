// ── CTO3-04 · scenario 3 als ÉÉN doorlopende keten ──────────────────────────
// Offline werkbon → materiaalverbruik → klantbewijs/handtekening → DUBBEL
// queue-item. Bewijst als één verhaal: exact één domeinmutatie bij een herhaald
// offline-commando (idempotentie), correcte audit, negatieve autorisatie en
// duurzame teruglezing. Alle IDs komen uit serverresponses; niets gefabriceerd.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
async function activeEmp(tok, tid, name, email) {
  const c = await j("POST", `/api/tenants/${tid}/employees`, { name, email }, tok);
  const t = decodeURIComponent((c.data.activationLink || "").split("activate=")[1] || "");
  await j("POST", "/api/auth/activate", { token: t, password: "Sterk2026!Wachtwoord" });
  const login = await j("POST", "/api/auth/login", { email, password: "Sterk2026!Wachtwoord" });
  return { id: c.data.user.id, token: login.data.token };
}

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const me = await j("GET", "/api/me", null, tok);
  const tid = me.data.user.tenantId, uid = me.data.user.id;

  // ── 1. Werkbon (offline aangemaakt) · serverrespons levert het WO-nummer ─────
  const wo = await j("POST", `/api/tenants/${tid}/workorders`, { title: "Offline ketelbeurt", date: "2026-09-01", description: "Jaarlijkse controle" }, tok);
  check("1· werkbon aangemaakt (WO-nummer)", wo.status === 201 && /^WO-/.test(wo.data.workorder.number), wo.data.workorder && wo.data.workorder.number);
  const woId = wo.data.workorder.id;

  // ── 2. Uren + MATERIAALVERBRUIK + verplicht klantformulier ───────────────────
  let canon = await j("GET", `/api/tenants/${tid}/workorders/${woId}/canonical`, null, tok);
  const set = await j("PATCH", `/api/tenants/${tid}/workorders/${woId}/fields`, {
    expectedVersion: canon.data.workorder.version,
    workers: [{ userId: uid, name: "Tech", start: "08:00", end: "12:00", costRate: 30, salesRate: 55 }],
    materials: [{ description: "Ketelonderdeel", qty: 2, unitPrice: 150, costPrice: 90 }],
    forms: [{ id: "f1", label: "Gasdichtheid gecontroleerd?", type: "bool", required: true }],
  }, tok);
  check("2· uren + materiaalverbruik met gescheiden kost/verkoop", set.status === 200 && set.data.totals.cost > 0 && set.data.totals.sales > set.data.totals.cost, JSON.stringify(set.data.totals));

  // ── 3. Offline queue-item met commandId · toegepast, versie omhoog ───────────
  const cmd = { baseVersion: set.data.workorder.version, patch: { description: "Ter plaatse: filter vervangen" }, clientId: "toestel-9", commandId: "q-100" };
  const s1 = await j("POST", `/api/tenants/${tid}/workorders/${woId}/sync`, cmd, tok);
  check("3· offline sync toegepast (geen replay)", s1.status === 200 && !s1.data.replayed, s1.status);
  const vAfterSync = s1.data.workorder.version;

  // ── 4. DUBBEL QUEUE-ITEM: exact hetzelfde commando → exact één domeinmutatie ──
  const s2 = await j("POST", `/api/tenants/${tid}/workorders/${woId}/sync`, cmd, tok);
  check("4a· dubbel queue-item → replay (geen conflict)", s2.status === 200 && s2.data.replayed === true, JSON.stringify({ s: s2.status, r: s2.data.replayed }));
  check("4b· exact één domeinmutatie: versie ongewijzigd na replay", s2.data.workorder.version === vAfterSync, `${vAfterSync} == ${s2.data.workorder.version}`);
  check("4c· inhoud ongewijzigd na replay", s2.data.workorder.description === "Ter plaatse: filter vervangen");

  // ── 5. Klantbewijs: verplichte vraag beantwoorden + handtekening aan versie ──
  canon = await j("GET", `/api/tenants/${tid}/workorders/${woId}/canonical`, null, tok);
  await j("PATCH", `/api/tenants/${tid}/workorders/${woId}/fields`, { expectedVersion: canon.data.workorder.version, forms: [{ id: "f1", label: "Gasdichtheid gecontroleerd?", type: "bool", required: true, answer: true }] }, tok);
  const sign = await j("POST", `/api/tenants/${tid}/workorders/${woId}/sign`, { by: "Klant Jan", dataRef: "sig_offline" }, tok);
  check("5· handtekening gebonden aan versie (klantbewijs)", sign.status === 200 && sign.data.workorder.signature.invalidated === false && !!sign.data.workorder.signature.boundHash);

  // ── 6. Indienen + goedkeuren ─────────────────────────────────────────────────
  const sub = await j("POST", `/api/tenants/${tid}/workorders/${woId}/submit`, {}, tok);
  const appr = await j("POST", `/api/tenants/${tid}/workorders/${woId}/review`, { decision: "approve", note: "Akkoord" }, tok);
  check("6· ingediend + goedgekeurd", sub.status === 200 && appr.status === 200 && appr.data.workorder.status === "approved", appr.data.workorder && appr.data.workorder.status);

  // ── 7. NEGATIEVE AUTORISATIE: gewone medewerker raakt geen beheerdersdata ────
  // De werkbon-module is toegankelijk voor veldpersoneel (own:workorders), dus de
  // scherpe privilegegrens ligt bij BEHEERdersdata · de medewerkerslijst (met
  // kostvelden) is enkel voor een recht dat een gewone medewerker niet heeft.
  const emp = await activeEmp(tok, tid, "Wim Werker", "wim.wo@x.be");
  const denied = await j("GET", `/api/tenants/${tid}/employees`, null, emp.token);
  check("7· medewerker zonder beheerrecht → medewerkerslijst geweigerd (403)", denied.status === 403, denied.status);

  // ── 8. AUDIT: de keten liet echte domeingebeurtenissen na ───────────────────
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  const evSigned = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=workorder.signed`, null, superTok);
  const evSynced = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=workorder.synced`, null, superTok);
  check("8· audit: workorder.signed + workorder.synced geregistreerd", (evSigned.data.events || []).length >= 1 && (evSynced.data.events || []).length >= 1, `signed=${(evSigned.data.events || []).length} synced=${(evSynced.data.events || []).length}`);

  // ── 9. DUURZAME TERUGLEZING: de mutatie staat in de store, niet enkel in de respons ─
  const back = await j("GET", `/api/tenants/${tid}/workorders/${woId}/canonical?strategy=detail`, null, tok);
  check("9· teruggelezen werkbon: goedgekeurd, handtekening + factureerbare materiaalregel", back.data.workorder.status === "approved" && !!back.data.workorder.signature && (back.data.invoiceLines || []).some(l => l.sourceType === "workorder"), back.data.workorder && back.data.workorder.status);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
