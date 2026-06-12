import type { ContentBlockParam } from "../client-sdk/index.js";
import type { ImageMimeType } from "../core/common/index.js";
import { RegisteredGroup } from "../core/repositories/groups-repository.js";

interface ClaudeAgentInputBase {
  userName: string;
  prompt: string;
  group: Pick<RegisteredGroup, "jid" | "folder">;
}
interface ClaudeAgentTextInput extends ClaudeAgentInputBase {
  kind: "text";
}
interface ClaudeAgentImageInput extends ClaudeAgentInputBase {
  kind: "image";
  imageBase64: string;
  imageMimeType: ImageMimeType;
}

export type ClaudeAgentInput = ClaudeAgentTextInput | ClaudeAgentImageInput;

export type ClaudeHistoryEntry = {
  role: "user" | "assistant";
  content: Array<ContentBlockParam>;
};
