/** Offline resolver checks with a real local embedding endpoint and isolated RPC.
 * Rankings deliberately omit choices; the branch catalog must retain authority.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";

const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  const floats = new Float32Array(1536).fill(0.01);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ data: [{ embedding: request.encoding_format === "base64"
    ? Buffer.from(floats.buffer).toString("base64") : Array.from(floats) }] }));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://offline.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "offline-key";
process.env.MENU_EMBEDDING_API_KEY = "offline-key";
process.env.MENU_EMBEDDING_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
try {
  const { resolveItemDetailed, searchMenu, extractBaseItemName, extractSizeFromQuery } = await import("../lib/menu/search.ts");
  const { getSupabaseAdmin } = await import("../lib/supabase-admin.ts");
  let rows = [];
  let rpcCalls = 0;
  getSupabaseAdmin().rpc = async () => { rpcCalls++; return { data: rows, error: null }; };
  getSupabaseAdmin().from = () => { throw new Error("Unexpected catalog DB read"); };
  const food = (id, name, price = 99, available = true) => ({ id, name, price, category: "Soda Section", description: null, is_available: available });
  const drinks = [food("large", "1.5 Liter Drink", 199), food("small", "500ml Drink"), food("medium", "1 Liter Drink", 150)];
  let checks = 0;
  const test = async (name, fn) => { await fn(); checks++; console.log(`PASS: ${name}`); };
  const resolve = (query, size, menu = drinks) => resolveItemDetailed("offline", query, size, menu);
  for (const vector of [false, true]) {
    rows = vector ? [{ ...drinks[0], similarity: 0.99 }] : [];
    const path = vector ? "partial vector results" : "lexical fallback";
    await test(`${path}: unspecified drink shows all stored sizes`, async () => {
      const result = await resolve("drink"); assert.equal(result.kind, "variants");
      assert.deepEqual(result.variants.map((v) => v.id), ["small", "medium", "large"]);
    });
    for (const [query, id] of [["500 ml drink", "small"], ["0.5 litre drink", "small"], ["1 liter drink", "medium"], ["1 litre drink", "medium"], ["1.5 litre drink", "large"], ["1500ml drink", "large"]]) {
      await test(`${path}: ${query} selects the requested volume`, async () => {
        const result = await resolve(query); assert.equal(result.kind, "exact"); assert.equal(result.item.id, id);
      });
    }
    await test(`${path}: absent size cannot silently substitute another drink`, async () => assert.equal((await resolve("drink", "2 litre")).kind, "not_found"));
    await test(`${path}: explicit size overrides the old full name`, async () => {
      const result = await resolve("1.5 Liter Drink", "500 ml"); assert.equal(result.kind, "exact"); assert.equal(result.item.id, "small");
    });
  }
  await test("unit extraction keeps decimal volumes distinct", () => {
    assert.notEqual(extractSizeFromQuery("1.5 litre"), extractSizeFromQuery("15 litre"));
    for (const name of drinks.map((v) => v.name)) assert.equal(extractBaseItemName(name).baseName, "Drink");
  });
  rows = [];
  await test("exact chicken shawarma is not confused with cheese shawarma", async () => {
    const result = await resolve("chicken shawarma", null, [food("s", "Chicken Shawarma"), food("c", "Chicken Cheese Shawarma")]);
    assert.equal(result.kind, "exact"); assert.equal(result.item.id, "s");
  });
  await test("unknown brand at an explicit volume still requires a choice", async () => {
    const result = await resolve("500ml drink", null, [food("c", "Cola Drink 500ml"), food("o", "Orange Drink 500ml")]);
    assert.equal(result.kind, "ambiguous"); assert.equal(result.matches.length, 2);
  });
  await test("catalog siblings beyond the retrieval limit are not silently hidden", async () => {
    const menu = Array.from({ length: 12 }, (_, i) => food(`d${i}`, `${i + 1} Liter Drink`, 100 + i));
    const result = await resolve("drink", null, menu); assert.equal(result.kind, "variants"); assert.equal(result.variants.length, 12);
  });
  rows = [{ ...drinks[0], price: 1, similarity: 0.99 }];
  await test("current catalog owns prices and availability over vector metadata", async () => {
    const result = await resolve("1.5 litre drink"); assert.equal(result.item.price, 199);
    const unavailable = drinks.map((d) => ({ ...d, is_available: false }));
    assert.equal((await resolve("drink", null, unavailable)).kind, "not_found");
    assert.equal((await searchMenu("offline", "drink", 8, [])).matches.length, 0);
  });
  assert.ok(rpcCalls > 0, "Vector tests must actually reach the vector RPC");
  console.log(`MENU RESOLUTION: ${checks} checks passed.`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
