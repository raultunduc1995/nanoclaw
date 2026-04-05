import type { ChatsLocalResource, ChatRow } from '../db/index.js';
import type { GroupsRepository } from './groups-repository.js';

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
  storeMetadata: (chatJid: string, metadata: { timestamp: string; name?: string; channel?: string; isGroup?: boolean }) => void;
  update: (chatInfo: ChatInfo) => void;
  getAll: () => ChatInfo[];
  getAvailableGroups: () => AvailableGroup[];
}

export const createChatsRepository = (resource: ChatsLocalResource, groupsRepository: GroupsRepository): ChatsRepository => {
  return {
    storeMetadata: (chatJid, metadata) => {
      if (metadata.name) {
        resource.storeNamedMetadata(chatJid, { timestamp: metadata.timestamp, name: metadata.name, channel: metadata.channel, isGroup: metadata.isGroup });
      } else {
        resource.storeMetadata(chatJid, { timestamp: metadata.timestamp, channel: metadata.channel, isGroup: metadata.isGroup });
      }
    },

    update: (chatInfo) => {
      resource.updateName(chatInfo.jid, chatInfo.name);
    },

    getAll: () => {
      return resource.getAll().map(toChatInfo);
    },

    getAvailableGroups: () => {
      const chats = resource.getAll();
      const registeredJids = groupsRepository.getRegisteredGroupsJids();

      return chats
        .filter((c) => c.is_group === 1)
        .map((c) => ({
          jid: c.jid,
          name: c.name,
          lastActivity: c.last_message_time,
          isRegistered: registeredJids.has(c.jid),
        }));
    },
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
