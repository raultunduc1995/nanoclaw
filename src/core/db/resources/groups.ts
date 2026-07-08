import { type Database } from "@tursodatabase/database";

export interface GroupRow {
  jid: string;
  name: string;
  folder: string;
  added_at: string;
  temperature: number;
}

export interface GroupsLocalResource {
  get: (jid: string) => Promise<GroupRow | undefined>;
  set: (jid: string, group: GroupRow) => Promise<void>;
  getAll: () => Promise<GroupRow[]>;
}

export const createGroupsLocalResource = (db: Database): GroupsLocalResource => ({
  get: async (jid) => {
    const stmt = await db.prepare("SELECT * FROM registered_groups WHERE jid = ?");
    return (await stmt.get(jid)) as GroupRow | undefined;
  },

  set: async (jid, group) => {
    const stmt = await db.prepare("INSERT OR REPLACE INTO registered_groups (jid, name, folder, added_at, temperature) VALUES (?, ?, ?, ?, ?)");
    await stmt.run(jid, group.name, group.folder, group.added_at, group.temperature);
  },

  getAll: async () => {
    const stmt = await db.prepare("SELECT * FROM registered_groups");
    return (await stmt.all()) as GroupRow[];
  },
});
