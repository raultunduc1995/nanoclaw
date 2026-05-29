/* eslint-disable no-catch-all/no-catch-all */
import { Temporal } from "@js-temporal/polyfill";
import { query, countTokens, type ContentBlockParam, RefusalError, type QueryTurn } from "../client-sdk/index.js";
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
}

export const createAgent = (deps: AgentDeps): Agent => {
  const { onOutput, onError } = deps;
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
    history[chatJid] = [];
  };

  const handleResponse = async (chatJid: string, response: QueryTurn) => {
    const { role, turn } = response;

    if (role === "user") {
      history[chatJid].push(turn);
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

    history[chatJid].push({ role: "assistant", content: contentBlocksParam });

    const isResponseValid = message.length > 0 || citations.length > 0 || sources.length > 0;
    if (isResponseValid) {
      let claudeMessage = message;
      if (citations.length > 0) claudeMessage += `\n---\nCitations:\n${citations}`;
      if (sources.length > 0) claudeMessage += `\n---\nSources:\n${sources}`;

      await onOutput({ chatJid, message: claudeMessage });
    }
  };

  const checkContextWindowTokens = async (chatJid: string) => {
    const promptTokensAfterThisTurn = await countTokens(history[chatJid]);
    logger.debug({ promptTokensAfterThisTurn }, "Tokens used on this turn");
    if (promptTokensAfterThisTurn >= 200_000) {
      logger.warn({ chatJid, promptTokensAfterThisTurn }, "Total prompt tokens approaching model limit, consider pruning history");
      await runCompaction(chatJid);
    }
  };

  const run = async (input: AgentInput): Promise<void> => {
    const chatJid = input.group.jid;
    logger.debug({ chatJid, input }, "Received input from the user");

    if (!history[chatJid]) history[chatJid] = [];
    const rollbackLength = history[chatJid].length;
    const wrappedUserPrompt = wrapMessage(input.userName, input.prompt);
    const content: Array<ContentBlockParam> =
      input.kind === "image"
        ? [
            { type: "image", source: { type: "base64", media_type: input.imageMimeType, data: input.imageBase64 } },
            { type: "text", text: wrappedUserPrompt },
          ]
        : [{ type: "text", text: wrappedUserPrompt }];
    history[chatJid].push({ role: "user", content });

    try {
      for await (const response of query(history[chatJid], input.group)) {
        await handleResponse(chatJid, response);
      }
      await checkContextWindowTokens(chatJid);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      let errorMessage: string;
      if (err instanceof RefusalError) {
        logger.error({ chatJid }, "Refusal - clearing in-memory history");
        history[chatJid] = [];
        errorMessage = "Claude refused to answer";
      } else {
        logger.error({ err }, "Error during query iteration");
        history[chatJid].length = rollbackLength;
        errorMessage = err.message;
      }
      await onError({ chatJid, message: errorMessage });
    }
  };

  return {
    run,
  };
};
