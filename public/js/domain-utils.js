(function () {
  let deps = {};

  function configure(nextDeps) {
    deps = nextDeps || {};
  }

  function todayValue() {
    return new Date().toISOString().slice(0, 10);
  }

  function futureDateValue(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function shortDateTime(value) {
    if (!value) return "Nog niet";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Onbekend";
    return date.toLocaleString("nl-BE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function optionList(rows, emptyLabel) {
    if (!rows.length) return `<option value="">${emptyLabel}</option>`;
    return rows.map(row => `<option value="${row.id}">${row.name || row.title || row.id}</option>`).join("");
  }

  function personName(id) {
    return deps.state?.users.find(user => user.id === id)?.name || "Onbekend";
  }

  function venueName(id) {
    return deps.state?.venues.find(venue => venue.id === id)?.name || "Geen werf";
  }

  function renderList(id, rows, template, empty) {
    deps.el(id).innerHTML = rows.length ? rows.map(template).join("") : `<div class="empty">${empty}</div>`;
  }

  window.WorkFlowProDomain = {
    configure,
    todayValue,
    futureDateValue,
    shortDateTime,
    optionList,
    personName,
    venueName,
    renderList
  };
}());
