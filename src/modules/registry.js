const modules = [
  { key: "tenants", collection: "tenants", permission: "tenants", tenantScoped: false, label: "SaaS klanten" },
  { key: "users", collection: "users", permission: "employees", tenantScoped: true, label: "Medewerkers" },
  { key: "roles", collection: "roles", permission: "employees", tenantScoped: true, label: "Rollen" },
  { key: "venues", collection: "venues", permission: "venues", tenantScoped: true, label: "Venues/werven" },
  { key: "customers", collection: "customers", permission: "customers", tenantScoped: true, label: "Klanten" },
  { key: "planning", collection: "shifts", permission: "planning", tenantScoped: true, label: "Planning" },
  { key: "clockings", collection: "clocks", permission: "clockings", tenantScoped: true, label: "Tijdregistraties" },
  { key: "workorders", collection: "workorders", permission: "workorders", tenantScoped: true, label: "Werkbonnen" },
  { key: "expenses", collection: "expenses", permission: "expenses", tenantScoped: true, label: "Onkosten" },
  { key: "stock", collection: "stock", permission: "stock", tenantScoped: true, label: "Stock" },
  { key: "vehicles", collection: "vehicles", permission: "vehicles", tenantScoped: true, label: "Wagenpark" },
  { key: "leaves", collection: "leaves", permission: "leaves", tenantScoped: true, label: "Verlof" },
  { key: "messages", collection: "messages", permission: "messages", tenantScoped: true, label: "Berichten" },
  { key: "notifications", collection: "notifications", permission: "alerts", tenantScoped: true, label: "Notificaties" },
  { key: "integrations", collection: "integrations", permission: "integrations", tenantScoped: true, label: "Integraties" },
  { key: "invoices", collection: "invoices", permission: "billing", tenantScoped: true, label: "Facturen" },
  { key: "sales", collection: "salesLeads", permission: "tenants", tenantScoped: true, label: "Sales pipeline" },
  { key: "partners", collection: "partners", permission: "tenants", tenantScoped: true, label: "Partners" },
  { key: "audit", collection: "auditLogs", permission: "audit", tenantScoped: false, label: "Auditlog" }
];

function moduleByKey(key) {
  return modules.find(module => module.key === key);
}

module.exports = { modules, moduleByKey };
