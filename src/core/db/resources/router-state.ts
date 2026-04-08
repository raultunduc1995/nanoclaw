import type Database from 'better-sqlite3';

export interface RouterStateLocalResource {
  get(): RouterStateRow | undefined;
  set(routerStateRow: RouterStateRow): void;
}

export interface RouterStateRow {
  last_timestamp?: string;
  last_agent_timestamp?: Record<string, string>;
}

export const createRouterStateLocalResource = (db: Database.Database): RouterStateLocalResource => ({
  get: () => {
    const lastTimestampRow = db.prepare('SELECT value FROM router_state WHERE key = ?').get('last_timestamp') as { value: string } | undefined;
    const lastAgentTimestampRow = db.prepare('SELECT value FROM router_state WHERE key = ?').get('last_agent_timestamp') as { value: string } | undefined;
    let lastAgentTimestampParsed: Record<string, string> | undefined;
    try {
      lastAgentTimestampParsed = lastAgentTimestampRow?.value ? JSON.parse(lastAgentTimestampRow.value) : undefined;
    } catch {
      /* empty */
    }

    if (lastTimestampRow?.value !== undefined || lastAgentTimestampParsed !== undefined) {
      return {
        last_timestamp: lastTimestampRow?.value,
        last_agent_timestamp: lastAgentTimestampParsed,
      };
    }
  },

  set: (routerStateRow) => {
    if (routerStateRow.last_timestamp !== undefined) {
      db.prepare('INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)').run('last_timestamp', routerStateRow.last_timestamp);
    }
    if (routerStateRow.last_agent_timestamp !== undefined) {
      db.prepare('INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)').run('last_agent_timestamp', JSON.stringify(routerStateRow.last_agent_timestamp));
    }
  },
});
