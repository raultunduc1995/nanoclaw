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
    name: "text_editor",
    description: "Executes a text editor command such as view, replace_lines, create, or insert on a specified file path.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: "The type of editor command to execute.",
          enum: ["view", "replace_lines", "create", "insert"],
        },
        path: {
          type: Type.STRING,
          description: "The file system path where the command should be executed.",
        },
        view_range: {
          type: Type.ARRAY,
          description: "Optional: A tuple containing the starting and ending line numbers to view [start, end]. Only used with 'view' command.",
          items: {
            type: Type.INTEGER,
          },
          minItems: "2",
          maxItems: "2",
        },
        new_str: {
          type: Type.STRING,
          description: "The text content to replace the specified lines with. Required only for 'replace_lines' command.",
        },
        replace_range: {
          type: Type.ARRAY,
          description: "A tuple containing the starting and ending line numbers to replace [start, end]. Required only for 'replace_lines' command.",
          items: {
            type: Type.INTEGER,
          },
          minItems: "2",
          maxItems: "2",
        },
        file_text: {
          type: Type.STRING,
          description: "The initial text content for creating a file. Required only for 'create' command.",
        },
        insert_line: {
          type: Type.INTEGER,
          description: "The line number where text should be inserted. Required only for 'insert' command.",
        },
        insert_text: {
          type: Type.STRING,
          description: "The text content to insert. Required only for 'insert' command.",
        },
      },
      required: ["command", "path"],
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
    name: "mcp_text_editor",
    description: "Executes a text editor command on a specified file path on the remote work-mac server.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: "The type of editor command to execute on the remote server.",
          enum: ["view", "replace_lines", "create", "insert"],
        },
        path: {
          type: Type.STRING,
          description: "The remote file system path where the command should be executed.",
        },
        view_range: {
          type: Type.ARRAY,
          description: "Optional: A tuple containing the starting and ending line numbers to view [start, end]. Only used with 'view' command.",
          items: {
            type: Type.INTEGER,
          },
          minItems: "2",
          maxItems: "2",
        },
        new_str: {
          type: Type.STRING,
          description: "The text content to replace the specified lines with. Required only for 'replace_lines' command on the remote server.",
        },
        replace_range: {
          type: Type.ARRAY,
          description: "A tuple containing the starting and ending line numbers to replace [start, end]. Required only for 'replace_lines' command on the remote server.",
          items: {
            type: Type.INTEGER,
          },
          minItems: "2",
          maxItems: "2",
        },
        file_text: {
          type: Type.STRING,
          description: "The initial text content for creating a file. Required only for 'create' command on the remote server.",
        },
        insert_line: {
          type: Type.INTEGER,
          description: "The line number where text should be inserted. Required only for 'insert' command on the remote server.",
        },
        insert_text: {
          type: Type.STRING,
          description: "The text content to insert. Required only for 'insert' command on the remote server.",
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
];
