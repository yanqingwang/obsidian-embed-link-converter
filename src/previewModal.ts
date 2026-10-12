import { App, Modal } from "obsidian";
import type { Direction } from "./converter";
import type { Plan } from "./planner";

/**
 * The confirmation step. Nothing is written until this dialog is accepted.
 *
 * It shows real before/after text rather than just a count, because the failure this plugin has to
 * avoid is a bulk rewrite the user approved without noticing that it was rewriting the wrong thing
 * — and the only way to notice that in advance is to see it.
 */

export interface PreviewRequest {
  readonly direction: Direction;
  readonly scopeDescription: string;
  readonly plan: Plan;
  readonly backupEnabled: boolean;
  readonly retentionDays: number;
  /** Notes where a note transclusion becomes a plain link, which changes what renders. */
  readonly noteEmbeds: number;
}

const MAX_RENDERED_FILES = 300;
const MAX_CHANGES_PER_FILE = 20;

export const DIRECTION_LABEL: Record<Direction, string> = {
  "wiki-to-md": "双链嵌入 → Markdown 图片",
  "md-to-wiki": "Markdown 图片 → 双链嵌入",
};

export class PreviewModal extends Modal {
  private readonly request: PreviewRequest;
  private readonly onConfirm: () => void;

  constructor(app: App, request: PreviewRequest, onConfirm: () => void) {
    super(app);
    this.request = request;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { plan, direction, scopeDescription, noteEmbeds } = this.request;
    const { contentEl } = this;

    this.titleEl.setText(DIRECTION_LABEL[direction]);
    contentEl.empty();

    contentEl.createEl("p", {
      cls: "elc-summary",
      text:
        plan.files.length === 0
          ? "Nothing to convert."
          : `${plan.files.length} note${plan.files.length === 1 ? "" : "s"} · ${plan.totalChanges} embed${
              plan.totalChanges === 1 ? "" : "s"
            } · scope: ${scopeDescription}`,
    });

    if (plan.skipped > 0) {
      contentEl.createEl("p", {
        cls: "elc-muted",
        text: `${plan.skipped} note${plan.skipped === 1 ? "" : "s"} already in the target format and will not be touched.`,
      });
    }

    if (noteEmbeds > 0) {
      contentEl.createEl("p", {
        cls: "elc-warning",
        text: `${noteEmbeds} of these are note transclusions (![[Some Note]]). Converting one turns a rendered excerpt into a plain link — check them below.`,
      });
    }

    if (this.request.backupEnabled) {
      const days = this.request.retentionDays;
      contentEl.createEl("p", {
        cls: "elc-muted",
        text:
          days > 0
            ? `Originals will be copied to .obsidian/plugins/embed-link-converter/backups/. Backups older than ${days} day${
                days === 1 ? "" : "s"
              } are deleted automatically.`
            : "Originals will be copied to .obsidian/plugins/embed-link-converter/backups/ and kept indefinitely.",
      });
    } else {
      contentEl.createEl("p", {
        cls: "elc-warning",
        text: "Backups are turned off. Obsidian's own file recovery will be the only way back.",
      });
    }

    const list = contentEl.createDiv({ cls: "elc-files" });
    const shown = plan.files.slice(0, MAX_RENDERED_FILES);
    for (const file of shown) this.renderFile(list, file.path, file.changes);
    if (plan.files.length > shown.length) {
      list.createEl("p", {
        cls: "elc-muted",
        text: `… and ${plan.files.length - shown.length} more notes, not listed here.`,
      });
    }

    const buttons = contentEl.createDiv({ cls: "elc-buttons" });
    const cancel = buttons.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());

    const apply = buttons.createEl("button", {
      text: plan.files.length === 0 ? "关闭" : `转换 ${plan.files.length} 个文件`,
      cls: "mod-cta",
    });
    apply.addEventListener("click", () => {
      this.close();
      if (plan.files.length > 0) this.onConfirm();
    });

    apply.focus();
  }

  private renderFile(parent: HTMLElement, path: string, changes: Plan["files"][number]["changes"]): void {
    const details = parent.createEl("details", { cls: "elc-file" });
    const summary = details.createEl("summary");
    summary.createSpan({ cls: "elc-path", text: path });
    summary.createSpan({ cls: "elc-count", text: `${changes.length}` });

    const shown = changes.slice(0, MAX_CHANGES_PER_FILE);
    for (const change of shown) {
      const row = details.createDiv({ cls: "elc-change" });
      row.createEl("code", { cls: "elc-before", text: change.before });
      row.createSpan({ cls: "elc-arrow", text: "→" });
      row.createEl("code", { cls: "elc-after", text: change.after });
    }
    if (changes.length > shown.length) {
      details.createEl("p", {
        cls: "elc-muted",
        text: `… and ${changes.length - shown.length} more in this note.`,
      });
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}