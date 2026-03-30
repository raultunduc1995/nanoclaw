import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { STORE_DIR } from '../../config.js';
import { createSchema } from './schema.js';
import { ChatsResource } from './resources/chats.js';
import { MessagesResource } from './resources/messages.js';
import { TasksResource } from './resources/tasks.js';
import { RouterStateResource } from './resources/router-state.js';
import { GroupsResource } from './resources/groups.js';

import type { ChatsLocalResource } from './resources/chats.js';
import type { MessagesLocalResource } from './resources/messages.js';
import type { TasksLocalResource } from './resources/tasks.js';
import type { RouterStateLocalResource } from './resources/router-state.js';
import type { GroupsLocalResource } from './resources/groups.js';

export interface LocalDatabase {
  chats: ChatsLocalResource;
  messages: MessagesLocalResource;
  tasks: TasksLocalResource;
  routerState: RouterStateLocalResource;
  groups: GroupsLocalResource;
  close(): void;
}

function createResources(db: Database.Database): LocalDatabase {
  createSchema(db);

  return {
    chats: new ChatsResource(db),
    messages: new MessagesResource(db),
    tasks: new TasksResource(db),
    routerState: new RouterStateResource(db),
    groups: new GroupsResource(db),
    close: () => db.close(),
  };
}

let instance: LocalDatabase | null = null;

export function initLocalDatabase(): LocalDatabase {
  const dbPath = path.join(STORE_DIR, 'messages.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  instance = createResources(new Database(dbPath));
  return instance;
}

export function initTestDatabase(): LocalDatabase {
  instance = createResources(new Database(':memory:'));
  return instance;
}

export function getLocalDatabase(): LocalDatabase {
  if (!instance) throw new Error('Database not initialized');
  return instance;
}
