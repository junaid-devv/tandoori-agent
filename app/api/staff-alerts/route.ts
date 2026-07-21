import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse } from "@/lib/api-utils";
import { resolveRequestBranch } from "@/lib/branch-request";
import { supabaseAdmin } from "@/lib/supabase-admin";

const ALERT_STATUSES = new Set(["open", "acknowledged", "resolved"]);

export async function GET(req: NextRequest) {
  const auth = await resolveRequestBranch(req, { allowAllForAdmin: true });
  if (auth.response) {
    return auth.response;
  }

  const { searchParams } = new URL(req.url);
  const requestedStatus = searchParams.get("status")?.trim() || "open";
  const status = ALERT_STATUSES.has(requestedStatus) ? requestedStatus : "open";
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get("limit") ?? "20", 10) || 20, 1), 50);

  let query = supabaseAdmin
    .from("staff_alerts")
    .select(`
      id,
      conversation_id,
      branch_id,
      kind,
      severity,
      status,
      message,
      resolved_at,
      created_at,
      updated_at,
      conversations (phone, name),
      branches (name, slug)
    `)
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (auth.branchId) {
    query = query.eq("branch_id", auth.branchId);
  }

  const { data, error } = await query;
  if (error) {
    return apiErrorResponse(error, { fallback: "Failed to load staff alerts.", context: "staff alerts GET" });
  }

  return NextResponse.json(data ?? []);
}
