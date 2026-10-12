/**
 * The conversion engine: `![[wiki embed]]` ⇄ `![alt](url)`, both directions.
 *
 * Pure functions over strings. Nothing here touches the Obsidian API, so the whole rewriting
 * contract is unit-testable without a vault, which is where the risk in this plugin actually lives.
 *
 * The design rule throughout is **preservation**: a link's path is carried across verbatim. This
 * plugin changes the *syntax* of an embed, never its destination, because a destination rewrite is
 * the one transformation that can silently break a link for good.
 */

import { classifyPath, type TargetKind } from "./constants";
import { iterateHtmlImages, iterateMarkdownImages } from "./markdown-image";
import { segmentDocument } from "./segments";
import {
  buildWikiEmbed,
  formatSize,
  isRemoteUrl,
  parseWikiEmbed,
  splitAltSize,
  WIKI_EMBED_RE,
  type EmbedSize,
} from "./wiki-embed";

export type Direction = "wiki-to-md" | "md-to-wiki";

/**
 * Which link targets participate in a run.
 *
 * - `image-only` — images only. The default, and the only lossless scope.
 * - `image-and-attachments` — adds PDF, audio, video, canvases and data files, but never notes.
 * - `all` — also converts note transclusions. This changes what a note *renders* as, so it is
 *   opt-in and surfaced in the preview.
 */
export type EmbedScope = "image-only" | "image-and-attachments" | "all";

/** What happens to an Obsidian size hint when a wiki embed becomes a Markdown image. */
export type SizeStrategy =
  /** Emit `<img src="..." width="300">`. Renders anywhere HTML is allowed, reverses cleanly. */
  | "html"
  /** Drop the hint. Simplest output, silently loses sizing. */
  | "drop"
  /** Emit Obsidian's own `![alt|300](url)` spelling. Reversible, but not portable Markdown. */
  | "obsidian-alt";

export interface ConvertOptions {
  readonly scope: EmbedScope;
  readonly size: SizeStrategy;
}

export interface ChangeRecord {
  readonly kind: "wiki-embed" | "md-image" | "html-img";
  readonly before: string;
  readonly after: string;
  /** Character offset of the change in the source document. */
  readonly offset: number;
}

export interface ConvertResult {
  readonly text: string;
  readonly changes: ChangeRecord[];
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly after: string;
  readonly kind: ChangeRecord["kind"];
}

/** Scope gate. `other` (no extension, e.g. `![[My Note]]`) is treated as a note. */
export function isInScope(kind: TargetKind, scope: EmbedScope): boolean {
  if (kind === "image") return true;
  if (kind === "attachment") return scope !== "image-only";
  // `note` and `other`
  return scope === "all";
}

export const DEFAULT_OPTIONS: ConvertOptions = { scope: "image-only", size: "html" };

/** Convert Obsidian wiki embeds to Markdown image syntax. */
export function convertWikiEmbedsToMarkdown(src: string, opts: ConvertOptions): ConvertResult {
  const edits: Edit[] = [];

  for (const seg of segmentDocument(src)) {
    if (seg.kind !== "text") continue;
    const re = new RegExp(WIKI_EMBED_RE.source, "g");
    re.lastIndex = seg.start;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      // A match must lie wholly inside this segment. An embed whose text runs into a code span is
      // not a real embed, so it is left for the next pass rather than half-rewritten.
      if (m.index + m[0].length > seg.end) break;
      const embed = parseWikiEmbed(m[1]);
      if (!embed) continue;

      const kind = classifyPath(embed.target);
      if (!isInScope(kind, opts.scope)) continue;

      const after = buildMarkdownImage(embed.target + embed.subpath, embed.alias, embed.size, opts);
      if (after === null) continue; // destination cannot be represented safely; leave it alone
      edits.push({ start: m.index, end: m.index + m[0].length, after, kind: "wiki-embed" });
    }
  }

  return applyEdits(src, edits);
}

/** Convert Markdown image syntax (and raw HTML `<img>`) to Obsidian wiki embeds. */
export function convertMarkdownImagesToWiki(src: string, opts: ConvertOptions): ConvertResult {
  const edits: Edit[] = [];

  for (const seg of segmentDocument(src)) {
    if (seg.kind !== "text") continue;

    for (const img of iterateMarkdownImages(src, seg.start, seg.end)) {
      // A title cannot survive the move to `[[target|alias]]`, so those links are left untouched
      // rather than rewritten with the title silently dropped.
      if (img.title !== null) continue;
      if (isRemoteUrl(img.url)) continue;

      const { alias, size } = splitAltSize(img.alt);
      const { bare, subpath } = splitSubpath(img.url);
      if (!isInScope(classifyPath(bare), opts.scope)) continue;

      const params: string[] = [];
      if (alias) params.push(alias);
      if (size) params.push(formatSize(size));
      edits.push({
        start: img.start,
        end: img.end,
        after: buildWikiEmbed(bare + subpath, params),
        kind: "md-image",
      });
    }

    for (const img of iterateHtmlImages(src, seg.start, seg.end)) {
      if (img.unsupportedSize) continue;
      if (isRemoteUrl(img.src)) continue;

      const { bare, subpath } = splitSubpath(img.src);
      if (!isInScope(classifyPath(bare), opts.scope)) continue;

      const params: string[] = [];
      if (img.alt) params.push(img.alt);
      if (img.width !== null || img.height !== null) {
        params.push(
          formatSize({
            ...(img.width !== null ? { width: img.width } : {}),
            ...(img.height !== null ? { height: img.height } : {}),
          })
        );
      }
      edits.push({
        start: img.start,
        end: img.end,
        after: buildWikiEmbed(bare + subpath, params),
        kind: "html-img",
      });
    }
  }

  return applyEdits(src, edits);
}

/** Dispatch on direction. */
export function convert(src: string, direction: Direction, opts: ConvertOptions): ConvertResult {
  return direction === "wiki-to-md"
    ? convertWikiEmbedsToMarkdown(src, opts)
    : convertMarkdownImagesToWiki(src, opts);
}

/**
 * Render a wiki embed as a Markdown image.
 *
 * Returns `null` when the destination cannot be expressed without risking a broken link, so the
 * caller can leave the original embed in place instead of writing something worse.
 */
function buildMarkdownImage(
  url: string,
  alias: string,
  size: EmbedSize | null,
  opts: ConvertOptions
): string | null {
  const href = formatUrl(url);
  if (href === null) return null;

  if (!size || opts.size === "drop") {
    return `![${alias}](${href})`;
  }
  if (opts.size === "obsidian-alt") {
    // The `|` is kept even with an empty alias: `![|300](a.png)` is unambiguous, whereas
    // `![300](a.png)` reads back as an alt text of "300" and would not survive the round trip.
    return `![${alias}|${formatSize(size)}](${href})`;
  }

  const attrs = [`src="${escapeAttribute(url)}"`];
  if (alias) attrs.push(`alt="${escapeAttribute(alias)}"`);
  if (size.width !== undefined) attrs.push(`width="${size.width}"`);
  if (size.height !== undefined) attrs.push(`height="${size.height}"`);
  return `<img ${attrs.join(" ")}>`;
}

/**
 * Wrap a destination so spaces and parentheses survive.
 *
 * `<...>` is used rather than backslash escaping because it is CommonMark, because Obsidian accepts
 * it, and because it reverses to the original string with no unescaping pass. A destination that
 * itself contains angle brackets cannot be represented, and yields `null`.
 */
export function formatUrl(url: string): string | null {
  if (/[<>\r\n]/.test(url)) return null;
  if (/[\s()]/.test(url)) return `<${url}>`;
  return url;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** Split `#heading` / `^block` off a link destination, keeping the sigil. */
export function splitSubpath(url: string): { bare: string; subpath: string } {
  const m = /^([^#^]*)([#^][\s\S]*)?$/.exec(url);
  if (!m) return { bare: url, subpath: "" };
  return { bare: m[1], subpath: m[2] ?? "" };
}

/** Splice edits into the source. Edits are applied in one pass, left to right. */
function applyEdits(src: string, edits: Edit[]): ConvertResult {
  if (edits.length === 0) return { text: src, changes: [] };

  edits.sort((a, b) => a.start - b.start);
  const changes: ChangeRecord[] = [];
  let out = "";
  let cursor = 0;

  for (const edit of edits) {
    if (edit.start < cursor) continue; // overlapping match, keep the first
    out += src.slice(cursor, edit.start);
    out += edit.after;
    changes.push({
      kind: edit.kind,
      before: src.slice(edit.start, edit.end),
      after: edit.after,
      offset: edit.start,
    });
    cursor = edit.end;
  }
  out += src.slice(cursor);

  return { text: out, changes };
}