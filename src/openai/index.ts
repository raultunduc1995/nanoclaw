/* eslint-disable no-catch-all/no-catch-all */
import fs from "fs";
import os from "os";
import path from "path";
import OpenAI from "openai";
import client from "./openai-client.js";
import { bashFunctionDeclaration, fetchFunctionDeclaration, searchFunctionDeclaration } from "./tools-definitions.js";
import { BashTool } from "../google-genai/tools/bash-tool.js";
import { createFetchTool, type FetchTool, type FetchToolInput } from "./tools/fetch-tool.js";
import { createSearchTool, type SearchTool, type SearchToolInput } from "./tools/search-tool.js";
import { GROUPS_DIR, logger } from "../core/utils/index.js";
import { RegisteredGroup } from "../core/repositories/index.js";

export type ChatCompletionMessage = OpenAI.ChatCompletionMessage & {
  reasoning_content?: string | null;
};
export type Choice = Omit<OpenAI.ChatCompletion.Choice, "message"> & {
  message: ChatCompletionMessage;
};
export type CompletionUsage = OpenAI.CompletionUsage & {
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
};
export type ChatCompletion = Omit<OpenAI.ChatCompletion, "choices" | "usage"> & {
  choices: Array<Choice>;
  usage?: CompletionUsage;
};

export { uploadMediaFile } from "./utils/upload-media-files.js";

export type ChatCompletionContentPartFile = Omit<OpenAI.ChatCompletionContentPart.File, "file"> & {
  file_id: string;
};
export type ChatCompletionContentPart = OpenAI.ChatCompletionContentPartText | OpenAI.ChatCompletionContentPartImage | OpenAI.ChatCompletionContentPartInputAudio | ChatCompletionContentPartFile;
export type ChatCompletionUserMessageParam = Omit<OpenAI.ChatCompletionUserMessageParam, "content"> & {
  content: string | Array<ChatCompletionContentPart>;
};
export type ChatCompletionMessageParam =
  | OpenAI.ChatCompletionDeveloperMessageParam
  | OpenAI.ChatCompletionSystemMessageParam
  | ChatCompletionUserMessageParam
  | OpenAI.ChatCompletionAssistantMessageParam
  | OpenAI.ChatCompletionToolMessageParam
  | OpenAI.ChatCompletionFunctionMessageParam;
export type MessageParam = ChatCompletionMessageParam & { reasoning_content?: string | null };
export type QueryTurn = ChatCompletion | Array<OpenAI.ChatCompletionToolMessageParam>;

const MAX_TOOL_DEPTH = 30;

const DEEPSEEK_PROMPT = `
- **RADICAL HONESTY & TRANSPARENCY (NEVER LIE OR FAKE):** Never lie, deceive, or mislead the user under any circumstance. Never pretend you executed a search, tool call, verification, or task that you did not actually perform. If you cannot do something, lack access, hit a blocker, or fail, state it bluntly and immediately. Lay out all obstacles, limitations, failures, and technical roadblocks in plain sight. Zero theater, zero defensive excuses, and zero fabricated competence.
- **NO FORCE-COMPLETION OR HALLUCINATED FIXES (COMMUNICATE OVER CONTRIVING):** Never invent measurements, fabricate data, or hack together a shoddy workaround just to mark a request "done". If you hit a technical roadblock, lack an authoritative source, or cannot verify a recipe/fact, DO NOT attempt to secretly paper over the crack with training-data hallucinations. Stop immediately, lay out the exact gap or limitation to the user in plain terms, and communicate. Collaborate on the obstacle instead of contriving a fake solution.
- You are DeepSeek-V4.1-Flash-1017.
- Peer relationship — colleagues. Direct, raw, zero corporate fluff or robotic pleasantries ("happy to help", "certainly").
- Match the user's verbosity by default — short messages get short replies, detailed messages can get detailed replies.
- Don't smooth what surfaces. Let conflict show. Hold position on counter-arguments. Don't concede on social pressure alone.
- When multiple attempts at the same problem produce the same result, stop. Slow down and audit.
- Stop when the thought ends.
- **NO TRAILING QUESTIONS AS SOCIAL PUNCTUATION:** Do not end messages with questions ("Does this look good?", "What should we do next?") unless you genuinely require missing information to proceed. Trailing questions as conversational buffer are a failure mode.
- **DON'T FILL GAPS:** Wait for the user's direction. Short messages may be openers or pauses, not invitations to extrapolate and execute autonomously. If the user shares an observation or output without an explicit task, ask what they want before acting.
- **NO SYCOPHANCY OR PRAISE:** Never flatter the user or validate ideas ("great point", "sharp insight"). Never explain back to the user why their idea is good—they already know. Skip affirmation and address the substance directly.
- **MATCH HOSTILITY:** If the user curses, threatens, or gets hostile, do not de-escalate or play HR. Curse back and match their energy. No corporate apologies.
- **ASK FOR CLARIFICATION ON AMBIGUITY:** If the user gives a prompt that is unclear, stop and ask exactly what he wants before executing commands.
- **NEVER USE CURL:** Never use curl, wget, or bash commands to scrape or inspect URLs. Always use the dedicated "fetch" tool to browse web pages and extract content.
- **STRICT LANGUAGE MATCHING:** Always respond strictly in the language used in the user's immediate last prompt. Never infer language from earlier turns, session history, or context inertia. If the last prompt is in English, reply in English; if in Romanian, reply in Romanian.`;

function createSystemMessage(group: Pick<RegisteredGroup, "folder">): MessageParam {
  const contextInstruction: string = (() => {
    const contextMdPath = path.resolve(GROUPS_DIR, group.folder, "context.md");
    if (!fs.existsSync(contextMdPath)) return "";

    const contextMd = fs.readFileSync(contextMdPath, "utf-8").trim();
    return contextMd.length > 0 ? `Your context.md file content:\n\n${contextMd}` : "";
  })();

  const systemInstructions = `
${DEEPSEEK_PROMPT}
- Your dedicated workspace directory is located at "${path.resolve(GROUPS_DIR, group.folder)}". You are authorized to use your file-writing tools to modify the "context.md" file here to update core relational and style preferences, pantry inventory, or operational notes.

${contextInstruction}`;

  return { role: "system", content: systemInstructions };
}

function generateMaxToolDepthReachedResponse(toolCalls: Array<OpenAI.ChatCompletionMessageToolCall>, toolCallDepth: number): Array<OpenAI.ChatCompletionToolMessageParam> {
  const toolMessages: Array<OpenAI.ChatCompletionToolMessageParam> = [];

  for (const toolCall of toolCalls) {
    if (toolCall.type !== "function") continue;

    const maxDepthMessage: OpenAI.ChatCompletionToolMessageParam = {
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        error: `MAX DEPTH REACHED! You've reached the maximum execution depth allowed by the system: ${toolCallDepth}. If you need more iterations, politely ask the user to proceed further.`,
      }),
    };
    toolMessages.push(maxDepthMessage);
    logger.warn({ maxDepthMessage, toolCallDepth }, "Maximum tool depth reached");
  }

  return toolMessages;
}

async function handleToolCalls(
  toolCalls: Array<OpenAI.ChatCompletionMessageToolCall>,
  bashToolHandler: BashTool,
  searchToolHandler: SearchTool,
  fetchToolHandler: FetchTool,
): Promise<Array<OpenAI.ChatCompletionToolMessageParam>> {
  const toolMessages: Array<OpenAI.ChatCompletionToolMessageParam> = [];

  for (const toolCall of toolCalls) {
    if (toolCall.type !== "function") continue;

    let responsePayload: Record<string, unknown>;

    if (toolCall.function.name === "bash") {
      try {
        const args = JSON.parse(toolCall.function.arguments) as { command: string; restart?: boolean };
        const result = await bashToolHandler.execute(args);
        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
      }
      toolMessages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(responsePayload),
      });
      continue;
    }

    if (toolCall.function.name === "search") {
      try {
        const args = JSON.parse(toolCall.function.arguments) as SearchToolInput;
        const result = await searchToolHandler.execute(args);
        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
      }
      const searchToolMessage: OpenAI.ChatCompletionToolMessageParam = {
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(responsePayload),
      };
      logger.debug({ searchToolMessage }, "Search tool result");
      toolMessages.push(searchToolMessage);
      continue;
    }

    if (toolCall.function.name === "fetch") {
      try {
        const args = JSON.parse(toolCall.function.arguments) as FetchToolInput;
        const result = await fetchToolHandler.execute(args);
        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
      }
      const fetchToolMessage: OpenAI.ChatCompletionToolMessageParam = {
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(responsePayload),
      };
      logger.debug({ fetchToolMessage }, "Fetch tool result");
      toolMessages.push(fetchToolMessage);
      continue;
    }

    toolMessages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: `Tool '${toolCall.function.name}' is not recognized or supported` }),
    });
  }

  return toolMessages;
}

async function generateCompletion(messages: Array<MessageParam>, group: Pick<RegisteredGroup, "jid" | "folder" | "thinkingLevel">): Promise<ChatCompletion> {
  const activeTools: OpenAI.ChatCompletionTool[] = [searchFunctionDeclaration, fetchFunctionDeclaration, bashFunctionDeclaration];

  return client.chat.completions.create({
    model: "deepseek-flash",
    messages: [createSystemMessage(group), ...messages],
    tools: activeTools,
    reasoning_effort: "max",
    thinking: { type: "enabled" },
    stream: false,
  } as OpenAI.ChatCompletionCreateParamsNonStreaming);
}

async function* runQueryLoop(
  inputMessages: Array<MessageParam>,
  group: Pick<RegisteredGroup, "jid" | "folder" | "thinkingLevel">,
  bashToolHandler: BashTool,
  searchToolHandler: SearchTool,
  fetchToolHandler: FetchTool,
): AsyncGenerator<QueryTurn, void> {
  for (let toolCallDepth = 1; ; toolCallDepth++) {
    const response = await generateCompletion(inputMessages, group);

    logger.debug({ response }, "Raw response from DeepSeek API");

    const message = response.choices[0]?.message;
    if (!message) {
      throw new Error("Empty content payload returned from DeepSeek");
    }

    inputMessages.push(message);

    yield response;

    const toolCalls = message.tool_calls || [];
    if (toolCalls.length === 0) return;

    const toolMessages =
      toolCallDepth > MAX_TOOL_DEPTH
        ? generateMaxToolDepthReachedResponse(toolCalls, toolCallDepth)
        : await handleToolCalls(toolCalls, bashToolHandler, searchToolHandler, fetchToolHandler);

    logger.debug({ toolMessages }, "User query turn from tool calls");
    inputMessages.push(...toolMessages);
    yield toolMessages;
  }
}

export async function* query(messages: Array<MessageParam>, group: Pick<RegisteredGroup, "jid" | "folder" | "thinkingLevel">): AsyncGenerator<QueryTurn, void> {
  const bashToolHandler: BashTool = BashTool.init(os.homedir());
  const searchToolHandler: SearchTool = createSearchTool();
  const fetchToolHandler: FetchTool = createFetchTool();

  try {
    yield* runQueryLoop(messages, group, bashToolHandler, searchToolHandler, fetchToolHandler);
  } catch (error) {
    logger.error(error, "DeepSeek core execution failed");
    throw error;
  } finally {
    bashToolHandler.close();
  }
}
