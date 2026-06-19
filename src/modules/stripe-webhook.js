"use strict";

const crypto = require("crypto");

function parseStripeSignature(signatureHeader) {
  return String(signatureHeader || "")
    .split(",")
    .map(part => part.split("=", 2))
    .reduce((acc, pair) => {
      if (pair[0]) acc[pair[0]] = pair[1] || "";
      return acc;
    }, {});
}

function verifyStripeSignature(rawBody, signatureHeader, options = {}) {
  const secret = options.webhookSecret || "";
  const requireSignature = !!options.requireSignature;

  if (!secret) {
    return requireSignature
      ? { ok: false, mode: "missing-webhook-secret" }
      : { ok: true, mode: "unsigned-testmode" };
  }

  const parts = parseStripeSignature(signatureHeader);
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return { ok: false, mode: "missing-signature" };

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const ok = Buffer.byteLength(signature) === Buffer.byteLength(expected)
    && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  return { ok, mode: "signed" };
}

module.exports = { parseStripeSignature, verifyStripeSignature };
