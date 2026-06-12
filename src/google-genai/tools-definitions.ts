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
    description: "Executes a text editor command such as view, str_replace, create, or insert on a specified file path.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: "The type of editor command to execute.",
          enum: ["view", "str_replace", "create", "insert"],
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
        old_str: {
          type: Type.STRING,
          description: "The string to be replaced. Required only for 'str_replace' command.",
        },
        new_str: {
          type: Type.STRING,
          description: "The new string to replace the old string with. Required only for 'str_replace' command.",
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
];
