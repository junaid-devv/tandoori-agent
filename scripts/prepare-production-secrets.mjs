import crypto from "node:crypto";
import fs from "node:fs";
import dotenv from "dotenv";

const targetFile = ".env.local";
const shouldWrite = process.argv.includes("--write-local");

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function isWeakSecret(value, minLength) {
  const raw = String(value ?? "").trim();
  const normalized = raw.toLowerCase();
  return (
    raw.length < minLength ||
    normalized.includes("replace_with") ||
    normalized.includes("xxxxxxxx")
  );
}

function updateEnvText(text, updates) {
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match) return line;

    const key = match[1];
    if (!(key in updates)) return line;

    seen.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }

  return nextLines.join("\n").replace(/\n*$/, "\n");
}

if (!fs.existsSync(targetFile)) {
  console.error(`FAIL: ${targetFile} does not exist. Copy .env.example first.`);
  process.exit(1);
}

const originalText = fs.readFileSync(targetFile, "utf8");
const parsed = dotenv.parse(originalText);
const updates = {};

if (isWeakSecret(parsed.WHATSAPP_VERIFY_TOKEN, 24)) {
  updates.WHATSAPP_VERIFY_TOKEN = randomSecret(24);
}

if (isWeakSecret(parsed.RATE_LIMIT_HASH_SECRET, 32)) {
  updates.RATE_LIMIT_HASH_SECRET = randomSecret(32);
}

if (Object.keys(updates).length === 0) {
  console.log("PASS: Local production secrets already look strong enough.");
  process.exit(0);
}

if (!shouldWrite) {
  console.log(`Would update ${Object.keys(updates).join(", ")} in ${targetFile}. Re-run with --write-local to apply.`);
  process.exit(0);
}

fs.writeFileSync(targetFile, updateEnvText(originalText, updates));
console.log(`PASS: Updated ${Object.keys(updates).join(", ")} in ${targetFile}.`);
if ("WHATSAPP_VERIFY_TOKEN" in updates) {
  console.log("ACTION REQUIRED: Update the Meta webhook verify token to match the new local value before webhook verification.");
}
