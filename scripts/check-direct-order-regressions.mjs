/**
 * scripts/check-direct-order-regressions.mjs — Phase 9 repoint
 *
 * Verifies direct-order invariants in the rebuilt architecture:
 * 1) NLU layer extracts structured item adds/removals with queries, quantities, sizes
 * 2) State machine transitions correctly into cart building and checkout stages
 * 3) Executor performs menu resolution (searchMenu / resolveItem) and cart mutations
 * 4) Pipeline executes fast-path numeric and full turn cycles
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const nluPath = path.join(root, "lib", "agent", "nlu.ts");
const stateMachinePath = path.join(root, "lib", "agent", "state-machine.ts");
const executorPath = path.join(root, "lib", "agent", "executor.ts");
const searchPath = path.join(root, "lib", "menu", "search.ts");
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

for (const filePath of [nluPath, stateMachinePath, executorPath, searchPath, pipelinePath]) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing required file: ${filePath}`);
    process.exit(1);
  }
}

const nlu = fs.readFileSync(nluPath, "utf8");
const sm = fs.readFileSync(stateMachinePath, "utf8");
const executor = fs.readFileSync(executorPath, "utf8");
const search = fs.readFileSync(searchPath, "utf8");
const pipeline = fs.readFileSync(pipelinePath, "utf8");

// 1) NLU structured output for direct ordering
mustInclude(nlu, "\"add_items\"", "Missing add_items intent in NLU.");
mustInclude(nlu, "\"remove_items\"", "Missing remove_items intent in NLU.");
mustInclude(nlu, "ItemMentionSchema", "Missing ItemMentionSchema in NLU.");
mustInclude(nlu, "query: z.string()", "Missing query field in ItemMentionSchema.");
mustInclude(nlu, "qty: z.number()", "Missing qty field in ItemMentionSchema.");

// 2) State machine stages and actions for direct ordering
mustInclude(sm, "building_cart", "Missing building_cart stage in state machine.");
mustInclude(sm, "add_items", "Missing add_items action in state machine.");
mustInclude(sm, "confirming", "Missing confirming stage in state machine.");

// 3) Executor handles item resolution and cart mutations
mustInclude(executor, "resolveItem", "Missing resolveItem in executor.");
mustInclude(executor, "searchMenu", "Missing searchMenu in executor.");
mustInclude(executor, "addToCart", "Missing addToCart in executor.");
mustInclude(executor, "removeFromCart", "Missing removeFromCart in executor.");
mustInclude(executor, "updateQuantity", "Missing updateQuantity in executor.");

// 4) Hybrid search with vector & lexical fallbacks
mustInclude(search, "match_menu_items_by_embedding", "Missing match_menu_items_by_embedding RPC in search.");
mustInclude(search, "resolveItem", "Missing resolveItem helper in search.");

// 5) Pipeline fast-path
mustInclude(pipeline, "last_shown_options", "Missing last_shown_options fast path in pipeline.");

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}
