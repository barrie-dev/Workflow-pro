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

test("auth: proefperiode, pakketten en resellerpad zijn direct zichtbaar", () => {
  const html = read("public/index.html");
  const source = read("public/main.js");
  for (const plan of ["starter", "business", "enterprise"]) {
    assert.match(html, new RegExp(`data-auth-plan-key="${plan}"`));
  }
  assert.match(html, /id="authTrialBanner"/);
  assert.match(html, /id="showResellerApplyLogin"/);
  assert.match(source, /async function loadAuthOffer\(\)/);
  assert.match(source, /showRegisterForm\("reseller"\)/);
  assert.match(source, /registerLastStep\(\).*reseller.*\? 2 : 3/s);
  assert.match(source, /api\("\/api\/resellers\/apply"/);
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
  assert.match(source, /const TEST_HOSTS = \["workflow-pro-w6v1\.onrender\.com"\]/);
  assert.match(source, /if \(isTestHost && \(!env \|\| env === "production"\)\) env = "test"/);
  assert.match(source, /bar\.textContent = "Test · QA"/);
});

test("auth: publieke flows blijven drietalig", () => {
  const source = read("public/js/i18n.js");
  for (const key of [
    "auth.storyTitle",
    "auth.trialTitle",
    "auth.resellerChoiceSub",
    "forgot.title",
    "reg.stepCompany",
    "reg.activationHint",
    "reg.activationHintTest",
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
