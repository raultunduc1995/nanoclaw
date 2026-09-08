import { exec } from "child_process";
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
  server.registerTool(
    "bash",
    {
      title: "Run a shell command",
      description: `Execute a bash command on the host. Returns stdout, stderr, exit code.

ast-grep (sg) is pre-installed for structural AST code search and rewriting:
- Search: ast-grep run -l <lang> -p '<pattern>' <path>
- Rewrite: ast-grep run -l <lang> -p '<pattern>' -r '<rewrite>' -U <path>
  Flags: -p/--pattern, -r/--rewrite, -l/--lang (typescript, kotlin, etc.), -U/--update-all (apply in-place without asking).
- Metavariables: $VAR matches single AST node, $$$VAR matches multiple nodes/statements/args.
- Shell quoting: ALWAYS use single quotes ('...') around patterns and rewrites so bash does not expand metavariables.
- Complex relational rules: Write YAML rule to /tmp/rule.yaml and execute:
  ast-grep scan -r /tmp/rule.yaml -U <path>`,
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
      } catch (err: unknown) {
        const error = err as Error & { stdout?: string; stderr?: string; code?: number };
        output.stdout = typeof error.stdout === "string" ? error.stdout : "";
        output.stderr = typeof error.stderr === "string" ? error.stderr : error.message || "";
        output.exitCode = typeof error.code === "number" ? error.code : 1;
        resultStr = `STDOUT:\n${output.stdout || "(empty)"}\n\nSTDERR:\n${output.stderr || "(empty)"}\n\nExit Code: ${output.exitCode}`;
      }

      if (resultStr.length > 4000) {
        resultStr = resultStr.substring(0, 4000) + "\n\n... [TRUNCATED] ...\n(Output exceeded 4000 characters)";
      }

      return { content: [{ type: "text" as const, text: resultStr }], structuredContent: output };
    },
  );
}
