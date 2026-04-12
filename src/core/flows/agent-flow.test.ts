import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createAgentFlow } from './agent-flow.js';

// --- mocks ---

const { mockMkdirSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
  },
}));

vi.mock('path', () => ({
  default: {
    join: (...parts: string[]) => parts.join('/'),
  },
}));

const FAKE_IPC_DIR = '/data/ipc/group-abc';

vi.mock('../utils/index.js', () => ({
  resolveGroupIpcPath: vi.fn(() => FAKE_IPC_DIR),
}));

import { resolveGroupIpcPath } from '../utils/index.js';

// --- fixtures ---

const groups = [
  { jid: 'jid1', name: 'Alpha', lastActivity: '2026-01-01T00:00:00.000Z', isRegistered: true },
  { jid: 'jid2', name: 'Beta', lastActivity: '2026-01-02T00:00:00.000Z', isRegistered: false },
];

// --- tests ---

beforeEach(() => {
  vi.clearAllMocks();
});

describe('writeAvailableGroupsIn', () => {
  it('calls resolveGroupIpcPath with the supplied groupFolder', () => {
    const flow = createAgentFlow();
    flow.writeAvailableGroupsIn('group-abc', groups, true);
    expect(resolveGroupIpcPath).toHaveBeenCalledWith('group-abc');
  });

  it('creates the ipc directory recursively', () => {
    const flow = createAgentFlow();
    flow.writeAvailableGroupsIn('group-abc', groups, true);
    expect(mockMkdirSync).toHaveBeenCalledWith(FAKE_IPC_DIR, { recursive: true });
  });

  it('writes to available_groups.json inside the ipc dir', () => {
    const flow = createAgentFlow();
    flow.writeAvailableGroupsIn('group-abc', groups, true);
    const [filePath] = mockWriteFileSync.mock.calls[0];
    expect(filePath).toBe(`${FAKE_IPC_DIR}/available_groups.json`);
  });

  describe('main group (isMain = true)', () => {
    it('includes all groups in the written file', () => {
      const flow = createAgentFlow();
      flow.writeAvailableGroupsIn('group-abc', groups, true);

      const [, content] = mockWriteFileSync.mock.calls[0];
      const parsed = JSON.parse(content as string);
      expect(parsed.groups).toEqual(groups);
    });

    it('writes a valid ISO lastSync timestamp', () => {
      const before = new Date().toISOString();
      const flow = createAgentFlow();
      flow.writeAvailableGroupsIn('group-abc', groups, true);
      const after = new Date().toISOString();

      const [, content] = mockWriteFileSync.mock.calls[0];
      const parsed = JSON.parse(content as string);
      expect(parsed.lastSync >= before).toBe(true);
      expect(parsed.lastSync <= after).toBe(true);
    });

    it('formats the JSON with 2-space indentation', () => {
      const flow = createAgentFlow();
      flow.writeAvailableGroupsIn('group-abc', groups, true);

      const [, content] = mockWriteFileSync.mock.calls[0];
      expect(content).toBe(JSON.stringify(JSON.parse(content as string), null, 2));
    });
  });

  describe('non-main group (isMain = false)', () => {
    it('writes an empty groups array', () => {
      const flow = createAgentFlow();
      flow.writeAvailableGroupsIn('group-abc', groups, false);

      const [, content] = mockWriteFileSync.mock.calls[0];
      const parsed = JSON.parse(content as string);
      expect(parsed.groups).toEqual([]);
    });

    it('still creates the directory', () => {
      const flow = createAgentFlow();
      flow.writeAvailableGroupsIn('group-abc', groups, false);
      expect(mockMkdirSync).toHaveBeenCalledWith(FAKE_IPC_DIR, { recursive: true });
    });

    it('still writes the file', () => {
      const flow = createAgentFlow();
      flow.writeAvailableGroupsIn('group-abc', groups, false);
      expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    });
  });

  it('written JSON has exactly groups and lastSync keys at the top level', () => {
    const flow = createAgentFlow();
    flow.writeAvailableGroupsIn('group-abc', groups, true);

    const [, content] = mockWriteFileSync.mock.calls[0];
    const parsed = JSON.parse(content as string);
    expect(Object.keys(parsed).sort()).toEqual(['groups', 'lastSync']);
  });
});
