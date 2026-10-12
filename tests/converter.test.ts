import {
  convertMarkdownImagesToWiki,
  convertWikiEmbedsToMarkdown,
  formatUrl,
  isInScope,
  splitSubpath,
  type ConvertOptions,
  type SizeStrategy,
} from "../src/converter";

const opts = (over: Partial<ConvertOptions> = {}): ConvertOptions => ({
  scope: "image-only",
  size: "html",
  ...over,
});

const w2m = (src: string, over: Partial<ConvertOptions> = {}) =>
  convertWikiEmbedsToMarkdown(src, opts(over)).text;

const m2w = (src: string, over: Partial<ConvertOptions> = {}) =>
  convertMarkdownImagesToWiki(src, opts(over)).text;

describe("wiki embed → markdown", () => {
  it("converts a bare embed", () => {
    expect(w2m("![[a.png]]")).toBe("![](a.png)");
    expect(w2m("![[folder/sub/a.png]]")).toBe("![](folder/sub/a.png)");
  });

  it("converts several embeds in one document", () => {
    expect(w2m("![[a.png]]\n\ntext\n\n![[b.png]]")).toBe("![](a.png)\n\ntext\n\n![](b.png)");
  });

  it("turns an alias into alt text", () => {
    // An alias with no size hint is ordinary alt text, so no HTML tag is needed.
    expect(w2m("![[a.png|caption]]")).toBe("![caption](a.png)");
    expect(w2m("![[a.png|caption|300]]")).toBe('<img src="a.png" alt="caption" width="300">');
  });

  it("renders a width hint as an HTML img tag", () => {
    expect(w2m("![[a.png|300]]")).toBe('<img src="a.png" width="300">');
    expect(w2m("![[a.png|300x200]]")).toBe('<img src="a.png" width="300" height="200">');
  });

  it("emits alias before size, matching Obsidian's parameter order", () => {
    expect(w2m("![[a.png|caption|300]]")).toBe('<img src="a.png" alt="caption" width="300">');
  });

  it("wraps paths containing spaces or parentheses in angle brackets", () => {
    expect(w2m("![[my image.png]]")).toBe("![](<my image.png>)");
    expect(w2m("![[Screenshot (1).png]]")).toBe("![](<Screenshot (1).png>)");
  });

  it("refuses destinations that cannot be represented safely", () => {
    expect(formatUrl("a<b.png")).toBeNull();
    expect(w2m("![[a<b.png]]")).toBe("![[a<b.png]]");
  });

  it("preserves a heading or block subpath", () => {
    expect(w2m("![[a.png#section]]")).toBe("![](a.png#section)");
    expect(w2m("![[Note#heading]]", { scope: "all" })).toBe("![](Note#heading)");
  });

  it("honours the size strategy", () => {
    expect(w2m("![[a.png|300]]", { size: "drop" })).toBe("![](a.png)");
    expect(w2m("![[a.png|300]]", { size: "obsidian-alt" })).toBe("![|300](a.png)");
    expect(w2m("![[a.png|cap|300]]", { size: "obsidian-alt" })).toBe("![cap|300](a.png)");
  });

  it("trims whitespace inside the brackets, as Obsidian does", () => {
    expect(w2m("![[  a.png  ]]")).toBe("![](a.png)");
  });
});

describe("scope gate", () => {
  it("converts images under every scope", () => {
    for (const scope of ["image-only", "image-and-attachments", "all"] as const) {
      expect(w2m("![[a.png]]", { scope })).toBe("![](a.png)");
    }
  });

  it("leaves attachments alone unless asked", () => {
    expect(w2m("![[doc.pdf]]")).toBe("![[doc.pdf]]");
    expect(w2m("![[doc.pdf]]", { scope: "image-and-attachments" })).toBe("![](doc.pdf)");
    expect(w2m("![[clip.mp4]]", { scope: "image-and-attachments" })).toBe("![](clip.mp4)");
    expect(w2m("![[board.canvas]]", { scope: "image-and-attachments" })).toBe("![](board.canvas)");
  });

  it("never converts note transclusions unless scope is all", () => {
    expect(w2m("![[Note]]")).toBe("![[Note]]");
    expect(w2m("![[Note.md]]", { scope: "image-and-attachments" })).toBe("![[Note.md]]");
    expect(w2m("![[Note.md]]", { scope: "all" })).toBe("![](Note.md)");
    // An extensionless note is only known to be a note by exclusion.
    expect(w2m("![[Note]]", { scope: "all" })).toBe("![](Note)");
  });

  it("exposes the gate directly", () => {
    expect(isInScope("image", "image-only")).toBe(true);
    expect(isInScope("attachment", "image-only")).toBe(false);
    expect(isInScope("attachment", "image-and-attachments")).toBe(true);
    expect(isInScope("note", "image-and-attachments")).toBe(false);
    expect(isInScope("note", "all")).toBe(true);
    expect(isInScope("other", "all")).toBe(true);
    expect(isInScope("other", "image-and-attachments")).toBe(false);
  });
});

describe("markdown → wiki embed", () => {
  it("converts a bare image", () => {
    expect(m2w("![](a.png)")).toBe("![[a.png]]");
    expect(m2w("![](folder/sub/a.png)")).toBe("![[folder/sub/a.png]]");
  });

  it("converts alt text to an alias", () => {
    expect(m2w("![caption](a.png)")).toBe("![[a.png|caption]]");
  });

  it("converts an HTML img back to a sized embed", () => {
    expect(m2w('<img src="a.png" width="300">')).toBe("![[a.png|300]]");
    expect(m2w('<img src="a.png" width="300" height="200">')).toBe("![[a.png|300x200]]");
    expect(m2w('<img src="a.png" alt="cap" width="300">')).toBe("![[a.png|cap|300]]");
  });

  it("reads Obsidian's own alt-text size hint", () => {
    expect(m2w("![|300](a.png)")).toBe("![[a.png|300]]");
    expect(m2w("![cap|300](a.png)")).toBe("![[a.png|cap|300]]");
  });

  it("unwraps angle-bracketed destinations", () => {
    expect(m2w("![](<my image.png>)")).toBe("![[my image.png]]");
    expect(m2w("![](<Screenshot (1).png>)")).toBe("![[Screenshot (1).png]]");
  });

  it("handles parentheses inside a bare destination", () => {
    expect(m2w("![alt](Screenshot (1).png)")).toBe("![[Screenshot (1).png|alt]]");
  });

  it("leaves remote and data URLs alone", () => {
    for (const url of ["https://x.com/a.png", "http://x.com/a.png", "data:image/png;base64,AAA"]) {
      expect(m2w(`![](${url})`)).toBe(`![](${url})`);
    }
    expect(m2w('<img src="https://x.com/a.png">')).toBe('<img src="https://x.com/a.png">');
  });

  it("leaves reference-style images alone", () => {
    expect(m2w("![a][ref]")).toBe("![a][ref]");
    expect(m2w("![a]")).toBe("![a]");
  });

  it("leaves titled images alone rather than dropping the title", () => {
    expect(m2w('![a](a.png "Title")')).toBe('![a](a.png "Title")');
    expect(m2w("![a](a.png 'Title')")).toBe("![a](a.png 'Title')");
  });

  it("skips html images whose dimensions cannot round trip", () => {
    expect(m2w('<img src="a.png" width="50%">')).toBe('<img src="a.png" width="50%">');
    expect(m2w('<img src="a.png" height="200">')).toBe('<img src="a.png" height="200">');
  });

  it("respects scope in both directions", () => {
    expect(m2w("![](doc.pdf)")).toBe("![](doc.pdf)");
    expect(m2w("![](doc.pdf)", { scope: "image-and-attachments" })).toBe("![[doc.pdf]]");
    expect(m2w("![cap](note.md)", { scope: "all" })).toBe("![[note.md|cap]]");
  });

  it("does not touch embeds that are already wiki links", () => {
    expect(m2w("![[a.png]]")).toBe("![[a.png]]");
    expect(m2w('<img src="a.png">')).toBe("![[a.png]]");
  });
});

describe("change reporting", () => {
  it("records one change per rewrite with before and after text", () => {
    const result = convertWikiEmbedsToMarkdown("a\n![[x.png]]\nb\n![[y.png]]", opts());
    expect(result.changes).toHaveLength(2);
    expect(result.changes[0]).toMatchObject({
      kind: "wiki-embed",
      before: "![[x.png]]",
      after: "![](x.png)",
    });
    expect(result.changes[1].before).toBe("![[y.png]]");
  });

  it("returns the source untouched when there is nothing to do", () => {
    const src = "![a](https://x.com/a.png)\n\nplain text";
    const result = convertMarkdownImagesToWiki(src, opts());
    expect(result.text).toBe(src);
    expect(result.changes).toEqual([]);
  });

  it("labels html img rewrites distinctly", () => {
    const result = convertMarkdownImagesToWiki('<img src="a.png">', opts());
    expect(result.changes[0].kind).toBe("html-img");
  });
});

describe("helpers", () => {
  it("splits a subpath off a destination", () => {
    expect(splitSubpath("a.png")).toEqual({ bare: "a.png", subpath: "" });
    expect(splitSubpath("a.png#head")).toEqual({ bare: "a.png", subpath: "#head" });
    expect(splitSubpath("Note#head")).toEqual({ bare: "Note", subpath: "#head" });
    expect(splitSubpath("Note^block")).toEqual({ bare: "Note", subpath: "^block" });
    expect(splitSubpath("doc.pdf#page=3")).toEqual({ bare: "doc.pdf", subpath: "#page=3" });
  });

  it("wraps only when needed", () => {
    expect(formatUrl("a.png")).toBe("a.png");
    expect(formatUrl("a b.png")).toBe("<a b.png>");
    expect(formatUrl("a(b).png")).toBe("<a(b).png>");
  });
});

// A regression guard for the two round-trip bugs found while writing this suite: an
// `obsidian-alt` render that dropped the `|` separator when the alias was empty, and an
// `![300](a.png)` alt text that read back as a caption instead of a size.
describe("regressions", () => {
  const strategies: SizeStrategy[] = ["html", "obsidian-alt"];

  it.each(strategies)("keeps a bare size hint stable via %s", (size) => {
    const once = w2m("![[a.png|300]]", { size });
    expect(m2w(once, { size })).toBe("![[a.png|300]]");
  });

  it.each(strategies)("keeps alias plus size stable via %s", (size) => {
    const once = w2m("![[a.png|caption|300x200]]", { size });
    expect(m2w(once, { size })).toBe("![[a.png|caption|300x200]]");
  });
});