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
  it('returns undefined when nothing stored', () => {
    expect(repo.get()).toBeUndefined();
  });

  it('returns state after set', () => {
    repo.set({ lastAgentTimestamp: { 'tg:123': '2024-01-01T00:00:00.000Z' } });
    const result = repo.get();
    expect(result?.lastAgentTimestamp).toEqual({ 'tg:123': '2024-01-01T00:00:00.000Z' });
  });
});

describe('set', () => {
  it('overwrites on update', () => {
    repo.set({ lastAgentTimestamp: { 'tg:1': 'first' } });
    repo.set({ lastAgentTimestamp: { 'tg:1': 'second' } });
    expect(repo.get()?.lastAgentTimestamp).toEqual({ 'tg:1': 'second' });
  });

  it('persists through fresh repository creation', () => {
    repo.set({ lastAgentTimestamp: { 'tg:123': 'ts2' } });
    const freshRepo = createRouterStateRepository(db.routerState);
    expect(freshRepo.get()?.lastAgentTimestamp).toEqual({ 'tg:123': 'ts2' });
  });
});
