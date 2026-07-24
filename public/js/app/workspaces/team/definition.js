/* ============================================================
   IA-12 · Teamdomein (IA handover §7/§8)

   Contract: "People, time, leave, expenses and safety."
   Acceptatie: "Manager scope tests; approval SoD; sensitive-field
   redaction."

   Dit is het gevoeligste domein van het platform. Drie regels.

   1. SCOPE. Een manager ziet zijn team, niet de hele organisatie. Dat is
      geen weergavefilter maar een grens: wat buiten je scope valt bestaat
      voor jou niet, ook niet via een deeplink of een export.

   2. FUNCTIESCHEIDING (SoD). Je keurt je eigen aanvraag niet goed, en je
      keurt de aanvraag van je eigen leidinggevende niet goed. Het eerste
      is evident, het tweede minder: wie de verlofaanvraag van zijn baas
      mag goedkeuren, staat onder druk om dat te doen.

   3. GEVOELIGE VELDEN. Rijksregisternummer, loon, kosttarief, bankrekening
      en medische gegevens zijn GEEN gewone velden. Ze hangen aan een eigen
      recht, niet aan "mag medewerkers zien". Een teamleider die de planning
      maakt hoort geen loon te zien.

   De echte afdwinging staat serverzijdig. Dit bestand maakt de regels
   toetsbaar en zorgt dat de UI niets toont wat de API zou weigeren · en
   nergens andersom (D-07 rechtenpariteit).
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) { root.wfpWorkspaces = root.wfpWorkspaces || {}; root.wfpWorkspaces.team = api; }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const DEFINITION = {
    id: "team.employees",
    recordBase: "/app/team/employees",
    idParam: "employeeId",
    defaultTab: "overview",
    tabs: [
      { id: "overview", labelKey: "employee.tab.overview", permission: "employees.view" },
      { id: "time", labelKey: "employee.tab.time", permission: "time.view", countSource: "employee.time" },
      { id: "leave", labelKey: "employee.tab.leave", permission: "leaves.view", countSource: "employee.leave" },
      { id: "expenses", labelKey: "employee.tab.expenses", permission: "expenses.view", countSource: "employee.expenses" },
      { id: "skills", labelKey: "employee.tab.skills", permission: "employees.view", countSource: "employee.skills" },
      { id: "safety", labelKey: "employee.tab.safety", permission: "employees.view", countSource: "employee.safety" },
      // Contract en loon zitten achter een EIGEN recht, niet achter employees.view.
      { id: "contract", labelKey: "employee.tab.contract", permission: "employees.hr" },
      { id: "activity", labelKey: "employee.tab.activity", permission: "employees.view" },
    ],
  };

  /**
   * Gevoelige velden per klasse, met het recht dat elke klasse ontsluit.
   * De klassen komen overeen met de backend-dataklassen (reseller-authz),
   * zodat UI, API en export dezelfde taal spreken.
   */
  const SENSITIVE_FIELDS = {
    national_number: { fields: ["nationalNumber", "rijksregisternummer", "ssn"], permission: "employees.hr" },
    payroll: { fields: ["salary", "grossSalary", "hourlyWage", "costRate", "payrollNumber"], permission: "costs.view" },
    bank: { fields: ["iban", "bic", "bankAccount"], permission: "employees.hr" },
    medical: { fields: ["medicalNotes", "workAccidentDetails", "disability"], permission: "employees.hr" },
  };

  function heeft(ctx, recht) {
    const p = (ctx && ctx.permissions) || [];
    return p.includes("*") || p.includes(recht);
  }

  /** Welke gevoelige klassen mag deze gebruiker zien? */
  function allowedClasses(ctx) {
    return Object.keys(SENSITIVE_FIELDS).filter(k => heeft(ctx, SENSITIVE_FIELDS[k].permission));
  }

  /**
   * Verwijder gevoelige velden waar geen recht op is.
   *
   * Het veld wordt WEGGELATEN, niet op null gezet: een veld met de waarde
   * null vertelt nog steeds dat het bestaat, en een leeg loonveld naast een
   * gevuld loonveld verraadt wie er meer verdient.
   */
  function redact(employee, ctx) {
    const toegestaan = new Set(allowedClasses(ctx));
    const uit = {};
    const verboden = new Set();
    for (const [klasse, def] of Object.entries(SENSITIVE_FIELDS)) {
      if (!toegestaan.has(klasse)) for (const f of def.fields) verboden.add(f);
    }
    for (const [k, v] of Object.entries(employee || {})) if (!verboden.has(k)) uit[k] = v;
    return uit;
  }

  /**
   * Zit deze medewerker binnen de scope van de gebruiker?
   *
   * "eigen"  · alleen jezelf
   * "team"   · jij en wie aan jou rapporteert
   * "alle"   · de hele organisatie
   *
   * Fail-closed: een onbekende scope geeft geen toegang.
   */
  function inScope(employee, ctx) {
    if (!employee || !ctx) return false;
    const scope = ctx.scope || "eigen";
    if (scope === "alle") return true;
    if (scope === "eigen") return employee.id === ctx.userId;
    if (scope === "team") {
      return employee.id === ctx.userId
        || employee.managerId === ctx.userId
        || (ctx.teamMemberIds || []).includes(employee.id);
    }
    return false;
  }

  /**
   * Mag deze gebruiker deze aanvraag goedkeuren?
   *
   * @returns {{ ok, code }}
   */
  function canApprove(request, ctx) {
    if (!request || !ctx) return { ok: false, code: "UNKNOWN_REQUEST" };
    if (!heeft(ctx, request.type === "expense" ? "expenses.approve" : "leaves.approve")) {
      return { ok: false, code: "NO_APPROVAL_RIGHT" };
    }
    // SoD 1: je keurt je eigen aanvraag niet goed.
    if (request.employeeId === ctx.userId) return { ok: false, code: "SELF_APPROVAL" };
    // SoD 2: je keurt de aanvraag van je eigen leidinggevende niet goed ·
    // anders staat de goedkeurder onder druk van de aanvrager.
    if (ctx.managerId && request.employeeId === ctx.managerId) return { ok: false, code: "UPWARD_APPROVAL" };
    // Scope: buiten je team bestaat de aanvraag niet.
    if (!inScope({ id: request.employeeId, managerId: request.managerId }, ctx)) {
      return { ok: false, code: "OUT_OF_SCOPE" };
    }
    return { ok: true, code: null };
  }

  /**
   * Filter een lijst tot wat binnen scope valt EN redigeer de velden.
   * Eén functie, zodat een lijstscherm de twee stappen niet kan vergeten.
   */
  function visibleList(employees, ctx) {
    return (employees || []).filter(e => inScope(e, ctx)).map(e => redact(e, ctx));
  }

  return {
    DEFINITION, SENSITIVE_FIELDS,
    allowedClasses, redact, inScope, canApprove, visibleList,
  };
});
