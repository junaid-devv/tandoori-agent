import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://tenant-tests.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
process.env.EVOLUTION_API_BASE_URL = "https://evolution.test";
process.env.EVOLUTION_API_KEY = "gateway-secret";
process.env.EVOLUTION_WEBHOOK_SECRET = "test-webhook-secret-with-more-than-32-characters";
process.env.APP_URL = "https://dashboard.test";
process.env.MOCK_WHATSAPP = "false";

const { withWhatsAppTransport, getWhatsAppTransport, withConversationWhatsApp } = await import("../lib/whatsapp-context.ts");
const { sendWhatsAppMessage, sendWhatsAppInteractiveList, sendWhatsAppReplyButtons, sendWhatsAppImage } = await import("../lib/whatsapp.ts");
const { normalizeEvolutionMessage, evolutionMessageId, evolutionDeliveryStatus } = await import("../lib/evolution-webhook.ts");
const { performEvolutionAction, evolutionWebhookToken, verifyEvolutionWebhook, getEvolutionFullStatus } = await import("../lib/evolution-client.ts");
const { whatsappRestaurantId } = await import("../lib/whatsapp-request.ts");
const { NextRequest } = await import("next/server");
const { POST: webhook } = await import("../app/api/webhook/evolution/route.ts");
const { recordWebhookEvent } = await import("../lib/webhook-events.ts");
const { getRestaurantProfile, updateRestaurantProfile } = await import("../lib/restaurant-profile.ts");

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const instance = id => `orderiq-${id}`;
const transport = id => ({ provider: "evolution", restaurantId: id, instanceName: instance(id) });
const requests = [];
let evolutionStatus = "open";
let instanceExists = true;
let gatewayFailure = null;
let webhookRow = null;
const json = value => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const request = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(request.url);
  const body = request.method === "GET" ? null : JSON.parse(await request.text() || "{}");
  requests.push({ url, method: request.method, body, headers: Object.fromEntries(request.headers) });
  if (url.host === "tenant-tests.supabase.co") {
    const table = url.pathname.split("/").pop();
    if (table === "webhook_events") {
      if (request.method === "POST") {
        assert.ok(request.headers.get("prefer").includes("resolution=ignore-duplicates"));
        if (webhookRow) return json([]);
        webhookRow = { ...body, id: "event-a" };
        return json([webhookRow]);
      }
      return json(webhookRow);
    }
    const restaurant = url.searchParams.get("restaurant_id")?.replace("eq.", "") || A;
    let row;
    if (table === "evolution_configs") row = { restaurant_id: restaurant, instance_name: instance(restaurant), is_active: true, display_phone_number: "923001234567", verified_name: "Restaurant", connection_status: "open" };
    else if (table === "whatsapp_configs") row = { phone_number_id: "meta-a", access_token: "meta-token-a" };
    else if (table === "conversations") row = { contact_id: "contact-a", whatsapp_provider: "evolution", evolution_instance_name: instance(A) };
    else if (table === "contacts") row = { restaurant_id: A };
    else if (table === "restaurant_profiles") row = { id: A, name: "Restaurant A", whatsapp_provider: "evolution" };
    else throw new Error(`Unexpected table ${table}`);
    return json(request.headers.get("accept")?.includes("vnd.pgrst.object") ? row : [row]);
  }
  if (url.host === "graph.facebook.com") return json({ messages: [{ id: "wamid.meta-a" }] });
  assert.equal(url.host, "evolution.test");
  assert.equal(request.headers.get("apikey"), "gateway-secret");
  if (gatewayFailure && url.pathname.includes("/message/")) return new Response("rejected", { status: gatewayFailure });
  if (url.pathname.includes("fetchInstances")) return json(instanceExists ? [{ name: url.searchParams.get("instanceName") }] : []);
  if (url.pathname.includes("connectionState")) return json({ instance: { state: evolutionStatus } });
  if (url.pathname.includes("/instance/connect/")) return json({ base64: "data:image/png;base64,cXI=", pairingCode: "12345678", apikey: "must-not-leak" });
  if (url.pathname.includes("/message/")) return json({ key: { id: "raw-message-id" } });
  return json({ success: true, apikey: "must-not-leak" });
};

try {
  await assert.rejects(() => sendWhatsAppMessage("923001234567", "no tenant"), /tenant-scoped/);
  assert.equal(requests.length, 0, "No global credential fallback is allowed");
  await recordWebhookEvent({ rawBody: "private", payload: { private: true }, signature: null, provider: "evolution", deliveryKey: "delivery-a" });
  webhookRow.status = "processed";
  webhookRow.payload = { redacted_after_processing: true };
  const replay = await recordWebhookEvent({ rawBody: "changed", payload: { private: "replayed" }, signature: null, provider: "evolution", deliveryKey: "delivery-a" });
  assert.equal(replay.status, "processed");
  assert.equal(replay.payload.redacted_after_processing, true);
  console.log("PASS: Duplicate webhook deliveries preserve processing state and payload redaction.");
  await Promise.all([A, B].map(id => withWhatsAppTransport(transport(id), async () => {
    await new Promise(resolve => setTimeout(resolve, id === A ? 8 : 1));
    assert.equal(getWhatsAppTransport().restaurantId, id);
    const sent = await sendWhatsAppMessage("923001234567", id);
    assert.equal(sent.messageId, evolutionMessageId(instance(id), "raw-message-id"));
  })));
  assert.equal(getWhatsAppTransport(), undefined);
  for (const id of [A, B]) assert.ok(requests.some(r => r.body?.text === id && r.url.pathname.endsWith(instance(id))));
  console.log("PASS: Concurrent tenants use separate instances without global fallback.");

  await withWhatsAppTransport(transport(A), async () => {
    await sendWhatsAppInteractiveList("923001234567", { body: "Menu", buttonText: "Choose", sectionTitle: "Dishes", rows: [{ id: "menu_item_123", title: "Chicken Karahi", description: "Half" }] });
    const list = requests.at(-1);
    assert.ok(list.url.pathname.includes("/message/sendList/"));
    assert.equal(list.body.sections[0].rows[0].rowId, "menu_item_123");
    await sendWhatsAppReplyButtons("923001234567", { body: "Confirm?", buttons: [{ id: "confirm_order", title: "Confirm" }] });
    assert.equal(requests.at(-1).body.buttons[0].id, "confirm_order");
    assert.equal(requests.at(-1).body.buttons[0].type, "reply");
    await sendWhatsAppImage("923001234567", "https://images.test/menu.jpg", "Menu");
    assert.equal(requests.at(-1).body.mediatype, "image");
    gatewayFailure = 400;
    await assert.rejects(() => sendWhatsAppReplyButtons("923001234567", { body: "Confirm?", buttons: [{ id: "yes", title: "Yes" }] }), /400/);
    gatewayFailure = null;
  });
  console.log("PASS: Native lists, reply buttons, and images use Evolution v2 payloads; rejected sends surface for text fallback.");

  const base = { key: { id: "inbound", remoteJid: "923001234567@s.whatsapp.net" }, messageTimestamp: 1792840000 };
  const parse = message => normalizeEvolutionMessage(instance(A), { ...base, message });
  assert.equal(parse({ listResponseMessage: { singleSelectReply: { selectedRowId: "item_42" }, title: "Karahi" } }).interactive.list_reply.id, "item_42");
  assert.equal(parse({ buttonsResponseMessage: { selectedButtonId: "confirm_order", selectedDisplayText: "Confirm" } }).interactive.button_reply.id, "confirm_order");
  assert.equal(parse({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{"id":"order_delivery","title":"Delivery"}' } } }).interactive.button_reply.id, "order_delivery");
  assert.equal(parse({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: "invalid" } } }), null);
  assert.equal(parse({ ephemeralMessage: { message: { conversation: "menu" } } }).text.body, "menu");
  assert.equal(normalizeEvolutionMessage(instance(A), { ...base, key: { ...base.key, remoteJid: "123@g.us" }, message: { conversation: "group" } }), null);
  assert.equal(normalizeEvolutionMessage(instance(A), { ...base, key: { ...base.key, remoteJid: "123456789012345@lid" }, message: { conversation: "hello" } }).from, "123456789012345@lid");
  assert.equal(normalizeEvolutionMessage(instance(A), { ...base, key: { ...base.key, remoteJid: "123@lid", remoteJidAlt: "923001234567@s.whatsapp.net" }, message: { conversation: "hello" } }).from, "923001234567");
  assert.equal(parse({ audioMessage: { mimetype: "audio/ogg", ptt: true } }).type, "audio");
  assert.ok(parse({ locationMessage: { degreesLatitude: 33.7, degreesLongitude: 73.1 } }).text.body.includes("33.7,73.1"));
  assert.equal(evolutionDeliveryStatus("DELIVERY_ACK"), "delivered");
  assert.equal(evolutionDeliveryStatus(4), "read");
  assert.equal(evolutionDeliveryStatus("PENDING"), null);
  assert.notEqual(evolutionMessageId(instance(A), "same"), evolutionMessageId(instance(B), "same"));
  console.log("PASS: Buttons/lists preserve order-flow IDs; voice, location, wrappers, LIDs, and receipt formats normalize correctly.");

  const token = evolutionWebhookToken(instance(A));
  assert.ok(verifyEvolutionWebhook(instance(A), `Bearer ${token}`));
  assert.ok(!verifyEvolutionWebhook(instance(B), `Bearer ${token}`));
  assert.ok(!verifyEvolutionWebhook(instance(A), "wrong"));
  const count = requests.length;
  const response = await webhook(new NextRequest("https://dashboard.test/api/webhook/evolution", { method: "POST", body: JSON.stringify({ event: "messages.upsert", instance: instance(A), data: base }) }));
  assert.equal(response.status, 401);
  assert.equal(requests.length, count, "Unauthorized webhooks must not access tenant data");
  console.log("PASS: Per-instance webhook authentication rejects tampering before database access.");

  const session = { role: "admin", restaurantId: A };
  const req = new NextRequest(`https://dashboard.test/api/dashboard/whatsapp/action?restaurant_id=${B}`);
  assert.throws(() => whatsappRestaurantId(req, session, true), /Forbidden/);
  assert.throws(() => whatsappRestaurantId(req, { ...session, role: "branch_staff" }, true), /administrators/);
  assert.equal(whatsappRestaurantId(req, { ...session, role: "super_admin" }, true), B);
  await withConversationWhatsApp("conversation-a", () => sendWhatsAppMessage("923001234567", "dashboard reply"));
  assert.ok(requests.at(-1).url.pathname.endsWith(instance(A)));
  console.log("PASS: Dashboard actions enforce tenant and role boundaries; conversation replies recover the tenant channel.");
  const profile = await getRestaurantProfile(A);
  await updateRestaurantProfile(A, { ...profile, support_phone: "1234567", delivery_phone: "1234567", dine_in_phone: "1234567", whatsapp_provider: "evolution" });
  const profileWrite = requests.findLast(r => r.url.pathname.endsWith("restaurant_profiles") && r.method === "PATCH");
  assert.equal(profileWrite.url.searchParams.get("id"), `eq.${A}`);
  assert.equal(profileWrite.body.name, "Restaurant A");
  assert.equal(profileWrite.body.whatsapp_provider, "evolution");
  assert.ok(!("app_name" in profileWrite.body));
  assert.ok(!("default_branch_id" in profileWrite.body));
  console.log("PASS: Dashboard profile settings map to the live multi-tenant schema.");

  await withWhatsAppTransport({ provider: "meta", restaurantId: A, phoneNumberId: "meta-a" }, () => sendWhatsAppMessage("923001234567", "official"));
  assert.equal(requests.at(-1).url.host, "graph.facebook.com");
  assert.equal(requests.at(-1).headers.authorization, "Bearer meta-token-a");
  assert.ok(requests.some(r => r.url.pathname.endsWith("whatsapp_configs") && r.url.searchParams.get("restaurant_id") === `eq.${A}`));
  console.log("PASS: Official Meta API remains available with tenant-scoped credentials.");

  const beforeStatus = requests.length;
  const status = await getEvolutionFullStatus(A);
  assert.equal(status.session.status, "CONNECTED");
  assert.ok(requests.slice(beforeStatus).every(r => r.method === "GET"), "Status reads cannot start instances or mutate QR codes");
  assert.ok(!JSON.stringify(status).includes("gateway-secret"));
  instanceExists = false;
  const action = await performEvolutionAction("pair", A, "923001234567");
  assert.equal(action.data.pairingCode, "12345678");
  assert.ok(!JSON.stringify(action).includes("must-not-leak"));
  const create = requests.find(r => r.url.pathname === "/instance/create");
  assert.equal(create.body.instanceName, instance(A));
  assert.equal(create.body.integration, "WHATSAPP-BAILEYS");
  assert.equal(create.body.webhook.headers.authorization, `Bearer ${token}`);
  assert.equal(create.body.webhook.url, "https://dashboard.test/api/webhook/evolution");
  assert.equal(create.body.webhook.byEvents, false);
  await performEvolutionAction("logout", A);
  assert.ok(requests.some(r => r.url.pathname === `/instance/logout/${instance(A)}` && r.method === "DELETE"));
  console.log("PASS: Pairing, QR generation, logout, safe status responses, and authenticated tenant webhooks use Evolution v2 contracts.");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("Evolution integration regressions passed.");
