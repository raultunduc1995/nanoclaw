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
  `);
};
