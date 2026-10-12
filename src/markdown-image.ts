/**
 * Parsers for the *Markdown* half of the conversion.
 *
 * These are hand-written scanners rather than regular expressions for one concrete reason: filenames
 * containing parentheses are extremely common in real vaults (`Screenshot (1).png`), and the usual
 * `!\[[^\]]*\]\(([^)]*)\)` pattern truncates the URL at the first `)` and silently corrupts the
 * link. Everything here reports character offsets so a caller can rebuild the document by splicing.
 */

/** A parsed `![alt](url "title")` construct. Offsets are absolute in the scanned source. */
export interface MarkdownImage {
  readonly start: number;
  readonly end: number;
  /** Text between `![` and `]`. May itself carry an Obsidian `|300` size hint. */
  readonly alt: string;
  /** Link destination with any `<>` wrapping removed. */
  readonly url: string;
  readonly title: string | null;
}

/** A parsed raw HTML `<img ...>` tag. Offsets are absolute in the scanned source. */
export interface HtmlImage {
  readonly start: number;
  readonly end: number;
  readonly src: string;
  readonly alt: string | null;
  /** Plain integer pixel values only; a `%` or unit-suffixed value yields `null`. */
  readonly width: number | null;
  readonly height: number | null;
  /**
   * True when the tag carries a dimension that cannot be expressed as an Obsidian size hint: a
   * non-integer value (`50%`, `12em`), or a height with no width to pair it with. Such a tag is
   * left alone rather than silently rewritten to an unsized embed.
   */
  readonly unsupportedSize: boolean;
}

const WHITESPACE_RE = /\s/;

/**
 * Yield every Markdown image in `text[from, to)`.
 *
 * Only quoted titles (`"..."` / `'...'`) are recognised. A parenthesised title is not supported:
 * it is indistinguishable from a parenthesised filename, and guessing wrong rewrites working links.
 */
export function* iterateMarkdownImages(
  text: string,
  from = 0,
  to = text.length
): Generator<MarkdownImage> {
  let i = from;
  while (i < to) {
    const start = text.indexOf("![", i);
    if (start === -1 || start + 2 > to) return;

    const altEnd = text.indexOf("]", start + 2);
    if (altEnd === -1 || altEnd >= to) return;
    // Anything other than an immediately following `(` is a reference-style image (`![a][b]`)
    // or a bare `![a]`, neither of which this plugin rewrites.
    if (text[altEnd + 1] !== "(") {
      i = start + 2;
      continue;
    }

    const dest = readDestination(text, altEnd + 1, to);
    if (!dest) {
      i = start + 2;
      continue;
    }

    yield {
      start,
      end: dest.end,
      alt: text.slice(start + 2, altEnd),
      url: dest.url,
      title: dest.title,
    };
    i = dest.end;
  }
}

interface Destination {
  readonly url: string;
  readonly title: string | null;
  /** Offset just past the closing `)`. */
  readonly end: number;
}

/**
 * Read a link destination starting at the `(` in `text[openParen, to)`.
 *
 * Balances nested parentheses so `![a](f (1).png)` yields the whole path, and accepts both the
 * CommonMark `<url with spaces>` form and a bare unescaped URL containing spaces, which is what
 * several export tools emit.
 */
function readDestination(text: string, openParen: number, to: number): Destination | null {
  let depth = 1;
  let i = openParen + 1;
  const rawStart = i;

  while (i < to) {
    const c = text[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) break;
    }
    i += 1;
  }

  if (depth !== 0 || i >= to) return null; // unterminated
  const raw = text.slice(rawStart, i);

  // Split a trailing quoted title off the destination. Lazy URL + optional title means the engine
  // only takes a title when the remainder really does look like one.
  const titleMatch = /^(.*?)(\s+(?:"[^"]*"|'[^']*'))?$/s.exec(raw);
  if (!titleMatch) return null;
  const urlPart = titleMatch[1].trim();
  const title = titleMatch[2] === undefined ? null : titleMatch[2].trim().slice(1, -1);

  const url =
    urlPart.startsWith("<") && urlPart.endsWith(">") && urlPart.length >= 2
      ? urlPart.slice(1, -1)
      : urlPart;

  if (url.length === 0) return null;
  return { url, title, end: i + 1 };
}

/** Yield every raw `<img>` tag in `text[from, to)`. */
export function* iterateHtmlImages(text: string, from = 0, to = text.length): Generator<HtmlImage> {
  const re = /<img\b[^>]*>/gi;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index >= to) return;
    const attrs = parseAttributes(m[0]);
    const src = attrs.src ?? null;
    if (src === null || src.length === 0) continue;
    const width = parsePixelValue(attrs.width);
    const height = parsePixelValue(attrs.height);
    yield {
      start: m.index,
      end: m.index + m[0].length,
      src,
      alt: attrs.alt ?? null,
      width,
      height,
      unsupportedSize:
        (attrs.width !== undefined && width === null) ||
        (attrs.height !== undefined && height === null) ||
        (attrs.height !== undefined && attrs.width === undefined),
    };
  }
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) {
    const key = m[1].toLowerCase();
    if (key in attrs) continue; // first occurrence wins, as browsers do
    attrs[key] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

/** Integer pixel size, or `null` for `%`, `em`, unit-suffixed or missing values. */
function parsePixelValue(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}