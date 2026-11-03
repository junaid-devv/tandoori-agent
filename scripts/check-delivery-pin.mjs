/** Exercise the real repository and Supabase HTTP client against an isolated
 * REST fixture, including concurrent staff changes. No production writes. */
import assert from "node:assert/strict";
import { createServer } from "node:http";

let order;
let writes = 0;
let conflict = false;
const requests = [];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://fixture");
  assert.equal(req.method, "PATCH");
  assert.equal(url.pathname, "/rest/v1/orders");
  let body = "";
  for await (const chunk of req) body += chunk;
  const patch = JSON.parse(body);
  requests.push({ url, patch });
  if (conflict) { order.updated_at = "2026-11-03T12:01:00Z"; order.customer_instructions = "Staff: call on arrival"; conflict = false; }
  const matches = ["id", "conversation_id", "branch_id", "updated_at"].every((key) => url.searchParams.get(key) === `eq.${order[key]}`)
    && url.searchParams.get("status")?.includes(order.status);
  if (matches) { Object.assign(order, patch); writes++; }
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(matches ? { id: order.id } : null));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "isolated-fixture-key";
const { orderRepo } = await import("../lib/data/order.repo.ts");
const pin = "https://maps.google.com/?q=33.7,73.1";
const fresh = () => ({ id: "order", conversation_id: "conversation", branch_id: "branch", type: "delivery", status: "received",
  address: "House 3 near Anwar Chowk", total: 748, delivery_fee: 100, customer_instructions: "Call at gate", updated_at: "2026-11-03T12:00:00Z" });
try {
  order = fresh();
  assert.equal(await orderRepo.saveDeliveryPin({ ...order }, pin), true);
  assert.match(order.customer_instructions, /Call at gate\nDelivery location: https/);
  assert.equal(order.address, fresh().address); assert.equal(order.total, 748); assert.equal(order.delivery_fee, 100);
  assert.deepEqual(Object.keys(requests[0].patch).sort(), ["customer_instructions", "updated_at"]);
  assert.equal(await orderRepo.saveDeliveryPin({ ...order }, pin), true); assert.equal(writes, 1);
  console.log("PASS: rider location preserves instructions, address, fee and total; repeated pins are idempotent.");
  order = fresh(); conflict = true;
  assert.equal(await orderRepo.saveDeliveryPin({ ...order }, pin), false);
  assert.equal(order.customer_instructions, "Staff: call on arrival");
  assert.equal(writes, 1);
  console.log("PASS: a concurrent staff update cannot be overwritten by a stale location save.");
  order = fresh();
  assert.equal(await orderRepo.saveDeliveryPin({ ...order, conversation_id: "someone-else" }, pin), false);
  assert.equal(await orderRepo.saveDeliveryPin({ ...order, branch_id: "another-branch" }, pin), false);
  const before = requests.length;
  for (const status of ["delivered", "cancelled"]) assert.equal(await orderRepo.saveDeliveryPin({ ...order, status }, pin), false);
  assert.equal(await orderRepo.saveDeliveryPin({ ...order, type: "pickup" }, pin), false);
  assert.equal(requests.length, before); assert.equal(writes, 1);
  console.log("PASS: location writes respect conversation, branch, active order status and delivery service.");
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
