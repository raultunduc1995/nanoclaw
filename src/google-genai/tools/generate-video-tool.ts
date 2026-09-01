import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { FileState } from "@google/genai";
import ai from "../genai-client.js";
import { logger, delay } from "../../core/utils/index.js";

const execFileAsync = promisify(execFile);

export interface GenerateVideoTool {
  execute: (args: { prompt: string; aspectRatio?: "16:9" | "9:16"; resolution?: "360p" | "720p" | "1080p" | "4k" }) => Promise<string>;
}

export const createGenerateVideoTool = (): GenerateVideoTool => {
  return {
    execute: async ({ prompt, aspectRatio = "16:9", resolution = "720p" }) => {
      try {
        const response = await ai.interactions.create({
          model: "gemini-omni-1.1-flash",
          input: prompt,
          response_format: {
            type: "video",
            delivery: "uri",
            aspect_ratio: aspectRatio,
            resolution,
          },
          store: true,
        });
        logger.info({ response }, "Video generation interaction response");

        const videoOutput = response.output_video;
        if (!videoOutput?.uri) {
          return "Error: No video URI returned from the model.";
        }

        const fileIdMatch = videoOutput.uri.match(/files\/([a-zA-Z0-9_-]+)/);
        if (!fileIdMatch) {
          return "Error: Invalid video URI returned from the model.";
        }

        const fileName = `files/${fileIdMatch[1]}`;
        const downloadPath = path.join("/Users/raultunduc/Desktop", `generated_video_${Date.now()}.mp4`);

        while (true) {
          const fileInfo = await ai.files.get({ name: fileName })!;
          if (fileInfo.state === FileState.ACTIVE) break;
          if (fileInfo.state === FileState.FAILED) return "Error: Video processing failed on the server.";
          await delay(3_000);
        }

        await ai.files.download({ file: fileName, downloadPath });
        try {
          await execFileAsync("xattr", ["-w", "com.apple.metadata:kMDItemFinderComment", prompt, downloadPath]);
          await execFileAsync("xattr", ["-w", "com.apple.metadata:kMDItemDescription", prompt, downloadPath]);
        } catch (metaError) {
          logger.warn({ metaError, downloadPath }, "Failed to attach xattr metadata");
        }

        logger.debug({ downloadPath, uri: videoOutput.uri }, "Video generated and downloaded successfully");
        return downloadPath;
      } catch (error) {
        return `Error generating video: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
};
