import type Database from 'better-sqlite3';

// --- Types and interfaces ---

export interface ChatRow {
  jid: string;
  name: string;
  last_message_time: string;
  channel: string;
  is_group: number;
}

// --- Local resource interface and implementation ---

export interface ChatsLocalResource {
  storeNamedMetadata: (chatJid: string, metadata: { timestamp: string; name: string; channel?: string; isGroup?: boolean }) => void;
  storeMetadata: (chatJid: string, metadata: { timestamp: string; channel?: string; isGroup?: boolean }) => void;
  updateName: (chatJid: string, name: string) => void;
  getAll: () => ChatRow[];
}

export const createChatsLocalResource = (db: Database.Database): ChatsLocalResource => ({
  storeNamedMetadata: (chatJid, metadata) => {
    const { timestamp, name, channel, isGroup } = metadata;
    const ch = channel ?? null;
    const group = isGroup === undefined ? null : isGroup ? 1 : 0;

    db.prepare(
      `INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(jid) DO UPDATE SET
           name = excluded.name,
           last_message_time = MAX(last_message_time, excluded.last_message_time),
           channel = COALESCE(excluded.channel, channel),
           is_group = COALESCE(excluded.is_group, is_group)`,
    ).run(chatJid, name, timestamp, ch, group);
  },

  storeMetadata: (chatJid, metadata) => {
    const { timestamp, channel, isGroup } = metadata;
    const ch = channel ?? null;
    const group = isGroup === undefined ? null : isGroup ? 1 : 0;

    db.prepare(
      `INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(jid) DO UPDATE SET
             last_message_time = MAX(last_message_time, excluded.last_message_time),
             channel = COALESCE(excluded.channel, channel),
             is_group = COALESCE(excluded.is_group, is_group)`,
    ).run(chatJid, chatJid, timestamp, ch, group);
  },

  updateName: (chatJid, name) => {
    db.prepare(
      `INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
       ON CONFLICT(jid) DO UPDATE SET name = excluded.name`,
    ).run(chatJid, name, new Date().toISOString());
  },

  getAll: () => {
    return db.prepare(`SELECT jid, name, last_message_time, channel, is_group FROM chats ORDER BY last_message_time DESC`).all() as ChatRow[];
  },
});
