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

type AstGrepOutput = { result: string };

// --- Tool registration ---

export function registerTools(server: McpServer): void {
  server.registerTool(
    "bash",
    {
      title: "Run a shell command",
      description: "Execute a bash command on the host. Returns stdout, stderr, exit code.",
      inputSchema: { command: z.string(), cwd: z.string().optional(), timeoutMs: z.number().int().positive().max(600_000).optional() },
    },
    async ({ command, cwd, timeoutMs }) => {
      let resultStr: string;
      const output = { stdout: "", stderr: "", exitCode: 0 };
      const runDir = cwd ? resolveSafe(cwd) : config.root ? resolveSafe(config.root) : process.cwd();

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: runDir,
          timeout: timeoutMs ?? 120_000,
          maxBuffer: 1024 * 1024 * 10,
        });
        output.stdout = stdout;
        output.stderr = stderr;
        resultStr = `STDOUT:\n${stdout || "(empty)"}\n\nSTDERR:\n${stderr || "(empty)"}\n\nExit Code: 0`;
      } catch (err: any) {
        output.stdout = err.stdout || "";
        output.stderr = err.stderr || err.message || "";
        output.exitCode = err.code ?? 1;
        resultStr = `STDOUT:\n${output.stdout || "(empty)"}\n\nSTDERR:\n${output.stderr || "(empty)"}\n\nExit Code: ${output.exitCode}`;
      }

      if (resultStr.length > 4000) {
        resultStr = resultStr.substring(0, 4000) + "\n\n... [TRUNCATED] ...\n(Output exceeded 4000 characters)";
      }

      return { content: [{ type: "text" as const, text: resultStr }], structuredContent: output };
    },
  );

  server.registerTool(
    "ast_grep",
    {
      title: "AST Grep tool",
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
      inputSchema: {
        command: z.enum(["rule", "outline"]),
        path: z.string().describe("Absolute or relative file/directory path."),
        language: z.string().optional().describe("The language of the target files. Required for 'rule'."),
        rule: z.record(z.string(), z.any()).optional().describe("The pure JSON object representing the ast-grep rule conditions."),
        fix: z.string().optional().describe("Optional replacement string for matches found by the rule."),
        items: z.string().optional().describe("Top-level items to outline."),
        view: z.string().optional().describe("Outline detail level."),
        type: z.string().optional().describe("Comma-separated list of top-level symbol types to filter."),
      },
      outputSchema: { result: z.string() },
    },
    async ({ command, path: p, language, rule, fix, items, view, type }) => {
      let result: string = "";

      const targetPath = resolveSafe(p);

      try {
        if (command === "outline") {
          let cli = `sg outline "${targetPath}"`;
          if (items) cli += ` --items ${items}`;
          if (view) cli += ` --view ${view}`;
          if (type) cli += ` --type ${type}`;

          try {
            const { stdout, stderr } = await execAsync(cli, { maxBuffer: 1024 * 1024 * 10 });
            result = stdout || stderr;
          } catch (e: any) {
            result = e.stdout || `Execution failed: ${e.message}\n${e.stderr || ""}`;
          }
        } else if (command === "rule") {
          if (!language || !rule) {
            throw new Error("Error: 'language' and 'rule' are required for the 'rule' command.");
          }

          const ruleConfig: any = {
            id: `rule-${randomUUID()}`,
            language,
            rule,
          };
          if (fix) ruleConfig.fix = fix;

          const tempFile = `/tmp/ast-grep-rule-${randomUUID()}.json`;
          const fs = await import("fs/promises");
          await fs.writeFile(tempFile, JSON.stringify(ruleConfig, null, 2), "utf-8");

          let cli = `sg scan -r "${tempFile}" "${targetPath}"`;

          if (fix) {
            cli += ` --update-all`;
            try {
              const { stdout, stderr } = await execAsync(cli, { maxBuffer: 1024 * 1024 * 10 });
              result = stdout || stderr;
            } catch (e: any) {
              result = e.stdout || `Execution failed: ${e.message}\n${e.stderr || ""}`;
            }
          } else {
            cli += ` --json`;
            try {
              const { stdout } = await execAsync(cli, { maxBuffer: 1024 * 1024 * 10 });
              const parsed = JSON.parse(stdout);
              if (Array.isArray(parsed) && parsed.length > 0) {
                result = parsed.map((match: any, i: number) => `--- Match ${i + 1} (${match.file}:${match.range.start.line}) ---\n${match.text}\n`).join("\n");
              } else {
                result = "No matches found.";
              }
            } catch (err: any) {
              if (err.stdout) {
                try {
                  const parsed = JSON.parse(err.stdout);
                  if (Array.isArray(parsed) && parsed.length > 0) {
                    result = parsed.map((match: any, i: number) => `--- Match ${i + 1} (${match.file}:${match.range.start.line}) ---\n${match.text}\n`).join("\n");
                  } else {
                    result = "No matches found.";
                  }
                } catch {
                  result = `Execution failed or JSON parse error: ${err.message}`;
                }
              } else {
                result = `Execution failed or JSON parse error: ${err.message}`;
              }
            }
          }
          await fs.unlink(tempFile).catch(() => {});
        } else {
          throw new Error(`Error: Unknown ast-grep command: ${command}`);
        }
      } catch (err: any) {
        result = `Error executing ast-grep: ${err.message}`;
      }

      const output: AstGrepOutput = { result };
      return { content: [{ type: "text" as const, text: result }], structuredContent: output };
    },
  );
}
