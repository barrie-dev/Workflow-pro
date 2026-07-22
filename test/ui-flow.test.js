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
  assert.match(source, /id="custNewQuote"/);
  assert.match(source, /openOfferteDrawer\(null, \{/);
  assert.match(source, /if \(created\.customer\?\.id\) renderCustomerDetail/);
});

test("admin: onboarding is een korte flow met logische vervolgstappen", () => {
  const source = read("public/js/platforms/admin.js");
  for (const step of ["1", "2", "3"]) assert.match(source, new RegExp(`data-ob-step=\\"${step}\\"`));
  assert.match(source, /validateObStep/);
  assert.match(source, /admObLaunchCustomer/);
  assert.match(source, /admObLaunchTeam/);
  assert.match(source, /admObLaunchOverview/);
  assert.match(source, /openCustomerDrawer\(null\)/);
  assert.match(source, /switchView\("employees"\)/);
});

test("admin: snelle acties openen de bedoelde aanmaakflow", () => {
  const source = read("public/js/platforms/admin.js");
  assert.match(source, /data-quick-click="admAddShift"/);
  assert.match(source, /data-quick-click="admNewWO"/);
  assert.match(source, /data-quick-drawer="customer"/);
  assert.match(source, /Na het aanmaken meteen inplannen/);
  assert.match(source, /adm-operations-board/);
});

test("admin: actiecentrum bundelt dagelijkse uitzonderingen in een logische flow", () => {
  const source = read("public/js/platforms/admin.js");
  const css = read("public/css/admin.css");
  assert.match(source, /data-view="actions"/);
  assert.match(source, /id="admActionBadge"/);
  assert.match(source, /const CORE_UI_VIEWS = new Set\(\["dashboard", "actions", "workos", "profielen"\]\)/);
  assert.match(source, /async function renderActionCenter\(\)/);
  for (const endpoint of ["/notifications", "/leaves?status=aangevraagd", "/expenses", "/facturen", "/workorders"]) {
    assert.match(source, new RegExp(endpoint.replace(/[?]/g, "\\?")));
  }
  for (const filter of ["all", "critical", "approvals", "finance", "operations"]) {
    assert.match(source, new RegExp(`\\["${filter}",`));
  }
  assert.match(source, /actions\.next/);
  assert.match(source, /data-action-view/);
  assert.match(source, /data-action-read/);
  assert.match(source, /actions: renderActionCenter/);
  assert.match(css, /\.adm-action-center/);
  assert.match(css, /\.adm-action-stats/);
  assert.match(css, /@media \(max-width:520px\)[\s\S]*\.adm-action-row/);
});

test("admin: de getoonde globale zoeksneltoets werkt echt", () => {
  const source = read("public/js/platforms/admin.js");
  assert.match(source, /\(e\.metaKey \|\| e\.ctrlKey\) && e\.key\.toLowerCase\(\) === "k"/);
  assert.match(source, /e\.preventDefault\(\);\s*input\.focus\(\);\s*input\.select\(\)/);
});

test("admin: documentregels en submits zijn mobiel en dubbelklikveilig", () => {
  const source = read("public/js/platforms/admin.js");
  const css = read("public/css/admin.css");
  assert.match(source, /q-line-row adm-document-line/);
  assert.match(source, /inv-line-row adm-document-line/);
  assert.match(source, /submitButton\.disabled=true/);
  assert.match(source, /submitButton\.disabled = true/);
  assert.match(css, /\.adm-document-line/);
  assert.match(css, /max-width:560px/);
});

test("admin: planning ondersteunt week, dag en capaciteit zonder vaste klantvoortgangslijn", () => {
  const source = read("public/js/platforms/admin.js");
  const css = read("public/css/admin.css");
  for (const mode of ["week", "day", "capacity"]) {
    assert.match(source, new RegExp(`data-planning-mode=\\"${mode}\\"`));
  }
  assert.match(source, /renderPlanningCapacity\(shifts, visibleEmployees, leaveMap, from\)/);
  assert.match(css, /\.adm-flow-line\s*\{\s*display:\s*none/);
});

test("employee: werkbon afronden vraagt uitvoering en ondersteunt klantbevestiging", () => {
  const source = read("public/js/platforms/employee.js");
  assert.match(source, /woCompletionNote/);
  assert.match(source, /woCompletionMaterials/);
  assert.match(source, /woCustomerConfirmed/);
  assert.match(source, /\/mobile\/workorders\/\$\{wo\.id\}\/signature/);
  assert.match(source, /completionNote: completionText/);
  assert.match(source, /wo\.completionNote\|\|wo\.mobileNote/);
  assert.match(source, /Beschrijf kort welke werkzaamheden werden uitgevoerd/);
});

test("manager: dagstart stuurt naar de vier dagelijkse uitzonderingsflows", () => {
  const source = read("public/js/platforms/manager.js");
  for (const view of ["planning", "workorders", "leaves", "expenses"]) {
    assert.match(source, new RegExp(`data-focus-view=\\"${view}\\"`));
  }
});

test("rolomgevingen gebruiken dezelfde goedgekeurde compacte workspace", () => {
  const markers = [
    ["public/js/platforms/manager.js", "Monargo Workspace · manager"],
    ["public/js/platforms/employee.js", "Monargo Workspace · medewerker"],
    ["public/js/platforms/reseller.js", "Monargo Workspace · reseller"],
    ["public/js/platforms/superadmin.js", "Monargo Workspace · superadmin"]
  ];
  for (const [file, marker] of markers) assert.match(read(file), new RegExp(marker));
});


test("admin: golden flow bewaart domeinkoppelingen tussen klant, werkbon, planning en factuur", () => {
  const source = read("public/js/platforms/admin.js");
  assert.match(source, /customerId: customer\.id,[\s\S]{0,180}prefillCustomerName: customer\.name/);
  assert.match(source, /const savedWorkorder = saved\.workorder \|\| saved\.row \|\| workorder \|\| null/);
  assert.match(source, /workorderId: savedWorkorder\?\.id \|\| ""/);
  assert.match(source, /name="workorderId" value="\$\{esc\(shift\?\.workorderId \|\| prefill\.workorderId \|\| ""\)\}"/);
  assert.match(source, /api\("POST", `\/workorders\/\$\{workorder\.id\}\/invoice`, \{\}\)/);
  assert.match(source, /\(invoice\?\.customerId \|\| prefill\.customerId\)===c\.id/);
});
