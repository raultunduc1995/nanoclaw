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

describe('get and set', () => {
  it('returns undefined for missing key', () => {
    expect(routerState.get('nonexistent')).toBeUndefined();
  });

  it('sets and gets a value', () => {
    routerState.set('cursor', '2024-01-01T00:00:00.000Z');
    expect(routerState.get('cursor')).toBe('2024-01-01T00:00:00.000Z');
  });

  it('overwrites on duplicate key', () => {
    routerState.set('cursor', 'first');
    routerState.set('cursor', 'second');
    expect(routerState.get('cursor')).toBe('second');
  });

  it('stores multiple independent keys', () => {
    routerState.set('last_timestamp', 'ts1');
    routerState.set('last_agent_timestamp', 'ts2');
    expect(routerState.get('last_timestamp')).toBe('ts1');
    expect(routerState.get('last_agent_timestamp')).toBe('ts2');
  });

  it('stores empty string as value', () => {
    routerState.set('empty', '');
    expect(routerState.get('empty')).toBe('');
  });
});
