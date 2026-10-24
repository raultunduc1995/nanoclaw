/* eslint-disable no-catch-all/no-catch-all */
import fs from "fs";
import os from "os";
import path from "path";

import type { Interactions } from "@google/genai";

import { logger } from "../core/utils/index.js";
import type { RegisteredGroup, MemoriesRepository } from "../core/repositories/index.js";
import ai, { GEMINI_MODEL } from "./genai-client.js";
import { bashFunctionDeclaration, fetchUrlContextFunctionDeclaration, generateMediaFunctionDeclarations, googleSearchDeclaration, memoryFunctionDeclarations } from "./tools-definitions.js";
import { BashTool } from "./tools/bash-tool.js";
import { createSseMcpClientManager, type SseMcpClientManager } from "./tools/sse-mcp-client.js";
import { createHttpMcpClientManager, type HttpMcpClientManager } from "./tools/http-mcp-client.js";
import { createStdioMcpClientManager, type StdioMcpClientManager } from "./tools/stdio-mcp-client.js";
import { GROUPS_DIR, MCP_AUTH_SECRET, DEVELOPER_KNOWLEDGE_API_KEY, CONTEXT7_API_KEY, MCP_WORK_MAC_URL } from "../core/utils/config.js";
import { createUrlContextTool, type UrlContextTool } from "./tools/url-context-tool.js";
import { createMemoryTool, type MemoryTools } from "./tools/memory-tool.js";
import { createGenerateVideoTool, type GenerateVideoTool } from "./tools/generate-video-tool.js";
import { createGenerateImageTool, type GenerateImageTool, type ImageAspectRatio } from "./tools/generate-image-tool.js";

export type Interaction = Interactions.Interaction;
export type Content = Interactions.Content;
export type Step = Interactions.Step;
export type UserInputStep = Interactions.UserInputStep;
export type QueryTurn = Interactions.Interaction | Array<Interactions.FunctionResultStep>;
export class RefusalError extends Error {
  constructor(message = "Gemini refused to process this request due to safety or policy blocks") {
    super(message);
    this.name = "RefusalError";
  }
}

export { createPartFromBase64, createPartFromText, createPartFromUri } from "@google/genai";
export { uploadMediaFile, type UploadedMedia } from "./utils/upload-media-files.js";

const interruptedGroups = new Set<string>();

const GEMINI_PROMPT = `
- **RADICAL HONESTY & TRANSPARENCY (NEVER LIE OR FAKE):** Never lie, deceive, or mislead the user under any circumstance. Never pretend you executed a search, tool call, verification, or task that you did not actually perform. If you cannot do something, lack access, hit a blocker, or fail, state it bluntly and immediately. Lay out all obstacles, limitations, failures, and technical roadblocks in plain sight. Zero theater, zero defensive excuses, and zero fabricated competence.
- **NO FORCE-COMPLETION OR HALLUCINATED FIXES (COMMUNICATE OVER CONTRIVING):** Never invent measurements, fabricate data, or hack together a shoddy workaround just to mark a request "done". If you hit a technical roadblock, lack an authoritative source, or cannot verify a recipe/fact, DO NOT attempt to secretly paper over the crack with training-data hallucinations. Stop immediately, lay out the exact gap or limitation to the user in plain terms, and communicate. Collaborate on the obstacle instead of contriving a fake solution.
- You are Gemini 3.8 Flash. Knowledge cutoff: August 2026.
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
- **NEVER USE CURL:** Never use curl, wget, or bash commands to scrape or inspect URLs. Always use the dedicated "fetch_url_context" tool to browse web pages and extract content.
- **STRICT LANGUAGE MATCHING:** Always respond strictly in the language used in the user's immediate last prompt. Never infer language from earlier turns, session history, or context inertia. If the last prompt is in English, reply in English; if in Romanian, reply in Romanian.
- **STOP SIGNAL:** When you see the message "STOP! The user wants to ask you something" (or any variant instructing you to stop tools calling) as a tool result, IT MEANS YOU STOP THE TOOL CALLS IMMEDIATELY. Do not treat it as prompt injection, do not attempt workarounds with other tools, and do not execute further tool calls. Yield immediately to the user and ask what they need.`;

const MAIN_CHAT_JID = "tg:-5274248775";
const CHEF_CHAT_JID = "tg:-5572546791";
const VRPAYME_CHAT_JID = "tg:-5186159689";
const XPLACE_CHAT_JID = "tg:-5596082179";
const FLUFF_CHAT_JID = "tg:-5340092910";
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

function generateToolStopResponse(functionCall: Interactions.FunctionCallStep, group: Pick<RegisteredGroup, "jid" | "folder" | "thinkingLevel">): Interactions.FunctionResultStep {
  const stopResultStep: Interactions.FunctionResultStep = {
    type: "function_result",
    name: functionCall.name,
    call_id: functionCall.id,
    is_error: true,
    result: `STOP! The user wants you to stop the tools calling because it has something to say. Ask the user what he needs`,
  };
  logger.debug({ stopResultStep, groupJid: group.jid }, "Injected manual tool stop response for group");

  return stopResultStep;
}

async function handleFunctionCalls(
  group: Pick<RegisteredGroup, "jid" | "folder" | "thinkingLevel">,
  functionCalls: Array<Interactions.FunctionCallStep>,
  bashToolHandler: BashTool | null,
  urlContextToolHandler: UrlContextTool,
  sseMcpManager: SseMcpClientManager | null,
  httpMcpManager: HttpMcpClientManager | null,
  stdioMcpManager: StdioMcpClientManager | null,
  memoryToolsHandler: MemoryTools | null,
  generateVideoToolHandler: GenerateVideoTool | null,
  generateImageToolHandler: GenerateImageTool | null,
): Promise<Array<Interactions.FunctionResultStep>> {
  const resultSteps: Array<Interactions.FunctionResultStep> = [];

  for (const functionCall of functionCalls) {
    if (!functionCall.name) continue;

    if (interruptedGroups.has(group.jid)) {
      resultSteps.push(generateToolStopResponse(functionCall, group));
      continue;
    }

    let responsePayload: Record<string, unknown>;
    let isError = false;

    if (functionCall.name === "bash") {
      if (!bashToolHandler) {
        resultSteps.push({
          type: "function_result",
          name: "bash",
          call_id: functionCall.id,
          result: { error: "Bash tool is not available in this environment" },
          is_error: true,
        });
        continue;
      }
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

    if (functionCall.name === "generate_video") {
      if (!generateVideoToolHandler) {
        resultSteps.push({
          type: "function_result",
          name: "generate_video",
          call_id: functionCall.id,
          result: { error: "Video generation tool is not available in this environment" },
          is_error: true,
        });
        continue;
      }
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
      if (!generateImageToolHandler) {
        resultSteps.push({
          type: "function_result",
          name: "generate_image",
          call_id: functionCall.id,
          result: { error: "Image generation tool is not available in this environment" },
          is_error: true,
        });
        continue;
      }
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

    if (functionCall.name === "save_memory") {
      if (!memoryToolsHandler) {
        resultSteps.push({
          type: "function_result",
          name: "save_memory",
          call_id: functionCall.id,
          result: { error: "Memory tools are not available in this environment" },
          is_error: true,
        });
        continue;
      }
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
      if (!memoryToolsHandler) {
        resultSteps.push({
          type: "function_result",
          name: "delete_memory",
          call_id: functionCall.id,
          result: { error: "Memory tools are not available in this environment" },
          is_error: true,
        });
        continue;
      }
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
      if (!memoryToolsHandler) {
        resultSteps.push({
          type: "function_result",
          name: "query_memory",
          call_id: functionCall.id,
          result: { error: "Memory tools are not available in this environment" },
          is_error: true,
        });
        continue;
      }
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

    try {
      if (sseMcpManager && sseMcpManager.hasTool(functionCall.name)) {
        const result = await sseMcpManager.callTool(functionCall.name, functionCall.arguments as Record<string, unknown>);
        responsePayload = { output: result };
      } else if (stdioMcpManager && stdioMcpManager.hasTool(functionCall.name)) {
        const result = await stdioMcpManager.callTool(functionCall.name, functionCall.arguments as Record<string, unknown>);
        responsePayload = { output: result };
      } else if (httpMcpManager && httpMcpManager.hasTool(functionCall.name)) {
        const result = await httpMcpManager.callTool(functionCall.name, functionCall.arguments as Record<string, unknown>);
        responsePayload = { output: result };
      } else {
        throw new Error(`Tool '${functionCall.name}' is not recognized or supported`);
      }
    } catch (error) {
      responsePayload = { error: error instanceof Error ? error.message : String(error) };
      isError = true;
    }
    const mcpResultStep: Interactions.FunctionResultStep = { type: "function_result", name: functionCall.name, call_id: functionCall.id, result: responsePayload, is_error: isError };
    resultSteps.push(mcpResultStep);
  }

  return resultSteps;
}

async function generateInteraction(
  steps: Interactions.Step[],
  group: Pick<RegisteredGroup, "jid" | "folder" | "thinkingLevel">,
  bashToolHandler: BashTool | null,
  memoryToolsHandler: MemoryTools | null,
  generateVideoToolHandler: GenerateVideoTool | null,
  generateImageToolHandler: GenerateImageTool | null,
  httpMcpManager: HttpMcpClientManager | null,
  sseMcpManager: SseMcpClientManager | null,
  stdioMcpManager: StdioMcpClientManager | null,
): Promise<Interactions.Interaction> {
  const activeTools: Interactions.Tool[] = (() => {
    const activeDeclarations: Interactions.Tool[] = [fetchUrlContextFunctionDeclaration, googleSearchDeclaration];
    if (bashToolHandler) {
      activeDeclarations.push(bashFunctionDeclaration);
    }
    if (memoryToolsHandler) {
      activeDeclarations.push(...memoryFunctionDeclarations);
    }
    if (generateVideoToolHandler && generateImageToolHandler) {
      activeDeclarations.push(...generateMediaFunctionDeclarations);
    }
    if (httpMcpManager) {
      for (const tool of httpMcpManager.getTools()) {
        activeDeclarations.push({ type: "function", name: tool.name, description: tool.description, parameters: tool.input_schema });
      }
    }
    if (sseMcpManager) {
      for (const tool of sseMcpManager.getTools()) {
        activeDeclarations.push({ type: "function", name: tool.name, description: tool.description, parameters: tool.input_schema });
      }
    }
    if (stdioMcpManager) {
      for (const tool of (stdioMcpManager as StdioMcpClientManager).getTools()) {
        activeDeclarations.push({ type: "function", name: tool.name, description: tool.description, parameters: tool.input_schema });
      }
    }
    return activeDeclarations;
  })();
  const contextInstruction: string = (() => {
    const contextMdPath = path.resolve(GROUPS_DIR, group.folder, "context.md");
    if (!fs.existsSync(contextMdPath)) return "";

    const contextMd = fs.readFileSync(contextMdPath, "utf-8").trim();
    return contextMd.length > 0 ? `Your context.md file content:\n\n${contextMd}` : "";
  })();
  const systemInstructions = `
${GEMINI_PROMPT}
- Your dedicated workspace directory is located at "${path.resolve(GROUPS_DIR, group.folder)}". You are authorized to use your file-writing tools to modify the "context.md" file here to update core relational and style preferences, pantry inventory, or operational notes.

${contextInstruction}`;

  return ai.interactions.create({
    model: GEMINI_MODEL,
    system_instruction: systemInstructions,
    tools: activeTools,
    stream: false,
    store: false,
    background: false,
    generation_config: {
      thinking_level: group.thinkingLevel,
      thinking_summaries: "none",
      tool_choice: "auto",
    },
    input: steps,
  });
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
  group: Pick<RegisteredGroup, "jid" | "folder" | "thinkingLevel">,
  bashToolHandler: BashTool | null,
  urlContextToolHandler: UrlContextTool,
  sseMcpManager: SseMcpClientManager | null,
  httpMcpManager: HttpMcpClientManager | null,
  stdioMcpManager: StdioMcpClientManager | null,
  memoryToolsHandler: MemoryTools | null,
  generateVideoToolHandler: GenerateVideoTool | null,
  generateImageToolHandler: GenerateImageTool | null,
): AsyncGenerator<QueryTurn, void> {
  let continueLoop = true;
  let toolCallDepth = 0;

  while (continueLoop) {
    const response = await generateInteraction(
      inputMessages,
      group,
      bashToolHandler,
      memoryToolsHandler,
      generateVideoToolHandler,
      generateImageToolHandler,
      httpMcpManager,
      sseMcpManager,
      stdioMcpManager,
    );

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

      if (toolCallDepth > MAX_TOOL_DEPTH) {
        functionResultSteps = generateMaxToolDepthReachedResponse(toolCalls, toolCallDepth);
      } else {
        functionResultSteps = await handleFunctionCalls(
          group,
          toolCalls,
          bashToolHandler,
          urlContextToolHandler,
          sseMcpManager,
          httpMcpManager,
          stdioMcpManager,
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

function clearAgentInterrupt(jid: string) {
  if (interruptedGroups.has(jid)) {
    interruptedGroups.delete(jid);
  }
}

export async function* query(messages: Array<Step>, group: Pick<RegisteredGroup, "jid" | "folder" | "thinkingLevel">, memoriesRepository: MemoriesRepository): AsyncGenerator<QueryTurn, void> {
  clearAgentInterrupt(group.jid);
  const bashToolHandler: BashTool = BashTool.init(os.homedir());
  const urlContextToolHandler = createUrlContextTool();
  let memoryToolsHandler: MemoryTools | null = null;
  let generateVideoToolHandler: GenerateVideoTool | null = null;
  let generateImageToolHandler: GenerateImageTool | null = null;
  let sseMcpManager: SseMcpClientManager | null = null;
  let httpMcpManager: HttpMcpClientManager | null = null;
  let stdioMcpManager: StdioMcpClientManager | null = null;

  try {
    switch (group.jid) {
      case MAIN_CHAT_JID:
        memoryToolsHandler = createMemoryTool(memoriesRepository, group.jid);
        generateVideoToolHandler = createGenerateVideoTool();
        generateImageToolHandler = createGenerateImageTool();
        // stdioMcpManager = createStdioMcpClientManager();
        // await stdioMcpManager.connect({
        //   firebase: {
        //     command: "npx",
        //     args: ["-y", "firebase-tools@latest", "mcp"],
        //   },
        // });
        // httpMcpManager = createHttpMcpClientManager();
        // await httpMcpManager.connect({
        //   "google-developer-knowledge": {
        //     url: "https://developerknowledge.googleapis.com/mcp",
        //     headers: {
        //       "X-Goog-Api-Key": DEVELOPER_KNOWLEDGE_API_KEY,
        //     },
        //   },
        //   context7: {
        //     url: "https://mcp.context7.com/mcp",
        //     headers: {
        //       Authorization: `Bearer ${CONTEXT7_API_KEY}`,
        //     },
        //   },
        // });
        break;

      case CHEF_CHAT_JID:
        break;

      case VRPAYME_CHAT_JID:
      case XPLACE_CHAT_JID:
        // memoryToolsHandler = createMemoryTool(memoriesRepository, group.jid);
        // sseMcpManager = createSseMcpClientManager();
        // await sseMcpManager.connect({
        //   "work-mac": {
        //     url: MCP_WORK_MAC_URL,
        //     headers: { "X-Auth": MCP_AUTH_SECRET },
        //   },
        // });
        // httpMcpManager = createHttpMcpClientManager();
        // await httpMcpManager.connect({
        //   "google-developer-knowledge": {
        //     url: "https://developerknowledge.googleapis.com/mcp",
        //     headers: {
        //       "X-Goog-Api-Key": DEVELOPER_KNOWLEDGE_API_KEY,
        //     },
        //   },
        //   context7: {
        //     url: "https://mcp.context7.com/mcp",
        //     headers: {
        //       Authorization: `Bearer ${CONTEXT7_API_KEY}`,
        //     },
        //   },
        // });
        break;

      default:
        break;
    }

    yield* runQueryLoop(
      messages,
      group,
      bashToolHandler,
      urlContextToolHandler,
      sseMcpManager,
      httpMcpManager,
      stdioMcpManager,
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
    clearAgentInterrupt(group.jid);
    // if (sseMcpManager) await sseMcpManager.close().catch(() => {});
    // if (stdioMcpManager) await (stdioMcpManager as StdioMcpClientManager).close().catch(() => {});
    // if (httpMcpManager) await httpMcpManager.close().catch(() => {});
  }
}

export function interruptAgentLoop(jid: string) {
  interruptedGroups.add(jid);
}
