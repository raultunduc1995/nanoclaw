import { Context7 } from "@upstash/context7-sdk";
import { CONTEXT7_API_KEY } from "../../core/utils/config.js";

export interface Context7Tools {
  searchLibrary: (args: { query: string; libraryName?: string }) => Promise<string>;
  getContext: (args: { query: string; libraryId: string }) => Promise<string>;
}

export const createContext7Tools = (): Context7Tools => {
  const client = new Context7({
    apiKey: CONTEXT7_API_KEY,
  });
  return {
    searchLibrary: async ({ query, libraryName }) => {
      try {
        const results = await client.searchLibrary(query, libraryName || "", { type: "json" });

        if (!results || (Array.isArray(results) && results.length === 0)) {
          return "No libraries found matching the query.";
        }

        return JSON.stringify(results);
      } catch (error) {
        if (error instanceof Error) {
          console.error("Context7 API Error:", error.message);
          return `Error searching Context7 library: ${error.message}`;
        } else {
          console.error("Unexpected error:", error);
          return `Error searching Context7 library: ${String(error)}`;
        }
      }
    },
    getContext: async ({ query, libraryId }) => {
      try {
        const result = await client.getContext(query, libraryId, { type: "txt" });

        if (!result) {
          return "No relevant documentation found for that query and library.";
        }

        return result;
      } catch (error) {
        if (error instanceof Error) {
          console.error("Context7 API Error:", error.message);
          return `Error retrieving Context7 docs: ${error.message}`;
        } else {
          console.error("Unexpected error:", error);
          return `Error retrieving Context7 docs: ${String(error)}`;
        }
      }
    },
  };
};
