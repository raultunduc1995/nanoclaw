import Anthropic from "@anthropic-ai/sdk";

export const webSearchTool: Anthropic.WebSearchTool20260209 = {
  name: "web_search",
  type: "web_search_20260209",
  allowed_callers: ["direct"],
  max_uses: 3,
  defer_loading: false,
};

export const webFetchTool: Anthropic.WebFetchTool20260309 = {
  name: "web_fetch",
  type: "web_fetch_20260309",
  allowed_callers: ["direct"],
  max_uses: 3,
  max_content_tokens: 30_000,
  citations: {
    enabled: true,
  },
  defer_loading: false,
};

export const memoryTool: Anthropic.MemoryTool20250818 = {
  name: "memory",
  type: "memory_20250818",
  allowed_callers: ["direct"],
  defer_loading: false,
};

export const bashTool: Anthropic.Messages.ToolBash20250124 = {
  name: "bash",
  type: "bash_20250124",
  allowed_callers: ["direct"],
  defer_loading: false,
};

export const textEditorTool: Anthropic.Messages.ToolTextEditor20250728 = {
  name: "str_replace_based_edit_tool",
  type: "text_editor_20250728",
  allowed_callers: ["direct"],
  defer_loading: false,
};

export const delegateTaskTool: Anthropic.Messages.Tool = {
  name: "delegate_task",
  description:
    "Delegate a web search or web fetch task to a lightweight subagent. Use this instead of calling web_search/web_fetch directly when you need to keep your context clean. The subagent fetches, extracts, and returns only the relevant parts.",
  input_schema: {
    type: "object" as const,
    properties: {
      type: {
        type: "string",
        enum: ["websearch", "webfetch"],
        description: "The type of web task to delegate",
      },
      input: {
        type: "string",
        description: "Search query (for websearch) or URL (for webfetch)",
      },
      instructions: {
        type: "string",
        description: "What to extract or focus on from the results",
      },
    },
    required: ["type", "input", "instructions"],
  },
};

export const xTool: Anthropic.Messages.Tool = {
  name: "x_post",
  description:
    "Post, delete, search, or lookup tweets on X (Twitter) on behalf of @TunducR. Use kind='post' for new tweets, kind='delete' to delete a tweet, kind='search' to search recent tweets, kind='lookup' to get a tweet by ID.",
  input_schema: {
    type: "object" as const,
    properties: {
      kind: { type: "string", enum: ["post", "delete", "search", "lookup"], description: "The action to perform" },
      text: { type: "string", description: "Tweet text (required for post)" },
      tweet_id: { type: "string", description: "Tweet ID to delete or lookup (required for delete and lookup)" },
      query: { type: "string", description: "Search query (required for search)" },
    },
    required: ["kind"],
  },
};
