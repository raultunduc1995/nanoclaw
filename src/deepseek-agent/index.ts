/* eslint-disable no-catch-all/no-catch-all */
import { Temporal } from "@js-temporal/polyfill";
import { query, uploadMediaFile } from "../openai/index.js";
import type { ChatCompletionContentPart, MessageParam, QueryTurn } from "../openai/index.js";
import type { ImageMimeType } from "../core/common/index.js";
import { logger, TIMEZONE } from "../core/utils/index.js";
import type { RegisteredGroup, MemoriesRepository } from "../core/repositories/index.js";

export type DeepSeekAgentInput = DeepSeekAgentTextInput | DeepSeekAgentImageInput;

export interface DeepSeekAgent {
  runQuery: (input: DeepSeekAgentInput) => Promise<void>;
  runCompaction: (group: Pick<RegisteredGroup, "jid" | "folder" | "thinkingLevel">) => Promise<void>;
}

interface DeepSeekAgentInputBase {
  userName: string;
  prompt: string;
  group: Pick<RegisteredGroup, "jid" | "folder" | "thinkingLevel">;
}

interface DeepSeekAgentTextInput extends DeepSeekAgentInputBase {
  kind: "text";
}

interface DeepSeekAgentImageInput extends DeepSeekAgentInputBase {
  kind: "image";
  blob: Blob;
  mimeType: ImageMimeType;
}

const formatDateTime = (): string => Temporal.Now.zonedDateTimeISO(TIMEZONE).toPlainDateTime().toString({ fractionalSecondDigits: 0 });

const wrapMessage = (senderName: string, content: string): string => `[${formatDateTime()}] ${senderName}:\n${content}`;

const createUserMessage = async (input: DeepSeekAgentInput): Promise<MessageParam> => {
  const content: string | Array<ChatCompletionContentPart> = await (async () => {
    switch (input.kind) {
      case "text":
        return wrapMessage(input.userName, input.prompt);
      case "image": {
        const fileId = await uploadMediaFile(input.blob, input.mimeType);
        return [
          { type: "text", text: wrapMessage(input.userName, input.prompt) },
          { type: "file", file_id: fileId },
        ];
      }
    }
  })();

  return {
    role: "user",
    name: input.userName,
    content,
  };
};

interface DeepSeekAgentDeps {
  memoriesRepository: MemoriesRepository;
  onOutput: (result: { chatJid: string; message: string }) => Promise<void>;
  onError: (error: { chatJid: string; message: string }) => Promise<void>;
  loadHistory: (jid: string) => Promise<MessageParam[]>;
  appendHistory: (jid: string, seq: number, entry: MessageParam) => Promise<void>;
  deleteHistoryFrom: (jid: string, fromSeq: number) => Promise<void>;
  clearHistory: (jid: string) => Promise<void>;
}

export const createDeepSeekAgent = (deps: DeepSeekAgentDeps): DeepSeekAgent => {
  const { onOutput, onError } = deps;

  const appendToHistory = async (chatJid: string, history: Array<MessageParam>, entry: MessageParam) => {
    history.push(entry);
    await deps.appendHistory(chatJid, history.length, entry);
  };

  const handleResponse = async (chatJid: string, history: Array<MessageParam>, response: QueryTurn) => {
    if (Array.isArray(response)) {
      logger.debug({ response }, "DeepSeek tool results");
      for (const toolMessage of response) {
        await appendToHistory(chatJid, history, toolMessage);
      }
      return;
    }

    const assistantMsg = response.choices[0].message;

    await appendToHistory(chatJid, history, {
      role: "assistant",
      content: assistantMsg.content,
      reasoning_content: assistantMsg.reasoning_content,
      tool_calls: assistantMsg.tool_calls,
      audio: assistantMsg.audio,
      function_call: assistantMsg.function_call,
      refusal: assistantMsg.refusal,
    });

    const outputText = assistantMsg.content?.trim();
    if (outputText && outputText.length > 0) {
      await onOutput({ chatJid, message: outputText });
    }
  };

  const handleError = async (chatJid: string, e: unknown) => {
    const err = e instanceof Error ? e : new Error(String(e));
    logger.error({ chatJid, err }, "DeepSeek error");
    await onError({ chatJid, message: err.message });
  };

  const runInternal = async (history: Array<MessageParam>, input: DeepSeekAgentInput): Promise<QueryTurn | undefined> => {
    const chatJid: string = input.group.jid;
    const rollbackLength = history.length;

    try {
      if (input.kind === "text" && input.prompt.length === 0) return undefined;

      const userMessage = await createUserMessage(input);

      logger.debug({ userMessage }, "Running DeepSeek user query");
      await appendToHistory(chatJid, history, userMessage);

      let lastTurn: QueryTurn | undefined;
      for await (const response of query([...history], input.group)) {
        lastTurn = response;
        await handleResponse(chatJid, history, response);
      }

      return lastTurn;
    } catch (e) {
      history.length = rollbackLength;
      await deps.deleteHistoryFrom(chatJid, rollbackLength + 1);
      await handleError(chatJid, e);
      return undefined;
    }
  };

  const runCompaction = async (group: Pick<RegisteredGroup, "jid" | "folder" | "thinkingLevel">) => {
    const chatJid: string = group.jid;
    logger.warn({ chatJid }, "Total prompt tokens approaching model limit, running compaction");

    const queryTurn: QueryTurn | undefined = await runInternal(await deps.loadHistory(chatJid), {
      kind: "text",
      userName: "System",
      prompt: `Summarize the entire conversation and send it back to me.
          Include: key topics discussed, decisions made, technical details, action items, and any important context for continuing the conversation.
          Write a dense, factual summary. Write the summary in the same language used in the conversation.`,
      group,
    });
    if (!queryTurn) return;

    await deps.clearHistory(chatJid);

    let summary: string = "";
    if (!Array.isArray(queryTurn) && queryTurn.choices[0]?.message.content) {
      summary = queryTurn.choices[0].message.content.trim();
    }
    if (summary.length === 0) return;

    await runInternal(await deps.loadHistory(chatJid), {
      kind: "text",
      userName: "System",
      prompt: `Context was compacted. Read the convo summary below:\n\n${summary}`,
      group,
    });
  };

  const runQuery = async (input: DeepSeekAgentInput): Promise<void> => {
    const chatJid = input.group.jid;
    const history = await deps.loadHistory(chatJid);
    const completion = await runInternal(history, input);

    if (!completion || Array.isArray(completion) || !completion.usage) return;

    const usage = completion.usage;
    const totalTokens = usage.total_tokens ?? 0;
    const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
    const inputTokens = usage.prompt_tokens ?? 0;
    const uncached = inputTokens - cachedTokens;
    const output = usage.completion_tokens ?? 0;
    const cacheHitTokens = usage.prompt_cache_hit_tokens ?? 0;
    const cacheMissTokens = usage.prompt_cache_miss_tokens ?? 0;
    await onOutput({
      chatJid,
      message: `Group JID: ${input.group.jid}\nFolder: ${input.group.folder}\nThinking Level: ${input.group.thinkingLevel}\nTotal: ${totalTokens}\nCached: ${cachedTokens}\nUncached-Input: ${uncached}\nCache-Hit: ${cacheHitTokens}\nCache-Miss: ${cacheMissTokens}\nOutput: ${output}`,
    });
    if (totalTokens >= 900_000) await runCompaction(input.group);
  };

  return {
    runQuery,
    runCompaction,
  };
};
