// Route-smoke E07: werkbon v2 · offline sync + conflict, verplichte formulieren,
// handtekening aan versie, review, correctieboeking, facturatiestrategieën.
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
  const uid = me.data.user.id;

  // Werkbon aanmaken via de bestaande (legacy) route → moet canoniek leesbaar zijn.
  const wo = await j("POST", `/api/tenants/${tid}/workorders`, { title: "Ketel vervangen", date: "2026-07-10", description: "Jaarlijkse beurt" }, tok);
  check("werkbon aangemaakt (legacy-route)", wo.status === 201 && /^WO-/.test(wo.data.workorder.number), wo.data.workorder && wo.data.workorder.number);
  const woId = wo.data.workorder.id;

  const canon = await j("GET", `/api/tenants/${tid}/workorders/${woId}/canonical`, null, tok);
  check("legacy-werkbon canoniek leesbaar (status opgewaardeerd)", canon.status === 200 && canon.data.workorder.status === "draft" && canon.data.workorder.legacyStatus === "open", JSON.stringify({ s: canon.data.workorder?.status, l: canon.data.workorder?.legacyStatus }));

  // v2-velden zetten: uren, materiaal, verplicht formulier
  const v1 = canon.data.workorder.version;
  const fields = await j("PATCH", `/api/tenants/${tid}/workorders/${woId}/fields`, {
    expectedVersion: v1,
    workers: [{ userId: uid, name: "Admin", start: "08:00", end: "17:00", breaks: [{ start: "12:00", end: "12:30" }], costRate: 30, salesRate: 55 }],
    materials: [{ description: "Ketelonderdeel", qty: 1, unitPrice: 200, costPrice: 120 }],
    forms: [{ id: "f1", label: "Gasdichtheid gecontroleerd?", type: "bool", required: true }],
  }, tok);
  check("v2-velden gezet · uren met pauze = 8.5u", fields.status === 200 && fields.data.workorder.workers[0].hours === 8.5, fields.data.workorder?.workers?.[0]?.hours);
  check("totalen: kost en verkoop gescheiden", fields.data.totals?.cost === 375 && fields.data.totals?.sales === 667.5, JSON.stringify(fields.data.totals));

  // Indienen zonder antwoord op verplichte vraag → 400
  const early = await j("POST", `/api/tenants/${tid}/workorders/${woId}/submit`, {}, tok);
  check("verplicht formulier blokkeert indienen → 400", early.status === 400 && early.data.code === "REQUIRED_FORMS_MISSING", early.data.code);

  // Antwoord invullen
  const v2 = fields.data.workorder.version;
  const answered = await j("PATCH", `/api/tenants/${tid}/workorders/${woId}/fields`, {
    expectedVersion: v2,
    forms: [{ id: "f1", label: "Gasdichtheid gecontroleerd?", type: "bool", required: true, answer: true }],
  }, tok);
  check("verplichte vraag beantwoord", answered.status === 200);

  // Handtekening gebonden aan versie
  const signed = await j("POST", `/api/tenants/${tid}/workorders/${woId}/sign`, { by: "Klant Jan", dataRef: "sig_1" }, tok);
  check("handtekening gebonden aan versie + hash", signed.status === 200 && !!signed.data.workorder.signature.boundHash && signed.data.workorder.signature.invalidated === false, signed.data.workorder?.signature?.boundVersion);

  // OFFLINE SYNC CONFLICT: client werkt op oude versie terwijl server wijzigt
  const staleVersion = signed.data.workorder.version;
  await j("PATCH", `/api/tenants/${tid}/workorders/${woId}/fields`, { expectedVersion: staleVersion, description: "Backoffice-aanvulling" }, tok);
  const conflict = await j("POST", `/api/tenants/${tid}/workorders/${woId}/sync`, { baseVersion: staleVersion, patch: { description: "Offline notitie van technieker" }, clientId: "toestel-1" }, tok);
  check("sync-conflict → 409 SYNC_CONFLICT", conflict.status === 409 && conflict.data.code === "SYNC_CONFLICT", conflict.data.code);
  check("conflict geeft serverstaat + clientmutatie terug (geen stille overschrijving)", !!conflict.data.serverState && conflict.data.clientPatch?.description === "Offline notitie van technieker");
  const afterConflict = await j("GET", `/api/tenants/${tid}/workorders/${woId}/canonical`, null, tok);
  check("server behield zijn eigen versie", afterConflict.data.workorder.description === "Backoffice-aanvulling", afterConflict.data.workorder?.description);

  // Sync mét juiste baseVersion lukt
  const good = await j("POST", `/api/tenants/${tid}/workorders/${woId}/sync`, { baseVersion: afterConflict.data.workorder.version, patch: { description: "Samengevoegde notitie" }, clientId: "toestel-1", clientUpdatedAt: "2026-07-10T18:00:00Z" }, tok);
  check("sync met juiste baseVersion slaagt", good.status === 200 && good.data.workorder.description === "Samengevoegde notitie" && good.data.workorder.sync.clientId === "toestel-1");

  // Indienen + review
  const submitted = await j("POST", `/api/tenants/${tid}/workorders/${woId}/submit`, {}, tok);
  check("indienen lukt na beantwoorde vragen", submitted.status === 200 && submitted.data.workorder.status === "submitted", submitted.data.workorder?.status);
  const approved = await j("POST", `/api/tenants/${tid}/workorders/${woId}/review`, { decision: "approve", note: "Akkoord" }, tok);
  check("goedkeuren", approved.status === 200 && approved.data.workorder.status === "approved");

  // Na goedkeuring: rechtstreeks uren wijzigen geblokkeerd
  const frozen = await j("PATCH", `/api/tenants/${tid}/workorders/${woId}/fields`, { workers: [{ userId: uid, start: "08:00", end: "20:00", costRate: 30 }] }, tok);
  check("na goedkeuring geen directe urenwijziging → 409", frozen.status === 409 && frozen.data.code === "CORRECTION_REQUIRED", frozen.data.code);

  // Correctie zonder reden → 400; met reden → 201 en auditbaar
  const noReason = await j("POST", `/api/tenants/${tid}/workorders/${woId}/corrections`, { type: "hours", qty: 2 }, tok);
  check("correctie zonder reden → 400", noReason.status === 400 && noReason.data.code === "REASON_REQUIRED");
  const corr = await j("POST", `/api/tenants/${tid}/workorders/${woId}/corrections`, { type: "hours", targetId: uid, field: "hours", from: 8.5, to: 10.5, qty: 2, reason: "Extra uren nagemeld" }, tok);
  check("correctieboeking auditbaar (reden, tijd, actor)", corr.status === 201 && corr.data.correction.reason === "Extra uren nagemeld" && !!corr.data.correction.at && !!corr.data.correction.by);

  // Facturatiestrategieën
  const detail = await j("GET", `/api/tenants/${tid}/workorders/${woId}/canonical?strategy=detail`, null, tok);
  const grouped = await j("GET", `/api/tenants/${tid}/workorders/${woId}/canonical?strategy=grouped`, null, tok);
  const single = await j("GET", `/api/tenants/${tid}/workorders/${woId}/canonical?strategy=single`, null, tok);
  check("strategie detail geeft aparte regels", (detail.data.invoiceLines || []).length === 2, (detail.data.invoiceLines || []).length);
  check("strategie grouped groepeert arbeid/materiaal", (grouped.data.invoiceLines || []).map(l => l.description).join(",") === "Werkuren,Materiaal", (grouped.data.invoiceLines || []).map(l => l.description).join(","));
  check("strategie single geeft één totaalregel", (single.data.invoiceLines || []).length === 1 && single.data.invoiceLines[0].unitPrice === 667.5, single.data.invoiceLines?.[0]?.unitPrice);
  check("bronallocatie op factuurlijnen", (detail.data.invoiceLines || []).every(l => l.sourceType === "workorder" && l.sourceId === woId));

  // Events
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  const ev = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=workorder.corrected`, null, superTok);
  check("workorder.corrected event", (ev.data.events || []).length >= 1, (ev.data.events || []).length);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
