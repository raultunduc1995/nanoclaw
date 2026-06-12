import type { HistoryLocalResource, HistoryRow } from "../db/index.js";
import type { ClaudeHistoryEntry } from "../../agent/types.js";
import { GeminiHistoryEntry } from "../../google-agent/types.js";

type HistoryEntry = ClaudeHistoryEntry | GeminiHistoryEntry;

export interface HistoryRepository {
  load: (jid: string) => HistoryEntry[];
  append: (jid: string, seq: number, entry: HistoryEntry) => void;
  deleteFrom: (jid: string, fromSeq: number) => void;
  clear: (jid: string) => void;
}

export const createHistoryRepository = (resource: HistoryLocalResource): HistoryRepository => ({
  load: (jid) =>
    resource.getAll(jid).map((row: HistoryRow) => {
      if (row.role === "assistant") {
        return {
          role: "assistant",
          content: JSON.parse(row.content),
        } as ClaudeHistoryEntry;
      }
      if (row.role === "model") {
        return {
          role: "model",
          content: JSON.parse(row.content),
        } as GeminiHistoryEntry;
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
