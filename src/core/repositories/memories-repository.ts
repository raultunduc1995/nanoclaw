import type { MemoriesLocalResource, MemorySearchResult } from "../db/index.js";
import ai from "../../google-genai/genai-client.js";

export interface MemoriesRepository {
  saveMemory: (jid: string, content: string, tags: string[]) => Promise<number>;
  queryMemories: (jid: string, query: string, limit?: number) => Promise<MemorySearchResult[]>;
  deleteMemory: (jid: string, id: number) => Promise<boolean>;
}

export const createMemoriesRepository = (resource: MemoriesLocalResource): MemoriesRepository => ({
  saveMemory: async (jid, content, tags) => {
    const response = await ai.models.embedContent({
      model: "gemini-embedding-2",
      contents: content,
    });

    const embedding = response.embeddings?.[0]?.values;
    if (!embedding) {
      throw new Error("Failed to generate embedding for memory");
    }

    return await resource.insert(jid, content, tags, embedding);
  },

  deleteMemory: async (jid, id) => {
    return await resource.delete(jid, id);
  },

  queryMemories: async (jid, query, limit = 10) => {
    const response = await ai.models.embedContent({
      model: "gemini-embedding-2",
      contents: query,
    });

    const embedding = response.embeddings?.[0]?.values;
    if (!embedding) {
      throw new Error("Failed to generate embedding for search query");
    }

    return await resource.searchFull(jid, embedding, limit);
  },
});
