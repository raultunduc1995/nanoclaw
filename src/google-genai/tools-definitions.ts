import { type FunctionDeclaration, Type } from "@google/genai";

export const functionDeclarations: FunctionDeclaration[] = [
  {
    name: "bash",
    description: "Execute a single bash command string on the local server.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: "The exact bash command line to run.",
        },
        restart: {
          type: Type.BOOLEAN,
          description: "Whether to restart the bash session (clearing all context) before executing this command.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "mcp_bash",
    description: "Execute a single bash command string on the remote work-mac server.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: "The exact bash command line to run on the remote server.",
        },
        cwd: {
          type: Type.STRING,
          description: "Optional working directory on the remote server.",
        },
        timeoutMs: {
          type: Type.INTEGER,
          description: "Optional execution timeout in milliseconds.",
        },
      },
      required: ["command"],
    },
  },
  {
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
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: "The ast-grep command to run.",
          enum: ["rule", "outline"],
        },
        path: {
          type: Type.STRING,
          description: "The file or directory path to search/modify on the remote work-mac server.",
        },
        language: {
          type: Type.STRING,
          description: "The language of the target files (e.g. 'typescript', 'kotlin'). Required for 'rule'.",
        },
        rule: {
          type: Type.OBJECT,
          description: "The pure JSON object representing the ast-grep rule conditions (e.g. { pattern: '...' }). Required for 'rule'.",
        },
        fix: {
          type: Type.STRING,
          description: "Optional replacement string for matches found by the rule (used for patching).",
        },
        items: {
          type: Type.STRING,
          description: "Top-level items to outline. Options: 'structure', 'exports', 'imports', 'all' (used for 'outline').",
        },
        view: {
          type: Type.STRING,
          description: "Outline detail level. Options: 'names', 'signatures', 'digest', 'expanded' (used for 'outline').",
        },
        type: {
          type: Type.STRING,
          description: "Comma-separated list of top-level symbol types to filter (e.g. 'class,function') (used for 'outline').",
        },
      },
      required: ["command", "path"],
    },
  },
  {
    name: "fetch_url_context",
    description: "Browse a specific URL and extract targeted information based on custom instructions or questions.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: "The full web URL to browse.",
        },
        query: {
          type: Type.STRING,
          description: "Specific questions, focus areas, or instructions on what exact information to extract from the page.",
        },
      },
      required: ["url", "query"],
    },
  },
  {
    name: "context7_search_library",
    description: "Search the Context7 registry for official API documentation library IDs based on a query or framework.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "The search query (e.g., 'I need to build a UI with components').",
        },
        libraryName: {
          type: Type.STRING,
          description: "Optional filter for the library name. Should be a single lowercase keyword (e.g., 'react', 'android', 'nextjs').",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "context7_get_context",
    description: "Retrieve fresh, official API documentation and code examples from a specific Context7 library.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "The exact problem or task to query docs for (e.g., 'How do I use hooks?').",
        },
        libraryId: {
          type: Type.STRING,
          description: "The exact library ID resolved from context7_search_library (e.g., '/facebook/react').",
        },
      },
      required: ["query", "libraryId"],
    },
  },
  {
    name: "save_memory",
    description: "Save an explicit, high-signal architectural rule, preference, or snippet into the persistent local SQLite vector database.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        content: {
          type: Type.STRING,
          description: "The exact, dense, factual text to remember.",
        },
        tags: {
          type: Type.ARRAY,
          description: "A list of topics/keywords this memory relates to.",
          items: {
            type: Type.STRING,
          },
        },
      },
      required: ["content", "tags"],
    },
  },
  {
    name: "query_memory",
    description: "Perform a semantic RAG vector search across the local memory vault to recall previously saved rules, snippets, or facts.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "The concept, topic, or question to search the vector database for.",
        },
        limit: {
          type: Type.INTEGER,
          description: "Optional number of results to return (default 10).",
        },
        tags: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: "Optional array of tags to strictly pre-filter the vector search.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "delete_memory",
    description: "Delete a specific memory from the vector database by its integer ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: {
          type: Type.INTEGER,
          description: "The ID of the memory to delete.",
        },
      },
      required: ["id"],
    },
  },
  {
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
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: "The ast-grep command to run.",
          enum: ["rule", "outline"],
        },
        path: {
          type: Type.STRING,
          description: "The file or directory path to search/modify.",
        },
        language: {
          type: Type.STRING,
          description: "The language of the target files (e.g. 'typescript', 'kotlin'). Required for 'rule'.",
        },
        rule: {
          type: Type.OBJECT,
          description: "The pure JSON object representing the ast-grep rule conditions (e.g. { pattern: '...' }). Required for 'rule'.",
        },
        fix: {
          type: Type.STRING,
          description: "Optional replacement string for matches found by the rule (used for patching).",
        },
        items: {
          type: Type.STRING,
          description: "Top-level items to outline. Options: 'structure', 'exports', 'imports', 'all' (used for 'outline').",
        },
        view: {
          type: Type.STRING,
          description: "Outline detail level. Options: 'names', 'signatures', 'digest', 'expanded' (used for 'outline').",
        },
        type: {
          type: Type.STRING,
          description: "Comma-separated list of top-level symbol types to filter (e.g. 'class,function') (used for 'outline').",
        },
      },
      required: ["command", "path"],
    },
  },
];
