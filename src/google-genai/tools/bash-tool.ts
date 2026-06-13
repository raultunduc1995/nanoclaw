import { type ChildProcess, spawn } from "child_process";
import fs from "fs";
import path from "path";

const COMMAND_TIMEOUT = 30_000;
const CHAT_PREVIEW_LIMIT = 4000;
const MARKER = "__BASH_END_7f3a9b__";

export class BashTool {
  private process: ChildProcess;
  private cwd: string;
  private pendingCleanup: (() => void) | null = null;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.process = this.spawnBash();
  }

  static init(cwd: string): BashTool {
    return new BashTool(cwd);
  }

  private spawnBash(): ChildProcess {
    return spawn("/bin/bash", ["--norc", "--noprofile"], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  async execute(input: { command?: string; restart?: boolean }): Promise<string> {
    if (input.restart) {
      if (this.pendingCleanup) this.pendingCleanup();
      this.process.kill();
      this.process = this.spawnBash();
      return "Bash session restarted";
    }

    if (!input.command) {
      throw new Error("No command provided");
    }

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Command timed out after ${COMMAND_TIMEOUT / 1000} seconds`));
      }, COMMAND_TIMEOUT);

      const onStdout = (data: Buffer) => {
        stdout += data.toString();
        const markerIndex = stdout.indexOf(MARKER);
        if (markerIndex !== -1) {
          stdout = stdout.slice(0, markerIndex);
          cleanup();
          resolve(truncateAndLog((stdout + stderr).trim()));
        }
      };

      const onStderr = (data: Buffer) => {
        stderr += data.toString();
      };

      const onExit = (code: number | null) => {
        cleanup();
        const output = (stdout + stderr).trim();
        if (output) {
          resolve(truncateAndLog(output));
        } else {
          resolve(`Process exited with code ${code}`);
        }
        // Respawn so next command has a live process
        this.process = this.spawnBash();
      };

      const onError = (err: Error) => {
        cleanup();
        reject(new Error(`Bash process error: ${err.message}`));
        this.process = this.spawnBash();
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.process.stdout?.off("data", onStdout);
        this.process.stderr?.off("data", onStderr);
        this.process.off("exit", onExit);
        this.process.off("error", onError);
        this.pendingCleanup = null;
      };

      this.pendingCleanup = cleanup;

      this.process.stdout?.on("data", onStdout);
      this.process.stderr?.on("data", onStderr);
      this.process.on("exit", onExit);
      this.process.on("error", onError);
      this.process.stdin?.write(`${input.command}\necho "${MARKER}"\n`);
    });
  }

  close() {
    if (this.pendingCleanup) this.pendingCleanup();
    this.process.kill();
  }
}

function truncateAndLog(output: string): string {
  if (output.length <= CHAT_PREVIEW_LIMIT) {
    return output;
  }

  const safeOutput = output;

  const logPath = path.resolve(process.cwd(), ".last_bash_output.log");

  try {
    fs.writeFileSync(logPath, safeOutput, "utf8");
  } catch (error) {
    return safeOutput.slice(0, CHAT_PREVIEW_LIMIT) + `\n\n... Output truncated (${safeOutput.length} characters) ... [Write to log failed: ${error instanceof Error ? error.message : String(error)}]`;
  }

  const halfLimit = Math.floor(CHAT_PREVIEW_LIMIT / 2);
  const head = safeOutput.slice(0, halfLimit);
  const tail = safeOutput.slice(-halfLimit);

  return `[SYSTEM NOTE: Output truncated to save context window. ${safeOutput.length - CHAT_PREVIEW_LIMIT} characters omitted from the middle.

--- START OF PREVIEW ---
${head}
... [TRUNCATED] ...
${tail}
--- END OF PREVIEW ---

The full un-truncated output was written to the absolute path: '${logPath}'. 
If you need to search or inspect the omitted section, use 'grep' or use the 'text_editor' tool to view specific line ranges of '${logPath}'.]`;
}
