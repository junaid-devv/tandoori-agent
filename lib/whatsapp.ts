import { EvolutionApiError, evolutionRequest, getEvolutionConfig } from "./evolution-client";
import { getWhatsAppTransport, withConversationWhatsApp } from "./whatsapp-context";
import { getRestaurantProfile } from "./restaurant-profile";
import { supabaseAdmin } from "./supabase-admin";

export class WhatsAppSendUncertainError extends Error {
  constructor() { super("Delivery is unconfirmed after a network interruption. Check WhatsApp before sending again."); this.name = "WhatsAppSendUncertainError"; }
}
class WhatsAppRejectedError extends Error {}

export type WhatsAppSendResult = {
  messageId: string | null;
  raw: unknown;
  deliveryFormat?: "text_options" | "native";
  renderedText?: string;
};

export type WhatsAppInteractiveListRow = {
  id: string;
  title: string;
  description?: string;
};

export type WhatsAppInteractiveListPayload = {
  body: string;
  buttonText: string;
  sectionTitle?: string;
  rows: WhatsAppInteractiveListRow[];
};

export type WhatsAppReplyButton = {
  id: string;
  title: string;
};

export type WhatsAppReplyButtonPayload = {
  body: string;
  buttons: WhatsAppReplyButton[];
  headerText?: string;
  footerText?: string;
};

const STATUS_MESSAGES: Record<string, string> = {
  preparing: "Your order is being prepared. It will be ready soon.",
  out_for_delivery: "Your order is on the way and should reach you shortly.",
  delivered: "Your order has been delivered. Thank you for choosing {restaurant}.",
  cancelled: "Your order has been cancelled. For help, please call {support_phone}.",
};
const WHATSAPP_REQUEST_TIMEOUT_MS = Number(process.env.WHATSAPP_REQUEST_TIMEOUT_MS) || 15_000;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = WHATSAPP_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (init.method === "POST") throw new WhatsAppSendUncertainError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Set of message IDs recently sent by our bot (to avoid self-echo processing)
const sentMessageIds = new Map<string, number>(); // messageId -> timestamp
const SENT_MESSAGE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function recordSentMessageId(messageId: string | null | undefined) {
  if (!messageId) return;
  const now = Date.now();
  sentMessageIds.set(messageId, now);

  if (sentMessageIds.size > 2000) {
    for (const [id, ts] of sentMessageIds.entries()) {
      if (now - ts > SENT_MESSAGE_TTL_MS) {
        sentMessageIds.delete(id);
      }
    }
  }
}

export function isBotSentMessageId(messageId: string | null | undefined): boolean {
  if (!messageId) return false;
  const ts = sentMessageIds.get(messageId);
  if (!ts) return false;
  if (Date.now() - ts > SENT_MESSAGE_TTL_MS) {
    sentMessageIds.delete(messageId);
    return false;
  }
  return true;
}

async function sendEvolution(to: string, endpoint: string, payload: Record<string, unknown>): Promise<WhatsAppSendResult> {
  const transport = getWhatsAppTransport();
  if (transport?.provider !== "evolution") throw new Error("A tenant Evolution instance is required");
  if (transport.readOnly) throw new Error("Media access cannot send messages");
  const number = to.includes("@") ? to : to.replace(/[^0-9]/g, "");
  if (!/^(?:\d{7,15}|\d{7,20}@(s\.whatsapp\.net|lid))$/.test(number)) throw new Error("Invalid WhatsApp recipient");
  const config = await getEvolutionConfig(transport.restaurantId);
  if (!config?.is_active || config.connection_status !== "open" || config.instance_name !== transport.instanceName) throw new Error("Evolution connection is disconnected or belongs to another restaurant");
  const data = await evolutionRequest('/message/' + endpoint + '/' + encodeURIComponent(transport.instanceName), "POST", { number, ...payload }).catch(error => {
    if (!(error instanceof EvolutionApiError) || error.status >= 500) throw new WhatsAppSendUncertainError();
    throw error;
  });
  const rawId = data.key?.id;
  if (typeof rawId !== "string" || !rawId) throw new Error("Evolution returned no message ID");
  const messageId = `evolution:${transport.instanceName}:${rawId}`;
  recordSentMessageId(messageId);
  return { messageId, raw: data, ...(["sendButtons", "sendList"].includes(endpoint) ? { deliveryFormat: "native" as const } : {}) };
}

async function evolutionNativeInteractiveEnabled(): Promise<boolean> {
  const transport = getWhatsAppTransport();
  if (transport?.provider !== "evolution") return false;
  const config = await getEvolutionConfig(transport.restaurantId);
  if (!config?.is_active || config.instance_name !== transport.instanceName) throw new Error("Evolution connection is inactive for this restaurant");
  return config.interactive_mode === "native";
}

async function resolveCredentials(
  phoneNumberId?: string,
  customToken?: string,
  mediaRead = false,
): Promise<{ phoneId: string; token: string }> {
  const context = getWhatsAppTransport();
  if (context?.provider !== "meta") throw new Error("A tenant-scoped WhatsApp connection is required");
  if (context.readOnly && !mediaRead) throw new Error("Media access cannot send messages");
  const phoneId = context.phoneNumberId;
  if (phoneNumberId && phoneNumberId !== phoneId) throw new Error("Meta phone does not match the active tenant connection");
  let query = supabaseAdmin.from("whatsapp_configs").select("phone_number_id, access_token")
    .eq("phone_number_id", phoneId).eq("restaurant_id", context.restaurantId);
  if (!mediaRead || !context.readOnly) query = query.eq("is_active", true);
  const { data: config, error } = await query.maybeSingle();
  if (error || !config?.access_token) throw error || new Error("Meta connection is missing or inactive for this restaurant");
  if (customToken && customToken !== config.access_token) throw new Error("Meta token override does not match tenant credentials");
  const token = config.access_token;
  return { phoneId, token };
}

export async function sendWhatsAppMessage(
  to: string,
  body: string,
  phoneNumberId?: string,
  customAccessToken?: string
): Promise<WhatsAppSendResult> {
  if (process.env.MOCK_WHATSAPP === "true" && process.env.NODE_ENV !== "production") {
    console.log(`[MOCK WHATSAPP] Sending text message to ${to}:`, body);
    return {
      messageId: `wamid.mockText${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      raw: { mock: true },
    };
  }

  if (getWhatsAppTransport()?.provider === "evolution") return sendEvolution(to, "sendText", { text: body });

  const { phoneId, token } = await resolveCredentials(phoneNumberId, customAccessToken);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(`https://graph.facebook.com/v22.0/${phoneId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body },
        }),
      });

      const data = (await response.json()) as {
        error?: { code?: number; message?: string };
        messages?: Array<{ id?: string }>;
      };

      if (!response.ok) {
        // A closed 24-hour window requires a client-approved template. Never
        // substitute hello_world while recording an order confirmation as sent.
        const errorMessage = data.error?.message || `WhatsApp send failed with status ${response.status}`;
        const error = new WhatsAppRejectedError(errorMessage);
        if (data.error?.code === 131030) {
          console.warn("WhatsApp recipient is not in the allowed list.");
        }

        if (attempt < 3 && isRetriableStatus(response.status)) {
          lastError = error;
          await sleep(attempt * 400);
          continue;
        }

        throw error;
      }

      const sentId = data.messages?.[0]?.id ?? null;
      recordSentMessageId(sentId);

      return {
        messageId: sentId,
        raw: data,
      };
    } catch (error) {
      if (error instanceof WhatsAppRejectedError || error instanceof WhatsAppSendUncertainError) throw error;
      lastError = error instanceof Error ? error : new Error("Unknown WhatsApp send failure");
      if (attempt < 3) {
        await sleep(attempt * 400);
        continue;
      }
    }
  }

  throw lastError ?? new Error("WhatsApp send failed.");
}

export async function sendWhatsAppImage(
  to: string,
  imageUrl: string,
  caption?: string,
  phoneNumberId?: string,
  customAccessToken?: string,
): Promise<WhatsAppSendResult> {
  if (process.env.MOCK_WHATSAPP === "true" && process.env.NODE_ENV !== "production") {
    console.log(`[MOCK WHATSAPP] Sending image to ${to}: ${imageUrl}${caption ? ` (caption: ${caption})` : ""}`);
    return {
      messageId: `wamid.mockImg${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      raw: { mock: true },
    };
  }

  if (getWhatsAppTransport()?.provider === "evolution") return sendEvolution(to, "sendMedia", { mediatype: "image", media: imageUrl, ...(caption ? { caption } : {}) });

  const { phoneId, token } = await resolveCredentials(phoneNumberId, customAccessToken);

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(`https://graph.facebook.com/v22.0/${phoneId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "image",
          image: {
            link: imageUrl,
            ...(caption ? { caption: caption.slice(0, 1024) } : {}),
          },
        }),
      });

      const data = (await response.json()) as {
        error?: { code?: number; message?: string };
        messages?: Array<{ id?: string }>;
      };

      if (!response.ok) {
        const errorMessage = data.error?.message || `WhatsApp image send failed with status ${response.status}`;
        const error = new WhatsAppRejectedError(errorMessage);
        if (attempt < 3 && isRetriableStatus(response.status)) {
          lastError = error;
          await sleep(attempt * 400);
          continue;
        }
        throw error;
      }

      return {
        messageId: data.messages?.[0]?.id ?? null,
        raw: data,
      };
    } catch (error) {
      if (error instanceof WhatsAppRejectedError || error instanceof WhatsAppSendUncertainError) throw error;
      lastError = error instanceof Error ? error : new Error("Unknown WhatsApp image send failure");
      if (attempt < 3) {
        await sleep(attempt * 400);
        continue;
      }
    }
  }

  throw lastError ?? new Error("WhatsApp image send failed.");
}

export async function getWhatsAppMediaUrl(mediaId: string): Promise<string> {
  const { token } = await resolveCredentials(undefined, undefined, true);

  const response = await fetchWithTimeout(`https://graph.facebook.com/v22.0/${encodeURIComponent(mediaId)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const data = (await response.json()) as { url?: string; error?: { message?: string } };
  if (!response.ok || !data.url) {
    throw new Error(data.error?.message || `WhatsApp media lookup failed with status ${response.status}`);
  }
  return data.url;
}

export async function downloadWhatsAppMedia(mediaUrl: string): Promise<ArrayBuffer> {
  const { token } = await resolveCredentials(undefined, undefined, true);

  const response = await fetchWithTimeout(mediaUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`WhatsApp media download failed with status ${response.status}`);
  }
  return response.arrayBuffer();
}

export async function sendWhatsAppInteractiveList(
  to: string,
  payload: WhatsAppInteractiveListPayload,
  phoneNumberId?: string,
  customAccessToken?: string,
): Promise<WhatsAppSendResult> {
  if (process.env.MOCK_WHATSAPP === "true" && process.env.NODE_ENV !== "production") {
    console.log(`[MOCK WHATSAPP] Sending interactive list to ${to}:`, payload);
    return {
      messageId: `wamid.mockList${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      raw: { mock: true },
    };
  }

  if (getWhatsAppTransport()?.provider === "evolution") {
    if (!payload.rows?.length) throw new Error("Interactive list requires at least one row.");
    if (!(await evolutionNativeInteractiveEnabled())) {
      const text = [payload.body, payload.rows.slice(0, 10).map((row, i) => `${i + 1}. ${row.title}${row.description ? ` — ${row.description}` : ""}`).join("\n"), "Reply with an option number or name."].join("\n\n");
      return { ...await sendEvolution(to, "sendText", { text }), deliveryFormat: "text_options", renderedText: text };
    }
    return sendEvolution(to, "sendList", {
      title: (payload.sectionTitle || "Options").slice(0, 60), description: payload.body.slice(0, 1024),
      buttonText: payload.buttonText.slice(0, 20),
      footerText: "Select an option",
      sections: [{ title: (payload.sectionTitle || "Options").slice(0, 24), rows: payload.rows.slice(0, 10).map(row => ({
        rowId: String(row.id).slice(0, 200), title: row.title.slice(0, 24), description: (row.description || "").slice(0, 72),
      })) }],
    });
  }

  const { phoneId, token } = await resolveCredentials(phoneNumberId, customAccessToken);

  if (!payload.rows || payload.rows.length === 0) {
    throw new Error("Interactive list requires at least one row.");
  }

  const rows = payload.rows.slice(0, 10).map((row) => {
    const title = String(row.title);
    const truncatedTitle = title.length > 24 ? title.slice(0, 21) + "..." : title;
    return {
      id: String(row.id).slice(0, 200),
      title: truncatedTitle,
      ...(row.description ? { description: String(row.description).slice(0, 72) } : {}),
    };
  });

  const body = payload.body.slice(0, 1024);
  const buttonText = payload.buttonText.slice(0, 20);
  const sectionTitle = (payload.sectionTitle || "Options").slice(0, 24);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(`https://graph.facebook.com/v22.0/${phoneId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "interactive",
          interactive: {
            type: "list",
            body: { text: body },
            action: {
              button: buttonText,
              sections: [
                {
                  title: sectionTitle,
                  rows,
                },
              ],
            },
          },
        }),
      });

      const data = (await response.json()) as {
        error?: { code?: number; message?: string };
        messages?: Array<{ id?: string }>;
      };

      if (!response.ok) {
        const errorMessage = data.error?.message || `WhatsApp interactive send failed with status ${response.status}`;
        const error = new WhatsAppRejectedError(errorMessage);
        if (attempt < 3 && isRetriableStatus(response.status)) {
          lastError = error;
          await sleep(attempt * 400);
          continue;
        }
        throw error;
      }

      const sentId = data.messages?.[0]?.id ?? null;
      recordSentMessageId(sentId);

      return {
        messageId: sentId,
        raw: data,
      };
    } catch (error) {
      if (error instanceof WhatsAppRejectedError || error instanceof WhatsAppSendUncertainError) throw error;
      lastError = error instanceof Error ? error : new Error("Unknown WhatsApp interactive send failure");
      if (attempt < 3) {
        await sleep(attempt * 400);
        continue;
      }
    }
  }

  throw lastError ?? new Error("WhatsApp interactive send failed.");
}

export async function sendWhatsAppReplyButtons(
  to: string,
  payload: WhatsAppReplyButtonPayload,
  phoneNumberId?: string,
  customAccessToken?: string,
): Promise<WhatsAppSendResult> {
  if (process.env.MOCK_WHATSAPP === "true" && process.env.NODE_ENV !== "production") {
    console.log(`[MOCK WHATSAPP] Sending reply buttons to ${to}:`, payload);
    return {
      messageId: `wamid.mockBtn${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      raw: { mock: true },
    };
  }

  if (getWhatsAppTransport()?.provider === "evolution") {
    if (!payload.buttons?.length || payload.buttons.length > 3) throw new Error("Reply buttons require 1-3 buttons.");
    if (!(await evolutionNativeInteractiveEnabled())) {
      const text = [payload.body, payload.buttons.map((button, i) => `${i + 1}. ${button.title}`).join("\n"), "Reply with an option number or name."].join("\n\n");
      return { ...await sendEvolution(to, "sendText", { text }), deliveryFormat: "text_options", renderedText: text };
    }
    return sendEvolution(to, "sendButtons", {
      title: (payload.headerText || "Choose an option").slice(0, 60), description: payload.body.slice(0, 1024),
      footer: (payload.footerText || "").slice(0, 60),
      buttons: payload.buttons.map(button => ({ type: "reply", id: String(button.id).slice(0, 256), displayText: button.title.slice(0, 20) })),
    });
  }

  const { phoneId, token } = await resolveCredentials(phoneNumberId, customAccessToken);

  if (!payload.buttons || payload.buttons.length === 0 || payload.buttons.length > 3) {
    throw new Error("Reply buttons require 1-3 buttons.");
  }

  const buttons = payload.buttons.map((btn) => ({
    type: "reply" as const,
    reply: {
      id: String(btn.id).slice(0, 256),
      title: String(btn.title).slice(0, 20),
    },
  }));

  const body = payload.body.slice(0, 1024);
  const headerText = payload.headerText?.trim().slice(0, 60);
  const footerText = payload.footerText?.trim().slice(0, 60);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(`https://graph.facebook.com/v22.0/${phoneId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "interactive",
          interactive: {
            type: "button",
            ...(headerText ? { header: { type: "text", text: headerText } } : {}),
            body: { text: body },
            ...(footerText ? { footer: { text: footerText } } : {}),
            action: {
              buttons,
            },
          },
        }),
      });

      const data = (await response.json()) as {
        error?: { code?: number; message?: string };
        messages?: Array<{ id?: string }>;
      };

      if (!response.ok) {
        const errorMessage = data.error?.message || `WhatsApp button send failed with status ${response.status}`;
        const error = new WhatsAppRejectedError(errorMessage);
        if (attempt < 3 && isRetriableStatus(response.status)) {
          lastError = error;
          await sleep(attempt * 400);
          continue;
        }
        throw error;
      }

      return {
        messageId: data.messages?.[0]?.id ?? null,
        raw: data,
      };
    } catch (error) {
      if (error instanceof WhatsAppRejectedError || error instanceof WhatsAppSendUncertainError) throw error;
      lastError = error instanceof Error ? error : new Error("Unknown WhatsApp button send failure");
      if (attempt < 3) {
        await sleep(attempt * 400);
        continue;
      }
    }
  }

  throw lastError ?? new Error("WhatsApp button send failed.");
}

export async function notifyCustomer(phone: string, status: string, conversationId?: string) {
  const template = STATUS_MESSAGES[status];
  if (!template) return;

  if (!conversationId) throw new Error("Conversation is required for a tenant notification");
  return withConversationWhatsApp(conversationId, async () => {
  const profile = await getRestaurantProfile(getWhatsAppTransport()!.restaurantId);
  const message = template
    .replace("{restaurant}", profile.app_name || "us")
    .replace("{support_phone}", profile.support_phone || profile.delivery_phone || "our support line");

  await sendWhatsAppMessage(phone, message);

  if (conversationId) {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    const { error } = await supabaseAdmin.from("messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: message,
    });

    if (error) {
      console.error("[notifyCustomer] Failed to persist status message:", error);
    }
  }
  });
}
