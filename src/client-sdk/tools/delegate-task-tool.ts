import Anthropic from "@anthropic-ai/sdk";
import { client } from "../anthropic-client.js";
import { webSearchTool, webFetchTool } from "../tools-definitions.js";
import { logger } from "../../core/utils/index.js";

export interface DelegateTaskTool {
  query(type: "websearch" | "webfetch", input: string, instructions: string): Promise<string>;
}

export function createDelegateTaskTool(): DelegateTaskTool {
  return {
    async query(type, input, instructions) {
      const tool: Anthropic.Messages.ToolUnion = type === "websearch" ? webSearchTool : webFetchTool;
      const prompt = type === "websearch" ? `Search for: ${input}\n\nFrom the results, ${instructions}` : `Fetch this URL: ${input}\n\nFrom the fetched content, ${instructions}`;
      const message = await client.messages
        .stream({
          system: [
            {
              type: "text",
              text: "You perform delegated web tasks (searches or fetches) and return concise results based on instructions. Always follow the instructions carefully and return only the relevant information. No commentary.",
            },
          ],
          model: "claude-sonnet-4-6",
          max_tokens: 30_000,
          output_config: { effort: "medium" },
          service_tier: "auto",
          thinking: { type: "disabled" },
          tools: [tool],
          tool_choice: { type: "any", disable_parallel_tool_use: true },
          messages: [{ role: "user", content: prompt }],
        })
        .finalMessage();

      logger.debug({ type, input, instructions, message }, "Received response from delegate task tool");

      const textBlocks = message.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
      return textBlocks.map((b) => b.text).join("\n") || "No results found";
    },
  };
}
