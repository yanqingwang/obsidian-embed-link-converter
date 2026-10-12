import { iterateHtmlImages, iterateMarkdownImages } from "../src/markdown-image";
import {
  buildWikiEmbed,
  formatSize,
  isRemoteUrl,
  parseWikiEmbed,
  splitAltSize,
} from "../src/wiki-embed";

const imgs = (src: string, from?: number, to?: number) => [
  ...iterateMarkdownImages(src, from, to),
];
const htmls = (src: string) => [...iterateHtmlImages(src)];

describe("markdown image scanner", () => {
  it("reads a simple image", () => {
    expect(imgs("![](a.png)")).toEqual([
      { start: 0, end: 10, alt: "", url: "a.png", title: null },
    ]);
  });

  it("reads alt text", () => {
    expect(imgs("![cap](a.png)")[0]).toMatchObject({ alt: "cap", url: "a.png" });
  });

  it("keeps parentheses inside a bare destination", () => {
    expect(imgs("![a](Screenshot (1).png)")[0].url).toBe("Screenshot (1).png");
  });

  it("unwraps an angle-bracketed destination", () => {
    expect(imgs("![](<my image.png>)")[0].url).toBe("my image.png");
  });

  it("keeps spaces in an unbracketed destination", () => {
    expect(imgs("![a](my image.png)")[0].url).toBe("my image.png");
  });

  it("separates a quoted title from a spaced destination", () => {
    expect(imgs('![a](my image.png "Cap")')[0]).toMatchObject({
      url: "my image.png",
      title: "Cap",
    });
  });

  it("ignores reference-style images", () => {
    expect(imgs("![a][ref]")).toEqual([]);
    expect(imgs("![a]")).toEqual([]);
  });

  it("ignores an unterminated image", () => {
    expect(imgs("![a](a.png")).toEqual([]);
  });

  it("reports absolute offsets for several images", () => {
    const src = "![a](a.png) and ![b](b.png)";
    const found = imgs(src);
    expect(found).toHaveLength(2);
    expect(found[1].start).toBe(src.indexOf("![b]"));
    expect(src.slice(found[1].start, found[1].end)).toBe("![b](b.png)");
  });

  it("does not resume inside a wiki embed", () => {
    expect(imgs("![[a.png]]")).toEqual([]);
  });

  it("respects a scan window", () => {
    // The first image ends at offset 11; the second starts at 12, so a window from 13 excludes it.
    expect(imgs("![a](a.png) ![b](b.png)", 13)).toHaveLength(0);
    expect(imgs("![a](a.png) ![b](b.png)", 12)).toHaveLength(1);
  });
});

describe("html img scanner", () => {
  it("reads src, alt and dimensions", () => {
    expect(htmls('<img src="a.png" alt="c" width="300" height="200">')[0]).toMatchObject({
      src: "a.png",
      alt: "c",
      width: 300,
      height: 200,
      unsupportedSize: false,
    });
  });

  it("accepts single quotes and unquoted values", () => {
    expect(htmls("<img src=a.png width=300>")[0]).toMatchObject({ src: "a.png", width: 300 });
  });

  it("flags non-pixel dimensions as unrepresentable", () => {
    expect(htmls('<img src="a.png" width="50%">')[0].unsupportedSize).toBe(true);
    expect(htmls('<img src="a.png" height="200">')[0].unsupportedSize).toBe(true);
  });

  it("skips a tag with no src", () => {
    expect(htmls("<img alt='x'>")).toEqual([]);
  });

  it("ignores lookalikes that are not tags", () => {
    expect(htmls("<image src='a.png'>")).toEqual([]);
  });
});

describe("wiki embed parser", () => {
  it("parses a bare embed", () => {
    expect(parseWikiEmbed("a.png")).toMatchObject({
      target: "a.png",
      subpath: "",
      alias: "",
      size: null,
    });
  });

  it("parses an alias", () => {
    expect(parseWikiEmbed("a.png|a caption")).toMatchObject({ alias: "a caption", size: null });
  });

  it("parses size parameters", () => {
    expect(parseWikiEmbed("a.png|300")!.size).toEqual({ width: 300 });
    expect(parseWikiEmbed("a.png|300x200")!.size).toEqual({ width: 300, height: 200 });
    expect(parseWikiEmbed("a.png|300X200")!.size).toEqual({ width: 300, height: 200 });
  });

  it("parses alias followed by size, in Obsidian's order", () => {
    expect(parseWikiEmbed("a.png|cap|300")).toMatchObject({ alias: "cap", size: { width: 300 } });
  });

  it("splits the subpath off the target", () => {
    expect(parseWikiEmbed("a.png#head")).toMatchObject({ target: "a.png", subpath: "#head" });
    expect(parseWikiEmbed("Note^blk")).toMatchObject({ target: "Note", subpath: "^blk" });
    expect(parseWikiEmbed("doc.pdf#page=3")).toMatchObject({
      target: "doc.pdf",
      subpath: "#page=3",
    });
  });

  it("rejects an empty destination", () => {
    expect(parseWikiEmbed("")).toBeNull();
    expect(parseWikiEmbed("|300")).toBeNull();
  });

  it("treats a non-numeric parameter as an alias", () => {
    expect(parseWikiEmbed("a.png|v2")!.alias).toBe("v2");
  });
});

describe("wiki embed builder", () => {
  it("joins parameters in order and drops empty ones", () => {
    expect(buildWikiEmbed("a.png", [])).toBe("![[a.png]]");
    expect(buildWikiEmbed("a.png", ["", "cap", ""])).toBe("![[a.png|cap]]");
    expect(buildWikiEmbed("a.png", ["cap", "300"])).toBe("![[a.png|cap|300]]");
  });

  it("formats sizes", () => {
    expect(formatSize({ width: 300 })).toBe("300");
    expect(formatSize({ width: 300, height: 200 })).toBe("300x200");
  });
});

describe("alt text size hint", () => {
  it("splits a trailing numeric hint", () => {
    expect(splitAltSize("|300")).toEqual({ alias: "", size: { width: 300 } });
    expect(splitAltSize("cap|300x200")).toEqual({
      alias: "cap",
      size: { width: 300, height: 200 },
    });
  });

  it("leaves ordinary alt text alone", () => {
    expect(splitAltSize("cap")).toEqual({ alias: "cap", size: null });
    expect(splitAltSize("v2")).toEqual({ alias: "v2", size: null });
  });

  it("uses the last pipe, so a caption containing a pipe still works", () => {
    expect(splitAltSize("a|b|300")).toEqual({ alias: "a|b", size: { width: 300 } });
  });
});

describe("remote url detection", () => {
  it("detects schemes", () => {
    expect(isRemoteUrl("https://x/a.png")).toBe(true);
    expect(isRemoteUrl("HTTP://x/a.png")).toBe(true);
    expect(isRemoteUrl("data:image/png;base64,AA")).toBe(true);
    expect(isRemoteUrl("//cdn/a.png")).toBe(true);
  });

  it("leaves vault-relative paths alone", () => {
    expect(isRemoteUrl("a.png")).toBe(false);
    expect(isRemoteUrl("folder/a.png")).toBe(false);
    expect(isRemoteUrl("folder name/a.png")).toBe(false);
    expect(isRemoteUrl("../a.png")).toBe(false);
  });
});