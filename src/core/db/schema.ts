import type Database from 'better-sqlite3';

export const createSchema = (database: Database.Database): void => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS registered_groups (
      jid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL UNIQUE,
      added_at TEXT NOT NULL,
      is_main INTEGER DEFAULT 0,
      session_id TEXT NOT NULL DEFAULT ''
    );
  `);
};
