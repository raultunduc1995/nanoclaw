import { Step } from "../../google-genai/index.js";
import type { MessageParam } from "../../openai/index.js";
import type { HistoryLocalResource, HistoryRow } from "../db/index.js";

export interface HistoryRepository {
  loadSteps: (jid: string) => Promise<Step[]>;
  appendStep: (jid: string, seq: number, entry: Step) => Promise<void>;
  loadMessages: (jid: string) => Promise<MessageParam[]>;
  appendMessage: (jid: string, seq: number, entry: MessageParam) => Promise<void>;
  deleteFrom: (jid: string, fromSeq: number) => Promise<void>;
  clear: (jid: string) => Promise<void>;
}

export const createHistoryRepository = (resource: HistoryLocalResource): HistoryRepository => ({
  loadSteps: async (jid) => {
    const rows = await resource.getAll(jid);
    return rows.map((row: HistoryRow) => JSON.parse(row.content) as Step);
  },

  appendStep: async (jid, seq, entry) => {
    await resource.append(jid, seq, entry.type, JSON.stringify(entry));
  },

  loadMessages: async (jid) => {
    const rows = await resource.getAll(jid);
    return rows.map((row: HistoryRow) => JSON.parse(row.content) as MessageParam);
  },

  appendMessage: async (jid, seq, entry) => {
    await resource.append(jid, seq, entry.role, JSON.stringify(entry));
  },

  deleteFrom: async (jid, fromSeq) => {
    await resource.deleteFrom(jid, fromSeq);
  },

  clear: async (jid) => {
    await resource.clear(jid);
  },
});
