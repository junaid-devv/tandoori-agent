import { NextRequest, NextResponse } from "next/server";
import { contactRepo } from "@/lib/data/contact.repo";
import { conversationRepo } from "@/lib/data/conversation.repo";
import { messageRepo } from "@/lib/data/message.repo";
import { stateRepo, getDefaultState } from "@/lib/data/state.repo";
import { getRestaurantProfile } from "@/lib/restaurant-profile";
import { runTurn } from "@/lib/agent/pipeline";
import { escalateToHuman, resumeBotForConversation } from "@/lib/handoff";
import { inferLanguagePreference } from "@/lib/core/lang-detect";
import type { LanguagePreference, ConversationStage } from "@/lib/schema.types";
import { sendAndPersistAssistantMessage } from "@/lib/assistant-dispatcher";
import { saveCustomerAddressFromOrder, updateCustomerOrderStats } from "@/lib/customer-crm";
import { isBotSentMessageId, recordSentMessageId, sendWhatsAppMessage } from "@/lib/whatsapp";
import { supabaseAdmin } from "@/lib/supabase-admin";
import type { BranchRecord } from "@/lib/branches";
import { getActiveBranches } from "@/lib/branches";

export const dynamic = "force-dynamic";

type IncomingWaAkgPayload = {
  event?: string;
  sessionId?: string;
  data?: any;
  key?: {
    id?: string;
    remoteJid?: string;
    fromMe?: boolean;
    participant?: string;
  };
  from?: string;
  receiver?: string;
  pushName?: string;
  content?: string;
  text?: string;
  message?: Record<string, any>;
};

// ---------------------------------------------------------------------------
// Short-TTL cache for single branch & profile
// ---------------------------------------------------------------------------
let _cachedBranches: { data: BranchRecord[]; at: number } | null = null;
let _cachedProfile: { data: Awaited<ReturnType<typeof getRestaurantProfile>>; at: number } | null = null;
const CACHE_TTL_MS = 10_000;

async function getCachedBranches(restaurantId?: string): Promise<BranchRecord[]> {
  if (_cachedBranches && Date.now() - _cachedBranches.at < CACHE_TTL_MS) {
    return _cachedBranches.data;
  }
  const data = await getActiveBranches(restaurantId);
  _cachedBranches = { data, at: Date.now() };
  return data;
}

async function getCachedProfile(restaurantId?: string): Promise<Awaited<ReturnType<typeof getRestaurantProfile>>> {
  if (_cachedProfile && Date.now() - _cachedProfile.at < CACHE_TTL_MS) {
    return _cachedProfile.data;
  }
  const data = await getRestaurantProfile(restaurantId);
  _cachedProfile = { data, at: Date.now() };
  return data;
}

// ---------------------------------------------------------------------------
// Processing Lock
// ---------------------------------------------------------------------------
async function acquireLock(conversationId: string): Promise<string | null> {
  const token = crypto.randomUUID();
  const staleThresholdMs = 90_000;
  const delays = [150, 250, 400, 600, 800, 1000, 1500, 2000];

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

    if (i < delays.length) {
      await new Promise((r) => setTimeout(r, delays[i]));
    }
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

// ---------------------------------------------------------------------------
// POST: Inbound Baileys / WA-AKG Webhook
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data = body.data || body;
  const key = data.key || body.key || {};
  const message = data.message || body.message;
  const messageId: string = key.id || data.id || body.id || `wa-akg-${Date.now()}`;

  // Guard 1: Ignore messages sent by our bot
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

  // Target restaurant resolution: support ?restaurant_id query param or fallback to active restaurant
  const targetRestaurantId = new URL(req.url).searchParams.get("restaurant_id") || undefined;
  const profile = await getCachedProfile(targetRestaurantId);
  const restaurantId = profile.id;
  const businessPhone = (receiverJid || profile.support_phone || "923155160301").replace(/[^0-9]/g, "");

  // Extract clean customer phone number
  let phone = rawJid.replace(/@s\.whatsapp\.net$/, "").replace(/@lid$/, "").replace(/[^0-9]/g, "");

  // Check remoteJidAlt for direct phone JID
  const altJid = String(key.remoteJidAlt || data.remoteJidAlt || body.remoteJidAlt || "").trim();
  if (altJid && altJid.includes("@s.whatsapp.net")) {
    const cleanAlt = altJid.replace(/@s\.whatsapp\.net$/, "").replace(/[^0-9]/g, "");
    if (cleanAlt) phone = cleanAlt;
  }

  // Check candidate JIDs (from, sender) for phone numbers
  if (phone.length > 13 || rawJid.includes("@lid")) {
    const candidateJids = [data.from, data.sender, key.remoteJidAlt, body.from, body.sender];
    for (const c of candidateJids) {
      if (typeof c === "string" && c.includes("@s.whatsapp.net")) {
        const p = c.replace(/@s\.whatsapp\.net$/, "").replace(/[^0-9]/g, "");
        if (p && p.length <= 13) {
          phone = p;
          break;
        }
      }
    }
  }

  // If still an LID (14+ digits or @lid in rawJid), resolve from WA-AKG Contact table
  if (phone.length > 13 || rawJid.includes("@lid")) {
    try {
      const lidTarget = rawJid.includes("@lid") ? rawJid : `${phone}@lid`;
      const { data: matchedContact } = await supabaseAdmin
        .schema("tandoori_wa_akg" as any)
        .from("Contact")
        .select("jid")
        .eq("lid", lidTarget)
        .like("jid", "%@s.whatsapp.net")
        .maybeSingle();

      if (matchedContact?.jid) {
        phone = matchedContact.jid.replace(/@s\.whatsapp\.net$/, "").replace(/[^0-9]/g, "");
      }
    } catch (err) {
      console.warn("[wa-akg-webhook] Could not resolve LID from Contact table:", err);
    }
  }

  if (!phone) {
    return NextResponse.json({ status: "ignored_missing_phone" });
  }

  // Self-chat detection ("Message yourself" on WhatsApp for testing)
  const isSelfChat = Boolean(
    (receiverJid && rawJid && (rawJid === receiverJid || rawJid.split("@")[0] === receiverJid.split("@")[0])) ||
    (businessPhone && phone === businessPhone)
  );

  // Extract incoming text
  const incomingContent =
    (typeof data?.content === "string" && data.content.trim()) ||
    (typeof data?.text === "string" && data.text.trim()) ||
    (typeof data?.caption === "string" && data.caption.trim()) ||
    (typeof body?.caption === "string" && body.caption.trim()) ||
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

  // Guard 3: Messages sent by owner from phone app to a customer (Coexistence / Manual Reply)
  if (key.fromMe === true && !isSelfChat) {
    if (incomingContent) {
      await handleOwnerManualReply(phone, incomingContent, messageId, restaurantId, businessPhone);
    }
    return NextResponse.json({ status: "owner_reply_recorded" });
  }

  if (!incomingContent || typeof incomingContent !== "string" || !incomingContent.trim()) {
    return NextResponse.json({ status: "ignored_empty_content" });
  }

  const cleanText = incomingContent.trim();
  const contactName: string = data.pushName || data.verifiedName || body.pushName || "";

  console.log(`[wa-akg-webhook] Inbound message from ${phone} (${contactName || "Customer"}): "${cleanText}"`);

  try {
    await processWaAkgMessage({
      phone,
      messageId,
      contactName,
      text: cleanText,
      restaurantId,
      businessPhone,
    });
  } catch (error) {
    console.error("[wa-akg-webhook] Processing error:", error);
  }

  return NextResponse.json({ status: "received", messageId });
}

// ---------------------------------------------------------------------------
// Coexistence: Record owner manual reply from WhatsApp app & pause bot
// ---------------------------------------------------------------------------
async function handleOwnerManualReply(customerPhone: string, content: string, messageId: string, restaurantId: string, businessPhone?: string) {
  recordSentMessageId(messageId);

  const branches = await getCachedBranches(restaurantId);
  const branch = branches[0];
  if (!branch) return;

  const contact = await contactRepo.upsertByPhone({ restaurantId, phone: customerPhone, name: null });
  const conversation = await conversationRepo.ensure({
    contactId: contact.id,
    branchId: branch.id,
    phone: customerPhone,
    name: contact.name,
    whatsappPhone: businessPhone || null,
  });

  const existing = await messageRepo.getByWhatsappId(messageId);
  if (existing) return;

  await messageRepo.insert({
    conversationId: conversation.id,
    role: "assistant",
    senderKind: "human",
    content,
    whatsappMsgId: messageId,
    deliveryStatus: "sent",
    metadata: {
      source: "wa_akg_coexistence",
      sender_device: "whatsapp_phone_app",
      timestamp: Date.now(),
    },
  });

  const now = new Date().toISOString();
  await supabaseAdmin
    .from("conversations")
    .update({ mode: "human", has_unread: false, updated_at: now })
    .eq("id", conversation.id);

  await stateRepo.patch(conversation.id, {
    stage: "human",
    is_bot_active: false,
    escalation_reason: "Manual reply from WhatsApp phone app",
    escalated_at: now,
    last_intent: "human_manual_reply",
  });

  console.log(`[wa-akg-webhook] Recorded owner reply to ${customerPhone}: "${content}". Bot paused.`);
}

// ---------------------------------------------------------------------------
// Process incoming customer message
// ---------------------------------------------------------------------------
async function processWaAkgMessage({
  phone,
  messageId,
  contactName,
  text,
  restaurantId,
  businessPhone,
}: {
  phone: string;
  messageId: string;
  contactName: string;
  text: string;
  restaurantId: string;
  businessPhone?: string;
}) {
  const [branches, profile] = await Promise.all([
    getCachedBranches(restaurantId),
    getCachedProfile(restaurantId),
  ]);

  if (branches.length === 0) {
    console.error("[wa-akg-webhook] No active branches found.");
    return;
  }

  const activeBranch = branches[0];
  const contact = await contactRepo.upsertByPhone({ restaurantId, phone, name: contactName || null });
  const detectedLang: LanguagePreference = inferLanguagePreference(
    text,
    contact.preferred_language || "english",
  );

  if (contact.active_branch_id !== activeBranch.id) {
    await contactRepo.setActiveBranch(contact.id, activeBranch.id);
    contact.active_branch_id = activeBranch.id;
  }

  const conversation = await conversationRepo.ensure({
    contactId: contact.id,
    branchId: activeBranch.id,
    phone,
    name: contactName || null,
    whatsappPhone: businessPhone || null,
  });

  let state = await stateRepo.ensure(conversation.id);

  if (state.last_user_whatsapp_msg_id === messageId) return;

  // Inactivity reset
  if (state.last_processed_user_message_at) {
    const last = new Date(state.last_processed_user_message_at).getTime();
    if (Number.isFinite(last) && Date.now() - last >= 2 * 60 * 60 * 1000) {
      const fresh = getDefaultState(conversation.id);
      state = await stateRepo.patch(conversation.id, {
        ...fresh,
        preferred_language: detectedLang,
      });
    }
  }

  // Human mode check: if human staff is chatting
  if (conversation.mode === "human") {
    if (text.toLowerCase().includes("resume bot") || text.toLowerCase().includes("back to bot")) {
      await resumeBotForConversation(conversation.id);
      await conversationRepo.setMode(conversation.id, "agent");
      await stateRepo.patch(conversation.id, {
        is_bot_active: true,
        stage: "greeting" as ConversationStage,
      });
      await sendWhatsAppMessage(phone, "Assistant resumed. How can I help you?");
    } else {
      await Promise.all([
        messageRepo.insert({
          conversationId: conversation.id,
          role: "user",
          senderKind: "user",
          content: text,
          whatsappMsgId: messageId,
        }),
        conversationRepo.setUnread(conversation.id, true),
      ]);
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

  // Processing lock
  const lockToken = await acquireLock(conversation.id);
  if (!lockToken) {
    console.warn("[wa-akg-webhook] Could not acquire lock, skipping turn:", conversation.id);
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
      ]).catch((e) => console.error("[wa-akg-webhook] Post-order error:", e));
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
