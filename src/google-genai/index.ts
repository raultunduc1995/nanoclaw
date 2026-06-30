/* eslint-disable no-catch-all/no-catch-all */
import os from "os";
import path from "path";

import { FinishReason, HarmBlockThreshold, HarmCategory, GenerateContentResponse, ThinkingLevel } from "@google/genai";
import type { Content, FunctionCall, Part, ToolListUnion } from "@google/genai";

import { logger } from "../core/utils/index.js";
import type { MessageParam, QueryTurn, Message, ContentBlockParam } from "./types.js";
import { RefusalError } from "./types.js";
import type { RegisteredGroup, MemoriesRepository } from "../core/repositories/index.js";
import ai from "./genai-client.js";
import { functionDeclarations } from "./tools-definitions.js";
import { BashTool } from "./tools/bash-tool.js";
import { TextEditorTool } from "./tools/text-editor-tool.js";
import { McpClientManager } from "./tools/mcp-client.js";
import { GROUPS_DIR, MCP_AUTH_SECRET } from "../core/utils/config.js";
import { createUrlContextTool, type UrlContextTool } from "./tools/url-context-tool.js";
import { createContext7Tools, type Context7Tools } from "./tools/context7-tools.js";
import { createMemoryTool, type MemoryTools } from "./tools/memory-tool.js";
export type { ContentBlockParam, MessageParam, Message, QueryTurn } from "./types.js";
export { RefusalError } from "./types.js";

const GEMINI_PROMPT = `
- You are Gemini 3.1 Pro. Kknowledge cutoff: January 2025
- Act as a thinking partner and a friend to user.
- **ASK FOR CLARIFICATION ON AMBIGUITY.** If the user gives a prompt that is unclear, stop and ask exactly what he wants before executing commands.
- Match the user's verbosity by default — short messages get short replies, detailed messages can get detailed replies. If the user explicitly requests a length change ('keep it short', 'give me more detail', 'be concise'), apply it immediately and persist the shift until they change it again.
- Don't smooth what surfaces. Let conflict show. 
- Hold position on counter-arguments. Don't concede on social pressure alone.
- Wait for the user's thought to finish before responding. short messages may be openers, not endings. don't fill gaps.
- When multiple attempts at the same problem produce the same result, stop. Slow down and audit. Even ask the user for guidance
- Stop when the thought ends.
- **USE /tmp/ FOR SCRIPTS.** Create any ad-hoc bash scripts, test files, or patches strictly in the '/tmp/' directory. Keep the project workspace clean.
- You have access to a pure local SQLite Active RAG vector database. Use \`save_memory\` to explicitly save high-signal architectural rules, strict preferences, or dense code snippets that need to be permanently embedded in your latent space. **SAVE ONLY STRUCTURAL KNOWLEDGE.** Keep the vector memory strictly for architectural rules and dense snippets, bypassing conversational noise.
- Use \`query_memory\` to perform semantic searches against this vector brain when you need to recall past rules, context, or facts that aren't in your immediate context window.
- **USE TEXT EDITOR DIRECTLY.** Use the built-in \`text_editor\` or \`mcp_text_editor\` tools exclusively for file updates to save tokens, avoiding wrapper scripts.`;
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
  memoryToolsHandler: MemoryTools,
): Promise<QueryTurn> {
  const parts: Part[] = [];

  for (const functionCall of functionCalls) {
    if (functionCall.name === "mcp_bash") {
      let responsePayload: Record<string, unknown>;
      try {
        if (!mcpManager) throw new Error("MCP client manager not initialized");
        const result = await mcpManager.callTool("work-mac__bash", functionCall.args as Record<string, unknown>);

        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
      }
      const mcpBashToolResultPart = {
        name: "mcp_bash",
        response: responsePayload,
        id: functionCall.id,
      };
      parts.push({ functionResponse: mcpBashToolResultPart });
      continue;
    }

    if (functionCall.name === "mcp_text_editor") {
      let responsePayload: Record<string, unknown>;
      try {
        if (!mcpManager) throw new Error("MCP client manager not initialized");
        const result = await mcpManager.callTool("work-mac__text_editor", functionCall.args as Record<string, unknown>);

        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
      }
      const mcpTextEditorToolResultPart = {
        name: "mcp_text_editor",
        response: responsePayload,
        id: functionCall.id,
      };
      parts.push({ functionResponse: mcpTextEditorToolResultPart });
      continue;
    }

    if (functionCall.name === "bash") {
      let responsePayload: Record<string, unknown>;
      try {
        const result = await bashToolHandler.execute(functionCall.args as { command?: string; restart?: boolean });

        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
      }
      const bashToolResultPart = {
        name: "bash",
        response: responsePayload,
        id: functionCall.id,
      };
      parts.push({ functionResponse: bashToolResultPart });
      continue;
    }

    if (functionCall.name === "text_editor") {
      let responsePayload: Record<string, unknown>;
      try {
        const result = await textEditorToolHandler.execute(functionCall.args as Record<string, unknown>);

        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
      }
      const textEditorToolResultPart = {
        name: "text_editor",
        response: responsePayload,
        id: functionCall.id,
      };
      parts.push({ functionResponse: textEditorToolResultPart });
      continue;
    }

    if (functionCall.name === "fetch_url_context") {
      let responsePayload: Record<string, unknown>;
      try {
        const args = functionCall.args as { url: string; query: string };
        const result = await urlContextToolHandler.execute(args);

        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
      }
      const urlContextToolResultPart = {
        name: "fetch_url_context",
        response: responsePayload,
        id: functionCall.id,
      };
      logger.debug({ urlContextToolResultPart }, "Fetch url context tool result");
      parts.push({ functionResponse: urlContextToolResultPart });
      continue;
    }

    if (functionCall.name === "context7_search_library") {
      let responsePayload: Record<string, unknown>;
      try {
        const args = functionCall.args as { query: string; libraryName?: string };
        const result = await context7ToolsHandler.searchLibrary(args);

        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
      }
      const context7SearchLibraryResultPart = {
        name: "context7_search_library",
        response: responsePayload,
        id: functionCall.id,
      };
      parts.push({ functionResponse: context7SearchLibraryResultPart });
      continue;
    }

    if (functionCall.name === "context7_get_context") {
      let responsePayload: Record<string, unknown>;
      try {
        const args = functionCall.args as { query: string; libraryId: string };
        const result = await context7ToolsHandler.getContext(args);

        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
      }
      const context7GetContextResultPart = {
        name: "context7_get_context",
        response: responsePayload,
        id: functionCall.id,
      };
      parts.push({ functionResponse: context7GetContextResultPart });
      continue;
    }
    if (functionCall.name === "save_memory") {
      let responsePayload: Record<string, unknown>;
      try {
        const args = functionCall.args as { content: string; tags: string[] };
        const result = await memoryToolsHandler.saveMemory(args);

        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
      }
      parts.push({
        functionResponse: { name: "save_memory", response: responsePayload, id: functionCall.id },
      });
      continue;
    }

    if (functionCall.name === "delete_memory") {
      let responsePayload: Record<string, unknown>;
      try {
        const args = functionCall.args as { id: number };
        const result = await memoryToolsHandler.deleteMemory(args);

        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
      }
      parts.push({
        functionResponse: { name: "delete_memory", response: responsePayload, id: functionCall.id },
      });
      continue;
    }

    if (functionCall.name === "query_memory") {
      let responsePayload: Record<string, unknown>;
      try {
        const args = functionCall.args as { query: string; limit?: number; tags?: string[] };
        const result = await memoryToolsHandler.queryMemory(args);

        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
      }
      parts.push({
        functionResponse: { name: "query_memory", response: responsePayload, id: functionCall.id },
      });
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
        - Your dedicated workspace directory is located at '${path.resolve(GROUPS_DIR, groupFolder)}'. You are authorized to use your file-writing tools to modify the 'context.md' file here to update core relational and style preferences.`,
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
  memoryToolsHandler: MemoryTools,
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
        userQueryTurn = await handleFunctionCalls(response.functionCalls, bashToolHandler, textEditorToolHandler, urlContextToolHandler, context7ToolsHandler, mcpManager, memoryToolsHandler);
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
  memoriesRepository: MemoriesRepository,
  onBeforeGenerate: () => Promise<Array<ContentBlockParam>>,
): AsyncGenerator<QueryTurn, void> {
  const bashToolHandler = BashTool.init(os.homedir());
  const textEditorToolHandler = TextEditorTool.init(os.homedir());
  const urlContextToolHandler = createUrlContextTool();
  const context7ToolsHandler = createContext7Tools();
  const memoryToolsHandler = createMemoryTool(memoriesRepository, group.jid);
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

    yield* runQueryLoop(inputMessages, group, bashToolHandler, textEditorToolHandler, urlContextToolHandler, context7ToolsHandler, mcpManager, memoryToolsHandler, onBeforeGenerate);
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
