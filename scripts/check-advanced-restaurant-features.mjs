import fs from "node:fs";

const sources = {
  schema: fs.readFileSync("db/schema.sql", "utf8"),
  webhook: fs.readFileSync("app/api/webhook/route.ts", "utf8") + fs.readFileSync("lib/whatsapp-inbound.ts", "utf8"),
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

mustInclude(sources.schema, "customer_addresses", "Missing customer address table in schema.");
mustInclude(sources.schema, "available_days", "Missing menu schedule columns in schema.");
mustInclude(sources.menu, "isMenuScheduleAvailable", "Missing menu schedule filtering in menu catalog.");
mustInclude(sources.crm, "isUseSavedAddressRequest", "Missing saved-address conversation shortcut.");
mustInclude(sources.crm, "isReorderRequest", "Missing reorder conversation shortcut.");
mustInclude(sources.webhook, "saveCustomerAddressFromOrder", "Missing saved-address persistence after order placement.");
if (sources.webhook.includes("promptSavedBranchChoice") || sources.webhook.includes("Continue Same Branch")) {
  throw new Error("Automatic saved-branch choice prompt must not be reintroduced.");
}
// Voice handling is shared by Meta and Evolution and transcribes into the order pipeline.
mustInclude(sources.webhook, "audio.transcriptions.create", "Missing shared voice-note transcription path.");
mustInclude(sources.whatsapp, "getWhatsAppMediaUrl", "Missing WhatsApp media lookup helper.");
mustInclude(sources.whatsapp, "downloadWhatsAppMedia", "Missing WhatsApp media download helper.");
mustInclude(sources.conversationsPage, "Customer Profile", "Missing staff inbox customer profile save action.");
mustInclude(sources.menuPage, "WEEKDAYS", "Missing menu schedule dashboard controls.");
mustInclude(sources.analyticsApi, "topItems", "Missing restaurant analytics top-items API.");
mustInclude(sources.analyticsPage, "hourlyDemand", "Missing restaurant hourly-demand analytics.");
