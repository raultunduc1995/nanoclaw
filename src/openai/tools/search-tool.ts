import client from "../openai-client.js";

export interface SearchToolInput {
  query: string;
  count?: number;
  ori_question?: string;
  need_content?: boolean;
}

export interface SearchResultItem {
  rerank_score: number;
  title: string;
  url: string;
  snippet: string;
  summary: string;
  content: string;
  site_name: string | null;
  site_icon: string | null;
  date: string | null;
  authority: number;
}

export interface SearchResponse {
  results: Array<SearchResultItem>;
}

export interface SearchTool {
  execute: (input: SearchToolInput) => Promise<SearchResponse>;
}

export const createSearchTool = (): SearchTool => {
  const execute = async (input: SearchToolInput): Promise<SearchResponse> => {
    return client.post<SearchResponse>("/v1/tools/search", {
      body: input,
    });
  };

  return {
    execute,
  };
};
