import { describe, it, expect, beforeEach, vi } from 'vitest';

import { initTestDatabase } from '../db/connection.js';
import type { LocalResource } from '../db/connection.js';
import { createIpcHandler } from './ipc-handler.js';
import type { IpcHandler } from './ipc-handler.js';
import { createGroupsRepository, GroupsRepository } from '../repositories/groups-repository.js';
import { createChatsRepository, ChatsRepository } from '../repositories/chats-repository.js';
import { createTasksRepository, TasksRepository } from '../repositories/tasks-repository.js';

vi.mock('../../logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../config.js', () => ({
  DATA_DIR: '/tmp/test-data',
  GROUPS_DIR: '/tmp/test-groups',
  IPC_POLL_INTERVAL: 1000,
  TIMEZONE: 'UTC',
}));

vi.mock('../../container-runner.js', () => ({
  writeGroupsSnapshot: vi.fn(),
  writeTasksSnapshot: vi.fn(),
}));

vi.mock('../../channels/registry.js', () => ({
  sendMessageToChatChannel: vi.fn().mockResolvedValue(undefined),
  syncGroupsOnAllSyncableChannels: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return { ...actual, default: { ...actual, mkdirSync: vi.fn(), existsSync: vi.fn(() => false), copyFileSync: vi.fn() } };
});

let db: LocalResource;
let groupsRepo: GroupsRepository;
let chatsRepo: ChatsRepository;
let tasksRepo: TasksRepository;
let handler: IpcHandler;

const MAIN = { groupFolder: 'telegram_main', isMain: true };
const OTHER = { groupFolder: 'other-group', isMain: false };
const THIRD = { groupFolder: 'third-group', isMain: false };

beforeEach(() => {
  vi.clearAllMocks();
  db = initTestDatabase();
  groupsRepo = createGroupsRepository(db.groups);
  chatsRepo = createChatsRepository(db.chats, groupsRepo);
  tasksRepo = createTasksRepository(db.tasks, groupsRepo);
  handler = createIpcHandler(groupsRepo, chatsRepo, tasksRepo);

  groupsRepo.registerGroup('tg:main', { name: 'Main', folder: 'telegram_main', addedAt: '2024-01-01T00:00:00.000Z', isMain: true });
  groupsRepo.registerGroup('tg:other', { name: 'Other', folder: 'other-group', addedAt: '2024-01-01T00:00:00.000Z', isMain: false });
  groupsRepo.registerGroup('tg:third', { name: 'Third', folder: 'third-group', addedAt: '2024-01-01T00:00:00.000Z', isMain: false });
});

const seedTask = (id: string, groupFolder: string, chatJid: string, opts?: { status?: string }) => {
  tasksRepo.saveTask({
    id,
    groupFolder,
    chatJid,
    prompt: 'test task',
    scheduleType: 'once',
    scheduleValue: '2025-06-01T00:00:00',
    contextMode: 'isolated',
    nextRun: '2025-06-01T00:00:00.000Z',
  });
  if (opts?.status === 'paused') {
    const task = tasksRepo.getTaskById(id)!;
    tasksRepo.updateTask({ ...task, status: 'paused' });
  }
};

// --- schedule_task authorization ---

describe('schedule_task authorization', () => {
  it('main group can schedule for another group', async () => {
    await handler.processTaskCommand({ type: 'schedule_task', prompt: 'do something', schedule_type: 'once', schedule_value: '2025-06-01T00:00:00', targetJid: 'tg:other' }, MAIN);
    const tasks = tasksRepo.getAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].groupFolder).toBe('other-group');
  });

  it('non-main group can schedule for itself', async () => {
    await handler.processTaskCommand({ type: 'schedule_task', prompt: 'self task', schedule_type: 'once', schedule_value: '2025-06-01T00:00:00', targetJid: 'tg:other' }, OTHER);
    const tasks = tasksRepo.getAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].groupFolder).toBe('other-group');
  });

  it('non-main group cannot schedule for another group', async () => {
    await handler.processTaskCommand({ type: 'schedule_task', prompt: 'unauthorized', schedule_type: 'once', schedule_value: '2025-06-01T00:00:00', targetJid: 'tg:main' }, OTHER);
    expect(tasksRepo.getAllTasks()).toHaveLength(0);
  });

  it('rejects schedule_task for unregistered target JID', async () => {
    await handler.processTaskCommand({ type: 'schedule_task', prompt: 'no target', schedule_type: 'once', schedule_value: '2025-06-01T00:00:00', targetJid: 'tg:unknown' }, MAIN);
    expect(tasksRepo.getAllTasks()).toHaveLength(0);
  });
});

// --- pause_task authorization ---

describe('pause_task authorization', () => {
  beforeEach(() => {
    seedTask('task-main', 'telegram_main', 'tg:main');
    seedTask('task-other', 'other-group', 'tg:other');
  });

  it('main group can pause any task', async () => {
    await handler.processTaskCommand({ type: 'pause_task', taskId: 'task-other' }, MAIN);
    expect(tasksRepo.getTaskById('task-other')!.status).toBe('paused');
  });

  it('non-main group can pause its own task', async () => {
    await handler.processTaskCommand({ type: 'pause_task', taskId: 'task-other' }, OTHER);
    expect(tasksRepo.getTaskById('task-other')!.status).toBe('paused');
  });

  it('non-main group cannot pause another groups task', async () => {
    await handler.processTaskCommand({ type: 'pause_task', taskId: 'task-main' }, OTHER);
    expect(tasksRepo.getTaskById('task-main')!.status).toBe('active');
  });
});

// --- resume_task authorization ---

describe('resume_task authorization', () => {
  beforeEach(() => {
    seedTask('task-paused', 'other-group', 'tg:other', { status: 'paused' });
  });

  it('main group can resume any task', async () => {
    await handler.processTaskCommand({ type: 'resume_task', taskId: 'task-paused' }, MAIN);
    expect(tasksRepo.getTaskById('task-paused')!.status).toBe('active');
  });

  it('non-main group can resume its own task', async () => {
    await handler.processTaskCommand({ type: 'resume_task', taskId: 'task-paused' }, OTHER);
    expect(tasksRepo.getTaskById('task-paused')!.status).toBe('active');
  });

  it('non-main group cannot resume another groups task', async () => {
    await handler.processTaskCommand({ type: 'resume_task', taskId: 'task-paused' }, THIRD);
    expect(tasksRepo.getTaskById('task-paused')!.status).toBe('paused');
  });
});

// --- cancel_task authorization ---

describe('cancel_task authorization', () => {
  it('main group can cancel any task', async () => {
    seedTask('task-to-cancel', 'other-group', 'tg:other');
    await handler.processTaskCommand({ type: 'cancel_task', taskId: 'task-to-cancel' }, MAIN);
    expect(tasksRepo.getTaskById('task-to-cancel')).toBeUndefined();
  });

  it('non-main group can cancel its own task', async () => {
    seedTask('task-own', 'other-group', 'tg:other');
    await handler.processTaskCommand({ type: 'cancel_task', taskId: 'task-own' }, OTHER);
    expect(tasksRepo.getTaskById('task-own')).toBeUndefined();
  });

  it('non-main group cannot cancel another groups task', async () => {
    seedTask('task-foreign', 'telegram_main', 'tg:main');
    await handler.processTaskCommand({ type: 'cancel_task', taskId: 'task-foreign' }, OTHER);
    expect(tasksRepo.getTaskById('task-foreign')).toBeDefined();
  });
});

// --- update_task authorization ---

describe('update_task authorization', () => {
  it('main group can update any task', async () => {
    seedTask('task-to-update', 'other-group', 'tg:other');
    await handler.processTaskCommand({ type: 'update_task', taskId: 'task-to-update', prompt: 'updated' }, MAIN);
    expect(tasksRepo.getTaskById('task-to-update')!.prompt).toBe('updated');
  });

  it('non-main group can update its own task', async () => {
    seedTask('task-own', 'other-group', 'tg:other');
    await handler.processTaskCommand({ type: 'update_task', taskId: 'task-own', prompt: 'my update' }, OTHER);
    expect(tasksRepo.getTaskById('task-own')!.prompt).toBe('my update');
  });

  it('non-main group cannot update another groups task', async () => {
    seedTask('task-foreign', 'telegram_main', 'tg:main');
    await handler.processTaskCommand({ type: 'update_task', taskId: 'task-foreign', prompt: 'nope' }, OTHER);
    expect(tasksRepo.getTaskById('task-foreign')!.prompt).toBe('test task');
  });
});

// --- register_group authorization ---

describe('register_group authorization', () => {
  it('non-main group cannot register a group', async () => {
    await handler.processTaskCommand({ type: 'register_group', jid: 'tg:new', name: 'New Group', folder: 'telegram_new-group' }, OTHER);
    expect(groupsRepo.getBy('tg:new')).toBeUndefined();
  });

  it('main group can register a new group', async () => {
    await handler.processTaskCommand({ type: 'register_group', jid: 'tg:new', name: 'New Group', folder: 'telegram_new-group' }, MAIN);
    expect(groupsRepo.getBy('tg:new')).toBeDefined();
    expect(groupsRepo.getBy('tg:new')!.name).toBe('New Group');
    expect(groupsRepo.getBy('tg:new')!.isMain).toBe(false);
  });

  it('main group cannot register with unsafe folder path', async () => {
    await expect(handler.processTaskCommand({ type: 'register_group', jid: 'tg:bad', name: 'Bad', folder: '../../outside' }, MAIN)).rejects.toThrow();
    expect(groupsRepo.getBy('tg:bad')).toBeUndefined();
  });
});

// --- refresh_groups authorization ---

describe('refresh_groups authorization', () => {
  it('non-main group cannot trigger refresh', async () => {
    const { syncGroupsOnAllSyncableChannels } = await import('../../channels/registry.js');
    await handler.processTaskCommand({ type: 'refresh_groups' }, OTHER);
    expect(syncGroupsOnAllSyncableChannels).not.toHaveBeenCalled();
  });

  it('main group can trigger refresh', async () => {
    const { syncGroupsOnAllSyncableChannels } = await import('../../channels/registry.js');
    await handler.processTaskCommand({ type: 'refresh_groups' }, MAIN);
    expect(syncGroupsOnAllSyncableChannels).toHaveBeenCalled();
  });
});

// --- schedule_task schedule types ---

describe('schedule_task schedule types', () => {
  it('creates task with cron schedule and computes nextRun', async () => {
    await handler.processTaskCommand({ type: 'schedule_task', prompt: 'cron task', schedule_type: 'cron', schedule_value: '0 9 * * *', targetJid: 'tg:other' }, MAIN);
    const tasks = tasksRepo.getAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].scheduleType).toBe('cron');
    expect(tasks[0].nextRun).toBeTruthy();
  });

  it('rejects invalid cron expression', async () => {
    await expect(handler.processTaskCommand({ type: 'schedule_task', prompt: 'bad cron', schedule_type: 'cron', schedule_value: 'not a cron', targetJid: 'tg:other' }, MAIN)).rejects.toThrow();
    expect(tasksRepo.getAllTasks()).toHaveLength(0);
  });

  it('creates task with interval schedule', async () => {
    await handler.processTaskCommand({ type: 'schedule_task', prompt: 'interval task', schedule_type: 'interval', schedule_value: '60000', targetJid: 'tg:other' }, MAIN);
    const tasks = tasksRepo.getAllTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].scheduleType).toBe('interval');
    expect(tasks[0].nextRun).toBeTruthy();
  });

  it('rejects invalid interval', async () => {
    await expect(handler.processTaskCommand({ type: 'schedule_task', prompt: 'bad interval', schedule_type: 'interval', schedule_value: '-100', targetJid: 'tg:other' }, MAIN)).rejects.toThrow();
    expect(tasksRepo.getAllTasks()).toHaveLength(0);
  });

  it('rejects invalid once timestamp', async () => {
    await expect(handler.processTaskCommand({ type: 'schedule_task', prompt: 'bad once', schedule_type: 'once', schedule_value: 'not-a-date', targetJid: 'tg:other' }, MAIN)).rejects.toThrow();
    expect(tasksRepo.getAllTasks()).toHaveLength(0);
  });
});

// --- processMessage authorization ---

describe('processMessage authorization', () => {
  it('main group can send to any registered chat', async () => {
    const { sendMessageToChatChannel } = await import('../../channels/registry.js');
    await handler.processMessage({ type: 'message', chatJid: 'tg:other', text: 'hello' }, MAIN);
    expect(sendMessageToChatChannel).toHaveBeenCalledWith('tg:other', 'hello');
  });

  it('non-main group can send to its own chat', async () => {
    const { sendMessageToChatChannel } = await import('../../channels/registry.js');
    await handler.processMessage({ type: 'message', chatJid: 'tg:other', text: 'hello' }, OTHER);
    expect(sendMessageToChatChannel).toHaveBeenCalledWith('tg:other', 'hello');
  });

  it('non-main group cannot send to another groups chat', async () => {
    const { sendMessageToChatChannel } = await import('../../channels/registry.js');
    await handler.processMessage({ type: 'message', chatJid: 'tg:main', text: 'sneaky' }, OTHER);
    expect(sendMessageToChatChannel).not.toHaveBeenCalled();
  });

  it('non-main group cannot send to unregistered JID', async () => {
    const { sendMessageToChatChannel } = await import('../../channels/registry.js');
    await handler.processMessage({ type: 'message', chatJid: 'tg:unknown', text: 'hello' }, OTHER);
    expect(sendMessageToChatChannel).not.toHaveBeenCalled();
  });

  it('main group can send to unregistered JID', async () => {
    const { sendMessageToChatChannel } = await import('../../channels/registry.js');
    await handler.processMessage({ type: 'message', chatJid: 'tg:unknown', text: 'broadcast' }, MAIN);
    expect(sendMessageToChatChannel).toHaveBeenCalledWith('tg:unknown', 'broadcast');
  });
});
