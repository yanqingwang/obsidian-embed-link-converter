import { EmbedConverterSettingTab } from "../src/SettingsTab";
import { DEFAULT_SETTINGS, type EmbedConverterSettings } from "../src/settings";

/**
 * The declarative settings API exists for one reason: without it, nothing in this tab appears in
 * Obsidian's settings *search* on 1.13.0 and later. Nothing else in the test suite touches it, so a
 * typo in a key or a dropped item would ship silently.
 */

/** Just enough host for the tab to read, write and persist. */
function host(settings: Partial<EmbedConverterSettings> = {}) {
  const saved: EmbedConverterSettings[] = [];
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  return {
    settings: merged,
    saved,
    saveSettings: async () => {
      saved.push({ ...merged });
    },
  };
}

function tab(settings: Partial<EmbedConverterSettings> = {}) {
  const h = host(settings);
  return { tab: new EmbedConverterSettingTab({} as never, h as never), ...h };
}

/** The control descriptor a given settings key is advertised with. */
function controlOf(t: EmbedConverterSettingTab, key: string): Record<string, unknown> {
  const groups = t.getSettingDefinitions() as Array<{
    items: Array<{ control?: { key?: string } & Record<string, unknown> }>;
  }>;
  const found = groups.flatMap((g) => g.items).find((i) => i.control?.key === key);
  if (!found?.control) throw new Error(`no declarative control advertised for "${key}"`);
  return found.control;
}

/** Every control key the declarative definitions advertise. */
function controlKeys(): string[] {
  const { tab: t } = tab();
  const keys: string[] = [];
  for (const group of t.getSettingDefinitions() as Array<{ items?: Array<Record<string, unknown>> }>) {
    for (const item of group.items ?? []) {
      const control = item.control as { key?: string } | undefined;
      if (control?.key) keys.push(control.key);
    }
  }
  return keys;
}

describe("declarative settings (Obsidian 1.13.0+)", () => {
  it("advertises every setting exactly once", () => {
    const keys = controlKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("covers every persisted field, so nothing is stranded out of the search index", () => {
    // The regression this guards: a setting exists in the settings file but never reaches
    // `getSettingDefinitions()`, so the user cannot find it by searching.
    const keys = new Set(controlKeys());
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      expect(keys.has(key)).toBe(true);
    }
  });

  it("groups the settings and gives each group a heading", () => {
    const groups = tab().tab.getSettingDefinitions() as Array<{ type: string; heading?: string }>;
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.type).toBe("group");
      expect(group.heading).toBeTruthy();
    }
  });

  it("offers every valid value of a dropdown, each with a label", () => {
    const options = controlOf(tab().tab, "scope").options as Record<string, string>;
    // A dropdown missing an option would leave the stored value unselectable and, worse, render as
    // a blank control with no way back.
    for (const value of ["image-only", "image-and-attachments", "all"]) {
      expect(options[value]).toBeTruthy();
    }
    expect(options[DEFAULT_SETTINGS.scope]).toBeTruthy();
  });

  it("re-reads a dropdown's explanation from the current value on each render", () => {
    // The description is a function, so switching "处理哪些嵌入" has to change what is written
    // underneath it rather than leaving the previous option's explanation on screen.
    const { tab: t } = tab({ scope: "image-only" });
    const descOf = () =>
      ((t.getSettingDefinitions()[0] as { items: Array<Record<string, unknown>> }).items.find((i) =>
        (i.control as { key?: string })?.key === "scope"
      )!.desc) as string;

    expect(descOf()).toContain("png/jpg/gif/svg");

    t.setControlValue("scope", "all");
    expect(descOf()).toContain("![[Some Note]]");
  });

  it("includes the rollback action", () => {
    const groups = tab().tab.getSettingDefinitions() as Array<{
      items: Array<{ action?: (el: HTMLElement, index: number) => void }>;
    }>;
    const actions = groups.flatMap((g) => g.items.filter((i) => typeof i.action === "function"));
    expect(actions).toHaveLength(1);
  });

  it("gives every row a name, because that is what search matches on", () => {
    const groups = tab().tab.getSettingDefinitions() as Array<{
      items: Array<{ name?: string; desc?: string }>;
    }>;
    // `expect` takes one argument, so the misses are collected and reported together.
    const unnamed = groups.flatMap((g) => g.items).filter((i) => !i.name).length;
    expect(unnamed).toBe(0);
  });
});

describe("reading and writing through the declarative bind", () => {
  it("reads the live value", () => {
    const { tab: t } = tab({ scopeFolder: "AITasks/pilot" });
    expect(t.getControlValue("scopeFolder")).toBe("AITasks/pilot");
  });

  it("falls back to the shipped default for an unknown key instead of returning undefined", () => {
    // Obsidian renders the control before anything is written; an undefined here means an empty
    // box that silently overwrites a real default on first keystroke.
    expect(tab().tab.getControlValue("scope")).toBe(DEFAULT_SETTINGS.scope);
  });

  it("writes and persists", () => {
    const { tab: t, settings, saved } = tab();
    t.setControlValue("backupRetentionDays", 30);
    expect(settings.backupRetentionDays).toBe(30);
    expect(saved).toHaveLength(1);
  });

  it("normalises the folder before storing it", () => {
    // The imperative path normalises; if this one did not, the same field would behave differently
    // depending on the Obsidian version the user happens to run.
    const { tab: t, settings } = tab();
    t.setControlValue("scopeFolder", "  /notes/sub/  ");
    expect(settings.scopeFolder).toBe("notes/sub");
  });
});

describe("validation", () => {
  function validatorFor(key: string): ((value: unknown) => string | void) | undefined {
    const { tab: t } = tab();
    const groups = t.getSettingDefinitions() as Array<{
      items: Array<{ control?: { key?: string; validate?: (value: never) => string | void } }>;
    }>;
    for (const item of groups.flatMap((g) => g.items)) {
      if (item.control?.key === key) return item.control.validate as (value: unknown) => string | void;
    }
    return undefined;
  }

  it("rejects a negative retention instead of silently dropping the keystroke", () => {
    const validate = validatorFor("backupRetentionDays");
    expect(validate?.(-1)).toBeTruthy();
    expect(validate?.(1.5)).toBeTruthy();
    expect(validate?.(0)).toBeUndefined();
    expect(validate?.(7)).toBeUndefined();
  });

  it("leaves the toggles unvalidated, since a boolean cannot be wrong", () => {
    expect(validatorFor("previewBeforeWrite")).toBeUndefined();
  });
});