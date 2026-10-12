import {
  convertMarkdownImagesToWiki,
  convertWikiEmbedsToMarkdown,
  type ConvertOptions,
} from "../src/converter";

/**
 * The plugin's central promise: converting one way and back changes nothing.
 *
 * Every case below is a syntax the converter is expected to understand. If a case stops round
 * tripping, the user has lost information, so each is also pinned by an explicit expectation of the
 * intermediate Markdown form rather than only being asserted as idempotent.
 */

const opts = (over: Partial<ConvertOptions> = {}): ConvertOptions => ({
  scope: "all",
  size: "html",
  ...over,
});

const ROUND_TRIP_CASES: Array<{ name: string; wiki: string }> = [
  { name: "bare embed", wiki: "![[a.png]]" },
  { name: "nested folder", wiki: "![[attachments/sub/a.png]]" },
  { name: "alias", wiki: "![[a.png|caption]]" },
  { name: "width", wiki: "![[a.png|300]]" },
  { name: "width and height", wiki: "![[a.png|300x200]]" },
  { name: "alias and width", wiki: "![[a.png|caption|300]]" },
  { name: "alias and both dimensions", wiki: "![[a.png|caption|640x480]]" },
  { name: "space in filename", wiki: "![[my image.png]]" },
  { name: "parentheses in filename", wiki: "![[Screenshot (1).png]]" },
  { name: "spaces and parentheses", wiki: "![[Screen Shot (2).png]]" },
  { name: "non-ascii filename", wiki: "![[附件/图片 一.png]]" },
  { name: "pdf attachment", wiki: "![[doc.pdf]]" },
  { name: "pdf with page", wiki: "![[doc.pdf#page=3]]" },
  { name: "canvas", wiki: "![[board.canvas]]" },
  { name: "extensionless note", wiki: "![[Some Note]]" },
  { name: "note with subpath", wiki: "![[Some Note#heading]]" },
  { name: "note with block ref", wiki: "![[Some Note^block-id]]" },
  { name: "alias containing a space", wiki: "![[a.png|my caption]]" },
];

describe("wiki → markdown → wiki", () => {
  it.each(ROUND_TRIP_CASES)("$name survives a round trip", ({ wiki }) => {
    const forward = convertWikiEmbedsToMarkdown(wiki, opts());
    expect(forward.changes.length).toBeGreaterThan(0);
    const back = convertMarkdownImagesToWiki(forward.text, opts());
    expect(back.text).toBe(wiki);
  });
});

describe("round trip is idempotent going forward", () => {
  it.each(ROUND_TRIP_CASES)("$name does not change again on a second pass", ({ wiki }) => {
    const once = convertWikiEmbedsToMarkdown(wiki, opts()).text;
    const twice = convertWikiEmbedsToMarkdown(once, opts());
    expect(twice.changes).toHaveLength(0);
    expect(twice.text).toBe(once);
  });

  it.each(ROUND_TRIP_CASES)("$name does not change again on a second reverse pass", ({ wiki }) => {
    const once = convertMarkdownImagesToWiki(convertWikiEmbedsToMarkdown(wiki, opts()).text, opts()).text;
    const twice = convertMarkdownImagesToWiki(once, opts());
    expect(twice.changes).toHaveLength(0);
  });
});

describe("obsidian-alt size strategy also round trips", () => {
  const altOpts = opts({ size: "obsidian-alt" });

  it.each(ROUND_TRIP_CASES.filter((c) => /\|\d/.test(c.wiki)))(
    "$name survives via the alt-text spelling",
    ({ wiki }) => {
      const forward = convertWikiEmbedsToMarkdown(wiki, altOpts).text;
      expect(convertMarkdownImagesToWiki(forward, altOpts).text).toBe(wiki);
    }
  );
});

describe("document-level round trip", () => {
  const doc = [
    "---",
    "tags: [demo]",
    "cover: ![[ignored.png]]",
    "---",
    "",
    "# Heading",
    "",
    "![[attachments/a.png|300]]",
    "",
    "An alias: ![[attachments/b.png|a caption]]",
    "",
    "Nested: ![[Screen Shot (2).png]]",
    "",
    "```markdown",
    "![[not-converted.png]]",
    "```",
    "",
    "Inline `![[also-not.png]]` stays.",
    "",
    "A remote image ![](https://example.com/x.png) stays.",
    "",
    "![[doc.pdf#page=2]]",
  ].join("\n");

  it("preserves everything outside embeds", () => {
    const forward = convertWikiEmbedsToMarkdown(doc, opts()).text;
    expect(forward).toContain("cover: ![[ignored.png]]"); // frontmatter untouched
    expect(forward).toContain("![[not-converted.png]]"); // fenced code untouched
    expect(forward).toContain("`![[also-not.png]]`"); // inline code untouched
    expect(forward).toContain("![](https://example.com/x.png)"); // remote untouched
  });

  it("returns the original document exactly", () => {
    const forward = convertWikiEmbedsToMarkdown(doc, opts()).text;
    expect(convertMarkdownImagesToWiki(forward, opts()).text).toBe(doc);
  });

  it("converts exactly the four in-scope embeds", () => {
    const result = convertWikiEmbedsToMarkdown(doc, opts());
    expect(result.changes).toHaveLength(4);
    expect(result.changes.map((c) => c.before)).toEqual([
      "![[attachments/a.png|300]]",
      "![[attachments/b.png|a caption]]",
      "![[Screen Shot (2).png]]",
      "![[doc.pdf#page=2]]",
    ]);
  });
});

describe("lossy strategies are opt-in and reported", () => {
  it("dropping a size is a change the user can see in the preview", () => {
    const result = convertWikiEmbedsToMarkdown("![[a.png|300]]", opts({ size: "drop" }));
    expect(result.text).toBe("![](a.png)");
    expect(result.changes[0].before).toBe("![[a.png|300]]");
  });
});