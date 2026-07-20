"use strict";
// Geverifieerde publieke aanvaarding voor smokes: OTP aanvragen, de code uit
// de mail-log vissen (superadmin) en ondertekenen. Valt terug op
// link-aanvaarding wanneer er geen dossieradres is (NO_EMAIL_ON_FILE).
// Zo testen alle smokes automatisch het ECHTE gedrag van de ondertekenflow.
module.exports = async function acceptQuote(BASE, pubToken, name = "Jan Klant") {
  async function j(method, path, body, token) {
    const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json().catch(() => ({})) };
  }
  const otp = await j("POST", `/api/public/quote/${pubToken}/otp`);
  if (otp.status === 409 && otp.data.code === "NO_EMAIL_ON_FILE") {
    return j("POST", `/api/public/quote/${pubToken}`, { decision: "accept", name });
  }
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;
  const mail = await j("GET", "/api/admin/mail-log", null, superTok);
  const m = (mail.data.mail || []).filter(x => /Verificatiecode offerte/.test(x.subject || "")).pop();
  const code = m ? (String(m.subject).match(/(\d{6})/) || [])[1] : null;
  return j("POST", `/api/public/quote/${pubToken}`, { decision: "accept", code, name });
};
