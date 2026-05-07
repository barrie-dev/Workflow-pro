const { productionReadiness } = require("./production");
const { pilotKpis } = require("./pilot");
const { salesLaunchReadiness } = require("./sales");

function goLiveReadiness(store, tenant, options = {}) {
  const minPilotScore = Number(options.minPilotScore || 80);
  const strictProduction = !!options.strictProduction;
  const production = productionReadiness(store);
  const openP0 = production.checks.filter(row => !row.ok && row.priority === "P0");
  const openP1 = production.checks.filter(row => !row.ok && row.priority === "P1");
  const pilot = pilotKpis(store, tenant.id);
  const openPilot = pilot.kpis.filter(row => !row.ok);
  const sales = salesLaunchReadiness(store, tenant.id);
  const productionOk = openP0.length === 0 && (!strictProduction || openP1.length === 0);
  const pilotOk = pilot.score >= minPilotScore && openPilot.length === 0;
  return {
    ok: productionOk && pilotOk && sales.ok,
    tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan, status: tenant.status },
    generatedAt: new Date().toISOString(),
    gates: {
      production: { ok: productionOk, strict: strictProduction, score: production.score, p0: openP0.length, p1: openP1.length, openP0, openP1 },
      pilot: { ok: pilotOk, minScore: minPilotScore, score: pilot.score, openCount: openPilot.length, openKpis: openPilot },
      sales: { ok: sales.ok, score: sales.score, openCount: sales.openChecks.length, openChecks: sales.openChecks }
    }
  };
}

module.exports = { goLiveReadiness };
