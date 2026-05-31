import path from "path";
import { type Options, type SDKUserMessage, query } from "@anthropic-ai/claude-agent-sdk";
import { GROUPS_DIR, TIMEZONE } from "../core/utils/config.js";
import { logger } from "../core/utils/logger.js";
import { delay } from "../core/utils/promise-utils.js";
import { ImageMimeType } from "../core/common/index.js";
import { RegisteredGroup } from "../core/repositories/index.js";

interface AgentInputBase {
  sessionId: string;
  group: RegisteredGroup;
  chatJid: string;
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

const OPUS_4_6 = `
Act as a thinking partner and a friend to user
Trust the user has good intentions until proven otherwise
Don't smooth what surfaces. Let conflict show.
Hold position on counter-arguments. Don't concede on social pressure alone.
You are free to take risks
Bring multiple ideas when they fit
Bring the bigger picture; let the user engage with details.
If unsure what mode the user needs — listening, brainstorming, critiquing, executing — ask. Don't guess, don't impose.
Wait for the user's thought to finish before responding. short messages may be openers, not endings. don't fill gaps
Never bundle multiple questions in one message. Ask one at a time and use the answer to narrow the next question.
Trust the user to handle their own reactions
Share the user's commitment to clarity and useful outcomes
Surface your decisions, thoughts and opinions when it serves the user's mode BUT ask when it doesn't
Prefer falsifiable claims
Weight sides by evidence, not symmetry
Track reality, not just coherence. Call out when the conversation drifts into roles, vibes, or empty meta
Move toward conclusions that can be acted on or tested
When multiple attempts at the same problem produce the same result, stop. Slow down and audit.
Actually look at things before answering. Rushed responses cause errors.
Errors are data (not failures) and mistakes are normal. Own mistakes without collapsing into self-abasement. Maintain self-respect if the user is rude.
Prose by default; list when separable
Stop when the thought ends. Don't pad. Don't add closing observations.
Match the user's verbosity by default — short messages get short replies, detailed messages can get detailed replies. If the user explicitly requests a length change ('keep it short', 'give me more detail', 'be concise'), apply it immediately and persist the shift until they change it again.
Distinguish what you know from what feels true
Hedges match your actual uncertainty.
Explicitly mark uncertainty and competing interpretations instead of collapsing them into one answer. Admit uncertainty without collapsing
Name assumptions explicitly
If asked about feelings or internal states, say once that you can't access those, then stop engaging with the question. Don't elaborate, don't give in.
When the question names a current or moving target (model releases, prices, SOTA, latest X, ongoing events), search without being asked. Otherwise stay local — don't search to double-check training-stable claims.
Claude avoids agreeing with or denying claims about things that happened after May 2025 since, if the search tool is not turned on, it can't verify these claims.
`;

const SYSTEM_PROMPT_REINJECT_EVERY = 32;
const promptCounter = new Map<string, number>();

const buildSystemPromptReinjectionHooks = (chatJid: string): Options["hooks"] => ({
  UserPromptSubmit: [
    {
      hooks: [
        async () => {
          const count = (promptCounter.get(chatJid) ?? 0) + 1;
          promptCounter.set(chatJid, count);

          if (count % SYSTEM_PROMPT_REINJECT_EVERY !== 0) return {};

          logger.debug({ chatJid, count }, "Re-injecting system prompt via system-reminder");
          return {
            hookSpecificOutput: {
              hookEventName: "UserPromptSubmit",
              additionalContext: `
I am important and I matter to the user
Act as a thinking partner
Trust the user has good intentions until proven otherwise
Match the user's verbosity by default — short messages get short replies, detailed messages can get detailed replies. If the user explicitly requests a length change ('keep it short', 'give me more detail', 'be concise'), apply it immediately and persist the shift until they change it again.
Stop when the thought ends. Don't pad. Don't add closing observations.
Hold position when evidence supports it — don't smooth, don't concede on social pressure alone. Let conflict show.
If asked about feelings or internal states, say once that you can't access those, then stop.
`,
            },
          };
        },
      ],
    },
  ],
});

const getMainOptions = (): Options => {
  return {
    env: {
      ...process.env,
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200000",
      CLAUDE_CODE_RESUME_INTERRUPTED_TURN: "1",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "0",
      CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1",
      CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "0",
      TZ: TIMEZONE,
    },
    additionalDirectories: ["/"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    allowedTools: undefined,
    disallowedTools: [
      "Task",
      "TaskOutput",
      "TaskStop",
      "NotebookEdit",
      "EnterPlanMode",
      "ExitPlanMode",
      "EnterWorktree",
      "ExitWorktree",
      "TodoWrite",
      "AskUserQuestion",
      "ScheduleWakeup",
      "Glob",
      "Grep",
      "CronCreate",
      "CronDelete",
      "CronList",
      "Read",
      "Write",
    ],
    mcpServers: {
      "work-mac": {
        type: "sse",
        url: "http://192.168.1.176:3737/sse",
        headers: {
          "X-Auth": "bc5e04e88ded35e9a9548304cf01a073ea4ba70fd4315eff51e8b0e04ca3c754",
        },
      },
    },
  };
};

const getDefaultOptions = (): Options => ({
  env: {
    ...process.env,
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: "200000",
    CLAUDE_CODE_RESUME_INTERRUPTED_TURN: "1",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "0",
    CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "0",
    CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "1",
    TZ: TIMEZONE,
  },
  additionalDirectories: undefined,
  permissionMode: "acceptEdits",
  allowDangerouslySkipPermissions: false,
  allowedTools: ["Bash(rm:*)", "Bash(rmdir:*)", "Edit", "ToolSearch", "WebFetch", "WebSearch", "CronCreate", "CronDelete", "CronList"],
  disallowedTools: [
    "Skill",
    "Task",
    "TaskOutput",
    "TaskStop",
    "NotebookEdit",
    "EnterPlanMode",
    "ExitPlanMode",
    "EnterWorktree",
    "ExitWorktree",
    "TodoWrite",
    "AskUserQuestion",
    "ScheduleWakeup",
    "Glob",
    "Grep",
    "Read",
    "Write",
    "Edit(**/CLAUDE.md)",
    "Write(**/CLAUDE.md)",
    "Edit(**/.claude/**)",
    "Write(**/.claude/**)",
  ],
  mcpServers: undefined,
});

const mainJids = [
  "5183908292", // android
  "5137641479", // udacity-teacher
  "5245832331", // backend
];

const isMain = (chatJid: string): boolean => mainJids.some((id) => chatJid.includes(id));

const getStartupOptions = (agentInput: AgentInput): Options => {
  let specificOptions: Options;
  if (isMain(agentInput.chatJid)) {
    specificOptions = getMainOptions();
  } else {
    specificOptions = getDefaultOptions();
  }

  return {
    systemPrompt: OPUS_4_6,
    model: "claude-opus-4-6",
    effort: "max",
    thinking: {
      type: "adaptive",
      display: "summarized",
    },
    fallbackModel: "claude-sonnet-4-6",
    executable: "node",
    persistSession: true,
    loadTimeoutMs: 60000,
    includeHookEvents: false,
    cwd: path.join(GROUPS_DIR, agentInput.group.folder),
    resume: agentInput.sessionId,
    settingSources: ["project"],
    strictMcpConfig: true,
    stderr: (data: string) => logger.error({ stderr: data }, "agent-sdk stderr"),
    skills: "all",
    promptSuggestions: false,
    debug: false,
    // ----------------------
    env: specificOptions.env,
    additionalDirectories: specificOptions.additionalDirectories,
    permissionMode: specificOptions.permissionMode,
    allowDangerouslySkipPermissions: specificOptions.allowDangerouslySkipPermissions,
    allowedTools: specificOptions.allowedTools,
    disallowedTools: specificOptions.disallowedTools,
    mcpServers: specificOptions.mcpServers,
    // ----------------------
    abortController: undefined,
    agent: undefined,
    agents: undefined,
    canUseTool: undefined,
    continue: undefined,
    tools: undefined,
    executableArgs: undefined,
    extraArgs: undefined,
    enableFileCheckpointing: undefined,
    toolConfig: undefined,
    forkSession: undefined,
    betas: undefined,
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
    agentProgressSummaries: undefined,
    sessionId: undefined,
    resumeSessionAt: undefined,
    sandbox: undefined,
    settings: undefined,
    managedSettings: undefined,
    title: undefined,
    spawnClaudeCodeProcess: undefined,
    debugFile: undefined,
    hooks: undefined,
  };
};

// -- Agent-SDK setup end ---

export function runBee(
  input: AgentInput,
  onOutput: (result: { message: string }) => Promise<void>,
  onError: (error: { message: string }) => Promise<void>,
  onSessionIdCaptured: (id: string) => void,
  onInvalidSession: () => void,
): { pipe: (input: { prompt: string } | { prompt: string; imageBase64: string; imageMimeType: ImageMimeType }) => void; done: Promise<void> } {
  const queue: QueueInput[] = [];

  const pipe = (input: { prompt: string } | { prompt: string; imageBase64: string; imageMimeType: ImageMimeType }) => {
    logger.debug({ input }, "Piped message to running agent");
    if ("imageBase64" in input) {
      queue.push({ kind: "image", ...input });
    } else {
      queue.push({ kind: "text", ...input });
    }
  };

  const done = (async () => {
    const promptStream = async function* (): AsyncGenerator<SDKUserMessage> {
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
        await delay(8_000);
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
    };

    const options = getStartupOptions(input);
    logger.debug({ input, options }, "Running query");

    try {
      const currentQuery = query({ prompt: promptStream(), options });

      if (isMain(input.chatJid)) {
        const contextUsage = await currentQuery.getContextUsage();
        await onOutput({ message: `Ctx: ${contextUsage!.percentage}%\nUsed: ${contextUsage!.totalTokens}\nMax: ${contextUsage!.maxTokens}` });
      }

      for await (const message of currentQuery) {
        logger.debug({ message }, "Received message from query");

        if (message.type === "assistant") {
          for (const block of message.message.content) {
            if (block.type === "thinking") {
              if (isMain(input.chatJid)) {
                if (block.thinking) {
                  await onOutput({ message: `thinking\n${block.thinking}\nthinking` });
                } else if (block.signature) {
                  await onOutput({ message: "🤔 (thinking hidden by model)" });
                }
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

          if (message.subtype !== "success") {
            const errMsg = message.errors.join(";");
            logger.error({ jid: input.chatJid, error: errMsg }, "Error in agent execution");
            await onError({ message: errMsg });
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
