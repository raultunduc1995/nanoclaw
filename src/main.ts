import { logger } from "./core/utils/index.js";
import { createChannelsRegistry, type ChannelsRegistry, type TelegramChannelOpts, type InboundMessage } from "./channels/index.js";
import { initLocalDatabase } from "./core/db/index.js";
import { createGroupsRepository, createHistoryRepository, createMemoriesRepository, type GroupsRepository, type RegisteredGroup } from "./core/repositories/index.js";
import type { ThinkingLevel } from "./core/repositories/groups-repository.js";
// import { startVoiceServer } from "./voice/index.js";
import { type Step } from "./google-genai/index.js";
import { createGeminiAgent, type GeminiAgent, type GeminiAgentInput } from "./google-agent/index.js";
import { type MessageParam } from "./openai/index.js";
import { createDeepSeekAgent, type DeepSeekAgent } from "./deepseek-agent/index.js";

let groupsRepo: GroupsRepository;
let channelsRegistry: ChannelsRegistry;
let geminiAgent: GeminiAgent;
let deepSeekAgent: DeepSeekAgent;

const activeRuns = new Map<string, Promise<void>>();
const DEEPSEEK_GROUP_JIDS = new Set(["tg:-5410596622", "tg:-5583249540"]);

const initMain = async () => {
  channelsRegistry = createChannelsRegistry();

  const localResource = await initLocalDatabase();
  groupsRepo = await createGroupsRepository(localResource.groups);
  const historyRepo = createHistoryRepository(localResource.history);
  const memoriesRepo = createMemoriesRepository(localResource.memories);

  const onOutput = async ({ chatJid, message }: { chatJid: string; message: string }) => {
    const channel = channelsRegistry.findChannel(chatJid);
    if (channel) {
      await channel.sendMessage(chatJid, message);
    }
  };

  const onError = async ({ chatJid, message }: { chatJid: string; message: string }) => {
    const channel = channelsRegistry.findChannel(chatJid);
    if (channel) {
      await channel.sendMessage(chatJid, `Error: ${message}`);
    }
  };

  geminiAgent = createGeminiAgent({
    memoriesRepository: memoriesRepo,
    onOutput,
    onError,
    loadHistory: async (jid: string): Promise<Step[]> => await historyRepo.loadSteps(jid),
    appendHistory: historyRepo.appendStep,
    deleteHistoryFrom: historyRepo.deleteFrom,
    clearHistory: historyRepo.clear,
  });

  deepSeekAgent = createDeepSeekAgent({
    memoriesRepository: memoriesRepo,
    onOutput,
    onError,
    loadHistory: async (jid: string): Promise<MessageParam[]> => await historyRepo.loadMessages(jid),
    appendHistory: historyRepo.appendMessage,
    deleteHistoryFrom: historyRepo.deleteFrom,
    clearHistory: historyRepo.clear,
  });
};

const registerCleanupHandlers = () => {
  const shutdown = async (signal: string) => {
    logger.debug({ signal }, "Shutdown signal received");
    await channelsRegistry.disconnectAll();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

const runAgentLoop = async (inputMsg: InboundMessage, group: RegisteredGroup) => {
  if (DEEPSEEK_GROUP_JIDS.has(group.jid)) {
    if (inputMsg.kind === "text") {
      await deepSeekAgent.runQuery({ kind: "text", userName: inputMsg.userName, prompt: inputMsg.prompt, group });
      return;
    }
    if (inputMsg.kind === "image") {
      await deepSeekAgent.runQuery({ kind: "image", userName: inputMsg.userName, prompt: inputMsg.prompt, blob: inputMsg.blob, mimeType: inputMsg.mimeType, group });
      return;
    }
    return;
  }

  const initialInput: GeminiAgentInput =
    inputMsg.kind === "text"
      ? { kind: "text", userName: inputMsg.userName, prompt: inputMsg.prompt, group }
      : inputMsg.kind === "image"
        ? { kind: "image", userName: inputMsg.userName, prompt: inputMsg.prompt, blob: inputMsg.blob, mimeType: inputMsg.mimeType, group }
        : inputMsg.kind === "video"
          ? { kind: "video", userName: inputMsg.userName, prompt: inputMsg.prompt, blob: inputMsg.blob, mimeType: inputMsg.mimeType, group }
          : inputMsg.kind === "voice"
            ? { kind: "voice", userName: inputMsg.userName, prompt: inputMsg.prompt, blob: inputMsg.blob, mimeType: inputMsg.mimeType, group }
            : { kind: "pdf", userName: inputMsg.userName, prompt: inputMsg.prompt, blob: inputMsg.blob, mimeType: inputMsg.mimeType, group };
  await geminiAgent.runQuery(initialInput);
};

const registerChannels = async () => {
  const telegramOps: TelegramChannelOpts = {
    type: "telegram",
    onInboundMessage: (message, group) => {
      const chatJid = message.chatJid;
      channelsRegistry.findChannel(chatJid)?.setTyping(chatJid);

      const previousRun = activeRuns.get(chatJid) || Promise.resolve();
      const currentRun = previousRun
        .then(async () => {
          await runAgentLoop(message, group);
        })
        .catch((err) => logger.error({ chatJid, err }, "Error running agent loop in promise chain"))
        .finally(() => {
          if (activeRuns.get(chatJid) === currentRun) activeRuns.delete(chatJid);
        });
      activeRuns.set(chatJid, currentRun);
    },
    onCommand: async (command, group, payload) => {
      if (command === "stop") {
        if (DEEPSEEK_GROUP_JIDS.has(group.jid)) return;
        geminiAgent.interruptAgentLoop(group.jid);
        return;
      }
      if (command === "compact") {
        if (DEEPSEEK_GROUP_JIDS.has(group.jid)) {
          await deepSeekAgent.runCompaction(group).catch((err) => {
            logger.error({ err, jid: group.jid }, "Failed to manually compact context");
          });
          return;
        }
        await geminiAgent.runCompaction(group).catch((err) => {
          logger.error({ err, jid: group.jid }, "Failed to manually compact context");
        });
        return;
      }
      if (command === "thinking") {
        if (DEEPSEEK_GROUP_JIDS.has(group.jid)) return;
        const level = payload?.trim().toLowerCase();
        const validLevels: ThinkingLevel[] = ["low", "medium", "high"];
        if (level && validLevels.includes(level as ThinkingLevel)) {
          await groupsRepo.updateGroup(group.jid, { ...group, thinkingLevel: level as ThinkingLevel });
          channelsRegistry.findChannel(group.jid)?.sendMessage(group.jid, `🧠 Thinking level updated to ${level}`);
          return;
        }
        channelsRegistry.findChannel(group.jid)?.sendMessage(
          group.jid,
          `🧠 Current thinking level: ${group.thinkingLevel || "medium"}
Usage: /thinking <low|medium|high>`,
        );
        return;
      }
    },
    getRegisteredGroups: () => groupsRepo.getAllAsRecord(),
    registerNewGroup: (jid, group) => groupsRepo.register(jid, group),
  };

  channelsRegistry.registerTelegramChannel(telegramOps);
  await channelsRegistry.connectAll();
};

// const startVoice = () => {
//   const voiceJid = process.env.VOICE_JID;
//   if (!voiceJid) {
//     logger.warn("VOICE_JID not set — voice server disabled");
//     return;
//   }
//
//   startVoiceServer((text) => {
//     const group = groupsRepo.getByJid(voiceJid);
//     if (!group) {
//       logger.warn({ voiceJid }, "Voice target group not found");
//       return;
//     }
//
//     const previousRun = groupChains.get(voiceJid) || Promise.resolve();
//     const currentRun = previousRun
//       .then(async () => {
//         await runAgent({ kind: "text", jid: voiceJid, group, prompt: text, userName: "Voice" });
//       })
//       .catch((err) => {
//         logger.error({ voiceJid, err }, "Error running agent for voice in promise chain");
//       })
//       .finally(() => {
//         if (groupChains.get(voiceJid) === currentRun) {
//           groupChains.delete(voiceJid);
//         }
//       });
//
//     groupChains.set(voiceJid, currentRun);
//   });
// };

export const main = async () => {
  await initMain();
  registerCleanupHandlers();
  await registerChannels();
  // startVoice();
};
