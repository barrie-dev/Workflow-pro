const { apiError, formatMinutes, windowFromTimes, windowFromTimesSafe, windowsOverlap } = require("./time-utils");

function shiftWindow(shift) {
  return windowFromTimes(shift.start, shift.end, { start: "Starttijd", end: "Eindtijd" });
}

function shiftWindowSafe(shift) {
  return windowFromTimesSafe(shift.start, shift.end);
}

function validatePlanningRules(store, tenantId, payload, existing = null) {
  const shift = { ...(existing || {}), ...(payload || {}), tenantId };
  const window = shiftWindow(shift);

  const sameUserSameDay = store
    .list("shifts", tenantId)
    .filter(row => row.id !== existing?.id && row.userId === shift.userId && row.date === shift.date);

  const conflict = sameUserSameDay.find(row => {
    const candidateWindow = shiftWindowSafe(row);
    return candidateWindow && windowsOverlap(window, candidateWindow);
  });

  if (conflict) {
    throw apiError(
      `Planningconflict: medewerker heeft al een shift op ${shift.date} van ${conflict.start} tot ${conflict.end}`,
      409
    );
  }

  return {
    durationMinutes: window.end - window.start,
    startMinutes: window.start,
    endMinutes: window.end
  };
}

function planningInsights(shifts) {
  const byUserDate = new Map();
  const capacityByDate = new Map();
  let invalidCount = 0;
  let plannedMinutes = 0;

  for (const shift of shifts) {
    const window = shiftWindowSafe(shift);
    if (!window) {
      invalidCount += 1;
      continue;
    }

    plannedMinutes += window.end - window.start;
    const userDateKey = `${shift.userId || "unknown"}::${shift.date || "unknown"}`;
    const dateKey = shift.date || "unknown";
    const indexedShift = { ...shift, window };

    if (!byUserDate.has(userDateKey)) byUserDate.set(userDateKey, []);
    byUserDate.get(userDateKey).push(indexedShift);

    const capacity = capacityByDate.get(dateKey) || { date: dateKey, shifts: 0, minutes: 0, users: new Set() };
    capacity.shifts += 1;
    capacity.minutes += window.end - window.start;
    if (shift.userId) capacity.users.add(shift.userId);
    capacityByDate.set(dateKey, capacity);
  }

  const conflicts = [];
  for (const rows of byUserDate.values()) {
    rows.sort((a, b) => a.window.start - b.window.start);
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1];
      const current = rows[index];
      if (!windowsOverlap(previous.window, current.window)) continue;
      conflicts.push({
        userId: current.userId,
        date: current.date,
        firstShiftId: previous.id,
        secondShiftId: current.id,
        overlap: {
          start: formatMinutes(Math.max(previous.window.start, current.window.start)),
          end: formatMinutes(Math.min(previous.window.end, current.window.end))
        }
      });
    }
  }

  const capacity = Array.from(capacityByDate.values())
    .map(day => ({
      date: day.date,
      shifts: day.shifts,
      uniqueUsers: day.users.size,
      plannedHours: Number((day.minutes / 60).toFixed(2))
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    conflictCount: conflicts.length,
    conflicts: conflicts.slice(0, 25),
    invalidCount,
    plannedHours: Number((plannedMinutes / 60).toFixed(2)),
    capacity
  };
}

module.exports = { validatePlanningRules, planningInsights };
