import { Step } from "../../google-genai/index.js";
import type { HistoryLocalResource, HistoryRow } from "../db/index.js";

export interface HistoryRepository {
  load: (jid: string) => Promise<Step[]>;
  append: (jid: string, seq: number, entry: Step) => Promise<void>;
  deleteFrom: (jid: string, fromSeq: number) => Promise<void>;
  clear: (jid: string) => Promise<void>;
}

export const createHistoryRepository = (resource: HistoryLocalResource): HistoryRepository => ({
  load: async (jid) => {
    const rows = await resource.getAll(jid);
    return rows.map((row: HistoryRow) => JSON.parse(row.content) as Step);
  },

  append: async (jid, seq, entry) => {
    await resource.append(jid, seq, entry.type, JSON.stringify(entry));
  },

  deleteFrom: async (jid, fromSeq) => {
    await resource.deleteFrom(jid, fromSeq);
  },

  clear: async (jid) => {
    await resource.clear(jid);
  },
});
