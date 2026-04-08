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

  it('returns last_timestamp after set', () => {
    routerState.set({ last_timestamp: '2024-01-01T00:00:00.000Z' });
    const result = routerState.get();
    expect(result?.last_timestamp).toBe('2024-01-01T00:00:00.000Z');
  });

  it('returns last_agent_timestamp after set', () => {
    routerState.set({ last_agent_timestamp: { 'tg:123': '2024-01-01T00:00:00.000Z' } });
    const result = routerState.get();
    expect(result?.last_agent_timestamp).toEqual({ 'tg:123': '2024-01-01T00:00:00.000Z' });
  });

  it('returns both fields after set', () => {
    routerState.set({ last_timestamp: 'ts1', last_agent_timestamp: { 'tg:456': 'ts2' } });
    const result = routerState.get();
    expect(result?.last_timestamp).toBe('ts1');
    expect(result?.last_agent_timestamp).toEqual({ 'tg:456': 'ts2' });
  });
});

describe('set', () => {
  it('overwrites last_timestamp', () => {
    routerState.set({ last_timestamp: 'first' });
    routerState.set({ last_timestamp: 'second' });
    expect(routerState.get()?.last_timestamp).toBe('second');
  });

  it('sets only last_timestamp without touching last_agent_timestamp', () => {
    routerState.set({ last_agent_timestamp: { 'tg:1': 'ts1' } });
    routerState.set({ last_timestamp: 'ts2' });
    const result = routerState.get();
    expect(result?.last_timestamp).toBe('ts2');
    expect(result?.last_agent_timestamp).toEqual({ 'tg:1': 'ts1' });
  });

  it('handles corrupted JSON in last_agent_timestamp gracefully', () => {
    // Write raw corrupted value directly to DB
    db.routerState.set({ last_timestamp: 'ts1' });
    // Manually corrupt the agent timestamp via raw DB access
    (db as any)._db?.prepare('INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)').run('last_agent_timestamp', '{broken');
    const result = routerState.get();
    expect(result?.last_timestamp).toBe('ts1');
    expect(result?.last_agent_timestamp).toBeUndefined();
  });
});
