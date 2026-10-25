import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { requireSuperAdminSession } from "@/lib/admin-request";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdminSession();
  if (auth.response || !auth.session) {
    return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 100);

  try {
    // 1. Fetch recent agent turns
    const turnsQuery = supabaseAdmin
      .from("agent_turns")
      .select(`
        id,
        conversation_id,
        system_response:assistant_reply,
        stage_before,
        stage_after,
        detected_intent:nlu_intent,
        confidence_score:nlu_confidence,
        latency_ms,
        used_semantic_search,
        result_status:processing_result,
        error_message,
        created_at
      `)
      .order("created_at", { ascending: false })
      .limit(limit);

    // 2. Fetch recent webhook events
    const webhooksQuery = supabaseAdmin
      .from("webhook_events")
      .select(`
        id,
        provider,
        status,
        retry_count:attempt_count,
        error_message:last_error,
        created_at,
        processed_at
      `)
      .order("created_at", { ascending: false })
      .limit(30);

    // 3. Fetch active rate limit count
    const rateLimitsQuery = supabaseAdmin
      .from("rate_limits")
      .select("scope, request_count, blocked_until", { count: "exact" })
      .gt("blocked_until", new Date().toISOString())
      .limit(20);

    // 4. Fetch WhatsApp configs health
    const whatsappQuery = supabaseAdmin
      .from("whatsapp_configs")
      .select("id, phone_number_id, display_phone_number, is_active, updated_at, restaurant_id")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(10);

    // 5. Fetch active branches count
    const branchesQuery = supabaseAdmin
      .from("branches")
      .select("id, name, restaurant_id", { count: "exact" })
      .eq("is_active", true)
      .limit(10);

    const [turnsRes, webhooksRes, rateLimitsRes, waConfigRes, branchesRes] = await Promise.all([
      turnsQuery,
      webhooksQuery,
      rateLimitsQuery,
      whatsappQuery,
      branchesQuery,
    ]);

    if (turnsRes.error) {
      console.error("Failed to load agent turns:", turnsRes.error);
    }
    if (webhooksRes.error) {
      console.error("Failed to load webhooks:", webhooksRes.error);
    }

    const turns = turnsRes.data ?? [];
    const webhooks = webhooksRes.data ?? [];

    // Calculate aggregated metrics
    const totalTurns = turns.length;
    const avgLatency =
      totalTurns > 0
        ? Math.round(turns.reduce((acc, t) => acc + (t.latency_ms || 0), 0) / totalTurns)
        : 0;

    const successfulTurns = turns.filter((t) => t.result_status === "success").length;
    const fallbackTurns = turns.filter((t) => t.result_status === "fallback").length;
    const escalatedTurns = turns.filter((t) => t.result_status === "escalate_to_human").length;

    const webhookStatusCounts = webhooks.reduce<Record<string, number>>((acc, w) => {
      acc[w.status] = (acc[w.status] || 0) + 1;
      return acc;
    }, {});

    const waConfigs = waConfigRes.data ?? [];
    const waHealth = {
      mock_mode_active: process.env.MOCK_WHATSAPP === "true",
      configured_phone_numbers: waConfigs.map((c: any) => ({
        phone_number_id: c.phone_number_id,
        display_phone_number: c.display_phone_number,
        is_active: c.is_active,
        updated_at: c.updated_at,
      })),
      has_access_token_in_env: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
      has_verify_token_in_env: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
      total_active_configs: waConfigs.length,
      total_active_branches: branchesRes.count ?? 0,
      issues: [] as string[],
    };

    if (waHealth.mock_mode_active) {
      waHealth.issues.push("MOCK_WHATSAPP=true — bot replies are only logged, NOT sent to customers!");
    }
    if (waHealth.total_active_configs === 0) {
      waHealth.issues.push("No active WhatsApp configs found. Connect WhatsApp in the dashboard.");
    }
    if (waHealth.total_active_branches === 0) {
      waHealth.issues.push("No active branches found. Add at least one branch to process orders.");
    }

    return NextResponse.json({
      metrics: {
        total_recent_turns: totalTurns,
        avg_latency_ms: avgLatency,
        success_rate: totalTurns > 0 ? Math.round((successfulTurns / totalTurns) * 100) : 100,
        fallback_count: fallbackTurns,
        escalated_count: escalatedTurns,
        webhook_status_counts: webhookStatusCounts,
        active_rate_limits: rateLimitsRes.count ?? 0,
      },
      whatsapp_health: waHealth,
      turns,
      webhooks,
    });
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Failed to load system diagnostics", context: "admin diagnostics GET" });
  }
}
