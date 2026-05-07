const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const inputPath = process.argv[2] || path.join(root, "data", "workflowpro-fullstack.json");
const outputPath = process.argv[3] || path.join(root, "data", "supabase-seed.sql");

const TENANT_COLLECTIONS = [
  "users",
  "roles",
  "venues",
  "customers",
  "shifts",
  "workorders",
  "clocks",
  "expenses",
  "stock",
  "vehicles",
  "leaves",
  "messages",
  "notifications",
  "integrations",
  "invoices",
  "paymentMethods",
  "files",
  "secrets",
  "apiKeys",
  "supportTickets",
  "salesLeads",
  "partners"
];

const GLOBAL_COLLECTIONS = ["migrationHistory"];
const MIN_SCHEMA_VERSION = 6;

function sqlString(value) {
  if (value == null) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `${sqlString(JSON.stringify(value || {}))}::jsonb`;
}

function recordId(collection, row, index) {
  return row.id || `${collection}_${index + 1}`;
}

function tenantId(row) {
  return row.tenantId || row.tenant_id || null;
}

function isTenantRecordExportable(collection, row) {
  if (tenantId(row)) return true;
  return collection === "users" && row.role === "super_admin";
}

function tenantInsert(tenant) {
  const data = { ...tenant };
  delete data.id;
  delete data.name;
  delete data.plan;
  delete data.status;
  delete data.billingEmail;
  return `insert into tenants (id, name, plan, status, billing_email, data)
values (${sqlString(tenant.id)}, ${sqlString(tenant.name)}, ${sqlString(tenant.plan || "business")}, ${sqlString(tenant.status || "trial")}, ${sqlString(tenant.billingEmail || "")}, ${sqlJson(data)})
on conflict (id) do update set name = excluded.name, plan = excluded.plan, status = excluded.status, billing_email = excluded.billing_email, data = excluded.data, updated_at = now();`;
}

function tenantRecordInsert(collection, row, index) {
  return `insert into tenant_records (collection, id, tenant_id, data)
values (${sqlString(collection)}, ${sqlString(recordId(collection, row, index))}, ${sqlString(tenantId(row))}, ${sqlJson(row)})
on conflict (collection, id) do update set tenant_id = excluded.tenant_id, data = excluded.data, updated_at = now();`;
}

function globalRecordInsert(collection, row, index) {
  return `insert into global_records (collection, id, data)
values (${sqlString(collection)}, ${sqlString(recordId(collection, row, index))}, ${sqlJson(row)})
on conflict (collection, id) do update set data = excluded.data, updated_at = now();`;
}

function auditInsert(row, index) {
  return `insert into audit_logs (id, tenant_id, actor, area, action, detail, data, at)
values (${sqlString(recordId("auditLogs", row, index))}, ${sqlString(row.tenantId || null)}, ${sqlString(row.actor || "")}, ${sqlString(row.area || "system")}, ${sqlString(row.action || "event")}, ${sqlString(row.detail || "")}, ${sqlJson(row)}, ${sqlString(row.at || new Date().toISOString())})
on conflict (id) do update set data = excluded.data;`;
}

function errorInsert(row, index) {
  return `insert into error_events (id, tenant_id, status, method, path, message, data, at)
values (${sqlString(recordId("errorEvents", row, index))}, ${sqlString(row.tenantId || null)}, ${Number(row.status || 500)}, ${sqlString(row.method || "")}, ${sqlString(row.path || "")}, ${sqlString(row.message || "")}, ${sqlJson(row)}, ${sqlString(row.at || new Date().toISOString())})
on conflict (id) do update set data = excluded.data;`;
}

function collectionCount(data, collection) {
  return Array.isArray(data[collection]) ? data[collection].length : 0;
}

function validateData(data) {
  const errors = [];
  if ((data.schemaVersion || 1) < MIN_SCHEMA_VERSION) {
    errors.push(`schemaVersion ${data.schemaVersion || 1} is te oud; verwacht minstens ${MIN_SCHEMA_VERSION}`);
  }
  for (const collection of ["tenants", ...TENANT_COLLECTIONS, ...GLOBAL_COLLECTIONS, "auditLogs", "errorEvents"]) {
    if (!Array.isArray(data[collection])) errors.push(`${collection} ontbreekt of is geen array`);
  }
  for (const tenant of data.tenants || []) {
    if (!tenant.id) errors.push("tenant zonder id gevonden");
    if (!tenant.name) errors.push(`tenant ${tenant.id || "onbekend"} mist naam`);
  }
  for (const collection of TENANT_COLLECTIONS) {
    (data[collection] || []).forEach((row, index) => {
      if (!isTenantRecordExportable(collection, row)) errors.push(`${collection}[${index}] mist tenantId`);
    });
  }
  if (errors.length) {
    console.error(`Supabase export geblokkeerd:\n- ${errors.join("\n- ")}`);
    process.exit(1);
  }
}

function exportSummary(data) {
  return {
    schemaVersion: data.schemaVersion || 1,
    tenants: collectionCount(data, "tenants"),
    tenantRecords: TENANT_COLLECTIONS.reduce((total, collection) => {
      return total + (data[collection] || []).filter(row => isTenantRecordExportable(collection, row)).length;
    }, 0),
    superAdmins: (data.users || []).filter(row => row.role === "super_admin" && !tenantId(row)).length,
    globalRecords: GLOBAL_COLLECTIONS.reduce((total, collection) => total + collectionCount(data, collection), 0),
    auditLogs: collectionCount(data, "auditLogs"),
    errorEvents: collectionCount(data, "errorEvents")
  };
}

if (!fs.existsSync(inputPath)) {
  console.error(`Input niet gevonden: ${inputPath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
validateData(data);
const summary = exportSummary(data);
const lines = [
  `-- WorkFlow Pro Supabase seed export`,
  `-- schemaVersion: ${summary.schemaVersion}`,
  `-- tenants: ${summary.tenants}, tenantRecords: ${summary.tenantRecords}, superAdmins: ${summary.superAdmins}, globalRecords: ${summary.globalRecords}, auditLogs: ${summary.auditLogs}, errorEvents: ${summary.errorEvents}`,
  "begin;",
  "set local statement_timeout = '30s';",
  ...((data.tenants || []).map(tenantInsert))
];

for (const collection of TENANT_COLLECTIONS) {
  (data[collection] || []).forEach((row, index) => {
    if (isTenantRecordExportable(collection, row)) lines.push(tenantRecordInsert(collection, row, index));
  });
}

(data.auditLogs || []).forEach((row, index) => lines.push(auditInsert(row, index)));
(data.errorEvents || []).forEach((row, index) => lines.push(errorInsert(row, index)));

for (const collection of GLOBAL_COLLECTIONS) {
  (data[collection] || []).forEach((row, index) => lines.push(globalRecordInsert(collection, row, index)));
}

lines.push("commit;");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${lines.join("\n\n")}\n`);
console.log(`Supabase seed SQL geschreven naar ${outputPath}`);
console.log(JSON.stringify({ ok: true, outputPath, summary }));
