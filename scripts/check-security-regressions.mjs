import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function mustInclude(source, token, message) {
  if (!source.includes(token)) {
    fail(message);
    return;
  }
  pass(message.replace("Missing", "Found"));
}

function listFiles(dir, result = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relativePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listFiles(relativePath, result);
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      result.push(relativePath);
    }
  }
  return result;
}

function failIfAnyApiRouteMatches(pattern, description) {
  const matches = [];
  for (const file of listFiles("app/api")) {
    const text = read(file);
    if (pattern.test(text)) {
      matches.push(file);
    }
  }

  if (matches.length > 0) {
    fail(`${description}: ${matches.join(", ")}`);
    return;
  }

  pass(`No ${description.toLowerCase()} found.`);
}

const schema = read("supabase-schema.sql");
const migrations = read("migrations.sql");
const supabaseAdmin = read("lib/supabase-admin.ts");
const loginRoute = read("app/api/auth/login/route.ts");
const webhookRoute = read("app/api/webhook/route.ts");
const webhookEvents = read("lib/webhook-events.ts");
const flowRoute = read("app/api/whatsapp/flows/route.ts");
const healthRoute = read("app/api/health/route.ts");
const adminResetRoute = read("app/api/admin/reset/route.ts");
const adminHelpers = read("lib/admin.ts");
const adminConsole = read("app/components/dashboard/AdminConsole.tsx");
const proxy = read("proxy.ts");
const nextConfig = read("next.config.ts");
const gitignore = read(".gitignore");
const envExample = read(".env.example");
const apiUtils = read("lib/api-utils.ts");
const menuProcessRoute = read("app/api/menu/process/route.ts");
const conversationRoute = read("app/api/conversations/[id]/route.ts");
const orderStatusRoute = read("app/api/orders/[id]/status/route.ts");
const loginRouteForBodyLimits = read("app/api/auth/login/route.ts");
const adminBranchesRoute = read("app/api/admin/branches/route.ts");
const adminStaffRoute = read("app/api/admin/staff/route.ts");
const staffAlertsRoute = read("app/api/staff-alerts/route.ts");
const staffAlertRoute = read("app/api/staff-alerts/[id]/route.ts");
const dashboardPage = read("app/dashboard/page.tsx");

if (/create policy "service_[^"]+"[^;]+using \(true\)/i.test(schema + "\n" + migrations)) {
  fail("Detected permissive service_* RLS policy using (true).");
} else {
  pass("No permissive service_* RLS policy found.");
}

mustInclude(schema, "create table if not exists rate_limits", "Missing rate_limits table in base schema.");
mustInclude(migrations, "create table if not exists rate_limits", "Missing rate_limits table in migrations.");
mustInclude(schema, "create or replace function check_rate_limit", "Missing check_rate_limit RPC in base schema.");
mustInclude(migrations, "create or replace function check_rate_limit", "Missing check_rate_limit RPC in migrations.");
mustInclude(schema, "create or replace function claim_webhook_event", "Missing atomic webhook claim RPC in base schema.");
mustInclude(migrations, "create or replace function claim_webhook_event", "Missing atomic webhook claim RPC in migrations.");
mustInclude(webhookEvents, "supabaseAdmin.rpc(\"claim_webhook_event\"", "Missing atomic webhook claim RPC usage.");
mustInclude(webhookEvents, "WEBHOOK_STORE_RAW_BODY", "Missing raw webhook body privacy gate.");
mustInclude(webhookEvents, "WEBHOOK_RETAIN_PROCESSED_PAYLOAD", "Missing processed webhook payload retention gate.");
mustInclude(webhookEvents, "redacted_after_processing", "Missing processed webhook payload redaction.");
mustInclude(supabaseAdmin, "let adminClient", "Missing lazy Supabase admin singleton.");
mustInclude(supabaseAdmin, "new Proxy", "Missing lazy Supabase admin proxy.");
mustInclude(loginRoute, "scope: \"dashboard_login\"", "Missing dashboard login rate limit.");
mustInclude(webhookRoute, "scope: \"whatsapp_webhook\"", "Missing WhatsApp webhook rate limit.");
mustInclude(webhookRoute, "alertStaffForFailedWebhook", "Missing failed webhook staff alert path.");
mustInclude(webhookRoute, "kind: \"webhook_processing\"", "Missing webhook_processing staff alert kind usage.");
mustInclude(flowRoute, "scope: \"whatsapp_flow\"", "Missing WhatsApp Flow rate limit.");
mustInclude(flowRoute, "WHATSAPP_ALLOW_UNSIGNED_FLOW_ENDPOINT", "Missing explicit dev-only unsigned Flow override.");
mustInclude(healthRoute, "HEALTHCHECK_SECRET", "Missing optional healthcheck secret enforcement.");
mustInclude(healthRoute, "supabaseAdmin.from(\"branches\")", "Missing healthcheck database connectivity check.");
mustInclude(healthRoute, "databaseSchema", "Missing healthcheck database schema-shape check.");
mustInclude(healthRoute, "delivery_status_updated_at", "Missing healthcheck message schema check.");
mustInclude(healthRoute, "rate_limits", "Missing healthcheck rate_limits schema check.");
mustInclude(adminResetRoute, "ADMIN_RESET_ENABLED", "Missing production gate for destructive admin reset.");
mustInclude(adminResetRoute, "WIPE ALL OPERATIONAL DATA", "Missing typed confirmation for all-data wipe.");
mustInclude(adminResetRoute, "expectedBranchConfirmation", "Missing typed confirmation for branch wipe.");
mustInclude(adminHelpers, "throwIfSupabaseError", "Missing Supabase error checks in operational wipe helper.");
mustInclude(adminHelpers, "MIN_STAFF_PASSWORD_LENGTH = 8", "Missing backend staff password minimum.");
mustInclude(adminConsole, "MIN_STAFF_PASSWORD_LENGTH = 8", "Missing dashboard staff password minimum.");
mustInclude(proxy, "sec-fetch-site", "Missing cross-site API mutation guard.");
mustInclude(proxy, "refreshDashboardSession", "Missing dashboard session refresh in proxy.");
mustInclude(proxy, "grant_type=refresh_token", "Missing Supabase refresh-token exchange.");
mustInclude(proxy, "requestHeaders.set(\"cookie\"", "Missing refreshed cookie forwarding to route handlers.");
mustInclude(proxy, "matcher: [\"/api/:path*\", \"/dashboard/:path*\"]", "Missing API/dashboard proxy matcher.");
mustInclude(apiUtils, "readLimitedJsonBody", "Missing shared limited JSON body reader.");
mustInclude(apiUtils, "process.env.NODE_ENV === \"production\"", "Missing production error sanitization helper.");
mustInclude(menuProcessRoute, "validateMenuImageUrl", "Missing menu image URL validation.");
mustInclude(menuProcessRoute, "parsed.protocol !== \"https:\"", "Missing HTTPS-only menu image URL guard.");
mustInclude(conversationRoute, "MANUAL_MESSAGE_MAX_CHARS", "Missing manual outbound message length limit.");
mustInclude(orderStatusRoute, "STATUS_BODY_LIMIT_BYTES", "Missing order status body limit.");
mustInclude(loginRouteForBodyLimits, "LOGIN_BODY_LIMIT_BYTES", "Missing login body limit.");
mustInclude(adminBranchesRoute, "BRANCH_BODY_LIMIT_BYTES", "Missing admin branch mutation body limit.");
mustInclude(adminStaffRoute, "STAFF_BODY_LIMIT_BYTES", "Missing admin staff mutation body limit.");
mustInclude(gitignore, "!.env.example", "Missing .env.example tracking exception in .gitignore.");
mustInclude(envExample, "ADMIN_RESET_ENABLED=false", "Missing ADMIN_RESET_ENABLED example.");
mustInclude(envExample, "RATE_LIMIT_HASH_SECRET=", "Missing rate-limit secret example.");
mustInclude(staffAlertsRoute, "resolveRequestBranch", "Missing branch-scoped staff alerts list API.");
mustInclude(staffAlertRoute, "isBranchAllowed", "Missing branch access check for staff alert mutation.");
mustInclude(staffAlertRoute, "ALERT_BODY_LIMIT_BYTES", "Missing staff alert mutation body limit.");
mustInclude(dashboardPage, "Staff Alerts", "Missing staff alert dashboard panel.");
mustInclude(dashboardPage, "/api/staff-alerts", "Missing staff alert dashboard data fetch.");

failIfAnyApiRouteMatches(/\breq\.json\s*\(/, "raw req.json API body parsing");
failIfAnyApiRouteMatches(
  /NextResponse\.json\(\{\s*error:\s*(?:error\.message|message|messageText|[^}\n]*\?\.message)/,
  "raw API error message responses",
);

if (nextConfig.includes("allowedOrigins: [\"*\"]")) {
  fail("Detected wildcard Server Actions allowedOrigins.");
} else {
  pass("No wildcard Server Actions allowedOrigins found.");
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}
