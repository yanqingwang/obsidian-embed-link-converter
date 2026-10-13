import { TFile, TFolder, type Vault } from "obsidian";
import { normalizeScopeFolder } from "./settings";

/**
 * Decide which notes a run may touch.
 *
 * An empty folder means the whole vault, which is the point of the plugin: a pilot on one folder
 * and a deliberate whole-vault pass are the same code path with a different scope string.
 */

export interface ScopeResult {
  readonly files: TFile[];
  /** Shown in the preview header so the user can see what "now" covers. */
  readonly description: string;
  /** Set when the configured folder could not be found; the run is refused. */
  readonly error?: string;
}

/** Dot-directories (`.obsidian`, `.trash`, `.git`) are never conversion targets. */
export function isHiddenPath(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

export function isMarkdown(file: TFile): boolean {
  return file.extension === "md";
}

/**
 * Resolve the run scope.
 *
 * A folder that resolves to a note is treated as "just that note", so a folder suggestion or a
 * hand-typed path cannot silently widen the run to the vault.
 */
export function collectScope(vault: Vault, rawFolder: string, includeSubfolders: boolean): ScopeResult {
  const folder = normalizeScopeFolder(rawFolder);

  if (folder.length === 0) {
    const files = vault.getMarkdownFiles().filter((f) => !isHiddenPath(f.path));
    return { files, description: `the whole vault (${files.length} notes)` };
  }

  const target = vault.getAbstractFileByPath(folder);
  if (!target) {
    return {
      files: [],
      description: folder,
      error: `Folder not found in this vault: "${folder}". Clear the folder to run on the whole vault.`,
    };
  }

  if (target instanceof TFile) {
    if (!isMarkdown(target)) {
      return {
        files: [],
        description: folder,
        error: `"${folder}" is not a markdown note.`,
      };
    }
    return { files: [target], description: `1 note (${target.path})` };
  }

  // `instanceof` rather than a cast: a cast would let a `TFile` through and then fail on
  // `.children` at runtime, long after the mistake was made.
  if (!(target instanceof TFolder)) {
    return { files: [], description: folder, error: `"${folder}" is not a folder.` };
  }

  const files: TFile[] = [];
  for (const child of target.children) {
    if (child instanceof TFile && isMarkdown(child) && !isHiddenPath(child.path)) {
      files.push(child);
    } else if (includeSubfolders && child instanceof TFolder && !isHiddenPath(child.path)) {
      collectFolder(child, files);
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));

  const suffix = includeSubfolders ? " and subfolders" : "";
  return { files, description: `"${folder}"${suffix} (${files.length} notes)` };
}

function collectFolder(folder: TFolder, out: TFile[]): void {
  for (const child of folder.children) {
    if (child instanceof TFile) {
      if (isMarkdown(child) && !isHiddenPath(child.path)) out.push(child);
    } else if (child instanceof TFolder && !isHiddenPath(child.path)) {
      collectFolder(child, out);
    }
  }
}