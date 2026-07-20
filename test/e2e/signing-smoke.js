// Geverifieerde offerte-ondertekening tegen de echte server: OTP naar het
// GEKENDE klantadres (uit de mail-log gevist · bewijst dat de mail vertrekt),
// foute code telt af, goede code tekent met naam + handtekening, dossier
// opvraagbaar, en zonder dossieradres een eerlijke ongeverifieerde terugval.
const BASE = "http://localhost:4299";
const exitSoft = require("./_exit");
let failures = 0;
function check(name, ok, extra) { console.log((ok ? "OK " : "FOUT") + " · " + name + (extra !== undefined ? " · " + extra : "")); if (!ok) failures++; }
async function j(method, path, body, token) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

(async () => {
  const login = await j("POST", "/api/auth/login", { email: "admin@demobouw.be", password: "Demo2026!" });
  const tok = login.data.token;
  const tid = (await j("GET", "/api/me", null, tok)).data.user.tenantId;
  const superTok = (await j("POST", "/api/auth/login", { email: "super@workflowpro.be", password: "Demo2026!" })).data.token;

  // Klant MET e-mailadres + offerte die verstuurd is (publicToken nodig).
  const cust = await j("POST", `/api/tenants/${tid}/customers`, { name: "Eindklant NV", email: "eindklant@bedrijf.be" }, tok);
  const quote = await j("POST", `/api/tenants/${tid}/offertes`, {
    customerId: cust.data.customer.id, customerName: "Eindklant NV",
    lines: [{ description: "Renovatie badkamer", qty: 1, unitPrice: 1000, vatRate: 21 }],
    validUntil: "2099-01-01",
  }, tok);
  const q = quote.data.quote || quote.data.offerte;
  check("offerte aangemaakt", quote.status === 201 && !!q, quote.status);
  const send = await j("POST", `/api/tenants/${tid}/offertes/${q.id}/send`, {}, tok);
  const pubToken = (send.data.quote && send.data.quote.publicToken) || q.publicToken;
  check("offerte verstuurd met publieke link", !!pubToken, send.status);

  // ── Aanvaarden zonder code wordt geweigerd zodra er een dossieradres is ──
  const zonderCode = await j("POST", `/api/public/quote/${pubToken}`, { decision: "accept", name: "Indringer" });
  check("aanvaarden zonder verificatie → geweigerd (OTP_REQUIRED)", zonderCode.status === 400 && zonderCode.data.code === "OTP_REQUIRED", zonderCode.data.code);

  // ── Code aanvragen · uit de mail-log vissen ──
  const otpReq = await j("POST", `/api/public/quote/${pubToken}/otp`, {});
  check("code verstuurd naar gemaskeerd dossieradres", otpReq.status === 200 && /ei.*@bedrijf\.be/.test(otpReq.data.sentTo), otpReq.data.sentTo);
  const cooldown = await j("POST", `/api/public/quote/${pubToken}/otp`, {});
  check("meteen opnieuw vragen → cooldown 429", cooldown.status === 429 && cooldown.data.code === "OTP_COOLDOWN", cooldown.status);

  const mailLog = await j("GET", "/api/admin/mail-log", null, superTok);
  const otpMail = (mailLog.data.mail || []).find(m => /Verificatiecode offerte/.test(m.subject || "") && /eindklant@bedrijf\.be/.test(String(m.to)));
  check("verificatiemail in de mail-log", !!otpMail, (mailLog.data.mail || []).length);
  const code = otpMail ? (String(otpMail.subject).match(/(\d{6})/) || [])[1] : null;
  check("code uit de mail te lezen", !!code);

  // ── Foute code telt af; goede code tekent ──
  const fout = await j("POST", `/api/public/quote/${pubToken}`, { decision: "accept", code: "000000", name: "Jan" });
  check("foute code → OTP_INVALID met resterende pogingen", fout.status === 400 && fout.data.code === "OTP_INVALID" && fout.data.attemptsLeft === 4, fout.data.attemptsLeft);

  const signature = "data:image/png;base64," + Buffer.from("handtekening-pixels").toString("base64");
  const getekend = await j("POST", `/api/public/quote/${pubToken}`, { decision: "accept", code, name: "Jan Eindklant", signature });
  check("goede code + naam + handtekening → ondertekend en geverifieerd", getekend.status === 200 && getekend.data.status === "aanvaard" && getekend.data.verified === true, JSON.stringify(getekend.data));

  // ── Dossier ──
  const receipt = await j("GET", `/api/public/quote/${pubToken}/receipt`, null);
  const rc = receipt.data.receipt;
  check("ondertekeningsbewijs opvraagbaar", receipt.status === 200 && rc.signer.name === "Jan Eindklant" && rc.signer.verified === true && rc.signer.method === "email-otp");
  check("bewijs draagt versie + documentvingerafdruk, e-mail gemaskeerd", !!rc.document.documentHash && /•/.test(rc.signer.verifiedEmail) && rc.signer.hasDrawnSignature === true, rc.signer.verifiedEmail);

  const admin = await j("GET", `/api/tenants/${tid}/offertes`, null, tok);
  const adminQ = (admin.data.quotes || admin.data.offertes || []).find(x => x.id === q.id);
  check("beheerder ziet het geverifieerde record op de offerte", adminQ && adminQ.acceptance && adminQ.acceptance.verified === true && adminQ.acceptance.verifiedEmail === "eindklant@bedrijf.be");

  const nogEens = await j("POST", `/api/public/quote/${pubToken}`, { decision: "accept", code, name: "Jan" });
  check("verwerkte offerte kan niet opnieuw → 409", nogEens.status === 409);

  // ── Terugval: klant ZONDER e-mailadres → link-aanvaarding, eerlijk gemarkeerd ──
  const quote2 = await j("POST", `/api/tenants/${tid}/offertes`, {
    customerName: "Anonieme Klant", lines: [{ description: "Klus", qty: 1, unitPrice: 100, vatRate: 21 }], validUntil: "2099-01-01",
  }, tok);
  const q2 = quote2.data.quote || quote2.data.offerte;
  const send2 = await j("POST", `/api/tenants/${tid}/offertes/${q2.id}/send`, {}, tok);
  const pub2 = (send2.data.quote && send2.data.quote.publicToken) || q2.publicToken;
  const otp2 = await j("POST", `/api/public/quote/${pub2}/otp`, {});
  check("zonder dossieradres → NO_EMAIL_ON_FILE", otp2.status === 409 && otp2.data.code === "NO_EMAIL_ON_FILE", otp2.data.code);
  const linkAccept = await j("POST", `/api/public/quote/${pub2}`, { decision: "accept", name: "Anonieme Klant" });
  check("link-aanvaarding blijft werken, eerlijk verified:false", linkAccept.status === 200 && linkAccept.data.verified === false, JSON.stringify(linkAccept.data));

  console.log(failures === 0 ? "SMOKE OK" : `SMOKE FAALT: ${failures}`);
  exitSoft(failures === 0 ? 0 : 1);
})().catch(e => { console.error("FOUT:", e.message); exitSoft(1); });
