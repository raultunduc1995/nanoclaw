import type { ImageMimeType, VideoMimeType, AudioMimeType, PdfMimeType } from "../core/common/index.js";
import { RegisteredGroup } from "../core/repositories/groups-repository.js";

interface GeminiAgentInputBase {
  userName: string;
  prompt: string;
  group: Pick<RegisteredGroup, "jid" | "folder" | "temperature">;
}
interface GeminiAgentTextInput extends GeminiAgentInputBase {
  kind: "text";
}
interface GeminiAgentImageInput extends GeminiAgentInputBase {
  kind: "image";
  blob: Blob;
  mimeType: ImageMimeType;
}
interface GeminiAgentVideoInput extends GeminiAgentInputBase {
  kind: "video";
  blob: Blob;
  mimeType: VideoMimeType;
}
interface GeminiAgentVoiceInput extends GeminiAgentInputBase {
  kind: "voice";
  blob: Blob;
  mimeType: AudioMimeType;
}
interface GeminiAgentPdfInput extends GeminiAgentInputBase {
  kind: "pdf";
  blob: Blob;
  mimeType: PdfMimeType;
}

export type GeminiAgentInput = GeminiAgentTextInput | GeminiAgentImageInput | GeminiAgentVideoInput | GeminiAgentVoiceInput | GeminiAgentPdfInput;
