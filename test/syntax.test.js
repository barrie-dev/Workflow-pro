"use strict";
// Syntax-sweep: node --check op ELKE .js onder public/, src/ en scripts/.
// Vangt regressies zoals de domain-screens.js JSX-bug die de hele pagina brak.
const { test } = require("node:test");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith(".js")) acc.push(full);
  }
  return acc;
}

const files = ["public", "src", "scripts"].flatMap(d => walk(path.join(root, d)));

for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, "/");
  test(`syntax ok: ${rel}`, () => {
    // execFileSync gooit met de stderr (SyntaxError) als --check faalt → test faalt.
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  });
}
