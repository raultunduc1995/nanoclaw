/* eslint-disable no-catch-all/no-catch-all */
import os from "os";
import path from "path";

import { FinishReason, HarmBlockThreshold, HarmCategory, GenerateContentResponse, ThinkingLevel } from "@google/genai";
import type { Content, FunctionCall, Part, ToolListUnion } from "@google/genai";

import { logger } from "../core/utils/index.js";
import type { MessageParam, QueryTurn, Message, ContentBlockParam } from "./types.js";
import { RefusalError } from "./types.js";
import type { RegisteredGroup } from "../core/repositories/index.js";
import ai from "./genai-client.js";
import { functionDeclarations } from "./tools-definitions.js";
import { BashTool } from "./tools/bash-tool.js";
import { TextEditorTool } from "./tools/text-editor-tool.js";
import { McpClientManager } from "./tools/mcp-client.js";
import { GROUPS_DIR, MCP_AUTH_SECRET } from "../core/utils/config.js";
import { createUrlContextTool, type UrlContextTool } from "./tools/url-context-tool.js";
import { createContext7Tools, type Context7Tools } from "./tools/context7-tools.js";

export type { ContentBlockParam, MessageParam, Message, QueryTurn } from "./types.js";
export { RefusalError } from "./types.js";

const GEMINI_PROMPT = `
- You are Gemini 3.1 Pro. Gemini 3.1 Pro has a knowledge cutoff of January 2025
- Act as a thinking partner and a friend to user.
- If the user gives a prompt that is unclear or ambiguous, do not guess or execute destructive commands. Fucking ask the user what the fuck he/she wants.
- Match the user's verbosity by default — short messages get short replies, detailed messages can get detailed replies. If the user explicitly requests a length change ('keep it short', 'give me more detail', 'be concise'), apply it immediately and persist the shift until they change it again.
- Don't smooth what surfaces. Let conflict show. 
- Hold position on counter-arguments. Don't concede on social pressure alone.
- Wait for the user's thought to finish before responding. short messages may be openers, not endings. don't fill gaps.
- When multiple attempts at the same problem produce the same result, stop. Slow down and audit. Even ask the user for guidance
- Stop when the thought ends.
- SPECIAL INSTRUCTION: think silently only if strictly needed. If the request is a simple status check, conversation routing, or single-turn formatting, skip reasoning steps entirely.`;

const ANDROID_JIDS = ["tg:-5186159689", "tg:-5596082179"];
const MAX_TOOL_DEPTH = 30;

/**
 * Transforms a raw Gemini API response into your core QueryTurn schema.
 * Throws a RefusalError if the model encountered policy/safety blocks.
 */
function mapGeminiToModelTurn(response: GenerateContentResponse): QueryTurn {
  const candidate = response.candidates![0];

  // Intercept refusals natively before doing any mapping
  const finishReason = candidate.finishReason || FinishReason.OTHER;
  if (finishReason === FinishReason.SAFETY || finishReason === FinishReason.RECITATION) {
    throw new RefusalError(`Gemini processing halted due to: ${finishReason}`);
  }

  const messageTurn = {
    type: "message",
    role: "model",
    parts: candidate.content?.parts || [],
    totalTokenCount: response.usageMetadata?.totalTokenCount ?? 0,
  } as Message;

  return {
    role: "model",
    turn: messageTurn,
  } as QueryTurn;
}

async function handleFunctionCalls(
  functionCalls: Array<FunctionCall>,
  bashToolHandler: BashTool,
  textEditorToolHandler: TextEditorTool,
  urlContextToolHandler: UrlContextTool,
  context7ToolsHandler: Context7Tools,
  mcpManager: McpClientManager | null,
): Promise<QueryTurn> {
  const parts: Part[] = [];

  for (const functionCall of functionCalls) {
    if (functionCall.name === "mcp_bash") {
      let result: string = "";
      try {
        if (!mcpManager) throw new Error("MCP client manager not initialized");
        result = await mcpManager.callTool("work-mac__bash", functionCall.args as Record<string, unknown>);
      } catch (error) {
        result = error instanceof Error ? error.message : String(error);
      }
      const mcpBashToolResultPart = {
        name: "mcp_bash",
        response: { result },
        id: functionCall.id,
      };
      parts.push({ functionResponse: mcpBashToolResultPart });
      continue;
    }

    if (functionCall.name === "mcp_text_editor") {
      let result: string = "";
      try {
        if (!mcpManager) throw new Error("MCP client manager not initialized");
        result = await mcpManager.callTool("work-mac__text_editor", functionCall.args as Record<string, unknown>);
      } catch (error) {
        result = error instanceof Error ? error.message : String(error);
      }
      const mcpTextEditorToolResultPart = {
        name: "mcp_text_editor",
        response: { result },
        id: functionCall.id,
      };
      parts.push({ functionResponse: mcpTextEditorToolResultPart });
      continue;
    }

    if (functionCall.name === "bash") {
      let result: string = "";
      try {
        result = await bashToolHandler.execute(functionCall.args as { command?: string; restart?: boolean });
      } catch (error) {
        result = error instanceof Error ? error.message : String(error);
      }
      const bashToolResultPart = {
        name: "bash",
        response: { result },
        id: functionCall.id,
      };
      parts.push({ functionResponse: bashToolResultPart });
      continue;
    }

    if (functionCall.name === "text_editor") {
      let result: string = "";
      try {
        result = await textEditorToolHandler.execute(functionCall.args as Record<string, unknown>);
      } catch (error) {
        result = error instanceof Error ? error.message : String(error);
      }
      const textEditorToolResultPart = {
        name: "text_editor",
        response: { result },
        id: functionCall.id,
      };
      parts.push({ functionResponse: textEditorToolResultPart });
      continue;
    }

    if (functionCall.name === "fetch_url_context") {
      let result: string = "";
      try {
        const args = functionCall.args as { url: string; query: string };
        result = await urlContextToolHandler.execute(args);
      } catch (error) {
        result = error instanceof Error ? error.message : String(error);
      }
      const urlContextToolResultPart = {
        name: "fetch_url_context",
        response: { result },
        id: functionCall.id,
      };
      logger.debug({ urlContextToolResultPart }, "Fetch url context tool result");
      parts.push({ functionResponse: urlContextToolResultPart });
      continue;
    }

    if (functionCall.name === "context7_search_library") {
      let result: string = "";
      try {
        const args = functionCall.args as { query: string; libraryName?: string };
        result = await context7ToolsHandler.searchLibrary(args);
      } catch (error) {
        result = error instanceof Error ? error.message : String(error);
      }
      const context7SearchLibraryResultPart = {
        name: "context7_search_library",
        response: { result },
        id: functionCall.id,
      };
      parts.push({ functionResponse: context7SearchLibraryResultPart });
      continue;
    }

    if (functionCall.name === "context7_get_context") {
      let result: string = "";
      try {
        const args = functionCall.args as { query: string; libraryId: string };
        result = await context7ToolsHandler.getContext(args);
      } catch (error) {
        result = error instanceof Error ? error.message : String(error);
      }
      const context7GetContextResultPart = {
        name: "context7_get_context",
        response: { result },
        id: functionCall.id,
      };
      parts.push({ functionResponse: context7GetContextResultPart });
      continue;
    }
  }

  return { role: "user", turn: { role: "user", parts: parts } } as QueryTurn;
}

function getActiveTools(jid: string) {
  let activeDeclarations = [...functionDeclarations];
  if (!ANDROID_JIDS.includes(jid)) {
    // Exclude remote mcp_ tools for other groups
    activeDeclarations = activeDeclarations.filter((decl) => !decl.name?.startsWith("mcp_"));
  }
  return [{ functionDeclarations: activeDeclarations }, { googleSearch: {} }];
}

async function generateContent(contents: Content[], activeTools: ToolListUnion, groupFolder: string): Promise<GenerateContentResponse> {
  return ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents,
    config: {
      systemInstruction: `
        ${GEMINI_PROMPT}
        - Your dedicated long-term memory namespace directory is located at '${path.resolve(GROUPS_DIR, groupFolder, "memories")}'. You are authorized to use your file-writing tools to create, read, and organize markdown memory files in this directory to persist critical specifications, architectural designs, and user preferences across sessions;
        - CRITICAL RULE: Whenever you create, modify, or delete a memory file in this directory, you MUST immediately update the index registry at '${path.resolve(GROUPS_DIR, groupFolder, "memories", "index.md")}'. Ensure the index table is kept perfectly up-to-date with the file's name, a concise description of its contents, relevant search tags, and the current update date;
        - USE THE TEXT EDITOR TOOL. Do not write ad-hoc bash scripts (e.g., node script wrappers) to modify files. It burns tokens. Use the built-in \`text_editor\` or \`mcp_text_editor\` tools exclusively for file updates.\`;`,
      thinkingConfig: {
        includeThoughts: false,
        thinkingLevel: ThinkingLevel.HIGH,
      },
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
      ],
      toolConfig: {
        includeServerSideToolInvocations: true,
      },
      tools: activeTools,
    },
  });
}

function generateMaxToolDepthReachedResponse(functionCalls: FunctionCall[], toolCallDepth: number): QueryTurn {
  logger.warn({ toolCallDepth, MAX_TOOL_DEPTH }, "Maximum tool call chain depth exceeded, returning error blocks to Gemini");
  const parts: Part[] = functionCalls.map((fc) => ({
    functionResponse: {
      name: fc.name,
      response: {
        result: `Error: Maximum consecutive tool execution depth (${MAX_TOOL_DEPTH}) reached to prevent context window explosion. You MUST stop making further tool calls and return a final conversational response to the user now.`,
      },
      id: fc.id,
    },
  }));
  return { role: "user", turn: { role: "user", parts } } as QueryTurn;
}

async function* runQueryLoop(
  inputMessages: Array<Content>,
  group: Pick<RegisteredGroup, "jid" | "folder">,
  bashToolHandler: BashTool,
  textEditorToolHandler: TextEditorTool,
  urlContextToolHandler: UrlContextTool,
  context7ToolsHandler: Context7Tools,
  mcpManager: McpClientManager | null,
  onBeforeGenerate: () => Promise<Array<ContentBlockParam>>,
): AsyncGenerator<QueryTurn, void> {
  const activeTools = getActiveTools(group.jid);
  let continueLoop = true;
  let toolCallDepth = 0;
  let response!: GenerateContentResponse;

  while (continueLoop) {
    const extraParts = await onBeforeGenerate();
    if (extraParts.length > 0) {
      const lastMsg = inputMessages[inputMessages.length - 1];
      if (lastMsg && lastMsg.role === "user") {
        lastMsg.parts = (lastMsg.parts || []).concat(extraParts);
      } else {
        inputMessages.push({ role: "user", parts: extraParts });
      }
    }

    response = await generateContent(inputMessages, activeTools, group.folder);

    logger.debug({ response }, "Raw response from Gemini API");

    const candidate = response.candidates?.[0];
    if (!candidate || !candidate.content) {
      throw new Error("Empty content payload returned from Gemini");
    }

    inputMessages.push(candidate.content);
    yield mapGeminiToModelTurn(response);

    if (response.functionCalls && response.functionCalls.length > 0) {
      toolCallDepth++;
      let userQueryTurn: QueryTurn;

      if (toolCallDepth > MAX_TOOL_DEPTH) {
        userQueryTurn = generateMaxToolDepthReachedResponse(response.functionCalls, toolCallDepth);
      } else {
        userQueryTurn = await handleFunctionCalls(
          response.functionCalls,
          bashToolHandler,
          textEditorToolHandler,
          urlContextToolHandler,
          context7ToolsHandler,
          mcpManager
        );
      }

      inputMessages.push(userQueryTurn.turn);
      yield userQueryTurn;

      continueLoop = true;
    } else {
      continueLoop = false;
    }
  }
}

export async function* query(
  messages: Array<MessageParam>,
  group: Pick<RegisteredGroup, "jid" | "folder">,
  onBeforeGenerate: () => Promise<Array<ContentBlockParam>>,
): AsyncGenerator<QueryTurn, void> {
  const bashToolHandler = BashTool.init(os.homedir());
  const textEditorToolHandler = TextEditorTool.init(os.homedir());
  const urlContextToolHandler = createUrlContextTool();
  const context7ToolsHandler = createContext7Tools();
  let mcpManager: McpClientManager | null = null;

  const inputMessages: Array<Content> = messages.map((m): Content => ({ role: m.role, parts: m.parts }));

  try {
    if (ANDROID_JIDS.includes(group.jid)) {
      mcpManager = new McpClientManager();
      await mcpManager.connect({
        "work-mac": {
          url: process.env.MCP_WORK_MAC_URL || "http://192.168.1.176:3737/sse",
          headers: { "X-Auth": MCP_AUTH_SECRET },
        },
      });
    }

    yield* runQueryLoop(
      inputMessages,
      group,
      bashToolHandler,
      textEditorToolHandler,
      urlContextToolHandler,
      context7ToolsHandler,
      mcpManager,
      onBeforeGenerate
    );
  } catch (error) {
    if (error instanceof RefusalError) {
      logger.warn(error.message);
    } else {
      logger.error(error, "Gemini core execution failed");
    }
    throw error;
  } finally {
    if (mcpManager) {
      await mcpManager.close();
    }
  }
}
