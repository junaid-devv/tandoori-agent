import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextRequest } from "next/server";
import { getCustomerSupportReply, type OrderTurnIntent } from "@/lib/ai";
import {
  findBranchSelection,
  getActiveBranches,
  getBranchById,
  getBranchSelectionPrompt,
  isBranchChangeRequest,
  type BranchSummary,
} from "@/lib/branches";
import { escalateToHuman, resumeBotForConversation } from "@/lib/handoff";
import { sendAndPersistAssistantMessage } from "@/lib/assistant-dispatcher";
import { deleteUnsentOutboundMessage, OutboundMessageError, type MessageDeliveryStatus } from "@/lib/messages";
import {
  decideTurn,
  getDefaultConversationState,
  inferLanguagePreference,
  parseConversationState,
  detectMessageType,
  type MenuCatalogItem,
  type TurnDecision,
  type ConversationState,
  type PlaceableOrderPayload,
} from "@/lib/order-engine";
import { getMenuCatalog, getMenuForAI } from "@/lib/menu";
import { getSemanticMenuMatches } from "@/lib/semantic-menu";
import { getRestaurantSettings, isWithinOperatingHours } from "@/lib/settings";
import { createStaffAlert } from "@/lib/staff-alerts";
import {
  getLatestSavedAddress,
  saveCustomerAddressFromOrder,
  updateCustomerOrderStats,
} from "@/lib/customer-crm";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { buildRateLimitHeaders, checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { buildSessionUpdate, getDefaultUserSession, getOrCreateUserSession, updateUserSession } from "@/lib/user-session";
import {
  buildBranchSelectionFlowMessage,
  buildFlowMessageForAgentReply,
  buildInteractiveListForBranches,
  buildInteractiveListForPresentedOptions,
} from "@/lib/webhook-interactive-builders";
import {
  buildCityBranchGroups,
  buildInteractiveCategoryList,
  buildInteractiveListForCities,
  findCitySelection,
  getCitySelectionPrompt,
  normalizeCityValue,
  type CityBranchGroup,
} from "@/lib/webhook-city-helpers";
import {
  extractFlowResponseCommand,
} from "@/lib/whatsapp-flow";
import {
  claimWebhookEvent,
  markWebhookEventFailed,
  markWebhookEventProcessed,
  recordWebhookEvent,
} from "@/lib/webhook-events";
import {
  downloadWhatsAppMedia,
  getWhatsAppMediaUrl,
  sendWhatsAppInteractiveFlow,
  sendWhatsAppInteractiveList,
  sendWhatsAppMessage,
} from "@/lib/whatsapp";

function shouldResumeBotFromHumanMessage(content: string): boolean {
  const normalized = content.toLowerCase().trim();
  return (
    normalized.includes("resume bot") ||
    normalized.includes("back to bot") ||
    normalized.includes("switch to bot") ||
    normalized.includes("bot resume") ||
    normalized.includes("ai handle") ||
    normalized.includes("let ai handle") ||
    normalized.includes("transfer to ai") ||
    normalized.includes("bot can handle")
  );
}

const SAVED_BRANCH_CHOICE_MARKER = "__saved_branch_choice__";

function isContinueWithSavedBranchRequest(content: string): boolean {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    normalized === "branch_continue_saved" ||
    normalized === "branch continue saved" ||
    /\bcontinue\b/.test(normalized) ||
    /\b(same|current|previous)\s+branch\b/.test(normalized) ||
    /\b(use|keep)\s+(same|current|previous)\s+branch\b/.test(normalized)
  );
}

function isSelectNewBranchRequest(content: string): boolean {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    normalized === "branch_change_saved" ||
    normalized === "branch change saved" ||
    /\b(change|switch|new)\s+branch\b/.test(normalized) ||
    /\bselect\s+new\s+branch\b/.test(normalized) ||
    isBranchChangeRequest(content)
  );
}

function isBranchAddressLookupRequest(content: string): boolean {
  const normalized = content.trim().toLowerCase().replace(/\s+/g, " ");
  return /\b(address|location|where|kahan|kidhar|branch address|map)\b/.test(normalized);
}

function shouldRunSemanticLookup(content: string): boolean {
  const normalized = content.toLowerCase().trim();
  if (normalized.length < 4) return false;
  if (/^(ok|okay|yes|no|han|haan|nahi|menu|\d{1,2})$/.test(normalized)) return false;
  return /\p{L}/u.test(normalized);
}
type IncomingWhatsAppMessage = {
  id: string;
  from: string;
  type: string;
  timestamp: string;
  text?: { body?: string };
  audio?: {
    id?: string;
    mime_type?: string;
    voice?: boolean;
  };
  interactive?: {
    type?: "button_reply" | "list_reply" | "nfm_reply";
    button_reply?: {
      id?: string;
      title?: string;
    };
    list_reply?: {
      id?: string;
      title?: string;
      description?: string;
    };
    nfm_reply?: {
      name?: string;
      body?: string;
      response_json?: string;
    };
  };
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

type IncomingWhatsAppStatus = {
  id?: string;
  recipient_id?: string;
  status?: string;
  timestamp?: string;
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
    error_data?: { details?: string };
  }>;
};

type IncomingMessageEvent = {
  message: IncomingWhatsAppMessage;
  contactName: string;
};

type ConversationRow = {
  id: string;
  branch_id: string;
  contact_id: string;
  phone: string;
  name: string | null;
  mode: "agent" | "human";
};

type ContactRow = {
  id: string;
  phone: string;
  name: string | null;
  active_branch_id: string | null;
};

type MessageRow = {
  id: string;
  ingest_seq: number;
  content: string;
  created_at: string;
  whatsapp_msg_id: string | null;
};

type PersistedUserMessage = {
  message: MessageRow | null;
};

export const runtime = "nodejs";
export const maxDuration = 60;
const ORDER_FRESH_START_AFTER_INACTIVITY_MS = 2 * 60 * 60 * 1000;

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

export async function POST(req: NextRequest) {
  console.log("[webhook] POST request received. Version: Legacy-V1-Reset");
  let rawBody = "";
  let body: unknown;
  const signature = req.headers.get("x-hub-signature-256");
  const rateLimit = await checkRateLimit({
    scope: "whatsapp_webhook",
    identifier: getClientIp(req),
    limit: Number(process.env.WHATSAPP_WEBHOOK_RATE_LIMIT_EVENTS) || 600,
    windowSeconds: Number(process.env.WHATSAPP_WEBHOOK_RATE_LIMIT_WINDOW_SECONDS) || 60,
    blockSeconds: Number(process.env.WHATSAPP_WEBHOOK_RATE_LIMIT_BLOCK_SECONDS) || 60,
  });
  if (!rateLimit.allowed) {
    return new Response("Too Many Requests", {
      status: 429,
      headers: buildRateLimitHeaders(rateLimit),
    });
  }

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
    const event = await recordWebhookEvent({
      rawBody,
      payload: body,
      signature,
    });

    after(async () => {
      await processWebhookEventInBackground(event.id);
    });

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[webhook] Failed to persist webhook event:", error);
    return new Response("Server Error", { status: 500 });
  }
}

async function processWebhookEventInBackground(eventId: string) {
  const claimed = await claimWebhookEvent(eventId);
  if (!claimed) return;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await processWebhook(claimed.payload);
      await markWebhookEventProcessed(eventId);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown webhook processing error");
      console.error(`[webhook] Background processing attempt ${attempt + 1} failed:`, lastError);
      if (attempt < 2) {
        await sleep((attempt + 1) * 500);
      }
    }
  }

  const errorMessage = lastError?.message ?? "Unknown webhook processing error";
  await markWebhookEventFailed(eventId, errorMessage);
  await alertStaffForFailedWebhook(claimed.payload, eventId, errorMessage).catch((alertError) => {
    console.error("[webhook] Failed to create webhook processing alert:", alertError);
  });
}

async function processWebhook(body: unknown) {
  const statusEvents = extractIncomingStatusEvents(body);
  if (statusEvents.length > 0) {
    await updateOutboundMessageStatuses(statusEvents);
  }

  const events = extractIncomingMessages(body);
  if (events.length === 0) return;

  const branches = await getActiveBranches();
  const cityGroups = await buildCityBranchGroups(branches);
  const agentConversations = new Map<string, ConversationRow>();

  for (const event of events) {
    const { message, contactName } = event;
    const contact = await upsertContact(message.from, contactName);
    const incomingContent = await extractIncomingContent(message);
    const prefersRomanUrdu = inferLanguagePreference(incomingContent ?? "", "english") !== "english";
    const activeBranch = contact.active_branch_id
      ? branches.find((branch) => branch.id === contact.active_branch_id) ?? null
      : null;

    if (!contact.active_branch_id || !activeBranch) {
      if (contact.active_branch_id && !activeBranch) {
        await setActiveBranch(contact.id, null);
      }

      if (!incomingContent) {
        if (message.type !== "reaction") {
          await sendCitySelectionMessage(message.from, cityGroups, prefersRomanUrdu);
        }
        continue;
      }

      // City selection must win over branch fuzzy-matching (branch addresses often include city names).
      // Otherwise typing "Lahore" could accidentally match a branch and skip the branch list.
      const selectedCity = findCitySelection(
        incomingContent,
        cityGroups.map((group) => group.city),
      );

      if (selectedCity) {
        const cityGroup =
          cityGroups.find((group) => normalizeCityValue(group.city) === normalizeCityValue(selectedCity)) ?? null;
        const cityBranches = cityGroup?.branches ?? [];
        if (cityBranches.length === 0) {
          await sendCitySelectionMessage(message.from, cityGroups, prefersRomanUrdu);
          continue;
        }

        if (cityBranches.length === 1) {
          // Auto-pick single-branch cities.
          const selectedBranch = cityBranches[0];
          await setActiveBranch(contact.id, selectedBranch.id);
          contact.active_branch_id = selectedBranch.id;

          const selectedConversation = await upsertConversation(contact, selectedBranch.id, contactName);
          const selectedState = await getOrCreateConversationState(selectedConversation.id);
          const createdAt = toIsoTimestamp(message.timestamp);
          if (selectedState.last_processed_user_message_id === message.id) {
            continue;
          }

          const persistedMessage = await persistUserMessage(
            selectedConversation.id,
            incomingContent,
            message.id,
            createdAt,
          );

          const assistantReply = prefersRomanUrdu
            ? `Theek hai, *${selectedBranch.name}* select ho gayi. Address: ${selectedBranch.address}\n\nAb category select karein ya item name bhej dein.`
            : `Great, you've selected *${selectedBranch.name}*. Address: ${selectedBranch.address}\n\nNow choose a category or send any item name.`;
          const selectedMenuItems = await getMenuCatalog(selectedBranch.id);
          const categoryInteractiveList = buildInteractiveCategoryList(selectedMenuItems, prefersRomanUrdu, 1);

          await sendAndPersistAssistantMessage({
            conversationId: selectedConversation.id,
            phone: message.from,
            content: assistantReply,
            interactiveList: categoryInteractiveList,
            flowMessage: null,
          });

          await markMessageProcessed(
            selectedState,
            message.id,
            createdAt,
            persistedMessage.message?.ingest_seq ?? null,
            {
              workflow_step: "collecting_items",
              last_presented_category: "__category_list__",
              last_presented_options: null,
              last_presented_options_at: null,
              preferred_language: prefersRomanUrdu ? "roman_urdu" : "english",
            },
          );

          const selectedSession = await getOrCreateUserSession(selectedConversation.id, {
            active_node: "cart_builder",
            status: "active",
            is_bot_active: true,
          });

          await updateUserSession(
            selectedConversation.id,
            buildSessionUpdate({
              session: selectedSession,
              stateBefore: selectedState,
              stateAfter: parseConversationState({
                ...selectedState,
                conversation_id: selectedConversation.id,
                workflow_step: "collecting_items",
                last_presented_category: "__category_list__",
                last_presented_options: null,
                last_presented_options_at: null,
                preferred_language: prefersRomanUrdu ? "roman_urdu" : "english",
              }),
              mode: "agent",
              intent: null,
              lastUserMessage: incomingContent,
              lastAssistantReply: assistantReply,
            }),
          );

          continue;
        }

        await sendBranchSelectionMessage(message.from, cityBranches, prefersRomanUrdu, selectedCity);
        continue;
      }

      // If user didn't select a city, allow direct branch selection by typing branch name/number.
      const selectedBranch = findBranchSelection(incomingContent, branches);
      if (!selectedBranch) {
        await sendCitySelectionMessage(message.from, cityGroups, prefersRomanUrdu);
        continue;
      }

      // Continue with global branch selection (existing logic below uses selectedBranch).

      await setActiveBranch(contact.id, selectedBranch.id);
      // Update local contact object so subsequent logic uses the correct branch
      contact.active_branch_id = selectedBranch.id;

      const selectedConversation = await upsertConversation(contact, selectedBranch.id, contactName);
      const selectedState = await getOrCreateConversationState(selectedConversation.id);
      
      const createdAt = toIsoTimestamp(message.timestamp);
      if (selectedState.last_processed_user_message_id === message.id) {
        continue;
      }

      const persistedMessage = await persistUserMessage(
        selectedConversation.id,
        incomingContent,
        message.id,
        createdAt,
      );

      const assistantReply = prefersRomanUrdu
        ? `Theek hai, *${selectedBranch.name}* select ho gayi. Address: ${selectedBranch.address}\n\nAb category select karein ya item name bhej dein.`
        : `Great, you've selected *${selectedBranch.name}*. Address: ${selectedBranch.address}\n\nNow choose a category or send any item name.`;
      const selectedMenuItems = await getMenuCatalog(selectedBranch.id);
      const categoryInteractiveList = buildInteractiveCategoryList(selectedMenuItems, prefersRomanUrdu, 1);

      await sendAndPersistAssistantMessage({
        conversationId: selectedConversation.id,
        phone: message.from,
        content: assistantReply,
        interactiveList: categoryInteractiveList,
        flowMessage: null,
      });

      await markMessageProcessed(
        selectedState,
        message.id,
        createdAt,
        persistedMessage.message?.ingest_seq ?? null,
        {
          workflow_step: "collecting_items",
          last_presented_category: "__category_list__",
          last_presented_options: null,
          last_presented_options_at: null,
          preferred_language: prefersRomanUrdu ? "roman_urdu" : "english",
        },
      );
      
      const selectedSession = await getOrCreateUserSession(selectedConversation.id, {
        active_node: "cart_builder",
        status: "active",
        is_bot_active: true,
      });

      await updateUserSession(
        selectedConversation.id,
        buildSessionUpdate({
          session: selectedSession,
          stateBefore: selectedState,
          stateAfter: parseConversationState({
            ...selectedState,
            conversation_id: selectedConversation.id,
            workflow_step: "collecting_items",
            last_presented_category: "__category_list__",
            last_presented_options: null,
            last_presented_options_at: null,
            preferred_language: prefersRomanUrdu ? "roman_urdu" : "english",
          }),
          mode: "agent",
          intent: null,
          lastUserMessage: incomingContent,
          lastAssistantReply: assistantReply,
        }),
      );
      continue;
    }

    // Normal processing if branch is already active
    const conversation = await upsertConversation(contact, contact.active_branch_id, contactName);
    let state = await getOrCreateConversationState(conversation.id);
    if (state.last_processed_user_message_id === message.id) {
      continue;
    }

    const createdAt = toIsoTimestamp(message.timestamp);
    if (shouldStartFreshOrderAfterInactivity(state, createdAt)) {
      const nextLanguage = incomingContent
        ? inferLanguagePreference(incomingContent, state.preferred_language)
        : state.preferred_language;
      const inactivityMs = Math.max(
        0,
        new Date(createdAt).getTime() - new Date(state.last_processed_user_message_at ?? createdAt).getTime(),
      );
      console.info("[webhook] Fresh-start reset after inactivity", {
        conversationId: conversation.id,
        mode: conversation.mode,
        inactivityMinutes: Math.round(inactivityMs / 60_000),
        previousWorkflow: state.workflow_step,
        lastProcessedMessageSeq: state.last_processed_message_seq,
        lastProcessedAt: state.last_processed_user_message_at,
        incomingAt: createdAt,
      });
      await resetOrderDraftAfterInactivity({
        conversationId: conversation.id,
        mode: conversation.mode,
        preferredLanguage: nextLanguage,
        previousState: state,
      });
      state = await getOrCreateConversationState(conversation.id);

    }

    if (!incomingContent) {
      if (message.type !== "reaction") {
        if (message.type === "audio") {
          const voiceFallback =
            state.preferred_language === "urdu"
              ? "آپ کا وائس نوٹ مل گیا، لیکن ابھی آٹومیٹک ٹرانسکرپشن دستیاب نہیں ہے۔ اسٹاف آپ کی مدد کرے گا۔ AI سے آرڈر جاری رکھنے کے لیے براہ کرم ٹیکسٹ میں آرڈر بھیجیں۔"
              : state.preferred_language === "roman_urdu"
              ? "Voice note receive ho gaya hai, lekin is waqt automatic transcription available nahi. Staff aapki help karega. Agar AI se order continue karna hai to please text mein order bhej dein."
              : "I received your voice note, but automatic transcription is not available right now. A staff member will help. To continue with the AI, please type your order.";
          const persistedVoiceMessage = await persistUserMessage(
            conversation.id,
            "[Voice note received - transcription unavailable]",
            message.id,
            createdAt,
          );
          await escalateToHuman({
            conversationId: conversation.id,
            branchId: conversation.branch_id,
            phone: conversation.phone,
            reason: "voice_note_requires_staff",
            prefersRomanUrdu: state.preferred_language !== "english",
          });
          await sendAndPersistAssistantMessage({
            conversationId: conversation.id,
            phone: message.from,
            content: voiceFallback,
            interactiveList: null,
            flowMessage: null,
          });
          await markMessageProcessed(state, message.id, createdAt, persistedVoiceMessage.message?.ingest_seq ?? null, {
            preferred_language: state.preferred_language,
          });
          continue;
        }

        const nonTextReply =
          state.preferred_language === "urdu"
            ? "براہ کرم ٹیکسٹ میسج بھیجیں، میں مینو اور آرڈر میں مدد کروں گا۔"
            : state.preferred_language === "roman_urdu"
            ? "Please text message bhej dein, main menu aur order mein help kar deta hoon."
            : "Please send a text message and I'll help you with the menu or your order.";
        const nonTextFlow = buildFlowMessageForAgentReply({
          context: "menu",
          conversationId: conversation.id,
          prefersRomanUrdu: state.preferred_language !== "english",
          workflowStep: state.workflow_step,
          body: nonTextReply,
        });
        await sendAndPersistAssistantMessage({
          conversationId: conversation.id,
          phone: message.from,
          content: nonTextReply,
          interactiveList: null,
          flowMessage: nonTextFlow,
        });
      }
      await markMessageProcessed(state, message.id, createdAt, null);
      continue;
    }

    const content = incomingContent;
    const persistedMessage = await persistUserMessage(conversation.id, content, message.id, createdAt);
    const nextLanguage = inferLanguagePreference(content, state.preferred_language);
    const { error: languageUpdateError } = await supabaseAdmin
      .from("contacts")
      .update({ preferred_language: nextLanguage, updated_at: new Date().toISOString() })
      .eq("id", contact.id);
    if (languageUpdateError) {
      console.error("[webhook] Failed to update contact language preference:", languageUpdateError);
    }

    if (state.last_presented_category === SAVED_BRANCH_CHOICE_MARKER) {
      if (isContinueWithSavedBranchRequest(content) && activeBranch) {
        const selectedMenuItems = await getMenuCatalog(activeBranch.id);
        const categoryInteractiveList = buildInteractiveCategoryList(selectedMenuItems, prefersRomanUrdu, 1);
        const continueReply = prefersRomanUrdu
          ? `Theek hai, *${activeBranch.name}* continue karte hain. Ab category select karein ya item name bhej dein.`
          : `Great, continuing with *${activeBranch.name}*. Now choose a category or send any item name.`;

        await sendAndPersistAssistantMessage({
          conversationId: conversation.id,
          phone: message.from,
          content: continueReply,
          interactiveList: categoryInteractiveList,
          flowMessage: null,
        });

        await markMessageProcessed(state, message.id, createdAt, persistedMessage.message?.ingest_seq ?? null, {
          workflow_step: "collecting_items",
          preferred_language: nextLanguage,
          last_presented_category: "__category_list__",
          last_presented_options: null,
          last_presented_options_at: null,
        });

        const continueSession = await getOrCreateUserSession(conversation.id, {
          active_node: "cart_builder",
          status: "active",
          is_bot_active: true,
        });
        await updateUserSession(
          conversation.id,
          buildSessionUpdate({
            session: continueSession,
            stateBefore: state,
            stateAfter: parseConversationState({
              ...state,
              conversation_id: conversation.id,
              workflow_step: "collecting_items",
              preferred_language: nextLanguage,
              last_presented_category: "__category_list__",
              last_presented_options: null,
              last_presented_options_at: null,
            }),
            mode: "agent",
            intent: null,
            lastUserMessage: content,
            lastAssistantReply: continueReply,
            forceNode: "cart_builder",
          }),
        );
        continue;
      }

      if (activeBranch && isBranchAddressLookupRequest(content)) {
        const addressReply = activeBranch.address?.trim()
          ? prefersRomanUrdu
            ? `${activeBranch.name} ka address: ${activeBranch.address}`
            : `${activeBranch.name} address: ${activeBranch.address}`
          : prefersRomanUrdu
            ? `Maazrat, ${activeBranch.name} ka address abhi update nahi hai.`
            : `Sorry, ${activeBranch.name} address is not configured yet.`;

        await sendAndPersistAssistantMessage({
          conversationId: conversation.id,
          phone: message.from,
          content: addressReply,
          interactiveList: null,
          flowMessage: null,
        });

        await markMessageProcessed(state, message.id, createdAt, persistedMessage.message?.ingest_seq ?? null, {
          preferred_language: nextLanguage,
        });
        continue;
      }

      if (!isSelectNewBranchRequest(content)) {
        await updateConversationState(state, {
          last_presented_category: null,
          last_presented_options: null,
          last_presented_options_at: null,
        });
        state = parseConversationState({
          ...state,
          last_presented_category: null,
          last_presented_options: null,
          last_presented_options_at: null,
        });
      }
    }

    if (isSelectNewBranchRequest(content)) {
      const prefersRomanUrduForFlow = state.preferred_language !== "english";
      const availableCities = cityGroups.map((group) => group.city);
      const cityInteractiveList = buildInteractiveListForCities(availableCities, prefersRomanUrduForFlow);
      const cityPrompt = getCitySelectionPrompt(availableCities, prefersRomanUrduForFlow);
      await updateConversationState(state, {
        ...getDefaultConversationState(conversation.id),
        workflow_step: "awaiting_branch_selection",
        preferred_language: inferLanguagePreference(content, state.preferred_language),
      });
      await setActiveBranch(contact.id, null);
      const branchFlow = buildFlowMessageForAgentReply({
        context: "branch",
        conversationId: conversation.id,
        prefersRomanUrdu: prefersRomanUrduForFlow,
        workflowStep: "awaiting_branch_selection",
        branches,
        body: cityInteractiveList ? cityInteractiveList.body : cityPrompt,
      });
      await sendAndPersistAssistantMessage({
        conversationId: conversation.id,
        phone: message.from,
        content: cityInteractiveList ? cityInteractiveList.body : cityPrompt,
        interactiveList: cityInteractiveList,
        flowMessage: branchFlow,
      });
      const resetState = await getOrCreateConversationState(conversation.id);
      await markMessageProcessed(resetState, message.id, createdAt, persistedMessage.message?.ingest_seq ?? null);
      const session = await getOrCreateUserSession(conversation.id);
      await updateUserSession(
        conversation.id,
        buildSessionUpdate({
          session,
          stateBefore: state,
          stateAfter: parseConversationState({
            ...getDefaultConversationState(conversation.id),
            workflow_step: "awaiting_branch_selection",
            preferred_language: inferLanguagePreference(content, state.preferred_language),
            conversation_id: conversation.id,
          }),
          mode: "agent",
          intent: null,
          lastUserMessage: content,
          lastAssistantReply: cityPrompt,
          forceNode: "branch_selection",
        }),
      );
      continue;
    }

    if (conversation.mode === "human") {
      if (incomingContent && shouldResumeBotFromHumanMessage(incomingContent)) {
        const resumeReply =
          state.preferred_language === "urdu"
            ? "ٹھیک ہے، AI اسسٹنٹ دوبارہ فعال ہو گیا ہے۔ آپ اپنا آرڈر بھیج سکتے ہیں۔"
            : state.preferred_language === "roman_urdu"
            ? "Theek hai, AI assistant dobara active kar diya gaya hai. Aap apna order message bhej dein."
            : "Done, the AI assistant is active again. You can send your order now.";

        await resumeBotForConversation(conversation.id);
        await supabaseAdmin
          .from("conversations")
          .update({
            mode: "agent",
            has_unread: false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", conversation.id);

        await sendAndPersistAssistantMessage({
          conversationId: conversation.id,
          phone: message.from,
          content: resumeReply,
        });

        await markMessageProcessed(state, message.id, createdAt, persistedMessage.message?.ingest_seq ?? null);
        await getOrCreateUserSession(conversation.id, {
          active_node: "cart_builder",
          status: "active",
          is_bot_active: true,
        });
        await updateUserSession(conversation.id, {
          active_node: "cart_builder",
          return_node: null,
          status: "active",
          is_bot_active: true,
          escalation_reason: null,
          escalated_at: null,
          last_user_message: content,
          last_assistant_reply: resumeReply,
        });
        continue;
      }

      await markMessageProcessed(state, message.id, createdAt, persistedMessage.message?.ingest_seq ?? null);
      const humanSession = await getOrCreateUserSession(conversation.id, {
        active_node: "human_handoff",
        status: "human_handoff",
        is_bot_active: false,
      });
      await updateUserSession(conversation.id, {
        ...buildSessionUpdate({
          session: humanSession,
          stateBefore: state,
          stateAfter: state,
          mode: "human",
          intent: null,
          lastUserMessage: content,
          lastAssistantReply: null,
          forceNode: "human_handoff",
        }),
        status: "human_handoff",
        is_bot_active: false,
      });
      continue;
    }

    agentConversations.set(conversation.id, conversation);
  }

  for (const conversation of agentConversations.values()) {
    await drainConversationQueue(conversation);
  }
}

async function alertStaffForFailedWebhook(payload: unknown, eventId: string, errorMessage: string): Promise<void> {
  const target = await resolveWebhookAlertTarget(payload);
  if (!target) {
    console.warn("[webhook] Could not resolve conversation for failed webhook alert", { eventId });
    return;
  }

  await createStaffAlert({
    conversationId: target.conversationId,
    branchId: target.branchId,
    kind: "webhook_processing",
    severity: "high",
    message: `WhatsApp webhook ${eventId} failed after retries: ${errorMessage.slice(0, 300)}`,
  });
}

async function resolveWebhookAlertTarget(
  payload: unknown,
): Promise<{ conversationId: string; branchId: string } | null> {
  const statusMessageId = extractFirstStatusMessageId(payload);
  if (statusMessageId) {
    const { data: messageRow, error: messageError } = await supabaseAdmin
      .from("messages")
      .select("conversation_id")
      .eq("whatsapp_msg_id", statusMessageId)
      .maybeSingle();

    if (messageError) throw messageError;
    if (messageRow?.conversation_id) {
      return getConversationAlertTarget(messageRow.conversation_id);
    }
  }

  const phone = extractFirstWebhookPhone(payload);
  if (!phone) return null;

  const { data: conversation, error } = await supabaseAdmin
    .from("conversations")
    .select("id, branch_id")
    .eq("phone", phone)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!conversation) return null;

  return {
    conversationId: conversation.id,
    branchId: conversation.branch_id,
  };
}

async function getConversationAlertTarget(
  conversationId: string,
): Promise<{ conversationId: string; branchId: string } | null> {
  const { data: conversation, error } = await supabaseAdmin
    .from("conversations")
    .select("id, branch_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (error) throw error;
  if (!conversation) return null;

  return {
    conversationId: conversation.id,
    branchId: conversation.branch_id,
  };
}

function extractFirstWebhookPhone(payload: unknown): string | null {
  const envelope = payload as IncomingEnvelope;
  for (const entry of envelope.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const messageFrom = change.value?.messages?.find((message) => message.from)?.from;
      if (messageFrom) return messageFrom;

      const statusRecipient = change.value?.statuses?.find((status) => status.recipient_id)?.recipient_id;
      if (statusRecipient) return statusRecipient;
    }
  }
  return null;
}

function extractFirstStatusMessageId(payload: unknown): string | null {
  const envelope = payload as IncomingEnvelope;
  for (const entry of envelope.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const statusId = change.value?.statuses?.find((status) => status.id)?.id;
      if (statusId) return statusId;
    }
  }
  return null;
}

function extractIncomingMessages(body: unknown): IncomingMessageEvent[] {
  const payload = body as IncomingEnvelope;
  const events: IncomingMessageEvent[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const contactName = change.value?.contacts?.[0]?.profile?.name;
      for (const message of change.value?.messages ?? []) {
        if (!message.id || !message.from || !message.timestamp || !message.type) {
          continue;
        }

        events.push({
          message,
          contactName: contactName ?? message.from,
        });
      }
    }
  }

  events.sort((left, right) => {
    const timeDelta = compareMessageTimestamps(left.message.timestamp, right.message.timestamp);
    if (timeDelta !== 0) return timeDelta;
    return left.message.id.localeCompare(right.message.id);
  });

  return events;
}

function extractIncomingStatusEvents(body: unknown): IncomingWhatsAppStatus[] {
  const payload = body as IncomingEnvelope;
  const statuses: IncomingWhatsAppStatus[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        if (!status.id || !status.status) {
          continue;
        }
        statuses.push(status);
      }
    }
  }

  statuses.sort((left, right) => {
    const timeDelta = compareMessageTimestamps(left.timestamp ?? "", right.timestamp ?? "");
    if (timeDelta !== 0) return timeDelta;
    return String(left.id).localeCompare(String(right.id));
  });

  return statuses;
}

async function updateOutboundMessageStatuses(statuses: IncomingWhatsAppStatus[]): Promise<void> {
  for (const statusEvent of statuses) {
    const whatsappMessageId = statusEvent.id?.trim();
    const nextStatus = normalizeWhatsAppDeliveryStatus(statusEvent.status);
    if (!whatsappMessageId || !nextStatus) {
      continue;
    }

    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("messages")
      .select("id, delivery_status")
      .eq("whatsapp_msg_id", whatsappMessageId)
      .maybeSingle();

    if (lookupError) {
      throw lookupError;
    }

    if (!existing) {
      console.warn("[webhook] Received status for unknown outbound WhatsApp message", {
        whatsappMessageId,
        status: statusEvent.status,
        recipientId: statusEvent.recipient_id ?? null,
      });
      continue;
    }

    const currentStatus = normalizeWhatsAppDeliveryStatus(existing.delivery_status);
    if (currentStatus && getDeliveryStatusRank(nextStatus) < getDeliveryStatusRank(currentStatus)) {
      continue;
    }

    const { error: updateError } = await supabaseAdmin
      .from("messages")
      .update({
        delivery_status: nextStatus,
        delivery_error: nextStatus === "failed" ? buildWhatsAppStatusError(statusEvent) : null,
        delivery_status_updated_at: statusEvent.timestamp
          ? toIsoTimestamp(statusEvent.timestamp)
          : new Date().toISOString(),
      })
      .eq("id", existing.id);

    if (updateError) {
      throw updateError;
    }
  }
}

function normalizeWhatsAppDeliveryStatus(value: string | null | undefined): MessageDeliveryStatus | null {
  switch (value) {
    case "pending":
    case "sent":
    case "delivered":
    case "read":
    case "failed":
      return value;
    default:
      return null;
  }
}

function getDeliveryStatusRank(status: MessageDeliveryStatus): number {
  const ranks: Record<MessageDeliveryStatus, number> = {
    pending: 0,
    sent: 1,
    delivered: 2,
    read: 3,
    failed: 4,
  };
  return ranks[status];
}

function buildWhatsAppStatusError(statusEvent: IncomingWhatsAppStatus): string | null {
  const errors = statusEvent.errors ?? [];
  if (errors.length === 0) return "WhatsApp reported delivery failure.";

  return errors
    .map((error) => {
      const code = error.code != null ? `#${error.code}` : null;
      const text = error.message || error.title || error.error_data?.details || "WhatsApp delivery failure";
      return [code, text].filter(Boolean).join(" ");
    })
    .join("; ")
    .slice(0, 500);
}

async function extractIncomingContent(message: IncomingWhatsAppMessage): Promise<string | null> {
  if (message.type === "text") {
    const text = message.text?.body?.trim() ?? "";
    return text || null;
  }

  if (message.type === "audio" && message.audio?.id) {
    return transcribeWhatsAppAudioMessage(message.audio.id, message.audio.mime_type);
  }

  if (message.type === "interactive") {
    const flowReply = message.interactive?.nfm_reply;
    if (flowReply?.response_json) {
      const extracted = extractFlowResponseCommand(flowReply.response_json);
      if (extracted) return extracted.trim();

      const compact = flowReply.response_json.trim();
      if (compact) return compact;
    }

    const listReply = message.interactive?.list_reply;
    if (listReply?.id) return listReply.id.trim();
    if (listReply?.title) return listReply.title.trim();

    const buttonReply = message.interactive?.button_reply;
    if (buttonReply?.id) return buttonReply.id.trim();
    if (buttonReply?.title) return buttonReply.title.trim();
  }

  return null;
}

async function transcribeWhatsAppAudioMessage(mediaId: string, mimeType?: string): Promise<string | null> {
  if (!process.env.GROQ_API_KEY) {
    return null;
  }

  try {
    const mediaUrl = await getWhatsAppMediaUrl(mediaId);
    const media = await downloadWhatsAppMedia(mediaUrl);
    const formData = new FormData();
    const extension = mimeType?.includes("mpeg")
      ? "mp3"
      : mimeType?.includes("wav")
        ? "wav"
        : "ogg";
    formData.append("file", new Blob([media], { type: mimeType || "audio/ogg" }), `voice-note.${extension}`);
    formData.append("model", process.env.GROQ_AUDIO_TRANSCRIPTION_MODEL || "whisper-large-v3-turbo");
    // Force Urdu transcription so Arabic-script Urdu is produced (not Hindi/Devanagari)
    formData.append("language", "ur");

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: formData,
    });

    const data = (await response.json()) as { text?: string; error?: { message?: string } };
    if (!response.ok) {
      throw new Error(data.error?.message || `Groq transcription failed with status ${response.status}`);
    }

    const text = data.text?.trim();
    return text ? `[Voice note] ${text}` : null;
  } catch (error) {
    console.error("[webhook] Failed to transcribe WhatsApp voice note:", error);
    return null;
  }
}

async function upsertContact(phone: string, name: string): Promise<ContactRow> {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from("contacts")
    .select("id, phone, name, active_branch_id")
    .eq("phone", phone)
    .maybeSingle();

  if (fetchError) {
    console.error("[webhook] Error fetching contact:", fetchError);
  }

  if (existing) {
    // If name has changed, update it. Otherwise keep the existing record (and its active_branch_id)
    if (existing.name !== name) {
      const { data: updated, error: updateError } = await supabaseAdmin
        .from("contacts")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select("id, phone, name, active_branch_id")
        .single();
      
      if (updateError) {
        console.error("[webhook] Error updating contact name:", updateError);
        return existing;
      }
      return updated;
    }
    return existing;
  }

  const { data, error } = await supabaseAdmin
    .from("contacts")
    .insert({ phone, name })
    .select("id, phone, name, active_branch_id")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to insert contact.");
  }

  return data;
}

async function setActiveBranch(contactId: string, branchId: string | null) {
  const { error } = await supabaseAdmin
    .from("contacts")
    .update({
      active_branch_id: branchId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contactId);

  if (error) {
    throw error;
  }
}

async function upsertConversation(contact: ContactRow, branchId: string, name: string): Promise<ConversationRow> {
  const { data, error } = await supabaseAdmin
    .from("conversations")
    .upsert(
      {
        contact_id: contact.id,
        branch_id: branchId,
        phone: contact.phone,
        name,
        has_unread: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "contact_id,branch_id" },
    )
    .select("id, contact_id, branch_id, phone, name, mode")
    .single();

  if (error || !data) {
    throw error ?? new Error("Failed to upsert conversation.");
  }

  return data;
}

async function getOrCreateConversationState(conversationId: string): Promise<ConversationState> {
  const { data, error } = await supabaseAdmin
    .from("conversation_states")
    .select("*")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return parseConversationState(data as ConversationState);
  }

  const defaults = getDefaultConversationState(conversationId);
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("conversation_states")
    .insert(defaults)
    .select("*")
    .single();

  if (insertError || !inserted) {
    throw insertError ?? new Error("Failed to create conversation state.");
  }

  return parseConversationState(inserted as ConversationState);
}

async function persistUserMessage(
  conversationId: string,
  content: string,
  whatsappMessageId: string,
  createdAt: string,
): Promise<PersistedUserMessage> {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "user",
      sender_kind: "user",
      content,
      whatsapp_msg_id: whatsappMessageId,
      created_at: createdAt,
    })
    .select("id, ingest_seq, content, created_at, whatsapp_msg_id")
    .maybeSingle();

  if (!error) {
    return {
      message: data
        ? {
            id: data.id,
            ingest_seq: data.ingest_seq,
            content: data.content,
            created_at: data.created_at,
            whatsapp_msg_id: data.whatsapp_msg_id,
          }
        : null,
    };
  }

  if (String(error.code) !== "23505") {
    throw error;
  }

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("messages")
    .select("id, ingest_seq, content, created_at, whatsapp_msg_id")
    .eq("conversation_id", conversationId)
    .eq("whatsapp_msg_id", whatsappMessageId)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  return {
    message: existing
      ? {
          id: existing.id,
          ingest_seq: existing.ingest_seq,
          content: existing.content,
          created_at: existing.created_at,
          whatsapp_msg_id: existing.whatsapp_msg_id,
        }
      : null,
  };
}

async function drainConversationQueue(conversation: ConversationRow) {
  const token = await acquireConversationLock(conversation.id);
  if (!token) {
    console.warn(`[webhook] Skipping queue drain because lock is busy for conversation ${conversation.id}`);
    return;
  }

  try {
    const branch = await getBranchById(conversation.branch_id);
    if (!branch) {
      throw new Error(`Missing branch ${conversation.branch_id} for conversation ${conversation.id}`);
    }
    let settings = await getRestaurantSettings(conversation.branch_id);
    let settingsLoadedAt = Date.now();
    let isOpenNow = settings.is_accepting_orders && isWithinOperatingHours(settings.opening_time, settings.closing_time);
    let cachedMenuItems: MenuCatalogItem[] | null = null;
    let menuLoadedAt = 0;

    while (true) {
      const state = await getOrCreateConversationState(conversation.id);
      const nextMessage = await getNextPendingUserMessage(
        conversation.id,
        state.last_processed_message_seq,
      );
      if (!nextMessage) break;

      if (isStaleMessage(nextMessage, state)) {
        await updateConversationState(state, {
          last_processed_message_seq: nextMessage.ingest_seq,
          last_error: null,
        });
        continue;
      }

      if (Date.now() - settingsLoadedAt > 60_000) {
        settings = await getRestaurantSettings(conversation.branch_id);
        settingsLoadedAt = Date.now();
        isOpenNow = settings.is_accepting_orders && isWithinOperatingHours(settings.opening_time, settings.closing_time);
      }
      // Detect message type for optimization
      const normalizedIncoming = nextMessage.content.toLowerCase().trim();
      const messageType = detectMessageType(normalizedIncoming);
      const hasDirectMenuSignal = /(menu|show.*menu|list.*items?|category|categories|price|rates?|kya.*hai|dikhao)/.test(normalizedIncoming);
      const shouldPrimeMenuOnGreeting =
        messageType === "greeting" &&
        (state.workflow_step === "idle" || state.workflow_step === "collecting_items") &&
        Array.isArray(state.cart) &&
        state.cart.length === 0;
      const shouldKeepMenuHydratedForOrderFlow =
        state.workflow_step === "collecting_items" ||
        state.workflow_step === "awaiting_upsell_reply" ||
        state.workflow_step === "awaiting_order_type";

      // Load menu when direct menu signals exist, even if mixed with greetings like "hi menu".
      const needsFullProcessing =
        messageType === "complex" ||
        messageType === "menu_related" ||
        hasDirectMenuSignal ||
        shouldPrimeMenuOnGreeting ||
        shouldKeepMenuHydratedForOrderFlow;
      if (needsFullProcessing && (!cachedMenuItems || Date.now() - menuLoadedAt > 5 * 60_000)) {
        cachedMenuItems = await getMenuCatalog(conversation.branch_id);
        menuLoadedAt = Date.now();
      }
      const shouldHydrateSession = !(messageType === "greeting" || messageType === "acknowledgment");
      const [
        menuItems,
        semanticMatches,
        session,
        savedAddress,
      ] = await Promise.all([
        needsFullProcessing ? Promise.resolve(cachedMenuItems ?? []) : Promise.resolve([]),
        needsFullProcessing && shouldRunSemanticLookup(nextMessage.content)
          ? getSemanticMenuMatches(conversation.branch_id, nextMessage.content, 20)
          : Promise.resolve([]),
        shouldHydrateSession
          ? getOrCreateUserSession(conversation.id, {
              active_node: conversation.mode === "human" ? "human_handoff" : "cart_builder",
              status: conversation.mode === "human" ? "human_handoff" : "active",
              is_bot_active: conversation.mode !== "human",
            })
          : Promise.resolve(getDefaultUserSession(conversation.id)),
        getLatestSavedAddress(conversation.id),
      ]);

      const decision = await decideTurn({
        messageText: nextMessage.content,
        state,
        menuItems,
        semanticMatches,
        branch: {
          id: branch.id,
          name: branch.name,
          address: branch.address ?? null,
        },
        settings,
        isOpenNow,
        recentOrder: null,
        savedAddress,
        session,
      });

      const updatedState: Partial<ConversationState> = decision.statePatch ?? {};
      const nextStateSnapshot = parseConversationState({
        ...state,
        ...updatedState,
        conversation_id: state.conversation_id,
      });

      try {
        let reply = "";

        if (decision.kind === "escalate_to_human") {
          reply = decision.reply;
          await escalateToHuman({
            conversationId: conversation.id,
            branchId: conversation.branch_id,
            phone: conversation.phone,
            reason: decision.reason,
            prefersRomanUrdu: (updatedState.preferred_language ?? state.preferred_language) === "roman_urdu",
          });
          await updateConversationState(state, {
            ...updatedState,
            last_processed_user_message_id: nextMessage.whatsapp_msg_id,
            last_processed_message_seq: nextMessage.ingest_seq,
            last_processed_user_message_at: nextMessage.created_at,
            last_user_whatsapp_msg_id: nextMessage.whatsapp_msg_id,
            last_error: null,
          });
          await updateUserSession(
            conversation.id,
            buildSessionUpdate({
              session,
              stateBefore: state,
              stateAfter: nextStateSnapshot,
              mode: "human",
              intent: (decision.trace?.intent as OrderTurnIntent | undefined) ?? null,
              lastUserMessage: nextMessage.content,
              lastAssistantReply: reply,
              semanticCandidates: semanticMatches.map((item) => ({
                id: item.id,
                name: item.name,
                price: item.price,
                category: item.category,
                similarity: item.similarity,
              })),
              forceNode: "human_handoff",
              escalationReason: decision.reason,
            }),
          );
          await recordOrderAgentTurn({
            conversationId: conversation.id,
            messageId: nextMessage.id,
            whatsappMessageId: nextMessage.whatsapp_msg_id,
            workflowBefore: state.workflow_step,
            workflowAfter:
              (updatedState.workflow_step as ConversationState["workflow_step"] | undefined) ?? state.workflow_step,
            decisionKind: decision.kind,
            trace: decision.trace,
            result: "success",
            reply,
          });
          break;
        }

        if (decision.kind === "fallback") {
          // For fallback, we need conversation history and menu data
          const history = await getConversationHistoryUpTo(conversation.id, nextMessage.ingest_seq);
          const fallbackMenuForAI = await getMenuForAI(conversation.branch_id);
          reply = await getCustomerSupportReply(
            history,
            fallbackMenuForAI,
            isOpenNow,
            history.some((entry) => entry.role === "assistant"),
            settings,
            (decision.statePatch?.preferred_language ?? state.preferred_language) || "english",
            {
              id: branch.id,
              slug: branch.slug,
              name: branch.name,
              city: branch.city,
              address: branch.address,
            },
          );
        } else {
          reply = decision.reply;
        }

        if (decision.kind === "place_order") {
          await createOrderFromPayload(
            conversation.id,
            conversation.branch_id,
            nextMessage.whatsapp_msg_id,
            decision.order,
            settings,
          );
          await Promise.all([
            saveCustomerAddressFromOrder({
              conversationId: conversation.id,
              branchId: conversation.branch_id,
              address: decision.order.type === "delivery" ? decision.order.address : null,
            }),
            updateCustomerOrderStats({
              conversationId: conversation.id,
              preferredLanguage: (updatedState.preferred_language ?? state.preferred_language) === "roman_urdu" ? "roman_urdu" : "english",
            }),
          ]);
        }

        const optionsFromState = Array.isArray(updatedState.last_presented_options)
          ? updatedState.last_presented_options
          : null;
        const canAttachPresentedOptions =
          nextStateSnapshot.workflow_step === "idle" ||
          nextStateSnapshot.workflow_step === "collecting_items";
        const interactiveList =
          ("interactiveList" in decision ? decision.interactiveList : null) ??
          (canAttachPresentedOptions && optionsFromState && optionsFromState.length > 0
            ? buildInteractiveListForPresentedOptions(
              optionsFromState,
              (updatedState.preferred_language ?? state.preferred_language) === "roman_urdu",
            )
            : null);

        const flowMessage =
          decision.kind === "place_order"
            ? null
            : buildFlowMessageForAgentReply({
                conversationId: conversation.id,
                prefersRomanUrdu: (updatedState.preferred_language ?? state.preferred_language) === "roman_urdu",
                workflowStep: nextStateSnapshot.workflow_step,
                branch: {
                  id: branch.id,
                  slug: branch.slug,
                  name: branch.name,
                  address: branch.address,
                },
                menuItems,
                cart: nextStateSnapshot.cart,
                customerInstructions: nextStateSnapshot.customer_instructions,
                orderType: nextStateSnapshot.order_type,
                address: nextStateSnapshot.address,
                guests: nextStateSnapshot.guests,
                reservationTime: nextStateSnapshot.reservation_time,
                pickupTime: nextStateSnapshot.pickup_time,
                settings,
                suggestedUpsell:
                  typeof nextStateSnapshot.upsell_item_name === "string" &&
                  nextStateSnapshot.upsell_item_name.trim() &&
                  typeof nextStateSnapshot.upsell_item_price === "number"
                    ? {
                        name: nextStateSnapshot.upsell_item_name,
                        price: nextStateSnapshot.upsell_item_price,
                      }
                    : null,
                body: reply,
              });

        await sendAndPersistAssistantMessage({
          conversationId: conversation.id,
          phone: conversation.phone,
          content: reply,
          interactiveList,
          flowMessage,
        });
        await updateConversationState(state, {
          ...updatedState,
          last_processed_user_message_id: nextMessage.whatsapp_msg_id,
          last_processed_message_seq: nextMessage.ingest_seq,
          last_processed_user_message_at: nextMessage.created_at,
          last_user_whatsapp_msg_id: nextMessage.whatsapp_msg_id,
          last_error: null,
        });
        if (shouldHydrateSession) {
          await updateUserSession(
            conversation.id,
            buildSessionUpdate({
              session,
              stateBefore: state,
              stateAfter: nextStateSnapshot,
              mode: conversation.mode,
              intent: (decision.trace?.intent as OrderTurnIntent | undefined) ?? null,
              lastUserMessage: nextMessage.content,
              lastAssistantReply: reply,
              semanticCandidates: semanticMatches.map((item) => ({
                id: item.id,
                name: item.name,
                price: item.price,
                category: item.category,
                similarity: item.similarity,
              })),
            }),
          );
        }
        await recordOrderAgentTurn({
          conversationId: conversation.id,
          messageId: nextMessage.id,
          whatsappMessageId: nextMessage.whatsapp_msg_id,
          workflowBefore: state.workflow_step,
          workflowAfter:
            (updatedState.workflow_step as ConversationState["workflow_step"] | undefined) ?? state.workflow_step,
          decisionKind: decision.kind,
          trace: decision.trace,
          result: "success",
          reply,
        });
      } catch (error) {
        if (error instanceof OutboundMessageError) {
          if (error.messageSent) {
            await updateConversationState(state, {
              ...updatedState,
              last_processed_user_message_id: nextMessage.whatsapp_msg_id,
              last_processed_message_seq: nextMessage.ingest_seq,
              last_processed_user_message_at: nextMessage.created_at,
              last_user_whatsapp_msg_id: nextMessage.whatsapp_msg_id,
              last_error: error.message,
            });
            await recordOrderAgentTurn({
              conversationId: conversation.id,
              messageId: nextMessage.id,
              whatsappMessageId: nextMessage.whatsapp_msg_id,
              workflowBefore: state.workflow_step,
              workflowAfter:
                (updatedState.workflow_step as ConversationState["workflow_step"] | undefined) ?? state.workflow_step,
              decisionKind: decision.kind,
              trace: decision.trace,
              result: "partial",
              reply: null,
              error: error.message,
            });
            continue;
          }

          await deleteUnsentOutboundMessage(error.persistedMessageId);
          await updateConversationState(state, {
            last_error: error.message,
          });
          await recordOrderAgentTurn({
            conversationId: conversation.id,
            messageId: nextMessage.id,
            whatsappMessageId: nextMessage.whatsapp_msg_id,
            workflowBefore: state.workflow_step,
            workflowAfter: state.workflow_step,
            decisionKind: decision.kind,
            trace: decision.trace,
            result: "failed",
            reply: null,
            error: error.message,
          });
          throw error;
        }

        const replyLanguage =
          (updatedState.preferred_language ?? state.preferred_language) === "roman_urdu" ? "roman_urdu" : "english";
        const missingMenuItem = /Menu item no longer exists:\s*(.+)$/i.exec(
          error instanceof Error ? error.message : "",
        );
        const fallback = missingMenuItem
          ? replyLanguage === "roman_urdu"
            ? `Maazrat, *${missingMenuItem[1]}* ab menu mein available nahi hai. Kisi aur item ka naam bhej dein ya *menu* likh dein.`
            : `Sorry, *${missingMenuItem[1]}* is no longer available right now. Please send another item name or type *menu*.`
          : replyLanguage === "roman_urdu"
            ? "Maazrat, system is waqt thora busy hai. Thori dair mein dubara message bhej dein ya urgent help ke liye call karein."
            : "I'm sorry, the system is a little busy right now. Please send your message again in a moment or call us for urgent help.";
        try {
          await sendAndPersistAssistantMessage({
            conversationId: conversation.id,
            phone: conversation.phone,
            content: fallback,
          });
          await updateConversationState(state, {
            last_processed_user_message_id: nextMessage.whatsapp_msg_id,
            last_processed_message_seq: nextMessage.ingest_seq,
            last_processed_user_message_at: nextMessage.created_at,
            last_user_whatsapp_msg_id: nextMessage.whatsapp_msg_id,
            last_error: error instanceof Error ? error.message : "Unknown processing error",
          });
          await recordOrderAgentTurn({
            conversationId: conversation.id,
            messageId: nextMessage.id,
            whatsappMessageId: nextMessage.whatsapp_msg_id,
            workflowBefore: state.workflow_step,
            workflowAfter: state.workflow_step,
            decisionKind: decision.kind,
            trace: decision.trace,
            result: "recovered",
            reply: fallback,
            error: error instanceof Error ? error.message : "Unknown processing error",
          });
        } catch (fallbackError) {
          if (fallbackError instanceof OutboundMessageError && fallbackError.messageSent) {
            await updateConversationState(state, {
              last_processed_user_message_id: nextMessage.whatsapp_msg_id,
              last_processed_message_seq: nextMessage.ingest_seq,
              last_processed_user_message_at: nextMessage.created_at,
              last_user_whatsapp_msg_id: nextMessage.whatsapp_msg_id,
              last_error: fallbackError.message,
            });
            await recordOrderAgentTurn({
              conversationId: conversation.id,
              messageId: nextMessage.id,
              whatsappMessageId: nextMessage.whatsapp_msg_id,
              workflowBefore: state.workflow_step,
              workflowAfter: state.workflow_step,
              decisionKind: decision.kind,
              trace: decision.trace,
              result: "partial",
              reply: null,
              error: fallbackError.message,
            });
            continue;
          }

          await updateConversationState(state, {
            last_error:
              error instanceof Error
                ? `${error.message} | Fallback failed: ${fallbackError instanceof Error ? fallbackError.message : "Unknown error"}`
                : "Unknown processing error",
          });
          await recordOrderAgentTurn({
            conversationId: conversation.id,
            messageId: nextMessage.id,
            whatsappMessageId: nextMessage.whatsapp_msg_id,
            workflowBefore: state.workflow_step,
            workflowAfter: state.workflow_step,
            decisionKind: decision.kind,
            trace: decision.trace,
            result: "failed",
            reply: null,
            error:
              fallbackError instanceof Error
                ? fallbackError.message
                : "Fallback failed with unknown error",
          });
          throw fallbackError;
        }
      }
    }
  } finally {
    await releaseConversationLock(conversation.id, token);
  }
}

async function getNextPendingUserMessage(
  conversationId: string,
  lastProcessedMessageSeq: number | null,
): Promise<MessageRow | null> {
  let query = supabaseAdmin
    .from("messages")
    .select("id, ingest_seq, content, created_at, whatsapp_msg_id")
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .order("ingest_seq", { ascending: true })
    .limit(1);

  if (lastProcessedMessageSeq != null) {
    query = query.gt("ingest_seq", lastProcessedMessageSeq);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    ingest_seq: data.ingest_seq,
    content: data.content,
    created_at: data.created_at,
    whatsapp_msg_id: data.whatsapp_msg_id,
  };
}

async function getConversationHistoryUpTo(conversationId: string, ingestSeq: number) {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("role, content, ingest_seq")
    .eq("conversation_id", conversationId)
    .lte("ingest_seq", ingestSeq)
    .order("ingest_seq", { ascending: false })
    .limit(20);

  if (error) throw error;
  return (data ?? []).reverse().map((row) => ({
    role: row.role,
    content: row.content,
  }));
}

async function markMessageProcessed(
  state: ConversationState,
  whatsappMessageId: string,
  createdAt: string,
  ingestSeq: number | null,
  extraPatch?: Partial<ConversationState>,
) {
  await updateConversationState(state, {
    ...extraPatch,
    last_processed_user_message_id: whatsappMessageId,
    ...(ingestSeq != null ? { last_processed_message_seq: ingestSeq } : {}),
    last_processed_user_message_at: createdAt,
    last_user_whatsapp_msg_id: whatsappMessageId,
    last_error: null,
  });
}

async function updateConversationState(state: ConversationState, patch: Partial<ConversationState>) {
  const nextState = {
    ...state,
    ...patch,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("conversation_states")
    .update(nextState)
    .eq("conversation_id", state.conversation_id);

  if (error) {
    throw error;
  }
}

async function acquireConversationLock(conversationId: string): Promise<string | null> {
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 90 * 1000).toISOString();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data: unlockedRow, error: unlockedError } = await supabaseAdmin
      .from("conversation_states")
      .update({
        processing_token: token,
        processing_started_at: now,
      })
      .eq("conversation_id", conversationId)
      .is("processing_token", null)
      .select("conversation_id")
      .maybeSingle();

    if (unlockedError) throw unlockedError;
    if (unlockedRow) return token;

    const { data: staleRow, error: staleError } = await supabaseAdmin
      .from("conversation_states")
      .update({
        processing_token: token,
        processing_started_at: now,
      })
      .eq("conversation_id", conversationId)
      .lt("processing_started_at", staleBefore)
      .select("conversation_id")
      .maybeSingle();

    if (staleError) throw staleError;
    if (staleRow) return token;

    await sleep(150 * (attempt + 1));
  }

  return null;
}

async function releaseConversationLock(conversationId: string, token: string) {
  const { error } = await supabaseAdmin
    .from("conversation_states")
    .update({
      processing_token: null,
      processing_started_at: null,
    })
    .eq("conversation_id", conversationId)
    .eq("processing_token", token);

  if (error) {
    console.error("[webhook] Failed to release lock:", error);
  }
}

async function createOrderFromPayload(
  conversationId: string,
  branchId: string,
  sourceUserMessageId: string | null,
  payload: PlaceableOrderPayload,
  settings: Awaited<ReturnType<typeof getRestaurantSettings>>,
) {
  if (!sourceUserMessageId) {
    throw new Error("Missing source user message id for order placement.");
  }

  const deliveryFee =
    payload.type === "delivery" && settings.delivery_enabled && settings.delivery_fee > 0
      ? Number(settings.delivery_fee)
      : 0;

  const orderItems = payload.items.map((item) => ({
    name: item.name,
    qty: item.qty,
    size: item.size ?? null,
    addons: Array.isArray(item.addons) ? item.addons.slice(0, 8) : [],
    item_instructions: item.item_instructions ?? null,
  }));

  const { data, error } = await supabaseAdmin.rpc("place_order_from_payload", {
    p_conversation_id: conversationId,
    p_branch_id: branchId,
    p_source_user_message_id: sourceUserMessageId,
    p_type: payload.type,
    p_items: orderItems,
    p_customer_instructions: payload.customer_instructions ?? null,
    p_address: payload.type === "delivery" ? payload.address : null,
    p_guests: payload.type === "dine-in" ? payload.guests : null,
    p_reservation_time: payload.type === "dine-in" ? payload.reservation_time : null,
    p_pickup_time: payload.type === "pickup" ? payload.pickup_time : null,
    p_delivery_fee: deliveryFee,
  });

  if (error) {
    throw error;
  }

  const order = Array.isArray(data) ? data[0] : data;
  if (!order?.id) {
    throw new Error("Failed to create order.");
  }

  return order;
}

async function sendBranchSelectionMessage(
  phone: string,
  branches: BranchSummary[],
  prefersRomanUrdu: boolean,
  selectedCity?: string,
) {
  const interactiveList = buildInteractiveListForBranches(branches, prefersRomanUrdu, selectedCity);
  if (interactiveList) {
    try {
      await sendWhatsAppInteractiveList(phone, interactiveList);
      return;
    } catch (error) {
      console.warn("[webhook] Interactive branch list failed, falling back to text:", error);
    }
  }

  const flowMessage = buildBranchSelectionFlowMessage(phone, branches, prefersRomanUrdu);
  if (flowMessage) {
    try {
      await sendWhatsAppInteractiveFlow(phone, flowMessage);
      return;
    } catch (error) {
      console.warn("[webhook] Flow branch selector failed, falling back to text:", error);
    }
  }

  await sendWhatsAppMessage(phone, getBranchSelectionPromptForCity(branches, prefersRomanUrdu, selectedCity));
}

async function sendCitySelectionMessage(
  phone: string,
  cityGroups: CityBranchGroup[],
  prefersRomanUrdu: boolean,
) {
  const cities = cityGroups.map((group) => group.city);
  const interactiveList = buildInteractiveListForCities(cities, prefersRomanUrdu);
  if (interactiveList) {
    try {
      await sendWhatsAppInteractiveList(phone, interactiveList);
      return;
    } catch (error) {
      console.warn("[webhook] Interactive city list failed, falling back to text:", error);
    }
  }

  await sendWhatsAppMessage(phone, getCitySelectionPrompt(cities, prefersRomanUrdu));
}

function getBranchSelectionPromptForCity(
  branches: BranchSummary[],
  prefersRomanUrdu: boolean,
  selectedCity?: string,
): string {
  if (!selectedCity) {
    return getBranchSelectionPrompt(branches, prefersRomanUrdu);
  }

  if (branches.length === 0) {
    return prefersRomanUrdu
      ? `Maazrat, ${selectedCity} mein koi branch available nahi hai.`
      : `Sorry, no branches are available in ${selectedCity}.`;
  }

  const intro = prefersRomanUrdu
    ? `${selectedCity} mein apni branch select karein:`
    : `Please choose your branch in ${selectedCity}:`;
  const closing = prefersRomanUrdu
    ? "Reply mein branch ka naam bhej dein."
    : "Reply with your branch name.";

  return [
    intro,
    ...branches.map((branch, index) => `${index + 1}. ${branch.name}${branch.address ? ` - ${branch.address}` : ""}`),
    closing,
  ].join("\n");
}

function shouldStartFreshOrderAfterInactivity(state: ConversationState, incomingCreatedAt: string): boolean {
  if (!state.last_processed_user_message_at) return false;

  const lastProcessedAtMs = new Date(state.last_processed_user_message_at).getTime();
  const incomingAtMs = new Date(incomingCreatedAt).getTime();
  if (!Number.isFinite(lastProcessedAtMs) || !Number.isFinite(incomingAtMs)) return false;

  return incomingAtMs - lastProcessedAtMs >= ORDER_FRESH_START_AFTER_INACTIVITY_MS;
}

async function resetOrderDraftAfterInactivity(params: {
  conversationId: string;
  mode: ConversationRow["mode"];
  preferredLanguage: ConversationState["preferred_language"];
  previousState: ConversationState;
}) {
  const { conversationId, mode, preferredLanguage, previousState } = params;
  const resetState = {
    ...getDefaultConversationState(conversationId),
    preferred_language: preferredLanguage,
    // Keep processed-message pointers so old queued user messages are not replayed.
    last_processed_user_message_id: previousState.last_processed_user_message_id,
    last_processed_message_seq: previousState.last_processed_message_seq,
    last_processed_user_message_at: previousState.last_processed_user_message_at,
    last_user_whatsapp_msg_id: previousState.last_user_whatsapp_msg_id,
  };

  const { error: stateError } = await supabaseAdmin
    .from("conversation_states")
    .update({
      ...resetState,
      updated_at: new Date().toISOString(),
    })
    .eq("conversation_id", conversationId);

  if (stateError) {
    throw stateError;
  }

  if (mode === "human") {
    return;
  }

  await getOrCreateUserSession(conversationId, {
    active_node: "cart_builder",
    status: "active",
    is_bot_active: true,
  });

  await updateUserSession(conversationId, {
    active_node: "cart_builder",
    return_node: null,
    status: "active",
    is_bot_active: true,
    invalid_step_count: 0,
    consecutive_tool_failures: 0,
    anger_level: 0,
    last_intent: null,
    last_tool_name: null,
    last_tool_error: null,
    last_user_message: null,
    last_assistant_reply: null,
    last_semantic_candidates: [],
    escalation_reason: null,
    escalated_at: null,
  });
}

function toIsoTimestamp(timestamp: string): string {
  const parsed = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return new Date().toISOString();
  }

  const date = new Date(parsed * 1000);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function compareMessageTimestamps(left: string, right: string): number {
  const leftValue = Number.parseInt(left, 10);
  const rightValue = Number.parseInt(right, 10);

  const leftValid = Number.isFinite(leftValue);
  const rightValid = Number.isFinite(rightValue);
  if (leftValid && rightValid) return leftValue - rightValue;
  if (leftValid) return -1;
  if (rightValid) return 1;
  return 0;
}

function isStaleMessage(message: MessageRow, state: ConversationState): boolean {
  if (!state.last_processed_user_message_at) {
    return false;
  }

  const nextTime = new Date(message.created_at).getTime();
  const lastProcessedTime = new Date(state.last_processed_user_message_at).getTime();

  if (Number.isNaN(nextTime) || Number.isNaN(lastProcessedTime)) {
    return false;
  }

  return nextTime < lastProcessedTime;
}

function isValidWhatsAppSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
  if (!appSecret) {
    console.error("[webhook] Missing WHATSAPP_APP_SECRET for signature validation.");
    return false;
  }

  if (!signatureHeader?.startsWith("sha256=")) {
    console.error("[webhook] Missing x-hub-signature-256 header.");
    return false;
  }

  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const received = signatureHeader.trim();
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function recordOrderAgentTurn(input: {
  conversationId: string;
  messageId: string;
  whatsappMessageId: string | null;
  workflowBefore: ConversationState["workflow_step"];
  workflowAfter: ConversationState["workflow_step"];
  decisionKind: TurnDecision["kind"];
  trace?: TurnDecision["trace"];
  result: "success" | "partial" | "recovered" | "failed";
  reply: string | null;
  error?: string;
}) {
  try {
    await supabaseAdmin.from("order_agent_turns").insert({
      conversation_id: input.conversationId,
      message_id: input.messageId,
      whatsapp_message_id: input.whatsappMessageId,
      workflow_before: input.workflowBefore,
      workflow_after: input.workflowAfter,
      decision_kind: input.decisionKind,
      nlu_intent: input.trace?.intent ?? null,
      nlu_confidence: input.trace?.confidence ?? null,
      nlu_unknown_items: input.trace?.unknownItems ?? [],
      nlu_notes: input.trace?.notes ?? null,
      processing_result: input.result,
      assistant_reply: input.reply,
      error_message: input.error ?? null,
    });
  } catch (error) {
    console.error("[webhook] Failed to record order agent turn:", error);
  }
}

