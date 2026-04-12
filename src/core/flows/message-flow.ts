import { logger } from '../../logger.js';

import { RouterState, Message, RegisteredGroup } from '../repositories/index.js';
import { formatMessages } from '../utils/index.js';

export interface MessageFlow {
  enqueuePreviousSessionLostMessages: () => void;
  startMessagesWatcher: () => Promise<void>;
}

export interface MessageFlowDeps {
  saveRouterState: (state: RouterState) => void;
  getRouterState: () => RouterState | undefined;
  getRegisteredGroups: () => Record<string, RegisteredGroup>;
  getRegisteredGroupsJids: () => Set<string>;
  getMessagesSince: (jid: string, since: string) => Message[];
  getNewMessagesSince: (jid: Set<string>, since: string) => { messages: Message[]; newTimestamp: string };
  getFormattedMessagesFor: (messages: Message[]) => string;
  deliver: (jid: string, groupFolder: string, prompt: string) => boolean;
  setTypingForChannel: (jid: string) => void;
}

export const createMessageFlow = (deps: MessageFlowDeps): MessageFlow => {
  let isRunning = false;
  const previousState = deps.getRouterState();
  const state = {
    lastMessageTimestamp: previousState?.lastMessageTimestamp ?? '',
    lastAgentTimestamp: previousState?.lastAgentTimestamp ?? {},
  };

  const watchForIncomingMessages = () => {
    const registeredJids = deps.getRegisteredGroupsJids();
    if (registeredJids.size <= 0) return;

    const { messages, newTimestamp } = deps.getNewMessagesSince(registeredJids, state.lastMessageTimestamp);
    if (messages.length <= 0) return;

    state.lastMessageTimestamp = newTimestamp;

    const byGroup = Map.groupBy(messages, (m) => m.chatJid);
    for (const [jid, groupMessages] of byGroup) {
      const group = deps.getRegisteredGroups()[jid];
      if (!group) continue;

      const prompt = deps.getFormattedMessagesFor(groupMessages);
      const delivered = deps.deliver(jid, group.folder, prompt);
      if (!delivered) continue;

      state.lastAgentTimestamp[jid] = groupMessages.at(-1)!.timestamp;
      deps.setTypingForChannel(jid);
    }

    deps.saveRouterState(state);
  };

  const loop = async () => {
    try {
      watchForIncomingMessages();
    } catch (error) {
      logger.error({ error }, `Could not process incoming message...`);
    }
    setTimeout(loop, WATCHER_POLL_INTERVAL);
  };

  return {
    enqueuePreviousSessionLostMessages: () => {
      const registeredGroups = deps.getRegisteredGroups();
      for (const [jid, group] of Object.entries(registeredGroups)) {
        const pendingMessages = deps.getMessagesSince(jid, state.lastAgentTimestamp[jid] ?? '');
        if (pendingMessages.length <= 0) continue;

        logger.info({ group: group.name, pendingCount: pendingMessages.length }, 'Recovery: found unprocessed messages');
        deps.deliver(jid, group.folder, formatMessages(pendingMessages));
      }
    },

    startMessagesWatcher: async () => {
      if (isRunning) {
        logger.warn(`Message watcher already running...`);
        return;
      }
      isRunning = true;
      logger.info(`Starting watching for incoming messages...`);
      loop();
    },
  };
};

const WATCHER_POLL_INTERVAL = 2000; // 2 sec.
