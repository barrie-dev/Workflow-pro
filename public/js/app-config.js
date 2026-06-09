(function () {
  window.WorkFlowProConfig = {
    views: {
      start:         { pageId: "customerStartPage",   tabId: "viewStart",         refresh: "refreshCustomerStart" },
      notifications: { pageId: "notificationsPage",   tabId: "viewNotifications", refresh: "refreshNotifications" },
      customers:     { pageId: "customersPage",       tabId: "viewCustomers",     refresh: "refreshCustomers" },
      planning:      { pageId: "planningPage",         tabId: "viewPlanning",      refresh: "refreshOps" },
      workorders:    { pageId: "workordersPage",       tabId: "viewWorkorders",    refresh: "refreshOps" },
      employees:     { pageId: "employeesPage",       tabId: "viewEmployees",     refresh: "refreshEmployees" },
      clockings:     { pageId: "clockingsPage",       tabId: "viewClockings",     refresh: "refreshClockings" },
      expenses:      { pageId: "expensesPage",        tabId: "viewExpenses",      refresh: "refreshExpenses" },
      invoices:      { pageId: "invoicesPage",        tabId: "viewInvoices",      refresh: "refreshInvoices" },
      stock:         { pageId: "stockPage",           tabId: "viewStock",         refresh: "refreshStock" },
      assets:        { pageId: "wagenparkPage",       tabId: "viewAssets",        refresh: "refreshWagenpark" },
      verlof:        { pageId: "verlofPage",          tabId: "viewVerlof",        refresh: "refreshVerlof" },
      reports:       { pageId: "reportsPage",         tabId: "viewReports",       refresh: "refreshReportsDashboard" },
      integrations:  { pageId: "integrationsPage",   tabId: "viewIntegrations",  refresh: "refreshIntegrations" },
      admin:         { pageId: "adminPage",           tabId: "viewAdmin",         refresh: "refreshAdmin" },
      // Legacy / intern — bewaard voor backwards compat met main.js
      ops:           { pageId: "opsPage",             tabId: "viewOps" },
      billing:       { pageId: "billingPage",         tabId: "viewBilling" },
      mobile:        { pageId: "mobilePage",          tabId: "viewMobile",        refresh: "refreshMobile" },
      portal:        { pageId: "portalPage",          tabId: "viewPortal",        refresh: "refreshPortal" },
      sales:         { pageId: "salesPage",           tabId: "viewSales",         refresh: "refreshSales" },
      demo:          { pageId: "demoPage",            tabId: "viewDemo" },
      status:        { pageId: "statusPage",          tabId: "viewStatus",        refresh: "refreshStatus" },
      json:          { pageId: "jsonPage",            tabId: "viewJson",          refresh: "refreshJson" },
      api:           { pageId: "apiPage",             tabId: "viewApi" }
    }
  };
}());
