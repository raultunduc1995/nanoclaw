import { type ChildProcess, spawn } from "child_process";

const COMMAND_TIMEOUT = 30_000;
const MAX_OUTPUT_LENGTH = 50_000;
const MARKER = "__BASH_END_7f3a9b__";

export class BashTool {
  private process: ChildProcess;
  private cwd: string;

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
      this.process.kill();
      this.process = this.spawnBash();
      return "Bash session restarted";
    }

    if (!input.command) {
      throw new Error("No command provided");
    }

    if (input.command.includes("sudo")) {
      throw new Error("sudo is not allowed");
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
          resolve(truncate((stdout + stderr).trim()));
        }
      };

      const onStderr = (data: Buffer) => {
        stderr += data.toString();
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.process.stdout?.off("data", onStdout);
        this.process.stderr?.off("data", onStderr);
      };

      this.process.stdout?.on("data", onStdout);
      this.process.stderr?.on("data", onStderr);
      this.process.stdin?.write(`${input.command}\necho "${MARKER}"\n`);
    });
  }

  close() {
    this.process.kill();
  }
}

function truncate(output: string): string {
  if (output.length > MAX_OUTPUT_LENGTH) {
    return output.slice(0, MAX_OUTPUT_LENGTH) + `\n\n... Output truncated (${output.length} length) ...`;
  }
  return output;
}
