/**
 * Smoke-loads the real built bundle against a stubbed `obsidian` module and checks that the plugin
 * registers its commands without throwing. A plugin that throws at import or at onload() is broken
 * in Obsidian, and neither `tsc` nor jest would catch it.
 */
const Module = require("module");
const path = require("path");

const stub = `
class Component { constructor(){} onload(){} unload(){} }
class Plugin {
  constructor(app, manifest) { this.app = app; this.manifest = manifest; this.commands = []; this.settingTabs = []; this.ribbons = []; }
  addCommand(c) { this.commands.push(c); return c; }
  addRibbonIcon(i, t, cb) { this.ribbons.push({i,t,cb}); return {}; }
  addSettingTab(t) { this.settingTabs.push(t); }
  registerEvent() {}
  registerDomEvent() {}
  registerInterval() {}
  async loadData() { return null; }
  async saveData() {}
}
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = { empty(){}, createEl(){}, createDiv(){}, style:{} }; } }
class Notice { constructor(m) { this.message = m; } setMessage(m) { this.message = m; } }
class Modal { constructor(app) { this.app = app; this.contentEl = {}; this.titleEl = { setText(){} }; } open(){} close(){} }
class Setting { constructor() { this.selectEl = { addEventListener(){} }; }
  setName(){return this} setDesc(){return this} setHeading(){return this}
  addText(){return this} addToggle(){return this} addDropdown(){return this} addButton(){return this} }
class TAbstractFile { constructor(p) { this.path = p; } }
class TFile extends TAbstractFile { constructor(p) { super(p); this.extension = (p.split(".").pop() || ""); } }
class TFolder extends TAbstractFile { constructor(p) { super(p); this.children = []; this.isRoot = p === "/"; } }
class FuzzySuggestModal { constructor(app) { this.app = app; } setPlaceholder(){} open(){} }
module.exports = { Plugin, PluginSettingTab, Notice, Modal, Setting, TFile, TFolder, TAbstractFile, FuzzySuggestModal, Component };
`;

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") {
    const stubModule = { exports: {} };
    new Function("module", "exports", stub)(stubModule, stubModule.exports);
    return stubModule.exports;
  }
  return origLoad.call(this, request, parent, isMain);
};

(async () => {
  const bundle = process.argv[2];
  const mod = require(path.resolve(bundle));
  const PluginClass = mod.default || mod;

  const app = {
    vault: {
      adapter: {
        exists: async () => false,
        list: async () => ({ files: [], folders: [] }),
      },
      getMarkdownFiles: () => [],
      getRoot: () => ({ children: [] }),
      getAbstractFileByPath: () => null,
    },
    workspace: { getActiveFile: () => null },
  };

  const plugin = new PluginClass(app, { id: "embed-link-converter", version: "0.1.0" });
  await plugin.onload();

  const expected = [
    "wiki-to-markdown",
    "markdown-to-wiki",
    "current-note-wiki-to-markdown",
    "current-note-markdown-to-wiki",
    "current-folder-wiki-to-markdown",
    "current-folder-markdown-to-wiki",
    "rollback",
  ];
  const ids = plugin.commands.map((c) => c.id);

  const missing = expected.filter((id) => !ids.includes(id));
  const problems = [];
  if (missing.length) problems.push(`missing commands: ${missing.join(", ")}`);
  if (plugin.settingTabs.length !== 1) problems.push("settings tab not registered");
  if (plugin.ribbons.length !== 1) problems.push("ribbon icon not registered");
  if (!plugin.settings || plugin.settings.scopeFolder !== "") {
    problems.push("defaults not loaded");
  }

  // The declarative settings API has to survive bundling. Unit tests import the TypeScript source;
  // this is the only check that runs against the artefact users actually load. Without it, nothing
  // in the tab appears in Obsidian's settings search on 1.13.0+.
  const settingsTab = plugin.settingTabs[0];
  let searchable = 0;
  if (typeof settingsTab.getSettingDefinitions !== "function") {
    problems.push("settings tab does not implement getSettingDefinitions()");
  } else {
    const keys = settingsTab
      .getSettingDefinitions()
      .flatMap((group) => group.items ?? [])
      .map((item) => item.control?.key)
      .filter(Boolean);
    searchable = keys.length;
    if (searchable !== Object.keys(plugin.settings).length) {
      problems.push(`${searchable} searchable settings but ${Object.keys(plugin.settings).length} stored`);
    }
    // The stub base class has no such method, so this only passes if the override really shipped.
    if (settingsTab.getControlValue("scope") === undefined) {
      problems.push("getControlValue() did not resolve a stored setting");
    }
  }

  // A run with an empty scope must be a clean no-op, not a throw.
  await plugin.runConversion("wiki-to-md");

  console.log(JSON.stringify({ commands: ids, ribbon: plugin.ribbons.length, settingsTab: plugin.settingTabs.length, searchableSettings: searchable, problems }, null, 2));
  process.exit(problems.length ? 1 : 0);
})().catch((e) => {
  console.error("SMOKE LOAD FAILED:", e);
  process.exit(1);
});