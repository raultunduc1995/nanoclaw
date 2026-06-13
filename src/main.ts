import { logger } from "./core/utils/index.js";
import { createGroupQueue, type GroupQueue } from "./core/group-queue.js";
import { createChannelsRegistry, type ChannelsRegistry, type TelegramChannelOpts } from "./channels/index.js";
import { initLocalDatabase } from "./core/db/index.js";
import { createGroupsRepository, createHistoryRepository, type GroupsRepository } from "./core/repositories/index.js";
// import { startVoiceServer } from "./voice/index.js";
import { createClaudeAgent, type ClaudeAgent, type ClaudeAgentInput, type ClaudeHistoryEntry } from "./agent/index.js";
import { ImageMimeType } from "./core/common/index.js";
import { createGeminiAgent, type GeminiAgent, type GeminiAgentInput, type GeminiHistoryEntry } from "./google-agent/index.js";

let groupsRepo: GroupsRepository;
let channelsRegistry: ChannelsRegistry;
let geminiAgent: GeminiAgent;
let claudeAgent: ClaudeAgent;
let groupQueue: GroupQueue;

const initMain = () => {
  channelsRegistry = createChannelsRegistry();

  const localResource = initLocalDatabase();
  groupsRepo = createGroupsRepository(localResource.groups);
  const historyRepo = createHistoryRepository(localResource.history);

  geminiAgent = createGeminiAgent({
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
    loadHistory: function (jid: string): GeminiHistoryEntry[] {
      return historyRepo.load(jid).map((e): GeminiHistoryEntry => {
        if (e.role === "model") {
          return {
            role: "model",
            content: e.content,
          };
        }
        return {
          role: "user",
          content: e.content,
        } as GeminiHistoryEntry;
      });
    },
    appendHistory: historyRepo.append,
    deleteHistoryFrom: historyRepo.deleteFrom,
    clearHistory: historyRepo.clear,
  });

  claudeAgent = createClaudeAgent({
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
    loadHistory: function (jid: string): ClaudeHistoryEntry[] {
      return historyRepo.load(jid).map((e): ClaudeHistoryEntry => {
        if (e.role === "assistant") {
          return {
            role: "assistant",
            content: e.content,
          };
        }
        return {
          role: "user",
          content: e.content,
        } as ClaudeHistoryEntry;
      });
    },
    appendHistory: historyRepo.append,
    deleteHistoryFrom: historyRepo.deleteFrom,
    clearHistory: historyRepo.clear,
  });

  groupQueue = createGroupQueue({
    runBee: (input) => {
      if (input.jid === "tg:-5274248775" || input.jid === "tg:-5186159689") {
        let agentInput!: GeminiAgentInput;
        if (input.kind === "text") {
          agentInput = {
            kind: "text",
            userName: input.userName,
            prompt: input.prompt,
            group: input.group,
          };
        } else if (input.kind === "image") {
          agentInput = {
            kind: "image",
            userName: input.userName,
            prompt: input.prompt,
            inlineData: {
              data: input.imageBase64,
              mimeType: input.imageMimeType,
            },
            group: input.group,
          };
        }

        return {
          pipe: () => logger.warn("pipe() called but streaming is not implemented in client-sdk-bee yet"),
          done: geminiAgent.run(agentInput),
        };
      }

      let agentInput!: ClaudeAgentInput;
      if (input.kind === "text") {
        agentInput = {
          kind: "text",
          userName: input.userName,
          prompt: input.prompt,
          group: input.group,
        };
      } else if (input.kind === "image") {
        agentInput = {
          kind: "image",
          userName: input.userName,
          prompt: input.prompt,
          imageBase64: input.imageBase64,
          imageMimeType: input.imageMimeType,
          group: input.group,
        };
      }

      return {
        pipe: () => logger.warn("pipe() called but streaming is not implemented in client-sdk-bee yet"),
        done: claudeAgent.run(agentInput),
      };
    },
  });
};

const registerCleanupHandlers = () => {
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown signal received");
    groupQueue.shutdown();
    await channelsRegistry.disconnectAll();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
};

const registerChannels = async () => {
  const telegramOps: TelegramChannelOpts = {
    type: "telegram",
    onInboundMessage: (message, group) => {
      channelsRegistry.findChannel(message.chatJid)?.setTyping(message.chatJid);
      if (message.kind === "text") {
        groupQueue.deliver({ kind: "text", userName: message.userName, prompt: message.prompt, jid: message.chatJid, group });
      } else if (message.kind === "image") {
        groupQueue.deliver({
          kind: "image",
          userName: message.userName,
          prompt: message.prompt,
          imageBase64: message.imageBase64,
          imageMimeType: message.imageMimeType as ImageMimeType,
          jid: message.chatJid,
          group,
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

//   startVoiceServer((text) => {
//     const group = groupsRepo.getByJid(voiceJid);
//     if (!group) {
//       logger.warn({ voiceJid }, "Voice target group not found");
//       return;
//     }
//     groupQueue.deliver({ kind: "text", jid: voiceJid, group, prompt: text });
//   });
// };

export const main = async () => {
  initMain();
  registerCleanupHandlers();
  await registerChannels();
  // startVoice();
};
