import type { ContentBlockParam } from "../client-sdk/index.js";
import type { ImageMimeType } from "../core/common/index.js";
import { RegisteredGroup } from "../core/repositories/groups-repository.js";

interface AgentInputBase {
  userName: string;
  prompt: string;
  group: Pick<RegisteredGroup, "jid" | "folder">;
}
interface AgentTextInput extends AgentInputBase {
  kind: "text";
}
interface AgentImageInput extends AgentInputBase {
  kind: "image";
  imageBase64: string;
  imageMimeType: ImageMimeType;
}

export type AgentInput = AgentTextInput | AgentImageInput;

export type HistoryEntry = {
  role: "user" | "assistant";
  content: Array<ContentBlockParam>;
};
