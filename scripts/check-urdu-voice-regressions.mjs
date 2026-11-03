import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { normalizeText, stripVoiceNotePrefix } from "../lib/order-text-utils.ts";
import { containsUrduScript, inferLanguagePreference } from "../lib/core/lang-detect.ts";

const root = process.cwd();
const langDetectTarget = path.join(root, "lib", "core", "lang-detect.ts");
const nluTarget = path.join(root, "lib", "agent", "nlu.ts");
const aiTarget = path.join(root, "lib", "ai.ts");
const webhookTarget = path.join(root, "app", "api", "webhook", "route.ts");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function mustInclude(source, token, message) {
  if (!source.includes(token)) {
    fail(message);
    return false;
  }
  pass(message.replace("Missing", "Found"));
  return true;
}

function testNormalization() {
  assert.equal(stripVoiceNotePrefix("[Voice note] مینو"), "مینو");
  assert.equal(normalizeText("[Voice note] مینو"), "menu");
  assert.equal(normalizeText("[Voice note] ایک ہاف چکن کڑاہی کر دو"), "ek half chicken karahi kar do");
  assert.equal(
    normalizeText("[Voice note] بریانی میں اور کوئی آپشن اویلیبل ہے"),
    "biryani mein aur koi option available",
  );
  assert.equal(containsUrduScript("ایک ہاف چکن کڑاہی کر دو"), true);
  assert.equal(containsUrduScript("one chicken karahi"), false);
  assert.equal(inferLanguagePreference("ایک ہاف چکن کڑاہی کر دو"), "roman_urdu");
  assert.equal(inferLanguagePreference("kya haal hai bhai"), "roman_urdu");
  assert.equal(inferLanguagePreference("hello please deliver"), "english");
  assert.equal(inferLanguagePreference("ایک مسالہ فرائز اور ایک فرینڈ فرائز۔", "roman_urdu"), "roman_urdu");
  assert.equal(inferLanguagePreference("ٹماٹر اور ٹھنڈی بوتل", "english"), "roman_urdu");
  assert.equal(inferLanguagePreference("ڈلیوری کر دیں", "english"), "roman_urdu");
  assert.equal(inferLanguagePreference("څومره غواړم"), "roman_urdu");
  pass("Urdu voice-note and script normalization functions verified.");
}

for (const target of [langDetectTarget, nluTarget, aiTarget, webhookTarget]) {
  if (!fs.existsSync(target)) {
    fail(`Missing required file: ${target}`);
    process.exit(1);
  }
}

const langDetectSource = fs.readFileSync(langDetectTarget, "utf8").replace(/\r\n/g, "\n");
const nluSource = fs.readFileSync(nluTarget, "utf8").replace(/\r\n/g, "\n");
const aiSource = fs.readFileSync(aiTarget, "utf8").replace(/\r\n/g, "\n");
const webhookSource = (fs.readFileSync(webhookTarget, "utf8") + fs.readFileSync(path.join(root, "lib", "whatsapp-inbound.ts"), "utf8")).replace(/\r\n/g, "\n");

testNormalization();

mustInclude(
  langDetectSource,
  "export function containsUrduScript",
  "Missing containsUrduScript in lang-detect.",
);

mustInclude(
  langDetectSource,
  "export function inferLanguagePreference",
  "Missing inferLanguagePreference in lang-detect.",
);

// Urdu-aware normalization in NLU
mustInclude(
  nluSource,
  "stripVoiceNotePrefix(input.messageText)",
  "Missing Urdu-aware voice-note normalization in NLU layer.",
);

// Voice note handling in webhook
mustInclude(
  webhookSource,
  "handleNonText",
  "Missing handleNonText in webhook route.",
);

mustInclude(
  aiSource,
  "مینیو/مینو = Menu",
  "Missing AI prompt support for مینو menu variant.",
);

mustInclude(
  aiSource,
  "آپشن/اوشن/اویشن = Option",
  "Missing AI prompt support for Urdu option transcription variants.",
);

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}
