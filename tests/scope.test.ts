import { TFile, TFolder } from "obsidian";
import { collectScope, isHiddenPath } from "../src/scope";

/** Build a vault from a list of paths. */
function fakeVault(paths: string[]) {
  const byPath = new Map<string, any>();
  const root = new TFolder("/");

  const ensureFolder = (path: string): TFolder => {
    if (byPath.has(path)) return byPath.get(path);
    const folder = new TFolder(path);
    byPath.set(path, folder);
    if (path !== "/") {
      const parentPath = path.slice(0, path.lastIndexOf("/")) || "/";
      ensureFolder(parentPath).children.push(folder);
      folder.parent = ensureFolder(parentPath);
    }
    return folder;
  };

  for (const path of paths) {
    const parentPath = path.slice(0, path.lastIndexOf("/")) || "/";
    const file = new TFile(path);
    const parent = ensureFolder(parentPath);
    parent.children.push(file);
    file.parent = parent;
    byPath.set(path, file);
  }

  const vault = {
    getRoot: () => root,
    getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
    getMarkdownFiles: () =>
      [...byPath.values()].filter((f): f is TFile => f instanceof TFile && f.extension === "md"),
  };
  return vault as any;
}

const VAULT_PATHS = [
  "a.md",
  "notes/b.md",
  "notes/deep/c.md",
  "notes/deep/d.txt",
  "other/e.md",
  ".obsidian/plugins/x/y.md",
  ".trash/z.md",
];

describe("hidden paths", () => {
  it("detects dot-directories at any depth", () => {
    expect(isHiddenPath(".obsidian/plugins/x/y.md")).toBe(true);
    expect(isHiddenPath("notes/.trash/z.md")).toBe(true);
    expect(isHiddenPath("notes/b.md")).toBe(false);
  });
});

describe("whole vault scope", () => {
  it("takes every markdown note when no folder is set", () => {
    const result = collectScope(fakeVault(VAULT_PATHS), "", true);
    expect(result.files.map((f: TFile) => f.path).sort()).toEqual([
      "a.md",
      "notes/b.md",
      "notes/deep/c.md",
      "other/e.md",
    ]);
    expect(result.error).toBeUndefined();
  });

  it("treats a blank or whitespace folder as the whole vault", () => {
    const vault = fakeVault(VAULT_PATHS);
    expect(collectScope(vault, "   ", true).files).toHaveLength(4);
    expect(collectScope(vault, "/", true).files).toHaveLength(4);
  });

  it("never descends into dot-directories", () => {
    const result = collectScope(fakeVault(VAULT_PATHS), "", true);
    expect(result.files.some((f: TFile) => f.path.includes(".obsidian"))).toBe(false);
    expect(result.files.some((f: TFile) => f.path.includes(".trash"))).toBe(false);
  });
});

describe("folder scope", () => {
  it("takes the folder and its subfolders", () => {
    const result = collectScope(fakeVault(VAULT_PATHS), "notes", true);
    expect(result.files.map((f: TFile) => f.path)).toEqual(["notes/b.md", "notes/deep/c.md"]);
  });

  it("takes only direct children when subfolders are off", () => {
    const result = collectScope(fakeVault(VAULT_PATHS), "notes", false);
    expect(result.files.map((f: TFile) => f.path)).toEqual(["notes/b.md"]);
  });

  it("excludes non-markdown children", () => {
    const result = collectScope(fakeVault(VAULT_PATHS), "notes", true);
    expect(result.files.some((f: TFile) => f.path.endsWith(".txt"))).toBe(false);
  });

  it("normalises a typed path", () => {
    expect(collectScope(fakeVault(VAULT_PATHS), "/notes/", true).files).toHaveLength(2);
    expect(collectScope(fakeVault(VAULT_PATHS), "notes//deep", false).files).toHaveLength(1);
  });

  it("scopes to a single note when the path points at a file", () => {
    const result = collectScope(fakeVault(VAULT_PATHS), "notes/b.md", true);
    expect(result.files.map((f: TFile) => f.path)).toEqual(["notes/b.md"]);
  });

  it("reports a missing folder instead of silently widening to the vault", () => {
    const result = collectScope(fakeVault(VAULT_PATHS), "nope", true);
    expect(result.files).toEqual([]);
    expect(result.error).toContain("Folder not found");
  });

  it("rejects a non-markdown file path", () => {
    const result = collectScope(fakeVault(VAULT_PATHS), "notes/deep/d.txt", true);
    expect(result.error).toContain("not a markdown note");
  });

  it("returns an empty folder without erroring", () => {
    const vault = fakeVault(["a.md", "empty"]);
    expect(collectScope(vault, "empty", true).files).toEqual([]);
  });
});