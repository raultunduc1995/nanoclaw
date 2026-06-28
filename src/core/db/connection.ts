import { connect, type Database } from "@tursodatabase/database";
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

async function createLocalResource(db: Database): Promise<LocalResource> {
  await createSchema(db);

  return {
    groups: createGroupsLocalResource(db),
    history: createHistoryLocalResource(db),
    memories: createMemoriesLocalResource(db),
    close: () => db.close(),
  };
}

let instance: LocalResource | null = null;

export async function initLocalDatabase(): Promise<LocalResource> {
  const dbPath = path.join(STORE_DIR, "turso_messages.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = await connect(dbPath);
  instance = await createLocalResource(db);
  logger.info("Turso Database was initialized successfully");
  return instance;
}

