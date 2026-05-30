const crypto = require("crypto");
const { config } = require("./config");

function key() {
  return crypto.createHash("sha256").update(config.encryptionKey).digest();
}

function encryptSecret(value) {
  if (!value) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptSecret(payload) {
  if (!payload) return "";
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt] = stored.split(":");
  const expected = hashPassword(password, salt);
  const left = Buffer.from(expected);
  const right = Buffer.from(stored);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function assertStrongPassword(password) {
  const value = String(password || "");
  const checks = [
    value.length >= 12,
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /\d/.test(value),
    /[^A-Za-z0-9]/.test(value)
  ];
  if (checks.every(Boolean)) return;
  const error = new Error("Wachtwoord moet minstens 12 tekens bevatten, met hoofdletter, kleine letter, cijfer en symbool.");
  error.status = 400;
  throw error;
}

module.exports = { encryptSecret, decryptSecret, hashPassword, verifyPassword, assertStrongPassword };
