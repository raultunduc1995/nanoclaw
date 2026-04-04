import type Database from 'better-sqlite3';

export interface MessageRow {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: number;
  is_bot_message: number;
  reply_to_message_id: string | null;
  reply_to_message_content: string | null;
  reply_to_sender_name: string | null;
}

export interface MessagesLocalResource {
  store(msg: MessageRow): void;
  getNew(jids: string[], lastTimestamp: string, botPrefix: string, limit?: number): MessageRow[];
  getSince(chatJid: string, sinceTimestamp: string, botPrefix: string, limit?: number): MessageRow[];
  getLastBotTimestamp(chatJid: string, botPrefix: string): string | undefined;
}

export const createMessagesLocalResource = (db: Database.Database): MessagesLocalResource => ({
  store: (msg) => {
    db.prepare(
      `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message, reply_to_message_id, reply_to_message_content, reply_to_sender_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      msg.id,
      msg.chat_jid,
      msg.sender,
      msg.sender_name,
      msg.content,
      msg.timestamp,
      msg.is_from_me,
      msg.is_bot_message,
      msg.reply_to_message_id,
      msg.reply_to_message_content,
      msg.reply_to_sender_name,
    );
  },

  getNew: (jids, lastTimestamp, botPrefix, limit = 200) => {
    const placeholders = jids.map(() => '?').join(',');
    const sql = `
        SELECT * FROM (
          SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message, reply_to_message_id, reply_to_message_content, reply_to_sender_name
          FROM messages
          WHERE timestamp > ? AND chat_jid IN (${placeholders})
            AND is_bot_message = 0 AND content NOT LIKE ?
            AND content != '' AND content IS NOT NULL
          ORDER BY timestamp DESC
          LIMIT ?
        ) ORDER BY timestamp
      `;

    return db.prepare(sql).all(lastTimestamp, ...jids, `${botPrefix}:%`, limit) as MessageRow[];
  },

  getSince: (chatJid, sinceTimestamp, botPrefix, limit = 200) => {
    const sql = `
        SELECT * FROM (
          SELECT id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message, reply_to_message_id, reply_to_message_content, reply_to_sender_name
          FROM messages
          WHERE chat_jid = ? AND timestamp > ?
            AND is_bot_message = 0 AND content NOT LIKE ?
            AND content != '' AND content IS NOT NULL
          ORDER BY timestamp DESC
          LIMIT ?
        ) ORDER BY timestamp
      `;

    return db.prepare(sql).all(chatJid, sinceTimestamp, `${botPrefix}:%`, limit) as MessageRow[];
  },

  getLastBotTimestamp: (chatJid, botPrefix) => {
    const row = db.prepare(`SELECT MAX(timestamp) as ts FROM messages WHERE chat_jid = ? AND (is_bot_message = 1 OR content LIKE ?)`).get(chatJid, `${botPrefix}:%`) as
      | { ts: string | null }
      | undefined;

    return row?.ts ?? undefined;
  },
});
