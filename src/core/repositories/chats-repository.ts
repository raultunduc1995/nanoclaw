import type { ChatsLocalResource, ChatRow } from '../db/index.js';

// --- Types and interfaces ---

export interface ChatInfo {
  jid: string;
  name: string;
  lastMessageTime: string;
  channel: string;
  isGroup: boolean;
}

export interface AvailableGroup {
  jid: string;
  name: string;
  lastActivity: string;
  isRegistered: boolean;
}

// --- Repository interface and implementation ---

export interface ChatsRepository {
  saveChat: (chatJid: string, metadata: { timestamp: string; name: string; channel: string; isGroup: boolean }) => void;
  updateChatName: (chatInfo: ChatInfo) => void;
  getAllChats: () => ChatInfo[];
  getGroupChats: () => ChatInfo[];
}

export const createChatsRepository = (resource: ChatsLocalResource): ChatsRepository => {
  return {
    saveChat: (chatJid, metadata) => {
      resource.upsert(chatJid, { timestamp: metadata.timestamp, name: metadata.name, channel: metadata.channel, isGroup: metadata.isGroup });
    },

    updateChatName: (chatInfo) => {
      resource.updateName(chatInfo.jid, chatInfo.name);
    },

    getAllChats: () => {
      return resource.getAll().map(toChatInfo);
    },

    getGroupChats: () =>
      resource
        .getAll()
        .filter((chat) => chat.is_group === 1)
        .map(toChatInfo),
  };
};

// --- Conversion function from ChatRow to ChatInfo ---

const toChatInfo = (row: ChatRow): ChatInfo => ({
  jid: row.jid,
  name: row.name,
  lastMessageTime: row.last_message_time,
  channel: row.channel,
  isGroup: row.is_group === 1,
});
