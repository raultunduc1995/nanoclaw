import { ImageMimeType, VideoMimeType } from "../core/common/index.js";
import { RegisteredGroup } from "../core/repositories/index.js";

interface MessageBase {
  id: string;
  chatJid: string;
  userName: string;
  prompt: string;
}

interface TextMessage extends MessageBase {
  kind: "text";
}

interface ImageMessage extends MessageBase {
  kind: "image";
  imageBase64: string;
  imageMimeType: ImageMimeType;
}

interface VideoMessage extends MessageBase {
  kind: "video";
  videoBase64: string;
  videoMimeType: VideoMimeType;
}

export type InboundMessage = TextMessage | ImageMessage | VideoMessage;

export interface ChannelOpts {
  type: "telegram";
  /**
   * Callback type that channels use to deliver inbound messages
   *
   * @param message
   */
  onInboundMessage: (message: InboundMessage, group: RegisteredGroup) => void;
  onCommand: (command: "compact", group: RegisteredGroup) => void;
  getRegisteredGroups: () => Record<string, RegisteredGroup>;
  registerNewGroup: (jid: string, group: Omit<RegisteredGroup, "jid">) => void;
}

export interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  // Optional: typing indicator. Channels that support it implement it.
  setTyping(jid: string): Promise<void>;
}
