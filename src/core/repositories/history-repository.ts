import type { HistoryLocalResource, HistoryRow } from "../db/index.js";
import type { HistoryEntry } from "../../agent/types.js";

export interface HistoryRepository {
  load: (jid: string) => HistoryEntry[];
  append: (jid: string, seq: number, entry: HistoryEntry) => void;
  deleteFrom: (jid: string, fromSeq: number) => void;
  clear: (jid: string) => void;
}

export const createHistoryRepository = (resource: HistoryLocalResource): HistoryRepository => ({
  load: (jid) =>
    resource.getAll(jid).map((row: HistoryRow) => ({
      role: row.role as "user" | "assistant",
      content: JSON.parse(row.content),
    })),

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
