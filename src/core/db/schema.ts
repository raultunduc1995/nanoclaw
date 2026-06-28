import type Database from "better-sqlite3";

export const createSchema = (database: Database.Database): void => {
  database.exec(`
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
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
      memory_id INTEGER PRIMARY KEY,
      jid TEXT,
      embedding float[3072] distance_metric=cosine
    );
  `);
};
