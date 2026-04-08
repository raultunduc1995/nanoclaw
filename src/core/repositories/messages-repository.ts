import type { MessageRow, MessagesLocalResource } from '../db/index.js';

// --- Types and interfaces ---

export interface Message {
  id: string;
  chatJid: string;
  sender: string;
  senderName: string;
  content: string;
  timestamp: string;
  replyToMessageId?: string;
  replyToMessageContent?: string;
  replyToSenderName?: string;
}

// --- Repository interface and implementation ---

export interface MessagesRepository {
  save(msg: Message): void;
  getNew(jids: string[], lastTimestamp: string, limit?: number): { messages: Message[]; newTimestamp: string };
  getSince(chatJid: string, sinceTimestamp: string, limit?: number): Message[];
}

export const createMessagesRepository = (resource: MessagesLocalResource): MessagesRepository => {
  return {
    save: (msg: Message) => resource.store(toMessageRow(msg)),

    getNew: (jids: string[], lastTimestamp: string, limit?: number) => {
      if (jids.length === 0) return { messages: [], newTimestamp: lastTimestamp };

      const messages = resource.getNew(jids, lastTimestamp, limit);
      let newTimestamp = lastTimestamp;
      for (const msg of messages) {
        if (msg.timestamp > newTimestamp) newTimestamp = msg.timestamp;
      }

      return { messages: messages.map(toMessage), newTimestamp };
    },

    getSince: (chatJid: string, sinceTimestamp: string, limit?: number) => {
      const rows = resource.getSince(chatJid, sinceTimestamp, limit);
      return rows.map(toMessage);
    },
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
  reply_to_message_id: msg.replyToMessageId ?? null,
  reply_to_message_content: msg.replyToMessageContent ?? null,
  reply_to_sender_name: msg.replyToSenderName ?? null,
});
