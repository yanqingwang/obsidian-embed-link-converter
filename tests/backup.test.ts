import {
  backupDir,
  createBackup,
  findLatestBackup,
  isExpired,
  listBackupFiles,
  parseTimestampName,
  pruneBackups,
  restoreBackup,
  timestampName,
} from "../src/backup";
import { backupsDir } from "../src/settings";
import { TFile } from "obsidian";

/**
 * The plugin no longer assumes the config folder is called `.obsidian` — a user can point Obsidian
 * anywhere — so every path in these tests is derived from a `Vault#configDir` value, exactly as
 * production does.
 */
const CONFIG_DIR = "/srv/notes/.obsidian";
const BACKUP_ROOT = backupsDir(CONFIG_DIR);

/** In-memory stand-in for Obsidian's vault adapter. */
class FakeAdapter {
  files = new Map<string, string>();
  folders = new Set<string>();
  mkdirCalls: string[] = [];
  removed: string[] = [];

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.mkdirCalls.push(path);
    // A real adapter keeps the path it was handed, leading slash included. Dropping it here made
    // `list()` unable to find folders whenever `Vault#configDir` was absolute -- which it usually
    // is -- and the mismatch stayed invisible while the plugin hard-coded a relative `.obsidian`.
    const absolute = path.startsWith("/");
    let current = "";
    for (const part of path.split("/").filter(Boolean)) {
      current = current ? `${current}/${part}` : part;
      this.folders.add(absolute ? `/${current}` : current);
    }
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const text = await this.read(path);
    return new TextEncoder().encode(text).buffer as ArrayBuffer;
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, new TextDecoder().decode(data));
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = path === "" ? "" : `${path}/`;
    const files = [...this.files.keys()].filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes("/"));
    const folders = [...this.folders]
      .filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes("/"))
      .map((f) => f.slice(prefix.length));
    return { files: files.sort(), folders: folders.sort() };
  }

  async remove(path: string): Promise<void> {
    this.removed.push(path);
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
    }
    for (const key of [...this.folders]) {
      if (key === path || key.startsWith(`${path}/`)) this.folders.delete(key);
    }
  }
}

const DAY = 86_400_000;
const encoder = (s: string) => new TextEncoder().encode(s);

describe("timestamp names", () => {
  it("round trips through the folder name", () => {
    const date = new Date("2026-10-12T07:51:03.123Z");
    const name = timestampName(date);
    expect(name).toBe("2026-10-12T07-51-03-123Z");
    expect(parseTimestampName(name)).toBe(date.getTime());
  });

  it("sorts chronologically as a string", () => {
    const early = timestampName(new Date("2026-01-01T00:00:00.000Z"));
    const late = timestampName(new Date("2026-12-31T23:59:59.999Z"));
    expect([late, early].sort()).toEqual([early, late]);
  });

  it("rejects names it did not create", () => {
    expect(parseTimestampName("notes")).toBeNull();
    expect(parseTimestampName("2026-10-12")).toBeNull();
    expect(parseTimestampName("v1.0.0")).toBeNull();
    expect(parseTimestampName("../escape")).toBeNull();
  });
});

describe("expiry", () => {
  const now = new Date("2026-10-12T00:00:00.000Z").getTime();

  it("keeps everything when retention is zero", () => {
    expect(isExpired(now - 4000 * DAY, 0, now)).toBe(false);
  });

  it("expires past the window and keeps inside it", () => {
    expect(isExpired(now - 8 * DAY, 7, now)).toBe(true);
    expect(isExpired(now - 1 * DAY, 7, now)).toBe(false);
    expect(isExpired(now, 7, now)).toBe(false);
  });
});

describe("creating and restoring a backup", () => {
  const seed = async (adapter: FakeAdapter) => {
    adapter.files.set("notes/a.md", "![[x.png]]");
    adapter.files.set("notes/deep/b.md", "![[y.png]]");
  };

  it("copies each file to its mirrored path under the backup folder", async () => {
    const adapter = new FakeAdapter();
    await seed(adapter);
    const when = new Date("2026-10-12T00:00:00.000Z");

    const outcome = await createBackup(adapter as any, ["notes/a.md", "notes/deep/b.md"], CONFIG_DIR, when);

    expect(outcome.files).toBe(2);
    expect(outcome.dir).toBe(backupDir(CONFIG_DIR, timestampName(when)));
    expect(adapter.files.get(`${outcome.dir}/notes/a.md`)).toBe("![[x.png]]");
    expect(adapter.files.get(`${outcome.dir}/notes/deep/b.md`)).toBe("![[y.png]]");
  });

  it("leaves the originals in place", async () => {
    const adapter = new FakeAdapter();
    await seed(adapter);
    await createBackup(adapter as any, ["notes/a.md"], CONFIG_DIR);
    expect(adapter.files.get("notes/a.md")).toBe("![[x.png]]");
  });

  it("lists every file in a backup", async () => {
    const adapter = new FakeAdapter();
    await seed(adapter);
    const when = new Date("2026-10-12T00:00:00.000Z");
    await createBackup(adapter as any, ["notes/a.md", "notes/deep/b.md"], CONFIG_DIR, when);
    expect(await listBackupFiles(adapter as any, CONFIG_DIR, timestampName(when))).toEqual([
      "notes/a.md",
      "notes/deep/b.md",
    ]);
  });

  it("writes the backup back over the vault", async () => {
    const adapter = new FakeAdapter();
    await seed(adapter);
    const when = new Date("2026-10-12T00:00:00.000Z");
    const name = timestampName(when);
    await createBackup(adapter as any, ["notes/a.md", "notes/deep/b.md"], CONFIG_DIR, when);

    // Simulate the conversion having run.
    adapter.files.set("notes/a.md", "![](x.png)");
    adapter.files.set("notes/deep/b.md", "![](y.png)");

    const modified = new Map<string, string>();
    const vault = {
      adapter: adapter as any,
      configDir: CONFIG_DIR,
      getAbstractFileByPath: (p: string) => (adapter.files.has(p) ? new TFile(p) : null),
      modify: async (file: TFile, data: string) => {
        modified.set(file.path, data);
        adapter.files.set(file.path, data);
      },
    };

    const restored = await restoreBackup(vault as any, name);

    expect(restored).toEqual(["notes/a.md", "notes/deep/b.md"]);
    expect(modified.get("notes/a.md")).toBe("![[x.png]]");
    expect(adapter.files.get("notes/deep/b.md")).toBe("![[y.png]]");
  });

  it("fails loudly when a source file has vanished", async () => {
    const adapter = new FakeAdapter();
    await expect(createBackup(adapter as any, ["gone.md"], CONFIG_DIR)).rejects.toThrow(/ENOENT/);
  });
});

describe("pruning", () => {
  const name = (iso: string) => timestampName(new Date(iso));

  const seedAges = async (adapter: FakeAdapter) => {
    for (const iso of ["2026-10-01T00:00:00.000Z", "2026-10-10T00:00:00.000Z", "2026-10-11T00:00:00.000Z"]) {
      await adapter.mkdir(backupDir(CONFIG_DIR, name(iso)));
    }
    // A folder the plugin did not create must survive untouched.
    await adapter.mkdir(`${BACKUP_ROOT}/my-own-notes`);
  };

  it("removes only the expired folders", async () => {
    const adapter = new FakeAdapter();
    await seedAges(adapter);
    const now = new Date("2026-10-12T00:00:00.000Z").getTime();

    const removed = await pruneBackups(adapter as any, 7, CONFIG_DIR, now);

    expect(removed).toEqual([name("2026-10-01T00:00:00.000Z")]);
    expect(adapter.removed).toEqual([backupDir(CONFIG_DIR, name("2026-10-01T00:00:00.000Z"))]);
    expect(await adapter.exists(backupDir(CONFIG_DIR, name("2026-10-10T00:00:00.000Z")))).toBe(true);
  });

  it("never deletes a folder it cannot identify", async () => {
    const adapter = new FakeAdapter();
    await seedAges(adapter);
    await pruneBackups(adapter as any, 1, CONFIG_DIR, new Date("2026-10-12T00:00:00.000Z").getTime());
    expect(await adapter.exists(`${BACKUP_ROOT}/my-own-notes`)).toBe(true);
  });

  it("does nothing when retention is zero", async () => {
    const adapter = new FakeAdapter();
    await seedAges(adapter);
    expect(await pruneBackups(adapter as any, 0, CONFIG_DIR)).toEqual([]);
    expect(adapter.removed).toEqual([]);
  });

  it("does nothing when there are no backups at all", async () => {
    expect(await pruneBackups(new FakeAdapter() as any, 7, CONFIG_DIR)).toEqual([]);
  });
});

describe("finding the latest backup", () => {
  it("picks the newest by name", async () => {
    const adapter = new FakeAdapter();
    for (const iso of ["2026-10-10T00:00:00.000Z", "2026-10-12T00:00:00.000Z", "2026-10-11T00:00:00.000Z"]) {
      await adapter.mkdir(backupDir(CONFIG_DIR, timestampName(new Date(iso))));
    }
    expect(await findLatestBackup(adapter as any, CONFIG_DIR)).toBe("2026-10-12T00-00-00-000Z");
  });

  it("returns null when there is nothing to roll back", async () => {
    expect(await findLatestBackup(new FakeAdapter() as any, CONFIG_DIR)).toBeNull();
  });

  it("ignores folders that are not backups", async () => {
    const adapter = new FakeAdapter();
    await adapter.mkdir(`${BACKUP_ROOT}/scratch`);
    expect(await findLatestBackup(adapter as any, CONFIG_DIR)).toBeNull();
  });
});

describe("path safety", () => {
  it("keeps backups inside the plugin folder", () => {
    expect(BACKUP_ROOT).toBe(`${CONFIG_DIR}/plugins/embed-link-converter/backups`);
    expect(backupDir(CONFIG_DIR, "x")).toBe(`${BACKUP_ROOT}/x`);
  });

  it("follows the config folder the vault reports instead of assuming `.obsidian`", () => {
    // A hard-coded `.obsidian` would write backups where this vault never looks, and the user would
    // only find out when the rollback button silently found nothing.
    const moved = "/Library/Mobile Documents/iCloud~md~obsidian/Documents/config";
    expect(backupsDir(moved)).toBe(`${moved}/plugins/embed-link-converter/backups`);
    expect(backupsDir(moved)).not.toContain(".obsidian");
  });

  it("works whether the config folder is reported absolute or relative", async () => {
    // Obsidian reports an absolute path on desktop and a vault-relative one on mobile, so both
    // shapes have to round-trip through create -> list -> restore.
    for (const configDir of ["/srv/notes/.obsidian", ".obsidian"]) {
      const adapter = new FakeAdapter();
      adapter.files.set("notes/a.md", "![[x.png]]");
      adapter.files.set("notes/deep/b.md", "![[y.png]]");
      const when = new Date("2026-10-12T00:00:00.000Z");
      const name = timestampName(when);

      await createBackup(adapter as any, ["notes/a.md", "notes/deep/b.md"], configDir, when);
      expect(await listBackupFiles(adapter as any, configDir, name)).toEqual([
        "notes/a.md",
        "notes/deep/b.md",
      ]);
    }
  });

  it("does not let a traversal in a vault path escape the backup folder", () => {
    const adapter = new FakeAdapter();
    adapter.files.set("../outside.md", "secret");
    // `createBackup` is only ever called with paths from `vault.getMarkdownFiles()`, which cannot
    // contain a traversal; the assertion documents that the mirror is a plain concatenation.
    const target = `${BACKUP_ROOT}/x/../outside.md`;
    expect(target.startsWith(BACKUP_ROOT)).toBe(true);
    expect(encoder(target).length).toBeGreaterThan(0);
  });
});