import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabase-admin";

export type WebhookEventStatus = "received" | "processing" | "processed" | "failed";

export interface WebhookEventRecord {
  id: string;
  provider: string;
  delivery_key: string;
  raw_body: string;
  payload: unknown;
  signature: string | null;
  status: WebhookEventStatus;
  attempt_count: number;
  received_count: number;
  processing_started_at: string | null;
  processed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function parseWebhookEventRecord(value: Record<string, unknown>): WebhookEventRecord {
  return {
    id: String(value.id),
    provider: String(value.provider ?? "meta_whatsapp"),
    delivery_key: String(value.delivery_key),
    raw_body: String(value.raw_body ?? ""),
    payload: value.payload ?? null,
    signature: typeof value.signature === "string" ? value.signature : null,
    status: (value.status as WebhookEventStatus) ?? "received",
    attempt_count: Number(value.attempt_count ?? 0),
    received_count: Number(value.received_count ?? 1),
    processing_started_at: typeof value.processing_started_at === "string" ? value.processing_started_at : null,
    processed_at: typeof value.processed_at === "string" ? value.processed_at : null,
    last_error: typeof value.last_error === "string" ? value.last_error : null,
    created_at: String(value.created_at ?? new Date().toISOString()),
    updated_at: String(value.updated_at ?? new Date().toISOString()),
  };
}

function shouldStoreRawWebhookBody(): boolean {
  return process.env.WEBHOOK_STORE_RAW_BODY === "true";
}

function shouldRetainProcessedWebhookPayload(): boolean {
  return process.env.WEBHOOK_RETAIN_PROCESSED_PAYLOAD === "true";
}

export function getWebhookDeliveryKey(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export async function recordWebhookEvent(input: {
  rawBody: string;
  payload: unknown;
  signature: string | null;
}): Promise<WebhookEventRecord> {
  const deliveryKey = getWebhookDeliveryKey(input.rawBody);
  const fetchExisting = async () => {
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("webhook_events")
      .select("*")
      .eq("delivery_key", deliveryKey)
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (!existing) return null;

    const parsed = parseWebhookEventRecord(existing as Record<string, unknown>);
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("webhook_events")
      .update({
        received_count: parsed.received_count + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", parsed.id)
      .select("*")
      .single();

    if (updateError || !updated) {
      throw updateError ?? new Error("Failed to update webhook event.");
    }

    return parseWebhookEventRecord(updated as Record<string, unknown>);
  };

  const existing = await fetchExisting();
  if (existing) return existing;

  const { data, error } = await supabaseAdmin
    .from("webhook_events")
    .insert({
      provider: "meta_whatsapp",
      delivery_key: deliveryKey,
      raw_body: shouldStoreRawWebhookBody() ? input.rawBody : "[redacted]",
      payload: input.payload,
      signature: input.signature,
      status: "received",
      attempt_count: 0,
      received_count: 1,
    })
    .select("*")
    .single();

  if (error || !data) {
    if (String((error as { code?: string } | null)?.code) === "23505") {
      const raced = await fetchExisting();
      if (raced) return raced;
    }
    throw error ?? new Error("Failed to persist webhook event.");
  }

  return parseWebhookEventRecord(data as Record<string, unknown>);
}

export async function claimWebhookEvent(eventId: string): Promise<WebhookEventRecord | null> {
  const { data, error } = await supabaseAdmin.rpc("claim_webhook_event", {
    p_event_id: eventId,
    p_stale_after_seconds: 90,
  });

  if (error) {
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return row ? parseWebhookEventRecord(row as Record<string, unknown>) : null;
}

export async function markWebhookEventProcessed(eventId: string): Promise<void> {
  const update: Record<string, unknown> = {
    status: "processed",
    processed_at: new Date().toISOString(),
    processing_started_at: null,
    last_error: null,
  };

  if (!shouldRetainProcessedWebhookPayload()) {
    update.payload = {
      redacted_after_processing: true,
      redacted_at: new Date().toISOString(),
    };
  }

  const { error } = await supabaseAdmin
    .from("webhook_events")
    .update(update)
    .eq("id", eventId);

  if (error) throw error;
}

export async function markWebhookEventFailed(eventId: string, errorMessage: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("webhook_events")
    .update({
      status: "failed",
      processing_started_at: null,
      last_error: errorMessage,
    })
    .eq("id", eventId);

  if (error) throw error;
}
