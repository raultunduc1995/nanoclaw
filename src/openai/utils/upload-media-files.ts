import { toFile } from "openai";
import client from "../openai-client.js";

export const uploadMediaFile = async (file: Blob, mimeType: string): Promise<string> => {
  const uploaded = await client.files.create({
    file: await toFile(file, "image", { type: mimeType }),
    purpose: "user_data",
  });

  return uploaded.id;
};
