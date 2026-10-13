import {
  convertOptionsOf,
  DEFAULT_SETTINGS,
  normalizeScopeFolder,
  PLUGIN_ID,
  backupsDir,
  backupsHint,
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

describe("where backups are written", () => {
  it("keeps backups inside the plugin's own folder", () => {
    expect(backupsDir(".obsidian")).toBe(".obsidian/plugins/embed-link-converter/backups");
  });

  it("derives the folder name from the plugin id, so a rename cannot silently break it", () => {
    // The plugin id is the single source of truth; nothing spells the folder out by hand.
    expect(backupsDir(".obsidian")).toContain(`${PLUGIN_ID}/`);
    expect(PLUGIN_ID).toBe("embed-link-converter");
  });

  it("uses whatever config folder the vault reports", () => {
    // Obsidian lets the user move the config folder. A hard-coded `.obsidian` would write backups
    // where the vault never looks and the rollback button would silently find nothing.
    const moved = "/srv/notes-config";
    expect(backupsDir(moved)).toBe("/srv/notes-config/plugins/embed-link-converter/backups");
    expect(backupsDir(moved)).not.toContain(".obsidian");
  });

  it("shows the user the real path, with a trailing slash", () => {
    expect(backupsHint("/srv/notes-config")).toBe(
      "/srv/notes-config/plugins/embed-link-converter/backups/"
    );
  });
});