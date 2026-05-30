(function () {
  function el(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    el(id).textContent = value;
  }

  function showJson(id, data) {
    el(id).textContent = JSON.stringify(data, null, 2);
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
