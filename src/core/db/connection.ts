import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import fs from "fs";
import path from "path";

import { STORE_DIR, logger } from "../utils/index.js";

import { createSchema } from "./schema.js";
import { createGroupsLocalResource } from "./resources/groups.js";
import type { GroupsLocalResource } from "./resources/groups.js";
import { createHistoryLocalResource } from "./resources/history.js";
import type { HistoryLocalResource } from "./resources/history.js";
import { createMemoriesLocalResource } from "./resources/memories.js";
import type { MemoriesLocalResource } from "./resources/memories.js";

export interface LocalResource {
  groups: GroupsLocalResource;
  history: HistoryLocalResource;
  memories: MemoriesLocalResource;
  close(): void;
}

function createLocalResource(db: Database.Database): LocalResource {
  sqliteVec.load(db);
  createSchema(db);

  return {
    groups: createGroupsLocalResource(db),
    history: createHistoryLocalResource(db),
    memories: createMemoriesLocalResource(db),
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
