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
  runBee: (
    input: AgentInput,
    onOutput: (result: { sessionId: string; message: string }) => Promise<void>,
    onError: (error: { sessionId: string; message: string }) => Promise<void>,
    onInvalidSession: () => void,
    onCompact: (event: { sessionId: string; trigger: "manual" | "auto" }) => Promise<void>,
  ) => { pipe: (input: { prompt: string } | { prompt: string; imageBase64: string; imageMimeType: ImageMimeType }) => void; done: Promise<void> };
  onOutput: (jid: string, group: RegisteredGroup, result: { sessionId: string; message: string }) => Promise<void>;
  onError: (jid: string, error: { sessionId: string; message: string }) => Promise<void>;
  onInvalidSession: (jid: string) => void;
}

export interface GroupQueue {
  deliver: (data: GroupData) => boolean;
  shutdown: () => void;
}

export const createGroupQueue = (deps: GroupQueueDeps): GroupQueue => {
  const queue: GroupData[] = [];
  let shuttingDown = false;
  let pipe: ((input: { prompt: string } | { prompt: string; imageBase64: string; imageMimeType: ImageMimeType }) => void) | undefined;
  let runningJid: string | undefined;

  const enqueue = (data: GroupCompactionData): void => {
    if (shuttingDown) return;
    logger.debug({ queueLength: queue.length }, "Enqueued message at front (no pipe)");
    queue.unshift(data);
  };

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
    const jid = data.jid;
    const group = data.group.name;
    logger.debug({ jid, group }, "Spawning agent for group");

    const base = { groupFolder: data.group.folder, chatJid: data.jid, isMain: data.group.isMain, sessionId: data.group.sessionId };
    const beeAgentInput: AgentInput =
      data.kind === "compaction"
        ? { ...base, kind: "compaction" }
        : data.kind === "image"
          ? { ...base, kind: "image", prompt: data.prompt, imageBase64: data.imageBase64, imageMimeType: data.imageMimeType }
          : { ...base, kind: "text", prompt: data.prompt };
    const channel = deps.runBee(
      beeAgentInput,
      async (output) => deps.onOutput(data.jid, data.group, output),
      async (error) => {
        logger.error({ data, error }, "Error in agent execution");
        deps.onError(data.jid, error);
      },
      () => {
        logger.warn({ data }, "Agent reported invalid session — clearing session ID");
        deps.onInvalidSession(data.jid);
      },
      async (_event) => {
        enqueue({ kind: "compaction", jid: data.jid, group: data.group });
      },
    );
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
    shutdown: () => {
      logger.info({ queueLength: queue.length }, "GroupQueue shutting down");
      shuttingDown = true;
    },
  };
};
