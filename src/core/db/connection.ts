import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

import { STORE_DIR, logger } from "../utils/index.js";

import { createSchema } from "./schema.js";
import { createGroupsLocalResource } from "./resources/groups.js";
import type { GroupsLocalResource } from "./resources/groups.js";
import { createHistoryLocalResource } from "./resources/history.js";
import type { HistoryLocalResource } from "./resources/history.js";

export interface LocalResource {
  groups: GroupsLocalResource;
  history: HistoryLocalResource;
  close(): void;
}

function createLocalResource(db: Database.Database): LocalResource {
  createSchema(db);

  return {
    groups: createGroupsLocalResource(db),
    history: createHistoryLocalResource(db),
    close: () => db.close(),
  };
}

let instance: LocalResource | null = null;

export function initLocalDatabase(): LocalResource {
  const dbPath = path.join(STORE_DIR, "messages.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  instance = createLocalResource(new Database(dbPath));
  logger.info("Database was initialized successfuly");
  return instance;
}

export function initTestDatabase(): LocalResource {
  instance = createLocalResource(new Database(":memory:"));
  return instance;
}
