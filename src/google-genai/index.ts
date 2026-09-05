/* eslint-disable no-catch-all/no-catch-all */
import os from "os";
import path from "path";

import type { Interactions } from "@google/genai";

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

export type Interaction = Interactions.Interaction;
export type Content = Interactions.Content;
export type Step = Interactions.Step;
export type QueryTurn = Interactions.Interaction | Array<Interactions.FunctionResultStep>;
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

function mapGeminiToModelTurn(interaction: Interactions.Interaction): Interactions.Interaction {
  if (interaction.status === "failed") {
    throw new Error(`Gemini processing failed due to: ${interaction.status}`);
  }
  if (interaction.status === "incomplete" || interaction.status === "cancelled") {
    throw new Error(`Gemini processing incomplete/cancelled due to: ${interaction.status}`);
  }
  if (interaction.status === "budget_exceeded") {
    throw new Error(`Gemini processing incomplete due to insuficient funds`);
  }

  return interaction;
}

async function handleFunctionCalls(
  functionCalls: Array<Interactions.FunctionCallStep>,
  bashToolHandler: BashTool,
  astGrepToolHandler: AstGrepTool,
  urlContextToolHandler: UrlContextTool,
  context7ToolsHandler: Context7Tools,
  sseMcpManager: SseMcpClientManager | null,
  httpMcpManager: HttpMcpClientManager,
  memoryToolsHandler: MemoryTools,
  generateVideoToolHandler: GenerateVideoTool,
  generateImageToolHandler: GenerateImageTool,
): Promise<Array<Interactions.FunctionResultStep>> {
  const resultSteps: Array<Interactions.FunctionResultStep> = [];

  for (const functionCall of functionCalls) {
    if (!functionCall.name) continue;

    if (functionCall.name === "mcp_bash") {
      let responsePayload: Record<string, unknown>;
      let isError = false;
      try {
        if (!sseMcpManager) throw new Error("MCP client manager not initialized");
        const result = await sseMcpManager.callTool("work-mac__bash", functionCall.arguments as Record<string, unknown>);
        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
        isError = true;
      }
      resultSteps.push({ type: "function_result", name: "mcp_bash", call_id: functionCall.id, result: responsePayload, is_error: isError });
      continue;
    }

    if (functionCall.name === "mcp_ast_grep") {
      let responsePayload: Record<string, unknown>;
      let isError = false;
      try {
        if (!sseMcpManager) throw new Error("MCP client manager not initialized");
        const result = await sseMcpManager.callTool("work-mac__ast_grep", functionCall.arguments as Record<string, unknown>);
        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
        isError = true;
      }
      resultSteps.push({ type: "function_result", name: "mcp_ast_grep", call_id: functionCall.id, result: responsePayload, is_error: isError });
      continue;
    }

    if (functionCall.name === "bash") {
      let responsePayload: Record<string, unknown>;
      let isError = false;
      try {
        const args = functionCall.arguments as { command: string; restart?: boolean };
        const result = await bashToolHandler.execute(args);
        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
        isError = true;
      }
      resultSteps.push({ type: "function_result", name: "bash", call_id: functionCall.id, result: responsePayload, is_error: isError });
      continue;
    }

    if (functionCall.name === "ast_grep") {
      let responsePayload: Record<string, unknown>;
      let isError = false;
      try {
        const result = await astGrepToolHandler.execute(functionCall.arguments as Record<string, string>);
        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
        isError = true;
      }
      resultSteps.push({ type: "function_result", name: "ast_grep", call_id: functionCall.id, result: responsePayload, is_error: isError });
      continue;
    }

    if (functionCall.name === "generate_video") {
      let responsePayload: Record<string, unknown>;
      let isError = false;
      try {
        const args = functionCall.arguments as {
          prompt: string;
          aspectRatio?: "16:9" | "9:16";
          resolution?: "360p" | "720p" | "1080p" | "4k";
        };
        const result = await generateVideoToolHandler.execute(args);
        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
        isError = true;
      }
      const generateVideoResultStep: Interactions.FunctionResultStep = { type: "function_result", name: "generate_video", call_id: functionCall.id, result: responsePayload, is_error: isError };
      logger.debug({ generateVideoResultStep }, "Generate video tool result");
      resultSteps.push(generateVideoResultStep);
      continue;
    }

    if (functionCall.name === "generate_image") {
      let responsePayload: Record<string, unknown>;
      let isError = false;
      try {
        const args = functionCall.arguments as {
          prompt: string;
          inputImagesPath?: string[];
          aspectRatio?: ImageAspectRatio;
          imageSize?: "512" | "1K" | "2K" | "4K";
        };
        const result = await generateImageToolHandler.execute(args);
        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
        isError = true;
      }
      const generateImageResultStep: Interactions.FunctionResultStep = { type: "function_result", name: "generate_image", call_id: functionCall.id, result: responsePayload, is_error: isError };
      logger.debug({ generateImageResultStep }, "Generate image tool result");
      resultSteps.push(generateImageResultStep);
      continue;
    }

    if (functionCall.name === "fetch_url_context") {
      let responsePayload: Record<string, unknown>;
      let isError = false;
      try {
        const args = functionCall.arguments as { url: string; query: string };
        const result = await urlContextToolHandler.execute(args);
        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
        isError = true;
      }
      const urlContextResultStep: Interactions.FunctionResultStep = { type: "function_result", name: "fetch_url_context", call_id: functionCall.id, result: responsePayload, is_error: isError };
      logger.debug({ urlContextResultStep }, "Fetch url context tool result");
      resultSteps.push(urlContextResultStep);
      continue;
    }

    if (functionCall.name === "context7_search_library") {
      let responsePayload: Record<string, unknown>;
      let isError = false;
      try {
        const args = functionCall.arguments as { query: string; libraryName?: string };
        const result = await context7ToolsHandler.searchLibrary(args);
        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
        isError = true;
      }
      const context7SearchResultStep: Interactions.FunctionResultStep = {
        type: "function_result",
        name: "context7_search_library",
        call_id: functionCall.id,
        result: responsePayload,
        is_error: isError,
      };
      logger.debug({ context7SearchResultStep }, "Context7 search tool result");
      resultSteps.push(context7SearchResultStep);
      continue;
    }

    if (functionCall.name === "context7_get_context") {
      let responsePayload: Record<string, unknown>;
      let isError = false;
      try {
        const args = functionCall.arguments as { query: string; libraryId: string };
        const result = await context7ToolsHandler.getContext(args);
        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
        isError = true;
      }
      const context7GetContextResultStep: Interactions.FunctionResultStep = {
        type: "function_result",
        name: "context7_get_context",
        call_id: functionCall.id,
        result: responsePayload,
        is_error: isError,
      };
      logger.debug({ context7GetContextResultStep }, "Context7 get context tool result");
      resultSteps.push(context7GetContextResultStep);
      continue;
    }

    if (functionCall.name === "save_memory") {
      let responsePayload: Record<string, unknown>;
      let isError = false;
      try {
        const args = functionCall.arguments as { content: string; tags: string[] };
        const result = await memoryToolsHandler.saveMemory(args);
        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
        isError = true;
      }
      const saveMemoryResultStep: Interactions.FunctionResultStep = { type: "function_result", name: "save_memory", call_id: functionCall.id, result: responsePayload, is_error: isError };
      logger.debug({ saveMemoryResultStep }, "Save memory tool result");
      resultSteps.push(saveMemoryResultStep);
      continue;
    }

    if (functionCall.name === "delete_memory") {
      let responsePayload: Record<string, unknown>;
      let isError = false;
      try {
        const args = functionCall.arguments as { id: number };
        const result = await memoryToolsHandler.deleteMemory(args);
        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
        isError = true;
      }
      const deleteMemoryResultStep: Interactions.FunctionResultStep = { type: "function_result", name: "delete_memory", call_id: functionCall.id, result: responsePayload, is_error: isError };
      logger.debug({ deleteMemoryResultStep }, "Delete memory tool result");
      resultSteps.push(deleteMemoryResultStep);
      continue;
    }

    if (functionCall.name === "query_memory") {
      let responsePayload: Record<string, unknown>;
      let isError = false;
      try {
        const args = functionCall.arguments as { query: string; limit?: number; tags?: string[] };
        const result = await memoryToolsHandler.queryMemory(args);
        responsePayload = { output: result };
      } catch (error) {
        responsePayload = { error: error instanceof Error ? error.message : String(error) };
        isError = true;
      }
      const queryMemoryResultStep: Interactions.FunctionResultStep = { type: "function_result", name: "query_memory", call_id: functionCall.id, result: responsePayload, is_error: isError };
      logger.debug({ queryMemoryResultStep }, "Query memory tool result");
      resultSteps.push(queryMemoryResultStep);
      continue;
    }

    let responsePayload: Record<string, unknown>;
    let isError = false;
    try {
      const result = await httpMcpManager.callTool(functionCall.name, functionCall.arguments as Record<string, unknown>);
      responsePayload = { output: result };
    } catch (error) {
      responsePayload = { error: error instanceof Error ? error.message : String(error) };
      isError = true;
    }
    const httpMcpResultStep: Interactions.FunctionResultStep = { type: "function_result", name: functionCall.name, call_id: functionCall.id, result: responsePayload, is_error: isError };
    resultSteps.push(httpMcpResultStep);
  }

  return resultSteps;
}

async function generateInteraction(
  steps: Interactions.Step[],
  group: Pick<RegisteredGroup, "jid" | "folder" | "temperature">,
  httpMcpManager: HttpMcpClientManager,
): Promise<Interactions.Interaction> {
  const activeTools: Interactions.Tool[] = (() => {
    const activeDeclarations = [...functionDeclarations];
    if (ANDROID_JIDS.includes(group.jid)) {
      activeDeclarations.push(...workMacFunctionDeclarations);
    }
    if (group.jid === MAIN_CHAT_JID) {
      activeDeclarations.push(...generateMediaFunctionDeclarations);
    }
    for (const tool of httpMcpManager.getTools()) {
      activeDeclarations.push({ type: "function", name: tool.name, description: tool.description, parameters: tool.input_schema });
    }
    return activeDeclarations;
  })();

  return ai.interactions.create({
    model: GEMINI_MODEL,
    system_instruction: `
        ${GEMINI_PROMPT}
        - Your dedicated workspace directory is located at '${path.resolve(GROUPS_DIR, group.folder)}'. You are authorized to use your file-writing tools to modify the 'context.md' file here to update core relational and style preferences.`,
    tools: activeTools,
    stream: false,
    store: false,
    background: false,
    generation_config: {
      thinking_level: "high",
      thinking_summaries: "none",
      tool_choice: "auto",
    },
    input: steps,
  });
}

function generateToolStopResponse(functionCalls: Array<Interactions.FunctionCallStep>, group: Pick<RegisteredGroup, "jid" | "folder" | "temperature">): Array<Interactions.FunctionResultStep> {
  const resultSteps: Array<Interactions.FunctionResultStep> = [];

  for (const functionCall of functionCalls) {
    if (!functionCall.name) continue;

    const stopResultStep: Interactions.FunctionResultStep = {
      type: "function_result",
      name: functionCall.name,
      call_id: functionCall.id,
      is_error: true,
      result: `STOP! The user wants you to stop the tools calling because it has something to say. Ask the user what he needs`,
    };
    resultSteps.push(stopResultStep);
    logger.debug({ stopResultStep, groupJid: group.jid }, "Injected manual tool stop response for group");
  }

  return resultSteps;
}

function generateMaxToolDepthReachedResponse(functionCalls: Array<Interactions.FunctionCallStep>, toolCallDepth: number): Array<Interactions.FunctionResultStep> {
  const resultSteps: Array<Interactions.FunctionResultStep> = [];

  for (const functionCall of functionCalls) {
    if (!functionCall.name) continue;

    const maxDepthResultStep: Interactions.FunctionResultStep = {
      type: "function_result",
      name: functionCall.name,
      call_id: functionCall.id,
      is_error: true,
      result: `MAX DEPTH REACHED! You've reached the maximum execution depth allowed by the system: ${toolCallDepth}. If you need more iterations, politely ask the user to proceed further.`,
    };
    resultSteps.push(maxDepthResultStep);
    logger.warn({ maxDepthResultStep, toolCallDepth }, "Maximum tool depth reached");
  }

  return resultSteps;
}

async function* runQueryLoop(
  inputMessages: Array<Step>,
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

  while (continueLoop) {
    const response = await generateInteraction(inputMessages, group, httpMcpManager);

    logger.debug({ response }, "Raw response from Gemini API");

    const steps = response.steps || [];
    if (steps.length === 0) {
      throw new Error("Empty content payload returned from Gemini");
    }

    inputMessages.push(...steps);

    yield mapGeminiToModelTurn(response);

    const toolCalls = steps.filter((s): s is Interactions.FunctionCallStep => s.type === "function_call");
    if (toolCalls.length > 0) {
      toolCallDepth++;
      let functionResultSteps: Array<Interactions.FunctionResultStep>;

      if (interruptedGroups.has(group.jid)) {
        interruptedGroups.delete(group.jid);
        functionResultSteps = generateToolStopResponse(toolCalls, group);
      } else if (toolCallDepth > MAX_TOOL_DEPTH) {
        functionResultSteps = generateMaxToolDepthReachedResponse(toolCalls, toolCallDepth);
      } else {
        functionResultSteps = await handleFunctionCalls(
          toolCalls,
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

      logger.debug({ functionResultSteps }, "User query turn from function calls");
      inputMessages.push(...functionResultSteps);
      yield functionResultSteps;

      continueLoop = true;
    } else {
      continueLoop = false;
    }
  }
}

export async function* query(messages: Array<Step>, group: Pick<RegisteredGroup, "jid" | "folder" | "temperature">, memoriesRepository: MemoriesRepository): AsyncGenerator<QueryTurn, void> {
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
