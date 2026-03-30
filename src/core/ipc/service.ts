import fs from 'fs';
import path from 'path';

import { GROUPS_DIR } from '../../config.js';
import { resolveGroupFolderPath } from '../../group-folder.js';
import { logger } from '../../logger.js';
import {
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from '../../container-runner.js';
import type { RegisteredGroup, LocalDatabase } from '../db/index.js';
import type { AvailableGroup } from './types.js';

export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  getRegisteredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroups: (force: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
  onTasksChanged: () => void;
}

export class IpcService implements IpcDeps {
  private groups: Record<string, RegisteredGroup> = {};

  constructor(private localDatabase: LocalDatabase) {
    this.groups = localDatabase.groups.getAll();
  }

  // --- Channel-dependent (must be set externally) ---

  sendMessage: (jid: string, text: string) => Promise<void> = () => {
    throw new Error('sendMessage not configured — set via setSendMessage()');
  };

  syncGroups: (force: boolean) => Promise<void> = async () => {
    throw new Error('syncGroups not configured — set via setSyncGroups()');
  };

  setSendMessage(fn: (jid: string, text: string) => Promise<void>): void {
    this.sendMessage = fn;
  }

  setSyncGroups(fn: (force: boolean) => Promise<void>): void {
    this.syncGroups = fn;
  }

  // --- DB-backed ---

  getRegisteredGroups(): Record<string, RegisteredGroup> {
    return this.groups;
  }

  registerGroup(jid: string, group: RegisteredGroup): void {
    let groupDir: string;
    try {
      groupDir = resolveGroupFolderPath(group.folder);
    } catch (err) {
      logger.warn(
        { jid, folder: group.folder, err },
        'Rejecting group registration with invalid folder',
      );
      return;
    }

    this.groups[jid] = group;
    this.localDatabase.groups.set(jid, group);

    fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

    if (!group.isMain) {
      const globalLocalMd = path.join(GROUPS_DIR, 'global', 'CLAUDE.local.md');
      const groupLocalMd = path.join(groupDir, 'CLAUDE.local.md');
      if (fs.existsSync(globalLocalMd)) {
        fs.copyFileSync(globalLocalMd, groupLocalMd);
        logger.info(
          { folder: group.folder },
          'Copied global CLAUDE.local.md to group',
        );
      }
    }

    logger.info(
      { jid, name: group.name, folder: group.folder },
      'Group registered',
    );
  }

  getAvailableGroups(): AvailableGroup[] {
    const chats = this.localDatabase.chats.getAll();
    const registeredJids = new Set(Object.keys(this.groups));

    return chats
      .filter((c) => c.jid !== '__group_sync__' && c.isGroup)
      .map((c) => ({
        jid: c.jid,
        name: c.name,
        lastActivity: c.lastMessageTime,
        isRegistered: registeredJids.has(c.jid),
      }));
  }

  writeGroupsSnapshot(
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ): void {
    writeGroupsSnapshot(groupFolder, isMain, availableGroups, registeredJids);
  }

  onTasksChanged(): void {
    const tasks = this.localDatabase.tasks.getAll();
    const taskRows = tasks.map((t) => ({
      id: t.id,
      groupFolder: t.groupFolder,
      prompt: t.prompt,
      script: t.script || undefined,
      schedule_type: t.scheduleType,
      schedule_value: t.scheduleValue,
      status: t.status,
      next_run: t.nextRun,
    }));
    for (const group of Object.values(this.groups)) {
      writeTasksSnapshot(group.folder, group.isMain === true, taskRows);
    }
  }
}
