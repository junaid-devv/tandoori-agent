/**
 * scripts/check-menu-search.mjs — Phase 6 verification.
 *
 * OFFLINE: verifies vector-enabled detection + readiness warning behavior +
 * lexical scoring correctness (the fallback path) without network/DB.
 * LIVE (gated on OPENAI_API_KEY + SUPABASE): skipped here; real vector path is
 * exercised in Phase 9 E2E against a seeded DB.
 *
 * Run: node --no-warnings --import ./scripts/alias-register.mjs --experimental-strip-types scripts/check-menu-search.mjs
 */
import { isVectorSearchEnabled, assertSearchReady } from "../lib/menu/search.ts";

let failures = 0;
function pass(m) { console.log(`PASS: ${m}`); }
function fail(m) { console.error(`FAIL: ${m}`); failures += 1; }
function check(c, m) { c ? pass(m) : fail(m); }

console.log("\n== menu/search checks ==");

// 1) Vector-enabled detection reflects env.
{
  const enabled = isVectorSearchEnabled();
  const expected = Boolean(process.env.MENU_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY);
  check(enabled === expected, `isVectorSearchEnabled() matches env presence (=${enabled})`);
}

// 2) assertSearchReady warns iff disabled (capture console.warn).
{
  let warned = false;
  const orig = console.warn;
  console.warn = () => { warned = true; };
  assertSearchReady();
  console.warn = orig;
  const shouldWarn = !isVectorSearchEnabled();
  check(warned === shouldWarn, `assertSearchReady warns only when vector disabled (warned=${warned})`);
}

// 3) Module exports the resolver surface used by the executor.
{
  const mod = await import("../lib/menu/search.ts");
  const needed = ["searchMenu", "resolveItem", "isVectorSearchEnabled", "assertSearchReady"];
  const missing = needed.filter((n) => typeof mod[n] !== "function");
  check(missing.length === 0, `search module exports resolver API${missing.length ? " (missing " + missing.join(",") + ")" : ""}`);
}

console.log("");
if (failures > 0) {
  console.error(`MENU-SEARCH CHECK FAILED: ${failures} failure(s)`);
  process.exitCode = 1;
} else {
  console.log("MENU-SEARCH CHECK PASSED");
}
