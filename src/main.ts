import { Notice, Plugin, TFile } from "obsidian";
import { createBackup, findLatestBackup, pruneBackups, restoreBackup } from "./backup";
import { classifyPath } from "./constants";
import type { Direction } from "./converter";
import { buildPlan, type Plan, type SourceFile } from "./planner";
import { DIRECTION_LABEL, PreviewModal } from "./previewModal";
import { collectScope } from "./scope";
import { EmbedConverterSettingTab } from "./SettingsTab";
import {
  convertOptionsOf,
  DEFAULT_SETTINGS,
  normalizeScopeFolder,
  PLUGIN_DIR,
  type ConverterHost,
  type EmbedConverterSettings,
} from "./settings";
import { parseWikiEmbed } from "./wiki-embed";

/**
 * Convert between Obsidian wiki embeds and Markdown image syntax, in either direction.
 *
 * The run is deliberately linear and inspectable: resolve scope → read → plan → show → back up →
 * write → report. Every step that can surprise the user (an unexpected scope, a lossy rewrite, a
 * note transclusion) is surfaced before the write step rather than after it.
 */
export default class EmbedLinkConverterPlugin extends Plugin implements ConverterHost {
  settings: EmbedConverterSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new EmbedConverterSettingTab(this.app, this));

    this.addRibbonIcon("arrow-right-left", "嵌入链接格式转换", () => {
      void this.runConversion("wiki-to-md");
    });

    this.addCommand({
      id: "wiki-to-markdown",
      name: "双链嵌入 → Markdown 图片（按设置范围）",
      callback: () => void this.runConversion("wiki-to-md"),
    });

    this.addCommand({
      id: "markdown-to-wiki",
      name: "Markdown 图片 → 双链嵌入（按设置范围）",
      callback: () => void this.runConversion("md-to-wiki"),
    });

    this.addCommand({
      id: "current-note-wiki-to-markdown",
      name: "当前笔记：双链嵌入 → Markdown 图片",
      callback: () => void this.runConversion("wiki-to-md", this.activeNoteScope()),
    });

    this.addCommand({
      id: "current-note-markdown-to-wiki",
      name: "当前笔记：Markdown 图片 → 双链嵌入",
      callback: () => void this.runConversion("md-to-wiki", this.activeNoteScope()),
    });

    this.addCommand({
      id: "current-folder-wiki-to-markdown",
      name: "当前文件夹：双链嵌入 → Markdown 图片",
      callback: () => void this.runConversion("wiki-to-md", this.activeFolderScope()),
    });

    this.addCommand({
      id: "current-folder-markdown-to-wiki",
      name: "当前文件夹：Markdown 图片 → 双链嵌入",
      callback: () => void this.runConversion("md-to-wiki", this.activeFolderScope()),
    });

    this.addCommand({
      id: "rollback",
      name: "回滚上一次转换",
      callback: () => void this.rollbackLastRun(),
    });

    // Prune on load so backups age out even in a vault nobody converts in for weeks.
    void this.pruneBackupsQuietly();
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<EmbedConverterSettings>) };
    this.settings.scopeFolder = normalizeScopeFolder(this.settings.scopeFolder ?? "");
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** Scope covering only the note in the active leaf. */
  private activeNoteScope(): string[] | null {
    const file = this.app.workspace.getActiveFile();
    return file ? [file.path] : null;
  }

  /** Scope covering the folder of the active note, with the configured subfolder behaviour. */
  private activeFolderScope(): { files: TFile[]; description: string } | null {
    const file = this.app.workspace.getActiveFile();
    if (!file) return null;
    const parent = file.parent?.path;
    if (!parent) return null;
    const result = collectScope(this.app.vault, parent, this.settings.includeSubfolders);
    return { files: result.files, description: result.description };
  }

  async runConversion(direction: Direction, override?: string[] | { files: TFile[]; description: string } | null): Promise<void> {
    let files: TFile[];
    let description: string;

    if (Array.isArray(override)) {
      if (override.length === 0) {
        new Notice("Embed Link Converter：没有找到可处理的文件。");
        return;
      }
      files = override.map((path) => this.app.vault.getAbstractFileByPath(path)).filter((f): f is TFile => f instanceof TFile);
      description = `当前笔记（${files.length} 个）`;
    } else if (override) {
      files = override.files;
      description = override.description;
    } else {
      const scope = collectScope(this.app.vault, this.settings.scopeFolder, this.settings.includeSubfolders);
      if (scope.error) {
        new Notice(`Embed Link Converter：${scope.error}`, 8000);
        return;
      }
      files = scope.files;
      description = scope.description;
    }

    if (files.length === 0) {
      new Notice("Embed Link Converter：范围内没有 Markdown 文件。");
      return;
    }

    const sources: SourceFile[] = [];
    for (const file of files) {
      sources.push({ path: file.path, content: await this.app.vault.read(file) });
    }

    const plan = buildPlan(sources, direction, convertOptionsOf(this.settings));
    if (plan.files.length === 0) {
      new Notice(`Embed Link Converter：${DIRECTION_LABEL[direction]} — 没有需要转换的内容。`);
      return;
    }

    const noteEmbeds = this.countNoteEmbeds(plan, direction);

    const proceed = (): void => void this.applyPlan(plan, direction, description);
    if (this.settings.previewBeforeWrite) {
      new PreviewModal(this.app, {
        direction,
        scopeDescription: description,
        plan,
        backupEnabled: this.settings.backupEnabled,
        retentionDays: this.settings.backupRetentionDays,
        noteEmbeds,
      }, proceed).open();
    } else {
      proceed();
    }
  }

  /**
   * Note transclusions are the one rewrite that changes what a note renders, so they are counted
   * separately and called out in the preview. Only meaningful in the wiki → Markdown direction;
   * the reverse turns Markdown images into embeds, which cannot silently create a transclusion
   * unless the scope explicitly allows notes.
   */
  private countNoteEmbeds(plan: Plan, direction: Direction): number {
    if (direction !== "wiki-to-md") return 0;

    let count = 0;
    for (const file of plan.files) {
      for (const change of file.changes) {
        if (change.kind !== "wiki-embed") continue;
        const inner = change.before.slice(3, -2); // strip the leading `![[` and trailing `]]`
        const target = parseWikiEmbed(inner);
        if (!target) continue;
        const kind = classifyPath(target.target);
        if (kind === "note" || kind === "other") count += 1;
      }
    }
    return count;
  }

  private async applyPlan(plan: Plan, direction: Direction, description: string): Promise<void> {
    const paths = plan.files.map((f) => f.path);
    let backupDir: string | null = null;

    if (this.settings.backupEnabled) {
      try {
        const backup = await createBackup(this.app.vault.adapter, paths);
        backupDir = backup.dir;
      } catch (error) {
        // Refusing to continue is the only safe response: the write below is destructive.
        new Notice(`Embed Link Converter：备份失败，已中止，未改动任何文件。\n${String(error)}`, 10000);
        console.error("[embed-link-converter] backup failed, aborting", error);
        return;
      }
    }

    let written = 0;
    const failures: string[] = [];
    for (const planned of plan.files) {
      const file = this.app.vault.getAbstractFileByPath(planned.path);
      if (!(file instanceof TFile)) {
        failures.push(`${planned.path} (文件已不存在)`);
        continue;
      }
      try {
        await this.app.vault.modify(file, planned.after);
        written += 1;
      } catch (error) {
        failures.push(`${planned.path} (${String(error)})`);
      }
    }

    await this.pruneBackupsQuietly();

    const parts = [
      `已转换 ${written}/${plan.files.length} 个文件`,
      `${plan.totalChanges} 处`,
      description,
    ];
    if (backupDir) parts.push(`备份：${backupDir}`);

    const notice = new Notice(parts.join(" · "), failures.length > 0 ? 15000 : 8000);
    if (failures.length > 0) {
      console.error(`[embed-link-converter] ${failures.length} file(s) failed:\n${failures.join("\n")}`);
      notice.setMessage(`${parts.join(" · ")} · ${failures.length} 个文件失败（详见开发者控制台）`);
    }
    console.log(`[embed-link-converter] ${direction}: wrote ${written}/${plan.files.length} files`, { backupDir, failures });
  }

  private async pruneBackupsQuietly(): Promise<void> {
    try {
      const removed = await pruneBackups(this.app.vault.adapter, this.settings.backupRetentionDays);
      if (removed.length > 0) {
        console.log(`[embed-link-converter] pruned ${removed.length} expired backup(s) from ${PLUGIN_DIR}/backups`);
      }
    } catch (error) {
      console.warn("[embed-link-converter] backup pruning failed", error);
    }
  }

  async rollbackLastRun(): Promise<void> {
    const latest = await findLatestBackup(this.app.vault.adapter);
    if (!latest) {
      new Notice("Embed Link Converter：没有找到任何备份。");
      return;
    }

    try {
      const restored = await restoreBackup(this.app.vault, latest);
      new Notice(`Embed Link Converter：已从 ${latest} 回滚 ${restored.length} 个文件。`, 10000);
    } catch (error) {
      new Notice(`Embed Link Converter：回滚失败。\n${String(error)}`, 10000);
      console.error("[embed-link-converter] rollback failed", error);
    }
  }
}