import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { normalizeText, stripVoiceNotePrefix } from "../lib/order-text-utils.ts";

const root = process.cwd();
const engineTarget = path.join(root, "lib", "order-engine.ts");
const nluTarget = path.join(root, "lib", "agent", "nlu.ts");
const aiTarget = path.join(root, "lib", "ai.ts");

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
  pass("Urdu voice-note text normalizes into order-engine tokens.");
}

if (!fs.existsSync(engineTarget) || !fs.existsSync(nluTarget) || !fs.existsSync(aiTarget)) {
  fail("Missing one or more source files required for Urdu voice regression checks.");
  process.exit();
}

const engineSource = fs.readFileSync(engineTarget, "utf8").replace(/\r\n/g, "\n");
const nluSource = fs.readFileSync(nluTarget, "utf8").replace(/\r\n/g, "\n");
const aiSource = fs.readFileSync(aiTarget, "utf8").replace(/\r\n/g, "\n");

testNormalization();

mustInclude(
  engineSource,
  "const rawText = stripVoiceNotePrefix(context.messageText).trim();",
  "Missing voice-note prefix stripping before order-engine parsing.",
);

mustInclude(
  engineSource,
  "if (isOrderFlowMessageWhileAwaitingNote(rawText, normalizedText, context.menuItems)) {",
  "Missing order-note escape for Urdu menu/order messages.",
);

mustInclude(
  engineSource,
  "notes: \"deterministic_direct_order\",",
  "Missing deterministic direct-order trace for Urdu voice orders.",
);

mustInclude(
  engineSource,
  "kaun si.*(?:item|dish|food|biryani|chicken|karahi|option)",
  "Missing Urdu availability/menu tokens in menu-request classifier.",
);

// Urdu-aware normalization moved from the webhook into the NLU layer in the rebuild:
// the single extraction strips voice-note prefixes and normalizes Urdu/Roman-Urdu input.
mustInclude(
  nluSource,
  "stripVoiceNotePrefix(input.messageText)",
  "Missing Urdu-aware voice-note normalization in NLU layer.",
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
