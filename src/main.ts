import { appendFileSync, mkdirSync } from "fs";
import path from "path";

import { logger, HISTORY_DIR } from "./core/utils/index.js";
import { createGroupQueue, type GroupQueue } from "./core/group-queue.js";
import channelsRegistry, { type TelegramChannelOpts } from "./channels/index.js";
import { initLocalDatabase } from "./core/db/index.js";
import { createGroupsRepository, type GroupsRepository } from "./core/repositories/index.js";
// import { startVoiceServer } from "./voice/index.js";
import { runAgent, type AgentInput } from "./agent/index.js";
import { ImageMimeType } from "./core/common/index.js";

mkdirSync(HISTORY_DIR, { recursive: true });

const saveHistoryEntry = async ({ chatJid, content }: { chatJid: string; content: string }): Promise<void> => {
  const filePath = path.join(HISTORY_DIR, `${chatJid.replace(/:/g, "_")}.txt`);
  appendFileSync(filePath, content);
};

let groupsRepo: GroupsRepository;
let groupQueue: GroupQueue;

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

const initRepos = () => {
  const localResource = initLocalDatabase();
  groupsRepo = createGroupsRepository(localResource.groups);
};

const initMain = () => {
  initRepos();
  groupQueue = createGroupQueue({
    runBee: (input) => {
      if (input.kind !== "text") {
        logger.warn({ kind: input.kind, jid: input.jid }, "Non-text input kind received — no-op (only 'text' is implemented in v0)");
        return { pipe: () => {}, done: Promise.resolve() };
      }

      const agentInput: AgentInput = {
        kind: "text",
        userName: input.userName,
        prompt: input.prompt,
        group: {
          folder: input.group.folder,
          name: input.group.name,
          chatJid: input.jid,
        },
      };

      const done = (async () => {
        const channel = channelsRegistry.findChannel(agentInput.group.chatJid);
        await runAgent({
          input: agentInput,
          onOutput: async ({ message }) => {
            if (channel) {
              await channel.sendMessage(agentInput.group.chatJid, message);
            }
          },
          onError: async ({ message }) => {
            if (channel) {
              await channel.sendMessage(agentInput.group.chatJid, `Error: ${message}`);
            }
          },
          saveHistoryEntry,
        });
      })();

      return {
        pipe: () => logger.warn("pipe() called but streaming is not implemented in client-sdk-bee yet"),
        done,
      };
    },
  });
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
  registerCleanupHandlers();
  initMain();
  await registerChannels();
  // startVoice();
};
