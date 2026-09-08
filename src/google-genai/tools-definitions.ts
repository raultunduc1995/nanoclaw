import type { Interactions } from "@google/genai";

export const bashFunctionDeclaration: Interactions.Tool = {
  type: "function",
  name: "bash",
  description: `Execute a single bash command string on the local server.

ast-grep (sg) is pre-installed for structural AST code search and rewriting:
- Search: ast-grep run -l <lang> -p '<pattern>' <path>
- Rewrite: ast-grep run -l <lang> -p '<pattern>' -r '<rewrite>' -U <path>
  Flags: -p/--pattern, -r/--rewrite, -l/--lang (typescript, kotlin, etc.), -U/--update-all (apply in-place without asking).
- Metavariables: $VAR matches single AST node, $$$VAR matches multiple nodes/statements/args.
- Shell quoting: ALWAYS use single quotes ('...') around patterns and rewrites so bash does not expand metavariables.
- Complex relational rules: Write YAML rule to /tmp/rule.yaml and execute:
  ast-grep scan -r /tmp/rule.yaml -U <path>`,
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The exact bash command line to run.",
      },
      restart: {
        type: "boolean",
        description: "Whether to restart the bash session (clearing all context) before executing this command.",
      },
    },
    required: ["command"],
  },
};

export const functionDeclarations: Interactions.Tool[] = [
  {
    type: "function",
    name: "fetch_url_context",
    description: "Browse a specific URL and extract targeted information based on custom instructions or questions.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The full web URL to browse.",
        },
        query: {
          type: "string",
          description: "Specific questions, focus areas, or instructions on what exact information to extract from the page.",
        },
      },
      required: ["url", "query"],
    },
  },
  {
    type: "function",
    name: "save_memory",
    description: "Save an explicit, high-signal architectural rule, preference, or snippet into the persistent local SQLite vector database.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The exact, dense, factual text to remember.",
        },
        tags: {
          type: "array",
          description: "A list of topics/keywords this memory relates to.",
          items: {
            type: "string",
          },
        },
      },
      required: ["content", "tags"],
    },
  },
  {
    type: "function",
    name: "query_memory",
    description: "Perform a semantic RAG vector search across the local memory vault to recall previously saved rules, snippets, or facts.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The concept, topic, or question to search the vector database for.",
        },
        limit: {
          type: "integer",
          description: "Optional number of results to return (default 10).",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional array of tags to strictly pre-filter the vector search.",
        },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "delete_memory",
    description: "Delete a specific memory from the vector database by its integer ID.",
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "integer",
          description: "The ID of the memory to delete.",
        },
      },
      required: ["id"],
    },
  },
  {
    type: "google_search",
  },
];

export const generateMediaFunctionDeclarations: Interactions.Tool[] = [
  {
    type: "function",
    name: "generate_video",
    description: "Generate a video from a detailed text prompt using Gemini Omni and save it locally to disk.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The detailed prompt describing the scene, motion, lighting, and camera movement for the video.",
        },
        aspectRatio: {
          type: "string",
          description: "The aspect ratio of the video output (e.g. '16:9', '9:16'). Defaults to '16:9'.",
          enum: ["16:9", "9:16"],
        },
        resolution: {
          type: "string",
          description: "The resolution of the video output (e.g. '360p', '720p', '1080p', '4k'). Defaults to '720p'.",
          enum: ["360p", "720p", "1080p", "4k"],
        },
      },
      required: ["prompt"],
    },
  },
  {
    type: "function",
    name: "generate_image",
    description: "Generate an image from a detailed text prompt or edit existing images using Gemini Image and save it locally to disk.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "The detailed prompt describing the scene, style, lighting, and composition for the image.",
        },
        inputImagesPath: {
          type: "array",
          items: {
            type: "string",
          },
          description: "Optional array of local image file paths to condition or edit.",
        },
        aspectRatio: {
          type: "string",
          description: "The aspect ratio of the image output. Defaults to '1:1'.",
          enum: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:8", "8:1", "1:4", "4:1"],
        },
        imageSize: {
          type: "string",
          description: "The size/resolution of the image output (e.g. '512', '1K', '2K', '4K'). Defaults to '1K'.",
          enum: ["512", "1K", "2K", "4K"],
        },
      },
      required: ["prompt"],
    },
  },
];
