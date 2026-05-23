import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../core/utils/index.js";

export type ModelInfo = Anthropic.Models.ModelInfo;

export type TextBlockParam = Anthropic.TextBlockParam;
export type ContentBlockParam = Anthropic.ContentBlockParam;
export type MessageParam = Anthropic.MessageParam;
export type QueryCreateParams = Anthropic.MessageCreateParams;

export type ContentBlock = Anthropic.ContentBlock;
export interface Message extends Anthropic.Message {
  promptTokensAfterThisTurn: number;
}

const client = new Anthropic({
  logger: logger.child({ name: "Anthropic" }),
  logLevel: "info",
});

export async function listModels(): Promise<ModelInfo[]> {
  const modelsInfo = [];
  for await (const modelInfo of client.models.list()) {
    modelsInfo.push(modelInfo);
  }
  return modelsInfo;
}

function mapAnthropicMessageToMessage(message: Anthropic.Message): Message {
  const usage = message.usage;
  const promptTokensAfterThisTurn = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + usage.output_tokens;

  return {
    ...message,
    promptTokensAfterThisTurn,
  };
}

export async function* query(params: QueryCreateParams): AsyncGenerator<Message, void> {
  const inputMessages: Array<MessageParam> = [...params.messages];
  let maxTokensPerMessage = params.max_tokens;
  let message: Anthropic.Message = await client.messages.create({
    ...params,
    max_tokens: maxTokensPerMessage,
    messages: inputMessages,
    stream: false,
  });
  logger.debug({ message }, "Anthropic.Message received");

  while (true) {
    switch (message.stop_reason) {
      case "end_turn":
        if (message.content.length !== 0) {
          yield mapAnthropicMessageToMessage(message);
          return;
        }
        inputMessages.push({ role: "user", content: [{ type: "text", text: "Please continue" }] });
        break;

      case "max_tokens":
        logger.warn({ stop_reason: message.stop_reason }, "Response truncated at max_tokens");
        maxTokensPerMessage += 10_000;
        break;

      case "stop_sequence":
        logger.warn({ stop_reason: message.stop_reason, stop_sequence: message.stop_sequence }, "Stopped at sequence");
        yield mapAnthropicMessageToMessage(message);
        return;

      case "tool_use":
        logger.warn({ stop_reason: message.stop_reason }, "Tool use triggered but no tool dispatch implemented in v0");
        throw new Error("stop_reason='tool_use' but no tool dispatch implemented in v0");

      case "pause_turn":
        logger.warn({ stop_reason: message.stop_reason }, "Turn paused");
        inputMessages.push({ role: "assistant", content: message.content });
        break;

      case "refusal":
        logger.error({ stop_reason: message.stop_reason }, "Model refused to respond");
        throw new Error("Claude was unable to process this request");

      default:
        logger.warn({ stop_reason: message.stop_reason }, "Unknown stop_reason");
        yield mapAnthropicMessageToMessage(message);
        return;
    }

    message = await client.messages.create({
      ...params,
      max_tokens: maxTokensPerMessage,
      messages: inputMessages,
      stream: false,
    });
    logger.debug({ message }, "Anthropic.Message received");
  }
}
