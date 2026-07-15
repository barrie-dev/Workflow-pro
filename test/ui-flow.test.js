const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("admin: klanttraject is zichtbaar en navigeerbaar", () => {
  const source = read("public/js/platforms/admin.js");
  for (const step of ["customers", "offertes", "planning", "workorders", "facturen"]) {
    assert.match(source, new RegExp(`view:\\"${step}\\"`));
  }
  assert.match(source, /Van aanvraag tot betaling/);
  assert.match(source, /data-flow-view/);
});

test("admin: snelle acties openen de bedoelde aanmaakflow", () => {
  const source = read("public/js/platforms/admin.js");
  assert.match(source, /data-quick-click="admAddShift"/);
  assert.match(source, /data-quick-click="admNewWO"/);
  assert.match(source, /data-quick-drawer="customer"/);
  assert.match(source, /Na het aanmaken meteen inplannen/);
});

test("employee: werkbon afronden vraagt uitvoering en ondersteunt klantbevestiging", () => {
  const source = read("public/js/platforms/employee.js");
  assert.match(source, /woCompletionNote/);
  assert.match(source, /woCompletionMaterials/);
  assert.match(source, /woCustomerConfirmed/);
  assert.match(source, /signatureAt/);
  assert.match(source, /Beschrijf kort welke werkzaamheden werden uitgevoerd/);
});

test("manager: dagstart stuurt naar de vier dagelijkse uitzonderingsflows", () => {
  const source = read("public/js/platforms/manager.js");
  for (const view of ["planning", "workorders", "leaves", "expenses"]) {
    assert.match(source, new RegExp(`data-focus-view=\\"${view}\\"`));
  }
});
