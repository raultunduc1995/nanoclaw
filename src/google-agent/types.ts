// google-agent/types.ts

import type { ContentBlockParam } from "../google-genai/index.js";
import type { ImageMimeType } from "../core/common/index.js";
import { RegisteredGroup } from "../core/repositories/groups-repository.js";

interface GeminiAgentInputBase {
  userName: string;
  prompt: string;
  group: Pick<RegisteredGroup, "jid" | "folder">;
}
interface GeminiAgentTextInput extends GeminiAgentInputBase {
  kind: "text";
}
interface GeminiAgentImageInput extends GeminiAgentInputBase {
  kind: "image";
  inlineData: { mimeType: ImageMimeType; data: string };
}

export type GeminiAgentInput = GeminiAgentTextInput | GeminiAgentImageInput;

export type GeminiHistoryEntry = {
  role: "user" | "model";
  content: Array<ContentBlockParam>;
};
