import { segmentDocument, splitInlineCode } from "../src/segments";

/** Concatenate the text segments — what the converter is allowed to rewrite. */
const textOf = (src: string): string =>
  segmentDocument(src)
    .filter((s) => s.kind === "text")
    .map((s) => src.slice(s.start, s.end))
    .join("");

describe("frontmatter", () => {
  it("protects a leading yaml block", () => {
    const src = "---\ntags: [a]\n---\n\nbody\n";
    const segs = segmentDocument(src);
    expect(segs[0]).toMatchObject({ kind: "frontmatter", start: 0 });
    // Ends just past the closing delimiter's newline; the blank line after it is body text.
    expect(src.slice(segs[0].start, segs[0].end)).toBe("---\ntags: [a]\n---\n");
  });

  it("only treats --- at offset 0 as frontmatter", () => {
    const src = "intro\n---\nnot frontmatter\n";
    expect(segmentDocument(src).some((s) => s.kind === "frontmatter")).toBe(false);
  });

  it("handles a document that is only frontmatter", () => {
    expect(textOf("---\na: 1\n---\n")).toBe("");
  });

  it("treats an unterminated frontmatter block as a thematic break, as Obsidian does", () => {
    // Obsidian renders a lone leading `---` as a horizontal rule, so the lines after it are body
    // text rather than metadata. Matching that means a note with malformed frontmatter still gets
    // its embeds converted, instead of being silently skipped.
    const src = "---\na: 1\n";
    expect(textOf(src)).toBe(src);
  });

  it("accepts --- with trailing spaces and a --- close", () => {
    expect(textOf("--- \na: 1\n--- \nbody")).toBe("body");
  });

  it("treats an empty file as a single empty region", () => {
    expect(segmentDocument("")).toEqual([]);
  });
});

describe("fenced code", () => {
  it("protects a fenced block", () => {
    // The fence's own lines belong to the code segment, newline included, so no blank line is
    // left behind where the fence used to be.
    const src = "before\n```\n![[a.png]]\n```\nafter\n";
    expect(textOf(src)).toBe("before\nafter\n");
  });

  it("protects a tilde fence", () => {
    const src = "~~~\n![[a.png]]\n~~~\n";
    expect(textOf(src)).toBe("");
  });

  it("allows a longer closing fence", () => {
    const src = "````\n![[a.png]]\n````\n";
    expect(textOf(src)).toBe("");
  });

  it("does not close a backtick fence with a tilde fence", () => {
    const src = "```\n~~~\n![[a.png]]\n```\n";
    expect(textOf(src)).toBe("");
  });

  it("treats an unterminated fence as running to end of file", () => {
    expect(textOf("```\n![[a.png]]\n")).toBe("");
  });

  it("protects an indented fence", () => {
    expect(textOf("  ```\n  ![[a.png]]\n  ```\n")).toBe("");
  });

  it("leaves an inline hash after the opening fence alone", () => {
    const src = "```js\nconst a = 1;\n```\n";
    expect(textOf(src)).toBe("");
  });
});

describe("inline code", () => {
  it("protects a single-backtick span", () => {
    expect(textOf("a `![[x.png]]` b")).toBe("a  b");
  });

  it("protects a double-backtick span containing single backticks", () => {
    const src = "``a ` b ![[x.png]]`` tail";
    expect(textOf(src)).toBe(" tail");
  });

  it("does not let an unclosed backtick swallow the document", () => {
    expect(textOf("a ` b ![[x.png]]")).toBe("a ` b ![[x.png]]");
  });

  it("leaves a lone backtick as text", () => {
    expect(splitInlineCode(0, "`")).toEqual([{ start: 0, end: 1, kind: "text" }]);
  });

  it("reports absolute offsets", () => {
    expect(splitInlineCode(10, "ab`c`")).toEqual([
      { start: 10, end: 12, kind: "text" },
      { start: 12, end: 15, kind: "code" },
      { start: 15, end: 15, kind: "text" },
    ].filter((s) => s.end > s.start));
  });
});

describe("coverage", () => {
  it("produces contiguous non-overlapping segments", () => {
    const src = "---\na: 1\n---\n\ntext `x` more\n\n```\ncode\n```\n\nend\n";
    const segs = segmentDocument(src);
    for (let i = 1; i < segs.length; i += 1) {
      expect(segs[i].start).toBeGreaterThanOrEqual(segs[i - 1].end);
    }
    expect(segs[0].start).toBe(0);
    expect(segs[segs.length - 1].end).toBeLessThanOrEqual(src.length);
  });

  it("covers code spans inside a text run without gaps", () => {
    const src = "one `a` two `b` three";
    const kinds = segmentDocument(src).map((s) => s.kind);
    expect(kinds).toEqual(["text", "code", "text", "code", "text"]);
  });
});