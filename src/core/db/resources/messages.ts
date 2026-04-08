import type Database from 'better-sqlite3';

export interface MessageRow {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  reply_to_message_id: string | null;
  reply_to_message_content: string | null;
  reply_to_sender_name: string | null;
}

export interface MessagesLocalResource {
  store(msg: MessageRow): void;
  getNew(jids: string[], lastTimestamp: string, limit?: number): MessageRow[];
  getSince(chatJid: string, sinceTimestamp: string, limit?: number): MessageRow[];
}

export const createMessagesLocalResource = (db: Database.Database): MessagesLocalResource => ({
  store: (msg) => {
    db.prepare(
      `INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message, reply_to_message_id, reply_to_message_content, reply_to_sender_name)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
    ).run(
      msg.id,
      msg.chat_jid,
      msg.sender,
      msg.sender_name,
      msg.content,
      msg.timestamp,
      msg.reply_to_message_id,
      msg.reply_to_message_content,
      msg.reply_to_sender_name,
    );
  },

  getNew: (jids, lastTimestamp, limit = 200) => {
    const placeholders = jids.map(() => '?').join(',');
    const sql = `
        SELECT * FROM (
          SELECT *
          FROM messages
          WHERE timestamp > ? AND chat_jid IN (${placeholders})
            AND content != '' AND content IS NOT NULL
          ORDER BY timestamp DESC
          LIMIT ?
        ) ORDER BY timestamp
      `;

    return db.prepare(sql).all(lastTimestamp, ...jids, limit) as MessageRow[];
  },

  getSince: (chatJid, sinceTimestamp, limit = 200) => {
    const sql = `
        SELECT * FROM (
          SELECT *
          FROM messages
          WHERE chat_jid = ? AND timestamp > ?
            AND content != '' AND content IS NOT NULL
          ORDER BY timestamp DESC
          LIMIT ?
        ) ORDER BY timestamp
      `;

    return db.prepare(sql).all(chatJid, sinceTimestamp, limit) as MessageRow[];
  },
});
