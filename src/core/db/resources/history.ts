import { type Database } from "@tursodatabase/database";

export interface HistoryRow {
  jid: string;
  seq: number;
  role: string;
  content: string;
}

export interface HistoryLocalResource {
  append: (jid: string, seq: number, role: string, content: string) => Promise<void>;
  getAll: (jid: string) => Promise<HistoryRow[]>;
  deleteFrom: (jid: string, fromSeq: number) => Promise<void>;
  clear: (jid: string) => Promise<void>;
}

export const createHistoryLocalResource = (db: Database): HistoryLocalResource => ({
  append: async (jid, seq, role, content) => {
    const stmt = await db.prepare("INSERT INTO history (jid, seq, role, content) VALUES (?, ?, ?, ?)");
    await stmt.run(jid, seq, role, content);
  },

  getAll: async (jid) => {
    const stmt = await db.prepare("SELECT * FROM history WHERE jid = ? ORDER BY seq");
    return (await stmt.all(jid)) as unknown as HistoryRow[];
  },

  deleteFrom: async (jid, fromSeq) => {
    const stmt = await db.prepare("DELETE FROM history WHERE jid = ? AND seq >= ?");
    await stmt.run(jid, fromSeq);
  },

  clear: async (jid) => {
    const stmt = await db.prepare("DELETE FROM history WHERE jid = ?");
    await stmt.run(jid);
  },
});
