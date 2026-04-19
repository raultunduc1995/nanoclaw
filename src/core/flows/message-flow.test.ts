import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMessageFlow, MessageFlowDeps } from './message-flow.js';

vi.mock('../../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/index.js', () => ({
  formatMessages: (messages: { content: string }[]) => messages.map((m) => m.content).join('\n'),
}));

const makeGroup = (overrides = {}) => ({
  name: 'TestGroup',
  folder: 'test-folder',
  addedAt: '2026-01-01T00:00:00.000Z',
  isMain: false,
  ...overrides,
});

const makeMessage = (overrides = {}) => ({
  id: 'msg1',
  chatJid: 'jid1',
  content: 'hello',
  timestamp: '2026-01-01T00:01:00.000Z',
  sender: 'sender1',
  senderName: 'Sender One',
  ...overrides,
});

const makeDeps = (overrides: Partial<MessageFlowDeps> = {}): MessageFlowDeps => ({
  getLastAgentTimestamps: vi.fn(() => ({})),
  getRegisteredGroups: vi.fn(() => ({})),
  getMessagesSince: vi.fn(() => []),
  deliver: vi.fn(() => true),
  saveLastAgentTimestamp: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('enqueuePreviousSessionLostMessages', () => {
  it('does not deliver when no registered groups', () => {
    const deps = makeDeps({ getRegisteredGroups: vi.fn(() => ({})) });
    createMessageFlow(deps).enqueuePreviousSessionLostMessages();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it('does not deliver when no pending messages', () => {
    const deps = makeDeps({
      getRegisteredGroups: vi.fn(() => ({ jid1: makeGroup() })),
      getMessagesSince: vi.fn(() => []),
    });
    createMessageFlow(deps).enqueuePreviousSessionLostMessages();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it('delivers for groups that have pending messages', () => {
    const deps = makeDeps({
      getRegisteredGroups: vi.fn(() => ({
        jid1: makeGroup(),
        jid2: makeGroup({ name: 'Other' }),
      })),
      getMessagesSince: vi.fn()
        .mockReturnValueOnce([makeMessage()])
        .mockReturnValueOnce([]),
    });
    createMessageFlow(deps).enqueuePreviousSessionLostMessages();
    expect(deps.deliver).toHaveBeenCalledTimes(1);
    expect(deps.deliver).toHaveBeenCalledWith('jid1', 'test-folder', expect.any(String));
  });

  it('uses lastAgentTimestamp from previous state', () => {
    const deps = makeDeps({
      getLastAgentTimestamps: vi.fn(() => ({ jid1: '2026-01-01T00:05:00.000Z' })),
      getRegisteredGroups: vi.fn(() => ({ jid1: makeGroup() })),
      getMessagesSince: vi.fn(() => [makeMessage()]),
    });
    createMessageFlow(deps).enqueuePreviousSessionLostMessages();
    expect(deps.getMessagesSince).toHaveBeenCalledWith('jid1', '2026-01-01T00:05:00.000Z');
  });

  it('passes empty string as since when no previous state', () => {
    const deps = makeDeps({
      getLastAgentTimestamps: vi.fn(() => ({})),
      getRegisteredGroups: vi.fn(() => ({ jid1: makeGroup() })),
      getMessagesSince: vi.fn(() => []),
    });
    createMessageFlow(deps).enqueuePreviousSessionLostMessages();
    expect(deps.getMessagesSince).toHaveBeenCalledWith('jid1', '');
  });

  it('saves last agent timestamp after delivery', () => {
    const deps = makeDeps({
      getLastAgentTimestamps: vi.fn(() => ({ jid2: 'ts-other' })),
      getRegisteredGroups: vi.fn(() => ({ jid1: makeGroup() })),
      getMessagesSince: vi.fn(() => [makeMessage({ timestamp: '2026-01-01T00:10:00.000Z' })]),
    });
    createMessageFlow(deps).enqueuePreviousSessionLostMessages();
    expect(deps.saveLastAgentTimestamp).toHaveBeenCalledWith({
      jid2: 'ts-other',
      jid1: '2026-01-01T00:10:00.000Z',
    });
  });
});
