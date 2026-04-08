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
  upsert: (chatJid: string, metadata: { timestamp: string; name: string; channel: string; isGroup: boolean }) => void;
  updateName: (chatJid: string, name: string) => void;
  getAll: () => ChatRow[];
}

export const createChatsLocalResource = (db: Database.Database): ChatsLocalResource => ({
  upsert: (chatJid, metadata) => {
    db.prepare(
      `INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(jid) DO UPDATE SET
           name = excluded.name,
           last_message_time = MAX(last_message_time, excluded.last_message_time),
           channel = excluded.channel,
           is_group = excluded.is_group`,
    ).run(chatJid, metadata.name, metadata.timestamp, metadata.channel, metadata.isGroup ? 1 : 0);
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
