import type { HistoryLocalResource, HistoryRow } from "../db/index.js";
import { ContentBlockParam } from "../../google-genai/index.js";

export interface HistoryEntry {
  role: "user" | "model";
  content: Array<ContentBlockParam>;
}

export interface HistoryRepository {
  load: (jid: string) => HistoryEntry[];
  append: (jid: string, seq: number, entry: HistoryEntry) => void;
  deleteFrom: (jid: string, fromSeq: number) => void;
  clear: (jid: string) => void;
}

export const createHistoryRepository = (resource: HistoryLocalResource): HistoryRepository => ({
  load: (jid) =>
    resource.getAll(jid).map((row: HistoryRow) => {
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
    }),

  append: (jid, seq, entry) => {
    resource.append(jid, seq, entry.role, JSON.stringify(entry.content));
  },

  deleteFrom: (jid, fromSeq) => {
    resource.deleteFrom(jid, fromSeq);
  },

  clear: (jid) => {
    resource.clear(jid);
  },
});
