import { describe, it, expect, beforeEach, vi } from 'vitest';

import { initTestDatabase } from '../db/connection.js';
import type { LocalResource } from '../db/connection.js';
import { createChatsRepository, ChatsRepository } from './chats-repository.js';
import { createGroupsRepository, GroupsRepository } from './groups-repository.js';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../config.js', () => ({
  DATA_DIR: '/tmp/test-data',
  GROUPS_DIR: '/tmp/test-groups',
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: vi.fn(),
      existsSync: vi.fn(() => false),
      copyFileSync: vi.fn(),
    },
  };
});

let db: LocalResource;
let groupsRepo: GroupsRepository;
let repo: ChatsRepository;

beforeEach(() => {
  vi.clearAllMocks();
  db = initTestDatabase();
  groupsRepo = createGroupsRepository(db.groups);
  repo = createChatsRepository(db.chats, groupsRepo);
});

// --- storeMetadata ---

describe('storeMetadata', () => {
  it('stores chat with JID as default name', () => {
    repo.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:00.000Z' });

    const chats = repo.getAll();
    expect(chats).toHaveLength(1);
    expect(chats[0].jid).toBe('tg:100');
    expect(chats[0].name).toBe('tg:100');
  });

  it('stores chat with explicit name', () => {
    repo.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:00.000Z', name: 'Dev Team' });

    const chats = repo.getAll();
    expect(chats[0].name).toBe('Dev Team');
  });

  it('updates name on subsequent call with name', () => {
    repo.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:00.000Z' });
    repo.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:01.000Z', name: 'Updated' });

    const chats = repo.getAll();
    expect(chats).toHaveLength(1);
    expect(chats[0].name).toBe('Updated');
  });

  it('preserves newer timestamp on conflict', () => {
    repo.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:05.000Z' });
    repo.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:01.000Z' });

    const chats = repo.getAll();
    expect(chats[0].lastMessageTime).toBe('2024-01-01T00:00:05.000Z');
  });

  it('stores channel and isGroup', () => {
    repo.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:00.000Z', channel: 'telegram', isGroup: true });

    const chats = repo.getAll();
    expect(chats[0].channel).toBe('telegram');
    expect(chats[0].isGroup).toBe(true);
  });
});

// --- update ---

describe('update', () => {
  it('updates chat name', () => {
    repo.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:00.000Z' });
    repo.update({ jid: 'tg:100', name: 'New Name', lastMessageTime: '', channel: '', isGroup: false });

    const chats = repo.getAll();
    expect(chats[0].name).toBe('New Name');
  });
});

// --- getAll ---

describe('getAll', () => {
  it('returns empty array when no chats', () => {
    expect(repo.getAll()).toEqual([]);
  });

  it('returns chats as domain types with camelCase fields', () => {
    repo.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:00.000Z', name: 'Test', channel: 'telegram', isGroup: true });

    const chats = repo.getAll();
    expect(chats[0]).toEqual({
      jid: 'tg:100',
      name: 'Test',
      lastMessageTime: '2024-01-01T00:00:00.000Z',
      channel: 'telegram',
      isGroup: true,
    });
  });

  it('returns multiple chats ordered by last message time descending', () => {
    repo.storeMetadata('tg:old', { timestamp: '2024-01-01T00:00:00.000Z' });
    repo.storeMetadata('tg:new', { timestamp: '2024-01-02T00:00:00.000Z' });

    const chats = repo.getAll();
    expect(chats[0].jid).toBe('tg:new');
    expect(chats[1].jid).toBe('tg:old');
  });
});

// --- getAvailableGroups ---

describe('getAvailableGroups', () => {
  it('returns empty when no chats', () => {
    expect(repo.getAvailableGroups()).toEqual([]);
  });

  it('returns only group chats, excludes __group_sync__', () => {
    repo.storeMetadata('tg:group1', { timestamp: '2024-01-01T00:00:00.000Z', name: 'Group', isGroup: true });
    repo.storeMetadata('tg:dm1', { timestamp: '2024-01-01T00:00:00.000Z', name: 'DM', isGroup: false });
    repo.storeMetadata('__group_sync__', { timestamp: '2024-01-01T00:00:00.000Z' });

    const available = repo.getAvailableGroups();
    expect(available).toHaveLength(1);
    expect(available[0].jid).toBe('tg:group1');
    expect(available[0].name).toBe('Group');
  });

  it('marks registered groups as isRegistered', () => {
    repo.storeMetadata('tg:registered', { timestamp: '2024-01-01T00:00:00.000Z', name: 'Registered', isGroup: true });
    repo.storeMetadata('tg:unregistered', { timestamp: '2024-01-01T00:00:00.000Z', name: 'Unregistered', isGroup: true });

    groupsRepo.registerGroup('tg:registered', { name: 'Registered', folder: 'telegram_registered', addedAt: '2024-01-01T00:00:00.000Z', isMain: false });

    const available = repo.getAvailableGroups();
    const registered = available.find((g) => g.jid === 'tg:registered');
    const unregistered = available.find((g) => g.jid === 'tg:unregistered');

    expect(registered!.isRegistered).toBe(true);
    expect(unregistered!.isRegistered).toBe(false);
  });

  it('includes lastActivity from chat metadata', () => {
    repo.storeMetadata('tg:group1', { timestamp: '2024-06-15T12:00:00.000Z', name: 'Active Group', isGroup: true });

    const available = repo.getAvailableGroups();
    expect(available[0].lastActivity).toBe('2024-06-15T12:00:00.000Z');
  });
});
