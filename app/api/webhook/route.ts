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
  sendWhatsAppInteractiveList,
  sendWhatsAppMessage,
} from "@/lib/whatsapp";
import { normalizeText } from "@/lib/order-text-utils";
import { inferLanguagePreference } from "@/lib/core/lang-detect";
import { downloadWhatsAppMedia, getWhatsAppMediaUrl } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 60;

const ORDER_FRESH_START_AFTER_INACTIVITY_MS = 2 * 60 * 60 * 1000; // 2 hours

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------
type IncomingWhatsAppMessage = {
  id: string;
  from: string;
  type: string;
  timestamp: string;
  text?: { body?: string };
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
    changes?: Array<{
      value?: {
        contacts?: Array<{ profile?: { name?: string } }>;
        messages?: IncomingWhatsAppMessage[];
        statuses?: IncomingWhatsAppStatus[];
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
    await markWebhookEventProcessed(eventId);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[webhook] Background processing failed:", msg, error);
    await markWebhookEventFailed(eventId, msg);
    await alertStaffForFailedWebhook(claimed.payload, eventId, msg).catch((e) => {
      console.error("[webhook] Staff alert failed:", e);
    });
  }
}

async function processWebhook(body: unknown) {
  // 1) Status events (delivery receipts)
  const statusEvents = extractStatusEvents(body);
  if (statusEvents.length > 0) {
    await updateDeliveryStatuses(statusEvents);
  }

  const events = extractMessages(body);
  if (events.length === 0) return;

  const [branches, profile] = await Promise.all([getActiveBranches(), getRestaurantProfile()]);
  const cityGroups = await buildCityBranchGroups(branches);

  for (const { message, contactName } of events) {
    try {
      await processOneMessage(message, contactName, branches, cityGroups, profile);
    } catch (error) {
      console.error("[webhook] Failed to process message:", { from: message.from, error });
    }
  }
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
) {
  const phone = message.from;
  const contact = await upsertContact(phone, contactName);
  const incomingContent = await extractContent(message);
  const prefersRomanUrdu = inferLanguagePreference(incomingContent ?? "", "english") === "roman_urdu";

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
      if (message.type !== "reaction") await sendCitySelection(phone, cityGroups, prefersRomanUrdu);
      return;
    }
    await handleBranchSelection(message, contact, incomingContent, branches, cityGroups, prefersRomanUrdu, profile);
    return;
  }

  // ---- Normal turn processing ----
  const conversation = await conversationRepo.ensure({
    contactId: contact.id,
    branchId: activeBranch.id,
    phone,
    name: contactName,
  });
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
      await handleBotResume(conversation, state, message, incomingContent, prefersRomanUrdu);
    } else if (incomingContent) {
      await messageRepo.insert({ conversationId: conversation.id, role: "user", senderKind: "user", content: incomingContent, whatsappMsgId: message.id });
      await conversationRepo.setUnread(conversation.id, true);
    }
    return;
  }

  // Non-text / voice
  if (!incomingContent) {
    await handleNonText(message, conversation, state, prefersRomanUrdu);
    return;
  }

  // Branch change request
  if (isBranchChangeRequest(incomingContent) && profile.branch_mode === "multiple") {
    await handleBranchChange(message, contact, conversation, state, incomingContent, cityGroups, branches, prefersRomanUrdu);
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

  // Processing lock (optimistic — if already held, skip this turn)
  const lockToken = await acquireLock(conversation.id);
  if (!lockToken) {
    console.warn("[webhook] Could not acquire processing lock, skipping turn:", conversation.id);
    return;
  }

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
      trivial: isTrivialMessage(incomingContent),
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
        saveCustomerAddressFromOrder({ conversationId: conversation.id, branchId: activeBranch.id, address: state.address }),
        updateCustomerOrderStats({ conversationId: conversation.id, preferredLanguage: nextLang }),
      ]).catch((e) => console.error("[webhook] Post-order hooks failed:", e));
    }

    await sendAndPersistAssistantMessage({
      conversationId: conversation.id,
      phone,
      content: result.replyText,
      interactiveList: result.interactive?.kind === "list" ? result.interactive.payload : null,
      replyButtons: result.interactive?.kind === "buttons" ? result.interactive.payload : null,
    });

    await conversationRepo.touch(conversation.id);
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
  prefersRomanUrdu: boolean,
  profile: Awaited<ReturnType<typeof getRestaurantProfile>>,
) {
  const phone = message.from;
  const cities = cityGroups.map((g) => g.city);
  const selectedCity = findCitySelection(content, cities);

  if (selectedCity) {
    const cityGroup = cityGroups.find((g) => normalizeCityValue(g.city) === normalizeCityValue(selectedCity)) ?? null;
    const cityBranches = cityGroup?.branches ?? [];
    if (cityBranches.length === 0) { await sendCitySelection(phone, cityGroups, prefersRomanUrdu); return; }
    if (cityBranches.length === 1) {
      await assignBranchAndGreet(message, contact, cityBranches[0], content, prefersRomanUrdu, profile);
      return;
    }
    await sendBranchSelection(phone, cityBranches, prefersRomanUrdu, selectedCity);
    return;
  }

  const selectedBranch = findBranchSelection(content, branches);
  if (!selectedBranch) { await sendCitySelection(phone, cityGroups, prefersRomanUrdu); return; }
  await assignBranchAndGreet(message, contact, selectedBranch, content, prefersRomanUrdu, profile);
}

async function assignBranchAndGreet(
  message: IncomingWhatsAppMessage,
  contact: Awaited<ReturnType<typeof upsertContact>>,
  branch: BranchSummary,
  content: string,
  prefersRomanUrdu: boolean,
  profile: Awaited<ReturnType<typeof getRestaurantProfile>>,
) {
  await contactRepo.setActiveBranch(contact.id, branch.id);
  const conversation = await conversationRepo.ensure({ contactId: contact.id, branchId: branch.id, phone: message.from });
  const state = await stateRepo.ensure(conversation.id);
  if (state.last_user_whatsapp_msg_id === message.id) return;

  const menuItems = await getMenuCatalog(branch.id);
  const categoryUI = buildInteractiveCategoryUI(menuItems, prefersRomanUrdu, 1);
  const greetReply = prefersRomanUrdu
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
    preferred_language: prefersRomanUrdu ? "roman_urdu" : "english",
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
  prefersRomanUrdu: boolean,
) {
  const cities = cityGroups.map((g) => g.city);
  const prompt = getCitySelectionPrompt(cities, prefersRomanUrdu);
  const interactiveList = buildInteractiveListForCities(cities, prefersRomanUrdu);
  await contactRepo.setActiveBranch(contact.id, null);
  await stateRepo.patch(conversation.id, { stage: "greeting", preferred_language: prefersRomanUrdu ? "roman_urdu" : "english", last_user_whatsapp_msg_id: message.id });
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
  prefersRomanUrdu: boolean,
) {
  await resumeBotForConversation(conversation.id);
  await conversationRepo.setMode(conversation.id, "agent");
  const resumeReply = prefersRomanUrdu ? "Theek hai. Apna order message bhej dein." : "Done. Send your order when ready.";
  await sendAndPersistAssistantMessage({ conversationId: conversation.id, phone: message.from, content: resumeReply });
  await stateRepo.patch(conversation.id, { is_bot_active: true, escalation_reason: null, escalated_at: null, last_user_whatsapp_msg_id: message.id });
}

// ---------------------------------------------------------------------------
// Non-text / voice
// ---------------------------------------------------------------------------
async function handleNonText(
  message: IncomingWhatsAppMessage,
  conversation: Awaited<ReturnType<typeof conversationRepo.ensure>>,
  state: Awaited<ReturnType<typeof stateRepo.ensure>>,
  prefersRomanUrdu: boolean,
) {
  if (message.type === "reaction") return;

  if (message.type === "audio") {
    const voiceFallback = prefersRomanUrdu
      ? "Voice note mil gaya, lekin abhi voice ordering available nahi. Item text mein bhej dein."
      : "Got your voice note, but voice ordering isn't available yet. Please type your item.";
    await messageRepo.insert({ conversationId: conversation.id, role: "user", senderKind: "user", content: "[Voice note received]", whatsappMsgId: message.id });
    await escalateToHuman({ conversationId: conversation.id, branchId: conversation.branch_id, phone: conversation.phone, reason: "voice_note", prefersRomanUrdu });
    await sendAndPersistAssistantMessage({ conversationId: conversation.id, phone: conversation.phone, content: voiceFallback });
    return;
  }

  const fallback = prefersRomanUrdu
    ? "Please text message bhej dein, main order mein help karta hoon."
    : "Please send a text message and I'll help with your order.";
  await sendAndPersistAssistantMessage({ conversationId: conversation.id, phone: conversation.phone, content: fallback });
}

// ---------------------------------------------------------------------------
// Delivery status updates
// ---------------------------------------------------------------------------
async function updateDeliveryStatuses(statuses: IncomingWhatsAppStatus[]) {
  for (const s of statuses) {
    if (!s.id || !s.status) continue;
    const nextStatus = normalizeDeliveryStatus(s.status);
    if (!nextStatus) continue;
    const errText = s.errors?.[0] ? `${s.errors[0].title ?? ""}: ${s.errors[0].error_data?.details ?? s.errors[0].message ?? ""}`.trim() : null;
    await messageRepo.applyDeliveryStatus(s.id, nextStatus, { error: errText, atIso: s.timestamp ? toIso(s.timestamp) : null }).catch((e) => {
      console.error("[webhook] Delivery status update failed:", e);
    });
  }
}

function normalizeDeliveryStatus(v: string): import("@/lib/schema.types").MessageDeliveryStatus | null {
  if (v === "pending" || v === "sent" || v === "delivered" || v === "read" || v === "failed") return v;
  return null;
}

// ---------------------------------------------------------------------------
// Contact / conversation upsert (thin wrappers)
// ---------------------------------------------------------------------------
async function upsertContact(phone: string, name: string | null) {
  return contactRepo.upsertByPhone({ phone, name });
}

// ---------------------------------------------------------------------------
// Envelope parsing
// ---------------------------------------------------------------------------
function extractMessages(body: unknown): Array<{ message: IncomingWhatsAppMessage; contactName: string }> {
  const envelope = body as IncomingEnvelope;
  const out: Array<{ message: IncomingWhatsAppMessage; contactName: string }> = [];
  for (const entry of envelope.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const contactName = value?.contacts?.[0]?.profile?.name ?? "";
      for (const msg of value?.messages ?? []) {
        out.push({ message: msg, contactName });
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

function isTrivialMessage(content: string): boolean {
  const n = content.trim().toLowerCase();
  return n.length < 10 && /^(ok|okay|yes|no|hi|hey|salam|haan|han|na|acha|k|thk)$/.test(n);
}

function toIso(timestamp: string): string {
  const n = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(n) || n <= 0) return new Date().toISOString();
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function isValidWhatsAppSignature(rawBody: string, sig: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
  if (!secret) { console.error("[webhook] Missing WHATSAPP_APP_SECRET"); return false; }
  if (!sig?.startsWith("sha256=")) { console.error("[webhook] Missing signature header"); return false; }
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const eb = Buffer.from(expected), rb = Buffer.from(sig.trim());
  return eb.length === rb.length && timingSafeEqual(eb, rb);
}

// ---------------------------------------------------------------------------
// Conversation processing lock (prevents double-processing concurrent messages)
// ---------------------------------------------------------------------------
async function acquireLock(conversationId: string): Promise<string | null> {
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const stale = new Date(Date.now() - 90_000).toISOString();
  for (let i = 0; i < 8; i++) {
    const { data } = await supabaseAdmin.from("conversation_states").update({ processing_token: token, processing_started_at: now }).eq("conversation_id", conversationId).is("processing_token", null).select("conversation_id").maybeSingle();
    if (data) return token;
    const { data: staleData } = await supabaseAdmin.from("conversation_states").update({ processing_token: token, processing_started_at: now }).eq("conversation_id", conversationId).lt("processing_started_at", stale).select("conversation_id").maybeSingle();
    if (staleData) return token;
    await new Promise((r) => setTimeout(r, 150 * (i + 1)));
  }
  return null;
}

async function releaseLock(conversationId: string, token: string) {
  await supabaseAdmin.from("conversation_states").update({ processing_token: null, processing_started_at: null }).eq("conversation_id", conversationId).eq("processing_token", token);
}

// ---------------------------------------------------------------------------
// Messaging helpers
// ---------------------------------------------------------------------------
async function sendCitySelection(phone: string, cityGroups: CityBranchGroup[], prefersRomanUrdu: boolean) {
  const cities = cityGroups.map((g) => g.city);
  const list = buildInteractiveListForCities(cities, prefersRomanUrdu);
  if (list) { try { await sendWhatsAppInteractiveList(phone, list); return; } catch { /* fall through */ } }
  await sendWhatsAppMessage(phone, getCitySelectionPrompt(cities, prefersRomanUrdu));
}

async function sendBranchSelection(phone: string, branches: BranchSummary[], prefersRomanUrdu: boolean, city?: string) {
  const list = buildInteractiveListForBranches(branches, prefersRomanUrdu, city);
  if (list) { try { await sendWhatsAppInteractiveList(phone, list); return; } catch { /* fall through */ } }
  await sendWhatsAppMessage(phone, getBranchSelectionPrompt(branches, prefersRomanUrdu));
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
