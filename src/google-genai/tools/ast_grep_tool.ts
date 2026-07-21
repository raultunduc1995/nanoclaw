import fs from "fs/promises";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function runBashCommand(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, { maxBuffer: 1024 * 1024 * 10 });
    // Some CLI tools write warnings to stderr while succeeding on stdout
    return stdout || stderr;
  } catch (error: any) {
    // If sg finds no matches or has a soft error, it might exit > 0 but still have stdout
    if (error.stdout) return error.stdout;
    return `Execution failed: ${error.message}\n${error.stderr || ""}`;
  }
}

export interface AstGrepTool {
  execute(args: any): Promise<string>;
}

export const createAstGrepTool = (): AstGrepTool => {
  return {
    execute: async (args: any): Promise<string> => {
      const cmd = args.command;
      const targetPath = args.path || ".";

      try {
        if (cmd === "outline") {
          let cli = `sg outline "${targetPath}"`;
          if (args.items) cli += ` --items ${args.items}`;
          if (args.view) cli += ` --view ${args.view}`;
          if (args.type) cli += ` --type ${args.type}`;
          return await runBashCommand(cli);
        }

        if (cmd === "rule") {
          if (!args.language || !args.rule) {
            return "Error: 'language' and 'rule' are required for the 'rule' command.";
          }

          const ruleConfig: any = {
            id: `rule-${randomUUID()}`,
            language: args.language,
            rule: args.rule,
          };

          if (args.fix) {
            ruleConfig.fix = args.fix;
          }

          const tempFile = `/tmp/ast-grep-rule-${randomUUID()}.json`;
          await fs.writeFile(tempFile, JSON.stringify(ruleConfig, null, 2), "utf-8");

          let cli = `sg scan -r "${tempFile}" "${targetPath}"`;

          if (args.fix) {
            cli += ` --update-all`;
            const result = await runBashCommand(cli);
            await fs.unlink(tempFile).catch(() => {});
            return result;
          } else {
            cli += ` --json`;
            const rawResult = await runBashCommand(cli);
            await fs.unlink(tempFile).catch(() => {});

            try {
              const parsed = JSON.parse(rawResult);
              if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed.map((match: any, i: number) => `--- Match ${i + 1} (${match.file}:${match.range.start.line}) ---\n${match.text}\n`).join("\n");
              } else {
                return "No matches found.";
              }
            } catch (error) {
              return `Found matches but failed to parse JSON output. Raw result snippet: ${rawResult.substring(0, 500)}`;
            }
          }
        }

        return `Error: Unknown ast-grep command: ${cmd}`;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return `Error executing ast-grep: ${errorMessage}`;
      }
    },
  };
};
