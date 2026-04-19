import { describe, it, expect, beforeEach } from 'vitest';

import { initTestDatabase } from '../connection.js';
import type { LocalResource } from '../connection.js';
import type { GroupsLocalResource, GroupRow } from './groups.js';

let db: LocalResource;
let groups: GroupsLocalResource;

beforeEach(() => {
  db = initTestDatabase();
  groups = db.groups;
});

const row = (overrides?: Partial<GroupRow>): GroupRow => ({
  jid: 'tg:100',
  name: 'Test Group',
  folder: 'telegram_test-group',
  added_at: '2024-01-01T00:00:00.000Z',
  container_config: null,
  is_main: 0,
  session_id: '',
  ...overrides,
});

describe('set and get', () => {
  it('stores and retrieves a group', () => {
    groups.set('tg:100', row());
    const result = groups.get('tg:100');
    expect(result).toBeDefined();
    expect(result!.name).toBe('Test Group');
    expect(result!.folder).toBe('telegram_test-group');
  });

  it('returns undefined for non-existent group', () => {
    expect(groups.get('tg:unknown')).toBeUndefined();
  });

  it('upserts on duplicate jid', () => {
    groups.set('tg:100', row({ name: 'Original' }));
    groups.set('tg:100', row({ name: 'Updated' }));

    const result = groups.get('tg:100');
    expect(result!.name).toBe('Updated');
    expect(groups.getAll()).toHaveLength(1);
  });

  it('stores is_main as 1', () => {
    groups.set('tg:main', row({ jid: 'tg:main', folder: 'telegram_main', is_main: 1 }));
    expect(groups.get('tg:main')!.is_main).toBe(1);
  });

  it('stores is_main as 0', () => {
    groups.set('tg:100', row({ is_main: 0 }));
    expect(groups.get('tg:100')!.is_main).toBe(0);
  });

  it('stores container_config as JSON string', () => {
    const config = JSON.stringify({ additionalMounts: [{ hostPath: '/tmp' }], timeout: 60000 });
    groups.set('tg:100', row({ container_config: config }));
    expect(groups.get('tg:100')!.container_config).toBe(config);
  });

  it('stores null container_config', () => {
    groups.set('tg:100', row({ container_config: null }));
    expect(groups.get('tg:100')!.container_config).toBeNull();
  });
});

describe('getAll', () => {
  it('returns empty array when no groups', () => {
    expect(groups.getAll()).toEqual([]);
  });

  it('returns all groups', () => {
    groups.set('tg:one', row({ jid: 'tg:one', folder: 'telegram_one' }));
    groups.set('tg:two', row({ jid: 'tg:two', folder: 'telegram_two' }));
    expect(groups.getAll()).toHaveLength(2);
  });

  it('returns raw GroupRow fields', () => {
    groups.set('tg:100', row({ is_main: 1, container_config: '{"timeout":5000}' }));
    const result = groups.getAll();
    expect(result[0].is_main).toBe(1);
    expect(result[0].container_config).toBe('{"timeout":5000}');

    expect(result[0].added_at).toBe('2024-01-01T00:00:00.000Z');
  });
});
