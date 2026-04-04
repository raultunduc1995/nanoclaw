import { describe, it, expect, beforeEach } from 'vitest';

import { initTestDatabase } from '../db/connection.js';
import type { LocalResource } from '../db/connection.js';
import { createRouterStateRepository, RouterStateRepository } from './router-state-repository.js';

let db: LocalResource;
let repo: RouterStateRepository;

beforeEach(() => {
  db = initTestDatabase();
  repo = createRouterStateRepository(db.routerState);
});

describe('getRouterState', () => {
  it('returns undefined for missing key', () => {
    expect(repo.getRouterState('nonexistent')).toBeUndefined();
  });

  it('returns value after set', () => {
    repo.setRouterState('cursor', '2024-01-01T00:00:00.000Z');
    expect(repo.getRouterState('cursor')).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('setRouterState', () => {
  it('overwrites on duplicate key', () => {
    repo.setRouterState('cursor', 'first');
    repo.setRouterState('cursor', 'second');
    expect(repo.getRouterState('cursor')).toBe('second');
  });

  it('stores multiple independent keys', () => {
    repo.setRouterState('last_timestamp', 'ts1');
    repo.setRouterState('last_agent_timestamp', 'ts2');
    expect(repo.getRouterState('last_timestamp')).toBe('ts1');
    expect(repo.getRouterState('last_agent_timestamp')).toBe('ts2');
  });

  it('stores empty string as value', () => {
    repo.setRouterState('empty', '');
    expect(repo.getRouterState('empty')).toBe('');
  });

  it('persists through fresh repository creation', () => {
    repo.setRouterState('persistent', 'value');

    const freshRepo = createRouterStateRepository(db.routerState);
    expect(freshRepo.getRouterState('persistent')).toBe('value');
  });
});
