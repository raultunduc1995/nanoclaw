import { FileState } from "@google/genai";
import ai from "../genai-client.js";
import { delay } from "../../core/utils/promise-utils.js";

export interface UploadedMedia {
  uri: string;
  mimeType: string;
}

export const uploadMediaFile = async (file: Blob, mimeType: string): Promise<UploadedMedia> => {
  const myFile = await ai.files.upload({
    file,
    config: { mimeType },
  });

  let getFile = await ai.files.get({ name: myFile.name! });
  while (getFile.state === FileState.PROCESSING) {
    await delay(3_000);
    getFile = await ai.files.get({ name: myFile.name! });
  }
  if (getFile.state === FileState.FAILED) {
    throw new Error(`File processing failed.`);
  }

  return {
    uri: myFile.uri!,
    mimeType: myFile.mimeType || mimeType,
  };
};
