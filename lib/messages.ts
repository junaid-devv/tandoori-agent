import { supabaseAdmin } from "./supabase-admin";
import {
  sendWhatsAppImage,
  sendWhatsAppInteractiveList,
  sendWhatsAppMessage,
  sendWhatsAppReplyButtons,
  type WhatsAppInteractiveListPayload,
  type WhatsAppReplyButtonPayload,
} from "./whatsapp";

export type MessageSenderKind = "user" | "ai" | "human" | "system";
export type MessageDeliveryStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export class OutboundMessageError extends Error {
  constructor(
    message: string,
    public readonly messageSent: boolean,
    public readonly persistedMessageId: string | null = null,
  ) {
    super(message);
    this.name = "OutboundMessageError";
  }
}

type OutboundMessageParams = {
  conversationId: string;
  phone: string;
  content: string;
  senderKind: Exclude<MessageSenderKind, "user">;
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
      });
      firstResult ??= result;
      sentAtLeastOneChunk = true;
    } catch (error) {
      if (sentAtLeastOneChunk && firstResult) {
        console.error("[messages] Failed to send later WhatsApp text chunk:", error);
        return firstResult;
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
    const result = await sendWhatsAppMessage(phone, content);
    const { error: updateError } = await supabaseAdmin
      .from("messages")
      .update({
        whatsapp_msg_id: result.messageId,
        delivery_status: "sent",
        delivery_error: null,
        delivery_status_updated_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);

    if (updateError) {
      throw new OutboundMessageError(updateError.message, true, inserted.id);
    }

    return {
      id: inserted.id,
      whatsappMessageId: result.messageId,
    };
  } catch (error) {
    const message = toErrorMessage(error);

    await supabaseAdmin
      .from("messages")
      .update({
        delivery_status: error instanceof OutboundMessageError && error.messageSent ? "sent" : "failed",
        delivery_error: error instanceof OutboundMessageError && error.messageSent ? message : message,
        delivery_status_updated_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);

    if (error instanceof OutboundMessageError) {
      throw error;
    }

    throw new OutboundMessageError(message, false, inserted.id);
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
    const result = await sendWhatsAppInteractiveList(phone, interactive);
    const { error: updateError } = await supabaseAdmin
      .from("messages")
      .update({
        whatsapp_msg_id: result.messageId,
        delivery_status: "sent",
        delivery_error: null,
        delivery_status_updated_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);

    if (updateError) {
      throw new OutboundMessageError(updateError.message, true, inserted.id);
    }

    return {
      id: inserted.id,
      whatsappMessageId: result.messageId,
    };
  } catch (error) {
    const message = toErrorMessage(error);

    await supabaseAdmin
      .from("messages")
      .update({
        delivery_status: error instanceof OutboundMessageError && error.messageSent ? "sent" : "failed",
        delivery_error: message,
        delivery_status_updated_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);

    if (error instanceof OutboundMessageError) {
      throw error;
    }

    throw new OutboundMessageError(message, false, inserted.id);
  }
}

export async function sendAndPersistOutboundReplyButtonMessage({
  conversationId,
  phone,
  content,
  senderKind,
  replyButtons,
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
    const result = await sendWhatsAppReplyButtons(phone, replyButtons);
    const { error: updateError } = await supabaseAdmin
      .from("messages")
      .update({
        whatsapp_msg_id: result.messageId,
        delivery_status: "sent",
        delivery_error: null,
        delivery_status_updated_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);

    if (updateError) {
      throw new OutboundMessageError(updateError.message, true, inserted.id);
    }

    return {
      id: inserted.id,
      whatsappMessageId: result.messageId,
    };
  } catch (error) {
    const message = toErrorMessage(error);

    await supabaseAdmin
      .from("messages")
      .update({
        delivery_status: error instanceof OutboundMessageError && error.messageSent ? "sent" : "failed",
        delivery_error: message,
        delivery_status_updated_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);

    if (error instanceof OutboundMessageError) {
      throw error;
    }

    throw new OutboundMessageError(message, false, inserted.id);
  }
}

export async function sendAndPersistOutboundImageMessage({
  conversationId,
  phone,
  imageUrl,
  caption,
  senderKind,
}: {
  conversationId: string;
  phone: string;
  imageUrl: string;
  caption?: string;
  senderKind: Exclude<MessageSenderKind, "user">;
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
    const result = await sendWhatsAppImage(phone, imageUrl, caption);
    await supabaseAdmin
      .from("messages")
      .update({
        whatsapp_msg_id: result.messageId,
        delivery_status: "sent",
        delivery_error: null,
        delivery_status_updated_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);

    return {
      id: inserted.id,
      whatsappMessageId: result.messageId,
    };
  } catch (error) {
    const message = toErrorMessage(error);
    await supabaseAdmin
      .from("messages")
      .update({
        delivery_status: "failed",
        delivery_error: message,
        delivery_status_updated_at: new Date().toISOString(),
      })
      .eq("id", inserted.id);
    throw error;
  }
}


