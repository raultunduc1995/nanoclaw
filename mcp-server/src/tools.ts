import { exec } from "child_process";
import { promisify } from "util";
import { open, readFile, readdir, rename, stat, mkdir } from "fs/promises";
import { unlink } from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "./config.js";

const execAsync = promisify(exec);

const MAX_VIEW_LENGTH = 50_000;
const MAX_LINES = 999999;
const LINE_NUMBER_WIDTH = String(MAX_LINES).length;
const FILE_CREATE_MODE = 0o600;
const DIR_CREATE_MODE = 0o700;

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function resolveSafe(p: string): string {
  const abs = path.resolve(expandHome(p));
  if (config.root && !abs.startsWith(path.resolve(config.root))) {
    throw new Error(`path outside MCP_ROOT: ${abs}`);
  }
  return abs;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0B";
  const k = 1024;
  const sizes = ["B", "K", "M", "G"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  return (size % 1 === 0 ? size.toString() : size.toFixed(1)) + sizes[i]!;
}

async function atomicWriteFile(targetPath: string, content: string): Promise<void> {
  const dir = path.dirname(targetPath);
  const tempPath = path.join(dir, `.tmp-${process.pid}-${randomUUID()}`);

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(tempPath, "wx", FILE_CREATE_MODE);
    await handle.writeFile(content, "utf-8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tempPath, targetPath);
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    await unlink(tempPath).catch(() => {});
    throw err;
  }
}

// --- Text editor command handlers ---

async function viewPath(filePath: string, viewRange?: [number, number]): Promise<string> {
  const fullPath = resolveSafe(filePath);

  let info;
  try {
    info = await stat(fullPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Error: File not found: ${filePath}`);
    }
    throw err;
  }

  if (info.isDirectory()) {
    return viewDirectory(fullPath, filePath);
  }

  const content = await readFile(fullPath, "utf-8");
  const lines = content.split("\n");

  if (lines.length > MAX_LINES) {
    throw new Error(`File ${filePath} has too many lines (${lines.length}). Maximum is ${MAX_LINES.toLocaleString()} lines.`);
  }

  let displayLines = lines;
  let startNum = 1;

  if (viewRange && viewRange.length === 2) {
    const startLine = Math.max(1, viewRange[0]) - 1;
    const endLine = viewRange[1] === -1 ? lines.length : viewRange[1];

    if (startLine >= lines.length) {
      throw new Error(`Error: view_range start line ${viewRange[0]} is out of range (1-${lines.length}).`);
    }
    if (endLine < startLine + 1 || endLine > lines.length) {
      throw new Error(`Error: view_range end line ${endLine} is out of range (${startLine + 1}-${lines.length}).`);
    }

    displayLines = lines.slice(startLine, endLine);
    startNum = startLine + 1;
  }

  const numberedLines = displayLines.map((line, i) => `${String(i + startNum).padStart(LINE_NUMBER_WIDTH, " ")}\t${line}`);
  const result = numberedLines.join("\n");

  if (result.length > MAX_VIEW_LENGTH) {
    return result.slice(0, MAX_VIEW_LENGTH) + `\n\n... Output truncated (${result.length} characters) ...`;
  }

  return result;
}

async function viewDirectory(fullPath: string, originalPath: string): Promise<string> {
  const dirStat = await stat(fullPath);
  const items: Array<{ size: string; path: string }> = [];

  const collectItems = async (dirPath: string, relativePath: string): Promise<void> => {
    const dirContents = await readdir(dirPath);

    for (const item of dirContents.sort()) {
      if (item === "node_modules") continue;

      const itemPath = path.join(dirPath, item);
      const itemRelativePath = relativePath ? `${relativePath}/${item}` : item;

      let itemStat;
      try {
        itemStat = await stat(itemPath);
      } catch {
        continue;
      }

      if (itemStat.isDirectory()) {
        items.push({ size: formatFileSize(itemStat.size), path: `${itemRelativePath}/` });
        await collectItems(itemPath, itemRelativePath);
      } else if (itemStat.isFile()) {
        items.push({ size: formatFileSize(itemStat.size), path: itemRelativePath });
      }
    }
  };

  await collectItems(fullPath, "");

  const header = `Here are the files and directories in ${originalPath}, excluding node_modules:`;
  const dirSize = formatFileSize(dirStat.size);
  const lines = [`${dirSize}\t${originalPath}`, ...items.map((item) => `${item.size}\t${originalPath}/${item.path}`)];

  return `${header}\n${lines.join("\n")}`;
}

async function strReplace(filePath: string, oldStr: string, newStr: string): Promise<string> {
  const fullPath = resolveSafe(filePath);

  let content: string;
  try {
    content = await readFile(fullPath, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Error: File not found: ${filePath}`);
    }
    throw err;
  }

  const matchingLines: Array<number> = [];
  let matchIndex = content.indexOf(oldStr);
  const firstMatchIndex = matchIndex;
  while (matchIndex !== -1) {
    matchingLines.push(content.slice(0, matchIndex).split("\n").length);
    matchIndex = content.indexOf(oldStr, matchIndex + 1);
  }

  if (matchingLines.length === 0) {
    throw new Error("Error: No match found for replacement. Please check your text and try again.");
  }
  if (matchingLines.length > 1) {
    throw new Error(`Error: Found ${matchingLines.length} matches for replacement text. Please provide more context to make a unique match.`);
  }

  const newContent = content.slice(0, firstMatchIndex) + newStr + content.slice(firstMatchIndex + oldStr.length);
  await atomicWriteFile(fullPath, newContent);

  const changedLineIndex = content.slice(0, firstMatchIndex).split("\n").length - 1;
  const newLines = newContent.split("\n");
  const contextStart = Math.max(0, changedLineIndex - 2);
  const contextEnd = Math.min(newLines.length, changedLineIndex + 3);
  const snippet = newLines.slice(contextStart, contextEnd).map((line, i) => {
    const lineNum = contextStart + i + 1;
    return `${String(lineNum).padStart(LINE_NUMBER_WIDTH, " ")}\t${line}`;
  });

  return `Successfully replaced text at exactly one location.\n${snippet.join("\n")}`;
}

async function createFile(filePath: string, fileText: string): Promise<string> {
  const fullPath = resolveSafe(filePath);
  const dir = path.dirname(fullPath);

  await mkdir(dir, { recursive: true, mode: DIR_CREATE_MODE });

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(fullPath, "w", FILE_CREATE_MODE);
    await handle.writeFile(fileText, "utf-8");
    await handle.sync();
  } finally {
    await handle?.close().catch(() => {});
  }

  return `Successfully created file ${filePath}.`;
}

async function insertText(filePath: string, insertLine: number, insertText: string): Promise<string> {
  const fullPath = resolveSafe(filePath);

  let content: string;
  try {
    content = await readFile(fullPath, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Error: File not found: ${filePath}`);
    }
    throw err;
  }

  const lines = content.split("\n");

  if (insertLine < 0 || insertLine > lines.length) {
    throw new Error(`Error: insert_line ${insertLine} is out of range (0-${lines.length}).`);
  }

  lines.splice(insertLine, 0, insertText.replace(/\n$/, ""));
  await atomicWriteFile(fullPath, lines.join("\n"));

  return `Successfully inserted text at line ${insertLine}.`;
}

// --- Output types (type alias, not interface — required for structuredContent assignability) ---

type BashOutput = { exitCode: number; stdout: string; stderr: string };
type TextEditorOutput = { result: string };

// --- Tool registration ---

export function registerTools(server: McpServer): void {
  server.registerTool(
    "bash",
    {
      title: "Run a shell command",
      description: "Execute a bash command on the host. Returns stdout, stderr, exit code.",
      inputSchema: { command: z.string(), cwd: z.string().optional(), timeoutMs: z.number().int().positive().max(600_000).optional() },
      outputSchema: { exitCode: z.number(), stdout: z.string(), stderr: z.string() },
    },
    async ({ command, cwd, timeoutMs }) => {
      const opts = { cwd: cwd ? resolveSafe(cwd) : undefined, timeout: timeoutMs ?? 120_000, maxBuffer: 10 * 1024 * 1024 };
      try {
        const { stdout, stderr } = await execAsync(command, opts);
        const output: BashOutput = { exitCode: 0, stdout, stderr };
        return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: output };
      } catch (err: unknown) {
        const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
        const output: BashOutput = { exitCode: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message ?? "" };
        return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: output };
      }
    },
  );

  server.registerTool(
    "text_editor",
    {
      title: "Text editor tool",
      description: `Tool for viewing, creating and editing text files.
Commands:
- view: View files or directories. Shows line numbers for files. Supports view_range for partial viewing. For directories, recursively lists all files excluding node_modules.
- str_replace: Replace exact text in a file. old_str must match exactly once. Atomic write.
- create: Create or overwrite a file. Creates parent directories automatically.
- insert: Insert text at a specific line number. 0 = beginning, N = after line N.`,
      inputSchema: {
        command: z.enum(["view", "str_replace", "create", "insert"]),
        path: z.string().describe("Absolute or relative file/directory path. Supports ~ for home directory."),
        view_range: z.tuple([z.number().int(), z.number().int()]).optional().describe("For view command only. [start_line, end_line], 1-indexed. Use -1 for end_line to view to end of file."),
        old_str: z.string().optional().describe("For str_replace command. The exact text to find and replace. Must match exactly once."),
        new_str: z.string().optional().describe("For str_replace command. The replacement text."),
        file_text: z.string().optional().describe("For create command. The complete file content to write."),
        insert_line: z.number().int().optional().describe("For insert command. Line number to insert at. 0 = beginning of file."),
        insert_text: z.string().optional().describe("For insert command. The text to insert."),
      },
      outputSchema: { result: z.string() },
    },
    async ({ command, path: filePath, view_range, old_str, new_str, file_text, insert_line, insert_text: insertTextParam }) => {
      let result: string;

      switch (command) {
        case "view":
          result = await viewPath(filePath, view_range);
          break;

        case "str_replace":
          if (old_str === undefined) throw new Error("Error: old_str is required for str_replace command.");
          if (new_str === undefined) throw new Error("Error: new_str is required for str_replace command.");
          result = await strReplace(filePath, old_str, new_str);
          break;

        case "create":
          if (file_text === undefined) throw new Error("Error: file_text is required for create command.");
          result = await createFile(filePath, file_text);
          break;

        case "insert":
          if (insert_line === undefined) throw new Error("Error: insert_line is required for insert command.");
          if (insertTextParam === undefined) throw new Error("Error: insert_text is required for insert command.");
          result = await insertText(filePath, insert_line, insertTextParam);
          break;

        default:
          throw new Error(`Error: Unknown command '${JSON.stringify(command)}'.`);
      }

      const output: TextEditorOutput = { result };
      return { content: [{ type: "text" as const, text: result }], structuredContent: output };
    },
  );
}
