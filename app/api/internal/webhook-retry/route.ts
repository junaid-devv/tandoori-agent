import { NextRequest, NextResponse } from "next/server";
import { validWebhookWorker } from "@/lib/webhook-replay";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { apiErrorResponse } from "@/lib/api-utils";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!validWebhookWorker(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const cutoff = new Date(Date.now() - 120_000).toISOString();
    const { data, error } = await supabaseAdmin.from("webhook_events").select("id, provider, attempt_count, updated_at")
      .or(`status.in.(received,failed),and(status.eq.processing,processing_started_at.lt.${cutoff})`)
      .lt("updated_at", cutoff).lt("attempt_count", 5).order("created_at", { ascending: true }).limit(20);
    if (error) throw error;
    const event = data?.find(row => ["evolution", "meta_whatsapp"].includes(row.provider) && Date.now() - Date.parse(row.updated_at) >= Math.max(120_000, row.attempt_count * 60_000));
    if (!event) return NextResponse.json({ retried: 0 });
    // Use the configured application origin, never an untrusted Host header.
    const appUrl = process.env.APP_URL;
    if (!appUrl || new URL(appUrl).protocol !== "https:") throw new Error("Configure HTTPS APP_URL");
    const endpoint = new URL(event.provider === "evolution" ? "/api/webhook/evolution" : "/api/webhook", appUrl);
    const result = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "x-worker-key": process.env.WORKER_API_KEY! },
      body: JSON.stringify({ eventId: event.id }), signal: AbortSignal.timeout(55_000), redirect: "error" });
    if (!result.ok) throw new Error("Webhook retry endpoint returned " + result.status);
    return NextResponse.json({ retried: 1 });
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Webhook recovery failed", context: "webhook retry worker" });
  }
}
