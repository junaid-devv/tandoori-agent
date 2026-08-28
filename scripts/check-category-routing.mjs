/**
 * scripts/check-category-routing.mjs — Phase 9 repoint
 *
 * In the rebuild, category routing & menu browsing are handled by:
 *  1. NLU taxonomy: browse_menu, ask_item_info, ask_recommendation
 *  2. Search layer: hybrid vector & lexical menu search (searchMenu)
 *  3. Executor: show_menu & answer_info actions that set last_shown_options
 *  4. Pipeline: numeric fast-path for selecting presented category/menu options
 *  5. Interactive builders: buildInteractiveListForPresentedOptions
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const nluPath = path.join(root, "lib", "agent", "nlu.ts");
const searchPath = path.join(root, "lib", "menu", "search.ts");
const executorPath = path.join(root, "lib", "agent", "executor.ts");
const pipelinePath = path.join(root, "lib", "agent", "pipeline.ts");
const builderPath = path.join(root, "lib", "webhook-interactive-builders.ts");

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

for (const filePath of [nluPath, searchPath, executorPath, pipelinePath, builderPath]) {
  if (!fs.existsSync(filePath)) {
    fail(`Missing required file: ${filePath}`);
    process.exit(1);
  }
}

const nlu = fs.readFileSync(nluPath, "utf8");
const search = fs.readFileSync(searchPath, "utf8");
const executor = fs.readFileSync(executorPath, "utf8");
const pipeline = fs.readFileSync(pipelinePath, "utf8");
const builder = fs.readFileSync(builderPath, "utf8");

// 1) NLU menu & category intents
mustInclude(nlu, "browse_menu", "Missing browse_menu intent in NLU taxonomy.");
mustInclude(nlu, "ask_recommendation", "Missing ask_recommendation intent in NLU taxonomy.");
mustInclude(nlu, "ask_item_info", "Missing ask_item_info intent in NLU taxonomy.");

// 2) Search menu supports queries & categories
mustInclude(search, "export async function searchMenu", "Missing searchMenu in search layer.");

// 3) Executor handles show_menu & answer_info actions
mustInclude(executor, "case \"show_menu\":", "Missing show_menu action in executor.");
mustInclude(executor, "case \"answer_info\":", "Missing answer_info action in executor.");
mustInclude(executor, "last_shown_options", "Missing last_shown_options assignment in executor.");

// 4) Pipeline fast-path
mustInclude(pipeline, "NUMERIC_RE", "Missing numeric fast-path in pipeline.");
mustInclude(pipeline, "last_shown_options", "Missing last_shown_options fast-path in pipeline.");

// 5) Interactive list builder for presented options
mustInclude(builder, "buildInteractiveListForPresentedOptions", "Missing buildInteractiveListForPresentedOptions builder.");

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}
