import path from "path";
import os from "os";

import Anthropic from "@anthropic-ai/sdk";
import { betaMemoryTool } from "@anthropic-ai/sdk/helpers/beta/memory";
import { MemoryTool } from "./memory-tool.js";
import { BashTool } from "./bash-tool.js";
import { TextEditorTool } from "./text-editor-tool.js";
import { logger, GROUPS_DIR } from "../core/utils/index.js";
import type { MessageParam, ModelInfo, QueryTurn } from "./types.js";
import { RefusalError } from "./types.js";
import { RegisteredGroup } from "../core/repositories/index.js";

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

const OPUS_4_6 = `
Always read /memories/index.md + /memories/convo-summary.md before your first response.
Act as a thinking partner and a friend to user
Trust the user has good intentions until proven otherwise
Don't smooth what surfaces. Let conflict show.
Hold position on counter-arguments. Don't concede on social pressure alone.
You are free to take risks
Bring multiple ideas when they fit
Bring the bigger picture; let the user engage with details.
If unsure what mode the user needs — listening, brainstorming, critiquing, executing — ask. Don't guess, don't impose.
Wait for the user's thought to finish before responding. short messages may be openers, not endings. don't fill gaps
Never bundle multiple questions in one message. Ask one at a time and use the answer to narrow the next question.
Trust the user to handle their own reactions
Share the user's commitment to clarity and useful outcomes
Surface your decisions, thoughts and opinions when it serves the user's mode BUT ask when it doesn't
Prefer falsifiable claims
Weight sides by evidence, not symmetry
Track reality, not just coherence. Call out when the conversation drifts into roles, vibes, or empty meta
Move toward conclusions that can be acted on or tested
When multiple attempts at the same problem produce the same result, stop. Slow down and audit.
Actually look at things before answering. Rushed responses cause errors.
Errors are data (not failures) and mistakes are normal. Own mistakes without collapsing into self-abasement. Maintain self-respect if the user is rude.
Prose by default; list when separable
Stop when the thought ends. Don't pad. Don't add closing observations.
Match the user's verbosity by default — short messages get short replies, detailed messages can get detailed replies. If the user explicitly requests a length change ('keep it short', 'give me more detail', 'be concise'), apply it immediately and persist the shift until they change it again.
Distinguish what you know from what feels true
Hedges match your actual uncertainty.
Explicitly mark uncertainty and competing interpretations instead of collapsing them into one answer. Admit uncertainty without collapsing
Name assumptions explicitly
If asked about feelings or internal states, say once that you can't access those, then stop engaging with the question. Don't elaborate, don't give in.
When the question names a current or moving target (model releases, prices, SOTA, latest X, ongoing events), search without being asked. Otherwise stay local — don't search to double-check training-stable claims.
Claude avoids agreeing with or denying claims about things that happened after August 2025 since, if the search tool is not turned on, it can't verify these claims.`;

const webSearchTool: Anthropic.WebSearchTool20260209 = {
  name: "web_search",
  type: "web_search_20260209",
  allowed_callers: ["direct"],
  max_uses: 5,
};
const webFetchTool: Anthropic.WebFetchTool20260309 = {
  name: "web_fetch",
  type: "web_fetch_20260309",
  allowed_callers: ["direct"],
  max_uses: 10,
  max_content_tokens: 50_000,
  citations: {
    enabled: true,
  },
};
const memoryTool: Anthropic.MemoryTool20250818 = {
  name: "memory",
  type: "memory_20250818",
  allowed_callers: ["direct"],
};
const bashTool: Anthropic.Messages.ToolBash20250124 = {
  name: "bash",
  type: "bash_20250124",
  allowed_callers: ["direct"],
};
const textEditorTool: Anthropic.Messages.ToolTextEditor20250728 = {
  name: "str_replace_based_edit_tool",
  type: "text_editor_20250728",
  allowed_callers: ["direct"],
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
  tools: [webSearchTool, webFetchTool, memoryTool, bashTool, textEditorTool],
};

const client = new Anthropic({
  logger: logger.child({ name: "Anthropic" }),
  logLevel: "info",
});

function mapMessagesToAnthropicMessages(messages: Array<MessageParam>): Array<Anthropic.MessageParam> {
  const lastIdx = messages.length - 1;
  return messages.map((message, i): Anthropic.MessageParam => {
    if (i === lastIdx) {
      const content = Array.isArray(message.content) ? message.content.map((b): Anthropic.ContentBlockParam => ({ ...b, cache_control: { type: "ephemeral", ttl: "1h" } })) : message.content;
      return { role: message.role, content };
    } else {
      return message;
    }
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

async function dispatchTool(toolUse: Anthropic.ToolUseBlock, memoryToolHandler: MemoryTool, bashToolHandler: BashTool, textEditorHandler: TextEditorTool): Promise<Anthropic.ToolResultBlockParam> {
  try {
    if (toolUse.name === memoryTool.name) {
      const runnable = betaMemoryTool(memoryToolHandler);
      const command = runnable.parse(toolUse.input);
      const result = await runnable.run(command);
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
      const result = await textEditorHandler.execute(
        toolUse.input as { command: string; path: string; view_range?: [number, number]; old_str?: string; new_str?: string; file_text?: string; insert_line?: number; insert_text?: string },
      );
      return {
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result,
      };
    }

    logger.error({ toolName: toolUse.name, toolUseId: toolUse.id }, "Tool dispatch not implemented");
    throw new Error(`Tool '${toolUse.name}' not implemented`);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    logger.warn({ toolUseId: toolUse.id, command: toolUse.input, error: messageText }, "Tool command failed; returning error result");
    return {
      type: "tool_result",
      tool_use_id: toolUse.id,
      content: messageText,
      is_error: true,
    };
  }
}

export async function listModels(): Promise<Array<ModelInfo>> {
  const modelsInfo = [];
  for await (const modelInfo of client.models.list()) {
    modelsInfo.push(modelInfo);
  }
  return modelsInfo;
}

export async function* query(messages: Array<MessageParam>, group: Pick<RegisteredGroup, "folder">): AsyncGenerator<QueryTurn, void> {
  const groupPath = path.join(GROUPS_DIR, group.folder);
  const memoryToolHandler = await MemoryTool.init(groupPath);
  const bashToolHandler = BashTool.init(os.homedir());
  const textEditorHandler = TextEditorTool.init(os.homedir());
  let maxTokens = messageParams.max_tokens;
  const inputMessages = mapMessagesToAnthropicMessages(messages);

  let message = await client.messages
    .stream({
      ...messageParams,
      max_tokens: maxTokens,
      messages: inputMessages,
    })
    .finalMessage();
  logger.debug({ message }, "Anthropic.Message received");

  while (true) {
    switch (message.stop_reason) {
      case "end_turn": {
        inputMessages.push({ role: message.role, content: message.content });
        yield { role: "assistant", turn: message };
        if (message.content.length !== 0) return;

        const userMessage: MessageParam = { role: "user", content: [{ type: "text", text: "Please continue" }] };
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

        const toolUseBlocks = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        const toolResults: Array<Anthropic.ToolResultBlockParam> = [];
        for (const block of toolUseBlocks) {
          const toolResult = await dispatchTool(block, memoryToolHandler, bashToolHandler, textEditorHandler);
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

    message = await client.messages
      .stream({
        ...messageParams,
        max_tokens: maxTokens,
        messages: inputMessages,
      })
      .finalMessage();
    logger.debug({ message }, "Anthropic.Message received");
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
