'use strict';

const fs = require('node:fs');
const { computeProgress } = require('./stats');
const { sessionToMarkdown, defaultExportName } = require('./export');

/** Application-level history operations used by the IPC layer. */
class HistoryService {
  constructor({ store, showSaveDialog, writeFile = fs.promises.writeFile, now = Date.now, tzOffsetMinutes = () => new Date().getTimezoneOffset() }) {
    this.store = store;
    this.showSaveDialog = showSaveDialog;
    this.writeFile = writeFile;
    this.now = now;
    this.tzOffsetMinutes = tzOffsetMinutes;
  }

  save(snapshot) {
    return this.store.save(snapshot);
  }

  list(options) {
    return this.store.list(options);
  }

  get(id) {
    return this.store.get(id);
  }

  delete(id) {
    return this.store.delete(id);
  }

  clear() {
    return this.store.clear();
  }

  stats() {
    return computeProgress(this.store.list(), { now: this.now(), tzOffsetMinutes: this.tzOffsetMinutes() });
  }

  /** Ask where to save, then write a Markdown report. Returns { path } or { canceled: true }. */
  async exportSession(id) {
    const snapshot = this.store.get(id);
    if (!snapshot) throw new Error('That interview was not found');
    const markdown = sessionToMarkdown(snapshot);
    const result = await this.showSaveDialog({
      title: 'Export interview report',
      defaultPath: defaultExportName(snapshot),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!result || result.canceled || !result.filePath) return { canceled: true };
    await this.writeFile(result.filePath, markdown, 'utf8');
    return { path: result.filePath };
  }
}

module.exports = { HistoryService };
