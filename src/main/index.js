'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { Config } = require('../shared/config');
const { createLogger } = require('../shared/logger');
const { buildWindowOptions } = require('./window-options');
const { registerIpc } = require('./ipc');

const config = new Config();
const logger = createLogger({
  scope: 'main',
  level: config.get('logging.level'),
  logDir: config.get('logging.toFile') ? path.join(config.get('app.dataDir'), 'logs') : null,
});

const smokeMode = process.env.MOCKINGBIRD_SMOKE === '1';

function createMainWindow() {
  const win = new BrowserWindow(buildWindowOptions(config));
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => {
    logger.info('renderer loaded');
    if (smokeMode) setTimeout(() => app.quit(), 300);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    logger.error('renderer failed to load', { code, desc });
    if (smokeMode) app.exit(1);
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    registerIpc(ipcMain, {
      config,
      appInfo: { name: app.getName(), version: app.getVersion(), platform: process.platform },
    });
    createMainWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
