import type { ImageMimeType, VideoMimeType } from "../core/common/index.js";
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
interface GeminiAgentVideoInput extends GeminiAgentInputBase {
  kind: "video";
  inlineData: { mimeType: VideoMimeType; data: string };
}

export type GeminiAgentInput = GeminiAgentTextInput | GeminiAgentImageInput | GeminiAgentVideoInput;
