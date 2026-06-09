const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

const dbPath = path.join(__dirname, "../data/workflowpro-fullstack.json");
const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));

const newPass = "Demo2026!";
const targets = [
  "admin@demobouw.be",
  "manager@demobouw.be",
  "jan@demobouw.be",
  "sara@demobouw.be",
  "super@workflowpro.be"
];

targets.forEach(email => {
  const user = db.users.find(u => u.email === email);
  if (user) {
    user.passwordHash = hashPassword(newPass);
    user.mfaEnabled = false;
    user.mfaSecret = null;
    user.mfaPendingSecret = null;
    user.loginAttempts = 0;
    user.lockedUntil = null;
    console.log("✓ Reset:", email);
  } else {
    console.log("✗ Not found:", email);
  }
});

fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
console.log("\nDone. Wachtwoord voor alle demo-gebruikers: " + newPass);
