import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const engineTarget = path.join(root, "lib", "order-engine.ts");

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

if (!fs.existsSync(engineTarget)) {
  fail(`Missing target file: ${engineTarget}`);
  process.exit();
}

const source = fs.readFileSync(engineTarget, "utf8").replace(/\r\n/g, "\n");

mustInclude(
  source,
  "const likelyDirectOrderMessage =\n    forceDirectOrderResolution || isLikelyDirectOrderRequest(rawText, normalizedText, interpretation, menuItems);",
  "Missing direct-order message gate assignment.",
);

mustInclude(
  source,
  "const deterministicDirectHints = resolveRequestedItems([], [], menuItems, rawText, context.semanticMatches);",
  "Missing deterministic direct-order fallback hints extraction.",
);

mustInclude(
  source,
  "const forceDirectOrderResolution =\n    hasDirectOrderVerb(normalizedText) &&\n    (deterministicDirectHints.matched.length > 0 || deterministicDirectHints.ambiguous.length > 0);",
  "Missing hard direct-order resolution bypass condition.",
);

mustInclude(
  source,
  "trace.notes = trace.notes ? `${trace.notes} | forced_direct_order` : \"forced_direct_order\";",
  "Missing forced direct-order trace note for diagnostics.",
);

mustInclude(
  source,
  "if (state.workflow_step === \"awaiting_delivery_address\") {",
  "Missing awaiting-delivery-address guard block.",
);

mustInclude(
  source,
  "if (!wantsCartMutation && !explicitMenuBrowse) {",
  "Missing address-step protection against accidental menu lookup.",
);

mustInclude(
  source,
  "workflow_step: \"awaiting_delivery_address\",",
  "Missing explicit state persistence for delivery-address guard reply.",
);

mustInclude(
  source,
  "const directLookupQuery =\n    !likelyDirectOrderMessage &&",
  "Missing direct-order guard before standalone lookup query.",
);

mustInclude(
  source,
  "if (\n    !likelyDirectOrderMessage &&\n    (\n      interpretation.asks_menu ||\n      interpretation.intent === \"browse_menu\" ||\n      isLikelyMenuRequest(normalizedText)\n    )\n  ) {",
  "Missing guarded menu branch for direct-order messages.",
);

mustInclude(
  source,
  "if (!likelyDirectOrderMessage && (interpretation.intent === \"category_question\" || interpretation.category_query)) {",
  "Missing guarded category-question branch for direct-order messages.",
);

mustInclude(
  source,
  "if (state.last_presented_category === \"__category_list__\" && !likelyDirectOrderMessage) {",
  "Missing category-list-context guard for direct-order messages.",
);

mustInclude(
  source,
  "function isLikelyDirectOrderRequest(",
  "Missing direct-order classifier helper.",
);

mustInclude(
  source,
  "const delimitedInline = findInlineItemsFromDelimitedClauses(rawText, menuItems);",
  "Missing delimited parser usage in direct-order classifier.",
);

mustInclude(
  source,
  "if (delimitedInline.hasDelimitedInput && (delimitedInline.requests.length > 0 || delimitedInline.ambiguous.length > 0)) {",
  "Missing ambiguity-aware direct-order classifier condition.",
);

mustInclude(
  source,
  "function findInlineItemsFromDelimitedClauses(",
  "Missing delimited inline item parser helper.",
);

mustInclude(
  source,
  "const clauseQtyHint = extractClauseQuantityHint(segment);",
  "Missing per-clause quantity hint extraction for delimited orders.",
);

mustInclude(
  source,
  "qty: clauseQtyHint ?? segmentMatches[0].qty,",
  "Missing per-clause quantity override when segment item is matched.",
);

mustInclude(
  source,
  "function extractClauseQuantityHint(rawClause: string): number | null {",
  "Missing clause quantity hint helper.",
);

mustInclude(
  source,
  "/^(?:qty|quantity|x)\\s*(\\d{1,2}|aik|ek|do|teen|char|chaar|panj|paanch|cheh|chay|saat|aath|ath|das)\\b/i",
  "Missing Roman Urdu quantity-word support in clause quantity helper.",
);

mustInclude(
  source,
  ".split(/\\s*(?:,|&|\\+|\\b(?:and|aur|or)\\b)\\s*/i)",
  "Missing multi-clause split for and/or/aur-delimited orders.",
);

mustInclude(
  source,
  "const suggestions = findLikelyMenuSuggestions(segment, menuItems, 3);",
  "Missing per-segment ambiguity suggestion extraction.",
);

mustInclude(
  source,
  "if (\n    matchedAdds.ambiguous.length > 0 &&\n    (matchedAdds.matched.length > 0 || removeRequests.length > 0 || qtyUpdates.length > 0)\n  ) {",
  "Missing partial-ambiguity handling branch (known items + clarify unknown).",
);

mustInclude(
  source,
  "buildAmbiguousItemReply(firstAmbiguous.query, firstAmbiguous.options, prefersRomanUrdu)",
  "Missing ambiguous clarification prompt in partial-ambiguity branch.",
);

mustInclude(
  source,
  "last_presented_options: firstAmbiguous.options,",
  "Missing option-presentation state patch for ambiguous follow-up.",
);

mustInclude(
  source,
  ": inlineParsed.hasDelimitedInput\n          ? inlineParsed.requests\n          : findInlineItems(rawText, menuItems);",
  "Missing delimited-request priority in item resolution.",
);

mustInclude(
  source,
  "if (forceDirectOrderResolution) {\n    matchedAdds = mergeMatchedItemsResults(matchedAdds, deterministicDirectHints);\n  }",
  "Missing merge of deterministic hints into final matched adds.",
);

mustInclude(
  source,
  "skipUpsell?: boolean;",
  "Missing optional skipUpsell flag in logistics/summary builder params.",
);

mustInclude(
  source,
  "!params.skipUpsell &&",
  "Missing upsell short-circuit for direct mixed-text order path.",
);

mustInclude(
  source,
  "skipUpsell: forceDirectOrderResolution,",
  "Missing direct-order skipUpsell wiring at cart-mutation reply path.",
);

mustInclude(
  source,
  "function mergeMatchedItemsResults(left: MatchedItemsResult, right: MatchedItemsResult): MatchedItemsResult {",
  "Missing matched-item results merge helper.",
);

mustInclude(
  source,
  "unknown: [...new Set(unknown)].slice(0, 5),\n    ambiguous,",
  "Missing explicit preservation of ambiguous entries in resolved result.",
);

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}
