const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("auth: login gebruikt de nieuwe rustige toegangsshell", () => {
  const html = read("public/index.html");
  const css = read("public/css/auth.css");
  assert.match(html, /href="\/css\/auth\.css"/);
  assert.match(html, /class="login-page auth-v2"/);
  assert.match(html, /id="loginSubmit"/);
  assert.match(html, /data-toggle-password="loginPassword"/);
  assert.match(html, /id="ssoInline"/);
  assert.match(css, /\.auth-v2\.login-page/);
  assert.match(css, /@media \(max-width: 860px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test("auth: gebruikt de officiële Monargo Apex-assets en brandtokens", () => {
  const html = read("public/index.html");
  const css = read("public/css/auth.css");
  const symbol = read("public/brand/one-symbol.svg");
  const icon = read("public/icon.svg");
  assert.match(html, /src="\/brand\/one-symbol\.svg"/);
  assert.match(html, /<strong>One<\/strong><small>by Monargo<\/small>/);
  assert.match(symbol, /M150 392 L150 164 L320 84 L320 392/);
  assert.match(icon, /aria-label="One app icon"/);
  assert.match(css, /--monargo-ink: #0B1320/);
  assert.match(css, /--monargo-blue: #2563FF/);
  assert.match(css, /--monargo-soft-white: #F7F8FA/);
  assert.doesNotMatch(icon, /INTERIM|#0071e3/);
});

test("auth: proefperiode en resellerpad zijn zichtbaar; tarieven blijven uit de login", () => {
  const html = read("public/index.html");
  const source = read("public/main.js");
  assert.match(html, /id="authTrialBanner"/);
  assert.match(html, /id="showResellerApplyLogin"/);
  assert.match(html, /class="auth-value-section"/);
  assert.doesNotMatch(html, /data-auth-plan-price|auth-offer-grid/);
  assert.match(source, /async function loadAuthOffer\(\)/);
  assert.match(source, /api\("\/api\/plans"\)/);
  assert.match(source, /showRegisterForm\("reseller"\)/);
  assert.match(source, /registerLastStep\(\).*reseller.*\? 2 : 3/s);
  assert.match(source, /api\("\/api\/resellers\/apply"/);
});

test("auth: desktopcompositie gebruikt ruimte en verbergt de productpreview niet", () => {
  const html = read("public/index.html");
  const css = read("public/css/auth.css");
  const spacious = css.lastIndexOf("Ruime toegangservaring");
  assert.ok(spacious > -1);
  assert.match(html, /class="auth-value-section"/);
  assert.match(html, /auth\.valueInvoiceText/);
  assert.doesNotMatch(html, /auth-offer-section/);
  assert.match(css.slice(spacious), /min-height: 1120px/);
  assert.match(css.slice(spacious), /\.auth-workspace-card \{\s+display: block;/);
  assert.match(css.slice(spacious), /grid-template-columns: minmax\(720px, 58fr\) minmax\(560px, 42fr\)/);
  assert.match(css.slice(spacious), /\.auth-signup-choices \{[^}]*grid-template-columns: 1fr;/s);
});

test("auth: registratie is een navigeerbare driestappenflow", () => {
  const html = read("public/index.html");
  const source = read("public/main.js");
  for (const step of [1, 2, 3]) {
    assert.match(html, new RegExp(`data-reg-step="${step}"`));
    assert.match(html, new RegExp(`data-reg-go="${step}"`));
  }
  assert.match(source, /function setRegisterStep\(next\)/);
  assert.match(source, /function validateRegisterStep\(step\)/);
  assert.match(source, /setAuthView\("registerSuccess"\)/);
  assert.match(html, /id="registerSuccessMailState"/);
});

test("auth: herstel en SSO werken inline zonder browserprompt", () => {
  const source = read("public/main.js");
  const forgotStart = source.indexOf("let _recoveryMode");
  const registerStart = source.indexOf("let _registerMode");
  const ssoStart = source.indexOf('document.getElementById("ssoLoginBtn")');
  const ssoErrors = source.indexOf("const SSO_ERRORS");
  assert.ok(forgotStart > -1 && registerStart > forgotStart);
  assert.doesNotMatch(source.slice(forgotStart, registerStart), /\bprompt\(/);
  assert.ok(ssoStart > -1 && ssoErrors > ssoStart);
  assert.doesNotMatch(source.slice(ssoStart, ssoErrors), /\bprompt\(/);
  assert.match(source, /showRecoveryForm\("activation"\)/);
});

test("auth: testomgeving belooft geen mail die niet verstuurd kan worden", () => {
  const source = read("public/main.js");
  assert.match(source, /E-mailverzending is in deze testomgeving niet actief/);
  assert.match(source, /Het account blijft pending/);
  assert.match(source, /Je bestaande wachtwoorden zijn niet gewijzigd/);
  assert.match(source, /result\.activationLink/);
});

test("auth: publieke Render-preview is herkenbaar als test, niet als ontwikkelomgeving", () => {
  const source = read("public/main.js");
  const css = read("public/styles.css");
  assert.match(source, /const TEST_HOSTS = \["workflow-pro-w6v1\.onrender\.com"\]/);
  assert.match(source, /if \(isTestHost && \(!env \|\| env === "production"\)\) env = "test"/);
  assert.match(source, /bar\.textContent = "Testomgeving"/);
  assert.match(css, /\.env-banner\{position:absolute;left:auto;right:152px;top:34px;bottom:auto/);
  assert.doesNotMatch(css, /\.env-banner\{position:fixed;left:0;right:0/);
});

test("auth: pakketkaarten tonen hun volledige inhoud vóór de keuze", () => {
  const source = read("public/main.js");
  const css = read("public/css/auth.css");
  assert.match(source, /class="reg-plan-details"/);
  assert.match(source, /class="reg-plan-features"/);
  assert.match(source, /featureLabels\(p\)/);
  assert.match(source, /includedSeats/);
  assert.match(css, /\.auth-v2 \.reg-plan-features/);
  assert.match(css, /grid-template-columns: 1fr/);
});

test("auth: publieke flows blijven drietalig", () => {
  const source = read("public/js/i18n.js");
  for (const key of [
    "auth.storyTitle",
    "auth.valueTitle",
    "auth.valueInvoiceText",
    "auth.trialTitle",
    "auth.resellerChoiceSub",
    "forgot.title",
    "reg.stepCompany",
    "reg.activationHint",
    "reg.activationHintTest",
    "reg.includedTitle",
    "reg.includedSeats",
    "reg.planDescription.business",
    "reg.successTitle",
    "reseller.introTitle",
    "reseller.successTitle",
    "reset.kicker"
  ]) {
    const matches = source.match(new RegExp(`"${key.replace(".", "\\.")}"`, "g")) || [];
    assert.equal(matches.length, 3, `${key} bestaat in NL, FR en EN`);
  }
  assert.match(read("public/main.js"), /wfp:langchange", refreshRegisterMailHint/);
});
