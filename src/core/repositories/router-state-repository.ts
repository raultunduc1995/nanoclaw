import type { RouterStateLocalResource } from '../db/index.js';

// --- Types and interfaces ---

export interface RouterStateRepository {
  get: () => RouterState | undefined;
  set: (routerState: RouterState) => void;
}

export interface RouterState {
  lastMessageTimestamp?: string;
  lastAgentTimestamp?: Record<string, string>;
}

export const createRouterStateRepository = (resource: RouterStateLocalResource): RouterStateRepository => {
  return {
    get: () => {
      const routerStateRow = resource.get();
      if (routerStateRow) {
        return {
          lastMessageTimestamp: routerStateRow.last_timestamp,
          lastAgentTimestamp: routerStateRow.last_agent_timestamp,
        };
      }
    },
    set: (routerState) =>
      resource.set({
        last_timestamp: routerState.lastMessageTimestamp,
        last_agent_timestamp: routerState.lastAgentTimestamp,
      }),
  };
};
