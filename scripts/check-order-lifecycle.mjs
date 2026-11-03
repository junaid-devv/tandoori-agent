/** Real cancellation repository over an isolated REST fixture; no live writes. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { currentOrderHistory, orderSessionExpired } from "../lib/order-session.ts";
import { confirmedOrderRevenue } from "../lib/order-revenue.ts";

const yesterday = "2026-11-02T12:00:00Z";
const today = "2026-11-03T12:00:00Z";
const history = [
  { id: "old", role: "user", created_at: yesterday, content: "confirm delivery" },
  { id: "old-reply", role: "assistant", created_at: yesterday, content: "confirmed" },
  { id: "current", role: "user", created_at: today, content: "add a roll" },
  { id: "future", role: "user", created_at: today, content: "and fries" },
];
assert.deepEqual(currentOrderHistory(history, "current"), []);
assert.deepEqual(currentOrderHistory(history, "future").map(m => m.id), ["current"]);
assert.deepEqual(currentOrderHistory(history.slice(1), "current"), []);
assert.deepEqual(currentOrderHistory(history, "missing"), []);
assert.equal(orderSessionExpired(today, "2026-11-03T13:59:59Z"), false);
assert.equal(orderSessionExpired(today, "2026-11-03T14:00:00Z"), true);
assert.equal(orderSessionExpired(null, today), false);
assert.equal(orderSessionExpired("invalid", today), false);
console.log("PASS: two-hour session boundary removes yesterday's chat without consuming future queued messages.");

let order;
const server = createServer(async (req, res) => {
  assert.equal(req.method, "PATCH");
  const url = new URL(req.url, "http://fixture");
  assert.equal(url.pathname, "/rest/v1/orders");
  let body = "";
  for await (const chunk of req) body += chunk;
  const statuses = url.searchParams.get("status");
  assert.equal(statuses, "in.(received,preparing)");
  const cutoff = url.searchParams.get("created_at");
  assert.ok(cutoff.startsWith("gte."));
  const matches = url.searchParams.get("id") === `eq.${order.id}`
    && ["received", "preparing"].includes(order.status)
    && Date.parse(order.created_at) >= Date.parse(cutoff.slice(4));
  if (matches) Object.assign(order, JSON.parse(body));
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(matches ? { id: order.id } : null));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = "isolated-fixture-key";
const { orderRepo } = await import("../lib/data/order.repo.ts");
const fresh = (status, minutes = 0) => ({ id: "confirmed-order", status, subtotal: 548, delivery_fee: 200, total: 748,
  created_at: new Date(Date.now() - minutes * 60_000).toISOString() });
try {
  for (const status of ["received", "preparing", "out_for_delivery", "delivered"]) {
    order = fresh(status);
    assert.equal(confirmedOrderRevenue([order]), 748);
  }
  assert.equal(confirmedOrderRevenue([{ status: "received", subtotal: 548, delivery_fee: 200, total: null }]), 748);
  assert.equal(confirmedOrderRevenue([{ status: "cancelled", total: 748 }, { status: "draft", total: 99 }]), 0);
  for (const status of ["received", "preparing"]) {
    order = fresh(status, 9);
    assert.equal(await orderRepo.cancelOrder(order.id), true);
    assert.equal(order.status, "cancelled");
    assert.equal(confirmedOrderRevenue([order]), 0);
    assert.equal(await orderRepo.cancelOrder(order.id), false);
    assert.equal(confirmedOrderRevenue([order]), 0);
  }
  console.log("PASS: confirmation adds revenue immediately; cancelling within ten minutes removes it once, including during preparation.");
  for (const [status, minutes] of [["received", 11], ["preparing", 11], ["out_for_delivery", 1], ["delivered", 1]]) {
    order = fresh(status, minutes);
    assert.equal(await orderRepo.cancelOrder(order.id), false);
    assert.equal(confirmedOrderRevenue([order]), 748);
  }
  order.cancellation_requested_at = new Date().toISOString();
  assert.equal(confirmedOrderRevenue([order]), 748);
  assert.equal(confirmedOrderRevenue(Array.from({length: 1501}, () => fresh("received"))), 1501 * 748);
  console.log("PASS: expired/dispatch cancellation attempts and pending requests do not remove confirmed revenue.");
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
