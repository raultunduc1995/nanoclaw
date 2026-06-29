import { logger } from "./core/utils/index.js";
import { createChannelsRegistry, type ChannelsRegistry, type TelegramChannelOpts, type InboundMessage } from "./channels/index.js";
import { initLocalDatabase } from "./core/db/index.js";
import { createGroupsRepository, createHistoryRepository, createMemoriesRepository, type HistoryEntry, type GroupsRepository, type RegisteredGroup } from "./core/repositories/index.js";
// import { startVoiceServer } from "./voice/index.js";
import { createGeminiAgent, type GeminiAgent, type GeminiAgentInput } from "./google-agent/index.js";

let groupsRepo: GroupsRepository;
let channelsRegistry: ChannelsRegistry;
let geminiAgent: GeminiAgent;

const messagePipe = new Map<string, Array<{ message: InboundMessage; group: Pick<RegisteredGroup, "jid" | "folder"> }>>();
const activeRuns = new Map<string, boolean>();

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
    pullExtraInputs: (jid: string) => {
      const inputs = messagePipe.get(jid) || [];
      messagePipe.set(jid, []);
      return inputs.map(
        ({ message, group }): GeminiAgentInput =>
          message.kind === "text"
            ? { kind: "text", userName: message.userName, prompt: message.prompt, group }
            : message.kind === "image"
              ? { kind: "image", userName: message.userName, prompt: message.prompt, inlineData: { data: message.imageBase64, mimeType: message.imageMimeType }, group }
              : { kind: "video", userName: message.userName, prompt: message.prompt, inlineData: { data: message.videoBase64, mimeType: message.videoMimeType }, group },
      );
    },
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

const runAgentLoop = async (chatJid: string) => {
  if (activeRuns.get(chatJid)) return;
  activeRuns.set(chatJid, true);

  try {
    while (true) {
      const inputs = messagePipe.get(chatJid) || [];
      if (inputs.length === 0) break;
      const { message: inputMsg, group: inputGroup } = inputs[0];
      messagePipe.set(chatJid, inputs.slice(1));

      const initialInput: GeminiAgentInput =
        inputMsg.kind === "text"
          ? { kind: "text", userName: inputMsg.userName, prompt: inputMsg.prompt, group: inputGroup }
          : inputMsg.kind === "image"
            ? { kind: "image", userName: inputMsg.userName, prompt: inputMsg.prompt, inlineData: { data: inputMsg.imageBase64, mimeType: inputMsg.imageMimeType }, group: inputGroup }
            : { kind: "video", userName: inputMsg.userName, prompt: inputMsg.prompt, inlineData: { data: inputMsg.videoBase64, mimeType: inputMsg.videoMimeType }, group: inputGroup };
      await geminiAgent.runQuery(initialInput);
    }
  } catch (err) {
    logger.error({ chatJid, err }, "Error running agent loop");
  } finally {
    activeRuns.delete(chatJid);
  }
};

const registerChannels = async () => {
  const telegramOps: TelegramChannelOpts = {
    type: "telegram",
    onInboundMessage: (message, group) => {
      const chatJid = message.chatJid;
      channelsRegistry.findChannel(chatJid)?.setTyping(chatJid);

      const inputs = messagePipe.get(chatJid) || [];
      inputs.push({ message, group });
      messagePipe.set(chatJid, inputs);

      runAgentLoop(chatJid);
    },
    onCommand: async (command, group) => {
      if (command === "compact") {
        await geminiAgent.runCompaction(group).catch((err) => {
          logger.error({ err, jid: group.jid }, "Failed to manually compact context");
        });
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
