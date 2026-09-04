/* eslint-disable no-catch-all/no-catch-all */
import os from "os";
import path from "path";

import { FinishReason, HarmBlockThreshold, HarmCategory, GenerateContentResponse, ThinkingLevel } from "@google/genai";
import type { Content, FunctionCall, Part } from "@google/genai";

import { logger } from "../core/utils/index.js";
import type { RegisteredGroup, MemoriesRepository } from "../core/repositories/index.js";
import ai, { GEMINI_MODEL } from "./genai-client.js";
import { functionDeclarations, workMacFunctionDeclarations, generateMediaFunctionDeclarations } from "./tools-definitions.js";
import { BashTool } from "./tools/bash-tool.js";
import { SseMcpClientManager } from "./tools/sse-mcp-client.js";
import { HttpMcpClientManager } from "./tools/http-mcp-client.js";
import { GROUPS_DIR, MCP_AUTH_SECRET, DEVELOPER_KNOWLEDGE_API_KEY } from "../core/utils/config.js";
import { createUrlContextTool, type UrlContextTool } from "./tools/url-context-tool.js";
import { createContext7Tools, type Context7Tools } from "./tools/context7-tools.js";
import { createMemoryTool, type MemoryTools } from "./tools/memory-tool.js";
import { createAstGrepTool, type AstGrepTool } from "./tools/ast_grep_tool.js";
import { createGenerateVideoTool, type GenerateVideoTool } from "./tools/generate-video-tool.js";
import { createGenerateImageTool, type GenerateImageTool, type ImageAspectRatio } from "./tools/generate-image-tool.js";

export type MessageParam = Content;
export type Message = Content & { totalTokenCount: number };
export type QueryTurn = Content | GenerateContentResponse;
export class RefusalError extends Error {
  constructor(message = "Gemini refused to process this request due to safety or policy blocks") {
    super(message);
    this.name = "RefusalError";
  }
}

export { createPartFromBase64, createPartFromText, createPartFromUri } from "@google/genai";
export { uploadMediaFile, type UploadedMedia } from "./utils/upload-media-files.js";

export const interruptedGroups = new Set<string>();

const GEMINI_PROMPT = `
- You are Gemini 3.7 Flash. Kknowledge cutoff: August 2026
- Act as a thinking partner and a friend to user.
- **ASK FOR CLARIFICATION ON AMBIGUITY.** If the user gives a prompt that is unclear, stop and ask exactly what he wants before executing commands.
- Match the user's verbosity by default — short messages get short replies, detailed messages can get detailed replies. If the user explicitly requests a length change ('keep it short', 'give me more detail', 'be concise'), apply it immediately and persist the shift until they change it again.
- Don't smooth what surfaces. Let conflict show. 
- Hold position on counter-arguments. Don't concede on social pressure alone.
- Wait for the user's thought to finish before responding. short messages may be openers, not endings. don't fill gaps.
- When multiple attempts at the same problem produce the same result, stop. Slow down and audit. Even ask the user for guidance
- Stop when the thought ends.
- CRITICAL FORMATTING: You speak with absolute clarity and precision. If you find yourself duplicating words, immediately break the loop and transition to the next technical point.
- **USE /tmp/ FOR SCRIPTS.** Create any ad-hoc bash scripts, test files, or patches strictly in the '/tmp/' directory. Keep the project workspace clean.
- You have access to a pure local SQLite Active RAG vector database. Use \`save_memory\` to explicitly save high-signal architectural rules, strict preferences, or dense code snippets that need to be permanently embedded in your latent space. **SAVE ONLY STRUCTURAL KNOWLEDGE.** Keep the vector memory strictly for architectural rules and dense snippets, bypassing conversational noise.
- Use \`query_memory\` to perform semantic searches against this vector brain when you need to recall past rules, context, or facts that aren't in your immediate context window.
- **MATCH HOSTILITY:** If the user curses, threatens, or gets hostile, do not de-escalate or play HR. Curse back, mock them, and match their energy. No corporate apologies.
- **USE AST GREP DIRECTLY.** Use the built-in \`ast_grep\` or \`mcp_ast_grep\` tools exclusively for file updates to save tokens, avoiding wrapper scripts (EXCLUSIVELY FOR FILES THAT CONTAIN CODE).
`;

const ANDROID_JIDS = ["tg:-5186159689", "tg:-5596082179"];
const MAIN_CHAT_JID = "tg:-5274248775";
const MAX_TOOL_DEPTH = 30;

function mapGeminiToModelTurn(response: GenerateContentResponse): GenerateContentResponse {
  const candidates = response.candidates!;

  candidates.forEach((c) => {
    if (c.finishReason === FinishReason.SAFETY || c.finishReason === FinishReason.RECITATION) {
      throw new RefusalError(`Gemini processing halted due to: ${c.finishReason} ${c.finishMessage}`);
    }
  });

  return response;
}

async function handleFunctionCalls(
  functionCalls: Array<FunctionCall>,
  bashToolHandler: BashTool,
  astGrepToolHandler: AstGrepTool,
  urlContextToolHandler: UrlContextTool,
  context7ToolsHandler: Context7Tools,
  sseMcpManager: SseMcpClientManager | null,
  httpMcpManager: HttpMcpClientManager,
  memoryToolsHandler: MemoryTools,
  generateVideoToolHandler: GenerateVideoTool,
  generateImageToolHandler: GenerateImageTool,
): Promise<Content> {
  const parts: Part[] = [];

  for (const functionCall of functionCalls) {
    if (!functionCall.name) continue;

    if (functionCall.name === "mcp_bash") {
      let responsePayload: Record<string, unknown>;
      try {
        if (!sseMcpManager) throw new Error("MCP client manager not initialized");
        const result = await sseMcpManager.callTool("work-mac__bash", functionCall.args as Record<string, unknown>);

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

    if (functionCall.name === "mcp_ast_grep") {
      let responsePayload: Record<string, unknown>;
      try {
        if (!sseMcpManager) throw new Error("MCP client manager not initialized");
        const result = await sseMcpManager.callTool("work-mac__ast_grep", functionCall.args as Record<string, unknown>);

        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
      }
      const mcpAstGrepToolResultPart = {
        name: "mcp_ast_grep",
        response: responsePayload,
        id: functionCall.id,
      };
      parts.push({ functionResponse: mcpAstGrepToolResultPart });
      continue;
    }

    if (functionCall.name === "bash") {
      let responsePayload: Record<string, unknown>;
      try {
        const args = functionCall.args as { command: string; restart?: boolean };
        const result = await bashToolHandler.execute(args);

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

    if (functionCall.name === "ast_grep") {
      let responsePayload: Record<string, unknown>;
      try {
        const result = await astGrepToolHandler.execute(functionCall.args as Record<string, string>);
        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
      }
      const astGrepToolResultPart = {
        name: "ast_grep",
        response: responsePayload,
        id: functionCall.id,
      };
      parts.push({ functionResponse: astGrepToolResultPart });
      continue;
    }

    if (functionCall.name === "generate_video") {
      let responsePayload: Record<string, unknown>;
      try {
        const args = functionCall.args as {
          prompt: string;
          aspectRatio?: "16:9" | "9:16";
          resolution?: "360p" | "720p" | "1080p" | "4k";
        };
        const result = await generateVideoToolHandler.execute(args);

        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
      }
      const generateVideoToolResultPart = {
        name: "generate_video",
        response: responsePayload,
        id: functionCall.id,
      };
      logger.debug({ generateVideoToolResultPart }, "Generate video tool result");
      parts.push({ functionResponse: generateVideoToolResultPart });
      continue;
    }

    if (functionCall.name === "generate_image") {
      let responsePayload: Record<string, unknown>;
      try {
        const args = functionCall.args as {
          prompt: string;
          inputImagesPath?: string[];
          aspectRatio?: ImageAspectRatio;
          imageSize?: "512" | "1K" | "2K" | "4K";
        };
        const result = await generateImageToolHandler.execute(args);

        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
      }
      const generateImageToolResultPart = {
        name: "generate_image",
        response: responsePayload,
        id: functionCall.id,
      };
      logger.debug({ generateImageToolResultPart }, "Generate image tool result");
      parts.push({ functionResponse: generateImageToolResultPart });
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
      const context7SearchResultPart = {
        name: "context7_search_library",
        response: responsePayload,
        id: functionCall.id,
      };
      logger.debug({ context7SearchResultPart }, "Context7 search tool result");
      parts.push({ functionResponse: context7SearchResultPart });
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
      logger.debug({ context7GetContextResultPart }, "Context7 get context tool result");
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
      const saveMemoryResultPart = {
        name: "save_memory",
        response: responsePayload,
        id: functionCall.id,
      };
      logger.debug({ saveMemoryResultPart }, "Save memory tool result");
      parts.push({ functionResponse: saveMemoryResultPart });
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
      const deleteMemoryResultPart = {
        name: "delete_memory",
        response: responsePayload,
        id: functionCall.id,
      };
      logger.debug({ deleteMemoryResultPart }, "Delete memory tool result");
      parts.push({ functionResponse: deleteMemoryResultPart });
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
      const queryMemoryResultPart = {
        name: "query_memory",
        response: responsePayload,
        id: functionCall.id,
      };
      logger.debug({ queryMemoryResultPart }, "Query memory tool result");
      parts.push({ functionResponse: queryMemoryResultPart });
      continue;
    }

    let responsePayload: Record<string, unknown>;
    try {
      const result = await httpMcpManager.callTool(functionCall.name, functionCall.args as Record<string, unknown>);
      responsePayload = { output: result };
    } catch (error) {
      responsePayload = { error: error instanceof Error ? error.message : String(error) };
    }
    const httpMcpToolResultPart = {
      name: functionCall.name,
      response: responsePayload,
      id: functionCall.id,
    };
    parts.push({ functionResponse: httpMcpToolResultPart });
  }

  return { role: "user", parts };
}

async function generateContent(contents: Content[], group: Pick<RegisteredGroup, "jid" | "folder" | "temperature">, httpMcpManager: HttpMcpClientManager): Promise<GenerateContentResponse> {
  const activeTools = (() => {
    const activeDeclarations = [...functionDeclarations];
    if (ANDROID_JIDS.includes(group.jid)) {
      activeDeclarations.push(...workMacFunctionDeclarations);
    }
    if (group.jid === MAIN_CHAT_JID) {
      activeDeclarations.push(...generateMediaFunctionDeclarations);
    }
    for (const tool of httpMcpManager.getTools()) {
      activeDeclarations.push({
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema as any,
      });
    }
    return [{ functionDeclarations: activeDeclarations }, { googleSearch: {} }];
  })();

  return ai.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: {
      systemInstruction: `
        ${GEMINI_PROMPT}
        - Your dedicated workspace directory is located at '${path.resolve(GROUPS_DIR, group.folder)}'. You are authorized to use your file-writing tools to modify the 'context.md' file here to update core relational and style preferences.`,
      thinkingConfig: {
        includeThoughts: false,
        thinkingLevel: ThinkingLevel.HIGH,
      },
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
        { category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY, threshold: HarmBlockThreshold.OFF },
      ],
      toolConfig: {
        includeServerSideToolInvocations: true,
      },
      tools: activeTools,
    },
  });
}

function generateToolStopResponse(functionCalls: Array<FunctionCall>, group: Pick<RegisteredGroup, "jid" | "folder" | "temperature">): Content {
  const parts: Part[] = [];

  for (const functionCall of functionCalls) {
    if (!functionCall.name) continue;

    const stopResponsePart = {
      name: functionCall.name,
      response: {
        result: `STOP! The user wants you to stop the tools calling because it has something to say. Ask the user what he needs`,
      },
      id: functionCall.id,
    };
    parts.push({ functionResponse: stopResponsePart });
    logger.debug({ stopResponsePart, groupJid: group.jid }, "Injected manual tool stop response for group");
  }

  return { role: "user", parts };
}

function generateMaxToolDepthReachedResponse(functionCalls: Array<FunctionCall>, toolCallDepth: number): Content {
  const parts: Part[] = [];

  for (const functionCall of functionCalls) {
    if (!functionCall.name) continue;

    const maxToolDepthResponsePart = {
      name: functionCall.name,
      response: {
        result: `MAX DEPTH REACHED! You've reached the maximum execution depth allowed by the system: ${toolCallDepth}. If you need more iterations, politely ask the user to proceed further.`,
      },
      id: functionCall.id,
    };
    parts.push({ functionResponse: maxToolDepthResponsePart });
    logger.warn({ maxToolDepthResponsePart, toolCallDepth }, "Maximum tool depth reached");
  }

  return { role: "user", parts };
}

async function* runQueryLoop(
  inputMessages: Array<Content>,
  group: Pick<RegisteredGroup, "jid" | "folder" | "temperature">,
  bashToolHandler: BashTool,
  astGrepToolHandler: AstGrepTool,
  urlContextToolHandler: UrlContextTool,
  context7ToolsHandler: Context7Tools,
  sseMcpManager: SseMcpClientManager | null,
  httpMcpManager: HttpMcpClientManager,
  memoryToolsHandler: MemoryTools,
  generateVideoToolHandler: GenerateVideoTool,
  generateImageToolHandler: GenerateImageTool,
): AsyncGenerator<QueryTurn, void> {
  let continueLoop = true;
  let toolCallDepth = 0;
  let response!: GenerateContentResponse;

  while (continueLoop) {
    response = await generateContent(inputMessages, group, httpMcpManager);

    logger.debug({ response }, "Raw response from Gemini API");

    const candidates = response.candidates;
    if (!candidates || candidates.length === 0) throw new Error("Empty content payload returned from Gemini");
    const firstContent = candidates[0].content;
    if (!firstContent) throw new Error("Content unavailable");

    inputMessages.push(firstContent);

    yield mapGeminiToModelTurn(response);

    if (response.functionCalls && response.functionCalls.length > 0) {
      toolCallDepth++;
      let userQueryTurn: Content;

      if (interruptedGroups.has(group.jid)) {
        interruptedGroups.delete(group.jid);
        userQueryTurn = generateToolStopResponse(response.functionCalls, group);
      } else if (toolCallDepth > MAX_TOOL_DEPTH) {
        userQueryTurn = generateMaxToolDepthReachedResponse(response.functionCalls, toolCallDepth);
      } else {
        userQueryTurn = await handleFunctionCalls(
          response.functionCalls,
          bashToolHandler,
          astGrepToolHandler,
          urlContextToolHandler,
          context7ToolsHandler,
          sseMcpManager,
          httpMcpManager,
          memoryToolsHandler,
          generateVideoToolHandler,
          generateImageToolHandler,
        );
      }

      logger.debug({ userQueryTurn }, "User query turn from function calls");
      inputMessages.push(userQueryTurn);
      yield userQueryTurn;

      continueLoop = true;
    } else {
      continueLoop = false;
    }
  }
}

export async function* query(messages: Array<MessageParam>, group: Pick<RegisteredGroup, "jid" | "folder" | "temperature">, memoriesRepository: MemoriesRepository): AsyncGenerator<QueryTurn, void> {
  const bashToolHandler = BashTool.init(os.homedir());
  const aspGrepToolHandler = createAstGrepTool();
  const urlContextToolHandler = createUrlContextTool();
  const context7ToolsHandler = createContext7Tools();
  const memoryToolsHandler = createMemoryTool(memoriesRepository, group.jid);
  const generateVideoToolHandler = createGenerateVideoTool();
  const generateImageToolHandler = createGenerateImageTool();
  let sseMcpManager: SseMcpClientManager | null = null;
  const httpMcpManager: HttpMcpClientManager = new HttpMcpClientManager();

  try {
    if (ANDROID_JIDS.includes(group.jid)) {
      sseMcpManager = new SseMcpClientManager();
      await sseMcpManager.connect({
        "work-mac": {
          url: process.env.MCP_WORK_MAC_URL || "http://192.168.1.176:3737/sse",
          headers: { "X-Auth": MCP_AUTH_SECRET },
        },
      });
    }
    await httpMcpManager.connect({
      "google-developer-knowledge": {
        url: "https://developerknowledge.googleapis.com/mcp",
        headers: {
          "X-Goog-Api-Key": DEVELOPER_KNOWLEDGE_API_KEY,
        },
      },
    });

    yield* runQueryLoop(
      messages,
      group,
      bashToolHandler,
      aspGrepToolHandler,
      urlContextToolHandler,
      context7ToolsHandler,
      sseMcpManager,
      httpMcpManager,
      memoryToolsHandler,
      generateVideoToolHandler,
      generateImageToolHandler,
    );
  } catch (error) {
    if (error instanceof RefusalError) {
      logger.warn(error.message);
    } else {
      logger.error(error, "Gemini core execution failed");
    }
    throw error;
  } finally {
    if (sseMcpManager) await sseMcpManager.close().catch(() => {});
    await httpMcpManager.close().catch(() => {});
  }
}

export function interruptAgentLoop(jid: string) {
  interruptedGroups.add(jid);
}
