/**
 * app/api/webhook/wa-akg/route.ts
 *
 * Dedicated inbound webhook handler for the self-hosted WA-AKG gateway.
 * Bridges incoming WhatsApp Web / Baileys messages into ORDERiQ's AI agent pipeline.
 */

import { after, NextRequest, NextResponse } from "next/server";
import { runTurn } from "@/lib/agent/pipeline";
import { stateRepo } from "@/lib/data/state.repo";
import { contactRepo } from "@/lib/data/contact.repo";
import { conversationRepo } from "@/lib/data/conversation.repo";
import { messageRepo } from "@/lib/data/message.repo";
import { getActiveBranches, type BranchRecord } from "@/lib/branches";
import { escalateToHuman } from "@/lib/handoff";
import { sendAndPersistAssistantMessage } from "@/lib/assistant-dispatcher";
import { getRestaurantProfile } from "@/lib/restaurant-profile";
import { saveCustomerAddressFromOrder, updateCustomerOrderStats } from "@/lib/customer-crm";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildRateLimitHeaders, checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { readLimitedJsonBody } from "@/lib/api-utils";
import { isBotSentMessageId, sendWhatsAppMessage } from "@/lib/whatsapp";
import { inferLanguagePreference } from "@/lib/core/lang-detect";
import type { LanguagePreference } from "@/lib/schema.types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Short cache for branch & restaurant profile
let _branchesCache: { data: BranchRecord[]; at: number } | null = null;
let _profileCache: { data: Awaited<ReturnType<typeof getRestaurantProfile>>; at: number } | null = null;
const CACHE_TTL_MS = 10_000;

async function getCachedBranches(): Promise<BranchRecord[]> {
  if (_branchesCache && Date.now() - _branchesCache.at < CACHE_TTL_MS) return _branchesCache.data;
  const data = await getActiveBranches();
  _branchesCache = { data, at: Date.now() };
  return data;
}

async function getCachedProfile(): Promise<Awaited<ReturnType<typeof getRestaurantProfile>>> {
  if (_profileCache && Date.now() - _profileCache.at < CACHE_TTL_MS) return _profileCache.data;
  const data = await getRestaurantProfile();
  _profileCache = { data, at: Date.now() };
  return data;
}

// Conversation processing lock
async function acquireLock(conversationId: string): Promise<string | null> {
  const token = crypto.randomUUID();
  const staleThresholdMs = 90_000;
  const delays = [150, 250, 400, 600, 800, 1000, 1500, 2000, 2500];
  for (let i = 0; i <= delays.length; i++) {
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - staleThresholdMs).toISOString();
    const { data } = await supabaseAdmin
      .from("conversation_states")
      .update({ processing_token: token, processing_started_at: now })
      .eq("conversation_id", conversationId)
      .is("processing_token", null)
      .select("conversation_id")
      .maybeSingle();
    if (data) return token;

    const { data: staleData } = await supabaseAdmin
      .from("conversation_states")
      .update({ processing_token: token, processing_started_at: now })
      .eq("conversation_id", conversationId)
      .lt("processing_started_at", stale)
      .select("conversation_id")
      .maybeSingle();
    if (staleData) return token;

    if (i < delays.length) await new Promise((r) => setTimeout(r, delays[i]));
  }
  return null;
}

async function releaseLock(conversationId: string, token: string) {
  await supabaseAdmin
    .from("conversation_states")
    .update({ processing_token: null, processing_started_at: null })
    .eq("conversation_id", conversationId)
    .eq("processing_token", token);
}

// GET — Endpoint healthcheck
export async function GET() {
  return NextResponse.json({ status: "ok", gateway: "wa-akg-receiver" });
}

// POST — Process incoming WA-AKG message webhook
export async function POST(req: NextRequest) {
  // Optional rate limiting
  const rateLimit = await checkRateLimit({
    scope: "wa_akg_webhook",
    identifier: getClientIp(req),
    limit: 600,
    windowSeconds: 60,
    blockSeconds: 60,
  });
  if (!rateLimit.allowed) {
    return new Response("Too Many Requests", { status: 429, headers: buildRateLimitHeaders(rateLimit) });
  }

  // Optional webhook secret verification
  const configuredSecret = process.env.WA_AKG_WEBHOOK_SECRET?.trim();
  if (configuredSecret) {
    const headerSecret = req.headers.get("x-webhook-secret");
    const querySecret = req.nextUrl.searchParams.get("secret") || req.nextUrl.searchParams.get("token");
    if (headerSecret !== configuredSecret && querySecret !== configuredSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: Record<string, any>;
  try {
    body = await readLimitedJsonBody<Record<string, any>>(req, 64 * 1024);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // WA-AKG event filtering: only message.received represents incoming customer messages
  const event = String(body.event || "").trim();
  if (event && event !== "message.received") {
    return NextResponse.json({ status: `acknowledged_${event}` });
  }

  // WA-AKG wraps payload inside `data` or passes top-level
  const data = body.data || body;
  const key = data.key || body.key || {};
  const message = data.message || body.message;
  const messageId: string = key.id || data.id || `wa-akg-${Date.now()}`;

  // Guard 1: Ignore messages sent by our bot (prevent loop / echo)
  if (messageId && isBotSentMessageId(messageId)) {
    return NextResponse.json({ status: "ignored_bot_sent" });
  }

  // Raw JID & Phone resolution
  const receiverJid: string = String(data.receiver || body.receiver || "").trim();
  const rawJid: string = String(key.remoteJid || data.from || body.from || "").trim();

  // Guard 2: Ignore WhatsApp groups, broadcasts, and newsletters
  if (!rawJid || rawJid.endsWith("@g.us") || rawJid.includes("broadcast") || rawJid.includes("@newsletter")) {
    return NextResponse.json({ status: "ignored_non_personal" });
  }

  // Self-chat detection ("Message yourself" on WhatsApp for testing)
  const isSelfChat = Boolean(
    receiverJid &&
    rawJid &&
    (rawJid === receiverJid || rawJid.split("@")[0] === receiverJid.split("@")[0])
  );

  // Guard 3: Ignore messages sent by owner to others (personal chat guard)
  // BUT allow if it's a self-test message sent to own number
  if (key.fromMe === true && !isSelfChat) {
    return NextResponse.json({ status: "ignored_from_me" });
  }

  // Extract clean phone number
  let phone = rawJid.replace(/@s\.whatsapp\.net$/, "").replace(/@lid$/, "").replace(/[^0-9]/g, "");
  if ((!phone || rawJid.includes("@lid")) && typeof data.from === "string") {
    const fromPhone = data.from.replace(/@s\.whatsapp\.net$/, "").replace(/[^0-9]/g, "");
    if (fromPhone) phone = fromPhone;
  }
  if (!phone) {
    return NextResponse.json({ status: "ignored_missing_phone" });
  }

  const contactName: string = data.pushName || data.verifiedName || body.pushName || "";

  // Extract text or action payload from WA-AKG data or raw Baileys message
  const incomingContent =
    (typeof data?.content === "string" && data.content.trim()) ||
    (typeof data?.text === "string" && data.text.trim()) ||
    (typeof data?.caption === "string" && data.caption.trim()) ||
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.buttonsResponseMessage?.selectedButtonId ||
    message?.buttonsResponseMessage?.selectedDisplayText ||
    message?.templateButtonReplyMessage?.selectedId ||
    message?.templateButtonReplyMessage?.selectedDisplayText ||
    message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    message?.listResponseMessage?.title ||
    message?.imageMessage?.caption ||
    null;

  if (!incomingContent || typeof incomingContent !== "string" || !incomingContent.trim()) {
    console.log(`[wa-akg-webhook] Ignored empty content from ${phone}:`, {
      type: data?.type,
      hasContent: Boolean(data?.content),
    });
    return NextResponse.json({ status: "ignored_empty_content" });
  }

  const cleanText = incomingContent.trim();
  console.log(`[wa-akg-webhook] Inbound message from ${phone} (${contactName || "Customer"}): "${cleanText}"`);

  // Process in background and return 200 OK immediately to gateway
  const runBackground = async () => {
    console.log(`[wa-akg-webhook] Background runner started for ${phone}...`);
    try {
      await processWaAkgMessage({
        phone,
        messageId,
        contactName,
        text: cleanText,
      });
    } catch (error) {
      console.error("[wa-akg-webhook] Background processing error:", error);
    }
  };

  void runBackground();

  return NextResponse.json({ status: "received", messageId });
}

async function processWaAkgMessage({
  phone,
  messageId,
  contactName,
  text,
}: {
  phone: string;
  messageId: string;
  contactName: string;
  text: string;
}) {
  console.log(`[wa-akg-webhook] processWaAkgMessage starting: phone=${phone}, text="${text}"`);
  const [branches, profile] = await Promise.all([getCachedBranches(), getCachedProfile()]);
  const contact = await contactRepo.upsertByPhone({ phone, name: contactName || null });
  const detectedLang = inferLanguagePreference(
    text,
    (contact.preferred_language as LanguagePreference) || "english",
  );

  // Resolve active branch
  let activeBranch: BranchRecord | null = contact.active_branch_id
    ? (branches.find((b) => b.id === contact.active_branch_id) ?? null)
    : null;

  if (!activeBranch && profile.branch_mode !== "multiple") {
    activeBranch =
      (profile.default_branch_id ? branches.find((b) => b.id === profile.default_branch_id) : null) ??
      branches[0] ??
      null;
    if (activeBranch) {
      await contactRepo.setActiveBranch(contact.id, activeBranch.id);
      contact.active_branch_id = activeBranch.id;
    }
  }

  if (!activeBranch) {
    if (branches.length > 0) {
      activeBranch = branches[0];
      await contactRepo.setActiveBranch(contact.id, activeBranch.id);
    } else {
      console.error("[wa-akg-webhook] No active branches found.");
      return;
    }
  }

  // Ensure conversation and state
  const conversation = await conversationRepo.ensure({
    contactId: contact.id,
    branchId: activeBranch.id,
    phone,
    name: contactName || null,
  });

  let state = await stateRepo.ensure(conversation.id);

  // Dedup: already processed this WhatsApp message
  if (state.last_user_whatsapp_msg_id === messageId) return;

  // Human mode check: if staff is actively chatting, let staff handle
  if (conversation.mode === "human") {
    if (text.toLowerCase().includes("resume bot") || text.toLowerCase().includes("back to bot")) {
      await conversationRepo.setMode(conversation.id, "agent");
      await sendWhatsAppMessage(phone, "Assistant resumed. How can I help you?");
    } else {
      await messageRepo.insert({
        conversationId: conversation.id,
        role: "user",
        senderKind: "user",
        content: text,
        whatsappMsgId: messageId,
      });
      await conversationRepo.setUnread(conversation.id, true);
    }
    return;
  }

  // Insert user message into conversation history
  const persistedMsg = await messageRepo.insert({
    conversationId: conversation.id,
    role: "user",
    senderKind: "user",
    content: text,
    whatsappMsgId: messageId,
  });

  // Acquire processing lock
  const lockToken = await acquireLock(conversation.id);
  if (!lockToken) {
    console.warn("[wa-akg-webhook] Could not acquire processing lock, skipping turn:", conversation.id);
    return;
  }

  try {
    state = await stateRepo.ensure(conversation.id);

    const result = await runTurn({
      conversationId: conversation.id,
      branchId: activeBranch.id,
      phone,
      messageText: text,
      sourceUserMessageId: messageId,
      whatsappMessageId: messageId,
      messageId: persistedMsg.id,
      appName: profile.app_name || "Restaurant",
      currency: profile.currency || "Rs.",
      customerName: contactName || contact.name || null,
      menuDisplayMode: profile.menu_display_mode,
      menuCardImages: profile.menu_card_images,
    });

    if (result.escalate) {
      await escalateToHuman({
        conversationId: conversation.id,
        branchId: activeBranch.id,
        phone,
        reason: result.intent,
        prefersRomanUrdu: detectedLang === "roman_urdu",
      });
      await conversationRepo.setMode(conversation.id, "human");
    }

    if (result.placeOrder) {
      void Promise.all([
        saveCustomerAddressFromOrder({
          conversationId: conversation.id,
          branchId: activeBranch.id,
          address: result.address ?? state.address,
        }),
        updateCustomerOrderStats({ conversationId: conversation.id, preferredLanguage: detectedLang }),
      ]).catch((e) => console.error("[wa-akg-webhook] Post-order hooks error:", e));
    }

    await sendAndPersistAssistantMessage({
      conversationId: conversation.id,
      phone,
      content: result.replyText,
      interactiveList: result.interactive?.kind === "list" ? result.interactive.payload : null,
      replyButtons: result.interactive?.kind === "buttons" ? result.interactive.payload : null,
      mediaUrls: result.mediaUrls ?? null,
    });

    console.log(`[wa-akg-webhook] Reply sent to ${phone}: "${result.replyText.slice(0, 100)}"`);
    void conversationRepo.touch(conversation.id).catch(() => {});
  } finally {
    await releaseLock(conversation.id, lockToken);
  }
}
