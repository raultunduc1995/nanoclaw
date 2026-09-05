/* eslint-disable no-catch-all/no-catch-all */
import fs from "fs";
import path from "path";
import { Temporal } from "@js-temporal/polyfill";
import { query, RefusalError, uploadMediaFile, interruptAgentLoop } from "../google-genai/index.js";
import type { QueryTurn, Content, Step } from "../google-genai/index.js";
import { logger, TIMEZONE, GROUPS_DIR } from "../core/utils/index.js";
import type { GeminiAgentInput } from "./types.js";
import type { RegisteredGroup, MemoriesRepository } from "../core/repositories/index.js";

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
  loadHistory: (jid: string) => Promise<Step[]>;
  appendHistory: (jid: string, seq: number, entry: Step) => Promise<void>;
  deleteHistoryFrom: (jid: string, fromSeq: number) => Promise<void>;
  clearHistory: (jid: string) => Promise<void>;
}

export const createGeminiAgent = (deps: GeminiAgentDeps): GeminiAgent => {
  const { onOutput, onError } = deps;

  const appendToHistory = async (chatJid: string, history: Array<Step>, entry: Step) => {
    history.push(entry);
    await deps.appendHistory(chatJid, history.length, entry);
  };

  const handleResponse = async (chatJid: string, history: Array<Step>, response: QueryTurn) => {
    if (Array.isArray(response)) {
      for (const step of response) {
        await appendToHistory(chatJid, history, step);
      }
      return;
    }

    if (response.steps) {
      for (const step of response.steps) {
        await appendToHistory(chatJid, history, step);
      }
    }

    const outputText = response.output_text?.trim();
    if (outputText && outputText.length > 0) {
      await onOutput({ chatJid, message: outputText });
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

  const runInternal = async (history: Array<Step>, input: GeminiAgentInput): Promise<QueryTurn | null> => {
    const chatJid: string = input.group.jid;
    const rollbackLength = history.length;

    const content: Content[] = [];
    if (input.kind === "image") {
      const media = await uploadMediaFile(input.blob, input.mimeType);
      content.push({
        type: "image",
        uri: media.uri,
        mime_type: media.mimeType,
      });
    }
    if (input.kind === "video") {
      const media = await uploadMediaFile(input.blob, input.mimeType);
      content.push({
        type: "video",
        uri: media.uri,
        mime_type: media.mimeType,
      });
    }
    if (input.kind === "voice") {
      const media = await uploadMediaFile(input.blob, input.mimeType);
      content.push({
        type: "audio",
        uri: media.uri,
        mime_type: media.mimeType,
      });
    }
    if (input.kind === "pdf") {
      const media = await uploadMediaFile(input.blob, input.mimeType);
      content.push({
        type: "document",
        uri: media.uri,
        mime_type: media.mimeType,
      });
    }
    if (input.prompt.length > 0) {
      content.push({
        type: "text",
        text: wrapMessage(input.userName, input.prompt),
      });
    }
    if (content.length === 0) return null;

    const userStep: Step = { type: "user_input", content };

    logger.debug({ userStep }, "Running user query");
    await appendToHistory(chatJid, history, userStep);

    let queryTurn: QueryTurn | null = null;
    try {
      for await (const response of query([...history], input.group, deps.memoriesRepository)) {
        await handleResponse(chatJid, history, response);
        queryTurn = response;
      }
    } catch (e) {
      await deps.deleteHistoryFrom(chatJid, rollbackLength);
      await handleError(chatJid, e);
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
    if (!Array.isArray(queryTurn) && queryTurn.output_text) {
      summary = queryTurn.output_text.trim();
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

    if (Array.isArray(queryTurn) || !queryTurn?.usage) return;

    const usage = queryTurn.usage;
    const totalTokens = usage.total_tokens ?? 0;
    const cachedTokens = usage.total_cached_tokens ?? 0;
    const inputTokens = usage.total_input_tokens ?? 0;
    const uncached = inputTokens - cachedTokens;
    const output = usage.total_output_tokens ?? 0;
    await onOutput({
      chatJid,
      message: `Total: ${totalTokens}\nCached: ${cachedTokens}\nUncached-Input: ${uncached}\nOutput: ${output}`,
    });
    if (totalTokens >= 300_000) await runCompaction(input.group);
  };

  return {
    runQuery,
    runCompaction,
    interruptAgentLoop,
  };
};
