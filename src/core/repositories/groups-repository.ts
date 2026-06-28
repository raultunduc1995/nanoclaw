import path from "path";
import fs from "fs";

import { GROUPS_DIR } from "../utils/config.js";
import { logger } from "../utils/logger.js";

import type { GroupRow, GroupsLocalResource } from "../db/index.js";
import { assertValidGroupFolder, ensureWithinBase } from "../utils/index.js";

export interface RegisteredGroup {
  jid: string;
  name: string;
  folder: string;
  addedAt: string;
}

export interface GroupsRepository {
  getAllAsRecord: () => Record<string, RegisteredGroup>;
  getAllJids: () => Set<string>;
  getByJid: (jid: string) => RegisteredGroup | undefined;
  register: (jid: string, group: Omit<RegisteredGroup, "jid">) => Promise<void>;
}

export const createGroupsRepository = async (resource: GroupsLocalResource): Promise<GroupsRepository> => {
  const groupRows = await resource.getAll();
  const registeredGroups: Record<string, RegisteredGroup> = Object.fromEntries(groupRows.map((row) => [row.jid, toRegisteredGroup(row)]));

  const saveGroup = async (jid: string, registeredGroup: RegisteredGroup) => {
    assertValidGroupFolder(registeredGroup.folder);
    await resource.set(jid, toGroupRow(jid, registeredGroup));
    registeredGroups[jid] = registeredGroup;
  };

  return {
    getAllAsRecord: () => registeredGroups,
    getAllJids: () => new Set(Object.keys(registeredGroups)),
    getByJid: (jid) => registeredGroups[jid],
    register: async (jid, group) => {
      logger.debug({ jid, name: group.name, folder: group.folder }, "Register group...");
      const groupDir = resolveGroupFolderPath(group.folder);
      await saveGroup(jid, { ...group, jid });
      createGroupDirectory(groupDir);
    },
  };
};

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

function resolveGroupFolderPath(folder: string): string {
  assertValidGroupFolder(folder);
  const groupPath = path.resolve(GROUPS_DIR, folder);
  ensureWithinBase(GROUPS_DIR, groupPath);
  return groupPath;
}

function createGroupDirectory(groupDir: string): void {
  const groupsDir = path.join(groupDir);
  fs.mkdirSync(groupsDir, { recursive: true });

  const contextMdPath = path.join(groupDir, "context.md");
  if (!fs.existsSync(contextMdPath)) {
    const defaultContextContent = ["# Relational Context", "*Local preferences and specifications for this chat group.*", ""].join("\n");
    fs.writeFileSync(contextMdPath, defaultContextContent, "utf-8");
  }
}
