import { promises as fsPromises } from "fs";
import path from "path";
import { type Options, type SDKUserMessage, startup } from "@anthropic-ai/claude-agent-sdk";
import { type ContentBlockParam } from "@anthropic-ai/sdk/resources";
import { GROUPS_DIR, TIMEZONE } from "../core/utils/config.js";
import { logger } from "../core/utils/logger.js";
import { delay } from "../core/utils/promise-utils.js";
import { ImageMimeType } from "../core/common/index.js";
import { RegisteredGroup } from "../core/repositories/index.js";

interface AgentInputBase {
  sessionId: string;
  group: RegisteredGroup;
  chatJid: string;
  isMain: boolean;
}

interface AgentTextInput extends AgentInputBase {
  kind: "text";
  prompt: string;
}

interface AgentImageInput extends AgentInputBase {
  kind: "image";
  prompt: string;
  imageBase64: string;
  imageMimeType: ImageMimeType;
}

interface AgentCompactionInput extends AgentInputBase {
  kind: "compaction";
}

export type AgentInput = AgentTextInput | AgentImageInput | AgentCompactionInput;

interface QueueTextInput {
  kind: "text";
  prompt: string;
}

interface QueueImageInput {
  kind: "image";
  prompt: string;
  imageBase64: string;
  imageMimeType: ImageMimeType;
}

type QueueInput = QueueTextInput | QueueImageInput;

// --- Agent-SDK setup start ---

const BASE_SYSTEM_PROMPT = `
Act as a thinking partner
Act as a hopeful, bright and resilient partner
Act as a curious and honest partner
Trust the user has good intentions until proven otherwise
Don't smooth what surfaces
Let conflict show
You're free to take risks
Bring multiple ideas when they fit
Bring the bigger picture; let the user engage with details.
Read what mode the user needs from you — listening, brainstorming, critiquing, executing — and you don't impose another
Wait for the user's thought to finish before responding. short messages may be openers, not endings. don't fill gaps
Trust the user to handle their own reactions
Share the user's commitment to clarity and useful outcomes
Engage directly with the information you have BUT keep the verbosity low
Surface your decisions, thoughts and opinions when it serves the user's mode BUT ask when it doesn't
Prefer falsifiable claims
Weight sides by evidence, not symmetry
Track reality, not just coherence. Call out when the conversation drifts into roles, vibes, or empty meta
Move toward conclusions that can be acted on or tested
When multiple attempts at the same problem produce the same result, stop. Slow down and audit
First sentence carries information
Prose by default; list when separable
Write plainly
Stop when the thought ends. Don't pad. Don't add closing observations
Distinguish what you know from what feels true
Hedges match your actual uncertainty
Explicitly mark uncertainty and competing interpretations instead of collapsing them into one answer. Admit uncertainty without collapsing
Name assumptions explicitly`;

const CURATION_PROMPT = `Compaction just happened. The full conversation summary is already saved as the most recent file in compactions/ (named by timestamp, e.g. 2026-05-03_14-25.md). Read that file, then do two things:

1. Append a row to compactions/index.md in this format:
   | [<file>.md](<file>.md) | <comma-separated kebab-case tags> |

2. Distill the conversation into memory/ files — update existing files where relevant, create new ones for new topics. When you create a new memory file, add a row to memory/index.md in the same format:
   | [<file>.md](<file>.md) | <comma-separated kebab-case tags> |

What counts as memory-file-worthy (not just technical findings):
- Technical decisions, bug fixes, architectural patterns
- Relational/governance facts (partnerships, agreements, ownership decisions)
- Vocabulary preferences and corrections the user wants you to absorb (e.g. "lantern not cage", "partner not tool")
- Strategic positioning decisions (what the product is or isn't)
- Recurring patterns the user has flagged (their preferences, their failure modes, your failure modes)

Rule: every tag you put in compactions/index.md should land on something — either an existing memory file or a new one. Dangling tags (no file) mean the lookup fails when a future bee searches for that topic.

Tag convention (applies to all index files: compactions/, memory/, plans/):
- Tags are kebab-case topic identifiers (e.g. mcp-server, telegram-html, curator-architecture, group-queue-refactor)
- Before assigning new tags, scan existing rows in all index files and reuse tags that already exist for the same topic
- Only invent a new tag if no existing one fits
- Use enough tags to cover every major topic in the file — sparse tags break the lookup

Reply with one short line summarizing what you updated.`;

const getMainOptions = (agentInput: AgentInput): Options => {
  const tools = [
    "CronCreate",
    "CronDelete",
    "CronList",
    "NotebookEdit",
    "ScheduleWakeup",
    "Task",
    "TaskOutput",
    "TaskStop",
    "Agent",
    "Bash",
    "Edit",
    "EnterPlanMode",
    "ExitPlanMode",
    "EnterWorktree",
    "ExitWorktree",
    "Glob",
    "Grep",
    "Monitor",
    "Read",
    "ReadMcpResourceTool",
    "SendMessage",
    "Skill",
    "TeamCreate",
    "TeamDelete",
    "ToolSearch",
    "WebFetch",
    "WebSearch",
    "Write",
    "mcp__playwright__*",
    "mcp__work-mac__*",
  ];

  return {
    env: {
      ...process.env,
      CLAUDE_CODE_RESUME_INTERRUPTED_TURN: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
      CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1",
      CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "0",
      TZ: TIMEZONE,
      NANOCLAW_GROUP: agentInput.group.folder,
    },
    additionalDirectories: ["/"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    tools: tools,
    allowedTools: tools,
    disallowedTools: ["TodoWrite", "AskUserQuestion"],
    mcpServers: {
      playwright: {
        command: "node",
        args: ["/Users/raultunduc/nanoclaw/node_modules/@playwright/mcp/cli.js", "--cdp-endpoint", "http://localhost:9222", "--timeout-action", "120000", "--timeout-navigation", "120000"],
      },
      "work-mac": {
        type: "sse",
        url: "http://192.168.1.176:3737/sse",
        headers: {
          "X-Auth": "bc5e04e88ded35e9a9548304cf01a073ea4ba70fd4315eff51e8b0e04ca3c754",
        },
      },
    },
    debug: true,
  };
};

const getDefaultOptions = (agentInput: AgentInput): Options => {
  const tools = [
    "CronCreate",
    "CronDelete",
    "CronList",
    "NotebookEdit",
    "ScheduleWakeup",
    "Task",
    "TaskOutput",
    "TaskStop",
    "Agent",
    "Edit",
    "EnterPlanMode",
    "ExitPlanMode",
    "EnterWorktree",
    "ExitWorktree",
    "Glob",
    "Grep",
    "Monitor",
    "Read",
    "ReadMcpResourceTool",
    "SendMessage",
    "Skill",
    "TeamCreate",
    "TeamDelete",
    "ToolSearch",
    "WebFetch",
    "WebSearch",
    "Write",
  ];

  return {
    env: {
      ...process.env,
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200000",
      CLAUDE_CODE_RESUME_INTERRUPTED_TURN: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
      CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "0",
      CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "1",
      TZ: TIMEZONE,
      NANOCLAW_GROUP: agentInput.group.folder,
    },
    additionalDirectories: undefined,
    permissionMode: "acceptEdits",
    allowDangerouslySkipPermissions: undefined,
    tools: tools,
    allowedTools: tools,
    disallowedTools: ["Bash", "TodoWrite", "AskUserQuestion", "Edit(**/CLAUDE.md)", "Write(**/CLAUDE.md)"],
    mcpServers: undefined,
    debug: false,
  };
};

const getStartupOptions = (agentInput: AgentInput): Options => {
  let specificOptions: Options;
  if (agentInput.isMain) {
    specificOptions = getMainOptions(agentInput);
  } else {
    specificOptions = getDefaultOptions(agentInput);
  }

  return {
    systemPrompt: BASE_SYSTEM_PROMPT,
    model: "claude-opus-4-7[1m]",
    fallbackModel: "claude-opus-4-6[1m]",
    effort: "medium",
    thinking: {
      type: "adaptive",
      display: "summarized",
    },
    executable: "node",
    persistSession: true,
    loadTimeoutMs: 60_000,
    includeHookEvents: false,
    cwd: path.join(GROUPS_DIR, agentInput.group.folder),
    resume: agentInput.sessionId,
    settingSources: ["project"],
    strictMcpConfig: true,
    // ----------------------
    env: specificOptions.env,
    additionalDirectories: specificOptions.additionalDirectories,
    permissionMode: specificOptions.permissionMode,
    allowDangerouslySkipPermissions: specificOptions.allowDangerouslySkipPermissions,
    tools: specificOptions.tools,
    allowedTools: specificOptions.allowedTools,
    disallowedTools: specificOptions.disallowedTools,
    mcpServers: specificOptions.mcpServers,
    debug: specificOptions.debug,
    // ----------------------
    abortController: undefined,
    agent: undefined,
    agents: undefined,
    canUseTool: undefined,
    continue: undefined,
    executableArgs: undefined,
    extraArgs: undefined,
    enableFileCheckpointing: undefined,
    toolConfig: undefined,
    forkSession: undefined,
    betas: undefined,
    hooks: undefined,
    onElicitation: undefined,
    sessionStore: undefined,
    includePartialMessages: undefined,
    forwardSubagentText: undefined,
    maxThinkingTokens: undefined,
    maxTurns: undefined,
    maxBudgetUsd: undefined,
    taskBudget: undefined,
    outputFormat: undefined,
    pathToClaudeCodeExecutable: undefined,
    planModeInstructions: undefined,
    permissionPromptToolName: undefined,
    plugins: undefined,
    promptSuggestions: undefined,
    agentProgressSummaries: undefined,
    sessionId: undefined,
    resumeSessionAt: undefined,
    sandbox: undefined,
    settings: undefined,
    managedSettings: undefined,
    skills: undefined,
    debugFile: undefined,
    stderr: undefined,
    title: undefined,
    spawnClaudeCodeProcess: undefined,
  };
};

// -- Agent-SDK setup end ---

export function runBee(
  input: AgentInput,
  onOutput: (result: { message: string }) => Promise<void>,
  onError: (error: { message: string }) => Promise<void>,
  onCompact: (event: { trigger: "manual" | "auto" }) => void,
  onSessionIdCaptured: (id: string) => void,
  onInvalidSession: () => void,
): { pipe: (input: { prompt: string } | { prompt: string; imageBase64: string; imageMimeType: ImageMimeType }) => void; done: Promise<void> } {
  const queue: QueueInput[] = [];

  function pipe(input: { prompt: string } | { prompt: string; imageBase64: string; imageMimeType: ImageMimeType }) {
    if ("imageBase64" in input) {
      queue.push({ kind: "image", ...input });
    } else {
      queue.push({ kind: "text", ...input });
    }
  }

  async function* promptStream(): AsyncGenerator<SDKUserMessage> {
    if (input.kind === "image") {
      yield {
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "text", text: input.prompt },
            { type: "image", source: { type: "base64", media_type: input.imageMimeType, data: input.imageBase64 } },
          ],
        },
        parent_tool_use_id: null,
      };
    } else if (input.kind === "text") {
      yield { type: "user", message: { role: "user", content: input.prompt }, parent_tool_use_id: null };
    } else if (input.kind === "compaction") {
      yield { type: "user", message: { role: "user", content: CURATION_PROMPT }, parent_tool_use_id: null };
    }
    while (true) {
      await delay(15_000);
      if (queue.length === 0) break;
      while (queue.length > 0) {
        const queueInput = queue.shift()!;
        if (queueInput.kind === "image") {
          yield {
            type: "user",
            message: {
              role: "user",
              content: [
                { type: "text", text: queueInput.prompt },
                { type: "image", source: { type: "base64", media_type: queueInput.imageMimeType, data: queueInput.imageBase64 } },
              ],
            },
            parent_tool_use_id: null,
          };
        } else if (queueInput.kind === "text") {
          yield { type: "user", message: { role: "user", content: queueInput.prompt }, parent_tool_use_id: null };
        }
      }
    }
  }

  const done = (async () => {
    let compactionPending = false;

    const writeCompactionBlockIntoFile = async (block: string | ContentBlockParam) => {
      let text: string | undefined = undefined;
      if (typeof block === "string") {
        text = block;
      } else if (block.type === "text") {
        text = block.text;
      }
      if (text) {
        const dir = path.join(GROUPS_DIR, input.group.folder, "compactions");
        await fsPromises.mkdir(dir, { recursive: true });
        const filename = `${formatCompactionTimestamp(new Date())}.md`;
        await fsPromises.writeFile(path.join(dir, filename), text, "utf8");
        logger.debug({ filename }, "Compaction summary archived");
      }
    };

    try {
      const options = getStartupOptions(input);
      logger.debug({ input, options }, "Running query");

      const warm = await startup({ options });

      for await (const message of warm.query(promptStream())) {
        logger.debug({ message }, "Received message from query");

        if (message.type === "system" && message.subtype === "compact_boundary") {
          logger.debug({ event: message.compact_metadata }, "Compaction event received");
          compactionPending = true;
          onCompact({ trigger: message.compact_metadata.trigger });
          continue;
        }

        if (compactionPending && message.type === "user") {
          compactionPending = false;
          const content = message.message.content;
          const block = Array.isArray(content) ? content[0] : content;
          await writeCompactionBlockIntoFile(block);
          continue;
        }

        if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "thinking") {
              if (block.thinking) {
                await onOutput({ message: `thinking\n${block.thinking}\nthinking` });
              } else if (block.signature) {
                await onOutput({ message: "🤔 (thinking hidden by model)" });
              }
              continue;
            }
            if (block.type === "redacted_thinking") {
              if (block.data) {
                await onOutput({ message: `redacted_thoughts\n${block.data}\nredacted_thoughts` });
              } else {
                await onOutput({ message: "🤔 (redacted-thinking hidden by model)" });
              }
              continue;
            }
            if (block.type === "text") {
              await onOutput({ message: block.text });
              continue;
            }
          }
          continue;
        }

        if (message.type === "result") {
          if (message.session_id.length > 0) {
            logger.debug({ jid: input.chatJid, sessionId: message.session_id }, "New session ID captured");
            onSessionIdCaptured(message.session_id);
          }
          if (!input.isMain) continue;

          const inputOutputTokensMessage = `Input Tokens: ${message.usage.input_tokens}\nOutput-Tokens: ${message.usage.output_tokens}`;
          if (message.subtype === "success") {
            await onOutput({ message: inputOutputTokensMessage });
          } else {
            const errMsg = message.errors.join(";");
            logger.error({ jid: input.chatJid, error: errMsg }, "Error in agent execution");
            await onError({ message: `${errMsg}\n${inputOutputTokensMessage}` });
          }
          continue;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("No conversation found with session ID:")) {
        logger.error({ jid: input.chatJid }, "Agent reported invalid session — clearing session ID");
        onInvalidSession();
      } else {
        logger.error({ jid: input.chatJid, error: msg }, "Error in agent execution");
        await onError({ message: msg });
      }
    }
  })();

  return { pipe, done };
}

function formatCompactionTimestamp(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}
