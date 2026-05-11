import type Database from "better-sqlite3";

// --- Types and interfaces ---

export interface GroupRow {
  jid: string;
  name: string;
  folder: string;
  session_id: string;
  added_at: string;
}

// --- Local resource interface and implementation ---

export interface GroupsLocalResource {
  get: (jid: string) => GroupRow | undefined;
  set: (jid: string, group: GroupRow) => void;
  getAll: () => GroupRow[];
}

export const createGroupsLocalResource = (db: Database.Database): GroupsLocalResource => ({
  get: (jid) => db.prepare("SELECT * FROM registered_groups WHERE jid = ?").get(jid) as GroupRow | undefined,

  set: (jid, group) => {
    db.prepare(`INSERT OR REPLACE INTO registered_groups (jid, name, folder, added_at, session_id) VALUES (?, ?, ?, ?, ?)`).run(jid, group.name, group.folder, group.added_at, group.session_id);
  },

  getAll: () => db.prepare("SELECT * FROM registered_groups").all() as GroupRow[],
});
