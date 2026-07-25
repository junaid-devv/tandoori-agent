import {
  deleteUnsentOutboundMessage,
  OutboundMessageError,
  sendAndPersistOutboundFlowMessage,
  sendAndPersistOutboundInteractiveMessage,
  sendAndPersistOutboundReplyButtonMessage,
  sendAndPersistOutboundMessage,
} from "./messages";
import type { WhatsAppInteractiveFlowPayload, WhatsAppInteractiveListPayload, WhatsAppReplyButtonPayload } from "./whatsapp";

export async function sendAndPersistAssistantMessage({
  conversationId,
  phone,
  content,
  interactiveList,
  replyButtons,
  flowMessage,
}: {
  conversationId: string;
  phone: string;
  content: string;
  interactiveList?: WhatsAppInteractiveListPayload | null;
  replyButtons?: WhatsAppReplyButtonPayload | null;
  flowMessage?: WhatsAppInteractiveFlowPayload | null;
}) {
  if (flowMessage) {
    const flowVisibleBody = flowMessage.body?.trim();
    const flowPersistedContent = flowVisibleBody && flowVisibleBody.length > 0 ? flowVisibleBody : content;
    try {
      await sendAndPersistOutboundFlowMessage({
        conversationId,
        phone,
        content: flowPersistedContent,
        senderKind: "ai",
        flow: flowMessage,
      });
      return;
    } catch (error) {
      if (error instanceof OutboundMessageError && !error.messageSent) {
        await deleteUnsentOutboundMessage(error.persistedMessageId);
      } else {
        throw error;
      }
    }
  }

  if (replyButtons && replyButtons.buttons.length > 0) {
    const buttonPayload: WhatsAppReplyButtonPayload = {
      ...replyButtons,
      body: buildInteractiveVisibleBody(content, replyButtons.body),
    };
    try {
      await sendAndPersistOutboundReplyButtonMessage({
        conversationId,
        phone,
        content,
        senderKind: "ai",
        replyButtons: buttonPayload,
      });
      return;
    } catch (error) {
      if (error instanceof OutboundMessageError && !error.messageSent) {
        await deleteUnsentOutboundMessage(error.persistedMessageId);
        await sendAndPersistOutboundMessage({
          conversationId,
          phone,
          content: `${content}\n\n${buildReplyButtonFallbackText(buttonPayload)}`,
          senderKind: "ai",
        });
        return;
      }

      throw error;
    }
  }

  if (interactiveList && interactiveList.rows.length > 0) {
    const interactivePayload: WhatsAppInteractiveListPayload = {
      ...interactiveList,
      body: buildInteractiveVisibleBody(content, interactiveList.body),
    };
    try {
      await sendAndPersistOutboundInteractiveMessage({
        conversationId,
        phone,
        content,
        senderKind: "ai",
        interactive: interactivePayload,
      });
      return;
    } catch (error) {
      if (error instanceof OutboundMessageError && !error.messageSent) {
        await deleteUnsentOutboundMessage(error.persistedMessageId);
        await sendAndPersistOutboundMessage({
          conversationId,
          phone,
          content: `${content}\n\n${buildInteractiveFallbackText(interactivePayload)}`,
          senderKind: "ai",
        });
        return;
      }

      throw error;
    }
  }

  await sendAndPersistOutboundMessage({
    conversationId,
    phone,
    content,
    senderKind: "ai",
  });
}

function buildInteractiveVisibleBody(content: string, interactiveBody: string): string {
  const contentText = content.trim();
  const bodyText = interactiveBody.trim();
  if (!contentText) return bodyText;
  if (!bodyText) return contentText;

  const normalizedContent = normalizeForDedup(contentText);
  const normalizedBody = normalizeForDedup(bodyText);
  if (normalizedContent === normalizedBody || normalizedContent.includes(normalizedBody)) {
    return contentText;
  }

  return `${contentText}\n\n${bodyText}`;
}

function normalizeForDedup(value: string): string {
  return value
    .toLowerCase()
    .replace(/[*_`~]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildInteractiveFallbackText(payload: {
  body: string;
  rows: Array<{ title: string; description?: string }>;
}) {
  const options = payload.rows
    .slice(0, 10)
    .map((row, index) => `${index + 1}. ${row.title}${row.description ? ` - ${row.description}` : ""}`)
    .join("\n");

  return [payload.body, options].filter(Boolean).join("\n");
}

function buildReplyButtonFallbackText(payload: WhatsAppReplyButtonPayload) {
  const options = payload.buttons
    .map((btn, index) => `${index + 1}. ${btn.title}`)
    .join("\n");

  return [payload.body, options].filter(Boolean).join("\n");
}

