/** Read-only verification against the configured database. No orders/messages. */
import assert from "node:assert/strict";
import fs from "node:fs";
import dotenv from "dotenv";
for (const path of [".env.production.local", ".env.local", ".env"]) {
  if (fs.existsSync(path)) dotenv.config({ path, override: false, quiet: true });
}
const { supabaseAdmin } = await import("../lib/supabase-admin.ts");
const { getMenuCatalog } = await import("../lib/menu.ts");
const { resolveItemDetailed } = await import("../lib/menu/search.ts");
const { catalogQuestionMatches } = await import("../lib/agent/questions.ts");
const { data: branches, error } = await supabaseAdmin.from("branches").select("id").eq("is_active", true);
if (error) throw error;
assert.ok(branches?.length, "At least one active branch is required");
let verified = 0;
for (const branch of branches) {
  const catalog = await getMenuCatalog(branch.id);
  assert.ok(catalog.length, "An active branch has an empty priced catalog");
  for (const item of catalog) {
    assert.ok(Number.isFinite(item.price) && item.price >= 0, "Catalog contains an invalid price");
    if (!item.is_available) continue;
    const result = await resolveItemDetailed(branch.id, item.name, null, catalog);
    assert.equal(result.kind, "exact", `Cannot resolve stored catalog name: ${item.name}`);
    assert.equal(result.item.id, item.id, `Wrong SKU for stored catalog name: ${item.name}`);
    assert.equal(result.item.price, item.price);
    assert.equal(result.item.method, "lexical", "A named item should not require embeddings");
    verified++;
  }
  console.log(`PASS: branch catalog has ${catalog.length} priced items; every available full name resolves to its own SKU/price locally.`);
  const paratha = catalog.find((item) => item.name === "Chicken Paratha" && item.category === "Paratha Roll");
  if (paratha?.is_available) {
    for (const query of ["chicken paratha roll", "chicken Partha roll", "چکن پراٹھا رول", "चिकन पराठा रोल"]) {
      const result = await resolveItemDetailed(branch.id, query, null, catalog);
      assert.equal(result.kind, "exact"); assert.equal(result.item.id, paratha.id); assert.equal(result.item.price, paratha.price);
    }
    console.log("PASS: the real Chicken Paratha SKU resolves typed, Urdu and voice-script roll requests.");
  }
  const kababish = catalog.filter((item) => /^Kababish Pizza /i.test(item.name) && item.is_available);
  if (kababish.length) {
    const result = await resolveItemDetailed(branch.id, "kababish pizza", null, catalog);
    assert.equal(result.kind, "variants");
    assert.deepEqual(result.variants.map((item) => item.id).sort(), kababish.map((item) => item.id).sort());
    const mid = kababish.find((item) => / Mid$/i.test(item.name));
    if (mid) assert.equal((await resolveItemDetailed(branch.id, "kababish pizza", "medium", catalog)).item.id, mid.id);
    console.log(`PASS: Kababish Pizza retains all ${kababish.length} real sizes; Medium selects the Mid SKU.`);
  }
  const fries = catalog.filter((item) => /\bfries\b/i.test(item.name));
  if (fries.length) {
    assert.deepEqual(catalogQuestionMatches("Fries hain?", catalog).map((item) => item.id).sort(), fries.map((item) => item.id).sort());
    console.log(`PASS: the incident availability question resolves ${fries.length} fries SKUs from the live catalog without AI.`);
  }
}
const version = await supabaseAdmin.rpc("restaurant_agent_reply_version");
if (version.error) throw version.error;
assert.equal(version.data, "20261026124645");
console.log(`LIVE CATALOG: ${verified} available SKUs verified; reply migration verified through the server API. No writes performed.`);
