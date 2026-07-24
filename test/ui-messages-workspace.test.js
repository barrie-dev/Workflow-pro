"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Berichten woont sinds de uitsplitsing in een eigen bestand; de assertie
// hieronder gaat over het SCHERM, niet over de vindplaats.
const admin = fs.readFileSync(path.join(__dirname, "..", "public", "js", "platforms", "admin-berichten.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "public", "css", "admin.css"), "utf8");
const section = admin;

test("berichten zijn een gesprekworkspace en geen samengedrukte tabelpopup", () => {
  assert.match(section, /class="message-workspace"/);
  assert.match(section, /class="message-threads"/);
  assert.match(section, /class="message-stream-panel"/);
  assert.match(section, /class="message-card-detail"/);
  assert.doesNotMatch(section, /max-width:480px/);
  assert.doesNotMatch(section, /<table class="adm-table"/);
});

test("werfcontext en ontvangers volgen het bestaande berichtencontract", () => {
  assert.match(section, /venueId: fd\.get\("venueId"\) \|\| null/);
  assert.match(section, /payload\.recipientId = fd\.get\("recipientId"\)/);
  assert.match(section, /payload\.toRole = "employee"/);
  assert.match(section, /payload\.toRole = "manager"/);
  assert.match(section, /await api\("POST", "\/messages", payload\)/);
});

test("composer is ruim en leesbaar", () => {
  assert.match(section, /id="admMsgForm" class="message-compose-form"/);
  assert.match(section, /rows="9"/);
  assert.match(css, /\.adm-drawer:has\(#admMsgForm\)/);
  assert.match(css, /width:min\(1040px,calc\(100vw - 72px\)\)/);
  assert.match(css, /\.message-compose-form \.adm-form-group textarea/);
  assert.match(css, /min-height:190px/);
});

test("zoeken, werfgesprekken en uitklapbare berichtdetails zijn interactief", () => {
  assert.match(section, /id="msgSearch"/);
  assert.match(section, /data-thread=/);
  assert.match(section, /aria-expanded="false"/);
  assert.match(section, /classList\.toggle\("expanded"/);
});
