import type { MessageRow, MessagesLocalResource } from '../db/index.js';

// --- Types and interfaces ---

export interface Message {
  id: string;
  chatJid: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
  isFromMe: boolean;
  isBotMessage: boolean;
  threadId?: string;
  replyToMessageId?: string;
  replyToMessageContent?: string;
  replyToSenderName?: string;
}

// --- Repository interface and implementation ---

export interface MessagesRepository {
  saveMessage(msg: Message): void;
  getNewMessages(jids: string[], lastTimestamp: string, botPrefix: string, limit?: number): { messages: Message[]; newTimestamp: string };
  getMessagesSince(chatJid: string, sinceTimestamp: string, botPrefix: string, limit?: number): Message[];
  getLastBotMessageTimestamp(chatJid: string, botPrefix: string): string | undefined;
}

export const createMessagesRepository = (resource: MessagesLocalResource): MessagesRepository => {
  return {
    saveMessage: (msg: Message) => resource.store(toMessageRow(msg)),

    getNewMessages: (jids: string[], lastTimestamp: string, botPrefix: string, limit?: number) => {
      if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

      const messages = resource.getNew(jids, lastTimestamp, botPrefix, limit);
      let newTimestamp = lastTimestamp;
      for (const msg of messages) {
        if (msg.timestamp > newTimestamp) newTimestamp = msg.timestamp;
      }

      return { messages: messages.map(toMessage), newTimestamp };
    },

    getMessagesSince: (chatJid: string, sinceTimestamp: string, botPrefix: string, limit?: number) => {
      const rows = resource.getSince(chatJid, sinceTimestamp, botPrefix, limit);
      return rows.map(toMessage);
    },

    getLastBotMessageTimestamp: (chatJid: string, botPrefix: string) => resource.getLastBotTimestamp(chatJid, botPrefix),
  };
};

// --- Mapping functions ---

const toMessage = (row: MessageRow): Message => ({
  id: row.id,
  chatJid: row.chat_jid,
  sender: row.sender,
  senderName: row.sender_name,
  content: row.content,
  timestamp: row.timestamp,
  isFromMe: row.is_from_me === 1,
  isBotMessage: row.is_bot_message === 1,
  replyToMessageId: row.reply_to_message_id ?? undefined,
  replyToMessageContent: row.reply_to_message_content ?? undefined,
  replyToSenderName: row.reply_to_sender_name ?? undefined,
});

const toMessageRow = (msg: Message): MessageRow => ({
  id: msg.id,
  chat_jid: msg.chatJid,
  sender: msg.sender,
  sender_name: msg.senderName,
  content: msg.content,
  timestamp: msg.timestamp,
  is_from_me: msg.isFromMe ? 1 : 0,
  is_bot_message: msg.isBotMessage ? 1 : 0,
  reply_to_message_id: msg.replyToMessageId ?? null,
  reply_to_message_content: msg.replyToMessageContent ?? null,
  reply_to_sender_name: msg.replyToSenderName ?? null,
});
