import type Database from "better-sqlite3";

export interface HistoryRow {
  jid: string;
  seq: number;
  role: string;
  content: string;
}

export interface HistoryLocalResource {
  append: (jid: string, seq: number, role: string, content: string) => void;
  getAll: (jid: string) => HistoryRow[];
  deleteFrom: (jid: string, fromSeq: number) => void;
  clear: (jid: string) => void;
}

export const createHistoryLocalResource = (db: Database.Database): HistoryLocalResource => ({
  append: (jid, seq, role, content) => {
    db.prepare("INSERT INTO history (jid, seq, role, content) VALUES (?, ?, ?, ?)").run(jid, seq, role, content);
  },

  getAll: (jid) => db.prepare("SELECT * FROM history WHERE jid = ? ORDER BY seq").all(jid) as HistoryRow[],

  deleteFrom: (jid, fromSeq) => {
    db.prepare("DELETE FROM history WHERE jid = ? AND seq >= ?").run(jid, fromSeq);
  },

  clear: (jid) => {
    db.prepare("DELETE FROM history WHERE jid = ?").run(jid);
  },
});
