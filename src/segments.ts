/**
 * Split a document into regions the converter is allowed to touch and regions it must not.
 *
 * A wiki embed written inside a fenced code block or a YAML frontmatter key is documentation, not
 * an embed — converting it would corrupt the docs that explain the syntax. So the document is cut
 * into alternating segments first, and every rewrite is applied only to `text` segments.
 *
 * Kept free of any Obsidian import: this is the layer that decides "is this real content".
 */

/** Frontmatter, fenced code and inline code are off-limits; everything else is fair game. */
export type SegmentKind = "text" | "frontmatter" | "code";

export interface Segment {
  readonly start: number;
  readonly end: number;
  readonly kind: SegmentKind;
}

const FENCE_RE = /^([ \t]{0,3})(`{3,}|~{3,})(.*)$/;

/**
 * Segment a markdown document.
 *
 * Frontmatter is only recognised at offset 0, matching YAML frontmatter rules: a `---` further down
 * the file is a thematic break or a setext underline, not metadata.
 */
export function segmentDocument(src: string): Segment[] {
  const segments: Segment[] = [];
  const push = (start: number, end: number, kind: SegmentKind): void => {
    if (end > start) segments.push({ start, end, kind });
  };

  let pos = 0;
  const frontmatterEnd = findFrontmatterEnd(src);
  if (frontmatterEnd > 0) {
    push(0, frontmatterEnd, "frontmatter");
    pos = frontmatterEnd;
  }

  // Walk lines, tracking fenced-code state. Text between fences is buffered and later split again
  // for inline code, which is why it is collected rather than pushed immediately.
  const textPieces: Array<[number, number]> = [];
  let cursor = pos;
  let lineStart = pos;
  let fence: { char: string; len: number } | null = null;
  let fenceStart = pos;

  while (lineStart < src.length) {
    let lineEnd = src.indexOf("\n", lineStart);
    if (lineEnd === -1) lineEnd = src.length;
    const nextLineStart = lineEnd < src.length ? lineEnd + 1 : src.length;
    const line = src.slice(lineStart, lineEnd).replace(/\r$/, "");
    const fenceMatch = FENCE_RE.exec(line);

    if (fence === null && fenceMatch) {
      // Opening fence: everything seen so far is real text.
      if (lineStart > cursor) textPieces.push([cursor, lineStart]);
      fenceStart = lineStart;
      fence = { char: fenceMatch[2][0], len: fenceMatch[2].length };
    } else if (fence !== null) {
      const isClosing =
        fenceMatch !== null &&
        fenceMatch[2][0] === fence.char &&
        fenceMatch[2].length >= fence.len &&
        fenceMatch[3].trim() === "";
      if (isClosing) {
        push(fenceStart, nextLineStart, "code");
        fence = null;
        fenceStart = nextLineStart;
        cursor = nextLineStart;
      }
    }

    lineStart = nextLineStart;
  }

  if (fence !== null) {
    // Unterminated fence: the rest of the file is code, which is the safe reading.
    push(fenceStart, src.length, "code");
  } else if (src.length > cursor) {
    textPieces.push([cursor, src.length]);
  }

  for (const [start, end] of textPieces) {
    for (const seg of splitInlineCode(start, src.slice(start, end))) {
      push(seg.start, seg.end, seg.kind);
    }
  }

  return segments.sort((a, b) => a.start - b.start);
}

/** End offset of the leading `---` frontmatter block, or `0` when there is none. */
function findFrontmatterEnd(src: string): number {
  if (!/^---[ \t]*\r?\n/.test(src)) return 0;

  const re = /^(---|\.\.\.)[ \t]*$/gm;
  re.lastIndex = 3;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const after = m.index + m[0].length;
    // The closing delimiter must be followed by end-of-line.
    if (after === src.length || src[after] === "\n" || src[after] === "\r") {
      const nl = src.indexOf("\n", after);
      return nl === -1 ? src.length : nl + 1;
    }
  }
  return 0;
}

/**
 * Split one text region into alternating text / inline-code segments.
 *
 * A run of N backticks is closed by a run of at least N backticks, matching CommonMark closely
 * enough for real notes. An unclosed run is treated as literal text rather than swallowing the
 * rest of the file.
 */
export function splitInlineCode(start: number, text: string): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  let i = 0;

  const pushText = (from: number, to: number): void => {
    if (to > from) out.push({ start: start + from, end: start + to, kind: "text" });
  };

  while (i < text.length) {
    if (text[i] !== "`") {
      i += 1;
      continue;
    }
    let run = 0;
    while (text[i + run] === "`") run += 1;

    const closing = findClosingBacktickRun(text, i + run, run);
    if (closing === -1) {
      i += run;
      continue;
    }

    pushText(cursor, i);
    out.push({ start: start + i, end: start + closing + run, kind: "code" });
    cursor = closing + run;
    i = cursor;
  }

  pushText(cursor, text.length);
  return out;
}

/** Index of the backtick run of length >= `len` starting at or after `from`, or -1. */
function findClosingBacktickRun(text: string, from: number, len: number): number {
  for (let i = from; i < text.length; i += 1) {
    if (text[i] !== "`") continue;
    let run = 0;
    while (text[i + run] === "`") run += 1;
    if (run >= len) return i;
    i += run - 1;
  }
  return -1;
}