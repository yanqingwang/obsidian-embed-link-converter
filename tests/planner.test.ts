import { buildPlan } from "../src/planner";
import type { ConvertOptions } from "../src/converter";

const opts: ConvertOptions = { scope: "image-only", size: "html" };

describe("plan building", () => {
  it("includes only files that change", () => {
    const plan = buildPlan(
      [
        { path: "a.md", content: "![[x.png]]" },
        { path: "b.md", content: "no embeds here" },
        { path: "c.md", content: "![](y.png)" },
      ],
      "wiki-to-md",
      opts
    );

    expect(plan.files.map((f) => f.path)).toEqual(["a.md"]);
    expect(plan.skipped).toBe(2);
    expect(plan.totalChanges).toBe(1);
  });

  it("carries before and after content for each file", () => {
    const plan = buildPlan([{ path: "a.md", content: "x ![[p.png]] y" }], "wiki-to-md", opts);
    const file = plan.files[0];
    expect(file.before).toBe("x ![[p.png]] y");
    expect(file.after).toBe("x ![](p.png) y");
  });

  it("reports per-file change counts that sum to the total", () => {
    const plan = buildPlan(
      [
        { path: "a.md", content: "![[p.png]] ![[q.png]]" },
        { path: "b.md", content: "![[r.png]]" },
      ],
      "wiki-to-md",
      opts
    );
    expect(plan.files.map((f) => f.changes.length)).toEqual([2, 1]);
    expect(plan.totalChanges).toBe(3);
  });

  it("returns an empty plan when nothing matches", () => {
    const plan = buildPlan([{ path: "a.md", content: "plain" }], "wiki-to-md", opts);
    expect(plan.files).toEqual([]);
    expect(plan.totalChanges).toBe(0);
    expect(plan.skipped).toBe(1);
  });

  it("honours the scope when planning", () => {
    const sources = [{ path: "a.md", content: "![[x.png]] ![[doc.pdf]] ![[Note]]" }];
    expect(buildPlan(sources, "wiki-to-md", opts).totalChanges).toBe(1);
    expect(
      buildPlan(sources, "wiki-to-md", { ...opts, scope: "image-and-attachments" }).totalChanges
    ).toBe(2);
    expect(buildPlan(sources, "wiki-to-md", { ...opts, scope: "all" }).totalChanges).toBe(3);
  });

  it("preserves the order of the input files", () => {
    const plan = buildPlan(
      [
        { path: "z.md", content: "![[a.png]]" },
        { path: "a.md", content: "![[b.png]]" },
      ],
      "wiki-to-md",
      opts
    );
    expect(plan.files.map((f) => f.path)).toEqual(["z.md", "a.md"]);
  });
});