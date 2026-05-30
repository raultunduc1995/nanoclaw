import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryTool } from "./memory-tool.js";

let basePath: string;
let memory: MemoryTool;

const seed = (filePath: string, fileText: string) => memory.create({ command: "create", path: filePath, file_text: fileText });

const readMemoryFile = (relativePath: string) => readFile(path.join(basePath, "memories", relativePath), "utf-8");

beforeEach(async () => {
  basePath = await mkdtemp(path.join(tmpdir(), "memory-tool-test-"));
  memory = await MemoryTool.init(basePath);
});

afterEach(async () => {
  await rm(basePath, { recursive: true, force: true });
});

describe("str_replace", () => {
  it("replaces a single-line occurrence", async () => {
    await seed("/memories/notes.md", "alpha\nbeta\ngamma\n");

    await memory.str_replace({ command: "str_replace", path: "/memories/notes.md", old_str: "beta", new_str: "BETA" });

    expect(await readMemoryFile("notes.md")).toBe("alpha\nBETA\ngamma\n");
  });

  it("replaces a multi-line occurrence (the bug the subclass fixes)", async () => {
    await seed("/memories/notes.md", "line one\nline two\nline three\nline four\n");

    await memory.str_replace({
      command: "str_replace",
      path: "/memories/notes.md",
      old_str: "line two\nline three",
      new_str: "replaced two\nreplaced three",
    });

    expect(await readMemoryFile("notes.md")).toBe("line one\nreplaced two\nreplaced three\nline four\n");
  });

  it("replaces a multi-line block with a different number of lines", async () => {
    await seed("/memories/notes.md", "header\nold a\nold b\nold c\nfooter\n");

    await memory.str_replace({
      command: "str_replace",
      path: "/memories/notes.md",
      old_str: "old a\nold b\nold c",
      new_str: "single new line",
    });

    expect(await readMemoryFile("notes.md")).toBe("header\nsingle new line\nfooter\n");
  });

  it("returns a line-numbered snippet of the change", async () => {
    await seed("/memories/notes.md", "one\ntwo\nthree\nfour\nfive\n");

    const result = await memory.str_replace({ command: "str_replace", path: "/memories/notes.md", old_str: "three", new_str: "THREE" });

    expect(result).toContain("The memory file has been edited");
    expect(result).toContain("THREE");
    expect(result).toMatch(/\b3\tTHREE/);
  });

  it("throws when old_str does not appear", async () => {
    await seed("/memories/notes.md", "alpha\nbeta\n");

    await expect(
      memory.str_replace({ command: "str_replace", path: "/memories/notes.md", old_str: "missing", new_str: "x" }),
    ).rejects.toThrow(/did not appear verbatim/);
  });

  it("throws when old_str appears more than once", async () => {
    await seed("/memories/notes.md", "dup\nother\ndup\n");

    await expect(
      memory.str_replace({ command: "str_replace", path: "/memories/notes.md", old_str: "dup", new_str: "x" }),
    ).rejects.toThrow(/Multiple occurrences/);
  });

  it("counts multi-line occurrences for the uniqueness check", async () => {
    await seed("/memories/notes.md", "a\nb\nfiller\na\nb\n");

    await expect(
      memory.str_replace({ command: "str_replace", path: "/memories/notes.md", old_str: "a\nb", new_str: "x" }),
    ).rejects.toThrow(/Multiple occurrences/);
  });

  it("throws when the target file does not exist", async () => {
    await expect(
      memory.str_replace({ command: "str_replace", path: "/memories/missing.md", old_str: "x", new_str: "y" }),
    ).rejects.toThrow(/does not exist/);
  });

  it("rejects paths outside /memories", async () => {
    await expect(
      memory.str_replace({ command: "str_replace", path: "/etc/passwd", old_str: "x", new_str: "y" }),
    ).rejects.toThrow(/must start with \/memories/);
  });
});
