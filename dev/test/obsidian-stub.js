"use strict";
// Minimal stand-ins so main.js can be required outside Obsidian.
class Component {}
class Plugin extends Component {
  constructor(app, manifest) {
    super();
    this.app = app;
    this.manifest = manifest;
    this._data = null;
    this.saved = [];
  }
  async loadData() {
    return this._data === null ? null : JSON.parse(JSON.stringify(this._data));
  }
  async saveData(data) {
    this._data = JSON.parse(JSON.stringify(data));
    this.saved.push(this._data);
  }
  addSettingTab() {}
  registerEvent() {}
}
class Modal {
  constructor(app) {
    this.app = app;
  }
  open() {}
  close() {}
}
class SuggestModal extends Modal {
  setPlaceholder() {}
}
class FuzzySuggestModal extends SuggestModal {}
class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
  }
}
class Notice {
  constructor(message) {
    Notice.messages.push(message);
  }
}
Notice.messages = [];
class TAbstractFile {
  constructor(path) {
    this.path = path;
  }
}
class TFolder extends TAbstractFile {}
class TFile extends TAbstractFile {}
class Setting {}
class ButtonComponent {}
class ExtraButtonComponent {}
module.exports = {
  Component,
  Plugin,
  Modal,
  SuggestModal,
  FuzzySuggestModal,
  PluginSettingTab,
  Notice,
  TAbstractFile,
  TFolder,
  TFile,
  Setting,
  ButtonComponent,
  ExtraButtonComponent,
};
