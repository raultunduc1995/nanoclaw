import { logger } from './utils/logger.js';
import { RegisteredGroup } from './repositories/groups-repository.js';

interface GroupData {
  jid: string;
  group: RegisteredGroup;
  prompt: string;
}

interface GroupQueueDeps {
  runAgent: (jid: string, group: RegisteredGroup, prompt: string) => { pipe: (prompt: string) => void; done: Promise<void> };
}

export class GroupQueue {
  private queue: GroupData[] = [];
  private shuttingDown = false;
  private deps: GroupQueueDeps;
  private pipe?: (prompt: string) => void = undefined;
  private runningJid?: string = undefined;

  constructor(deps: GroupQueueDeps) {
    this.deps = deps;
  }

  deliver(groupJid: string, group: RegisteredGroup, prompt: string): boolean {
    if (this.shuttingDown) return false;

    if (this.runningJid !== undefined) {
      if (this.pipe && this.runningJid === groupJid) {
        this.pipe(prompt);
        logger.debug({ groupJid }, 'Piped message to running agent');
        return true;
      }

      this.queue.push({ jid: groupJid, group, prompt });
      logger.debug({ groupJid, queueLength: this.queue.length }, 'Agent busy, message queued');
      return false;
    }

    this.runningJid = groupJid;
    logger.debug({ groupJid }, 'Spawning agent for group');

    const channel = this.deps.runAgent(groupJid, group, prompt);
    this.pipe = channel.pipe;
    channel.done
      .catch((err) => {
        logger.error({ groupJid, err }, 'Error in runAgent');
      })
      .finally(() => {
        this.pipe = undefined;
        this.runningJid = undefined;
        if (this.queue.length > 0) {
          const next = this.queue.shift()!;
          logger.debug({ groupJid: next.jid, queueLength: this.queue.length }, 'Dequeuing next message');
          this.deliver(next.jid, next.group, next.prompt);
        }
      });

    return true;
  }

  shutdown() {
    this.shuttingDown = true;
    logger.info({ queueLength: this.queue.length }, 'GroupQueue shutting down');
  }
}
