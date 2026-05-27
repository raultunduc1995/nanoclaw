import Anthropic from "@anthropic-ai/sdk";

export type TextBlockParam = Anthropic.TextBlockParam;
export type ServerToolUseBlockParam = Anthropic.ServerToolUseBlockParam;
export type WebSearchToolResultBlockParam = Anthropic.WebSearchToolResultBlockParam;
export type WebFetchToolResultBlockParam = Anthropic.WebFetchToolResultBlockParam;
export type ContentBlockParam = TextBlockParam | ServerToolUseBlockParam | WebSearchToolResultBlockParam | WebFetchToolResultBlockParam;
export type MessageParam = Pick<Anthropic.MessageParam, "role"> & {
  content: Array<ContentBlockParam>;
};

export type TextBlock = Anthropic.TextBlock;
export type ThinkingBlock = Anthropic.ThinkingBlock;
export type WebSearchToolResultBlock = Anthropic.WebSearchToolResultBlock;
export type WebFetchToolResultBlock = Anthropic.WebFetchToolResultBlock;
export type ContentBlock = Anthropic.ContentBlock;
export type Message = Pick<Anthropic.Message, "content" | "role" | "stop_reason" | "type">;

export type ModelInfo = Anthropic.ModelInfo;

export class RefusalError extends Error {
  constructor(message = "Claude refused to process this request") {
    super(message);
    this.name = "RefusalError";
  }
}
