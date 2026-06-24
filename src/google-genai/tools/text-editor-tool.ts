/* eslint-disable preserve-caught-error */
import { open, readFile, readdir, rename, stat, mkdir } from "fs/promises";
import { unlink } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const MAX_VIEW_LENGTH = 50_000;
const MAX_LINES = 999999;
const LINE_NUMBER_WIDTH = String(MAX_LINES).length;
const FILE_CREATE_MODE = 0o600;
const DIR_CREATE_MODE = 0o700;

// --- Discriminated union (validated) ---

interface ViewCommand {
  command: "view";
  path: string;
  view_range?: [number, number];
}

interface ReplaceLinesCommand {
  command: "replace_lines";
  path: string;
  replace_range: [number, number];
  new_str: string;
}

interface CreateCommand {
  command: "create";
  path: string;
  file_text: string;
}

interface InsertCommand {
  command: "insert";
  path: string;
  insert_line: number;
  insert_text: string;
}

type EditorCommand = ViewCommand | ReplaceLinesCommand | CreateCommand | InsertCommand;

// --- Utilities ---

function parseCommand(input: Record<string, unknown>): EditorCommand {
  switch (input.command) {
    case "view":
      return { command: "view", path: input.path as string, view_range: input.view_range ? (input.view_range as [number, number]) : undefined };

    case "replace_lines":
      if (input.replace_range === undefined) throw new Error("Error: replace_range is required for replace_lines command.");
      if (input.new_str === undefined) throw new Error("Error: new_str is required for replace_lines command.");
      return { command: "replace_lines", path: input.path as string, replace_range: input.replace_range as [number, number], new_str: input.new_str as string };

    case "create":
      if (input.file_text === undefined) throw new Error("Error: file_text is required for create command.");
      return { command: "create", path: input.path as string, file_text: input.file_text as string };

    case "insert":
      if (input.insert_line === undefined) throw new Error("Error: insert_line is required for insert command.");
      if (input.insert_text === undefined) throw new Error("Error: insert_text is required for insert command.");
      return { command: "insert", path: input.path as string, insert_line: input.insert_line as number, insert_text: input.insert_text as string };

    default:
      throw new Error(`Error: Unknown command '${input.command}'. Valid commands: view, replace_lines, create, insert.`);
  }
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

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0B";
  const k = 1024;
  const sizes = ["B", "K", "M", "G"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);
  return (size % 1 === 0 ? size.toString() : size.toFixed(1)) + sizes[i]!;
}

// --- Tool class ---

export class TextEditorTool {
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  static init(cwd: string): TextEditorTool {
    return new TextEditorTool(cwd);
  }

  private resolvePath(filePath: string): string {
    const resolved = path.resolve(this.cwd, filePath);
    const resolvedRoot = path.resolve(this.cwd);
    if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
      throw new Error("Error: Path traversal outside working directory is not allowed.");
    }
    return resolved;
  }

  async execute(input: Record<string, unknown>): Promise<string> {
    const cmd = parseCommand(input);
    switch (cmd.command) {
      case "view":
        return this.view(cmd);
      case "replace_lines":
        return this.replaceLines(cmd);
      case "create":
        return this.create(cmd);
      case "insert":
        return this.insert(cmd);
    }
  }

  private async view(cmd: ViewCommand): Promise<string> {
    const fullPath = this.resolvePath(cmd.path);

    let info;
    try {
      info = await stat(fullPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Error: File not found: ${cmd.path}`);
      }
      throw err;
    }

    if (info.isDirectory()) {
      return this.viewDirectory(fullPath, cmd.path);
    }

    const content = await readFile(fullPath, "utf-8");
    const lines = content.split("\n");

    if (lines.length > MAX_LINES) {
      throw new Error(`File ${cmd.path} has too many lines (${lines.length}). Maximum is ${MAX_LINES.toLocaleString()} lines.`);
    }

    let displayLines = lines;
    let startNum = 1;

    if (cmd.view_range && cmd.view_range.length === 2) {
      const startLine = Math.max(1, cmd.view_range[0]) - 1;
      const endLine = cmd.view_range[1] === -1 ? lines.length : cmd.view_range[1];

      if (startLine >= lines.length) {
        throw new Error(`Error: view_range start line ${cmd.view_range[0]} is out of range (1-${lines.length}).`);
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

  private async viewDirectory(fullPath: string, originalPath: string): Promise<string> {
    const dirStat = await stat(fullPath);
    const items: Array<{ size: string; path: string }> = [];

    const collectItems = async (dirPath: string, relativePath: string): Promise<void> => {
      const dirContents = await readdir(dirPath);

      for (const item of dirContents.sort()) {
        if (item.startsWith(".")) continue;

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

  private async replaceLines(cmd: ReplaceLinesCommand): Promise<string> {
    const fullPath = this.resolvePath(cmd.path);

    let content: string;
    try {
      content = await readFile(fullPath, "utf-8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Error: File not found: ${cmd.path}`);
      }
      throw err;
    }

    const lines = content.split("\n");
    const [start, end] = cmd.replace_range;

    if (start < 1 || start > lines.length || end < 1 || end > lines.length || start > end) {
      throw new Error(`Error: Invalid replace_range [${start}, ${end}]. File has ${lines.length} lines.`);
    }

    // Convert 1-based to 0-based
    const startIndex = start - 1;
    const deleteCount = end - start + 1;

    const replacementLines = cmd.new_str.split("\n");
    lines.splice(startIndex, deleteCount, ...replacementLines);

    await atomicWriteFile(fullPath, lines.join("\n"));

    return `Successfully replaced lines ${start} to ${end}.`;
  }

  private async create(cmd: CreateCommand): Promise<string> {
    const fullPath = this.resolvePath(cmd.path);
    const dir = path.dirname(fullPath);

    await mkdir(dir, { recursive: true, mode: DIR_CREATE_MODE });

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(fullPath, "w", FILE_CREATE_MODE);
      await handle.writeFile(cmd.file_text, "utf-8");
      await handle.sync();
    } finally {
      await handle?.close().catch(() => {});
    }

    return `Successfully created file ${cmd.path}.`;
  }

  private async insert(cmd: InsertCommand): Promise<string> {
    const fullPath = this.resolvePath(cmd.path);

    let content: string;
    try {
      content = await readFile(fullPath, "utf-8");
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Error: File not found: ${cmd.path}`);
      }
      throw err;
    }

    const lines = content.split("\n");

    if (cmd.insert_line < 0 || cmd.insert_line > lines.length) {
      throw new Error(`Error: insert_line ${cmd.insert_line} is out of range (0-${lines.length}).`);
    }

    // Strip trailing newline from insert_text before splicing, matching SDK behavior
    lines.splice(cmd.insert_line, 0, cmd.insert_text.replace(/\n$/, ""));
    await atomicWriteFile(fullPath, lines.join("\n"));

    return `Successfully inserted text at line ${cmd.insert_line}.`;
  }
}
