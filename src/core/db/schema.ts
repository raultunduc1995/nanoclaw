import { type Database } from "@tursodatabase/database";

export const createSchema = async (database: Database): Promise<void> => {
  await database.exec(`
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL UNIQUE,
      added_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS history (
      jid TEXT NOT NULL,
      seq INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      PRIMARY KEY (jid, seq)
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jid TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      embedding F32_BLOB(3072)
    );

    CREATE INDEX IF NOT EXISTS idx_memories_jid ON memories(jid);
  `);
};
