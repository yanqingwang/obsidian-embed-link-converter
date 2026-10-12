import {
  convertOptionsOf,
  DEFAULT_SETTINGS,
  normalizeScopeFolder,
  PLUGIN_DIR,
} from "../src/settings";

describe("scope folder normalisation", () => {
  it("trims whitespace and surrounding slashes", () => {
    expect(normalizeScopeFolder("  notes/sub  ")).toBe("notes/sub");
    expect(normalizeScopeFolder("/notes/sub/")).toBe("notes/sub");
    expect(normalizeScopeFolder("///notes///sub///")).toBe("notes/sub");
  });

  it("converts backslashes and collapses separators", () => {
    expect(normalizeScopeFolder("notes\\sub")).toBe("notes/sub");
    expect(normalizeScopeFolder("notes//sub")).toBe("notes/sub");
  });

  it("keeps an empty or blank folder empty", () => {
    expect(normalizeScopeFolder("")).toBe("");
    expect(normalizeScopeFolder("   ")).toBe("");
    expect(normalizeScopeFolder("/")).toBe("");
  });

  it("leaves an ordinary vault path untouched", () => {
    expect(normalizeScopeFolder("AITasks/embed-pilot")).toBe("AITasks/embed-pilot");
    expect(normalizeScopeFolder("A folder with spaces")).toBe("A folder with spaces");
  });
});

describe("defaults", () => {
  it("defaults to a whole-vault scope with the lossless scope and backups on", () => {
    expect(DEFAULT_SETTINGS.scopeFolder).toBe("");
    expect(DEFAULT_SETTINGS.scope).toBe("image-only");
    expect(DEFAULT_SETTINGS.size).toBe("html");
    expect(DEFAULT_SETTINGS.backupEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.backupRetentionDays).toBe(7);
    expect(DEFAULT_SETTINGS.previewBeforeWrite).toBe(true);
    expect(DEFAULT_SETTINGS.includeSubfolders).toBe(true);
  });

  it("projects only what the converter needs", () => {
    expect(
      convertOptionsOf({ ...DEFAULT_SETTINGS, scope: "all", size: "drop" })
    ).toEqual({ scope: "all", size: "drop" });
  });
});

describe("plugin directory", () => {
  it("keeps backups inside the plugin's own folder", () => {
    expect(PLUGIN_DIR).toBe(".obsidian/plugins/embed-link-converter");
  });
});