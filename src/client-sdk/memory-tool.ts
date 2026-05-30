import { mkdir, open, readFile, rename, stat, unlink } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

import type { BetaMemoryTool20250818StrReplaceCommand } from "@anthropic-ai/sdk/resources/beta";
import { BetaLocalFilesystemMemoryTool } from "@anthropic-ai/sdk/tools/memory/node";

const FILE_CREATE_MODE = 0o600;
const DIR_CREATE_MODE = 0o700;
const MAX_LINES = 999999;
const LINE_NUMBER_WIDTH = String(MAX_LINES).length;

const atomicWriteFile = async (targetPath: string, content: string): Promise<void> => {
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
};

export class MemoryTool extends BetaLocalFilesystemMemoryTool {
  static override async init(basePath = "./memory"): Promise<MemoryTool> {
    const memory = new MemoryTool(basePath);
    await mkdir(path.join(basePath, "memories"), { recursive: true, mode: DIR_CREATE_MODE });
    return memory;
  }

  override async str_replace(command: BetaMemoryTool20250818StrReplaceCommand): Promise<string> {
    const resolvePath = (this as unknown as { validatePath: (p: string) => Promise<string> }).validatePath.bind(this);
    const fullPath = await resolvePath(command.path);

    let info;
    try {
      info = await stat(fullPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`The path ${command.path} does not exist. Please provide a valid path.`);
      }
      throw err;
    }
    if (!info.isFile()) {
      throw new Error(`The path ${command.path} is not a file.`);
    }

    let content: string;
    try {
      content = await readFile(fullPath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`The file ${command.path} no longer exists (may have been deleted or renamed concurrently).`);
      }
      throw err;
    }

    const matchingLines: Array<number> = [];
    let matchIndex = content.indexOf(command.old_str);
    const firstMatchIndex = matchIndex;
    while (matchIndex !== -1) {
      matchingLines.push(content.slice(0, matchIndex).split("\n").length);
      matchIndex = content.indexOf(command.old_str, matchIndex + 1);
    }

    if (matchingLines.length === 0) {
      throw new Error(`No replacement was performed, old_str \`${command.old_str}\` did not appear verbatim in ${command.path}.`);
    }
    if (matchingLines.length > 1) {
      throw new Error(`No replacement was performed. Multiple occurrences of old_str \`${command.old_str}\` in lines: ${matchingLines.join(", ")}. Please ensure it is unique`);
    }

    const newContent = content.slice(0, firstMatchIndex) + command.new_str + content.slice(firstMatchIndex + command.old_str.length);
    await atomicWriteFile(fullPath, newContent);

    const changedLineIndex = content.slice(0, firstMatchIndex).split("\n").length - 1;
    const newLines = newContent.split("\n");
    const contextStart = Math.max(0, changedLineIndex - 2);
    const contextEnd = Math.min(newLines.length, changedLineIndex + 3);
    const snippet = newLines.slice(contextStart, contextEnd).map((line, i) => {
      const lineNum = contextStart + i + 1;
      return `${String(lineNum).padStart(LINE_NUMBER_WIDTH, " ")}\t${line}`;
    });
    return `The memory file has been edited. Here is the snippet showing the change (with line numbers):\n${snippet.join("\n")}`;
  }
}
