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

describe('storeNamedMetadata', () => {
  it('stores chat with all fields', () => {
    chats.upsert('tg:100', { timestamp: '2024-01-01T00:00:00.000Z', name: 'Dev Team', channel: 'telegram', isGroup: true });
    const rows = chats.getAll();
    expect(rows).toHaveLength(1);
    expect(rows[0].jid).toBe('tg:100');
    expect(rows[0].name).toBe('Dev Team');
    expect(rows[0].channel).toBe('telegram');
    expect(rows[0].is_group).toBe(1);
  });

  it('updates name on subsequent call', () => {
    chats.upsert('tg:100', { timestamp: '2024-01-01T00:00:00.000Z', name: 'Old', channel: 'telegram', isGroup: true });
    chats.upsert('tg:100', { timestamp: '2024-01-01T00:00:01.000Z', name: 'New', channel: 'telegram', isGroup: true });
    expect(chats.getAll()[0].name).toBe('New');
  });

  it('preserves newer timestamp on conflict', () => {
    chats.upsert('tg:100', { timestamp: '2024-01-01T00:00:05.000Z', name: 'Chat', channel: 'telegram', isGroup: false });
    chats.upsert('tg:100', { timestamp: '2024-01-01T00:00:01.000Z', name: 'Chat', channel: 'telegram', isGroup: false });
    expect(chats.getAll()[0].last_message_time).toBe('2024-01-01T00:00:05.000Z');
  });

  it('stores is_group as 1 for groups', () => {
    chats.upsert('tg:100', { timestamp: '2024-01-01T00:00:00.000Z', name: 'Group', channel: 'telegram', isGroup: true });
    expect(chats.getAll()[0].is_group).toBe(1);
  });

  it('stores is_group as 0 for non-groups', () => {
    chats.upsert('tg:100', { timestamp: '2024-01-01T00:00:00.000Z', name: 'DM', channel: 'telegram', isGroup: false });
    expect(chats.getAll()[0].is_group).toBe(0);
  });
});

describe('updateName', () => {
  it('updates name of existing chat', () => {
    chats.upsert('tg:100', { timestamp: '2024-01-01T00:00:00.000Z', name: 'Old', channel: 'telegram', isGroup: false });
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
    chats.upsert('tg:old', { timestamp: '2024-01-01T00:00:00.000Z', name: 'Old', channel: 'telegram', isGroup: false });
    chats.upsert('tg:new', { timestamp: '2024-01-02T00:00:00.000Z', name: 'New', channel: 'telegram', isGroup: false });
    const rows = chats.getAll();
    expect(rows[0].jid).toBe('tg:new');
    expect(rows[1].jid).toBe('tg:old');
  });
});
