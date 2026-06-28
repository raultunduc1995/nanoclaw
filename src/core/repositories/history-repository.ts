import type { HistoryLocalResource, HistoryRow } from "../db/index.js";
import { ContentBlockParam } from "../../google-genai/index.js";

export interface HistoryEntry {
  role: "user" | "model";
  content: Array<ContentBlockParam>;
}

export interface HistoryRepository {
  load: (jid: string) => Promise<HistoryEntry[]>;
  append: (jid: string, seq: number, entry: HistoryEntry) => Promise<void>;
  deleteFrom: (jid: string, fromSeq: number) => Promise<void>;
  clear: (jid: string) => Promise<void>;
}

export const createHistoryRepository = (resource: HistoryLocalResource): HistoryRepository => ({
  load: async (jid) => {
    const rows = await resource.getAll(jid);
    return rows.map((row: HistoryRow) => {
      if (row.role === "model") {
        return {
          role: "model",
          content: JSON.parse(row.content),
        } as HistoryEntry;
      }
      return {
        role: "user",
        content: JSON.parse(row.content),
      } as HistoryEntry;
    });
  },

  append: async (jid, seq, entry) => {
    await resource.append(jid, seq, entry.role, JSON.stringify(entry.content));
  },

  deleteFrom: async (jid, fromSeq) => {
    await resource.deleteFrom(jid, fromSeq);
  },

  clear: async (jid) => {
    await resource.clear(jid);
  },
});
