import { logger } from '../../logger.js';
import { RegisteredGroup } from '../repositories/index.js';
import { RouterState } from '../repositories/router-state-repository.js';
import { delay } from '../utils/index.js';

export interface MessageFlow {
  enqueuePreviousSessionLostMessages: () => void;
  startMessagesWatcher: () => Promise<void>;
}

export interface MessageFlowDeps {
	getRouterState: () => RouterState | undefined;
	getRegisteredGroups: () => Record<string, RegisteredGroup>;
  getRegisteredGroupsJids: () => Set<string>;
	enqueueMessageCheck: (jid: string) => void;
}

export const createMessageFlow = (deps: MessageFlowDeps): MessageFlow => {
  let isRunning = false;
	let state = deps.getRouterState();

  const watchForIncomingMessages = () => {
    const registeredJids = deps.getRegisteredGroupsJids();
  };

  return {
    enqueuePreviousSessionLostMessages: () => {
			const registeredGroups = deps.getRegisteredGroups();
			for (const [jid, group] of Object.entries(registeredGroups)) {
				const pending = 
			}
		},

    startMessagesWatcher: async () => {
      if (isRunning) {
        logger.warn(`Message watcher already running...`);
        return;
      }
      isRunning = true;

      while (true) {
        watchForIncomingMessages();
        await delay(WATCHER_POLL_INTERVAL);
      }
    },
  };
};

const WATCHER_POLL_INTERVAL = 2000; // 2 sec.
