import { describe, it, expect, beforeEach } from 'vitest';

import { initTestDatabase } from '../connection.js';
import type { LocalResource } from '../connection.js';
import type { RouterStateLocalResource } from './router-state.js';

let db: LocalResource;
let routerState: RouterStateLocalResource;

beforeEach(() => {
  db = initTestDatabase();
  routerState = db.routerState;
});

describe('get', () => {
  it('returns undefined when nothing stored', () => {
    expect(routerState.get()).toBeUndefined();
  });

  it('returns last_agent_timestamp after set', () => {
    routerState.set({ last_agent_timestamp: { 'tg:123': '2024-01-01T00:00:00.000Z' } });
    const result = routerState.get();
    expect(result?.last_agent_timestamp).toEqual({ 'tg:123': '2024-01-01T00:00:00.000Z' });
  });
});

describe('set', () => {
  it('overwrites last_agent_timestamp', () => {
    routerState.set({ last_agent_timestamp: { 'tg:1': 'first' } });
    routerState.set({ last_agent_timestamp: { 'tg:1': 'second' } });
    expect(routerState.get()?.last_agent_timestamp).toEqual({ 'tg:1': 'second' });
  });

  it('handles corrupted JSON in last_agent_timestamp gracefully', () => {
    (db as any)._db?.prepare('INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)').run('last_agent_timestamp', '{broken');
    const result = routerState.get();
    expect(result?.last_agent_timestamp).toBeUndefined();
  });
});
