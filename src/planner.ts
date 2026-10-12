import { convert, type ChangeRecord, type ConvertOptions, type Direction } from "./converter";

/**
 * Turn a set of files into a reviewable list of edits without touching the vault.
 *
 * Planning is a separate pass from writing so the preview and the applied result are computed from
 * exactly the same code — the user reviews the plan, not a re-derived guess at what will happen.
 */

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

export interface PlannedFile {
  readonly path: string;
  readonly before: string;
  readonly after: string;
  readonly changes: ChangeRecord[];
}

export interface Plan {
  readonly files: PlannedFile[];
  readonly totalChanges: number;
  /** Files that were read but needed no change. */
  readonly skipped: number;
}

export function buildPlan(sources: SourceFile[], direction: Direction, opts: ConvertOptions): Plan {
  const files: PlannedFile[] = [];
  let skipped = 0;

  for (const source of sources) {
    const result = convert(source.content, direction, opts);
    if (result.changes.length === 0 || result.text === source.content) {
      skipped += 1;
      continue;
    }
    files.push({ path: source.path, before: source.content, after: result.text, changes: result.changes });
  }

  return {
    files,
    totalChanges: files.reduce((sum, f) => sum + f.changes.length, 0),
    skipped,
  };
}

/** One-line summary of a single change, for the preview and the result notice. */
export function describeChange(change: ChangeRecord): string {
  return change.kind === "html-img" ? "HTML <img>" : change.kind === "md-image" ? "Markdown" : "双链";
}