/* eslint-disable no-catch-all/no-catch-all */
import fs from "fs";
import path from "path";
import { Temporal } from "@js-temporal/polyfill";
import { query, type ContentBlockParam, RefusalError, type QueryTurn, type MessageParam } from "../google-genai/index.js";
import { logger, TIMEZONE, GROUPS_DIR } from "../core/utils/index.js";
import type { GeminiAgentInput } from "./types.js";
import type { HistoryEntry, RegisteredGroup, MemoriesRepository } from "../core/repositories/index.js";

export type { GeminiAgentInput } from "./types.js";

export interface GeminiAgent {
  run: (input: GeminiAgentInput) => Promise<void>;
}

const formatDateTime = (): string => Temporal.Now.zonedDateTimeISO(TIMEZONE).toPlainDateTime().toString({ fractionalSecondDigits: 0 });

const wrapMessage = (senderName: string, content: string): string => `[${formatDateTime()}] ${senderName}:\n${content}`;

interface GeminiAgentDeps {
  memoriesRepository: MemoriesRepository;
  onOutput: (result: { chatJid: string; message: string }) => Promise<void>;
  onError: (error: { chatJid: string; message: string }) => Promise<void>;
  loadHistory: (jid: string) => Promise<HistoryEntry[]>;
  appendHistory: (jid: string, seq: number, entry: HistoryEntry) => Promise<void>;
  deleteHistoryFrom: (jid: string, fromSeq: number) => Promise<void>;
  clearHistory: (jid: string) => Promise<void>;
  pullExtraInputs: (jid: string) => Array<GeminiAgentInput>;
}

export const createGeminiAgent = (deps: GeminiAgentDeps): GeminiAgent => {
  const { onOutput, onError } = deps;

  const appendToHistory = async (chatJid: string, history: Array<HistoryEntry>, entry: HistoryEntry) => {
    history.push(entry);
    await deps.appendHistory(chatJid, history.length - 1, entry);
  };

  const handleResponse = async (chatJid: string, history: Array<HistoryEntry>, response: QueryTurn) => {
    const { role, turn } = response;
    if (role === "user") {
      await appendToHistory(chatJid, history, { role: turn.role, content: turn.parts });
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

    await appendToHistory(chatJid, history, { role: "model", content: parts });
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

  const runInternal = async (history: Array<HistoryEntry>, input: GeminiAgentInput): Promise<QueryTurn | null> => {
    const chatJid: string = input.group.jid;
    const rollbackLength = history.length;

    const parts: Array<ContentBlockParam> = [];
    if (input.kind === "image" || input.kind === "video") parts.push({ inlineData: input.inlineData });
    if (input.prompt.length > 0) parts.push({ text: wrapMessage(input.userName, input.prompt) });
    if (parts.length === 0) return null;

    appendToHistory(chatJid, history, { role: "user", content: parts });

    const partsHistory = history.map((h): MessageParam => ({ role: h.role, parts: h.content }));

    const onBeforeGenerate = async (): Promise<Array<ContentBlockParam>> => {
      const extraInputs = deps.pullExtraInputs(chatJid);
      const extraParts: Array<ContentBlockParam> = [];
      for (const input of extraInputs) {
        if ((input.kind === "image" || input.kind === "video") && input.inlineData) extraParts.push({ inlineData: input.inlineData });
        if (input.prompt.length > 0) extraParts.push({ text: wrapMessage(input.userName, input.prompt) });
      }
      return extraParts;
    };

    let queryTurn: QueryTurn | null = null;
    try {
      for await (const response of query(partsHistory, input.group, deps.memoriesRepository, onBeforeGenerate)) {
        await handleResponse(chatJid, history, response);
        queryTurn = response;
      }
    } catch (e) {
      deps.deleteHistoryFrom(chatJid, rollbackLength);
      handleError(chatJid, e);
    }

    return queryTurn;
  };

  const injectContextMd = async (group: Pick<RegisteredGroup, "jid" | "folder">) => {
    const chatJid: string = group.jid;
    const history = await deps.loadHistory(chatJid);
    if (history.length > 0) return;

    logger.debug({ chatJid }, "Injecting context.md if available");

    const contextMdPath = path.resolve(GROUPS_DIR, group.folder, "context.md");
    if (fs.existsSync(contextMdPath)) {
      const contextMdContent = fs.readFileSync(contextMdPath, "utf-8");
      if (contextMdContent) {
        await runInternal(history, {
          kind: "text",
          userName: "System",
          prompt: `Below are the critical relational and style preferences for our partnership. Read and internalize these FIRST:
            
            ${contextMdContent}`,
          group,
        });
      }
    }
  };

  const runCompaction = async (group: Pick<RegisteredGroup, "jid" | "folder">) => {
    const chatJid: string = group.jid;
    logger.warn({ chatJid }, "Total prompt tokens approaching model limit, running compaction");

    const queryTurn: QueryTurn | null = await runInternal(await deps.loadHistory(chatJid), {
      kind: "text",
      userName: "System",
      prompt: `Summarize the entire conversation and send it back to me.
        Include: key topics discussed, decisions made, technical details, action items, and any important context for continuing the conversation.
        Write a dense, factual summary. Write the summary in the same language used in the conversation.`,
      group,
    });
    if (!queryTurn) return;

    await deps.clearHistory(chatJid);

    await injectContextMd(group);

    let summary: string = "";
    for (const part of queryTurn.turn.parts) {
      if (part.thought) continue;
      if (part.text) summary += part.text + "\n\n";
    }
    await runInternal(await deps.loadHistory(chatJid), {
      kind: "text",
      userName: "System",
      prompt: `Context was compacted. Read the convo summary below:\n\n${summary}`,
      group,
    });
  };

  const run = async (input: GeminiAgentInput): Promise<void> => {
    const chatJid = input.group.jid;
    logger.debug({ chatJid, input }, "Received input from the user");

    await injectContextMd(input.group);

    const history = await deps.loadHistory(chatJid);
    const queryTurn: QueryTurn | null = await runInternal(history, input);

    if (!(queryTurn && queryTurn.role === "model")) return;

    await onOutput({ chatJid, message: `Ctx: ${queryTurn.turn.totalTokenCount}` });
    if (queryTurn.turn.totalTokenCount >= 180_000) await runCompaction(input.group);
  };

  return {
    run,
  };
};
