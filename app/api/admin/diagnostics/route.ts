import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { requireApiSession } from "@/lib/branch-request";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const auth = await requireApiSession();
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
        turn_seq,
        channel,
        user_message,
        system_response,
        stage_before,
        stage_after,
        detected_intent,
        confidence_score,
        model_name,
        provider,
        latency_ms,
        used_semantic_search,
        result_status,
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
        event_type,
        status,
        retry_count,
        error_message,
        created_at,
        processed_at
      `)
      .order("created_at", { ascending: false })
      .limit(30);

    // 3. Fetch active rate limit count
    const rateLimitsQuery = supabaseAdmin
      .from("rate_limits")
      .select("key, count, expires_at", { count: "exact" })
      .gt("expires_at", new Date().toISOString())
      .limit(20);

    const [turnsRes, webhooksRes, rateLimitsRes] = await Promise.all([
      turnsQuery,
      webhooksQuery,
      rateLimitsQuery,
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
      turns,
      webhooks,
    });
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Failed to load system diagnostics", context: "admin diagnostics GET" });
  }
}
