import { logger } from "./utils/logger.js";
import { RegisteredGroup } from "./repositories/groups-repository.js";
import { AgentInput } from "../bee/index.js";
import { ImageMimeType } from "./common/index.js";

interface GroupDataBase {
  jid: string;
  group: RegisteredGroup;
}

interface GroupTextData extends GroupDataBase {
  kind: "text";
  prompt: string;
}

interface GroupImageData extends GroupDataBase {
  kind: "image";
  prompt: string;
  imageBase64: string;
  imageMimeType: ImageMimeType;
}

interface GroupCompactionData extends GroupDataBase {
  kind: "compaction";
}

type GroupData = GroupTextData | GroupImageData | GroupCompactionData;

interface GroupQueueDeps {
  runBee: (input: AgentInput) => { pipe: (input: { prompt: string } | { prompt: string; imageBase64: string; imageMimeType: ImageMimeType }) => void; done: Promise<void> };
}

export interface GroupQueue {
  deliver: (data: GroupData) => boolean;
  enqueueCompaction: (data: GroupCompactionData) => void;
  shutdown: () => void;
}

export const createGroupQueue = (deps: GroupQueueDeps): GroupQueue => {
  const queue: GroupData[] = [];
  let shuttingDown = false;
  let pipe: ((input: { prompt: string } | { prompt: string; imageBase64: string; imageMimeType: ImageMimeType }) => void) | undefined;
  let runningJid: string | undefined;

  const deliver = (data: GroupData): boolean => {
    if (shuttingDown) return false;

    if (runningJid !== undefined) {
      if (pipe && runningJid === data.jid) {
        if (data.kind === "image") {
          pipe({ prompt: data.prompt, imageBase64: data.imageBase64, imageMimeType: data.imageMimeType });
        } else if (data.kind === "text") {
          pipe({ prompt: data.prompt });
        } else if (data.kind === "compaction") {
          throw new Error(`Compaction reached pipe path — invariant broken (jid=${data.jid})`);
        }
        logger.debug({ data }, "Piped message to running agent");
        return true;
      }

      queue.push(data);
      logger.debug({ data, queueLength: queue.length }, "Agent busy, message queued");
      return false;
    }

    runningJid = data.jid;
    logger.debug({ jid: data.jid, group: data.group.name }, "Spawning agent for group");

    const base = { group: data.group, chatJid: data.jid, isMain: data.group.isMain, sessionId: data.group.sessionId };
    const beeAgentInput: AgentInput =
      data.kind === "compaction"
        ? { ...base, kind: "compaction" }
        : data.kind === "image"
          ? { ...base, kind: "image", prompt: data.prompt, imageBase64: data.imageBase64, imageMimeType: data.imageMimeType }
          : { ...base, kind: "text", prompt: data.prompt };
    const channel = deps.runBee(beeAgentInput);
    pipe = channel.pipe;

    channel.done
      .catch((err) => {
        logger.error({ data, err }, "Error in runAgent");
      })
      .finally(() => {
        pipe = undefined;
        runningJid = undefined;
        if (queue.length > 0) {
          const next = queue.shift()!;
          logger.debug({ groupJid: next.jid, queueLength: queue.length }, "Dequeuing next message");
          deliver(next);
        }
      });

    return true;
  };

  return {
    deliver: (data) => deliver(data),
    enqueueCompaction: (data) => {
      if (shuttingDown) return;
      logger.debug({ queueLength: queue.length }, "Enqueued message at front (no pipe)");
      queue.unshift(data);
    },
    shutdown: () => {
      logger.info({ queueLength: queue.length }, "GroupQueue shutting down");
      shuttingDown = true;
    },
  };
};
