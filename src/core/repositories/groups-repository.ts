import path from "path";
import fs from "fs";

import { GROUPS_DIR } from "../utils/config.js";
import { logger } from "../utils/logger.js";

import type { GroupRow, GroupsLocalResource } from "../db/index.js";
import { assertValidGroupFolder, ensureWithinBase } from "../utils/index.js";

// --- Types and interfaces ---

export interface RegisteredGroup {
  jid: string;
  name: string;
  folder: string;
  addedAt: string;
}

// --- Repository interface and implementation ---

export interface GroupsRepository {
  getAllAsRecord: () => Record<string, RegisteredGroup>;
  getAllJids: () => Set<string>;
  getByJid: (jid: string) => RegisteredGroup | undefined;
  register: (jid: string, group: Omit<RegisteredGroup, "jid">) => void;
}

export const createGroupsRepository = (resource: GroupsLocalResource): GroupsRepository => {
  const groupRows = resource.getAll();
  const registeredGroups: Record<string, RegisteredGroup> = Object.fromEntries(groupRows.map((row) => [row.jid, toRegisteredGroup(row)]));

  const saveGroup = (jid: string, registeredGroup: RegisteredGroup) => {
    assertValidGroupFolder(registeredGroup.folder);
    resource.set(jid, toGroupRow(jid, registeredGroup));
    registeredGroups[jid] = registeredGroup;
  };

  return {
    getAllAsRecord: () => registeredGroups,

    getAllJids: () => new Set(Object.keys(registeredGroups)),

    getByJid: (jid) => registeredGroups[jid],

    register: (jid, group) => {
      logger.debug({ jid, name: group.name, folder: group.folder }, "Register group...");
      const groupDir = resolveGroupFolderPath(group.folder);
      saveGroup(jid, { ...group, jid });
      createGroupDirectory(groupDir);
    },
  };
};

// --- Conversion functions between GroupRow and RegisteredGroup ---

const toRegisteredGroup = (row: GroupRow): RegisteredGroup => ({
  jid: row.jid,
  name: row.name,
  folder: row.folder,
  addedAt: row.added_at,
});

const toGroupRow = (jid: string, group: RegisteredGroup): GroupRow => ({
  jid,
  name: group.name,
  folder: group.folder,
  added_at: group.addedAt,
});

// --- Utility functions for group directory management ---

function resolveGroupFolderPath(folder: string): string {
  assertValidGroupFolder(folder);

  const groupPath = path.resolve(GROUPS_DIR, folder);
  ensureWithinBase(GROUPS_DIR, groupPath);

  return groupPath;
}

function createGroupDirectory(groupDir: string): void {
  fs.mkdirSync(path.join(groupDir, "memories"), { recursive: true });
}
