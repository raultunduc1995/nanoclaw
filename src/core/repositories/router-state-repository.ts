import type { RouterStateLocalResource } from '../db/index.js';

// --- Types and interfaces ---

export interface RouterStateRepository {
  getRouterState: (key: string) => string | undefined;
  setRouterState: (key: string, value: string) => void;
}

export const createRouterStateRepository = (resource: RouterStateLocalResource): RouterStateRepository => {
  return {
    getRouterState: (key) => resource.get(key),
    setRouterState: (key, value) => resource.set(key, value),
  };
};
