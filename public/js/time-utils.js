"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.wfpTime = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function asDate(value, dateHint) {
    if (!value) return null;
    const raw = String(value).trim();
    const combined = /^\d{1,2}:\d{2}(?::\d{2})?$/.test(raw) && dateHint
      ? `${dateHint}T${raw.length === 5 ? raw + ":00" : raw}`
      : raw;
    const parsed = new Date(combined);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function clockDate(row) {
    if (!row) return "";
    if (row.date) return String(row.date).slice(0, 10);
    const raw = row.clockedIn || row.clockIn || "";
    const match = String(raw).match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : "";
  }

  function clockPoint(row, side) {
    if (!row) return null;
    const end = side === "out";
    const direct = end ? row.clockedOut : row.clockedIn;
    if (direct) return asDate(direct, clockDate(row));
    const legacy = end ? row.clockOut : row.clockIn;
    return asDate(legacy, clockDate(row));
  }

  function isActive(row) {
    return !!clockPoint(row, "in") && !clockPoint(row, "out");
  }

  function clockMinutes(row) {
    if (!row) return 0;
    const explicit = Number(row.durationMinutes);
    if (Number.isFinite(explicit) && explicit >= 0 && !isActive(row)) return explicit;
    const start = clockPoint(row, "in");
    const end = clockPoint(row, "out");
    if (!start || !end) return 0;
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  }

  function clockHours(row) {
    return clockMinutes(row) / 60;
  }

  function clockTime(row, side, locale = "nl-BE") {
    if (!row) return "";
    const end = side === "out";
    const legacy = end ? row.clockOut : row.clockIn;
    if (legacy && /^\d{1,2}:\d{2}/.test(String(legacy))) return String(legacy).slice(0, 5).padStart(5, "0");
    const point = clockPoint(row, side);
    return point ? point.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
  }

  return { clockDate, clockPoint, clockTime, clockMinutes, clockHours, isActive };
});
