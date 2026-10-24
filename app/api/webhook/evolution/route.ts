import { after, NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { readLimitedJsonBody, apiErrorResponse } from "@/lib/api-utils";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { evolutionRequest, verifyEvolutionWebhook } from "@/lib/evolution-client";
import type { EvolutionEnvelope, EvolutionEventData, EvolutionInstance } from "@/lib/evolution-types";
import { normalizeEvolutionMessage, evolutionMessageId, evolutionDeliveryStatus } from "@/lib/evolution-webhook";
import { getRestaurantProfile } from "@/lib/restaurant-profile";
import { getActiveBranches } from "@/lib/branches";
import { withWhatsAppTransport } from "@/lib/whatsapp-context";
import { processOneMessage, processEchoMessage } from "@/lib/whatsapp-inbound";
import { isBotSentMessageId } from "@/lib/whatsapp";
import { messageRepo } from "@/lib/data/message.repo";
import { claimWebhookEvent, recordWebhookEvent, markWebhookEventProcessed, markWebhookEventFailed } from "@/lib/webhook-events";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await readLimitedJsonBody<EvolutionEnvelope>(req, 1024 * 1024);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
    const instance = typeof body.instance === "string" ? body.instance : "";
    if (!instance || !verifyEvolutionWebhook(instance, req.headers.get("authorization"))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const eventName = String(body.event || "").toLowerCase().replaceAll("_", ".");
    if (!["messages.upsert", "messages.update", "connection.update"].includes(eventName)) return NextResponse.json({ status: "ignored_event" });
    const { data: config, error } = await supabaseAdmin.from("evolution_configs").select("restaurant_id, instance_name, is_active")
      .eq("instance_name", instance).maybeSingle();
    if (error) throw error;
    if (!config?.is_active) return NextResponse.json({ error: "Unknown or inactive instance" }, { status: 404 });
    // Do not persist the envelope's apikey, server_url, or caller-supplied tenant IDs.
    const payload = { event: eventName, instance, data: body.data };
    const rawBody = JSON.stringify(payload);
    const dataId = !Array.isArray(body.data) ? body.data?.key?.id : undefined;
    const identity = eventName === "messages.upsert" && dataId ? `${instance}:${eventName}:${dataId}` : `${instance}:${rawBody}`;
    const event = await recordWebhookEvent({ rawBody, payload, signature: null, provider: "evolution", deliveryKey: `evolution:${createHash("sha256").update(identity).digest("hex")}` });
    after(async () => {
      const claimed = await claimWebhookEvent(event.id);
      if (!claimed) return;
      try {
        await processEvent(claimed.payload as typeof payload, config.restaurant_id);
        await markWebhookEventProcessed(event.id);
      } catch (failure) {
        console.error("[evolution-webhook] Processing failed", event.id, failure);
        await markWebhookEventFailed(event.id, failure instanceof Error ? failure.message : "Processing failed");
      }
    });
    return NextResponse.json({ status: "received" });
  } catch (error) {
    return apiErrorResponse(error, { fallback: "Failed to receive Evolution event", context: "POST /api/webhook/evolution" });
  }
}

async function processEvent(payload: { event: string; instance: string; data?: EvolutionEventData | EvolutionEventData[] }, restaurantId: string) {
  const { instance, event } = payload;
  const data = payload.data || {};
  if (event === "connection.update") {
    if (Array.isArray(data)) throw new Error("Invalid connection event");
    const update: Record<string, unknown> = { connection_status: String(data?.state || "close"), updated_at: new Date().toISOString() };
    // Owner identity is read from this instance, never from an unrelated global session.
    if (data?.state === "open") {
      const instances = await evolutionRequest<EvolutionInstance[]>(`/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`);
      const own = instances.find(item => (item.name || item.instance?.instanceName) === instance);
      if (own) {
        update.display_phone_number = String(own.ownerJid || own.instance?.owner || "").split("@")[0].split(":")[0] || null;
        update.verified_name = own.profileName || own.instance?.profileName || null;
      }
    }
    const { error } = await supabaseAdmin.from("evolution_configs").update(update).eq("restaurant_id", restaurantId).eq("instance_name", instance);
    if (error) throw error;
    return;
  }
  if (event === "messages.update") {
    for (const receipt of Array.isArray(data) ? data : [data]) {
      const status = evolutionDeliveryStatus(receipt?.status ?? receipt?.update?.status);
      const id = receipt?.keyId || receipt?.key?.id;
      if (status && id) await messageRepo.applyDeliveryStatus(evolutionMessageId(instance, String(id)), status);
    }
    return;
  }
  const profile = await getRestaurantProfile(restaurantId);
  if (profile.whatsapp_provider !== "evolution") return;
  const branches = await getActiveBranches(restaurantId);
  if (!branches.length) throw new Error("Restaurant has no active branch");
  const { data: config, error } = await supabaseAdmin.from("evolution_configs").select("display_phone_number")
    .eq("restaurant_id", restaurantId).eq("instance_name", instance).single();
  if (error) throw error;
  await withWhatsAppTransport({ provider: "evolution", restaurantId, instanceName: instance }, async () => {
    for (const incoming of Array.isArray(data) ? data : [data]) {
      const message = normalizeEvolutionMessage(instance, incoming || {});
      if (!message) continue;
      if (isBotSentMessageId(message.id)) continue;
      // Persistent outbound IDs survive serverless restarts and prevent bot echoes pausing AI.
      if (incoming.key?.fromMe === true) {
        if (await messageRepo.getByWhatsappId(message.id)) continue;
        await new Promise(resolve => setTimeout(resolve, 750));
        if (await messageRepo.getByWhatsappId(message.id)) continue;
        await processEchoMessage(message, message.from, branches[0], restaurantId, config?.display_phone_number || undefined);
        continue;
      }
      if (message.type === "audio") {
        message.mediaMetadata = { evolutionMessageKey: incoming.key };
        message.mediaBytes = async () => {
          const media = await evolutionRequest(`/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`, "POST", { message: { key: incoming.key }, convertToMp4: false });
          if (typeof media.base64 !== "string") throw new Error("Evolution returned no audio data");
          const bytes = Buffer.from(media.base64.replace(/^data:[^,]+,/, ""), "base64");
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        };
      }
      await processOneMessage(message, String(incoming.pushName || ""), branches[0], profile, undefined, restaurantId, config?.display_phone_number || undefined);
    }
  });
}
