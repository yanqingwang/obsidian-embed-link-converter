/**
 * Parsers and builders for Obsidian wiki-link embeds.
 *
 * Parameter order matters here and is not arbitrary: Obsidian reads `![[image.jpg|caption|300]]`,
 * alias first, then the size. Verified against the 0.9.4 release notes quoted on the Obsidian
 * forum (`![AltText|100x100](image.png)` for Markdown images, `![[image|100x100]]` for embeds) and
 * against the `obsidian-image-captions` README, which documents `![[image.jpg|caption|center]]`.
 * Both agree, so that order is what this module writes and expects.
 */

/** An image dimension hint. Either or both may be present. */
export interface EmbedSize {
  readonly width?: number;
  readonly height?: number;
}

export interface ParsedWikiEmbed {
  /** The whole `![[...]]` token. */
  readonly raw: string;
  /** Link destination as written, trimmed — Obsidian ignores surrounding whitespace here. */
  readonly target: string;
  /** `#heading`, `^block` or `#page=3` suffix, including the sigil. Empty when absent. */
  readonly subpath: string;
  /** The first non-numeric parameter, i.e. the caption/alias. */
  readonly alias: string;
  /** The first numeric parameter (`300` or `300x200`). */
  readonly size: EmbedSize | null;
}

/** Matches a wiki embed. Newlines are excluded because Obsidian links never span lines. */
export const WIKI_EMBED_RE = /!\[\[([^[\]\n]+)\]\]/g;

/** Numeric size parameter: `300` or `300x200`. */
const SIZE_RE = /^(\d+)(?:[xX](\d+))?$/;

/**
 * Split the inside of a `![[...]]` into its destination and parameters.
 *
 * Returns `null` for an empty destination, which is not a usable link.
 */
export function parseWikiEmbed(inner: string): ParsedWikiEmbed | null {
  const raw = `![[${inner}]]`;
  const parts = inner.split("|");
  const target = parts[0].trim();
  if (target.length === 0) return null;

  let alias = "";
  let size: EmbedSize | null = null;
  for (const rawParam of parts.slice(1)) {
    const param = rawParam.trim();
    if (param.length === 0) continue;
    if (!size) {
      const sizeMatch = SIZE_RE.exec(param);
      if (sizeMatch) {
        size = sizeMatch[2]
          ? { width: Number(sizeMatch[1]), height: Number(sizeMatch[2]) }
          : { width: Number(sizeMatch[1]) };
        continue;
      }
    }
    if (!alias) alias = param;
  }

  const subpathMatch = /^([^#^]*)([#^][\s\S]*)?$/.exec(target);
  const path = subpathMatch ? subpathMatch[1] : target;
  const subpath = (subpathMatch && subpathMatch[2]) || "";

  return { raw, target: path, subpath, alias, size };
}

/** Reassemble a wiki embed from a destination plus ordered parameters. */
export function buildWikiEmbed(target: string, params: string[]): string {
  const kept = params.filter((p) => p.length > 0);
  return `![[${[target, ...kept].join("|")}]]`;
}

/** Render a size hint back to Obsidian's `300` / `300x200` form. */
export function formatSize(size: EmbedSize): string {
  return size.height === undefined ? String(size.width) : `${size.width}x${size.height}`;
}

/**
 * Pull an Obsidian `|300` hint out of a Markdown alt attribute.
 *
 * `![alt|300](img.png)` is Obsidian's own Markdown spelling of a size hint, so the
 * `obsidian-alt` size strategy stays reversible through this.
 */
export function splitAltSize(alt: string): { alias: string; size: EmbedSize | null } {
  const pipe = alt.lastIndexOf("|");
  if (pipe === -1) return { alias: alt, size: null };
  const sizeMatch = SIZE_RE.exec(alt.slice(pipe + 1).trim());
  if (!sizeMatch) return { alias: alt, size: null };
  const size = sizeMatch[2]
    ? { width: Number(sizeMatch[1]), height: Number(sizeMatch[2]) }
    : { width: Number(sizeMatch[1]) };
  return { alias: alt.slice(0, pipe), size };
}

/**
 * True for links Obsidian resolves to a real vault file rather than a remote resource.
 *
 * A bare `C:`-style path would also match, but Obsidian link targets are vault-relative, so a
 * single-letter scheme is not a realistic collision.
 */
export function isRemoteUrl(url: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) || url.startsWith("//");
}