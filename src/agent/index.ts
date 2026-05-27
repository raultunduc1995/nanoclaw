import { Temporal } from "@js-temporal/polyfill";
import { query, countTokens, type ContentBlockParam, type MessageParam, type Message } from "../client-sdk/index.js";
import { logger, TIMEZONE } from "../core/utils/index.js";
import type { AgentInput, HistoryEntry } from "./types.js";

export type { AgentInput, HistoryEntry } from "./types.js";

export interface Agent {
  run: (input: AgentInput) => Promise<void>;
}

const formatDateTime = (): string => Temporal.Now.zonedDateTimeISO(TIMEZONE).toPlainDateTime().toString({ fractionalSecondDigits: 0 });
const wrapMessage = (senderName: string, content: string): string => `[${formatDateTime()}] ${senderName}:\n${content}`;

interface AgentDeps {
  onOutput: (result: { chatJid: string; message: string }) => Promise<void>;
  onError: (error: { chatJid: string; message: string }) => Promise<void>;
  saveHistoryEntry: (entry: { chatJid: string; content: string }) => Promise<void>;
}

export const createAgent = (deps: AgentDeps): Agent => {
  const { onOutput, onError, saveHistoryEntry } = deps;
  const history: Record<string, Array<HistoryEntry>> = {};

  const runCompaction = async (chatJid: string) => {
    logger.debug({ chatJid }, "Running compaction for chat");
    // TODO(compaction): implement two-query compaction:
    //   1. Memory-extraction query — Claude reads current in-memory history, calls the memory tool
    //      (memory_20250818) repeatedly to add / modify / stale-tag memory files. No delete op.
    //   2. Summarization query — Claude produces a dense summary of the same history, wrapped in
    //      <summary>...</summary> xml tags. System prompt for this query must instruct Claude NOT
    //      to re-summarize content already inside <summary> tags (prevents summary-of-summary loss).
    // Both queries should override `output_config.effort` to "xhigh" — compaction is quality-critical,
    // agentic, infrequent; latency is invisible (between turns).
    // After both queries succeed:
    //   - Full clean of history[chatJid] (no preservation of older <summary> blocks).
    //   - Push the new summary as a user-type HistoryEntry (re-roled, not assistant).
    //   - Do NOT call saveHistoryEntry for the summary — it must not land in the history file
    //     (history file is the durable record; summary belongs only to in-memory state).
    //     Requires extending HistoryEntry with a `kind` field ("turn" | "summary") and filtering
    //     on save.
    history[chatJid] = [];
  };

  const handleResponse = async (chatJid: string, wrappedUserPrompt: string, response: Message) => {
    const content = response.content;
    const chatHistory = history[chatJid];
    const contentBlocksParam: Array<ContentBlockParam> = [];
    let message = "";
    let citations = "";
    let sources = "";

    for (const block of content) {
      if (block.type === "thinking") {
        await onOutput({ chatJid, message: `<thinking>\n${block.thinking}\n</thinking>` });
        continue;
      }

      if (block.type === "text") {
        if (block.text.length > 0) message += block.text;

        if (block.citations && block.citations.length > 0) {
          for (const c of block.citations) {
            if (c.type === "web_search_result_location") {
              citations += c.title ? `- ${c.title}:${c.url}\n` : `- ${c.url}\n`;
            } else if (c.type === "search_result_location") {
              citations += c.title ? `- ${c.title}:${c.source}\n` : `- ${c.source}\n`;
            } else {
              citations += `- ${c.document_title}\n`;
            }
          }
        }

        contentBlocksParam.push(block);
        continue;
      }

      if (block.type === "server_tool_use") {
        contentBlocksParam.push(block);
        continue;
      }

      if (block.type === "web_search_tool_result") {
        if (Array.isArray(block.content)) {
          for (const c of block.content) {
            sources += `- ${c.title}:${c.url}\n`;
          }
        }

        contentBlocksParam.push(block);
        continue;
      }

      if (block.type === "web_fetch_tool_result") {
        if (block.content.type === "web_fetch_result") {
          const title = block.content.content.title;
          sources += title ? `- ${title}:${block.content.url}\n` : `- ${block.content.url}\n`;
        }

        contentBlocksParam.push(block);
        continue;
      }
    }

    if (message.length > 0) {
      chatHistory.push({ role: "user", content: [{ type: "text", text: wrappedUserPrompt }] });
      chatHistory.push({ role: "assistant", content: contentBlocksParam });

      let claudeMessage = message;
      if (citations.length > 0) claudeMessage += `\n---\nCitations:\n${citations}`;
      if (sources.length > 0) claudeMessage += `\n---\nSources:\n${sources}`;

      await onOutput({ chatJid, message: claudeMessage });
      // TODO(history-entry-kind): when summary entries land in history (see runCompaction),
      // extend HistoryEntry with a `kind` field ("turn" | "summary") and skip saveHistoryEntry
      // for summary kinds — they must never reach the history file.
      await saveHistoryEntry({ chatJid, content: `${wrappedUserPrompt}\n` });
      await saveHistoryEntry({ chatJid, content: `${wrapMessage("Claude", claudeMessage)}\n` });
    }

    const promptTokensAfterThisTurn = await countTokens(chatHistory);
    logger.debug({ promptTokensAfterThisTurn }, "Tokens used on this turn");
    if (promptTokensAfterThisTurn > 200_000) {
      logger.warn({ chatJid, promptTokensAfterThisTurn }, "Total prompt tokens approaching model limit, consider pruning history");
      await runCompaction(chatJid);
    }

    if (message.length === 0) {
      logger.warn({ stop_reason: response.stop_reason }, "No text content in message, checking stop_reason");
      throw new Error("No message to process");
    }
  };

  const run = async (input: AgentInput): Promise<void> => {
    const chatJid = input.group.chatJid;
    logger.debug({ chatJid, input }, "Received input from the user");

    if (input.kind !== "text") {
      logger.warn({ inputKind: input.kind, chatJid }, "Non-text input kind received — no-op (only 'text' is implemented in v0)");
      await onError({ chatJid, message: `Input kind '${input.kind}' not implemented yet` });
      return;
    }

    if (!history[chatJid]) history[chatJid] = [];
    const wrappedUserPrompt = wrapMessage(input.userName, input.prompt);
    const chatHistory: Array<MessageParam> = [
      ...history[chatJid].map((h): MessageParam => ({ role: h.role, content: h.content })),
      { role: "user", content: [{ type: "text", text: wrappedUserPrompt }] },
    ];

    try {
      const response = await query(chatHistory);
      await handleResponse(chatJid, wrappedUserPrompt, response);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      logger.error({ err }, "Error during query iteration");
      await onError({ chatJid, message: err.message });
    }
  };

  return {
    run,
  };
};
