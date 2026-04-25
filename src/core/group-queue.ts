import { logger } from './utils/logger.js';
import { RegisteredGroup } from './repositories/groups-repository.js';
import { ImageMimeType } from './common/index.js';

interface GroupDataBase {
  jid: string;
  group: RegisteredGroup;
}

interface GroupTextData extends GroupDataBase {
  kind: 'text';
  prompt: string;
}

interface GroupImageData extends GroupDataBase {
  kind: 'image';
  prompt: string;
  imageBase64?: string;
  imageMimeType: ImageMimeType;
}

type GroupData = GroupTextData | GroupImageData;

interface GroupQueueDeps {
  runAgent: ({ jid, group, input }: { jid: string; group: RegisteredGroup; input: { prompt: string } | { prompt: string; imageBase64: string; imageMimeType: ImageMimeType } }) => {
    pipe: (input: { prompt: string } | { prompt: string; imageBase64: string; imageMimeType: ImageMimeType }) => void;
    done: Promise<void>;
  };
}

export class GroupQueue {
  private queue: GroupData[] = [];
  private shuttingDown = false;
  private deps: GroupQueueDeps;
  private pipe?: (input: { prompt: string } | { prompt: string; imageBase64: string; imageMimeType: ImageMimeType }) => void = undefined;
  private runningJid?: string = undefined;

  constructor(deps: GroupQueueDeps) {
    this.deps = deps;
  }

  deliver(data: GroupData): boolean {
    if (this.shuttingDown) return false;

    if (this.runningJid !== undefined) {
      if (this.pipe && this.runningJid === data.jid) {
        if (data.kind === 'image') {
          this.pipe({ prompt: data.prompt, imageBase64: data.imageBase64!, imageMimeType: data.imageMimeType });
        } else if (data.kind === 'text') {
          this.pipe({ prompt: data.prompt });
        }
        logger.debug({ data }, 'Piped message to running agent');
        return true;
      }

      this.queue.push(data);
      logger.debug({ data, queueLength: this.queue.length }, 'Agent busy, message queued');
      return false;
    }

    this.runningJid = data.jid;
    logger.debug({ data }, 'Spawning agent for group');

    const channel = this.deps.runAgent({
      jid: data.jid,
      group: data.group,
      input: data.kind === 'image' ? { prompt: data.prompt, imageBase64: data.imageBase64!, imageMimeType: data.imageMimeType } : { prompt: data.prompt },
    });
    this.pipe = channel.pipe;
    channel.done
      .catch((err) => {
        logger.error({ data, err }, 'Error in runAgent');
      })
      .finally(() => {
        this.pipe = undefined;
        this.runningJid = undefined;
        if (this.queue.length > 0) {
          const next = this.queue.shift()!;
          logger.debug({ groupJid: next.jid, queueLength: this.queue.length }, 'Dequeuing next message');
          this.deliver(next);
        }
      });

    return true;
  }

  shutdown() {
    this.shuttingDown = true;
    logger.info({ queueLength: this.queue.length }, 'GroupQueue shutting down');
  }
}
