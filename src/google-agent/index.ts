/* eslint-disable no-catch-all/no-catch-all */
import fs from "fs";
import path from "path";
import { Temporal } from "@js-temporal/polyfill";
import { query, RefusalError, type QueryTurn, createPartFromText, createPartFromUri, uploadMediaFile, interruptAgentLoop } from "../google-genai/index.js";
import { logger, TIMEZONE, GROUPS_DIR } from "../core/utils/index.js";
import type { GeminiAgentInput } from "./types.js";
import type { HistoryEntry, RegisteredGroup, MemoriesRepository } from "../core/repositories/index.js";
import { Content } from "@google/genai";

export type { GeminiAgentInput } from "./types.js";

export interface GeminiAgent {
  runCompaction: (group: Pick<RegisteredGroup, "jid" | "folder" | "temperature">) => Promise<void>;
  runQuery: (input: GeminiAgentInput) => Promise<void>;
  interruptAgentLoop: (jid: string) => void;
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
}

export const createGeminiAgent = (deps: GeminiAgentDeps): GeminiAgent => {
  const { onOutput, onError } = deps;

  const appendToHistory = async (chatJid: string, history: Array<HistoryEntry>, entry: HistoryEntry) => {
    history.push(entry);
    await deps.appendHistory(chatJid, history.length, entry);
  };

  const handleResponse = async (chatJid: string, history: Array<HistoryEntry>, response: QueryTurn) => {
    if ("role" in response && response.role === "user") {
      await appendToHistory(chatJid, history, response);
      return;
    }

    if ("candidates" in response && response.candidates) {
      if (response.candidates.length == 0) return;

      const candidate = response.candidates[0];
      if (!candidate.content || !candidate.content.parts) return;

      const content = { ...candidate.content };
      await appendToHistory(chatJid, history, content);

      let outputText = "";
      for (const part of candidate.content.parts) {
        if (part.text && part.text.length > 0) {
          outputText += part.text;
        }
      }
      if (outputText.length > 0) await onOutput({ chatJid, message: outputText });

      return;
    }
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

    let userContent: Content = { role: "user", parts: [] };
    if (input.kind === "image" || input.kind === "video" || input.kind === "voice" || input.kind === "pdf") {
      const media = await uploadMediaFile(input.blob, input.mimeType);
      userContent = {
        ...userContent,
        parts: [...userContent.parts!, createPartFromUri(media.uri, media.mimeType)],
      };
    }
    if (input.prompt.length > 0) {
      userContent = {
        ...userContent,
        parts: [...userContent.parts!, createPartFromText(wrapMessage(input.userName, input.prompt))],
      };
    }
    if (!userContent.parts || userContent.parts.length === 0) return null;

    logger.debug({ userContent }, "Running user query");
    appendToHistory(chatJid, history, userContent);

    let queryTurn: QueryTurn | null = null;
    try {
      for await (const response of query([...history], input.group, deps.memoriesRepository)) {
        await handleResponse(chatJid, history, response);
        queryTurn = response;
      }
    } catch (e) {
      deps.deleteHistoryFrom(chatJid, rollbackLength);
      handleError(chatJid, e);
    }

    return queryTurn;
  };

  const injectContextMd = async (group: Pick<RegisteredGroup, "jid" | "folder" | "temperature">) => {
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

  const runCompaction = async (group: Pick<RegisteredGroup, "jid" | "folder" | "temperature">) => {
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
    if ("candidates" in queryTurn && queryTurn.candidates) {
      const parts = queryTurn.candidates[0]?.content?.parts || [];
      summary =
        parts
          .filter((p) => !p.thought && p.text)
          .map((p) => p.text)
          .join("") || "";
    }
    if (summary.length === 0) return;

    await runInternal(await deps.loadHistory(chatJid), {
      kind: "text",
      userName: "System",
      prompt: `Context was compacted. Read the convo summary below:\n\n${summary}`,
      group,
    });
  };

  const runQuery = async (input: GeminiAgentInput): Promise<void> => {
    const chatJid = input.group.jid;
    logger.debug({ chatJid, input }, "Received input from the user");

    await injectContextMd(input.group);

    const history = await deps.loadHistory(chatJid);
    const queryTurn: QueryTurn | null = await runInternal(history, input);

    if (!(queryTurn && "usageMetadata" in queryTurn)) return;

    const usage = queryTurn.usageMetadata!;
    const totalTokens = usage.totalTokenCount ?? 0;
    const cachedTokens = usage.cachedContentTokenCount ?? 0;
    const uncached = (usage.promptTokenCount ?? 0) - cachedTokens;
    const output = totalTokens - (usage.promptTokenCount ?? 0);
    await onOutput({
      chatJid,
      message: `Total: ${totalTokens}
Cached: ${cachedTokens}
Uncached-Input: ${uncached}
Output: ${output}`,
    });
    if (totalTokens >= 300_000) await runCompaction(input.group);
  };

  return {
    runQuery,
    runCompaction,
    interruptAgentLoop,
  };
};
