import { NextRequest, NextResponse } from "next/server";
import { apiErrorResponse, readLimitedJsonBody } from "@/lib/api-utils";
import { requireApiSession } from "@/lib/branch-request";
import { isBranchAllowed } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase-admin";

type AlertPatchBody = {
  status?: "acknowledged" | "resolved";
};

const ALERT_BODY_LIMIT_BYTES = 1024;
const MUTABLE_ALERT_STATUSES = new Set(["acknowledged", "resolved"]);

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiSession();
  if (auth.response || !auth.session) {
    return auth.response ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const { data: existingAlert, error: lookupError } = await supabaseAdmin
    .from("staff_alerts")
    .select("id, branch_id")
    .eq("id", id)
    .maybeSingle();

  if (lookupError) {
    return apiErrorResponse(lookupError, { fallback: "Failed to load staff alert.", context: "staff alert PATCH lookup" });
  }

  const alertRow = existingAlert as { id: string; branch_id: string } | null;
  if (!alertRow || !isBranchAllowed(auth.session, alertRow.branch_id)) {
    return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  }

  let body: AlertPatchBody;
  try {
    body = await readLimitedJsonBody<AlertPatchBody>(req, ALERT_BODY_LIMIT_BYTES);
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Invalid staff alert request.", context: "staff alert PATCH" });
  }

  const nextStatus = body.status?.trim();
  if (!nextStatus || !MUTABLE_ALERT_STATUSES.has(nextStatus)) {
    return NextResponse.json({ error: "Status must be acknowledged or resolved." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("staff_alerts")
    .update({
      status: nextStatus,
      resolved_at: nextStatus === "resolved" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", alertRow.id)
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
      updated_at
    `)
    .single();

  if (error || !data) {
    return apiErrorResponse(error, { fallback: "Failed to update staff alert.", context: "staff alert PATCH update" });
  }

  return NextResponse.json(data);
}
