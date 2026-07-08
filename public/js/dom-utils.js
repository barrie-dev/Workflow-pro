(function () {
  function el(id) {
    return document.getElementById(id);
  }

  // Null-veilig: veel views delen dezelfde helper terwijl hun doel-element niet
  // in elke shell/route bestaat (bv. queueCount op de loginpagina). Zonder deze
  // guard gooit één ontbrekend element een top-level TypeError die de rest van
  // main.js afbreekt · dat brak stil o.a. de reset-/activatie-/support-deeplinks.
  function setText(id, value) {
    const node = el(id);
    if (node) node.textContent = value;
  }

  function showJson(id, data) {
    const node = el(id);
    if (node) node.textContent = JSON.stringify(data, null, 2);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function setNoticeText(id, message, good = true) {
    const notice = el(id);
    notice.textContent = message;
    notice.classList.toggle("bad", !good);
  }

  function statusTone(status) {
    const normalized = String(status || "").toLowerCase();
    if (["voltooid", "afgerond", "klaar", "approved"].includes(normalized)) return "success";
    if (["operational", "online", "up-to-date"].includes(normalized)) return "success";
    if (["bezig", "review"].includes(normalized)) return "info";
    if (["pending", "mock-ready", "testmode"].includes(normalized)) return "warning";
    if (["overdue", "te laat", "risico"].includes(normalized)) return "danger";
    if (["degraded", "error", "offline"].includes(normalized)) return "danger";
    return "warning";
  }

  window.WorkFlowProDom = {
    el,
    setText,
    showJson,
    escapeHtml,
    setNoticeText,
    statusTone
  };
}());
