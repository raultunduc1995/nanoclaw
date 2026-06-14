/* eslint-disable no-catch-all/no-catch-all */

// google-agent/index.ts

import fs from "fs";
import path from "path";
import { Temporal } from "@js-temporal/polyfill";
import { query, type ContentBlockParam, RefusalError, type QueryTurn, type MessageParam } from "../google-genai/index.js";
import { logger, TIMEZONE, GROUPS_DIR } from "../core/utils/index.js";
import type { GeminiAgentInput, GeminiHistoryEntry } from "./types.js";
import type { RegisteredGroup } from "../core/repositories/index.js";

export type { GeminiAgentInput, GeminiHistoryEntry } from "./types.js";

export interface GeminiAgent {
  run: (input: GeminiAgentInput) => Promise<void>;
}

const formatDateTime = (): string => Temporal.Now.zonedDateTimeISO(TIMEZONE).toPlainDateTime().toString({ fractionalSecondDigits: 0 });

const wrapMessage = (senderName: string, content: string): string => `[${formatDateTime()}] ${senderName}:\n${content}`;

interface GeminiAgentDeps {
  onOutput: (result: { chatJid: string; message: string }) => Promise<void>;
  onError: (error: { chatJid: string; message: string }) => Promise<void>;
  loadHistory: (jid: string) => GeminiHistoryEntry[];
  appendHistory: (jid: string, seq: number, entry: GeminiHistoryEntry) => void;
  deleteHistoryFrom: (jid: string, fromSeq: number) => void;
  clearHistory: (jid: string) => void;
}

export const createGeminiAgent = (deps: GeminiAgentDeps): GeminiAgent => {
  const { onOutput, onError } = deps;

  const appendToHistory = (chatJid: string, history: Array<GeminiHistoryEntry>, entry: GeminiHistoryEntry) => {
    history.push(entry);
    deps.appendHistory(chatJid, history.length - 1, entry);
  };

  const handleResponse = async (chatJid: string, history: Array<GeminiHistoryEntry>, response: QueryTurn) => {
    const { role, turn } = response;
    if (role === "user") {
      appendToHistory(chatJid, history, { role: turn.role, content: turn.parts });
      return;
    }

    const parts: Array<ContentBlockParam> = [];
    let message = "";
    // Clean structural filtering matching your tools-free schemas
    for (const part of turn.parts) {
      if (part.thought && part.text && part.text.length > 0) {
        await onOutput({ chatJid, message: `Gemini thought:\n${part.text}\n` });
        continue;
      }
      if (part.text && part.text.length > 0) message += part.text;
      parts.push(part);
    }

    appendToHistory(chatJid, history, { role: "model", content: parts });
    if (message.length > 0) await onOutput({ chatJid, message });
  };

  const handleError = async (chatJid: string, e: unknown) => {
    const err = e instanceof Error ? e : new Error(String(e));
    let errorMessage: string;
    if (err instanceof RefusalError) {
      errorMessage = "Error: Gemini refused to answer";
    } else {
      errorMessage = err.message;
    }
    await onError({ chatJid, message: errorMessage });
  };

  const runCompaction = async (history: Array<GeminiHistoryEntry>, group: Pick<RegisteredGroup, "jid" | "folder">) => {
    const chatJid: string = group.jid;
    logger.warn({ chatJid }, "Total prompt tokens approaching model limit, running compaction");

    let rollbackLength = history.length;
    const compactionText = wrapMessage(
      "System",
      `
        Summarize the entire conversation and send it back to me.
        Include: key topics discussed, decisions made, technical details, action items, and any important context for continuing the conversation.
        Write a dense, factual summary. Write the summary in the same language used in the conversation.`,
    );
    appendToHistory(chatJid, history, { role: "user", content: [{ text: compactionText }] });
    const partsHistory = history.map((h): MessageParam => ({ role: h.role, parts: h.content }));
    let queryTurn: QueryTurn | null = null;
    try {
      for await (const turn of query(partsHistory, group)) {
        await handleResponse(chatJid, history, turn);
        queryTurn = turn;
      }
    } catch (e) {
      deps.deleteHistoryFrom(chatJid, rollbackLength);
      handleError(chatJid, e);
    }
    if (!queryTurn) return;

    deps.clearHistory(chatJid);

    let summary: string = "";
    for (const part of queryTurn.turn.parts) {
      if (part.thought) continue;
      if (part.text) summary += part.text + "\n\n";
    }

    let contextContent = "";
    const contextPath = path.resolve(GROUPS_DIR, group.folder, "memories", "context.md");
    if (fs.existsSync(contextPath)) {
      contextContent = fs.readFileSync(contextPath, "utf-8");
    }

    await run({
      kind: "text",
      userName: "System",
      prompt: wrapMessage(
        "System",
        contextContent
          ? `Below are the critical relational and style preferences for our partnership. Read and internalize these FIRST:\n\n${contextContent}\n\n=========================================\n\nContext was compacted. Read the convo summary below:\n\n${summary}`
          : `Context was compacted. Read the convo summary below:\n\n${summary}`,
      ),
      group: { jid: chatJid, folder: group.folder },
    });
    await run({
      kind: "text",
      userName: "System",
      prompt: wrapMessage(
        "System",
        `Additionally, use your file-viewing tool to read the memory index file at '${path.resolve(GROUPS_DIR, group.folder, "memories", "index.md")}' to see what permanent specifications and memories are available in this workspace.`,
      ),
      group: { jid: chatJid, folder: group.folder },
    });
  };

  const run = async (input: GeminiAgentInput): Promise<void> => {
    const chatJid = input.group.jid;
    logger.debug({ chatJid, input }, "Received input from the user");

    const history = deps.loadHistory(chatJid);
    let rollbackLength = history.length;

    // Process new incoming contents cleanly around your flat Text vs Image block schemas
    const parts: Array<ContentBlockParam> = [];
    if (input.kind === "image") parts.push({ inlineData: input.inlineData });
    if (input.prompt.length > 0) parts.push({ text: wrapMessage(input.userName, input.prompt) });
    if (parts.length == 0) return;

    appendToHistory(chatJid, history, { role: "user", content: parts });
    const partsHistory = history.map((h): MessageParam => ({ role: h.role, parts: h.content }));
    let queryTurn: QueryTurn | null = null;
    try {
      for await (const response of query(partsHistory, input.group)) {
        await handleResponse(chatJid, history, response);
        queryTurn = response;
      }
    } catch (e) {
      deps.deleteHistoryFrom(chatJid, rollbackLength);
      handleError(chatJid, e);
    }

    if (!(queryTurn && queryTurn.role === "model")) return;

    rollbackLength = history.length;
    await onOutput({ chatJid, message: `Ctx: ${queryTurn.turn.totalTokenCount}` });
    if (queryTurn.turn.totalTokenCount >= 150_000) await runCompaction(history, input.group);
  };

  return {
    run,
  };
};
