import { describe, it, expect, beforeEach, vi } from "vitest";

import { initTestDatabase } from "../db/connection.js";
import type { LocalResource } from "../db/connection.js";
import { createGroupsRepository, GroupsRepository } from "./groups-repository.js";

vi.mock("../utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../utils/config.js", () => ({
  DATA_DIR: "/tmp/test-data",
  GROUPS_DIR: "/tmp/test-groups",
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    default: {
      ...actual,
      mkdirSync: vi.fn(),
      existsSync: vi.fn(() => false),
      copyFileSync: vi.fn(),
    },
  };
});

let db: LocalResource;
let repo: GroupsRepository;

beforeEach(() => {
  vi.clearAllMocks();
  db = initTestDatabase();
  repo = createGroupsRepository(db.groups);
});

// --- getRegisteredGroupsRecord ---

describe("getAllAsRecord", () => {
  it("returns empty record when no groups exist", () => {
    expect(repo.getAllAsRecord()).toEqual({});
  });

  it("loads existing groups from DB on creation", () => {
    db.groups.set("tg:main", {
      jid: "tg:main",
      name: "Main",
      folder: "telegram_main",
      added_at: "2024-01-01T00:00:00.000Z",
    });

    const freshRepo = createGroupsRepository(db.groups);
    const groups = freshRepo.getAllAsRecord();

    expect(groups["tg:main"]).toBeDefined();
    expect(groups["tg:main"].name).toBe("Main");
    expect(groups["tg:main"].folder).toBe("telegram_main");
  });

  it("maps snake_case DB rows to camelCase domain types", () => {
    db.groups.set("tg:dev", {
      jid: "tg:dev",
      name: "Dev Team",
      folder: "telegram_dev-team",
      added_at: "2026-03-01T10:00:00.000Z",
    });

    const freshRepo = createGroupsRepository(db.groups);
    const group = freshRepo.getAllAsRecord()["tg:dev"];

    expect(group.addedAt).toBe("2026-03-01T10:00:00.000Z");
  });
});

// --- getRegisteredGroupsJids ---

describe("getRegisteredGroupsJids", () => {
  it("returns empty set when no groups exist", () => {
    expect(repo.getAllJids().size).toBe(0);
  });

  it("returns jids after registration", () => {
    repo.register("tg:one", { name: "One", folder: "telegram_one", addedAt: "2024-01-01T00:00:00.000Z" });
    repo.register("tg:two", { name: "Two", folder: "telegram_two", addedAt: "2024-01-01T00:00:00.000Z" });

    const jids = repo.getAllJids();
    expect(jids.has("tg:one")).toBe(true);
    expect(jids.has("tg:two")).toBe(true);
    expect(jids.size).toBe(2);
  });
});

// --- getBy ---

describe("getBy", () => {
  it("returns undefined for non-existent group", () => {
    expect(repo.getByJid("tg:unknown")).toBeUndefined();
  });

  it("returns group after registerGroup", () => {
    repo.register("tg:chat", { name: "Chat", folder: "telegram_chat", addedAt: "2024-01-01T00:00:00.000Z" });

    const group = repo.getByJid("tg:chat");
    expect(group).toBeDefined();
    expect(group!.name).toBe("Chat");
    expect(group!.folder).toBe("telegram_chat");
  });
});

// --- registerGroup ---

describe("register", () => {
  it("adds group to cache and persists to DB", () => {
    repo.register("tg:new", { name: "New Group", folder: "telegram_new-group", addedAt: "2024-06-01T00:00:00.000Z" });

    expect(repo.getByJid("tg:new")).toBeDefined();
    expect(repo.getAllAsRecord()["tg:new"].name).toBe("New Group");

    const freshRepo = createGroupsRepository(db.groups);
    expect(freshRepo.getByJid("tg:new")).toBeDefined();
    expect(freshRepo.getByJid("tg:new")!.name).toBe("New Group");
  });

  it("overwrites existing group", () => {
    repo.register("tg:chat", { name: "Original", folder: "telegram_chat", addedAt: "2024-01-01T00:00:00.000Z" });
    repo.register("tg:chat", { name: "Updated", folder: "telegram_chat", addedAt: "2024-01-01T00:00:00.000Z" });

    expect(repo.getByJid("tg:chat")!.name).toBe("Updated");
  });

  it("throws on invalid folder name", () => {
    expect(() => repo.register("tg:bad", { name: "Bad", folder: "../../outside", addedAt: "2024-01-01T00:00:00.000Z" })).toThrow();

    expect(repo.getByJid("tg:bad")).toBeUndefined();
  });

  it("creates group directory with logs subdirectory", async () => {
    const fs = await import("fs");
    repo.register("tg:dir", { name: "Dir Test", folder: "telegram_dir-test", addedAt: "2024-01-01T00:00:00.000Z" });

    expect(fs.default.mkdirSync).toHaveBeenCalledWith("/tmp/test-groups/telegram_dir-test/logs", { recursive: true });
  });
});
