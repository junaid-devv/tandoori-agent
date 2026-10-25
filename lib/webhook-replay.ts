import "server-only";
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "./supabase-admin";
import { readLimitedJsonBody } from "./api-utils";

export function validWebhookWorker(req: NextRequest): boolean {
  const secret = process.env.WORKER_API_KEY;
  if (!secret || secret.length < 32) return false;
  const given = Buffer.from(req.headers.get("x-worker-key") || "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function replayStoredWebhook(req: NextRequest, provider: string, process: (id: string) => Promise<void>) {
  if (!validWebhookWorker(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { eventId } = await readLimitedJsonBody<{ eventId?: string }>(req, 1024);
  if (!eventId || !/^[0-9a-f-]{36}$/i.test(eventId)) return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
  const { data, error } = await supabaseAdmin.from("webhook_events").select("id").eq("id", eventId).eq("provider", provider).maybeSingle();
  if (error) throw error;
  if (!data) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  await process(data.id);
  return NextResponse.json({ success: true });
}
