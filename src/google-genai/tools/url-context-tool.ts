import { HarmBlockThreshold, HarmCategory } from "@google/genai";
import ai from "../genai-client.js";
import { logger } from "../../core/utils/logger.js";

export interface UrlContextTool {
  execute: (args: { url: string; query: string }) => Promise<string>;
}

export const createUrlContextTool = (): UrlContextTool => {
  return {
    execute: async ({ url, query }) => {
      const systemInstruction = `
        You are an elite, highly targeted web research and information extraction agent.
        Your job is to use your browse tool to fetch the provided URL, read its contents, and extract ONLY the information requested in the user's query.
        Do not summarize unrelated parts of the page. Do not write introductory or conversational fluff. 
        Deliver a dense, direct, and factual extraction in Markdown matching the request.
      `;

      try {
        const response = await ai.models.generateContent({
          model: "gemini-3.7-flash",
          contents: `URL to browse: ${url}\nTargeted Query/Instructions: ${query}`,
          config: {
            systemInstruction,
            tools: [{ urlContext: {} }],
            safetySettings: [
              { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.OFF },
              { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.OFF },
              { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.OFF },
              { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.OFF },
            ],
          },
        });

        logger.debug({ response }, "Received gemini flash lite web-fetch result");
        return response.text || "No relevant information found matching your query on that page.";
      } catch (error) {
        return `Error executing url_context: ${error instanceof Error ? error.message : String(error)}`;
      }
    },
  };
};
