function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function readBody(req, maxBytes = 2_000_000) {
  return readRawBody(req, maxBytes).then(body => {
    if (!body) return {};
    try {
      return JSON.parse(body);
    } catch (error) {
      throw new Error("Invalid JSON body");
    }
  });
}

function readRawBody(req, maxBytes = 2_000_000) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      resolve(body);
    });
    req.on("error", reject);
  });
}

function routeKey(req) {
  const url = new URL(req.url, "http://localhost");
  return `${req.method} ${url.pathname}`;
}

module.exports = { sendJson, readBody, readRawBody, routeKey };
