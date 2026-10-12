import { TFile, type DataAdapter, type Vault } from "obsidian";
import { PLUGIN_DIR } from "./settings";

/**
 * Timestamped, self-pruning backups.
 *
 * Every file a run is about to overwrite is copied into a folder named after the moment the run
 * started, preserving its path inside the vault. That makes a backup readable as "what this file
 * looked like before that run", and makes "undo the last run" a single directory listing rather
 * than bookkeeping the plugin would have to persist and could get out of sync.
 *
 * The timestamp is in the *name*, which means the newest backup sorts first and a rollback needs no
 * stored pointer.
 */

export const BACKUP_ROOT = `${PLUGIN_DIR}/backups`;

const TIMESTAMP_NAME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;
const DAY_MS = 86_400_000;

/** `2026-10-12T07-51-03-123Z` — filesystem-safe, and sorts lexicographically by time. */
export function timestampName(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

export function backupDir(name: string): string {
  return `${BACKUP_ROOT}/${name}`;
}

/** Epoch millis for a backup folder name, or `null` when the name is not one of ours. */
export function parseTimestampName(name: string): number | null {
  const m = TIMESTAMP_NAME_RE.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms));
}

/**
 * Whether a backup has outlived the retention window.
 *
 * `keepDays === 0` means keep everything. An unrecognised folder name is never expired — deleting
 * something this plugin cannot identify is how a backup tool loses data.
 */
export function isExpired(timestamp: number, keepDays: number, now: number): boolean {
  if (keepDays <= 0) return false;
  return now - timestamp > keepDays * DAY_MS;
}

export interface BackupOutcome {
  readonly dir: string;
  readonly files: number;
}

/** Copy the originals of every path into a fresh backup folder. */
export async function createBackup(
  adapter: DataAdapter,
  paths: string[],
  now: Date = new Date()
): Promise<BackupOutcome> {
  const dir = backupDir(timestampName(now));
  await adapter.mkdir(dir);
  for (const path of paths) {
    const data = await adapter.readBinary(path);
    const target = `${dir}/${path}`;
    await adapter.mkdir(target.slice(0, target.lastIndexOf("/")));
    await adapter.writeBinary(target, data);
  }
  return { dir, files: paths.length };
}

/** Delete backup folders older than `keepDays`. Returns the names removed. */
export async function pruneBackups(
  adapter: DataAdapter,
  keepDays: number,
  now: number = Date.now()
): Promise<string[]> {
  if (keepDays <= 0) return [];
  if (!(await adapter.exists(BACKUP_ROOT))) return [];

  const listing = await adapter.list(BACKUP_ROOT);
  const removed: string[] = [];

  for (const name of listing.folders) {
    const timestamp = parseTimestampName(name);
    if (timestamp === null || !isExpired(timestamp, keepDays, now)) continue;
    await adapter.remove(backupDir(name));
    removed.push(name);
  }
  return removed;
}

/** Newest backup folder name, or `null` when there are none. */
export async function findLatestBackup(adapter: DataAdapter): Promise<string | null> {
  if (!(await adapter.exists(BACKUP_ROOT))) return null;
  const listing = await adapter.list(BACKUP_ROOT);
  const names = listing.folders.filter((name) => parseTimestampName(name) !== null);
  if (names.length === 0) return null;
  return names.sort().pop() as string;
}

/** Every file inside a backup folder, as vault-relative paths. */
export async function listBackupFiles(adapter: DataAdapter, name: string): Promise<string[]> {
  const root = backupDir(name);
  const out: string[] = [];

  const walk = async (current: string): Promise<void> => {
    const listing = await adapter.list(current);
    for (const file of listing.files) out.push(file.slice(root.length + 1));
    for (const folder of listing.folders) await walk(`${current}/${folder}`);
  };

  await walk(root);
  return out.sort();
}

/**
 * Write a backup folder back over the vault, restoring every file it holds.
 *
 * Written through `vault.modify` rather than the adapter so Obsidian's in-memory state and the open
 * editor stay in step with disk. Backups only ever hold markdown, because markdown is the only
 * thing this plugin ever rewrites, so decoding the stored bytes as UTF-8 is exact.
 */
export async function restoreBackup(vault: Vault, name: string): Promise<string[]> {
  const adapter = vault.adapter;
  const root = backupDir(name);
  const paths = await listBackupFiles(adapter, name);
  const restored: string[] = [];

  for (const path of paths) {
    const file = vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) continue;
    await vault.modify(file, await adapter.read(`${root}/${path}`));
    restored.push(path);
  }
  return restored;
}