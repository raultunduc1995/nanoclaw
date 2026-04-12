import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMessageFlow, MessageFlowDeps } from './message-flow.js';

// --- mocks ---

vi.mock('../../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/index.js', () => ({
  formatMessages: (messages: { content: string }[]) => messages.map((m) => m.content).join('\n'),
}));

// --- fixtures ---

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
  saveRouterState: vi.fn(),
  getRouterState: vi.fn(() => undefined),
  getRegisteredGroups: vi.fn(() => ({})),
  getRegisteredGroupsJids: vi.fn(() => new Set<string>()),
  getMessagesSince: vi.fn(() => []),
  getNewMessagesSince: vi.fn(() => ({ messages: [], newTimestamp: '' })),
  getFormattedMessagesFor: vi.fn(() => 'formatted'),
  deliver: vi.fn(() => true),
  setTypingForChannel: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// --- enqueuePreviousSessionLostMessages ---

describe('enqueuePreviousSessionLostMessages', () => {
  it('does not deliver when no registered groups', () => {
    const deps = makeDeps({ getRegisteredGroups: vi.fn(() => ({})) });
    const flow = createMessageFlow(deps);
    flow.enqueuePreviousSessionLostMessages();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it('does not deliver when no pending messages', () => {
    const deps = makeDeps({
      getRegisteredGroups: vi.fn(() => ({ jid1: makeGroup() })),
      getMessagesSince: vi.fn(() => []),
    });
    const flow = createMessageFlow(deps);
    flow.enqueuePreviousSessionLostMessages();
    expect(deps.deliver).not.toHaveBeenCalled();
  });

  it('delivers for groups that have pending messages', () => {
    const deps = makeDeps({
      getRegisteredGroups: vi.fn(() => ({
        jid1: makeGroup(),
        jid2: makeGroup({ name: 'Other' }),
      })),
      getMessagesSince: vi.fn()
        .mockReturnValueOnce([makeMessage()])  // jid1 has messages
        .mockReturnValueOnce([]),               // jid2 has none
    });
    const flow = createMessageFlow(deps);
    flow.enqueuePreviousSessionLostMessages();
    expect(deps.deliver).toHaveBeenCalledTimes(1);
    expect(deps.deliver).toHaveBeenCalledWith('jid1', 'test-folder', expect.any(String));
  });

  it('uses lastAgentTimestamp from previous router state', () => {
    const deps = makeDeps({
      getRouterState: vi.fn(() => ({
        lastMessageTimestamp: '2026-01-01T00:00:00.000Z',
        lastAgentTimestamp: { jid1: '2026-01-01T00:05:00.000Z' },
      })),
      getRegisteredGroups: vi.fn(() => ({ jid1: makeGroup() })),
      getMessagesSince: vi.fn(() => [makeMessage()]),
    });
    const flow = createMessageFlow(deps);
    flow.enqueuePreviousSessionLostMessages();
    expect(deps.getMessagesSince).toHaveBeenCalledWith('jid1', '2026-01-01T00:05:00.000Z');
  });

  it('passes empty string as since when no previous state', () => {
    const deps = makeDeps({
      getRouterState: vi.fn(() => undefined),
      getRegisteredGroups: vi.fn(() => ({ jid1: makeGroup() })),
      getMessagesSince: vi.fn(() => []),
    });
    const flow = createMessageFlow(deps);
    flow.enqueuePreviousSessionLostMessages();
    expect(deps.getMessagesSince).toHaveBeenCalledWith('jid1', '');
  });
});

// --- startMessagesWatcher ---

describe('startMessagesWatcher', () => {
  it('starts without error', async () => {
    const flow = createMessageFlow(makeDeps());
    await expect(flow.startMessagesWatcher()).resolves.toBeUndefined();
  });

  it('does not start twice', async () => {
    const deps = makeDeps();
    const flow = createMessageFlow(deps);

    await flow.startMessagesWatcher();
    await flow.startMessagesWatcher();

    // getRegisteredGroupsJids is called inside the loop — second start is a no-op
    const callCount = (deps.getRegisteredGroupsJids as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callCount).toBe(1);
  });
});
