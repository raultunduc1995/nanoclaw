import type Database from 'better-sqlite3';

// --- Types and interfaces ---

export interface GroupRow {
  jid: string;
  name: string;
  folder: string;
  trigger_pattern: string;
  added_at: string;
  container_config: string | null;
  requires_trigger: number | null;
  is_main: number | null;
}

// --- Local resource interface and implementation ---

export interface GroupsLocalResource {
  get: (jid: string) => GroupRow | undefined;
  set: (jid: string, group: GroupRow) => void;
  getAll: () => GroupRow[];
}

export const createGroupsLocalResource = (db: Database.Database): GroupsLocalResource => ({
  get: (jid) => db.prepare('SELECT * FROM registered_groups WHERE jid = ?').get(jid) as GroupRow | undefined,

  set: (jid, group) => {
    db.prepare(`INSERT OR REPLACE INTO registered_groups (jid, name, folder, trigger_pattern, added_at, container_config, requires_trigger, is_main) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      jid,
      group.name,
      group.folder,
      'none', // TODO: delete trigger_pattern column + migrate DB
      group.added_at,
      group.container_config ?? null,
      0, // TODO: delete requires_trigger column + migrate DB
      group.is_main ? 1 : 0,
    );
  },

  getAll: () => db.prepare('SELECT * FROM registered_groups').all() as GroupRow[],
});
