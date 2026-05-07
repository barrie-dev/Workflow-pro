const { hashPassword } = require("../lib/security");

const FIELD_ALIASES = {
  naam: "name",
  name: "name",
  medewerker: "name",
  email: "email",
  "e-mail": "email",
  mail: "email",
  rol: "role",
  role: "role",
  telefoon: "phone",
  phone: "phone",
  functie: "jobTitle",
  jobtitle: "jobTitle"
};

const ROLE_PERMISSIONS = {
  employee: ["workorders", "expenses", "leaves", "messages"],
  planner: ["employees", "venues", "planning", "workorders", "clockings", "expenses", "messages", "alerts"],
  tenant_admin: ["tenants", "employees", "venues", "customers", "planning", "workorders", "clockings", "expenses", "billing", "settings", "audit", "messages", "alerts", "integrations"]
};

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function detectDelimiter(headerLine) {
  const commaCount = (headerLine.match(/,/g) || []).length;
  const semicolonCount = (headerLine.match(/;/g) || []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function parseCsvLine(line, delimiter) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === "\"" && quoted && next === "\"") {
      value += "\"";
      i += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(value.trim());
      value = "";
    } else {
      value += char;
    }
  }
  cells.push(value.trim());
  return cells;
}

function normalizeHeader(header) {
  return FIELD_ALIASES[String(header || "").trim().toLowerCase()] || String(header || "").trim();
}

function parseEmployeesCsv(csv) {
  const lines = String(csv || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) badRequest("CSV bevat geen medewerkers.");
  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map(normalizeHeader);
  if (!headers.includes("name") || !headers.includes("email")) {
    badRequest("CSV heeft minstens naam/name en email nodig.");
  }
  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line, delimiter);
    const row = headers.reduce((acc, header, cellIndex) => {
      if (header) acc[header] = cells[cellIndex] || "";
      return acc;
    }, {});
    return { sourceLine: index + 2, ...row };
  });
}

function normalizeRole(role) {
  const value = String(role || "employee").trim().toLowerCase();
  if (["admin", "tenant_admin", "tenant admin"].includes(value)) return "tenant_admin";
  if (["planner", "dispatcher", "planning"].includes(value)) return "planner";
  return "employee";
}

function publicUser(user) {
  const { passwordHash, mfaSecret, recoveryCodes, ...safe } = user;
  return safe;
}

function importEmployees(store, tenant, body, user) {
  const csv = body.csv || body.text || "";
  const rows = parseEmployeesCsv(csv);
  const result = { created: [], updated: [], skipped: [] };
  const now = new Date().toISOString();

  rows.forEach(row => {
    const name = String(row.name || "").trim();
    const email = String(row.email || "").trim().toLowerCase();
    const role = normalizeRole(row.role);
    if (!name || !email.includes("@")) {
      result.skipped.push({ line: row.sourceLine, reason: "Naam of geldig e-mailadres ontbreekt." });
      return;
    }
    const existing = store.data.users.find(item => item.tenantId === tenant.id && item.email.toLowerCase() === email);
    const patch = {
      name,
      email,
      role,
      phone: String(row.phone || "").trim(),
      jobTitle: String(row.jobTitle || "").trim(),
      active: true,
      permissions: ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.employee,
      importedAt: now,
      importedBy: user.email
    };
    if (existing) {
      const updated = store.update("users", existing.id, patch);
      result.updated.push(publicUser(updated));
      return;
    }
    const created = store.insert("users", {
      id: `user_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      tenantId: tenant.id,
      passwordHash: hashPassword(body.defaultPassword || "Welkom123!"),
      mfaEnabled: false,
      mfaEnforced: false,
      lastLoginAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
      ...patch
    });
    result.created.push(publicUser(created));
  });

  store.audit({
    actor: user.email,
    tenantId: tenant.id,
    action: "employees_imported",
    area: "employees",
    detail: `${result.created.length} created, ${result.updated.length} updated, ${result.skipped.length} skipped`
  });

  return result;
}

module.exports = { importEmployees, parseEmployeesCsv };
