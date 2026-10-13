import type { Plugin } from "obsidian";
import type { ConvertOptions, EmbedScope, SizeStrategy } from "./converter";

/** Plugin id; the folder name Obsidian derives from it under the vault's config directory. */
export const PLUGIN_ID = "embed-link-converter";

/**
 * Folder backups live in, relative to the vault's config directory.
 *
 * The `.obsidian` name is *not* hard-coded anywhere: a user can point Obsidian at a different
 * config folder, and a hard-coded path would silently write backups somewhere the vault never sees.
 * `Vault#configDir` is the supported way to ask.
 */
export function backupsDir(configDir: string): string {
  return `${configDir}/plugins/${PLUGIN_ID}/backups`;
}

/** Where the user will find their backups, for display in the preview. */
export function backupsHint(configDir: string): string {
  return `${configDir}/plugins/${PLUGIN_ID}/backups/`;
}

export interface EmbedConverterSettings {
  /**
   * Folder the run is limited to. Empty means the whole vault — the deliberate "just look at
   * everything" setting, which is why it is a blank field rather than a required one.
   */
  scopeFolder: string;
  /** When a scope folder is set, descend into its subfolders too. */
  includeSubfolders: boolean;
  /** Which link targets take part in a run. */
  scope: EmbedScope;
  /** What happens to a `|300` size hint. */
  size: SizeStrategy;
  /** Show the change list before anything is written. */
  previewBeforeWrite: boolean;
  /** Copy the original of every file about to change into a timestamped backup folder. */
  backupEnabled: boolean;
  /** Delete backups older than this many days. `0` keeps them forever. */
  backupRetentionDays: number;
}

export const DEFAULT_SETTINGS: EmbedConverterSettings = {
  scopeFolder: "",
  includeSubfolders: true,
  scope: "image-only",
  size: "html",
  previewBeforeWrite: true,
  backupEnabled: true,
  backupRetentionDays: 7,
};

/** Narrow the full settings object down to what the pure converter needs. */
export function convertOptionsOf(settings: EmbedConverterSettings): ConvertOptions {
  return { scope: settings.scope, size: settings.size };
}

/** Normalise a user-typed folder path: no leading/trailing slash, no duplicate separators. */
export function normalizeScopeFolder(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

/**
 * The slice of the plugin object the settings tab needs.
 *
 * Declared here rather than imported from `main.ts` so the settings tab does not pull the entry
 * point in, which would make the module graph circular.
 */
export interface ConverterHost extends Plugin {
  settings: EmbedConverterSettings;
  saveSettings(): Promise<void>;
  rollbackLastRun(): Promise<void>;
}