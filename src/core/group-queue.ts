import { logger } from "./utils/logger.js";
import { RegisteredGroup } from "./repositories/groups-repository.js";
import { ImageMimeType } from "./common/index.js";

interface GroupDataBase {
  jid: string;
  group: RegisteredGroup;
}

interface GroupTextData extends GroupDataBase {
  kind: "text";
  userName: string;
  prompt: string;
}

interface GroupImageData extends GroupDataBase {
  kind: "image";
  userName: string;
  prompt: string;
  imageBase64: string;
  imageMimeType: ImageMimeType;
}

interface GroupCompactionData extends GroupDataBase {
  kind: "compaction";
}

type GroupData = GroupTextData | GroupImageData | GroupCompactionData;

interface GroupQueueDeps {
  runBee: (input: GroupData) => { pipe: (input: { prompt: string } | { prompt: string; imageBase64: string; imageMimeType: ImageMimeType }) => void; done: Promise<void> };
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
        return true;
      }

      queue.push(data);
      logger.debug({ data, queueLength: queue.length }, "Agent busy, message queued");
      return false;
    }

    runningJid = data.jid;
    const channel = deps.runBee(data);
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
