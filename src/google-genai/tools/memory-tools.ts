import { MemoriesRepository } from "../../core/repositories/memories-repository.js";

export interface MemoryTools {
  saveMemory: (args: { content: string; tags: string[] }) => Promise<string>;
  queryMemory: (args: { query: string; limit?: number }) => Promise<string>;
  deleteMemory: (args: { id: number }) => Promise<string>;
}

export const createMemoryTools = (repo: MemoriesRepository, jid: string): MemoryTools => {
  return {
    saveMemory: async ({ content, tags }) => {
      try {
        const id = await repo.saveMemory(jid, content, tags);
        return `Successfully saved memory with ID: ${id}`;
      } catch (error) {
        if (error instanceof Error) {
          console.error("Memory Tool Error:", error.message);
          return `Error saving memory: ${error.message}`;
        }
        console.error("Unexpected error:", error);
        return `Error saving memory: ${String(error)}`;
      }
    },
    deleteMemory: async ({ id }) => {
      try {
        const success = await repo.deleteMemory(jid, id);
        return success ? `Successfully deleted memory with ID: ${id}` : `Memory with ID ${id} not found or does not belong to this group.`;
      } catch (error) {
        if (error instanceof Error) {
          console.error("Memory Tool Error:", error.message);
          return `Error deleting memory: ${error.message}`;
        }
        console.error("Unexpected error:", error);
        return `Error deleting memory: ${String(error)}`;
      }
    },
    queryMemory: async ({ query, limit }) => {
      try {
        const results = await repo.queryMemories(jid, query, limit);
        if (results.length === 0) {
          return "No relevant memories found for that query.";
        }
        return JSON.stringify(results.map(r => ({ id: r.id, content: r.content, tags: r.tags, distance: r.distance })));
      } catch (error) {
        if (error instanceof Error) {
          console.error("Memory Tool Error:", error.message);
          return `Error querying memory: ${error.message}`;
        }
        console.error("Unexpected error:", error);
        return `Error querying memory: ${String(error)}`;
      }
    }
  };
};
