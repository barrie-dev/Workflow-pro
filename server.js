const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const dataDir = path.join(root, "data");
const dbPath = path.join(dataDir, "workflow-pro-db.json");
const port = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon"
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 8_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function readDatabase() {
  if (!fs.existsSync(dbPath)) return null;
  return JSON.parse(fs.readFileSync(dbPath, "utf8"));
}

function writeDatabase(data) {
  fs.mkdirSync(dataDir, { recursive: true });
  const record = {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    data
  };
  fs.writeFileSync(dbPath, JSON.stringify(record, null, 2));
  return record;
}

http.createServer((req, res) => {
  if (req.url === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      app: "WorkFlow Pro",
      mode: "local-saas",
      time: new Date().toISOString()
    });
    return;
  }

  if (req.url === "/api/state" && req.method === "GET") {
    sendJson(res, 200, readDatabase() || { schemaVersion: 1, savedAt: null, data: null });
    return;
  }

  if (req.url === "/api/state" && req.method === "PUT") {
    readBody(req)
      .then(body => {
        const parsed = JSON.parse(body || "{}");
        if (!parsed || typeof parsed !== "object" || !parsed.data) {
          sendJson(res, 400, { ok: false, error: "Missing data payload" });
          return;
        }
        const record = writeDatabase(parsed.data);
        sendJson(res, 200, { ok: true, savedAt: record.savedAt });
      })
      .catch(error => sendJson(res, 400, { ok: false, error: error.message }));
    return;
  }

  if (req.url === "/api/bootstrap" && req.method === "POST") {
    readBody(req)
      .then(body => {
        const parsed = JSON.parse(body || "{}");
        const current = readDatabase();
        if (current && current.data) {
          sendJson(res, 200, { ok: true, created: false, savedAt: current.savedAt });
          return;
        }
        const record = writeDatabase(parsed.data);
        sendJson(res, 201, { ok: true, created: true, savedAt: record.savedAt });
      })
      .catch(error => sendJson(res, 400, { ok: false, error: error.message }));
    return;
  }

  if (req.url === "/api/integrations/robaws/test" && req.method === "POST") {
    readBody(req)
      .then(body => {
        const parsed = JSON.parse(body || "{}");
        if (!parsed.apiKey || !parsed.accountId) {
          sendJson(res, 400, { ok: false, error: "Robaws API key en bedrijfsaccount zijn verplicht." });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          provider: "robaws",
          accountId: parsed.accountId,
          availableMappings: ["customers", "projects", "workorders", "materials", "hours", "invoices"],
          mode: "local-simulation"
        });
      })
      .catch(error => sendJson(res, 400, { ok: false, error: error.message }));
    return;
  }

  if (req.url === "/api/integrations/robaws/sync" && req.method === "POST") {
    sendJson(res, 202, {
      ok: true,
      provider: "robaws",
      queuedAt: new Date().toISOString(),
      exported: {
        workorders: 3,
        hours: 12,
        materials: 4
      },
      mode: "local-simulation"
    });
    return;
  }

  const safePath = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
  const filePath = path.join(root, safePath || "index.html");

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(root, "index.html"), (fallbackErr, fallback) => {
        if (fallbackErr) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": types[".html"] });
        res.end(fallback);
      });
      return;
    }

    res.writeHead(200, {
      "Content-Type": types[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}).listen(port, () => {
  console.log(`WorkFlow Pro draait op http://localhost:${port}`);
});
