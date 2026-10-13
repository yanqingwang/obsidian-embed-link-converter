import {
  FuzzySuggestModal,
  Notice,
  PluginSettingTab,
  Setting,
  TFolder,
  type App,
  type ExtraButtonComponent,
  type SettingDefinitionItem,
  type SettingGroupItem,
} from "obsidian";
import type { ConverterHost, EmbedConverterSettings } from "./settings";
import { DEFAULT_SETTINGS, normalizeScopeFolder } from "./settings";

/** Folder picker. Typing stays available; this is a shortcut, not a replacement. */
class FolderSuggest extends FuzzySuggestModal<string> {
  constructor(app: App, private readonly onChoose: (folder: string) => void) {
    super(app);
    this.setPlaceholder("选择一个文件夹…");
  }

  getItems(): string[] {
    const out: string[] = [];
    const walk = (folder: TFolder): void => {
      for (const child of folder.children) {
        if (child instanceof TFolder) {
          out.push(child.path);
          walk(child);
        }
      }
    };
    walk(this.app.vault.getRoot());
    return out;
  }

  getItemText(item: string): string {
    return item;
  }

  onChooseItem(item: string): void {
    this.onChoose(item);
  }
}

/** Dropdown value -> [label, explanation]. */
type OptionTable = Record<string, [string, string]>;

const SCOPE_OPTIONS: OptionTable = {
  "image-only": ["仅图片", "只处理 png/jpg/gif/svg 等图片。这是默认值，也是唯一不改变渲染结果的范围。"],
  "image-and-attachments": ["图片 + 附件", "同时处理 PDF、音视频、canvas、压缩包等，但不动笔记。"],
  all: ["全部（含笔记转嵌）", "连 ![[Some Note]] 也转成普通链接 —— 这会改变笔记的渲染结果。"],
};

const SIZE_OPTIONS: OptionTable = {
  html: [
    "HTML <img> 标签",
    '![[a.png|300]] → <img src="a.png" width="300">，通用 Markdown 渲染器都能显示，可逆。',
  ],
  drop: ["直接丢弃尺寸", "![[a.png|300]] → ![](a.png)，最简洁，但尺寸会丢失。"],
  "obsidian-alt": [
    "写入 alt 文本",
    "![[a.png|300]] → ![|300](a.png)，Obsidian 自有写法，可逆，但不是通用 Markdown。",
  ],
};

type SettingKey = keyof EmbedConverterSettings;

interface RowSpec {
  /** Absent on action rows, which run something instead of storing something. */
  key?: SettingKey;
  name: string;
  /** A function is re-read on every render, which is how dropdowns show their current explanation. */
  desc?: string | (() => string);
  control?: {
    type: "text" | "toggle" | "dropdown" | "number";
    placeholder?: string;
    min?: number;
    options?: OptionTable;
  };
  action?: { text: string; warning?: boolean; run: () => Promise<unknown> | unknown };
  /**
   * Row-level buttons. Only the pre-1.13 imperative path can draw these; the declarative path
   * hoists them onto the group header, which is the nearest equivalent it offers.
   */
  buttons?: Array<{ text: string; warning?: boolean; run: () => Promise<unknown> | unknown }>;
}

interface GroupSpec {
  heading: string;
  items: RowSpec[];
}

/**
 * Wrap a callback body so it does not return a promise.
 *
 * Obsidian's `onChange` / `onClick` declare `=> void`, so handing them an `async` arrow passes a
 * promise nobody awaits: if the save rejects, it surfaces as an unhandled rejection rather than
 * anything the user can act on. This keeps the body async but the arrow synchronous, and turns a
 * rejected save into a Notice.
 */
function fire<A extends unknown[]>(body: (...args: A) => Promise<unknown> | unknown): (...args: A) => void {
  return (...args: A) => {
    void Promise.resolve(body(...args)).catch((error: unknown) => {
      new Notice(`Embed Link Converter：操作失败 —— ${error instanceof Error ? error.message : String(error)}`);
    });
  };
}

/**
 * Values the control's own type cannot constrain, checked before anything is persisted.
 *
 * Returning a non-empty string rejects the change and Obsidian renders it inline, which is why the
 * old behaviour of silently dropping an unparseable number is not repeated here.
 */
const VALIDATORS: Partial<Record<SettingKey, (value: unknown) => string | void>> = {
  backupRetentionDays: (value) =>
    typeof value === "number" && Number.isInteger(value) && value >= 0
      ? undefined
      : "请输入 0 或更大的天数（0 = 永久保留）",
};

export class EmbedConverterSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly host: ConverterHost) {
    super(app, host);
  }

  /* ---------------------------------------------------------------- *
   * Declarative settings (Obsidian 1.13.0+)
   *
   * Without these, nothing here appears in Obsidian's settings *search* on 1.13 and later.
   *
   * `spec()` is the single source of truth: `getSettingDefinitions()` and `display()` both read it,
   * so the two renderings cannot drift into disagreeing about what settings exist.
   * ---------------------------------------------------------------- */

  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.spec().map((group) => ({
      type: "group" as const,
      heading: group.heading,
      extraButtons: this.headerButtons(group),
      items: group.items.map((row) => (row.action ? this.actionItem(row) : this.controlItem(row))),
    }));
  }

  /** The declarative path owns persistence; these two are how it reads and writes. */
  getControlValue(key: string): unknown {
    const settings = this.host.settings as unknown as Record<string, unknown>;
    return key in settings ? settings[key] : (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
  }

  setControlValue(key: string, value: unknown): void {
    const settings = this.host.settings as unknown as Record<string, unknown>;
    settings[key] = key === "scopeFolder" && typeof value === "string" ? normalizeScopeFolder(value) : value;
    void this.host.saveSettings();
  }

  /**
   * The pre-1.13 renderer. Still required — `display()` is abstract — and still what every version
   * before 1.13 uses.
   */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const settings = this.host.settings;

    for (const group of this.spec()) {
      new Setting(containerEl).setName(group.heading).setHeading();

      for (const row of group.items) {
        const setting = new Setting(containerEl).setName(row.name);
        const desc = resolve(row.desc);
        if (desc) setting.setDesc(desc);

        if (row.action) {
          setting.addButton((button) => {
            button.setButtonText(row.action!.text);
            if (row.action!.warning) button.setWarning();
            button.onClick(fire(row.action!.run));
          });
          continue;
        }

        const control = row.control!;
        const key = row.key!;
        switch (control.type) {
          case "text":
            setting.addText((text) => {
              text.setPlaceholder(control.placeholder ?? "");
              text.setValue(String(settings[key] ?? ""));
              text.onChange(fire((value: string) => this.write(key, value)));
            });
            break;
          case "toggle":
            setting.addToggle((toggle) => {
              toggle.setValue(Boolean(settings[key])).onChange(fire((value: boolean) => this.write(key, value)));
            });
            break;
          case "dropdown":
            setting.addDropdown((dropdown) => {
              for (const [value, [label]] of Object.entries(control.options!)) dropdown.addOption(value, label);
              dropdown.setValue(String(settings[key])).onChange(fire((value: string) => this.write(key, value, true)));
            });
            break;
          case "number":
            setting.addText((text) => {
              text.setPlaceholder(control.placeholder ?? String(DEFAULT_SETTINGS[key]));
              text.setValue(String(settings[key]));
              text.onChange(
                fire((value: string) => {
                  const parsed = Number.parseInt(value, 10);
                  if (VALIDATORS[key]?.(parsed)) return;
                  this.write(key, parsed);
                })
              );
            });
            break;
        }

        for (const button of row.buttons ?? []) {
          setting.addButton((b) => {
            b.setButtonText(button.text);
            if (button.warning) b.setWarning();
            b.onClick(fire(button.run));
          });
        }
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  private spec(): GroupSpec[] {
    return [
      {
        heading: "转换范围",
        items: [
          {
            key: "scopeFolder",
            name: "文件夹",
            desc: "留空 = 整个 vault。建议先在一个子文件夹里试点，确认结果后再清空这一栏。",
            control: { type: "text", placeholder: "例如：AITasks/embed-pilot（留空则全库）" },
            buttons: [
              { text: "浏览…", run: () => this.browseForFolder() },
              { text: "清空", warning: true, run: () => this.clearScopeFolder() },
            ],
          },
          {
            key: "includeSubfolders",
            name: "包含子文件夹",
            desc: "指定了文件夹时，是否连同它的子文件夹一起处理。",
            control: { type: "toggle" },
          },
          {
            key: "scope",
            name: "处理哪些嵌入",
            desc: () => SCOPE_OPTIONS[this.host.settings.scope][1],
            control: { type: "dropdown", options: SCOPE_OPTIONS },
          },
        ],
      },
      {
        heading: "转换选项",
        items: [
          {
            key: "size",
            name: "尺寸参数如何处理",
            desc: () => SIZE_OPTIONS[this.host.settings.size][1],
            control: { type: "dropdown", options: SIZE_OPTIONS },
          },
        ],
      },
      {
        heading: "安全",
        items: [
          {
            key: "previewBeforeWrite",
            name: "写入前先预览",
            desc: "先列出将改动的每个文件和具体前后差异，确认后才写入。建议保持开启。",
            control: { type: "toggle" },
          },
          {
            key: "backupEnabled",
            name: "自动备份",
            desc: "把即将改动的文件原样复制到插件目录下的时间戳备份文件夹。",
            control: { type: "toggle" },
          },
          {
            key: "backupRetentionDays",
            name: "备份保留天数",
            desc: "超过这个天数的备份会在每次转换后自动删除。设为 0 表示永久保留。",
            control: { type: "number", min: 0, placeholder: "7" },
          },
          {
            name: "回滚上一次转换",
            desc: "用最近一次备份覆盖当前文件，把这些笔记恢复到那次转换之前的状态。",
            action: { text: "回滚", run: () => this.host.rollbackLastRun() },
          },
        ],
      },
    ];
  }

  private async write(key: SettingKey, value: unknown, redraw = false): Promise<void> {
    (this.host.settings as unknown as Record<string, unknown>)[key] =
      key === "scopeFolder" && typeof value === "string" ? normalizeScopeFolder(value) : value;
    await this.host.saveSettings();
    // Only the two dropdowns change what else is on screen, and only via their explanation line.
    if (redraw) this.display();
  }

  private async browseForFolder(): Promise<void> {
    new FolderSuggest(this.app, (folder) => {
      void fire(async () => {
        await this.write("scopeFolder", folder);
        this.display();
      })();
    }).open();
  }

  private async clearScopeFolder(): Promise<void> {
    await this.write("scopeFolder", "");
    this.display();
  }

  private actionItem(row: RowSpec): SettingGroupItem {
    return {
      name: row.name,
      desc: resolve(row.desc),
      action: () => {
        fire(row.action!.run)();
      },
    };
  }

  private controlItem(row: RowSpec): SettingGroupItem {
    const control = row.control!;
    const key = row.key!;
    const base = { name: row.name, desc: resolve(row.desc) };
    const check = VALIDATORS[key];
    // A function accepting the widest value type is assignable to every control's narrower
    // signature, so one adapter covers text / toggle / dropdown / number alike.
    const validate = check ? (value: string | boolean | number) => check(value) : undefined;

    switch (control.type) {
      case "text":
        return {
          ...base,
          control: {
            type: "text",
            key,
            defaultValue: DEFAULT_SETTINGS[key] as string,
            placeholder: control.placeholder,
            validate,
          },
        };
      case "toggle":
        return {
          ...base,
          control: { type: "toggle", key, defaultValue: DEFAULT_SETTINGS[key] as boolean },
        };
      case "dropdown": {
        const options: Record<string, string> = {};
        for (const [value, [label]] of Object.entries(control.options!)) options[value] = label;
        return {
          ...base,
          control: { type: "dropdown", key, defaultValue: DEFAULT_SETTINGS[key] as string, options },
        };
      }
      case "number":
        return {
          ...base,
          control: {
            type: "number",
            key,
            defaultValue: DEFAULT_SETTINGS[key] as number,
            min: control.min,
            placeholder: control.placeholder,
            validate,
          },
        };
    }
  }

  /**
   * Row buttons, hoisted to the group header for the declarative path.
   *
   * `SettingDefinitionControl` explicitly forbids a per-item `render`/`action` alongside a control,
   * and `extraButtons` is the only per-row affordance it exposes. One group here has buttons, so
   * the result is identical in practice.
   */
  private headerButtons(group: GroupSpec) {
    const buttons = group.items.flatMap((row) => row.buttons ?? []);
    if (buttons.length === 0) return undefined;
    return buttons.map(
      (button) => (component: ExtraButtonComponent) => {
        component.setIcon("folder-search").setTooltip(button.text);
        component.onClick(fire(button.run));
      }
    );
  }
}

function resolve(desc: string | (() => string) | undefined): string | undefined {
  return typeof desc === "function" ? desc() : desc;
}