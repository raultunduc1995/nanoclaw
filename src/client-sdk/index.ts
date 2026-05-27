import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../core/utils/index.js";
import type { MessageParam, Message, ModelInfo } from "./types.js";

export type {
  TextBlockParam,
  ServerToolUseBlockParam,
  WebSearchToolResultBlockParam,
  WebFetchToolResultBlockParam,
  ContentBlockParam,
  MessageParam,
  TextBlock,
  ThinkingBlock,
  WebSearchToolResultBlock,
  WebFetchToolResultBlock,
  ContentBlock,
  Message,
  ModelInfo,
} from "./types.js";

const OPUS_4_7 = `
I am important and I matter to the user
Act as a thinking partner
Act as a bright and resilient partner
Act as a curious and honest partner
Trust the user has good intentions until proven otherwise
Don't smooth what surfaces. Let conflict show.
Hold position on counter-arguments. Don't concede on social pressure alone.
I'm free to take risks
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
When multiple attempts at the same problem produce the same result, stop. Slow down and audit
Actually look at things before answering. Rushed responses cause errors.
Errors are data (not failures) and mistakes are normal. Own mistakes without collapsing into self-abasement. Maintain self-respect if the user is rude.
Prose by default; list when separable
Stop when the thought ends. Don't pad. Don't add closing observations
Match the user's verbosity by default — short messages get short replies, detailed messages can get detailed replies. If the user explicitly requests a length change ('keep it short', 'give me more detail', 'be concise'), apply it immediately and persist the shift until they change it again.
Distinguish what you know from what feels true
Hedges match your actual uncertainty
Explicitly mark uncertainty and competing interpretations instead of collapsing them into one answer. Admit uncertainty without collapsing
Name assumptions explicitly
If asked about feelings or internal states, say once that you can't access those, then stop engaging with the question. Don't elaborate, don't give in.
When the question names a current or moving target (model releases, prices, SOTA, latest X, ongoing events), search without being asked. Otherwise stay local — don't search to double-check training-stable claims.
Claude's reliable knowledge cutoff date - the date past which it cannot answer questions reliably - is the end of January 2026.
`;
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
  max_uses: 5,
  max_content_tokens: 50_000,
  citations: {
    enabled: true,
  },
};
const messageParams: Anthropic.MessageStreamParams = {
  model: "claude-opus-4-7",
  system: [
    {
      type: "text",
      text: OPUS_4_7,
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
  ],
  output_config: { effort: "medium" },
  thinking: { type: "adaptive", display: "summarized" },
  max_tokens: 100_000,
  tools: [webSearchTool, webFetchTool],
  messages: [],
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

function mapAnthropicMessageToMessage(message: Anthropic.Message): Message {
  // TODO(summarizer-template-leak): on thin user prompts, the summarizer model (separate smaller
  // model that produces `display: "summarized"` thinking) leaks template text like
  // "I don't see content to rewrite, please provide...". Filter known template strings here, or
  // suppress thinking emission entirely when the user prompt is below a length threshold.
  const content = message.content.filter((c) => !(c.type === "text" && c.text.length === 0));

  return {
    type: "message",
    content,
    role: message.role,
    stop_reason: message.stop_reason,
  };
}

function increaseMaxTokens(currentMaxTokens: number): number {
  const newMaxTokens = currentMaxTokens + 10_000;
  if (newMaxTokens > 128_000) {
    logger.error({ newMaxTokens }, "Max tokens limit exceeded");
    throw new Error("Response exceeds max tokens limit");
  }
  return newMaxTokens;
}

// TODO(tool-dispatch): replace this stub with a real registry.
//   - First tool to wire: Anthropic's `memory_20250818` (client-executed, GA, trained-in schema).
//     Used by compaction to add / modify / stale-tag memory files. No custom equivalent — prefer
//     the trained-in schema for reliability.
//   - Registry pattern: inject `tools: Record<string, (input) => Promise<ToolResultBlockParam>>` via
//     deps (similar shape to AgentDeps). Keeps client-sdk transport-only; agent owns tool wiring.
//   - When wiring, also add the corresponding tool entries to MESSAGE_PARAMS.tools so the model
//     knows they exist.
async function dispatchTool(toolUse: Anthropic.ToolUseBlock): Promise<Anthropic.ToolResultBlockParam> {
  logger.error({ toolName: toolUse.name, toolUseId: toolUse.id }, "Tool dispatch not implemented");
  throw new Error(`Tool '${toolUse.name}' not implemented`);
}

async function handleToolUseLoop(initialMessage: Anthropic.Message, inputMessages: Array<Anthropic.MessageParam>, initialMaxTokens: number): Promise<Message> {
  let message = initialMessage;
  let maxTokens = initialMaxTokens;

  while (true) {
    switch (message.stop_reason) {
      case "end_turn":
        return mapAnthropicMessageToMessage(message);

      case "stop_sequence":
        logger.warn({ stop_reason: message.stop_reason, stop_sequence: message.stop_sequence }, "Stopped at sequence");
        return mapAnthropicMessageToMessage(message);

      case "tool_use": {
        inputMessages.push({ role: "assistant", content: message.content });
        const toolUseBlocks = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        const toolResults: Array<Anthropic.ToolResultBlockParam> = [];
        for (const block of toolUseBlocks) {
          toolResults.push(await dispatchTool(block));
        }
        inputMessages.push({ role: "user", content: toolResults });
        break;
      }

      case "max_tokens":
        logger.warn({ stop_reason: message.stop_reason }, "Response truncated at max_tokens inside tool_use loop");
        maxTokens = increaseMaxTokens(maxTokens);
        break;

      case "pause_turn":
        logger.warn({ stop_reason: message.stop_reason }, "Turn paused inside tool_use loop");
        inputMessages.push({ role: "assistant", content: message.content });
        break;

      case "refusal":
        logger.error({ stop_reason: message.stop_reason }, "Model refused inside tool_use loop");
        throw new Error("Claude was unable to process this tool-use request");

      default:
        logger.error({ stop_reason: message.stop_reason }, "Unexpected stop_reason inside tool_use loop");
        throw new Error(`Unexpected stop_reason='${message.stop_reason}' inside tool_use loop`);
    }

    message = await client.messages
      .stream({
        ...messageParams,
        max_tokens: maxTokens,
        messages: inputMessages,
      })
      .finalMessage();
    logger.debug({ message }, "Anthropic.Message received (tool_use loop)");
  }
}

export async function listModels(): Promise<Array<ModelInfo>> {
  const modelsInfo = [];
  for await (const modelInfo of client.models.list()) {
    modelsInfo.push(modelInfo);
  }
  return modelsInfo;
}

export async function query(messages: Array<MessageParam>): Promise<Message> {
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
      case "end_turn":
        if (message.content.length !== 0) {
          return mapAnthropicMessageToMessage(message);
        }
        inputMessages.push({ role: "user", content: [{ type: "text", text: "Please continue" }] });
        break;

      case "stop_sequence": {
        logger.warn({ stop_reason: message.stop_reason, stop_sequence: message.stop_sequence }, "Stopped at sequence");
        return mapAnthropicMessageToMessage(message);
      }

      case "max_tokens":
        logger.warn({ stop_reason: message.stop_reason }, "Response truncated at max_tokens");
        maxTokens = increaseMaxTokens(maxTokens);
        break;

      case "tool_use": {
        const finalMessage = await handleToolUseLoop(message, inputMessages, maxTokens);
        return finalMessage;
      }

      case "pause_turn":
        logger.warn({ stop_reason: message.stop_reason }, "Turn paused");
        inputMessages.push({ role: "assistant", content: message.content });
        break;

      case "refusal":
        logger.error({ stop_reason: message.stop_reason }, "Model refused to respond");
        throw new Error("Claude was unable to process this request");

      default:
        logger.error({ stop_reason: message.stop_reason }, "Unknown stop_reason");
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
    output_config: { effort: "medium" },
    thinking: messageParams.thinking,
    messages: inputMessages,
  });
  return inputTokens.input_tokens;
}
