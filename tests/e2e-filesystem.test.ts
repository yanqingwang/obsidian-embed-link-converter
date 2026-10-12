import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildPlan, type SourceFile } from "../src/planner";
import type { ConvertOptions } from "../src/converter";

/**
 * End-to-end over a real directory: real filenames, real bytes, real writes.
 *
 * The unit tests prove the rewriting rules; this proves the rules survive contact with an actual
 * vault layout — non-ASCII paths, attachments folders, CRLF files, and filenames containing the
 * characters that break naive link rewriting.
 */

const VAULT_FILES: Record<string, string> = {
  "笔记/日报.md": [
    "# 2026-10-12",
    "",
    "![[attachments/图表 1.png]]",
    "",
    "带尺寸：![[attachments/图表 1.png|640x480]]",
    "",
    "带标题：![[Screen Shot (2).png|我的截图]]",
    "",
    "空格：![[attachments/my report.png]]",
    "",
    "PDF：![[files/手册.pdf#page=3]]",
    "",
    "笔记转嵌：![[周报模板]]",
  ].join("\n"),
  "笔记/子目录/deep.md": "![[../../attachments/图表 1.png]]\n\n![[files/手册.pdf]]",
  "attachments/图表 1.png": "not really a png",
  "attachments/my report.png": "not really a png",
  "attachments/Screen Shot (2).png": "not really a png",
  "files/手册.pdf": "not really a pdf",
  "代码块示例.md": [
    "这是文档，不是嵌入：",
    "",
    "```markdown",
    "![[attachments/图表 1.png]]",
    "```",
    "",
    "行内代码 `![[attachments/图表 1.png|300]]` 也不动。",
  ].join("\n"),
  "crlf.md": "第一行\r\n\r\n![[attachments/图表 1.png]]\r\n",
  "no-embed.md": "这个文件里没有嵌入。",
};

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "elc-e2e-"));
  for (const [path, content] of Object.entries(VAULT_FILES)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const readVault = (): SourceFile[] =>
  Object.keys(VAULT_FILES)
    .filter((p) => p.endsWith(".md"))
    .map((p) => ({ path: p, content: readFileSync(join(root, p), "utf8") }));

const applyToDisk = (paths: string[], plan: ReturnType<typeof buildPlan>): void => {
  for (const file of plan.files) {
    writeFileSync(join(root, file.path), file.after, "utf8");
  }
  expect(plan.files.map((f) => f.path).sort()).toEqual(paths.sort());
};

describe("whole-vault conversion on real files", () => {
  const opts: ConvertOptions = { scope: "all", size: "html" };

  it("rewrites only the notes that need it", () => {
    const plan = buildPlan(readVault(), "wiki-to-md", opts);

    // 代码块示例.md is deliberately absent: every embed in it is inside a code fence or inline
    // code, so there is nothing to convert and the file must not be touched.
    expect(plan.files.map((f) => f.path).sort()).toEqual([
      "crlf.md",
      "笔记/子目录/deep.md",
      "笔记/日报.md",
    ]);
    expect(plan.skipped).toBe(2);
  });

  it("produces portable markdown with intact paths", () => {
    const plan = buildPlan(readVault(), "wiki-to-md", opts);
    const daily = plan.files.find((f) => f.path === "笔记/日报.md")!.after;

    expect(daily).toContain("![](<attachments/图表 1.png>)");
    expect(daily).toContain('<img src="attachments/图表 1.png" width="640" height="480">');
    // An alias with no size hint is ordinary alt text, so no HTML tag is needed.
    expect(daily).toContain("![我的截图](<Screen Shot (2).png>)");
    expect(daily).toContain("![](<attachments/my report.png>)");
    expect(daily).toContain("![](files/手册.pdf#page=3)");
    expect(daily).toContain("![](周报模板)");
  });

  it("leaves documentation and non-embed notes alone", () => {
    const plan = buildPlan(readVault(), "wiki-to-md", opts);

    expect(plan.files.some((f) => f.path === "代码块示例.md")).toBe(false);
    expect(readFileSync(join(root, "代码块示例.md"), "utf8")).toBe(VAULT_FILES["代码块示例.md"]);
    expect(readFileSync(join(root, "no-embed.md"), "utf8")).toBe(VAULT_FILES["no-embed.md"]);
  });

  it("preserves CRLF line endings", () => {
    const plan = buildPlan(readVault(), "wiki-to-md", opts);
    const crlf = plan.files.find((f) => f.path === "crlf.md")!.after;
    expect(crlf).toContain("\r\n");
    expect(crlf).not.toMatch(/(?<!\r)\n/);
  });

  it("survives a write to disk and a full round trip back", () => {
    const changed = ["crlf.md", "笔记/子目录/deep.md", "笔记/日报.md"];
    applyToDisk(changed, buildPlan(readVault(), "wiki-to-md", opts));

    // The files on disk must now read back as plain markdown...
    const onDisk = readVault();
    expect(onDisk.find((f) => f.path === "笔记/日报.md")!.content).toContain("![](<attachments/图表 1.png>)");

    // ...and converting them back must reproduce the originals byte for byte.
    applyToDisk(changed, buildPlan(onDisk, "md-to-wiki", opts));

    for (const [path, original] of Object.entries(VAULT_FILES)) {
      if (!path.endsWith(".md")) continue;
      expect(readFileSync(join(root, path), "utf8")).toBe(original);
    }
  });
});

describe("scope narrows the blast radius on real files", () => {
  const opts: ConvertOptions = { scope: "image-only", size: "html" };

  it("touching one folder leaves the rest of the vault byte-identical", () => {
    const others = Object.keys(VAULT_FILES).filter((p) => !p.startsWith("笔记/"));
    const before = others.map((p) => readFileSync(join(root, p), "utf8"));

    const plan = buildPlan(
      readVault().filter((f) => f.path.startsWith("笔记/")),
      "wiki-to-md",
      opts
    );
    expect(plan.files.map((f) => f.path).sort()).toEqual(["笔记/子目录/deep.md", "笔记/日报.md"]);

    const after = others.map((p) => readFileSync(join(root, p), "utf8"));
    expect(after).toEqual(before);
  });

  it("image-only scope leaves attachments and note embeds in place", () => {
    const daily = buildPlan(readVault(), "wiki-to-md", opts).files.find(
      (f) => f.path === "笔记/日报.md"
    )!.after;

    expect(daily).toContain("![[files/手册.pdf#page=3]]");
    expect(daily).toContain("![[周报模板]]");
    expect(daily).toContain("![](<attachments/图表 1.png>)"); // the image still converted
  });
});