"use strict";
// Taken, formulieren, bestanden en communicatie (master-spec h39/DOC):
// gestructureerde antwoorden, verplichte vragen, bevroren templateversie,
// bestandsversies met geauditeerde downloads, verzonden snapshot.
const { test } = require("node:test");
const assert = require("node:assert");

const {
  validateAnswers, renderTemplate, normalizeFileMeta, allQuestions,
  makeFormTemplateRepository, makeFormInstanceRepository, makeTaskRepository,
  makeFileRepository, makeCommunicationRepository, MAX_FILE_BYTES,
} = require("../src/platform/work-os");

function fakeStore(data = {}) {
  const d = { formTemplates: [], formInstances: [], tasks: [], files: [], communications: [], ...data };
  return {
    data: d,
    list(col, tid) { const r = d[col] || []; return tid == null ? r : r.filter(x => x.tenantId === tid); },
    get(col, id) { return (d[col] || []).find(x => x.id === id); },
    insert(col, row) { (d[col] = d[col] || []).push(row); return row; },
    update(col, id, patch) { d[col] = (d[col] || []).map(x => x.id === id ? { ...x, ...patch } : x); return (d[col] || []).find(x => x.id === id); },
    remove(col, id) { d[col] = (d[col] || []).filter(x => x.id !== id); },
    save() {},
  };
}

const KEURING = {
  name: "Keuring ketel",
  appliesTo: ["workorder"],
  sections: [{
    title: "Veiligheid",
    questions: [
      { id: "q1", label: "Gasdichtheid gecontroleerd?", type: "bool", required: true },
      { id: "q2", label: "Rookgasmeting (ppm)", type: "number", required: true },
      { id: "q3", label: "Toestand", type: "choice", options: ["goed", "matig", "slecht"], required: false },
      { id: "q4", label: "Opmerkingen", type: "text", required: false },
    ],
  }],
};

function seedForms() {
  const store = fakeStore();
  const templates = makeFormTemplateRepository(store);
  const instances = makeFormInstanceRepository(store, templates);
  const tpl = templates.insert("t1", KEURING, "beheer@x.be");
  templates.transition("t1", tpl.id, "published", "beheer@x.be");
  return { store, templates, instances, tpl: templates.findById("t1", tpl.id) };
}

test("formulier: designer valideert vragen en keuzeopties", () => {
  const store = fakeStore();
  const repo = makeFormTemplateRepository(store);
  assert.throws(() => repo.insert("t1", { name: "Leeg", sections: [] }, "x"), /sectie met vragen|NO_QUESTIONS/);
  assert.throws(() => repo.insert("t1", { name: "Fout", sections: [{ title: "S", questions: [{ label: "Keuze", type: "choice" }] }] }, "x"), /keuzeopties|OPTIONS_REQUIRED/);
  const tpl = repo.insert("t1", KEURING, "x");
  assert.equal(allQuestions(tpl).length, 4);
  assert.equal(tpl.status, "draft");
  assert.equal(tpl.key, "keuring_ketel");
});

test("formulier: verplichte vragen blokkeren indienen (ook offline afdwingbaar)", () => {
  const { instances, tpl } = seedForms();
  const inst = instances.start("t1", { templateId: tpl.id, context: { entityType: "workorder", entityId: "wo1" } }, "tech@x.be");
  assert.equal(inst.status, "draft");
  // validateAnswers is puur → dezelfde regels gelden offline op het toestel.
  const leeg = validateAnswers(tpl, {});
  assert.equal(leeg.ok, false);
  assert.equal(leeg.missing.length, 2);
  assert.throws(() => instances.submit("t1", inst.id, "tech@x.be"), e => e.code === "REQUIRED_MISSING");

  instances.saveAnswers("t1", inst.id, { q1: true, q2: 35 }, "tech@x.be");
  assert.equal(instances.findById("t1", inst.id).status, "filled");
  const submitted = instances.submit("t1", inst.id, "tech@x.be");
  assert.equal(submitted.status, "submitted");
  assert.ok(submitted.submittedAt);
});

test("formulier: typefouten worden geweigerd met reden", () => {
  const { tpl } = seedForms();
  const check = validateAnswers(tpl, { q1: "ja", q2: "veel", q3: "onbekend" });
  assert.equal(check.ok, false);
  assert.equal(check.invalid.length, 3);
  assert.ok(check.invalid.some(i => i.id === "q1" && /ja of nee/.test(i.reason)));
  assert.ok(check.invalid.some(i => i.id === "q2" && /geldig getal/i.test(i.reason)));
  assert.ok(check.invalid.some(i => i.id === "q3" && /Onbekende keuze/.test(i.reason)));
  // Correcte waarden slagen wel.
  assert.equal(validateAnswers(tpl, { q1: false, q2: 0, q3: "goed" }).ok, true);
});

test("formulier: antwoorden zijn gestructureerd en filterbaar via de API", () => {
  const { instances, tpl } = seedForms();
  const a = instances.start("t1", { templateId: tpl.id, context: { entityType: "workorder", entityId: "wo1" } }, "tech@x.be");
  instances.saveAnswers("t1", a.id, { q1: true, q2: 35, q3: "goed" }, "tech@x.be");
  const b = instances.start("t1", { templateId: tpl.id, context: { entityType: "workorder", entityId: "wo2" } }, "tech@x.be");
  instances.saveAnswers("t1", b.id, { q1: false, q2: 120, q3: "slecht" }, "tech@x.be");

  // Antwoorden staan als data, niet als PDF-blob.
  const opgeslagen = instances.findById("t1", a.id);
  assert.equal(opgeslagen.answers.q2, 35);
  assert.equal(typeof opgeslagen.answers.q1, "boolean");
  // Filterbaar op context.
  assert.equal(instances.list("t1", { entityType: "workorder", entityId: "wo2" }).length, 1);
  // En dus ook op antwoordwaarde door de aanroeper.
  const slecht = instances.list("t1", {}).filter(i => i.answers.q3 === "slecht");
  assert.equal(slecht.length, 1);
  assert.equal(slecht[0].id, b.id);
});

test("formulier: een gewijzigde template verandert een bestaande invulling niet", () => {
  const { templates, instances, tpl } = seedForms();
  const inst = instances.start("t1", { templateId: tpl.id, context: { entityType: "workorder", entityId: "wo1" } }, "tech@x.be");
  assert.equal(inst.templateVersion, tpl.version);

  // Template krijgt een extra verplichte vraag.
  templates.update("t1", tpl.id, {
    ...KEURING,
    sections: [{ ...KEURING.sections[0], questions: [...KEURING.sections[0].questions, { id: "q5", label: "Extra keuring", type: "bool", required: true }] }],
  }, "beheer@x.be");
  assert.equal(templates.findById("t1", tpl.id).version, tpl.version + 1);

  // De lopende invulling draagt de BEVROREN definitie: q5 blokkeert haar niet.
  instances.saveAnswers("t1", inst.id, { q1: true, q2: 20 }, "tech@x.be");
  const submitted = instances.submit("t1", inst.id, "tech@x.be");
  assert.equal(submitted.status, "submitted");
  assert.equal(allQuestions(submitted.templateSnapshot).length, 4, "snapshot bevat de oude 4 vragen");
});

test("formulier: ingediend formulier is niet meer wijzigbaar; vergrendelen kan", () => {
  const { instances, tpl } = seedForms();
  const inst = instances.start("t1", { templateId: tpl.id, context: { entityType: "workorder", entityId: "wo1" } }, "tech@x.be");
  instances.saveAnswers("t1", inst.id, { q1: true, q2: 10 }, "tech@x.be");
  instances.submit("t1", inst.id, "tech@x.be");
  assert.throws(() => instances.saveAnswers("t1", inst.id, { q4: "alsnog" }, "tech@x.be"), e => e.code === "FORM_LOCKED");
  const locked = instances.lock("t1", inst.id, "beheer@x.be");
  assert.equal(locked.status, "locked");
});

test("formulier: foto blijft zowel gestructureerd als bestand beschikbaar", () => {
  const { instances, tpl } = seedForms();
  const inst = instances.start("t1", { templateId: tpl.id, context: { entityType: "workorder", entityId: "wo1" } }, "tech@x.be");
  const met = instances.attachPhoto("t1", inst.id, { questionId: "q4", fileId: "file_123" }, "tech@x.be");
  assert.equal(met.photos.length, 1, "als bestandsverwijzing");
  assert.deepEqual(met.answers.q4, ["file_123"], "en als gestructureerd antwoord");
});

test("formulier: enkel gepubliceerde templates zijn invulbaar", () => {
  const store = fakeStore();
  const templates = makeFormTemplateRepository(store);
  const instances = makeFormInstanceRepository(store, templates);
  const concept = templates.insert("t1", KEURING, "x");
  assert.throws(() => instances.start("t1", { templateId: concept.id, context: { entityType: "workorder", entityId: "w" } }, "x"), e => e.code === "NOT_PUBLISHED");
});

test("taak: één primaire context, optionele relaties, en statusverloop", () => {
  const store = fakeStore();
  const repo = makeTaskRepository(store);
  assert.throws(() => repo.insert("t1", { title: "Zonder context" }, "x"), e => e.code === "CONTEXT_REQUIRED");
  const task = repo.insert("t1", {
    title: "Attest opvragen", type: "compliance", priority: "hoog", dueDate: "2026-08-01",
    context: { entityType: "project", entityId: "p1" },
    relations: [{ entityType: "customer", entityId: "c1" }, { entityType: "", entityId: "" }],
    assigneeId: "u2",
  }, "pl@x.be");
  assert.deepEqual(task.context, { entityType: "project", entityId: "p1" });
  assert.equal(task.relations.length, 1, "lege relaties worden genegeerd");
  assert.equal(task.status, "open");

  assert.throws(() => repo.transition("t1", task.id, "done_wrong", "x"), e => e.code === "INVALID_TRANSITION");
  repo.transition("t1", task.id, "in_progress", "u2");
  const done = repo.transition("t1", task.id, "done", "u2");
  assert.equal(done.status, "done");
  assert.ok(done.completedAt);
});

test("taak: persoonlijke en teamoverzichten, plus achterstallige taken", () => {
  const store = fakeStore();
  const repo = makeTaskRepository(store);
  repo.insert("t1", { title: "Mijn taak", context: { entityType: "project", entityId: "p1" }, assigneeId: "u2", dueDate: "2026-07-01" }, "x");
  repo.insert("t1", { title: "Teamtaak", context: { entityType: "project", entityId: "p1" }, teamId: "noord", dueDate: "2026-12-01" }, "x");
  repo.insert("t1", { title: "Andermans", context: { entityType: "project", entityId: "p2" }, assigneeId: "u9" }, "x");

  assert.equal(repo.list("t1", { assigneeId: "u2" }).length, 1, "persoonlijk overzicht");
  assert.equal(repo.list("t1", { teamId: "noord" }).length, 1, "teamoverzicht");
  assert.equal(repo.list("t1", { entityId: "p1" }).length, 2, "dossieroverzicht");
  const overdue = repo.list("t1", { overdueOn: "2026-07-18" });
  assert.equal(overdue.length, 1);
  assert.equal(overdue[0].title, "Mijn taak");
});

test("bestand: versies, hash en grootte; onveilige extensie en te groot geweigerd", () => {
  const store = fakeStore();
  const repo = makeFileRepository(store);
  assert.throws(() => normalizeFileMeta({ name: "virus.exe", size: 10 }), e => e.code === "UNSAFE_EXTENSION");
  assert.throws(() => normalizeFileMeta({ name: "groot.pdf", size: MAX_FILE_BYTES + 1 }), e => e.code === "FILE_TOO_LARGE");

  const file = repo.insert("t1", {
    name: "keuringsverslag.pdf", mimeType: "application/pdf", size: 1024, storageRef: "s3://a",
    context: { entityType: "workorder", entityId: "wo1" },
  }, "tech@x.be");
  assert.equal(file.currentVersion, 1);
  assert.equal(file.versions.length, 1);
  assert.ok(file.hash && file.hash.length === 64, "inhoudshash aanwezig");

  const v2 = repo.addVersion("t1", file.id, { size: 2048, storageRef: "s3://b" }, "backoffice@x.be");
  assert.equal(v2.currentVersion, 2);
  assert.equal(v2.versions.length, 2, "vorige versie blijft bewaard");
  assert.equal(v2.versions[0].size, 1024);
  assert.equal(v2.size, 2048);
  assert.notEqual(v2.versions[0].hash, v2.versions[1].hash, "elke versie heeft een eigen hash");
});

test("bestand: downloads worden geaudit per versie", () => {
  const store = fakeStore();
  const repo = makeFileRepository(store);
  const file = repo.insert("t1", { name: "plan.pdf", size: 100, storageRef: "s3://a" }, "x");
  repo.addVersion("t1", file.id, { size: 200, storageRef: "s3://b" }, "x");

  const d1 = repo.recordDownload("t1", file.id, { actor: "klant@x.be", ip: "1.2.3.4" });
  assert.equal(d1.version, 2, "standaard de huidige versie");
  const d2 = repo.recordDownload("t1", file.id, { version: 1, actor: "audit@x.be" });
  assert.equal(d2.version, 1);
  const after = repo.findById("t1", file.id);
  assert.equal(after.downloads.length, 2);
  assert.equal(after.downloads[0].by, "klant@x.be");
  assert.throws(() => repo.recordDownload("t1", file.id, { version: 9 }), e => e.code === "VERSION_NOT_FOUND");
});

test("communicatie: verzonden snapshot bewaart ontvangers, bijlagen en template", () => {
  const store = fakeStore();
  const repo = makeCommunicationRepository(store);
  assert.throws(() => repo.record("t1", { to: [], subject: "X" }, "x"), e => e.code === "NO_RECIPIENTS");
  const sent = repo.record("t1", {
    channel: "email",
    context: { entityType: "invoice", entityId: "i1" },
    to: ["klant@x.be"], cc: ["boekhouding@x.be"],
    subject: "Factuur 2026-001",
    body: "Beste Jan, in bijlage uw factuur.",
    templateKey: "invoice_send", templateVersion: 3,
    attachments: [{ fileId: "file_1", name: "factuur.pdf", version: 2 }],
  }, "admin@x.be");

  assert.deepEqual(sent.to, ["klant@x.be"]);
  assert.deepEqual(sent.cc, ["boekhouding@x.be"]);
  assert.equal(sent.template.key, "invoice_send");
  assert.equal(sent.template.version, 3, "welke templateversie gebruikt is");
  assert.equal(sent.attachments[0].version, 2, "welke bestandsversie meeging");
  assert.ok(sent.sentAt);
  assert.equal(repo.list("t1", { entityType: "invoice", entityId: "i1" }).length, 1, "zichtbaar op de tijdlijn van het dossier");
});

test("communicatie: vervangingscodes zijn veilig en niet-recursief", () => {
  const r = renderTemplate("Beste {{klant.naam}}, uw factuur {{factuur.nummer}} van {{bedrag}}.", {
    "klant.naam": "Jan", "factuur.nummer": "2026-001", bedrag: "€ 1.210",
  });
  assert.equal(r.text, "Beste Jan, uw factuur 2026-001 van € 1.210.");
  assert.deepEqual(r.used.sort(), ["bedrag", "factuur.nummer", "klant.naam"]);

  // Onbekende code blijft zichtbaar staan in plaats van stil te verdwijnen.
  const onbekend = renderTemplate("Hallo {{niet.bestaand}}", {});
  assert.equal(onbekend.text, "Hallo {{niet.bestaand}}");
  assert.deepEqual(onbekend.unknown, ["niet.bestaand"]);

  // Een waarde die zelf op een code lijkt wordt NIET opnieuw vervangen.
  const injectie = renderTemplate("Hallo {{naam}}", { naam: "{{geheim}}", geheim: "MAG NIET" });
  assert.equal(injectie.text, "Hallo {{geheim}}");
  assert.ok(!/MAG NIET/.test(injectie.text));
});
