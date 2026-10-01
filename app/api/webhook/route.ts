/**
 * app/api/webhook/route.ts — rebuilt Phase 8
 *
 * Transport only: verify signature → record event → 200 immediately.
 * All heavy work runs inside after() via processWebhookEventInBackground.
 *
 * Key changes from the old god-route:
 *  - decideTurn() → runTurn() from lib/agent/pipeline
 *  - user_sessions table eliminated (merged into conversation_states)
 *  - order_agent_turns → agent_turns (written by pipeline automatically)
 *  - WhatsApp Flow code removed entirely
 *  - state fields: stage/last_shown_options (new schema)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextRequest } from "next/server";
import OpenAI from "openai";
import { runTurn } from "@/lib/agent/pipeline";
import { stateRepo, getDefaultState } from "@/lib/data/state.repo";
import { contactRepo } from "@/lib/data/contact.repo";
import { conversationRepo } from "@/lib/data/conversation.repo";
import { messageRepo } from "@/lib/data/message.repo";
import { getActiveBranches, getBranchById, isBranchChangeRequest, findBranchSelection, getBranchSelectionPrompt, type BranchSummary, type BranchRecord } from "@/lib/branches";
import { escalateToHuman, resumeBotForConversation } from "@/lib/handoff";
import { sendAndPersistAssistantMessage } from "@/lib/assistant-dispatcher";
import { getMenuCatalog } from "@/lib/menu";
import { getRestaurantSettings } from "@/lib/settings";
import { getRestaurantProfile } from "@/lib/restaurant-profile";
import { getRestaurantByPhoneNumberId, type RestaurantContext } from "@/lib/restaurant-resolver";
import { createStaffAlert } from "@/lib/staff-alerts";
import { saveCustomerAddressFromOrder, updateCustomerOrderStats } from "@/lib/customer-crm";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildRateLimitHeaders, checkRateLimit, getClientIp } from "@/lib/rate-limit";
import {
  buildInteractiveListForBranches,
  buildInteractiveListForPresentedOptions,
} from "@/lib/webhook-interactive-builders";
import {
  buildCityBranchGroups,
  buildInteractiveListForCities,
  buildInteractiveCategoryUI,
  findCitySelection,
  getCitySelectionPrompt,
  normalizeCityValue,
  type CityBranchGroup,
} from "@/lib/webhook-city-helpers";
import {
  claimWebhookEvent,
  markWebhookEventFailed,
  markWebhookEventProcessed,
  recordWebhookEvent,
} from "@/lib/webhook-events";
import {
  downloadWhatsAppMedia,
  getWhatsAppMediaUrl,
  isBotSentMessageId,
  recordSentMessageId,
  sendWhatsAppInteractiveList,
  sendWhatsAppMessage,
} from "@/lib/whatsapp";
import { normalizeText } from "@/lib/order-text-utils";
import { inferLanguagePreference } from "@/lib/core/lang-detect";
import type { LanguagePreference } from "@/lib/schema.types";
import { processUniversityWebhookMessage } from "@/lib/university/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

const ORDER_FRESH_START_AFTER_INACTIVITY_MS = 2 * 60 * 60 * 1000; // 2 hours

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------
type IncomingWhatsAppMessage = {
  id: string;
  from: string;
  to?: string;
  recipient_id?: string;
  type: string;
  timestamp: string;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string; voice?: boolean };
  interactive?: {
    type?: "button_reply" | "list_reply";
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
};

type IncomingWhatsAppStatus = {
  id?: string;
  recipient_id?: string;
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
    if (process.env.MOCK_WHATSAPP !== "true" && !isValidWhatsAppSignature(rawBody, signature)) {
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
    void markWebhookEventProcessed(eventId).catch((e) => console.error("[webhook] mark-processed failed:", e));
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[webhook] Background processing failed:", msg, error);
    // Fire-and-forget: don't let bookkeeping errors mask the original failure
    void markWebhookEventFailed(eventId, msg).catch((e) => console.error("[webhook] mark-failed failed:", e));
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
const _profileCacheMap = new Map<string, { data: Awaited<ReturnType<typeof getRestaurantProfile>>; at: number }>();
const BRANCH_CACHE_MS = 10_000; // 10 seconds

async function getCachedBranches(restaurantId: string): Promise<BranchRecord[]> {
  const cached = _branchesCacheMap.get(restaurantId);
  if (cached && Date.now() - cached.at < BRANCH_CACHE_MS) return cached.data;
  const data = await getActiveBranches(restaurantId);
  _branchesCacheMap.set(restaurantId, { data, at: Date.now() });
  return data;
}

async function getCachedProfile(restaurantId: string): Promise<Awaited<ReturnType<typeof getRestaurantProfile>>> {
  const cached = _profileCacheMap.get(restaurantId);
  if (cached && Date.now() - cached.at < BRANCH_CACHE_MS) return cached.data;
  const data = await getRestaurantProfile(restaurantId);
  _profileCacheMap.set(restaurantId, { data, at: Date.now() });
  return data;
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
      const [branches, profile] = await Promise.all([
        getCachedBranches(restaurantCtx.restaurantId),
        getCachedProfile(restaurantCtx.restaurantId),
      ]);
      await processEchoMessage(message, customerPhone, branches, profile, phoneNumberId, restaurantCtx.restaurantId);
    } catch (error) {
      console.error("[webhook-coexistence] Failed to process echo:", { customerPhone, error });
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
        console.warn("[webhook] Missing phone_number_id, skipping");
        continue;
      }
      const restaurantCtx = await getRestaurantByPhoneNumberId(phoneNumberId);
      if (!restaurantCtx) {
        console.warn("[webhook] Unknown phone_number_id, skipping:", phoneNumberId);
        continue;
      }
      const [branches, profile] = await Promise.all([
        getCachedBranches(restaurantCtx.restaurantId),
        getCachedProfile(restaurantCtx.restaurantId),
      ]);
      const cityGroups = await buildCityBranchGroups(branches);
      await processOneMessage(message, contactName, branches, cityGroups, profile, phoneNumberId, restaurantCtx.restaurantId);
    } catch (error) {
      console.error("[webhook] Failed to process message:", { from: message.from, error });
    }
  }
}

// ---------------------------------------------------------------------------
// Coexistence Echo Processing (Restaurant Owner replying from Phone App)
// ---------------------------------------------------------------------------
async function processEchoMessage(
  message: IncomingWhatsAppMessage,
  customerPhone: string,
  branches: BranchRecord[],
  profile: Awaited<ReturnType<typeof getRestaurantProfile>>,
  phoneNumberId: string,
  restaurantId: string,
) {
  recordSentMessageId(message.id);

  const contact = await upsertContact(customerPhone, "", restaurantId);
  let activeBranch: BranchRecord | null = contact.active_branch_id
    ? (branches.find((b) => b.id === contact.active_branch_id) ?? null)
    : null;

  if (!activeBranch && profile.branch_mode !== "multiple") {
    const def = pickDefaultBranch(branches, profile.default_branch_id ?? null);
    if (def) {
      await contactRepo.setActiveBranch(contact.id, def.id);
      contact.active_branch_id = def.id;
      activeBranch = def;
    }
  }

  if (!activeBranch && branches.length > 0) {
    activeBranch = branches[0];
  }

  if (!activeBranch) {
    console.warn("[webhook-coexistence] No branch available for customer echo:", customerPhone);
    return;
  }

  const conversation = await conversationRepo.ensure({
    contactId: contact.id,
    branchId: activeBranch.id,
    phone: customerPhone,
    name: contact.name,
  });

  const content =
    message.text?.body?.trim() ||
    (message.type === "image"
      ? `[Image: ${message.image?.caption || "Sent from phone"}]`
      : `[Sent from phone: ${message.type}]`);

  const existing = await messageRepo.getByWhatsappId(message.id);
  if (existing) return;

  await messageRepo.insert({
    conversationId: conversation.id,
    role: "assistant",
    senderKind: "human",
    content,
    whatsappMsgId: message.id,
    deliveryStatus: "sent",
    metadata: {
      source: "coexistence_echo",
      sender_device: "whatsapp_business_mobile_app",
      timestamp: message.timestamp,
    },
  });

  // Hand off to human: pause AI bot turns so owner has uninterrupted control
  const now = new Date().toISOString();
  await supabaseAdmin
    .from("conversations")
    .update({
      mode: "human",
      has_unread: false,
      updated_at: now,
    })
    .eq("id", conversation.id);

  await stateRepo.patch(conversation.id, {
    stage: "human",
    is_bot_active: false,
    escalation_reason: "Manual reply from WhatsApp Business mobile app (Coexistence)",
    escalated_at: now,
    last_intent: "human_manual_reply",
  });

  console.log(`[webhook-coexistence] Recorded owner reply to ${customerPhone}: "${content}". Bot paused.`);
}

// ---------------------------------------------------------------------------
// Per-message processing
// ---------------------------------------------------------------------------
async function processOneMessage(
  message: IncomingWhatsAppMessage,
  contactName: string,
  branches: BranchRecord[],
  cityGroups: CityBranchGroup[],
  profile: Awaited<ReturnType<typeof getRestaurantProfile>>,
  phoneNumberId: string,
  restaurantId: string,
) {
  const phone = message.from;
  const contact = await upsertContact(phone, contactName, restaurantId);
  const incomingContent = await extractContent(message);
  const detectedLang = inferLanguagePreference(
    incomingContent ?? "",
    (contact.preferred_language as LanguagePreference) || "english",
  );
  const prefersRomanUrdu = detectedLang === "roman_urdu";

  // ---- Branch resolution ----
  let activeBranch: BranchRecord | null = contact.active_branch_id
    ? (branches.find((b) => b.id === contact.active_branch_id) ?? null)
    : null;

  if (!activeBranch && profile.branch_mode !== "multiple") {
    const def = pickDefaultBranch(branches, profile.default_branch_id ?? null);
    if (def) {
      await contactRepo.setActiveBranch(contact.id, def.id);
      contact.active_branch_id = def.id;
      activeBranch = def;
    }
  }

  // ---- No branch yet: city/branch selection flow ----
  if (!activeBranch) {
    if (!incomingContent) {
      if (message.type !== "reaction") await sendCitySelection(phone, cityGroups, detectedLang);
      return;
    }
    await handleBranchSelection(message, contact, incomingContent, branches, cityGroups, detectedLang, profile);
    return;
  }

  // ---- Normal turn processing — ensure conversation first, then state (sequential by necessity) ----
  const conversation = await conversationRepo.ensure({
    contactId: contact.id,
    branchId: activeBranch.id,
    phone,
    name: contactName,
  });
  // State ensure is now a single-trip upsert, so this is fast
  let state = await stateRepo.ensure(conversation.id);

  // Dedup: already processed this WhatsApp message id
  if (state.last_user_whatsapp_msg_id === message.id) return;

  const createdAt = toIso(message.timestamp);

  // Inactivity reset: clear cart/draft after 2 h idle
  if (shouldResetForInactivity(state, createdAt)) {
    const nextLang = incomingContent ? inferLanguagePreference(incomingContent, state.preferred_language) : state.preferred_language;
    const fresh = getDefaultState(conversation.id);
    state = await stateRepo.patch(conversation.id, {
      ...fresh,
      preferred_language: nextLang,
      last_user_whatsapp_msg_id: state.last_user_whatsapp_msg_id,
      last_processed_user_message_id: state.last_processed_user_message_id,
      last_processed_message_seq: state.last_processed_message_seq,
      last_processed_user_message_at: state.last_processed_user_message_at,
    });
  }

  // Human mode: forward to staff, check for bot-resume command
  if (conversation.mode === "human") {
    if (incomingContent && shouldResumeBotFromMessage(incomingContent)) {
      await handleBotResume(conversation, state, message, incomingContent, detectedLang);
    } else if (incomingContent) {
      // Persist message and mark unread in parallel
      await Promise.all([
        messageRepo.insert({ conversationId: conversation.id, role: "user", senderKind: "user", content: incomingContent, whatsappMsgId: message.id }),
        conversationRepo.setUnread(conversation.id, true),
      ]);
    }
    return;
  }

  // Non-text / voice
  if (!incomingContent) {
    await handleNonText(message, conversation, state, detectedLang, profile, activeBranch, contactName || contact.name || null);
    return;
  }

  // Branch change request
  if (isBranchChangeRequest(incomingContent) && profile.branch_mode === "multiple") {
    await handleBranchChange(message, contact, conversation, state, incomingContent, cityGroups, branches, detectedLang);
    return;
  }

  // ---- Main agent turn ----
  const persistedMsg = await messageRepo.insert({
    conversationId: conversation.id,
    role: "user",
    senderKind: "user",
    content: resolveDisplayContent(message, incomingContent),
    whatsappMsgId: message.id,
  });

  // Update language on contact
  const nextLang = inferLanguagePreference(incomingContent, state.preferred_language);
  void contactRepo.setPreferredLanguage(contact.id, nextLang).catch(() => {});

  // Processing lock (wait for prior turn if active)
  const lockToken = await acquireLock(conversation.id);
  if (!lockToken) {
    console.warn("[webhook] Could not acquire processing lock, skipping turn:", conversation.id);
    return;
  }

  // Refresh conversation state now that we hold the lock, ensuring we have the latest
  // cart, stage, and order details from any turn that completed while we waited.
  state = await stateRepo.ensure(conversation.id);

  try {
    const result = await runTurn({
      conversationId: conversation.id,
      branchId: activeBranch.id,
      phone,
      messageText: incomingContent,
      sourceUserMessageId: message.id,
      whatsappMessageId: message.id,
      messageId: persistedMsg.id,
      appName: profile.app_name || "Restaurant",
      currency: profile.currency || "Rs.",
      customerName: contactName || contact.name || null,
      trivial: isTrivialMessage(incomingContent),
      menuDisplayMode: profile.menu_display_mode,
      menuCardImages: profile.menu_card_images,
    });

    if (result.escalate) {
      await escalateToHuman({
        conversationId: conversation.id,
        branchId: activeBranch.id,
        phone,
        reason: result.intent,
        prefersRomanUrdu: nextLang === "roman_urdu",
      });
      await conversationRepo.setMode(conversation.id, "human");
    }

    if (result.placeOrder) {
      void Promise.all([
        saveCustomerAddressFromOrder({ conversationId: conversation.id, branchId: activeBranch.id, address: result.address ?? state.address }),
        updateCustomerOrderStats({ conversationId: conversation.id, preferredLanguage: nextLang }),
      ]).catch((e) => console.error("[webhook] Post-order hooks failed:", e));
    }

    await sendAndPersistAssistantMessage({
      conversationId: conversation.id,
      phone,
      content: result.replyText,
      interactiveList: result.interactive?.kind === "list" ? result.interactive.payload : null,
      replyButtons: result.interactive?.kind === "buttons" ? result.interactive.payload : null,
      mediaUrls: result.mediaUrls ?? null,
      phoneNumberId,
    });

    // Fire-and-forget: touch is low priority, don't block reply delivery
    void conversationRepo.touch(conversation.id).catch((e) => console.error("[webhook] touch failed:", e));
  } finally {
    await releaseLock(conversation.id, lockToken);
  }
}

// ---------------------------------------------------------------------------
// Branch/city selection helpers
// ---------------------------------------------------------------------------
async function handleBranchSelection(
  message: IncomingWhatsAppMessage,
  contact: Awaited<ReturnType<typeof upsertContact>>,
  content: string,
  branches: BranchRecord[],
  cityGroups: CityBranchGroup[],
  langOrPrefersRomanUrdu: boolean | LanguagePreference,
  profile: Awaited<ReturnType<typeof getRestaurantProfile>>,
) {
  const phone = message.from;
  const cities = cityGroups.map((g) => g.city);
  const selectedCity = findCitySelection(content, cities);

  if (selectedCity) {
    const cityGroup = cityGroups.find((g) => normalizeCityValue(g.city) === normalizeCityValue(selectedCity)) ?? null;
    const cityBranches = cityGroup?.branches ?? [];
    if (cityBranches.length === 0) { await sendCitySelection(phone, cityGroups, langOrPrefersRomanUrdu); return; }
    if (cityBranches.length === 1) {
      await assignBranchAndGreet(message, contact, cityBranches[0], content, langOrPrefersRomanUrdu, profile);
      return;
    }
    await sendBranchSelection(phone, cityBranches, langOrPrefersRomanUrdu, selectedCity);
    return;
  }

  const selectedBranch = findBranchSelection(content, branches);
  if (!selectedBranch) { await sendCitySelection(phone, cityGroups, langOrPrefersRomanUrdu); return; }
  await assignBranchAndGreet(message, contact, selectedBranch, content, langOrPrefersRomanUrdu, profile);
}

async function assignBranchAndGreet(
  message: IncomingWhatsAppMessage,
  contact: Awaited<ReturnType<typeof upsertContact>>,
  branch: BranchSummary,
  content: string,
  langOrPrefersRomanUrdu: boolean | LanguagePreference,
  profile: Awaited<ReturnType<typeof getRestaurantProfile>>,
) {
  await contactRepo.setActiveBranch(contact.id, branch.id);
  const conversation = await conversationRepo.ensure({ contactId: contact.id, branchId: branch.id, phone: message.from });
  const state = await stateRepo.ensure(conversation.id);
  if (state.last_user_whatsapp_msg_id === message.id) return;

  const resolvedLang: LanguagePreference =
    typeof langOrPrefersRomanUrdu === "string"
      ? langOrPrefersRomanUrdu
      : langOrPrefersRomanUrdu
      ? "roman_urdu"
      : "english";

  const menuItems = await getMenuCatalog(branch.id);
  const categoryUI = buildInteractiveCategoryUI(menuItems, resolvedLang, 1);
  const greetReply =
    resolvedLang === "pashto"
      ? `Kha, *${branch.name}* select sho. Address: ${branch.address}\n\nOss category select kra ya da item num rawalega.`
      : resolvedLang === "roman_urdu"
      ? `Theek hai, *${branch.name}* select ho gayi. Address: ${branch.address}\n\nAb category select karein ya item name bhej dein.`
      : `Got it — you've selected *${branch.name}*. Address: ${branch.address}\n\nChoose a category or send any item name.`;

  await messageRepo.insert({ conversationId: conversation.id, role: "user", senderKind: "user", content, whatsappMsgId: message.id });
  await sendAndPersistAssistantMessage({
    conversationId: conversation.id,
    phone: message.from,
    content: greetReply,
    interactiveList: categoryUI.interactiveList,
    replyButtons: categoryUI.replyButtons,
  });
  await stateRepo.patch(conversation.id, {
    stage: "building_cart",
    preferred_language: resolvedLang,
    last_user_whatsapp_msg_id: message.id,
    last_processed_user_message_at: toIso(message.timestamp),
  });
}

async function handleBranchChange(
  message: IncomingWhatsAppMessage,
  contact: Awaited<ReturnType<typeof upsertContact>>,
  conversation: Awaited<ReturnType<typeof conversationRepo.ensure>>,
  state: Awaited<ReturnType<typeof stateRepo.ensure>>,
  content: string,
  cityGroups: CityBranchGroup[],
  branches: BranchRecord[],
  langOrPrefersRomanUrdu: boolean | LanguagePreference,
) {
  const resolvedLang: LanguagePreference =
    typeof langOrPrefersRomanUrdu === "string"
      ? langOrPrefersRomanUrdu
      : langOrPrefersRomanUrdu
      ? "roman_urdu"
      : "english";
  const cities = cityGroups.map((g) => g.city);
  const prompt = getCitySelectionPrompt(cities, resolvedLang);
  const interactiveList = buildInteractiveListForCities(cities, resolvedLang);
  await contactRepo.setActiveBranch(contact.id, null);
  await stateRepo.patch(conversation.id, { stage: "greeting", preferred_language: resolvedLang, last_user_whatsapp_msg_id: message.id });
  await sendAndPersistAssistantMessage({ conversationId: conversation.id, phone: message.from, content: prompt, interactiveList });
}

// ---------------------------------------------------------------------------
// Human mode / bot resume
// ---------------------------------------------------------------------------
function shouldResumeBotFromMessage(content: string): boolean {
  const n = content.toLowerCase().trim();
  return n.includes("resume bot") || n.includes("back to bot") || n.includes("bot can handle") || n.includes("let ai handle") || n.includes("transfer to ai");
}

async function handleBotResume(
  conversation: Awaited<ReturnType<typeof conversationRepo.ensure>>,
  state: Awaited<ReturnType<typeof stateRepo.ensure>>,
  message: IncomingWhatsAppMessage,
  content: string,
  langOrPrefersRomanUrdu: boolean | LanguagePreference,
) {
  await resumeBotForConversation(conversation.id);
  await conversationRepo.setMode(conversation.id, "agent");
  const resolvedLang: LanguagePreference =
    typeof langOrPrefersRomanUrdu === "string"
      ? langOrPrefersRomanUrdu
      : langOrPrefersRomanUrdu
      ? "roman_urdu"
      : "english";
  const resumeReply =
    resolvedLang === "pashto"
      ? "Kha. Khpal order message rawalegay."
      : resolvedLang === "roman_urdu"
      ? "Theek hai. Apna order message bhej dein."
      : "Done. Send your order when ready.";
  await sendAndPersistAssistantMessage({ conversationId: conversation.id, phone: message.from, content: resumeReply });
  await stateRepo.patch(conversation.id, { is_bot_active: true, escalation_reason: null, escalated_at: null, last_user_whatsapp_msg_id: message.id });
}

// ---------------------------------------------------------------------------
// Non-text / voice
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Language helper — uses stable conversation state, not single-message snap
// ---------------------------------------------------------------------------
function stateLang(state: { preferred_language: string }): import("@/lib/schema.types").LanguagePreference {
  if (state.preferred_language === "pashto") return "pashto";
  return state.preferred_language === "roman_urdu" ? "roman_urdu" : "english";
}

async function handleNonText(
  message: IncomingWhatsAppMessage,
  conversation: Awaited<ReturnType<typeof conversationRepo.ensure>>,
  state: Awaited<ReturnType<typeof stateRepo.ensure>>,
  langOrPrefersRomanUrdu: boolean | LanguagePreference,
  profile: Awaited<ReturnType<typeof getRestaurantProfile>>,
  activeBranch: { id: string; name?: string },
  customerName?: string | null,
) {
  if (message.type === "reaction") return;

  if (message.type === "audio" || (message as any).type === "voice" || (message as any).voice) {
    const lang = stateLang(state);
    const isRomanUrdu = lang === "roman_urdu";
    const audioObj = message.audio || (message as any).voice;
    const audioId = audioObj?.id;

    // Check Groq or OpenAI credentials for transcription
    const groqApiKey = process.env.GROQ_API_KEY || (process.env.DEEPSEEK_API_KEY?.startsWith("gsk_") ? process.env.DEEPSEEK_API_KEY : undefined);
    const apiKey = groqApiKey || process.env.OPENAI_API_KEY;
    const isGroq = Boolean(groqApiKey);

    // --- Real voice pipeline ---
    if (audioId && apiKey) {
      try {
        console.log(`[voice] Processing voice note from ${message.from}, audioId=${audioId}, provider=${isGroq ? "groq" : "openai"}`);
        const mediaUrl = await getWhatsAppMediaUrl(audioId);
        const audioBuffer = await downloadWhatsAppMedia(mediaUrl);

        // Transcribe via Groq (whisper-large-v3-turbo) or OpenAI Whisper
        const client = new OpenAI({
          apiKey,
          baseURL: isGroq ? "https://api.groq.com/openai/v1" : undefined,
        });

        const rawMime = audioObj?.mime_type || "audio/ogg";
        const cleanMime = rawMime.split(";")[0]?.trim() || "audio/ogg";
        const ext = cleanMime.includes("mp4") || cleanMime.includes("m4a") ? "m4a" : "ogg";

        const audioBlob = new Blob([audioBuffer], { type: cleanMime });
        const audioFile = new File([audioBlob], `voice.${ext}`, { type: cleanMime });

        const model = isGroq
          ? (process.env.GROQ_AUDIO_TRANSCRIPTION_MODEL || "whisper-large-v3-turbo")
          : "whisper-1";

        // Multi-lingual prompt guiding Whisper towards Roman Pashto, Roman Urdu, and English
        const prompt = "Customer ordering food at a Pakistani restaurant. Pashto, Roman Pashto, Urdu, Roman Urdu, English. Stare mashay, pa kher, menu wakhaya, delivery fee tsomra da, raka, dwa, dre, karahi, naan, deal, pizza, burger, address, shukriya.";

        const transcription = await client.audio.transcriptions.create({
          model,
          file: audioFile,
          ...(lang === "pashto" ? { language: "ps" } : {}),
          prompt,
        });

        const transcript = transcription.text?.trim();
        if (!transcript) throw new Error("Empty transcription");

        console.log(`[voice] Transcribed (${model}): "${transcript}"`);

        // Synchronously calculate public storage URL
        const storagePath = `${conversation.id}/${message.id}.${ext}`;
        const { data: publicUrlData } = supabaseAdmin.storage
          .from("voice-notes")
          .getPublicUrl(storagePath);
        const voiceAudioUrl = publicUrlData?.publicUrl || `/api/media/${audioId}`;

        // Non-blocking upload to Supabase storage — eliminates user reply latency!
        void supabaseAdmin.storage
          .from("voice-notes")
          .upload(storagePath, audioBuffer, {
            contentType: cleanMime,
            upsert: true,
          })
          .catch((uploadErr) => {
            console.warn("[voice] Background storage upload warning:", uploadErr);
          });

        // Store with transcript and audioUrl visible in conversation history
        const persistedMsg = await messageRepo.insert({
          conversationId: conversation.id,
          role: "user",
          senderKind: "user",
          content: `🎤 ${transcript}`,
          whatsappMsgId: message.id,
          metadata: {
            isVoiceNote: true,
            audioUrl: voiceAudioUrl,
            mediaId: audioId,
            mimeType: cleanMime,
            transcript,
          },
        });

        // Update language from transcript
        const transcriptLang = inferLanguagePreference(transcript, state.preferred_language);
        if (transcriptLang !== state.preferred_language) {
          await stateRepo.patch(conversation.id, { preferred_language: transcriptLang });
        }
        void contactRepo.getByPhone(message.from).then((c) => {
          if (c) void contactRepo.setPreferredLanguage(c.id, transcriptLang).catch(() => {});
        }).catch(() => {});

        // Feed transcript into same pipeline as text
        const lockToken = await acquireLock(conversation.id);
        if (!lockToken) {
          console.warn("[voice] Could not acquire lock:", conversation.id);
          return;
        }
        try {
          const result = await runTurn({
            conversationId: conversation.id,
            branchId: activeBranch.id,
            phone: message.from,
            messageText: transcript,
            sourceUserMessageId: message.id,
            whatsappMessageId: message.id,
            messageId: persistedMsg.id,
            appName: profile.app_name || "Restaurant",
            currency: profile.currency || "Rs.",
            customerName: customerName || null,
            menuDisplayMode: profile.menu_display_mode,
            menuCardImages: profile.menu_card_images,
          });
          if (result.escalate) {
            await escalateToHuman({ conversationId: conversation.id, branchId: activeBranch.id, phone: message.from, reason: result.intent, language: transcriptLang });
            await conversationRepo.setMode(conversation.id, "human");
          }
          if (result.placeOrder) {
            void Promise.all([
              saveCustomerAddressFromOrder({ conversationId: conversation.id, branchId: activeBranch.id, address: result.address ?? state.address }),
              updateCustomerOrderStats({ conversationId: conversation.id, preferredLanguage: transcriptLang }),
            ]).catch((e) => console.error("[voice] Post-order hooks failed:", e));
          }
          await sendAndPersistAssistantMessage({
            conversationId: conversation.id,
            phone: message.from,
            content: result.replyText,
            interactiveList: result.interactive?.kind === "list" ? result.interactive.payload : null,
            replyButtons: result.interactive?.kind === "buttons" ? result.interactive.payload : null,
          });
          void conversationRepo.touch(conversation.id).catch((e) => console.error("[voice] touch failed:", e));
        } finally {
          await releaseLock(conversation.id, lockToken);
        }
        return;
      } catch (err) {
        console.error("[voice] Voice pipeline failed:", err);
        // Graceful degradation — language-consistent, no escalation
        const fallbackMsg =
          lang === "pashto"
            ? "Voice note raghay, kho pohaidal ke mushkil sho. Khpal order text ke rawalegay!"
            : isRomanUrdu
            ? "Voice note mil gaya, lekin samajhne mein mushkil hua. Apna order text mein bhej dein!"
            : "Got your voice note, but had trouble understanding it. Please type your order!";
        await messageRepo.insert({
          conversationId: conversation.id,
          role: "user",
          senderKind: "user",
          content: "[Voice note - transcription failed]",
          whatsappMsgId: message.id,
          metadata: {
            isVoiceNote: true,
            audioUrl: audioId ? `/api/media/${audioId}` : null,
            mediaId: audioId,
          },
        });
        await sendAndPersistAssistantMessage({ conversationId: conversation.id, phone: message.from, content: fallbackMsg });
        return;
      }
    }

    // No API key — graceful degradation / voice_note fallback, language-consistent
    const voiceFallback =
      lang === "pashto"
        ? "Voice note raghay! Khpal order text ke rawalegay, za ba darsara madad kawa."
        : isRomanUrdu
        ? "Voice note mil gaya! Apna order text mein bhej dein, main turant help karunga."
        : "Got your voice note! Please type your order and I'll help right away.";
    await messageRepo.insert({
      conversationId: conversation.id,
      role: "user",
      senderKind: "user",
      content: "[Voice note received]",
      whatsappMsgId: message.id,
      metadata: {
        isVoiceNote: true,
        audioUrl: audioId ? `/api/media/${audioId}` : null,
        mediaId: audioId,
      },
    });
    await sendAndPersistAssistantMessage({ conversationId: conversation.id, phone: message.from, content: voiceFallback });
    return;
  }

  // Other unsupported media types
  const lang = stateLang(state);
  const fallback =
    lang === "pashto"
      ? "Meherbani warka text message rawalegay, za ba order ke madad kawa."
      : lang === "roman_urdu"
      ? "Please text message bhej dein, main order mein help karta hoon."
      : "Please send a text message and I'll help with your order.";
  await sendAndPersistAssistantMessage({ conversationId: conversation.id, phone: conversation.phone, content: fallback });
}

// ---------------------------------------------------------------------------
// Delivery status updates
// ---------------------------------------------------------------------------
async function updateDeliveryStatuses(statuses: IncomingWhatsAppStatus[]) {
  // Fan out all delivery-status updates in parallel — no ordering requirement
  await Promise.allSettled(
    statuses
      .filter((s) => s.id && s.status)
      .map((s) => {
        const nextStatus = normalizeDeliveryStatus(s.status!);
        if (!nextStatus) return Promise.resolve();
        const errText = s.errors?.[0]
          ? `${s.errors[0].title ?? ""}: ${s.errors[0].error_data?.details ?? s.errors[0].message ?? ""}`.trim()
          : null;
        return messageRepo
          .applyDeliveryStatus(s.id!, nextStatus, { error: errText, atIso: s.timestamp ? toIso(s.timestamp) : null })
          .catch((e) => console.error("[webhook] Delivery status update failed:", e));
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
async function upsertContact(phone: string, name: string | null, restaurantId: string) {
  return contactRepo.upsertByPhone({ restaurantId, phone, name });
}

// ---------------------------------------------------------------------------
// Envelope parsing
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
        out.push(s);
      }
    }
  }
  return out;
}

async function extractContent(message: IncomingWhatsAppMessage): Promise<string | null> {
  if (message.type === "text") return message.text?.body?.trim() || null;
  if (message.type === "interactive") {
    const ir = message.interactive;
    if (ir?.type === "button_reply") return ir.button_reply?.id || ir.button_reply?.title || null;
    if (ir?.type === "list_reply") return ir.list_reply?.id || ir.list_reply?.title || null;
  }
  if (message.type === "audio") return null;
  return null;
}

function resolveDisplayContent(message: IncomingWhatsAppMessage, content: string): string {
  if (message.type === "interactive") {
    const ir = message.interactive;
    if (ir?.type === "button_reply") return ir.button_reply?.title || content;
    if (ir?.type === "list_reply") return ir.list_reply?.title || content;
  }
  return content;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function pickDefaultBranch(branches: BranchRecord[], defaultId: string | null): BranchRecord | null {
  if (defaultId) { const f = branches.find((b) => b.id === defaultId); if (f) return f; }
  return branches[0] ?? null;
}

function shouldResetForInactivity(state: Awaited<ReturnType<typeof stateRepo.ensure>>, incomingAt: string): boolean {
  if (!state.last_processed_user_message_at) return false;
  const last = new Date(state.last_processed_user_message_at).getTime();
  const now = new Date(incomingAt).getTime();
  return Number.isFinite(last) && Number.isFinite(now) && now - last >= ORDER_FRESH_START_AFTER_INACTIVITY_MS;
}

// Trivial = greeting/ack that needs no menu. Skips menu load in loadTurnContext.
const TRIVIAL_RE = /^(ok|okay|yes|no|hi|hey|salam|aoa|a\.o\.a|assalam|hola|hello|haan|han|na|nahin|nahi|acha|k|thk|ji|nope|yep|yup|sure|done|thanks|shukriya|shukria|ty)$/i;
function isTrivialMessage(content: string): boolean {
  const n = content.trim();
  return n.length <= 15 && TRIVIAL_RE.test(n);
}

function toIso(timestamp: string): string {
  const n = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
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
  const secrets = secretEnv.split(",").map((s) => s.trim()).filter(Boolean);
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
async function acquireLock(conversationId: string): Promise<string | null> {
  const token = crypto.randomUUID();
  const staleThresholdMs = 90_000;
  // Delays: wait up to ~12s with progressive backoff so rapid sequential messages from the same user
  // wait for the active turn to finish and release the lock, rather than dropping the message.
  const delays = [150, 250, 400, 600, 800, 1000, 1500, 2000, 2500, 3000];
  for (let i = 0; i <= delays.length; i++) {
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - staleThresholdMs).toISOString();
    // Try: lock is null (free)
    const { data } = await supabaseAdmin
      .from("conversation_states")
      .update({ processing_token: token, processing_started_at: now })
      .eq("conversation_id", conversationId)
      .is("processing_token", null)
      .select("conversation_id")
      .maybeSingle();
    if (data) return token;
    // Try: lock is stale (previous holder crashed)
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
  await supabaseAdmin.from("conversation_states").update({ processing_token: null, processing_started_at: null }).eq("conversation_id", conversationId).eq("processing_token", token);
}

// ---------------------------------------------------------------------------
// Messaging helpers
// ---------------------------------------------------------------------------
async function sendCitySelection(phone: string, cityGroups: CityBranchGroup[], langOrPrefersRomanUrdu: boolean | LanguagePreference) {
  const cities = cityGroups.map((g) => g.city);
  const list = buildInteractiveListForCities(cities, langOrPrefersRomanUrdu);
  if (list) { try { await sendWhatsAppInteractiveList(phone, list); return; } catch { /* fall through */ } }
  await sendWhatsAppMessage(phone, getCitySelectionPrompt(cities, langOrPrefersRomanUrdu));
}

async function sendBranchSelection(phone: string, branches: BranchSummary[], langOrPrefersRomanUrdu: boolean | LanguagePreference, city?: string) {
  const list = buildInteractiveListForBranches(branches, langOrPrefersRomanUrdu, city);
  if (list) { try { await sendWhatsAppInteractiveList(phone, list); return; } catch { /* fall through */ } }
  await sendWhatsAppMessage(phone, getBranchSelectionPrompt(branches, langOrPrefersRomanUrdu));
}

// ---------------------------------------------------------------------------
// Staff alert for failed webhook
// ---------------------------------------------------------------------------
async function alertStaffForFailedWebhook(payload: unknown, eventId: string, error: string) {
  try {
    const envelope = payload as IncomingEnvelope;
    const phone = envelope.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;
    if (!phone) return;
    const contact = await contactRepo.getByPhone(phone);
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
