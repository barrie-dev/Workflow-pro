const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function apiError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseTime(value, label = "Tijd") {
  const match = TIME_PATTERN.exec(String(value || "").trim());
  if (!match) throw apiError(`${label} moet in HH:MM formaat staan`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function parseTimeSafe(value) {
  const match = TIME_PATTERN.exec(String(value || "").trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatMinutes(minutes) {
  const hour = String(Math.floor(minutes / 60)).padStart(2, "0");
  const minute = String(minutes % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function windowFromTimes(startValue, endValue, labels = {}) {
  const start = parseTime(startValue, labels.start || "Starttijd");
  const end = parseTime(endValue, labels.end || "Eindtijd");
  if (end <= start) throw apiError(`${labels.end || "Eindtijd"} moet na ${labels.start || "starttijd"} liggen`);
  return { start, end };
}

function windowFromTimesSafe(startValue, endValue) {
  const start = parseTimeSafe(startValue);
  const end = parseTimeSafe(endValue);
  if (start == null || end == null || end <= start) return null;
  return { start, end };
}

function windowsOverlap(left, right) {
  return left.start < right.end && right.start < left.end;
}

function minutesBetween(startValue, endValue) {
  const window = windowFromTimes(startValue, endValue, { start: "Starttijd", end: "Eindtijd" });
  return window.end - window.start;
}

module.exports = {
  apiError,
  parseTime,
  parseTimeSafe,
  formatMinutes,
  windowFromTimes,
  windowFromTimesSafe,
  windowsOverlap,
  minutesBetween
};
