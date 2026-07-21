import fs from "node:fs";

const sources = {
  schema: fs.readFileSync("supabase-schema.sql", "utf8"),
  migrations: fs.readFileSync("migrations.sql", "utf8"),
  orderEngine: fs.readFileSync("lib/order-engine.ts", "utf8"),
  webhook: fs.readFileSync("app/api/webhook/route.ts", "utf8"),
  whatsapp: fs.readFileSync("lib/whatsapp.ts", "utf8"),
  crm: fs.readFileSync("lib/customer-crm.ts", "utf8"),
  menu: fs.readFileSync("lib/menu.ts", "utf8"),
  menuPage: fs.readFileSync("app/dashboard/menu/page.tsx", "utf8"),
  conversationsPage: fs.readFileSync("app/dashboard/conversations/page.tsx", "utf8"),
  analyticsApi: fs.readFileSync("app/api/dashboard/analytics/route.ts", "utf8"),
  analyticsPage: fs.readFileSync("app/dashboard/analytics/page.tsx", "utf8"),
};

function mustInclude(source, needle, message) {
  if (!source.includes(needle)) throw new Error(message);
  console.log(`PASS: ${message.replace(/^Missing /, "Found ").replace(/\.$/, "")}.`);
}

mustInclude(sources.schema, "customer_addresses", "Missing customer address table in base schema.");
mustInclude(sources.migrations, "customer_addresses", "Missing customer address migration.");
mustInclude(sources.schema, "available_days", "Missing menu schedule columns in base schema.");
mustInclude(sources.migrations, "available_days", "Missing menu schedule migration.");
mustInclude(sources.menu, "isMenuScheduleAvailable", "Missing menu schedule filtering in menu catalog.");
mustInclude(sources.orderEngine, "isUseSavedAddressRequest", "Missing saved-address conversation shortcut.");
mustInclude(sources.orderEngine, "isReorderRequest", "Missing reorder conversation shortcut.");
mustInclude(sources.webhook, "saveCustomerAddressFromOrder", "Missing saved-address persistence after order placement.");
if (sources.webhook.includes("promptSavedBranchChoice") || sources.webhook.includes("Continue Same Branch")) {
  throw new Error("Automatic saved-branch choice prompt must not be reintroduced.");
}
mustInclude(sources.webhook, "deleteUnsentOutboundMessage(error.persistedMessageId)", "Missing cleanup for unsent failed outbound retries.");
mustInclude(sources.webhook, "transcribeWhatsAppAudioMessage", "Missing WhatsApp voice-note transcription path.");
mustInclude(sources.webhook, "https://api.groq.com/openai/v1/audio/transcriptions", "Missing Groq audio transcription endpoint.");
mustInclude(sources.webhook, "whisper-large-v3-turbo", "Missing Groq whisper-large-v3-turbo model.");
mustInclude(sources.whatsapp, "getWhatsAppMediaUrl", "Missing WhatsApp media lookup helper.");
mustInclude(sources.whatsapp, "downloadWhatsAppMedia", "Missing WhatsApp media download helper.");
mustInclude(sources.conversationsPage, "Customer Profile", "Missing staff inbox customer profile save action.");
mustInclude(sources.menuPage, "WEEKDAYS", "Missing menu schedule dashboard controls.");
mustInclude(sources.analyticsApi, "topItems", "Missing restaurant analytics top-items API.");
mustInclude(sources.analyticsPage, "Hourly Demand", "Missing restaurant analytics page.");
