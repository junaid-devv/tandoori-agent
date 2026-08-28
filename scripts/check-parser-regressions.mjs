/**
 * scripts/check-parser-regressions.mjs — Phase 9 repoint
 *
 * Checks parser and extraction invariants in the rebuilt architecture:
 * 1) Text utils: Ice-cream alias normalization
 * 2) NLU schema & rules: structured extraction for items, removals, confirm_order
 * 3) Menu search: conservative match threshold & resolveItem helper
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const textUtilsTarget = path.join(root, "lib", "order-text-utils.ts");
const nluTarget = path.join(root, "lib", "agent", "nlu.ts");
const searchTarget = path.join(root, "lib", "menu", "search.ts");

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

for (const target of [textUtilsTarget, nluTarget, searchTarget]) {
  if (!fs.existsSync(target)) {
    fail(`Missing target file: ${target}`);
    process.exit(1);
  }
}

const textUtilsSource = fs.readFileSync(textUtilsTarget, "utf8").replace(/\r\n/g, "\n");
const nluSource = fs.readFileSync(nluTarget, "utf8").replace(/\r\n/g, "\n");
const searchSource = fs.readFileSync(searchTarget, "utf8").replace(/\r\n/g, "\n");

// 1) Ice-cream alias normalization should stay in place.
mustInclude(
  textUtilsSource,
  ".replace(/\\bice[\\s-]?cream\\b/g, \"ice cream\")",
  "Missing ice-cream alias normalization in order-text-utils.",
);

// 2) NLU structured schema for items and removals
mustInclude(
  nluSource,
  "items: z.array(ItemMentionSchema)",
  "Missing items schema in NLU layer.",
);
mustInclude(
  nluSource,
  "removals: z.array(RemovalMentionSchema)",
  "Missing removals schema in NLU layer.",
);
mustInclude(
  nluSource,
  "\"confirm_order\"",
  "Missing confirm_order intent in NLU taxonomy.",
);

// 3) NLU few-shot examples for modify/remove differentiation
mustInclude(
  nluSource,
  "primary_intent: \"remove_items\"",
  "Missing remove_items few-shot handling in NLU.",
);

// 4) Conservative similarity threshold in menu search
mustInclude(
  searchSource,
  "SIMILARITY_THRESHOLD",
  "Missing SIMILARITY_THRESHOLD in menu search.",
);
mustInclude(
  searchSource,
  "export async function resolveItem",
  "Missing resolveItem in menu search.",
);

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}
