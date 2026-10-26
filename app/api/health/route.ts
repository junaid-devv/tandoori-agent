import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HealthCheck = {
  ok: boolean;
  message?: string;
};

function hasConfiguredSecret(name: string): boolean {
  const value = process.env[name]?.trim() ?? "";
  return value.length > 0 && !/replace_with|xxxx|eyj\.\.\.|eaa\.\.\.|sk-or-v1-\.\.\./i.test(value);
}

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.HEALTHCHECK_SECRET?.trim();
  if (!expected) return true;

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const querySecret = new URL(req.url).searchParams.get("secret")?.trim();
  return bearer === expected || querySecret === expected;
}

async function checkDatabase(): Promise<HealthCheck> {
  try {
    const { error } = await supabaseAdmin.from("branches").select("id").limit(1);
    if (error) {
      return { ok: false, message: "database query failed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "database client failed" };
  }
}

async function checkTableColumns(table: string, columns: string): Promise<HealthCheck> {
  try {
    const { error } = await supabaseAdmin.from(table).select(columns).limit(1);
    if (error) {
      return { ok: false, message: `${table} schema check failed` };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: `${table} schema check failed` };
  }
}

async function checkDatabaseShape(): Promise<HealthCheck> {
  const checks = await Promise.all([
    checkTableColumns("restaurant_profiles", "id, name, brand_color, branch_mode"),
    checkTableColumns("branches", "id, city, address"),
    checkTableColumns("restaurant_settings", "branch_id, delivery_areas, estimated_prep_minutes, estimated_delivery_minutes"),
    checkTableColumns("messages", "id, whatsapp_msg_id, delivery_status, delivery_status_updated_at, delivery_error"),
    checkTableColumns("webhook_events", "id, status, payload, processed_at, processing_started_at, attempt_count, received_count"),
    checkTableColumns("rate_limits", "scope, identifier_hash, window_start, request_count, blocked_until"),
    checkTableColumns("orders", "id, source_user_message_id, type, pickup_time, status_notification_status"),
    checkTableColumns("contacts", "id, preferred_language, tags, total_orders, last_order_at"),
    checkTableColumns("evolution_configs", "restaurant_id, instance_name, is_active, connection_status"),
    checkTableColumns("conversations", "id, whatsapp_provider, whatsapp_phone_number_id, evolution_instance_name"),
    checkTableColumns("customer_addresses", "id, contact_id, branch_id, address_key, last_used_at"),
    checkTableColumns("menu_items", "id, available_days, available_start_time, available_end_time"),
    checkTableColumns("conversation_states", "conversation_id, stage, cart, pending_clarification, summary_sent_at, processing_token"),
  ]);

  const failed = checks.find((check) => !check.ok);
  if (failed) {
    return { ok: false, message: failed.message ?? "database schema is incomplete" };
  }

  return { ok: true };
}

async function checkOrderIntegrity(): Promise<HealthCheck> {
  try {
    const { data, error } = await supabaseAdmin.rpc("restaurant_agent_integrity_version");
    return { ok: !error && data === "20261025124633", message: error || data !== "20261025124633" ? "restaurant order-integrity migration is required" : undefined };
  } catch {
    return { ok: false, message: "restaurant order-integrity migration check failed" };
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  }

  const checks: Record<string, HealthCheck> = {
    supabaseUrl: { ok: hasConfiguredSecret("NEXT_PUBLIC_SUPABASE_URL") },
    supabaseAnonKey: { ok: hasConfiguredSecret("NEXT_PUBLIC_SUPABASE_ANON_KEY") },
    supabaseServiceKey: { ok: hasConfiguredSecret("SUPABASE_SERVICE_ROLE_KEY") },
    whatsappCredentials: {
      ok:
        (
          (hasConfiguredSecret("WHATSAPP_APP_SECRET") || hasConfiguredSecret("META_APP_SECRET")) &&
          hasConfiguredSecret("WHATSAPP_VERIFY_TOKEN")
        ) || (
          hasConfiguredSecret("EVOLUTION_API_BASE_URL") && hasConfiguredSecret("EVOLUTION_API_KEY") && hasConfiguredSecret("EVOLUTION_WEBHOOK_SECRET")
        ),
    },
    aiProvider: {
      ok: hasConfiguredSecret("GROQ_API_KEY") || hasConfiguredSecret("DEEPSEEK_API_KEY") || hasConfiguredSecret("OPENROUTER_API_KEY"),
    },
    rateLimitSecret: { ok: hasConfiguredSecret("RATE_LIMIT_HASH_SECRET") },
    database: await checkDatabase(),
    databaseSchema: await checkDatabaseShape(),
    orderIntegrity: await checkOrderIntegrity(),
  };

  const ok = Object.values(checks).every((check) => check.ok);

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
