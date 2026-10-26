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
}
const version = await supabaseAdmin.rpc("restaurant_agent_reply_version");
if (version.error) throw version.error;
assert.equal(version.data, "20261026124645");
console.log(`LIVE CATALOG: ${verified} available SKUs verified; reply migration verified through the server API. No writes performed.`);
