import type Database from 'better-sqlite3';

export interface RouterStateLocalResource {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

export class RouterStateResource implements RouterStateLocalResource {
  constructor(private db: Database.Database) {}

  get(key: string): string | undefined {
    const row = this.db
      .prepare('SELECT value FROM router_state WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)',
      )
      .run(key, value);
  }
}
