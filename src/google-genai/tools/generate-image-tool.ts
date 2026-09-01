import { Interactions } from "@google/genai";
import path from "node:path";
import ai from "../genai-client.js";
import { logger } from "../../core/utils/logger.js";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ImageAspectRatio = "1:1" | "2:3" | "3:2" | "3:4" | "4:3" | "4:5" | "5:4" | "9:16" | "16:9" | "21:9" | "1:8" | "8:1" | "1:4" | "4:1";

export interface GenerateImageTool {
  execute: (args: { prompt: string; inputImagesPath?: string[]; aspectRatio?: ImageAspectRatio; imageSize?: "512" | "1K" | "2K" | "4K" }) => Promise<string>;
}

const getMimeType = (filePath: string): string => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".heic") return "image/heic";
  return "image/jpeg";
};

export const createGenerateImageTool = (): GenerateImageTool => {
  return {
    execute: async ({ prompt, inputImagesPath, aspectRatio = "1:1", imageSize = "1K" }) => {
      try {
        const inputPayload: Array<Interactions.Content> = [{ type: "text", text: prompt }];

        if (inputImagesPath && inputImagesPath.length > 0) {
          for (const imgPath of inputImagesPath) {
            const mimeType = getMimeType(imgPath);
            const uploaded = await ai.files.upload({
              file: imgPath,
              config: { mimeType },
            });
            if (uploaded.uri) {
              inputPayload.push({
                type: "image",
                uri: uploaded.uri,
                mime_type: uploaded.mimeType ?? mimeType,
              });
            }
          }
        }

        const response = await ai.interactions.create({
          model: "gemini-3.1-flash-image",
          input: inputPayload,
          tools: [
            {
              type: "google_search",
              search_types: ["web_search", "image_search"],
            },
          ],
          response_format: {
            type: "image",
            aspect_ratio: aspectRatio,
            image_size: imageSize,
          },
          store: false,
        });
        logger.info({ response }, "Image generation interaction response");

        const imageOutput = response.output_image;
        if (!imageOutput?.data) {
          return "Error: No image output returned from the model.";
        }

        const extension = imageOutput.mime_type === "image/png" ? "png" : "jpg";
        const downloadPath = path.join("/Users/raultunduc/Desktop", `generated_image_${Date.now()}.${extension}`);
        const buffer = Buffer.from(imageOutput.data, "base64");
        await fs.writeFile(downloadPath, buffer);
        try {
          await execFileAsync("xattr", ["-w", "com.apple.metadata:kMDItemFinderComment", prompt, downloadPath]);
          await execFileAsync("xattr", ["-w", "com.apple.metadata:kMDItemDescription", prompt, downloadPath]);
        } catch (metaError) {
          logger.warn({ metaError, downloadPath }, "Failed to attach xattr metadata");
        }

        logger.debug({ downloadPath, mimeType: imageOutput.mime_type }, "Image generated and saved successfully");
        return downloadPath;
      } catch (error) {
        return `Error generating image: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
};
