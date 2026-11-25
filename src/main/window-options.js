'use strict';

const path = require('node:path');

/**
 * Build BrowserWindow options. Pure function so it can be unit tested without Electron.
 * Security defaults: no node integration, context isolation, sandboxed renderer.
 */
function buildWindowOptions(config, { preloadPath } = {}) {
  return {
    width: config.get('window.width'),
    height: config.get('window.height'),
    minWidth: config.get('window.minWidth'),
    minHeight: config.get('window.minHeight'),
    backgroundColor: config.get('window.backgroundColor'),
    title: config.get('app.name'),
    show: false,
    webPreferences: {
      preload: preloadPath || path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  };
}

module.exports = { buildWindowOptions };
