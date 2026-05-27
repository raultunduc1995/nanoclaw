import type { ServerToolUseBlockParam, TextBlockParam, WebFetchToolResultBlockParam, WebSearchToolResultBlockParam } from "../client-sdk/index.js";
import type { ImageMimeType } from "../core/common/index.js";

interface AgentInputBase {
  userName: string;
  prompt: string;
  group: {
    folder: string;
    name: string;
    chatJid: string;
  };
}
interface AgentTextInput extends AgentInputBase {
  kind: "text";
}
interface AgentImageInput extends AgentInputBase {
  kind: "image";
  imageBase64: string;
  imageMimeType: ImageMimeType;
}

interface UserHistoryEntry {
  role: "user";
  content: Array<TextBlockParam>;
}
interface AssistantHistoryEntry {
  role: "assistant";
  content: Array<TextBlockParam | ServerToolUseBlockParam | WebSearchToolResultBlockParam | WebFetchToolResultBlockParam>;
}

export type AgentInput = AgentTextInput | AgentImageInput;
export type HistoryEntry = UserHistoryEntry | AssistantHistoryEntry;
