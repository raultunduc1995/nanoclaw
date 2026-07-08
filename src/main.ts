import { logger } from "./core/utils/index.js";
import { createChannelsRegistry, type ChannelsRegistry, type TelegramChannelOpts, type InboundMessage } from "./channels/index.js";
import { initLocalDatabase } from "./core/db/index.js";
import { createGroupsRepository, createHistoryRepository, createMemoriesRepository, type HistoryEntry, type GroupsRepository, type RegisteredGroup } from "./core/repositories/index.js";
// import { startVoiceServer } from "./voice/index.js";
import { createGeminiAgent, type GeminiAgent, type GeminiAgentInput } from "./google-agent/index.js";

let groupsRepo: GroupsRepository;
let channelsRegistry: ChannelsRegistry;
let geminiAgent: GeminiAgent;

const activeRuns = new Map<string, Promise<void>>();

const initMain = async () => {
  channelsRegistry = createChannelsRegistry();

  const localResource = await initLocalDatabase();
  groupsRepo = await createGroupsRepository(localResource.groups);
  const historyRepo = createHistoryRepository(localResource.history);
  const memoriesRepo = createMemoriesRepository(localResource.memories);

  geminiAgent = createGeminiAgent({
    memoriesRepository: memoriesRepo,
    onOutput: async ({ chatJid, message }) => {
      const channel = channelsRegistry.findChannel(chatJid);
      if (channel) {
        await channel.sendMessage(chatJid, message);
      }
    },
    onError: async ({ chatJid, message }) => {
      const channel = channelsRegistry.findChannel(chatJid);
      if (channel) {
        await channel.sendMessage(chatJid, `Error: ${message}`);
      }
    },
    loadHistory: async function (jid: string): Promise<HistoryEntry[]> {
      const loaded = await historyRepo.load(jid);
      return loaded.map((e): HistoryEntry => {
        if (e.role === "model") {
          return {
            role: "model",
            content: e.content,
          };
        }
        return {
          role: "user",
          content: e.content,
        };
      });
    },
    appendHistory: historyRepo.append,
    deleteHistoryFrom: historyRepo.deleteFrom,
    clearHistory: historyRepo.clear,
  });
};

const registerCleanupHandlers = () => {
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received");
    await channelsRegistry.disconnectAll();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

const runAgentLoop = async (inputMsg: InboundMessage, group: RegisteredGroup) => {
  const initialInput: GeminiAgentInput =
    inputMsg.kind === "text"
      ? { kind: "text", userName: inputMsg.userName, prompt: inputMsg.prompt, group }
      : inputMsg.kind === "image"
        ? { kind: "image", userName: inputMsg.userName, prompt: inputMsg.prompt, inlineData: { data: inputMsg.imageBase64, mimeType: inputMsg.imageMimeType }, group }
        : { kind: "video", userName: inputMsg.userName, prompt: inputMsg.prompt, inlineData: { data: inputMsg.videoBase64, mimeType: inputMsg.videoMimeType }, group };
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
        geminiAgent.interruptAgentLoop(group.jid);
        return;
      }
      if (command === "compact") {
        await geminiAgent.runCompaction(group).catch((err) => {
          logger.error({ err, jid: group.jid }, "Failed to manually compact context");
        });
        return;
      }
      if (command === "temp" && payload) {
        const temp = parseFloat(payload);
        if (!isNaN(temp) && temp >= 0.0 && temp <= 2.0) {
          await groupsRepo.updateGroup(group.jid, { ...group, temperature: temp });
          channelsRegistry.findChannel(group.jid)?.sendMessage(group.jid, `🌡️ Temperature updated to ${temp}`);
        } else {
          channelsRegistry.findChannel(group.jid)?.sendMessage(group.jid, `⚠️ Invalid temperature. Please provide a number between 0.0 and 2.0 (e.g., /temp 1.5)`);
        }
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
