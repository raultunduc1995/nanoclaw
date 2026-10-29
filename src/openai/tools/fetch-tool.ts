import client from "../openai-client.js";

export interface FetchToolInput {
  url: string;
}

export interface FetchResponse {
  title: string;
  content: string;
}

export interface FetchTool {
  execute: (input: FetchToolInput) => Promise<FetchResponse>;
}

export const createFetchTool = (): FetchTool => {
  const execute = async (input: FetchToolInput): Promise<FetchResponse> => {
    return client.post<FetchResponse>("/v1/tools/fetch", {
      body: input,
    });
  };

  return {
    execute,
  };
};
