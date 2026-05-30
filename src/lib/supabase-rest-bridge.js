const action = process.argv[2];
const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

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

function requiredConfig() {
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase bridge mist SUPABASE_URL of SUPABASE_SERVICE_ROLE_KEY");
}

function headers(extra = {}) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
    ...extra
  };
}

async function request(path, options = {}) {
  requiredConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: headers(options.headers || {})
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${options.method || "GET"} ${path} faalde: ${response.status} ${text}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function readAll(table, query = "select=*") {
  return request(`${table}?${query}`, {
    headers: { range: "0-9999" }
  });
}

function recordId(collection, row, index) {
  return row.id || `${collection}_${index + 1}`;
}

function tenantId(row) {
  return row.tenantId || row.tenant_id || null;
}

function emptyData() {
  return {
    schemaVersion: 1,
    tenants: [],
    auditLogs: [],
    errorEvents: [],
    global_records: []
  };
}

function ensureCollections(data) {
  for (const collection of [...TENANT_COLLECTIONS, ...GLOBAL_COLLECTIONS]) {
    if (!Array.isArray(data[collection])) data[collection] = [];
  }
}

async function loadData() {
  const data = emptyData();
  ensureCollections(data);

  const [tenants, tenantRecords, globalRecords, auditLogs, errorEvents] = await Promise.all([
    readAll("tenants"),
    readAll("tenant_records"),
    readAll("global_records"),
    readAll("audit_logs"),
    readAll("error_events")
  ]);

  data.tenants = (tenants || []).map(row => ({
    ...(row.data || {}),
    id: row.id,
    name: row.name,
    plan: row.plan,
    status: row.status,
    billingEmail: row.billing_email
  }));

  for (const row of tenantRecords || []) {
    if (!data[row.collection]) data[row.collection] = [];
    data[row.collection].push({
      ...(row.data || {}),
      id: (row.data && row.data.id) || row.id,
      tenantId: (row.data && row.data.tenantId) || row.tenant_id
    });
  }

  for (const row of globalRecords || []) {
    if (!data[row.collection]) data[row.collection] = [];
    data[row.collection].push({
      ...(row.data || {}),
      id: (row.data && row.data.id) || row.id
    });
  }

  data.auditLogs = (auditLogs || []).map(row => ({
    ...(row.data || {}),
    id: row.id,
    tenantId: row.tenant_id,
    actor: row.actor,
    area: row.area,
    action: row.action,
    detail: row.detail,
    at: row.at
  }));
  data.errorEvents = (errorEvents || []).map(row => ({
    ...(row.data || {}),
    id: row.id,
    tenantId: row.tenant_id,
    status: row.status,
    method: row.method,
    path: row.path,
    message: row.message,
    at: row.at
  }));
  data.schemaVersion = Math.max(1, ...data.migrationHistory.map(row => Number(row.version || 1)));
  return data;
}

async function ping() {
  const [tenants, migrations, tenantRecords, auditLogs] = await Promise.all([
    readAll("tenants", "select=id&limit=1"),
    readAll("app_schema_migrations", "select=version,name,applied_at&order=version.desc&limit=1"),
    readAll("tenant_records", "select=collection,id&limit=1"),
    readAll("audit_logs", "select=id&limit=1")
  ]);
  const latestMigration = (migrations || [])[0] || null;
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    tables: {
      tenants: Array.isArray(tenants),
      app_schema_migrations: Array.isArray(migrations),
      tenant_records: Array.isArray(tenantRecords),
      audit_logs: Array.isArray(auditLogs)
    },
    latestMigration
  };
}

async function probeWrite() {
  const id = `probe_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const row = {
    collection: "_health",
    id,
    data: {
      id,
      purpose: "workflowpro-supabase-write-probe",
      at: new Date().toISOString()
    }
  };
  await upsert("global_records", [row], "collection,id");
  const found = await readAll("global_records", `select=collection,id&collection=eq._health&id=eq.${encodeURIComponent(id)}&limit=1`);
  await request(`global_records?collection=eq._health&id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE"
  });
  return {
    ok: Array.isArray(found) && found.length === 1,
    id,
    checkedAt: new Date().toISOString()
  };
}

async function upsert(table, rows, onConflict = "id") {
  if (!rows.length) return;
  await request(`${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(rows)
  });
}

async function deleteMissingTenantRecords(expectedKeys) {
  const existing = await readAll("tenant_records", "select=collection,id");
  for (const row of existing || []) {
    const key = `${row.collection}:${row.id}`;
    if (expectedKeys.has(key)) continue;
    await request(`tenant_records?collection=eq.${encodeURIComponent(row.collection)}&id=eq.${encodeURIComponent(row.id)}`, {
      method: "DELETE"
    });
  }
}

async function deleteMissingGlobalRecords(expectedKeys) {
  const existing = await readAll("global_records", "select=collection,id");
  for (const row of existing || []) {
    const key = `${row.collection}:${row.id}`;
    if (expectedKeys.has(key)) continue;
    await request(`global_records?collection=eq.${encodeURIComponent(row.collection)}&id=eq.${encodeURIComponent(row.id)}`, {
      method: "DELETE"
    });
  }
}

async function saveData(data) {
  ensureCollections(data);
  await upsert("tenants", (data.tenants || []).map(tenant => {
    const extra = { ...tenant };
    delete extra.id;
    delete extra.name;
    delete extra.plan;
    delete extra.status;
    delete extra.billingEmail;
    return {
      id: tenant.id,
      name: tenant.name,
      plan: tenant.plan || "business",
      status: tenant.status || "trial",
      billing_email: tenant.billingEmail || "",
      data: extra
    };
  }), "id");

  const tenantRecords = [];
  const tenantKeys = new Set();
  for (const collection of TENANT_COLLECTIONS) {
    (data[collection] || []).forEach((row, index) => {
      const id = recordId(collection, row, index);
      tenantKeys.add(`${collection}:${id}`);
      tenantRecords.push({
        collection,
        id,
        tenant_id: tenantId(row),
        data: row
      });
    });
  }
  await upsert("tenant_records", tenantRecords, "collection,id");
  await deleteMissingTenantRecords(tenantKeys);

  const globalRecords = [];
  const globalKeys = new Set();
  for (const collection of GLOBAL_COLLECTIONS) {
    (data[collection] || []).forEach((row, index) => {
      const id = recordId(collection, row, index);
      globalKeys.add(`${collection}:${id}`);
      globalRecords.push({ collection, id, data: row });
    });
  }
  await upsert("global_records", globalRecords, "collection,id");
  await deleteMissingGlobalRecords(globalKeys);

  await upsert("audit_logs", (data.auditLogs || []).map((row, index) => ({
    id: recordId("auditLogs", row, index),
    tenant_id: row.tenantId || null,
    actor: row.actor || "",
    area: row.area || "system",
    action: row.action || "event",
    detail: row.detail || "",
    data: row,
    at: row.at || new Date().toISOString()
  })), "id");
  await upsert("error_events", (data.errorEvents || []).map((row, index) => ({
    id: recordId("errorEvents", row, index),
    tenant_id: row.tenantId || null,
    status: Number(row.status || 500),
    method: row.method || "",
    path: row.path || "",
    message: row.message || "",
    data: row,
    at: row.at || new Date().toISOString()
  })), "id");
}

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : null;
}

(async () => {
  if (action === "load") {
    process.stdout.write(JSON.stringify(await loadData()));
    return;
  }
  if (action === "ping") {
    process.stdout.write(JSON.stringify(await ping()));
    return;
  }
  if (action === "probe-write") {
    process.stdout.write(JSON.stringify(await probeWrite()));
    return;
  }
  if (action === "save") {
    await saveData(await readStdinJson());
    process.stdout.write(JSON.stringify({ ok: true }));
    return;
  }
  throw new Error(`Onbekende Supabase bridge actie: ${action}`);
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
