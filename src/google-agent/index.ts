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

const loadGeminiMd = (groupFolder: string): string => {
  const geminiMdPath = path.join(groupFolder, "GEMINI.md");
  if (!fs.existsSync(geminiMdPath)) return "";
  return fs.readFileSync(geminiMdPath, "utf-8").trim();
};

export const createGeminiAgent = (deps: GeminiAgentDeps): GeminiAgent => {
  const { onOutput, onError } = deps;

  const appendToHistory = (chatJid: string, history: Array<GeminiHistoryEntry>, entry: GeminiHistoryEntry) => {
    history.push(entry);
    deps.appendHistory(chatJid, history.length - 1, entry);
  };

  const injectGeminiMd = (chatJid: string, history: Array<GeminiHistoryEntry>, groupPath: string) => {
    if (history.length > 0) return;
    const content = loadGeminiMd(groupPath);
    if (!content) return;
    logger.info({ chatJid }, "Injecting GEMINI.md instructions into empty history");
    appendToHistory(chatJid, history, {
      role: "user",
      content: [{ text: wrapMessage("System", `GEMINI.md instructions:\n${content}`) }],
    });
    appendToHistory(chatJid, history, {
      role: "model",
      content: [{ text: "Understood." }],
    });
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
      if (part.thought && part.text) {
        await onOutput({ chatJid, message: part.text });
        continue;
      }

      if (part.text) {
        if (part.text.length > 0) message += part.text;
      }

      parts.push(part);
    }

    appendToHistory(chatJid, history, { role: "model", content: parts });

    if (message.length > 0) {
      await onOutput({ chatJid, message });
    }

    logger.debug({ tokenCount: turn.totalTokenCount }, "Tokens used on this turn");
    await onOutput({ chatJid, message: `Tokens used: ${turn.totalTokenCount}` });
  };

  //   const runCompaction = async (chatJid: string, history: Array<GeminiHistoryEntry>, group: Pick<RegisteredGroup, "jid" | "folder">) => {
  //     logger.warn({ chatJid }, "Total prompt tokens approaching model limit, running compaction");

  //     const compactionText = wrapMessage(
  //       "System",
  //       `
  //       Summarize the entire conversation above into /memories/convo-summary.md.
  //       If the file already exists, delete it first, then create it fresh with the new summary.
  //       Include: key topics discussed, decisions made, technical details, action items, and any important context for continuing the conversation.
  //       Write a dense, factual summary. Write the summary in the same language used in the conversation.`,
  //     );

  //     appendToHistory(chatJid, history, {
  //       role: "user",
  //       content: [{ text: compactionText }],
  //     });

  //     for await (const turn of query(history, group)) {
  //       await handleResponse(chatJid, history, turn);
  //     }
  //     deps.clearHistory(chatJid);

  //     await run({
  //       kind: "text",
  //       userName: "System",
  //       prompt: "Context was compacted. Read /memories/convo-summary.md and /memories/index.md before your next response.",
  //       group: { jid: chatJid, folder: group.folder },
  //     });
  //   };

  const run = async (input: GeminiAgentInput): Promise<void> => {
    const chatJid = input.group.jid;
    logger.debug({ chatJid, input }, "Received input from the user");

    const history = deps.loadHistory(chatJid);
    injectGeminiMd(chatJid, history, path.join(GROUPS_DIR, input.group.folder));
    const rollbackLength = history.length;

    // Process new incoming contents cleanly around your flat Text vs Image block schemas
    const parts: Array<ContentBlockParam> = [];
    if (input.kind === "image") {
      parts.push({ inlineData: input.inlineData, text: wrapMessage(input.userName, input.prompt) });
    } else if (input.kind === "text") {
      parts.push({ text: wrapMessage(input.userName, input.prompt) });
    }

    appendToHistory(chatJid, history, { role: "user", content: parts });

    try {
      const partsHistory = history.map((h): MessageParam => ({ role: h.role, parts: h.content }));
      for await (const response of query(partsHistory, input.group)) {
        await handleResponse(chatJid, history, response);
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      let errorMessage: string;

      if (err instanceof RefusalError) {
        deps.deleteHistoryFrom(chatJid, rollbackLength);
        errorMessage = "Error: Gemini refused to answer";
      } else {
        deps.deleteHistoryFrom(chatJid, rollbackLength);
        errorMessage = err.message;
      }

      await onError({ chatJid, message: errorMessage });
    }
  };

  return {
    run,
  };
};
