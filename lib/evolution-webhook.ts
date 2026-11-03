import type { IncomingWhatsAppMessage } from "./whatsapp-inbound";
import type { EvolutionEventData } from "./evolution-types";
import { locationPinUrl } from "./location-pin";

export function evolutionMessageId(instance: string, id: string) { return `evolution:${instance}:${id}`; }

/** Convert Baileys replies into the same stable IDs used by the Meta order flow. */
export function normalizeEvolutionMessage(instance: string, data: EvolutionEventData): IncomingWhatsAppMessage | null {
  const key = data.key || {};
  const jid = String(key.remoteJid || "");
  if (!key.id || !jid || /@g\.us$|broadcast|@newsletter$/.test(jid)) return null;
  const directJid = [key.remoteJidAlt, data.remoteJidAlt, jid].find(value => typeof value === "string" && value.endsWith("@s.whatsapp.net"));
  // Retain unresolved LIDs as opaque addresses; never mistake an LID for a phone number.
  const from = directJid ? directJid.split("@")[0].split(":")[0] : jid.endsWith("@lid") ? jid : null;
  if (!from) return null;
  let content = data.message || {};
  for (let i = 0; i < 5; i++) {
    const wrapped = content.ephemeralMessage?.message || content.viewOnceMessage?.message || content.viewOnceMessageV2?.message || content.documentWithCaptionMessage?.message;
    if (!wrapped) break;
    content = wrapped;
  }
  const result: IncomingWhatsAppMessage = {
    id: evolutionMessageId(instance, String(key.id)), from,
    timestamp: String(data.messageTimestamp || Math.floor(Date.now() / 1000)), type: "text",
  };
  const button = content.buttonsResponseMessage || content.templateButtonReplyMessage;
  const list = content.listResponseMessage;
  if (button) {
    const id = button.selectedButtonId || button.selectedId;
    if (!id) return null;
    result.type = "interactive";
    result.interactive = { type: "button_reply", button_reply: { id, title: button.selectedDisplayText } };
  } else if (list) {
    const id = list.singleSelectReply?.selectedRowId;
    if (!id) return null;
    result.type = "interactive";
    result.interactive = { type: "list_reply", list_reply: { id, title: list.title, description: list.description } };
  } else if (content.interactiveResponseMessage?.nativeFlowResponseMessage) {
    try {
      const params = JSON.parse(content.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson || "{}");
      const id = params.id || params.selectedId || params.selectedRowId || params.rowId;
      if (typeof id !== "string" || !id) return null;
      result.type = "interactive";
      result.interactive = { type: "button_reply", button_reply: { id, title: params.title || params.display_text || id } };
    } catch { return null; }
  } else if (content.audioMessage) {
    result.type = "audio";
    result.audio = { id: String(key.id), mime_type: content.audioMessage.mimetype || "audio/ogg", voice: Boolean(content.audioMessage.ptt) };
  } else if (content.imageMessage) {
    result.type = "image";
    result.image = { id: String(key.id), caption: content.imageMessage.caption, mime_type: content.imageMessage.mimetype };
  } else if (content.locationMessage || content.liveLocationMessage) {
    result.type = "text";
    const location = content.locationMessage || content.liveLocationMessage;
    if (!location) return null;
    const pin = locationPinUrl(location.degreesLatitude, location.degreesLongitude);
    if (!pin) return null;
    result.text = { body: [location.name, location.address, pin].filter(Boolean).join("\n") };
  } else {
    const text = content.conversation || content.extendedTextMessage?.text;
    if (typeof text !== "string" || !text.trim()) return null;
    result.text = { body: text.trim() };
  }
  return result;
}

export function evolutionDeliveryStatus(value: unknown): "sent" | "delivered" | "read" | "failed" | null {
  const normalized = String(value).toUpperCase();
  if (["SERVER_ACK", "SENT", "2"].includes(normalized)) return "sent";
  if (["DELIVERY_ACK", "DELIVERED", "3"].includes(normalized)) return "delivered";
  if (["READ", "PLAYED", "4", "5"].includes(normalized)) return "read";
  if (["ERROR", "FAILED", "0"].includes(normalized)) return "failed";
  return null;
}
