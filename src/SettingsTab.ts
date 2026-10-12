import { FuzzySuggestModal, PluginSettingTab, Setting, TFolder, type App } from "obsidian";
import type { ConverterHost, EmbedConverterSettings } from "./settings";
import { normalizeScopeFolder } from "./settings";

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

const SCOPE_OPTIONS: Record<EmbedConverterSettings["scope"], [string, string]> = {
  "image-only": ["仅图片", "只处理 png/jpg/gif/svg 等图片。这是默认值，也是唯一不改变渲染结果的范围。"],
  "image-and-attachments": ["图片 + 附件", "同时处理 PDF、音视频、canvas、压缩包等，但不动笔记。"],
  all: ["全部（含笔记转嵌）", "连 ![[Some Note]] 也转成普通链接 —— 这会改变笔记的渲染结果。"],
};

const SIZE_OPTIONS: Record<EmbedConverterSettings["size"], [string, string]> = {
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

/** Explanatory line rendered under a dropdown. */
function describe(containerEl: HTMLElement, text: string): void {
  const p = containerEl.createEl("p", { cls: "setting-item-description", text });
  p.style.margin = "-0.4em 0 0.8em 0";
}

export class EmbedConverterSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly host: ConverterHost) {
    super(app, host);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("转换范围").setHeading();

    new Setting(containerEl)
      .setName("文件夹")
      .setDesc("留空 = 整个 vault。建议先在一个子文件夹里试点，确认结果后再清空这一栏。")
      .addText((text) =>
        text
          .setPlaceholder("例如：AITasks/embed-pilot（留空则全库）")
          .setValue(this.host.settings.scopeFolder)
          .onChange(async (value) => {
            this.host.settings.scopeFolder = normalizeScopeFolder(value);
            await this.host.saveSettings();
          })
      )
      .addButton((button) =>
        button.setButtonText("浏览…").onClick(() => {
          new FolderSuggest(this.app, async (folder) => {
            this.host.settings.scopeFolder = folder;
            await this.host.saveSettings();
            this.display();
          }).open();
        })
      )
      .addButton((button) =>
        button
          .setButtonText("清空")
          .setWarning()
          .onClick(async () => {
            this.host.settings.scopeFolder = "";
            await this.host.saveSettings();
            this.display();
          })
      );

    new Setting(containerEl)
      .setName("包含子文件夹")
      .setDesc("指定了文件夹时，是否连同它的子文件夹一起处理。")
      .addToggle((toggle) =>
        toggle.setValue(this.host.settings.includeSubfolders).onChange(async (value) => {
          this.host.settings.includeSubfolders = value;
          await this.host.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("处理哪些嵌入")
      .setDesc("除图片以外的嵌入（PDF、Canvas、音视频、笔记转嵌）是否参与转换。")
      .addDropdown((dropdown) => {
        for (const [value, [label]] of Object.entries(SCOPE_OPTIONS)) {
          dropdown.addOption(value, label);
        }
        dropdown.setValue(this.host.settings.scope).onChange(async (value) => {
          this.host.settings.scope = value as EmbedConverterSettings["scope"];
          await this.host.saveSettings();
          this.display();
        });
      });
    describe(containerEl, SCOPE_OPTIONS[this.host.settings.scope][1]);

    new Setting(containerEl).setName("转换选项").setHeading();

    new Setting(containerEl)
      .setName("尺寸参数如何处理")
      .setDesc("双链的图片尺寸写法在标准 Markdown 里没有对应语法，必须决定去留。")
      .addDropdown((dropdown) => {
        for (const [value, [label]] of Object.entries(SIZE_OPTIONS)) {
          dropdown.addOption(value, label);
        }
        dropdown.setValue(this.host.settings.size).onChange(async (value) => {
          this.host.settings.size = value as EmbedConverterSettings["size"];
          await this.host.saveSettings();
          this.display();
        });
      });
    describe(containerEl, SIZE_OPTIONS[this.host.settings.size][1]);

    new Setting(containerEl).setName("安全").setHeading();

    new Setting(containerEl)
      .setName("写入前先预览")
      .setDesc("先列出将改动的每个文件和具体前后差异，确认后才写入。建议保持开启。")
      .addToggle((toggle) =>
        toggle.setValue(this.host.settings.previewBeforeWrite).onChange(async (value) => {
          this.host.settings.previewBeforeWrite = value;
          await this.host.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("自动备份")
      .setDesc("把即将改动的文件原样复制到插件目录下的时间戳备份文件夹。")
      .addToggle((toggle) =>
        toggle.setValue(this.host.settings.backupEnabled).onChange(async (value) => {
          this.host.settings.backupEnabled = value;
          await this.host.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("备份保留天数")
      .setDesc("超过这个天数的备份会在每次转换后自动删除。设为 0 表示永久保留。")
      .addText((text) =>
        text
          .setPlaceholder("7")
          .setValue(String(this.host.settings.backupRetentionDays))
          .onChange(async (value) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isNaN(parsed) || parsed < 0) return;
            this.host.settings.backupRetentionDays = parsed;
            await this.host.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("回滚上一次转换")
      .setDesc("用最近一次备份覆盖当前文件，把这些笔记恢复到那次转换之前的状态。")
      .addButton((button) =>
        button.setButtonText("回滚").onClick(async () => {
          await this.host.rollbackLastRun();
        })
      );
  }
}