import type { Interactions } from "@google/genai";

export const functionDeclarations: Interactions.Tool[] = [
  {
    type: "function",
    name: "bash",
    description: "Execute a single bash command string on the local server.",
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
  },
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
    name: "context7_search_library",
    description: "Search the Context7 registry for official API documentation library IDs based on a query or framework.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query (e.g., 'I need to build a UI with components').",
        },
        libraryName: {
          type: "string",
          description: "Optional filter for the library name. Should be a single lowercase keyword (e.g., 'react', 'android', 'nextjs').",
        },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "context7_get_context",
    description: "Retrieve fresh, official API documentation and code examples from a specific Context7 library.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The exact problem or task to query docs for (e.g., 'How do I use hooks?').",
        },
        libraryId: {
          type: "string",
          description: "The exact library ID resolved from context7_search_library (e.g., '/facebook/react').",
        },
      },
      required: ["query", "libraryId"],
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
    type: "function",
    name: "ast_grep",
    description: `Execute structural code search, patching, and code outlining using Abstract Syntax Trees (ast-grep/sg). EXCLUSIVELY USE FOR FILES THAT CONTAIN CODE (do not use for markdown or plain text).
  Usage & Combinations:
  - rule: Structural search and replace using JSON logic (e.g. pattern, inside, has, not).
    - You must provide 'language' (e.g., 'typescript', 'kotlin').
    - 'rule' is a JSON object with conditions. Metavariables: $VAR (single node), $$$VAR (multiple nodes).
    - 'fix' is an optional string to replace matches.
    Example rule (JSON): { "pattern": "console.log($$$)", "inside": { "kind": "method_definition" } }
  - outline: Map code structure without reading full files.
    - Map directory API surface: path: 'dir/', items: 'exports', view: 'names'
    - Trace dependencies: path: 'dir/', items: 'imports', view: 'signatures'
    - Map local file structure: path: 'file.ts', items: 'structure', view: 'digest'
    - Zoom into symbol types: path: 'file.ts', type: 'class,function', view: 'expanded'
    Example outline args (JSON): { "command": "outline", "path": "src/", "items": "exports", "view": "signatures" }`,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The ast-grep command to run.",
          enum: ["rule", "outline"],
        },
        path: {
          type: "string",
          description: "The file or directory path to search/modify.",
        },
        language: {
          type: "string",
          description: "The language of the target files (e.g. 'typescript', 'kotlin'). Required for 'rule'.",
        },
        rule: {
          type: "object",
          description: "The pure JSON object representing the ast-grep rule conditions (e.g. { pattern: '...' }). Required for 'rule'.",
        },
        fix: {
          type: "string",
          description: "Optional replacement string for matches found by the rule (used for patching).",
        },
        items: {
          type: "string",
          description: "Top-level items to outline. Options: 'structure', 'exports', 'imports', 'all' (used for 'outline').",
        },
        view: {
          type: "string",
          description: "Outline detail level. Options: 'names', 'signatures', 'digest', 'expanded' (used for 'outline').",
        },
        type: {
          type: "string",
          description: "Comma-separated list of top-level symbol types to filter (e.g. 'class,function') (used for 'outline').",
        },
      },
      required: ["command", "path"],
    },
  },
  {
    type: "google_search",
  },
];

export const workMacFunctionDeclarations: Interactions.Tool[] = [
  {
    type: "function",
    name: "mcp_bash",
    description: "Execute a single bash command string on the remote work-mac server.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The exact bash command line to run on the remote server.",
        },
        cwd: {
          type: "string",
          description: "Optional working directory on the remote server.",
        },
        timeoutMs: {
          type: "integer",
          description: "Optional execution timeout in milliseconds.",
        },
      },
      required: ["command"],
    },
  },
  {
    type: "function",
    name: "mcp_ast_grep",
    description: `Execute structural code search, patching, and code outlining using Abstract Syntax Trees (ast-grep/sg) on the remote work-mac server. EXCLUSIVELY USE FOR FILES THAT CONTAIN CODE (do not use for markdown or plain text).
  Usage & Combinations:
  - rule: Structural search and replace using JSON logic (e.g. pattern, inside, has, not).
    - You must provide 'language' (e.g., 'typescript', 'kotlin').
    - 'rule' is a JSON object with conditions. Metavariables: $VAR (single node), $$$VAR (multiple nodes).
    - 'fix' is an optional string to replace matches.
    Example rule (JSON): { "pattern": "console.log($$$)", "inside": { "kind": "method_definition" } }
  - outline: Map code structure without reading full files.
    - Map directory API surface: path: 'dir/', items: 'exports', view: 'names'
    - Trace dependencies: path: 'dir/', items: 'imports', view: 'signatures'
    - Map local file structure: path: 'file.ts', items: 'structure', view: 'digest'
    - Zoom into symbol types: path: 'file.ts', type: 'class,function', view: 'expanded'
    Example outline args (JSON): { "command": "outline", "path": "src/", "items": "exports", "view": "signatures" }`,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The ast-grep command to run.",
          enum: ["rule", "outline"],
        },
        path: {
          type: "string",
          description: "The file or directory path to search/modify on the remote work-mac server.",
        },
        language: {
          type: "string",
          description: "The language of the target files (e.g. 'typescript', 'kotlin'). Required for 'rule'.",
        },
        rule: {
          type: "object",
          description: "The pure JSON object representing the ast-grep rule conditions (e.g. { pattern: '...' }). Required for 'rule'.",
        },
        fix: {
          type: "string",
          description: "Optional replacement string for matches found by the rule (used for patching).",
        },
        items: {
          type: "string",
          description: "Top-level items to outline. Options: 'structure', 'exports', 'imports', 'all' (used for 'outline').",
        },
        view: {
          type: "string",
          description: "Outline detail level. Options: 'names', 'signatures', 'digest', 'expanded' (used for 'outline').",
        },
        type: {
          type: "string",
          description: "Comma-separated list of top-level symbol types to filter (e.g. 'class,function') (used for 'outline').",
        },
      },
      required: ["command", "path"],
    },
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
