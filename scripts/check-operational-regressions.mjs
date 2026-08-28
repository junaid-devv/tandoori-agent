import fs from "node:fs";

const delivery = fs.readFileSync("lib/agent/delivery.ts", "utf8");
const reply = fs.readFileSync("lib/agent/reply.ts", "utf8");
const ai = fs.readFileSync("lib/ai.ts", "utf8");
const settings = fs.readFileSync("lib/settings.ts", "utf8");
const dashboardSettings = fs.readFileSync("app/dashboard/settings/page.tsx", "utf8");
const staffAlerts = fs.readFileSync("lib/staff-alerts.ts", "utf8");
const schema = fs.readFileSync("db/schema.sql", "utf8");

function mustInclude(source, needle, message) {
  if (!source.includes(needle)) {
    throw new Error(message);
  }
  console.log(`PASS: ${message.replace(/^Missing /, "Found ").replace(/\.$/, "")}.`);
}

mustInclude(settings, "delivery_areas: string[]", "Missing delivery areas in RestaurantSettings.");
mustInclude(settings, "estimated_prep_minutes: number", "Missing prep estimate in RestaurantSettings.");
mustInclude(settings, "estimated_delivery_minutes: number", "Missing delivery estimate in RestaurantSettings.");
mustInclude(delivery, "function findMatchingDeliveryArea", "Missing deterministic delivery-area validation.");
mustInclude(delivery, "buildDeliveryAreaHint", "Missing delivery-area hint in order prompts.");
mustInclude(delivery, "buildEstimatedTimeReply", "Missing configurable ETA reply helper.");
mustInclude(dashboardSettings, "Delivery Areas", "Missing delivery-area settings UI.");
mustInclude(dashboardSettings, "estimated_prep_minutes", "Missing prep estimate settings UI.");
mustInclude(dashboardSettings, "estimated_delivery_minutes", "Missing delivery estimate settings UI.");
mustInclude(reply, "COD", "Missing COD-first payment reply.");
mustInclude(ai, "never collect online payment details", "Missing no-online-payment prompt rule.");
mustInclude(staffAlerts, "customer_cancellation", "Missing staff alert kind for customer cancellation.");
mustInclude(schema, "delivery_areas jsonb", "Missing delivery areas in schema.");
mustInclude(schema, "estimated_prep_minutes integer", "Missing prep estimate in schema.");
mustInclude(schema, "estimated_delivery_minutes integer", "Missing delivery estimate in schema.");
mustInclude(schema, "Delivery is not available for this branch.", "Missing delivery-enabled enforcement in order RPC.");
mustInclude(schema, "Delivery address is outside configured delivery areas.", "Missing delivery-area enforcement in order RPC.");
mustInclude(schema, "Minimum delivery order is Rs.", "Missing minimum-delivery enforcement in order RPC.");
mustInclude(schema, "customer_cancellation", "Missing customer cancellation alert kind in schema.");
