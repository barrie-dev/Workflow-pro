// Route-smoke h39: formulierdesigner + invulling, taken, bestandsversies met
// geauditeerde download, communicatietijdlijn met snapshot.
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

  // ── Formulierdesigner ──
  const tpl = await j("POST", `/api/tenants/${tid}/forms/templates`, {
    name: "Keuring ketel", appliesTo: ["workorder"],
    sections: [{ title: "Veiligheid", questions: [
      { id: "q1", label: "Gasdichtheid gecontroleerd?", type: "bool", required: true },
      { id: "q2", label: "Rookgasmeting (ppm)", type: "number", required: true },
      { id: "q3", label: "Toestand", type: "choice", options: ["goed", "matig", "slecht"] },
    ] }],
  }, tok);
  check("formuliertemplate aangemaakt (concept)", tpl.status === 201 && tpl.data.template.status === "draft" && tpl.data.template.key === "keuring_ketel", tpl.data.template && tpl.data.template.key);
  const tplId = tpl.data.template.id;

  // Concept is nog niet invulbaar
  const teVroeg = await j("POST", `/api/tenants/${tid}/forms/instances`, { templateId: tplId, context: { entityType: "workorder", entityId: "wo1" } }, tok);
  check("concept-template niet invulbaar → 409", teVroeg.status === 409 && teVroeg.data.code === "NOT_PUBLISHED", teVroeg.data.code);

  await j("POST", `/api/tenants/${tid}/forms/templates/${tplId}/transition`, { status: "published" }, tok);

  // ── Invulling ──
  const inst = await j("POST", `/api/tenants/${tid}/forms/instances`, { templateId: tplId, context: { entityType: "workorder", entityId: "wo1" } }, tok);
  check("invulling gestart met bevroren templateversie", inst.status === 201 && inst.data.instance.templateVersion === 1 && !!inst.data.instance.templateSnapshot, inst.data.instance && inst.data.instance.templateVersion);
  const instId = inst.data.instance.id;

  const teVroegIndienen = await j("POST", `/api/tenants/${tid}/forms/instances/${instId}/submit`, {}, tok);
  check("verplichte vragen blokkeren indienen → 400", teVroegIndienen.status === 400 && teVroegIndienen.data.code === "REQUIRED_MISSING", teVroegIndienen.data.code);
  check("meldt WELKE vragen ontbreken", (teVroegIndienen.data.missing || []).length === 2, (teVroegIndienen.data.missing || []).map(m => m.id).join(","));

  const fout = await j("PATCH", `/api/tenants/${tid}/forms/instances/${instId}`, { answers: { q1: true, q2: 35, q3: "onbekend" } }, tok);
  const foutIndienen = await j("POST", `/api/tenants/${tid}/forms/instances/${instId}/submit`, {}, tok);
  check("ongeldige keuze geweigerd", foutIndienen.status === 400 && foutIndienen.data.code === "INVALID_ANSWERS", foutIndienen.data.code);

  await j("PATCH", `/api/tenants/${tid}/forms/instances/${instId}`, { answers: { q3: "goed" } }, tok);
  const ingediend = await j("POST", `/api/tenants/${tid}/forms/instances/${instId}/submit`, {}, tok);
  check("indienen lukt met geldige antwoorden", ingediend.status === 200 && ingediend.data.instance.status === "submitted", ingediend.data.instance && ingediend.data.instance.status);
  check("antwoorden gestructureerd bewaard", ingediend.data.instance.answers.q2 === 35 && ingediend.data.instance.answers.q1 === true);

  // Template wijzigen raakt de ingediende invulling niet
  await j("PATCH", `/api/tenants/${tid}/forms/templates/${tplId}`, {
    name: "Keuring ketel", sections: [{ title: "Veiligheid", questions: [
      { id: "q1", label: "Gasdichtheid gecontroleerd?", type: "bool", required: true },
      { id: "q2", label: "Rookgasmeting (ppm)", type: "number", required: true },
      { id: "q9", label: "Nieuwe verplichte vraag", type: "bool", required: true },
    ] }],
  }, tok);
  const naWijziging = await j("GET", `/api/tenants/${tid}/forms/instances?entityId=wo1`, null, tok);
  check("ingediende invulling ongewijzigd na templatewijziging", naWijziging.data.instances[0].status === "submitted" && naWijziging.data.instances[0].templateVersion === 1);

  // Filterbaar via de API
  const gefilterd = await j("GET", `/api/tenants/${tid}/forms/instances?entityType=workorder&entityId=wo1&status=submitted`, null, tok);
  check("antwoorden filterbaar via de API", (gefilterd.data.instances || []).length === 1);

  // ── Taken ──
  const zonderContext = await j("POST", `/api/tenants/${tid}/tasks`, { title: "Zonder context" }, tok);
  check("taak zonder primaire context → 400", zonderContext.status === 400 && zonderContext.data.code === "CONTEXT_REQUIRED", zonderContext.data.code);
  const taak = await j("POST", `/api/tenants/${tid}/tasks`, {
    title: "Attest opvragen", type: "compliance", priority: "hoog", dueDate: "2026-01-01",
    context: { entityType: "workorder", entityId: "wo1" },
    relations: [{ entityType: "customer", entityId: "c1" }],
  }, tok);
  check("taak met context en relatie", taak.status === 201 && taak.data.task.context.entityId === "wo1" && taak.data.task.relations.length === 1);
  const dossier = await j("GET", `/api/tenants/${tid}/tasks?entityType=workorder&entityId=wo1`, null, tok);
  check("taak zichtbaar op het dossier", (dossier.data.tasks || []).length === 1);
  const achterstallig = await j("GET", `/api/tenants/${tid}/tasks?overdue=1`, null, tok);
  check("achterstallige taken", (achterstallig.data.tasks || []).length === 1);
  const klaar = await j("POST", `/api/tenants/${tid}/tasks/${taak.data.task.id}/transition`, { status: "in_progress" }, tok);
  check("statusverloop", klaar.status === 200 && klaar.data.task.status === "in_progress");

  // ── Bestanden ──
  const onveilig = await j("POST", `/api/tenants/${tid}/docfiles`, { name: "virus.exe", size: 100 }, tok);
  check("onveilige extensie geweigerd → 400", onveilig.status === 400 && onveilig.data.code === "UNSAFE_EXTENSION", onveilig.data.code);
  const file = await j("POST", `/api/tenants/${tid}/docfiles`, {
    name: "keuringsverslag.pdf", mimeType: "application/pdf", content: Buffer.from("PDF-inhoud van het keuringsverslag v1").toString("base64"), encoding: "base64",
    context: { entityType: "workorder", entityId: "wo1" },
  }, tok);
  check("bestand met versie 1, hash en server-side objectkey", file.status === 201 && file.data.file.currentVersion === 1 && (file.data.file.hash || "").length === 64 && String(file.data.file.storageRef || "").startsWith("t/"));
  const fileId = file.data.file.id;
  const v2 = await j("POST", `/api/tenants/${tid}/docfiles/${fileId}/versions`, { size: 2048 }, tok);
  check("nieuwe versie bewaart de vorige", v2.data.file.currentVersion === 2 && v2.data.file.versions.length === 2 && v2.data.file.versions[0].size > 0);
  const dl = await j("POST", `/api/tenants/${tid}/docfiles/${fileId}/download`, {}, tok);
  check("download geregistreerd op de huidige versie", dl.status === 200 && dl.data.download.version === 2, dl.data.download && dl.data.download.version);
  const dl1 = await j("POST", `/api/tenants/${tid}/docfiles/${fileId}/download?version=1`, {}, tok);
  check("download van een oude versie kan en wordt geaudit", dl1.data.download.version === 1);
  const files = await j("GET", `/api/tenants/${tid}/docfiles?entityId=wo1`, null, tok);
  check("downloadhistoriek bewaard", (files.data.files[0].downloads || []).length === 2, (files.data.files[0].downloads || []).length);

  // ── Communicatie ──
  const comm = await j("POST", `/api/tenants/${tid}/communications`, {
    channel: "email", context: { entityType: "workorder", entityId: "wo1" },
    to: ["klant@x.be"], cc: ["backoffice@x.be"], subject: "Keuringsverslag",
    body: "In bijlage het verslag.", templateKey: "wo_report", templateVersion: 2,
    attachments: [{ fileId, name: "keuringsverslag.pdf", version: 2 }],
  }, tok);
  check("communicatie vastgelegd als snapshot", comm.status === 201 && comm.data.communication.template.key === "wo_report" && comm.data.communication.attachments[0].version === 2);
  const tijdlijn = await j("GET", `/api/tenants/${tid}/communications?entityType=workorder&entityId=wo1`, null, tok);
  check("zichtbaar op de dossier-tijdlijn", (tijdlijn.data.communications || []).length === 1 && tijdlijn.data.communications[0].to[0] === "klant@x.be");

  // Events
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  const ev = await j("GET", `/api/admin/events?tenantId=${tid}&eventType=form.submitted`, null, superTok);
  check("form.submitted event", (ev.data.events || []).length >= 1, (ev.data.events || []).length);

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
