const { productionReadiness } = require("./production");
const { pilotKpis } = require("./pilot");
const { salesLaunchReadiness } = require("./sales");
const { liveServiceReadiness } = require("./live-services");

function customerStartGate(store, tenant) {
  const scoped = store.tenantScoped(tenant.id);
  const today = new Date().toISOString().slice(0, 10);
  const sortedShiftDates = Array.from(new Set(scoped.shifts.map(row => row.date).filter(Boolean))).sort();
  const nextShiftDate = sortedShiftDates.find(date => date >= today);
  const latestShiftDate = sortedShiftDates[sortedShiftDates.length - 1];
  const workspaceDate = scoped.shifts.some(row => row.date === today) ? today : nextShiftDate || latestShiftDate || today;
  const dayShifts = scoped.shifts.filter(row => row.date === workspaceDate);
  const openWorkorders = scoped.workorders.filter(row => !["Voltooid", "Afgewerkt"].includes(row.status));
  const ready = !!dayShifts.length && !!openWorkorders.length;
  const blockers = [
    dayShifts.length ? "" : "Geen planning voor de eerstvolgende werkdag",
    openWorkorders.length ? "" : "Geen open werkbonnen voor uitvoering"
  ].filter(Boolean);
  return {
    ok: ready,
    ready,
    label: ready ? "Dagelijkse flow klaar" : "Nog niet klantklaar",
    detail: ready
      ? "Planning en werkbonnen zijn aanwezig voor de klantstart."
      : "Zet minstens planning en werkbonnen klaar voordat een klant zelfstandig start.",
    workspaceDate,
    routeCount: null,
    blockers,
    internalRoutes: []
  };
}

function goLiveReadiness(store, tenant, options = {}) {
  const minPilotScore = Number(options.minPilotScore || 80);
  const strictProduction = !!options.strictProduction;
  const production = productionReadiness(store);
  const openP0 = production.checks.filter(row => !row.ok && row.priority === "P0");
  const openP1 = production.checks.filter(row => !row.ok && row.priority === "P1");
  const liveServices = liveServiceReadiness();
  const openLiveP0 = liveServices.blockers;
  const openLiveP1 = liveServices.warnings;
  const pilot = pilotKpis(store, tenant.id);
  const openPilot = pilot.kpis.filter(row => !row.ok);
  const sales = salesLaunchReadiness(store, tenant.id);
  const productionOk = openP0.length === 0 && openLiveP0.length === 0 && (!strictProduction || (openP1.length === 0 && openLiveP1.length === 0));
  const pilotOk = pilot.score >= minPilotScore && openPilot.length === 0;
  const customerStart = customerStartGate(store, tenant);
  return {
    ok: productionOk && pilotOk && sales.ok && customerStart.ok,
    tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan, status: tenant.status },
    generatedAt: new Date().toISOString(),
    gates: {
      production: { ok: productionOk, strict: strictProduction, score: production.score, p0: openP0.length, p1: openP1.length, openP0, openP1 },
      liveServices: { ok: openLiveP0.length === 0 && (!strictProduction || openLiveP1.length === 0), strict: strictProduction, ready: liveServices.ready, total: liveServices.total, p0: openLiveP0.length, p1: openLiveP1.length, openP0: openLiveP0, openP1: openLiveP1, groups: liveServices.groups },
      pilot: { ok: pilotOk, minScore: minPilotScore, score: pilot.score, openCount: openPilot.length, openKpis: openPilot },
      sales: { ok: sales.ok, score: sales.score, openCount: sales.openChecks.length, openChecks: sales.openChecks },
      customerStart
    }
  };
}

module.exports = { goLiveReadiness, customerStartGate };
