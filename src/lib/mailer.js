/**
 * WorkFlow Pro – e-mail transport
 *
 * Strategie:
 *  - Dev  (EMAIL_PROVIDER=log of niet gezet): print e-mail naar console, geen echte verzending.
 *  - Productie met SMTP   (EMAIL_PROVIDER=smtp): gebruik Node's net/tls + SMTP AUTH LOGIN.
 *  - Productie met Resend (EMAIL_PROVIDER=resend): gebruik Resend REST API (https://resend.com).
 *  - Productie met SendGrid (EMAIL_PROVIDER=sendgrid): gebruik SendGrid Mail Send API.
 *
 * Vereiste env-vars per provider:
 *   SMTP:      SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
 *   Resend:    RESEND_API_KEY, EMAIL_FROM
 *   SendGrid:  SENDGRID_API_KEY, EMAIL_FROM
 *
 * Optioneel: EMAIL_PROVIDER=log → altijd naar console (handig voor staging).
 */

const https = require("https");

const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || "log").toLowerCase();
const EMAIL_FROM     = process.env.EMAIL_FROM || "WorkFlow Pro <noreply@workflowpro.app>";

// Runtime-config (gezet door de server vanuit de platform-config in de DB).
// Heeft voorrang op env-vars zodat de super-admin sleutels live kan wijzigen.
let RUNTIME = null;
function setRuntimeConfig(emailCfg) {
  if (!emailCfg) { RUNTIME = null; return; }
  RUNTIME = {
    provider: String(emailCfg.provider || "").toLowerCase() || null,
    apiKey: emailCfg.apiKey || null,
    from: emailCfg.from || null,
  };
}
function activeProvider() { return (RUNTIME && RUNTIME.provider) || EMAIL_PROVIDER; }
function activeFrom() { return (RUNTIME && RUNTIME.from) || EMAIL_FROM; }
function activeKey() { return (RUNTIME && RUNTIME.apiKey) || null; }
function realKey(envName) {
  const k = activeKey() || process.env[envName];
  return (k && !/DUMMY/.test(k)) ? k : null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function jsonPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        ...headers
      }
    }, res => {
      let raw = "";
      res.on("data", c => { raw += c; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, status: res.statusCode });
        } else {
          reject(new Error(`E-mail API ${res.statusCode}: ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── Providers ──────────────────────────────────────────────────────────────────

async function sendViaLog(mail) {
  console.log(`\n📧 [MAIL – ${new Date().toISOString()}]`);
  console.log(`   Aan  : ${mail.to}`);
  console.log(`   Van  : ${mail.from || EMAIL_FROM}`);
  console.log(`   Onderwerp: ${mail.subject}`);
  console.log(`   ─────────────────────────────`);
  // Geef de tekst-body wanneer HTML niet nodig is voor logging
  const body = mail.text || mail.html?.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim() || "(leeg)";
  console.log(`   ${body.slice(0, 400)}`);
  console.log();
  return { ok: true, provider: "log" };
}

async function sendViaResend(mail) {
  const key = realKey("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY is niet geconfigureerd (nog dummy)");
  return jsonPost("api.resend.com", "/emails", { Authorization: `Bearer ${key}` }, {
    from: mail.from || activeFrom(),
    to: Array.isArray(mail.to) ? mail.to : [mail.to],
    subject: mail.subject,
    html: mail.html,
    text: mail.text
  }).then(() => ({ ok: true, provider: "resend" }));
}

async function sendViaSendGrid(mail) {
  const key = realKey("SENDGRID_API_KEY");
  if (!key) throw new Error("SENDGRID_API_KEY is niet geconfigureerd (nog dummy)");
  const to = Array.isArray(mail.to) ? mail.to : [mail.to];
  return jsonPost("api.sendgrid.com", "/v3/mail/send", { Authorization: `Bearer ${key}` }, {
    personalizations: [{ to: to.map(e => ({ email: e })) }],
    from: { email: EMAIL_FROM.replace(/.*<(.+?)>/, "$1"), name: "WorkFlow Pro" },
    subject: mail.subject,
    content: [
      ...(mail.html ? [{ type: "text/html", value: mail.html }] : []),
      { type: "text/plain", value: mail.text || mail.subject }
    ]
  }).then(() => ({ ok: true, provider: "sendgrid" }));
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Stuur een e-mail.
 * @param {object} mail  - { to, subject, html, text, from? }
 * @returns {Promise<{ok:boolean, provider:string}>}
 */
async function sendMail(mail) {
  if (!mail?.to || !mail?.subject) {
    throw new Error("sendMail: 'to' en 'subject' zijn verplicht");
  }

  const provider = activeProvider();
  try {
    switch (provider) {
      case "resend":    return await sendViaResend(mail);
      case "sendgrid":  return await sendViaSendGrid(mail);
      default:          return await sendViaLog(mail);   // "log" + onbekende waarden
    }
  } catch (err) {
    // E-mail-fouten loggen maar NOOIT de request laten crashen; val terug op log
    console.error(`[mailer] Verzenden mislukt (${provider}): ${err.message} — fallback naar log`);
    await sendViaLog(mail).catch(() => {});
    return { ok: false, provider, error: err.message };
  }
}

/**
 * Brand-aware HTML-wrapper.
 * Gebruik: wrapHtml("Onderwerp", "<p>Inhoud</p>")
 */
function wrapHtml(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
  body{margin:0;padding:0;background:#f1f5f9;font-family:system-ui,-apple-system,sans-serif;color:#0f172a}
  .wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
  .header{background:#4f46e5;padding:24px 28px;display:flex;align-items:center;gap:12px}
  .header-logo{width:36px;height:36px;background:#fff;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:#4f46e5}
  .header-title{color:#fff;font-size:17px;font-weight:600;margin:0}
  .body{padding:28px}
  .body h2{font-size:16px;font-weight:600;margin:0 0 12px}
  .body p{line-height:1.6;margin:0 0 12px;color:#334155}
  .pill{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600}
  .pill-pending{background:#fef9c3;color:#713f12}
  .pill-approved{background:#dcfce7;color:#14532d}
  .pill-rejected{background:#fee2e2;color:#7f1d1d}
  .detail-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin:16px 0}
  .detail-row{display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px}
  .detail-row:last-child{margin-bottom:0}
  .detail-label{color:#64748b}
  .detail-value{font-weight:500;color:#0f172a;text-align:right;max-width:55%}
  .cta{display:inline-block;margin-top:16px;padding:10px 20px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600}
  .footer{padding:16px 28px;border-top:1px solid #f1f5f9;font-size:11px;color:#94a3b8}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="header-logo">WP</div>
    <h1 class="header-title">WorkFlow Pro</h1>
  </div>
  <div class="body">
    ${bodyHtml}
  </div>
  <div class="footer">
    WorkFlow Pro · ${new Date().getFullYear()} ·
    Dit bericht is automatisch gegenereerd, antwoord niet op dit e-mailadres.
  </div>
</div>
</body>
</html>`;
}

module.exports = { sendMail, wrapHtml, EMAIL_FROM, setRuntimeConfig };
