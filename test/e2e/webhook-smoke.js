// Route-smoke E19: webhook registreren, event triggeren, bezorgronde,
// handtekening verifieren bij een ECHTE ontvanger, health/achterstand, requeue.
// De ontvanger draait lokaal over https met een self-signed cert.
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

// Verifieer een handtekening exact zoals een externe integrator dat zou doen.
function verify(body, secret, header) {
  const parts = String(header || "").split(",").reduce((a, kv) => { const [k, v] = kv.split("="); if (k && v) a[k.trim()] = v.trim(); return a; }, {});
  const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.${body}`).digest("hex");
  return parts.v1 === expected;
}

(async () => {
  // ── Lokale HTTPS-ontvanger met self-signed cert ──
  const selfsigned = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  // Node kan zelf geen X.509 uitgeven; gebruik een vast test-cert via openssl.
  let key, cert;
  try {
    const os = require("os"), fs = require("fs"), path = require("path");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "whsmoke-"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem"), "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
    key = fs.readFileSync(path.join(dir, "k.pem"));
    cert = fs.readFileSync(path.join(dir, "c.pem"));
  } catch (e) {
    console.log("OVERGESLAGEN · openssl niet beschikbaar voor de HTTPS-ontvanger");
    exitSoft(0);
  }

  const received = [];
  const receiver = https.createServer({ key, cert }, (req, res) => {
    let raw = "";
    req.on("data", c => raw += c);
    req.on("end", () => {
      received.push({ body: raw, headers: req.headers });
      // Eerste poging faalt bewust → bewijst retry; daarna 200.
      if (received.length === 1) { res.writeHead(500); res.end("boom"); return; }
      res.writeHead(200); res.end("ok");
    });
  });
  await new Promise(r => receiver.listen(4444, r));
  // De server valideert certs; voor deze smoke accepteren we het self-signed cert.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;

  // Endpoint registreren → secret eenmalig
  const ep = await j("POST", `/api/tenants/${tid}/webhooks`, { url: "https://localhost:4444/hook", eventTypes: ["article.*"], description: "Smoke-ontvanger" }, tok);
  check("webhook geregistreerd + secret eenmalig getoond", ep.status === 201 && /^whsec_/.test(ep.data.secret || ""), ep.data.endpoint && ep.data.endpoint.url);
  const secret = ep.data.secret;
  const epId = ep.data.endpoint.id;

  // http:// wordt geweigerd
  const bad = await j("POST", `/api/tenants/${tid}/webhooks`, { url: "http://onveilig.be/hook", eventTypes: ["article.created"] }, tok);
  check("http:// geweigerd → 400", bad.status === 400 && bad.data.code === "INVALID_URL", bad.data.code);

  // Secret lekt niet in de lijst
  const list = await j("GET", `/api/tenants/${tid}/webhooks`, null, tok);
  check("secret niet in lijst, wel een hint", !list.data.endpoints[0].secret && /^whsec_…/.test(list.data.endpoints[0].secretHint || ""), list.data.endpoints[0].secretHint);

  // Event triggeren: artikel aanmaken
  await j("POST", `/api/tenants/${tid}/articles`, { name: "Webhook-testartikel", salesPrice: 5 }, tok);

  // Bezorgronde 1 → ontvanger geeft 500 → mislukt
  const d1 = await j("POST", `/api/tenants/${tid}/webhooks/deliver`, {}, tok);
  check("bezorgronde 1: mislukt (ontvanger gaf 500)", d1.data.failed === 1 && d1.data.delivered === 0, JSON.stringify({ d: d1.data.delivered, f: d1.data.failed }));
  check("ontvanger kreeg een ondertekend verzoek", received.length === 1 && verify(received[0].body, secret, received[0].headers["x-monargo-signature"]), received.length);
  check("event-ID meegestuurd voor dedupe", !!received[0].headers["x-monargo-event-id"], received[0].headers["x-monargo-event-id"]);
  const firstEventId = received[0].headers["x-monargo-event-id"];

  // Health toont laatste fout + achterstand
  const h1 = await j("GET", `/api/tenants/${tid}/webhooks`, null, tok);
  const eph = (h1.data.health.endpoints || []).find(e => e.id === epId);
  check("health toont laatste fout", !!eph.lastErrorAt && /HTTP 500/.test(eph.lastError || ""), eph.lastError);
  check("health toont achterstand", h1.data.health.backlogTotal >= 1, h1.data.health.backlogTotal);

  // Requeue (reset backoff) → bezorgronde 2 slaagt
  await j("POST", `/api/tenants/${tid}/webhooks/events/${firstEventId}/requeue`, {}, tok);
  const d2 = await j("POST", `/api/tenants/${tid}/webhooks/deliver`, {}, tok);
  check("na requeue: bezorgronde 2 slaagt", d2.data.delivered >= 1, JSON.stringify({ d: d2.data.delivered, f: d2.data.failed }));
  check("herlevering draagt hetzelfde event-ID (dedupe bij ontvanger)", received.length >= 2 && received[1].headers["x-monargo-event-id"] === firstEventId, received[1] && received[1].headers["x-monargo-event-id"]);
  check("payload draagt geen delivery-metadata/actor", (() => { const p = JSON.parse(received[1].body); return p.delivery === undefined && p.actor === undefined && p.eventType === "article.created"; })());

  // Health na succes
  const h2 = await j("GET", `/api/tenants/${tid}/webhooks`, null, tok);
  const eph2 = (h2.data.health.endpoints || []).find(e => e.id === epId);
  check("health toont laatste succes", !!eph2.lastSuccessAt && eph2.delivered >= 1, eph2.delivered);

  // Secret roteren geeft een nieuw secret
  const rot = await j("POST", `/api/tenants/${tid}/webhooks/${epId}/rotate-secret`, {}, tok);
  check("secret roteren", rot.status === 200 && /^whsec_/.test(rot.data.secret) && rot.data.secret !== secret);

  receiver.close();
  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
