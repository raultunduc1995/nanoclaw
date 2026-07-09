import { MessageParam } from "../../google-genai/index.js";
import type { HistoryLocalResource, HistoryRow } from "../db/index.js";

export type HistoryEntry = MessageParam;

export interface HistoryRepository {
  load: (jid: string) => Promise<HistoryEntry[]>;
  append: (jid: string, seq: number, entry: HistoryEntry) => Promise<void>;
  deleteFrom: (jid: string, fromSeq: number) => Promise<void>;
  clear: (jid: string) => Promise<void>;
}

export const createHistoryRepository = (resource: HistoryLocalResource): HistoryRepository => ({
  load: async (jid) => {
    const rows = await resource.getAll(jid);
    return rows.map((row: HistoryRow) => ({
      role: row.role,
      parts: JSON.parse(row.content),
    }));
  },

  append: async (jid, seq, entry) => {
    await resource.append(jid, seq, entry.role!, JSON.stringify(entry.parts));
  },

  deleteFrom: async (jid, fromSeq) => {
    await resource.deleteFrom(jid, fromSeq);
  },

  clear: async (jid) => {
    await resource.clear(jid);
  },
});
