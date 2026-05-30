(function () {
  window.WorkFlowProConfig = {
    views: {
      start: { pageId: "customerStartPage", tabId: "viewStart", refresh: "refreshCustomerStart" },
      demo: { pageId: "demoPage", tabId: "viewDemo" },
      planning: { pageId: "planningPage", tabId: "viewPlanning", refresh: "refreshOps" },
      workorders: { pageId: "workordersPage", tabId: "viewWorkorders", refresh: "refreshOps" },
      ops: { pageId: "opsPage", tabId: "viewOps", refresh: "refreshOps" },
      billing: { pageId: "billingPage", tabId: "viewBilling", refresh: "refreshBilling" },
      assets: { pageId: "wagenparkPage", tabId: "viewAssets", refresh: "refreshWagenpark" },
      stock: { pageId: "stockPage", tabId: "viewStock", refresh: "refreshStock" },
      verlof: { pageId: "verlofPage", tabId: "viewVerlof", refresh: "refreshVerlof" },
      reports: { pageId: "reportsPage", tabId: "viewReports", refresh: "refreshReportsDashboard" },
      mobile: { pageId: "mobilePage", tabId: "viewMobile", refresh: "refreshMobile" },
      integrations: { pageId: "integrationsPage", tabId: "viewIntegrations", refresh: "refreshIntegrations" },
      notifications: { pageId: "notificationsPage", tabId: "viewNotifications", refresh: "refreshNotifications" },
      admin: { pageId: "adminPage", tabId: "viewAdmin", refresh: "refreshAdmin" },
      portal: { pageId: "portalPage", tabId: "viewPortal", refresh: "refreshPortal" },
      sales: { pageId: "salesPage", tabId: "viewSales", refresh: "refreshSales" },
      status: { pageId: "statusPage", tabId: "viewStatus", refresh: "refreshStatus" },
      json: { pageId: "jsonPage", tabId: "viewJson", refresh: "refreshJson" },
      api: { pageId: "apiPage", tabId: "viewApi" }
    }
  };
}());
