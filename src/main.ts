import { logger } from "./core/utils/logger.js";
import { createGroupQueue, type GroupQueue } from "./core/group-queue.js";
import channelsRegistry, { type TelegramChannelOpts } from "./channels/index.js";
import { initLocalDatabase } from "./core/db/index.js";
import { createGroupsRepository, type GroupsRepository } from "./core/repositories/index.js";
import { startVoiceServer } from "./voice/index.js";
import { runBee } from "./bee/index.js";

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
    runBee: (input, onOutput, onError, onInvalidSession, onCompact) => runBee(input, onOutput, onError, onInvalidSession, onCompact),
    onOutput: async (jid, group, output) => {
      if (output.sessionId.length > 0) {
        logger.debug({ jid, group, sessionId: output.sessionId }, "Updating session ID for group");
        groupsRepo.updateSessionId(jid, output.sessionId);
      }
      const channel = channelsRegistry.findChannel(jid);
      if (channel) {
        await channel.sendMessage(jid, output.message);
      }
    },
    onError: async (jid, error) => {
      const channel = channelsRegistry.findChannel(jid);
      if (channel) {
        await channel.sendMessage(jid, error.message);
      }
    },
    onInvalidSession: (jid) => groupsRepo.updateSessionId(jid, ""),
  });
};

const registerChannels = async () => {
  const telegramOps: TelegramChannelOpts = {
    type: "telegram",
    onInboundMessage: (message, group) => {
      channelsRegistry.findChannel(message.chatJid)?.setTyping(message.chatJid);
      if (message.kind === "text") {
        groupQueue.deliver({ kind: "text", prompt: message.prompt, jid: message.chatJid, group });
      } else if (message.kind === "image") {
        groupQueue.deliver({
          kind: "image",
          prompt: message.prompt,
          imageBase64: message.imageBase64!,
          imageMimeType: message.imageMimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
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

const startVoice = () => {
  const voiceJid = process.env.VOICE_JID;
  if (!voiceJid) {
    logger.warn("VOICE_JID not set — voice server disabled");
    return;
  }

  startVoiceServer((text) => {
    const group = groupsRepo.getByJid(voiceJid);
    if (!group) {
      logger.warn({ voiceJid }, "Voice target group not found");
      return;
    }
    groupQueue.deliver({ kind: "text", jid: voiceJid, group, prompt: text });
  });
};

export const main = async () => {
  registerCleanupHandlers();
  initMain();
  await registerChannels();
  startVoice();
};
