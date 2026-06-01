/* eslint-disable no-catch-all/no-catch-all */
import { Temporal } from "@js-temporal/polyfill";
import { query, countTokens, type ContentBlockParam, RefusalError, type QueryTurn } from "../client-sdk/index.js";
import { logger, TIMEZONE } from "../core/utils/index.js";
import type { AgentInput, HistoryEntry } from "./types.js";
import type { RegisteredGroup } from "../core/repositories/index.js";

export type { AgentInput, HistoryEntry } from "./types.js";

export interface Agent {
  run: (input: AgentInput) => Promise<void>;
}

const formatDateTime = (): string => Temporal.Now.zonedDateTimeISO(TIMEZONE).toPlainDateTime().toString({ fractionalSecondDigits: 0 });
const wrapMessage = (senderName: string, content: string): string => `[${formatDateTime()}] ${senderName}:\n${content}`;

interface AgentDeps {
  onOutput: (result: { chatJid: string; message: string }) => Promise<void>;
  onError: (error: { chatJid: string; message: string }) => Promise<void>;
  loadHistory: (jid: string) => HistoryEntry[];
  appendHistory: (jid: string, seq: number, entry: HistoryEntry) => void;
  deleteHistoryFrom: (jid: string, fromSeq: number) => void;
  clearHistory: (jid: string) => void;
}

export const createAgent = (deps: AgentDeps): Agent => {
  const { onOutput, onError } = deps;

  const appendToHistory = (chatJid: string, history: Array<HistoryEntry>, entry: HistoryEntry) => {
    history.push(entry);
    deps.appendHistory(chatJid, history.length - 1, entry);
  };

  const handleResponse = async (chatJid: string, history: Array<HistoryEntry>, response: QueryTurn) => {
    const { role, turn } = response;

    if (role === "user") {
      appendToHistory(chatJid, history, turn);
      return;
    }

    const contentBlocksParam: Array<ContentBlockParam> = [];
    let message = "";
    let citations = "";
    let sources = "";

    for (const block of turn.content) {
      if (block.type === "thinking") {
        await onOutput({ chatJid, message: `thinking\n${block.thinking}\nthinking` });
        continue;
      } else if (block.type === "redacted_thinking") {
        continue;
      } else if (block.type === "text") {
        if (block.text.length > 0) message += block.text;

        if (block.citations && block.citations.length > 0) {
          for (const c of block.citations) {
            if (c.type === "search_result_location") {
              citations += c.title ? `- ${c.title}:${c.source}\n` : `- ${c.source}\n`;
            } else if (c.type === "char_location" || c.type === "content_block_location" || c.type === "page_location") {
              citations += `- ${c.document_title}\n`;
            }
          }
        }

        contentBlocksParam.push(block);
        continue;
      } else if (block.type === "tool_use") {
        contentBlocksParam.push(block);
        continue;
      } else if (block.type === "server_tool_use") {
        contentBlocksParam.push(block);
        continue;
      } else if (block.type === "web_search_tool_result") {
        if (Array.isArray(block.content)) {
          for (const c of block.content) {
            sources += `- ${c.title}:${c.url}\n`;
          }
        }

        contentBlocksParam.push(block);
        continue;
      } else if (block.type === "web_fetch_tool_result") {
        if (block.content.type === "web_fetch_result") {
          const title = block.content.content.title;
          sources += title ? `- ${title}:${block.content.url}\n` : `- ${block.content.url}\n`;
        }

        contentBlocksParam.push(block);
        continue;
      } else if (block.type === "code_execution_tool_result") {
        continue;
      } else if (block.type === "bash_code_execution_tool_result") {
        continue;
      } else if (block.type === "text_editor_code_execution_tool_result") {
        continue;
      } else if (block.type === "tool_search_tool_result") {
        continue;
      } else if (block.type === "container_upload") {
        continue;
      }
    }

    appendToHistory(chatJid, history, { role: "assistant", content: contentBlocksParam });

    const isResponseValid = message.length > 0 || citations.length > 0 || sources.length > 0;
    if (isResponseValid) {
      let claudeMessage = message;
      if (citations.length > 0) claudeMessage += `\n---\nCitations:\n${citations}`;
      if (sources.length > 0) claudeMessage += `\n---\nSources:\n${sources}`;

      await onOutput({ chatJid, message: claudeMessage });
    }
  };

  const runCompaction = async (chatJid: string, history: Array<HistoryEntry>, group: Pick<RegisteredGroup, "jid" | "folder">) => {
    logger.warn({ chatJid }, "Total prompt tokens approaching model limit, running compaction");

    const compactionPrompt: HistoryEntry = {
      role: "user",
      content: [
        {
          type: "text",
          text: `
          Summarize the entire conversation above into /memories/convo-summary.md.
          If the file already exists, delete it first, then create it fresh with the new summary.
          Include: key topics discussed, decisions made, technical details, action items, and any important context for continuing the conversation.
          Write a dense, factual summary. Write the summary in the same language used in the conversation.`,
        },
      ],
    };

    for await (const turn of query([...history, compactionPrompt], group)) {
      await handleResponse(chatJid, history, turn);
    }

    deps.clearHistory(chatJid);

    await run({
      kind: "text",
      userName: "System",
      prompt: "Context was compacted. Read /memories/index.md and /memories/convo-summary.md before your next response.",
      group: { jid: chatJid, folder: group.folder },
    });
  };

  const run = async (input: AgentInput): Promise<void> => {
    const chatJid = input.group.jid;
    logger.debug({ chatJid, input }, "Received input from the user");

    const history = deps.loadHistory(chatJid);
    const rollbackLength = history.length;
    const wrappedUserPrompt = wrapMessage(input.userName, input.prompt);
    const content: Array<ContentBlockParam> =
      input.kind === "image"
        ? [
            { type: "image", source: { type: "base64", media_type: input.imageMimeType, data: input.imageBase64 } },
            { type: "text", text: wrappedUserPrompt },
          ]
        : [{ type: "text", text: wrappedUserPrompt }];
    appendToHistory(chatJid, history, { role: "user", content });

    try {
      for await (const response of query(history, input.group)) {
        await handleResponse(chatJid, history, response);
      }
      const promptTokensAfterThisTurn = await countTokens(history);
      logger.debug({ promptTokensAfterThisTurn }, "Tokens used on this turn");
      if (promptTokensAfterThisTurn >= 100_000) {
        await runCompaction(chatJid, history, input.group);
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      let errorMessage: string;
      if (err instanceof RefusalError) {
        logger.error({ chatJid }, "Refusal - clearing history");
        deps.clearHistory(chatJid);
        errorMessage = "Claude refused to answer";
      } else {
        logger.error({ err }, "Error during query iteration");
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
