import { supabaseAdmin } from "@/lib/supabase-admin";
import { replayStoredWebhook } from "@/lib/webhook-replay";
/**
 * app/api/webhook/route.ts — Single-Branch Edition
 *
 * Transport only: verify signature → record event → 200 immediately.
 * All heavy work runs inside after() via processWebhookEventInBackground.
 *
 * Single-branch model: each restaurant has exactly one active branch.
 * The webhook auto-assigns it — no city/branch selection prompts.
 * Full tenant isolation: every message is routed via phone_number_id → restaurant_id.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextRequest, NextResponse } from "next/server";
import { processOneMessage, processEchoMessage, type IncomingWhatsAppMessage } from "@/lib/whatsapp-inbound";
import { getActiveWhatsAppProvider, withWhatsAppTransport } from "@/lib/whatsapp-context";
import { contactRepo } from "@/lib/data/contact.repo";
import { messageRepo } from "@/lib/data/message.repo";
import { getActiveBranches, type BranchRecord } from "@/lib/branches";
import { getRestaurantProfile } from "@/lib/restaurant-profile";
import { getRestaurantByPhoneNumberId } from "@/lib/restaurant-resolver";
import { createStaffAlert } from "@/lib/staff-alerts";
import { buildRateLimitHeaders, checkRateLimit, getClientIp } from "@/lib/rate-limit";

import {
  claimWebhookEvent,
  markWebhookEventFailed,
  markWebhookEventProcessed,
  recordWebhookEvent,
} from "@/lib/webhook-events";
import { isBotSentMessageId } from "@/lib/whatsapp";
import { processUniversityWebhookMessage } from "@/lib/university/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;


// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------
type IncomingWhatsAppStatus = {
  id?: string;
  recipient_id?: string;
  phoneNumberId?: string;
  status?: string;
  timestamp?: string;
  errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>;
};

type IncomingEnvelope = {
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        messaging_product?: string;
        metadata?: { phone_number_id?: string; display_phone_number?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: IncomingWhatsAppMessage[];
        statuses?: IncomingWhatsAppStatus[];
        message_echoes?: IncomingWhatsAppMessage[];
      };
    }>;
  }>;
};

// ---------------------------------------------------------------------------
// GET — Meta webhook verification
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");
  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// ---------------------------------------------------------------------------
// POST — ingest + 200 immediately
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  if (req.headers.has("x-worker-key")) return replayStoredWebhook(req, "meta_whatsapp", processWebhookEventInBackground);
  const signature = req.headers.get("x-hub-signature-256");
  const rateLimit = await checkRateLimit({
    scope: "whatsapp_webhook",
    identifier: getClientIp(req),
    limit: Number(process.env.WHATSAPP_WEBHOOK_RATE_LIMIT_EVENTS) || 600,
    windowSeconds: Number(process.env.WHATSAPP_WEBHOOK_RATE_LIMIT_WINDOW_SECONDS) || 60,
    blockSeconds: Number(process.env.WHATSAPP_WEBHOOK_RATE_LIMIT_BLOCK_SECONDS) || 60,
  });
  if (!rateLimit.allowed) {
    return new Response("Too Many Requests", { status: 429, headers: buildRateLimitHeaders(rateLimit) });
  }

  let rawBody = "";
  let body: unknown;
  try {
    rawBody = await req.text();
    if ((process.env.MOCK_WHATSAPP !== "true" || process.env.NODE_ENV === "production") && !isValidWhatsAppSignature(rawBody, signature)) {
      console.warn("[webhook] Incoming POST rejected with 401 Unauthorized due to signature mismatch.");
      return new Response("Unauthorized", { status: 401 });
    }
    body = JSON.parse(rawBody) as unknown;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }



  try {
    const event = await recordWebhookEvent({ rawBody, payload: body, signature });
    after(async () => { await processWebhookEventInBackground(event.id); });
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[webhook] Failed to record event:", error);
    return new Response("Server Error", { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Background processing
// ---------------------------------------------------------------------------
async function processWebhookEventInBackground(eventId: string) {
  const claimed = await claimWebhookEvent(eventId);
  if (!claimed) return;
  try {
    await processWebhook(claimed.payload);
    // Fire-and-forget: marking processed doesn't affect customer experience
    await markWebhookEventProcessed(eventId).catch((e) => console.error("[webhook] mark-processed failed:", e));
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[webhook] Background processing failed:", msg, error);
    // Fire-and-forget: don't let bookkeeping errors mask the original failure
    await markWebhookEventFailed(eventId, msg).catch((e) => console.error("[webhook] mark-failed failed:", e));
    void alertStaffForFailedWebhook(claimed.payload, eventId, msg).catch((e) => {
      console.error("[webhook] Staff alert failed:", e);
    });
  }
}

// ---------------------------------------------------------------------------
// Short-TTL process-level cache for branches/profile (fetched on EVERY webhook)
// These rarely change and are safe to cache for a few seconds across concurrent
// requests. Full invalidation on admin save handles correctness.
// ---------------------------------------------------------------------------
const _branchesCacheMap = new Map<string, { data: BranchRecord[]; at: number }>();
const BRANCH_CACHE_MS = 10_000; // 10 seconds

async function getCachedBranches(restaurantId: string): Promise<BranchRecord[]> {
  const cached = _branchesCacheMap.get(restaurantId);
  if (cached && Date.now() - cached.at < BRANCH_CACHE_MS) return cached.data;
  const data = await getActiveBranches(restaurantId);
  _branchesCacheMap.set(restaurantId, { data, at: Date.now() });
  return data;
}

async function getCachedProfile(restaurantId: string): Promise<Awaited<ReturnType<typeof getRestaurantProfile>>> {
  // Use the shared cache so provider switches invalidate webhook routing immediately.
  return getRestaurantProfile(restaurantId);
}

async function processWebhook(body: unknown) {
  // 1) Status events (delivery receipts)
  const statusEvents = extractStatusEvents(body);
  if (statusEvents.length > 0) {
    await updateDeliveryStatuses(statusEvents);
  }

  // 2) Coexistence: smb_message_echoes (owner replied manually from WhatsApp Business phone app)
  const echoes = extractEchoes(body);
  for (const { message, customerPhone, phoneNumberId } of echoes) {
    try {
      if (!phoneNumberId) {
        console.warn("[webhook] Missing phone_number_id for echo, skipping");
        continue;
      }
      const restaurantCtx = await getRestaurantByPhoneNumberId(phoneNumberId);
      if (!restaurantCtx) {
        console.warn("[webhook] Unknown phone_number_id for echo, skipping:", phoneNumberId);
        continue;
      }
      const branches = await getCachedBranches(restaurantCtx.restaurantId);
      if (branches.length === 0) continue;
      const businessPhone = restaurantCtx.whatsappConfig?.display_phone_number?.replace(/[^0-9]/g, "") ||
        restaurantCtx.profile?.support_phone?.replace(/[^0-9]/g, "") || undefined;
      if (await getActiveWhatsAppProvider(restaurantCtx.restaurantId) !== "meta") continue;
      await withWhatsAppTransport({ provider: "meta", restaurantId: restaurantCtx.restaurantId, phoneNumberId }, () => processEchoMessage(message, customerPhone, branches[0], restaurantCtx.restaurantId, businessPhone));
    } catch (error) {
      console.error("[webhook-coexistence] Failed to process echo:", { customerPhone, error });
      throw error;
    }
  }

  // 3) Normal incoming customer messages
  const events = extractMessages(body);
  if (events.length === 0) return;

  // University Admissions Mode
  if (process.env.APP_MODE === "university") {
    for (const { message, contactName, phoneNumberId } of events) {
      try {
        const incomingContent = await extractContent(message);
        if (incomingContent) {
          await processUniversityWebhookMessage({
            phone: message.from,
            contactName,
            messageContent: incomingContent,
            rawMessageId: message.id,
            phoneNumberId,
          });
        }
      } catch (error) {
        console.error("[webhook-university] Failed to process message:", { from: message.from, error });
      }
    }
    return;
  }

  for (const { message, contactName, phoneNumberId } of events) {
    try {
      if (!phoneNumberId) {
        console.warn("[webhook] Missing phone_number_id in incoming message — check Meta webhook subscription. Skipping message from:", message.from);
        continue;
      }
      const restaurantCtx = await getRestaurantByPhoneNumberId(phoneNumberId);
      if (!restaurantCtx) {
        console.warn(
          `[webhook] phone_number_id "${phoneNumberId}" is NOT registered in whatsapp_configs. ` +
          `Please connect WhatsApp in the dashboard (Settings > WhatsApp). Dropping message from: ${message.from}`
        );
        continue;
      }
      const [branches, profile] = await Promise.all([
        getCachedBranches(restaurantCtx.restaurantId),
        getCachedProfile(restaurantCtx.restaurantId),
      ]);
      if (await getActiveWhatsAppProvider(restaurantCtx.restaurantId) !== "meta") continue;
      if (branches.length === 0) {
        console.warn(`[webhook] Restaurant ${restaurantCtx.restaurantId} has no active branches. Cannot process message from: ${message.from}`);
        continue;
      }
      // Single-branch: always use the first (only) active branch — no selection prompt needed.
      const branch = branches[0];
      const businessPhone = restaurantCtx.whatsappConfig?.display_phone_number?.replace(/[^0-9]/g, "") ||
        profile.support_phone?.replace(/[^0-9]/g, "") || undefined;
      await withWhatsAppTransport({ provider: "meta", restaurantId: restaurantCtx.restaurantId, phoneNumberId }, () => processOneMessage(message, contactName, branch, profile, phoneNumberId, restaurantCtx.restaurantId, businessPhone));
    } catch (error) {
      console.error("[webhook] Failed to process message:", { from: message.from, phoneNumberId, error });
      throw error;
    }
  }
}


// ---------------------------------------------------------------------------
// Coexistence Echo Processing (Restaurant Owner replying from Phone App)
// ---------------------------------------------------------------------------
async function updateDeliveryStatuses(statuses: IncomingWhatsAppStatus[]) {
  // Fan out all delivery-status updates in parallel — no ordering requirement
  await Promise.all(
    statuses
      .filter((s) => s.id && s.status)
      .map(async (s) => {
        if (!s.phoneNumberId) return;
        const { data: config, error } = await supabaseAdmin.from("whatsapp_configs").select("restaurant_id").eq("phone_number_id", s.phoneNumberId).maybeSingle();
        if (error) throw error;
        if (!config) return;
        const nextStatus = normalizeDeliveryStatus(s.status!);
        if (!nextStatus) return Promise.resolve();
        const errText = s.errors?.[0]
          ? `${s.errors[0].title ?? ""}: ${s.errors[0].error_data?.details ?? s.errors[0].message ?? ""}`.trim()
          : null;
        return messageRepo.applyDeliveryStatus(s.id!, nextStatus, { restaurantId: config.restaurant_id, error: errText, atIso: s.timestamp ? toIso(s.timestamp) : null });
      }),
  );
}

function normalizeDeliveryStatus(v: string): import("@/lib/schema.types").MessageDeliveryStatus | null {
  if (v === "pending" || v === "sent" || v === "delivered" || v === "read" || v === "failed") return v;
  return null;
}

// ---------------------------------------------------------------------------
// Contact / conversation upsert (thin wrappers)
// ---------------------------------------------------------------------------
function extractMessages(body: unknown): Array<{ message: IncomingWhatsAppMessage; contactName: string; phoneNumberId?: string }> {
  const envelope = body as IncomingEnvelope;
  const out: Array<{ message: IncomingWhatsAppMessage; contactName: string; phoneNumberId?: string }> = [];
  for (const entry of envelope.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const field = change.field;
      // Ignore coexistence echoes and sync events here (handled separately)
      if (field === "smb_message_echoes" || field === "history" || field === "smb_app_state_sync") {
        continue;
      }
      const value = change.value;
      const contactName = value?.contacts?.[0]?.profile?.name ?? "";
      const phoneNumberId = value?.metadata?.phone_number_id;
      for (const msg of value?.messages ?? []) {
        if (isBotSentMessageId(msg.id)) continue;
        out.push({ message: msg, contactName, phoneNumberId });
      }
    }
  }
  return out;
}

function extractEchoes(body: unknown): Array<{ message: IncomingWhatsAppMessage; customerPhone: string; phoneNumberId?: string }> {
  const envelope = body as IncomingEnvelope;
  const out: Array<{ message: IncomingWhatsAppMessage; customerPhone: string; phoneNumberId?: string }> = [];
  for (const entry of envelope.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const isEchoField = change.field === "smb_message_echoes";
      const value = change.value;
      const msgs = value?.message_echoes || (isEchoField ? value?.messages : []);
      if (!msgs || msgs.length === 0) continue;

      const phoneNumberId = value?.metadata?.phone_number_id;
      const defaultRecipient = value?.contacts?.[0]?.wa_id || "";

      for (const msg of msgs) {
        if (isBotSentMessageId(msg.id)) continue;
        const customerPhone = msg.to || msg.recipient_id || defaultRecipient;
        if (!customerPhone) continue;
        out.push({ message: msg, customerPhone, phoneNumberId });
      }
    }
  }
  return out;
}

function extractStatusEvents(body: unknown): IncomingWhatsAppStatus[] {
  const envelope = body as IncomingEnvelope;
  const out: IncomingWhatsAppStatus[] = [];
  for (const entry of envelope.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const s of (change.value as { statuses?: IncomingWhatsAppStatus[] })?.statuses ?? []) {
        out.push({ ...s, phoneNumberId: change.value?.metadata?.phone_number_id });
      }
    }
  }
  return out;
}

function isValidWhatsAppSignature(rawBody: string, sig: string | null): boolean {
  const secretEnv = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
  if (!secretEnv) {
    console.error("[webhook] Missing WHATSAPP_APP_SECRET in environment variables");
    return false;
  }
  if (!sig?.startsWith("sha256=")) {
    console.error("[webhook] Missing or malformed x-hub-signature-256 header:", sig);
    return false;
  }

  // Support multiple comma-separated secrets (e.g. during app transition or multi-app setups)
  // Clean surrounding quotes and whitespace
  const secrets = secretEnv
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
  const rb = Buffer.from(sig.trim());

  for (const secret of secrets) {
    const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    const eb = Buffer.from(expected);
    if (eb.length === rb.length && timingSafeEqual(eb, rb)) {
      return true;
    }
  }

  console.error(
    `[webhook] 401 Signature mismatch. Received: ${sig?.slice(0, 16)}... Ensure WHATSAPP_APP_SECRET matches App ID: ${process.env.NEXT_PUBLIC_META_APP_ID || process.env.META_APP_ID}`
  );
  return false;
}

// ---------------------------------------------------------------------------
// Conversation processing lock (prevents double-processing concurrent messages)
// ---------------------------------------------------------------------------
async function alertStaffForFailedWebhook(payload: unknown, eventId: string, error: string) {
  try {
    const envelope = payload as IncomingEnvelope;
    const phone = envelope.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
    if (!phone) return;
    const phoneId = envelope.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
    if (!phoneId) return;
    const restaurant = await getRestaurantByPhoneNumberId(phoneId);
    if (!restaurant) return;
    const contact = await contactRepo.getByPhone(phone, restaurant.restaurantId);
    if (!contact?.active_branch_id) return;
    const conv = await supabaseAdmin.from("conversations").select("id").eq("contact_id", contact.id).eq("branch_id", contact.active_branch_id).maybeSingle();
    if (!conv.data?.id) return;
    await createStaffAlert({
      conversationId: conv.data.id,
      branchId: contact.active_branch_id,
      kind: "webhook_processing",
      severity: "high",
      message: `Webhook event ${eventId} failed: ${error}`,
    });
  } catch (e) {
    console.error("[webhook] alertStaffForFailedWebhook failed:", e);
  }
}

function extractContent(message: IncomingWhatsAppMessage): Promise<string | null> {
  return Promise.resolve(message.text?.body || message.interactive?.button_reply?.id || message.interactive?.list_reply?.id || null);
}
function toIso(timestamp: string): string {
  const n = Number(timestamp);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
}
