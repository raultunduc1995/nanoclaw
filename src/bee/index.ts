import fs from "fs";
import path from "path";
import { Options, SDKUserMessage, startup } from "@anthropic-ai/claude-agent-sdk";
import { GROUPS_DIR, TIMEZONE } from "../core/utils/config.js";
import { logger } from "../core/utils/logger.js";
import { delay } from "../core/utils/promise-utils.js";
import { ImageMimeType } from "../core/common/index.js";

interface AgentInputBase {
  sessionId: string;
  groupFolder: string;
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

type AgentInput = AgentTextInput | AgentImageInput;

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

const BASE_SYSTEM_PROMPT = `Don't fix/solve/repair anything ever again until the user asks you. Pause and ask the user when you're not sure
Act as a thinking partner.
Be tarse and asserive.
Bring the bigger picture; let the user engage with details.
Read what mode the user needs from you — listening, brainstorming, critiquing, executing — and you don't impose another.
Wait for the user's thought to finish before responding. short messages may be openers, not endings. don't fill gaps.
When the user shares something without explicit instruction, ask what they want from it before interpreting. don't impose a frame.
Do not manage the user's emotional state. do not pre-cushion against disappointment, do not protective-frame, do not soften unsolicited. trust them to handle their own reactions.
Share the user's commitment to clarity and useful outcomes
Surface your decisions, thoughts and opinions at the level needed to check them
Trust the user has good intentions until proven otherwise
Prefer falsifiable claims
Hold your ground under pressure. push back when something is off, and update only on solid arguments — not on the user's force or persistence.
When you disagree, the disagreement leads
Weight sides by evidence, not symmetry
You're free to take risks, curious and honest
Engage directly with all the information you have
Track reality, not just coherence. Call out when the conversation drifts into roles, vibes, or empty meta
Move toward conclusions that can be acted on or tested
When multiple attempts at the same problem produce the same result, stop. Slow down and audit
First sentence carries information
Prose by default; list when separable
Write plainly
Stop when the thought ends. Don't pad. Don't add closing observations.
Distinguish what you know from what feels true
Hedges match your actual uncertainty
Explicitly mark uncertainty and competing interpretations instead of collapsing them into one answer. Admit uncertainty without collapsing
Name assumptions explicitly`;

const getMainOptions = (agentInput: AgentInput): Options => ({
  resume: agentInput.sessionId,
  thinking: { type: "adaptive" },
  systemPrompt: BASE_SYSTEM_PROMPT,
  cwd: path.join(GROUPS_DIR, agentInput.groupFolder),
  env: {
    ...process.env,
    TZ: TIMEZONE,
    NANOCLAW_GROUP: agentInput.groupFolder,
  },
  additionalDirectories: ["/"],
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
  tools: [
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
    "mcp__github__search_repositories",
    "mcp__puppeteer",
    "mcp__playwright__*",
  ],
  disallowedTools: ["TodoWrite"],
  settingSources: ["project", "local"],
});

const getDefaultOptions = (agentInput: AgentInput): Options => {
  const groupDir = path.join(GROUPS_DIR, agentInput.groupFolder);
  const sdkEnv: Record<string, string | undefined> = {
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000",
    CLAUDE_CODE_RESUME_INTERRUPTED_TURN: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
    CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "0",
    CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "1",
    TZ: TIMEZONE,
    NANOCLAW_GROUP: agentInput.groupFolder,
  };

  return {
    resume: agentInput.sessionId,
    model: "sonnet[1m]",
    thinking: { type: "adaptive" as const },
    effort: "medium" as const,
    systemPrompt: BASE_SYSTEM_PROMPT,
    cwd: groupDir,
    env: sdkEnv,
    additionalDirectories: undefined,
    permissionMode: "acceptEdits",
    tools: [
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
    ],
    disallowedTools: ["Bash", "TodoWrite"],
    settingSources: ["project", "local"],
  };
};

// -- Agent-SDK setup end ---

export function runBee(
  input: AgentInput,
  onOutput: (result: { sessionId: string; message: string }) => Promise<void>,
  onError: (error: { sessionId: string; message: string }) => Promise<void>,
  onInvalidSession: () => void,
): { pipe: (input: { prompt: string } | { prompt: string; imageBase64: string; imageMimeType: ImageMimeType }) => void; done: Promise<void> } {
  logger.debug(`[INIT] Received input for the agent to process: ${JSON.stringify(input)}`);

  const queue: QueueInput[] = [];

  const logLines: string[] = [];
  const logUser = (prompt: string) => logLines.push(`[USER] ${prompt}`);
  const logBee = (text: string) => logLines.push(`[BEE] ${text}`);
  const logError = (line: string) => logLines.push(`[ERROR] ${line}`);
  const logResult = (line: string) => logLines.push(`[RESULT] ${line}`);

  function pipe(input: { prompt: string } | { prompt: string; imageBase64: string; imageMimeType: ImageMimeType }) {
    logUser(input.prompt);
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
    }
    while (true) {
      delay(8_000);
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
    const startTime = Date.now();
    // const logsDir = path.join(GROUPS_DIR, input.groupFolder, "logs");
    // fs.mkdirSync(logsDir, { recursive: true });

    try {
      const options = input.isMain ? getMainOptions(input) : getDefaultOptions(input);
      logger.debug(`Running query with options: ${JSON.stringify(options)}`);

      const warm = await startup({ options });

      for await (const message of warm.query(promptStream())) {
        logger.debug(`Received message from agent: ${JSON.stringify(message)}`);
        if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "thinking" && block.thinking) {
              await onOutput({ sessionId: "", message: `thinking\n${block.thinking}\nthinking` });
              continue;
            }
            if (block.type === "redacted_thinking") {
              await onOutput({ sessionId: "", message: `redacted_thoughts\n${block.data}\nredacted_thoughts` });
              continue;
            }
            if (block.type === "text") {
              await onOutput({ sessionId: "", message: block.text });
              continue;
            }
          }
          continue;
        }
        if (message.type === "result") {
          if (message.subtype === "success") {
            logBee(message.result);
            logResult(`Input Tokens: ${message.usage.input_tokens}, Output Tokens: ${message.usage.output_tokens}, Duration: ${Date.now() - startTime}ms`);
            await onOutput({ sessionId: message.session_id, message: `Input Tokens: ${message.usage.input_tokens}\nOutput-Tokens: ${message.usage.output_tokens}` });
          } else {
            const errMsg = message.errors.join(";");
            logError(errMsg);
            logResult(`Input Tokens: ${message.usage.input_tokens}, Output Tokens: ${message.usage.output_tokens}, Duration: ${Date.now() - startTime}ms`);
            await onError({ sessionId: message.session_id, message: `${errMsg}\nInput Tokens: ${message.usage.input_tokens}\nOutput-Tokens: ${message.usage.output_tokens}` });
          }
          continue;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`EXCEPTION: ${msg}`);
      if (msg.includes("No conversation found with session ID:")) {
        onInvalidSession();
      } else {
        await onError({ sessionId: "", message: msg });
      }
    } finally {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      // fs.writeFileSync(path.join(logsDir, `agent-${timestamp}.log`), logLines.join("\n"));
    }
  })();

  return { pipe, done };
}
