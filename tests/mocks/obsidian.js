/**
 * Minimal stand-ins for the Obsidian classes the scope/backup code constructs or narrows against.
 * The real package is a type-only facade at runtime, so tests supply just enough behaviour.
 */

class TAbstractFile {
  constructor(path) {
    this.path = path;
    this.name = path.split("/").pop();
  }
}

class TFile extends TAbstractFile {
  constructor(path, content = "") {
    super(path);
    this.extension = path.includes(".") ? path.split(".").pop() : "";
    this.stat = { ctime: 0, mtime: 0, size: content.length };
    this.parent = null;
    this.vault = null;
  }
}

class TFolder extends TAbstractFile {
  constructor(path) {
    super(path);
    this.children = [];
    this.isRoot = path === "/";
  }
}

/** Records what the plugin told the user, so tests can assert a Notice actually appeared. */
const notices = [];

class Notice {
  constructor(message) {
    this.message = message;
    notices.push(message);
  }
  setMessage(message) {
    this.message = message;
    notices[notices.length - 1] = message;
  }
}

/**
 * Chainable no-op. Enough for `display()` to run without a DOM, which is what the settings tab
 * does on every version before 1.13.
 */
class Setting {
  constructor(containerEl) {
    this.containerEl = containerEl;
  }
  setName() {
    return this;
  }
  setDesc() {
    return this;
  }
  setHeading() {
    return this;
  }
  setButtonText() {
    return this;
  }
  setWarning() {
    return this;
  }
  setPlaceholder() {
    return this;
  }
  addButton(fn) {
    fn(this._child());
    return this;
  }
  addText(fn) {
    fn(this._child());
    return this;
  }
  addToggle(fn) {
    fn(this._child());
    return this;
  }
  addDropdown(fn) {
    fn(this._child());
    return this;
  }
  _child() {
    return {
      setName: () => {},
      setDesc: () => {},
      setPlaceholder: () => {},
      setValue: () => {},
      setButtonText: () => {},
      setWarning: () => {},
      addOption: () => {},
      onChange: () => {},
      onClick: () => {},
    };
  }
}

class FuzzySuggestModal {
  constructor(app) {
    this.app = app;
  }
  setPlaceholder() {}
  open() {
    return this;
  }
}

class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = { empty() {}, createEl: () => ({}) };
  }
}

module.exports = {
  TFile,
  TFolder,
  TAbstractFile,
  Notice,
  Setting,
  FuzzySuggestModal,
  PluginSettingTab,
  notices,
};