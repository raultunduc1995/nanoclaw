import Anthropic from "@anthropic-ai/sdk";

export type TextBlockParam = Anthropic.TextBlockParam;
export type ImageBlockParam = Anthropic.ImageBlockParam;
export type DocumentBlockParam = Anthropic.DocumentBlockParam;
export type ToolUseBlockParam = Anthropic.ToolUseBlockParam;
export type ToolResultBlockParam = Anthropic.ToolResultBlockParam;
export type ServerToolUseBlockParam = Anthropic.ServerToolUseBlockParam;
export type WebSearchToolResultBlockParam = Anthropic.WebSearchToolResultBlockParam;
export type WebFetchToolResultBlockParam = Anthropic.WebFetchToolResultBlockParam;
export type ContentBlockParam =
  | TextBlockParam
  | ImageBlockParam
  | DocumentBlockParam
  | ToolUseBlockParam
  | ToolResultBlockParam
  | ServerToolUseBlockParam
  | WebSearchToolResultBlockParam
  | WebFetchToolResultBlockParam;

export type MessageParam = Pick<Anthropic.MessageParam, "role"> & {
  content: Array<ContentBlockParam>;
};
export type Message = Pick<Anthropic.Message, "role" | "content">;
export type QueryTurn = { role: "user"; turn: MessageParam } | { role: "assistant"; turn: Message };

export class RefusalError extends Error {
  constructor(message = "Claude refused to process this request") {
    super(message);
  }
}
