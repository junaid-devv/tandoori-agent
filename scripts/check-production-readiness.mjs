import fs from "node:fs";
import dotenv from "dotenv";

for (const file of [".env.production.local", ".env.local", ".env"]) {
  if (fs.existsSync(file)) {
    dotenv.config({ path: file, override: false, quiet: true });
  }
}

const failures = [];
const warnings = [];

function value(name) {
  return process.env[name]?.trim() ?? "";
}

function isPlaceholder(raw) {
  const normalized = raw.toLowerCase();
  return (
    !raw ||
    normalized.includes("replace_with") ||
    normalized.includes("xxxxxxxx") ||
    normalized === "eyj..." ||
    normalized === "eaa..." ||
    normalized === "sk-or-v1-..."
  );
}

function requireEnv(name, hint) {
  if (isPlaceholder(value(name))) {
    failures.push(`${name} is missing or still uses a placeholder. ${hint}`);
  }
}

function requireEither(names, hint) {
  if (!names.some((name) => !isPlaceholder(value(name)))) {
    failures.push(`${names.join(" or ")} is required. ${hint}`);
  }
}

function requireLongSecret(name, minLength) {
  const raw = value(name);
  if (isPlaceholder(raw) || raw.length < minLength) {
    failures.push(`${name} must be a non-placeholder secret at least ${minLength} characters long.`);
  }
}

function mustInclude(file, needle, description) {
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(needle)) {
    failures.push(`${description} is missing from ${file}.`);
  }
}

requireEnv("NEXT_PUBLIC_SUPABASE_URL", "Set the Supabase project URL.");
requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "Set the public anon key used by the dashboard client.");
requireEnv("SUPABASE_SERVICE_ROLE_KEY", "Set the server-only service role key.");
requireEither(["OPENROUTER_API_KEY", "GOOGLE_AI_API_KEY"], "At least one AI provider key is needed for NLU/support.");
if (isPlaceholder(value("GROQ_API_KEY"))) {
  warnings.push("GROQ_API_KEY is not configured. WhatsApp voice notes will be handed to staff instead of transcribed.");
}
requireEnv("WHATSAPP_PHONE_NUMBER_ID", "Set the Meta WhatsApp phone number ID.");
requireEnv("WHATSAPP_ACCESS_TOKEN", "Set a production Meta access token.");
requireEither(["WHATSAPP_APP_SECRET", "META_APP_SECRET"], "Webhook and Flow signature validation require an app secret.");
requireLongSecret("WHATSAPP_VERIFY_TOKEN", 24);
requireLongSecret("RATE_LIMIT_HASH_SECRET", 32);

if (value("WHATSAPP_ALLOW_UNSIGNED_FLOW_ENDPOINT") === "true" && value("NODE_ENV") === "production") {
  failures.push("WHATSAPP_ALLOW_UNSIGNED_FLOW_ENDPOINT must not be true in production.");
}

if (value("WEBHOOK_STORE_RAW_BODY") === "true") {
  warnings.push("WEBHOOK_STORE_RAW_BODY=true retains raw customer payloads. Use only for temporary incident debugging.");
}

if (value("WEBHOOK_RETAIN_PROCESSED_PAYLOAD") === "true") {
  warnings.push("WEBHOOK_RETAIN_PROCESSED_PAYLOAD=true retains processed webhook payloads with customer data.");
}

if (value("ADMIN_RESET_ENABLED") === "true" && value("NODE_ENV") === "production") {
  warnings.push("ADMIN_RESET_ENABLED=true allows admin users to wipe operational data from the dashboard.");
}

if (value("WHATSAPP_FLOW_USE_DATA_EXCHANGE") === "true") {
  requireEnv("WHATSAPP_FLOW_PRIVATE_KEY", "Data exchange Flows need the configured private key.");
}

if (value("WHATSAPP_FLOW_ID") || value("WHATSAPP_FLOW_NAME")) {
  const mode = value("WHATSAPP_FLOW_MODE") || "published";
  if (!["draft", "published"].includes(mode)) {
    failures.push("WHATSAPP_FLOW_MODE must be draft or published.");
  }
}

mustInclude("migrations.sql", "create or replace function place_order_from_payload", "Atomic order placement RPC");
mustInclude("migrations.sql", "create or replace function claim_webhook_event", "Atomic webhook claim RPC");
mustInclude("migrations.sql", "create or replace function check_rate_limit", "Rate-limit RPC");
mustInclude("migrations.sql", "delivery_areas jsonb", "Delivery area settings migration");
mustInclude("migrations.sql", "delivery_status_updated_at", "WhatsApp delivery status timestamp migration");

for (const warning of warnings) {
  console.warn(`WARN: ${warning}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL: ${failure}`);
  }
  process.exit(1);
}

console.log("PASS: Production readiness checks passed.");
