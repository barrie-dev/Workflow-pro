const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "admin.css"), "utf8");

test("platformeditor vervangt de smalle zijlade door een gecentreerde werkruimte", () => {
  assert.match(css, /Monargo editor workspace · platformbreed/);
  assert.match(css, /left:50%/);
  assert.match(css, /width:min\(940px,calc\(100vw - 48px\)\)/);
  assert.match(css, /height:calc\(100dvh - 40px\)/);
  assert.match(css, /transform:translateX\(-50%\) translateY\(0\) scale\(1\)/);
});

test("facturen, offertes en werkbonnen krijgen een brede canvas", () => {
  assert.match(css, /\.adm-drawer:has\(#invForm\),/);
  assert.match(css, /\.adm-drawer:has\(#qForm\),/);
  assert.match(css, /\.adm-drawer:has\(#woForm\) \{ width:min\(1280px/);
  assert.match(css, /grid-template-columns:minmax\(260px,1fr\) 88px 140px 86px 38px/);
});

test("editor wordt een volledige mobiele werkruimte", () => {
  assert.match(css, /@media \(max-width:640px\)/);
  assert.match(css, /inset:0; width:100vw; height:100dvh; border:0; border-radius:0/);
  assert.match(css, /\.adm-drawer \.adm-form-row \{ grid-template-columns:1fr/);
  assert.match(css, /\.adm-drawer \.adm-document-line \.inv-line-desc \{ grid-column:1\/5; \}/);
});

test("editor is een toegankelijke werkruimte met context en toetsenbordsluiting", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "js", "platforms", "admin.js"), "utf8");
  assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="admDrawerTitle"/);
  assert.match(source, /id="admDrawerContext">Bewerkingsruimte/);
  assert.match(source, /isDocument \? "Documentwerkruimte" : "Bewerkingsruimte"/);
  assert.match(source, /e\.key === "Escape"/);
  assert.match(source, /classList\.add\("adm-editor-open"\)/);
});
