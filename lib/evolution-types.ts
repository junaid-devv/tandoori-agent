/** Fields consumed from Evolution v2/Baileys. Unused gateway fields stay private. */
export type EvolutionInstance = {
  name?: string;
  ownerJid?: string;
  profileName?: string;
  instance?: { instanceName?: string; owner?: string; profileName?: string; state?: string };
};

export type EvolutionResponse = {
  pairingCode?: string;
  base64?: string;
  key?: { id?: string };
  instance?: { state?: string };
};

type MessageContent = {
  conversation?: string;
  extendedTextMessage?: { text?: string };
  ephemeralMessage?: { message?: MessageContent };
  viewOnceMessage?: { message?: MessageContent };
  viewOnceMessageV2?: { message?: MessageContent };
  documentWithCaptionMessage?: { message?: MessageContent };
  buttonsResponseMessage?: ButtonReply;
  templateButtonReplyMessage?: ButtonReply;
  listResponseMessage?: { singleSelectReply?: { selectedRowId?: string }; title?: string; description?: string };
  interactiveResponseMessage?: { nativeFlowResponseMessage?: { paramsJson?: string } };
  audioMessage?: { mimetype?: string; ptt?: boolean };
  imageMessage?: { caption?: string; mimetype?: string };
  locationMessage?: Location;
  liveLocationMessage?: Location;
};
type ButtonReply = { selectedButtonId?: string; selectedId?: string; selectedDisplayText?: string };
type Location = { name?: string; address?: string; degreesLatitude?: number; degreesLongitude?: number };
export type EvolutionEventData = {
  key?: { id?: string; remoteJid?: string; remoteJidAlt?: string; fromMe?: boolean };
  keyId?: string;
  remoteJidAlt?: string;
  messageTimestamp?: number | string;
  pushName?: string;
  message?: MessageContent;
  state?: string;
  status?: string | number;
  update?: { status?: string | number };
};
export type EvolutionEnvelope = {
  event?: string;
  instance?: string;
  data?: EvolutionEventData | EvolutionEventData[];
};
