import fs from 'fs';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';

import { DATA_DIR, IPC_POLL_INTERVAL, TIMEZONE } from '../../config.js';
import { isValidGroupFolder } from '../../group-folder.js';
import { logger } from '../../logger.js';
import type { IpcTaskData } from './types.js';
import type { IpcDeps } from './service.js';
import type { LocalDatabase, RegisteredGroup } from '../db/index.js';


export class IpcHandler {
  private running = false;
  private readonly ipcBaseDir: string;

  constructor(
    private localDatabase: LocalDatabase,
    private deps: IpcDeps,
  ) {
    this.ipcBaseDir = path.join(DATA_DIR, 'ipc');
  }

  start(): void {
    if (this.running) {
      logger.debug('IPC watcher already running, skipping duplicate start');
      return;
    }
    this.running = true;
    fs.mkdirSync(this.ipcBaseDir, { recursive: true });
    this.poll();
    logger.info('IPC watcher started (per-group namespaces)');
  }

  private poll(): void {
    this.processIpcFiles().then(() => {
      setTimeout(() => this.poll(), IPC_POLL_INTERVAL);
    });
  }

  private async processIpcFiles(): Promise<void> {
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(this.ipcBaseDir).filter((f) => {
        const stat = fs.statSync(path.join(this.ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      return;
    }

    const registeredGroups = this.deps.getRegisteredGroups();

    const folderIsMain = new Map<string, boolean>();
    for (const group of Object.values(registeredGroups)) {
      if (group.isMain) folderIsMain.set(group.folder, true);
    }

    for (const sourceGroup of groupFolders) {
      const isMain = folderIsMain.get(sourceGroup) === true;
      await this.processMessages(sourceGroup, isMain, registeredGroups);
      await this.processTasks(sourceGroup, isMain);
    }
  }

  private async processMessages(
    sourceGroup: string,
    isMain: boolean,
    registeredGroups: ReturnType<IpcDeps['getRegisteredGroups']>,
  ): Promise<void> {
    const messagesDir = path.join(this.ipcBaseDir, sourceGroup, 'messages');
    try {
      if (!fs.existsSync(messagesDir)) return;

      const messageFiles = fs
        .readdirSync(messagesDir)
        .filter((f) => f.endsWith('.json'));

      for (const file of messageFiles) {
        const filePath = path.join(messagesDir, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (data.type === 'message' && data.chatJid && data.text) {
            const targetGroup = registeredGroups[data.chatJid];
            if (
              isMain ||
              (targetGroup && targetGroup.folder === sourceGroup)
            ) {
              await this.deps.sendMessage(data.chatJid, data.text);
              logger.info(
                { chatJid: data.chatJid, sourceGroup },
                'IPC message sent',
              );
            } else {
              logger.warn(
                { chatJid: data.chatJid, sourceGroup },
                'Unauthorized IPC message attempt blocked',
              );
            }
          }
          fs.unlinkSync(filePath);
        } catch (err) {
          logger.error(
            { file, sourceGroup, err },
            'Error processing IPC message',
          );
          this.moveToErrors(filePath, sourceGroup, file);
        }
      }
    } catch (err) {
      logger.error(
        { err, sourceGroup },
        'Error reading IPC messages directory',
      );
    }
  }

  private async processTasks(
    sourceGroup: string,
    isMain: boolean,
  ): Promise<void> {
    const tasksDir = path.join(this.ipcBaseDir, sourceGroup, 'tasks');
    try {
      if (!fs.existsSync(tasksDir)) return;

      const taskFiles = fs
        .readdirSync(tasksDir)
        .filter((f) => f.endsWith('.json'));

      for (const file of taskFiles) {
        const filePath = path.join(tasksDir, file);
        try {
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          await this.processTaskCommand(data, sourceGroup, isMain);
          fs.unlinkSync(filePath);
        } catch (err) {
          logger.error(
            { file, sourceGroup, err },
            'Error processing IPC task',
          );
          this.moveToErrors(filePath, sourceGroup, file);
        }
      }
    } catch (err) {
      logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
    }
  }

  async processTaskCommand(
    data: IpcTaskData,
    sourceGroup: string,
    isMain: boolean,
  ): Promise<void> {
    const registeredGroups = this.deps.getRegisteredGroups();

    switch (data.type) {
      case 'schedule_task':
        this.handleScheduleTask(data, sourceGroup, isMain, registeredGroups);
        break;

      case 'pause_task':
        this.handleTaskStatusChange(data, sourceGroup, isMain, 'paused', 'paused');
        break;

      case 'resume_task':
        this.handleTaskStatusChange(data, sourceGroup, isMain, 'active', 'resumed');
        break;

      case 'cancel_task':
        this.handleCancelTask(data, isMain, sourceGroup);
        break;

      case 'update_task':
        this.handleUpdateTask(data, sourceGroup, isMain);
        break;

      case 'refresh_groups':
        if (isMain) {
          await this.handleRefreshGroupsAsync(sourceGroup, registeredGroups);
        } else {
          logger.warn(
            { sourceGroup },
            'Unauthorized refresh_groups attempt blocked',
          );
        }
        break;

      case 'register_group':
        if (isMain) {
          this.handleRegisterGroup(data, sourceGroup);
      } else {
          logger.warn(
            { sourceGroup },
            'Unauthorized register_group attempt blocked',
          );
        }
        break;

      default:
        logger.warn({ type: data.type }, 'Unknown IPC task type');
    }
  }

  private handleScheduleTask(
    data: IpcTaskData,
    sourceGroup: string,
    isMain: boolean,
    registeredGroups: ReturnType<IpcDeps['getRegisteredGroups']>,
  ): void {
    if (!data.prompt || !data.schedule_type || !data.schedule_value || !data.targetJid) return;

    const targetJid = data.targetJid;
    const targetGroupEntry = registeredGroups[targetJid];

    if (!targetGroupEntry) {
      logger.warn({ targetJid }, 'Cannot schedule task: target group not registered');
      return;
    }

    const targetFolder = targetGroupEntry.folder;

    if (!isMain && targetFolder !== sourceGroup) {
      logger.warn(
        { sourceGroup, targetFolder },
        'Unauthorized schedule_task attempt blocked',
      );
      return;
    }

    const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';
    const nextRun = this.computeNextRun(scheduleType, data.schedule_value);
    if (nextRun === undefined) return;

    const taskId =
      data.taskId ||
      `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const contextMode =
      data.context_mode === 'group' || data.context_mode === 'isolated'
        ? data.context_mode
        : 'isolated';

    this.localDatabase.tasks.create({
      id: taskId,
      groupFolder: targetFolder,
      chatJid: targetJid,
      prompt: data.prompt,
      script: data.script || null,
      scheduleType: scheduleType,
      scheduleValue: data.schedule_value,
      contextMode: contextMode,
      nextRun: nextRun,
      status: 'active',
      createdAt: new Date().toISOString(),
    });

    logger.info(
      { taskId, sourceGroup, targetFolder, contextMode },
      'Task created via IPC',
    );
    this.deps.onTasksChanged();
  }

  private handleTaskStatusChange(
    data: IpcTaskData,
    sourceGroup: string,
    isMain: boolean,
    newStatus: 'active' | 'paused',
    action: string,
  ): void {
    if (!data.taskId) return;

    const task = this.localDatabase.tasks.getById(data.taskId);
    if (task && (isMain || task.groupFolder === sourceGroup)) {
      this.localDatabase.tasks.update(data.taskId, { status: newStatus });
      logger.info(
        { taskId: data.taskId, sourceGroup },
        `Task ${action} via IPC`,
      );
      this.deps.onTasksChanged();
    } else {
      logger.warn(
        { taskId: data.taskId, sourceGroup },
        `Unauthorized task ${action} attempt`,
      );
    }
  }

  private handleCancelTask(data: IpcTaskData, isMain: boolean, sourceGroup: string) {    
    if (!data.taskId) return;

    const task = this.localDatabase.tasks.getById(data.taskId);
    if (task && (isMain || task.groupFolder === sourceGroup)) {
      this.localDatabase.tasks.delete(data.taskId);
      logger.info(
        { taskId: data.taskId, sourceGroup },
        'Task cancelled via IPC'
      );
      this.deps.onTasksChanged();
    } else {
      logger.warn(
        { taskId: data.taskId, sourceGroup },
        'Unauthorized task cancel attempt'
      );
    }
  }

  private handleUpdateTask(data: IpcTaskData, sourceGroup: string, isMain: boolean): void {
    if (!data.taskId) return;

    const task = this.localDatabase.tasks.getById(data.taskId);
    if (!task) {
      logger.warn(
        { taskId: data.taskId, sourceGroup },
        'Task not found for update',
      );
      return;
    }
    if (!isMain && task.groupFolder !== sourceGroup) {
      logger.warn(
        { taskId: data.taskId, sourceGroup },
        'Unauthorized task update attempt',
      );
      return;
    }

    const updates: Parameters<typeof this.localDatabase.tasks.update>[1] = {};
    if (data.prompt !== undefined) updates.prompt = data.prompt;
    if (data.script !== undefined) updates.script = data.script || null;
    if (data.schedule_type !== undefined)
      updates.scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';
    if (data.schedule_value !== undefined)
      updates.scheduleValue = data.schedule_value;

    if (data.schedule_type || data.schedule_value) {
      const updatedTask = { ...task, ...updates };
      const nextRun = this.computeNextRun(
        updatedTask.scheduleType as 'cron' | 'interval' | 'once',
        updatedTask.scheduleValue,
      );
      if (nextRun === undefined) return;
      updates.nextRun = nextRun;
    }

    this.localDatabase.tasks.update(data.taskId, updates);
    logger.info(
      { taskId: data.taskId, sourceGroup, updates },
      'Task updated via IPC',
    );
    this.deps.onTasksChanged();
  }

  private async handleRefreshGroupsAsync(sourceGroup: string, registeredGroups: Record<string, RegisteredGroup>) {
    logger.info(
      { sourceGroup },
      'Group metadata refresh requested via IPC'
    );
    await this.deps.syncGroups(true);
    const availableGroups = this.deps.getAvailableGroups();
    this.deps.writeGroupsSnapshot(
      sourceGroup,
      true,
      availableGroups,
      new Set(Object.keys(registeredGroups))
    );
  }

  private handleRegisterGroup(data: IpcTaskData, sourceGroup: string) {
    if (!data.jid || !data.name || !data.folder) {
      logger.warn(
        { data },
        'Invalid register_group request - missing required fields',
      );
      return;
    }

    if (!isValidGroupFolder(data.folder)) {
      logger.warn(
        { sourceGroup, folder: data.folder },
        'Invalid register_group request - unsafe folder name',
      );
      return;
    }
    this.deps.registerGroup(data.jid, {
      name: data.name,
      folder: data.folder,
      addedAt: new Date().toISOString(),
      containerConfig: data.containerConfig,
      isMain: false,
    });
  }

  private computeNextRun(
    scheduleType: 'cron' | 'interval' | 'once',
    scheduleValue: string,
  ): string | null | undefined {
    if (scheduleType === 'cron') {
      try {
        const interval = CronExpressionParser.parse(scheduleValue, {
          tz: TIMEZONE,
        });
        return interval.next().toISOString();
      } catch {
        logger.warn({ scheduleValue }, 'Invalid cron expression');
        return undefined;
      }
    } else if (scheduleType === 'interval') {
      const ms = parseInt(scheduleValue, 10);
      if (isNaN(ms) || ms <= 0) {
        logger.warn({ scheduleValue }, 'Invalid interval');
        return undefined;
      }
      return new Date(Date.now() + ms).toISOString();
    } else if (scheduleType === 'once') {
      const date = new Date(scheduleValue);
      if (isNaN(date.getTime())) {
        logger.warn({ scheduleValue }, 'Invalid timestamp');
        return undefined;
      }
      return date.toISOString();
    }
    return null;
  }

  private moveToErrors(filePath: string, sourceGroup: string, file: string): void {
    const errorDir = path.join(this.ipcBaseDir, 'errors');
    fs.mkdirSync(errorDir, { recursive: true });
    fs.renameSync(filePath, path.join(errorDir, `${sourceGroup}-${file}`));
  }
}
