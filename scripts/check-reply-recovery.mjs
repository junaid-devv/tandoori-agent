/** Real reply dispatcher + PostgreSQL claim/finish contracts, no WhatsApp calls. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://offline.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "offline-test-key";
const { getSupabaseAdmin } = await import("../lib/supabase-admin.ts");
const { deliverCommittedReply } = await import("../lib/agent/reply-delivery.ts");
const { OutboundMessageError } = await import("../lib/messages.ts");
const { InMemoryCacheStore } = await import("../lib/core/cache.ts");
const db = new PGlite();
const conversationId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
const payload = { replyText: "Saved order #42", interactive: { kind: "buttons", payload: { body: "Confirm?", buttons: [{ id: "confirm:yes", title: "Confirm" }] } }, mediaUrls: ["https://example.test/menu.jpg"] };
const input = { conversationId, messageId, branchId: "test-branch", phone: "offline" };
let sends = 0;
let mode = "success";
let failFinish = false;
let alerts = 0;
const sender = async (sent) => {
  sends++;
  assert.equal(sent.content, payload.replyText);
  assert.deepEqual(sent.replyButtons, payload.interactive.payload);
  assert.deepEqual(sent.mediaUrls, payload.mediaUrls);
  if (mode === "failed") throw new OutboundMessageError("definitely rejected", false);
  if (mode === "uncertain") throw new OutboundMessageError("provider outcome unknown", true);
};
const status = async () => (await db.query("select metadata->>'agent_reply_status' status from messages")).rows[0].status;
const reset = async () => db.query("update messages set metadata=$1", [JSON.stringify({ agent_processed: true, agent_reply: payload, agent_reply_status: "ready" })]);
try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table messages(id uuid primary key,conversation_id uuid,role text,metadata jsonb);
    create function commit_restaurant_agent_turn(uuid,uuid,jsonb) returns boolean language sql as $$ select true $$;`);
  await db.exec(fs.readFileSync("supabase/migrations/20261026124645_restaurant_agent_reply_recovery.sql", "utf8"));
  await db.query("insert into messages values ($1,$2,'user','{}')", [messageId, conversationId]);
  getSupabaseAdmin().rpc = async (name, params) => {
    if (name === "claim_restaurant_agent_reply") return { data: (await db.query("select claim_restaurant_agent_reply($1,$2,$3) reply", [params.p_conversation_id, params.p_message_id, params.p_token])).rows[0].reply, error: null };
    if (failFinish && params.p_status === "sent") { failFinish = false; return { error: new Error("receipt save failed") }; }
    await db.query("select finish_restaurant_agent_reply($1,$2,$3,$4)", [params.p_conversation_id, params.p_message_id, params.p_token, params.p_status]);
    return { error: null };
  };
  getSupabaseAdmin().from = (table) => {
    const chain = { select: () => chain, eq: () => chain,
      maybeSingle: async () => table === "messages" ? { data: (await db.query("select metadata from messages")).rows[0], error: null }
        : (alerts++, { data: { id: "existing-alert" }, error: null }) };
    return chain;
  };
  await reset();
  await Promise.all([deliverCommittedReply(input, sender), deliverCommittedReply(input, sender)]);
  assert.equal(sends, 1); assert.equal(await status(), "sent");
  await deliverCommittedReply(input, sender); assert.equal(sends, 1);
  console.log("PASS: concurrent workers send a committed reply once and preserve its buttons/media");
  await reset(); mode = "failed";
  await assert.rejects(() => deliverCommittedReply(input, sender)); assert.equal(await status(), "failed");
  mode = "success"; await deliverCommittedReply(input, sender); assert.equal(await status(), "sent");
  console.log("PASS: a definite send rejection retries the stored reply without recomputing the order");
  await reset(); mode = "uncertain";
  await assert.rejects(() => deliverCommittedReply(input, sender)); assert.equal(await status(), "uncertain");
  const before = sends;
  await deliverCommittedReply(input, sender); assert.equal(sends, before); assert.ok(alerts > 0);
  console.log("PASS: uncertain sends surface for staff verification and never automatically duplicate the message");
  await reset(); mode = "success"; failFinish = true;
  await assert.rejects(() => deliverCommittedReply(input, sender)); assert.equal(await status(), "uncertain");
  const accepted = sends; await deliverCommittedReply(input, sender); assert.equal(sends, accepted);
  console.log("PASS: provider acceptance followed by a receipt-write failure cannot become a retryable failed send");

  const cache = new InMemoryCacheStore();
  let release;
  const oldLoad = cache.getOrSet("menu:b", 60000, () => new Promise((resolve) => { release = resolve; }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await cache.del("menu:b");
  assert.equal(await cache.getOrSet("menu:b", 60000, async () => "new menu"), "new menu");
  release("old menu"); await oldLoad;
  assert.equal(await cache.get("menu:b"), "new menu");
  console.log("PASS: a menu read started before an edit cannot repopulate the invalidated cache with stale data");
} finally { await db.close(); }
