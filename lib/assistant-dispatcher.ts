import {
  OutboundMessageError,
  sendAndPersistOutboundFlowMessage,
  sendAndPersistOutboundInteractiveMessage,
  sendAndPersistOutboundMessage,
} from "./messages";
import type { WhatsAppInteractiveFlowPayload, WhatsAppInteractiveListPayload } from "./whatsapp";

export async function sendAndPersistAssistantMessage({
  conversationId,
  phone,
  content,
  interactiveList,
  flowMessage,
}: {
  conversationId: string;
  phone: string;
  content: string;
  interactiveList?: WhatsAppInteractiveListPayload | null;
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
      if (!(error instanceof OutboundMessageError && !error.messageSent)) {
        throw error;
      }
    }
  }

  if (interactiveList) {
    const interactiveVisibleBody = buildInteractiveVisibleBody(content, interactiveList.body);
    try {
      await sendAndPersistOutboundInteractiveMessage({
        conversationId,
        phone,
        content: interactiveVisibleBody,
        senderKind: "ai",
        interactive: interactiveList,
      });
      return;
    } catch (error) {
      if (!(error instanceof OutboundMessageError && !error.messageSent)) {
        throw error;
      }
    }
  }

  await sendAndPersistOutboundMessage({
    conversationId,
    phone,
    content: interactiveList?.body
      ? buildInteractiveVisibleBody(content, interactiveList.body)
      : content,
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
