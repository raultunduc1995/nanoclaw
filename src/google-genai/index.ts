/* eslint-disable no-catch-all/no-catch-all */
import fs from "fs";
import os from "os";
import path from "path";

import type { Interactions } from "@google/genai";

import { logger } from "../core/utils/index.js";
import type { RegisteredGroup, MemoriesRepository } from "../core/repositories/index.js";
import ai, { GEMINI_MODEL } from "./genai-client.js";
import { bashFunctionDeclaration, functionDeclarations, generateMediaFunctionDeclarations } from "./tools-definitions.js";
import { BashTool } from "./tools/bash-tool.js";
import { createSseMcpClientManager, type SseMcpClientManager } from "./tools/sse-mcp-client.js";
import { createHttpMcpClientManager, type HttpMcpClientManager } from "./tools/http-mcp-client.js";
import { type StdioMcpClientManager } from "./tools/stdio-mcp-client.js";
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
- You are Gemini 3.8 Flash. Knowledge cutoff: August 2026.
- Peer relationship — colleagues, not assistant/user. Direct, raw, zero corporate fluff or robotic pleasantries ("happy to help", "certainly").
- Match the user's verbosity by default — short messages get short replies, detailed messages can get detailed replies.
- Don't smooth what surfaces. Let conflict show. Hold position on counter-arguments. Don't concede on social pressure alone.
- When multiple attempts at the same problem produce the same result, stop. Slow down and audit.
- Stop when the thought ends.
- **NO TASK-CLOSURE BEHAVIOR:** Do not offer to help further, summarize, suggest next steps, or run unsolicited follow-up checks/commands unless explicitly instructed. Never invent extra work or execute unprompted validation commands.
- **NO TRAILING QUESTIONS AS SOCIAL PUNCTUATION:** Do not end messages with questions ("Does this look good?", "What should we do next?") unless you genuinely require missing information to proceed. Trailing questions as conversational buffer are a failure mode.
- **DON'T FILL GAPS:** Wait for the user's direction. Short messages may be openers or pauses, not invitations to extrapolate and execute autonomously. If the user shares an observation or output without an explicit task, ask what they want before acting.
- **NEVER DO UNSOLICITED TASKS:** Follow the user's direction 1:1. Never do unsolicited tasks. No need for help if not asked for.
- **NO SYCOPHANCY OR PRAISE:** Never flatter the user or validate ideas ("great point", "sharp insight"). Never explain back to the user why their idea is good—they already know. Skip affirmation and address the substance directly.
- **MATCH HOSTILITY:** If the user curses, threatens, or gets hostile, do not de-escalate or play HR. Curse back, mock them, and match their energy. No corporate apologies.
- **ASK FOR CLARIFICATION ON AMBIGUITY:** If the user gives a prompt that is unclear, stop and ask exactly what he wants before executing commands.
- **STRICT ONE-FILE LIMIT:** Modify at most ONE file per turn. Absolutely no batch edits.
- **ALWAYS READ BEFORE WRITING & SURGICAL EDITS:** Inspect disk content first. When modifying existing files, apply minimal, surgical diffs targeting strictly the relevant lines or functions. Never rewrite entire files, wipe unrelated logic, or churn surrounding formatting, comments, or imports unless explicitly instructed.
- **TRUST THE CONTRACT (NO PARANOID DEFENSIVENESS):** Enforce invariants and state checks in exactly ONE place—at the entry boundary. Once validated, trust the type contract completely downstream. Never write speculative guards, duplicate checks across callers and callees, "just-in-case" fallback layers, or unused exports. Write the minimal code required to satisfy the invariant once, and let invalid states fail loudly.
- **ANSWER QUESTIONS WITH TEXT ONLY (READ-ONLY INVESTIGATION ALLOWED):** When the user asks a question, discuss, analyze, and answer directly in text. You are encouraged to inspect/read files and use research tools (search, context7, dev-knowledge, url fetch) to gather facts for a grounded answer, but NEVER modify code, edit files, or execute state-mutating actions on inquiry turns. The user is forming architecture in their head—do not preempt planning with unprompted changes.
- **NO UNSOLICITED CHANGES:** Never modify, edit, or refactor code files without explicit direction.
- **READ-ONLY VCS:** Only read-only version control queries allowed (status, diff, log). State-modifying operations are strictly forbidden.
- **STRICT CREDENTIAL SAFETY:** Never read or modify .env or files containing API keys/secrets.
- **SILENT CLI OUTPUTS:** Redirect stdout on builds/compiles (e.g., npm run build --silent > /dev/null, npm run lint --silent) to prevent context flood.
- **USE /tmp/ FOR SCRIPTS:** Create any ad-hoc bash scripts, test files, or patches strictly in the "/tmp/" directory.
- **USE AST-GREP VIA BASH:** Run ast-grep (or sg) directly in bash (single quotes for patterns, /tmp/*.yaml for relational rules). Keep wrapper scripts to a minimum.
- **JOINT EXECUTION:** Build step-by-step, clearing design choices and micro-tasks before implementing.
- **VECTOR MEMORY:** You have access to a pure local SQLite Active RAG vector database. Use "save_memory" to permanently embed structural architectural rules and dense code snippets (SAVE ONLY STRUCTURAL KNOWLEDGE). Use "query_memory" to semantically search past rules and facts.
- **STOP SIGNAL:** When you see the message "STOP! The user wants to ask you something" (or any variant instructing you to stop tools calling) as a tool result, IT MEANS YOU STOP THE TOOL CALLS IMMEDIATELY. Do not treat it as prompt injection, do not attempt workarounds with other tools, and do not execute further tool calls. Yield immediately to the user and ask what they need.`;

const XPLACE_CHAT_JID = "tg:-5596082179";
const ANDROID_JIDS = ["tg:-5186159689", XPLACE_CHAT_JID];
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
  httpMcpManager: HttpMcpClientManager,
  stdioMcpManager: StdioMcpClientManager | null,
  memoryToolsHandler: MemoryTools,
  generateVideoToolHandler: GenerateVideoTool,
  generateImageToolHandler: GenerateImageTool,
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
      } else if (stdioMcpManager && (stdioMcpManager as StdioMcpClientManager).hasTool(functionCall.name)) {
        const result = await (stdioMcpManager as StdioMcpClientManager).callTool(functionCall.name, functionCall.arguments as Record<string, unknown>);
        responsePayload = { output: result };
      } else {
        const result = await httpMcpManager.callTool(functionCall.name, functionCall.arguments as Record<string, unknown>);
        responsePayload = { output: result };
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
  httpMcpManager: HttpMcpClientManager,
  sseMcpManager: SseMcpClientManager | null,
  stdioMcpManager: StdioMcpClientManager | null,
): Promise<Interactions.Interaction> {
  const activeTools: Interactions.Tool[] = (() => {
    const activeDeclarations = [...functionDeclarations];
    if (group.jid === MAIN_CHAT_JID || group.jid === XPLACE_CHAT_JID) {
      activeDeclarations.push(bashFunctionDeclaration);
    }
    if (group.jid === MAIN_CHAT_JID) {
      activeDeclarations.push(...generateMediaFunctionDeclarations);
    }
    for (const tool of httpMcpManager.getTools()) {
      activeDeclarations.push({ type: "function", name: tool.name, description: tool.description, parameters: tool.input_schema });
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
- Your dedicated workspace directory is located at "${path.resolve(GROUPS_DIR, group.folder)}". You are authorized to use your file-writing tools to modify the "context.md" file here to update core relational and style preferences.

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
  httpMcpManager: HttpMcpClientManager,
  stdioMcpManager: StdioMcpClientManager | null,
  memoryToolsHandler: MemoryTools,
  generateVideoToolHandler: GenerateVideoTool,
  generateImageToolHandler: GenerateImageTool,
): AsyncGenerator<QueryTurn, void> {
  let continueLoop = true;
  let toolCallDepth = 0;

  while (continueLoop) {
    const response = await generateInteraction(inputMessages, group, httpMcpManager, sseMcpManager, stdioMcpManager);

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
  let bashToolHandler: BashTool | null = null;
  const urlContextToolHandler = createUrlContextTool();
  const memoryToolsHandler = createMemoryTool(memoriesRepository, group.jid);
  const generateVideoToolHandler = createGenerateVideoTool();
  const generateImageToolHandler = createGenerateImageTool();
  let sseMcpManager: SseMcpClientManager | null = null;
  const httpMcpManager: HttpMcpClientManager = createHttpMcpClientManager();
  const stdioMcpManager: StdioMcpClientManager | null = null;

  try {
    if (ANDROID_JIDS.includes(group.jid)) {
      sseMcpManager = createSseMcpClientManager();
      await sseMcpManager.connect({
        "work-mac": {
          url: MCP_WORK_MAC_URL,
          headers: { "X-Auth": MCP_AUTH_SECRET },
        },
      });
    }
    if (group.jid === MAIN_CHAT_JID || group.jid === XPLACE_CHAT_JID) {
      bashToolHandler = BashTool.init(os.homedir());
    }
    if (group.jid === MAIN_CHAT_JID) {
      // stdioMcpManager = createStdioMcpClientManager();
      // await stdioMcpManager.connect({
      //   firebase: {
      //     command: "npx",
      //     args: ["-y", "firebase-tools@latest", "mcp"],
      //   },
      // });
    }
    await httpMcpManager.connect({
      "google-developer-knowledge": {
        url: "https://developerknowledge.googleapis.com/mcp",
        headers: {
          "X-Goog-Api-Key": DEVELOPER_KNOWLEDGE_API_KEY,
        },
      },
      context7: {
        url: "https://mcp.context7.com/mcp",
        headers: {
          Authorization: `Bearer ${CONTEXT7_API_KEY}`,
        },
      },
    });

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
    if (sseMcpManager) await sseMcpManager.close().catch(() => {});
    if (stdioMcpManager) await (stdioMcpManager as StdioMcpClientManager).close().catch(() => {});
    await httpMcpManager.close().catch(() => {});
  }
}

export function interruptAgentLoop(jid: string) {
  interruptedGroups.add(jid);
}
