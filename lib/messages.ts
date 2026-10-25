import { withConversationWhatsApp } from "./whatsapp-context";
import { supabaseAdmin } from "./supabase-admin";
import {
  WhatsAppSendUncertainError,
  sendWhatsAppImage,
  sendWhatsAppInteractiveList,
  sendWhatsAppMessage,
  sendWhatsAppReplyButtons,
  type WhatsAppInteractiveListPayload,
  type WhatsAppReplyButtonPayload,
  type WhatsAppSendResult,
} from "./whatsapp";

export type MessageSenderKind = "user" | "ai" | "human" | "system";
export type MessageDeliveryStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export class OutboundMessageError extends Error {
  readonly messageSent: boolean;
  readonly persistedMessageId: string | null;

  constructor(
    message: string,
    messageSent: boolean,
    persistedMessageId: string | null = null,
  ) {
    super(message);
    this.name = "OutboundMessageError";
    this.messageSent = messageSent;
    this.persistedMessageId = persistedMessageId;
  }
}

type OutboundMessageParams = {
  conversationId: string;
  phone: string;
  content: string;
  senderKind: Exclude<MessageSenderKind, "user">;
  phoneNumberId?: string;
};

type OutboundInteractiveMessageParams = OutboundMessageParams & {
  interactive: WhatsAppInteractiveListPayload;
};

type OutboundReplyButtonMessageParams = OutboundMessageParams & {
  replyButtons: WhatsAppReplyButtonPayload;
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown outbound message error";
}

async function persistAcceptedOutbound(messageId: string, result: WhatsAppSendResult) {
  const { error } = await supabaseAdmin.rpc("accept_outbound_message", {
    p_message_id: messageId,
    p_whatsapp_id: result.messageId,
    p_metadata: result.deliveryFormat ? { deliveryFormat: result.deliveryFormat } : null,
    p_content: result.renderedText || null,
  });
  if (error) throw new OutboundMessageError("Message accepted but delivery record could not be saved", true, messageId);
}

export async function persistSystemMessage(conversationId: string, content: string) {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      sender_kind: "system",
      content,
    })
    .select("id")
    .single();

  if (error) throw error;
  return data;
}

export async function deleteUnsentOutboundMessage(messageId: string | null | undefined) {
  if (!messageId) return;

  const { error } = await supabaseAdmin
    .from("messages")
    .delete()
    .eq("id", messageId)
    .is("whatsapp_msg_id", null)
    .eq("delivery_status", "failed");

  if (error) {
    console.error("[messages] Failed to delete unsent failed outbound message:", error);
  }
}

export async function sendAndPersistOutboundMessage({
  conversationId,
  phone,
  content,
  senderKind,
  phoneNumberId,
}: OutboundMessageParams) {
  const chunks = splitWhatsAppText(content);
  let firstResult: { id: string; whatsappMessageId: string | null } | null = null;
  let sentAtLeastOneChunk = false;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunkContent = formatChunkForDelivery(chunks[index], index, chunks.length);
    try {
      const result = await sendAndPersistSingleOutboundMessage({
        conversationId,
        phone,
        content: chunkContent,
        senderKind,
        phoneNumberId,
      });
      firstResult ??= result;
      sentAtLeastOneChunk = true;
    } catch (error) {
      if (sentAtLeastOneChunk && firstResult) {
        console.error("[messages] Failed to send later WhatsApp text chunk:", error);
        throw new OutboundMessageError("Only part of this reply was sent: " + toErrorMessage(error), true, firstResult.id);
      }
      throw error;
    }
  }

  if (!firstResult) {
    throw new Error("Cannot send an empty WhatsApp message.");
  }

  return firstResult;
}

async function sendAndPersistSingleOutboundMessage({
  conversationId,
  phone,
  content,
  senderKind,
  phoneNumberId,
}: OutboundMessageParams) {
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      sender_kind: senderKind,
      content,
      delivery_status: "pending",
      delivery_status_updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw insertError ?? new Error("Failed to persist outbound message before send.");
  }

  try {
    const result = await withConversationWhatsApp(conversationId, () => sendWhatsAppMessage(phone, content, phoneNumberId));
    await persistAcceptedOutbound(inserted.id, result);

    return {
      id: inserted.id,
      whatsappMessageId: result.messageId,
    };
  } catch (error) {
    const message = toErrorMessage(error);

    if (!(error instanceof OutboundMessageError && error.messageSent)) await supabaseAdmin
      .from("messages")
      .update({
        delivery_status: error instanceof WhatsAppSendUncertainError ? "pending" : "failed",
        delivery_error: message,
        delivery_status_updated_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);

    if (error instanceof OutboundMessageError) {
      throw error;
    }

    throw new OutboundMessageError(message, error instanceof WhatsAppSendUncertainError, inserted.id);
  }
}

export function splitWhatsAppText(content: string, maxLength = 3600): string[] {
  const normalized = content.trim();
  if (!normalized) return [];
  if (normalized.length <= maxLength) return [normalized];

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > maxLength) {
    const slice = remaining.slice(0, maxLength);
    const splitAt = Math.max(
      slice.lastIndexOf("\n\n"),
      slice.lastIndexOf("\n"),
      slice.lastIndexOf(". "),
      slice.lastIndexOf(" "),
    );
    const cut = splitAt > maxLength * 0.55 ? splitAt : maxLength;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function formatChunkForDelivery(content: string, index: number, total: number): string {
  if (total <= 1) return content;
  return `(${index + 1}/${total})\n${content}`;
}

export async function sendAndPersistOutboundInteractiveMessage({
  conversationId,
  phone,
  content,
  senderKind,
  interactive,
  phoneNumberId,
}: OutboundInteractiveMessageParams) {
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      sender_kind: senderKind,
      content,
      metadata: {
        listSelector: {
          title: interactive.buttonText || interactive.body || "Select Option",
          buttonText: interactive.buttonText,
          rows: interactive.rows.map((r) => ({ id: r.id, title: r.title, description: r.description })),
        },
      },
      delivery_status: "pending",
      delivery_status_updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw insertError ?? new Error("Failed to persist outbound interactive message before send.");
  }

  try {
    const result = await withConversationWhatsApp(conversationId, () => sendWhatsAppInteractiveList(phone, interactive, phoneNumberId));
    await persistAcceptedOutbound(inserted.id, result);

    return {
      id: inserted.id,
      whatsappMessageId: result.messageId,
    };
  } catch (error) {
    const message = toErrorMessage(error);

    if (!(error instanceof OutboundMessageError && error.messageSent)) await supabaseAdmin
      .from("messages")
      .update({
        delivery_status: error instanceof WhatsAppSendUncertainError ? "pending" : "failed",
        delivery_error: message,
        delivery_status_updated_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);

    if (error instanceof OutboundMessageError) {
      throw error;
    }

    throw new OutboundMessageError(message, error instanceof WhatsAppSendUncertainError, inserted.id);
  }
}

export async function sendAndPersistOutboundReplyButtonMessage({
  conversationId,
  phone,
  content,
  senderKind,
  replyButtons,
  phoneNumberId,
}: OutboundReplyButtonMessageParams) {
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      sender_kind: senderKind,
      content,
      metadata: {
        replyButtons: replyButtons.buttons.map((b) => ({ id: b.id, title: b.title })),
      },
      delivery_status: "pending",
      delivery_status_updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw insertError ?? new Error("Failed to persist outbound reply button message before send.");
  }

  try {
    const result = await withConversationWhatsApp(conversationId, () => sendWhatsAppReplyButtons(phone, replyButtons, phoneNumberId));
    await persistAcceptedOutbound(inserted.id, result);

    return {
      id: inserted.id,
      whatsappMessageId: result.messageId,
    };
  } catch (error) {
    const message = toErrorMessage(error);

    if (!(error instanceof OutboundMessageError && error.messageSent)) await supabaseAdmin
      .from("messages")
      .update({
        delivery_status: error instanceof WhatsAppSendUncertainError ? "pending" : "failed",
        delivery_error: message,
        delivery_status_updated_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);

    if (error instanceof OutboundMessageError) {
      throw error;
    }

    throw new OutboundMessageError(message, error instanceof WhatsAppSendUncertainError, inserted.id);
  }
}

export async function sendAndPersistOutboundImageMessage({
  conversationId,
  phone,
  imageUrl,
  caption,
  senderKind,
  phoneNumberId,
}: {
  conversationId: string;
  phone: string;
  imageUrl: string;
  caption?: string;
  senderKind: Exclude<MessageSenderKind, "user">;
  phoneNumberId?: string;
}) {
  const content = caption ? `[image: ${imageUrl}]\n${caption}` : `[image: ${imageUrl}]`;
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      role: "assistant",
      sender_kind: senderKind,
      content,
      delivery_status: "pending",
      delivery_status_updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw insertError ?? new Error("Failed to persist outbound image message before send.");
  }

  try {
    const result = await withConversationWhatsApp(conversationId, () => sendWhatsAppImage(phone, imageUrl, caption, phoneNumberId));
    await persistAcceptedOutbound(inserted.id, result);

    return {
      id: inserted.id,
      whatsappMessageId: result.messageId,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    if (!(error instanceof OutboundMessageError && error.messageSent)) await supabaseAdmin
      .from("messages")
      .update({
        delivery_status: error instanceof WhatsAppSendUncertainError ? "pending" : "failed",
        delivery_error: message,
        delivery_status_updated_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);
    if (error instanceof OutboundMessageError) throw error;
    throw new OutboundMessageError(message, error instanceof WhatsAppSendUncertainError, inserted.id);
  }
}
