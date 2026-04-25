import { ImageMimeType } from '../core/common/index.js';
import { RegisteredGroup } from '../core/repositories/index.js';

interface MessageBase {
  id: string;
  chatJid: string;
  sender: string;
  senderName: string;
  timestamp: string;
  replyToMessageId?: string;
  replyToMessageContent?: string;
  replyToSenderName?: string;
}

interface TextMessage extends MessageBase {
  kind: 'text';
  content: string;
}

interface ImageMessage extends MessageBase {
  kind: 'image';
  content: string;
  imageBase64?: string;
  imageMimeType: ImageMimeType;
}

export type InboundMessage = TextMessage | ImageMessage;

export interface ChannelOpts {
  type: 'telegram';
  /**
   * Callback type that channels use to deliver inbound messages
   *
   * @param message
   */
  onInboundMessage: (message: InboundMessage, group: RegisteredGroup) => void;

  getRegisteredGroups: () => Record<string, RegisteredGroup>;
  registerNewGroup: (jid: string, group: RegisteredGroup) => void;
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
