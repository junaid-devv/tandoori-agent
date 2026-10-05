import { getRestaurantProfile } from "./restaurant-profile";
import { supabaseAdmin } from "./supabase-admin";

type WhatsAppSendResult = {
  messageId: string | null;
  raw: unknown;
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

export function isWaAkgProvider(provider?: string): boolean {
  if (provider) {
    const p = provider.trim().toLowerCase();
    return p === "wa_akg" || p === "wa-akg";
  }
  const envProv = (process.env.WHATSAPP_PROVIDER || "").trim().toLowerCase();
  if (envProv === "wa_akg" || envProv === "wa-akg") return true;
  if (envProv === "meta") return false;
  if (process.env.WA_AKG_BASE_URL && !process.env.WHATSAPP_PHONE_NUMBER_ID) return true;
  return false;
}

export async function resolveShouldUseWaAkg(provider?: string): Promise<boolean> {
  if (isWaAkgProvider(provider)) return true;
  if (provider === "meta" || process.env.WHATSAPP_PROVIDER === "meta") return false;

  try {
    const profile = await getRestaurantProfile();
    if (profile.whatsapp_provider === "wa_akg") return true;
    if (profile.whatsapp_provider === "meta") return false;
  } catch {
    // ignore
  }

  if (process.env.WA_AKG_BASE_URL && !process.env.WHATSAPP_PHONE_NUMBER_ID) {
    return true;
  }

  return false;
}

function normalizeWaJid(to: string): string {
  if (to.includes("@")) return to;
  const digits = to.replace(/[^0-9]/g, "");
  return `${digits}@s.whatsapp.net`;
}

export async function sendWaAkgMessage(to: string, body: string, customSessionId?: string): Promise<WhatsAppSendResult> {
  const baseUrl = (process.env.WA_AKG_BASE_URL || "http://localhost:3001").replace(/\/+$/, "");
  const apiKey = (process.env.WA_AKG_API_KEY || "").trim();
  const sessionId = (customSessionId || process.env.WA_AKG_SESSION_ID || "default").trim();
  const jid = normalizeWaJid(to);

  const response = await fetchWithTimeout(
    `${baseUrl}/api/messages/${encodeURIComponent(sessionId)}/${encodeURIComponent(jid)}/send`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
      },
      body: JSON.stringify({
        message: {
          text: body,
        },
      }),
    },
  );

  const data = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `WA-AKG send failed with status ${response.status}`);
  }

  const messageId = data?.data?.key?.id || data?.id || `wa-akg-${Date.now()}`;
  recordSentMessageId(messageId);

  return {
    messageId,
    raw: data,
  };
}

export async function sendWaAkgImage(to: string, imageUrl: string, caption?: string, customSessionId?: string): Promise<WhatsAppSendResult> {
  const baseUrl = (process.env.WA_AKG_BASE_URL || "http://localhost:3001").replace(/\/+$/, "");
  const apiKey = (process.env.WA_AKG_API_KEY || "").trim();
  const sessionId = (customSessionId || process.env.WA_AKG_SESSION_ID || "default").trim();
  const jid = normalizeWaJid(to);

  const response = await fetchWithTimeout(
    `${baseUrl}/api/messages/${encodeURIComponent(sessionId)}/${encodeURIComponent(jid)}/send`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
      },
      body: JSON.stringify({
        message: {
          image: { url: imageUrl },
          ...(caption ? { caption } : {}),
        },
      }),
    },
  );

  const data = (await response.json().catch(() => ({}))) as Record<string, any>;
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `WA-AKG image send failed with status ${response.status}`);
  }

  const messageId = data?.data?.key?.id || data?.id || `wa-akg-${Date.now()}`;
  recordSentMessageId(messageId);

  return {
    messageId,
    raw: data,
  };
}

async function resolveCredentials(
  phoneNumberId?: string,
  customToken?: string
): Promise<{ phoneId: string; token: string }> {
  let phoneId = phoneNumberId;
  let token = customToken;

  if (!phoneId || !token) {
    try {
      let query = supabaseAdmin
        .from("whatsapp_configs")
        .select("phone_number_id, access_token")
        .eq("is_active", true);

      if (phoneId) {
        query = query.eq("phone_number_id", phoneId);
      } else {
        query = query.order("updated_at", { ascending: false });
      }

      const { data: config } = await query.limit(1).maybeSingle();

      if (!phoneId && config?.phone_number_id) {
        phoneId = config.phone_number_id;
      }
      if (!token && config?.access_token) {
        token = config.access_token;
      }
    } catch (e) {
      console.warn("[whatsapp] Error resolving dynamic credentials:", e);
    }
  }

  phoneId = phoneId || process.env.WHATSAPP_PHONE_NUMBER_ID || "";
  token = token || process.env.WHATSAPP_ACCESS_TOKEN || "";

  if (!phoneId || !token) {
    throw new Error(
      "WhatsApp credentials (phone_number_id or access_token) are missing. Please connect WhatsApp in your dashboard."
    );
  }

  return { phoneId, token };
}

export async function sendWhatsAppMessage(
  to: string,
  body: string,
  phoneNumberId?: string,
  customAccessToken?: string
): Promise<WhatsAppSendResult> {
  if (process.env.MOCK_WHATSAPP === "true") {
    console.log(`[MOCK WHATSAPP] Sending text message to ${to}:`, body);
    return {
      messageId: `wamid.mockText${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      raw: { mock: true },
    };
  }

  if (await resolveShouldUseWaAkg()) {
    return sendWaAkgMessage(to, body);
  }

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
        // Fallback for Meta code 131047 (Customer 24h window closed): send approved template
        if (data.error?.code === 131047) {
          console.log("[whatsapp] Customer 24h window is closed. Falling back to approved greeting template...");
          const templateNames = ["restaurant_greeting", "hello_world"];
          for (const templateName of templateNames) {
            try {
              const templateRes = await fetchWithTimeout(`https://graph.facebook.com/v22.0/${phoneId}/messages`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  messaging_product: "whatsapp",
                  to,
                  type: "template",
                  template: {
                    name: templateName,
                    language: { code: "en_US" },
                  },
                }),
              });
              const templateData = (await templateRes.json()) as { messages?: Array<{ id?: string }>; error?: { message?: string } };
              if (templateRes.ok && templateData.messages?.[0]?.id) {
                const sentId = templateData.messages[0].id;
                recordSentMessageId(sentId);
                return {
                  messageId: sentId,
                  raw: templateData,
                };
              }
              console.warn(`[whatsapp] Template ${templateName} failed:`, templateData.error?.message);
            } catch (err) {
              console.warn(`[whatsapp] Template ${templateName} error:`, err);
            }
          }
        }

        const errorMessage = data.error?.message || `WhatsApp send failed with status ${response.status}`;
        const error = new Error(errorMessage);
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
  if (process.env.MOCK_WHATSAPP === "true") {
    console.log(`[MOCK WHATSAPP] Sending image to ${to}: ${imageUrl}${caption ? ` (caption: ${caption})` : ""}`);
    return {
      messageId: `wamid.mockImg${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      raw: { mock: true },
    };
  }

  if (await resolveShouldUseWaAkg()) {
    return sendWaAkgImage(to, imageUrl, caption);
  }

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
        const error = new Error(errorMessage);
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
  const { token } = await resolveCredentials();

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
  const { token } = await resolveCredentials();

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
  if (process.env.MOCK_WHATSAPP === "true") {
    console.log(`[MOCK WHATSAPP] Sending interactive list to ${to}:`, payload);
    return {
      messageId: `wamid.mockList${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      raw: { mock: true },
    };
  }

  if (await resolveShouldUseWaAkg()) {
    const listBody = payload.body.trim();
    const rows = payload.rows.slice(0, 8);

    const alreadyListsItems = rows.length > 0 && rows.some((r) => listBody.includes(r.title));
    if (alreadyListsItems) {
      return sendWaAkgMessage(to, `${listBody}\n\n_Reply with number or name_`);
    }

    const section = payload.sectionTitle ? `*${payload.sectionTitle.trim()}*:\n` : "";
    const formattedRows = rows
      .map((r, i) => `${i + 1}. *${r.title}*${r.description ? ` (${r.description.replace(/\s+/g, " ").trim()})` : ""}`)
      .join("\n");

    const fullText = listBody
      ? `${listBody}\n\n${section}${formattedRows}\n\n_Reply with number or name_`
      : `${section}${formattedRows}\n\n_Reply with number or name_`;

    return sendWaAkgMessage(to, fullText);
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
        const error = new Error(errorMessage);
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
  if (process.env.MOCK_WHATSAPP === "true") {
    console.log(`[MOCK WHATSAPP] Sending reply buttons to ${to}:`, payload);
    return {
      messageId: `wamid.mockBtn${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      raw: { mock: true },
    };
  }

  if (await resolveShouldUseWaAkg()) {
    const body = payload.body.trim();
    const count = payload.buttons.length;

    if (count === 1) {
      const btn = payload.buttons[0];
      const fullText = `${body}\n\n_Type *1* for ${btn.title}, ya direct apna order batayein._`;
      return sendWaAkgMessage(to, fullText);
    }

    if (count === 2) {
      const b1 = payload.buttons[0];
      const b2 = payload.buttons[1];
      const fullText = `${body}\n\n👉 *1* - ${b1.title}  |  *2* - ${b2.title}\n_(Reply *1* ya *2*)_`;
      return sendWaAkgMessage(to, fullText);
    }

    const btnLines = payload.buttons.map((b, i) => `*${i + 1}* - ${b.title}`).join("\n");
    const fullText = `${body}\n\n${btnLines}\n\n_Reply with number (1-${count})_`;
    return sendWaAkgMessage(to, fullText);
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
        const error = new Error(errorMessage);
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

  const profile = await getRestaurantProfile();
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
}
