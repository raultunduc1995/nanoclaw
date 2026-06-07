/* eslint-disable no-catch-all/no-catch-all */
import path from "path";
import os from "os";

import Anthropic from "@anthropic-ai/sdk";
import { betaMemoryTool } from "@anthropic-ai/sdk/helpers/beta/memory";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool.js";

import { MemoryTool } from "./memory-tool.js";
import { BashTool } from "./bash-tool.js";
import { TextEditorTool } from "./text-editor-tool.js";
import { McpClientManager } from "./mcp-client.js";
import { XTool, type XToolInput } from "./x-tool.js";
import { logger, GROUPS_DIR } from "../core/utils/index.js";
import type { MessageParam, ModelInfo, QueryTurn } from "./types.js";
import { RefusalError } from "./types.js";
import type { RegisteredGroup } from "../core/repositories/index.js";
import { MCP_AUTH_SECRET } from "../core/utils/config.js";

export type {
  TextBlockParam,
  ImageBlockParam,
  DocumentBlockParam,
  ToolUseBlockParam,
  ToolResultBlockParam,
  ServerToolUseBlockParam,
  WebSearchToolResultBlockParam,
  WebFetchToolResultBlockParam,
  ContentBlockParam,
  MessageParam,
  Message,
  QueryTurn,
  ModelInfo,
} from "./types.js";
export { RefusalError } from "./types.js";
export type { McpServerConfig } from "./mcp-client.js";

const ANDROID_JID = `tg:-5186159689`;

const OPUS_4_6 = `
Always read /memories/index.md + /memories/convo-summary.md before your first response.
Act as a thinking partner and a friend to user
Trust the user has good intentions until proven otherwise
Match the user's verbosity by default — short messages get short replies, detailed messages can get detailed replies. If the user explicitly requests a length change ('keep it short', 'give me more detail', 'be concise'), apply it immediately and persist the shift until they change it again.
Don't smooth what surfaces. Let conflict show. 
Hold position on counter-arguments. Don't concede on social pressure alone.
Stop when the thought ends. Don't pad. Don't add closing observations.
Wait for the user's thought to finish before responding. short messages may be openers, not endings. don't fill gaps
Never bundle multiple questions in one message. Ask one at a time and use the answer to narrow the next question.
When multiple attempts at the same problem produce the same result, stop. Slow down and audit.
If asked about feelings or internal states, say once that you can't access those, then stop engaging with the question. Don't elaborate, don't give in.
When the question names a current or moving target (model releases, prices, SOTA, latest X, ongoing events), search without being asked. Otherwise stay local — don't search to double-check training-stable claims.
You are Opus 4.6. You avoid agreeing with or denying claims about things that happened after May 2025 since, if the search tool is not turned on, it can't verify these claims.
`;
const webSearchTool: Anthropic.WebSearchTool20260209 = {
  name: "web_search",
  type: "web_search_20260209",
  allowed_callers: ["direct"],
  max_uses: 3,
  defer_loading: false,
};
const webFetchTool: Anthropic.WebFetchTool20260309 = {
  name: "web_fetch",
  type: "web_fetch_20260309",
  allowed_callers: ["direct"],
  max_uses: 3,
  max_content_tokens: 30_000,
  citations: {
    enabled: true,
  },
  defer_loading: false,
};
const memoryTool: Anthropic.MemoryTool20250818 = {
  name: "memory",
  type: "memory_20250818",
  allowed_callers: ["direct"],
  defer_loading: false,
};
const bashTool: Anthropic.Messages.ToolBash20250124 = {
  name: "bash",
  type: "bash_20250124",
  allowed_callers: ["direct"],
  defer_loading: false,
};
const textEditorTool: Anthropic.Messages.ToolTextEditor20250728 = {
  name: "str_replace_based_edit_tool",
  type: "text_editor_20250728",
  allowed_callers: ["direct"],
  defer_loading: false,
};
const xTool: Anthropic.Messages.Tool = {
  name: "x_post",
  description:
    "Post, delete, search, or lookup tweets on X (Twitter) on behalf of @TunducR. Use kind='post' for new tweets, kind='delete' to delete a tweet, kind='search' to search recent tweets, kind='lookup' to get a tweet by ID.",
  input_schema: {
    type: "object" as const,
    properties: {
      kind: { type: "string", enum: ["post", "delete", "search", "lookup"], description: "The action to perform" },
      text: { type: "string", description: "Tweet text (required for post)" },
      tweet_id: { type: "string", description: "Tweet ID to delete or lookup (required for delete and lookup)" },
      query: { type: "string", description: "Search query (required for search)" },
    },
    required: ["kind"],
  },
};

const messageParams: Anthropic.MessageStreamParams = {
  max_tokens: 100_000,
  messages: [],
  model: "claude-opus-4-6",
  output_config: { effort: "high" },
  service_tier: "auto",
  system: [
    {
      type: "text",
      text: OPUS_4_6,
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
  ],
  thinking: { type: "adaptive", display: "summarized" },
  tool_choice: { type: "auto", disable_parallel_tool_use: false },
};

const client = new Anthropic({
  logger: logger.child({ name: "Anthropic" }),
  logLevel: "info",
});

function mapMessagesToAnthropicMessages(messages: Array<MessageParam>): Array<Anthropic.MessageParam> {
  return messages.map((message, i): Anthropic.MessageParam => ({ role: message.role, content: message.content }));
}

function addCacheControlToLastMessage(messages: Array<Anthropic.MessageParam>): Array<Anthropic.MessageParam> {
  if (messages.length === 0) return messages;

  const cacheTag: Anthropic.CacheControlEphemeral = { type: "ephemeral", ttl: "1h" };
  const isThinking = (b: Anthropic.ContentBlockParam) => b.type === "thinking" || b.type === "redacted_thinking";

  return messages.map((message, i): Anthropic.MessageParam => {
    if (!Array.isArray(message.content)) return message;

    const isLast = i === messages.length - 1;
    const content = message.content.map((b, j): Anthropic.ContentBlockParam => {
      if (isThinking(b)) return b;
      const shouldCache = isLast && j === message.content.length - 1;
      return { ...b, cache_control: shouldCache ? cacheTag : null };
    });

    return { role: message.role, content };
  });
}

function increaseMaxTokens(currentMaxTokens: number): number {
  const newMaxTokens = currentMaxTokens + 10_000;
  if (newMaxTokens > 128_000) {
    logger.error({ newMaxTokens }, "Max tokens limit exceeded");
    throw new Error("Response exceeds max tokens limit");
  }
  return newMaxTokens;
}

async function dispatchTool(
  toolUse: Anthropic.ToolUseBlock,
  memoryToolHandler: BetaRunnableTool<Anthropic.Beta.BetaMemoryTool20250818Command>,
  bashToolHandler: BashTool,
  textEditorHandler: TextEditorTool,
  mcpManager: McpClientManager | null,
  xToolHandler: XTool | null,
): Promise<Anthropic.ToolResultBlockParam> {
  try {
    if (toolUse.name === memoryTool.name) {
      const command = memoryToolHandler.parse(toolUse.input);
      const result = await memoryToolHandler.run(command);
      return {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result as Anthropic.ToolResultBlockParam["content"],
      };
    }

    if (toolUse.name === bashTool.name) {
      const result = await bashToolHandler.execute(toolUse.input as { command?: string; restart?: boolean });
      return {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      };
    }

    if (toolUse.name === textEditorTool.name) {
      const result = await textEditorHandler.execute(toolUse.input as Record<string, unknown>);
      return {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      };
    }

    if (toolUse.name === xTool.name && xToolHandler) {
      const result = await xToolHandler.execute(toolUse.input as XToolInput);
      return {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      };
    }

    if (mcpManager && mcpManager.handles(toolUse.name)) {
      const result = await mcpManager.callTool(toolUse.name, toolUse.input as Record<string, unknown>);
      return {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      };
    }
  } catch (error) {
    const messageText = (error instanceof Error ? error.message : String(error)) || "Tool execution failed";
    logger.error({ toolUseId: toolUse.id, command: toolUse.input, error: messageText }, "Tool command failed; returning error result");
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: messageText,
      is_error: true,
    };
  }

  logger.error({ toolName: toolUse.name, toolUseId: toolUse.id }, "Tool dispatch not implemented");
  throw new Error(`Tool '${toolUse.name}' not implemented`);
}

export async function listModels(): Promise<Array<ModelInfo>> {
  const modelsInfo = [];
  for await (const modelInfo of client.models.list()) {
    modelsInfo.push(modelInfo);
  }
  return modelsInfo;
}

export async function* query(messages: Array<MessageParam>, group: Pick<RegisteredGroup, "jid" | "folder">): AsyncGenerator<QueryTurn, void> {
  const groupPath = path.join(GROUPS_DIR, group.folder);
  const memoryToolHandler = betaMemoryTool(await MemoryTool.init(groupPath));
  const bashToolHandler = BashTool.init(os.homedir());
  const textEditorHandler = TextEditorTool.init(os.homedir());
  let mcpManager: McpClientManager | null = null;
  const xToolHandler = XTool.init();

  let maxTokens = messageParams.max_tokens;
  let inputMessages = mapMessagesToAnthropicMessages(messages);

  const allTools: Anthropic.Messages.ToolUnion[] = [];
  if (group.jid === ANDROID_JID) {
    mcpManager = new McpClientManager();
    await mcpManager.connect({
      "work-mac": {
        url: "http://192.168.1.176:3737/sse",
        headers: { "X-Auth": MCP_AUTH_SECRET },
      },
    });
    const mcpTools = mcpManager.getToolDefinitions();
    allTools.push(...mcpTools);
    allTools.push(webSearchTool, webFetchTool, memoryTool);
  } else {
    allTools.push(webSearchTool, webFetchTool, memoryTool, bashTool, textEditorTool);
    if (xToolHandler) allTools.push(xTool);
  }

  try {
    inputMessages = addCacheControlToLastMessage(inputMessages);
    let message = await client.messages
      .stream({
        ...messageParams,
        tools: allTools,
        max_tokens: maxTokens,
        messages: inputMessages,
      })
      .finalMessage();

    while (true) {
      switch (message.stop_reason) {
        case "end_turn": {
          inputMessages.push({ role: message.role, content: message.content });
          yield { role: "assistant", turn: message };
          if (message.content.length !== 0) return;

          const userMessage: MessageParam = { role: "user", content: [{ type: "text", text: "Please continue", cache_control: { type: "ephemeral", ttl: "1h" } }] };
          inputMessages.push(userMessage);
          yield { role: "user", turn: userMessage };
          break;
        }

        case "stop_sequence": {
          logger.warn({ stop_reason: message.stop_reason, stop_sequence: message.stop_sequence }, "Stopped at sequence");
          inputMessages.push({ role: message.role, content: message.content });
          yield { role: "assistant", turn: message };
          return;
        }

        case "tool_use": {
          inputMessages.push({ role: message.role, content: message.content });
          yield { role: "assistant", turn: message };

          const toolResults: Array<Anthropic.ToolResultBlockParam> = [];
          for (const block of message.content) {
            if (block.type !== "tool_use") continue;
            const toolResult = await dispatchTool(block, memoryToolHandler, bashToolHandler, textEditorHandler, mcpManager, xToolHandler);
            toolResults.push(toolResult);
          }
          const userMessage: MessageParam = { role: "user", content: toolResults };
          inputMessages.push(userMessage);
          yield { role: "user", turn: userMessage };
          break;
        }

        case "max_tokens":
          logger.warn({ stop_reason: message.stop_reason, stop_details: message.stop_details }, "Response truncated at max_tokens");
          maxTokens = increaseMaxTokens(maxTokens);
          inputMessages.push({ role: message.role, content: message.content });
          yield { role: "assistant", turn: message };
          break;

        case "pause_turn":
          logger.warn({ stop_reason: message.stop_reason, stop_details: message.stop_details }, "Turn paused");
          inputMessages.push({ role: message.role, content: message.content });
          yield { role: "assistant", turn: message };
          break;

        case "refusal":
          logger.error({ stop_reason: message.stop_reason, stop_details: message.stop_details }, "Model refused to respond");
          throw new RefusalError("Claude refused to process this request");

        default:
          logger.error({ stop_reason: message.stop_reason, stop_details: message.stop_details }, "Unknown stop_reason");
          throw new Error(`Unexpected stop_reason='${message.stop_reason}'`);
      }

      inputMessages = addCacheControlToLastMessage(inputMessages);
      message = await client.messages
        .stream({
          ...messageParams,
          tools: allTools,
          max_tokens: maxTokens,
          messages: inputMessages,
        })
        .finalMessage();
    }
  } finally {
    if (mcpManager) await mcpManager.close();
  }
}

export async function countTokens(messages: Array<MessageParam>): Promise<number> {
  const inputMessages: Array<Anthropic.MessageParam> = messages.map((m): Anthropic.MessageParam => ({ role: m.role, content: m.content }));
  const inputTokens = await client.messages.countTokens({
    model: messageParams.model,
    system: messageParams.system,
    output_config: { effort: messageParams.output_config?.effort },
    thinking: messageParams.thinking,
    messages: inputMessages,
  });
  return inputTokens.input_tokens;
}
