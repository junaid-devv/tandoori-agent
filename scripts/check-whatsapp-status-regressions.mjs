import fs from "node:fs";

const webhookRoute = fs.readFileSync("app/api/webhook/route.ts", "utf8");
const messages = fs.readFileSync("lib/messages.ts", "utf8");
const databaseTypes = fs.readFileSync("lib/database.types.ts", "utf8");
const schema = fs.readFileSync("supabase-schema.sql", "utf8");
const migrations = fs.readFileSync("migrations.sql", "utf8");
const messageApi = fs.readFileSync("app/api/conversations/[id]/messages/route.ts", "utf8");
const orderStatusRoute = fs.readFileSync("app/api/orders/[id]/status/route.ts", "utf8");

function mustInclude(source, needle, message) {
  if (!source.includes(needle)) {
    throw new Error(message);
  }
  console.log(`PASS: ${message.replace(/^Missing /, "Found ").replace(/\.$/, "")}.`);
}

mustInclude(webhookRoute, "extractIncomingStatusEvents", "Missing WhatsApp status callback extraction.");
mustInclude(webhookRoute, "updateOutboundMessageStatuses(statusEvents)", "Missing WhatsApp outbound status persistence.");
mustInclude(webhookRoute, "getDeliveryStatusRank", "Missing delivery-status downgrade guard.");
mustInclude(webhookRoute, "buildWhatsAppStatusError", "Missing WhatsApp status failure detail persistence.");
mustInclude(messages, "\"pending\" | \"sent\" | \"delivered\" | \"read\" | \"failed\"", "Missing expanded delivery status type.");
mustInclude(messages, "splitWhatsAppText", "Missing outbound WhatsApp text chunking.");
mustInclude(messages, "formatChunkForDelivery", "Missing visible outbound chunk numbering.");
mustInclude(databaseTypes, "delivery_status_updated_at", "Missing delivery status timestamp in database types.");
mustInclude(messageApi, "delivery_status_updated_at", "Missing delivery status timestamp in message API.");
mustInclude(orderStatusRoute, "createDeliveryNotificationAlert", "Missing staff alert creation for failed customer order-status notifications.");
mustInclude(orderStatusRoute, "resolveStaffAlerts(conversationId, \"delivery_notification\")", "Missing staff alert resolution after successful customer order-status notification.");
mustInclude(schema, "'pending', 'sent', 'delivered', 'read', 'failed'", "Missing expanded delivery status constraint in base schema.");
mustInclude(schema, "delivery_status_updated_at timestamptz", "Missing delivery status timestamp in base schema.");
mustInclude(schema, "idx_messages_whatsapp_msg_id_unique", "Missing unique WhatsApp message id index in base schema.");
mustInclude(migrations, "delivery_status_updated_at timestamptz", "Missing delivery status timestamp migration.");
mustInclude(migrations, "'pending', 'sent', 'delivered', 'read', 'failed'", "Missing expanded delivery status migration constraint.");
