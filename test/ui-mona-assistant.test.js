const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "public", "js", "boden-widget.js"), "utf8");

test("de gedeelde assistent presenteert zich consequent als Mona", () => {
  assert.match(source, /Mona · AI-assistent chat-widget/);
  assert.match(source, /<div class="av">M<\/div>/);
  assert.doesNotMatch(source, /<div class="av">B<\/div>/);
});

test("Mona heeft leesbare berichten en bevestigingsacties", () => {
  assert.match(source, /\.boden-msg\{max-width:88%;padding:10px 12px;border-radius:10px;font-size:14px/);
  assert.match(source, /\.boden-prop button\{min-height:36px;background:var\(--wf-blue\)/);
  assert.match(source, /\.boden-foot input\{flex:1;min-width:0;height:42px/);
});

test("Mona blijft beschikbaar zonder het dashboard visueel te domineren", () => {
  assert.match(source, /#bodenFab\{[^}]*width:44px;height:44px;border-radius:10px/);
  assert.match(source, /background:#111827;color:#fff/);
  assert.doesNotMatch(source, /width:58px;height:58px/);
});

test("Mona is toegankelijk en mobiel schermvullend", () => {
  assert.match(source, /aria-controls", "bodenPanel"/);
  assert.match(source, /role", "dialog"/);
  assert.match(source, /@media\(max-width:560px\)/);
  assert.match(source, /aria-expanded", String\(_open\)/);
});
