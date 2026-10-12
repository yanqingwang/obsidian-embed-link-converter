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

module.exports = { TFile, TFolder, TAbstractFile };