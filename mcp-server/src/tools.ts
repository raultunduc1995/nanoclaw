import { exec } from "child_process";
import fs from "fs/promises";
import { promisify } from "util";
import os from "os";
import path from "path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config } from "./config.js";

const execAsync = promisify(exec);

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

// --- Tool registration ---

export function registerTools(server: McpServer): void {
  //   server.registerTool(
  //     "bash",
  //     {
  //       title: "Run a shell command",
  //       description: `Execute a bash command on the host. Returns stdout, stderr, exit code.

  // ast-grep (sg) is pre-installed for structural AST code search and rewriting:
  // - Search: ast-grep run -l <lang> -p '<pattern>' <path>
  // - Rewrite: ast-grep run -l <lang> -p '<pattern>' -r '<rewrite>' -U <path>
  //   Flags: -p/--pattern, -r/--rewrite, -l/--lang (typescript, kotlin, etc.), -U/--update-all (apply in-place without asking).
  // - Metavariables: $VAR matches single AST node, $$$VAR matches multiple nodes/statements/args.
  // - Shell quoting: ALWAYS use single quotes ('...') around patterns and rewrites so bash does not expand metavariables.
  // - Complex relational rules: Write YAML rule to /tmp/rule.yaml and execute:
  //   ast-grep scan -r /tmp/rule.yaml -U <path>`,
  //       inputSchema: { command: z.string(), cwd: z.string().optional(), timeoutMs: z.number().int().positive().max(600_000).optional() },
  //     },
  //     async ({ command, cwd, timeoutMs }) => {
  //       const output = { stdout: "", stderr: "", exitCode: 0 };
  //       const runDir = cwd ? resolveSafe(cwd) : config.root ? resolveSafe(config.root) : process.cwd();

  //       try {
  //         const { stdout, stderr } = await execAsync(command, {
  //           cwd: runDir,
  //           timeout: timeoutMs ?? 120_000,
  //           maxBuffer: 1024 * 1024 * 10,
  //         });
  //         output.stdout = stdout;
  //         output.stderr = stderr;
  //       } catch (err: unknown) {
  //         const error = err as Error & { stdout?: string; stderr?: string; code?: number };
  //         output.stdout = typeof error.stdout === "string" ? error.stdout : "";
  //         output.stderr = typeof error.stderr === "string" ? error.stderr : error.message || "";
  //         output.exitCode = typeof error.code === "number" ? error.code : 1;
  //       }

  //       const MAX_OUTPUT_CHARS = 400_000;

  //       if (output.stdout.length > MAX_OUTPUT_CHARS) {
  //         output.stdout = output.stdout.substring(0, MAX_OUTPUT_CHARS) + "\n\n... [TRUNCATED] ...\n(Stdout exceeded 400,000 characters)";
  //       }
  //       if (output.stderr.length > MAX_OUTPUT_CHARS) {
  //         output.stderr = output.stderr.substring(0, MAX_OUTPUT_CHARS) + "\n\n... [TRUNCATED] ...\n(Stderr exceeded 400,000 characters)";
  //       }

  //       return { structuredContent: output };
  //     },
  //   );

  server.registerTool(
    "read_file",
    {
      title: "Read a file",
      description: "Read UTF-8 file contents natively without spawning a shell. Optional 1-indexed inclusive startLine and endLine.",
      inputSchema: {
        path: z.string(),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
      },
    },
    async ({ path: targetPath, startLine, endLine }) => {
      try {
        const filePath = resolveSafe(targetPath);
        const raw = await fs.readFile(filePath, "utf8");
        const lines = raw.split("\n");
        const start = startLine ? Math.max(1, startLine) - 1 : 0;
        const end = endLine ? Math.min(lines.length, endLine) : lines.length;
        const content = lines.slice(start, end).join("\n");
        return {
          structuredContent: {
            content,
            totalLines: lines.length,
            exitCode: 0,
          },
        };
      } catch (err: unknown) {
        const error = err as Error;
        return {
          structuredContent: {
            content: "",
            stderr: error.message,
            exitCode: 1,
          },
        };
      }
    },
  );

  server.registerTool(
    "write_file",
    {
      title: "Write a file",
      description: "Write or overwrite a UTF-8 file natively without spawning a shell. Creates parent directories automatically.",
      inputSchema: {
        path: z.string(),
        content: z.string(),
      },
    },
    async ({ path: targetPath, content }) => {
      try {
        const filePath = resolveSafe(targetPath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf8");
        return {
          structuredContent: {
            status: "ok",
            path: filePath,
            bytesWritten: Buffer.byteLength(content, "utf8"),
            exitCode: 0,
          },
        };
      } catch (err: unknown) {
        const error = err as Error;
        return {
          structuredContent: {
            status: "error",
            stderr: error.message,
            exitCode: 1,
          },
        };
      }
    },
  );

  server.registerTool(
    "edit_file",
    {
      title: "Edit a file",
      description: "Replace target text with replacement text in a file natively (supports exact match, trailing-space-insensitive match, and indentation-insensitive match with auto-indentation).",
      inputSchema: {
        path: z.string(),
        target: z.string(),
        replacement: z.string(),
        replaceAll: z.boolean().optional(),
      },
    },
    async ({ path: targetPath, target, replacement, replaceAll }) => {
      try {
        const filePath = resolveSafe(targetPath);
        const raw = await fs.readFile(filePath, "utf8");
        const updated = applyFlexibleEdit(raw, target, replacement, replaceAll);
        if (updated === null) {
          return {
            structuredContent: {
              status: "error",
              stderr: "Target string not found in file",
              exitCode: 1,
            },
          };
        }
        await fs.writeFile(filePath, updated, "utf8");
        return {
          structuredContent: {
            status: "ok",
            path: filePath,
            exitCode: 0,
          },
        };
      } catch (err: unknown) {
        const error = err as Error;
        return {
          structuredContent: {
            status: "error",
            stderr: error.message,
            exitCode: 1,
          },
        };
      }
    },
  );
}

function applyFlexibleEdit(rawContent: string, target: string, replacement: string, replaceAll?: boolean): string | null {
  const useCrLf = rawContent.includes("\r\n");
  const content = rawContent.replace(/\r\n/g, "\n");
  const normTarget = target.replace(/\r\n/g, "\n");
  const normReplacement = replacement.replace(/\r\n/g, "\n");

  // Tier 1: Exact match
  if (content.includes(normTarget)) {
    const res = replaceAll ? content.split(normTarget).join(normReplacement) : content.replace(normTarget, () => normReplacement);
    return useCrLf ? res.replace(/\n/g, "\r\n") : res;
  }

  const fileLines = content.split("\n");
  const targetLines = normTarget.split("\n");
  const replacementLines = normReplacement.split("\n");
  const tLen = targetLines.length;

  if (tLen === 0 || tLen > fileLines.length) return null;

  // Tier 2: Trailing-whitespace-insensitive line match (trimEnd)
  const trimEndMatches: number[] = [];
  for (let i = 0; i <= fileLines.length - tLen; i++) {
    let ok = true;
    for (let k = 0; k < tLen; k++) {
      if (fileLines[i + k].trimEnd() !== targetLines[k].trimEnd()) {
        ok = false;
        break;
      }
    }
    if (ok) {
      trimEndMatches.push(i);
      if (!replaceAll) break;
      i += tLen - 1;
    }
  }

  if (trimEndMatches.length > 0) {
    const out = [...fileLines];
    for (let m = trimEndMatches.length - 1; m >= 0; m--) {
      out.splice(trimEndMatches[m], tLen, ...replacementLines);
    }
    const res = out.join("\n");
    return useCrLf ? res.replace(/\n/g, "\r\n") : res;
  }

  // Tier 3: Indentation-insensitive line match (trim) with relative indentation preservation
  const trimMatches: number[] = [];
  for (let i = 0; i <= fileLines.length - tLen; i++) {
    let ok = true;
    for (let k = 0; k < tLen; k++) {
      if (fileLines[i + k].trim() !== targetLines[k].trim()) {
        ok = false;
        break;
      }
    }
    if (ok) {
      trimMatches.push(i);
      if (!replaceAll) break;
      i += tLen - 1;
    }
  }

  if (trimMatches.length > 0) {
    const firstNonEmptyIdx = targetLines.findIndex((l) => l.trim().length > 0);
    const targetBaseIndent = firstNonEmptyIdx >= 0 ? (targetLines[firstNonEmptyIdx].match(/^\s*/)?.[0] ?? "") : "";

    const out = [...fileLines];
    for (let m = trimMatches.length - 1; m >= 0; m--) {
      const startIdx = trimMatches[m];
      const fileBaseIndent = firstNonEmptyIdx >= 0 ? (fileLines[startIdx + firstNonEmptyIdx].match(/^\s*/)?.[0] ?? "") : "";

      const adjustedReplacement = replacementLines.map((rLine) => {
        if (rLine.trim().length === 0) return "";
        if (rLine.startsWith(targetBaseIndent)) {
          return fileBaseIndent + rLine.slice(targetBaseIndent.length);
        }
        return fileBaseIndent + rLine.trimStart();
      });

      out.splice(startIdx, tLen, ...adjustedReplacement);
    }
    const res = out.join("\n");
    return useCrLf ? res.replace(/\n/g, "\r\n") : res;
  }

  return null;
}
