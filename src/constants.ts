/**
 * File-extension knowledge used to decide what a link target actually is.
 *
 * A wiki embed like `![[report.pdf#page=3]]` has no extension on the bare path; everything the
 * converter needs to classify it lives here, kept apart from the rewriting logic so the policy
 * (which extensions are in scope) is readable in one place.
 */

/** Raster and vector images. These are the default conversion target. */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
  "apng",
  "ico",
  "tif",
  "tiff",
  "heic",
]);

/**
 * Non-image attachments Obsidian can embed: audio, video, PDF, canvases, plain data files.
 * Enabled only when the scope is `image-and-attachments` or `all`.
 */
export const ATTACHMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  "pdf",
  "mp3",
  "m4a",
  "wav",
  "ogg",
  "oga",
  "flac",
  "aac",
  "mp4",
  "m4v",
  "webm",
  "mov",
  "avi",
  "mkv",
  "canvas",
  "webarchive",
  "txt",
  "csv",
  "tsv",
  "json",
  "xlsx",
  "docx",
  "pptx",
  "zip",
]);

/** Notes. Embedding one is a transclusion, which the `all` scope allows and the others do not. */
export const NOTE_EXTENSIONS: ReadonlySet<string> = new Set(["md", "markdown"]);

/** How a link target is classified. */
export type TargetKind = "image" | "attachment" | "note" | "other";

/**
 * Lowercased extension of a bare path, without the dot. Returns `""` when there is none.
 *
 * A leading dot does not count as a separator, so `.gitignore` has no extension — which is the
 * behaviour Obsidian itself has, since a dotfile is a name rather than an extension.
 */
export function extensionOf(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  const name = path.slice(lastSlash + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** Classify a bare link path (no `#heading` / `^block` suffix) by its extension. */
export function classifyPath(path: string): TargetKind {
  const ext = extensionOf(path);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (NOTE_EXTENSIONS.has(ext)) return "note";
  if (ATTACHMENT_EXTENSIONS.has(ext)) return "attachment";
  return "other";
}