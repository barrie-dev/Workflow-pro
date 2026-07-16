(function () {
  let getToken = function () { return ""; };

  function configure(options) {
    getToken = options?.getToken || getToken;
  }

  async function request(path, options = {}) {
    const token = getToken();
    const res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await res.json();
    if (!res.ok) {
      throw Object.assign(new Error(data.error || "Actie mislukt"), {
        status: res.status,
        data
      });
    }
    return data;
  }

  function modulePath(key, tenantId) {
    return `/api/modules/${key}?tenantId=${tenantId}`;
  }

  async function listModuleRows(key, tenantId) {
    const result = await request(modulePath(key, tenantId));
    return result.rows || [];
  }

  async function createModuleRow(key, payload, tenantId) {
    const result = await request(modulePath(key, tenantId), {
      method: "POST",
      body: JSON.stringify(payload)
    });
    return result.row;
  }

  async function updateModuleRow(key, id, payload, tenantId) {
    const result = await request(`/api/modules/${key}/${id}?tenantId=${tenantId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    return result.row;
  }

  window.WorkFlowProApi = {
    configure,
    request,
    modulePath,
    listModuleRows,
    createModuleRow,
    updateModuleRow
  };
}());
