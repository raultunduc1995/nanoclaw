import { describe, it, expect, beforeEach } from 'vitest';

import { initTestDatabase } from '../connection.js';
import type { LocalResource } from '../connection.js';
import type { ChatsLocalResource } from './chats.js';

let db: LocalResource;
let chats: ChatsLocalResource;

beforeEach(() => {
  db = initTestDatabase();
  chats = db.chats;
});

describe('storeMetadata', () => {
  it('uses JID as default name', () => {
    chats.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:00.000Z' });
    const rows = chats.getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].jid).toBe('tg:100');
    expect(rows[0].name).toBe('tg:100');
  });

  it('preserves existing name when called without name', () => {
    chats.storeNamedMetadata('tg:100', { timestamp: '2024-01-01T00:00:00.000Z', name: 'Original' });
    chats.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:01.000Z' });
    expect(chats.getAll()[0].name).toBe('Original');
  });

  it('preserves newer timestamp on conflict', () => {
    chats.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:05.000Z' });
    chats.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:01.000Z' });
    expect(chats.getAll()[0].last_message_time).toBe('2024-01-01T00:00:05.000Z');
  });

  it('stores channel field', () => {
    chats.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:00.000Z', channel: 'telegram' });
    expect(chats.getAll()[0].channel).toBe('telegram');
  });

  it('stores is_group as 1 for groups', () => {
    chats.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:00.000Z', isGroup: true });
    expect(chats.getAll()[0].is_group).toBe(1);
  });

  it('stores is_group as 0 for non-groups', () => {
    chats.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:00.000Z', isGroup: false });
    expect(chats.getAll()[0].is_group).toBe(0);
  });

  it('preserves existing channel on update without channel', () => {
    chats.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:00.000Z', channel: 'telegram' });
    chats.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:01.000Z' });
    expect(chats.getAll()[0].channel).toBe('telegram');
  });
});

describe('storeNamedMetadata', () => {
  it('stores with explicit name', () => {
    chats.storeNamedMetadata('tg:100', { timestamp: '2024-01-01T00:00:00.000Z', name: 'Dev Team' });
    expect(chats.getAll()[0].name).toBe('Dev Team');
  });

  it('updates name on subsequent call', () => {
    chats.storeNamedMetadata('tg:100', { timestamp: '2024-01-01T00:00:00.000Z', name: 'Old' });
    chats.storeNamedMetadata('tg:100', { timestamp: '2024-01-01T00:00:01.000Z', name: 'New' });
    expect(chats.getAll()[0].name).toBe('New');
  });
});

describe('updateName', () => {
  it('updates name of existing chat', () => {
    chats.storeMetadata('tg:100', { timestamp: '2024-01-01T00:00:00.000Z' });
    chats.updateName('tg:100', 'Renamed');
    expect(chats.getAll()[0].name).toBe('Renamed');
  });

  it('creates chat if it does not exist', () => {
    chats.updateName('tg:new', 'Fresh');
    const rows = chats.getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Fresh');
  });
});

describe('getAll', () => {
  it('returns empty array when no chats', () => {
    expect(chats.getAll()).toEqual([]);
  });

  it('returns rows ordered by last_message_time descending', () => {
    chats.storeMetadata('tg:old', { timestamp: '2024-01-01T00:00:00.000Z' });
    chats.storeMetadata('tg:new', { timestamp: '2024-01-02T00:00:00.000Z' });
    const rows = chats.getAll();
    expect(rows[0].jid).toBe('tg:new');
    expect(rows[1].jid).toBe('tg:old');
  });
});
