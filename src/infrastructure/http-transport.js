"use strict";
/**
 * Gedeeld HTTP-transport voor opslag-adapters (infrastructuurlaag).
 *
 * Eén plek voor het echte netwerkverkeer, zodat elke adapter hetzelfde gedrag
 * heeft (timeout, buffering, Content-Length) en in tests een fake transport
 * geïnjecteerd kan worden zonder netwerk.
 */

/**
 * @param {{ url: string, method: string, headers?: object, body?: Buffer|string|null }} input
 * @returns {Promise<{ status: number, headers: object, body: Buffer }>}
 */
function defaultTransport({ url, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "http:" ? require("http") : require("https");
    // Content-Length is verplicht bij uploads; hoort niet bij de ondertekende
    // headers, dus hier zetten (transportlaag) is correct én voldoende.
    const withLength = body != null
      ? { ...headers, "content-length": String(Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body))) }
      : headers;
    const req = mod.request(u, { method, headers: withLength }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("Opslag-endpoint antwoordt niet (timeout)")));
    if (body != null) req.write(body);
    req.end();
  });
}

module.exports = { defaultTransport };
