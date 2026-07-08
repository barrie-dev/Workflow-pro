const {
  apiError,
  parseTime,
  windowFromTimes,
  windowFromTimesSafe,
  windowsOverlap
} = require("./time-utils");
const { verifyClockGeo } = require("./geo");

const MAX_CLOCK_MINUTES = 16 * 60;

function clockWindowSafe(clock) {
  return windowFromTimesSafe(clock.clockIn, clock.clockOut);
}

function shiftWindowSafe(shift) {
  return windowFromTimesSafe(shift.start, shift.end);
}

function sameUserDate(rows, userId, date, excludeId = null) {
  return rows.filter(row => row.id !== excludeId && row.userId === userId && row.date === date);
}

function findMatchingShift(store, tenantId, userId, date, clockInMinutes, venueId = null) {
  const candidates = store
    .list("shifts", tenantId)
    .filter(shift => shift.userId === userId && shift.date === date)
    .map(shift => ({ shift, window: shiftWindowSafe(shift) }))
    .filter(row => row.window)
    .sort((a, b) => a.window.start - b.window.start);

  const inWindow = candidates.find(row => row.window.start <= clockInMinutes && clockInMinutes <= row.window.end);
  if (inWindow) return inWindow.shift;

  if (venueId) return candidates.find(row => row.shift.venueId === venueId)?.shift || null;
  return candidates[0]?.shift || null;
}

function assertNoCompletedOverlap(store, tenantId, userId, date, window, excludeId = null) {
  const overlap = sameUserDate(store.list("clocks", tenantId), userId, date, excludeId)
    .filter(clock => clock.clockOut)
    .find(clock => {
      const candidateWindow = clockWindowSafe(clock);
      return candidateWindow && windowsOverlap(window, candidateWindow);
    });

  if (!overlap) return;
  throw apiError(
    `Tijdregistratieconflict: medewerker heeft al registratie op ${date} van ${overlap.clockIn} tot ${overlap.clockOut}`,
    409
  );
}

function normalizeClockIn(store, tenantId, payload, actor, fallbackTime) {
  const userId = payload.userId || actor.id;
  const date = payload.date || new Date().toISOString().slice(0, 10);
  const clockIn = payload.clockIn || fallbackTime;
  const clockInMinutes = parseTime(clockIn, "Starttijd");

  const active = sameUserDate(store.list("clocks", tenantId), userId, date).find(clock => !clock.clockOut);
  if (active) throw apiError("Er loopt al een actieve tijdregistratie", 409);

  const matchingShift = findMatchingShift(store, tenantId, userId, date, clockInMinutes, payload.venueId || null);
  const venueId = payload.venueId || matchingShift?.venueId || null;

  const instantWindow = { start: clockInMinutes, end: clockInMinutes + 1 };
  assertNoCompletedOverlap(store, tenantId, userId, date, instantWindow);

  // Locatie-verificatie ("coördinaten tegen valsspelen"): vergelijk de positie van
  // het toestel met de geofence van de werf. Best-effort · zonder geo of werf-geo
  // blokkeert het inklokken niet, maar het resultaat wordt wél vastgelegd.
  const venue = venueId ? store.get("venues", venueId) : null;
  const geoCheck = verifyClockGeo(payload.geo, venue);

  return {
    userId,
    date,
    clockIn,
    venueId,
    shiftId: payload.shiftId || matchingShift?.id || null,
    workorderId: payload.workorderId || matchingShift?.workorderId || null,
    note: payload.note || "",
    planningMatch: matchingShift ? "matched" : "unplanned",
    geo: geoCheck.geo,
    geoStatus: geoCheck.status,
    geoVerified: geoCheck.verified,
    geoDistanceM: geoCheck.distanceM ?? null
  };
}

function normalizeClockOut(store, tenantId, active, payload, fallbackTime) {
  const clockOut = payload.clockOut || fallbackTime;
  // Contextuele melding i.p.v. het generieke "Eindtijd moet na Starttijd liggen":
  // de medewerker koos geen eindtijd, dus leg uit dat uitklokken nog niet kan.
  if (parseTime(clockOut) <= parseTime(active.clockIn)) {
    throw apiError(`Uitklokken kan pas nadat er tijd verstreken is sinds het inklokken om ${active.clockIn}. Probeer straks opnieuw, of laat een beheerder de tijd handmatig corrigeren.`, 400);
  }
  const window = windowFromTimes(active.clockIn, clockOut, { start: "Starttijd", end: "Eindtijd" });
  if (window.end - window.start > MAX_CLOCK_MINUTES) {
    throw apiError("Tijdregistratie mag maximaal 16 uur duren zonder correctie", 422);
  }
  assertNoCompletedOverlap(store, tenantId, active.userId, active.date, window, active.id);

  const shift = active.shiftId ? store.get("shifts", active.shiftId) : null;
  const shiftWindow = shift && shift.tenantId === tenantId ? shiftWindowSafe(shift) : null;
  const deviationMinutes = shiftWindow
    ? Math.abs(window.start - shiftWindow.start) + Math.abs(window.end - shiftWindow.end)
    : null;

  return {
    clockOut,
    durationMinutes: window.end - window.start,
    note: payload.note || active.note || "",
    planningDeviationMinutes: deviationMinutes,
    status: deviationMinutes == null || deviationMinutes <= 30 ? "ready_for_approval" : "needs_review"
  };
}

function clockingInsights(clocks, shifts = []) {
  const shiftById = new Map(shifts.map(shift => [shift.id, shift]));
  const byUserDate = new Map();
  let openCount = 0;
  let invalidCount = 0;
  let overlapCount = 0;
  let unplannedCount = 0;
  let reviewCount = 0;
  let totalMinutes = 0;

  for (const clock of clocks) {
    if (!clock.clockOut) {
      openCount += 1;
      continue;
    }
    const window = clockWindowSafe(clock);
    if (!window) {
      invalidCount += 1;
      continue;
    }
    totalMinutes += window.end - window.start;
    if (!clock.shiftId || !shiftById.has(clock.shiftId)) unplannedCount += 1;
    if (clock.status === "needs_review") reviewCount += 1;

    const key = `${clock.userId || "unknown"}::${clock.date || "unknown"}`;
    if (!byUserDate.has(key)) byUserDate.set(key, []);
    byUserDate.get(key).push({ ...clock, window });
  }

  for (const rows of byUserDate.values()) {
    rows.sort((a, b) => a.window.start - b.window.start);
    for (let index = 1; index < rows.length; index += 1) {
      if (windowsOverlap(rows[index - 1].window, rows[index].window)) overlapCount += 1;
    }
  }

  return {
    totalHours: Number((totalMinutes / 60).toFixed(2)),
    openCount,
    invalidCount,
    overlapCount,
    unplannedCount,
    reviewCount,
    payrollReady: invalidCount === 0 && overlapCount === 0 && openCount === 0,
    maxClockHours: Number((MAX_CLOCK_MINUTES / 60).toFixed(0))
  };
}

module.exports = { normalizeClockIn, normalizeClockOut, clockingInsights };
