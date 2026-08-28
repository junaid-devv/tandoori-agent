/**
 * scripts/check-interactive-guards.mjs — Phase 9 repoint
 *
 * In the rebuild, interactive payload guards are spread across:
 *  - lib/branches.ts: UUID guard for branch selection, strict branch number match
 *  - app/api/webhook/route.ts: city/order-type button routing
 *  - lib/agent/pipeline.ts: numeric fast-path for presented options
 *
 * Assertions match the patterns that exist in the rebuilt files.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const branchesPath = path.join(root, "lib", "branches.ts");
const webhookPath = path.join(root, "app", "api", "webhook", "route.ts");
const pipelinePath = path.join(root, "lib", "agent", "pipeline.ts");

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

for (const filePath of [branchesPath, webhookPath, pipelinePath]) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing required file: ${filePath}`);
    process.exit(1);
  }
}

const branches = fs.readFileSync(branchesPath, "utf8");
const webhook = fs.readFileSync(webhookPath, "utf8");
const pipeline = fs.readFileSync(pipelinePath, "utf8");

// branches.ts: UUID guard prevents menu-item UUIDs from matching branch selections
const branchUuidComment = "Guard against UUID-like payloads from other interactive lists";
mustInclude(branches, branchUuidComment, "Missing UUID guard comment/context in branch parser.");

// branches.ts: strict branch number regex
const strictBranchNumberMatch = "const numberMatch = normalized.match(/^(?:branch|option|number)?\\s*(\\d{1,2})$/);";
mustInclude(branches, strictBranchNumberMatch, "Missing strict branch number parser regex.");

// webhook: city selection and order-type interactive routing
mustInclude(webhook, "handleBranchSelection", "Missing branch selection handler in webhook.");
mustInclude(webhook, "city", "Missing city-level routing in webhook.");

// pipeline: numeric fast-path guards presented-options selections
mustInclude(pipeline, "last_shown_options", "Missing last_shown_options numeric fast-path in pipeline.");
mustInclude(pipeline, "NUMERIC_RE", "Missing NUMERIC_RE pattern for fast-path in pipeline.");

// Webhook handles non-text/voice escalation
mustInclude(webhook, "handleNonText", "Missing non-text/voice handler in webhook.");

// No mojibake in branches
if (branches.includes("ØŸ")) {
  fail("Detected mojibake token 'ØŸ' in branches.ts.");
} else {
  pass("No mojibake token found in branches.ts.");
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}
