import type Database from 'better-sqlite3';

import type { ChatInfo } from '../types.js';

interface ChatRow {
  jid: string;
  name: string;
  last_message_time: string;
  channel: string;
  is_group: number;
}

function toChat(row: ChatRow): ChatInfo {
  return {
    jid: row.jid,
    name: row.name,
    lastMessageTime: row.last_message_time,
    channel: row.channel,
    isGroup: row.is_group === 1,
  };
}

export interface ChatsLocalResource {
  storeMetadata(
    chatJid: string,
    timestamp: string,
    name?: string,
    channel?: string,
    isGroup?: boolean,
  ): void;
  updateName(chatJid: string, name: string): void;
  getAll(): ChatInfo[];
  getLastGroupSync(): string | null;
  setLastGroupSync(): void;
}

export class ChatsResource implements ChatsLocalResource {
  constructor(private db: Database.Database) {}

  storeMetadata(
    chatJid: string,
    timestamp: string,
    name?: string,
    channel?: string,
    isGroup?: boolean,
  ): void {
    const ch = channel ?? null;
    const group = isGroup === undefined ? null : isGroup ? 1 : 0;

    if (name) {
      this.db
        .prepare(
          `INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(jid) DO UPDATE SET
             name = excluded.name,
             last_message_time = MAX(last_message_time, excluded.last_message_time),
             channel = COALESCE(excluded.channel, channel),
             is_group = COALESCE(excluded.is_group, is_group)`,
        )
        .run(chatJid, name, timestamp, ch, group);
    } else {
      this.db
        .prepare(
          `INSERT INTO chats (jid, name, last_message_time, channel, is_group) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(jid) DO UPDATE SET
             last_message_time = MAX(last_message_time, excluded.last_message_time),
             channel = COALESCE(excluded.channel, channel),
             is_group = COALESCE(excluded.is_group, is_group)`,
        )
        .run(chatJid, chatJid, timestamp, ch, group);
    }
  }

  updateName(chatJid: string, name: string): void {
    this.db
      .prepare(
        `INSERT INTO chats (jid, name, last_message_time) VALUES (?, ?, ?)
         ON CONFLICT(jid) DO UPDATE SET name = excluded.name`,
      )
      .run(chatJid, name, new Date().toISOString());
  }

  getAll(): ChatInfo[] {
    const rows = this.db
      .prepare(
        `SELECT jid, name, last_message_time, channel, is_group
         FROM chats ORDER BY last_message_time DESC`,
      )
      .all() as ChatRow[];
    return rows.map(toChat);
  }

  getLastGroupSync(): string | null {
    const row = this.db
      .prepare(
        `SELECT last_message_time FROM chats WHERE jid = '__group_sync__'`,
      )
      .get() as { last_message_time: string } | undefined;
    return row?.last_message_time || null;
  }

  setLastGroupSync(): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO chats (jid, name, last_message_time) VALUES ('__group_sync__', '__group_sync__', ?)`,
      )
      .run(now);
  }
}
