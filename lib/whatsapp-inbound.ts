import type { BranchRecord } from "./branches";
// Shared restaurant message handling for Meta Cloud API and Evolution API.
import OpenAI from "openai";
import { runTurn } from "@/lib/agent/pipeline";
import { stateRepo, getDefaultState } from "@/lib/data/state.repo";
import { contactRepo } from "@/lib/data/contact.repo";
import { conversationRepo } from "@/lib/data/conversation.repo";
import { messageRepo } from "@/lib/data/message.repo";
import { escalateToHuman, resumeBotForConversation } from "@/lib/handoff";
import { sendAndPersistAssistantMessage } from "@/lib/assistant-dispatcher";
import type { getRestaurantProfile } from "@/lib/restaurant-profile";
import { saveCustomerAddressFromOrder, updateCustomerOrderStats } from "@/lib/customer-crm";
import { supabaseAdmin } from "@/lib/supabase-admin";

import {
  downloadWhatsAppMedia,
  getWhatsAppMediaUrl,
  recordSentMessageId,
} from "@/lib/whatsapp";
import { inferLanguagePreference } from "@/lib/core/lang-detect";
import type { LanguagePreference } from "@/lib/schema.types";


import { getWhatsAppTransport } from "./whatsapp-context";
const ORDER_FRESH_START_AFTER_INACTIVITY_MS = 2 * 60 * 60 * 1000;
export type IncomingWhatsAppMessage = {
  id: string;
  from: string;
  to?: string;
  recipient_id?: string;
  type: string;
  timestamp: string;
  mediaBytes?: () => Promise<ArrayBuffer>;
  mediaMetadata?: Record<string, unknown>;
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string; voice?: boolean };
  interactive?: {
    type?: "button_reply" | "list_reply";
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
};


export async function processEchoMessage(
  message: IncomingWhatsAppMessage,
  customerPhone: string,
  branch: BranchRecord,
  restaurantId: string,
  businessPhone?: string,
) {
  recordSentMessageId(message.id);

  const contact = await upsertContact(customerPhone, "", restaurantId);

  // Auto-assign to the single branch if not already set
  if (contact.active_branch_id !== branch.id) {
    await contactRepo.setActiveBranch(contact.id, branch.id);
  }

  const conversation = await conversationRepo.ensure({
    contactId: contact.id,
    branchId: branch.id,
    phone: customerPhone,
    name: contact.name,
    whatsappPhone: businessPhone || undefined,
    transport: getWhatsAppTransport(),
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
    .update({ mode: "human", has_unread: false, updated_at: now })
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
// Per-message processing (single-branch model)
// ---------------------------------------------------------------------------
export async function processOneMessage(
  message: IncomingWhatsAppMessage,
  contactName: string,
  branch: BranchRecord,
  profile: Awaited<ReturnType<typeof getRestaurantProfile>>,
  phoneNumberId: string | undefined,
  restaurantId: string,
  businessPhone?: string,
) {
  const phone = message.from;
  const contact = await upsertContact(phone, contactName, restaurantId);
  const incomingContent = await extractContent(message);
  const detectedLang = inferLanguagePreference(
    incomingContent ?? "",
    (contact.preferred_language as LanguagePreference) || "english",
  );

  // Auto-assign contact to the single branch on first message (no selection prompt needed)
  if (contact.active_branch_id !== branch.id) {
    await contactRepo.setActiveBranch(contact.id, branch.id);
    contact.active_branch_id = branch.id;
  }

  const activeBranch = branch;

  // ---- Ensure conversation + state ----
  const conversation = await conversationRepo.ensure({
    contactId: contact.id,
    branchId: activeBranch.id,
    phone,
    name: contactName,
    whatsappPhone: businessPhone || undefined,
    transport: getWhatsAppTransport(),
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
    await handleNonText(message, conversation, state, detectedLang, profile, activeBranch, contactName || contact.name || null, phoneNumberId);
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
    throw new Error("Conversation is busy; retry this event");
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
  phoneNumberId?: string,
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
        const audioBuffer = message.mediaBytes
          ? await message.mediaBytes()
          : await downloadWhatsAppMedia(await getWhatsAppMediaUrl(audioId));

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
            ...message.mediaMetadata,
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
        void contactRepo.getByPhone(message.from, profile.id).then((c) => {
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
            phoneNumberId,
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
            ...message.mediaMetadata,
            isVoiceNote: true,
            audioUrl: audioId ? `/api/media/${audioId}` : null,
            mediaId: audioId,
          },
        });
        await sendAndPersistAssistantMessage({ conversationId: conversation.id, phone: message.from, content: fallbackMsg, phoneNumberId });
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
        ...message.mediaMetadata,
        isVoiceNote: true,
        audioUrl: audioId ? `/api/media/${audioId}` : null,
        mediaId: audioId,
      },
    });
    await sendAndPersistAssistantMessage({ conversationId: conversation.id, phone: message.from, content: voiceFallback, phoneNumberId });
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
  await sendAndPersistAssistantMessage({ conversationId: conversation.id, phone: conversation.phone, content: fallback, phoneNumberId });
}

// ---------------------------------------------------------------------------
// Delivery status updates
// ---------------------------------------------------------------------------
async function upsertContact(phone: string, name: string | null, restaurantId: string) {
  return contactRepo.upsertByPhone({ restaurantId, phone, name });
}

// ---------------------------------------------------------------------------
// Envelope parsing
// ---------------------------------------------------------------------------
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
// Staff alert for failed webhook
// ---------------------------------------------------------------------------
